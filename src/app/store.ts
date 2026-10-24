/**
 * Application store (Zustand 5). Implements `AppState` from ./storeTypes.
 * Holds navigation, the live game (driven by the pure engine), settings and all local data.
 */
import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import {
  DEFAULT_SETTINGS,
  SCENARIO_IDS,
  type CampaignProgress,
  type CampaignResult,
  type ChapterResult,
  type DailyRecord,
  type GameConfig,
  type GameMode,
  type GameState,
  type HistoryEntry,
  type PersonalBests,
  type PlayerAction,
  type RepublicCondition,
  type Scenario,
  type ScenarioId,
  type Scores,
  type Settings,
} from '@/engine/types';
import {
  DEFAULT_OPPONENTS,
  carryScores,
  computeCampaignResult,
  computeChapterResult,
  createGame,
  decodeChallenge,
  deriveMapState,
  derivePulse,
  encodeChallenge,
  getDailySpec,
  getScenario,
  hashString,
  newSeed,
  reduce,
  tick as engineTick,
  updateRepublic,
} from '@/engine';
import type { AppState, PendingIntent, Screen, ScreenName, Toast } from './storeTypes';
import { storage, type MetaRecord, type SessionPlan, type SessionRecord } from './persistence';
import { currentLocationScreen } from './routes';
import { resolveReducedMotion } from './motion';
import { playCue } from '@/audio/sounds';
import { haptic, setHapticsNative } from '@/audio/haptics';

// ---------------------------------------------------------------------------
// Internal types & helpers
// ---------------------------------------------------------------------------

/** Store state = public contract + a few internal fields (additive, never required by screens). */
export type State = AppState & {
  /** Which scenarios the active run plays (persisted with the session). */
  plan?: SessionPlan;
  /** Set by replayLast so confirmSetup records the run as a replay. */
  replayOf?: string;
};

const HOME: Screen = { name: 'home' };
const FLOW_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>(['briefing', 'play', 'chapter-result', 'final-result']);
const MAX_STACK = 12;
const MAX_HISTORY = 200;
const MAX_TOASTS = 3;

let metaRecord: MetaRecord = {};
let hydratePromise: Promise<void> | null = null;
let persistTimer: number | undefined;
let toastCounter = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultRepublic(): RepublicCondition {
  return { freedom: 50, safety: 50, trust: 50, economy: 50, legitimacy: 50, campaigns: 0, crises: 0, updatedAt: nowIso() };
}

function defaultBests(): PersonalBests {
  return { chapters: {} };
}

/** Deterministic per-chapter seed derived from the run seed. */
export function chapterSeed(seed: number, index: number): number {
  return index === 0 ? seed >>> 0 : hashString(`${seed >>> 0}:${index}`) >>> 0;
}

function views(game: GameState | undefined, scenario: Scenario | undefined, focus?: string) {
  if (!game || !scenario) return { pulse: undefined, map: undefined };
  return { pulse: derivePulse(game), map: deriveMapState(game, scenario, focus) };
}

function makeChapterGame(progress: CampaignProgress, plan: SessionPlan, index: number, carry?: Scores): { scenario: Scenario; game: GameState } {
  const scenarioId = plan.scenarioIds[index];
  const scenario = getScenario(scenarioId);
  const config: GameConfig = {
    scenarioId,
    seed: chapterSeed(progress.config.seed, index),
    difficulty: progress.config.difficulty,
    opponents: [...progress.config.opponents],
    mode: progress.config.mode,
  };
  if (carry) config.carryScores = carry;
  return { scenario, game: createGame(config, scenario) };
}

function buildSessionRecord(s: State): SessionRecord | null {
  if (!s.campaign || !s.plan) return null;
  return {
    progress: { ...s.campaign, game: s.game, updatedAt: nowIso() },
    plan: s.plan,
    ui: { openEvidenceId: s.openEvidenceId, trayOpen: s.trayOpen, focusDistrict: s.focusDistrict },
    savedAt: nowIso(),
  };
}

function persistNow(): Promise<void> {
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  const rec = buildSessionRecord(useApp.getState());
  return (rec ? storage.setSession(rec) : storage.clearSession()).catch(() => undefined);
}

function persistSoon(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    void persistNow();
  }, 400);
}

/** Flush pending session writes (used on pagehide). */
export function flushPersistence(): Promise<void> {
  return persistNow();
}

function isFullCampaign(plan: SessionPlan): boolean {
  return plan.scenarioIds.length === SCENARIO_IDS.length;
}

function withChapterBest(bests: PersonalBests, result: ChapterResult): PersonalBests {
  const prev = bests.chapters[result.scenarioId];
  if (prev && prev.score >= result.score) return bests;
  return { ...bests, chapters: { ...bests.chapters, [result.scenarioId]: { score: result.score, at: result.completedAt } } };
}

function withRunBest(bests: PersonalBests, result: CampaignResult, plan: SessionPlan): PersonalBests {
  if (result.mode === 'daily' && plan.dailyDate) {
    if (!bests.daily || result.score > bests.daily.score) return { ...bests, daily: { score: result.score, date: plan.dailyDate } };
    return bests;
  }
  if (result.mode === 'replay') return bests;
  if (isFullCampaign(plan)) {
    if (!bests.campaign || result.score > bests.campaign.score)
      return { ...bests, campaign: { score: result.score, outcome: result.outcome, at: result.completedAt } };
  }
  return bests;
}

function runTitle(plan: SessionPlan, mode: GameMode, chapters: ChapterResult[]): string {
  const single = chapters.length === 1 ? getScenario(chapters[0].scenarioId).title : undefined;
  if (mode === 'daily') return `Daily crisis · ${single ?? 'Campaign'}`;
  if (mode === 'challenge') return `Challenge · ${single ?? 'Full campaign'}`;
  if (mode === 'replay') return `Replay · ${single ?? 'Full campaign'}`;
  return single ?? (isFullCampaign(plan) ? 'Full campaign' : 'Campaign');
}

function historyKind(mode: GameMode, plan: SessionPlan): HistoryEntry['kind'] {
  if (mode === 'daily') return 'daily';
  if (mode === 'challenge') return 'challenge';
  return isFullCampaign(plan) ? 'campaign' : 'chapter';
}

interface RestoredSession {
  campaign: CampaignProgress;
  plan: SessionPlan;
  game?: GameState;
  scenario?: Scenario;
  openEvidenceId?: string;
  trayOpen: boolean;
  focusDistrict?: string;
}

function restoreSession(rec: SessionRecord | undefined): RestoredSession | null {
  if (!rec?.progress || !Array.isArray(rec.plan?.scenarioIds) || rec.plan.scenarioIds.length === 0) return null;
  try {
    const known = SCENARIO_IDS as readonly string[];
    if (!rec.plan.scenarioIds.every((id) => known.includes(id))) return null;
    const { game: savedGame, ...progress } = rec.progress;
    if (!Array.isArray(progress.completed) || typeof progress.chapterIndex !== 'number') return null;
    if (progress.chapterIndex < 0 || progress.chapterIndex >= rec.plan.scenarioIds.length) return null;
    if (progress.completed.length > progress.chapterIndex + 1) return null;
    let game: GameState | undefined;
    let scenario: Scenario | undefined;
    if (savedGame) {
      if (savedGame.version !== 1 || !known.includes(savedGame.config?.scenarioId)) return null;
      scenario = getScenario(savedGame.config.scenarioId);
      game = savedGame.status === 'running' ? reduce(savedGame, { type: 'pause', tick: savedGame.tick }, scenario) : savedGame;
    }
    return {
      campaign: { ...progress, game: undefined },
      plan: rec.plan,
      game,
      scenario,
      openEvidenceId: rec.ui?.openEvidenceId,
      trayOpen: Boolean(rec.ui?.trayOpen),
      focusDistrict: rec.ui?.focusDistrict,
    };
  } catch {
    return null;
  }
}

interface InitialResolution {
  screen: Screen;
  stack: Screen[];
  lastChapter?: ChapterResult;
  lastCampaign?: CampaignResult;
  intent?: PendingIntent;
}

function awaitingContinue(c: CampaignProgress | undefined, game: GameState | undefined): boolean {
  return Boolean(c && !game && c.completed.length === c.chapterIndex + 1);
}

function resolveInitialScreen(
  url: Screen | null,
  ctx: { firstRun: boolean; session: RestoredSession | null; history: HistoryEntry[] },
): InitialResolution {
  const { session, history } = ctx;
  const game = session?.game;
  const campaign = session?.campaign;
  const flowFallback = (): InitialResolution => {
    if (game) return { screen: { name: game.status === 'briefing' ? 'briefing' : 'play' }, stack: [HOME] };
    if (awaitingContinue(campaign, game) && campaign)
      return { screen: { name: 'chapter-result' }, stack: [HOME], lastChapter: campaign.completed[campaign.completed.length - 1] };
    return { screen: HOME, stack: [] };
  };
  if (!url) return { screen: { name: 'launch' }, stack: [] };
  switch (url.name) {
    case 'launch':
      return { screen: { name: 'launch' }, stack: [] };
    case 'intro':
      return { screen: { name: 'intro' }, stack: [] };
    case 'home':
      return { screen: HOME, stack: [] };
    case 'opponents':
      return {
        screen: { name: 'opponents' },
        stack: [HOME],
        intent: { kind: 'campaign', seed: newSeed(), difficulty: 'standard', opponents: [...DEFAULT_OPPONENTS] },
      };
    case 'briefing':
    case 'play':
    case 'chapter-result':
      return flowFallback();
    case 'final-result': {
      const entry = (url.resultId ? history.find((h) => h.id === url.resultId) : history[0]) ?? history.find((h) => h.campaign);
      if (entry?.campaign) return { screen: { name: 'final-result', resultId: entry.id }, stack: [HOME], lastCampaign: entry.campaign };
      return flowFallback();
    }
    case 'challenge':
      return { screen: url, stack: [HOME] };
    default:
      return { screen: url, stack: [HOME] };
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

type DataFields = Pick<
  State,
  | 'campaign'
  | 'scenario'
  | 'game'
  | 'pulse'
  | 'map'
  | 'lastChapter'
  | 'lastCampaign'
  | 'intent'
  | 'plan'
  | 'replayOf'
  | 'screen'
  | 'stack'
  | 'toasts'
  | 'openEvidenceId'
  | 'trayOpen'
  | 'focusDistrict'
  | 'hydrated'
  | 'firstRun'
  | 'updateAvailable'
  | 'reducedMotion'
  | 'isNative'
  | 'online'
  | 'autoPaused'
  | 'settings'
  | 'republic'
  | 'bests'
  | 'history'
  | 'daily'
>;

function initialFields(): DataFields {
  return {
    campaign: undefined,
    scenario: undefined,
    game: undefined,
    pulse: undefined,
    map: undefined,
    lastChapter: undefined,
    lastCampaign: undefined,
    intent: undefined,
    plan: undefined,
    replayOf: undefined,
    screen: { name: 'launch' },
    stack: [],
    toasts: [],
    openEvidenceId: undefined,
    trayOpen: false,
    focusDistrict: undefined,
    hydrated: false,
    firstRun: true,
    updateAvailable: false,
    reducedMotion: false,
    isNative: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    autoPaused: false,
    settings: { ...DEFAULT_SETTINGS },
    republic: defaultRepublic(),
    bests: defaultBests(),
    history: [],
    daily: [],
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useApp = create<State>()((set, get) => ({
  ...initialFields(),

  // --- navigation -----------------------------------------------------------
  navigate(screen, opts) {
    const { screen: cur, stack, game } = get();
    if (cur.name === 'play' && screen.name !== 'play' && game?.status === 'running') get().pauseGame();
    let nextStack: Screen[];
    if (screen.name === 'home') nextStack = [];
    else if (FLOW_SCREENS.has(screen.name)) nextStack = [HOME];
    else if (opts?.replace || cur.name === 'launch' || cur.name === 'intro') nextStack = stack;
    else nextStack = [...stack.filter((s) => s.name !== screen.name), cur];
    set({ screen, stack: nextStack.slice(-MAX_STACK) });
  },

  back() {
    const s = get();
    if (s.screen.name === 'play' && s.game?.status === 'running') {
      s.pauseGame();
      return true;
    }
    if (s.screen.name === 'launch') return false;
    if (s.stack.length === 0) {
      if (s.screen.name === 'home') return false;
      // Leaving the first-run introduction by Back counts as having seen it.
      if (s.screen.name === 'intro' && s.firstRun) s.completeIntro();
      set({ screen: HOME, stack: [] });
      return true;
    }
    const prev = s.stack[s.stack.length - 1];
    set({ screen: prev, stack: s.stack.slice(0, -1) });
    return true;
  },

  // --- first run ------------------------------------------------------------
  completeIntro() {
    set({ firstRun: false });
    metaRecord = { ...metaRecord, introDone: true, createdAt: metaRecord.createdAt ?? nowIso() };
    void storage.setMeta(metaRecord).catch(() => undefined);
  },

  // --- setup ----------------------------------------------------------------
  beginCampaignSetup() {
    set({ intent: { kind: 'campaign', seed: newSeed(), difficulty: 'standard', opponents: [...DEFAULT_OPPONENTS] }, replayOf: undefined });
    get().navigate({ name: 'opponents' });
  },

  beginDailySetup() {
    const spec = getDailySpec(new Date());
    set({
      intent: { kind: 'daily', seed: spec.seed, difficulty: spec.difficulty, opponents: [...spec.opponents], daily: spec },
      replayOf: undefined,
    });
    get().confirmSetup();
  },

  beginChallenge(code) {
    const spec = decodeChallenge(code);
    if (!spec) return false;
    set({
      intent: { kind: 'challenge', seed: spec.seed, difficulty: spec.difficulty, opponents: [...spec.opponents], challenge: spec },
      replayOf: undefined,
    });
    get().confirmSetup();
    return true;
  },

  setIntentOpponents(opponents) {
    const { intent } = get();
    if (!intent) return;
    set({ intent: { ...intent, opponents: [...opponents] } });
  },

  setIntentDifficulty(difficulty) {
    const { intent } = get();
    if (!intent) return;
    set({ intent: { ...intent, difficulty } });
  },

  confirmSetup() {
    const s = get();
    const { intent } = s;
    if (!intent) return;
    const replay = Boolean(s.replayOf);
    const mode: GameMode = replay ? 'replay' : intent.kind === 'campaign' ? 'campaign' : intent.kind === 'daily' ? 'daily' : 'challenge';
    let scenarioIds: ScenarioId[];
    if (intent.kind === 'daily' && intent.daily) scenarioIds = [intent.daily.scenarioId];
    else if (intent.kind === 'challenge' && intent.challenge)
      scenarioIds = intent.challenge.scenario === 'campaign' ? [...SCENARIO_IDS] : [intent.challenge.scenario];
    else scenarioIds = [...SCENARIO_IDS];
    const plan: SessionPlan = { scenarioIds };
    if (intent.challenge) plan.challengeCode = encodeChallenge(intent.challenge);
    if (intent.daily) plan.dailyDate = intent.daily.date;
    const hadCampaign = Boolean(s.campaign && (s.game || s.campaign.completed.length));
    const progress: CampaignProgress = {
      id: uid(),
      config: { seed: intent.seed >>> 0, difficulty: intent.difficulty, opponents: [...intent.opponents], mode },
      chapterIndex: 0,
      completed: [],
      startedAt: nowIso(),
      updatedAt: nowIso(),
    };
    const { scenario, game } = makeChapterGame(progress, plan, 0);
    set({
      campaign: progress,
      plan,
      scenario,
      game,
      ...views(game, scenario),
      lastChapter: undefined,
      openEvidenceId: undefined,
      trayOpen: false,
      focusDistrict: undefined,
      replayOf: undefined,
    });
    void persistNow();
    if (hadCampaign && mode !== 'campaign') get().toast({ text: 'Your paused campaign was replaced by this run.', kind: 'info', duration: 4000 });
    get().navigate({ name: 'briefing' });
  },

  // --- game lifecycle ---------------------------------------------------------
  continueCampaign() {
    const s = get();
    const { campaign, plan, game } = s;
    if (!campaign || !plan) {
      get().navigate(HOME);
      return;
    }
    if (game) {
      const scenario = s.scenario ?? getScenario(game.config.scenarioId);
      set({ scenario, ...views(game, scenario, s.focusDistrict) });
      get().navigate({ name: game.status === 'briefing' ? 'briefing' : 'play' });
      return;
    }
    if (awaitingContinue(campaign, game)) {
      set({ lastChapter: campaign.completed[campaign.completed.length - 1] });
      get().navigate({ name: 'chapter-result' });
      return;
    }
    const prev = campaign.completed[campaign.completed.length - 1];
    const made = makeChapterGame(campaign, plan, campaign.chapterIndex, prev ? carryScores(prev.scores) : undefined);
    set({ scenario: made.scenario, game: made.game, ...views(made.game, made.scenario) });
    void persistNow();
    get().navigate({ name: 'briefing' });
  },

  startChapter() {
    const s = get();
    const { game, scenario } = s;
    if (!game || !scenario) return;
    if (game.status === 'briefing') {
      const next = reduce(game, { type: 'start', tick: game.tick }, scenario);
      set({ game: next, ...views(next, scenario, s.focusDistrict) });
      playCue('open');
    }
    void persistNow();
    get().navigate({ name: 'play' });
  },

  dispatch(action) {
    const s = get();
    const { game, scenario } = s;
    if (!game || !scenario) return;
    const next = reduce(game, action, scenario);
    if (next === game) return;
    set({ game: next, ...views(next, scenario, s.focusDistrict) });
    cueFor(action, game, next);
    if (action.type === 'resume' || action.type === 'pause') set({ autoPaused: action.type === 'pause' ? s.autoPaused : false });
    // An automatic pause ends as soon as the player has answered what triggered it.
    if (s.autoPaused && (action.type === 'decide' || action.type === 'rights' || action.type === 'undo') && next.status === 'paused') {
      const stillWaiting = next.pendingRightsIds.length > 0;
      if (!stillWaiting) {
        set({ autoPaused: false });
        get().dispatch({ type: 'resume', tick: next.tick });
        return;
      }
    }
    if (action.type === 'start' || action.type === 'decide' || action.type === 'undo' || action.type === 'rights' || action.type === 'pause' || action.type === 'resume')
      void persistNow();
    else persistSoon();
  },

  tickGame(n) {
    const s = get();
    const { game, scenario } = s;
    if (!game || !scenario || game.status !== 'running' || !(n > 0)) return;
    const next = engineTick(game, scenario, Math.floor(n));
    if (next === game) return;
    set({ game: next, ...views(next, scenario, s.focusDistrict) });
    if (next.status === 'ended') {
      playCue('chapterEnd');
      void persistNow();
      return;
    }
    // Simple play style: the clock waits whenever something new needs an answer.
    const grew = next.pendingDecisionIds.length > game.pendingDecisionIds.length || next.pendingRightsIds.length > game.pendingRightsIds.length;
    if (grew && s.settings.autoPauseOnDecision && next.status === 'running') {
      set({ autoPaused: true });
      get().dispatch({ type: 'pause', tick: next.tick });
      return;
    }
    persistSoon();
  },

  pauseGame() {
    const { game } = get();
    if (game?.status === 'running') get().dispatch({ type: 'pause', tick: game.tick });
  },

  resumeGame() {
    const { game } = get();
    if (game?.status === 'paused') get().dispatch({ type: 'resume', tick: game.tick });
  },

  endChapter() {
    const s = get();
    const { game, scenario, campaign, plan } = s;
    if (!game || !scenario || !campaign || !plan) return;
    if (campaign.completed.length > campaign.chapterIndex) return; // already recorded
    const result = computeChapterResult(game, scenario);
    const progress: CampaignProgress = { ...campaign, completed: [...campaign.completed, result], updatedAt: nowIso() };
    const bests = withChapterBest(s.bests, result);
    set({
      campaign: progress,
      game: undefined,
      pulse: undefined,
      map: undefined,
      lastChapter: result,
      bests,
      openEvidenceId: undefined,
      trayOpen: false,
      focusDistrict: undefined,
    });
    if (bests !== s.bests) void storage.setBests(bests).catch(() => undefined);
    void persistNow();
    haptic('success');
    get().navigate({ name: 'chapter-result' });
  },

  nextChapter() {
    const s = get();
    const { campaign, plan } = s;
    if (!campaign || !plan) {
      get().navigate(HOME);
      return;
    }
    const nextIndex = campaign.chapterIndex + 1;
    if (nextIndex < plan.scenarioIds.length) {
      const prev = campaign.completed[campaign.completed.length - 1];
      const progress: CampaignProgress = { ...campaign, chapterIndex: nextIndex, updatedAt: nowIso() };
      const made = makeChapterGame(progress, plan, nextIndex, prev ? carryScores(prev.scores) : undefined);
      set({ campaign: progress, scenario: made.scenario, game: made.game, ...views(made.game, made.scenario), lastChapter: undefined });
      void persistNow();
      get().navigate({ name: 'briefing' });
      return;
    }
    // Run complete.
    const id = uid();
    const completedAt = nowIso();
    const mode = campaign.config.mode;
    const result = computeCampaignResult(campaign.completed, {
      mode,
      seed: campaign.config.seed,
      difficulty: campaign.config.difficulty,
      opponents: [...campaign.config.opponents],
      id,
      completedAt,
    });
    const republic = updateRepublic(s.republic, result);
    const bests = withRunBest(s.bests, result, plan);
    const entry: HistoryEntry = {
      id,
      kind: historyKind(mode, plan),
      title: runTitle(plan, mode, campaign.completed),
      score: result.score,
      outcome: result.outcome,
      completedAt,
      campaign: result,
      chapter: campaign.completed.length === 1 ? campaign.completed[0] : undefined,
      challengeCode: result.challengeCode,
    };
    const history = [entry, ...s.history].slice(0, MAX_HISTORY);
    let daily: DailyRecord[] = s.daily;
    if (mode === 'daily' && plan.dailyDate) {
      // One record per calendar day; a repeat attempt only replaces it when it scores higher.
      const date = plan.dailyDate;
      const existing = s.daily.find((d) => d.date === date);
      const record: DailyRecord =
        existing && existing.score >= result.score ? existing : { date, score: result.score, outcome: result.outcome, completedAt };
      daily = [record, ...s.daily.filter((d) => d.date !== date)].slice(0, 400);
    }
    set({
      campaign: undefined,
      plan: undefined,
      game: undefined,
      scenario: undefined,
      pulse: undefined,
      map: undefined,
      lastChapter: undefined,
      lastCampaign: result,
      republic,
      bests,
      history,
      daily,
      openEvidenceId: undefined,
      trayOpen: false,
      focusDistrict: undefined,
    });
    void Promise.all([
      storage.setRepublic(republic),
      storage.setBests(bests),
      storage.setHistory(history),
      storage.setDaily(daily),
      storage.clearSession(),
    ]).catch(() => undefined);
    playCue('success');
    get().navigate({ name: 'final-result', resultId: id });
  },

  abandonCampaign() {
    set({
      campaign: undefined,
      plan: undefined,
      game: undefined,
      scenario: undefined,
      pulse: undefined,
      map: undefined,
      lastChapter: undefined,
      openEvidenceId: undefined,
      trayOpen: false,
      focusDistrict: undefined,
    });
    void storage.clearSession().catch(() => undefined);
    get().navigate(HOME);
  },

  replayLast() {
    const r = get().lastCampaign;
    if (!r) return;
    const scenarioIds = r.chapters.map((c) => c.scenarioId);
    const full = scenarioIds.length === SCENARIO_IDS.length;
    const intent: PendingIntent = full
      ? { kind: 'campaign', seed: r.seed, difficulty: r.difficulty, opponents: [...r.opponents] }
      : {
          kind: 'challenge',
          seed: r.seed,
          difficulty: r.difficulty,
          opponents: [...r.opponents],
          challenge: { v: 1, scenario: scenarioIds[0], seed: r.seed, difficulty: r.difficulty, opponents: [...r.opponents], score: r.score },
        };
    set({ intent, replayOf: r.id });
    get().confirmSetup();
  },

  // --- ui context -------------------------------------------------------------
  setOpenEvidence(id) {
    if (get().openEvidenceId === id) return;
    set({ openEvidenceId: id });
    persistSoon();
  },

  setTrayOpen(open) {
    if (get().trayOpen === open) return;
    set({ trayOpen: open });
    persistSoon();
  },

  setFocusDistrict(id) {
    const s = get();
    if (s.focusDistrict === id) return;
    set({ focusDistrict: id, ...(s.game && s.scenario ? { map: deriveMapState(s.game, s.scenario, id) } : {}) });
    persistSoon();
  },

  toast(t) {
    const id = t.id ?? `toast-${++toastCounter}`;
    const next: Toast = { ...t, id };
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== id), next].slice(-MAX_TOASTS) }));
  },

  dismissToast(id) {
    set((s) => (s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : {}));
  },

  setUpdateAvailable(v) {
    if (get().updateAvailable !== v) set({ updateAvailable: v });
  },

  // --- data -------------------------------------------------------------------
  setPlayStyle(style) {
    const simple = style === 'simple';
    get().updateSettings({ playStyle: style, autoPauseOnDecision: simple, timerPace: simple ? 'relaxed' : 'standard' });
  },

  updateSettings(patch) {
    const settings: Settings = { ...get().settings, ...patch };
    set({ settings, reducedMotion: resolveReducedMotion(settings) });
    void storage.setSettings(settings).catch(() => undefined);
  },

  async resetRepublic() {
    const republic = defaultRepublic();
    set({ republic });
    await storage.setRepublic(republic).catch(() => undefined);
    get().toast({ text: 'Your Republic has been reset.', kind: 'success', duration: 3500 });
  },

  async exportData() {
    const data = await storage.exportAll();
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
    return JSON.stringify({ app: 'VANDE: Republic Under Pressure', version, exportedAt: nowIso(), data }, null, 2);
  },

  /**
   * Wipes every local store (IndexedDB or the localStorage fallback) and resets in-memory state.
   * The app then behaves like a fresh install: settings return to defaults and the intro shows on the next launch.
   * The current screen is kept so the player sees the confirmation where they triggered it.
   */
  async deleteAllData() {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    await storage.clearAll().catch(() => undefined);
    metaRecord = {};
    const { screen, stack, isNative, online, reducedMotion } = get();
    set({
      ...initialFields(),
      hydrated: true,
      firstRun: true,
      screen,
      stack,
      isNative,
      online,
      reducedMotion,
      settings: { ...DEFAULT_SETTINGS },
      toasts: [],
    });
    get().toast({ text: 'All local progress and settings were deleted.', kind: 'success', duration: 4000 });
  },

  // --- hydration ----------------------------------------------------------------
  hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      let isNative = false;
      try {
        isNative = Capacitor.isNativePlatform();
      } catch {
        isNative = false;
      }
      setHapticsNative(isNative);
      const [settings, republic, bests, history, daily, session, meta] = await Promise.all([
        storage.getSettings().catch(() => undefined),
        storage.getRepublic().catch(() => undefined),
        storage.getBests().catch(() => undefined),
        storage.getHistory().catch(() => undefined),
        storage.getDaily().catch(() => undefined),
        storage.getSession().catch(() => undefined),
        storage.getMeta().catch(() => undefined),
      ]);
      metaRecord = meta ?? {};
      const firstRun = !metaRecord.introDone;
      const mergedSettings: Settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
      const restored = restoreSession(session);
      const safeHistory = Array.isArray(history) ? history : [];
      const resolved = resolveInitialScreen(currentLocationScreen(), { firstRun, session: restored, history: safeHistory });
      set({
        hydrated: true,
        isNative,
        online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
        firstRun,
        settings: mergedSettings,
        reducedMotion: resolveReducedMotion(mergedSettings),
        republic: republic ?? defaultRepublic(),
        bests: bests ?? defaultBests(),
        history: safeHistory,
        daily: Array.isArray(daily) ? daily : [],
        campaign: restored?.campaign,
        plan: restored?.plan,
        game: restored?.game,
        scenario: restored?.scenario,
        ...views(restored?.game, restored?.scenario, restored?.focusDistrict),
        openEvidenceId: restored?.openEvidenceId,
        trayOpen: restored?.trayOpen ?? false,
        focusDistrict: restored?.focusDistrict,
        screen: resolved.screen,
        stack: resolved.stack,
        lastChapter: resolved.lastChapter,
        lastCampaign: resolved.lastCampaign,
        intent: resolved.intent,
      });
      if (!restored && session) {
        void storage.clearSession().catch(() => undefined);
        get().toast({ text: 'A saved game from an older version could not be restored and was cleared.', kind: 'warning', duration: 6000 });
      }
    })();
    return hydratePromise;
  },
}));

// ---------------------------------------------------------------------------
// Cues (sound + haptics) for player actions
// ---------------------------------------------------------------------------

function cueFor(action: PlayerAction, before: GameState, after: GameState): void {
  switch (action.type) {
    case 'decide': {
      const w = after.lastFeedback?.warning;
      if (w === 'false-accusation' || w === 'disproportionate') {
        playCue('danger');
        haptic('error');
      } else if (w === 'unverified-basis') {
        playCue('warning');
        haptic('warning');
      } else {
        playCue('confirm');
        haptic('light');
      }
      break;
    }
    case 'evidence': {
      const prev = before.evidence[action.evidenceId]?.state;
      const next = after.evidence[action.evidenceId]?.state;
      if (prev !== next && (next === 'verified' || next === 'corroborated')) {
        playCue('verify');
        haptic('success');
      } else if (prev !== next && next === 'manipulated') {
        playCue('warning');
        haptic('warning');
      } else playCue('tap');
      break;
    }
    case 'rights': {
      const r = after.rights[action.momentId];
      if (r?.correct) {
        playCue('success');
        haptic('success');
      } else {
        playCue('warning');
        haptic('light');
      }
      break;
    }
    case 'pause':
    case 'undo':
      playCue('close');
      break;
    case 'resume':
    case 'start':
      playCue('open');
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset the store and hydration state (unit tests only). */
export function __resetStoreForTests(): void {
  hydratePromise = null;
  metaRecord = {};
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  useApp.setState({ ...initialFields() });
}
