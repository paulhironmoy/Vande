import { describe, expect, it } from 'vitest';
import type { CoachingReason, ContactKind, DeliveryResult, FielderRole } from '@/contracts';
import { createPracticeT } from '@/i18n/practice';
import { coachingLines, headlineOf, markOf, oversText, timingWords, whySentences } from '@/practice/ui/coaching';
import { fakeEngine, fakeResult, plan } from './fakes';

const t = createPracticeT('en', null);
const engine = fakeEngine();

function result(over: { timing: DeliveryResult['contact']['timing']; errorMs: number | null; kind: ContactKind; reason: CoachingReason; zone?: DeliveryResult['coaching']['zone']; fielderRole?: FielderRole | null; runs?: DeliveryResult['outcome']['runs']; boundary?: 4 | 6 | null; dismissal?: DeliveryResult['outcome']['dismissal']; swing?: boolean; lbw?: DeliveryResult['coaching']['lbw'] }): DeliveryResult {
  const base = fakeResult(engine.flight({ plan: plan(), bowler: { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'x' }, conditions: 'balanced', seed: 's', handedness: 'right' }), over.swing === false ? null : { kind: 'attack', startT: 0.4, directionDeg: 40, power: 0.6, elevation: 0, footwork: 'auto' });
  return {
    ...base,
    contact: { ...base.contact, timing: over.timing, timingErrorMs: over.errorMs, kind: over.kind },
    outcome: { ...base.outcome, runs: over.runs ?? 0, boundary: over.boundary ?? null, dismissal: over.dismissal ?? null },
    coaching: { reason: over.reason, timing: null, zone: over.zone ?? null, fielderRole: over.fielderRole ?? null, lbw: over.lbw ?? null },
  };
}

describe('the coaching card (the brief’s three examples)', () => {
  it('PERFECT · Found the cover gap · FOUR', () => {
    const c = coachingLines(t, result({ timing: 'perfect', errorMs: 6, kind: 'middle', reason: 'found_the_gap', zone: 'cover', runs: 4, boundary: 4 }));
    expect([c.head, c.reason, c.result]).toEqual(['Perfect', 'Found the cover gap', 'Four']);
    expect(c.tone).toBe('boundary');
  });

  it('LATE · Outside edge · Caught behind', () => {
    const c = coachingLines(t, result({ timing: 'mistimed', errorMs: 95, kind: 'outside_edge', reason: 'edged_behind', dismissal: 'caught_behind' }));
    expect([c.head, c.reason, c.result]).toEqual(['Late', 'Outside edge', 'Caught behind']);
    expect(c.tone).toBe('out');
  });

  it('SOLID CONTACT · Hit directly to cover · DOT BALL', () => {
    const c = coachingLines(t, result({ timing: 'solid', errorMs: -40, kind: 'middle', reason: 'hit_to_fielder', fielderRole: 'cover' }));
    expect([c.head, c.reason, c.result]).toEqual(['Solid contact', 'Hit directly to cover', 'Dot ball']);
  });

  it('headlines: left alone, early, late, beaten, on the pad', () => {
    expect(headlineOf(result({ timing: 'none', errorMs: null, kind: 'leave', reason: 'left_well', swing: false }))).toBe('left');
    expect(headlineOf(result({ timing: 'missed', errorMs: -150, kind: 'miss', reason: 'too_early' }))).toBe('early');
    expect(headlineOf(result({ timing: 'missed', errorMs: 140, kind: 'miss', reason: 'too_late' }))).toBe('late');
    expect(headlineOf(result({ timing: 'solid', errorMs: 10, kind: 'pad', reason: 'pad_in_line' }))).toBe('pad');
    expect(headlineOf(result({ timing: 'solid', errorMs: 40, kind: 'outside_edge', reason: 'edged_to_slip' }))).toBe('late');
  });

  it('runs and timing words', () => {
    expect(coachingLines(t, result({ timing: 'solid', errorMs: 0, kind: 'middle', reason: 'beat_the_field', runs: 2 })).result).toBe('2 runs');
    expect(coachingLines(t, result({ timing: 'solid', errorMs: 0, kind: 'middle', reason: 'beat_the_field', runs: 1 })).result).toBe('1 run');
    expect(timingWords(t, 48, 'mistimed')).toBe('48 ms late');
    expect(timingWords(t, -31, 'solid')).toBe('31 ms early');
    // "On time" is the physics' own perfect band, never a number of the UI's.
    expect(timingWords(t, 19, 'perfect')).toBe('On time');
    expect(timingWords(t, 19, 'solid')).toBe('19 ms late');
    expect(timingWords(t, null)).toBeNull();
  });

  it('a reason without its fielder or zone still reads well', () => {
    expect(coachingLines(t, result({ timing: 'solid', errorMs: 0, kind: 'middle', reason: 'hit_to_fielder' })).reason).toBe('Hit straight to a fielder');
    expect(coachingLines(t, result({ timing: 'perfect', errorMs: 0, kind: 'middle', reason: 'found_the_gap' })).reason).toBe('Found the cover gap');
  });
});

describe('why it happened', () => {
  it('explains from the measured facts, with one tip', () => {
    const r = result({ timing: 'mistimed', errorMs: 64, kind: 'outside_edge', reason: 'edged_behind', dismissal: 'caught_behind' });
    const why = whySentences(t, engine.coachingFacts(r), true);
    expect(why.lines[0]).toBe('The ball: a 135 km/h Stock ball, Good length, outside off stump.');
    expect(why.lines).toContain('You started the swing 64 ms late.');
    expect(why.lines).toContain('It took the outside edge.');
    expect(why.lines).toContain('The keeper took the catch off the edge.');
    expect(why.tip).toBe('Start the swing a touch earlier, as the ball pitches.');
  });

  it('a pad hit that was not out says why', () => {
    const r = result({ timing: 'mistimed', errorMs: 80, kind: 'pad', reason: 'pad_in_line', lbw: 'pitched_outside_leg' });
    expect(whySentences(t, engine.coachingFacts(r), true, 'pitched_outside_leg').lines).toContain('Not out LBW: it pitched outside leg stump.');
    expect(whySentences(t, engine.coachingFacts(r), true, 'high').lines).toContain('Not out LBW: it was going over the stumps.');
    expect(whySentences(t, engine.coachingFacts(r), true, 'out').lines.some((l) => l.startsWith('Not out'))).toBe(false);
  });

  it('movement words follow the bowler: pace swings and seams, spin drifts and turns', () => {
    const r = result({ timing: 'missed', errorMs: 60, kind: 'miss', reason: 'beaten_by_turn' });
    const moving = { ...engine.coachingFacts(r), movement: { airM: 0.16, pitchM: -0.22, lineAtStumpsM: 0.05, heightAtBatM: 0.6 } };
    const pace = whySentences(t, moving, true, null, 'pace').lines;
    expect(pace).toContain('It swung 16 cm away from the bat in the air.');
    expect(pace).toContain('It seamed 22 cm in off the pitch.');
    const spin = whySentences(t, moving, true, null, 'spin').lines;
    expect(spin).toContain('It drifted 16 cm away from the bat in the air.');
    expect(spin).toContain('It turned 22 cm in off the pitch.');
    expect(spin.some((l) => l.includes('swung') || l.includes('seamed'))).toBe(false);
    // A full toss never pitched: nothing is said about the pitch.
    const fullToss = whySentences(t, { ...moving, movement: { ...moving.movement, pitchM: null } }, true, null, 'spin').lines;
    expect(fullToss.some((l) => l.includes('off the pitch'))).toBe(false);
  });

  it('a leave says no shot was played', () => {
    const r = result({ timing: 'none', errorMs: null, kind: 'leave', reason: 'left_and_bowled', dismissal: 'bowled', swing: false });
    const why = whySentences(t, engine.coachingFacts(r), false);
    expect(why.lines).toContain('You played no shot.');
    expect(why.lines).toContain('The ball went on to hit the stumps.');
    expect(why.tip).toBe('Tap to block it, or flick towards a gap to score.');
  });
});

describe('helpers', () => {
  it('badges and overs notation', () => {
    expect(markOf({ runs: 0, dismissal: 'caught_behind' })).toEqual({ kind: 'wicket', wicket: 'caught' });
    expect(markOf({ runs: 6, dismissal: null })).toEqual({ kind: 'six' });
    expect(markOf({ runs: 2, dismissal: null })).toEqual({ kind: 'runs', runs: 2 });
    expect(oversText(0)).toBe('0.0');
    expect(oversText(23)).toBe('3.5');
    expect(oversText(60)).toBe('10.0');
  });
});
