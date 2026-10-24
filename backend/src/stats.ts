import { DEFAULT_MIN_COHORT, SCORE_BANDS, type DailyStats, type RepublicOutcome, type ScoreBand, type StrategyClass } from './contract';

export function bandOf(score: number): ScoreBand {
  if (score >= 85) return '85-100';
  if (score >= 70) return '70-84';
  if (score >= 55) return '55-69';
  if (score >= 40) return '40-54';
  return '0-39';
}

/** Mirrors src/share/fingerprint.ts strategyClass. */
export function strategyClass(fp: string): StrategyClass {
  const codes = fp.toUpperCase().split('').filter((c) => 'DESPXW'.includes(c));
  if (codes.length === 0) return 'mixed';
  if (codes.includes('X')) return 'force';
  const waited = codes.filter((c) => c === 'W').length;
  if (waited * 2 >= codes.length) return 'passive';
  const restraint = codes.filter((c) => c === 'D' || c === 'E' || c === 'S').length;
  if (restraint / codes.length >= 0.6) return 'restraint';
  return 'mixed';
}

export interface CountRow {
  key: string;
  n: number;
}

export interface Aggregates {
  count: number;
  bands: CountRow[];
  outcomes: CountRow[];
  strategies: CountRow[];
  /** Sorted scores (ascending) or a histogram by score. */
  scores: CountRow[];
}

/** Shape of a `daily_stats` row as D1 returns it (JSON maps stored as text). */
export interface StatsRow {
  count: number;
  score_sum: number;
  bands_json: string;
  outcomes_json: string;
  strategies_json: string;
  scores_json: string;
  updated_at: string;
}

function rowsFromJson(text: string): CountRow[] {
  try {
    const obj = JSON.parse(text || '{}') as Record<string, unknown>;
    return Object.entries(obj)
      .map(([key, n]) => ({ key, n: Number(n) || 0 }))
      .filter((r) => r.n > 0);
  } catch {
    return [];
  }
}

/** Converts the incremental row into the same Aggregates the full scan produces, so `publicStats` needs no branch. */
export function aggregatesFromStatsRow(row: StatsRow): Aggregates {
  return {
    count: Number(row.count) || 0,
    bands: rowsFromJson(row.bands_json),
    outcomes: rowsFromJson(row.outcomes_json),
    strategies: rowsFromJson(row.strategies_json),
    scores: rowsFromJson(row.scores_json),
  };
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

export function medianFromHistogram(scores: CountRow[], total: number): number | undefined {
  if (total === 0) return undefined;
  const sorted = [...scores].map((r) => ({ score: Number(r.key), n: r.n })).sort((a, b) => a.score - b.score);
  const mid = (total + 1) / 2;
  let acc = 0;
  let lower: number | undefined;
  for (const row of sorted) {
    acc += row.n;
    if (lower === undefined && acc >= Math.floor(mid)) lower = row.score;
    if (acc >= Math.ceil(mid)) return lower === undefined ? row.score : (lower + row.score) / 2;
  }
  return lower;
}

/** Public stats document. Percentages only when the cohort is large enough. */
export function publicStats(dailyId: string, contentVersion: string, agg: Aggregates, now: Date, minCohort = DEFAULT_MIN_COHORT): DailyStats {
  const ready = agg.count >= minCohort;
  const base: DailyStats = { dailyId, contentVersion, count: agg.count, minCohort, ready, asOf: now.toISOString() };
  if (!ready) return base;
  const scoreBands = Object.fromEntries(SCORE_BANDS.map((b) => [b, pct(agg.bands.find((r) => r.key === b)?.n ?? 0, agg.count)])) as Record<ScoreBand, number>;
  const outcomes: Partial<Record<RepublicOutcome, number>> = {};
  for (const r of agg.outcomes) outcomes[r.key as RepublicOutcome] = pct(r.n, agg.count);
  const strategyMix: Record<string, number> = {};
  for (const r of agg.strategies) strategyMix[r.key] = pct(r.n, agg.count);
  return { ...base, scoreBands, outcomes, strategyMix, median: medianFromHistogram(agg.scores, agg.count) };
}
