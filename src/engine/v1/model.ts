/**
 * The Sealed Six outcome model (engine v1). For one ball it builds the complete probability distribution over
 * results ("atoms") from: the shot-vs-delivery matchup, timing, the bowler's execution, pitch and weather, the field
 * in the target zone, shot risk, sequencing (setup bonus, repeated balls) and the innings situation (new batter, last
 * ball). A single seeded draw then picks one atom. Because the distribution is explicit, expected values can be
 * computed exactly (tactical efficiency, oracle policies, balance tuning).
 *
 * Stage 1 decides contact (middle, thick edge, thin edge, pad, clean miss, or none for a leave); stage 2 decides the
 * result given that contact. Only basic arithmetic is used, so every engine computes identical probabilities.
 */
import type { Conditions, Contact, DeliveryPlan, ExecutionGrade, FieldSetting, FieldZone, Runs, ShotType, TimingGrade, WicketKind } from '@/contracts';
import * as T from './tables';
import type { AttackShot, Coverage } from './tables';

export type DeliveryCore = Omit<DeliveryPlan, 'gesture'>;

/** The previous main-innings delivery, for setup and repetition. */
export interface PrevBall {
  variant: DeliveryCore['variant'];
  line: DeliveryCore['line'];
  length: DeliveryCore['length'];
  intensity: DeliveryCore['intensity'];
  intent: DeliveryCore['intent'];
  grade: ExecutionGrade;
}

export interface BallContext {
  /** 0–5, or 6 for the Super Ball. */
  ball: number;
  superBall: boolean;
  /** Ball 6 of the main innings, or the Super Ball: the batters run on anything. */
  lastBall: boolean;
  /** First ball faced by this batter (the first ball of the innings, or the ball after a wicket). */
  newBatter: boolean;
  prev: PrevBall | null;
  /** How many immediately preceding deliveries had the same variant and length (0–2+). */
  repeats: number;
}

export interface ModelInput {
  d: DeliveryCore;
  grade: ExecutionGrade;
  shot: ShotType;
  zone: FieldZone | null;
  timing: TimingGrade;
  field: FieldSetting;
  cond: Conditions;
  ctx: BallContext;
  /**
   * Tools only (never set during play): replaces the intent's wicket/boundary multipliers, e.g. with their average
   * when computing what a batter can expect without knowing the sealed intent.
   */
  intentMult?: { wicket: number; boundary: number };
}

export type AtomKind = 'dot_block' | 'dot_beaten' | 'dot_fielded' | 'runs' | 'four' | 'six' | 'wicket';
/** Which part of the model produced the atom (used by explanations). */
export type AtomTag = 'gap' | 'ring' | 'deep' | 'both' | 'slips' | 'close' | 'stumps' | 'scramble' | 'leave' | 'edge' | 'block' | 'none';

export interface Atom {
  p: number;
  contact: Contact;
  runs: Runs;
  wicket: WicketKind | null;
  /** Fielder (zone) who stopped or caught the ball; null for the keeper, the cordon, stumps and boundaries. */
  fielder: FieldZone | null;
  /** Where the ball went. */
  zone: FieldZone | null;
  kind: AtomKind;
  /** Hit in the air (sixes, skied catches, one-bounce fours). */
  aerial: boolean;
  tag: AtomTag;
}

export interface Factors {
  matchup: number;
  timing: number;
  execution: number;
  pitch: number;
  field: number;
  setup: number;
  risk: number;
}

export interface Evaluation {
  atoms: Atom[];
  factors: Factors;
  /** Zone is natural for the shot and line. */
  natural: boolean;
  /** Batter advantage A (see tables.ts). */
  advantage: number;
  /** Probability of middling the ball. */
  pMiddle: number;
  /** Power of a middled shot. */
  power: number;
  /** 0..1: how strongly the previous setup ball sets this one up. */
  setupStrength: number;
  /** Probability the batter is out. */
  pWicket: number;
  /** Expected runs. */
  expectedRuns: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function lengthClass(variant: DeliveryCore['variant'], length: DeliveryCore['length']): 'full' | 'good' | 'short' {
  if (variant === 'yorker') return 'full';
  if (variant === 'bouncer') return 'short';
  return length;
}

/** Natural zones for a shot against this delivery ("play with the line"; short balls are hooked or upper-cut). */
export function naturalZonesFor(shot: AttackShot, d: Pick<DeliveryCore, 'variant' | 'line' | 'length'>): readonly FieldZone[] {
  if (shot === 'defend') return [];
  if (shot === 'loft' && lengthClass(d.variant, d.length) === 'short') return T.SHORT_LOFT_ZONES[d.line];
  return T.NATURAL_ZONES[shot][d.line];
}

/** Shot vs delivery, including "play with the line" for the target zone. */
export function matchupOf(shot: AttackShot, zone: FieldZone | null, d: DeliveryCore): { m: number; natural: boolean } {
  const family = T.FAMILY[d.variant];
  let m = T.LEN_SHOT[d.length][shot] + T.VAR_SHOT[d.variant][shot] + T.LINE_SHOT[d.line][shot];
  m += T.INTENSITY_SHOT[family === 'spin' ? 'spin' : 'pace'][d.intensity][shot];
  if (family === 'spin' && d.length === 'short') m += T.SPIN_LONG_HOP[shot];
  let natural = true;
  if (shot !== 'defend' && zone) {
    natural = naturalZonesFor(shot, d).includes(zone);
    if (!natural) m += T.AGAINST_LINE;
  }
  return { m: clamp(m, -1, 1), natural };
}

export function pitchEffect(d: DeliveryCore, shot: ShotType, cond: Conditions, ctx: BallContext): number {
  let p = T.PITCH_VAR[cond.pitch][d.variant];
  // Swing and seam need a full or good length; a short swing ball does not move.
  if (T.FAMILY[d.variant] === 'swing' && d.length === 'short' && p < 0) p *= T.SHORT_SWING_MULT;
  if (cond.pitch === 'green' && !ctx.superBall && T.NEW_BALL_VARIANTS.includes(d.variant)) p *= ctx.ball <= 2 ? T.NEW_BALL_MULT.early : T.NEW_BALL_MULT.late;
  p += T.WEATHER_VAR[cond.weather][d.variant] ?? 0;
  p += T.PITCH_SHOT[cond.pitch][shot] ?? 0;
  if (T.FAMILY[d.variant] !== 'spin' && d.intensity === 3) p += T.PITCH_EXPRESS[cond.pitch];
  return clamp(p, -1, 1);
}

export function executionEffect(grade: ExecutionGrade, d: DeliveryCore, shot: ShotType): number {
  if (grade === 'perfect') return clamp(T.PERFECT_EFFECT * T.PRECISION[d.variant], -1, 1);
  if (grade === 'loose') return clamp(T.LOOSE_EFFECT * T.LOOSE_SEVERITY[d.variant] * T.LOOSE_LINE[d.line] * T.LOOSE_SHOT[shot], -1, 1);
  return (T.GOOD_EFFECT[d.variant] ?? 0) * (shot === 'leave' ? 0 : T.LOOSE_SHOT[shot]);
}

function speedOf(d: { variant: DeliveryCore['variant']; intensity: DeliveryCore['intensity'] }): number {
  return T.SPEED_KPH[d.variant][d.intensity - 1];
}

/** Contrast between a setup ball and the next: length (short↔full), pace, movement direction, or line. */
export function contrasts(prev: PrevBall, d: DeliveryCore): boolean {
  const a = lengthClass(prev.variant, prev.length);
  const b = lengthClass(d.variant, d.length);
  if ((a === 'short' && b === 'full') || (a === 'full' && b === 'short')) return true;
  const dv = speedOf(prev) - speedOf(d);
  if (dv >= T.PACE_CONTRAST_KPH || dv <= -T.PACE_CONTRAST_KPH) return true;
  const pair = `${prev.variant}|${d.variant}`;
  if (pair === 'inswing|outswing' || pair === 'outswing|inswing' || pair === 'offspin|legspin' || pair === 'legspin|offspin') return true;
  const li = T.LINES.indexOf(prev.line) - T.LINES.indexOf(d.line);
  return li >= 2 || li <= -2;
}

export function sequenceEffect(d: DeliveryCore, ctx: BallContext): { s: number; setupStrength: number } {
  let s = 0;
  let setupStrength = 0;
  // A setup pays off only on the strike ball that follows it (intent attack), never in chains of setups.
  if (ctx.prev && ctx.prev.intent === 'setup' && ctx.prev.grade !== 'loose' && d.intent === 'attack') {
    if (contrasts(ctx.prev, d)) {
      s += T.SETUP_CONTRAST;
      setupStrength = 1;
    } else {
      s += T.SETUP_PLAIN;
      setupStrength = 0;
    }
  }
  s += T.REPEAT_EFFECT[ctx.repeats >= 3 ? 3 : ctx.repeats];
  return { s: clamp(s, -1, 1), setupStrength };
}

function edgeZone(d: DeliveryCore, zone: FieldZone | null): FieldZone {
  if (zone && T.OFF_SIDE_ZONES.includes(zone)) return 'third_man';
  return d.line === 'wide_off' || d.line === 'off' ? 'third_man' : 'fine_leg';
}

function pushZone(d: DeliveryCore): FieldZone {
  return d.line === 'wide_off' ? 'point' : d.line === 'off' ? 'cover' : d.line === 'middle' ? 'mid_on' : 'square_leg';
}

interface Part {
  p: number;
  runs: Runs;
  wicket: WicketKind | null;
  fielder: FieldZone | null;
  zone: FieldZone | null;
  kind: AtomKind;
  aerial: boolean;
  tag: AtomTag;
}

function part(p: number, runs: Runs, kind: AtomKind, zone: FieldZone | null, fielder: FieldZone | null, tag: AtomTag, aerial = false, wicket: WicketKind | null = null): Part {
  return { p, runs, wicket, fielder, zone, kind, aerial, tag };
}

const isBoundary = (x: Part) => x.kind === 'four' || x.kind === 'six';

/** Scale wicket parts by wm and boundary parts by bm, then rescale the rest so the parts sum to 1. */
function tilt(parts: Part[], wm: number, bm: number): Part[] {
  let adjusted = 0;
  let others = 0;
  for (const x of parts) {
    if (x.wicket) {
      x.p *= wm;
      adjusted += x.p;
    } else if (isBoundary(x)) {
      x.p *= bm;
      adjusted += x.p;
    } else others += x.p;
  }
  if (adjusted > 0.97) {
    const k = 0.97 / adjusted;
    for (const x of parts) if (x.wicket || isBoundary(x)) x.p *= k;
    adjusted = 0.97;
  }
  if (others > 0) {
    const k = (1 - adjusted) / others;
    for (const x of parts) if (!(x.wicket || isBoundary(x))) x.p *= k;
  } else if (adjusted > 0) {
    const k = 1 / adjusted;
    for (const x of parts) x.p *= k;
  }
  return parts;
}

type Weights = ReadonlyArray<readonly [Runs, number]>;

/** Fill `rest` probability over runs in proportion to weights. */
function spread(rest: number, weights: Weights, zone: FieldZone, fielder: FieldZone | null, tag: AtomTag, out: Part[]): void {
  let total = 0;
  for (const w of weights) total += w[1];
  if (total <= 0 || rest <= 0) return;
  for (const [runs, w] of weights) {
    if (w <= 0) continue;
    const p = (rest * w) / total;
    if (runs === 0) out.push(part(p, 0, 'dot_fielded', zone, fielder ?? zone, tag));
    else if (runs === 4) out.push(part(p, 4, 'four', zone, null, tag));
    else out.push(part(p, runs, 'runs', zone, fielder, tag));
  }
}

const ROTATE: Record<Coverage, Weights> = {
  gap: [
    [0, 0.04],
    [1, 0.54],
    [2, 0.36],
    [3, 0.03],
    [4, 0.03],
  ],
  ring: [
    [0, 0.2],
    [1, 0.72],
    [2, 0.06],
    [4, 0.02],
  ],
  deep: [
    [0, 0.04],
    [1, 0.62],
    [2, 0.32],
    [4, 0.02],
  ],
  both: [
    [0, 0.34],
    [1, 0.6],
    [2, 0.06],
  ],
};

/** Ground strokes (drive, cut/pull, sweep): four chance = a + b·power², the rest by these weights. */
const GROUND: Record<Coverage, { a: number; b: number; caught: number; rest: Weights }> = {
  gap: {
    a: 0.14,
    b: 0.65,
    caught: 0,
    rest: [
      [1, 0.35],
      [2, 0.45],
      [3, 0.2],
    ],
  },
  ring: {
    a: 0.06,
    b: 0.45,
    caught: 0.02,
    rest: [
      [0, 0.45],
      [1, 0.48],
      [2, 0.07],
    ],
  },
  deep: {
    a: 0.04,
    b: 0.25,
    caught: 0,
    rest: [
      [0, 0.05],
      [1, 0.45],
      [2, 0.5],
    ],
  },
  both: {
    a: 0.02,
    b: 0.06,
    caught: 0.015,
    rest: [
      [0, 0.55],
      [1, 0.42],
      [2, 0.03],
    ],
  },
};

function middleParts(inp: ModelInput, attack: AttackShot, coverage: Coverage, power: number, m: number): Part[] {
  const { d, zone, ctx, cond } = inp;
  const out: Part[] = [];
  if (attack === 'defend') {
    out.push(part(0.86, 0, 'dot_block', null, null, 'block'));
    out.push(part(0.14, 1, 'runs', pushZone(d), null, 'block'));
    return out;
  }
  const z = zone as FieldZone;
  if (attack === 'rotate') {
    const mistimed = inp.timing !== 'perfect' && inp.timing !== 'good';
    let runOut = T.RUN_OUT_BASE * T.RUN_OUT_COVERAGE[coverage] + (mistimed ? T.RUN_OUT_MISTIMED : 0);
    let weights = ROTATE[coverage];
    if (ctx.lastBall) {
      // Last ball: the batters run on anything, so a fielded dot becomes a single or a run out.
      let dot = 0;
      for (const w of weights) if (w[0] === 0) dot = w[1];
      weights = weights.map((w) => (w[0] === 0 ? ([0, 0] as const) : w[0] === 1 ? ([1, w[1] + dot * (1 - T.SCRAMBLE_RUN_OUT)] as const) : w));
      runOut = runOut * 2 + dot * T.SCRAMBLE_RUN_OUT;
    }
    out.push(part(runOut, 0, 'wicket', z, z, ctx.lastBall ? 'scramble' : coverage, false, 'run_out'));
    spread(1 - runOut, weights, z, z, coverage, out);
    return out;
  }
  if (attack === 'loft') {
    // Clearance: a lofted hit needs power AND the right length to get under the ball.
    const c = clamp(power + T.LOFT_MATCHUP * m, 0, 1);
    const deepish = coverage === 'deep' || coverage === 'both';
    const L = T.LOFT[deepish ? 'deep' : coverage === 'ring' ? 'ring' : 'gap'];
    const p6 = clamp(L.six * (c - T.LOFT_SIX_FROM), 0, T.LOFT_SIX_MAX) * L.sixMult;
    const p4 = clamp(0.12 + 0.35 * (c - 0.2), 0.05, 0.37) * L.fourMult;
    let caught = (L.catchBase + L.catchMiss * (1 - c) * (1 - c)) * (coverage === 'both' ? 1.2 : 1);
    if (cond.pitch === 'green' && !ctx.superBall && ctx.ball <= 2) caught *= T.GREEN_EARLY_LOFT_CATCH;
    caught = clamp(caught, 0, 0.6);
    const rest = clamp(1 - p6 - caught - p4, 0, 1);
    out.push(part(p6, 6, 'six', z, null, coverage, true));
    out.push(part(caught, 0, 'wicket', z, z, coverage, true, 'caught'));
    out.push(part(p4, 4, 'four', z, null, coverage, true));
    spread(
      rest,
      deepish
        ? [
            [1, 0.45],
            [2, 0.55],
          ]
        : [
            [1, 0.35],
            [2, 0.65],
          ],
      z,
      deepish ? z : null,
      coverage,
      out,
    );
    return out;
  }
  const g = GROUND[coverage];
  const p4 = clamp(g.a + g.b * power * power, 0, 0.85);
  out.push(part(p4, 4, 'four', z, null, coverage));
  if (g.caught > 0) out.push(part(g.caught, 0, 'wicket', z, z, coverage, true, 'caught'));
  spread(1 - p4 - g.caught, g.rest, z, coverage === 'gap' ? null : z, coverage, out);
  return out;
}

function thickParts(inp: ModelInput, attack: AttackShot, coverage: Coverage | null): Part[] {
  const { d, zone, field } = inp;
  const layout = T.FIELD_LAYOUTS[field];
  const ez = edgeZone(d, zone);
  const ezCov = layout.zones[ez];
  const fourOk = ezCov === 'gap' ? 1 : ezCov === 'ring' ? 0.4 : 0.12;
  const out: Part[] = [];
  if (attack === 'defend') {
    const closeZone: FieldZone = d.line === 'wide_off' || d.line === 'off' ? 'point' : 'square_leg';
    out.push(part(layout.closeCatch, 0, 'wicket', closeZone, closeZone, 'close', true, 'caught'));
    spread(
      1 - layout.closeCatch,
      [
        [0, 0.72],
        [1, 0.24],
        [4, 0.04 * fourOk],
      ],
      ez,
      null,
      'edge',
      out,
    );
    return out;
  }
  if (attack === 'rotate') {
    const z = zone as FieldZone;
    out.push(part(0.03, 0, 'wicket', z, z, 'edge', true, 'caught'));
    spread(
      0.97,
      [
        [0, 0.4],
        [1, 0.48],
        [2, 0.1],
      ],
      ez,
      null,
      'edge',
      out,
    );
    return out;
  }
  let caught: number;
  let catcher: FieldZone | null;
  let weights: Weights;
  if (attack === 'drive') {
    caught = layout.slipCatch * 0.35;
    catcher = 'point';
    weights = [
      [0, 0.3],
      [1, 0.32],
      [2, 0.13],
      [4, 0.3 * fourOk],
    ];
  } else if (attack === 'cut_pull') {
    caught = 0.18 + (ezCov === 'deep' || ezCov === 'both' ? 0.07 : 0);
    catcher = ez;
    weights = [
      [0, 0.32],
      [1, 0.3],
      [2, 0.06],
      [4, 0.2 * fourOk + 0.04],
    ];
  } else if (attack === 'sweep') {
    caught = 0.15 + (layout.zones.fine_leg === 'deep' ? 0.05 : 0);
    catcher = 'fine_leg';
    weights = [
      [0, 0.4],
      [1, 0.38],
      [4, 0.1 * fourOk + 0.02],
    ];
  } else {
    const c = coverage ?? 'gap';
    caught = c === 'deep' || c === 'both' ? 0.45 : c === 'ring' ? 0.35 : 0.2;
    catcher = zone;
    weights = [
      [0, 0.4],
      [1, 0.3],
      [2, 0.18],
      [4, 0.08],
    ];
  }
  out.push(part(caught, 0, 'wicket', catcher, catcher, 'edge', true, 'caught'));
  spread(1 - caught, weights, attack === 'loft' && zone ? zone : ez, null, 'edge', out);
  return out;
}

function thinParts(inp: ModelInput, attack: AttackShot): Part[] {
  const { d, field, cond, zone } = inp;
  const layout = T.FIELD_LAYOUTS[field];
  const family = T.FAMILY[d.variant];
  const caught = clamp(layout.slipCatch * T.CARRY[cond.pitch] * T.SHOT_EXPOSURE[attack] * (family === 'spin' ? 0.8 : 1), 0, 0.9);
  const ez = edgeZone(d, zone);
  const fourOk = layout.zones[ez] === 'gap' ? 1 : 0.15;
  const out: Part[] = [part(caught, 0, 'wicket', null, null, 'slips', true, 'caught')];
  spread(
    1 - caught,
    [
      [0, 0.55],
      [1, 0.2 + 0.25 * (1 - fourOk)],
      [4, 0.25 * fourOk],
    ],
    ez,
    null,
    'edge',
    out,
  );
  return out;
}

function padParts(inp: ModelInput, attack: AttackShot, natural: boolean): Part[] {
  const { d, cond } = inp;
  const lbw = clamp(
    T.LBW_LINE[d.line] *
      T.LBW_LENGTH[lengthClass(d.variant, d.length)] *
      (T.LBW_VARIANT[d.variant] ?? 1) *
      (T.LBW_SHOT[attack] ?? 1) *
      T.LBW_PITCH[cond.pitch] *
      T.SHOT_EXPOSURE[attack] *
      (natural ? 1 : 1.3),
    0,
    0.85,
  );
  return [part(lbw, 0, 'wicket', null, null, 'stumps', false, 'lbw'), part(1 - lbw, 0, 'dot_beaten', null, null, 'none')];
}

function missParts(inp: ModelInput, attack: AttackShot, natural: boolean): Part[] {
  const { d, cond } = inp;
  const charge = T.FAMILY[d.variant] === 'spin' && (attack === 'drive' || attack === 'loft') && (d.intensity === 1 || d.length === 'full');
  if (charge) return [part(T.STUMPED, 0, 'wicket', null, null, 'stumps', false, 'stumped'), part(1 - T.STUMPED, 0, 'dot_beaten', null, null, 'none')];
  const bowled = clamp(
    T.BOWLED_LINE[d.line] *
      T.BOWLED_LENGTH[lengthClass(d.variant, d.length)] *
      (T.BOWLED_VARIANT[d.variant] ?? 1) *
      T.BOWLED_PITCH[cond.pitch] *
      T.SHOT_EXPOSURE[attack] *
      (natural ? 1 : 1.25),
    0,
    0.85,
  );
  return [part(bowled, 0, 'wicket', null, null, 'stumps', false, 'bowled'), part(1 - bowled, 0, 'dot_beaten', null, null, 'none')];
}

const UNANSWERED: Evaluation = {
  atoms: [{ p: 1, contact: 'none', runs: 0, wicket: null, fielder: null, zone: null, kind: 'dot_beaten', aerial: false, tag: 'leave' }],
  factors: { matchup: 0, timing: 0, execution: 0, pitch: 0, field: 0, setup: 0, risk: 0 },
  natural: true,
  advantage: 0,
  pMiddle: 0,
  power: 0,
  setupStrength: 0,
  pWicket: 0,
  expectedRuns: 0,
};

function leaveEvaluation(inp: ModelInput, factorsBase: Omit<Factors, 'risk'>, setupStrength: number): Evaluation {
  const { d, cond, grade } = inp;
  if (inp.timing === 'interrupted') return { ...UNANSWERED, atoms: UNANSWERED.atoms.map((a) => ({ ...a })) };
  const execMult = grade === 'perfect' ? 1.15 : grade === 'loose' ? 0.6 : 1;
  const wm = (inp.intentMult ? inp.intentMult.wicket : T.INTENT_WICKET[d.intent]) * (1 + (T.SETUP_WICKET_MULT - 1) * setupStrength);
  const pHit = clamp(
    T.LEAVE_HIT[d.line] * (T.LEAVE_HIT_VARIANT[d.variant] ?? 1) * T.LEAVE_HIT_LENGTH[lengthClass(d.variant, d.length)] * T.LEAVE_HIT_PITCH[cond.pitch] * execMult * wm,
    0,
    0.9,
  );
  const atoms: Atom[] = [];
  if (pHit > 0) {
    atoms.push({ p: pHit * T.LEAVE_BOWLED_SHARE, contact: 'none', runs: 0, wicket: 'bowled', fielder: null, zone: null, kind: 'wicket', aerial: false, tag: 'leave' });
    atoms.push({ p: pHit * (1 - T.LEAVE_BOWLED_SHARE), contact: 'pad', runs: 0, wicket: 'lbw', fielder: null, zone: null, kind: 'wicket', aerial: false, tag: 'leave' });
  }
  atoms.push({ p: 1 - pHit, contact: 'none', runs: 0, wicket: null, fielder: null, zone: null, kind: 'dot_beaten', aerial: false, tag: 'leave' });
  return {
    atoms,
    factors: { ...factorsBase, risk: r3(clamp(T.SHOT_RISK.leave + pHit * 1.2, 0, 1)) },
    natural: true,
    advantage: 0,
    pMiddle: 0,
    power: 0,
    setupStrength,
    pWicket: pHit,
    expectedRuns: 0,
  };
}

export function evaluate(inp: ModelInput): Evaluation {
  const { d, shot, zone, timing, field, cond, ctx, grade } = inp;
  const layout = T.FIELD_LAYOUTS[field];
  const { s, setupStrength } = sequenceEffect(d, ctx);
  const leaving = shot === 'leave' || timing === 'no_shot' || timing === 'interrupted';
  const p = pitchEffect(d, leaving ? 'leave' : shot, cond, ctx);
  const e = executionEffect(grade, d, leaving ? 'leave' : shot);
  if (leaving) {
    // A deliberate leave has no timing; a chosen shot that was never played ("no shot") counts as the worst timing.
    const timingF = shot === 'leave' || timing === 'interrupted' ? 0 : T.TIMING_VALUE.no_shot;
    return leaveEvaluation(inp, { matchup: 0, timing: timingF, execution: r3(e), pitch: r3(p), field: r3(T.FIELD_FACTOR_BAT[field]), setup: r3(s) }, setupStrength);
  }
  const attack = shot as AttackShot;
  const { m, natural } = matchupOf(attack, zone, d);
  // Situational advantage (everything except the matchup, which has its own, stronger weights).
  const A = T.W_EXECUTION * e + T.W_PITCH * p + T.W_SETUP * s + (ctx.newBatter ? T.NEW_BATTER_A : 0);
  const pMiddle = clamp(T.MID_BASE[timing] + T.SHOT_EASE[attack] + T.K_MATCHUP_MIDDLE * m + T.K_ADVANTAGE * A, T.MID_MIN, T.MID_MAX);

  const family = T.FAMILY[d.variant];
  const pace = family === 'spin' ? (d.intensity === 1 ? 0.04 : d.intensity === 3 ? -0.03 : 0) : d.intensity === 3 ? 0.06 : d.intensity === 1 ? -0.04 : 0;
  const power = clamp(T.POWER_BASE + T.POWER_TIMING * T.TIMING_POWER[timing] + T.POWER_MATCHUP * m + T.POWER_ADVANTAGE * A + T.PITCH_POWER[cond.pitch] + pace, 0, 1);

  // Split of the non-middled share.
  const w = T.MISS_SPLIT[attack].slice();
  const mv = T.MISS_SPLIT_VARIANT[d.variant];
  const mt = timing === 'early' || timing === 'very_early' ? T.MISS_SPLIT_EARLY : timing === 'late' || timing === 'very_late' ? T.MISS_SPLIT_LATE : null;
  const mp = T.MISS_SPLIT_PITCH[cond.pitch];
  const ml = T.MISS_SPLIT_LINE[d.line];
  let wsum = 0;
  for (let i = 0; i < 4; i++) {
    w[i] *= (mv ? mv[i] : 1) * (mt ? mt[i] : 1) * mp[i] * ml[i];
    wsum += w[i];
  }
  const rest = 1 - pMiddle;

  const coverage: Coverage | null = zone ? layout.zones[zone] : null;
  const wm = (inp.intentMult ? inp.intentMult.wicket : T.INTENT_WICKET[d.intent]) * (1 + (T.SETUP_WICKET_MULT - 1) * setupStrength);
  const bm = inp.intentMult ? inp.intentMult.boundary : T.INTENT_BOUNDARY[d.intent];

  const atoms: Atom[] = [];
  let pWicket = 0;
  let expectedRuns = 0;
  const add = (contact: Contact, pContact: number, parts: Part[]) => {
    if (pContact <= 0) return;
    tilt(parts, wm, bm);
    for (const x of parts) {
      if (x.p <= 0) continue;
      const pa = pContact * x.p;
      atoms.push({ p: pa, contact, runs: x.runs, wicket: x.wicket, fielder: x.fielder, zone: x.zone, kind: x.kind, aerial: x.aerial, tag: x.tag });
      if (x.wicket) pWicket += pa;
      expectedRuns += pa * x.runs;
    }
  };
  add('middle', pMiddle, middleParts(inp, attack, coverage ?? 'gap', power, m));
  add('thick_edge', (rest * w[0]) / wsum, thickParts(inp, attack, coverage));
  add('thin_edge', (rest * w[1]) / wsum, thinParts(inp, attack));
  add('pad', (rest * w[2]) / wsum, padParts(inp, attack, natural));
  add('miss', (rest * w[3]) / wsum, missParts(inp, attack, natural));

  const fieldF = attack === 'defend' ? T.FIELD_FACTOR_BAT[field] : attack === 'loft' ? T.FIELD_FACTOR_LOFT[coverage ?? 'gap'] : T.FIELD_FACTOR_GROUND[coverage ?? 'gap'];
  const risk = clamp(T.SHOT_RISK[attack] + 0.3 * (m < 0 ? -m : 0) + (natural ? 0 : 0.15), 0, 1);
  return {
    atoms,
    factors: { matchup: r3(m), timing: r3(T.TIMING_VALUE[timing]), execution: r3(e), pitch: r3(p), field: r3(fieldF), setup: r3(s), risk: r3(risk) },
    natural,
    advantage: A + T.W_MATCHUP * m,
    pMiddle,
    power,
    setupStrength,
    pWicket,
    expectedRuns,
  };
}

/** Picks the atom for a uniform draw u in [0, 1). Deterministic summation order. */
export function pickAtom(atoms: Atom[], u: number): Atom {
  let total = 0;
  for (const a of atoms) total += a.p;
  const target = u * total;
  let acc = 0;
  for (const a of atoms) {
    acc += a.p;
    if (target < acc) return a;
  }
  return atoms[atoms.length - 1];
}
