/**
 * Local Practice metrics: counts and coarse histograms only, for the hidden diagnostics view and the success
 * metrics in docs/PRACTICE.md. No raw gestures, no timestamps, no device identifiers; never sent. The same coarse
 * buckets feed the consent-gated practice_* analytics events (src/contracts/analytics.ts).
 */
import type { AnalyticsProps, ContactKind, DeliveryOutcome, DeliveryResult, PerfTier } from '@/contracts';
import { PRACTICE_KEYS, isInt, isObj, localStore, readJson, removeKey, writeJson, type KeyStore } from './storage';

export type TimingProp = NonNullable<AnalyticsProps['timing']>;
export type IntentMatch = NonNullable<AnalyticsProps['intentMatch']>;
export type LatencyBucket = NonNullable<AnalyticsProps['latencyBucket']>;
export type TtfdBucket = NonNullable<AnalyticsProps['ttfdBucket']>;
export type OutcomeProp = NonNullable<AnalyticsProps['outcome']>;
export type OverNumberProp = NonNullable<AnalyticsProps['overNumber']>;

export const TIMING_PROPS: readonly TimingProp[] = ['early', 'on_time', 'late', 'none'];
export const INTENT_MATCHES: readonly IntentMatch[] = ['on_target', 'near', 'off_target', 'none'];
export const LATENCY_BUCKETS: readonly LatencyBucket[] = ['<50ms', '50-70ms', '70-100ms', '>100ms'];
export const TTFD_BUCKETS: readonly TtfdBucket[] = ['<5s', '5-10s', '10-20s', '>20s'];
export const OUTCOME_PROPS: readonly OutcomeProp[] = ['dot', 'runs', 'four', 'six', 'out'];
export const CONTACT_KINDS: readonly ContactKind[] = ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss', 'leave'];
/** Timing-error histogram: 25 ms bins from −200 to +200 ms, plus one bin each side for anything beyond. */
export const TIMING_BIN_MS = 25;
export const TIMING_RANGE_MS = 200;
export const TIMING_BINS = (2 * TIMING_RANGE_MS) / TIMING_BIN_MS + 2;
/** Intended direction within this many degrees of the actual exit direction is on target; within NEAR is near. */
export const INTENT_ON_TARGET_DEG = 15;
export const INTENT_NEAR_DEG = 35;

export function ttfdBucket(ms: number): TtfdBucket {
  return ms < 5000 ? '<5s' : ms < 10000 ? '5-10s' : ms < 20000 ? '10-20s' : '>20s';
}

export function latencyBucket(ms: number): LatencyBucket {
  return ms < 50 ? '<50ms' : ms < 70 ? '50-70ms' : ms < 100 ? '70-100ms' : '>100ms';
}

export function durationBucket(ms: number): NonNullable<AnalyticsProps['durationBucket']> {
  return ms < 30_000 ? '<30s' : ms < 60_000 ? '30-60s' : ms < 120_000 ? '1-2m' : ms < 300_000 ? '2-5m' : '>5m';
}

export function fpsBucket(fps: number): NonNullable<AnalyticsProps['fpsBucket']> {
  return fps < 20 ? '<20' : fps < 29.5 ? '20-29' : fps < 44.5 ? '30-44' : fps < 59.5 ? '45-59' : '60+';
}

export function overNumberProp(n: number): OverNumberProp {
  return String(Math.min(10, Math.max(1, Math.round(n)))) as OverNumberProp;
}

/** On time (perfect or solid), early or late by the sign of the error, or none (no swing). */
export function timingProp(r: Pick<DeliveryResult, 'swing' | 'contact'>): TimingProp {
  if (!r.swing || r.contact.timing === 'none' || r.contact.timingErrorMs === null) return 'none';
  if (r.contact.timing === 'perfect' || r.contact.timing === 'solid') return 'on_time';
  return r.contact.timingErrorMs < 0 ? 'early' : 'late';
}

/** Smallest difference between two bearings (degrees). */
export function bearingGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/** The player's intended direction against where the ball actually went (attacking shots that made contact). */
export function intentMatch(r: Pick<DeliveryResult, 'swing' | 'contact'>): IntentMatch {
  const c = r.contact;
  if (!r.swing || r.swing.kind !== 'attack' || c.intendedBearingDeg === null || c.exitBearingDeg === null) return 'none';
  const gap = bearingGap(c.intendedBearingDeg, c.exitBearingDeg);
  return gap <= INTENT_ON_TARGET_DEG ? 'on_target' : gap <= INTENT_NEAR_DEG ? 'near' : 'off_target';
}

export function outcomeProp(o: Pick<DeliveryOutcome, 'runs' | 'boundary' | 'dismissal'>): OutcomeProp {
  if (o.dismissal) return 'out';
  if (o.boundary === 6) return 'six';
  if (o.boundary === 4) return 'four';
  return o.runs > 0 ? 'runs' : 'dot';
}

export function timingBin(errorMs: number): number {
  if (errorMs < -TIMING_RANGE_MS) return 0;
  if (errorMs >= TIMING_RANGE_MS) return TIMING_BINS - 1;
  return 1 + Math.floor((errorMs + TIMING_RANGE_MS) / TIMING_BIN_MS);
}

type Counts<K extends string> = Record<K, number>;
const zero = <K extends string>(keys: readonly K[]): Counts<K> => Object.fromEntries(keys.map((k) => [k, 0])) as Counts<K>;

export interface PracticeMetrics {
  v: 1;
  /** Practice opened. */
  sessions: number;
  /** Scoring deliveries faced (innings balls). */
  deliveries: number;
  /** The first-time warm-up ball and non-scoring repeats. */
  warmups: number;
  repeats: number;
  overs: number;
  wickets: number;
  innings: number;
  nextOver: number;
  replays: number;
  timing: Counts<TimingProp>;
  timingHistogram: number[];
  contact: Counts<ContactKind>;
  intent: Counts<IntentMatch>;
  latency: Counts<LatencyBucket>;
  ttfd: Counts<TtfdBucket>;
  outcomes: Counts<OutcomeProp>;
  tiers: Counts<PerfTier>;
  fallbacks: number;
}

export function emptyMetrics(): PracticeMetrics {
  return {
    v: 1,
    sessions: 0,
    deliveries: 0,
    warmups: 0,
    repeats: 0,
    overs: 0,
    wickets: 0,
    innings: 0,
    nextOver: 0,
    replays: 0,
    timing: zero(TIMING_PROPS),
    timingHistogram: Array.from({ length: TIMING_BINS }, () => 0),
    contact: zero(CONTACT_KINDS),
    intent: zero(INTENT_MATCHES),
    latency: zero(LATENCY_BUCKETS),
    ttfd: zero(TTFD_BUCKETS),
    outcomes: zero(OUTCOME_PROPS),
    tiers: zero(['full', 'assisted', 'below'] as const),
    fallbacks: 0,
  };
}

const COUNTERS = ['sessions', 'deliveries', 'warmups', 'repeats', 'overs', 'wickets', 'innings', 'nextOver', 'replays', 'fallbacks'] as const;
export type MetricCounter = (typeof COUNTERS)[number];

function mergeCounts<K extends string>(base: Counts<K>, raw: unknown): Counts<K> {
  if (!isObj(raw)) return base;
  const out = { ...base };
  for (const k of Object.keys(base) as K[]) if (isInt(raw[k]) && (raw[k] as number) >= 0) out[k] = raw[k] as number;
  return out;
}

export function loadMetrics(store: KeyStore | null = localStore()): PracticeMetrics {
  const raw = readJson(store, PRACTICE_KEYS.metrics);
  const m = emptyMetrics();
  if (!isObj(raw) || raw.v !== 1) return m;
  for (const k of COUNTERS) if (isInt(raw[k]) && (raw[k] as number) >= 0) m[k] = raw[k] as number;
  m.timing = mergeCounts(m.timing, raw.timing);
  m.contact = mergeCounts(m.contact, raw.contact);
  m.intent = mergeCounts(m.intent, raw.intent);
  m.latency = mergeCounts(m.latency, raw.latency);
  m.ttfd = mergeCounts(m.ttfd, raw.ttfd);
  m.outcomes = mergeCounts(m.outcomes, raw.outcomes);
  m.tiers = mergeCounts(m.tiers, raw.tiers);
  if (Array.isArray(raw.timingHistogram) && raw.timingHistogram.length === TIMING_BINS && raw.timingHistogram.every((x) => isInt(x) && x >= 0)) {
    m.timingHistogram = raw.timingHistogram as number[];
  }
  return m;
}

export function saveMetrics(m: PracticeMetrics, store: KeyStore | null = localStore()): void {
  writeJson(store, PRACTICE_KEYS.metrics, m);
}

export function clearMetrics(store: KeyStore | null = localStore()): void {
  removeKey(store, PRACTICE_KEYS.metrics);
}

/** Adds one delivery's coarse facts (pure). `latencyMs` is the stage's input-to-bat measurement, when there was one. */
export function addDelivery(m: PracticeMetrics, r: DeliveryResult, opts: { scoring: boolean; latencyMs?: number | null }): PracticeMetrics {
  const next: PracticeMetrics = {
    ...m,
    timing: { ...m.timing },
    timingHistogram: [...m.timingHistogram],
    contact: { ...m.contact },
    intent: { ...m.intent },
    latency: { ...m.latency },
    outcomes: { ...m.outcomes },
  };
  if (opts.scoring) {
    next.deliveries++;
    next.outcomes[outcomeProp(r.outcome)]++;
    if (r.outcome.dismissal) next.wickets++;
  }
  next.timing[timingProp(r)]++;
  if (r.swing && r.contact.timingErrorMs !== null) next.timingHistogram[timingBin(r.contact.timingErrorMs)]++;
  next.contact[r.contact.kind]++;
  next.intent[intentMatch(r)]++;
  if (typeof opts.latencyMs === 'number' && Number.isFinite(opts.latencyMs) && opts.latencyMs >= 0) next.latency[latencyBucket(opts.latencyMs)]++;
  return next;
}

export function bump(m: PracticeMetrics, key: MetricCounter, by = 1): PracticeMetrics {
  return { ...m, [key]: m[key] + by };
}

export function addTtfd(m: PracticeMetrics, ms: number): PracticeMetrics {
  return { ...m, ttfd: { ...m.ttfd, [ttfdBucket(ms)]: m.ttfd[ttfdBucket(ms)] + 1 } };
}

export function addTier(m: PracticeMetrics, tier: PerfTier): PracticeMetrics {
  return { ...m, tiers: { ...m.tiers, [tier]: m.tiers[tier] + 1 } };
}
