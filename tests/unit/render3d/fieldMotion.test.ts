// @vitest-environment node
/**
 * WEB-FIELD: the fielders and the keeper move like cricketers, on real physics deliveries (src/physics, frozen), as
 * the Practice stage draws them (the choreography in practice/fielding.ts and the field pose hook in
 * core/fieldClips.ts + core/locomotion.ts):
 *  - gaits are chosen by speed and played speed-matched, so stride timing follows the speed (no running on the spot);
 *  - headings turn linearly at a body's rate, never snapping;
 *  - the set fielders stand up and watch once the ball is played elsewhere; the keeper rises with the ball from its
 *    bounce; fielders walk back after the dead ball;
 *  - with the hook: planted feet stay planted, nobody stands frozen, the gloves meet the physics ball at the take, and
 *    every frame is a pure function of (script, time).
 */
import { describe, expect, it } from 'vitest';
import { evaluateActor, lookScale } from '@/render3d/core/actors';
import { type ClipId, clipDuration, clipMarker, createPose, sampleClip } from '@/render3d/core/clips';
import { BUILTIN_FIELD_CLIPS, composeHooks, fieldClips, fieldPoseHook, fieldPoseHookFor, keeperStateAt, matchedRate, packTime, registerFieldMotion, setFieldPacks } from '@/render3d/core/fieldClips';
import { createJoints, createPoseScratch, forwardKinematics, localToWorld, palmLocal, trackPoseAt, turnRateCap } from '@/render3d/core/locomotion';
import { BONE_INDEX } from '@/render3d/core/skeleton';
import { angleDelta } from '@/render3d/core/math';
import { RETURN, gaitAt } from '@/render3d/practice/fielding';
import { ballAt, simToScene, toWorld } from '@/render3d/practice/frame';
import { corpus, measureTrack, scriptOf, summarize, type CorpusBall } from './fieldNaturalness';

const BALLS: CorpusBall[] = corpus(2, 1);
const fieldTracks = (s: ReturnType<typeof scriptOf>) => s.actors.filter((a) => a.id === 'keeper' || a.id.startsWith('fielder:'));
const GAITS = new Set<ClipId>(['walk', 'jog', 'run', 'run_drive']);

describe('gaits by speed, speed-matched', () => {
  it('picks walk, jog and run by ground speed, keeps a gait across a boundary within its hysteresis, and matches the rate', () => {
    expect(gaitAt(1.2, null).key).toBe('walk');
    expect(gaitAt(3.2, null).key).toBe('jog');
    expect(gaitAt(6.5, null).key).toBe('run');
    // Boundaries at the geometric means of neighbouring loops' speeds; a gait holds within 0.3 m/s past its edge.
    expect(gaitAt(2.4, 'walk').key).toBe('walk');
    expect(gaitAt(2.4, null).key).toBe('jog');
    for (const v of [0.5, 1, 1.4, 2, 3, 4, 5, 6, 7, 8]) {
      const g = gaitAt(v, null);
      const def = g.key === 'walk' ? BUILTIN_FIELD_CLIPS.walk : g.key === 'jog' ? BUILTIN_FIELD_CLIPS.jog : BUILTIN_FIELD_CLIPS.run;
      // MOTION-SPEC §6: speed-matched within [0.75, 1.3] of the loop's own rate.
      expect(g.rate).toBeCloseTo(matchedRate(def, v, 1, 0.75, 1.3), 9);
    }
  });

  it('the gait table speeds are the loops\' own: the planted ankle moves back at about that speed at rate 1', () => {
    const pose = createPose();
    const j = createJoints();
    for (const g of [BUILTIN_FIELD_CLIPS.walk, BUILTIN_FIELD_CLIPS.jog, BUILTIN_FIELD_CLIPS.run, BUILTIN_FIELD_CLIPS.drive]) {
      const D = clipDuration(g.clip);
      const N = 400;
      const ys: number[] = [];
      const zs: number[] = [];
      for (let k = 0; k < N; k++) {
        sampleClip(g.clip, (D * k) / N, pose);
        forwardKinematics(pose, j);
        ys.push(j.p[BONE_INDEX.footL * 3 + 1]);
        zs.push(j.p[BONE_INDEX.footL * 3 + 2]);
      }
      const lo = Math.min(...ys);
      let sum = 0;
      let n = 0;
      for (let k = 0; k < N; k++)
        if (ys[k] <= lo + 0.025) {
          sum += Math.abs(zs[(k + 1) % N] - zs[k]) / (D / N);
          n++;
        }
      expect(Math.abs(sum / n - g.speedMps) / g.speedMps, g.clip).toBeLessThan(0.16);
    }
  });

  it('on real fielding: gait loops only on the move, speed-matched (no running on the spot), cadence in a human range', () => {
    let checked = 0;
    for (const b of BALLS) {
      const script = scriptOf(b);
      const rel = script.practice!.releaseScene;
      for (const tr of fieldTracks(script)) {
        const scale = lookScale(tr.look);
        for (const m of tr.moves) {
          if (m.t0 < rel || !GAITS.has(m.clip) || !m.from || !m.to) continue;
          const v = Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z) / ((m.t1 - m.t0) / 1000);
          expect(v, `${b.key} ${tr.id} ${m.clip}`).toBeGreaterThan(0.3);
          const def = m.clip === 'walk' ? BUILTIN_FIELD_CLIPS.walk : m.clip === 'jog' ? BUILTIN_FIELD_CLIPS.jog : m.clip === 'run' ? BUILTIN_FIELD_CLIPS.run : BUILTIN_FIELD_CLIPS.drive;
          const cadence = (2 * (m.rate ?? 1)) / clipDuration(m.clip);
          expect(cadence).toBeGreaterThanOrEqual(1.0);
          expect(cadence).toBeLessThanOrEqual(4.7);
          // The drive cycle is never the start of a slow run (the audit's 1.6–3.6 m/s "running on the spot").
          if (m.clip === 'run_drive') expect(v).toBeGreaterThanOrEqual(0.5 * def.speedMps * scale - 1e-9);
          // Skate ratio (the loop's own foot speed over the ground speed) once he is properly moving.
          if (v >= 1) {
            const skate = ((m.rate ?? 1) * def.speedMps * scale) / v;
            expect(skate, `${b.key} ${tr.id} ${m.clip} v=${v.toFixed(2)}`).toBeGreaterThan(0.6);
            expect(skate, `${b.key} ${tr.id} ${m.clip} v=${v.toFixed(2)}`).toBeLessThan(1.6);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('headings, the set stance, the keeper and the walk back', () => {
  it('every field move turns linearly, no faster than a body at its speed can (a dive excepted)', () => {
    for (const b of BALLS) {
      const script = scriptOf(b);
      const rel = script.practice!.releaseScene;
      for (const tr of fieldTracks(script))
        for (const m of tr.moves) {
          if (m.t0 < rel || m.heading === undefined || m.headingTo === undefined) continue;
          expect(m.headingEase, `${tr.id} ${m.clip}`).toBe('linear');
          const dt = (m.t1 - m.t0) / 1000;
          const v = m.from && m.to ? Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z) / dt : 0;
          const rate = Math.abs(angleDelta(m.heading, m.headingTo)) / dt;
          expect(rate, `${b.key} ${tr.id} ${m.clip}`).toBeLessThanOrEqual((/dive/.test(m.clip) ? 14 : Math.max(9, turnRateCap(v))) + 1e-6);
        }
    }
  });

  it('a fielder the ball is not coming to stands up out of the ready crouch once it is played, and watches it', () => {
    let relaxed = 0;
    for (const b of BALLS) {
      const script = scriptOf(b);
      const rel = script.practice!.releaseScene;
      // Played: the bat's contact, or (left or missed) the ball reaching the stumps' plane.
      const contact = b.result.events.find((e) => e.kind === 'contact')?.t ?? b.result.flight.stumpsT;
      for (const f of b.result.fielders) {
        // Set until well after the contact (he is not sent after the ball, or only later).
        const firstMove = f.samples.find((s) => s.action !== 'set')?.t ?? Infinity;
        if (firstMove < contact + 1.4) continue;
        const tr = script.actors.find((a) => a.id === `fielder:${f.fielderId}`);
        if (!tr) continue;
        expect(evaluateActor(tr, rel + 20).current.clip).toBe('ready');
        // Never before the ball has been played (honest: no anticipation of where it goes).
        for (const m of tr.moves) if (m.clip === 'idle' && m.t0 >= rel && m.t0 < simToScene({ releaseScene: rel }, contact)) throw new Error(`${tr.id} stood up before the ball was played`);
        if (evaluateActor(tr, simToScene({ releaseScene: rel }, contact + 1.2)).current.clip === 'idle') relaxed++;
      }
    }
    expect(relaxed).toBeGreaterThan(3);
  });

  it('the keeper rises with the ball from its bounce and takes it at the physics take', () => {
    let rises = 0;
    for (const b of BALLS) {
      const take = b.result.events.find((e) => e.kind === 'keeper_take');
      const bounce = b.result.flight.bounce?.t;
      if (!take || bounce === undefined) continue;
      const script = scriptOf(b);
      const rel = script.practice!.releaseScene;
      const keeper = script.actors.find((a) => a.id === 'keeper')!;
      const takeMoves = keeper.moves.filter((m) => m.clip === 'keep_take');
      if (!takeMoves.length) continue;
      const first = takeMoves[0];
      const takeS = simToScene({ releaseScene: rel }, take.t);
      const bounceS = simToScene({ releaseScene: rel }, bounce);
      // With time between the bounce and the take's own lead-in (0.3 s), the rise starts at the bounce, never before;
      // a ball on him sooner (the keeper up to a spinner) gets the take's own lead-in.
      if (takeS - bounceS > 300 + 1) {
        expect(first.t0).toBeGreaterThanOrEqual(bounceS - 1);
        expect(first.t0).toBeLessThanOrEqual(takeS - 300 + 1);
        rises++;
      } else expect(first.t0).toBeCloseTo(takeS - 300, 3);
      expect(keeperStateAt(script, rel)?.phase).toBe('crouch');
    }
    expect(rises).toBeGreaterThan(0);
  });

  it('after the dead ball a fielder away from his mark walks back to it, unhurried', () => {
    let walkers = 0;
    for (const b of BALLS) {
      const script = scriptOf(b);
      for (const tr of fieldTracks(script)) {
        const path = b.result.fielders.find((p) => `fielder:${p.fielderId}` === tr.id || (tr.id === 'keeper' && p.fielderId === 'keeper'));
        if (!path) continue;
        const end = simToScene({ releaseScene: script.practice!.releaseScene }, path.samples[path.samples.length - 1].t);
        const after = tr.moves.filter((m) => m.t0 >= end && m.clip === 'walk' && m.from && m.to);
        if (!after.length) continue;
        walkers++;
        expect(after[0].t0).toBeGreaterThanOrEqual(end + RETURN.settleS * 1000 - 1);
        for (const m of after) expect(Math.hypot(m.to!.x - m.from!.x, m.to!.z - m.from!.z) / ((m.t1 - m.t0) / 1000)).toBeLessThanOrEqual(RETURN.mps + 1e-6);
      }
    }
    expect(walkers).toBeGreaterThan(5);
  });
});

describe('the field pose hook', () => {
  it('is a pure function of (track, time): random seeks give the same pose as playing through', () => {
    const b = BALLS.find((x) => x.key.endsWith('/drive'))!;
    const script = scriptOf(b);
    const rel = script.practice!.releaseScene;
    const sc = createPoseScratch();
    const times = Array.from({ length: 40 }, (_, i) => rel - 1200 + i * 137);
    const seq = fieldPoseHook(script);
    const ref = new Map<string, Float32Array>();
    for (const t of times)
      for (const tr of fieldTracks(script)) {
        const p = trackPoseAt(tr, t, sc);
        seq(tr, p, t);
        ref.set(`${tr.id}@${t}`, new Float32Array(p.q));
      }
    const rnd = fieldPoseHook(script);
    for (const t of [...times].reverse())
      for (const tr of fieldTracks(script)) {
        const p = trackPoseAt(tr, t, sc);
        rnd(tr, p, t);
        const r = ref.get(`${tr.id}@${t}`)!;
        for (let i = 0; i < r.length; i++) expect(Math.abs(p.q[i] - r[i])).toBeLessThan(1e-6);
      }
    // One hook per script, reused every frame.
    expect(fieldPoseHookFor(script)).toBe(fieldPoseHookFor(script));
  });

  it('leaves every other actor untouched, and composes after another hook', () => {
    const script = scriptOf(BALLS[0]);
    const hook = fieldPoseHook(script);
    const sc = createPoseScratch();
    for (const tr of script.actors.filter((a) => !(a.id === 'keeper' || a.id.startsWith('fielder:')))) {
      const p = trackPoseAt(tr, 3000, sc);
      const before = new Float32Array(p.q);
      hook(tr, p, 3000);
      expect([...p.q]).toEqual([...before]);
    }
    const order: string[] = [];
    const h = composeHooks(() => order.push('a'), undefined, () => order.push('b'));
    h!(script.actors[0], createPose(), 0);
    expect(order).toEqual(['a', 'b']);
    expect(composeHooks(undefined, null)).toBeUndefined();
  });

  it('the keeper\'s gloves meet the physics ball at the take', () => {
    let met = 0;
    for (const b of BALLS) {
      const take = b.result.events.find((e) => e.kind === 'keeper_take');
      if (!take) continue;
      const script = scriptOf(b);
      const p = script.practice!;
      const keeper = script.actors.find((a) => a.id === 'keeper')!;
      if (evaluateActor(keeper, simToScene(p, take.t)).current.clip !== 'keep_take') continue;
      const hook = fieldPoseHook(script);
      const t = simToScene(p, take.t);
      const pose = trackPoseAt(keeper, t, createPoseScratch());
      hook(keeper, pose, t);
      const j = forwardKinematics(pose, createJoints());
      const st = evaluateActor(keeper, t);
      const scale = lookScale(keeper.look);
      // At the palms (players.ts ballInHand: where StageScene.handOf draws the held ball).
      const pl = palmLocal(j, 'L');
      const pr = palmLocal(j, 'R');
      const L = localToWorld(pl.x, pl.y, pl.z, st.pos, st.heading, scale);
      const R = localToWorld(pr.x, pr.y, pr.z, st.pos, st.heading, scale);
      const ball = toWorld(ballAt(p.result!.ball, take.t)!, p.mirror);
      const gap = Math.hypot((L.x + R.x) / 2 - ball.x, (L.y + R.y) / 2 - ball.y, (L.z + R.z) / 2 - ball.z);
      // Within reach the hands are there (to the IK's soft reach); beyond it they reach as far as the arms go.
      if (Math.hypot(ball.x - st.pos.x, ball.z - st.pos.z) < 0.6) {
        expect(gap, b.key).toBeLessThan(0.12);
        met++;
      }
    }
    expect(met).toBeGreaterThan(0);
  });

  it('on the live delivery: planted feet stay planted, nobody snaps or stands frozen (measured, see fieldNaturalness.ts)', () => {
    const s = summarize(BALLS.slice(0, 9), (script) => fieldPoseHook(script), true);
    // Before WEB-FIELD on the same corpus and scripts: 69.5% of plants slid more than 2 cm (median 9.8 cm), 235 frames
    // turned faster than 10 rad/s, and 15 of 720 tracks held a statue pose longer than 1.5 s.
    expect(s.plantsOver2cmPct).toBeLessThan(40);
    expect(s.slideMedianCm).toBeLessThan(1.5);
    // A foot lock may not buy its slide score by snapping the pelvis or legs. The repaired StepPlan measures 21 pop
    // samples in 50,170 posed frames here; 32 leaves >50% headroom while rejecting the 7-value soft-reach trade.
    expect(s.bodyPopFrames).toBeLessThanOrEqual(32);
    expect(s.bodyAngMax).toBeLessThan(45);
    expect(s.snapFrames).toBe(0);
    expect(s.tracksStillOver1_5s).toBeLessThanOrEqual(Math.ceil(s.tracks * 0.02));
    expect(s.movingShareMean).toBeGreaterThan(0.4);
  });

  it('keeps the pickup run pelvis continuous while the swing foot lands on its planned step', () => {
    // This exact real-physics path exposed the round-7 failure: an airborne target pulled root Y down 14 cm and back
    // up in one frame, producing 82–88 rad/s thigh/foot jumps. The phase-continuous drop cap keeps the same ankle
    // lock while joining the supporting stances smoothly.
    const b = corpus(2, 2).find((x) => x.key === 'spin/green/1/drive')!;
    const script = scriptOf(b);
    const rel = script.practice!.releaseScene;
    const track = script.actors.find((a) => a.id === 'fielder:long_off')!;
    const m = measureTrack(track, rel + 3000, rel + 3250, rel, fieldPoseHook(script));
    expect(m.bodyAngMax).toBeLessThan(40);
    expect(m.bodyPops).toBeLessThanOrEqual(4);
  });

  it('Reduced Motion keeps the planted feet but drops the weight shift and the eyes on the ball', () => {
    const b = BALLS.find((x) => x.key.endsWith('/drive'))!;
    const script = scriptOf(b);
    const rel = script.practice!.releaseScene;
    const tr = fieldTracks(script).find((a) => evaluateActor(a, rel + 2500).current.clip === 'idle')!;
    const sc = createPoseScratch();
    const a = trackPoseAt(tr, rel + 2500, sc);
    fieldPoseHook(script)(tr, a, rel + 2500);
    const qa = new Float32Array(a.q);
    const r = trackPoseAt(tr, rel + 2500, sc);
    fieldPoseHook(script, { reducedMotion: true })(tr, r, rel + 2500);
    let diff = 0;
    for (const bone of ['neck', 'head', 'spine'] as const) for (let k = 0; k < 4; k++) diff += Math.abs(qa[BONE_INDEX[bone] * 4 + k] - r.q[BONE_INDEX[bone] * 4 + k]);
    expect(diff).toBeGreaterThan(1e-3);
  });
});


describe("MOTION's packs, when registered", () => {
  /** A synthetic pack clip: the sampler writes the clip time into the hips' rotation (x component), contacts both feet. */
  const clip = (name: string, loop: boolean, duration: number, markers: Record<string, number> = {}, speedMps = 0) => ({ name, loop, duration, speedMps, markers });
  const sample = (c: { name: string }, t: number, out: ReturnType<typeof createPose>) => {
    out.q.fill(0);
    for (let i = 0; i < out.q.length; i += 4) out.q[i + 3] = 1;
    out.q[0] = Math.sin(t / 10);
    out.q[3] = Math.cos(t / 10);
    out.root = [0, -0.1, 0];
    out.aimL = out.aimR = null;
    out.bat = null;
    void c;
    return 3;
  };

  it('a one-shot is shifted so its marker lands on the built-in marker the choreography put on the physics event', () => {
    const throwClip = clip('fld_throw_over', false, 1.1, { release: 0.5 });
    expect(packTime('field_throw', clipMarker('field_throw', 'release'), throwClip)).toBeCloseTo(0.5, 12);
    expect(packTime('field_throw', 0.1, throwClip)).toBeCloseTo(0.5 - (clipMarker('field_throw', 'release') - 0.1), 12);
    // Loops keep their own time; a clip without the marker keeps the built-in time.
    expect(packTime('ready', 0.77, clip('fld_ready', true, 1.2))).toBe(0.77);
    expect(packTime('field_throw', 0.3, clip('fld_throw_over', false, 1))).toBe(0.3);
  });

  it('draws the pack clip for a substituted hold (packs on), and a hook made before the packs keeps the built-ins', () => {
    const b = BALLS.find((x) => x.key.endsWith('/leave'))!;
    const script = scriptOf(b);
    const rel = script.practice!.releaseScene;
    const tr = fieldTracks(script).find((a) => a.id !== 'keeper' && evaluateActor(a, rel + 40).current.clip === 'ready')!;
    const before = fieldPoseHook(script);
    try {
      setFieldPacks(true);
      registerFieldMotion({ clips: new Map([['fld_ready', clip('fld_ready', true, 1.4)]]), sample });
      const after = fieldPoseHook(script);
      const sc = createPoseScratch();
      const t = rel + 40;
      const st = evaluateActor(tr, t);
      const a = trackPoseAt(tr, t, sc);
      after(tr, a, t);
      const qa = new Float32Array(a.q);
      const p = trackPoseAt(tr, t, sc);
      before(tr, p, t);
      // The pack's hips rotation (lean and sway layers are added on top) differs from the built-in ready crouch's.
      expect(Math.abs(qa[0] - p.q[0])).toBeGreaterThan(1e-3);
      const st2 = evaluateActor(tr, t);
      expect(st2.current.time).toBeCloseTo(st.current.time, 9);
    } finally {
      registerFieldMotion(null);
      setFieldPacks(false);
    }
  });
});

describe('the default draws the built-in path until the packs measure no worse', () => {
  it('registered packs are not drawn while PLAN_OPTIONS.fieldPacks is off', () => {
    registerFieldMotion({ clips: new Map([['fld_ready', { name: 'fld_ready', loop: true, duration: 1.4, speedMps: 0, markers: {} }]]), sample: () => 3 });
    try {
      expect(fieldClips()).toBe(BUILTIN_FIELD_CLIPS);
    } finally {
      registerFieldMotion(null);
    }
  });
});
