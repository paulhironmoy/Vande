// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BowlerProfile, ContactReport, NormalizedSwing, Vec3 } from '@/contracts/practice';
import { PITCH_HALF } from '@/physics/constants';
import { autoField, pointFromStriker } from '@/physics/field';
import type { FieldingPlay, FieldingResult } from '@/physics/fielding';
import { autoRuns } from '@/physics/running';
import { flightMovement } from '@/physics/delivery';
import { BEAT_THE_FIELD_M, diagnoseBeaten, judge, regionOf, zoneOf, type PlayFacts } from '@/physics/scoring';
import { stubFlight } from '../practice/game/stubTrajectory';

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 's' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 's' };
const FIELD = autoField(PACE, 'balanced');
const at = (b: number, d: number): Vec3 => ({ ...pointFromStriker(b, d), y: 1 });

const contact = (o: Partial<ContactReport> = {}): ContactReport => ({
  kind: 'middle',
  t: 0.55,
  timingErrorMs: 5,
  timing: 'perfect',
  point: { x: 0, y: 0.5, z: 8.3 },
  bladeU: 0.22,
  faceBearingDeg: 20,
  batSpeedKph: 90,
  exitSpeedKph: 120,
  exitBearingDeg: 20,
  exitElevationDeg: 4,
  intendedBearingDeg: 20,
  ...o,
});
const LEAVE: ContactReport = { kind: 'leave', t: null, timingErrorMs: null, timing: 'none', point: null, bladeU: null, faceBearingDeg: null, batSpeedKph: null, exitSpeedKph: null, exitBearingDeg: null, exitElevationDeg: null, intendedBearingDeg: null };
const swing = (o: Partial<NormalizedSwing> = {}): NormalizedSwing => ({ kind: 'attack', startT: 0.4, directionDeg: 20, power: 0.7, elevation: 0.1, footwork: 'auto', ...o });
const fielding = (play: FieldingPlay, nearest: FieldingResult['nearest'] = null): FieldingResult => ({ play, nearest, paths: [], ball: [], events: [], deadT: play.t });
const fielded = (fielderId: string, returnT: number, o: Partial<Extract<FieldingPlay, { kind: 'fielded' }>> = {}): FieldingPlay => ({
  kind: 'fielded',
  fielderId,
  how: 'stop',
  t: 1.5,
  p: at(60, 22),
  dive: false,
  movedM: 1,
  drop: null,
  releaseT: 2,
  returnT,
  end: 'striker',
  ...o,
});

function facts(o: Partial<PlayFacts>): PlayFacts {
  return { flight: stubFlight({}), bowler: PACE, swing: swing(), contact: contact(), field: FIELD, impact: null, bowled: null, playedOn: null, fielding: null, running: null, ...o };
}

describe('regions', () => {
  it('names the region a bearing points to (straight, behind, and the eight zones)', () => {
    expect(regionOf(0)).toBe('straight');
    expect(regionOf(-6)).toBe('straight');
    expect(regionOf(22)).toBe('mid_off');
    expect(regionOf(-22)).toBe('mid_on');
    expect(regionOf(60)).toBe('cover');
    expect(regionOf(-60)).toBe('midwicket');
    expect(regionOf(97)).toBe('point');
    expect(regionOf(-97)).toBe('square_leg');
    expect(regionOf(140)).toBe('third_man');
    expect(regionOf(-140)).toBe('fine_leg');
    expect(regionOf(170)).toBe('behind');
    expect(regionOf(-178)).toBe('behind');
    expect(zoneOf(3)).toBe('mid_off');
    expect(zoneOf(-3)).toBe('mid_on');
    expect(zoneOf(175)).toBe('third_man');
    expect(zoneOf(-175)).toBe('fine_leg');
  });
});

describe('movement of a delivery', () => {
  it('the synthetic test flights move as specified (as measured by the delivery physics)', () => {
    const m = flightMovement(stubFlight({ airSwingM: 0.2, pitchDevM: -0.07 }));
    expect(m.airM).toBeCloseTo(0.2, 2);
    expect(m.pitchM!).toBeCloseTo(-0.07, 2);
    const straight = flightMovement(stubFlight({}));
    expect(Math.abs(straight.airM)).toBeLessThan(0.005);
    expect(Math.abs(straight.pitchM!)).toBeLessThan(0.005);
    expect(straight.heightAtBatM).toBeLessThan(1);
  });

  it('names what beat the bat', () => {
    const miss = (o: Partial<ContactReport>, f = stubFlight({}), b = PACE, s = swing()) => diagnoseBeaten({ flight: f, bowler: b, swing: s, contact: contact({ kind: 'miss', ...o }) });
    expect(miss({ timing: 'missed', timingErrorMs: 200 })).toBe('too_late');
    expect(miss({ timing: 'missed', timingErrorMs: -200 })).toBe('too_early');
    expect(miss({ timing: 'missed', timingErrorMs: 200 }, stubFlight({ speedKph: 147 }))).toBe('beaten_by_pace');
    expect(miss({ timing: 'solid', timingErrorMs: 30 }, stubFlight({ pitchDevM: 0.09 }))).toBe('beaten_by_seam');
    expect(miss({ timing: 'solid', timingErrorMs: 30 }, stubFlight({ airSwingM: 0.25 }))).toBe('beaten_by_swing');
    expect(miss({ timing: 'solid', timingErrorMs: 30 }, stubFlight({ speedKph: 85, pitchDevM: 0.12 }), SPIN)).toBe('beaten_by_turn');
    expect(miss({ timing: 'solid', timingErrorMs: 30 }, stubFlight({ lengthM: 9 }))).toBe('beaten_by_bounce');
    expect(miss({ timing: 'solid', timingErrorMs: 30 }, stubFlight({ lineAtBounceM: 0.15 }), PACE, swing({ directionDeg: -60 }))).toBe('played_across_the_line');
    expect(miss({ timing: 'solid', timingErrorMs: 30 }, stubFlight({ lineAtBounceM: 0.02 }))).toBe('missed_straight_ball');
  });

  it('uses where the ball passed the bat: over it is the bounce; beside it, only movement that way counts', () => {
    const f = stubFlight({ pitchDevM: 0.09 }); // seamed away (towards off)
    const base = { flight: f, bowler: PACE, swing: swing(), contact: contact({ kind: 'miss', timing: 'solid', timingErrorMs: 30 }) };
    expect(diagnoseBeaten({ ...base, miss: { delta: { x: 0.02, y: 0.12, z: 0 } } })).toBe('beaten_by_bounce');
    expect(diagnoseBeaten({ ...base, miss: { delta: { x: 0.09, y: 0.01, z: 0 } } })).toBe('beaten_by_seam');
    // It seamed away but beat the bat on the inside: the seam is not why.
    expect(diagnoseBeaten({ ...base, miss: { delta: { x: -0.09, y: 0.01, z: 0 } } })).not.toBe('beaten_by_seam');
    // An outside edge off a ball that seamed away is the seam; an inside edge is not.
    expect(diagnoseBeaten({ ...base, contact: contact({ kind: 'outside_edge', timing: 'solid', timingErrorMs: 20 }) })).toBe('beaten_by_seam');
    expect(diagnoseBeaten({ ...base, contact: contact({ kind: 'inside_edge', timing: 'solid', timingErrorMs: 20 }) })).not.toBe('beaten_by_seam');
  });

  it('a miss timed right is coached as the ball beating the bat, never as early or late', () => {
    const timed = (o: Partial<ContactReport>, f = stubFlight({})) => diagnoseBeaten({ flight: f, bowler: PACE, swing: swing(), contact: contact({ kind: 'miss', ...o }) });
    for (const timing of ['perfect', 'solid'] as const) {
      expect(timed({ timing, timingErrorMs: 5 }, stubFlight({ pitchDevM: 0.02 }))).toBe('beaten_by_seam');
      expect(timed({ timing, timingErrorMs: 5 }, stubFlight({ airSwingM: 0.03 }))).toBe('beaten_by_swing');
      expect(['too_early', 'too_late']).not.toContain(timed({ timing, timingErrorMs: -5 }, stubFlight({ lineAtBounceM: 0.4 })));
    }
    // The same small movement with a mistimed swing is the timing.
    expect(timed({ timing: 'mistimed', timingErrorMs: 95 }, stubFlight({ pitchDevM: 0.02, lineAtBounceM: 0.4 }))).toBe('too_late');
  });

  it('a leg-side swing is across the line only to a ball outside the line of middle', () => {
    const d = (line: number) => diagnoseBeaten({ flight: stubFlight({ lineAtBounceM: line }), bowler: PACE, swing: swing({ directionDeg: -50 }), contact: contact({ kind: 'miss', timing: 'mistimed', timingErrorMs: 90 }) });
    expect(d(0.2)).toBe('played_across_the_line');
    expect(d(-0.05)).not.toBe('played_across_the_line');
  });
});

describe('judge: dismissals', () => {
  it('bowled when a left ball hits the stumps', () => {
    const j = judge(facts({ swing: null, contact: LEAVE, bowled: { t: 0.6, p: { x: 0, y: 0.4, z: PITCH_HALF } } }));
    expect(j.outcome).toMatchObject({ runs: 0, dismissal: 'bowled', boundary: null });
    expect(j.coaching).toMatchObject({ reason: 'left_and_bowled', timing: null });
  });

  it('bowled when a missed ball hits the stumps, with the reason it was missed', () => {
    const j = judge(facts({ contact: contact({ kind: 'miss', timing: 'missed', timingErrorMs: 190 }), bowled: { t: 0.6, p: { x: 0, y: 0.4, z: PITCH_HALF } } }));
    expect(j.outcome.dismissal).toBe('bowled');
    expect(j.coaching).toMatchObject({ reason: 'too_late', timing: 'late' });
  });

  it('bowled when an inside edge is played on', () => {
    const j = judge(facts({ contact: contact({ kind: 'inside_edge', timing: 'mistimed', timingErrorMs: 90 }), playedOn: { t: 0.62, p: { x: 0.05, y: 0.3, z: PITCH_HALF - 0.05 } } }));
    expect(j.outcome).toMatchObject({ dismissal: 'bowled', region: 'behind' });
  });

  it('lbw when the physics gives the pad out; a dead ball when not', () => {
    const impact = { t: 0.57, p: { x: 0, y: 0.4, z: PITCH_HALF - 1.1 }, part: 'pad' as const };
    const out = judge(facts({ contact: contact({ kind: 'pad', timing: 'missed', timingErrorMs: 150 }), impact: { ...impact, lbw: { out: true, reason: 'out' } } }));
    expect(out.outcome).toMatchObject({ dismissal: 'lbw', runs: 0 });
    expect(out.coaching).toMatchObject({ reason: 'pad_in_line', lbw: 'out' });
    const notOut = judge(facts({ swing: null, contact: { ...LEAVE, kind: 'pad', t: 0.57 }, impact: { ...impact, lbw: { out: false, reason: 'pitched_outside_leg' } } }));
    expect(notOut.outcome).toMatchObject({ dismissal: null, runs: 0 });
    // The card can say why it was not out.
    expect(notOut.coaching).toMatchObject({ reason: 'left_well', lbw: 'pitched_outside_leg' });
    // No pad, no LBW verdict.
    expect(judge(facts({ swing: null, contact: LEAVE })).coaching.lbw).toBeNull();
  });

  it('caught behind by the keeper or a slip off an edge; caught by anyone else', () => {
    const edge = contact({ kind: 'outside_edge', timing: 'mistimed', timingErrorMs: 95 });
    const keeper = judge(facts({ contact: edge, fielding: fielding({ kind: 'caught', fielderId: 'keeper', t: 0.9, p: at(178, 13), dive: false, speed: 25 }) }));
    expect(keeper.outcome).toMatchObject({ dismissal: 'caught_behind', fielderId: 'keeper', region: 'behind' });
    expect(keeper.coaching).toMatchObject({ reason: 'edged_behind', fielderRole: 'keeper', timing: 'late' });
    const slip = judge(facts({ contact: edge, fielding: fielding({ kind: 'caught', fielderId: 'slip1', t: 0.9, p: at(170, 13), dive: false, speed: 25 }) }));
    expect(slip.outcome.dismissal).toBe('caught_behind');
    expect(slip.coaching.reason).toBe('edged_to_slip');
    const ring = judge(facts({ fielding: fielding({ kind: 'caught', fielderId: 'cover', t: 1.4, p: at(63, 23), dive: false, speed: 22 }) }));
    expect(ring.outcome).toMatchObject({ dismissal: 'caught', fielderId: 'cover', region: 'cover' });
    expect(ring.coaching).toMatchObject({ reason: 'caught_in_the_ring', fielderRole: 'cover', zone: 'cover' });
    const deep = judge(facts({ fielding: fielding({ kind: 'caught', fielderId: 'third_man', t: 3.4, p: at(132, 51), dive: false, speed: 20 }) }));
    expect(deep.coaching.reason).toBe('caught_in_the_deep');
    const skied = judge(facts({ swing: swing({ elevation: 0.8 }), contact: contact({ timing: 'mistimed', timingErrorMs: -90 }), fielding: fielding({ kind: 'caught', fielderId: 'mid_off', t: 3, p: at(21, 25), dive: false, speed: 15 }) }));
    expect(skied.coaching).toMatchObject({ reason: 'mistimed_lofted', timing: 'early' });
  });
});

describe('judge: runs and boundaries', () => {
  it('six over the rope, four through the gap, four past a diving fielder', () => {
    const six = judge(facts({ fielding: fielding({ kind: 'boundary', runs: 6, t: 3, p: at(0, 70) }) }));
    expect(six.outcome).toMatchObject({ runs: 6, boundary: 6, dismissal: null, region: 'straight' });
    expect(six.coaching.reason).toBe('cleared_the_rope');
    const gap = judge(facts({ fielding: fielding({ kind: 'boundary', runs: 4, t: 3.5, p: at(42, 64) }, { fielderId: 'mid_off', shortfallM: 6 }) }));
    expect(gap.outcome).toMatchObject({ runs: 4, boundary: 4, region: 'cover' });
    expect(gap.coaching).toMatchObject({ reason: 'found_the_gap', zone: 'cover' });
    const beat = judge(facts({ fielding: fielding({ kind: 'boundary', runs: 4, t: 3.5, p: at(42, 64) }, { fielderId: 'cover', shortfallM: BEAT_THE_FIELD_M - 0.5 }) }));
    expect(beat.coaching).toMatchObject({ reason: 'beat_the_field', fielderRole: 'cover' });
  });

  it('runs into a gap, a dot straight to a fielder, a solid block, a mistimed shot', () => {
    const t0 = 0.55;
    const two = judge(facts({ fielding: fielding(fielded('mid_off', t0 + 7.2, { p: at(40, 50) })), running: autoRuns(t0, t0 + 7.2) }));
    expect(two.outcome).toMatchObject({ runs: 2, boundary: null, dismissal: null, fielderId: 'mid_off' });
    expect(two.coaching.reason).toBe('found_the_gap');
    const dot = judge(facts({ fielding: fielding(fielded('cover', t0 + 2.6, { p: at(63, 23) })), running: autoRuns(t0, t0 + 2.6) }));
    expect(dot.outcome.runs).toBe(0);
    expect(dot.coaching).toMatchObject({ reason: 'hit_to_fielder', fielderRole: 'cover', timing: 'on_time' });
    const block = judge(facts({ swing: swing({ kind: 'defend', power: 0.15 }), fielding: fielding(fielded('bowler', t0 + 2, { p: at(5, 6) })), running: autoRuns(t0, t0 + 2) }));
    expect(block.coaching.reason).toBe('solid_defence');
    const late = judge(facts({ contact: contact({ timing: 'mistimed', timingErrorMs: 100 }), fielding: fielding(fielded('point', t0 + 2.4, { p: at(97, 21) })), running: autoRuns(t0, t0 + 2.4) }));
    expect(late.coaching).toMatchObject({ reason: 'too_late', timing: 'late' });
  });

  it('a leave that misses everything is left well; an edge that runs away is still explained as an edge', () => {
    expect(judge(facts({ swing: null, contact: LEAVE })).coaching.reason).toBe('left_well');
    const edgeFour = judge(facts({ contact: contact({ kind: 'outside_edge', timing: 'mistimed', timingErrorMs: 100 }), fielding: fielding({ kind: 'boundary', runs: 4, t: 3, p: at(150, 50) }) }));
    expect(edgeFour.outcome.runs).toBe(4);
    expect(edgeFour.coaching.reason).toBe('too_late');
  });
});
