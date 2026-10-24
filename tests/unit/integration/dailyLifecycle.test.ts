import { beforeEach, describe, expect, it } from 'vitest';
import { __resetStoreForTests, useApp } from '@/app/store';
import { __resetPersistenceForTests, storage } from '@/app/persistence';
import { dailyIdFor, resolveDaily } from '@/engine/daily';

async function freshStore() {
  await __resetPersistenceForTests();
  __resetStoreForTests();
  await useApp.getState().hydrate();
  useApp.getState().updateSettings({ autoPauseOnDecision: false });
  useApp.getState().completeIntro();
}

describe('daily lifecycle: abandon, refresh, reset and duplicate completion', () => {
  beforeEach(freshStore);

  it('abandoning mid-attempt never creates an official result; the next attempt is still official', async () => {
    useApp.getState().startDailyQuickPlay();
    useApp.getState().beginDailyPlay();
    useApp.getState().tickGame(20);
    useApp.getState().abandonCampaign();
    const rec = useApp.getState().dailyV2[0];
    expect(rec.official).toBeUndefined();
    expect(rec.startedAt).toBeDefined();
    useApp.getState().startDailyQuickPlay();
    expect(useApp.getState().intent?.official).toBe(true);
  });

  it('a refresh mid-attempt restores the paused game with the daily intent and the completion is still official', async () => {
    useApp.getState().startDailyQuickPlay();
    useApp.getState().beginDailyPlay();
    useApp.getState().tickGame(15);
    const tick = useApp.getState().game!.tick;
    const dailyId = useApp.getState().plan!.dailyDate!;
    // Persist happens immediately on start; flush any debounced save by waiting a moment.
    await new Promise((r) => setTimeout(r, 500));
    const saved = await storage.getSession();
    expect(saved?.plan.dailyDate).toBe(dailyId);
    __resetStoreForTests();
    await useApp.getState().hydrate();
    const st = useApp.getState();
    expect(st.game?.tick).toBe(tick);
    expect(st.game?.status).toBe('paused');
    expect(st.intent?.kind).toBe('daily');
    expect(st.intent?.official).toBe(true);
    useApp.getState().updateSettings({ autoPauseOnDecision: false });
    useApp.getState().resumeGame();
    useApp.getState().tickGame(useApp.getState().game!.duration);
    useApp.getState().endChapter();
    useApp.getState().nextChapter();
    expect(useApp.getState().dailyV2.find((r) => r.dailyId === dailyId)?.official).toBeDefined();
    expect(useApp.getState().lastDaily?.official).toBe(true);
  });

  it('uses the UTC day: the same instant resolves to one canonical id everywhere, and the day after is a different crisis', () => {
    const now = new Date('2026-10-24T23:30:00Z');
    const id = dailyIdFor(now);
    expect(id).toBe('2026-10-24');
    expect(dailyIdFor(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25');
    const a = resolveDaily('2026-10-24');
    const b = resolveDaily('2026-10-25');
    expect(a.seed).not.toBe(b.seed);
    expect(resolveDaily('2026-10-24')).toEqual(a); // deterministic
    expect(a.nextAt).toBe('2026-10-25T00:00:00.000Z');
  });

  it('a second nextChapter call after completion cannot double-record (session already cleared)', () => {
    useApp.getState().startDailyQuickPlay();
    useApp.getState().beginDailyPlay();
    useApp.getState().tickGame(useApp.getState().game!.duration);
    useApp.getState().endChapter();
    useApp.getState().nextChapter();
    const once = useApp.getState().dailyV2;
    const historyLen = useApp.getState().history.length;
    useApp.getState().nextChapter();
    expect(useApp.getState().dailyV2).toEqual(once);
    expect(useApp.getState().history.length).toBe(historyLen);
    expect(useApp.getState().screen.name).toBe('home');
  });
});
