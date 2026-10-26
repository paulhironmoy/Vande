/**
 * Engine-driven players (engine v1): Auto Over, Auto XI, Practice Ghosts and the Daily Six setter. Every choice is a
 * deterministic function of its seed; gestures and swipes are synthesised to look like a real device and always pass
 * the same validation as human input.
 */
import type {
  BattingInput,
  Conditions,
  DeliveryPlan,
  DeliveryVariant,
  FieldSetting,
  FieldZone,
  GhostProfile,
  Intensity,
  Intent,
  Length,
  Line,
  OverPlan,
  PitchId,
  RevealedDelivery,
  ShotType,
  WeatherId,
} from '@/contracts';
import { rngFromKey, type Sfc32 } from '../prng';
import { matchupOf, naturalZonesFor } from './model';
import { energyCost } from './plan';
import { FIELD_LAYOUTS, LEGAL_ZONES, METER, OVER_ENERGY_BUDGET, PITCHES, SUPER_BALL_ALLOWANCE, type AttackShot, type Coverage } from './tables';
import { synthBattingTrace, synthExecutionTrace } from './traces';

/** A delivery before its gesture is synthesised. */
export interface DeliverySpec {
  variant: DeliveryVariant;
  line: Line;
  length: Length;
  intensity: Intensity;
  intent: Intent;
}

const spec = (variant: DeliveryVariant, line: Line, length: Length, intensity: Intensity, intent: Intent): DeliverySpec => ({ variant, line, length, intensity, intent });

/** Lowers intensities (most expensive first, from the end of the over) until the over fits the energy budget. */
export function fitBudget(balls: DeliverySpec[], budget = OVER_ENERGY_BUDGET): DeliverySpec[] {
  const out = balls.map((b) => ({ ...b }));
  let total = out.reduce((s, b) => s + energyCost(b), 0);
  while (total > budget) {
    let idx = -1;
    let best = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      const c = energyCost(out[i]);
      if (out[i].intensity > 1 && c > best) {
        best = c;
        idx = i;
      }
    }
    if (idx < 0) {
      // Every ball already at change-up intensity: swap the most expensive variant for a good-length ball.
      let j = 0;
      for (let i = 1; i < out.length; i++) if (energyCost(out[i]) > energyCost(out[j])) j = i;
      out[j] = { ...out[j], variant: 'good_length', length: 'good' };
    } else out[idx] = { ...out[idx], intensity: (out[idx].intensity - 1) as Intensity };
    total = out.reduce((s, b) => s + energyCost(b), 0);
  }
  return out;
}

/** Brings a Super Ball within its allowance (lower intensity first, then a stock good-length ball). */
export function fitSuperBall(d: DeliverySpec): DeliverySpec {
  let out = { ...d };
  while (energyCost(out) > SUPER_BALL_ALLOWANCE && out.intensity > 1) out = { ...out, intensity: (out.intensity - 1) as Intensity };
  if (energyCost(out) > SUPER_BALL_ALLOWANCE) out = { ...out, variant: 'good_length', length: 'good', intensity: 2 };
  return out;
}

/** Release time for a bowler with timing spread `sigma` ms (deterministic). */
export function releaseFor(rng: Sfc32, sigma: number, maxError = 400): number {
  let err = rng.normal() * sigma;
  if (err > maxError) err = maxError;
  if (err < -maxError) err = -maxError;
  return Math.round((METER.sweetMs + err) * 10) / 10;
}

/** Turns delivery specs into a legal, gestured plan (budget and Super Ball allowance enforced). */
export function toPlan(rng: Sfc32, field: FieldSetting, balls: DeliverySpec[], superBall: DeliverySpec, sigma: number, maxError?: number): OverPlan {
  const fitted = fitBudget(balls);
  const sb = fitSuperBall(superBall);
  const withGesture = (d: DeliverySpec): DeliveryPlan => ({ ...d, gesture: synthExecutionTrace(rng, releaseFor(rng, sigma, maxError)) });
  return { v: 1, field, balls: fitted.map(withGesture) as OverPlan['balls'], superBall: withGesture(sb) };
}

// ---------------------------------------------------------------------------------------------------------------
// Batting helpers
// ---------------------------------------------------------------------------------------------------------------

/** Typical run-up duration the client shows before the release (only used to fill clientElapsedMs plausibly). */
const CLIENT_RUN_UP_MS = 1800;

/** Builds a valid batting input with a plausible swipe for `shot` → `zone`, tapped at `tapMs`. */
export function battingInputFor(rng: Sfc32, delivery: RevealedDelivery, shot: ShotType, zone: FieldZone | null, tapMs: number | null): BattingInput {
  const z = shot === 'defend' || shot === 'leave' ? null : zone;
  const late = delivery.timing.releaseToContactMs + 590;
  const tap = tapMs === null ? null : Math.round(Math.min(late, Math.max(0, tapMs)) * 10) / 10;
  if (tap === null || shot === 'leave') {
    return {
      v: 1,
      ball: delivery.ball,
      shot,
      zone: z,
      tapMs: null,
      trace: synthBattingTrace(rng, null, 0, false),
      clientElapsedMs: CLIENT_RUN_UP_MS + delivery.timing.releaseToContactMs + 400 + Math.round(rng.float() * 200),
    };
  }
  const swipeMs = z ? 140 + rng.float() * 180 : 60 + rng.float() * 80;
  const trace = synthBattingTrace(rng, z, swipeMs, true);
  return { v: 1, ball: delivery.ball, shot, zone: z, tapMs: tap, trace, clientElapsedMs: Math.round(CLIENT_RUN_UP_MS + tap + 20 + rng.float() * 60) };
}

/** Tap time for a batter with timing spread `sigma` (and a bias, negative = early). */
export function tapFor(rng: Sfc32, delivery: RevealedDelivery, sigma: number, bias = 0): number {
  return delivery.timing.releaseToContactMs + bias + rng.normal() * sigma;
}

const GROUND_ROOM: Record<Coverage, number> = { gap: 0, deep: 1, ring: 2, both: 3 };
const LOFT_ROOM: Record<Coverage, number> = { gap: 0, ring: 1, deep: 2, both: 3 };

/** A natural zone for the shot against this delivery: the emptiest one when the field is known, else by preference. */
export function naturalZone(shot: ShotType, d: Pick<RevealedDelivery, 'variant' | 'line' | 'length'>, prefs: readonly FieldZone[] = [], field?: FieldSetting): FieldZone | null {
  if (shot === 'defend' || shot === 'leave') return null;
  const natural = naturalZonesFor(shot as AttackShot, d).filter((z) => LEGAL_ZONES[shot].includes(z));
  const pool = natural.length ? natural : LEGAL_ZONES[shot];
  if (field) {
    const room = shot === 'loft' ? LOFT_ROOM : GROUND_ROOM;
    let best = pool[0];
    for (const z of pool) if (room[FIELD_LAYOUTS[field].zones[z]] < room[FIELD_LAYOUTS[field].zones[best]]) best = z;
    return best;
  }
  for (const p of prefs) if (pool.includes(p)) return p;
  return pool[0] ?? null;
}

/** What each shot is worth beyond its matchup (run potential), and how much a cautious batter prefers it. */
const SHOT_REWARD: Record<AttackShot, number> = { defend: -0.45, rotate: -0.15, drive: 0.05, cut_pull: 0.05, sweep: 0, loft: 0.05 };
const SHOT_SAFETY: Record<AttackShot, number> = { defend: 0.3, rotate: 0.2, drive: 0, cut_pull: -0.05, sweep: -0.1, loft: -0.3 };
const ATTACK_SHOTS: readonly AttackShot[] = ['defend', 'rotate', 'drive', 'cut_pull', 'sweep', 'loft'];

/**
 * A thinking batter's read of the delivery: the shot that suits it (matchup), weighed by run potential and appetite
 * for risk (`aggression` 0 cautious … 1 all-out) and a personal style, aimed at a natural zone (the emptiest one when
 * the field is known). Balls outside off stump that offer nothing are left. Used by Auto XI, ghosts and the simulation.
 */
export function readShot(
  d: RevealedDelivery,
  aggression: number,
  rng: Sfc32,
  opts: { prefs?: readonly FieldZone[]; field?: FieldSetting; style?: Partial<Record<AttackShot, number>> } = {},
): { shot: ShotType; zone: FieldZone | null } {
  let best: { shot: AttackShot; zone: FieldZone | null; score: number } | null = null;
  for (const shot of ATTACK_SHOTS) {
    const zone = naturalZone(shot, d, opts.prefs, opts.field);
    const { m } = matchupOf(shot, zone, { variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: 'attack' });
    const score = m + SHOT_REWARD[shot] + (1 - aggression) * SHOT_SAFETY[shot] + (opts.style?.[shot] ?? 0) + (rng.float() - 0.5) * 0.12;
    if (!best || score > best.score) best = { shot, zone, score };
  }
  const b = best as { shot: AttackShot; zone: FieldZone | null; score: number };
  // In a one-over game you must score: leave only a ball outside off that offers nothing, or a wide bouncer when cautious.
  const outside = d.line === 'wide_off' || (d.line === 'off' && (d.variant === 'outswing' || d.variant === 'legspin'));
  if (outside && b.shot !== 'cut_pull' && b.score < -0.15 + 0.15 * (1 - aggression)) return { shot: 'leave', zone: null };
  if (d.variant === 'bouncer' && d.line === 'wide_off' && aggression < 0.5) return { shot: 'leave', zone: null };
  return { shot: b.shot, zone: b.zone };
}

// ---------------------------------------------------------------------------------------------------------------
// Auto Over and Auto XI
// ---------------------------------------------------------------------------------------------------------------

type OverSpec = { field: FieldSetting; balls: DeliverySpec[]; superBall: DeliverySpec };

/** Balanced, starter-only overs (always legal whatever the player has unlocked), adapted to the pitch. */
const AUTO_TEMPLATES: Record<PitchId, OverSpec> = {
  green: {
    field: 'balanced',
    balls: [
      spec('good_length', 'off', 'good', 2, 'contain'),
      spec('good_length', 'off', 'full', 2, 'setup'),
      spec('bouncer', 'middle', 'short', 2, 'attack'),
      spec('good_length', 'wide_off', 'good', 2, 'contain'),
      spec('offspin', 'off', 'good', 2, 'contain'),
      spec('yorker', 'middle', 'full', 1, 'attack'),
    ],
    superBall: spec('yorker', 'middle', 'full', 1, 'attack'),
  },
  hard: {
    field: 'balanced',
    balls: [
      spec('good_length', 'off', 'good', 2, 'contain'),
      spec('bouncer', 'middle', 'short', 2, 'setup'),
      spec('yorker', 'middle', 'full', 1, 'attack'),
      spec('good_length', 'wide_off', 'good', 2, 'contain'),
      spec('good_length', 'middle', 'full', 2, 'attack'),
      spec('good_length', 'off', 'good', 1, 'contain'),
    ],
    superBall: spec('yorker', 'off', 'full', 1, 'attack'),
  },
  slow: {
    field: 'balanced',
    balls: [
      spec('offspin', 'off', 'good', 2, 'contain'),
      spec('good_length', 'middle', 'good', 2, 'contain'),
      spec('bouncer', 'middle', 'short', 2, 'attack'),
      spec('offspin', 'middle', 'full', 2, 'contain'),
      spec('good_length', 'off', 'good', 2, 'contain'),
      spec('yorker', 'middle', 'full', 1, 'attack'),
    ],
    superBall: spec('offspin', 'middle', 'good', 3, 'attack'),
  },
};

export function autoOver(seed: string, conditions: Conditions): OverPlan {
  const rng = rngFromKey(`vande/v1/auto-over|${seed}|${conditions.pitch}|${conditions.weather}`);
  const t = AUTO_TEMPLATES[conditions.pitch] ?? AUTO_TEMPLATES.green;
  // Deliberately ordinary: an average release and no set-ups, so missing the deadline is never an advantage.
  return toPlan(rng, t.field, t.balls.map((b) => (b.intent === 'setup' ? { ...b, intent: 'contain' as const } : b)), t.superBall, 50);
}

/**
 * Auto XI: a cautious stand-in. When the field is known (it is visible to every batter) it aims at a gap half of the
 * time; its timing is deliberately ordinary, so batting yourself is always better.
 */
export function autoBat(seed: string, delivery: RevealedDelivery, field?: FieldSetting): BattingInput {
  const rng = rngFromKey(`vande/v1/auto-bat|${seed}|${delivery.ball}|${delivery.variant}|${delivery.line}|${delivery.length}`);
  const aware = field !== undefined && rng.float() < AUTO_XI_FIELD_SENSE;
  const { shot, zone } = readShot(delivery, delivery.ball >= 5 ? 0.7 : 0.35, rng, { prefs: ['mid_on', 'mid_off', 'cover', 'square_leg', 'point'], field: aware ? field : undefined });
  return battingInputFor(rng, delivery, shot, zone, tapFor(rng, delivery, field === undefined ? 55 : AUTO_XI_TIMING_SIGMA));
}
const AUTO_XI_FIELD_SENSE = 0.5;
const AUTO_XI_TIMING_SIGMA = 75;

// ---------------------------------------------------------------------------------------------------------------
// Practice Ghosts
// ---------------------------------------------------------------------------------------------------------------

interface GhostStyle {
  profile: GhostProfile;
  /** Bowling execution spread (ms around the sweet spot). */
  execSigma: number;
  /** Batting timing spread (ms). */
  timingSigma: number;
  aggression: number;
  /** How often the ghost reads the field and aims at the gap when the field is known (the rest: favourite zones). */
  fieldSense: number;
  /** Preferred shots (added to the read). */
  style: Partial<Record<AttackShot, number>>;
  zonePrefs: readonly FieldZone[];
  plan(pitch: PitchId, weather: WeatherId, rng: Sfc32): OverSpec;
}

const pickLine = (rng: Sfc32, lines: readonly Line[]): Line => rng.pick(lines);

const GHOST_STYLES: readonly GhostStyle[] = [
  {
    // The Anchor: tidy, patient, never gives the ball away; bats like a wall and nudges singles.
    profile: { id: 'anchor', nameKey: 'ghost.anchor.name', styleKey: 'ghost.anchor.style', difficulty: 1 },
    execSigma: 50,
    timingSigma: 66,
    aggression: 0.25,
    fieldSense: 0.2,
    style: { defend: 0.1, rotate: 0.15 },
    zonePrefs: ['mid_on', 'mid_off', 'cover', 'square_leg'],
    plan: (pitch, _w, rng) => ({
      field: 'balanced',
      balls: [0, 1, 2, 3, 4, 5].map((i) =>
        pitch === 'slow' && i % 2 === 0 ? spec('offspin', pickLine(rng, ['off', 'middle']), 'good', 2, 'contain') : spec('good_length', pickLine(rng, ['off', 'off', 'middle']), 'good', 2, 'contain'),
      ),
      superBall: spec('good_length', 'off', 'good', 3, 'contain'),
    }),
  },
  {
    // The Swinger: hoops it both ways with an attacking field; drives handsomely, leaves well outside off.
    profile: { id: 'swinger', nameKey: 'ghost.swinger.name', styleKey: 'ghost.swinger.style', difficulty: 2 },
    execSigma: 40,
    timingSigma: 62,
    aggression: 0.45,
    fieldSense: 0.4,
    style: { drive: 0.12 },
    zonePrefs: ['cover', 'mid_off', 'mid_on', 'point'],
    plan: (pitch, weather, rng) => {
      const swingy = pitch === 'green' || weather === 'humid';
      const out = rng.float() < 0.5;
      return {
        field: swingy ? 'attacking' : 'balanced',
        balls: [
          spec(out ? 'outswing' : 'inswing', 'off', 'full', 2, 'setup'),
          spec(out ? 'inswing' : 'outswing', 'middle', 'full', 2, 'attack'),
          spec('good_length', 'off', 'good', 2, 'contain'),
          spec('outswing', 'off', 'good', 2, 'setup'),
          spec('inswing', 'middle', 'good', 2, 'attack'),
          spec('good_length', 'wide_off', 'good', 1, 'contain'),
        ],
        superBall: spec('inswing', 'middle', 'full', 2, 'attack'),
      };
    },
  },
  {
    // The Enforcer: express bouncers and yorkers to a sweeper field; swings hard at everything.
    profile: { id: 'enforcer', nameKey: 'ghost.enforcer.name', styleKey: 'ghost.enforcer.style', difficulty: 2 },
    execSigma: 30,
    timingSigma: 40,
    aggression: 0.9,
    fieldSense: 0.4,
    style: { loft: 0.15, cut_pull: 0.1 },
    zonePrefs: ['midwicket', 'mid_on', 'square_leg', 'cover'],
    plan: (pitch, _w, rng) => ({
      field: pitch === 'hard' ? 'sweeper' : 'balanced',
      balls: [
        spec('bouncer', 'middle', 'short', 3, 'setup'),
        spec('yorker', 'middle', 'full', 2, 'attack'),
        spec('good_length', pickLine(rng, ['off', 'wide_off']), 'good', 1, 'contain'),
        spec('bouncer', 'leg', 'short', 2, 'setup'),
        spec('slower', 'off', pitch === 'slow' ? 'good' : 'full', 2, 'attack'),
        spec('good_length', 'off', 'good', 1, 'contain'),
      ],
      superBall: spec('bouncer', 'middle', 'short', 2, 'attack'),
    }),
  },
  {
    // The Trickster: spin, slower balls and set-ups; sweeps and places the ball into gaps.
    profile: { id: 'trickster', nameKey: 'ghost.trickster.name', styleKey: 'ghost.trickster.style', difficulty: 3 },
    execSigma: 30,
    timingSigma: 42,
    aggression: 0.6,
    fieldSense: 0.7,
    style: { sweep: 0.05, drive: 0.05, rotate: 0.05 },
    zonePrefs: ['square_leg', 'midwicket', 'fine_leg', 'cover', 'point'],
    plan: (pitch, weather, rng) => {
      const spinFriendly = pitch === 'slow' || (pitch === 'hard' && weather !== 'dew');
      return {
        field: 'balanced',
        balls: spinFriendly
          ? [
              spec('offspin', 'off', 'good', 2, 'setup'),
              spec('legspin', 'middle', 'good', 2, 'attack'),
              spec('slower', 'off', 'good', 2, 'contain'),
              spec('offspin', 'middle', 'good', 3, 'setup'),
              spec('legspin', pickLine(rng, ['off', 'middle']), 'good', 3, 'attack'),
              spec('offspin', 'middle', 'full', 1, 'contain'),
            ]
          : [
              spec('slower', 'off', 'good', 2, 'setup'),
              spec('yorker', 'middle', 'full', 2, 'attack'),
              spec('offspin', 'off', 'good', 2, 'contain'),
              spec('good_length', 'off', 'good', 2, 'setup'),
              spec('legspin', 'middle', 'good', 2, 'attack'),
              spec('good_length', 'wide_off', 'good', 1, 'contain'),
            ],
        superBall: spec('slower', 'middle', 'full', 2, 'attack'),
      };
    },
  },
  {
    // The Maestro: reads the pitch perfectly, bowls the right plan for it and bats with precise timing.
    profile: { id: 'maestro', nameKey: 'ghost.maestro.name', styleKey: 'ghost.maestro.style', difficulty: 3 },
    execSigma: 60,
    timingSigma: 62,
    aggression: 0.55,
    fieldSense: 0.9,
    style: {},
    zonePrefs: ['mid_off', 'midwicket', 'cover', 'fine_leg', 'third_man'],
    plan: (pitch, weather, rng) => {
      if (pitch === 'green')
        return {
          field: 'attacking',
          balls: [
            spec('outswing', 'off', 'good', 2, 'setup'),
            spec('inswing', 'middle', 'full', 2, 'attack'),
            spec('good_length', 'off', 'good', 2, 'contain'),
            spec('good_length', 'wide_off', 'good', 2, 'setup'),
            spec('yorker', 'middle', 'full', 1, 'attack'),
            spec('offspin', 'off', 'good', 1, 'contain'),
          ],
          superBall: spec('yorker', 'middle', 'full', 1, 'attack'),
        };
      if (pitch === 'hard')
        return {
          field: 'sweeper',
          balls: [
            spec('bouncer', 'middle', 'short', 3, 'setup'),
            spec('yorker', 'off', 'full', 2, 'attack'),
            spec('good_length', 'wide_off', 'good', 1, 'contain'),
            spec('bouncer', 'leg', 'short', 2, 'setup'),
            spec('slower', 'off', 'good', 1, 'attack'),
            spec('offspin', 'off', 'good', 1, 'contain'),
          ],
          superBall: spec('bouncer', 'middle', 'short', 2, 'attack'),
        };
      return {
        field: 'balanced',
        balls: [
          spec('legspin', 'middle', 'good', 2, 'setup'),
          spec('offspin', 'off', 'good', 3, 'attack'),
          spec('slower', 'middle', 'good', 2, 'contain'),
          spec('offspin', 'middle', 'good', 1, 'setup'),
          spec(weather === 'dew' ? 'yorker' : 'legspin', 'middle', weather === 'dew' ? 'full' : 'good', 2, 'attack'),
          spec('offspin', pickLine(rng, ['off', 'middle']), 'good', 2, 'contain'),
        ],
        superBall: spec('offspin', 'middle', 'good', 3, 'attack'),
      };
    },
  },
];

export const GHOSTS: readonly GhostProfile[] = GHOST_STYLES.map((g) => g.profile);

function ghostStyle(ghostId: string): GhostStyle {
  const g = GHOST_STYLES.find((s) => s.profile.id === ghostId);
  if (!g) throw new Error(`engine: unknown ghost ${ghostId}`);
  return g;
}

export function ghostPlan(ghostId: string, seed: string, conditions: Conditions): OverPlan {
  const g = ghostStyle(ghostId);
  const rng = rngFromKey(`vande/v1/ghost-plan|${ghostId}|${seed}|${conditions.pitch}|${conditions.weather}`);
  const p = g.plan(conditions.pitch, conditions.weather, rng);
  return toPlan(rng, p.field, p.balls, p.superBall, g.execSigma);
}

/** A ghost's shot for a delivery; with `field` it aims at the gaps like a thinking batter (difficulty comes from timing). */
export function ghostBat(ghostId: string, seed: string, delivery: RevealedDelivery, field?: FieldSetting): BattingInput {
  const g = ghostStyle(ghostId);
  const rng = rngFromKey(`vande/v1/ghost-bat|${ghostId}|${seed}|${delivery.ball}`);
  const lastBall = delivery.ball >= 5;
  const aware = field !== undefined && rng.float() < g.fieldSense;
  const { shot, zone } = readShot(delivery, lastBall ? Math.max(g.aggression, 0.85) : g.aggression, rng, { prefs: g.zonePrefs, style: g.style, field: aware ? field : undefined });
  return battingInputFor(rng, delivery, shot, zone, tapFor(rng, delivery, g.timingSigma));
}

// ---------------------------------------------------------------------------------------------------------------
// Daily Six
// ---------------------------------------------------------------------------------------------------------------

/** Days since 1970-01-01 for a YYYY-MM-DD string (pure integer arithmetic); 0 for anything else. */
export function dayIndex(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const yy = mo <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const DAILY_STYLES: ReadonlyArray<(pitch: PitchId, rng: Sfc32) => OverSpec> = [
  // A: pace and bounce.
  (pitch, rng) => ({
    field: pitch === 'hard' ? 'sweeper' : 'balanced',
    balls: [
      spec('good_length', pickLine(rng, ['off', 'middle']), 'good', 2, 'contain'),
      spec('bouncer', 'middle', 'short', 2, 'setup'),
      spec('yorker', 'middle', 'full', 1, 'attack'),
      spec('good_length', 'wide_off', 'good', 1, 'contain'),
      spec(pitch === 'slow' ? 'slower' : 'bouncer', pitch === 'slow' ? 'off' : 'wide_off', pitch === 'slow' ? 'good' : 'short', 2, 'setup'),
      spec('yorker', 'off', 'full', 1, 'attack'),
    ],
    superBall: spec('yorker', 'middle', 'full', 1, 'attack'),
  }),
  // B: movement and variety.
  (pitch, rng) => ({
    field: pitch === 'green' ? 'attacking' : 'balanced',
    balls: [
      spec('outswing', 'off', 'full', 2, 'setup'),
      spec('inswing', 'middle', 'full', 2, 'attack'),
      spec('good_length', pickLine(rng, ['off', 'wide_off']), 'good', 2, 'contain'),
      spec('slower', 'off', 'good', 2, 'setup'),
      spec(pitch === 'slow' ? 'offspin' : 'good_length', 'middle', 'good', 2, 'attack'),
      spec('offspin', 'off', 'good', 1, 'contain'),
    ],
    superBall: spec('inswing', 'middle', 'full', 2, 'attack'),
  }),
  // C: spin and guile.
  (pitch, rng) => ({
    field: 'balanced',
    balls: [
      spec('offspin', 'off', 'good', 2, 'contain'),
      spec('legspin', 'middle', 'good', 1, 'setup'),
      spec('offspin', 'middle', 'good', 2, 'attack'),
      spec(pitch === 'slow' ? 'legspin' : 'slower', 'off', 'good', 2, 'setup'),
      spec(pitch === 'green' ? 'good_length' : 'offspin', 'middle', 'good', 2, 'attack'),
      spec('legspin', pickLine(rng, ['off', 'middle']), 'good', 2, 'contain'),
    ],
    superBall: spec('offspin', 'middle', 'good', 3, 'attack'),
  }),
];

/**
 * Daily Six. With the server's secret `serverSalt` the conditions and all three overs are unpredictable from the client
 * bundle (each pitch still appears once in every block of three days, in a secret order). Without a salt this is the
 * deterministic practice version a client can build offline.
 */
export function dailyChallenge(day: string, serverSalt?: string): { conditions: Conditions; overs: [OverPlan, OverPlan, OverPlan] } {
  const salted = typeof serverSalt === 'string' && serverSalt.length > 0;
  const rng = rngFromKey(salted ? `vande/v1/daily|${day}|${serverSalt}` : `vande/v1/daily|${day}`);
  const idx = dayIndex(day);
  const slot = ((idx % 3) + 3) % 3;
  let pitch: PitchId = PITCHES[slot];
  if (salted) {
    const order = [0, 1, 2];
    const shuffle = rngFromKey(`vande/v1/daily-pitch|${Math.floor(idx / 3)}|${serverSalt}`);
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(shuffle.float() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    pitch = PITCHES[order[slot]];
  }
  const w = rng.float();
  const weather: WeatherId = w < 0.5 ? 'clear' : w < 0.75 ? 'humid' : 'dew';
  const conditions: Conditions = { pitch, weather };
  const overs = DAILY_STYLES.map((style) => {
    const p = style(pitch, rng);
    // The daily setter is consistent: always good or perfect, never a hidden loose ball.
    return toPlan(rng, p.field, p.balls, p.superBall, 25, 60);
  }) as [OverPlan, OverPlan, OverPlan];
  return { conditions, overs };
}
