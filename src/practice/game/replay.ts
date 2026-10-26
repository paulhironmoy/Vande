/**
 * The one Practice replay representation is the contract's DeliveryRecord: the delivery (plan, seed, bowler,
 * conditions, field), the settings that change the physics (handedness, assistance, the performance tier's extra
 * tolerance) and the player's NormalizedSwing. Re-simulating a record (`replayDelivery`, src/physics/resolve.ts)
 * reproduces the original DeliveryResult exactly: same contact, same trajectory, same fielding, same score.
 *
 * "Replay This Over" re-simulates the over's six records. "Practice This Delivery" (`repeatDelivery`) bowls the same
 * delivery again with a new swing in a training context that never touches the innings.
 */
import { PRACTICE_SIM_VERSION, type DeliveryRecord, type DeliveryResult, type NormalizedSwing, type PracticeInningsState } from '@/contracts/practice';
import { flight, replayDelivery, resolveDelivery } from '@/physics';
import { inningsReducer, nextDelivery, type NextDelivery } from './innings';

export { replayDelivery };

/** The record of a resolved delivery (what `deliveryResolved` takes). */
export function makeRecord(next: NextDelivery, swing: NormalizedSwing | null, tierToleranceMs: number, result: Pick<DeliveryResult, 'outcome'>): DeliveryRecord {
  return {
    version: PRACTICE_SIM_VERSION,
    overIndex: next.overIndex,
    ballIndex: next.ballIndex,
    bowler: next.bowler,
    plan: next.plan,
    seed: next.seed,
    conditions: next.conditions,
    field: next.field,
    handedness: next.handedness,
    assist: next.assist,
    tierToleranceMs,
    swing,
    runs: result.outcome.runs,
    dismissal: result.outcome.dismissal,
  };
}

/** The flight of the next ball (fixed before the batter acts). */
export function nextFlight(next: NextDelivery) {
  return flight({ plan: next.plan, bowler: next.bowler, conditions: next.conditions, seed: next.seed, handedness: next.handedness });
}

/** Resolve the next ball with a swing (null = leave): the result and its record. Does not change the innings. */
export function resolveNext(next: NextDelivery, swing: NormalizedSwing | null, tierToleranceMs: number): { result: DeliveryResult; record: DeliveryRecord } {
  const result = resolveDelivery({
    flight: nextFlight(next),
    swing,
    field: next.field,
    bowler: next.bowler,
    conditions: next.conditions,
    handedness: next.handedness,
    assist: next.assist,
    tierToleranceMs,
  });
  return { result, record: makeRecord(next, swing, tierToleranceMs, result) };
}

/**
 * Bowl the next ball of a batting innings in one step (start, resolve, record): for tests, simulations and any caller
 * that does not need to render between the start and the swing. Returns null when no ball is due.
 */
export function playBall(state: PracticeInningsState, swing: NormalizedSwing | null, tierToleranceMs = 0): { state: PracticeInningsState; result: DeliveryResult; record: DeliveryRecord } | null {
  const next = nextDelivery(state);
  if (!next || state.inFlight) return null;
  const started = inningsReducer(state, { type: 'deliveryStarted' });
  const { result, record } = resolveNext(next, swing, tierToleranceMs);
  return { state: inningsReducer(started, { type: 'deliveryResolved', record }), result, record };
}

/** "Replay This Over": the six (or fewer) deliveries re-simulated exactly. */
export function replayOver(over: { deliveries: readonly DeliveryRecord[] }): DeliveryResult[] {
  return over.deliveries.map((r) => replayDelivery(r));
}

/** Whether a record re-simulates to the runs and dismissal it claims. */
export function verifyRecord(record: DeliveryRecord): boolean {
  const r = replayDelivery(record);
  return r.outcome.runs === record.runs && r.outcome.dismissal === record.dismissal;
}

/**
 * "Practice This Delivery": the same delivery (plan, seed, bowler, field, conditions) with a new swing. Non-scoring:
 * it returns a result and changes nothing else. The assistance level and tier tolerance default to the record's.
 */
export function repeatDelivery(record: DeliveryRecord, swing: NormalizedSwing | null, opts: { assist?: DeliveryRecord['assist']; tierToleranceMs?: number } = {}): DeliveryResult {
  return replayDelivery({ ...record, swing, assist: opts.assist ?? record.assist, tierToleranceMs: opts.tierToleranceMs ?? record.tierToleranceMs });
}
