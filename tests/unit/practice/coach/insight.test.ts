import { describe, expect, it } from 'vitest';
import type { CoachAnalysis, DeliveryRecord, NormalizedSwing } from '@/contracts/practice';
import { analyzeBall, coachTip, compareAttempts, metStandard, praiseEarned, primaryInsight, tipOf, tipSentence, unwarnedRisks, type CoachTip } from '@/practice/coach';
import type { BallFacts } from '@/practice/coach/facts';
import { formatMessage } from '@/i18n/format';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import { play, recordFor, referenceRecord, swingFor } from './fixtures';

/** A full ball on middle stump, and a good length well wide of off stump (the coach leaves it). */
const FULL_STRAIGHT = recordFor({ variation: 'stock', lengthM: 3.4, lineM: 0.0, speedKph: 132 });
const WIDE = recordFor({ variation: 'stock', lengthM: 6.2, lineM: 0.32, speedKph: 136 });

function attempt(record: DeliveryRecord, swing: NormalizedSwing | null): CoachAnalysis {
  const { record: r, result } = play(record, swing);
  return analyzeBall(r, result);
}

/** The recommended response's own swing, shifted in time (ms, + = late) and, optionally, with other footwork. */
function recommendedSwing(record: DeliveryRecord, shiftMs = 0, footwork?: NormalizedSwing['footwork']): NormalizedSwing | null {
  const rec = analyzeBall(record).options[0];
  if (!rec.swing) return null;
  return { ...rec.swing, startT: Math.round((rec.swing.startT + shiftMs / 1000) * 1e4) / 1e4, ...(footwork ? { footwork } : {}) };
}

/** A reference ball the coach recommends playing (not leaving), at Real. */
function playedBall(): DeliveryRecord {
  for (const id of ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-6'] as const) {
    const r = referenceRecord(id, 'real');
    if (analyzeBall(r).options[0].decision !== 'leave') return r;
  }
  throw new Error('no reference ball to play');
}

describe('primaryInsight', () => {
  it('is why[0] and the rounded timing error', () => {
    const r = referenceRecord('ref-1');
    const a = attempt(r, swingFor(r, { directionDeg: 42, errorMs: 37.6 }));
    const p = primaryInsight(a);
    expect(p.reason).toBe(a.why[0]);
    expect(p.timingMs).toBe(Math.round(a.attempted.timingErrorMs!));
    expect(primaryInsight(attempt(r, null)).timingMs).toBeNull();
  });

  it('always points at the recommended response', () => {
    for (const id of ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5', 'ref-6'] as const) {
      const a = attempt(referenceRecord(id), null);
      const rec = a.options[0];
      const p = primaryInsight(a).recommendation;
      expect(p.decision).toBe(rec.decision);
      expect(p.footwork).toBe(rec.footwork);
      if (p.kind === 'attack_the_gap' || p.kind === 'aim_for_the_gap') expect(p.directionDeg).toBe(rec.swing!.directionDeg);
    }
  });

  it('leaving a ball that hits the stumps: play at it', () => {
    for (const id of ['ref-2', 'ref-6'] as const) {
      const a = attempt(referenceRecord(id), null);
      expect(a.ball.wouldHitStumps).toBe(true);
      expect(primaryInsight(a).recommendation.kind).toBe('play_at_the_stumps');
    }
  });

  it('playing at a ball the coach would leave: leave it', () => {
    const aw = analyzeBall(WIDE);
    expect(aw.options[0].decision).toBe('leave');
    expect(primaryInsight(attempt(WIDE, swingFor(WIDE, { kind: 'defend' }))).recommendation.kind).toBe('leave_outside_off');
  });

  it('the right stroke, late or early: play earlier or later, by how much', () => {
    const r = playedBall();
    const late = primaryInsight(attempt(r, recommendedSwing(r, 70)));
    expect(late.recommendation.kind).toBe('play_earlier');
    expect(Math.abs(late.recommendation.shiftMs! - 70)).toBeLessThanOrEqual(1);
    const early = primaryInsight(attempt(r, recommendedSwing(r, -70)));
    expect(early.recommendation.kind).toBe('play_later');
    expect(Math.abs(early.recommendation.shiftMs! - 70)).toBeLessThanOrEqual(1);
  });

  it('the recommended response, executed: repeat it', () => {
    const r = playedBall();
    const a = attempt(r, recommendedSwing(r));
    expect(metStandard(a)).toBe(true);
    expect(primaryInsight(a).recommendation.kind).toBe('repeat_it');
    expect(primaryInsight(attempt(WIDE, null)).recommendation.kind).toBe('repeat_it');
  });

  it('feet that fought the length: get forward to the full ball', () => {
    // A full ball on the stumps: it must be played, so the recommended response is a stroke or a block.
    const r = FULL_STRAIGHT;
    const rec = analyzeBall(r).options[0];
    expect(rec.decision).not.toBe('leave');
    const a = attempt(r, swingFor(r, { kind: rec.swing!.kind, directionDeg: rec.swing!.directionDeg, power: rec.swing!.power, elevation: rec.swing!.elevation, footwork: 'back' }));
    expect(a.read.length).toBe('wrong');
    expect(primaryInsight(a).recommendation.kind).toBe('get_forward');
  });
});

describe('after a stroke that worked (RK-F06)', () => {
  it('the card confirms it, or the record says why the coach would still change it', () => {
    let checked = 0;
    // Ball-appropriate, independently frozen responses. This population deliberately does not ask Coach what to
    // play: it covers the full outswinger's cover drive, the inswinger's straight drive, the bouncer's back-foot hook
    // and a straight full ball. The former universal-drive grid became almost entirely misses after physical shot
    // reach/anatomy landed, so it no longer supplied enough *worked strokes* to exercise RK-F06.
    const cases = [
      { record: referenceRecord('ref-1'), footwork: 'forward' as const, directions: [40, 50, 60], power: 0.6, elevation: 0.05 },
      { record: referenceRecord('ref-2'), footwork: 'forward' as const, directions: [-10, 0, 10], power: 0.6, elevation: 0.05 },
      { record: referenceRecord('ref-5'), footwork: 'back' as const, directions: [-145, -135, -125], power: 0.55, elevation: 0 },
      { record: FULL_STRAIGHT, footwork: 'forward' as const, directions: [-10, 0, 10], power: 0.6, elevation: 0.05 },
    ];
    for (const { record, footwork, directions, power, elevation } of cases) {
      for (const directionDeg of directions) {
        const a = attempt(record, swingFor(record, { directionDeg, footwork, power, elevation }));
        const at = a.attempted;
        if (at.dismissal !== null || at.contact !== 'middle' || at.runs === 0) continue;
        checked++;
        const k = primaryInsight(a).recommendation.kind;
        if (k === 'well_played' || k === 'repeat_it') continue;
        // Not confirmed: the stroke was lucky, and the record shows it (a protected aim, a misread, or less value).
        const s = at.spread!;
        const value = (x: { dismissalRisk: number; expectedRuns: number }) => x.expectedRuns - 24 * x.dismissalRisk;
        const lucky = s.risks.includes('into_protected_region') || Object.values(a.read).includes('wrong') || value(s) < value(a.options[0]) - 0.25;
        expect(lucky, `${k} after ${JSON.stringify(at)}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  // Anti-fake rule 7 (no unearned praise; owner decision 2026-11-03, coaching REPORT decision 10): a confirmation
  // (well_played, repeat_it) praises the stroke, so it is said only when the stroke carried no risk the recommended
  // response does not. The recommendation itself never changes; only its words do, in every launch locale.
  const LOCALES = [
    ['en', practiceEn as Record<string, string>, 'en-IN'],
    ['hi', practiceHi, 'hi-IN'],
    ['hi-Latn', practiceHiLatn, 'en-IN'],
  ] as const;
  const strict = (catalog: Record<string, string>, intl: string) => ({
    tk(key: string, params?: Record<string, string | number | null | undefined>) {
      if (!(key in catalog)) throw new Error(`missing copy ${key}`);
      return formatMessage(catalog[key], params, intl);
    },
  });
  const praiseIn = (catalog: Record<string, string>) =>
    ['practice.tip.do.well_played', 'practice.tip.do.repeat_it'].map((k) => catalog[k].toLocaleLowerCase());
  /** The card's words for a tip, in each locale: never a praise phrase when praise is not earned. */
  function expectNoPraise(tip: CoachTip, label: string) {
    for (const [locale, catalog, intl] of LOCALES) {
      const said = tipSentence(strict(catalog, intl), tip).toLocaleLowerCase();
      expect(praiseIn(catalog).filter((p) => said.includes(p)), `${locale} ${label}: ${said}`).toEqual([]);
    }
  }

  it('the known case: a drive that worked with an edge risk the recommended response avoids is not called well played', () => {
    // Real ref-4 as the coaching REPORT recorded it (decision 10): the recommendation carries no risk, the player's
    // drive (a different aim, worth as much over the execution spread) can take an edge. Recorded fields only.
    const known = {
      version: 3,
      ball: { variation: 'cutter', speedKph: 127, lengthM: 6.4, lineAtStumpsM: 0.08, airMovementM: 0, pitchMovementM: 0.04, heightAtBatM: 0.7, wouldHitStumps: false },
      read: { length: 'right', line: 'right', pace: 'unclear', movement: 'right', bounce: 'unclear' },
      attempted: { decision: 'attack', footwork: 'forward', directionDeg: 70, elevation: 0, power: 0.6, timingErrorMs: 3, contact: 'middle', timing: 'perfect', runs: 1, dismissal: null, spread: { dismissalRisk: 0.01, expectedRuns: 1.5, risks: ['can_edge'] } },
      why: ['found_the_gap'],
      options: [{ kind: 'recommended', decision: 'attack', footwork: 'back', swing: { kind: 'attack', startT: 0.4, directionDeg: 40, power: 0.6, elevation: 0, footwork: 'back' }, outcome: { runs: 1, boundary: null, dismissal: null, fielderId: null, endBearingDeg: null, endDistanceM: null, region: 'cover' }, contact: 'middle', contactPoint: null, contactT: 0.5, dismissalRisk: 0, expectedRuns: 0.8, region: 'cover', risks: [] }],
    } as unknown as CoachAnalysis;
    const rec = primaryInsight(known).recommendation;
    expect(rec.kind).toBe('well_played'); // the recommendation logic is unchanged ...
    expect(unwarnedRisks(known)).toEqual(['can_edge']);
    expect(praiseEarned(known, rec)).toBe(false); // ... but its praise is not earned
    const attemptFacts = { contact: { kind: 'middle' }, outcome: { dismissal: null, region: 'cover' }, coaching: { zone: 'cover', fielderRole: null } } as unknown as Parameters<typeof tipOf>[2];
    const tip = tipOf(known, {} as BallFacts, attemptFacts);
    expect(tip.action).toEqual(rec);
    expect(tip.fact).toEqual({ kind: 'unwarned', risk: 'can_edge', instead: 'aim_for_the_gap' });
    expect(tipSentence(strict(practiceEn as Record<string, string>, 'en-IN'), tip)).toBe('It worked, but that stroke can take an edge: aim for the cover gap.');
    expectNoPraise(tip, 'known case');
    // Without the risk the same stroke is praised, as before.
    const clean = { ...known, attempted: { ...known.attempted, spread: { ...known.attempted.spread!, risks: [] } } } as CoachAnalysis;
    expect(praiseEarned(clean, primaryInsight(clean).recommendation)).toBe(true);
    expect(tipSentence(strict(practiceEn as Record<string, string>, 'en-IN'), tipOf(clean, {} as BallFacts, attemptFacts))).toContain('works as well as the coach');
  });

  it('when the recommended response is a leave, the action said is that leave, never the praise', () => {
    // Found by the reference population below (Real ref-4, a 40° drive that worked but can be caught, while the coach
    // would leave the ball): the first version kept "that works as well as the coach's choice" for a leave.
    const leaveKnown = {
      version: 3,
      ball: { variation: 'outswing', speedKph: 138, lengthM: 5.2, lineAtStumpsM: 0.32, airMovementM: 0.18, pitchMovementM: 0.01, heightAtBatM: 0.8, wouldHitStumps: false },
      read: { length: 'right', line: 'right', pace: 'unclear', movement: 'right', bounce: 'unclear' },
      attempted: { decision: 'attack', footwork: 'forward', directionDeg: 40, elevation: 0.05, power: 0.6, timingErrorMs: 2, contact: 'middle', timing: 'perfect', runs: 2, dismissal: null, spread: { dismissalRisk: 0.005, expectedRuns: 1.2, risks: ['can_be_caught'] } },
      why: ['found_the_gap'],
      options: [{ kind: 'recommended', decision: 'leave', swing: null, footwork: 'forward', outcome: { runs: 0, boundary: null, dismissal: null, fielderId: null, endBearingDeg: null, endDistanceM: null, region: null }, contact: 'leave', contactPoint: null, contactT: null, dismissalRisk: 0, expectedRuns: 0, region: null, risks: [] }],
    } as unknown as CoachAnalysis;
    const rec = primaryInsight(leaveKnown).recommendation;
    expect(rec.kind).toBe('well_played');
    const tip = tipOf(leaveKnown, {} as BallFacts, { contact: { kind: 'middle' }, outcome: { dismissal: null, region: 'cover' }, coaching: { zone: 'cover', fielderRole: null } } as unknown as Parameters<typeof tipOf>[2]);
    expect(tip.fact).toEqual({ kind: 'unwarned', risk: 'can_be_caught', instead: 'leave_outside_off' });
    expect(tipSentence(strict(practiceEn as Record<string, string>, 'en-IN'), tip)).toBe('It worked, but that stroke can be caught: leave it, it is passing off stump.');
    expectNoPraise(tip, 'known leave case');
  });

  it('every confirmed stroke on the reference balls (Real ref-4 drives included) is praised only when earned', () => {
    const cases = [
      { record: referenceRecord('ref-4', 'real'), footwork: 'forward' as const, directions: [30, 40, 50, 60], power: 0.6, elevation: 0.05 },
      { record: referenceRecord('ref-4', 'real'), footwork: 'back' as const, directions: [30, 45, 60], power: 0.6, elevation: 0 },
      { record: referenceRecord('ref-1'), footwork: 'forward' as const, directions: [40, 50, 60], power: 0.6, elevation: 0.05 },
      { record: referenceRecord('ref-2'), footwork: 'forward' as const, directions: [-10, 0, 10], power: 0.6, elevation: 0.05 },
      { record: FULL_STRAIGHT, footwork: 'forward' as const, directions: [-10, 0, 10], power: 0.6, elevation: 0.05 },
    ];
    for (const { record, footwork, directions, power, elevation } of cases) {
      for (const directionDeg of directions) {
        const swing = swingFor(record, { directionDeg, footwork, power, elevation });
        const { record: r, result } = play(record, swing);
        const a = analyzeBall(r, result);
        const rec = primaryInsight(a).recommendation;
        if (rec.kind !== 'well_played' && rec.kind !== 'repeat_it') continue;
        const tip = coachTip(r, a);
        const earned = unwarnedRisks(a).length === 0;
        expect(praiseEarned(a, rec)).toBe(earned);
        if (earned) continue;
        expect(tip.fact.kind, JSON.stringify(a.attempted)).toBe('unwarned');
        expectNoPraise(tip, `${record.seed} ${directionDeg}°`);
      }
    }
  }, 120_000);

  it('a leave key says why the ball misses: in line with the stumps and missing means over the top', () => {
    for (const r of [WIDE, referenceRecord('ref-3'), referenceRecord('ref-5')]) {
      const a = attempt(r, swingFor(r, { kind: 'defend' }));
      const k = primaryInsight(a).recommendation.kind;
      if (!k.startsWith('leave_')) continue;
      const inLine = Math.abs(a.ball.lineAtStumpsM) < 0.1503;
      if (inLine || a.ball.heightAtBatM >= 1) expect(k).toBe('leave_over_the_top');
      else expect(k).toBe(a.ball.lineAtStumpsM < 0 ? 'leave_down_leg' : 'leave_outside_off');
    }
  });
});

describe('compareAttempts', () => {
  it('closer timing on the same stroke', () => {
    const r = playedBall();
    const prev = attempt(r, recommendedSwing(r, 70));
    const next = attempt(r, recommendedSwing(r, 10));
    const c = compareAttempts(prev, next);
    expect(c.changes).toContain('timing_closer');
    expect(c.timingMs!).toBeGreaterThanOrEqual(55);
    expect(c.verdict).toBe('better');
    const back = compareAttempts(next, prev);
    expect(back.changes).toContain('timing_further');
    expect(back.verdict).toBe('worse');
  });

  it('from bowled leaving it to surviving with the right decision', () => {
    const r = referenceRecord('ref-2');
    const prev = attempt(r, null);
    const next = attempt(r, recommendedSwing(r));
    const c = compareAttempts(prev, next);
    expect(c.changes[0]).toBe('survived_now');
    expect(c.changes).toContain('decision_right_now');
    expect(c.timingMs).toBeNull();
    expect(c.verdict).toBe('better');
    expect(compareAttempts(next, prev).changes[0]).toBe('out_now');
  });

  it('the same attempt twice is the same', () => {
    const r = referenceRecord('ref-1');
    const s = swingFor(r, { directionDeg: 42, errorMs: 20 });
    const c = compareAttempts(attempt(r, s), attempt(r, s));
    expect(c).toEqual({ changes: ['same_again'], verdict: 'same', timingMs: 0, runsDelta: 0 });
  });

  it('right footwork this time', () => {
    const r = FULL_STRAIGHT;
    const rec = analyzeBall(r).options[0];
    const o = { kind: rec.swing!.kind, directionDeg: rec.swing!.directionDeg, power: rec.swing!.power, elevation: rec.swing!.elevation };
    const prev = attempt(r, swingFor(r, { ...o, footwork: 'back' }));
    const next = attempt(r, swingFor(r, { ...o, footwork: rec.footwork }));
    expect(rec.footwork).toBe('forward');
    expect(compareAttempts(prev, next).changes).toContain('footwork_right_now');
  });
});
