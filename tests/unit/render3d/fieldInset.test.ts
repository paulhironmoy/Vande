/**
 * The field inset (picture-in-picture): what it shows at each moment of a ball, that every human on the field is in it
 * at the physics position, that it never shows what the physics did not produce, that close markers stay countable,
 * the DOM seam the Practice screen provides, and the 3D tiers' overhead ground capture (state restored, rows flipped).
 */
import { describe, expect, it } from 'vitest';
import type { DeliveryResult } from '@/contracts/practice';
import { evaluateActor } from '@/render3d/core/actors';
import { sampleBall, type BallScript } from '@/render3d/core/choreo';
import { BOUNDARY_R } from '@/render3d/core/ground';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import {
  INSET_FIELD_R,
  insetLayout,
  insetModel,
  insetMoment,
  paintFieldInset,
  type InsetModel,
} from '@/render3d/fallback2d/topDown';
import { autoField, resolveDelivery, flight as physicsFlight } from '@/physics/index';
import { overBalls, swingOf } from '@/practice/game/evaluate';
import { REFERENCE_CONDITIONS, REFERENCE_OVER } from '@/practice/game/reference';

/** Reference ball `index` with a real physics result (the physics' own fielder paths and ball). */
function reference(index: number, intent: Parameters<typeof swingOf>[1], handedness: 'right' | 'left' = 'right') {
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
  const swing = swingOf({ ...b, flight }, intent, 0);
  const result: DeliveryResult = resolveDelivery({
    flight,
    swing,
    field,
    bowler: b.over.bowler,
    conditions: b.conditions,
    handedness,
    assist: 'real',
    tierToleranceMs: 0,
  });
  const setup: PracticeSceneSetup = { field, bowler: b.over.bowler, conditions: b.conditions, handedness };
  return { setup, flight, result, script: buildPracticeScript({ setup, flight, result }) };
}

/** The first reference ball driven into the field (a stroke the fielders chase). */
function driven(handedness: 'right' | 'left' = 'right') {
  for (let i = 0; i < 6; i++) {
    const r = reference(i, DRIVE, handedness);
    if (r.result.contact.point && r.result.fielders.length && r.script.practice!.contactScene !== null) return r;
  }
  throw new Error('no driven reference ball');
}

const DRIVE = { kind: 'attack', power: 0.7, directionDeg: 30, elevation: 0, footwork: 'forward' } as const;

describe('field inset: moments of the ball', () => {
  it('is calm between balls, quiet in the run-up, hidden from the release to the fielding camera, then chase and full', () => {
    const { script, setup } = driven();
    const idle = buildPracticeScript({ setup, flight: null });
    expect(insetMoment(idle, 500)).toBe('calm');
    const p = script.practice!;
    expect(insetMoment(script, 0)).toBe('quiet');
    expect(insetMoment(script, p.releaseScene - 1)).toBe('quiet');
    expect(insetMoment(script, p.releaseScene)).toBe('hidden');
    expect(insetMoment(script, p.contactScene! + 1)).toBe('hidden');
    expect(p.firstPersonUntil).toBeGreaterThan(p.contactScene!);
    expect(insetMoment(script, p.firstPersonUntil)).toBe('chase');
    expect(insetMoment(script, p.deadScene!)).toBe('full');
    expect(insetModel(script, p.releaseScene + 10)).toBeNull();
  });

  it('a leave never shows a chase: hidden from the release until the dead ball', () => {
    const r = reference(0, null);
    const p = r.script.practice!;
    for (let t = p.releaseScene; t < p.deadScene!; t += 50) expect(insetMoment(r.script, t)).toBe('hidden');
    expect(insetMoment(r.script, p.deadScene!)).toBe('full');
    expect(insetModel(r.script, p.deadScene! + 10)!.path).toEqual([]);
  });

  it('a script that is not Practice shows nothing', () => {
    const { script } = driven();
    const plain: BallScript = { ...script, practice: undefined };
    expect(insetMoment(plain, 100)).toBe('hidden');
    expect(insetModel(plain, 100)).toBeNull();
  });
});

describe('field inset: every human, at the physics position', () => {
  it('shows every actor of the script: eleven fielders with the keeper and the bowler, both batters and the umpires', () => {
    for (const hand of ['right', 'left'] as const) {
      const { script, setup } = driven(hand);
      const m = insetModel(script, script.practice!.deadScene! + 100)!;
      expect(m.players.map((p) => p.id).sort()).toEqual(script.actors.map((a) => a.id).sort());
      const kinds = m.players.map((p) => p.kind);
      expect(kinds.filter((k) => k === 'keeper')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'bowler')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'striker')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'batter').length).toBeGreaterThanOrEqual(1);
      expect(kinds.filter((k) => k === 'umpire').length).toBeGreaterThanOrEqual(1);
      // The keeper, the bowler and the nine others: all eleven of the physics field.
      expect(kinds.filter((k) => k === 'keeper' || k === 'bowler' || k === 'fielder')).toHaveLength(
        setup.field.fielders.length,
      );
    }
  });

  it('places each player at the evaluated track position (never the drawn rig offset) and the ball at its physics sample', () => {
    const { script } = driven();
    const p = script.practice!;
    for (let t = p.firstPersonUntil; t < p.deadScene! + 500; t += 97) {
      const m = insetModel(script, t);
      if (!m) continue;
      for (const pl of m.players) {
        const s = evaluateActor(
          script.actors.find((a) => a.id === pl.id)!,
          t,
        ).pos;
        expect(pl.x).toBe(s.x);
        expect(pl.z).toBe(s.z);
      }
      const b = sampleBall(script, t);
      if (m.ball) {
        expect(m.ball.x).toBe(b.pos.x);
        expect(m.ball.z).toBe(b.pos.z);
      } else expect(b.visible).toBe(false);
    }
  });

  it('the run-up shows the field as set at the release, frozen: the same picture at every run-up frame', () => {
    const { script } = driven();
    const p = script.practice!;
    const first = insetModel(script, 1)!;
    for (const t of [200, p.releaseScene / 2, p.releaseScene - 1]) expect(insetModel(script, t)).toEqual(first);
    for (const pl of first.players) {
      const s = evaluateActor(
        script.actors.find((a) => a.id === pl.id)!,
        p.releaseScene,
      ).pos;
      expect([pl.x, pl.z]).toEqual([s.x, s.z]);
    }
    expect(first.ball).toBeNull();
    expect(first.path).toEqual([]);
  });

  it('after the stroke: the path is the physics ball from the bat, revealed only up to now; the chasers are the ones running', () => {
    const { script, result } = driven();
    const p = script.practice!;
    const early = insetModel(script, p.firstPersonUntil)!;
    const late = insetModel(script, p.deadScene!)!;
    expect(late.path.length).toBeGreaterThan(early.path.length);
    // Every path point is a physics ball position at or after the bat's contact.
    const after = result.ball.filter((s) => s.t >= result.contact.t! - 1e-9);
    for (let i = 0; i < late.path.length; i += 2) {
      const near = Math.min(...after.map((s) => Math.hypot(s.p.x - late.path[i], s.p.z - late.path[i + 1])));
      expect(near).toBeLessThan(1.2);
    }
    // Somebody chases a driven ball, and nobody is flagged running during the frozen run-up.
    let chased = false;
    for (let t = p.firstPersonUntil; t < p.deadScene!; t += 50)
      chased ||= insetModel(script, t)!.players.some((pl) => pl.kind === 'fielder' && Math.hypot(pl.vx, pl.vz) > 2.5);
    expect(chased).toBe(true);
    expect(insetModel(script, 10)!.players.every((pl) => pl.vx === 0 && pl.vz === 0)).toBe(true);
  });

  it('keeps the batter orientation: the bowler above the striker, and a left-hander mirrored like the first-person view', () => {
    for (const hand of ['right', 'left'] as const) {
      const { script } = driven(hand);
      const m = insetModel(script, 1)!;
      const L = insetLayout(m, 120);
      const at = (kind: string) => m.players.findIndex((pl) => pl.kind === kind);
      expect(L.at[at('bowler') * 2 + 1]).toBeLessThan(L.at[at('striker') * 2 + 1]);
      expect(L.at[at('keeper') * 2 + 1]).toBeGreaterThan(L.at[at('striker') * 2 + 1]);
    }
  });
});

describe('field inset: layout', () => {
  const model = (xs: Array<[number, number]>): InsetModel => ({
    moment: 'calm',
    players: xs.map(([x, z], i) => ({ id: `f${i}`, kind: 'fielder' as const, x, z, vx: 0, vz: 0, fielded: false })),
    ball: null,
    path: [],
  });

  it('fits the rope inside the inset', () => {
    const L = insetLayout(model([]), 100);
    expect(BOUNDARY_R * L.k).toBeLessThan(50);
    expect(INSET_FIELD_R * L.k).toBeLessThanOrEqual(48);
  });

  it('eases a slip cordon apart so each marker is countable, never moving one by more than one and a half radii', () => {
    // A pace slip cordon: 1.9 m apart beside the keeper (physics field.ts slipSpots), about two pixels at this size.
    const cordon: Array<[number, number]> = [
      [0.35, 26],
      [2.25, 25.5],
      [4.15, 25],
      [6.05, 24.5],
    ];
    const size = 112;
    const L = insetLayout(model(cordon), size);
    for (let i = 0; i < cordon.length; i++) {
      const hx = L.c + cordon[i][0] * L.k;
      const hy = L.c + cordon[i][1] * L.k;
      expect(Math.hypot(L.at[i * 2] - hx, L.at[i * 2 + 1] - hy)).toBeLessThanOrEqual(L.r * 1.5 + 1e-3);
      for (let j = i + 1; j < cordon.length; j++)
        expect(Math.hypot(L.at[i * 2] - L.at[j * 2], L.at[i * 2 + 1] - L.at[j * 2 + 1])).toBeGreaterThan(L.r * 1.4);
    }
  });

  it('keeps every player countable at 640×360 (a 104 px inset) for a pace and a spin field, keeper standing up', () => {
    // The audit's spin field (humans/audit/spin-field.txt): the keeper 0.8 m behind the stumps with a slip 1.6 m from
    // him and the striker in front: three markers inside about 2.5 m, under 3 px at this size before easing.
    for (const family of ['pace', 'spin'] as const) {
      for (const hand of ['right', 'left'] as const) {
        const bowler =
          family === 'pace'
            ? ({ family, paceBand: 'fast', arm: 'right', lookSeed: 'b' } as const)
            : ({ family, spinType: 'finger', arm: 'right', lookSeed: 's' } as const);
        const field = autoField(bowler, 'balanced', hand);
        const setup: PracticeSceneSetup = { field, bowler, conditions: 'balanced', handedness: hand };
        const idle = buildPracticeScript({ setup, flight: null });
        const m = insetModel(idle, 100)!;
        expect(m.players.length).toBeGreaterThanOrEqual(15);
        const L = insetLayout(m, 104);
        for (let i = 0; i < m.players.length; i++) {
          for (let j = i + 1; j < m.players.length; j++) {
            const d = Math.hypot(L.at[i * 2] - L.at[j * 2], L.at[i * 2 + 1] - L.at[j * 2 + 1]);
            expect(d, `${family} ${hand}: ${m.players[i].id} and ${m.players[j].id}`).toBeGreaterThan(L.r * 1.2);
          }
        }
      }
    }
  });

  it('moves nobody who already stands clear', () => {
    const spread: Array<[number, number]> = [
      [-40, 0],
      [40, 0],
      [0, -40],
      [0, 40],
    ];
    const L = insetLayout(model(spread), 120);
    spread.forEach(([x, z], i) => {
      expect(L.at[i * 2]).toBeCloseTo(L.c + x * L.k, 4);
      expect(L.at[i * 2 + 1]).toBeCloseTo(L.c + z * L.k, 4);
    });
  });
});

describe('field inset: the DOM seam', () => {
  function screen() {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.setAttribute('data-play-root', '');
    const stage = document.createElement('canvas');
    const pip = document.createElement('div');
    pip.setAttribute('data-pip', '');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-pip-canvas', '');
    pip.append(canvas);
    root.append(stage, pip);
    document.body.append(root);
    return { stage, pip };
  }

  it('reports the moment on the inset the play screen provides, and steps aside for a field view, a replay or a teaching view', () => {
    const { script } = driven();
    const { stage, pip } = screen();
    expect(paintFieldInset(stage, script, 10)).toBe('quiet');
    expect(pip.dataset.pipMoment).toBe('quiet');
    expect(pip.dataset.pipDrawn).toBe('1');
    expect(paintFieldInset(stage, script, script.practice!.deadScene!, { mode: 'live' })).toBe('full');
    expect(paintFieldInset(stage, script, script.practice!.deadScene!, { fieldInView: true })).toBe('hidden');
    for (const mode of ['replay', 'demo', 'closeup', 'benchmark'])
      expect(paintFieldInset(stage, script, script.practice!.deadScene!, { mode })).toBe('hidden');
    expect(pip.dataset.pipMoment).toBe('hidden');
    // Classic never draws the dead ball's picture (its card's half), but keeps the run-up's.
    expect(paintFieldInset(stage, script, script.practice!.deadScene!, { mode: 'live', deadBall: false })).toBe(
      'hidden',
    );
    expect(paintFieldInset(stage, script, 10, { mode: 'live', deadBall: false })).toBe('quiet');
  });

  it('does nothing for a stage canvas with no inset beside it, and finds a new one at once', () => {
    const { script } = driven();
    document.body.innerHTML = '';
    const lone = document.createElement('canvas');
    document.body.append(lone);
    expect(paintFieldInset(lone, script, 10)).toBeNull();
    const { stage, pip } = screen();
    expect(paintFieldInset(stage, script, 10)).toBe('quiet');
    pip.remove();
    expect(paintFieldInset(stage, script, 10)).toBeNull();
  });
});
