import { create } from 'zustand';
import type { DailyId, DailyStats } from '@/engine/types';
import { fetchDailyStats, isCommunityActive } from './client';
import type { StatsStatus } from './types';

interface Entry {
  status: StatsStatus;
  stats?: DailyStats;
  fromCache: boolean;
}

interface CommunityState {
  entries: Record<string, Entry>;
  load(dailyId: DailyId, opts?: { force?: boolean; contentVersion?: string }): Promise<void>;
}

export const useCommunity = create<CommunityState>()((set, get) => ({
  entries: {},
  async load(dailyId, opts = {}) {
    if (!isCommunityActive()) {
      set({ entries: { ...get().entries, [dailyId]: { status: 'disabled', fromCache: false } } });
      return;
    }
    const prev = get().entries[dailyId];
    set({ entries: { ...get().entries, [dailyId]: { status: 'loading', stats: prev?.stats, fromCache: prev?.fromCache ?? false } } });
    const result = await fetchDailyStats(dailyId, opts);
    const status: StatsStatus = result.stats ? 'ready' : result.error === 'offline' ? 'offline' : result.error === 'disabled' ? 'disabled' : 'error';
    set({ entries: { ...get().entries, [dailyId]: { status, stats: result.stats, fromCache: result.fromCache } } });
  },
}));
