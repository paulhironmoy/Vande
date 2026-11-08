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
import type { BallCondition, BowlerProfile, FieldArc, FieldIntent, FieldIntention, FieldLayout, Fielder, FielderRole, Handedness, PitchCondition } from '@/contracts/practice';
import { BOUNDARY_R, DEFAULT_BALL, OUTFIELD, PITCH_HALF, STRIKER_REF } from './constants';
// fielding.ts and scoring.ts import this module too: their bindings are only used inside functions (never while the
// modules initialise), so the cycle is safe.
import { ATHLETICS, KEEPER_RANGE_M, ROPE_MARGIN_M, coverable, diveLengths, diveReachM, fielderClass, type FielderClass } from './fielding';
import { regionOf } from './scoring';
import { DEG, bearingDeg, dcos, dexp, dlog, dsin } from './vec';

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

/**
 * White ball (limited overs, the default stage under lights): five fielders inside the ring and four on the rope, as
 * the fielding restrictions of the middle overs allow and as captains set them: a ring that saves the single and
 * boundary riders where the ball is bowled to be hit. Pace bowls the off-stump channel to an off-side field: point,
 * cover, mid-off, mid-on and midwicket up; deep cover, deep point, third man and fine leg back. Green: a slip comes up
 * for the moving ball in place of midwicket. Hard and bouncy: the short-ball trap of deep square leg and fine leg back
 * with deep point and third man. Spin: the ring a little closer and tight on the off side, long-off and long-on back
 * with a sweeper at deep cover (the drive through extra cover) and deep midwicket; on a turner a close catcher (short
 * leg for the ball turning in, a slip for the one turning away) replaces midwicket.
 */
const PACE_WHITE_TEMPLATES: Record<'balanced' | 'green' | 'hard', Template> = {
  balanced: {
    id: 'pace-white-balanced',
    slips: 0,
    spots: [
      ring('point', 98, 21),
      ring('cover', 62, 23),
      ring('mid_off', 20, 25),
      ring('mid_on', -20, 25),
      ring('midwicket', -60, 23),
      deep('deep_cover', 45),
      deep('deep_point', 85),
      deep('third_man', 130),
      deep('fine_leg', -145),
    ],
  },
  green: {
    id: 'pace-white-green',
    slips: 1,
    spots: [
      ring('point', 98, 21),
      ring('cover', 62, 23),
      ring('mid_off', 20, 25),
      ring('mid_on', -20, 25),
      deep('deep_cover', 45),
      deep('deep_point', 85),
      deep('third_man', 130),
      deep('fine_leg', -145),
    ],
  },
  hard: {
    id: 'pace-white-hard',
    slips: 0,
    spots: [
      ring('point', 98, 21),
      ring('cover', 62, 23),
      ring('mid_off', 20, 25),
      ring('mid_on', -20, 25),
      ring('midwicket', -60, 23),
      deep('deep_point', 80),
      deep('third_man', 130),
      deep('deep_square', -95),
      deep('fine_leg', -150),
    ],
  },
};

const SPIN_WHITE_TEMPLATES: Record<'in' | 'in_turning' | 'away' | 'away_turning', Template> = {
  in: {
    id: 'spin-white-in',
    slips: 0,
    spots: [
      ring('point', 90, 18),
      ring('cover', 55, 20),
      ring('mid_off', 22, 21),
      ring('mid_on', -22, 21),
      ring('midwicket', -60, 20),
      deep('long_off', 8),
      deep('deep_cover', 40),
      deep('long_on', -12),
      deep('deep_midwicket', -50),
    ],
  },
  in_turning: {
    id: 'spin-white-in-turning',
    slips: 0,
    spots: [
      ring('short_leg', -100, 5),
      ring('point', 90, 18),
      ring('cover', 55, 20),
      ring('mid_off', 22, 21),
      ring('mid_on', -22, 21),
      deep('long_off', 8),
      deep('deep_cover', 40),
      deep('long_on', -12),
      deep('deep_midwicket', -50),
    ],
  },
  away: {
    id: 'spin-white-away',
    slips: 0,
    spots: [
      ring('point', 95, 18),
      ring('cover', 60, 20),
      ring('mid_off', 22, 21),
      ring('mid_on', -22, 21),
      ring('midwicket', -60, 20),
      deep('long_off', 10),
      deep('deep_cover', 45),
      deep('long_on', -10),
      deep('deep_midwicket', -55),
    ],
  },
  away_turning: {
    id: 'spin-white-away-turning',
    slips: 1,
    spots: [
      ring('point', 95, 18),
      ring('cover', 60, 20),
      ring('mid_off', 22, 21),
      ring('mid_on', -22, 21),
      deep('long_off', 10),
      deep('deep_cover', 45),
      deep('long_on', -10),
      deep('deep_midwicket', -55),
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

function templateFor(bowler: BowlerProfile, conditions: PitchCondition, white: boolean): Template {
  if (bowler.family === 'pace') {
    const k = conditions === 'green' ? 'green' : conditions === 'hard' ? 'hard' : 'balanced';
    return white ? PACE_WHITE_TEMPLATES[k] : PACE_TEMPLATES[k];
  }
  const away = turnsAway(bowler);
  const turning = conditions === 'turning';
  const k = away ? (turning ? 'away_turning' : 'away') : turning ? 'in_turning' : 'in';
  return white ? SPIN_WHITE_TEMPLATES[k] : SPIN_TEMPLATES[k];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The automatic field for a bowler on a pitch, in the physics frame. `bowler` is the REAL bowler; the handedness
 * mirrors him into the striker's frame first (a right-arm off-spinner turns away from a left-hander, so a left-hander
 * gets the "turning away" field). The ball sets the format: a white ball (the default) gets the limited-overs field,
 * five in the ring and four out; a red ball the Test field. Deterministic: the same inputs give the same layout and id.
 */
export function autoField(bowler: BowlerProfile, conditions: PitchCondition, handedness: Handedness = 'right', ball: Pick<BallCondition, 'colour'> = DEFAULT_BALL): FieldLayout {
  const b = physicsBowler(bowler, handedness);
  const t = templateFor(b, conditions, ball.colour !== 'red');
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

// ---------------------------------------------------------------------------------------------------------------
// Field intelligence (`fieldIntent`): the catchers, what the field protects, the gaps, and the plan behind it
// ---------------------------------------------------------------------------------------------------------------

/**
 * The stroke the protected arcs are measured against: a well-hit ground drive leaving the bat at 150 km/h (the exit
 * speed of a perfectly timed power-0.75 drive in this physics: 148–155 km/h), rolling away from the striker with the
 * outfield's own law, a = OUTFIELD.rollDecel + OUTFIELD.rollDrag·v, in closed form. It reaches 25 m in 0.68 s, 40 m in
 * 1.18 s and 55 m in 1.80 s; the integrator's real drives take 0.64–0.69, 1.11–1.19 and 1.68–1.82 s.
 */
export const INTENT_STROKE_KPH = 150;
/** Spacing of the stroke's path (m) and of the outward scan for each fielder's arc (deg); arc edges are refined by bisection and rounded to 0.1°. */
const INTENT_STEP_M = 0.25;
const INTENT_SCAN_DEG = 0.25;

const ROLL_K = OUTFIELD.rollDrag;
const ROLL_C = OUTFIELD.rollDecel / OUTFIELD.rollDrag;

/** Distance (m) the stroke has rolled after t seconds from v0 (exact for a = rollDecel + rollDrag·v). */
function rolledM(v0: number, t: number): number {
  return ((v0 + ROLL_C) * (1 - dexp(-ROLL_K * t))) / ROLL_K - ROLL_C * t;
}

/** Seconds for the stroke to roll s metres (s ≤ its stopping distance): Newton on the concave distance. */
function rollSeconds(v0: number, s: number, tStop: number): number {
  if (s <= 0) return 0;
  let t = Math.min(tStop, s / v0);
  for (let i = 0; i < 40; i++) {
    const f = rolledM(v0, t) - s;
    const v = (v0 + ROLL_C) * dexp(-ROLL_K * t) - ROLL_C;
    if (Math.abs(f) < 1e-10 || v <= 1e-9) break;
    let next = t - f / v;
    if (next < 0) next = t / 2;
    if (next > tStop) next = (t + tStop) / 2;
    t = next;
  }
  return t;
}

interface StrokeTables {
  /** Distance along the path of sample i (m). */
  s: Float64Array;
  /** Squared stop reach of each fielding class when the stroke is at sample i: on his feet (reach plus the ground he has covered) or with a dive at full parry stretch (fielding.ts diveReachM). */
  reach2: Record<FielderClass, Float64Array>;
}

let strokeTables: StrokeTables | null = null;

/** The stroke's path, timed, and every class's reach along it (built on first use: fielding.ts initialises first). */
function tables(): StrokeTables {
  if (strokeTables) return strokeTables;
  const v0 = INTENT_STROKE_KPH / 3.6;
  const tStop = dlog((v0 + ROLL_C) / ROLL_C) / ROLL_K;
  const sStop = rolledM(v0, tStop);
  const n = Math.floor(Math.min(sStop, 2 * BOUNDARY_R) / INTENT_STEP_M) + 1;
  const s = new Float64Array(n);
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = i * INTENT_STEP_M;
    t[i] = rollSeconds(v0, s[i], tStop);
  }
  const reach2 = {} as Record<FielderClass, Float64Array>;
  for (const c of Object.keys(ATHLETICS) as FielderClass[]) {
    const a = ATHLETICS[c];
    const r = new Float64Array(n);
    const parry = diveLengths(a).parry;
    for (let i = 0; i < n; i++) {
      // A parried ball is reached too (fielding.ts PARRY_M): it protects, if not cleanly.
      const reach = Math.max(a.stopReachM + coverable(a, t[i]), diveReachM(a, t[i], parry, a.stopReachM));
      r[i] = reach * reach;
    }
    reach2[c] = r;
  }
  strokeTables = { s, reach2 };
  return strokeTables;
}

/** Distance from the striker along the unit ground direction (ux, uz) to where a fielder can still take the ball inside the rope. */
function inRopeM(ux: number, uz: number): number {
  const R = BOUNDARY_R - ROPE_MARGIN_M;
  const b = STRIKER_REF.x * ux + STRIKER_REF.z * uz;
  const c = STRIKER_REF.x * STRIKER_REF.x + STRIKER_REF.z * STRIKER_REF.z - R * R;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

/** Whether a fielder can stop the stroke hit along `bearing` anywhere on its path inside the rope (the fielding model's stop rule). */
function stops(f: Fielder, cls: FielderClass, bearing: number): boolean {
  const tb = tables();
  const ux = dsin(bearing * DEG);
  const uz = -dcos(bearing * DEG);
  const sMax = inRopeM(ux, uz);
  const r2 = tb.reach2[cls];
  const ox = STRIKER_REF.x - f.x;
  const oz = STRIKER_REF.z - f.z;
  for (let i = 1; i < tb.s.length; i++) {
    const s = tb.s[i];
    if (s > sMax) break;
    const dx = ox + s * ux;
    const dz = oz + s * uz;
    // The keeper fields a ground ball only near where he stands (fielding.ts KEEPER_RANGE_M).
    if (cls === 'keeper' && dx * dx + dz * dz > KEEPER_RANGE_M * KEEPER_RANGE_M) continue;
    if (dx * dx + dz * dz <= r2[i]) return true;
  }
  return false;
}

/** The arc (unwrapped bearings, lo < hi) a fielder covers around his own bearing, or null when he covers none. */
function fielderArc(f: Fielder): { lo: number; hi: number } | null {
  const cls = fielderClass(f);
  const own = bearingFromStriker(f.x, f.z);
  if (!stops(f, cls, own)) return null;
  const edge = (dir: 1 | -1): number => {
    let inside = own;
    let outside = own;
    let found = false;
    for (let j = 1; j * INTENT_SCAN_DEG <= 180; j++) {
      const b = own + dir * j * INTENT_SCAN_DEG;
      if (!stops(f, cls, b)) {
        outside = b;
        found = true;
        break;
      }
      inside = b;
    }
    if (!found) return own + dir * 180;
    for (let k = 0; k < 24; k++) {
      const mid = (inside + outside) / 2;
      if (stops(f, cls, mid)) inside = mid;
      else outside = mid;
    }
    return inside;
  };
  return { lo: edge(-1), hi: edge(1) };
}

/** A bearing rounded to the arcs' 0.1° resolution (12.3, never 12.299999). */
const tidy = (b: number) => Math.round(b * 10) / 10;

/** Split an unwrapped arc at ±180 into arcs inside [−180, 180]. */
function wrapArc(lo: number, hi: number): Array<[number, number]> {
  if (hi - lo >= 360) return [[-180, 180]];
  let a = lo;
  let b = hi;
  while (a < -180) {
    a += 360;
    b += 360;
  }
  while (a >= 180) {
    a -= 360;
    b -= 360;
  }
  if (b <= 180) return [[a, b]];
  return [
    [a, 180],
    [-180, b - 360],
  ];
}

/** Sort and merge overlapping (or touching) arcs; drop empty ones. */
function mergeArcs(arcs: Array<[number, number]>): Array<[number, number]> {
  const xs = arcs.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of xs) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The bearings in [−180, 180] that none of the (merged, sorted) arcs cover. */
function complementArcs(merged: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = -180;
  for (const [a, b] of merged) {
    if (a > from) out.push([from, a]);
    if (b > from) from = b;
  }
  if (from < 180) out.push([from, 180]);
  return out;
}

/** The parts of `arcs` inside (`keep` = true) or outside (`keep` = false) the merged `mask`. */
function intersectArcs(arcs: Array<[number, number]>, mask: Array<[number, number]>, keep: boolean): Array<[number, number]> {
  const inside: Array<[number, number]> = [];
  for (const [a, b] of arcs) for (const [m, n] of mask) if (Math.min(b, n) > Math.max(a, m)) inside.push([Math.max(a, m), Math.min(b, n)]);
  if (keep) return mergeArcs(inside);
  const out: Array<[number, number]> = [];
  for (const [a, b] of arcs) {
    let from = a;
    for (const [m, n] of mergeArcs(inside)) {
      if (n <= from || m >= b) continue;
      if (m > from) out.push([from, m]);
      from = Math.max(from, n);
    }
    if (from < b) out.push([from, b]);
  }
  return out;
}

/** Roles in catching positions (the contract's "attacking" fielders). */
const CATCHING_ROLES: ReadonlySet<FielderRole> = new Set<FielderRole>(['keeper', 'slip', 'gully', 'short_leg', 'silly_point', 'leg_slip']);

/** What the intention is read from: the catchers, the boundary riders, the keeper's depth. */
export interface FieldFeatures {
  /** Slips and gullies (catchers behind the bat on the off side). */
  offCatchers: number;
  /** Short leg and leg slip. */
  legCatchers: number;
  sillyPoints: number;
  /** Keeper standing up (within 3 m of the stumps). */
  keeperUp: boolean;
  /** Boundary riders (fielding.ts class 'deep') in front of square (|bearing| < 80°). */
  deepInFront: number;
  /** Boundary riders on the leg side at or behind square (bearing ≤ −80°): the hook and the pull. */
  deepLegBehindSquare: number;
  /** All the boundary riders. */
  deep: number;
}

export function fieldFeatures(layout: FieldLayout): FieldFeatures {
  const out: FieldFeatures = { offCatchers: 0, legCatchers: 0, sillyPoints: 0, keeperUp: false, deepInFront: 0, deepLegBehindSquare: 0, deep: 0 };
  for (const f of layout.fielders) {
    if (f.role === 'slip' || f.role === 'gully') out.offCatchers++;
    else if (f.role === 'short_leg' || f.role === 'leg_slip') out.legCatchers++;
    else if (f.role === 'silly_point') out.sillyPoints++;
    else if (f.role === 'keeper') out.keeperUp = f.z - PITCH_HALF < 3;
    if (fielderClass(f) !== 'deep') continue;
    out.deep++;
    const b = bearingFromStriker(f.x, f.z);
    if (Math.abs(b) < 80) out.deepInFront++;
    if (b <= -80) out.deepLegBehindSquare++;
  }
  return out;
}

/**
 * The plan behind a field, from its features (first rule that applies):
 *   1. spin_close_catchers     a short leg, leg slip or silly point, for a spinner or with the keeper up;
 *   2. attack_outside_off      three or more slips and gullies;
 *   3. short_ball_trap         pace with two boundary riders at or behind square on the leg side, or a leg-side catcher
 *                              with one of them;
 *   4. attack_outside_off      pace on a green pitch with two slips and gullies;
 *   5. yorker_and_boundaries   pace with no slip or gully and two or more boundary riders in front of square;
 *   6. protect_boundaries      two or more boundary riders in front of square, or four or more out (the white-ball
 *                              field);
 *   7. attack_the_stumps       pace with a short leg or leg slip (catchers for the straight ball), or a silly point
 *                              with at most one slip;
 *   8. save_singles            otherwise: a ring saving the single, with at most a slip or two and men back only
 *                              behind square.
 */
export function fieldIntention(layout: FieldLayout, bowler: BowlerProfile, conditions: PitchCondition): FieldIntention {
  const x = fieldFeatures(layout);
  const spin = bowler.family === 'spin';
  if (x.legCatchers + x.sillyPoints > 0 && (spin || x.keeperUp)) return 'spin_close_catchers';
  if (x.offCatchers >= 3) return 'attack_outside_off';
  if (!spin && (x.deepLegBehindSquare >= 2 || (x.legCatchers > 0 && x.deepLegBehindSquare >= 1))) return 'short_ball_trap';
  if (!spin && conditions === 'green' && x.offCatchers >= 2) return 'attack_outside_off';
  if (!spin && x.offCatchers === 0 && x.deepInFront >= 2) return 'yorker_and_boundaries';
  if (x.deepInFront >= 2 || x.deep >= 4) return 'protect_boundaries';
  if ((!spin && x.legCatchers > 0) || (x.sillyPoints > 0 && x.offCatchers <= 1)) return 'attack_the_stumps';
  return 'save_singles';
}

/**
 * What a field is set to do (src/contracts/practice.ts FieldIntent), shown before the over and on the radar.
 *
 *   attacking   the ids of the fielders in catching positions (keeper, slips, gully, short leg, silly point, leg
 *               slip), in layout order;
 *   protected   the arcs where a fielder stops a well-hit ground stroke (INTENT_STROKE_KPH, rolling from the striker)
 *               anywhere on its path inside the rope, by the fielding model's own stop rule (reaction, sprint,
 *               reach on his feet or, once he has reacted, diving): merged per depth, 'ring' for every fielder within
 *               38 m (close catchers, keeper and bowler included) and 'deep' for the boundary riders;
 *   gaps        the bearings the ring does not protect, split into 'deep' (no boundary rider protects them either:
 *               the stroke beats everybody) and 'ring' (it beats the ring, but a boundary rider cuts it off), each
 *               with the region of its middle bearing (scoring.ts regionOf);
 *   intention   fieldIntention() above.
 *
 * Arcs are bearings from the striker in the batter's (physics) frame, rounded to 0.1°, split at ±180° (fromDeg < toDeg),
 * protected sorted ring first then by bearing, gaps by bearing. The arcs depend on the fielders alone (the outfield is
 * the same on every pitch); the bowler (mirrored into the striker's frame, as autoField does) and the pitch only read
 * the intention. Deterministic: vec.ts arithmetic only.
 */
export function fieldIntent(layout: FieldLayout, bowler: BowlerProfile, conditions: PitchCondition, handedness: Handedness = 'right'): FieldIntent {
  const b = physicsBowler(bowler, handedness);
  const ring: Array<[number, number]> = [];
  const deep: Array<[number, number]> = [];
  for (const f of layout.fielders) {
    const arc = fielderArc(f);
    if (!arc) continue;
    for (const [lo, hi] of wrapArc(tidy(arc.lo), tidy(arc.hi))) (fielderClass(f) === 'deep' ? deep : ring).push([tidy(lo), tidy(hi)]);
  }
  const ringArcs = mergeArcs(ring);
  const deepArcs = mergeArcs(deep);
  const holes = complementArcs(ringArcs);
  const cutOff = intersectArcs(holes, deepArcs, true);
  const open = intersectArcs(holes, deepArcs, false);
  const arc = (depth: FieldArc['depth']) => ([fromDeg, toDeg]: [number, number]): FieldArc => ({ fromDeg, toDeg, depth });
  const gaps = [...cutOff.map(arc('ring')), ...open.map(arc('deep'))]
    .filter((g) => g.toDeg > g.fromDeg)
    .sort((p, q) => p.fromDeg - q.fromDeg)
    .map((g) => ({ ...g, region: regionOf((g.fromDeg + g.toDeg) / 2) }));
  return {
    intention: fieldIntention(layout, b, conditions),
    attacking: layout.fielders.filter((f) => CATCHING_ROLES.has(f.role)).map((f) => f.id),
    protected: [...ringArcs.map(arc('ring')), ...deepArcs.map(arc('deep'))],
    gaps,
  };
}
