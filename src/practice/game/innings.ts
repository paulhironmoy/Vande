/**
 * THE Practice innings: one wicket, up to ten six-ball overs, runs accumulating across overs. A pure reducer over the
 * contract's PracticeInningsState, so the store can persist every state and the UI can replay the history.
 *
 *   choosing_over ──chooseOver──▶ batting ──(six balls)──▶ over_complete ──nextOver──▶ choosing_over
 *                                    │                         (after the tenth over: complete)
 *                                    └──(a wicket on any ball)──▶ out
 *   abandon (from any unfinished state) ──▶ complete
 *
 * Rules (docs/PRACTICE_RULES.md, "Innings rules"): a full over must be finished before another is chosen unless the
 * batter is out; one wicket ends the innings at once; all six balls of every over are legal. Save-scumming is closed
 * off by `inFlight`: it is set (and persisted) the moment a delivery starts, and an innings resumed with a delivery in
 * flight resolves that delivery as a leave through the physics (`resumeInnings`), so quitting mid-ball can never earn
 * a second attempt, and a ball that would have hit the stumps still bowls you.
 */
import {
  PRACTICE_MAX_OVERS,
  PRACTICE_SIM_VERSION,
  type AssistLevel,
  type BowlerProfile,
  type CoachingReason,
  type DeliveryRecord,
  type DeliveryResult,
  type DeliveryVariation,
  type Dismissal,
  type FieldLayout,
  type FielderRole,
  type Handedness,
  type InningsStatus,
  type PitchCondition,
  type PracticeDeliveryPlan,
  type PracticeInningsState,
  type PracticeOverPlan,
  type SwingTiming,
} from '@/contracts/practice';
import { replayDelivery, validateField, type Region } from '@/physics';
import { deliveryQuality, emptyTiming } from './coaching';
import { ballSeed, validateOver } from './overs';

export type InningsAction =
  | { type: 'chooseOver'; plan: PracticeOverPlan; field: FieldLayout }
  | { type: 'deliveryStarted' }
  | { type: 'deliveryResolved'; record: DeliveryRecord }
  | { type: 'nextOver' }
  | { type: 'abandon' };

export function newInnings(opts: { id: string; conditions: PitchCondition; assist: AssistLevel; handedness: Handedness }): PracticeInningsState {
  return {
    version: PRACTICE_SIM_VERSION,
    id: opts.id,
    status: 'choosing_over',
    conditions: opts.conditions,
    assist: opts.assist,
    handedness: opts.handedness,
    runs: 0,
    balls: 0,
    overs: [],
    current: null,
    inFlight: null,
    dismissal: null,
  };
}

/** The ball to bowl next: everything the physics needs (flight and resolution) and the record is built from. */
export interface NextDelivery {
  overIndex: number;
  ballIndex: number;
  plan: PracticeDeliveryPlan;
  seed: string;
  bowler: BowlerProfile;
  field: FieldLayout;
  conditions: PitchCondition;
  handedness: Handedness;
  assist: AssistLevel;
}

export function nextDelivery(state: PracticeInningsState): NextDelivery | null {
  if (state.status !== 'batting' || !state.current || state.current.deliveries.length >= 6) return null;
  const ballIndex = state.current.deliveries.length;
  return {
    overIndex: state.overs.length,
    ballIndex,
    plan: state.current.plan.balls[ballIndex],
    seed: ballSeed(state.current.plan, ballIndex),
    bowler: state.current.plan.bowler,
    field: state.current.field,
    conditions: state.conditions,
    handedness: state.handedness,
    assist: state.assist,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const RUNS = new Set([0, 1, 2, 3, 4, 6]);
const DISMISSALS = new Set(['bowled', 'caught', 'caught_behind', 'lbw']);

/** Why an action cannot be applied to this state (a closed code), or null when it can. */
export function inningsError(state: PracticeInningsState, action: InningsAction): string | null {
  if (state.version !== PRACTICE_SIM_VERSION) return 'wrong_version';
  switch (action.type) {
    case 'chooseOver': {
      if (state.status !== 'choosing_over') return state.status === 'batting' ? 'finish_the_over_first' : 'not_choosing';
      if (state.overs.length >= PRACTICE_MAX_OVERS) return 'innings_complete';
      const v = validateOver(action.plan);
      if (!v.ok) return `illegal_over:${v.errors.join(',')}`;
      const f = validateField(action.field);
      if (f.length) return `illegal_field:${f.join(',')}`;
      return null;
    }
    case 'deliveryStarted':
      if (state.status !== 'batting' || !state.current) return 'not_batting';
      if (state.inFlight) return 'delivery_in_flight';
      return null;
    case 'deliveryResolved': {
      const next = nextDelivery(state);
      if (!next) return 'not_batting';
      if (!state.inFlight) return 'delivery_not_started';
      const r = action.record;
      if (state.inFlight.overIndex !== next.overIndex || state.inFlight.ballIndex !== next.ballIndex) return 'in_flight_mismatch';
      if (!r || r.version !== PRACTICE_SIM_VERSION) return 'record_version';
      if (r.overIndex !== next.overIndex || r.ballIndex !== next.ballIndex) return 'wrong_ball';
      if (r.seed !== next.seed || !sameJson(r.plan, next.plan) || !sameJson(r.bowler, next.bowler)) return 'not_this_delivery';
      if (!sameJson(r.field, next.field)) return 'wrong_field';
      if (r.conditions !== state.conditions || r.assist !== state.assist || r.handedness !== state.handedness) return 'wrong_settings';
      if (!RUNS.has(r.runs)) return 'bad_runs';
      if (r.dismissal !== null && (!DISMISSALS.has(r.dismissal) || r.runs !== 0)) return 'bad_dismissal';
      if (!Number.isFinite(r.tierToleranceMs) || r.tierToleranceMs < 0) return 'bad_tolerance';
      return null;
    }
    case 'nextOver':
      return state.status === 'over_complete' ? null : 'over_not_complete';
    case 'abandon':
      return state.status === 'out' || state.status === 'complete' ? 'innings_over' : null;
  }
}

/** Apply an action; an action that is not allowed leaves the state unchanged (see `inningsError` for why). */
export function inningsReducer(state: PracticeInningsState, action: InningsAction): PracticeInningsState {
  if (inningsError(state, action) !== null) return state;
  switch (action.type) {
    case 'chooseOver':
      return { ...state, status: 'batting', current: { plan: action.plan, field: action.field, deliveries: [] }, inFlight: null };
    case 'deliveryStarted': {
      const next = nextDelivery(state)!;
      return { ...state, inFlight: { overIndex: next.overIndex, ballIndex: next.ballIndex } };
    }
    case 'deliveryResolved': {
      const r = action.record;
      const cur = state.current!;
      const deliveries = [...cur.deliveries, r];
      const base = { ...state, runs: state.runs + r.runs, balls: state.balls + 1, inFlight: null };
      const overDone = deliveries.length === 6;
      const overs = overDone ? [...state.overs, { plan: cur.plan, deliveries }] : state.overs;
      const current = overDone ? null : { ...cur, deliveries };
      if (r.dismissal) return { ...base, overs, current, status: 'out', dismissal: { record: r } };
      if (!overDone) return { ...base, current };
      return { ...base, overs, current: null, status: overs.length >= PRACTICE_MAX_OVERS ? 'complete' : 'over_complete' };
    }
    case 'nextOver':
      return { ...state, status: 'choosing_over' };
    case 'abandon':
      return { ...state, status: 'complete', inFlight: null };
  }
}

/** The record of a delivery resolved as a leave (no swing): what a resumed in-flight delivery becomes. */
export function leaveRecord(next: NextDelivery): DeliveryRecord {
  const base: DeliveryRecord = { version: PRACTICE_SIM_VERSION, ...next, tierToleranceMs: 0, swing: null, runs: 0, dismissal: null };
  const result = replayDelivery(base);
  return { ...base, runs: result.outcome.runs, dismissal: result.outcome.dismissal };
}

/**
 * Restore an innings after a pause, kill or reload. A delivery that had started but not resolved is resolved as a leave
 * through the physics (deterministic: the same saved state always resumes to the same state). A stray in-flight flag
 * outside batting is cleared. Anything else is returned unchanged.
 */
export function resumeInnings(state: PracticeInningsState): PracticeInningsState {
  if (!state.inFlight) return state;
  const next = nextDelivery(state);
  if (!next || next.overIndex !== state.inFlight.overIndex || next.ballIndex !== state.inFlight.ballIndex) return { ...state, inFlight: null };
  return inningsReducer(state, { type: 'deliveryResolved', record: leaveRecord(next) });
}

// ---------------------------------------------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------------------------------------------

export interface ScoringArea {
  region: Region;
  runs: number;
  balls: number;
}

export interface WeakestDelivery {
  ballIndex: number;
  variation: DeliveryVariation;
  reason: CoachingReason;
  timing: SwingTiming;
  runs: number;
  dismissal: Dismissal | null;
}

export interface OverSummary {
  overIndex: number;
  runs: number;
  /** Legal balls faced in this over (6 unless the batter was out during it). */
  balls: number;
  fours: number;
  sixes: number;
  boundaries: number;
  dots: number;
  /** How each ball was timed (`none` = left alone). */
  timing: Record<SwingTiming, number>;
  /** Where the runs went (regions with at least one ball that went into the field), most runs first. */
  scoringAreas: ScoringArea[];
  /** The ball the batter handled worst (a wicket, then a miss or edge, then a mistimed shot…), earliest on a tie. */
  weakest: WeakestDelivery | null;
  dismissal: Dismissal | null;
  complete: boolean;
}

export interface InningsSummary {
  id: string;
  status: InningsStatus;
  finished: boolean;
  runs: number;
  /** Legal balls faced, including the ball the batter was out to. */
  balls: number;
  /** Balls faced in cricket notation (overs.balls), e.g. "3.4". */
  overs: string;
  completedOvers: number;
  /** Balls survived (faced and not out to): equals `balls` when not out. */
  survivedBalls: number;
  fours: number;
  sixes: number;
  dots: number;
  /** Runs per 100 balls (0 before the first ball). */
  strikeRate: number;
  timing: Record<SwingTiming, number>;
  scoringAreas: ScoringArea[];
  perOver: OverSummary[];
  dismissal: {
    record: DeliveryRecord;
    how: Dismissal;
    reason: CoachingReason;
    fielderRole: FielderRole | null;
    /** 1-based ball of the innings, and its overs notation (e.g. "2.3" = third ball of the third over). */
    ballNumber: number;
    at: string;
  } | null;
}

export const oversNotation = (balls: number): string => `${Math.floor(balls / 6)}.${balls % 6}`;

function resultsFor(deliveries: readonly DeliveryRecord[], results?: readonly (DeliveryResult | undefined)[]): DeliveryResult[] {
  return deliveries.map((r, i) => results?.[i] ?? replayDelivery(r));
}

function addAreas(areas: Map<Region, ScoringArea>, result: DeliveryResult): void {
  const region = result.outcome.region;
  if (!region || result.outcome.dismissal) return;
  const a = areas.get(region) ?? { region, runs: 0, balls: 0 };
  a.runs += result.outcome.runs;
  a.balls += 1;
  areas.set(region, a);
}

const sortAreas = (m: Map<Region, ScoringArea>) => [...m.values()].sort((a, b) => b.runs - a.runs || b.balls - a.balls || (a.region < b.region ? -1 : 1));

/**
 * Summary of one over (finished, or the one the batter was out in). `results` may supply already-resolved results
 * (aligned with `over.deliveries`); missing ones are re-simulated from the records.
 */
export function overSummary(over: { plan: PracticeOverPlan; deliveries: readonly DeliveryRecord[] }, results?: readonly (DeliveryResult | undefined)[]): OverSummary {
  const rs = resultsFor(over.deliveries, results);
  const timing = emptyTiming();
  const areas = new Map<Region, ScoringArea>();
  let runs = 0;
  let fours = 0;
  let sixes = 0;
  let dots = 0;
  let weakest: WeakestDelivery | null = null;
  let weakestQ = Infinity;
  let dismissal: Dismissal | null = null;
  for (let i = 0; i < rs.length; i++) {
    const res = rs[i];
    const o = res.outcome;
    runs += o.runs;
    if (o.boundary === 4) fours++;
    if (o.boundary === 6) sixes++;
    if (o.runs === 0) dots++;
    if (o.dismissal) dismissal = o.dismissal;
    timing[res.contact.timing]++;
    addAreas(areas, res);
    const q = deliveryQuality(res);
    if (q < weakestQ) {
      const rec = over.deliveries[i];
      weakestQ = q;
      weakest = { ballIndex: rec.ballIndex, variation: rec.plan.variation, reason: res.coaching.reason, timing: res.contact.timing, runs: o.runs, dismissal: o.dismissal };
    }
  }
  return {
    overIndex: over.deliveries[0]?.overIndex ?? 0,
    runs,
    balls: rs.length,
    fours,
    sixes,
    boundaries: fours + sixes,
    dots,
    timing,
    scoringAreas: sortAreas(areas),
    weakest,
    dismissal,
    complete: rs.length === 6,
  };
}

/**
 * Summary of the whole innings so far (completed overs plus the over in progress or the over of the dismissal).
 * `results` may supply resolved results keyed by "overIndex:ballIndex"; missing ones are re-simulated.
 */
export function inningsSummary(state: PracticeInningsState, results?: ReadonlyMap<string, DeliveryResult> | Readonly<Record<string, DeliveryResult>>): InningsSummary {
  const get = (r: DeliveryRecord): DeliveryResult | undefined => {
    const k = `${r.overIndex}:${r.ballIndex}`;
    if (!results) return undefined;
    return results instanceof Map ? results.get(k) : (results as Record<string, DeliveryResult>)[k];
  };
  const overs: Array<{ plan: PracticeOverPlan; deliveries: readonly DeliveryRecord[] }> = [...state.overs];
  if (state.current && state.current.deliveries.length > 0) overs.push(state.current);
  const perOver = overs.map((o) => overSummary(o, o.deliveries.map(get)));
  const timing = emptyTiming();
  const areas = new Map<Region, ScoringArea>();
  let fours = 0;
  let sixes = 0;
  let dots = 0;
  for (const o of perOver) {
    fours += o.fours;
    sixes += o.sixes;
    dots += o.dots;
    for (const k of Object.keys(o.timing) as SwingTiming[]) timing[k] += o.timing[k];
    for (const a of o.scoringAreas) {
      const m = areas.get(a.region) ?? { region: a.region, runs: 0, balls: 0 };
      m.runs += a.runs;
      m.balls += a.balls;
      areas.set(a.region, m);
    }
  }
  let dismissal: InningsSummary['dismissal'] = null;
  if (state.dismissal) {
    const rec = state.dismissal.record;
    const res = get(rec) ?? replayDelivery(rec);
    const role = res.outcome.fielderId ? (rec.field.fielders.find((f) => f.id === res.outcome.fielderId)?.role ?? null) : null;
    const ballNumber = rec.overIndex * 6 + rec.ballIndex + 1;
    dismissal = { record: rec, how: rec.dismissal ?? res.outcome.dismissal!, reason: res.coaching.reason, fielderRole: role, ballNumber, at: `${rec.overIndex}.${rec.ballIndex + 1}` };
  }
  return {
    id: state.id,
    status: state.status,
    finished: state.status === 'out' || state.status === 'complete',
    runs: state.runs,
    balls: state.balls,
    overs: oversNotation(state.balls),
    completedOvers: state.overs.length,
    survivedBalls: state.dismissal ? state.balls - 1 : state.balls,
    fours,
    sixes,
    dots,
    strikeRate: state.balls ? Math.round((state.runs / state.balls) * 1000) / 10 : 0,
    timing,
    scoringAreas: sortAreas(areas),
    perOver,
    dismissal,
  };
}
