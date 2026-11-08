import { describe, expect, it } from 'vitest';
import type { DeviceAssessment } from '@/contracts';
import {
  DEGRADATION_STEPS,
  INVARIANTS,
  QUALITY_TIERS,
  SessionMonitor,
  TIER_RENDERING,
  allowedQualityChoices,
  classifyDevice,
  effectiveQuality,
  effectiveTier,
  qualityChoiceForTier,
  tierChanged,
  tierChoiceFor,
  tierChoices,
  tierForAssessment,
  tierForQuality,
  type QualityChoice,
} from '@/perf';
import { measurements, steady } from './fixtures';

const premium = classifyDevice(measurements({ profile: 'high', memoryGb: 8 }));
const standard = classifyDevice(measurements());
const lowMemory = classifyDevice(measurements({ memoryGb: 2 }));
const assisted = classifyDevice(measurements({ frameMs: steady(48, 2) }));
const below = classifyDevice(measurements({ renderer: 'Google SwiftShader' }));

describe('the player-facing tiers', () => {
  it('fixtures cover every technical case', () => {
    expect([premium.tier, premium.profile]).toEqual(['full', 'high']);
    expect([standard.tier, standard.profile]).toEqual(['full', 'standard']);
    expect([lowMemory.tier, lowMemory.profile]).toEqual(['full', 'lite']);
    expect([assisted.tier, assisted.profile]).toEqual(['assisted', 'lite']);
    expect(below.tier).toBe('below');
  });

  it('Premium is High, Balanced is Standard and Lite, Classic is the 2D stage', () => {
    expect(QUALITY_TIERS).toEqual(['premium', 'balanced', 'classic']);
    expect(tierForQuality({ stage: '3d', profile: 'high' })).toBe('premium');
    expect(tierForQuality({ stage: '3d', profile: 'standard' })).toBe('balanced');
    expect(tierForQuality({ stage: '3d', profile: 'lite' })).toBe('balanced');
    for (const p of ['lite', 'standard', 'high'] as const) expect(tierForQuality({ stage: '2d', profile: p })).toBe('classic');
    for (const t of QUALITY_TIERS) for (const p of TIER_RENDERING[t].profiles) expect(tierForQuality({ stage: TIER_RENDERING[t].stage, profile: p })).toBe(t);
  });

  it('the device check earns one tier (none before a check)', () => {
    expect(tierForAssessment(null)).toBeNull();
    expect(tierForAssessment(premium)).toBe('premium');
    expect(tierForAssessment(standard)).toBe('balanced');
    expect(tierForAssessment(lowMemory)).toBe('balanced');
    expect(tierForAssessment(assisted)).toBe('balanced');
    expect(tierForAssessment(below)).toBe('classic');
  });

  it('settings offer only what the device earned: Automatic, Premium if earned, Balanced unless Below, Classic always', () => {
    expect(tierChoices(premium)).toEqual(['auto', 'premium', 'balanced', 'classic']);
    expect(tierChoices(standard)).toEqual(['auto', 'balanced', 'classic']);
    expect(tierChoices(lowMemory)).toEqual(['auto', 'balanced', 'classic']);
    expect(tierChoices(assisted)).toEqual(['auto', 'balanced', 'classic']);
    expect(tierChoices(below)).toEqual(['auto', 'classic']);
    expect(tierChoices(null)).toEqual(['auto', 'classic']);
  });

  it('a pick maps to a technical choice the device allows', () => {
    const cases: Array<[DeviceAssessment | null, QualityChoice, QualityChoice]> = [
      [premium, qualityChoiceForTier('premium', premium), 'high'],
      [premium, qualityChoiceForTier('balanced', premium), 'standard'],
      [standard, qualityChoiceForTier('balanced', standard), 'standard'],
      [lowMemory, qualityChoiceForTier('balanced', lowMemory), 'lite'],
      [assisted, qualityChoiceForTier('balanced', assisted), 'lite'],
      [below, qualityChoiceForTier('classic', below), 'classic'],
      [null, qualityChoiceForTier('auto', null), 'auto'],
    ];
    for (const [a, got, want] of cases) {
      expect(got).toBe(want);
      expect(allowedQualityChoices(a)).toContain(got);
    }
  });

  it('stored technical choices read back as the names the player picked', () => {
    expect(tierChoiceFor('auto')).toBe('auto');
    expect(tierChoiceFor('high')).toBe('premium');
    expect(tierChoiceFor('standard')).toBe('balanced');
    expect(tierChoiceFor('lite')).toBe('balanced');
    expect(tierChoiceFor('classic')).toBe('classic');
    for (const a of [premium, standard, lowMemory, assisted, below, null])
      for (const c of tierChoices(a)) expect(tierChoiceFor(qualityChoiceForTier(c, a))).toBe(c);
  });

  it('the effective rendering agrees with effectiveQuality and never exceeds the device', () => {
    expect(effectiveTier(premium, 'premium')).toEqual({ stage: '3d', profile: 'high', tier: 'premium' });
    expect(effectiveTier(premium, 'balanced')).toEqual({ stage: '3d', profile: 'standard', tier: 'balanced' });
    expect(effectiveTier(standard, 'premium')).toEqual({ stage: '3d', profile: 'standard', tier: 'balanced' });
    expect(effectiveTier(assisted, 'auto')).toEqual({ stage: '3d', profile: 'lite', tier: 'balanced' });
    expect(effectiveTier(below, 'premium')).toEqual({ stage: '2d', profile: 'lite', tier: 'classic' });
    expect(effectiveTier(standard, 'classic')).toEqual({ stage: '2d', profile: 'lite', tier: 'classic' });
    for (const a of [premium, standard, lowMemory, assisted, below])
      for (const c of ['auto', 'lite', 'standard', 'high', 'classic'] as const) {
        const { tier, ...q } = effectiveTier(a, c);
        expect(q).toEqual(effectiveQuality(a, c));
        expect(QUALITY_TIERS.indexOf(tier)).toBeGreaterThanOrEqual(QUALITY_TIERS.indexOf(tierForAssessment(a)!));
      }
  });

  it('only a change of name is worth a notice', () => {
    expect(tierChanged({ stage: '3d', profile: 'high' }, { stage: '3d', profile: 'standard' })).toBe(true);
    expect(tierChanged({ stage: '3d', profile: 'standard' }, { stage: '3d', profile: 'lite' })).toBe(false);
    expect(tierChanged({ stage: '3d', profile: 'lite' }, { stage: '2d', profile: 'lite' })).toBe(true);
  });
});

describe('degradation removes visual expense first', () => {
  it('the documented steps go strictly down and end at Classic', () => {
    const rank = (q: { stage: '3d' | '2d'; profile: string }) => (q.stage === '2d' ? 0 : { lite: 1, standard: 2, high: 3 }[q.profile]!);
    for (const s of DEGRADATION_STEPS) {
      expect(rank(s.to)).toBeLessThan(rank(s.from));
      expect(s.removes.length).toBeGreaterThan(0);
      for (const r of s.removes) expect(INVARIANTS.some((i) => r.includes(i))).toBe(false);
    }
    expect(DEGRADATION_STEPS.at(-1)!.to.stage).toBe('2d');
  });

  it('the session monitor applies the same steps, never up', () => {
    const run = (start: { tier: 'full' | 'assisted'; profile: 'high' | 'standard' | 'lite' }, fps: number) => {
      const m = new SessionMonitor({ ...start, stage: '3d' });
      let d = null;
      for (let i = 0; i < 3; i++) {
        for (const v of steady(fps, 1.2)) m.sample(v);
        d = m.checkpoint() ?? d;
      }
      return d ? { stage: d.stage, profile: d.profile } : null;
    };
    for (const s of DEGRADATION_STEPS.slice(0, 2)) {
      const tier = 'full' as const;
      const got = run({ tier, profile: s.from.profile as 'high' | 'standard' }, s.underFps - 2);
      expect(got).not.toBeNull();
      expect(tierForQuality(got!)).not.toBe('premium');
    }
    expect(run({ tier: 'assisted', profile: 'lite' }, 43)).toEqual({ stage: '2d', profile: 'lite' });
    expect(run({ tier: 'full', profile: 'standard' }, 60)).toBeNull();
  });
});
