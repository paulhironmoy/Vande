/**
 * Training (the first-run tutorial), engine v1. A fixed, legal and teachable set-up (the conditions, the tutorial
 * ghost, the coach's over the player bats against, and suggested deliveries for the player's own bowling lesson), and
 * `buildTrainingLog`, which turns the player's real inputs and over into a complete match log that `verifyMatchLog`
 * accepts: real salts and commits, a random 128-bit seed, the same rules as every other match.
 *
 * Works offline and loads early, so it imports only the v1 modules it uses (no ranking, no simulation, no registry,
 * no verifier). Randomness is limited to the seed and the commit salts (crypto.getRandomValues, the same fallback as
 * newSeed); everything that decides an outcome is deterministic.
 */
import type { BattingInput, CommitRecord, Conditions, DeliveryPlan, InningsState, InputTrace, KitSpec, MatchEventLog, OverPlan, PlayerRef, RevealedDelivery } from '@/contracts';
import { canonicalJson, commitHash } from './canonical';
import { rngFromKey } from './prng';
import { validateBattingInput } from './v1/batting';
import { revealDelivery } from './v1/delivery';
import { resolveNextBall, startInnings } from './v1/innings';
import { buildMatchLog } from './v1/match';
import { validatePlan } from './v1/plan';
import { autoBat, ghostBat, releaseFor } from './v1/policies';
import { METER, STARTER_VARIANTS, SUPERHUMAN_MS } from './v1/tables';
import { executionQuality, synthExecutionTrace } from './v1/traces';

/** A delivery without its release gesture. */
export type TrainingDelivery = Omit<DeliveryPlan, 'gesture'>;
export type TrainingStarter = 'good_length' | 'yorker' | 'bouncer' | 'offspin';

export const TRAINING_CONDITIONS: Conditions = { pitch: 'hard', weather: 'clear' };
/** The friendliest Practice Ghost (difficulty 1) coaches the tutorial and bats against the player's over. */
export const TRAINING_GHOST_ID = 'anchor';
/** Hour stamp used when the caller passes none (logs never carry exact times). */
export const TRAINING_HOUR = '2026-01-01T00:00Z';

/**
 * The coach's over (balanced field, 11 energy; Super Ball 3): a friendly half-volley first (the ball the tutorial
 * bats), then one ball for each lesson: short, honest, a set-up, the yorker it sets up, and a wide one to cut.
 */
const COACH: ReadonlyArray<TrainingDelivery & { releaseMs: number }> = [
  { variant: 'good_length', line: 'off', length: 'full', intensity: 1, intent: 'contain', releaseMs: 830 },
  { variant: 'bouncer', line: 'middle', length: 'short', intensity: 2, intent: 'attack', releaseMs: 812 },
  { variant: 'good_length', line: 'off', length: 'good', intensity: 2, intent: 'contain', releaseMs: 772 },
  { variant: 'offspin', line: 'off', length: 'good', intensity: 1, intent: 'setup', releaseMs: 845 },
  { variant: 'yorker', line: 'middle', length: 'full', intensity: 1, intent: 'attack', releaseMs: 790 },
  { variant: 'good_length', line: 'wide_off', length: 'short', intensity: 1, intent: 'contain', releaseMs: 758 },
];
const COACH_SUPER: TrainingDelivery & { releaseMs: number } = { variant: 'yorker', line: 'middle', length: 'full', intensity: 1, intent: 'attack', releaseMs: 806 };

/**
 * Suggested deliveries for the player's bowling lesson. The lesson ball is ball 1 of their over (one of the four
 * starters, as below, or any starter delivery); balls 2–6 and the Super Ball are bowled for them with an ordinary
 * release. They cost 8, so any lesson ball fits the energy budget, and ball 4 (short, a set-up) pays off on ball 5 (full).
 */
export const TRAINING_LESSON: {
  field: OverPlan['field'];
  choices: Readonly<Record<TrainingStarter, TrainingDelivery>>;
  rest: readonly TrainingDelivery[];
  superBall: TrainingDelivery;
} = {
  field: 'balanced',
  choices: {
    good_length: { variant: 'good_length', line: 'off', length: 'good', intensity: 2, intent: 'attack' },
    yorker: { variant: 'yorker', line: 'middle', length: 'full', intensity: 2, intent: 'attack' },
    bouncer: { variant: 'bouncer', line: 'off', length: 'short', intensity: 2, intent: 'attack' },
    offspin: { variant: 'offspin', line: 'off', length: 'good', intensity: 2, intent: 'attack' },
  },
  rest: [
    { variant: 'good_length', line: 'off', length: 'good', intensity: 1, intent: 'contain' },
    { variant: 'offspin', line: 'middle', length: 'good', intensity: 1, intent: 'contain' },
    { variant: 'bouncer', line: 'middle', length: 'short', intensity: 1, intent: 'setup' },
    { variant: 'yorker', line: 'off', length: 'full', intensity: 1, intent: 'attack' },
    { variant: 'good_length', line: 'wide_off', length: 'full', intensity: 1, intent: 'contain' },
  ],
  superBall: { variant: 'good_length', line: 'off', length: 'full', intensity: 2, intent: 'attack' },
};

export interface TrainingSetup {
  conditions: Conditions;
  ghostId: string;
  /** The over the player bats against (legal with the starter variants). */
  coachOver: OverPlan;
  lesson: typeof TRAINING_LESSON;
  /** 128-bit hex match seed: bat with it (localInnings) and pass the same setup to buildTrainingLog. */
  seed: string;
}

function hex(bytes: number): string {
  const b = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < bytes; i++) b[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (let i = 0; i < bytes; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/** A fresh 128-bit hex seed, generated locally. */
export function newTrainingSeed(): string {
  return hex(16);
}

const withGesture = (d: TrainingDelivery, gesture: InputTrace): DeliveryPlan => ({ variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: d.intent, gesture });

function assertLegal(plan: OverPlan, what: string): OverPlan {
  const v = validatePlan(plan, STARTER_VARIANTS);
  if (!v.ok) throw new Error(`engine: the training ${what} is not legal (${v.errors.join(', ')})`);
  return plan;
}

/** The coach's over, with fixed human-like releases (ball 1 is a good release, never a perfect one). */
export function trainingCoachOver(): OverPlan {
  const g = (d: { releaseMs: number }, i: number) => synthExecutionTrace(rngFromKey(`vande/training/coach|${i}`), d.releaseMs);
  const balls = COACH.map((d, i) => withGesture(d, g(d, i))) as OverPlan['balls'];
  return assertLegal({ v: 1, field: 'balanced', balls, superBall: withGesture(COACH_SUPER, g(COACH_SUPER, 6)) }, 'coach over');
}

export function trainingSetup(seed: string = newTrainingSeed()): TrainingSetup {
  return { conditions: { ...TRAINING_CONDITIONS }, ghostId: TRAINING_GHOST_ID, coachOver: trainingCoachOver(), lesson: TRAINING_LESSON, seed };
}

/** An ordinary release (spread 35 ms), kept out of the "superhuman" window so the over can never look scripted. */
function ordinaryGesture(seed: string, i: number): InputTrace {
  const rng = rngFromKey(`vande/training/lesson|${seed}|${i}`);
  let r = releaseFor(rng, 35);
  if (Math.abs(r - METER.sweetMs) <= SUPERHUMAN_MS) r = METER.sweetMs + (r < METER.sweetMs ? -1 : 1) * (SUPERHUMAN_MS + 3);
  return synthExecutionTrace(rng, r);
}

/**
 * The player's over for the bowling lesson: `lessonBall` (a starter delivery) with the player's own release `gesture`
 * as ball 1, then the lesson's other balls and Super Ball with an ordinary release (deterministic from `seed`). A gesture
 * the engine cannot read (too short, too long, malformed, a copy of another ball's trace) or none at all is replaced by
 * an ordinary release, so the over is always legal. Throws for a non-starter variant (and for an illegal length or intensity).
 */
export function trainingPlan(lessonBall: TrainingDelivery, gesture: InputTrace | null, seed: string): OverPlan {
  if (!(STARTER_VARIANTS as readonly string[]).includes(lessonBall.variant)) throw new Error(`engine: ${lessonBall.variant} is not a starter delivery`);
  const over = (first: InputTrace): OverPlan => ({
    v: 1,
    field: TRAINING_LESSON.field,
    balls: [withGesture(lessonBall, first), ...TRAINING_LESSON.rest.map((d, i) => withGesture(d, ordinaryGesture(seed, i + 1)))] as OverPlan['balls'],
    superBall: withGesture(TRAINING_LESSON.superBall, ordinaryGesture(seed, 6)),
  });
  if (gesture && executionQuality(gesture).ok) {
    const own = over(gesture);
    // A readable gesture can still be refused in context (a copy of another ball's trace): fall back to an ordinary one.
    if (validatePlan(own, STARTER_VARIANTS).ok) return own;
  }
  return assertLegal(over(ordinaryGesture(seed, 0)), 'over');
}

/** The tutorial ghost as a player in the log (the alias and kit come from the app). */
export function trainingCoachRef(alias: string, kit: KitSpec): PlayerRef {
  return { id: `ghost_${TRAINING_GHOST_ID}`, alias, avatar: { seed: `coach-${TRAINING_GHOST_ID}` }, kit, kind: 'ghost' };
}

/** Plays a whole innings (six balls and the Super Ball); `answer` proposes each input, invalid ones become unanswered. */
function playInnings(innings: 0 | 1, plan: OverPlan, conditions: Conditions, seed: string, answer: (k: number, d: RevealedDelivery) => BattingInput | null): { state: InningsState; inputs: Array<BattingInput | null> } {
  let state = startInnings(innings);
  const inputs: Array<BattingInput | null> = [];
  while (!state.done) {
    const d = revealDelivery(plan, state.nextBall, conditions);
    const raw = answer(inputs.length, d);
    const checked = raw ? validateBattingInput(raw, d) : null;
    const input = checked && checked.ok ? checked.input : null;
    inputs.push(input);
    state = resolveNextBall(state, { seed, conditions, plan, input }).state;
  }
  return { state, inputs };
}

export interface BuildTrainingLogArgs {
  setup: TrainingSetup;
  player: PlayerRef;
  /** trainingCoachRef(...). */
  coach: PlayerRef;
  /** The player's over (trainingPlan). */
  plan: OverPlan;
  /** The player's real inputs against setup.coachOver, in play order (as localInnings recorded them; null = unanswered). */
  inputs: ReadonlyArray<BattingInput | null>;
  /** The rest of the player's innings: batted by Auto XI ('auto', default) or left unanswered ('leave', safe dots). */
  finish?: 'auto' | 'leave';
  /** Hour stamp for the commits and meta, e.g. "2026-10-25T09:00Z" (default TRAINING_HOUR). */
  hour?: string;
  /** Commit salts [player, coach]; random by default (pass the player's own if their over was sealed with one). */
  salts?: [string, string];
}

/**
 * A complete, verifiable training match (kind 'training': never rated, never ranked). The player bats the coach's over
 * (their own inputs, then `finish`), the coach bats the player's over with the tutorial ghost's policy (seeing the
 * field), both overs are committed with salts, and the log is built by buildMatchLog. The coach's answer to the lesson
 * ball is `log.innings[1].balls[0]`. Throws if either over is not legal with the starter variants.
 */
export async function buildTrainingLog(a: BuildTrainingLogArgs): Promise<MatchEventLog> {
  const { conditions, seed, coachOver, ghostId } = a.setup;
  assertLegal(a.plan, 'over');
  assertLegal(coachOver, 'coach over');
  const finish = a.finish ?? 'auto';
  const mine = playInnings(0, coachOver, conditions, seed, (k, d) => (k < a.inputs.length ? a.inputs[k] : finish === 'auto' ? autoBat(`${seed}:training:auto`, d, coachOver.field) : null));
  const theirs = playInnings(1, a.plan, conditions, seed, (_k, d) => ghostBat(ghostId, `${seed}:training:coach`, d, a.plan.field));
  const salts = a.salts ?? [hex(16), hex(16)];
  const [h0, h1] = await Promise.all([commitHash(a.plan, salts[0]), commitHash(coachOver, salts[1])]);
  const hour = a.hour ?? TRAINING_HOUR;
  const commits: [CommitRecord, CommitRecord] = [
    { player: 0, hash: h0, sig: '', keyId: 'local', lockedHour: hour, salt: salts[0] },
    { player: 1, hash: h1, sig: '', keyId: 'local', lockedHour: hour, salt: salts[1] },
  ];
  return buildMatchLog({
    matchId: `training-${seed.slice(0, 12)}`,
    kind: 'training',
    seed,
    conditions,
    players: [a.player, a.coach],
    commits,
    plans: [a.plan, coachOver],
    inputs: [mine.inputs, theirs.inputs],
    innings: [mine.state, theirs.state],
    meta: { createdHour: hour, revealedHour: hour },
  });
}

/**
 * Which balls of a training log the player did not play by hand, by ball number (0–5, 6 = Super Ball): `batted`, balls
 * of the player's innings (innings 0) that Auto XI batted (`finish: 'auto'`); `bowled`, deliveries of the player's over
 * (faced by the coach in innings 1) that the lesson bowled for them, i.e. every ball but the lesson ball. Derived from
 * the log alone by re-running the same deterministic policies, so the log needs no extra fields. Empty for other logs.
 */
export function trainingAutoBalls(log: MatchEventLog): { batted: number[]; bowled: number[] } {
  const out = { batted: [] as number[], bowled: [] as number[] };
  if (!log || log.kind !== 'training' || !Array.isArray(log.plans) || !Array.isArray(log.inputs)) return out;
  const [plan, coachOver] = log.plans;
  for (const input of log.inputs[0] ?? []) {
    if (!input || typeof input.ball !== 'number') continue;
    const d = revealDelivery(coachOver, input.ball, log.conditions);
    const auto = validateBattingInput(autoBat(`${log.seed}:training:auto`, d, coachOver.field), d);
    if (auto.ok && canonicalJson(auto.input) === canonicalJson(input)) out.batted.push(input.ball);
  }
  const gestureOf = (g: InputTrace) => canonicalJson({ pointer: g.pointer, samples: g.samples });
  [...plan.balls, plan.superBall].forEach((d, i) => {
    if (i > 0 && d?.gesture && gestureOf(d.gesture) === gestureOf(ordinaryGesture(log.seed, i))) out.bowled.push(i);
  });
  return out;
}
