import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeStartupVisits } from './startup-summary.mjs';
import { measureStartupVisit } from './startup-visit.mjs';

const successful = () => ({ ok: true, errors: [], closeErrors: [], t: { firstScreen: 100, interactive: 200, release: 500, home: 100 }, practiceToRelease: 300, resourcesKb: 20 });

test('only finite, complete and error-free observations enter medians', () => {
  const invalid = { ...successful(), t: { firstScreen: 100, interactive: null, release: 500 } };
  const failed = { ...successful(), ok: false, failure: { message: 'returning menu timeout' }, errors: ['original console error'] };
  const result = summarizeStartupVisits([successful(), invalid, failed]);
  assert.equal(result.n, 1);
  assert.equal(result.firstReleaseMs, 500);
  assert.equal(result.errors, 1);
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.includes('returning menu timeout'));
  assert.equal(result.visits.length, 3);
});

test('late page or close errors invalidate an otherwise successful visit', () => {
  const visit = successful();
  visit.errors.push({ kind: 'crash', message: 'after release' });
  visit.closeErrors.push({ message: 'close failed' });
  const result = summarizeStartupVisits([visit]);
  assert.equal(result.n, 0);
  assert.equal(result.firstScreenMs, null);
  assert.equal(result.firstReleaseMs, null);
  assert.equal(result.errors, 2);
  assert.equal(result.failures.length, 1);
});

test('a failed navigation retains original, late and cleanup errors and closes its page', async () => {
  const listeners = new Map();
  let closed = false;
  const page = {
    on: (name, callback) => listeners.set(name, callback),
    addInitScript: async () => {},
    goto: async () => {
      listeners.get('console')({ type: () => 'error', text: () => 'before navigation failure' });
      throw new Error('navigation failed');
    },
    evaluate: async () => ({ phases: [], releases: [], firstInput: null, navigation: null, resourcesKb: 0 }),
    close: async () => {
      closed = true;
      listeners.get('pageerror')(new Error('late page error'));
      throw new Error('close failed');
    },
  };
  const context = { newPage: async () => page, newCDPSession: async () => ({ send: async () => {} }) };
  const visit = await measureStartupVisit({ context, url: 'http://test.invalid' });
  assert.equal(visit.ok, false);
  assert.equal(closed, true);
  assert.match(visit.failure.message, /navigation failed/);
  assert.equal(visit.errors.length, 2);
  assert.equal(visit.closeErrors.length, 1);
  const summary = summarizeStartupVisits([visit]);
  assert.equal(summary.n, 0);
  assert.equal(summary.errors, 3);
  assert.equal(summary.failures.length, 1);
});
