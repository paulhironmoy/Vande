import { describe, expect, it } from 'vitest';
import type { AssistLevel, NormalizedSwing } from '@/contracts/practice';
import { batPoseAdmissibility } from '@/physics/admissibility';
import { autoField, resolveDelivery } from '@/physics';
import { batSamples, batTravelMs, buildBatTrack, idealTimeFor } from '@/physics/bat';
import { sweep } from '@/physics/collision';
import { flight as flightOf } from '@/physics/delivery';
import { TIMING_BANDS } from '@/physics/constants';
import { metTiming, strike } from '@/physics/contact';
import { activeBands, classifyTiming, forgive } from '@/physics/timing';
import { bearingDelta } from '@/physics/vec';
import { REFERENCE_CONDITIONS, REFERENCE_OVER, ballSeed, randomOver } from '@/practice/game';
import { EDGES, LEGSPIN, OFFSPIN, PACE, fly, play, timedSwing } from './physics-helpers';

const LEVELS: AssistLevel[] = ['learn', 'play', 'real'];

describe('timing bands', () => {
  it('classifies at the band edges for each assist level', () => {
    for (const a of LEVELS) {
      const b = TIMING_BANDS[a];
      for (const s of [-1, 1]) {
        expect(classifyTiming(s * b.perfectMs, b)).toBe('perfect');
        expect(classifyTiming(s * (b.perfectMs + 0.5), b)).toBe('solid');
        expect(classifyTiming(s * b.solidMs, b)).toBe('solid');
        expect(classifyTiming(s * (b.solidMs + 0.5), b)).toBe('mistimed');
        expect(classifyTiming(s * b.edgeMs, b)).toBe('mistimed');
        expect(classifyTiming(s * (b.edgeMs + 0.5), b)).toBe('missed');
      }
    }
  });

  it('has the recalibrated bands, and the Assisted tier widens every edge by its tolerance', () => {
    // Lead decision 2026-11-03 (PHYS phase 3): the declared bands follow the measured physical windows of the
    // reference over (wedge/physics/phase3/timing-windows.json): Real perfect ⊆ every in-reach attacking sweet window
    // (ref-1 drive +14 ms), solid ⊆ every face window (ref-1 drive +29 ms), edge 55 ms; Learn and Play keep the brief's
    // forgiveness ratios to Real. Before (the brief's bands): learn 55/110/170, play 35/75/125, real perfect 25 and
    // solid 55 (edge 80); play + 10 ms tier = 45/85/135, so 40 ms read "perfect" there.
    expect(TIMING_BANDS.learn).toEqual({ perfectMs: 31, solidMs: 58, edgeMs: 117 });
    expect(TIMING_BANDS.play).toEqual({ perfectMs: 20, solidMs: 40, edgeMs: 86 });
    expect(TIMING_BANDS.real.perfectMs).toBe(14);
    expect(TIMING_BANDS.real.solidMs).toBe(29);
    expect(TIMING_BANDS.real.edgeMs).toBe(55);
    expect(activeBands('play', 10)).toEqual({ perfectMs: 30, solidMs: 50, edgeMs: 96 });
    expect(classifyTiming(29, activeBands('play', 10))).toBe('perfect');
    // Real applies no forgiveness on any device: the tier's tolerance is ignored there.
    expect(activeBands('real', 10)).toEqual(TIMING_BANDS.real);
    expect(forgive(70, activeBands('real', 30))).toBe(70);
  });

  it('forgives Learn and Play onto the Real geometry, and leaves Real alone', () => {
    const real = TIMING_BANDS.real;
    for (const e of [-200, -80, -55, -25, 0, 13, 25, 55, 80, 200]) expect(forgive(e, real)).toBeCloseTo(e, 12);
    for (const a of ['learn', 'play'] as const) {
      const b = TIMING_BANDS[a];
      expect(forgive(b.perfectMs, b)).toBeCloseTo(real.perfectMs, 12);
      expect(forgive(-b.solidMs, b)).toBeCloseTo(-real.solidMs, 12);
      expect(forgive(b.edgeMs, b)).toBeCloseTo(real.edgeMs, 12);
      let prev = -Infinity;
      for (let e = -300; e <= 300; e += 7) {
        const m = forgive(e, b);
        expect(m).toBeGreaterThan(prev);
        prev = m;
      }
    }
  });
});

describe('forgiveness moves the whole swing (SYS1)', () => {
  // PHYS2 phase 5e, evaluator eval-phys VERDICT §1.2. Before: Learn and Play moved only the bat's arrival to
  // idealT + forgive(e) and kept the player's start, so the travel shrank or grew and the stroke changed beyond the
  // declared bands (11 of 1,170 recomputed results differed from Real at the mapped error). Now the start and the
  // arrival move together: a Learn or Play swing is exactly the Real swing at the band-mapped error, and only the
  // report keeps the raw error.
  const shifted = (f: ReturnType<typeof fly>, s: NormalizedSwing, assist: AssistLevel, tol: number) => {
    const e = (s.startT + batTravelMs(s.kind, s.power) / 1000 - idealTimeFor(f, s.footwork === 'auto' ? 'auto' : s.footwork)) * 1000;
    const eff = forgive(e, activeBands(assist, tol));
    return { e, eff, real: { ...s, startT: s.startT + (eff - e) / 1000 } };
  };

  it('plays the Real swing at the mapped error with the stroke\'s own travel, and reports the raw error', () => {
    const flights = [fly({ lengthM: 4.04, lineM: 0.07, speedKph: 76.8 }, OFFSPIN, 'green', 'sys1'), fly({ lengthM: 6.5, lineM: 0.05, speedKph: 136 }, PACE, 'balanced', 't3')];
    for (const f of flights) for (const kind of ['attack', 'defend'] as const) for (const err of [-90, 0, 75.4, 120]) for (const [assist, tol] of [['learn', 0], ['learn', 20], ['play', 0]] as const) {
      const s = timedSwing(f, err, { kind, power: kind === 'defend' ? 0.2 : 0.7, directionDeg: kind === 'defend' ? 0 : 30, elevation: kind === 'defend' ? 0 : 0.2 });
      const { e, eff, real } = shifted(f, s, assist, tol);
      const a = strike(f, s, { assist, tierToleranceMs: tol });
      // PHYS2 5f: the swing is the Real swing at the declared effective error: the mapped error forgive(e), unless the
      // causal cap had to reduce it so that nothing is touched before the player's raw input.
      const fz = a.forgiveness!;
      expect(fz.rawMs).toBeCloseTo(e, 9);
      expect(fz.mappedMs).toBe(eff);
      expect(fz.effectiveMs).toBeGreaterThanOrEqual(Math.min(eff, e));
      expect(fz.effectiveMs).toBeLessThanOrEqual(Math.max(eff, e));
      const atEffective = { ...s, startT: s.startT + (fz.effectiveMs - fz.rawMs) / 1000 };
      const r = strike(f, atEffective, { assist: 'real', tierToleranceMs: 0 });
      expect(a.bat).toEqual(r.bat);
      expect(a.exit).toEqual(r.exit);
      expect({ ...a.contact, timing: null, timingErrorMs: null }).toEqual({ ...r.contact, timing: null, timingErrorMs: null });
      const touch = a.exit?.t ?? a.impact?.t ?? null;
      if (touch !== null) expect(touch).toBeGreaterThanOrEqual(s.startT);
      if (fz.effectiveMs !== fz.mappedMs) continue;
      expect(a.track!.startT).toBeCloseTo(real.startT, 12);
      expect((a.track!.arriveT - a.track!.startT) * 1000).toBeCloseTo(batTravelMs(kind, s.power), 9);
      expect(a.track!.errorMs).toBeCloseTo(e, 9);
      expect(a.contact.timingErrorMs).toBeCloseTo(e, 9);
      expect(a.track!.physErrorMs).toBeCloseTo(eff, 9);
    }
  });

  it('the evaluator\'s reproduction: Learn 20 ms, a defence 75 ms late is the Real defence at +27.5 ms (middle, not out)', () => {
    const over = randomOver({ seed: 'eval-phys-det|over|170|spin', conditions: 'green', assist: 'real', difficulty: 'beginner', family: 'spin' });
    const f = practiceFlightOf(over, 1);
    const swing: NormalizedSwing = { kind: 'defend', startT: 0.8349, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'across' };
    const args = { flight: f, field: autoField(over.bowler, 'green', 'right', over.ball), bowler: over.bowler, conditions: 'green' as const, handedness: 'right' as const };
    const { e, eff, real } = shifted(f, swing, 'learn', 20);
    expect(e).toBeCloseTo(75.38, 2);
    expect(eff).toBeCloseTo(27.54, 2);
    const learn = resolveDelivery({ ...args, swing, assist: 'learn', tierToleranceMs: 20 });
    const atEff = resolveDelivery({ ...args, swing: real, assist: 'real', tierToleranceMs: 0 });
    // Before: miss, bowled, labelled "solid" (the bat reached the zone 72.2 ms after its start instead of 120 ms).
    expect(learn.contact.kind).toBe('middle');
    expect(learn.outcome.dismissal).toBeNull();
    expect(learn.contact.timing).toBe('solid');
    expect({ ...learn.contact, timing: null, timingErrorMs: null }).toEqual({ ...atEff.contact, timing: null, timingErrorMs: null });
    expect(learn.outcome).toEqual(atEff.outcome);
    expect(learn.bat).toEqual(atEff.bat);
  });
});

describe('no input changes anything before it (5f causality)', () => {
  // PHYS2 phase 5f (WORKER fix-round; evaluator eval-phys-5e after-stumps). The evaluator's smallest reproduction: a
  // bowled leave (stock, 5.09 m, 104.2 km/h, left-handed); a defence begun 1 ms after the ball hit the stumps. Before:
  // at Learn 20 ms the forgiven bat started 82 ms early and met the ball 76 ms before the input (middle, not out);
  // in every level the footwork body could stand in the ball's path before the input (pad, LBW).
  const over = randomOver({ seed: 'eval-phys-5e|stumps|0', conditions: 'balanced', assist: 'real', difficulty: 'beginner', family: 'pace' });
  const f = flightOf({ plan: over.balls[0], bowler: over.bowler, conditions: 'balanced', seed: ballSeed(over, 0), handedness: 'left', ball: over.ball });
  const args = { flight: f, field: autoField(over.bowler, 'balanced', 'left', over.ball), bowler: over.bowler, conditions: 'balanced' as const, handedness: 'left' as const };
  const drawn = (r: ReturnType<typeof resolveDelivery>) => ({ outcome: r.outcome, ball: r.ball, events: r.events, deadT: r.deadT, fielders: r.fielders, lbw: r.lbw, frame: r.batterBodyFrame, root: r.batterRootOffset });
  const strokes: Omit<NormalizedSwing, 'startT'>[] = [
    { kind: 'defend', directionDeg: 0, power: 0.2, elevation: 0, footwork: 'auto' },
    { kind: 'attack', directionDeg: 0, power: 0.7, elevation: 0.1, footwork: 'forward' },
    { kind: 'attack', directionDeg: -60, power: 0.8, elevation: 0.1, footwork: 'back' },
  ];

  it('a bowled leave plus any swing begun after the stumps resolves exactly as the leave, at every level', () => {
    const leave = resolveDelivery({ ...args, swing: null, assist: 'real', tierToleranceMs: 0 });
    expect(leave.outcome.dismissal).toBe('bowled');
    for (const d of [1, 10, 50, 150]) for (const st of strokes) for (const [assist, tol] of [['real', 0], ['play', 0], ['learn', 0], ['learn', 20]] as const) {
      const swing = { ...st, startT: f.stumpsT + d / 1000 };
      const r = resolveDelivery({ ...args, swing, assist, tierToleranceMs: tol });
      expect(drawn(r)).toEqual(drawn(leave));
      expect(r.contact.kind).toBe('miss');
      expect(r.swing).toEqual(swing);
      // The late swing is still drawn, from the input on, touching nothing.
      expect(r.bat.length).toBeGreaterThan(0);
      expect(r.bat[0].t).toBeGreaterThanOrEqual(swing.startT - 1e-12);
    }
  });

  it('the causal cap: a block 130 ms late at Learn is Real at the least-reduced error whose touch follows the input', () => {
    // Evaluator eval-phys-5e contact-before-input: ref-1, right-handed, back-foot block 130 ms late, Learn 0. Before
    // (5e), the forgiven bat started at 0.4424 s and met the ball at 0.4969 s, 7.5 ms before the input at 0.5044 s.
    const f1 = flightOf({ plan: REFERENCE_OVER.balls[0], bowler: REFERENCE_OVER.bowler, conditions: REFERENCE_CONDITIONS, seed: ballSeed(REFERENCE_OVER, 0), handedness: 'right', ball: REFERENCE_OVER.ball });
    const block: NormalizedSwing = { kind: 'defend', directionDeg: 0, power: 0.2, elevation: 0, footwork: 'back', startT: idealTimeFor(f1, 'back') - batTravelMs('defend', 0.2) / 1000 + 0.13 };
    const expect1 = { bowler: REFERENCE_OVER.bowler, conditions: REFERENCE_CONDITIONS, handedness: 'right' as const };
    const a = strike(f1, block, { assist: 'learn', tierToleranceMs: 0, expect: expect1 });
    const fz = a.forgiveness!;
    expect(fz.mappedMs).toBe(forgive(fz.rawMs, activeBands('learn', 0)));
    expect(fz.effectiveMs).toBeGreaterThan(fz.mappedMs);
    expect(fz.effectiveMs).toBeLessThanOrEqual(fz.rawMs);
    const touch = a.exit?.t ?? a.impact?.t ?? null;
    if (touch !== null) expect(touch).toBeGreaterThanOrEqual(block.startT);
    const r = strike(f1, { ...block, startT: block.startT + (fz.effectiveMs - fz.rawMs) / 1000 }, { assist: 'real', tierToleranceMs: 0, expect: expect1 });
    expect(a.bat).toEqual(r.bat);
    expect({ ...a.contact, timing: null, timingErrorMs: null }).toEqual({ ...r.contact, timing: null, timingErrorMs: null });
    // Slightly less late, the uncapped mapped swing already touches after the input: no reduction there.
    const earlier = strike(f1, { ...block, startT: block.startT - 0.03 }, { assist: 'learn', tierToleranceMs: 0, expect: expect1 }).forgiveness!;
    expect(earlier.effectiveMs).toBe(earlier.mappedMs);
  });

  it('no contact, pad or body touch ever comes before the raw input start', () => {
    const balls = [fly({ lengthM: 6.5, lineM: 0.05, speedKph: 136 }, PACE, 'balanced', 't3'), fly({ lengthM: 2.4, lineM: 0, speedKph: 128 }, PACE, 'balanced', 'causal'), fly({ lengthM: 4.2, lineM: 0.12, speedKph: 84 }, OFFSPIN, 'turning', 'causal')];
    let late = 0;
    for (const fl of balls) for (const st of strokes) for (const d of [-150, -60, -20, 0, 20, 40, 80]) for (const [assist, tol] of [['real', 0], ['play', 0], ['learn', 20]] as const) {
      const swing = { ...st, startT: fl.idealContactT - batTravelMs(st.kind, st.power) / 1000 + d / 1000 + (d >= 0 ? batTravelMs(st.kind, st.power) / 1000 : 0) };
      if (swing.startT >= fl.idealContactT) late++;
      const common = { flight: fl, field: autoField(PACE, 'balanced', 'right'), bowler: PACE, conditions: 'balanced' as const, handedness: 'right' as const, tierToleranceMs: tol };
      const r = resolveDelivery({ ...common, swing, assist });
      // The only touch allowed before the input is the leave's own (the ball met the stance body before the swing began).
      const leave = resolveDelivery({ ...common, swing: null, assist: 'real' }).events.find((e) => e.kind === 'contact' || e.kind === 'pad');
      for (const e of r.events) {
        if ((e.kind === 'contact' || e.kind === 'pad') && e.t < swing.startT) expect(leave && leave.kind === e.kind && leave.t === e.t, `${assist}/${tol} ${st.kind} ${d}`).toBe(true);
      }
    }
    expect(late).toBeGreaterThan(0);
  });
});

function practiceFlightOf(over: ReturnType<typeof randomOver>, ballIndex: number) {
  return flightOf({ plan: over.balls[ballIndex], bowler: over.bowler, conditions: 'green', seed: ballSeed(over, ballIndex), handedness: 'right', ball: over.ball });
}

describe('contact from the physics', () => {
  // A stock ball whose seam lands square (seed 't3'): nothing off the pitch beats the batter's committed read, so the
  // windows below are the bat's geometry alone. Late movement against the read is tested elsewhere.
  const f = fly({ lengthM: 6.5, lineM: 0.05, speedKph: 136 }, PACE, 'balanced', 't3');

  it('rejects the frozen legacy post-zone-out handle pose because it penetrates head/neck anatomy', () => {
    const flight = fly({ lengthM: 10.5, lineM: -0.5, speedKph: 136 }, PACE, 'balanced', 'post-contact-audit');
    const swing = timedSwing(flight, -250, { directionDeg: 70, power: 0.7, elevation: 0.2 });
    const options = { assist: 'real' as const, expect: { bowler: PACE, conditions: 'balanced' as const, handedness: 'right' as const } };
    const track = buildBatTrack(flight, swing, options);
    const direct = sweep(flight.samples, track, track.body, 0, flight.samples.at(-1)!.t);
    const result = strike(flight, swing, options);
    const rejectedPose = {
      toe: { x: -0.7059607327203284, y: 1.6422488865297011, z: 9.276623668210744 },
      grip: { x: -0.3044548608144782, y: 1.2250345937996023, z: 8.640757905044612 },
      n: { x: -0.07770878469713192, y: 0.8103514250261413, z: -0.58076838131823 },
    };
    const anatomy = batPoseAdmissibility(rejectedPose, track.body);
    expect(anatomy.gap).toBeLessThan(0);
    expect(Math.min(anatomy.helmetGap, anatomy.neckGap)).toBeLessThan(0);
    expect(direct.hit === null || (direct.hit.part !== 'blade' && direct.hit.part !== 'handle')).toBe(true);
    expect(['middle', 'inside_edge', 'outside_edge', 'leading_edge', 'top_edge']).not.toContain(result.contact.kind);
    expect(result.exit).toBeNull();
    // Before: no impact at all (this bouncer on the leg line passed the batter). After (since the phase-1 anatomy repair:
    // anthropometric stance and reach): it strikes the planted batter's helmet at 0.546 s (direct sweep part 'head').
    // What the test protects is unchanged: the rejected handle pose never becomes a bat contact.
    expect(result.impact === null || !['blade', 'handle'].includes(direct.hit?.part ?? '')).toBe(true);
    if (result.impact) expect(result.contact.kind).toBe('body');
    expect(result.track).toEqual(track);
    expect(result.bat.length).toBeGreaterThan(2);
    for (const sample of result.bat) {
      expect(batPoseAdmissibility({ grip: sample.grip, toe: sample.toe, n: sample.face }, result.track!.body).gap).toBeGreaterThanOrEqual(-1e-10);
    }
  });

  it('uses an exact impulse knot only for bat hits and safe no-impulse traces for every other swing', () => {
    // Before: lineM −0.3. After (since the phase-1 anatomy repair): the planted batter's root (x +0.105 m) puts the
    // leg pad in the line of a ball 0.3 m outside leg, so that swing is a pad, not the non-contact miss this check
    // needs; 0.6 m outside leg passes the batter untouched (−0.4 and −0.5 still meet the pad).
    const miss = play(
      fly({ variation: 'stock', lengthM: 1.2, lineM: -0.6, speedKph: 136 }, PACE, 'balanced', 'nondecisive-search'),
      -200,
      { directionDeg: -70 },
    );
    const defence = play(f, 0, { kind: 'defend', power: 0.15, elevation: 0, directionDeg: 0 });
    // Before: lineM −0.12. After (since the phase-1 anatomy repair moved the planted pads): that ball now passes the
    // batter untouched (a miss on the phase-2 bat as well); 0.18 m to leg meets the pad, the non-bat contact needed here.
    const pad = play(
      fly({ variation: 'stock', lengthM: 2.5, lineM: -0.18, speedKph: 136 }, PACE, 'balanced', 'nondecisive-search'),
      -200,
      { directionDeg: -70 },
    );
    const body = play(
      fly({ variation: 'stock', lengthM: 8, lineM: -0.8, speedKph: 136 }, PACE, 'balanced', 'body-search'),
      -350,
      { directionDeg: -150 },
    );

    expect(miss.contact.kind).toBe('miss');
    expect(defence.contact.kind).toBe('middle');
    expect(pad.contact.kind).toBe('pad');
    expect(body.contact.kind).toBe('body');
    for (const result of [miss, pad, body]) {
      expect(result.track).not.toBeNull();
      expect(result.bat.length).toBeGreaterThan(2);
      expect(result.bat).toEqual(batSamples(result.track!));
      expect(result.batterMotion).toEqual({
        startT: result.track!.startT,
        contactT: result.track!.plannedContactT,
        endT: result.track!.zoneOut,
      });
      expect(result.bat.filter((sample) => sample.t === result.track!.zoneIn)).toHaveLength(1);
      expect(result.bat.filter((sample) => sample.t === result.track!.plannedContactT)).toHaveLength(1);
      expect(result.bat.filter((sample) => sample.t === result.track!.zoneOut)).toHaveLength(1);
      for (const sample of result.bat) {
        expect(batPoseAdmissibility({ grip: sample.grip, toe: sample.toe, n: sample.face }, result.track!.body).gap).toBeGreaterThanOrEqual(-1e-10);
      }
    }
    expect(defence.track).not.toBeNull();
    expect(defence.bat).not.toEqual(batSamples(defence.track!));
    expect(defence.bat.filter((sample) => sample.t === defence.contact.t)).toHaveLength(1);
    expect(defence.batterMotion?.contactT).toBe(defence.track!.plannedContactT);
    expect(defence.bat.filter((sample) => sample.t === defence.track!.plannedContactT)).toHaveLength(1);
    expect(defence.bat.filter((sample) => sample.t === defence.contact.t)).toHaveLength(1);
  });

  it('is deterministic', () => {
    expect(play(f, 17, { directionDeg: 25 })).toEqual(play(f, 17, { directionDeg: 25 }));
  });

  it('the bands follow the bat geometry at every level: a label never claims more than the contact', () => {
    // Before (the brief's bands, two-sided): the sweet spot ended exactly at perfect + 4 ms and the face at solid + 6 ms
    // on this one stock ball. After (lead decision 2026-11-03, PHYS phase 3): the bands are set inside the narrowest
    // in-reach attacking windows of the reference over, so on this wider-windowed ball they hold one-sided: inside the
    // bands the geometry delivers what the label says, and at every millisecond "perfect" is a sweet middle, "solid"
    // a middle, and "missed" no bat contact. The former point checks failed 17 of 27 on the phase-2 bat with the old
    // bands (wider than the geometry); with the new bands only the two-sided ones (perfect + 4 non-sweet, solid + 6 an
    // edge: 12 of 27) fail, because this ball's windows are wider than the reference drives', which is allowed.
    for (const a of LEVELS) {
      const b = TIMING_BANDS[a];
      const kindAt = (e: number) => play(f, e, {}, a);
      for (const e of [0, b.perfectMs - 3, -(b.perfectMs - 3)]) {
        const result = kindAt(e);
        expect.soft(result.quality?.sweet, `${a} ${e} sweet ${JSON.stringify({ quality: result.quality, bladeU: result.contact.bladeU })}`).toBe(true);
      }
      for (const e of [b.solidMs - 3, -(b.solidMs - 3)]) expect.soft(kindAt(e).contact.kind, `${a} ${e} middle`).toBe('middle');
      for (let e = -(b.edgeMs + 20); e <= b.edgeMs + 20; e++) {
        const result = kindAt(e);
        const middle = result.contact.kind === 'middle';
        if (result.contact.timing === 'perfect') expect.soft(middle && result.quality?.sweet, `${a} ${e} perfect is a sweet middle`).toBe(true);
        if (result.contact.timing === 'solid') expect.soft(middle, `${a} ${e} solid is a middle (${result.contact.kind})`).toBe(true);
        if (result.contact.timing === 'missed') expect.soft(middle || EDGES.has(result.contact.kind), `${a} ${e} missed is no bat contact`).toBe(false);
      }
      for (const e of [-(b.edgeMs + 15), a === 'learn' ? 185 : b.edgeMs + 15]) {
        const result = kindAt(e);
        // "Missed" is the input/timing grade, not permission to hide the visible bat from collision. A completed
        // early swing can still make a slow accidental block if—and only if—the authoritative swept geometry hits.
        const physical = sweep(f.samples, result.track!, result.track!.body, 0, f.samples.at(-1)!.t).hit;
        if (result.contact.kind === 'miss') {
          expect(result.contact.timing).toBe('missed');
          expect(['blade', 'handle']).not.toContain(physical?.part);
        } else {
          // Lead decision 2026-11-03: a label never contradicts the outcome, so a bat that met the ball beyond the
          // edge band reads "mistimed" (contact.ts metTiming). Before: "missed" whatever the bat met.
          const metBat = physical?.part === 'blade' || physical?.part === 'handle';
          expect(result.contact.timing).toBe(metBat ? 'mistimed' : 'missed');
          if (metBat) expect(result.contact.t).toBe(physical?.t);
        }
      }
    }
  });

  it('a bat that meets the ball is never labelled missed, and a block met on the face is at least solid', () => {
    // Added 2026-11-03 (lead decision, PHYS phase 3: labels follow physics and never contradict the outcome; blocks
    // are graded by contact). Before, a block met on the face was "missed" on 71–114 ms of each reference block window.
    expect(metTiming('missed', 'attack', 'middle')).toBe('mistimed');
    expect(metTiming('missed', 'attack', 'outside_edge')).toBe('mistimed');
    expect(metTiming('perfect', 'attack', 'outside_edge')).toBe('perfect');
    expect(metTiming('mistimed', 'attack', 'middle')).toBe('mistimed');
    expect(metTiming('perfect', 'defend', 'middle')).toBe('perfect');
    expect(metTiming('mistimed', 'defend', 'middle')).toBe('solid');
    expect(metTiming('missed', 'defend', 'middle')).toBe('solid');
    expect(metTiming('missed', 'defend', 'top_edge')).toBe('mistimed');
    let faceBlocksBeyondSolid = 0;
    for (const a of LEVELS) {
      const bands = TIMING_BANDS[a];
      for (const e of [-150, -120, -90, -60, -40, -20, 0, 20, 40, 60, 90, 120, 150]) {
        const block = play(f, e, { kind: 'defend', power: 0.15, elevation: 0, directionDeg: 0 }, a);
        const met = block.contact.kind === 'middle' || EDGES.has(block.contact.kind);
        if (met) expect(block.contact.timing, `${a} ${e} block ${block.contact.kind}`).not.toBe('missed');
        if (block.contact.kind === 'middle') {
          expect(['perfect', 'solid'], `${a} ${e} face block`).toContain(block.contact.timing);
          if (Math.abs(e) > bands.solidMs) faceBlocksBeyondSolid++;
        }
        if (!met) expect(block.contact.timing).toBe(classifyTiming(block.contact.timingErrorMs!, bands));
        const drive = play(f, e, { directionDeg: 25 }, a);
        if (drive.contact.kind === 'middle' || EDGES.has(drive.contact.kind)) expect(drive.contact.timing, `${a} ${e} drive`).not.toBe('missed');
      }
    }
    expect(faceBlocksBeyondSolid).toBeGreaterThan(0);
  });

  it('late leaves the face open (outside edge, square on the off side); early closes it (to leg, off the off edge)', () => {
    // Before: ±70 ms, inside the brief's Real edge band (55–80 ms), with early pinned as the inside edge. After (lead
    // decision 2026-11-03, bands recalibrated to the measured windows; PHYS phase 3): ±70 ms is beyond this ball's bat
    // window, so the edge band (solid, edge + 5] is scanned. Late, the open face takes the outside edge (+42..+44 ms).
    // Early, the bat has already swung across towards leg with the face closed, so the ball passes its off side and
    // meets the off (leading/outside) edge (−54..−48 ms), never the leg-side inside edge: the classic early-drive
    // leading edge. The inside-edge pin came from the pre-phase-1 drift geometry.
    // Updated again (PHYS2 phase 5). Before: the last early contacts (-48..-54 ms) read as the off (outside) edge. They
    // are toe-end hits (bladeU -0.04..-0.06: the ball under the toe, 0-4 mm across the blade's centre line) whose side
    // came only from the sign of that offset; once the toe was rounded (constants.ts BLADE_TOE_R) the -54 ms hit's
    // offset turned +0.00003 m and it read as the leg-side inside edge. After (lead toe-cap ruling, contract v6 has no toe
    // kind): a vertical bat's toe-end hit within the blade's width is a toe-cap contact, a middle with bladeU < 0. Early,
    // the closed face meets the ball on the face and then on the toe cap, never on the leg-side inside edge.
    const real = TIMING_BANDS.real;
    const lateKinds: string[] = [];
    const earlyKinds: string[] = [];
    const earlyToeCap: boolean[] = [];
    for (let e = real.solidMs + 1; e <= real.edgeMs + 5; e++) {
      lateKinds.push(play(f, e, { directionDeg: 0 }).contact.kind);
      const early = play(f, -e, { directionDeg: 0 });
      earlyKinds.push(early.contact.kind);
      earlyToeCap.push(early.contact.kind === 'middle' && early.quality?.region === 'toe' && early.contact.bladeU! < 0);
    }
    expect(lateKinds).toContain('outside_edge');
    expect(lateKinds).not.toContain('inside_edge');
    expect(earlyToeCap).toContain(true);
    expect(earlyKinds).not.toContain('inside_edge');
    const late = play(f, real.solidMs + 1 + lateKinds.indexOf('outside_edge'), { directionDeg: 0 });
    expect(late.contact.kind).toBe('outside_edge');
    const lateMid = play(f, 40);
    const earlyMid = play(f, -40);
    expect(lateMid.contact.exitBearingDeg!).toBeGreaterThan(15);
    expect(earlyMid.contact.exitBearingDeg!).toBeLessThan(-15);
    expect(earlyMid.contact.exitElevationDeg!).toBeGreaterThan(lateMid.contact.exitElevationDeg!);
    expect(late.contact.intendedBearingDeg).toBe(0);
  });

  it('early on a leg-side stroke finds the leading edge; late on the pull finds the top edge', () => {
    // Before: the flick at −70 ms (inside the brief's 55–80 ms Real edge band). After (lead decision 2026-11-03, bands
    // recalibrated, PHYS phase 3): on this ball the flick's leading edge lies at −57..−20 ms and beyond −58 ms it
    // misses, so the early edge band [−edge, −solid) is checked for the leading edge (and never another edge).
    const real = TIMING_BANDS.real;
    const flickKinds: string[] = [];
    for (let e = real.solidMs + 1; e <= real.edgeMs; e++) flickKinds.push(play(f, -e, { directionDeg: -55 }).contact.kind);
    expect(flickKinds).toContain('leading_edge');
    expect(flickKinds.filter((kind) => EDGES.has(kind) && kind !== 'leading_edge')).toEqual([]);
    const flick = play(f, -(real.solidMs + 1 + flickKinds.indexOf('leading_edge')), { directionDeg: -55 });
    expect(flick.contact.kind, JSON.stringify({ contact: flick.contact, miss: flick.miss, track: flick.track && { root: flick.track.batterRootOffset, posture: flick.track.batterPosture, shot: flick.track.shot } })).toBe('leading_edge');
    const short = fly({ variation: 'bouncer', lengthM: 10.5, lineM: 0, speedKph: 136 });
    // Late, the horizontal bat is still below the ball: it takes the top edge or passes under the ball.
    const pull = play(short, 70, { directionDeg: -70, power: 0.8, elevation: 0.3 });
    expect(['top_edge', 'miss']).toContain(pull.contact.kind);
    if (pull.contact.kind === 'miss' && pull.miss) expect(pull.miss.delta.y).toBeGreaterThan(0);
    // Before: a top edge pinned at +35 ms (after a 154 mm whole-body retarget). After (PHYS phase 3, lead decision
    // 2026-11-03: the limit-stroke fallback meets the ball at the fastest certified speed at its own aim instead of
    // moving its aim): this head-high ball is at the pull's anatomical limit (planned 13.4 m/s on time, 1.1 m/s from
    // ±20 ms), so the pull fends it on the middle through +55 ms and the late top edge comes at +60..+65 ms, before the
    // horizontal bat passes under the ball. The late top-edge semantics are checked across that late band.
    const lateKinds: string[] = [];
    for (let e = 30; e <= 90; e += 5) lateKinds.push(play(short, e, { directionDeg: -70, power: 0.8, elevation: 0.3 }).contact.kind);
    expect(lateKinds).toContain('top_edge');
    expect(lateKinds.indexOf('top_edge')).toBeLessThan(lateKinds.lastIndexOf('miss'));
    expect(play(short, 0, { directionDeg: -70, power: 0.8, elevation: 0.3 }).contact.kind).toBe('middle');
  });

  it('a perfect hit leaves in the intended direction, and the exit follows the face when mistimed', () => {
    // Each stroke against a ball inside its reach (shot geometry): played with the line, at a length it is played to.
    const balls: Array<[number, Parameters<typeof fly>[0]]> = [
      [-60, { lengthM: 6.5, lineM: -0.12 }],
      [-30, { lengthM: 6.5, lineM: -0.02 }],
      [0, { lengthM: 6.5, lineM: 0.05 }],
      [20, { lengthM: 7.5, lineM: 0.18 }],
      [45, { lengthM: 7.5, lineM: 0.25 }],
      [70, { lengthM: 7.5, lineM: 0.3 }],
    ];
    for (const [dir, p] of balls) {
      const r = play(fly(p), 0, { directionDeg: dir, power: 0.7 });
      expect(Math.hypot(r.track!.shot.outside.x, r.track!.shot.outside.y), `${dir}°`).toBeLessThan(0.01);
      expect(r.contact.kind).toBe('middle');
      expect(Math.abs(bearingDelta(r.contact.exitBearingDeg!, dir))).toBeLessThan(4);
    }
    const g = fly({ lengthM: 7.5, lineM: 0.18 });
    const shifts = [-30, -15, 15, 30].map((e) => {
      const r = play(g, e, { directionDeg: 20, power: 0.7 });
      return { face: bearingDelta(r.contact.faceBearingDeg!, play(g, 0, { directionDeg: 20, power: 0.7 }).contact.faceBearingDeg!), exit: bearingDelta(r.contact.exitBearingDeg!, 20) };
    });
    for (const s of shifts) expect(Math.sign(s.exit)).toBe(Math.sign(s.face));
    expect(shifts[0].exit).toBeLessThan(shifts[1].exit);
    expect(shifts[3].exit).toBeGreaterThan(shifts[2].exit);
  });

  it('hits harder off the sweet spot of a faster bat, and the sweet spot beats the toe', () => {
    const soft = play(f, 0, { power: 0.2 });
    const hard = play(f, 0, { power: 1 });
    expect(hard.contact.exitSpeedKph!).toBeGreaterThan(soft.contact.exitSpeedKph! + 25);
    expect(hard.contact.batSpeedKph!).toBeGreaterThan(soft.contact.batSpeedKph!);
    // The toe fixture. Before: a 1.2 m yorker under automatic footwork, dug out from the back plane low on the blade,
    // checked only if it was a middle. After (PHYS2 phase 5, lead ruling (a)): automatic footwork smothers yorkers on
    // the forward stride and meets that ball on the sweet spot (bladeU 0.225), so it no longer reached the toe. The
    // fixture is now built without automatic footwork: a half-volley pitched 2.1 m out, played on an explicit forward
    // stride, is met just after the bounce, low on the blade. Contract v6: a contact there is a middle with bladeU.
    const sweet = play(f, 0, { power: 0.6 });
    const toe = play(fly({ lengthM: 2.1, lineM: 0.05, speedKph: 140 }), 0, { power: 0.6 }, 'real', 'forward');
    expect(sweet.contact.kind).toBe('middle');
    expect(toe.contact.kind).toBe('middle');
    expect(toe.contact.bladeU!).toBeLessThan(0.15);
    expect(sweet.contact.bladeU!).toBeGreaterThan(0.2);
    // The same power, and a slower ball off the toe than off the sweet spot (or off the faster bat's sweet spot).
    expect(toe.contact.exitSpeedKph!).toBeLessThan(sweet.contact.exitSpeedKph!);
    expect(toe.contact.exitSpeedKph!).toBeLessThan(hard.contact.exitSpeedKph!);
  });

  it('a perfectly timed defence drops the ball dead in front (pace and spin, lengths, footwork)', () => {
    const cases = [
      { b: PACE, kph: 136, lens: [2.5, 4, 6, 7, 9] },
      { b: OFFSPIN, kph: 84, lens: [2.5, 4, 5.5, 7] },
      { b: LEGSPIN, kph: 84, lens: [2.5, 4, 5.5, 7] },
    ];
    for (const c of cases) {
      for (const L of c.lens) {
        const d = fly({ lengthM: L, lineM: 0.1, speedKph: c.kph }, c.b);
        for (const fw of ['auto', 'forward', 'back'] as const) {
          // A short pace ball (9 m) on the front foot rises above a forward defence's reach (shot geometry): a fend.
          if (fw === 'forward' && c.b === PACE && L >= 9) continue;
          for (const dir of [-20, 0, 20]) {
            const r = play(d, 0, { kind: 'defend', power: 0.15, elevation: 0, directionDeg: dir }, 'play', fw);
            // Going back to this half-volley with the face aimed at cover. Before (pre-phase-1 0.475 m hand reach):
            // the minimum static root hit the exact 180 mm cap and still left the shifted pad in front of the bat, so
            // it was pinned as a pad (out LBW). After (phase 1, anthropometric 0.57 m reach): the batter plays it on a
            // 48 mm root with a 0.116 m crouch and meets it on the middle (12.6 km/h, an off-balance squirt), so it
            // joins every other defensive fixture below; its root stays well inside the 180 mm cap.
            if (c.b === PACE && L === 2.5 && fw === 'back' && dir === 20) {
              const rootM = Math.hypot(r.track!.batterRootOffset.x, r.track!.batterRootOffset.z);
              expect(rootM).toBeLessThan(0.18);
              expect(r.track!.batterPosture.crouchM).toBeLessThanOrEqual(0.18);
            }
            expect(r.contact.kind, `${c.b.family} L${L} ${fw} ${dir} ${JSON.stringify({ root: r.track!.batterRootOffset, posture: r.track!.batterPosture, contact: r.contact, miss: r.miss })}`).toBe('middle');
            expect(r.contact.exitSpeedKph!).toBeLessThan(25);
            // Footwork that fights the length (back to a half-volley, forward to a ball short of a length) costs
            // balance: the dead bat then squirts the ball, and can let it trickle on towards the stumps.
            if (r.track!.balance < 1) continue;
            expect(r.exit!.v.z, `${c.b.family} L${L} ${fw} ${dir} ${JSON.stringify(r.contact)}`).toBeLessThan(0);
            // A block with under 10 km/h of horizontal travel dies at the batter's feet whatever its compass
            // bearing; the total speed can be larger while the ball is dropping almost vertically off the toe.
            if (Math.hypot(r.exit!.v.x, r.exit!.v.z) * 3.6 >= 10) {
              expect(Math.abs(bearingDelta(r.contact.exitBearingDeg!, dir)), `${c.b.family} L${L} ${fw} ${dir} ${JSON.stringify(r.contact)}`).toBeLessThanOrEqual(30);
            }
          }
        }
      }
    }
  });

  it('a well-timed attack inside the reach of its stroke goes within 10° of the aim against pace and spin', () => {
    let inReach = 0;
    for (const [b, kph] of [[PACE, 140], [OFFSPIN, 84], [LEGSPIN, 84]] as const) {
      // A spinner's full ball turns after the batter has committed (80 ms): it beats the read, so spin is checked
      // where it pitches early enough to be read.
      for (const L of b === PACE ? [3, 5, 6.5] : [5, 6.5]) {
        for (const [dir, line] of [[-45, -0.12], [0, 0.05], [45, 0.25]] as const) {
          const d = fly({ lengthM: L, lineM: line, speedKph: kph }, b);
          const r = play(d, 0, { directionDeg: dir, power: 0.7, elevation: 0.15 }, 'play');
          const sh = r.track!.shot;
          if (Math.hypot(sh.outside.x, sh.outside.y) > 0.01 || r.contact.kind !== 'middle' || !r.quality?.sweet) continue;
          inReach++;
          expect(Math.abs(bearingDelta(r.contact.exitBearingDeg!, dir)), `${b.family} ${L} m ${dir}°`).toBeLessThan(10);
        }
      }
    }
    expect(inReach).toBeGreaterThanOrEqual(8);
  });

  it('a leave reports a leave, or the pad when a straight ball comes into the batter', () => {
    const wide = fly({ lengthM: 6, lineM: 0.45 });
    const left = strike(wide, null, { assist: 'real' });
    expect(left.contact.kind).toBe('leave');
    expect(left.contact.timing).toBe('none');
    expect(left.bat).toHaveLength(0);
    const offbreak = fly({ lengthM: 4, lineM: -0.13, speedKph: 84 }, OFFSPIN, 'turning');
    const padded = strike(offbreak, null, { assist: 'real' });
    expect(padded.contact.kind).toBe('pad');
    expect(padded.impact?.part).toBe('pad');
    expect(padded.impact!.vOut.z).toBeLessThan(padded.impact!.vIn.z);
  });

  it('a swing started after the ball has passed never blocks it with a waiting bat; a malformed swing is a leave', () => {
    const straight = fly({ lengthM: 5, lineM: 0 });
    const tooLate = strike(straight, { kind: 'attack', startT: straight.stumpsT + 0.05, directionDeg: 0, power: 0.5, elevation: 0, footwork: 'auto' }, { assist: 'learn' });
    expect(tooLate.contact.kind).toBe('miss');
    expect(tooLate.contact.timing).toBe('missed');
    expect(tooLate.exit).toBeNull();
    const bad = strike(straight, { kind: 'attack', startT: Number.NaN, directionDeg: 0, power: 0.5, elevation: 0, footwork: 'auto' }, { assist: 'real' });
    expect(bad.contact.kind === 'leave' || bad.contact.kind === 'pad').toBe(true);
    expect(bad.bat).toHaveLength(0);
  });

  it('records the footwork played and the matching ideal contact', () => {
    const full = fly({ lengthM: 3 });
    const short = fly({ lengthM: 8 });
    expect(play(full, 0).footwork).toBe('forward');
    expect(play(short, 0).footwork).toBe('back');
    const r = play(full, 0, {}, 'real', 'back');
    expect(r.footwork).toBe('back');
    expect(r.idealT).toBeGreaterThan(full.idealContactT);
  });
});
