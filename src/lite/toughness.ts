/**
 * Toughness tiers for Insight points. The tiers are computed from the game itself (never from player answer rates)
 * by scripts/lite-toughness.mjs and committed to src/content/lite/toughness.json. A unit test recomputes them and
 * fails when content or engine changes make the committed manifest stale.
 *
 * Stable API used by the Lite screen: `TOUGHNESS`, `tierOf`, `closeCallMargin`.
 * Generator API: `TOUGHNESS_CONFIG`, `computeToughness`, `decisionSignals`, `tierFromSignals`,
 * `toughnessContentHash`, `bestMoveKindSurvey`.
 *
 * Method (docs/LITE-TOUGHNESS.md has the table for owner review):
 *   - Play the best path for every seed in TOUGHNESS_CONFIG.seeds: before each decision, scan the clues its options
 *     rely on (exactly as the Scan button does), then take the move the reveal marks "Best"; answer fair-play
 *     moments fairly.
 *   - At each decision, evaluate every move from that state and read three signals:
 *       close call  best and second-best moves within `closeCallMargin` points;
 *       trap        a non-best move looks better right now on at least one city bar, by at least `trapMargin`,
 *                   while its total effect (immediate change plus its delayed effects) is worse than the best
 *                   move's: temptation, not low immediate points;
 *       clue needed the best move relies on a visible clue, so scanning first matters.
 *   - No signal = Tricky, one = Tough, two or more = Boss. Each question takes its most common tier across seeds
 *     (ties resolve to the lower tier). Fair-play moments default to Tricky unless `rightsOverrides` says otherwise.
 */
import manifest from '@/content/lite/toughness.json';
import { actionKindOf, type ActionKind } from '@/components/game/cards/actionKind';
import { DEFAULT_OPPONENTS, checkCondition, createRng, hashString, reduce, rngFloat } from '@/engine';
import { DIMENSIONS, type GameState, type RngState, type Scenario, type ScenarioDecision, type Scores } from '@/engine/types';
import type { InsightTier, ToughnessEntry, ToughnessManifest, ToughnessSignals } from './contracts';
import { bestOf, evaluateAll, type MoveEval } from './points';
import { LITE_SCENARIO_ID, advanceToPending, scanEvidence, startLiteGame } from './replay';

export const TOUGHNESS = manifest as ToughnessManifest;

/** Tier of a decision or fair-play moment by id; 'tricky' when unknown. */
export function tierOf(stepId: string): InsightTier {
  return TOUGHNESS.decisions[stepId]?.tier ?? TOUGHNESS.rights[stepId]?.tier ?? 'tricky';
}

/** Best and second-best within this many points is a close call; also the Insight close-second margin. */
export function closeCallMargin(): number {
  return TOUGHNESS.thresholds.closeCallMargin;
}

// ---------------------------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------------------------

/** Bump when the method changes, so the content hash (and the staleness test) notices. */
export const TOUGHNESS_GENERATOR_VERSION = 1;

export const INSIGHT_TIER_NAMES: readonly InsightTier[] = ['tricky', 'tough', 'boss'];

export interface ToughnessThresholds {
  /** Best and second-best within this many points is a close call. */
  closeCallMargin: number;
  /** A tempting move must beat the best move on some bar by at least this much right now. */
  trapMargin: number;
}

export interface ToughnessConfig {
  /** Campaign seeds played along the best path. */
  seeds: number[];
  thresholds: ToughnessThresholds;
  /** Fair-play moments are Tricky unless listed here. */
  rightsOverrides: Record<string, InsightTier>;
}

const SEED_COUNT = 48;

/** The committed configuration. Tune thresholds here, never individual questions. */
export const TOUGHNESS_CONFIG: ToughnessConfig = {
  seeds: Array.from({ length: SEED_COUNT }, (_, i) => hashString(`vande-lite-toughness:${i}`) >>> 0),
  thresholds: { closeCallMargin: 40, trapMargin: 1 },
  rightsOverrides: {},
};

export interface DecisionReading {
  signals: ToughnessSignals;
  best: MoveEval;
  second?: MoveEval;
  evals: MoveEval[];
}

/** Net change across all bars (positive = better for the city). */
function net(delta: Partial<Scores>): number {
  let n = 0;
  for (const k of DIMENSIONS) n += delta[k] ?? 0;
  return n;
}

/** Immediate change plus the move's delayed effects whose condition holds after the move (unclamped estimate). */
function totalEffect(state: GameState, scenario: Scenario, d: ScenarioDecision, e: MoveEval): number {
  let total = net(e.delta);
  let after = state;
  try {
    after = reduce(state, { type: 'decide', tick: state.tick, decisionId: d.id, optionId: e.option.id }, scenario);
  } catch {
    /* no change */
  }
  for (const spec of e.option.delayed ?? []) {
    if (!checkCondition(spec.condition, after)) continue;
    for (const k of DIMENSIONS) total += spec.effects[k] ?? 0;
  }
  return total;
}

/** The three toughness signals for a decision, read at `state` (call after scanning the clues it relies on). */
export function decisionSignals(state: GameState, scenario: Scenario, d: ScenarioDecision, thresholds: ToughnessThresholds): DecisionReading {
  const evals = evaluateAll(state, scenario, d);
  const best = bestOf(evals);
  const others = evals.filter((e) => e.option.id !== best.option.id);
  const second = others.length ? others.reduce((a, b) => (b.pts > a.pts ? b : a), others[0]) : undefined;
  const closeCall = second ? best.pts - second.pts <= thresholds.closeCallMargin : false;
  const bestTotal = totalEffect(state, scenario, d, best);
  const trap = others.some((o) => {
    const tempting = DIMENSIONS.some((k) => (o.delta[k] ?? 0) - (best.delta[k] ?? 0) >= thresholds.trapMargin);
    return tempting && totalEffect(state, scenario, d, o) < bestTotal;
  });
  const clueNeeded = (best.option.requiresEvidence ?? []).some((id) => state.evidence[id]?.visible);
  return { signals: { closeCall, trap, clueNeeded }, best, second, evals };
}

export function tierFromSignals(s: ToughnessSignals): InsightTier {
  const n = Number(s.closeCall) + Number(s.trap) + Number(s.clueNeeded);
  return n === 0 ? 'tricky' : n === 1 ? 'tough' : 'boss';
}

/** Scan, before a decision, every visible clue its options rely on (the "scan everything" policy). */
function scanRelied(state: GameState, scenario: Scenario, d: ScenarioDecision): GameState {
  let g = state;
  const ids = new Set(d.options.flatMap((o) => o.requiresEvidence ?? []));
  for (const id of ids) {
    const es = g.evidence[id];
    if (es?.visible && !es.destroyed && !es.inspected) g = scanEvidence(g, scenario, id);
  }
  return g;
}

function fairAnswer(state: GameState, scenario: Scenario, momentId: string, pick?: (n: number) => number): GameState {
  const rm = scenario.rightsMoments.find((r) => r.id === momentId)!;
  const opt = pick ? rm.options[pick(rm.options.length)] : rm.options.find((o) => o.correct) ?? rm.options[0];
  return reduce(state, { type: 'rights', tick: state.tick, momentId, optionId: opt.id }, scenario);
}

export interface PathStep {
  decision: ScenarioDecision;
  /** State at the decision (after any scanning the policy did). */
  state: GameState;
}

/**
 * Plays one Lite game and calls `onDecision` at every decision. `choose` picks the option index (default: the
 * reveal's best). `scan` decides whether to scan the relied clues first. `answer` picks fair-play answers (default:
 * the fair one).
 */
export function playPath(
  seed: number,
  onDecision: (step: PathStep, scenario: Scenario) => void,
  policy: { scan?: (d: ScenarioDecision) => boolean; choose?: (evals: MoveEval[]) => number; answer?: (n: number) => number } = {},
): void {
  const game = startLiteGame(seed);
  const { scenario } = game;
  let state = game.state;
  for (let guard = 0; guard < 64; guard++) {
    state = advanceToPending(state, scenario);
    if (state.status === 'ended') return;
    const rid = state.pendingRightsIds[0];
    if (rid) {
      state = fairAnswer(state, scenario, rid, policy.answer);
      continue;
    }
    const did = state.pendingDecisionIds[0];
    if (!did) return;
    const d = scenario.decisions.find((x) => x.id === did)!;
    if (policy.scan ? policy.scan(d) : true) state = scanRelied(state, scenario, d);
    onDecision({ decision: d, state }, scenario);
    const evals = evaluateAll(state, scenario, d);
    const idx = policy.choose ? policy.choose(evals) : bestOf(evals).index;
    state = reduce(state, { type: 'decide', tick: state.tick, decisionId: d.id, optionId: d.options[idx].id }, scenario);
  }
}

/** Strips every `simple` subtree (copy and picture tags never change tiers). */
function withoutSimple(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutSimple);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== 'simple') out[k] = withoutSimple(x);
    return out;
  }
  return v;
}

/** Stable hash of everything the tiers depend on: the scenario (minus copy layers), opponents, method and config. */
export function toughnessContentHash(scenario: Scenario, config: ToughnessConfig = TOUGHNESS_CONFIG): string {
  const input = JSON.stringify({
    v: TOUGHNESS_GENERATOR_VERSION,
    scenario: withoutSimple(scenario),
    opponents: [...DEFAULT_OPPONENTS],
    seeds: config.seeds,
    thresholds: config.thresholds,
    rightsOverrides: config.rightsOverrides,
  });
  const a = (hashString(`a|${input}`) >>> 0).toString(16).padStart(8, '0');
  const b = (hashString(`b|${input}`) >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

export interface QuestionReport {
  id: string;
  title: string;
  /** Seeds in which the question appeared. */
  seen: number;
  tier: InsightTier;
  signals: ToughnessSignals;
  /** How often each signal fired across the seeds that reached the question. */
  signalCounts: { closeCall: number; trap: number; clueNeeded: number };
  tierCounts: Record<InsightTier, number>;
  /** Median points of the best and second-best moves at the question. */
  bestPts: number;
  secondPts: number;
  bestTitle: string;
  bestKind: ActionKind;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function modeTier(counts: Record<InsightTier, number>): InsightTier {
  // Most common; ties resolve to the lower tier so tiers never inflate on a coin flip.
  let best: InsightTier = 'tricky';
  for (const t of INSIGHT_TIER_NAMES) if (counts[t] > counts[best]) best = t;
  return best;
}

/** Computes the manifest and a per-question report for owner review. Deterministic. */
export function computeToughness(config: ToughnessConfig = TOUGHNESS_CONFIG): { manifest: ToughnessManifest; report: QuestionReport[] } {
  for (const [id, tier] of Object.entries(config.rightsOverrides))
    if (!INSIGHT_TIER_NAMES.includes(tier)) throw new Error(`rightsOverrides.${id}: '${String(tier)}' is not a tier`);
  const scenario = startLiteGame(config.seeds[0] ?? 0).scenario;
  for (const id of Object.keys(config.rightsOverrides))
    if (!scenario.rightsMoments.some((r) => r.id === id)) throw new Error(`rightsOverrides.${id}: no such fair-play moment`);

  type Acc = { readings: DecisionReading[]; tiers: Record<InsightTier, number> };
  const acc = new Map<string, Acc>();
  for (const seed of config.seeds) {
    playPath(seed, ({ decision, state }, sc) => {
      const r = decisionSignals(state, sc, decision, config.thresholds);
      const a = acc.get(decision.id) ?? { readings: [], tiers: { tricky: 0, tough: 0, boss: 0 } };
      a.readings.push(r);
      a.tiers[tierFromSignals(r.signals)] += 1;
      acc.set(decision.id, a);
    });
  }

  const decisions: Record<string, ToughnessEntry> = {};
  const report: QuestionReport[] = [];
  for (const d of scenario.decisions) {
    const a = acc.get(d.id);
    if (!a || !a.readings.length) {
      decisions[d.id] = { tier: 'tricky', signals: { closeCall: false, trap: false, clueNeeded: false } };
      report.push({
        id: d.id,
        title: d.simple?.title ?? d.title,
        seen: 0,
        tier: 'tricky',
        signals: { closeCall: false, trap: false, clueNeeded: false },
        signalCounts: { closeCall: 0, trap: 0, clueNeeded: 0 },
        tierCounts: { tricky: 0, tough: 0, boss: 0 },
        bestPts: 0,
        secondPts: 0,
        bestTitle: '',
        bestKind: 'talk',
      });
      continue;
    }
    const tier = modeTier(a.tiers);
    // The signals recorded are the majority reading of each signal among the seeds that produced this tier.
    const withTier = a.readings.filter((r) => tierFromSignals(r.signals) === tier);
    const majority = (key: keyof ToughnessSignals) => withTier.filter((r) => r.signals[key]).length * 2 > withTier.length;
    const signals: ToughnessSignals = { closeCall: majority('closeCall'), trap: majority('trap'), clueNeeded: majority('clueNeeded') };
    decisions[d.id] = { tier, signals };
    const bestCounts = new Map<string, number>();
    for (const r of a.readings) bestCounts.set(r.best.option.id, (bestCounts.get(r.best.option.id) ?? 0) + 1);
    const topBestId = [...bestCounts.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const topBest = d.options.find((o) => o.id === topBestId)!;
    report.push({
      id: d.id,
      title: d.simple?.title ?? d.title,
      seen: a.readings.length,
      tier,
      signals,
      signalCounts: {
        closeCall: a.readings.filter((r) => r.signals.closeCall).length,
        trap: a.readings.filter((r) => r.signals.trap).length,
        clueNeeded: a.readings.filter((r) => r.signals.clueNeeded).length,
      },
      tierCounts: a.tiers,
      bestPts: median(a.readings.map((r) => r.best.pts)),
      secondPts: median(a.readings.map((r) => r.second?.pts ?? 0)),
      bestTitle: d.simple?.options[topBest.id]?.title ?? topBest.title,
      bestKind: actionKindOf(topBest.tags),
    });
  }

  const rights: Record<string, ToughnessEntry> = {};
  for (const r of scenario.rightsMoments) rights[r.id] = { tier: config.rightsOverrides[r.id] ?? 'tricky', signals: { closeCall: false, trap: false, clueNeeded: false } };

  return {
    manifest: {
      scenarioId: LITE_SCENARIO_ID,
      contentHash: toughnessContentHash(scenario, config),
      thresholds: { ...config.thresholds },
      seeds: [...config.seeds],
      decisions,
      rights,
    },
    report,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Best-move kinds (twist coverage)
// ---------------------------------------------------------------------------------------------------------------

export interface BestKindSurvey {
  /** How often each action kind was the reveal's best move, over every decision reached. */
  kinds: Partial<Record<ActionKind, number>>;
  /** Per decision id: best-move kind counts. */
  byDecision: Record<string, Partial<Record<ActionKind, number>>>;
  decisionsSeen: number;
}

/**
 * Which action kinds can be the reveal's best move of a Chapter 1 decision: the best path over `seeds` (with and
 * without scanning) plus `randomPaths` seeded random games (random moves, random scanning, random fair-play answers).
 */
export function bestMoveKindSurvey(opts: { seeds?: number[]; randomPaths?: number } = {}): BestKindSurvey {
  const seeds = opts.seeds ?? TOUGHNESS_CONFIG.seeds;
  const randomPaths = opts.randomPaths ?? 300;
  const kinds: Partial<Record<ActionKind, number>> = {};
  const byDecision: Record<string, Partial<Record<ActionKind, number>>> = {};
  let decisionsSeen = 0;
  const record = ({ decision, state }: PathStep, sc: Scenario) => {
    const best = bestOf(evaluateAll(state, sc, decision));
    const k = actionKindOf(best.option.tags);
    kinds[k] = (kinds[k] ?? 0) + 1;
    const per = (byDecision[decision.id] ??= {});
    per[k] = (per[k] ?? 0) + 1;
    decisionsSeen++;
  };
  for (const seed of seeds) {
    playPath(seed, record, { scan: () => true });
    playPath(seed, record, { scan: () => false });
  }
  for (let i = 0; i < randomPaths; i++) {
    let rng: RngState = createRng(hashString(`vande-lite-random-path:${i}`) >>> 0);
    const next = () => {
      const r = rngFloat(rng);
      rng = r.next;
      return r.value;
    };
    playPath(hashString(`vande-lite-random-seed:${i}`) >>> 0, record, {
      scan: () => next() < 0.5,
      choose: (evals) => Math.floor(next() * evals.length),
      answer: (n) => Math.floor(next() * n),
    });
  }
  return { kinds, byDecision, decisionsSeen };
}
