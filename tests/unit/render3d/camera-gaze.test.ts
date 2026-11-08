/// <reference types="node" />
/**
 * The first-person gaze near the eye (F-012, owner option A3, 2026-11-03): the gain rule, the owner's comfort
 * condition (never a faster turn or a sharper change of turn than the gaze without A3, ball by ball) and determinism.
 * "Shipped" below is a frozen copy of the gaze integrator as it was before A3, used only as the reference.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BallFlight, DeliveryResult, Handedness, NormalizedSwing } from '@/contracts/practice';
import { GAZE, batterFov, cameraAt, gazeTrackWeight, practiceGaze, practicePlan } from '@/render3d/core/camera';
import { sampleBall, type BallScript } from '@/render3d/core/choreo';
import { ballDiameterPx } from '@/render3d/practice/ballLook';
import { simToScene } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';
import { evalOvers, overBalls, type EvalBall } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { resolveDelivery } from '@/physics/resolve';
import { batTravelMs } from '@/physics/bat';
import { autoField } from '@/physics/field';
import { flight as physicsFlight } from '@/physics/delivery';

import {
  DEG,
  type V,
  clamp,
  cross,
  dot,
  measures,
  productionGrid,
  shippedGaze,
  shippedTable,
  smooth,
  unit,
  windows,
} from './gazeReference';

interface Case {
  label: string;
  script: BallScript;
  flight: BallFlight;
}
const setupOf = (eb: EvalBall, hand: Handedness) => ({
  field: hand === 'right' ? eb.field : autoField(eb.over.bowler, eb.conditions, 'left', eb.over.ball),
  bowler: eb.over.bowler,
  conditions: eb.conditions,
  handedness: hand,
});

function referenceCases(): Case[] {
  const out: Case[] = [];
  const balls = overBalls(REFERENCE_OVER, 'balanced');
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
  // W0's safe swings on the reference over, and the drive 40 ms early and late.
  const safe = [null, drive(0), defend('auto'), defend('auto'), null, defend('forward')];
  for (const eb of balls) {
    const setup = setupOf(eb, 'right');
    out.push({
      label: `ref-${eb.ballIndex + 1} live`,
      script: buildPracticeScript({ setup, flight: eb.flight }),
      flight: eb.flight,
    });
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
      const result: DeliveryResult = resolveDelivery({
        flight: eb.flight,
        swing,
        field: eb.field,
        bowler: eb.over.bowler,
        conditions: eb.conditions,
        handedness: 'right',
        assist: 'play',
        tierToleranceMs: 0,
      });
      out.push({
        label: `ref-${eb.ballIndex + 1} ${tag}`,
        script: buildPracticeScript({ setup, flight: eb.flight, result }),
        flight: eb.flight,
      });
    }
  }
  return out;
}

/** 216 random deliveries: three difficulties, pace and spin, six overs each; every other over left-handed. */
function randomCases(): Case[] {
  const out: Case[] = [];
  let n = 0;
  for (const difficulty of ['beginner', 'club', 'expert'] as const) {
    for (const family of ['pace', 'spin'] as const) {
      evalOvers({ difficulty, overs: 6, key: `camera-gaze|${difficulty}|${family}`, family }).forEach((over, oi) =>
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
          let result: DeliveryResult | null = null;
          if (n % 6 === 0) {
            // A sixth with an attacking swing (seeded direction and timing), for the head-follow after contact.
            const swing: NormalizedSwing = {
              kind: 'attack',
              startT: fl.idealContactT - batTravelMs('attack', 0.7) / 1000 + (((n * 37) % 81) - 40) / 1000,
              directionDeg: ((n * 53) % 120) - 60,
              power: 0.7,
              elevation: 0,
              footwork: 'auto',
            };
            result = resolveDelivery({
              flight: fl,
              swing,
              field: setup.field,
              bowler: eb.over.bowler,
              conditions: eb.conditions,
              handedness: hand,
              assist: 'play',
              tierToleranceMs: 0,
            });
          }
          out.push({
            label: `${difficulty} ${family} over ${oi + 1} ball ${eb.ballIndex + 1} ${hand}${result ? ' swung' : ''}`,
            script: buildPracticeScript({ setup, flight: fl, result }),
            flight: fl,
          });
          n++;
        }),
      );
    }
  }
  return out;
}

const REFS = referenceCases();
const RANDOM = randomCases();

/** Production never above the frozen shipped gaze, measure by measure, window by window. */
function expectWithinShipped(c: Case) {
  const ref = shippedTable(c.script, false);
  for (const [w, end] of windows(c.script, ref)) {
    const s = measures(
      c.script,
      (t) => shippedGaze(ref, t),
      (i) => ({ yaw: ref.yaw[i], pitch: ref.pitch[i] }),
      ref.yaw.length,
      end,
    );
    const a = measures(
      c.script,
      (t) => practiceGaze(c.script, t, false),
      productionGrid(c.script, false),
      ref.yaw.length,
      end,
    );
    for (const k of Object.keys(s)) {
      // Where the shipped gaze itself became undefined (a ball sample that is not a number), the gaze must stay defined.
      if (!Number.isFinite(s[k]))
        expect(Number.isFinite(a[k]), `${c.label}, ${w}, ${k}: defined where shipped was not`).toBe(true);
      else expect(a[k], `${c.label}, ${w}, ${k}`).toBeLessThanOrEqual(s[k] * (1 + 1e-9) + 1e-9);
    }
  }
}

describe('the gaze near the eye (F-012, A3)', () => {
  it('names its constants: all the way (1.0) from 8 m to 2 m, and not under Reduced Motion', () => {
    expect(GAZE.closeGain).toBe(1);
    expect(GAZE.closeFarM).toBe(8);
    expect(GAZE.closeNearM).toBe(2);
    expect(GAZE.closeGainReduced).toBe(GAZE.trackGainReduced);
  });

  it('follows the gain rule: the shipped weight beyond 8 m, rising to all the way at 2 m, by distance only', () => {
    for (let d = 0; d <= 40; d += 0.01) {
      const shipped = GAZE.trackGain * smooth(GAZE.rampFarM, GAZE.rampNearM, d);
      const w = gazeTrackWeight(d, false);
      if (d >= GAZE.closeFarM) expect(w, `${d} m`).toBe(shipped);
      if (d <= GAZE.closeNearM) expect(w, `${d} m`).toBe(GAZE.closeGain);
      const expected =
        (GAZE.trackGain + (GAZE.closeGain - GAZE.trackGain) * smooth(GAZE.closeFarM, GAZE.closeNearM, d)) *
        smooth(GAZE.rampFarM, GAZE.rampNearM, d);
      expect(w, `${d} m`).toBeCloseTo(expected, 15);
      // Nearer never means less of the way.
      expect(gazeTrackWeight(Math.max(0, d - 0.01), false), `${d} m`).toBeGreaterThanOrEqual(w);
      // Reduced Motion keeps the shipped share exactly.
      expect(gazeTrackWeight(d, true), `${d} m`).toBe(GAZE.trackGainReduced * smooth(GAZE.rampFarM, GAZE.rampNearM, d));
    }
  });

  it('is the shipped gaze exactly until the ball first comes within 8 m, and the shipped gaze throughout under Reduced Motion', () => {
    for (const c of [...REFS, ...RANDOM.slice(0, 60)]) {
      const p = c.script.practice!;
      const ref = shippedTable(c.script, false);
      const refReduced = shippedTable(c.script, true);
      const grid = productionGrid(c.script, false);
      const gridReduced = productionGrid(c.script, true);
      let near = false;
      for (let i = 0; i < ref.yaw.length; i++) {
        const t = p.releaseScene + i * 4;
        let bx = 0;
        let by = 0;
        let bz = 0;
        for (let k = 0; k < 3; k++) {
          const s = sampleBall(c.script, t - 10 - k * 12).pos;
          bx += s.x;
          by += s.y;
          bz += s.z;
        }
        if (Math.hypot(bx / 3 - p.eye.x, by / 3 - p.eye.y, bz / 3 - p.eye.z) < GAZE.closeFarM) near = true;
        if (!Number.isFinite(refReduced.yaw[i]) || !Number.isFinite(ref.yaw[i])) break;
        const r = gridReduced(i);
        expect(Math.fround(r.yaw), `${c.label} reduced ${i}`).toBeCloseTo(refReduced.yaw[i], 6);
        expect(Math.fround(r.pitch), `${c.label} reduced ${i}`).toBeCloseTo(refReduced.pitch[i], 6);
        if (!near) {
          const a = grid(i);
          expect(Math.fround(a.yaw), `${c.label} ${i}`).toBeCloseTo(ref.yaw[i], 6);
          expect(Math.fround(a.pitch), `${c.label} ${i}`).toBeCloseTo(ref.pitch[i], 6);
        }
      }
      for (let t = p.releaseScene - 50; t < Math.min(c.script.duration, p.releaseScene + 3000); t += 7) {
        const a = practiceGaze(c.script, t, true);
        const b = shippedGaze(refReduced, t);
        if (![b.x, b.y, b.z].every(Number.isFinite)) break;
        expect(Math.acos(clamp(dot(a, b), -1, 1)) / DEG, `${c.label} reduced t=${t}`).toBeLessThan(1e-4);
      }
    }
  });

  it('never turns faster, or changes its turning more sharply, than the shipped gaze: reference over (W0 swings, ±40 ms drives)', () => {
    for (const c of REFS) expectWithinShipped(c);
  });

  it('never turns faster, or changes its turning more sharply, than the shipped gaze: 216 random deliveries', () => {
    expect(RANDOM.length).toBeGreaterThanOrEqual(200);
    for (const c of RANDOM) expectWithinShipped(c);
  });

  it('keeps the ball in the frame at least as long as the shipped gaze on the reference over, at four aspects', () => {
    let gain = 0;
    let n = 0;
    for (const c of REFS) {
      const p = c.script.practice!;
      const ideal = simToScene(p, c.flight.idealContactT);
      const ref = shippedTable(c.script, false);
      for (const [W, H] of [
        [915, 412],
        [844, 390],
        [640, 360],
        [1280, 720],
      ]) {
        const vfov = batterFov(W / H);
        const lastIn = (gaze: (t: number) => V) => {
          let last = -Infinity;
          for (let t = p.releaseScene; t <= ideal; t += 1) {
            const f = gaze(t);
            const r = unit(-f.z, 0, f.x);
            const u = cross(r, f);
            const b = sampleBall(c.script, t).pos;
            const v = { x: b.x - p.eye.x, y: b.y - p.eye.y, z: b.z - p.eye.z };
            const depth = dot(v, f);
            const ty = Math.tan((vfov * DEG) / 2);
            const sx = ((dot(v, r) / (depth * ty * (W / H)) + 1) / 2) * W;
            const sy = ((1 - dot(v, u) / (depth * ty)) / 2) * H;
            const rad = ballDiameterPx(depth, H / 2 / ty) / 2;
            if (depth > 0 && sx - rad >= 0 && sy - rad >= 0 && sx + rad <= W && sy + rad <= H) last = t;
          }
          return last;
        };
        const shipped = lastIn((t) => shippedGaze(ref, t));
        const a3 = lastIn((t) => practiceGaze(c.script, t, false));
        expect(a3, `${c.label} ${W}x${H}`).toBeGreaterThanOrEqual(shipped);
        gain += a3 - shipped;
        n++;
      }
    }
    // On average it holds the ball longer: the point of A3 (how much depends on the physics, so only the sign is fixed).
    expect(gain / n).toBeGreaterThan(0);
  });
});

describe('the gaze with bad input', () => {
  it('holds still, and stays defined, while the ball sample is not a number (the shipped gaze turned undefined)', () => {
    for (const reducedMotion of [false, true]) {
      const script = structuredClone(REFS[1].script) as BallScript;
      const p = script.practice!;
      const seg = script.ball.find((s) => s.k === 'path') as Extract<BallScript['ball'][number], { k: 'path' }>;
      for (const s of seg.samples) if (s.t >= 0.3 && s.t <= 0.35) s.p = { ...s.p, y: Number.NaN };
      const shipped = shippedTable(script, reducedMotion);
      expect(Array.from(shipped.yaw).some((y) => !Number.isFinite(y))).toBe(true);
      let held: V | null = null;
      for (let t = p.releaseScene - 20; t < Math.min(script.duration, p.releaseScene + 9000); t += 3) {
        const g = practiceGaze(script, t, reducedMotion);
        expect([g.x, g.y, g.z].every(Number.isFinite), `t=${t}`).toBe(true);
        // While every sample the eyes use is missing (t − 34 … t − 10 ms inside the gap), the view does not move.
        const rel = (t - p.releaseScene) / 1000;
        if (rel >= 0.3 + 0.034 + 0.004 && rel <= 0.35 + 0.01 - 0.004) {
          if (held) expect(Math.acos(clamp(dot(held, g), -1, 1)), `t=${t}`).toBeLessThan(1e-6);
          held = g;
        }
      }
      expect(held).not.toBeNull();
    }
  });
});

describe('the gaze is deterministic and presentation only', () => {
  it('gives the same direction at the same scene time, in any call order, and for an identical script built again', () => {
    for (const c of REFS.slice(0, 8)) {
      const p = c.script.practice!;
      const times = Array.from({ length: 400 }, (_, i) => p.releaseScene - 100 + i * 7.3);
      const forward = times.map((t) => practiceGaze(c.script, t, false));
      const backward = [...times]
        .reverse()
        .map((t) => practiceGaze(c.script, t, false))
        .reverse();
      // An identical script built from the same input (a cache miss: its own table).
      const again = buildPracticeScript({
        setup: setupOf(overBalls(REFERENCE_OVER, 'balanced')[0], 'right'),
        flight: c.flight,
        result: c.script.practice!.result,
      });
      const fresh = times.map((t) => practiceGaze(again, t, false));
      expect(backward).toEqual(forward);
      expect(fresh).toEqual(forward);
      const plan = practicePlan(c.script, false);
      for (const t of times.filter((_, i) => i % 20 === 0)) {
        for (const reducedMotion of [false, true]) {
          const ctx = { aspect: 915 / 412, reducedMotion };
          expect(cameraAt(again, t, practicePlan(again, reducedMotion), ctx)).toEqual(
            cameraAt(c.script, t, practicePlan(c.script, reducedMotion), ctx),
          );
        }
        expect(cameraAt(c.script, t, plan, { aspect: 915 / 412, reducedMotion: false })).toEqual(
          cameraAt(c.script, t, plan, { aspect: 915 / 412, reducedMotion: false }),
        );
      }
    }
  });

  it('reads the script without changing it, and the physics result is the same whether or not the gaze ran', () => {
    const eb = overBalls(REFERENCE_OVER, 'balanced')[1];
    const swing: NormalizedSwing = {
      kind: 'attack',
      startT: eb.flight.idealContactT - batTravelMs('attack', 0.7) / 1000,
      directionDeg: 55,
      power: 0.7,
      elevation: 0,
      footwork: 'forward',
    };
    const args = {
      flight: eb.flight,
      swing,
      field: eb.field,
      bowler: eb.over.bowler,
      conditions: eb.conditions,
      handedness: 'right' as const,
      assist: 'play' as const,
      tierToleranceMs: 0,
    };
    const before = JSON.stringify(resolveDelivery(args));
    const script = buildPracticeScript({
      setup: setupOf(eb, 'right'),
      flight: eb.flight,
      result: resolveDelivery(args),
    });
    const snapshot = JSON.stringify(script);
    for (let t = 0; t < script.duration; t += 5) {
      practiceGaze(script, t, false);
      practiceGaze(script, t, true);
    }
    expect(JSON.stringify(script)).toBe(snapshot);
    expect(JSON.stringify(resolveDelivery(args))).toBe(before);
  });

  it('is never imported by the physics, the game rules or the input (no camera state can reach an outcome)', () => {
    const root = join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    for (const dir of ['physics', 'practice/game', 'input']) walk(join(root, dir));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/(from\s+|import\()\s*['"][^'"]*render3d/);
  });
});
