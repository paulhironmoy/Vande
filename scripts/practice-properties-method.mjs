/**
 * Compare the owner-approved FAIR6 coach and best-fixed stopped-innings samples.
 *
 * Dismissals are compared per delivered ball because stopped innings can expose
 * the policies to different ball counts. Raw counts remain in the returned
 * evidence so the normalized result is auditable.
 */
export function fair6CoachComparison(coach, fixed) {
  const valid = (sample) => sample !== null
    && typeof sample === 'object'
    && Number.isFinite(sample.meanRuns)
    && sample.meanRuns >= 0
    && Number.isSafeInteger(sample.balls)
    && sample.balls > 0
    && Number.isSafeInteger(sample.dismissals)
    && sample.dismissals >= 0
    && sample.dismissals <= sample.balls;

  const coachValid = valid(coach);
  const fixedValid = valid(fixed);
  const coachComparisonEvidencePass = coachValid && fixedValid;
  const coachDismissalsPerBall = coachValid ? coach.dismissals / coach.balls : null;
  const fixedDismissalsPerBall = fixedValid ? fixed.dismissals / fixed.balls : null;

  // BigInt keeps equal rational rates equal without floating-point rounding.
  const noMoreDismissalsPass = coachComparisonEvidencePass
    && BigInt(coach.dismissals) * BigInt(fixed.balls) <= BigInt(fixed.dismissals) * BigInt(coach.balls);
  const expectedRunsPass = coachComparisonEvidencePass
    && coach.meanRuns >= 2 * fixed.meanRuns;

  return {
    coachComparisonEvidencePass,
    expectedRunsPass,
    noMoreDismissalsPass,
    coach: {
      dismissals: coach?.dismissals ?? null,
      balls: coach?.balls ?? null,
      dismissalsPerBall: coachDismissalsPerBall,
    },
    fixed: {
      dismissals: fixed?.dismissals ?? null,
      balls: fixed?.balls ?? null,
      dismissalsPerBall: fixedDismissalsPerBall,
    },
  };
}
