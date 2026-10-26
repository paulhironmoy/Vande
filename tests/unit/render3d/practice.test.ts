import { describe, expect, it } from 'vitest';
import type { DeliveryResult, QualityProfileId } from '@/contracts/practice';
import { BATTER_FOV, GAZE, batterFov, cameraAt, occludingActors, practicePlan, type CameraPose } from '@/render3d/core/camera';
import { sampleBall, type BallScript } from '@/render3d/core/choreo';
import { evaluateActor } from '@/render3d/core/actors';
import { PRACTICE_PROFILES, practicePixelRatio } from '@/render3d/core/quality';
import { STUMP_SPACING } from '@/render3d/core/ground';
import { BODY, STUMP_SPACING as PHYSICS_SPACING } from '@/physics/constants';
import { batPoseAt, STANCE } from '@/render3d/practice/bat';
import { buildDiagnostics } from '@/render3d/practice/diagnostics';
import { feedbackCues } from '@/render3d/practice/feedback';
import { ballAt, perfToSim, releasePerf, simToPerf, simToScene, toWorld, type Timebase } from '@/render3d/practice/frame';
import { batterEye, buildPracticeScript, practiceReleaseScene, pathMoves, NOMINAL_RELEASE_HAND, practiceAction } from '@/render3d/practice/script';
import { batterBody } from '@/physics/bat';
import { BENCH_CAP_MS, BENCH_MIN_MEASURED_FRAMES, PracticeSessionBase, replayWarp, warpScene, type StageClock, type StageFrame } from '@/render3d/practice/session';
import { frameStats, PERF_WARMUP_FRAMES } from '@/perf';
import type { PracticeBenchmarkRun, PracticeMountOptions, PracticeSceneSetup, PracticeSink } from '@/render3d/practice/types';
import { BatterViewPainter } from '@/render3d/fallback2d/batterView';
import { fixtureField, fixtureFlight, fixtureResult, type ResultKind } from './practiceFixtures';

const setupFor = (handedness: 'right' | 'left' = 'right', family: 'pace' | 'spin' = 'pace'): PracticeSceneSetup => ({
  field: fixtureField(),
  bowler: family === 'pace' ? { family, paceBand: 'fast', arm: 'right', lookSeed: 'b1' } : { family, spinType: 'finger', arm: 'right', lookSeed: 's1' },
  conditions: 'balanced',
  handedness,
});
const KINDS: ResultKind[] = ['drive', 'defend', 'edge', 'miss', 'leave', 'bowled', 'six', 'catch'];
const ctx = { aspect: 844 / 390, reducedMotion: false };

function resultScript(kind: ResultKind, handedness: 'right' | 'left' = 'right', opts: { timingMs?: number } = {}): { script: BallScript; result: DeliveryResult } {
  const flight = fixtureFlight({ lengthM: kind === 'bowled' ? 5 : 6, lineM: kind === 'bowled' ? 0 : 0.1 });
  const result = fixtureResult(flight, { kind, timingMs: opts.timingMs ?? 10, bearing: 30 });
  return { script: buildPracticeScript({ setup: setupFor(handedness), flight, result }), result };
}

/** Projects a world point through a camera pose; null when behind it. Returns NDC (−1..1). */
function ndc(cam: CameraPose, p: { x: number; y: number; z: number }, aspect: number) {
  const f = { x: cam.target.x - cam.pos.x, y: cam.target.y - cam.pos.y, z: cam.target.z - cam.pos.z };
  const fl = Math.hypot(f.x, f.y, f.z);
  const fw = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
  const r = { x: -fw.z, y: 0, z: fw.x };
  const rl = Math.hypot(r.x, r.z);
  r.x /= rl;
  r.z /= rl;
  const u = { x: r.y * fw.z - r.z * fw.y, y: r.z * fw.x - r.x * fw.z, z: r.x * fw.y - r.y * fw.x };
  const d = { x: p.x - cam.pos.x, y: p.y - cam.pos.y, z: p.z - cam.pos.z };
  const depth = d.x * fw.x + d.y * fw.y + d.z * fw.z;
  if (depth <= 0) return null;
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  return { x: (d.x * r.x + d.y * r.y + d.z * r.z) / depth / (tanV * aspect), y: (d.x * u.x + d.y * u.y + d.z * u.z) / depth / tanV };
}

const angleBetween = (a: CameraPose, b: CameraPose) => {
  const da = { x: a.target.x - a.pos.x, y: a.target.y - a.pos.y, z: a.target.z - a.pos.z };
  const db = { x: b.target.x - b.pos.x, y: b.target.y - b.pos.y, z: b.target.z - b.pos.z };
  const la = Math.hypot(da.x, da.y, da.z);
  const lb = Math.hypot(db.x, db.y, db.z);
  return (Math.acos(Math.min(1, (da.x * db.x + da.y * db.y + da.z * db.z) / (la * lb))) * 180) / Math.PI;
};

describe('the batter-eye camera', () => {
  it('sits 1.65–1.75 m above the crease, inside the physics head, on the batter’s leg side, mirrored for left-handers', () => {
    const head = batterBody(null).head;
    for (const mirror of [false, true]) {
      const eye = batterEye(mirror);
      expect(eye.y).toBeGreaterThanOrEqual(1.65);
      expect(eye.y).toBeLessThanOrEqual(1.75);
      expect(Math.hypot(eye.x - (mirror ? -head.c.x : head.c.x), eye.y - head.c.y, eye.z - head.c.z)).toBeLessThan(head.r);
      expect(Math.abs(eye.y - BODY.headY)).toBeLessThanOrEqual(BODY.headR);
    }
    expect(batterEye(false).x).toBeLessThan(0);
    expect(batterEye(true).x).toBeCloseTo(-batterEye(false).x, 9);
    // Every footwork the physics plays keeps its head where the eye can stay: the camera never moves with the stride.
    for (const fw of ['forward', 'back', 'across', 'down_track'] as const) {
      const h = batterBody(fw, fixtureFlight()).head.c;
      expect(h.y + 0.06).toBeGreaterThan(1.5);
    }
  });

  it('stays at the eye with a constant field of view for every footwork, swing and handedness (no zoom, no bob)', () => {
    for (const handedness of ['right', 'left'] as const) {
      for (const kind of KINDS) {
        const { script } = resultScript(kind, handedness);
        const plan = practicePlan(script, false);
        const eye = batterEye(handedness === 'left');
        const until = script.practice!.firstPersonUntil;
        for (let t = 0; t < Math.min(until, script.duration); t += 37) {
          const cam = cameraAt(script, t, plan, ctx);
          expect(cam.shot).toBe('batter_eye');
          expect(cam.pos).toEqual(eye);
          expect(cam.pos.y).toBeGreaterThanOrEqual(1.65);
          expect(cam.pos.y).toBeLessThanOrEqual(1.75);
          expect(cam.fov).toBe(batterFov(ctx.aspect));
        }
      }
    }
    expect(batterFov(2.16)).toBe(BATTER_FOV.vertical);
    expect(batterFov(1.33)).toBeGreaterThan(BATTER_FOV.vertical);
  });

  it('never cuts from the start of the delivery until after contact or a miss, and turns no faster than smooth pursuit', () => {
    // A cut would jump tens of degrees in one frame; the gaze turns at most GAZE.maxRateDegS (yaw and pitch each).
    const perFrame = GAZE.maxRateDegS * 0.016 * Math.SQRT2 + 0.05;
    for (const kind of KINDS) {
      const { script, result } = resultScript(kind);
      const plan = practicePlan(script, false);
      const rel = script.practice!.releaseScene;
      const decided = simToScene({ releaseScene: rel }, result.contact.t ?? result.flight.stumpsT);
      let prev = cameraAt(script, 0, plan, ctx);
      for (let t = 16; t <= decided; t += 16) {
        const cam = cameraAt(script, t, plan, ctx);
        expect(cam.shot, `${kind} at ${t}`).toBe('batter_eye');
        expect(angleBetween(prev, cam), `${kind} at ${t}`).toBeLessThan(perFrame);
        prev = cam;
      }
    }
  });

  it('cuts to the fielding camera after the bat, to the broken wicket after a bowled, and stays first person for a leave', () => {
    const shotAfter = (kind: ResultKind) => {
      const { script } = resultScript(kind);
      return cameraAt(script, script.duration - 10, practicePlan(script, false), ctx).shot;
    };
    expect(shotAfter('drive')).toBe('fielder_follow');
    expect(shotAfter('six')).toBe('fielder_follow');
    expect(shotAfter('bowled')).toBe('practice_stumps');
    expect(shotAfter('leave')).toBe('batter_eye');
    expect(shotAfter('miss')).toBe('batter_eye');
  });

  it('dismissal and fielding cameras have no player in the near part of their view, and frame the broken wicket', () => {
    for (const handedness of ['right', 'left'] as const) {
      for (const family of ['pace', 'spin'] as const) {
        for (const kind of ['bowled', 'catch', 'drive', 'six'] as ResultKind[]) {
          const flight = fixtureFlight({ lengthM: kind === 'bowled' ? 5 : 6, lineM: kind === 'bowled' ? 0 : 0.1, speedKph: family === 'spin' ? 86 : 136 });
          const result = fixtureResult(flight, { kind, timingMs: kind === 'bowled' ? -150 : 10, bearing: 30 });
          // A spinner's keeper stands up to the stumps: the case that once filled the bowled shot with legs.
          const field = fixtureField();
          if (family === 'spin') field.fielders = field.fielders.map((f) => (f.role === 'keeper' ? { ...f, z: 10.06 + 0.8 } : f));
          const script = buildPracticeScript({ setup: { ...setupFor(handedness, family), field }, flight, result });
          const plan = practicePlan(script, false);
          const p = script.practice!;
          for (let t = p.firstPersonUntil + 1; t < Math.min(script.duration, p.firstPersonUntil + 4000); t += 100) {
            const cam = cameraAt(script, t, plan, ctx);
            expect(cam.shot).not.toBe('batter_eye');
            expect(occludingActors(script, t, cam, 1.5), `${handedness} ${family} ${kind} ${cam.shot} t=${t}`).toEqual([]);
            if (kind === 'bowled') {
              const stumps = ndc(cam, { x: 0, y: 0.4, z: 10.06 }, ctx.aspect)!;
              expect(Math.abs(stumps.x)).toBeLessThan(0.5);
              expect(Math.abs(stumps.y)).toBeLessThan(0.5);
            }
          }
        }
      }
    }
  });

  it('frames the release in the upper part of the view and keeps the ball in view into the hitting area', () => {
    // The ideal contact is almost under the batter's eyes (the physics contact planes are 1.05–2.9 m in front of the
    // stumps, the head 1.2 m), so no forward view can show the last instant: the ball must stay in view until it is
    // at most HITTING_AREA_MS from the bat (≈ 2 m at express pace), never leaving earlier.
    const HITTING_AREA_MS = 60;
    for (const handedness of ['right', 'left'] as const) {
      for (const [lengthM, speedKph, releaseY] of [[1.5, 142, 2.15], [4, 136, 2.15], [6, 136, 2.15], [8.5, 145, 2.2], [4.5, 86, 1.9]] as const) {
        const flight = fixtureFlight({ lengthM, speedKph, releaseY });
        const result = fixtureResult(flight, { kind: 'drive', timingMs: 0 });
        const script = buildPracticeScript({ setup: setupFor(handedness), flight, result });
        const plan = practicePlan(script, false);
        const p = script.practice!;
        const atRelease = ndc(cameraAt(script, p.releaseScene, plan, ctx), p.releaseWorld, ctx.aspect)!;
        expect(atRelease.y).toBeGreaterThan(0.3);
        expect(Math.abs(atRelease.x)).toBeLessThan(0.3);
        for (let t = 0; t <= result.contact.t! - HITTING_AREA_MS / 1000; t += 0.01) {
          const scene = simToScene(p, t);
          const q = ndc(cameraAt(script, scene, plan, ctx), sampleBall(script, scene).pos, ctx.aspect)!;
          expect(q, `t=${t}`).not.toBeNull();
          expect(Math.abs(q.x), `${lengthM} t=${t}`).toBeLessThan(1);
          expect(Math.abs(q.y), `${lengthM} t=${t}`).toBeLessThan(1);
        }
      }
    }
  });
});

describe('physics positions are drawn where physics puts them', () => {
  it('the ball follows the result’s samples (mirrored for a left-hander) and the stumps are the physics stumps', () => {
    for (const handedness of ['right', 'left'] as const) {
      const { script, result } = resultScript('drive', handedness);
      const rel = script.practice!.releaseScene;
      for (const s of result.ball.filter((_, i) => i % 25 === 0)) {
        const drawn = sampleBall(script, simToScene({ releaseScene: rel }, s.t)).pos;
        const w = toWorld(s.p, handedness === 'left');
        expect(drawn.x).toBeCloseTo(w.x, 6);
        expect(drawn.y).toBeCloseTo(w.y, 6);
        expect(drawn.z).toBeCloseTo(w.z, 6);
      }
    }
    expect(STUMP_SPACING).toBe(PHYSICS_SPACING);
  });

  it('fielders follow their FielderPath', () => {
    const { script, result } = resultScript('catch');
    const rel = script.practice!.releaseScene;
    const path = result.fielders.find((p) => p.fielderId === 'cv')!;
    const track = script.actors.find((a) => a.id === 'fielder:cv')!;
    for (const s of path.samples) {
      const at = evaluateActor(track, simToScene({ releaseScene: rel }, s.t) + 0.5).pos;
      expect(at.x).toBeCloseTo(s.x, 1);
      expect(at.z).toBeCloseTo(s.z, 1);
    }
    // Dense run samples keep one stride phase (no restart every sample).
    const moves = pathMoves({ fielderId: 'x', samples: [0, 0.1, 0.2, 0.3].map((t, i) => ({ t, x: i, z: 0, action: 'run' as const })) }, false, 1000);
    expect(moves.map((m) => m.clipStart)).toEqual([0, expect.any(Number), expect.any(Number)]);
    expect(moves[1].clipStart!).toBeGreaterThan(0);
  });

  it('the drawn bat is the physics bat once the result is in, and the provisional swing blends into it', () => {
    const { result } = resultScript('drive');
    const rel = 2000;
    const live = buildPracticeScript({ setup: setupFor(), flight: result.flight, result, provisionalStart: simToScene({ releaseScene: rel }, result.swing!.startT), resultAt: simToScene({ releaseScene: rel }, result.swing!.startT + 0.05) });
    const p = live.practice!;
    const contact = simToScene(p, result.contact.t!);
    const drawn = batPoseAt(p.bat, contact);
    const physics = result.bat.find((b) => b.t >= result.contact.t! - 1e-9)!;
    expect(drawn.grip.x).toBeCloseTo(physics.grip.x, 2);
    expect(drawn.toe.y).toBeCloseTo(physics.toe.y, 2);
    // Before any swing: the stance.
    expect(batPoseAt(p.bat, 0).toe).toEqual(STANCE.toe);
  });

  it('the bowler releases from its own hand: the root sits behind the release point by the hand offset', () => {
    const setup = setupFor();
    const flight = fixtureFlight({ releaseX: 0.42 });
    const script = buildPracticeScript({ setup, flight });
    const bowler = script.actors.find((a) => a.id === 'bowler')!;
    const at = evaluateActor(bowler, script.practice!.releaseScene).pos;
    const hand = NOMINAL_RELEASE_HAND[practiceAction(setup.bowler)];
    expect(at.x + hand.x).toBeCloseTo(flight.release.p.x, 6);
    expect(at.z + hand.z).toBeCloseTo(flight.release.p.z, 6);
    // A left-arm bowler plays mirrored and its (mirrored) hand is at the release point.
    const lefty = buildPracticeScript({ setup: { ...setup, bowler: { ...setup.bowler, arm: 'left' } }, flight: fixtureFlight({ releaseX: -0.42 }) });
    const lb = lefty.actors.find((a) => a.id === 'bowler')!;
    expect(lb.mirror).toBe(true);
    expect(evaluateActor(lb, lefty.practice!.releaseScene).pos.x - hand.x).toBeCloseTo(-0.42, 6);
  });
});

describe('quality profiles', () => {
  it('lite is cheap, standard moderate, high capped; all at 60 fps with the same readable ball', () => {
    const { lite, standard, high } = PRACTICE_PROFILES;
    expect(lite.preset.shadowMap).toBe(0);
    expect(lite.preset.crowdAnimated).toBe(false);
    expect(lite.preset.particles).toBeLessThan(standard.preset.particles);
    expect(lite.preset.lodDistance).toBeLessThan(standard.preset.lodDistance);
    expect(standard.preset.shadowMap).toBe(1024);
    expect(high.preset.shadowMap).toBe(2048);
    for (const p of [lite, standard, high]) {
      expect(p.preset.maxFps).toBe(60);
      expect(p.ball.visualScale).toBeGreaterThanOrEqual(1.2);
      expect(p.ball.visualScale).toBeLessThanOrEqual(1.25);
    }
    expect([lite.internal, standard.internal, high.internal]).toEqual([{ min: 540, max: 720 }, { min: 720, max: 900 }, { min: 900, max: 1440 }]);
  });

  it('renders inside each profile’s internal-resolution band and never past its DPR cap', () => {
    const ids: QualityProfileId[] = ['lite', 'standard', 'high'];
    for (const id of ids) {
      const p = PRACTICE_PROFILES[id];
      for (const [css, dpr] of [[390, 3], [360, 2], [768, 1], [1080, 2], [412, 2.625]] as const) {
        const ratio = practicePixelRatio(p, css, dpr);
        expect(ratio).toBeLessThanOrEqual(p.maxDpr + 1e-9);
        const h = css * ratio;
        if (ratio < p.maxDpr) expect(h).toBeGreaterThanOrEqual(p.internal.min - 1);
        expect(h).toBeLessThanOrEqual(p.internal.max + 1);
      }
    }
  });
});

describe('replay frames are deterministic', () => {
  it('the same result gives the same camera, ball, bat and players at every replay time, in any order', () => {
    const frame = (script: BallScript, ms: number) => {
      const w = replayWarp(script, 0.3);
      const scene = warpScene(w, ms);
      const plan = [{ shot: 'replay_side' as const, atMs: 0, durationMs: script.duration }];
      const cam = cameraAt(script, scene, plan, ctx);
      const fp = cameraAt(script, scene, [{ shot: 'batter_eye', atMs: 0, durationMs: script.duration }], ctx);
      return JSON.stringify([cam, fp, sampleBall(script, scene), batPoseAt(script.practice!.bat, scene), script.actors.map((a) => evaluateActor(a, scene))]);
    };
    for (const kind of ['drive', 'six', 'bowled'] as const) {
      const flight = fixtureFlight({ lengthM: 5.5 });
      const result = fixtureResult(flight, { kind, timingMs: -20, bearing: -40 });
      const a = buildPracticeScript({ setup: setupFor('left'), flight, result });
      const b = buildPracticeScript({ setup: setupFor('left'), flight, result: JSON.parse(JSON.stringify(result)) });
      const dur = replayWarp(a, 0.3).duration;
      const times = [0, 400, 1200, 2100, dur * 0.7, dur - 1];
      const fa = times.map((t) => frame(a, t));
      const fb = [...times].reverse().map((t) => frame(b, t)).reverse();
      expect(fb).toEqual(fa);
      expect(buildDiagnostics(result, a.practice!.releaseScene, true)).toEqual(buildDiagnostics(result, b.practice!.releaseScene, true));
    }
  });

  it('slows down only around the bat', () => {
    const { script } = resultScript('drive');
    const w = replayWarp(script, 0.25);
    const p = script.practice!;
    expect(w.slow[0]).toBeLessThan(p.contactScene!);
    expect(w.slow[1]).toBeGreaterThan(p.contactScene!);
    // Inside the window, 100 ms of replay is 25 ms of play; outside it, real time.
    const inside = w.anchors[1][0] + 100;
    expect(warpScene(w, inside) - warpScene(w, w.anchors[1][0])).toBeCloseTo(25, 6);
    expect(warpScene(w, 100) - warpScene(w, 0)).toBeCloseTo(100, 6);
  });
});

describe('feedback is keyed to the simulation timestamps', () => {
  it('every contact kind gets its own feel at the event’s scene time', () => {
    const feelOf = (kind: ResultKind, timingMs = 5) => {
      const { result, script } = resultScript(kind, 'right', { timingMs });
      return { cues: feedbackCues(result, script.practice!.releaseScene, false), result, script };
    };
    const sweet = feelOf('drive', 5);
    const contact = sweet.cues.find((c) => c.feel)!;
    expect(contact.feel!.kind).toBe('sweet');
    expect(contact.t).toBeCloseTo(simToScene(sweet.script.practice!, sweet.result.contact.t!), 6);
    expect(feelOf('drive', 50).cues.find((c) => c.feel)!.feel!.kind).toBe('middle');
    expect(feelOf('edge').cues.find((c) => c.feel)!.feel!.kind).toBe('edge');
    expect(feelOf('miss').cues.find((c) => c.feel)!.feel!.kind).toBe('miss');
    // Bowled after a miss: the miss is felt at the closest approach, then the stumps.
    expect(feelOf('bowled').cues.filter((c) => c.feel).map((c) => c.feel!.kind)).toEqual(['miss', 'bowled']);
    expect(feelOf('six').cues.filter((c) => c.feel).map((c) => c.feel!.kind)).toContain('six');
    expect(feelOf('catch').cues.filter((c) => c.feel).map((c) => c.feel!.kind)).toContain('catch');
    expect(feelOf('leave').cues.filter((c) => c.feel)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The session: clocks, promises, profiles and cue timing
// ---------------------------------------------------------------------------------------------------------------

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
  /** Advances to `to`, firing timers in order and one frame every `frameMs`. */
  const run = async (to: number, frameMs = 16) => {
    while (now < to) {
      const step = Math.min(frameMs, to - now);
      const target = now + step;
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
      const cb = frames.shift();
      cb?.(now);
      await Promise.resolve();
    }
  };
  return { clock, run, now: () => now };
}

class RecordingStage extends PracticeSessionBase {
  readonly kind = '3d' as const;
  frames: StageFrame[] = [];
  profiles: QualityProfileId[] = [];
  protected drawFrame(frame: StageFrame) {
    this.frames.push(frame);
  }
  protected applyProfile(id: QualityProfileId) {
    this.profiles.push(id);
  }
  protected rendererName() {
    return 'test';
  }
  protected drawCalls() {
    return 0;
  }
  async mount(_c: HTMLCanvasElement, o: PracticeMountOptions) {
    this.startSession(o);
  }
  async benchmark(ms: number): Promise<PracticeBenchmarkRun> {
    const frameMs = await this.runBenchmarkScene(ms, buildPracticeScript({ setup: setupFor(), flight: null, runUp: true }));
    return { frameMs, shaderCompileMs: 0, contextLosses: 0, renderer: 'test', webgl2: true, hardware: true };
  }
}

async function mounted() {
  const c = fakeClock();
  const stage = new RecordingStage(c.clock);
  const sounds: string[] = [];
  const sink: PracticeSink = { cue: (k) => sounds.push(`${k}@${Math.round(c.now())}`), crowd: () => undefined, feel: (f) => sounds.push(`feel:${f}@${Math.round(c.now())}`) };
  stage.setSink(sink);
  await stage.mount({} as HTMLCanvasElement, { profile: 'standard', handedness: 'right', reducedMotion: false, learnCue: false });
  stage.setScene(setupFor());
  return { stage, c, sounds };
}

describe('the stage session', () => {
  it('maps simulation time to performance time from the release, and the time-scale hook scales it', async () => {
    const { stage, c } = await mounted();
    const flight = fixtureFlight();
    let released: number | null = null;
    void stage.bowl(flight).then((r) => (released = r.releasePerfMs));
    const expected = 1000 + practiceReleaseScene(setupFor().bowler);
    expect(stage.releasePerfMs()).toBe(expected);
    expect(stage.simToPerf(0)).toBe(expected);
    expect(stage.simToPerf(0.5)).toBe(expected + 500);
    expect(stage.perfToSim(expected + 250)).toBeCloseTo(0.25, 9);
    await c.run(expected + 20);
    expect(released).toBe(expected);
    const tb: Timebase = { startPerfMs: 0, releaseScene: 2000, timeScale: 0.5 };
    expect(releasePerf(tb)).toBe(4000);
    expect(perfToSim(tb, 5000)).toBeCloseTo(0.5, 9);
    expect(simToPerf(tb, perfToSim(tb, 4321))).toBeCloseTo(4321, 9);
  });

  it('every frame draws the simulation at its own timestamp (no frame counting)', async () => {
    const { stage, c } = await mounted();
    const flight = fixtureFlight();
    void stage.bowl(flight);
    const release = stage.releasePerfMs()!;
    await c.run(release + 200, 23);
    for (const f of stage.frames.filter((x) => x.mode === 'live')) {
      const sim = (f.scene - f.script.practice!.releaseScene) / 1000;
      if (sim < 0 || sim > flight.samples.at(-1)!.t) continue;
      const drawn = sampleBall(f.script, f.scene).pos;
      const truth = ballAt(flight.samples, sim)!;
      expect(drawn.z).toBeCloseTo(truth.z, 6);
    }
  });

  it('plays the result to dead ball, firing each sound once at its own time; profile changes wait for the dead ball', async () => {
    const { stage, c, sounds } = await mounted();
    const flight = fixtureFlight();
    void stage.bowl(flight);
    const release = stage.releasePerfMs()!;
    const result = fixtureResult(flight, { kind: 'six', timingMs: 5 });
    await c.run(release + result.swing!.startT * 1000 - 5);
    stage.beginSwing(c.now());
    await c.run(c.now() + 40);
    let dead = false;
    void stage.play(result).then(() => (dead = true));
    stage.setProfile('lite');
    expect(stage['profileId']).toBe('standard');
    await c.run(release + result.deadT * 1000 - 50);
    expect(dead).toBe(false);
    await c.run(release + result.deadT * 1000 + 20);
    expect(dead).toBe(true);
    expect(stage['profileId']).toBe('lite');
    const contactAt = Math.round(release + result.contact.t! * 1000);
    const bat = sounds.find((s) => s.startsWith('feel:sweet'))!;
    expect(Math.abs(Number(bat.split('@')[1]) - contactAt)).toBeLessThanOrEqual(1);
    expect(sounds.filter((s) => s.startsWith('release')).length).toBe(1);
    expect(sounds.some((s) => s.startsWith('six'))).toBe(true);
  });

  it('records the input-to-bat latency on the first frame that shows the bat moving', async () => {
    const { stage, c } = await mounted();
    void stage.bowl(fixtureFlight());
    const release = stage.releasePerfMs()!;
    await c.run(release + 300);
    const press = c.now() - 4;
    stage.beginSwing(press, 30);
    await c.run(c.now() + 40);
    const lat = stage.stats().lastInputToBatMs!;
    expect(lat).toBeGreaterThan(0);
    expect(lat).toBeLessThanOrEqual(4 + 16 + 1);
  });

  it('dispose settles every pending promise without rejecting', async () => {
    const { stage } = await mounted();
    const flight = fixtureFlight();
    const bowled = stage.bowl(flight);
    const played = stage.play(fixtureResult(flight, { kind: 'drive' }));
    stage.dispose();
    await expect(bowled).resolves.toHaveProperty('releasePerfMs');
    await expect(played).resolves.toBeUndefined();
  });

  it('measures a slow (software-rendered) device on real frames: the warm-up plus six at least, within the cap', async () => {
    const { stage, c } = await mounted();
    let r: PracticeBenchmarkRun | null = null;
    void stage.benchmark(1400).then((x) => (r = x));
    // A software renderer: one frame every 500 ms. A 1.4 s run alone would leave nothing after src/perf's warm-up.
    await c.run(c.now() + BENCH_CAP_MS + 600, 500);
    expect(r).not.toBeNull();
    expect(r!.frameMs.length).toBeGreaterThanOrEqual(PERF_WARMUP_FRAMES + BENCH_MIN_MEASURED_FRAMES);
    const stats = frameStats(r!.frameMs);
    expect(stats.frames).toBeGreaterThanOrEqual(BENCH_MIN_MEASURED_FRAMES);
    expect(stats.avgFps).toBeCloseTo(2, 0);
  });

  it('keeps running when a frame throws, and asks for the fallback after three failures', async () => {
    class Throwing extends RecordingStage {
      protected drawFrame(): void {
        throw new Error('boom');
      }
    }
    const c = fakeClock();
    const stage = new Throwing(c.clock);
    const fallbacks: unknown[] = [];
    stage.on('fallback', (p) => fallbacks.push(p));
    await stage.mount({} as HTMLCanvasElement, { profile: 'standard', handedness: 'right', reducedMotion: false, learnCue: false });
    stage.setScene(setupFor());
    await c.run(c.now() + 200);
    expect(fallbacks).toEqual([{ reason: 'error', message: 'boom' }]);
    const before = stage.stats().fps;
    await c.run(c.now() + 200);
    expect(stage.stats().fps).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  it('applies a profile on the next frame between deliveries (the benchmark switches between runs)', async () => {
    const { stage, c } = await mounted();
    stage.setProfile('high');
    expect(stage.profiles).toEqual(['high']);
    const run = stage.benchmark(200);
    await c.run(c.now() + 300);
    const r = await run;
    expect(r.frameMs.length).toBeGreaterThan(8);
    expect(r.frameMs.every((ms) => ms > 0 && ms <= 16)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Classic 2D draws the same data
// ---------------------------------------------------------------------------------------------------------------

/** A 2D context that records the circles it is asked to draw. */
function recordingContext() {
  const arcs: Array<{ x: number; y: number; r: number }> = [];
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  const ctx = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'arcs') return arcs;
        if (key === 'arc') return (x: number, y: number, r: number) => arcs.push({ x, y, r });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
        return noop;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D & { arcs: typeof arcs };
  return ctx;
}

describe('Classic 2D', () => {
  it('draws the ball where the result puts it, through the same camera as 3D', () => {
    const { script, result } = resultScript('drive');
    const p = script.practice!;
    const plan = practicePlan(script, false);
    const ctx2d = recordingContext();
    const painter = new BatterViewPainter(ctx2d);
    painter.resize(844, 390, 1);
    const t = simToScene(p, result.contact.t! - 0.1);
    const cam = cameraAt(script, t, plan, { aspect: 844 / 390, reducedMotion: false });
    painter.paint(script, t, cam, [
      { id: 'a', primary: '#000000', secondary: '#ffffff', pattern: 'plain' },
      { id: 'b', primary: '#000000', secondary: '#ffffff', pattern: 'plain' },
    ], { bat: null, landing: null, landingUntil: 0, hidden: new Set(['striker']), visualScale: 1.22 });
    const truth = toWorld(ballAt(result.ball, result.contact.t! - 0.1)!, false);
    const q = painter.project(truth)!;
    expect(ctx2d.arcs.some((a) => Math.abs(a.x - q.x) < 0.01 && Math.abs(a.y - q.y) < 0.01)).toBe(true);
  });
});
