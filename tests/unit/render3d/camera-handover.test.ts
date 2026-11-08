/**
 * The result's hand-over mid-flight (P-B) and gaze tables built off the frame path (P-C). When the result arrives the
 * stage swaps the live script for the result's: the camera must keep its eye ("stays there whatever the footwork")
 * and the gaze must carry on, so the view as displayed never turns faster or more sharply than it did as shipped
 * (where the eye moved to the planted stance and the gaze restarted, a jump). "Shipped" is the frozen integrator.
 */
import { describe, expect, it } from 'vitest';
import type { BallFlight, DeliveryResult, Handedness, NormalizedSwing, QualityProfileId } from '@/contracts/practice';
import { GAZE, cameraAt, practiceGaze, practiceGazeReady } from '@/render3d/core/camera';
import type { BallScript } from '@/render3d/core/choreo';
import { simToScene } from '@/render3d/practice/frame';
import { batterEye, buildPracticeScript } from '@/render3d/practice/script';
import { PracticeSessionBase, type StageClock, type StageFrame } from '@/render3d/practice/session';
import type { PracticeBenchmarkRun, PracticeMountOptions, PracticeSceneSetup } from '@/render3d/practice/types';
import { evalOvers, overBalls, type EvalBall } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { resolveDelivery } from '@/physics/resolve';
import { batTravelMs } from '@/physics/bat';
import { autoField } from '@/physics/field';
import { flight as physicsFlight } from '@/physics/delivery';
import { DEG, type V, clamp, dot, measures, shippedGaze, shippedTable, turn, yawPitch } from './gazeReference';

const setupOf = (eb: EvalBall, hand: Handedness): PracticeSceneSetup => ({
  field: hand === 'right' ? eb.field : autoField(eb.over.bowler, eb.conditions, 'left', eb.over.ball),
  bowler: eb.over.bowler,
  conditions: eb.conditions,
  handedness: hand,
});

interface Handover {
  label: string;
  live: BallScript;
  /** The result's script as the stage now builds it (eye kept, gaze carried on). */
  result: BallScript;
  /** The result's script as shipped: built from the result alone (planted eye, its own gaze from the release). */
  shipped: BallScript;
  at: number;
  flight: BallFlight;
}

function handover(
  label: string,
  setup: PracticeSceneSetup,
  flight: BallFlight,
  result: DeliveryResult,
  at: number,
): Handover {
  const live = buildPracticeScript({ setup, flight });
  return {
    label,
    live,
    result: buildPracticeScript({ setup, flight, result, handover: { script: live, atScene: at } }),
    shipped: buildPracticeScript({ setup, flight, result }),
    at,
    flight,
  };
}

/** Reference over: W0's safe swings and the drive ±40 ms, handed over 40 ms (HOOK_EMIT_MS) and 100 ms after the swing starts; leaves 300 ms after the stumps. */
function referenceHandovers(): Handover[] {
  const out: Handover[] = [];
  const drive = (e: number) => ({
    kind: 'attack' as const,
    e,
    directionDeg: 55,
    power: 0.7,
    footwork: 'forward' as const,
  });
  const defend = (footwork: 'auto' | 'forward') => ({
    kind: 'defend' as const,
    e: 0,
    directionDeg: 0,
    power: 0.2,
    footwork,
  });
  const safe = [null, drive(0), defend('auto'), defend('auto'), null, defend('forward')];
  for (const eb of overBalls(REFERENCE_OVER, 'balanced')) {
    const setup = setupOf(eb, 'right');
    for (const [tag, sw] of [
      ['safe', safe[eb.ballIndex]],
      ['drive-40', drive(-40)],
      ['drive+40', drive(40)],
    ] as const) {
      const swing: NormalizedSwing | null = sw
        ? {
            kind: sw.kind,
            startT: eb.flight.idealContactT - batTravelMs(sw.kind, sw.power) / 1000 + sw.e / 1000,
            directionDeg: sw.directionDeg,
            power: sw.power,
            elevation: 0,
            footwork: sw.footwork,
          }
        : null;
      const result = resolveDelivery({
        flight: eb.flight,
        swing,
        field: eb.field,
        bowler: eb.over.bowler,
        conditions: eb.conditions,
        handedness: 'right',
        assist: 'play',
        tierToleranceMs: 0,
      });
      const rel = buildPracticeScript({ setup, flight: eb.flight }).practice!.releaseScene;
      const ats = swing
        ? [simToScene({ releaseScene: rel }, swing.startT) + 40, simToScene({ releaseScene: rel }, swing.startT) + 100]
        : [simToScene({ releaseScene: rel }, eb.flight.stumpsT) + 300];
      for (const at of ats)
        out.push(
          handover(`ref-${eb.ballIndex + 1} ${tag} at ${Math.round(at - rel)} ms`, setup, eb.flight, result, at),
        );
    }
  }
  return out;
}

/** 216 random deliveries: three difficulties, pace and spin, six overs each, every other over left-handed; two in three swung, one in three left. */
function randomHandovers(): Handover[] {
  const out: Handover[] = [];
  let n = 0;
  for (const difficulty of ['beginner', 'club', 'expert'] as const) {
    for (const family of ['pace', 'spin'] as const) {
      evalOvers({ difficulty, overs: 6, key: `camera-handover|${difficulty}|${family}`, family }).forEach((over, oi) =>
        over.forEach((eb) => {
          const hand: Handedness = oi % 2 === 1 ? 'left' : 'right';
          const fl =
            hand === 'right'
              ? eb.flight
              : physicsFlight({
                  plan: eb.over.balls[eb.ballIndex],
                  bowler: eb.over.bowler,
                  conditions: eb.conditions,
                  seed: eb.seed,
                  ball: eb.over.ball,
                  handedness: 'left',
                });
          const setup = setupOf(eb, hand);
          const leave = n % 3 === 2;
          const swing: NormalizedSwing | null = leave
            ? null
            : {
                kind: n % 3 === 0 ? 'attack' : 'defend',
                startT:
                  fl.idealContactT -
                  batTravelMs(n % 3 === 0 ? 'attack' : 'defend', n % 3 === 0 ? 0.7 : 0.2) / 1000 +
                  (((n * 37) % 81) - 40) / 1000,
                directionDeg: ((n * 53) % 120) - 60,
                power: n % 3 === 0 ? 0.7 : 0.2,
                elevation: 0,
                footwork: n % 2 ? 'forward' : 'auto',
              };
          const result = resolveDelivery({
            flight: fl,
            swing,
            field: setup.field,
            bowler: eb.over.bowler,
            conditions: eb.conditions,
            handedness: hand,
            assist: 'play',
            tierToleranceMs: 0,
          });
          const rel = buildPracticeScript({ setup, flight: fl }).practice!.releaseScene;
          const at = swing
            ? simToScene({ releaseScene: rel }, swing.startT) + 40
            : simToScene({ releaseScene: rel }, fl.stumpsT) + 300;
          out.push(
            handover(
              `${difficulty} ${family} over ${oi + 1} ball ${eb.ballIndex + 1} ${hand}${leave ? ' left' : ' swung'}`,
              setup,
              fl,
              result,
              at,
            ),
          );
          n++;
        }),
      );
    }
  }
  return out;
}

/** The offline sweep's deliveries (key camera-a3, seven overs per difficulty and family), only the overs asked for. */
function straddleSet(overs: Array<[string, string, number]>): Handover[] {
  const out: Handover[] = [];
  let n = 0;
  for (const difficulty of ['beginner', 'club', 'expert'] as const) {
    for (const family of ['pace', 'spin'] as const) {
      evalOvers({ difficulty, overs: 7, key: `camera-a3|${difficulty}|${family}`, family }).forEach((over, oi) =>
        over.forEach((eb) => {
          const mine = n;
          n++;
          if (!overs.some(([d, f, o]) => d === difficulty && f === family && o === oi)) return;
          const hand: Handedness = oi % 2 === 1 ? 'left' : 'right';
          const fl =
            hand === 'right'
              ? eb.flight
              : physicsFlight({
                  plan: eb.over.balls[eb.ballIndex],
                  bowler: eb.over.bowler,
                  conditions: eb.conditions,
                  seed: eb.seed,
                  ball: eb.over.ball,
                  handedness: 'left',
                });
          const setup = setupOf(eb, hand);
          const leave = mine % 3 === 2;
          const kind = mine % 3 === 0 ? 'attack' : 'defend';
          const swing: NormalizedSwing | null = leave
            ? null
            : {
                kind,
                startT:
                  fl.idealContactT -
                  batTravelMs(kind, kind === 'attack' ? 0.7 : 0.2) / 1000 +
                  (((mine * 37) % 81) - 40) / 1000,
                directionDeg: ((mine * 53) % 120) - 60,
                power: kind === 'attack' ? 0.7 : 0.2,
                elevation: 0,
                footwork: mine % 2 ? 'forward' : 'auto',
              };
          const result = resolveDelivery({
            flight: fl,
            swing,
            field: setup.field,
            bowler: eb.over.bowler,
            conditions: eb.conditions,
            handedness: hand,
            assist: 'play',
            tierToleranceMs: 0,
          });
          const rel = buildPracticeScript({ setup, flight: fl }).practice!.releaseScene;
          const at = swing ? rel + swing.startT * 1000 + 40 : rel + fl.stumpsT * 1000 + 300;
          out.push(
            handover(
              `${difficulty} ${family} over ${oi + 1} ball ${eb.ballIndex + 1} ${hand}${leave ? ' left' : ' swung'}`,
              setup,
              fl,
              result,
              at,
            ),
          );
        }),
      );
    }
  }
  return out;
}

const REFS = referenceHandovers();
const RANDOM = randomHandovers();

/** The gaze as displayed: the live script's until the hand-over, then the result's. */
const shown = (h: Handover, a: (s: BallScript, t: number) => V, after: BallScript) => (t: number) =>
  t < h.at ? a(h.live, t) : a(after, t);

/** The straddle case kept as a pinned residual (see the straddle test). */
const RESIDUAL = 'expert spin over 5 ball 5 right swung';

function expectNoJumpAndWithinShipped(h: Handover, phases = 4, allowance: Record<string, number> = {}) {
  const p = h.result.practice!;
  // The camera keeps its eye.
  expect(p.eye, h.label).toEqual(h.live.practice!.eye);
  expect(p.gazeFrom?.script, h.label).toBe(h.live);
  // Up to the hand-over, the gaze is the live script's, exactly (the result takes over at the hand-over itself, inside
  // its grid cell, from where the live script was).
  for (let t = p.releaseScene - 20; t < h.at; t += 1)
    expect(practiceGaze(h.result, t, false), `${h.label} t=${t}`).toEqual(practiceGaze(h.live, t, false));
  for (const rm of [false, true])
    for (let t = p.releaseScene - 20; t < h.at; t += 5)
      expect(practiceGaze(h.result, t, rm)).toEqual(practiceGaze(h.live, t, rm));
  for (const rm of [false, true])
    expect(practiceGaze(h.result, h.at, rm), `${h.label} at the hand-over`).toEqual(practiceGaze(h.live, h.at, rm));
  // As displayed, measure by measure and window by window: never faster or sharper than the shipped display.
  const liveRef = shippedTable(h.live, false);
  const resRef = shippedTable(h.shipped, false);
  const shippedShown = (t: number) => (t < h.at ? shippedGaze(liveRef, t) : shippedGaze(resRef, t));
  const nowShown = shown(h, (s, t) => practiceGaze(s, t, false), h.result);
  const from = p.releaseScene;
  const len = resRef.yaw.length;
  const end = from + (len - 1) * 4;
  const fp = Number.isFinite(p.firstPersonUntil) ? Math.min(p.firstPersonUntil, end) : end;
  const ideal = Math.min(end, simToScene(p, h.flight.idealContactT));
  // The windows the screen shows: a live result's table past its first-person view is never displayed (the plan cuts
  // to the fielding camera there, and a replay from the batter's eye is built from the result alone).
  for (const [w, e] of [
    ['to ideal contact', ideal],
    ['first person', Math.max(ideal, fp)],
  ] as const) {
    const s = measures(
      h.result,
      shippedShown,
      (i) => yawPitch(shippedShown(from + i * 4 + (i === 0 ? 1e-9 : 0))),
      len,
      e,
      phases,
    );
    const a = measures(
      h.result,
      nowShown,
      (i) => yawPitch(nowShown(from + i * 4 + (i === 0 ? 1e-9 : 0))),
      len,
      e,
      phases,
    );
    for (const k of Object.keys(s)) {
      if (!Number.isFinite(s[k]))
        expect(Number.isFinite(a[k]), `${h.label}, ${w}, ${k}: defined where shipped was not`).toBe(true);
      else expect(a[k], `${h.label}, ${w}, ${k}`).toBeLessThanOrEqual(s[k] * (allowance[k] ?? 1 + 1e-9) + 1e-9);
    }
  }
}

describe('the result hands over without moving the camera (P-B)', () => {
  it('keeps the eye on screen for a live result; a result alone (a replay) uses the planted stance; a mismatched hand-over is ignored', () => {
    const eb = overBalls(REFERENCE_OVER, 'balanced')[1];
    const setup = setupOf(eb, 'right');
    const swing: NormalizedSwing = {
      kind: 'attack',
      startT: eb.flight.idealContactT - batTravelMs('attack', 0.7) / 1000,
      directionDeg: 55,
      power: 0.7,
      elevation: 0,
      footwork: 'forward',
    };
    const result = resolveDelivery({
      flight: eb.flight,
      swing,
      field: eb.field,
      bowler: eb.over.bowler,
      conditions: eb.conditions,
      handedness: 'right',
      assist: 'play',
      tierToleranceMs: 0,
    });
    expect(
      Math.hypot(result.batterRootOffset.x, result.batterRootOffset.z) + result.batterPosture.crouchM,
    ).toBeGreaterThan(0.05);
    const live = buildPracticeScript({ setup, flight: eb.flight });
    const at = live.practice!.releaseScene + 350;
    const taken = buildPracticeScript({ setup, flight: eb.flight, result, handover: { script: live, atScene: at } });
    expect(taken.practice!.eye).toEqual(live.practice!.eye);
    expect(taken.practice!.gazeFrom).toEqual({ script: live, atScene: at });
    const alone = buildPracticeScript({ setup, flight: eb.flight, result });
    expect(alone.practice!.eye).toEqual(batterEye(false, result.batterRootOffset, result.batterPosture.crouchM));
    expect(alone.practice!.gazeFrom ?? null).toBeNull();
    // Another batter (handedness) or a hand-over at no time: not this delivery's screen; ignored.
    const left = buildPracticeScript({
      setup: { ...setup, handedness: 'left' },
      flight: eb.flight,
      result,
      handover: { script: live, atScene: at },
    });
    expect(left.practice!.gazeFrom ?? null).toBeNull();
    expect(left.practice!.eye).toEqual(batterEye(true, result.batterRootOffset, result.batterPosture.crouchM));
    expect(
      buildPracticeScript({ setup, flight: eb.flight, result, handover: { script: live, atScene: Number.NaN } })
        .practice!.gazeFrom ?? null,
    ).toBeNull();
  });

  it('carries the gaze on and never turns faster or more sharply than shipped, as displayed: reference over', () => {
    for (const h of REFS) expectNoJumpAndWithinShipped(h);
  });

  it('carries the gaze on and never turns faster or more sharply than shipped, as displayed: 216 random deliveries', () => {
    expect(RANDOM.length).toBeGreaterThanOrEqual(200);
    for (const h of RANDOM) expectNoJumpAndWithinShipped(h);
  });

  it('closes the 30 fps straddle: frames that began before the first limited step (8 m, or the hand-over) stay inside shipped at 16 phases', () => {
    // The offline sweep's own deliveries (S/camera/tools/pb-offline.spec.ts), where a 30 fps frame straddling the
    // first limited step once went over: both of those overs, every ball, per script and as displayed.
    const picked = straddleSet([
      ['beginner', 'pace', 2],
      ['expert', 'spin', 4],
    ]);
    expect(picked.map((h) => h.label)).toContain('beginner pace over 3 ball 5 right swung');
    for (const h of picked) {
      const p = h.live.practice!;
      const ref = shippedTable(h.live, false);
      const end = p.releaseScene + (ref.yaw.length - 1) * 4;
      for (const [w, e] of [
        ['to ideal contact', Math.min(end, simToScene(p, h.flight.idealContactT))],
        ['whole gaze', end],
      ] as const) {
        const s = measures(
          h.live,
          (t) => shippedGaze(ref, t),
          (i) => ({ yaw: ref.yaw[i], pitch: ref.pitch[i] }),
          ref.yaw.length,
          e,
          16,
        );
        const a = measures(
          h.live,
          (t) => practiceGaze(h.live, t, false),
          (i) => yawPitch(practiceGaze(h.live, p.releaseScene + i * 4 + (i === 0 ? 1e-9 : 0), false)),
          ref.yaw.length,
          e,
          16,
        );
        for (const k of Object.keys(s))
          if (Number.isFinite(s[k]))
            expect(a[k], `${h.label} (per script), ${w}, ${k}`).toBeLessThanOrEqual(s[k] * (1 + 1e-9) + 1e-9);
      }
      if (h.label !== RESIDUAL) expectNoJumpAndWithinShipped(h, 16);
    }
    // The one known residual (REPORT addendum 2): before its hand-over the live gaze turns, at 30 fps, faster than the
    // shipped display ever did, because shipped switched scripts before its own live rule reached that peak. Only
    // limits that look no further than the present (causal) remove it, and those cost the ball in view on about half
    // of all deliveries. Pinned here: every other measure within shipped, that one within 6%.
    const r = picked.find((h) => h.label === RESIDUAL)!;
    expect(r).toBeDefined();
    expectNoJumpAndWithinShipped(r, 16, { '30 fps rate': 1.06 });
  });

  it('removes the jump: at the hand-over the result shows exactly what the live script showed (shipped jumped)', () => {
    let shippedJumps = 0;
    for (const h of [...REFS, ...RANDOM]) {
      expect(practiceGaze(h.result, h.at, false), h.label).toEqual(practiceGaze(h.live, h.at, false));
      expect(h.result.practice!.eye, h.label).toEqual(h.live.practice!.eye);
      const sLive = shippedGaze(shippedTable(h.live, false), h.at);
      const sResult = shippedGaze(shippedTable(h.shipped, false), h.at);
      if (Math.acos(clamp(dot(sLive, sResult), -1, 1)) / DEG > 0.05) shippedJumps++;
    }
    // The shipped hand-over did jump on many of these (the eye moved and the gaze restarted).
    expect(shippedJumps).toBeGreaterThan(20);
  });

  it('is deterministic: the same live script and hand-over time give the same frames, in any order', () => {
    for (const h of REFS.slice(0, 6)) {
      const again = buildPracticeScript({
        setup: {
          field: overBalls(REFERENCE_OVER, 'balanced')[0].field,
          bowler: REFERENCE_OVER.bowler,
          conditions: 'balanced',
          handedness: 'right',
        },
        flight: h.flight,
        result: h.result.practice!.result,
        handover: { script: h.live, atScene: h.at },
      });
      const times = Array.from({ length: 300 }, (_, i) => h.live.practice!.releaseScene - 50 + i * 9.1);
      const a = [...times]
        .reverse()
        .map((t) => practiceGaze(again, t, false))
        .reverse();
      expect(a).toEqual(times.map((t) => practiceGaze(h.result, t, false)));
    }
  });
});

// A stage on a test clock, drawing nothing (as in practice.test.ts).
function fakeClock(start = 1000) {
  let now = start;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  const frames: Array<(t: number) => void> = [];
  let next = 1;
  const clock: StageClock = {
    now: () => now,
    raf: (cb) => (frames.push(cb), frames.length),
    caf: () => undefined,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const run = async (to: number, frameMs = 16) => {
    while (now < to) {
      const target = now + Math.min(frameMs, to - now);
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > target) break;
        timers.shift();
        now = t.at;
        t.fn();
        await Promise.resolve();
      }
      now = target;
      frames.shift()?.(now);
      await Promise.resolve();
    }
  };
  return { clock, run, now: () => now };
}

class RecordingStage extends PracticeSessionBase {
  readonly kind = '3d' as const;
  frames: StageFrame[] = [];
  /** Whether each drawn frame found its gaze already built (P-C). */
  ready: boolean[] = [];
  constructor(
    clock: StageClock,
    private readonly motionReduced = false,
  ) {
    super(clock);
  }
  protected drawFrame(frame: StageFrame) {
    this.ready.push(practiceGazeReady(frame.script, this.motionReduced));
    this.frames.push(frame);
  }
  protected applyProfile(_id: QualityProfileId) {}
  protected rendererName() {
    return 'test';
  }
  protected drawCalls() {
    return 0;
  }
  async mount(_c: HTMLCanvasElement, o: PracticeMountOptions) {
    this.startSession(o);
  }
  async benchmark(): Promise<PracticeBenchmarkRun> {
    return { frameMs: [], shaderCompileMs: 0, contextLosses: 0, renderer: 'test', webgl2: true, hardware: true };
  }
}

describe('the stage keeps the camera through the hand-over and builds gaze tables off the frame path (P-B, P-C)', () => {
  for (const reducedMotion of [false, true]) {
    it(`the camera never jumps when play(result) arrives mid-flight and the eye stays put through the first-person view (EMB4)${reducedMotion ? ' (Reduced Motion)' : ''}; the view turns smoothly; every frame finds its gaze built`, async () => {
      const eb = overBalls(REFERENCE_OVER, 'balanced')[1];
      const setup = setupOf(eb, 'right');
      const c = fakeClock();
      const stage = new RecordingStage(c.clock, reducedMotion);
      await stage.mount({} as HTMLCanvasElement, {
        profile: 'standard',
        handedness: 'right',
        reducedMotion,
        learnCue: false,
      });
      stage.setScene(setup);
      const swing: NormalizedSwing = {
        kind: 'attack',
        startT: eb.flight.idealContactT - batTravelMs('attack', 0.7) / 1000,
        directionDeg: 55,
        power: 0.7,
        elevation: 0,
        footwork: 'forward',
      };
      const result = resolveDelivery({
        flight: eb.flight,
        swing,
        field: eb.field,
        bowler: eb.over.bowler,
        conditions: eb.conditions,
        handedness: 'right',
        assist: 'play',
        tierToleranceMs: 0,
      });
      void stage.bowl(eb.flight);
      const release = stage.releasePerfMs()!;
      const swingAt = release + swing.startT * 1000;
      await c.run(swingAt);
      stage.beginSwing(swingAt, 0);
      await c.run(swingAt + 40);
      void stage.play(result);
      await c.run(release + 1200);
      const ctx = { aspect: 915 / 412, reducedMotion };
      const poses = stage.frames
        .filter((f) => f.mode === 'live' && f.scene >= f.script.practice!.releaseScene - 100)
        .map((f) => ({ f, cam: cameraAt(f.script, f.scene, f.plan, ctx) }))
        .filter((x) => x.cam.shot === 'batter_eye');
      const scripts = [...new Set(poses.map((x) => x.f.script))];
      expect(scripts.length).toBe(2);
      const taken = scripts[1].practice!;
      const held = taken.eye;
      const stance = taken.stanceEye!;
      // The result plants the batter elsewhere (shipped moved the eye there at the hand-over, 25 cm at most).
      expect(Math.hypot(stance.x - held.x, stance.y - held.y, stance.z - held.z)).toBeGreaterThan(0.05);
      expect(taken.gazeFrom!.atScene).toBeLessThan(taken.releaseScene + eb.flight.idealContactT * 1000);
      let maxTurnDeg = 0;
      for (let i = 0; i < poses.length; i++) {
        const { cam } = poses[i];
        // The camera stays exactly where it was, before the hand-over, through the contact and after it.
        expect(cam.pos, `frame ${i}`).toEqual(held);
        if (i === 0) continue;
        const p0 = poses[i - 1].cam.pos;
        const d0 = {
          x: poses[i - 1].cam.target.x - p0.x,
          y: poses[i - 1].cam.target.y - p0.y,
          z: poses[i - 1].cam.target.z - p0.z,
        };
        const d1 = { x: cam.target.x - cam.pos.x, y: cam.target.y - cam.pos.y, z: cam.target.z - cam.pos.z };
        const r = turn(yawDir(d0), yawDir(d1));
        maxTurnDeg = Math.max(maxTurnDeg, Math.hypot(r.x, r.y, r.z) / DEG);
      }
      // Smooth pursuit: never more than the per-axis rate limit allows in one 16 ms frame.
      expect(maxTurnDeg).toBeLessThan(GAZE.maxRateDegS * 0.016 * Math.SQRT2 + 1e-6);
      // P-C: the gaze of every drawn script was built before its first frame (in bowl() and play()).
      expect(stage.ready.length).toBeGreaterThan(20);
      expect(stage.ready.every(Boolean)).toBe(true);
    });
  }
});

function yawDir(d: V): V {
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}
