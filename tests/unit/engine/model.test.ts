// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Conditions, ExecutionGrade, FieldSetting, FieldZone, ShotType, TimingGrade } from '@/contracts';
import { rngFromKey } from '@/engine/prng';
import { evaluate, type BallContext, type DeliveryCore, type ModelInput } from '@/engine/v1/model';
import { ALLOWED_LENGTHS, FIELD_SETTINGS, INTENSITIES, INTENTS, LEGAL_ZONES, LINES, SHOTS, VARIANTS } from '@/engine/v1/tables';
import { CONDITIONS } from './helpers';

const ctx = (over: Partial<BallContext> = {}): BallContext => ({ ball: 3, superBall: false, lastBall: false, newBatter: false, prev: null, repeats: 0, ...over });
const D = (over: Partial<DeliveryCore> = {}): DeliveryCore => ({ variant: 'good_length', line: 'off', length: 'good', intensity: 2, intent: 'contain', ...over });
const cond: Conditions = { pitch: 'hard', weather: 'clear' };
function ev(over: Partial<ModelInput> = {}) {
  return evaluate({ d: D(), grade: 'good', shot: 'drive', zone: 'cover', timing: 'good', field: 'balanced', cond, ctx: ctx(), ...over });
}
const value = (e: ReturnType<typeof evaluate>, lambda = 1.5) => e.expectedRuns - lambda * e.pWicket;
const GRADES: TimingGrade[] = ['perfect', 'good', 'early', 'late', 'very_early', 'very_late', 'no_shot', 'interrupted'];

describe('outcome distribution integrity', () => {
  it('is a proper probability distribution over legal results for random inputs', () => {
    const rng = rngFromKey('model-integrity');
    for (let i = 0; i < 4000; i++) {
      const variant = rng.pick(VARIANTS);
      const shot = rng.pick(SHOTS) as ShotType;
      const zones = LEGAL_ZONES[shot];
      const input: ModelInput = {
        d: { variant, line: rng.pick(LINES), length: rng.pick(ALLOWED_LENGTHS[variant]), intensity: rng.pick(INTENSITIES), intent: rng.pick(INTENTS) },
        grade: rng.pick(['perfect', 'good', 'loose'] as ExecutionGrade[]),
        shot,
        zone: zones.length ? rng.pick(zones) : null,
        timing: shot === 'leave' ? 'no_shot' : rng.pick(GRADES),
        field: rng.pick(FIELD_SETTINGS) as FieldSetting,
        cond: rng.pick(CONDITIONS),
        ctx: ctx({ ball: rng.int(0, 6), superBall: rng.float() < 0.1, lastBall: rng.float() < 0.2, newBatter: rng.float() < 0.3, repeats: rng.int(0, 3) }),
      };
      const e = evaluate(input);
      let total = 0;
      for (const a of e.atoms) {
        expect(a.p).toBeGreaterThan(0);
        expect([0, 1, 2, 3, 4, 6]).toContain(a.runs);
        if (a.wicket) expect(a.runs).toBe(0);
        if (a.contact !== 'middle' && a.contact !== 'thick_edge' && a.contact !== 'thin_edge') expect(a.runs).toBe(0);
        if (a.runs === 6) expect(a.contact).toBe('middle');
        total += a.p;
      }
      expect(Math.abs(total - 1)).toBeLessThan(1e-9);
      for (const k of ['matchup', 'timing', 'execution', 'pitch', 'field', 'setup'] as const) {
        expect(e.factors[k]).toBeGreaterThanOrEqual(-1);
        expect(e.factors[k]).toBeLessThanOrEqual(1);
      }
      expect(e.factors.risk).toBeGreaterThanOrEqual(0);
      expect(e.factors.risk).toBeLessThanOrEqual(1);
    }
  });

  it('never takes a wicket off an unanswered ball, and a leave outside off is always safe', () => {
    const unanswered = ev({ shot: 'leave', zone: null, timing: 'interrupted', d: D({ line: 'middle', variant: 'yorker', length: 'full', intent: 'attack' }) });
    expect(unanswered.pWicket).toBe(0);
    for (const variant of VARIANTS) expect(ev({ shot: 'leave', zone: null, timing: 'no_shot', d: D({ variant, line: 'wide_off', length: ALLOWED_LENGTHS[variant][0] }) }).pWicket).toBe(0);
    expect(ev({ shot: 'leave', zone: null, timing: 'no_shot', d: D({ line: 'middle', variant: 'inswing', length: 'full' }) }).pWicket).toBeGreaterThan(0.3);
  });
});

describe('every factor moves the result in the documented direction', () => {
  it('timing: perfect > good > early/late > very early/late', () => {
    const v = (timing: TimingGrade) => value(ev({ timing }));
    expect(v('perfect')).toBeGreaterThan(v('good'));
    expect(v('good')).toBeGreaterThan(v('early'));
    expect(v('late')).toBeGreaterThan(v('very_late'));
  });

  it('matchup: the right shot beats the wrong one for each delivery type', () => {
    const v = (shot: ShotType, zone: FieldZone | null, d: Partial<DeliveryCore>) => value(ev({ shot, zone, d: D(d), field: 'attacking' }));
    // Short ball: pull beats drive.
    expect(v('cut_pull', 'midwicket', { line: 'middle', length: 'short' })).toBeGreaterThan(v('drive', 'mid_on', { line: 'middle', length: 'short' }));
    // Yorker: lofting it is a gamble (far riskier than digging it out) and worth much less than lofting a half-volley.
    const yorker = D({ variant: 'yorker', length: 'full', line: 'middle' });
    const loftYorker = ev({ shot: 'loft', zone: 'mid_on', d: yorker, field: 'attacking' });
    const digOut = ev({ shot: 'rotate', zone: 'mid_on', d: yorker, field: 'attacking' });
    expect(loftYorker.pWicket).toBeGreaterThan(4 * digOut.pWicket);
    expect(loftYorker.expectedRuns).toBeLessThan(ev({ shot: 'loft', zone: 'mid_on', d: D({ length: 'full', line: 'middle' }), field: 'attacking' }).expectedRuns - 0.5);
    // Half-volley: the loft is the reward.
    expect(v('loft', 'mid_off', { length: 'full', line: 'off' })).toBeGreaterThan(v('defend', null, { length: 'full', line: 'off' }));
    // Playing against the line costs.
    expect(v('drive', 'cover', { line: 'off' })).toBeGreaterThan(v('drive', 'midwicket', { line: 'off' }));
  });

  it('execution: a loose ball is a gift, a perfect one is harder than a good one', () => {
    const v = (grade: ExecutionGrade) => value(ev({ grade, d: D({ variant: 'yorker', length: 'full', line: 'middle' }), shot: 'loft', zone: 'mid_on' }));
    expect(v('loose')).toBeGreaterThan(v('good'));
    expect(v('good')).toBeGreaterThan(v('perfect'));
  });

  it('pitch: swing bites on Green, bounce on Hard, spin on Slow', () => {
    const v = (pitch: Conditions['pitch'], d: Partial<DeliveryCore>, shot: ShotType = 'drive', zone: FieldZone = 'cover') => value(ev({ cond: { pitch, weather: 'clear' }, d: D(d), shot, zone }));
    expect(v('green', { variant: 'outswing', length: 'full' })).toBeLessThan(v('slow', { variant: 'outswing', length: 'full' }));
    expect(v('hard', { variant: 'bouncer', length: 'short', line: 'middle' }, 'cut_pull', 'midwicket')).toBeLessThan(v('slow', { variant: 'bouncer', length: 'short', line: 'middle' }, 'cut_pull', 'midwicket'));
    expect(v('slow', { variant: 'offspin', length: 'good' })).toBeLessThan(v('green', { variant: 'offspin', length: 'good' }));
  });

  it('field: a gap beats a packed zone; slips catch more edges than a sweeper field', () => {
    const v = (field: FieldSetting, zone: FieldZone) => ev({ field, zone, shot: 'drive', d: D({ line: 'middle' }) }).expectedRuns;
    expect(v('balanced', 'mid_off')).toBeGreaterThan(v('balanced', 'mid_on'));
    const caughtEdge = (field: FieldSetting) => ev({ field, timing: 'late', d: D({ variant: 'outswing' }) }).atoms.filter((a) => a.tag === 'slips').reduce((s, a) => s + a.p, 0);
    expect(caughtEdge('attacking')).toBeGreaterThan(caughtEdge('sweeper'));
  });

  it('intent: attack takes more wickets and leaks more boundaries than contain', () => {
    const attack = ev({ d: D({ intent: 'attack' }), timing: 'late' });
    const contain = ev({ d: D({ intent: 'contain' }), timing: 'late' });
    expect(attack.pWicket).toBeGreaterThan(contain.pWicket);
    const boundary = (e: ReturnType<typeof evaluate>) => e.atoms.filter((a) => a.runs >= 4).reduce((s, a) => s + a.p, 0);
    expect(boundary(ev({ d: D({ intent: 'attack' }), timing: 'perfect' }))).toBeGreaterThan(boundary(ev({ d: D({ intent: 'contain' }), timing: 'perfect' })));
  });

  it('sequencing: a contrasting set-up strengthens the strike ball; repeats help the batter', () => {
    const strike = D({ variant: 'yorker', length: 'full', intent: 'attack' });
    const setUp = ev({ d: strike, ctx: ctx({ prev: { variant: 'bouncer', line: 'middle', length: 'short', intensity: 2, intent: 'setup', grade: 'good' } }) });
    const plain = ev({ d: strike, ctx: ctx({ prev: { variant: 'bouncer', line: 'middle', length: 'short', intensity: 2, intent: 'contain', grade: 'good' } }) });
    expect(setUp.pWicket).toBeGreaterThan(plain.pWicket);
    expect(setUp.setupStrength).toBe(1);
    // A loose set-up ball sets nothing up; a set-up followed by a non-attacking ball pays nothing.
    expect(ev({ d: strike, ctx: ctx({ prev: { variant: 'bouncer', line: 'middle', length: 'short', intensity: 2, intent: 'setup', grade: 'loose' } }) }).setupStrength).toBe(0);
    expect(ev({ d: D({ variant: 'yorker', length: 'full', intent: 'contain' }), ctx: ctx({ prev: { variant: 'bouncer', line: 'middle', length: 'short', intensity: 2, intent: 'setup', grade: 'good' } }) }).setupStrength).toBe(0);
    expect(value(ev({ ctx: ctx({ repeats: 2 }) }))).toBeGreaterThan(value(ev({ ctx: ctx({ repeats: 0 }) })));
  });

  it('situation: a new batter is slightly worse off; a last-ball rotate never ends as a fielded dot', () => {
    expect(ev({ ctx: ctx({ newBatter: true }) }).pMiddle).toBeLessThan(ev().pMiddle);
    const last = ev({ shot: 'rotate', zone: 'point', ctx: ctx({ ball: 5, lastBall: true }) });
    expect(last.atoms.some((a) => a.contact === 'middle' && a.kind === 'dot_fielded')).toBe(false);
    expect(last.atoms.some((a) => a.wicket === 'run_out' && a.tag === 'scramble')).toBe(true);
  });

  it('defence protects the wicket far better than a loft', () => {
    const d = D({ variant: 'inswing', line: 'middle', length: 'good' });
    expect(ev({ d, shot: 'defend', zone: null }).pWicket * 4).toBeLessThan(ev({ d, shot: 'loft', zone: 'mid_on' }).pWicket);
  });
});
