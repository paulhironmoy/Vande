/**
 * Does the web's rigid bat blend (bat.ts `rigidBatBlend`: the hands travel straight, the bat turns about them by a
 * quaternion slerp that takes the SHORTER way) flip the way UNITY-3 found Unity's did? There, when the waiting and the
 * hitting bat frames were 180 degrees apart the blend turned the other way round and the toe jumped 1.1 m in 4 ms.
 *
 * The web has the same arithmetic. This test shows what it is exposed to (PERF-2, 2026-11-07; nothing in bat.ts changed):
 *  - the hazard itself, on two bats 179 and 181 degrees apart;
 *  - the presented waiting bat (grounded stance, the backlift, the compact top, first person's carry of it): never more
 *    than ~105 degrees from any hitting pose, so 75 degrees from a flip;
 *  - the waiting bat of the external views, the batter pack's own clip bat (`clipBatPose`), against the physics swing
 *    it closes on over the input-to-contact window: up to ~159 degrees today (right-handers; left-handers 146), so a
 *    roll of the waiting bat about its blade of as little as ~21 degrees the unfavourable way WOULD flip it. Not exposed
 *    today (the corpus never reaches 180); the margin is what is reported, and what this test pins from below.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BallFlight, DeliveryResult, Footwork, Handedness, NormalizedSwing } from '@/contracts/practice';
import { evaluateActor, lookScale } from '@/render3d/core/actors';
import type { BatPose } from '@/render3d/practice/frame';
import { simToScene } from '@/render3d/practice/frame';
import { BACKLIFT_TOP, FIRST_PERSON_READY, PROVISIONAL_TRAVEL_MS, STANCE_GROUNDED, batPoseAt, clipBatPose, provisionalPose, reachable, rigidBatBlend, visibleSwingStart } from '@/render3d/practice/bat';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { evalOvers, overBalls, type EvalBall } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { batTravelMs } from '@/physics/bat';
import { autoField } from '@/physics/field';
import { flight as physicsFlight } from '@/physics/delivery';
import { resolveDelivery } from '@/physics/resolve';

type V = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): V => ({ x, y, z });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a: V): V => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v(a.x / l, a.y / l, a.z / l);
};

type Q = [number, number, number, number];
/** The bat's orientation as bat.ts batQuat has it (a reference copy: the blade direction and the face as a rotation matrix). */
function quat(p: BatPose): Q {
  const a = norm(v(p.toe.x - p.grip.x, p.toe.y - p.grip.y, p.toe.z - p.grip.z));
  const b = norm(v(p.face.x - a.x * dot(p.face, a), p.face.y - a.y * dot(p.face, a), p.face.z - a.z * dot(p.face, a)));
  const c = cross(a, b);
  const m00 = a.x, m01 = b.x, m02 = c.x, m10 = a.y, m11 = b.y, m12 = c.y, m20 = a.z, m21 = b.z, m22 = c.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
/** The rotation between two bats (degrees, 0..180: the shorter way, which is the way the slerp takes). */
const angleDeg = (a: BatPose, b: BatPose) => {
  const p = quat(a);
  const q = quat(b);
  return (2 * Math.acos(Math.min(1, Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]))) * 180) / Math.PI;
};
/** The bat rolled about its own blade by `deg` (the grip and the toe stay; the face turns). */
function rolled(p: BatPose, deg: number): BatPose {
  const a = norm(v(p.toe.x - p.grip.x, p.toe.y - p.grip.y, p.toe.z - p.grip.z));
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const x = cross(a, p.face);
  return { grip: p.grip, toe: p.toe, face: v(p.face.x * c + x.x * s, p.face.y * c + x.y * s, p.face.z * c + x.z * s) };
}
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

let lib: typeof import('@/render3d/core/motion/library');
beforeAll(async () => {
  lib = await import('@/render3d/core/motion/library');
  const { readFile } = await import('node:fs/promises');
  lib.resetMotionLibrary();
  await lib.loadMotionPacks('/practice/motion/', async (url) => {
    try {
      const b = await readFile(`public/practice/motion/${url.split('/').pop()}`);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  });
  lib.commitMotion();
});
afterAll(() => lib.resetMotionLibrary());

describe('the shortest-way rigid bat blend (UNITY-3), as the web has it', () => {
  it('flips when the two bats are 180 degrees apart: the toe jumps by more than a metre between 179 and 181 degrees', () => {
    const a = STANCE_GROUNDED;
    // The same bat turned about the horizontal axis through its grip, across the blade, by 179 and by 181 degrees.
    const turnedBy = (deg: number): BatPose => {
      const c = Math.cos((deg * Math.PI) / 180);
      const s = Math.sin((deg * Math.PI) / 180);
      const about = (p: V): V => v(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
      const t = about(v(a.toe.x - a.grip.x, a.toe.y - a.grip.y, a.toe.z - a.grip.z));
      return { grip: a.grip, toe: v(a.grip.x + t.x, a.grip.y + t.y, a.grip.z + t.z), face: about(a.face) };
    };
    const at = (deg: number) => rigidBatBlend(a, turnedBy(deg), 0.5).toe;
    // Both are 179 degrees apart the short way round: 181 forwards is 179 backwards, and the blend turns that way.
    expect(angleDeg(a, turnedBy(179))).toBeCloseTo(179, 1);
    expect(angleDeg(a, turnedBy(181))).toBeCloseTo(179, 1);
    expect(dist(at(179), at(181)), 'toe jump across the flip (m)').toBeGreaterThan(1);
    // Away from 180 it is continuous.
    expect(dist(at(120), at(122)), 'toe step 2 degrees apart, away from the flip (m)').toBeLessThan(0.1);
  });

  it('the presented waiting bat (grounded, backlift, top, first person) is never within 60 degrees of a flip from any hitting pose', () => {
    const waits: BatPose[] = [STANCE_GROUNDED, BACKLIFT_TOP, FIRST_PERSON_READY];
    for (let lift = 0; lift <= 1; lift += 0.125) waits.push(rigidBatBlend(STANCE_GROUNDED, BACKLIFT_TOP, lift));
    let worst = 0;
    for (const w of waits)
      for (let bearing = -60; bearing <= 60; bearing += 15)
        for (const elevationIntent of [0, 0.5, 1])
          for (const bx of [-0.2, 0.3, 0.9])
            for (const by of [0.1, 0.7, 1.3])
              for (const bz of [7.4, 8.2, 9.0]) {
                const state = { forwardBearingDeg: bearing, elevationIntent, pathPower: 0.5, pullbackIntent: 0, lateralAdjustment: 0 } as never;
                worst = Math.max(worst, angleDeg(w, provisionalPose(PROVISIONAL_TRAVEL_MS, reachable(v(bx, by, bz)), state)));
              }
    // The compact backlift top is the furthest: about 105 degrees.
    expect(worst, `largest rotation from a presented waiting bat to a hitting pose: ${worst.toFixed(1)} deg`).toBeLessThan(120);
    expect(worst).toBeGreaterThan(100);
  });

  const setupOf = (eb: EvalBall, hand: Handedness): PracticeSceneSetup => ({ field: hand === 'right' ? eb.field : autoField(eb.over.bowler, eb.conditions, 'left', eb.over.ball), bowler: eb.over.bowler, conditions: eb.conditions, handedness: hand });

  it("the external views' waiting bat, the pack clip's own, against the physics swing it closes on: not flipped, and how far a roll it would take", () => {
    const footworks: Footwork[] = ['auto', 'forward', 'back', 'across', 'down_track'];
    let k = 0;
    const found: Array<{ hand: Handedness; from: BatPose; targets: BatPose[]; max: number }> = [];
    const add = (eb: EvalBall, hand: Handedness, fl: BallFlight) => {
      const n = k++;
      const kind = n % 3 === 0 ? 'attack' : 'defend';
      const power = kind === 'attack' ? 0.35 + ((n * 17) % 60) / 100 : 0.2;
      const swing: NormalizedSwing = { kind, startT: fl.idealContactT - batTravelMs(kind, power) / 1000 + (((n * 37) % 161) - 80) / 1000, directionDeg: ((n * 53) % 140) - 70, power, elevation: (n % 5) / 8, footwork: footworks[n % 5] };
      const setup = setupOf(eb, hand);
      const result: DeliveryResult = resolveDelivery({ flight: fl, swing, field: setup.field, bowler: eb.over.bowler, conditions: eb.conditions, handedness: hand, assist: 'play', tierToleranceMs: 0 });
      const releaseScene = buildPracticeScript({ setup, flight: fl }).practice!.releaseScene;
      const press = simToScene({ releaseScene }, swing.startT);
      const script = buildPracticeScript({ setup, flight: fl, result, provisionalStart: press, resultAt: press + 40 });
      const bat = script.practice!.bat;
      const striker = script.actors.find((a) => a.id === 'striker')!;
      const start = visibleSwingStart(bat);
      if (start === null || !evaluateActor(striker, start - 1).current.clip.startsWith('vmp:bat_')) return;
      const from = clipBatPose(striker, start - 1, lookScale(striker.look));
      if (!from) return;
      const end = bat.contactScene ?? bat.velocityPeakScene ?? start + 200;
      const targets: BatPose[] = [];
      for (let s = start; s <= end; s += 2) targets.push(batPoseAt(bat, Math.max(s, releaseScene + (bat.samples?.[0]?.t ?? 0) * 1000)));
      found.push({ hand, from, targets, max: Math.max(...targets.map((t) => angleDeg(from, t))) });
    };
    for (const eb of overBalls(REFERENCE_OVER, 'balanced')) for (let i = 0; i < 6; i++) add(eb, 'right', eb.flight);
    for (const difficulty of ['beginner', 'expert'] as const)
      for (const family of ['pace', 'spin'] as const)
        evalOvers({ difficulty, overs: 4, key: `blend2|${difficulty}|${family}`, family }).forEach((over, oi) =>
          over.forEach((eb) => {
            const hand: Handedness = oi % 2 === 1 ? 'left' : 'right';
            const fl = hand === 'right' ? eb.flight : physicsFlight({ plan: eb.over.balls[eb.ballIndex], bowler: eb.over.bowler, conditions: eb.conditions, seed: eb.seed, ball: eb.over.ball, handedness: 'left' });
            for (let i = 0; i < 3; i++) add(eb, hand, fl);
          }),
        );
    expect(found.length).toBeGreaterThan(100);
    expect(found.some((f) => f.hand === 'left')).toBe(true);
    const worst = found.reduce((a, b) => (b.max > a.max ? b : a));
    // Not flipped today: no frame of any closing window reaches 180 degrees (the angle, the shorter way, stays clear of it).
    expect(worst.max, `largest rotation between the clip's waiting bat and the swing it closes on: ${worst.max.toFixed(1)} deg`).toBeLessThan(175);
    // How far the waiting bat would have to roll about its blade, either way, for some frame to come within a degree of 180.
    const flipRoll = (f: (typeof found)[number]) => {
      for (let deg = 1; deg <= 180; deg++) for (const sign of [1, -1]) if (f.targets.some((t) => angleDeg(rolled(f.from, sign * deg), t) > 179)) return sign * deg;
      return Number.POSITIVE_INFINITY;
    };
    const tightest = found.map((f) => ({ f, roll: flipRoll(f) })).reduce((a, b) => (Math.abs(b.roll) < Math.abs(a.roll) ? b : a));
    const margin = tightest.roll;
    // About 21 degrees in the tightest case: a re-authored face hint of that much, the unfavourable way, would flip the blend.
    expect(Math.abs(margin), `the pack clip's waiting bat would flip with a roll of ${margin} deg`).toBeGreaterThanOrEqual(10);
    expect(Math.abs(margin)).toBeLessThanOrEqual(40);
    // And when it flips, the blend's toe jumps: the same swing frame with the waiting bat rolled to either side of the flip.
    let top = { roll: margin, angle: 0, frame: tightest.f.targets[0] };
    for (let roll = margin - 1; roll <= margin + 1; roll += 0.01) for (const t of tightest.f.targets) {
      const angle = angleDeg(rolled(tightest.f.from, roll), t);
      if (angle > top.angle) top = { roll, angle, frame: t };
    }
    expect(top.angle).toBeGreaterThan(179.9);
    const before = rigidBatBlend(rolled(tightest.f.from, top.roll - 0.3), top.frame, 0.5).toe;
    const after = rigidBatBlend(rolled(tightest.f.from, top.roll + 0.3), top.frame, 0.5).toe;
    expect(dist(before, after), 'toe jump for 0.6 degrees of roll across the flip (m)').toBeGreaterThan(0.3);
  }, 240_000);
});
