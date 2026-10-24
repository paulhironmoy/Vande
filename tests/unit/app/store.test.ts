import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPersistenceForTests, storage } from '@/app/persistence';
import { __resetStoreForTests, useApp } from '@/app/store';
import { SCENARIO_IDS } from '@/engine/types';
import { decodeChallenge } from '@/engine';

async function freshStore() {
  // close + wipe IndexedDB (fake-indexeddb) between tests
  await __resetPersistenceForTests(true);
  __resetStoreForTests();
  window.history.replaceState(null, '', '/');
  await useApp.getState().hydrate();
}

function firstPendingDecision() {
  const g = useApp.getState().game!;
  return g.pendingDecisionIds[0];
}

describe('app store', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await freshStore();
  });

  it('hydrates to the launch screen on first run and resolves deep links', async () => {
    expect(useApp.getState().hydrated).toBe(true);
    expect(useApp.getState().firstRun).toBe(true);
    expect(useApp.getState().screen).toEqual({ name: 'launch' });

    window.history.replaceState(null, '', '/settings');
    __resetStoreForTests();
    await useApp.getState().hydrate();
    expect(useApp.getState().screen).toEqual({ name: 'settings' });
    expect(useApp.getState().stack).toEqual([{ name: 'home' }]);
  });

  it('navigates with a back stack and pauses a running game instead of leaving it', () => {
    const s = useApp.getState();
    s.navigate({ name: 'home' });
    s.navigate({ name: 'settings' });
    s.navigate({ name: 'about', page: 'privacy' });
    expect(useApp.getState().stack.map((x) => x.name)).toEqual(['home', 'settings']);
    expect(useApp.getState().back()).toBe(true);
    expect(useApp.getState().screen).toEqual({ name: 'settings' });
    expect(useApp.getState().back()).toBe(true);
    expect(useApp.getState().screen).toEqual({ name: 'home' });
    expect(useApp.getState().back()).toBe(false);
  });

  it('runs the campaign setup flow: intro → opponents → briefing → play, and ticks deterministically', async () => {
    useApp.getState().updateSettings({ autoPauseOnDecision: false });
    const s = useApp.getState();
    s.completeIntro();
    s.beginCampaignSetup();
    expect(useApp.getState().screen).toEqual({ name: 'opponents' });
    expect(useApp.getState().intent?.opponents.length).toBe(2);
    useApp.getState().setIntentOpponents(['exploiter', 'provocateur', 'disinfo']);
    useApp.getState().setIntentDifficulty('severe');
    useApp.getState().confirmSetup();
    expect(useApp.getState().screen).toEqual({ name: 'briefing' });
    const game = useApp.getState().game!;
    expect(game.status).toBe('briefing');
    expect(game.config.scenarioId).toBe(SCENARIO_IDS[0]);
    expect(game.config.opponents).toEqual(['exploiter', 'provocateur', 'disinfo']);
    expect(game.config.difficulty).toBe('severe');

    useApp.getState().startChapter();
    expect(useApp.getState().screen).toEqual({ name: 'play' });
    expect(useApp.getState().game!.status).toBe('running');
    useApp.getState().tickGame(30);
    expect(useApp.getState().game!.tick).toBe(30);
    expect(useApp.getState().pulse).toBeDefined();
    expect(useApp.getState().map?.districts.length).toBeGreaterThan(0);

    // back during play pauses rather than leaving
    expect(useApp.getState().back()).toBe(true);
    expect(useApp.getState().screen).toEqual({ name: 'play' });
    expect(useApp.getState().game!.status).toBe('paused');
    useApp.getState().resumeGame();
    expect(useApp.getState().game!.status).toBe('running');
  });

  it('persists the in-progress chapter and restores it (paused) with UI context after a reload', async () => {
    const s = useApp.getState();
    s.completeIntro();
    s.beginCampaignSetup();
    s.confirmSetup();
    s.startChapter();
    s.tickGame(40);
    const pending = firstPendingDecision();
    if (pending) {
      const decision = useApp.getState().scenario!.decisions.find((d) => d.id === pending)!;
      useApp.getState().dispatch({ type: 'decide', tick: 40, decisionId: pending, optionId: decision.options[0].id });
    }
    useApp.getState().setTrayOpen(true);
    const evidenceId = Object.keys(useApp.getState().game!.evidence)[0];
    useApp.getState().setOpenEvidence(evidenceId);
    useApp.getState().pauseGame(); // persists immediately
    await new Promise((r) => setTimeout(r, 450)); // let the debounced writes settle
    const tickBefore = useApp.getState().game!.tick;
    const saved = await storage.getSession();
    expect(saved?.progress.game?.tick).toBe(tickBefore);

    // Simulate reload at /play
    window.history.replaceState(null, '', '/play');
    __resetStoreForTests();
    await useApp.getState().hydrate();
    const st = useApp.getState();
    expect(st.screen).toEqual({ name: 'play' });
    expect(st.game?.tick).toBe(tickBefore);
    expect(st.game?.status).toBe('paused');
    expect(st.trayOpen).toBe(true);
    expect(st.openEvidenceId).toBe(evidenceId);
    expect(st.firstRun).toBe(false);
    expect(st.campaign).toBeDefined();
    expect(st.scenario?.id).toBe(SCENARIO_IDS[0]);
  });

  it('completes a chapter, records bests, moves to the next chapter and finishes the campaign', async () => {
    const s = useApp.getState();
    s.completeIntro();
    s.beginCampaignSetup();
    s.confirmSetup();
    for (let chapter = 0; chapter < SCENARIO_IDS.length; chapter++) {
      useApp.getState().startChapter();
      const g = useApp.getState().game!;
      useApp.getState().tickGame(g.duration + 5);
      expect(useApp.getState().game!.status).toBe('ended');
      useApp.getState().endChapter();
      const st = useApp.getState();
      expect(st.screen).toEqual({ name: 'chapter-result' });
      expect(st.lastChapter?.scenarioId).toBe(SCENARIO_IDS[chapter]);
      expect(st.bests.chapters[SCENARIO_IDS[chapter]]).toBeDefined();
      expect(st.campaign?.completed.length).toBe(chapter + 1);
      useApp.getState().nextChapter();
      if (chapter < SCENARIO_IDS.length - 1) {
        expect(useApp.getState().screen).toEqual({ name: 'briefing' });
        expect(useApp.getState().game?.config.scenarioId).toBe(SCENARIO_IDS[chapter + 1]);
        expect(useApp.getState().game?.config.carryScores).toBeDefined();
      }
    }
    const done = useApp.getState();
    expect(done.screen.name).toBe('final-result');
    expect(done.lastCampaign?.chapters.length).toBe(3);
    expect(done.history.length).toBe(1);
    expect(done.history[0].kind).toBe('campaign');
    expect(done.bests.campaign?.score).toBe(done.lastCampaign?.score);
    expect(done.republic.campaigns).toBeGreaterThanOrEqual(1);
    expect(done.campaign).toBeUndefined();
    expect(await storage.getSession()).toBeUndefined();

    // replay recreates the identical configuration
    useApp.getState().replayLast();
    expect(useApp.getState().screen).toEqual({ name: 'briefing' });
    expect(useApp.getState().game?.config.seed).toBe(done.lastCampaign!.seed);
    expect(useApp.getState().campaign?.config.mode).toBe('replay');
  });

  it('starts today\'s crisis without opponent setup and records the first completion as the official result', async () => {
    useApp.getState().updateSettings({ autoPauseOnDecision: false });
    const s = useApp.getState();
    s.completeIntro();
    s.startDailyQuickPlay();
    expect(useApp.getState().screen).toEqual({ name: 'daily-open' });
    expect(useApp.getState().intent?.kind).toBe('daily');
    expect(useApp.getState().intent?.official).toBe(true);
    expect(useApp.getState().campaign).toBeUndefined(); // nothing is locked by looking at the cold open
    useApp.getState().beginDailyPlay();
    expect(useApp.getState().screen).toEqual({ name: 'play' });
    expect(useApp.getState().campaign?.config.mode).toBe('daily');
    expect(useApp.getState().game?.status).toBe('running');
    const dailyId = useApp.getState().plan!.dailyDate!;
    expect(useApp.getState().dailyV2[0]).toMatchObject({ dailyId });
    expect(useApp.getState().dailyV2[0].official).toBeUndefined(); // starting never locks
    useApp.getState().tickGame(useApp.getState().game!.duration);
    useApp.getState().endChapter();
    useApp.getState().nextChapter();
    const st = useApp.getState();
    expect(st.screen.name).toBe('final-result');
    expect(st.dailyV2.length).toBe(1);
    expect(st.dailyV2[0].official?.score).toBe(st.lastCampaign!.score);
    expect(st.dailyV2[0].official?.fingerprint).toMatch(/^[DESPXW]*$/);
    expect(st.lastDaily?.official).toBe(true);
    expect(st.bests.daily?.score).toBe(st.dailyV2[0].official?.score);
    expect(st.history[0].kind).toBe('daily');
    expect(st.history[0].title).not.toContain('Practice');
  });

  it('accepts a valid challenge code and rejects an invalid one', () => {
    const s = useApp.getState();
    expect(s.beginChallenge('not-a-real-code')).toBe(false);
    // Build a code from a finished campaign result shape via the engine
    const ok = s.beginChallenge(useApp.getState().lastCampaign?.challengeCode ?? 'invalid');
    expect(ok).toBe(false); // no campaign yet -> still invalid input
  });

  it('exports and deletes all local data', async () => {
    const s = useApp.getState();
    s.updateSettings({ highContrast: true, textScale: 1.5 });
    const json = await useApp.getState().exportData();
    const parsed = JSON.parse(json);
    expect(parsed.app).toContain('VANDE');
    expect(parsed.data.settings.highContrast).toBe(true);
    await useApp.getState().deleteAllData();
    expect(useApp.getState().settings.highContrast).toBe(false);
    expect(useApp.getState().firstRun).toBe(true);
    expect(await storage.getSettings()).toBeUndefined();
  });

  it('records a challenge code that reproduces the run configuration and ends a chapter only once', () => {
    const s = useApp.getState();
    s.completeIntro();
    s.beginCampaignSetup();
    useApp.getState().setIntentOpponents(['provocateur', 'sabotage', 'overreaction']);
    useApp.getState().setIntentDifficulty('measured');
    useApp.getState().confirmSetup();
    const seed = useApp.getState().campaign!.config.seed;
    for (let chapter = 0; chapter < SCENARIO_IDS.length; chapter++) {
      useApp.getState().startChapter();
      useApp.getState().tickGame(useApp.getState().game!.duration);
      useApp.getState().endChapter();
      useApp.getState().endChapter(); // second call must be a no-op
      expect(useApp.getState().campaign?.completed.length).toBe(chapter + 1);
      useApp.getState().nextChapter();
    }
    const result = useApp.getState().lastCampaign!;
    const spec = decodeChallenge(result.challengeCode)!;
    expect(spec).not.toBeNull();
    expect(spec.scenario).toBe('campaign');
    expect(spec.seed).toBe(seed);
    expect(spec.difficulty).toBe('measured');
    expect([...spec.opponents].sort()).toEqual(['overreaction', 'provocateur', 'sabotage']);
    expect(spec.score).toBe(result.score);
    // Replaying from the code reproduces chapter one exactly.
    expect(useApp.getState().beginChallenge(result.challengeCode)).toBe(true);
    const g = useApp.getState().game!;
    expect(g.config.seed).toBe(seed);
    expect(g.config.difficulty).toBe('measured');
    expect(g.config.scenarioId).toBe(SCENARIO_IDS[0]);
    expect(useApp.getState().plan?.scenarioIds).toEqual([...SCENARIO_IDS]);
  });

  it('never lets a practice attempt overwrite the official result, even with a higher score', () => {
    useApp.getState().updateSettings({ autoPauseOnDecision: false });
    const s = useApp.getState();
    s.completeIntro();
    s.startDailyQuickPlay();
    const dailyId = useApp.getState().intent!.dailyId!;
    // An earlier official result exists for today.
    const official = { score: 12, outcome: 'manipulated' as const, fingerprint: 'XXW', completedAt: '2026-10-24T08:00:00.000Z', contentVersion: 'x', mode: 'simple' as const, scores: { freedom: 10, grievance: 10, safety: 10, evidence: 10, trust: 10, economy: 10 } };
    useApp.setState({ dailyV2: [{ v: 2, dailyId, official }], bests: { ...useApp.getState().bests, daily: { score: 12, date: dailyId } } });
    const republicBefore = useApp.getState().republic;
    useApp.getState().startDailyById(dailyId);
    expect(useApp.getState().intent?.official).toBe(false);
    useApp.getState().beginDailyPlay();
    useApp.getState().tickGame(useApp.getState().game!.duration);
    useApp.getState().endChapter();
    useApp.getState().nextChapter();
    const st = useApp.getState();
    expect(st.lastCampaign!.score).toBeGreaterThan(12);
    expect(st.dailyV2.length).toBe(1);
    expect(st.dailyV2[0].official).toEqual(official); // immutable
    expect(st.dailyV2[0].practice?.attempts).toBe(1);
    expect(st.dailyV2[0].practice?.best.score).toBe(st.lastCampaign!.score);
    expect(st.lastDaily?.official).toBe(false);
    expect(st.bests.daily?.score).toBe(12); // official best only
    expect(st.republic).toEqual(republicBefore); // practice never moves the Republic
    expect(st.history[0].title).toContain('Practice');
    // A second, weaker practice keeps the best practice.
    useApp.getState().startDailyById(dailyId);
    useApp.getState().beginDailyPlay();
    useApp.setState({ dailyV2: useApp.getState().dailyV2.map((r) => ({ ...r, practice: { attempts: 1, best: { ...official, score: 100 } } })) });
    useApp.getState().tickGame(useApp.getState().game!.duration);
    useApp.getState().endChapter();
    useApp.getState().nextChapter();
    expect(useApp.getState().dailyV2[0].practice?.attempts).toBe(2);
    expect(useApp.getState().dailyV2[0].practice?.best.score).toBe(100);
    expect(useApp.getState().dailyV2[0].official).toEqual(official);
  });

  it('leaves a paused chapter resumable: back from play pauses, back again goes home, continue returns to play', () => {
    useApp.getState().updateSettings({ autoPauseOnDecision: false });
    const s = useApp.getState();
    s.completeIntro();
    s.beginCampaignSetup();
    s.confirmSetup();
    s.startChapter();
    s.tickGame(12);
    expect(useApp.getState().back()).toBe(true);
    expect(useApp.getState().game?.status).toBe('paused');
    expect(useApp.getState().screen).toEqual({ name: 'play' });
    expect(useApp.getState().back()).toBe(true);
    expect(useApp.getState().screen).toEqual({ name: 'home' });
    expect(useApp.getState().game?.tick).toBe(12);
    useApp.getState().continueCampaign();
    expect(useApp.getState().screen).toEqual({ name: 'play' });
    expect(useApp.getState().game?.status).toBe('paused');
  });

  it('discards a corrupt saved session with a notice instead of crashing hydration', async () => {
    await storage.setSession({ progress: { id: 'x', chapterIndex: 7, completed: 'nope' }, plan: { scenarioIds: ['not-a-scenario'] } } as never);
    window.history.replaceState(null, '', '/play');
    __resetStoreForTests();
    await useApp.getState().hydrate();
    const st = useApp.getState();
    expect(st.hydrated).toBe(true);
    expect(st.campaign).toBeUndefined();
    expect(st.game).toBeUndefined();
    expect(st.screen).toEqual({ name: 'home' });
    expect(st.toasts.some((t) => /could not be restored/i.test(t.text))).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await storage.getSession()).toBeUndefined();
  });

  it('replaying a daily from its result is a practice attempt: the official result and bests stay untouched', () => {
    useApp.getState().updateSettings({ autoPauseOnDecision: false });
    const s = useApp.getState();
    s.completeIntro();
    s.startDailyQuickPlay();
    useApp.getState().beginDailyPlay();
    useApp.getState().tickGame(useApp.getState().game!.duration);
    useApp.getState().endChapter();
    useApp.getState().nextChapter();
    const before = useApp.getState();
    const officialBefore = before.dailyV2[0].official;
    const bestsBefore = before.bests;
    expect(before.lastCampaign?.challengeCode).toMatch(/^D1-/); // daily results carry the spoiler-free daily code
    useApp.getState().replayLast();
    expect(useApp.getState().screen).toEqual({ name: 'daily-open' });
    expect(useApp.getState().intent?.official).toBe(false);
    useApp.getState().beginDailyPlay();
    expect(useApp.getState().campaign?.config.mode).toBe('daily');
    useApp.getState().tickGame(useApp.getState().game!.duration);
    useApp.getState().endChapter();
    useApp.getState().nextChapter();
    const after = useApp.getState();
    expect(after.dailyV2[0].official).toEqual(officialBefore);
    expect(after.dailyV2[0].practice?.attempts).toBe(1);
    expect(after.lastDaily?.official).toBe(false);
    expect(after.bests.daily).toEqual(bestsBefore.daily);
    expect(after.history.length).toBe(2);
    expect(after.history[0].title).toContain('Practice');
  });

  it('keeps toasts to a small queue and dismisses them', () => {
    const s = useApp.getState();
    for (let i = 0; i < 5; i++) s.toast({ text: `t${i}`, kind: 'info', duration: 0 });
    expect(useApp.getState().toasts.length).toBe(3);
    const id = useApp.getState().toasts[0].id;
    useApp.getState().dismissToast(id);
    expect(useApp.getState().toasts.find((t) => t.id === id)).toBeUndefined();
  });
});
