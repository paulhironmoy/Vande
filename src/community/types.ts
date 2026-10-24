import type { DailyContentVersion, DailyId, DailyStats, PlayStyle, RepublicOutcome } from '@/engine/types';

/** Exactly what leaves the device for one official daily result. Mirrors backend/src/contract.ts. */
export interface DailyResultSubmission {
  v: 1;
  dailyId: DailyId;
  contentVersion: DailyContentVersion;
  /** First 32 hex chars of sha256(installId + ':' + dailyId). Per-day, so days cannot be linked. */
  submissionId: string;
  score: number;
  outcome: RepublicOutcome;
  fingerprint: string;
  mode: PlayStyle;
  appVersion: string;
  platform: 'web' | 'android';
}

export interface OutboxItem {
  submission: DailyResultSubmission;
  /** ISO time when it was queued; dropped after 14 days. */
  queuedAt: string;
  attempts: number;
}

export interface StatsCacheEntry {
  stats: DailyStats;
  fetchedAt: string;
}

/** Storage adapter: the lead swaps the default localStorage implementation for IndexedDB stores. */
export interface CommunityStorage {
  getOutbox(): Promise<OutboxItem[]>;
  setOutbox(items: OutboxItem[]): Promise<void>;
  getStats(dailyId: DailyId): Promise<StatsCacheEntry | undefined>;
  setStats(dailyId: DailyId, entry: StatsCacheEntry): Promise<void>;
}

export type SubmitStatus = 'accepted' | 'duplicate' | 'queued' | 'rejected' | 'skipped';

export interface SubmitContext {
  installId: string;
  appVersion: string;
  platform: 'web' | 'android';
  communitySharing: 'unset' | 'on' | 'off';
}

export type StatsStatus = 'disabled' | 'loading' | 'ready' | 'offline' | 'error';
