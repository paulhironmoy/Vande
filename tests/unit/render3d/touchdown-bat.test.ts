/**
 * The touch-down stroke (owner decision 2026-11-04, CTL1: the bat starts moving at touch-down, and the shot commits on
 * lift; bat.ts TOUCHDOWN). Presentation only, live only. It must:
 *   - never move the bat before the touch, and move it in the first frame after;
 *   - while uncommitted, never bring the bat nearer the ball than the bat with no input at all, unless TOUCHDOWN.clearM
 *     (0.15 m) clear, with the guard looking 120 ms ahead along the ball's flight so the bat draws back instead of snapping;
 *   - check a press that outlives the tap window back to the no-input bat (a held press never draws a shot);
 *   - for a tap, keep the physics swing's start and be the physics bat from contact on.
 */
import { describe, expect, it } from 'vitest';
import type { BowlerProfile, NormalizedSwing, PracticeDeliveryPlan, Vec3 } from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { TAP_HOLD_MS } from '@/input';
import { TOUCHDOWN, batMoved, batPoseAt, firstPersonBatPose, presentedBatPose, touchdownTravel, type BatTrack } from '@/render3d/practice/bat';
import { ballAt, simToScene, toWorld } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'touchdown-pace' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'touchdown-spin' };
const setupOf = (bowler: BowlerProfile) => ({ field: autoField(bowler, 'balanced', 'right'), bowler, conditions: 'balanced' as const, handedness: 'right' as const });

function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ap = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
  const u = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / (ab.x * ab.x + ab.y * ab.y + ab.z * ab.z)));
  return Math.hypot(ap.x - ab.x * u, ap.y - ab.y * u, ap.z - ab.z * u);
}

describe('the touch-down stroke', () => {
  it('soft-caps the uncommitted travel: real time at first, never past capMs', () => {
    expect(touchdownTravel(0)).toBe(0);
    expect(touchdownTravel(4)).toBeGreaterThan(3.9);
    for (let ms = 1; ms < 2000; ms += 7) {
      expect(touchdownTravel(ms)).toBeLessThanOrEqual(TOUCHDOWN.capMs);
      expect(touchdownTravel(ms)).toBeLessThanOrEqual(ms);
      expect(touchdownTravel(ms + 1)).toBeGreaterThanOrEqual(touchdownTravel(ms));
    }
  });

  it('never moves before the touch, moves in the first frame after it, and checks a held press back to the no-input bat', () => {
    const fl = flight({ plan: { variation: 'stock', lengthM: 5, lineM: 0.1, speedKph: 136 }, bowler: PACE, conditions: 'balanced', seed: 'touchdown:held', handedness: 'right' });
    const base = buildPracticeScript({ setup: setupOf(PACE), flight: fl }).practice!.bat;
    for (const e of [-400, -200, -60, 0]) {
      const press = simToScene(base, fl.idealContactT) + e;
      const track: BatTrack = { ...base, touch: { start: press, end: press + TAP_HOLD_MS, commitAt: null, state: null } };
      for (const s of [press - 40, press - 1, press]) {
        expect(firstPersonBatPose(track, s)).toEqual(firstPersonBatPose(base, s));
        expect(presentedBatPose(track, s)).toEqual(presentedBatPose(base, s));
      }
      expect(batMoved(track, press + 4)).toBe(true);
      expect(batMoved(base, press + 4)).toBe(false);
      for (const s of [press + TAP_HOLD_MS + TOUCHDOWN.checkMs, press + 600]) {
        expect(firstPersonBatPose(track, s)).toEqual(firstPersonBatPose(base, s));
        expect(batMoved(track, s)).toBe(false);
      }
    }
  });

  it('while uncommitted, never brings the bat nearer the ball than the bat with no input, or keeps TOUCHDOWN.clearM (presented and first person)', () => {
    const LEFT: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'touchdown-left' };
    let checked = 0;
    let guarded = 0;
    for (const hand of ['right', 'left'] as const)
      for (const bowler of [PACE, SPIN, LEFT])
        for (const lengthM of [0.5, 2, 4, 6, 8, 11])
          for (const lineM of [-0.5, 0.1, 0.6]) {
            const speedKph = bowler.family === 'spin' ? 86 : lengthM >= 8 ? 120 : 145;
            const plan: PracticeDeliveryPlan = { variation: 'stock', lengthM, lineM, speedKph };
            const fl = flight({ plan, bowler, conditions: 'balanced', seed: `touchdown:${hand}:${bowler.lookSeed}:${lengthM}:${lineM}`, handedness: hand });
            const base = buildPracticeScript({ setup: { ...setupOf(bowler), field: autoField(bowler, 'balanced', hand), handedness: hand }, flight: fl }).practice!.bat;
            const ideal = simToScene(base, fl.idealContactT);
            for (let e = -500; e <= 100; e += 50) {
              const press = ideal + e;
              const open = { start: press, end: press + TAP_HOLD_MS, commitAt: null, state: null };
              const track: BatTrack = { ...base, touch: { ...open, ball: fl.samples } };
              const unguarded: BatTrack = { ...base, touch: open };
              for (let s = press; s <= press + 500; s += 8) {
                const b = ballAt(fl.samples, (s - base.releaseScene) / 1000);
                if (!b) continue;
                const ball = toWorld(b, base.mirror);
                for (const [drawName, draw] of [
                  ['presented', presentedBatPose],
                  ['first-person', firstPersonBatPose],
                ] as const) {
                  const p = draw(track, s);
                  const q = draw(base, s);
                  const d = segDist(ball, p.grip, p.toe);
                  const d0 = segDist(ball, q.grip, q.toe);
                  checked++;
                  expect(d, `${drawName}: ${hand} ${bowler.lookSeed} ${lengthM} m line ${lineM}: press ${e} ms, scene +${s - press}`).toBeGreaterThanOrEqual(Math.min(d0, TOUCHDOWN.clearM) - 1e-6);
                  const u = draw(unguarded, s);
                  if (segDist(ball, u.grip, u.toe) < Math.min(d0, TOUCHDOWN.clearM) - 1e-6) guarded++;
                }
              }
            }
          }
    expect(checked).toBeGreaterThan(100_000);
    // The guard is needed: without the ball the capped stroke alone breaks the rule on short balls.
    expect(guarded).toBeGreaterThan(0);
  });

  it('the clearance guard leaves an ordinary stroke untouched, and the bat still moves at once', () => {
    const fl = flight({ plan: { variation: 'stock', lengthM: 5, lineM: 0.1, speedKph: 136 }, bowler: PACE, conditions: 'balanced', seed: 'touchdown:untouched', handedness: 'right' });
    const base = buildPracticeScript({ setup: setupOf(PACE), flight: fl }).practice!.bat;
    const press = simToScene(base, fl.idealContactT) - 300;
    const open = { start: press, end: press + TAP_HOLD_MS, commitAt: null, state: null };
    for (let s = press; s <= press + 120; s += 4) {
      expect(firstPersonBatPose({ ...base, touch: { ...open, ball: fl.samples } }, s)).toEqual(firstPersonBatPose({ ...base, touch: open }, s));
    }
    expect(batMoved({ ...base, touch: { ...open, ball: fl.samples } }, press + 4)).toBe(true);
  });

  it('checks and rejoins around close balls without an endpoint pop', () => {
    const LEFT: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'l3' };
    const cases: Array<{ hand: 'right' | 'left'; bowler: BowlerProfile; lengthM: number; lineM: number; speedKph: number; errorMs: number }> = [
      // The worst transition in the permanent 2.57M-sample sweep when this regression was fixed.
      { hand: 'left', bowler: { ...SPIN, lookSeed: 's3' }, lengthM: 11, lineM: -0.2, speedKph: 78, errorMs: -375 },
      // A fast short ball that previously jumped at the tap-window/check-back boundary.
      { hand: 'right', bowler: { ...PACE, lookSeed: 'p3' }, lengthM: 11, lineM: -0.2, speedKph: 150, errorMs: -250 },
      // The opposite hand and arm, where the guard previously jumped as the ball passed the bat.
      { hand: 'left', bowler: LEFT, lengthM: 9, lineM: 0.4, speedKph: 150, errorMs: -200 },
    ];
    const endpointStep = (a: { grip: Vec3; toe: Vec3 }, b: { grip: Vec3; toe: Vec3 }) =>
      Math.max(Math.hypot(a.grip.x - b.grip.x, a.grip.y - b.grip.y, a.grip.z - b.grip.z), Math.hypot(a.toe.x - b.toe.x, a.toe.y - b.toe.y, a.toe.z - b.toe.z));
    for (const c of cases) {
      const fl = flight({ plan: { variation: 'stock', lengthM: c.lengthM, lineM: c.lineM, speedKph: c.speedKph }, bowler: c.bowler, conditions: 'balanced', seed: `w:${c.hand}:${c.bowler.lookSeed}:${c.lengthM}:${c.lineM}:${c.speedKph}`, handedness: c.hand });
      const setup = { ...setupOf(c.bowler), field: autoField(c.bowler, 'balanced', c.hand), handedness: c.hand };
      const base = buildPracticeScript({ setup, flight: fl }).practice!.bat;
      const press = simToScene(base, fl.idealContactT) + c.errorMs;
      const track: BatTrack = { ...base, touch: { start: press, end: press + TAP_HOLD_MS, commitAt: null, state: null, ball: fl.samples } };
      let previous = firstPersonBatPose(track, press);
      let max = 0;
      for (let scene = press + 4; scene <= press + 500; scene += 4) {
        const current = firstPersonBatPose(track, scene);
        max = Math.max(max, endpointStep(previous, current));
        previous = current;
      }
      expect(max, `${c.hand} ${c.bowler.lookSeed} L${c.lengthM} line ${c.lineM} ${c.speedKph} kph`).toBeLessThanOrEqual(0.08);
    }
  });

  it('a tap keeps the physics start and is the physics bat from contact on, joining it without a pop on ordinary taps', () => {
    for (const hold of [16, 40, 60, 80]) {
      for (const errMs of [-40, 0, 20]) {
        const fl = flight({ plan: { variation: 'stock', lengthM: 6, lineM: 0.1, speedKph: 136 }, bowler: PACE, conditions: 'balanced', seed: `touchdown:tap:${hold}:${errMs}`, handedness: 'right' });
        const setup = setupOf(PACE);
        const startT = fl.idealContactT - batTravelMs('defend', 0.2) / 1000 + errMs / 1000;
        const swing: NormalizedSwing = { kind: 'defend', startT, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'auto' };
        const result = resolveDelivery({ flight: fl, swing, field: setup.field, bowler: PACE, conditions: 'balanced', handedness: 'right', assist: 'real', tierToleranceMs: 0 });
        const pre = buildPracticeScript({ setup, flight: fl }).practice!.bat;
        const press = simToScene(pre, startT);
        const lift = press + hold;
        const resultAt = lift + 8;
        const open = { start: press, end: press + TAP_HOLD_MS, commitAt: null, state: null };
        const committed = { ...open, commitAt: lift };
        const live = buildPracticeScript({ setup, flight: fl, result, provisionalStart: press, resultAt }).practice!.bat;
        const tracks = { pre: { ...pre, touch: open } as BatTrack, commit: { ...pre, provisionalStart: press, touch: committed } as BatTrack, result: { ...live, touch: committed } as BatTrack };
        const at = (s: number) => (s < lift ? tracks.pre : s < resultAt ? tracks.commit : tracks.result);
        const label = `hold ${hold} err ${errMs}`;
        // The physics swing starts where the stroke started (calibration 0 here): the tap is never retimed.
        expect(simToScene(live, result.swing!.startT), label).toBeCloseTo(press, 6);
        const end = live.contactScene ?? live.velocityPeakScene;
        expect(end, label).not.toBeNull();
        expect(firstPersonBatPose(tracks.result, end!), label).toEqual(batPoseAt(live, end!));
        expect(presentedBatPose(tracks.result, end!), label).toEqual(batPoseAt(live, end!));
        // Ordinary taps (lifted well before contact) join the swing smoothly: hands under 50 m/s at 4 ms steps.
        if (end! - lift >= TOUCHDOWN.commitMs) {
          let speed = 0;
          for (let s = press; s < end!; s += 4) {
            const a = firstPersonBatPose(at(s), s);
            const b = firstPersonBatPose(at(s + 4), s + 4);
            const h = (x: { grip: Vec3; toe: Vec3 }) => ({ x: x.grip.x * 0.75 + x.toe.x * 0.25, y: x.grip.y * 0.75 + x.toe.y * 0.25, z: x.grip.z * 0.75 + x.toe.z * 0.25 });
            const ha = h(a);
            const hb = h(b);
            speed = Math.max(speed, Math.hypot(ha.x - hb.x, ha.y - hb.y, ha.z - hb.z) / 0.004);
          }
          expect(speed, label).toBeLessThan(50);
        }
      }
    }
  });
});
