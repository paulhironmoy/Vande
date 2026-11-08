/**
 * The candidate grid: every response the coach simulates against the exact delivery (docs/PRACTICE_COACH.md,
 * "Candidate grid"). Each candidate becomes a real NormalizedSwing, at the ideal timing for its own footwork, in the
 * input's own precision (src/input/constants.ts PRECISION), so the swing it demonstrates is one a player can play.
 *
 *   leave                                         no swing
 *   defend  × footwork {auto, the other foot}     the input's tap (straight bat, power DEFEND_POWER)
 *   attack  × footwork × direction × shot         directions: straight, the field's gaps and the line's own arc;
 *                                                 shots: along the ground at two powers, lofted over the top
 *                                                 and chipped over the ring (lofted only with the line); every
 *                                                 one a swing the input can produce (canPlay)
 *                                                 footwork: automatic, plus the other foot on a good length;
 *                                                 never down the track until stumpings exist (owner O9b), and a
 *                                                 yorker only forward (never the back plane)
 */
import type { BallFlight, Decision, Footwork, NormalizedSwing, PlayedFootwork, SwingKind } from '@/contracts/practice';
import { DEFEND_POWER, PRECISION } from '@/input/constants';
import { canPlay } from '@/input/normalize';
import { batTravelMs, idealTimeFor } from '@/physics';
import { arcMiddle, attackArc, withTheLine } from './cricket';
import type { BallFacts } from './facts';
import type { CoachField } from './field';

export const GRID = {
  /** The tap's power and the defensive stroke's straight bat (the input layer's own values). */
  defendPower: DEFEND_POWER,
  /**
   * Along the ground (elevation 0: the input reads every swipe short of its loft reach as grounded), at a placed power
   * (the keyboard's own) and a full-blooded one.
   */
  groundElevation: 0,
  groundPowers: [0.55, 0.9],
  /**
   * Lofted: over the top (the keyboard's lofted stroke) and a chip over the ring. A lofted swipe needs reach within
   * the read window, so it is always a hard one (src/input/normalize.ts minPowerForElevation).
   */
  lofted: [
    { elevation: 0.75, power: 0.85 },
    { elevation: 0.55, power: 0.8 },
  ],
  /** At most this many aiming directions; directions closer than mergeWithinDeg are one. */
  maxDirections: 9,
  mergeWithinDeg: 8,
} as const;

export interface Candidate {
  /** Canonical id, also the deterministic tie-break order. */
  id: string;
  /** Position in the grid (stable order). */
  index: number;
  decision: Decision;
  kind: SwingKind | null;
  footwork: Footwork;
  directionDeg: number;
  elevation: number;
  power: number;
}

/** The input layer's rounding (src/input/normalize.ts): to the step, six decimals, no negative zero. */
const clean = (v: number, step: number) => {
  const fixed = Number((Math.round(v / step) * step).toFixed(6));
  return fixed === 0 ? 0 : fixed;
};

/**
 * A yorker is met on the forward stride and never from the back plane: the body model cannot dig one out from the crease
 * (no hip flexion; a named limitation, lead ruling 2026-11-03), so the coach never offers a back-plane response to it.
 * Automatic footwork is kept only where it resolves forward; otherwise the forward foot is chosen explicitly.
 */
const yorkerFeet = (f: BallFacts): Footwork[] => (f.autoFootwork === 'forward' ? ['auto'] : ['forward']);

/** The other foot for a defence: forward and back both appear once, automatic first (a yorker: forward only). */
function defenceFootworks(f: BallFacts): Footwork[] {
  if (f.lengthBand === 'yorker') return yorkerFeet(f);
  return ['auto', f.autoFootwork === 'forward' ? 'back' : 'forward'];
}

/**
 * The coach never offers down the track (owner decision O9b, 2026-11-03): stumpings do not exist yet, and EPX-R7
 * measured the stranded-and-not-out exposure of going down the track at 20–33%, so a recommended charge would carry a
 * dismissal the physics cannot award. Until stumpings exist no option (recommended, safest or higher-scoring) is played
 * down the track. A player's own charge is still analysed as played.
 */
const DOWN_THE_TRACK_OFFERED = false;

/** Attacking footworks: automatic, and the other foot on a good length (never down the track: DOWN_THE_TRACK_OFFERED). */
function attackFootworks(f: BallFacts): Footwork[] {
  if (f.lengthBand === 'yorker') return yorkerFeet(f);
  const out: Footwork[] = ['auto'];
  if (f.lengthBand === 'good' && (f.autoFootwork === 'forward' || f.autoFootwork === 'back'))
    out.push(f.autoFootwork === 'forward' ? 'back' : 'forward');
  if (DOWN_THE_TRACK_OFFERED && f.family === 'spin' && f.lengthBand !== 'short') out.push('down_track');
  return out;
}

/** Aiming directions: straight, the field's gaps (widest first when there are too many), then the line's own arc, merged. */
function directionsFor(f: BallFacts, field: CoachField): number[] {
  const gaps = [...field.gaps].sort((a, b) => b.widthDeg - a.widthDeg || a.centreDeg - b.centreDeg);
  const dirs: number[] = [];
  const add = (d: number, limit: number) => {
    const r = Math.round(d);
    if (dirs.length >= limit) return;
    if (dirs.every((x) => Math.abs(x - r) >= GRID.mergeWithinDeg)) dirs.push(r);
  };
  // Playing straight, with the full face, is always tried (the answer to movement); then the gaps, keeping one slot
  // for the line's own direction.
  add(0, GRID.maxDirections);
  for (const g of gaps) add(g.centreDeg, GRID.maxDirections - 1);
  // The line's own direction, when no gap lies inside its orthodox arc (so a stroke with the line is always tried).
  for (const footwork of [f.autoFootwork, 'down_track'] as PlayedFootwork[]) {
    if (footwork === 'down_track' && (!DOWN_THE_TRACK_OFFERED || f.family !== 'spin')) continue;
    const arc = attackArc(f, footwork);
    const mid = arcMiddle(f, footwork);
    if (arc && mid !== null && !dirs.some((d) => d >= arc[0] && d <= arc[1])) add(mid, GRID.maxDirections);
  }
  return dirs.sort((a, b) => a - b);
}

/** The whole grid for a delivery, in a fixed order. */
export function candidatesFor(f: BallFacts, field: CoachField): Candidate[] {
  const out: Candidate[] = [];
  const push = (c: Omit<Candidate, 'index'>) => out.push({ ...c, index: out.length });
  push({ id: 'leave', decision: 'leave', kind: null, footwork: 'auto', directionDeg: 0, elevation: 0, power: 0 });
  for (const fw of defenceFootworks(f))
    push({
      id: `defend:${fw}`,
      decision: 'defend',
      kind: 'defend',
      footwork: fw,
      directionDeg: 0,
      elevation: 0,
      power: GRID.defendPower,
    });
  const dirs = directionsFor(f, field);
  // Only strokes a player can input (src/input canPlay): the coach never recommends a swing nobody can play.
  const attack = (fw: Footwork, d: number, elevation: number, power: number, id: string) => {
    if (canPlay({ kind: 'attack', power, elevation }))
      push({ id, decision: 'attack', kind: 'attack', footwork: fw, directionDeg: d, elevation, power });
  };
  for (const fw of attackFootworks(f)) {
    for (const d of dirs) {
      for (const p of GRID.groundPowers) attack(fw, d, GRID.groundElevation, p, `attack:${fw}:${d}:g${p}`);
      // Lofted strokes across the line are never shown (the higher-scoring alternative plays with the line).
      if (fw !== 'auto' || !withTheLine({ decision: 'attack', directionDeg: d }, f)) continue;
      for (const l of GRID.lofted) attack(fw, d, l.elevation, l.power, `attack:${fw}:${d}:l${l.elevation}:${l.power}`);
    }
  }
  return out;
}

/** Ideal contact time per footwork for this flight (the physics' own reference). */
export function idealTimes(flight: BallFlight): Record<Footwork, number> {
  const fws: Footwork[] = ['auto', 'forward', 'back', 'across', 'down_track'];
  return Object.fromEntries(fws.map((fw) => [fw, idealTimeFor(flight, fw)])) as Record<Footwork, number>;
}

/**
 * The candidate as a NormalizedSwing: timed `dtMs` from the ideal for its footwork (+ = late) and aimed `aimDeg` from
 * its direction, in the input's precision. Null for the leave.
 */
export function swingOf(c: Candidate, ideal: Record<Footwork, number>, dtMs = 0, aimDeg = 0): NormalizedSwing | null {
  if (c.kind === null) return null;
  const startT = ideal[c.footwork] - batTravelMs(c.kind, c.power) / 1000 + dtMs / 1000;
  return {
    kind: c.kind,
    startT: clean(startT, PRECISION.startT),
    directionDeg: clean(c.directionDeg + aimDeg, PRECISION.directionDeg),
    power: clean(c.power, PRECISION.unit),
    elevation: clean(c.elevation, PRECISION.unit),
    footwork: c.footwork,
  };
}
