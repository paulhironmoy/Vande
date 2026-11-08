/** Production startup/recovery invariants; no app state is written by this helper. */
import { isDeepStrictEqual } from 'node:util';

const fail = (message) => {
  throw new Error(message);
};

export function recordsOf(state) {
  if (!state) return [];
  return [...(state.overs ?? []).flatMap((over) => over.deliveries ?? []), ...(state.current?.deliveries ?? [])];
}

export function persistedSnapshot(value) {
  const state = value?.state ?? null;
  return state
    ? {
        wrapperVersion: value.v ?? null,
        id: state.id ?? null,
        status: state.status ?? null,
        inFlight: state.inFlight ?? null,
        completedOvers: state.overs?.length ?? 0,
        currentBallCount: state.current?.deliveries?.length ?? 0,
        balls: state.balls ?? recordsOf(state).length,
        records: structuredClone(recordsOf(state)),
      }
    : null;
}

export function routeFor(snapshot) {
  if (!snapshot) return { name: 'fresh', root: 'practice-menu', firstAction: 'practice-random', sameInnings: false };
  if (snapshot.status === 'batting') return { name: 'resume-batting', root: 'practice-menu', firstAction: 'practice-continue', sameInnings: true };
  if (snapshot.status === 'over_complete' || snapshot.status === 'choosing_over') {
    return { name: 'next-over', root: 'practice-menu', firstAction: 'practice-random', sameInnings: true };
  }
  if (snapshot.status === 'out') return { name: 'terminal-out', root: 'practice-out-summary', firstAction: 'practice-new-innings', sameInnings: false };
  if (snapshot.status === 'complete') return { name: 'terminal-complete', root: 'practice-innings-summary', firstAction: 'practice-new-innings', sameInnings: false };
  return fail(`Unsupported persisted status: ${snapshot.status}`);
}

export function proveRecoveredLeave(before, after) {
  if (!before?.inFlight) fail('The first release did not retain an in-flight delivery');
  if (!after) fail('The returning visit has no persisted innings');
  if (before.id !== after.id) fail(`Recovery changed innings id (${before.id} -> ${after.id})`);
  if (after.inFlight !== null) fail('Recovery left a delivery in flight');
  if (after.records.length !== before.records.length + 1) fail(`Recovery must append exactly one record (${before.records.length} -> ${after.records.length})`);
  if (after.balls !== before.balls + 1) fail(`Recovery must increment balls exactly once (${before.balls} -> ${after.balls})`);
  if (before.records.length !== before.balls || after.records.length !== after.balls) fail('Persisted balls counter disagrees with full record count');
  if (!isDeepStrictEqual(after.records.slice(0, before.records.length), before.records)) fail('Recovery mutated the persisted record prefix');
  const tail = after.records.at(-1);
  if (tail?.overIndex !== before.inFlight.overIndex || tail?.ballIndex !== before.inFlight.ballIndex) fail('Recovered record does not match the saved in-flight coordinate');
  if (tail?.swing !== null) fail('Recovered delivery was not an unswung leave');
  return { sameId: true, exactIncrement: 1, ballsIncrement: 1, immutablePrefix: true, coordinate: structuredClone(before.inFlight), swing: null, resultingStatus: after.status };
}

export function proveNextRelease(recovered, started, route) {
  if (!started?.inFlight) fail('The next visit did not persist a delivery before release');
  if (started.status !== 'batting') fail(`The next release is not in a batting innings (${started.status})`);
  if (route.sameInnings) {
    if (started.id !== recovered.id) fail(`Same-innings route changed id (${recovered.id} -> ${started.id})`);
    if (!isDeepStrictEqual(started.records, recovered.records)) fail('Same-innings route mutated resolved records before the next release');
    if (started.balls !== recovered.balls || started.records.length !== started.balls) fail('Same-innings route changed the resolved ball count before release');
    const expected = { overIndex: recovered.completedOvers, ballIndex: route.name === 'resume-batting' ? recovered.currentBallCount : 0 };
    if (!isDeepStrictEqual(started.inFlight, expected)) fail(`Next release skipped a coordinate (expected ${expected.overIndex}.${expected.ballIndex})`);
    return { sameId: true, immutableRecords: true, legitimateNewInnings: false, coordinate: expected };
  }
  if (!route.name.startsWith('terminal-')) fail(`Unexpected new-innings route: ${route.name}`);
  if (started.id === recovered.id) fail('Terminal New innings did not create a new id');
  if (started.records.length !== 0) fail('New innings already has resolved records at its first release');
  if (started.balls !== 0) fail('New innings has a nonzero resolved ball count at its first release');
  if (started.inFlight.overIndex !== 0 || started.inFlight.ballIndex !== 0) fail('New innings did not start at ball 0.0');
  return { sameId: false, immutableRecords: true, legitimateNewInnings: true, oldId: recovered.id, newId: started.id };
}

export function proveStableInFlight(atRelease, beforeClose) {
  if (!atRelease?.inFlight || !beforeClose?.inFlight) fail('Release state did not remain in flight until close');
  for (const key of ['id', 'status', 'balls']) if (!isDeepStrictEqual(atRelease[key], beforeClose[key])) fail(`Release state changed before close: ${key}`);
  if (!isDeepStrictEqual(atRelease.inFlight, beforeClose.inFlight)) fail('In-flight coordinate changed before close');
  if (!isDeepStrictEqual(atRelease.records, beforeClose.records)) fail('Resolved records changed before close');
  return { stableUntilClose: true, coordinate: structuredClone(atRelease.inFlight), balls: atRelease.balls, records: atRelease.records.length };
}
