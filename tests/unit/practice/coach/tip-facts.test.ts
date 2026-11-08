/**
 * The tip's fact explains its one action (RK4, anti-fake rules 6 and 7). Found on the repaired physics
 * (COACH2-RERUN.md): the on-time cover drive at the full outswinger (ref-1, Play and Real) scores one run through cover,
 * but over its execution spread it can be caught, and the coach recommends the leave. The tip said "Found the cover
 * gap: leave it, it is passing off stump.", a fact that gives no reason for the action. A stroke that worked is changed
 * only for a measured risk the recommended response avoids, so that risk is the fact.
 */
import { describe, expect, it } from 'vitest';
import type { CoachAnalysis } from '@/contracts/practice';
import { formatMessage } from '@/i18n/format';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import {
  PRAISE_MIN_SPEED_SHARE,
  compareAttempts,
  praiseEarned,
  primaryInsight,
  requestedKph,
  spokenAction,
  tipActionWords,
  tipOf,
  tipSentence,
  whereOf,
  type TipTranslator,
} from '@/practice/coach';
import { candidatesFor } from '@/practice/coach/candidates';
import type { BallFacts } from '@/practice/coach/facts';

const strict = (catalog: Record<string, string>, intl: string): TipTranslator => ({
  tk(key, params) {
    if (!(key in catalog)) throw new Error(`missing copy ${key}`);
    return formatMessage(catalog[key], params, intl);
  },
});
const EN = strict(practiceEn as Record<string, string>, 'en-IN');

/** The ref-1 Play case as recorded (fields only): the drive worked, its spread can be caught, the coach leaves it. */
const worked = {
  version: 3,
  ball: {
    variation: 'outswing',
    speedKph: 137.5,
    lengthM: 3,
    lineAtStumpsM: 0.36,
    airMovementM: 0.188,
    pitchMovementM: 0,
    heightAtBatM: 0.18,
    wouldHitStumps: false,
  },
  read: { length: 'right', line: 'right', pace: 'right', movement: 'right', bounce: 'unclear' },
  attempted: {
    decision: 'attack',
    footwork: 'forward',
    directionDeg: 45,
    elevation: 0,
    power: 0.55,
    timingErrorMs: 0,
    contact: 'middle',
    timing: 'perfect',
    runs: 1,
    dismissal: null,
    spread: { dismissalRisk: 0.093, expectedRuns: 0.34, risks: ['can_be_caught'] },
  },
  why: ['found_the_gap'],
  options: [
    {
      kind: 'recommended',
      decision: 'leave',
      footwork: 'forward',
      swing: null,
      outcome: {
        runs: 0,
        boundary: null,
        dismissal: null,
        fielderId: null,
        endBearingDeg: null,
        endDistanceM: null,
        region: null,
      },
      contact: 'leave',
      contactPoint: null,
      contactT: null,
      dismissalRisk: 0,
      expectedRuns: 0,
      region: null,
      risks: [],
    },
  ],
} as unknown as CoachAnalysis;
/** ref-1 as the coach describes it (facts.ts), the fields a tip reads. */
const FACTS = {
  family: 'pace',
  lengthM: 3,
  lengthBand: 'full',
  full: true,
  short: false,
  mover: 'swing',
  playedMoveM: 0.188,
  lineAtStumpsM: 0.36,
  wideOfStumpsM: 0.21,
  wouldHitStumps: false,
} as unknown as BallFacts;
const attempt = {
  contact: { kind: 'middle' },
  outcome: { dismissal: null, region: 'cover' },
  coaching: { zone: 'cover', fielderRole: null },
} as unknown as Parameters<typeof tipOf>[2];

describe('a stroke that worked and that the coach still changes', () => {
  it('says the measured risk of the stroke as the reason for the action', () => {
    const rec = primaryInsight(worked).recommendation;
    expect(rec.kind).toBe('leave_outside_off');
    const tip = tipOf(worked, FACTS, attempt);
    expect(tip.fact).toEqual({ kind: 'unwarned', risk: 'can_be_caught', instead: 'leave_outside_off' });
    expect(tip.action).toEqual(rec);
    expect(tipSentence(EN, tip)).toBe('It worked, but that stroke can be caught: leave it, it is passing off stump.');
    for (const t of [strict(practiceHi, 'hi-IN'), strict(practiceHiLatn, 'en-IN')])
      expect(tipSentence(t, tip)).toContain(t.tk('practice.tip.do.leave_outside_off'));
  });

  it('the most serious risk first, and only risks the recommended response does not carry', () => {
    const both = {
      ...worked,
      attempted: {
        ...worked.attempted,
        spread: { dismissalRisk: 0.065, expectedRuns: 0.41, risks: ['can_be_caught', 'can_edge'] },
      },
    } as CoachAnalysis;
    expect(tipOf(both, FACTS, attempt).fact).toMatchObject({ kind: 'unwarned', risk: 'can_be_caught' });
    const shared = { ...both, options: [{ ...worked.options[0], risks: ['can_be_caught'] }] } as CoachAnalysis;
    expect(tipOf(shared, FACTS, attempt).fact).toMatchObject({ kind: 'unwarned', risk: 'can_edge' });
  });

  it('without such a risk the fact is the physics reason, as before', () => {
    const clean = {
      ...worked,
      attempted: { ...worked.attempted, spread: { dismissalRisk: 0, expectedRuns: 0.1, risks: [] } },
    } as CoachAnalysis;
    const tip = tipOf(clean, FACTS, attempt);
    expect(tip.fact).toMatchObject({ kind: 'reason', reason: 'found_the_gap' });
  });

  it('a stroke that did not work keeps its failure fact', () => {
    const caught = {
      ...worked,
      attempted: { ...worked.attempted, runs: 0, dismissal: 'caught' },
      why: ['caught_in_the_ring'],
    } as CoachAnalysis;
    const tip = tipOf(caught, FACTS, {
      ...attempt,
      outcome: { dismissal: 'caught', region: 'cover' },
    } as unknown as Parameters<typeof tipOf>[2]);
    expect(tip.fact.kind).not.toBe('unwarned');
  });
});

describe('a stroke the movement beat, when the recommended stroke aims elsewhere (phase-2 interim rerun)', () => {
  // Found on PHYS phase-2 physics (Learn and Play with 15 ms, ref-1, the 45° drive late): the swing beat the bat, the
  // coach recommends a square drive at 113°, and the card said "Beaten by the swing: play straighter, with the line.",
  // pointing away from the stroke the demonstration plays. Recorded fields only. Timed inside the band here (5 ms), so
  // the movement is the cause; the 140 ms-late original is the mistimed case below (interim 3: the timing leads).
  const beaten = {
    ...worked,
    read: { length: 'right', line: 'right', pace: 'right', movement: 'wrong', bounce: 'unclear' },
    attempted: {
      ...worked.attempted,
      timingErrorMs: 5,
      timing: 'perfect',
      contact: 'miss',
      runs: 0,
      spread: { dismissalRisk: 0.1, expectedRuns: 0.4, risks: ['can_be_caught'] },
    },
    why: ['beaten_by_swing', 'too_late'],
    options: [
      {
        ...worked.options[0],
        decision: 'attack',
        footwork: 'forward',
        swing: { kind: 'attack', startT: 0.4, directionDeg: 113, power: 0.55, elevation: 0, footwork: 'forward' },
        contact: 'middle',
        region: 'point',
        outcome: { ...worked.options[0].outcome, runs: 1, region: 'point' },
        expectedRuns: 0.83,
      },
    ],
  } as unknown as CoachAnalysis;
  const missed = {
    contact: { kind: 'miss' },
    outcome: { dismissal: null, region: null },
    coaching: { zone: null, fielderRole: null },
  } as unknown as Parameters<typeof tipOf>[2];

  it('says the movement that beat the bat and points at the recommended aim, never "play straighter"', () => {
    const rec = primaryInsight(beaten).recommendation;
    expect(rec.kind).toBe('aim_for_the_gap');
    const tip = tipOf(beaten, FACTS, missed);
    expect(tip.fact).toMatchObject({ kind: 'moved', mover: 'swing', towards: 'away', cm: 19, where: 'miss' });
    expect(tipSentence(EN, tip)).toBe('It swung 19 cm away in the air, and it beat the bat: aim for the point gap.');
  });

  it('the same stroke 140 ms late: the measured timing leads, and the action is still the recommended aim', () => {
    const late = {
      ...beaten,
      read: { ...beaten.read, pace: 'wrong' },
      attempted: { ...beaten.attempted, timingErrorMs: 140, timing: 'mistimed' },
      why: ['beaten_by_swing', 'too_late'],
    } as unknown as CoachAnalysis;
    expect(primaryInsight(late).recommendation.kind).toBe('aim_for_the_gap');
    const tip = tipOf(late, FACTS, {
      ...missed,
      contact: { kind: 'miss', faceBearingDeg: 63, intendedBearingDeg: 45 },
    } as unknown as Parameters<typeof tipOf>[2]);
    expect(tip.fact).toEqual({ kind: 'late', ms: 140, faceDeg: 18, where: 'miss', zone: null });
    expect(tipSentence(EN, tip)).toBe('140 ms late, with the bat face 18° off your line: aim for the point gap.');
  });

  it('a stroke played across the movement is still told to play straighter', () => {
    const across = { ...beaten, attempted: { ...beaten.attempted, directionDeg: -70 } } as CoachAnalysis;
    expect(primaryInsight(across).recommendation.kind).toBe('play_straighter');
  });
});

describe('praise is earned by the contact itself, never by its label (interim 3, PHYS phase 3)', () => {
  // Measured on the phase-3 tree (COACH2-RERUN addendum 3): the ref-4 45° drive at Real meets the ball on the "middle"
  // at 8–28 km/h of the 107 km/h it asks for, and the coach called it well played; the ref-5 hook's sweet window is
  // narrower than its "perfect" band; toe-cap contacts are still labelled 'middle' in contract v6, with bladeU < 0.
  const block = {
    kind: 'recommended',
    decision: 'defend',
    footwork: 'forward',
    swing: { kind: 'defend', startT: 0.4, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'forward' },
    outcome: {
      runs: 0,
      boundary: null,
      dismissal: null,
      fielderId: null,
      endBearingDeg: null,
      endDistanceM: null,
      region: null,
    },
    contact: 'middle',
    contactPoint: null,
    contactT: 0.5,
    dismissalRisk: 0,
    expectedRuns: 0.7,
    region: null,
    risks: [],
  };
  const drive = (power: number, directionDeg: number, footwork: 'forward' | 'back') =>
    ({
      ...worked,
      read: { length: 'right', line: 'right', pace: 'right', movement: 'unclear', bounce: 'unclear' },
      attempted: {
        decision: 'attack',
        footwork,
        directionDeg,
        elevation: 0,
        power,
        timingErrorMs: 0,
        contact: 'middle',
        timing: 'perfect',
        runs: 1,
        dismissal: null,
        spread: { dismissalRisk: 0, expectedRuns: 0.87, risks: [] },
      },
      why: ['found_the_gap'],
      options: [block],
    }) as unknown as CoachAnalysis;
  const met = (bladeU: number, batSpeedKph: number) =>
    ({
      contact: { kind: 'middle', bladeU, batSpeedKph },
      outcome: { dismissal: null, region: 'third_man' },
      coaching: { zone: 'third_man', fielderRole: null },
    }) as unknown as Parameters<typeof tipOf>[2];

  it('a slow fend off the middle is told plainly with the measured speed, and earns no praise', () => {
    const an = drive(0.9, 45, 'forward');
    const rec = primaryInsight(an).recommendation;
    expect(rec.kind).toBe('well_played'); // the recorded spread is worth as much: the recommendation is unchanged ...
    expect(requestedKph(an.attempted)).toBeCloseTo(106.56, 2);
    const tip = tipOf(an, FACTS, met(0.632, 28));
    expect(tip.fact).toEqual({ kind: 'slow', kph: 28, requestedKph: 107, instead: 'defend_forward' });
    expect(tipSentence(EN, tip)).toBe(
      'The bat met it at only 28 km/h, not the 107 km/h you swung: defend on the front foot.',
    );
    expect(praiseEarned(an, rec)).toBe(true); // ... the analysis alone cannot see the speed (contract v6),
    expect(praiseEarned(an, rec, tip)).toBe(false); // so the card passes the tip.
    expect(tip.cleanContact).toBe(false);
    for (const t of [strict(practiceHi, 'hi-IN'), strict(practiceHiLatn, 'en-IN')]) {
      const said = tipSentence(t, tip);
      expect(
        said.includes(t.tk('practice.tip.do.well_played')) || said.includes(t.tk('practice.tip.do.repeat_it')),
        said,
      ).toBe(false);
    }
  });

  it(`at or above ${PRAISE_MIN_SPEED_SHARE * 100}% of the requested speed and in the sweet zone, the same stroke is praised`, () => {
    const an = drive(0.7, 45, 'forward');
    const tip = tipOf(an, FACTS, met(0.22, 85));
    expect(tip.fact.kind).toBe('reason');
    expect(praiseEarned(an, primaryInsight(an).recommendation, tip)).toBe(true);
    expect(tip.cleanContact).toBe(true);
  });

  it('a hook timed "perfect" but off the sweet zone earns no praise: the contact point decides, not the label', () => {
    const an = drive(0.55, -130, 'back');
    expect(requestedKph(an.attempted)).toBeCloseTo(76.32, 2); // the hook is a full horizontal swing: no punch
    const tip = tipOf(an, FACTS, met(0.109, 60));
    expect(tip.fact).toEqual({ kind: 'off_sweet', cm: 6, towards: 'toe', instead: 'defend_forward' });
    expect(tipSentence(EN, tip)).toBe('It came off the bat 6 cm below the sweet spot: defend on the front foot.');
    expect(praiseEarned(an, primaryInsight(an).recommendation, tip)).toBe(false);
  });

  it('off the toe end (bladeU < 0, still "middle" in contract v6) is said as the toe, in the fact and in where it went', () => {
    const an = drive(0.7, 45, 'forward');
    const tip = tipOf(an, FACTS, met(-0.02, 80));
    expect(tip.fact).toEqual({ kind: 'toe', instead: 'defend_forward' });
    expect(tipSentence(EN, tip)).toBe('It came off the toe of the bat: defend on the front foot.');
    expect(whereOf({ kind: 'middle', bladeU: -0.02 }, { dismissal: null, region: 'third_man' })).toEqual({
      where: 'toe',
      zone: null,
    });
    expect(whereOf({ kind: 'middle', bladeU: 0.2 }, { dismissal: null, region: 'third_man' })).toEqual({
      where: 'zone',
      zone: 'third_man',
    });
    for (const [catalog, intl] of [
      [practiceHi, 'hi-IN'],
      [practiceHiLatn, 'en-IN'],
    ] as const)
      expect(tipSentence(strict(catalog, intl), tip).length).toBeGreaterThan(0);
  });

  it('"Clean contact this time" comes from the measured contact when the card passes it', () => {
    const slow = drive(0.9, 45, 'forward');
    expect(compareAttempts(slow, slow).changes).toEqual(['same_again']);
    expect(compareAttempts(slow, slow, { previous: false, next: true })).toMatchObject({
      changes: ['clean_contact_now'],
      verdict: 'better',
    });
    expect(compareAttempts(slow, slow, { previous: true, next: false })).toMatchObject({
      changes: ['contact_worse'],
      verdict: 'worse',
    });
  });
});

describe('repeat it is said only for the recommended stroke, on its feet, timed inside the band (interim 3)', () => {
  // Found on the phase-3 tree: at Real ref-4 the coach recommends a back-foot punch at 45°; a front-foot 45° drive
  // 42 ms early met the ball "on the middle" at 3 km/h for a run, and the card said repeat_it (COACH2's too-early check).
  const punch = {
    kind: 'recommended',
    decision: 'attack',
    footwork: 'back',
    swing: { kind: 'attack', startT: 0.4, directionDeg: 45, power: 0.55, elevation: 0, footwork: 'back' },
    outcome: {
      runs: 1,
      boundary: null,
      dismissal: null,
      fielderId: null,
      endBearingDeg: null,
      endDistanceM: null,
      region: 'cover',
    },
    contact: 'middle',
    contactPoint: null,
    contactT: 0.5,
    dismissalRisk: 0,
    expectedRuns: 0.64,
    region: 'cover',
    risks: [],
  };
  const attempt = (footwork: 'forward' | 'back', timingErrorMs: number, timing: 'perfect' | 'mistimed') =>
    ({
      ...worked,
      ball: {
        ...worked.ball,
        lengthM: 6,
        lineAtStumpsM: 0.1,
        airMovementM: 0,
        pitchMovementM: 0.09,
        wouldHitStumps: true,
      },
      read: {
        length: 'unclear',
        line: 'right',
        pace: timing === 'perfect' ? 'right' : 'wrong',
        movement: 'unclear',
        bounce: 'unclear',
      },
      attempted: {
        decision: 'attack',
        footwork,
        directionDeg: 45,
        elevation: 0,
        power: 0.55,
        timingErrorMs,
        contact: 'middle',
        timing,
        runs: 1,
        dismissal: null,
        spread: { dismissalRisk: 0, expectedRuns: 0.5, risks: [] },
      },
      why: ['found_the_gap'],
      options: [punch],
    }) as unknown as CoachAnalysis;

  it('the recommended aim on the other feet: the feet are the action, never repeat it', () => {
    expect(primaryInsight(attempt('forward', -42, 'mistimed')).recommendation.kind).toBe('get_back');
    expect(primaryInsight(attempt('forward', 0, 'perfect')).recommendation.kind).toBe('get_back');
  });

  it('the recommended stroke itself, mistimed: a timing tip; on time: repeat it', () => {
    expect(primaryInsight(attempt('back', -42, 'mistimed')).recommendation).toMatchObject({
      kind: 'play_later',
      shiftMs: 42,
    });
    expect(primaryInsight(attempt('back', 0, 'perfect')).recommendation.kind).toBe('repeat_it');
  });

  it('a block on the other feet that survived is told the recommended block, not repeat it', () => {
    const blockBack = {
      ...punch,
      decision: 'defend',
      swing: { kind: 'defend', startT: 0.4, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'back' },
      region: null,
    };
    const fwd = {
      ...attempt('forward', 0, 'perfect'),
      attempted: {
        ...attempt('forward', 0, 'perfect').attempted,
        decision: 'defend',
        directionDeg: 0,
        power: 0.2,
        runs: 0,
      },
      options: [blockBack],
    } as unknown as CoachAnalysis;
    expect(primaryInsight(fwd).recommendation.kind).toBe('defend_back');
  });
});

describe('a yorker is never met from the back plane (lead ruling 2026-11-03: a named body-model limitation)', () => {
  it('the candidate grid offers a yorker only forward responses, whichever way automatic footwork resolves', () => {
    const yorker = { ...FACTS, lengthBand: 'yorker', autoFootwork: 'forward', family: 'pace' } as unknown as BallFacts;
    const field = { gaps: [] } as unknown as Parameters<typeof candidatesFor>[1];
    const feet = (f: BallFacts, decision: 'defend' | 'attack') => [
      ...new Set(
        candidatesFor(f, field)
          .filter((c) => c.decision === decision)
          .map((c) => c.footwork),
      ),
    ];
    expect(feet(yorker, 'defend')).toEqual(['auto']);
    expect(feet(yorker, 'attack')).toEqual(['auto']);
    // Physics that resolves a yorker's automatic footwork back (the 10:24Z revert): the forward foot, explicitly.
    const backAuto = { ...yorker, autoFootwork: 'back' } as BallFacts;
    expect(feet(backAuto, 'defend')).toEqual(['forward']);
    expect(feet(backAuto, 'attack')).toEqual(['forward']);
    // Other lengths keep both feet for a block.
    expect(feet({ ...FACTS, lengthBand: 'good', autoFootwork: 'forward' } as unknown as BallFacts, 'defend')).toEqual([
      'auto',
      'back',
    ]);
  });
});

describe('a swing timed inside the band that the bat never met (lead rulings (A) and (B), 2026-11-04)', () => {
  // The physics evaluator (eval-phys-5e §4) found 627 of 1,755 results labelled perfect or solid with no bat contact
  // (62 inside the bat window, 9 in Real). On 5e the card said "Played across the line: keep it along the ground.",
  // "Struck on the pad in line: keep it along the ground." and "6 ms late, with the bat face 12° off your line: …".
  // The timing label stays an honest timing fact in Why?; the tip says plainly that the bat never reached the ball,
  // why, and one stroke-choice action, never a timing action and never "keep it down" for a ball never hit.
  const TRS = [EN, strict(practiceHi, 'hi-IN'), strict(practiceHiLatn, 'en-IN')];
  const missed = (kind: 'miss' | 'pad' | 'body' = 'miss', dismissal: string | null = null) =>
    ({
      contact: { kind },
      outcome: { dismissal, region: null },
      coaching: { zone: null, fielderRole: null },
    }) as unknown as Parameters<typeof tipOf>[2];
  const unmet = (
    o: { timing?: string; contact?: string; why?: string[]; read?: Partial<CoachAnalysis['read']>; ms?: number } = {},
  ) =>
    ({
      ...worked,
      read: { ...worked.read, ...o.read },
      attempted: {
        ...worked.attempted,
        directionDeg: -70,
        timingErrorMs: o.ms ?? 6,
        timing: o.timing ?? 'perfect',
        contact: o.contact ?? 'miss',
        runs: 0,
        dismissal: null,
        spread: { dismissalRisk: 0, expectedRuns: 0, risks: [] },
      },
      why: o.why ?? ['played_across_the_line'],
    }) as unknown as CoachAnalysis;
  /** Every language renders it, with the one action, and the English never praises or names a timing. */
  const said = (an: CoachAnalysis, at: Parameters<typeof tipOf>[2], f: BallFacts = FACTS) => {
    const tip = tipOf(an, f, at);
    for (const t of TRS) expect(tipSentence(t, tip)).toContain(tipActionWords(t, spokenAction(tip)));
    const en = tipSentence(EN, tip);
    expect(en).not.toMatch(/\bms\b|well played|same way again/i);
    expect(['play_earlier', 'play_later', 'keep_it_down', 'repeat_it', 'well_played']).not.toContain(tip.action.kind);
    return { tip, en };
  };

  it('played across the line: the line it was on, and that the bat never reached it', () => {
    const { tip, en } = said(unmet({ read: { line: 'wrong' } }), missed());
    expect(tip.fact).toEqual({ kind: 'no_reach', why: 'off', cm: 21, lengthM: null });
    expect(en).toBe('It was 21 cm wide of off stump, and the bat never reached it: leave it, it is passing off stump.');
    // Solid, off the pad: the same.
    expect(
      said(unmet({ timing: 'solid', contact: 'pad', read: { line: 'wrong' } }), missed('pad')).tip.fact,
    ).toMatchObject({ kind: 'no_reach', why: 'off' });
  });

  it('played across the movement: the movement, and that the bat never reached it', () => {
    const { tip, en } = said(unmet({ read: { movement: 'wrong' } }), missed());
    expect(tip.fact).toEqual({ kind: 'no_reach', why: 'moved_away', cm: 19, lengthM: null });
    expect(en).toBe('It moved 19 cm away, and the bat never reached it: leave it, it is passing off stump.');
  });

  it('across the line with nothing measured: said as that, never the bare label', () => {
    expect(said(unmet(), missed()).en).toBe(
      'You played across the line, and the bat never reached it: leave it, it is passing off stump.',
    );
  });

  it('the length the stroke fought, and that the bat never reached it', () => {
    const short = { ...FACTS, lengthM: 7.5, lengthBand: 'short', full: false, short: true } as unknown as BallFacts;
    const { tip, en } = said(unmet(), missed(), short);
    expect(tip.fact).toEqual({ kind: 'no_reach', why: 'too_short_to_drive', cm: null, lengthM: 7.5 });
    expect(en).toBe(
      'Pitched 7.5 m from you, too short to drive, and the bat never reached it: leave it, it is passing off stump.',
    );
  });

  it('beaten for pace with a perfect label: never "6 ms late", the stroke that never reached it', () => {
    const { tip, en } = said(unmet({ why: ['beaten_by_pace'] }), missed());
    expect(tip.fact).toEqual({ kind: 'no_reach', why: 'stroke', cm: null, lengthM: null });
    expect(en).toBe('That stroke never reached the ball: leave it, it is passing off stump.');
    // Mistimed, the same ball keeps its measured timing (only an in-band label is contradicted by it).
    expect(tipOf(unmet({ why: ['beaten_by_pace'], timing: 'mistimed', ms: 70 }), FACTS, missed()).fact).toMatchObject({
      kind: 'late_where',
      ms: 70,
    });
  });

  it('a fact that already says the bat never met it stays: the movement that beat the bat, struck on the pad', () => {
    const swung = said(unmet({ why: ['beaten_by_swing'] }), missed());
    expect(swung.tip.fact).toMatchObject({ kind: 'moved', where: 'miss' });
    expect(swung.en).toBe('It swung 19 cm away in the air, and it beat the bat: leave it, it is passing off stump.');
    const pad = said(unmet({ why: ['pad_in_line'], contact: 'pad' }), missed('pad'));
    expect(pad.en).toBe('Struck on the pad in line: leave it, it is passing off stump.');
  });

  // The recommended stroke on the cover drive (45°, grounded) and the attempt's own fields around it.
  const drive = {
    ...worked.options[0],
    decision: 'attack',
    footwork: 'forward',
    swing: { kind: 'attack', startT: 0.4, directionDeg: 45, power: 0.55, elevation: 0, footwork: 'forward' },
    contact: 'middle',
    region: 'cover',
    outcome: { ...worked.options[0].outcome, runs: 1, region: 'cover' },
  };
  const at = (o: Record<string, unknown>) =>
    ({
      ...worked,
      options: [drive],
      attempted: { ...worked.attempted, spread: { dismissalRisk: 0, expectedRuns: 0, risks: [] }, ...o },
    }) as unknown as CoachAnalysis;

  it('(A) a lofted stroke the bat never met is not told "keep it along the ground"; one it met and was caught still is', () => {
    const lofted = { elevation: 0.75, contact: 'miss', runs: 0, dismissal: null, timing: 'perfect', timingErrorMs: 3 };
    expect(primaryInsight(at(lofted)).recommendation.kind).toBe('aim_for_the_gap');
    expect(primaryInsight(at({ ...lofted, contact: 'pad' })).recommendation.kind).toBe('aim_for_the_gap');
    expect(primaryInsight(at({ ...lofted, contact: 'middle', dismissal: 'caught' })).recommendation.kind).toBe(
      'keep_it_down',
    );
  });

  it('the recommended stroke itself, timed inside the band and never met by the bat: no timing action', () => {
    const bowled = { contact: 'miss', runs: 0, dismissal: 'bowled', timing: 'solid', timingErrorMs: 30 };
    expect(primaryInsight(at(bowled)).recommendation.kind).toBe('aim_for_the_gap');
    expect(said({ ...at(bowled), why: ['missed_straight_ball'] } as CoachAnalysis, missed('miss', 'bowled')).en).toBe(
      'Missed a straight ball: aim for the cover gap.',
    );
    expect(said(at(bowled), missed('miss', 'bowled')).en).toBe(
      'That stroke never reached the ball: aim for the cover gap.',
    );
    // Off the edge, the same timing is the one recorded difference: the timing action stays.
    expect(primaryInsight(at({ ...bowled, contact: 'outside_edge' })).recommendation).toMatchObject({
      kind: 'play_earlier',
      shiftMs: 30,
    });
  });
});
