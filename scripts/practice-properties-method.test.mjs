import assert from 'node:assert/strict';
import test from 'node:test';
import { fair6CoachComparison } from './practice-properties-method.mjs';

const sample = (dismissals, balls, meanRuns = 20) => ({ dismissals, balls, meanRuns });

test('FAIR6 compares dismissals per delivered ball, not equal raw counts', () => {
  const result = fair6CoachComparison(sample(100, 500, 40), sample(100, 2_000, 20));
  assert.equal(result.coachComparisonEvidencePass, true);
  assert.equal(result.expectedRunsPass, true);
  assert.equal(result.noMoreDismissalsPass, false);
  assert.deepEqual(result.coach, { dismissals: 100, balls: 500, dismissalsPerBall: 0.2 });
  assert.deepEqual(result.fixed, { dismissals: 100, balls: 2_000, dismissalsPerBall: 0.05 });
});

test('FAIR6 permits a greater raw count only when its per-ball rate is no greater', () => {
  const result = fair6CoachComparison(sample(100, 5_000, 40), sample(90, 1_800, 20));
  assert.equal(result.coachComparisonEvidencePass, true);
  assert.equal(result.noMoreDismissalsPass, true);
});

test('FAIR6 permits exactly equal dismissal rates', () => {
  const result = fair6CoachComparison(sample(100, 2_000, 40), sample(25, 500, 20));
  assert.equal(result.coachComparisonEvidencePass, true);
  assert.equal(result.noMoreDismissalsPass, true);
});

test('FAIR6 rejects zero or invalid ball-count evidence', () => {
  for (const balls of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    const result = fair6CoachComparison(sample(0, balls, 40), sample(25, 500, 20));
    assert.equal(result.coachComparisonEvidencePass, false, `balls=${String(balls)}`);
    assert.equal(result.noMoreDismissalsPass, false, `balls=${String(balls)}`);
  }
});

test('FAIR6 rejects invalid dismissal and mean-run evidence', () => {
  for (const coach of [
    sample(-1, 500, 40),
    sample(1.5, 500, 40),
    sample(Number.POSITIVE_INFINITY, 500, 40),
    sample(501, 500, 40),
    sample(100, 500, Number.NaN),
    sample(100, 500, -1),
  ]) {
    const result = fair6CoachComparison(coach, sample(25, 500, 20));
    assert.equal(result.coachComparisonEvidencePass, false);
    assert.equal(result.expectedRunsPass, false);
    assert.equal(result.noMoreDismissalsPass, false);
  }
});
