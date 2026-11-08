/** Aggregate only complete, finite visits; retain every failure and late error. */
export function summarizeStartupVisits(visits) {
  const valid = visit => visit.ok && !visit.failure && !(visit.errors?.length) && !(visit.closeErrors?.length) &&
    ['firstScreen', 'interactive', 'release'].every(key => Number.isFinite(visit.t?.[key]));
  const ok = visits.filter(valid);
  const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
  const metric = key => median(ok.map(visit => visit.t[key]));
  return {
    n: ok.length,
    firstScreenMs: metric('firstScreen'), interactiveMs: metric('interactive'), homeMs: metric('home'),
    setupMs: metric('setup'), playTapMs: metric('playTap'), runupMs: metric('runup'), firstReleaseMs: metric('release'),
    practiceToReleaseMs: median(ok.map(visit => visit.practiceToRelease)),
    resourcesKb: median(ok.map(visit => visit.resourcesKb)),
    errors: visits.reduce((sum, visit) => sum + (visit.errors?.length ?? 0) + (visit.closeErrors?.length ?? 0), 0),
    errorSamples: visits.flatMap(visit => [...(visit.errors ?? []), ...(visit.closeErrors ?? [])]).slice(0, 4),
    failures: visits.filter(visit => !valid(visit)).map(visit => visit.failure?.message ?? 'Visit incomplete or errors/invalid metrics observed'),
    visits,
  };
}
