/**
 * Binds the community client (outbox + stats cache) to the app's IndexedDB persistence,
 * and configures analytics from settings. Every call here is best-effort: failures never surface to gameplay.
 */
import type { CommunityStorage, OutboxItem, StatsCacheEntry } from '@/community/types';
import { clearCommunityStorage, setCommunityStorage, startCommunitySync } from '@/community';
import { configureAnalytics, setAnalyticsEnabled } from '@/analytics';
import { storage, type OutboxItem as StoredOutboxItem } from './persistence';
import type { Settings } from '@/engine/types';

const idbCommunityStorage: CommunityStorage = {
  async getOutbox() {
    const rows = (await storage.getOutbox().catch(() => undefined)) ?? [];
    return rows.map((r) => r.payload as OutboxItem).filter((p) => p && typeof p === 'object' && 'submission' in p);
  },
  async setOutbox(items) {
    const rows: StoredOutboxItem[] = items.map((item) => ({
      id: item.submission.submissionId,
      createdAt: item.queuedAt,
      payload: item,
      attempts: item.attempts,
    }));
    await storage.setOutbox(rows).catch(() => undefined);
  },
  async getStats(dailyId) {
    const cache = (await storage.getCommunityCache().catch(() => undefined)) ?? {};
    const entry = cache[dailyId];
    if (!entry) return undefined;
    const { fetchedAt, ...stats } = entry;
    return { stats, fetchedAt } satisfies StatsCacheEntry;
  },
  async setStats(dailyId, entry) {
    const cache = (await storage.getCommunityCache().catch(() => undefined)) ?? {};
    const next = { ...cache, [dailyId]: { ...entry.stats, fetchedAt: entry.fetchedAt } };
    // Keep the cache small: the newest 60 days only.
    const keys = Object.keys(next).sort().reverse().slice(0, 60);
    const trimmed = Object.fromEntries(keys.map((k) => [k, next[k]]));
    await storage.setCommunityCache(trimmed).catch(() => undefined);
  },
};

let started = false;

export async function startCommunityAndAnalytics(input: { installId: string; appVersion: string; isNative: boolean; settings: Settings }): Promise<void> {
  try {
    setCommunityStorage(idbCommunityStorage);
  } catch {
    /* keep the module's default adapter */
  }
  try {
    await configureAnalytics({
      installId: input.installId,
      appVersion: input.appVersion,
      platform: input.isNative ? 'android' : 'web',
      optOut: input.settings.analyticsOptOut,
      mode: input.settings.playStyle,
    });
  } catch {
    /* analytics stays off */
  }
  if (!started) {
    started = true;
    try {
      startCommunitySync();
    } catch {
      /* offline or disabled */
    }
  }
}

export function applyAnalyticsOptOut(optOut: boolean): void {
  try {
    setAnalyticsEnabled(!optOut);
  } catch {
    /* ignore */
  }
}

export async function wipeCommunityData(): Promise<void> {
  try {
    await clearCommunityStorage();
  } catch {
    /* ignore */
  }
}
