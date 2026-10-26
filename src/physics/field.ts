/**
 * Practice field placement: the automatic, beginner-readable field (keeper, bowler and nine fielders) and the ground
 * geometry the fielding, scoring and coaching share (bearings and distances from the striker, distance to the rope).
 *
 * Every layout is in the physics frame of src/contracts/practice.ts: metres, origin at the pitch centre, +Z towards the
 * striker, +X = the striker's OFF side. A left-handed striker is simulated mirrored, so the same layouts serve both;
 * the bowler is mirrored into that frame first (`physicsBowler`), which matters for spin (turning in or away).
 *
 * The fields are deliberately classic and readable rather than clever: an inner ring that saves singles with clear
 * gaps between its fielders, two or three men on the rope, and close catchers only where the conditions make edges or
 * bat-pad chances likely (two slips and a gully for pace on a green pitch, a short leg or silly point for spin on a
 * turner). All of them stand inside the 62 m rope. See docs/PRACTICE_RULES.md, "Field layouts".
 */
import type { BowlerProfile, FieldLayout, Fielder, FielderRole, Handedness, PitchCondition } from '@/contracts/practice';
import { BOUNDARY_R, PITCH_HALF, STRIKER_REF } from './constants';
import { DEG, bearingDeg, dcos, dsin } from './vec';

// Bearings and distances "from the striker" are measured from constants.ts STRIKER_REF (the front of the popping
// crease in line with middle stump, the renderer's reference too); these helpers are the one set built on it.

// All of it uses the deterministic trigonometry of vec.ts, so a replay is bit-identical on every browser engine.

/** Bearing (degrees) of a ground point from the striker: 0 = straight down the ground, + = off side, ±180 = behind. */
export function bearingFromStriker(x: number, z: number): number {
  return bearingDeg(x - STRIKER_REF.x, z - STRIKER_REF.z);
}

export function distanceFromStriker(x: number, z: number): number {
  const dx = x - STRIKER_REF.x;
  const dz = z - STRIKER_REF.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Ground point at a bearing and distance from the striker. */
export function pointFromStriker(bearing: number, distanceM: number): { x: number; z: number } {
  const a = bearing * DEG;
  return { x: STRIKER_REF.x + dsin(a) * distanceM, z: STRIKER_REF.z - dcos(a) * distanceM };
}

/** Distance from the striker to the rope along a bearing (the ground is a circle about the pitch centre). */
export function ropeDistance(bearing: number): number {
  const a = bearing * DEG;
  const dx = dsin(a);
  const dz = -dcos(a);
  const b = STRIKER_REF.x * dx + STRIKER_REF.z * dz;
  const c = STRIKER_REF.x * STRIKER_REF.x + STRIKER_REF.z * STRIKER_REF.z - BOUNDARY_R * BOUNDARY_R;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

/** Distance of a ground point from the pitch centre (the rope is at BOUNDARY_R). */
export const groundRadius = (x: number, z: number): number => Math.sqrt(x * x + z * z);

// ---------------------------------------------------------------------------------------------------------------
// The bowler in the physics frame
// ---------------------------------------------------------------------------------------------------------------

/**
 * The bowler as the physics sees him. `BowlerProfile.arm` is the real bowler's arm; the physics frame is the striker's
 * own (right-handed) frame, so for a left-handed striker the bowler is mirrored: a right-arm bowler becomes left-arm.
 * The one place this mirroring happens for fields; the delivery physics does the same inside `flight()`.
 */
export function physicsBowler(bowler: BowlerProfile, handedness: Handedness = 'right'): BowlerProfile {
  if (handedness === 'right') return bowler;
  return { ...bowler, arm: bowler.arm === 'right' ? 'left' : 'right' };
}

/**
 * Whether a spinner turns the ball away from the (physics-frame, right-handed) striker. An off-break turns in: a
 * right-arm finger spinner or a left-arm wrist spinner. A leg-break turns away: right-arm wrist or left-arm finger.
 */
export function turnsAway(bowler: BowlerProfile): boolean {
  return (bowler.spinType === 'wrist') !== (bowler.arm === 'left');
}

// ---------------------------------------------------------------------------------------------------------------
// Layout templates
// ---------------------------------------------------------------------------------------------------------------

/** A fielder in the ring or close in, by bearing and distance; or on the rope (`deep`, a few metres inside it). */
type Spot = { role: FielderRole; b: number; d: number } | { role: FielderRole; b: number; deep: true };

/** How far inside the rope the boundary riders stand (m). */
export const DEEP_INSET_M = 4;

interface Template {
  id: string;
  /** Number of slips beside the keeper (0–2). */
  slips: number;
  spots: Spot[];
}

const ring = (role: FielderRole, b: number, d: number): Spot => ({ role, b, d });
const deep = (role: FielderRole, b: number): Spot => ({ role, b, deep: true });

/**
 * Pace. Balanced: one slip, a ring of six, third man and fine leg back (gaps at extra cover, backward point,
 * wide mid-on and everywhere in the deep in front of square). Green: two slips and a gully for the moving ball,
 * midwicket open. Hard and bouncy: a gully, and deep square leg and fine leg for the pull and the hook.
 */
const PACE_TEMPLATES: Record<'balanced' | 'green' | 'hard', Template> = {
  balanced: {
    id: 'pace-balanced',
    slips: 1,
    spots: [
      ring('point', 97, 21),
      ring('cover', 63, 23),
      ring('mid_off', 21, 25),
      ring('mid_on', -21, 25),
      ring('midwicket', -62, 23),
      ring('square_leg', -97, 21),
      deep('third_man', 132),
      deep('fine_leg', -148),
    ],
  },
  green: {
    id: 'pace-green',
    slips: 2,
    spots: [
      ring('gully', 122, 14),
      ring('point', 95, 21),
      ring('cover', 62, 23),
      ring('mid_off', 21, 25),
      ring('mid_on', -21, 25),
      ring('square_leg', -95, 21),
      deep('fine_leg', -148),
    ],
  },
  hard: {
    id: 'pace-hard',
    slips: 1,
    spots: [
      ring('gully', 120, 14),
      ring('point', 95, 21),
      ring('cover', 62, 23),
      ring('mid_off', 21, 25),
      ring('mid_on', -21, 25),
      ring('midwicket', -62, 23),
      deep('deep_square', -100),
      deep('fine_leg', -150),
    ],
  },
};

/**
 * Spin, keeper standing up. The ring comes a little closer (spinners concede fewer hard-hit drives) and the two
 * boundary riders go where the spin sends the ball: deep midwicket for the off-break turning in, deep cover for the
 * ball turning away. On a turning pitch a close catcher replaces one of them: short leg for the off-break (bat-pad),
 * silly point for the leg-break.
 */
const SPIN_TEMPLATES: Record<'in' | 'in_turning' | 'away' | 'away_turning', Template> = {
  in: {
    id: 'spin-in',
    slips: 1,
    spots: [
      ring('point', 95, 19),
      ring('cover', 62, 21),
      ring('mid_off', 20, 22),
      ring('mid_on', -20, 22),
      ring('midwicket', -60, 21),
      ring('square_leg', -95, 19),
      deep('deep_midwicket', -52),
      deep('long_off', 12),
    ],
  },
  in_turning: {
    id: 'spin-in-turning',
    slips: 1,
    spots: [
      ring('short_leg', -100, 5),
      ring('point', 95, 19),
      ring('cover', 62, 21),
      ring('mid_off', 20, 22),
      ring('mid_on', -20, 22),
      ring('midwicket', -60, 21),
      ring('square_leg', -112, 19),
      deep('deep_midwicket', -52),
    ],
  },
  away: {
    id: 'spin-away',
    slips: 1,
    spots: [
      ring('point', 97, 19),
      ring('cover', 62, 21),
      ring('mid_off', 20, 22),
      ring('mid_on', -20, 22),
      ring('midwicket', -60, 21),
      ring('square_leg', -95, 19),
      deep('deep_cover', 66),
      deep('long_on', -12),
    ],
  },
  away_turning: {
    id: 'spin-away-turning',
    slips: 1,
    spots: [
      ring('silly_point', 78, 4.5),
      ring('point', 100, 19),
      ring('cover', 62, 21),
      ring('mid_off', 20, 22),
      ring('mid_on', -20, 22),
      ring('midwicket', -60, 21),
      ring('square_leg', -95, 19),
      deep('deep_cover', 66),
    ],
  },
};

/** Keeper's distance behind the striker's stumps for pace (m): further back the quicker the bowler. */
export const KEEPER_BACK_M = { controlled: 9, fast: 12, express: 15 } as const;
/** Extra depth on a hard, bouncy pitch (the ball carries further). */
export const KEEPER_BACK_HARD_M = 2;
/** Keeper standing up to the stumps for spin (m behind them). */
export const KEEPER_UP_M = 0.8;

function keeperSpot(bowler: BowlerProfile, conditions: PitchCondition): { x: number; z: number } {
  if (bowler.family === 'spin') return { x: 0.25, z: PITCH_HALF + KEEPER_UP_M };
  const back = KEEPER_BACK_M[bowler.paceBand ?? 'fast'] + (conditions === 'hard' ? KEEPER_BACK_HARD_M : 0);
  return { x: 0.35, z: PITCH_HALF + back };
}

/** Slips stand beside the keeper on the off side, a little in front of him, each one wider and finer than the last. */
function slipSpots(keeper: { x: number; z: number }, n: number, spin: boolean): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 1; i <= n; i++) {
    out.push(spin ? { x: keeper.x + 1.25 * i, z: keeper.z + 0.9 } : { x: keeper.x + 1.9 * i, z: keeper.z - 0.5 * i });
  }
  return out;
}

/** The bowler at the end of his follow-through when the ball reaches the bat (off the pitch's danger area). */
function bowlerSpot(bowler: BowlerProfile): { x: number; z: number } {
  const side = bowler.arm === 'right' ? 1 : -1;
  return bowler.family === 'pace' ? { x: 0.9 * side, z: -PITCH_HALF + 4.6 } : { x: 0.6 * side, z: -PITCH_HALF + 2.4 };
}

function templateFor(bowler: BowlerProfile, conditions: PitchCondition): Template {
  if (bowler.family === 'pace') return PACE_TEMPLATES[conditions === 'green' ? 'green' : conditions === 'hard' ? 'hard' : 'balanced'];
  const away = turnsAway(bowler);
  const turning = conditions === 'turning';
  return SPIN_TEMPLATES[away ? (turning ? 'away_turning' : 'away') : turning ? 'in_turning' : 'in'];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The automatic field for a bowler on a pitch, in the physics frame. `bowler` is the REAL bowler; the handedness
 * mirrors him into the striker's frame first (a right-arm off-spinner turns away from a left-hander, so a left-hander
 * gets the "turning away" field). Deterministic: the same inputs give the same layout and id.
 */
export function autoField(bowler: BowlerProfile, conditions: PitchCondition, handedness: Handedness = 'right'): FieldLayout {
  const b = physicsBowler(bowler, handedness);
  const t = templateFor(b, conditions);
  const keeper = keeperSpot(b, conditions);
  const fielders: Fielder[] = [
    { id: 'keeper', role: 'keeper', x: round2(keeper.x), z: round2(keeper.z) },
    { id: 'bowler', role: 'bowler', ...roundXZ(bowlerSpot(b)) },
  ];
  slipSpots(keeper, t.slips, b.family === 'spin').forEach((p, i) => fielders.push({ id: `slip${i + 1}`, role: 'slip', ...roundXZ(p) }));
  for (const s of t.spots) {
    const p = 'deep' in s ? pointFromStriker(s.b, ropeDistance(s.b) - DEEP_INSET_M) : pointFromStriker(s.b, s.d);
    fielders.push({ id: s.role, role: s.role, ...roundXZ(p) });
  }
  const band = b.family === 'pace' ? (b.paceBand ?? 'fast') : (b.spinType ?? 'finger');
  return { id: `auto/${t.id}/${band}${conditions === 'hard' && b.family === 'pace' ? '/deep-keeper' : ''}`, fielders };
}

function roundXZ(p: { x: number; z: number }): { x: number; z: number } {
  return { x: round2(p.x), z: round2(p.z) };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

const ROLES: ReadonlySet<FielderRole> = new Set<FielderRole>([
  'keeper', 'bowler', 'slip', 'gully', 'point', 'backward_point', 'cover', 'extra_cover', 'mid_off', 'mid_on', 'midwicket',
  'square_leg', 'fine_leg', 'third_man', 'deep_point', 'deep_cover', 'long_off', 'long_on', 'deep_midwicket', 'deep_square',
  'short_leg', 'silly_point', 'leg_slip',
]);

/** Closed-code problems with a layout (empty when it is a legal Practice field). */
export function validateField(field: FieldLayout): string[] {
  const errors: string[] = [];
  if (!field || !Array.isArray(field.fielders)) return ['not_a_field'];
  if (typeof field.id !== 'string' || field.id.length === 0) errors.push('missing_id');
  if (field.fielders.length !== 11) errors.push('need_eleven_fielders');
  const ids = new Set<string>();
  let keepers = 0;
  let bowlers = 0;
  for (const f of field.fielders) {
    if (ids.has(f.id)) errors.push(`duplicate_id:${f.id}`);
    ids.add(f.id);
    if (!ROLES.has(f.role)) errors.push(`unknown_role:${f.id}`);
    if (f.role === 'keeper') keepers++;
    if (f.role === 'bowler') bowlers++;
    if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) errors.push(`bad_position:${f.id}`);
    else if (groundRadius(f.x, f.z) > BOUNDARY_R - 1) errors.push(`outside_rope:${f.id}`);
    else if (f.role !== 'bowler' && f.role !== 'keeper' && Math.abs(f.x) < 1.6 && Math.abs(f.z) < PITCH_HALF + 0.5) errors.push(`on_the_pitch:${f.id}`);
  }
  if (keepers !== 1) errors.push('need_one_keeper');
  if (bowlers !== 1) errors.push('need_one_bowler');
  return errors;
}
