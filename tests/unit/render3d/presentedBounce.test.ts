/**
 * COH4 (EVAL-PHYS 2026-11-03): a ball met by the bat (or the batter) before it pitches must not sound, mark or spin-change
 * at the unimpeded flight's bounce. On build 38924bd+89c84e6d1a7e the physics result still listed that bounce after the
 * contact (src/physics/resolve.ts); PHYS2 phase 5e drops it there. The presentation independently keeps only a bounce
 * the presented ball actually makes, so these tests feed it results in the old form (`withFlightBounce`) as well.
 */
import { describe, expect, it } from 'vitest';
import type { DeliveryResult } from '@/contracts/practice';
import { autoField, resolveDelivery } from '@/physics/index';
import { flight as physicsFlight } from '@/physics/index';
import { overBalls, swingOf } from '@/practice/game/evaluate';
import { ballSeed, randomOver } from '@/practice/game/index';
import { REFERENCE_CONDITIONS, REFERENCE_OVER } from '@/practice/game/reference';
import { sampleBall, type BallScript } from '@/render3d/core/choreo';
import { buildDiagnostics } from '@/render3d/practice/diagnostics';
import { feedbackCues, presentedBounce, sceneEventsOf } from '@/render3d/practice/feedback';
import { ballAt, simToScene, toWorld } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';

const COVER_DRIVE = { kind: 'attack', directionDeg: 50, elevation: 0.05, power: 0.7, footwork: 'auto' } as const;

/** The result in the form build 38924bd+89c84e6d1a7e gave it: the flight's planned bounce always listed. */
function withFlightBounce(r: DeliveryResult): DeliveryResult {
  const b = r.flight.bounce;
  if (!b || r.events.some((e) => e.kind === 'bounce')) return r;
  return { ...r, events: [...r.events, { t: b.t, kind: 'bounce' as const, p: b.p }].sort((x, y) => x.t - y.t) };
}

function referenceBall(
  index: number,
  handedness: 'right' | 'left',
  intent: Parameters<typeof swingOf>[1],
  errorMs = 0,
) {
  const b = overBalls(REFERENCE_OVER, REFERENCE_CONDITIONS)[index];
  const field = autoField(b.over.bowler, b.conditions, handedness, b.over.ball);
  const flight = physicsFlight({
    plan: b.flight.plan,
    bowler: b.over.bowler,
    conditions: b.conditions,
    seed: b.seed,
    handedness,
    ball: b.over.ball,
  });
  const swing = swingOf({ ...b, flight }, intent, errorMs);
  const physics = resolveDelivery({
    flight,
    swing,
    field,
    bowler: b.over.bowler,
    conditions: b.conditions,
    handedness,
    assist: 'real',
    tierToleranceMs: 0,
  });
  const result = withFlightBounce(physics);
  const setup: PracticeSceneSetup = { field, bowler: b.over.bowler, conditions: b.conditions, handedness };
  return { result, physics, setup, mirror: handedness === 'left' };
}

const touchedFirst = (r: DeliveryResult) =>
  r.events.find((e) => (e.kind === 'contact' && e.contact !== 'miss' && e.contact !== 'leave') || e.kind === 'pad');

describe('COH4: no phantom bounce after the ball is met on the full', () => {
  it('reproduces the evaluator case: ref-6 cover drive on time at Real, contact 0.459 s, flight bounce 0.485 s at z 9.16', () => {
    const { result } = referenceBall(5, 'right', COVER_DRIVE);
    const touch = touchedFirst(result)!;
    const bounce = result.events.find((e) => e.kind === 'bounce')!;
    expect(touch.t).toBeCloseTo(0.4593, 3);
    expect(bounce.t).toBeCloseTo(0.4851, 3);
    expect('p' in bounce && bounce.p.z).toBeCloseTo(9.16, 2);
    // The result (in the evaluated build's form) carries the unimpeded flight's bounce after the contact.
    expect(bounce.t).toBeGreaterThan(touch.t);
    const p = (bounce as { p: { x: number; y: number; z: number } }).p;
    const drawn = ballAt(result.ball, bounce.t)!;
    expect(Math.hypot(drawn.x - p.x, drawn.y - p.y, drawn.z - p.z)).toBeGreaterThan(0.3);
  });

  for (const handedness of ['right', 'left'] as const) {
    it(`plays no bounce cue, mark or sound for it (${handedness}-handed), and keeps the contact cue`, () => {
      const { result, setup, mirror } = referenceBall(5, handedness, COVER_DRIVE);
      const bounce = result.events.find((e) => e.kind === 'bounce')!;
      expect(presentedBounce(result, bounce)).toBe(false);
      const script = buildPracticeScript({ setup, flight: result.flight, result });
      const releaseScene = script.practice!.releaseScene;
      const cues = feedbackCues(result, releaseScene, mirror);
      expect(cues.some((c) => c.scene?.kind === 'bounce')).toBe(false);
      expect(sceneEventsOf(cues).some((e) => e.kind === 'bounce')).toBe(false);
      // The script's own event list (the 3D scuff, the 2D mark and the session's sounds read it) has no bounce either.
      expect(script.events.some((e) => e.kind === 'bounce')).toBe(false);
      expect(script.practice!.cues.some((c) => c.scene?.kind === 'bounce')).toBe(false);
      // The contact is still felt at the physics contact.
      const contact = cues.find((c) => c.scene?.kind === 'bat' || c.scene?.kind === 'edge')!;
      expect(contact.t).toBeCloseTo(simToScene({ releaseScene }, result.contact.t!), 6);
      // The drawn ball never changes its spin at the phantom bounce. Held-ball ruling 2026-11-04: between a fielder's or
      // the keeper's take and the throw the ball is drawn in the hand (script.ts holdBallInHands), so the physics path
      // is split around the hold; every piece must keep the release segment's spin, unchanged across the split.
      const paths = script.ball.filter((s): s is Extract<BallScript['ball'][number], { k: 'path' }> => s.k === 'path');
      expect(paths.length).toBeGreaterThan(0);
      const first = paths[0];
      expect(first.t0).toBe(releaseScene);
      for (const seg of paths) {
        expect(seg.spinOrigin).toBe(first.spinOrigin);
        expect(seg.spinRate).toBe(first.spinRate);
        expect(seg.spinAxis).toEqual(first.spinAxis);
      }
      const holds = script.ball.filter(
        (s): s is Extract<BallScript['ball'][number], { k: 'hand' }> => s.k === 'hand' && s.t0 >= releaseScene,
      );
      const held = (scene: number) => holds.some((h) => scene >= h.t0 && scene < h.t1);
      // Outside the holds, the ball is drawn on the physics samples (the presented trajectory).
      let onPath = 0;
      for (let t = result.ball[0].t; t <= result.ball.at(-1)!.t; t += 1 / 60) {
        const scene = simToScene({ releaseScene }, t);
        if (held(scene)) continue;
        onPath++;
        const d = sampleBall(script, scene).pos;
        const w = toWorld(ballAt(result.ball, t)!, mirror);
        expect(Math.hypot(d.x - w.x, d.y - w.y, d.z - w.z)).toBeLessThan(1e-6);
      }
      expect(onPath).toBeGreaterThan(30);
      // Inside each hold: in the holder's hand, leaving the path at exactly the physics take position and rejoining it
      // within 1 cm of the physics release point (the throw).
      const handOf = (actor: string) => {
        const track = script.actors.find((a) => a.id === actor);
        return track ? { x: track.start.x + 0.11, y: 1.07, z: track.start.z - 0.13 } : null;
      };
      const physicsAt = (scene: number) => toWorld(ballAt(result.ball, (scene - releaseScene) / 1000)!, mirror);
      const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      for (const h of holds) {
        expect(script.actors.some((a) => a.id === h.actor)).toBe(true);
        expect(h.path).toBeDefined();
        const ph = h.path!;
        const start = sampleBall(script, h.t0, handOf);
        expect(start.heldBy).toBe(h.actor);
        expect(dist(start.pos, physicsAt(h.t0))).toBeLessThanOrEqual(1e-6);
        for (let scene = h.t0 + ph.inMs; scene <= h.t1 - ph.outMs - 1; scene += 16) {
          const b = sampleBall(script, scene, handOf);
          expect(b.heldBy).toBe(h.actor);
          expect(dist(b.pos, handOf(h.actor)!)).toBeLessThan(1e-9);
        }
        const throwEvent = result.events.find(
          (e) => e.kind === 'throw' && Math.abs(simToScene({ releaseScene }, e.t) - h.t1) < 1e-6,
        );
        if (throwEvent) {
          const end = sampleBall(script, h.t1 - 0.5, handOf);
          expect(dist(end.pos, physicsAt(h.t1))).toBeLessThan(0.01);
        }
      }
    });
  }

  it('keeps every genuine bounce: at the physics point, with its cue, mark and spin change, for every reference ball', () => {
    let genuine = 0;
    let phantom = 0;
    for (let i = 0; i < 6; i++) {
      for (const intent of [
        COVER_DRIVE,
        { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'auto' } as const,
        null,
      ]) {
        for (const err of [-40, 0, 40]) {
          const { result, setup, mirror } = referenceBall(i, 'right', intent, err);
          const bounce = result.events.find((e) => e.kind === 'bounce');
          if (!bounce || !('p' in bounce)) continue;
          // A bowled or keeper-taken ball whose flight ends before its pitch is a phantom too (the reach check).
          const ended = result.ball.at(-1)!.t < bounce.t;
          const touch = touchedFirst(result);
          const releaseScene = buildPracticeScript({ setup, flight: result.flight, result }).practice!.releaseScene;
          const cue = feedbackCues(result, releaseScene, mirror).find((c) => c.scene?.kind === 'bounce');
          if ((touch && touch.t < bounce.t) || ended) {
            phantom++;
            expect(cue).toBeUndefined();
            continue;
          }
          genuine++;
          expect(presentedBounce(result, bounce)).toBe(true);
          expect(cue).toBeDefined();
          expect(cue!.t).toBeCloseTo(simToScene({ releaseScene }, bounce.t), 6);
          const at = toWorld(bounce.p, mirror);
          expect(Math.hypot(cue!.scene!.at!.x - at.x, cue!.scene!.at!.z - at.z)).toBeLessThan(1e-9);
        }
      }
    }
    expect(genuine).toBeGreaterThan(30);
    expect(phantom).toBeGreaterThan(0);
  });

  it('shows no replay pitch marker for a ball met on the full, and the physics pitch for one that pitched', () => {
    for (const handedness of ['right', 'left'] as const) {
      const full = referenceBall(5, handedness, COVER_DRIVE);
      const releaseScene = buildPracticeScript({ setup: full.setup, flight: full.result.flight, result: full.result })
        .practice!.releaseScene;
      const d = buildDiagnostics(full.result, releaseScene, full.mirror);
      expect(d.bounce).toBeNull();
      expect(d.times.bounce).toBeNull();
      // The PHYS2 form of the result (no bounce event) gives the same: the flight's plan alone draws nothing.
      const phys2 = { ...full.result, events: full.result.events.filter((e) => e.kind !== 'bounce') };
      expect(buildDiagnostics(phys2, releaseScene, full.mirror).bounce).toBeNull();

      const pitched = referenceBall(0, handedness, COVER_DRIVE);
      const b = pitched.result.flight.bounce!;
      const dp = buildDiagnostics(pitched.result, releaseScene, pitched.mirror);
      const at = toWorld(b.p, pitched.mirror);
      expect(dp.bounce).not.toBeNull();
      expect(Math.hypot(dp.bounce!.x - at.x, dp.bounce!.y - at.y, dp.bounce!.z - at.z)).toBeLessThan(1e-9);
      expect(dp.times.bounce).toBeCloseTo(simToScene({ releaseScene }, b.t), 6);
    }
  });

  it('agrees with the PHYS2 5e physics on every ball: it keeps every bounce 5e keeps and only the ones 5e drops are dropped', () => {
    // 5e (confirmed 2026-11-04T02:49Z): the physics lists the pitch only if the ball reaches it before the bat, pad, body,
    // stumps or keeper. The presentation must neither hide a bounce the physics keeps nor invent one it dropped.
    const ref = referenceBall(5, 'right', COVER_DRIVE).physics;
    expect(ref.events.some((e) => e.kind === 'bounce')).toBe(false);
    let kept = 0;
    let dropped = 0;
    const check = (physics: DeliveryResult) => {
      const b = physics.flight.bounce;
      if (!b) return;
      const listed = physics.events.some((e) => e.kind === 'bounce');
      expect(presentedBounce(physics, b)).toBe(listed);
      // And the cue list follows the physics exactly: a bounce cue if and only if the physics lists the pitch.
      expect(feedbackCues(physics, 2000, false).some((c) => c.scene?.kind === 'bounce')).toBe(listed);
      if (listed) kept++;
      else dropped++;
    };
    const intents = [
      COVER_DRIVE,
      { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'auto' } as const,
      { kind: 'attack', directionDeg: -80, elevation: 0.1, power: 0.8, footwork: 'back' } as const,
      null,
    ];
    for (let i = 0; i < 6; i++)
      for (const intent of intents)
        for (const err of [-60, 0, 60])
          for (const h of ['right', 'left'] as const) check(referenceBall(i, h, intent, err).physics);
    for (let i = 0; i < 48; i++) {
      const handedness = i % 2 ? 'left' : 'right';
      const conditions = (['balanced', 'green', 'hard', 'turning'] as const)[i % 4];
      const over = randomOver({
        seed: `pres-fix-5e|${i}`,
        conditions,
        assist: 'real',
        difficulty: 'club',
        family: i % 3 ? 'pace' : 'spin',
      });
      const k = i % 6;
      const field = autoField(over.bowler, conditions, handedness, over.ball);
      const flight = physicsFlight({
        plan: over.balls[k],
        bowler: over.bowler,
        conditions,
        seed: ballSeed(over, k),
        handedness,
        ball: over.ball,
      });
      for (const [intent, err] of [
        [COVER_DRIVE, 0],
        [COVER_DRIVE, -90],
        [null, 0],
      ] as const) {
        const swing = swingOf(
          { over, overIndex: 0, ballIndex: k, conditions, seed: ballSeed(over, k), flight, field },
          intent,
          err,
        );
        check(
          resolveDelivery({
            flight,
            swing,
            field,
            bowler: over.bowler,
            conditions,
            handedness,
            assist: 'real',
            tierToleranceMs: 0,
          }),
        );
      }
    }
    expect(kept).toBeGreaterThan(200);
    expect(dropped).toBeGreaterThan(5);
  });

  it('drops a bounce the presented ball does not reach even with no touch before it (the ball stopped short)', () => {
    const { result } = referenceBall(0, 'right', COVER_DRIVE);
    const bounce = result.events.find(
      (e): e is Extract<DeliveryResult['events'][number], { kind: 'bounce' }> => e.kind === 'bounce',
    )!;
    expect(presentedBounce(result, bounce)).toBe(true);
    const moved = { ...bounce, p: { ...bounce.p, z: bounce.p.z + 0.4 } };
    expect(presentedBounce(result, moved)).toBe(false);
    const truncated: DeliveryResult = { ...result, ball: result.ball.filter((s) => s.t < bounce.t - 0.05) };
    expect(presentedBounce(truncated, bounce)).toBe(false);
  });
});
