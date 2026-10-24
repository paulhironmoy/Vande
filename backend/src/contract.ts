/** Mirrors src/community/types.ts and src/engine/types.ts (DailyStats). Keep in sync by hand; tests compare shapes. */
export const OUTCOMES = ['resilient', 'free-fragile', 'order-without-trust', 'manipulated', 'institutionally-weakened', 'economically-disrupted'] as const;
export type RepublicOutcome = (typeof OUTCOMES)[number];

export const SCORE_BANDS = ['0-39', '40-54', '55-69', '70-84', '85-100'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const STRATEGIES = ['restraint', 'mixed', 'force', 'passive'] as const;
export type StrategyClass = (typeof STRATEGIES)[number];

export interface DailyResultSubmission {
  v: 1;
  dailyId: string;
  contentVersion: string;
  submissionId: string;
  score: number;
  outcome: RepublicOutcome;
  fingerprint: string;
  mode: 'simple' | 'full';
  appVersion: string;
  platform: 'web' | 'android';
}

export interface DailyStats {
  dailyId: string;
  contentVersion: string;
  count: number;
  minCohort: number;
  ready: boolean;
  asOf: string;
  scoreBands?: Record<ScoreBand, number>;
  outcomes?: Partial<Record<RepublicOutcome, number>>;
  strategyMix?: Record<string, number>;
  median?: number;
}

export const MAX_BODY_BYTES = 2048;
export const DEFAULT_MIN_COHORT = 25;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;
/** Reads are limited only on an edge-cache miss; the cap is deliberately generous. */
export const DEFAULT_RATE_LIMIT_READS_PER_MINUTE = 120;
/** Stats responses are cached at the edge (and by browsers) for this long. */
export const STATS_CACHE_SECONDS = 300;
export const RESULT_RETENTION_DAYS = 180;
