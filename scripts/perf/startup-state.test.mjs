import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persistedSnapshot, proveNextRelease, proveRecoveredLeave, proveStableInFlight, routeFor } from './startup-state.mjs';

const record = (overIndex, ballIndex, swing = null) => ({ overIndex, ballIndex, seed: `s-${overIndex}-${ballIndex}`, swing, runs: 0, dismissal: null });
const state = ({ id = 'innings-a', status = 'batting', records = [], inFlight = null } = {}) => ({
  v: 1,
  state: { id, status, balls: records.length, inFlight, overs: [], current: status === 'batting' ? { deliveries: records } : null },
});

test('routes only exact persisted statuses through visible production actions', () => {
  assert.deepEqual(routeFor(null), { name: 'fresh', root: 'practice-menu', firstAction: 'practice-random', sameInnings: false });
  assert.equal(routeFor(persistedSnapshot(state())).firstAction, 'practice-continue');
  assert.equal(routeFor(persistedSnapshot(state({ status: 'over_complete' }))).firstAction, 'practice-random');
  assert.equal(routeFor(persistedSnapshot(state({ status: 'choosing_over' }))).name, 'next-over');
  assert.deepEqual(routeFor(persistedSnapshot(state({ status: 'out' }))), { name: 'terminal-out', root: 'practice-out-summary', firstAction: 'practice-new-innings', sameInnings: false });
  assert.equal(routeFor(persistedSnapshot(state({ status: 'complete' }))).root, 'practice-innings-summary');
  assert.throws(() => routeFor({ status: 'unknown' }), /Unsupported/);
});

test('recovery requires the same id, immutable full prefix and exactly one matching unswung record', () => {
  const prefix = [record(0, 0)];
  const before = persistedSnapshot(state({ records: prefix, inFlight: { overIndex: 0, ballIndex: 1 } }));
  const after = persistedSnapshot(state({ records: [...prefix, record(0, 1)] }));
  assert.deepEqual(proveRecoveredLeave(before, after), { sameId: true, exactIncrement: 1, ballsIncrement: 1, immutablePrefix: true, coordinate: { overIndex: 0, ballIndex: 1 }, swing: null, resultingStatus: 'batting' });
  assert.throws(() => proveRecoveredLeave(before, { ...after, id: 'other' }), /changed innings id/);
  assert.throws(() => proveRecoveredLeave(before, { ...after, records: [record(0, 0, { kind: 'defend' }), record(0, 1)] }), /mutated/);
  assert.throws(() => proveRecoveredLeave(before, { ...after, records: [...after.records, record(0, 2)] }), /exactly one/);
  assert.throws(() => proveRecoveredLeave(before, { ...after, balls: before.balls }), /increment balls/);
  assert.throws(() => proveRecoveredLeave(before, { ...after, records: [prefix[0], record(0, 1, { kind: 'defend' })] }), /unswung/);
  assert.throws(() => proveRecoveredLeave(before, { ...after, inFlight: { overIndex: 0, ballIndex: 2 } }), /left a delivery/);
});

test('the next release preserves a resumed innings or proves an explicit terminal new innings', () => {
  const recovered = persistedSnapshot(state({ records: [record(0, 0)] }));
  const resumed = persistedSnapshot(state({ records: recovered.records, inFlight: { overIndex: 0, ballIndex: 1 } }));
  assert.equal(proveNextRelease(recovered, resumed, routeFor(recovered)).sameId, true);
  assert.throws(() => proveNextRelease(recovered, { ...resumed, inFlight: { overIndex: 0, ballIndex: 2 } }, routeFor(recovered)), /skipped a coordinate/);
  assert.throws(() => proveNextRelease(recovered, { ...resumed, balls: 2 }, routeFor(recovered)), /ball count/);
  const terminal = { ...recovered, status: 'out' };
  const fresh = persistedSnapshot(state({ id: 'innings-b', records: [], inFlight: { overIndex: 0, ballIndex: 0 } }));
  assert.equal(proveNextRelease(terminal, fresh, routeFor(terminal)).legitimateNewInnings, true);
  assert.throws(() => proveNextRelease(recovered, { ...resumed, records: [record(0, 0, { kind: 'defend' })] }, routeFor(recovered)), /mutated/);
  const completedRecords = Array.from({ length: 6 }, (_, ballIndex) => record(0, ballIndex));
  const betweenOvers = { ...recovered, status: 'over_complete', completedOvers: 1, currentBallCount: 0, balls: 6, records: completedRecords, inFlight: null };
  const nextOverRelease = { ...betweenOvers, status: 'batting', inFlight: { overIndex: 1, ballIndex: 0 } };
  assert.deepEqual(proveNextRelease(betweenOvers, nextOverRelease, routeFor(betweenOvers)).coordinate, { overIndex: 1, ballIndex: 0 });
  assert.throws(() => proveNextRelease(betweenOvers, { ...nextOverRelease, inFlight: { overIndex: 2, ballIndex: 0 } }, routeFor(betweenOvers)), /skipped a coordinate/);
});

test('the claimed recovery baseline must remain in flight and unchanged until page close', () => {
  const release = persistedSnapshot(state({ inFlight: { overIndex: 0, ballIndex: 0 } }));
  assert.equal(proveStableInFlight(release, structuredClone(release)).stableUntilClose, true);
  assert.throws(() => proveStableInFlight(release, { ...release, inFlight: null }), /remain in flight/);
  assert.throws(() => proveStableInFlight(release, { ...release, records: [record(0, 0)], balls: 1 }), /balls|records/);
});
