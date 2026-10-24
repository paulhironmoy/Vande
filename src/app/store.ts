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
  isDailyScenarioId,
  type DailyRecord,
  type PassportAccomplishment,
  type DailyResolution,
  type DailyAttemptResult,
  type DailyRecordV2,
  type PassportState,
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
  getScenario,
  hashString,
  newSeed,
  reduce,
  tick as engineTick,
  updateRepublic,
} from '@/engine';
import type { AppState, PendingIntent, Screen, ScreenName, Toast } from './storeTypes';
import { elapsedBucket, track } from '@/analytics';
import { applyAnalyticsOptOut, startCommunityAndAnalytics, wipeCommunityData } from './communityBridge';
import { DAILY_CONTENT_VERSION, dailyIdFor, dailyScenarioId, resolveDaily } from '@/engine/daily';
import { roundScores } from '@/engine';
import { evaluateAccomplishments } from '@/progression/passport';
import { submitOfficialResult } from '@/community';
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
/** Wall-clock start of the current daily attempt (analytics bucketing only; never part of game state). */
let dailyStartedAt = 0;
let firstChoiceTracked = false;

/** UTC calendar day `YYYY-MM-DD` (the canonical daily id). */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function newInstallId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Migrates legacy daily records (one per local date, best score kept) into v2 records.
 * The legacy completion becomes the immutable official result; v2 rows that already exist win.
 */
export function migrateDailyRecords(legacy: DailyRecord[], existing: DailyRecordV2[]): DailyRecordV2[] {
  const byId = new Map(existing.map((r) => [r.dailyId, r] as const));
  for (const row of legacy) {
    if (!row || typeof row.date !== 'string' || byId.has(row.date)) continue;
    byId.set(row.date, {
      v: 2,
      dailyId: row.date,
      official: {
        score: row.score,
        outcome: row.outcome,
        fingerprint: 'legacy',
        completedAt: row.completedAt,
        contentVersion: 'v1-campaign',
        mode: 'full',
        scores: { freedom: 0, grievance: 0, safety: 0, evidence: 0, trust: 0, economy: 0 },
      },
    });
  }
  return [...byId.values()].sort((a, b) => (a.dailyId < b.dailyId ? 1 : -1));
}

function diffRepublic(prev: RepublicCondition, next: RepublicCondition): Partial<RepublicCondition> {
  const out: Partial<RepublicCondition> = {};
  for (const k of ['freedom', 'safety', 'trust', 'economy', 'legitimacy'] as const) {
    const d = Math.round(next[k] - prev[k]);
    if (d !== 0) out[k] = d;
  }
  return out;
}

function upsertDaily(records: DailyRecordV2[], dailyId: string, patch: (r: DailyRecordV2) => DailyRecordV2): DailyRecordV2[] {
  const existing = records.find((r) => r.dailyId === dailyId) ?? { v: 2 as const, dailyId };
  const next = patch(existing);
  return [next, ...records.filter((r) => r.dailyId !== dailyId)].slice(0, 400);
}
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
    if (!rec.plan.scenarioIds.every((id) => known.includes(id) || isDailyScenarioId(id))) return null;
    const { game: savedGame, ...progress } = rec.progress;
    if (!Array.isArray(progress.completed) || typeof progress.chapterIndex !== 'number') return null;
    if (progress.chapterIndex < 0 || progress.chapterIndex >= rec.plan.scenarioIds.length) return null;
    if (progress.completed.length > progress.chapterIndex + 1) return null;
    let game: GameState | undefined;
    let scenario: Scenario | undefined;
    if (savedGame) {
      const sid = savedGame.config?.scenarioId;
      if (savedGame.version !== 1 || typeof sid !== 'string' || !(known.includes(sid) || isDailyScenarioId(sid))) return null;
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
  | 'lastDaily'
  | 'newAccomplishments'
  | 'dailyV2'
  | 'passport'
  | 'installId'
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
    lastDaily: undefined,
    newAccomplishments: [],
    dailyV2: [],
    passport: { v: 1, earned: [] },
    installId: '',
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
    get().startDailyQuickPlay();
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
    // First meaningful choice of a daily attempt (time-to-first-choice metric, bucketed).
    if (game.pendingDecisionIds.length === 0 && next.pendingDecisionIds.length > 0 && s.plan?.dailyDate && next.stats.decisionsMade === 0 && !firstChoiceTracked) {
      firstChoiceTracked = true;
      track('first_choice_reached', { dailyId: s.plan.dailyDate, elapsedBucket: elapsedBucket(Date.now() - dailyStartedAt), mode: s.settings.playStyle });
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
    const isDaily = mode === 'daily' && Boolean(plan.dailyDate);
    const officialRun = isDaily ? !s.dailyV2.find((r) => r.dailyId === plan.dailyDate)?.official : false;
    // Practice runs never move the long-term Republic or the official best: progression is earned once per day.
    const republic = isDaily && !officialRun ? s.republic : updateRepublic(s.republic, result);
    const bests = isDaily && !officialRun ? s.bests : withRunBest(s.bests, result, plan);
    const entry: HistoryEntry = {
      id,
      kind: historyKind(mode, plan),
      title: runTitle(plan, mode, campaign.completed) + (isDaily && !officialRun ? ' · Practice' : ''),
      score: result.score,
      outcome: result.outcome,
      completedAt,
      campaign: result,
      chapter: campaign.completed.length === 1 ? campaign.completed[0] : undefined,
      challengeCode: result.challengeCode,
    };
    const history = [entry, ...s.history].slice(0, MAX_HISTORY);
    const daily: DailyRecord[] = s.daily; // legacy v1 rows stay untouched
    let dailyV2 = s.dailyV2;
    let lastDaily: State['lastDaily'];
    let awarded: PassportAccomplishment[] = [];
    if (isDaily && plan.dailyDate) {
      const dailyId = plan.dailyDate;
      const chapter = campaign.completed[campaign.completed.length - 1];
      const attempt: DailyAttemptResult = {
        score: result.score,
        outcome: result.outcome,
        fingerprint: chapter?.fingerprint ?? '',
        completedAt,
        contentVersion: DAILY_CONTENT_VERSION,
        mode: s.settings.playStyle,
        scores: roundScores(result.finalScores),
      };
      dailyV2 = upsertDaily(s.dailyV2, dailyId, (r) => {
        if (!r.official) return { ...r, dayId: r.dayId ?? s.intent?.dailyResolution?.dayId, official: attempt };
        const prevBest = r.practice?.best;
        return { ...r, practice: { attempts: (r.practice?.attempts ?? 0) + 1, best: prevBest && prevBest.score >= attempt.score ? prevBest : attempt } };
      });
      const record = dailyV2.find((r) => r.dailyId === dailyId)!;
      lastDaily = {
        dailyId,
        official: officialRun,
        result: attempt,
        record,
        friend: s.intent?.friend,
        republicDelta: officialRun ? diffRepublic(s.republic, republic) : undefined,
      };
      if (chapter)
        awarded = evaluateAccomplishments(
          { result: chapter, fingerprint: attempt.fingerprint, official: officialRun, dailyId, scenarioId: chapter.scenarioId },
          s.passport,
          completedAt,
        );
      track('daily_completed', {
        dailyId,
        official: officialRun,
        contentVersion: DAILY_CONTENT_VERSION,
        mode: s.settings.playStyle,
        state: 'completed',
        elapsedBucket: elapsedBucket(dailyStartedAt ? Date.now() - dailyStartedAt : 0),
      });
      if (s.intent?.friend) track('challenge_completed', { dailyId });
      if (officialRun) {
        void submitOfficialResult(record, {
          installId: s.installId,
          appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
          platform: s.isNative ? 'android' : 'web',
          communitySharing: s.settings.communitySharing,
        }).catch(() => undefined);
      }
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
      dailyV2,
      lastDaily,
      intent: undefined,
      newAccomplishments: [],
      openEvidenceId: undefined,
      trayOpen: false,
      focusDistrict: undefined,
    });
    if (awarded.length) get().awardAccomplishments(awarded);
    void Promise.all([
      storage.setRepublic(republic),
      storage.setBests(bests),
      storage.setHistory(history),
      storage.setDaily(daily),
      storage.setDailyV2(dailyV2),
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
  // --- daily quick play ------------------------------------------------------
  startDailyQuickPlay() {
    get().startDailyById(dailyIdFor(new Date()));
  },

  startDailyById(dailyId, opts) {
    let resolution: DailyResolution;
    try {
      resolution = resolveDaily(dailyId);
    } catch {
      return false;
    }
    const record = get().dailyV2.find((r) => r.dailyId === dailyId);
    let preview: Scenario | undefined;
    try {
      preview = getScenario(dailyScenarioId(resolution.dayId));
    } catch {
      preview = undefined;
    }
    set({
      // The cold open reads the day's title and lines; the game itself is created only when play begins.
      scenario: get().game ? get().scenario : preview,
      intent: {
        kind: 'daily',
        seed: resolution.seed,
        difficulty: resolution.difficulty,
        opponents: [...resolution.opponents],
        dailyId,
        dailyResolution: resolution,
        official: !record?.official,
        friend: opts?.friend,
      },
      replayOf: undefined,
    });
    get().navigate({ name: 'daily-open' });
    return true;
  },

  beginDailyPlay() {
    const s = get();
    const { intent } = s;
    if (!intent || intent.kind !== 'daily' || !intent.dailyResolution || !intent.dailyId) {
      get().navigate(HOME);
      return;
    }
    const res = intent.dailyResolution;
    const dailyId = intent.dailyId;
    const plan: SessionPlan = { scenarioIds: [dailyScenarioId(res.dayId)], dailyDate: dailyId };
    const hadCampaign = Boolean(s.campaign && (s.game || s.campaign.completed.length));
    const progress: CampaignProgress = {
      id: uid(),
      config: { seed: res.seed >>> 0, difficulty: res.difficulty, opponents: [...res.opponents], mode: 'daily' },
      chapterIndex: 0,
      completed: [],
      startedAt: nowIso(),
      updatedAt: nowIso(),
    };
    let made: { scenario: Scenario; game: GameState };
    try {
      made = makeChapterGame(progress, plan, 0);
    } catch {
      get().toast({ text: "Today's crisis could not be loaded. Please try again.", kind: 'warning', duration: 5000 });
      get().navigate(HOME);
      return;
    }
    // Starting never locks anything: only a completed attempt produces a result.
    const dailyV2 = upsertDaily(s.dailyV2, dailyId, (r) => ({ ...r, dayId: res.dayId, startedAt: r.startedAt ?? nowIso() }));
    const started = reduce(made.game, { type: 'start', tick: made.game.tick }, made.scenario);
    set({
      campaign: progress,
      plan,
      scenario: made.scenario,
      game: started,
      ...views(started, made.scenario),
      lastChapter: undefined,
      openEvidenceId: undefined,
      trayOpen: false,
      focusDistrict: undefined,
      replayOf: undefined,
      dailyV2,
      newAccomplishments: [],
    });
    void storage.setDailyV2(dailyV2).catch(() => undefined);
    void persistNow();
    if (hadCampaign) get().toast({ text: "Your paused campaign was replaced by today's crisis.", kind: 'info', duration: 4000 });
    dailyStartedAt = Date.now();
    firstChoiceTracked = false;
    track('daily_started', { dailyId, official: intent.official, contentVersion: res.contentVersion, mode: s.settings.playStyle });
    playCue('open');
    get().navigate({ name: 'play' });
  },

  setCommunitySharing(value) {
    get().updateSettings({ communitySharing: value });
  },
  setReminders(enabled, hour) {
    get().updateSettings({ remindersEnabled: enabled, ...(hour !== undefined ? { reminderHour: hour } : {}) });
    track(enabled ? 'reminder_enabled' : 'reminder_disabled');
  },
  awardAccomplishments(items) {
    const { passport } = get();
    const known = new Set(passport.earned.map((e) => e.id));
    const fresh = items.filter((i) => !known.has(i.id));
    if (!fresh.length) return;
    const next: PassportState = { v: 1, earned: [...passport.earned, ...fresh] };
    set({ passport: next, newAccomplishments: fresh });
    void storage.setPassport(next).catch(() => undefined);
  },

  async rotateInstallId() {
    metaRecord = { ...metaRecord, installId: newInstallId(), installIdRotatedAt: nowIso() };
    set({ installId: metaRecord.installId ?? '' });
    await storage.setMeta(metaRecord).catch(() => undefined);
    // The analytics distinct id derives from the install id: reconfigure immediately.
    const st = get();
    void startCommunityAndAnalytics({
      installId: metaRecord.installId ?? '',
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
      isNative: st.isNative,
      settings: st.settings,
    });
    get().toast({ text: 'Your anonymous id was replaced with a new one.', kind: 'success', duration: 3500 });
  },

  setPlayStyle(style) {
    const simple = style === 'simple';
    get().updateSettings({ playStyle: style, autoPauseOnDecision: simple, timerPace: simple ? 'relaxed' : 'standard' });
  },

  updateSettings(patch) {
    const settings: Settings = { ...get().settings, ...patch };
    set({ settings, reducedMotion: resolveReducedMotion(settings) });
    void storage.setSettings(settings).catch(() => undefined);
    if ('analyticsOptOut' in patch) applyAnalyticsOptOut(settings.analyticsOptOut);
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
    await wipeCommunityData();
    // A fresh anonymous id: nothing from the previous installation can be linked to the new one.
    metaRecord = { installId: newInstallId(), installIdRotatedAt: nowIso(), dailyMigratedV2: true };
    void storage.setMeta(metaRecord).catch(() => undefined);
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
      installId: metaRecord.installId ?? '',
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
      const [settings, republic, bests, history, daily, session, meta, dailyV2Stored, passportStored] = await Promise.all([
        storage.getSettings().catch(() => undefined),
        storage.getRepublic().catch(() => undefined),
        storage.getBests().catch(() => undefined),
        storage.getHistory().catch(() => undefined),
        storage.getDaily().catch(() => undefined),
        storage.getSession().catch(() => undefined),
        storage.getMeta().catch(() => undefined),
        storage.getDailyV2().catch(() => undefined),
        storage.getPassport().catch(() => undefined),
      ]);
      metaRecord = meta ?? {};
      const firstRun = !metaRecord.introDone;
      // Anonymous installation id: generated locally, rotatable, never sent raw.
      let metaDirty = false;
      if (!metaRecord.installId) {
        metaRecord = { ...metaRecord, installId: newInstallId(), installIdRotatedAt: nowIso() };
        metaDirty = true;
      }
      // Daily records v1 (local-date keyed) → v2 (official = first completion). Legacy rows are kept untouched.
      const legacyDaily = Array.isArray(daily) ? daily : [];
      let dailyV2: DailyRecordV2[] = Array.isArray(dailyV2Stored) ? dailyV2Stored.filter((r) => r && r.v === 2 && typeof r.dailyId === 'string') : [];
      if (!metaRecord.dailyMigratedV2) {
        dailyV2 = migrateDailyRecords(legacyDaily, dailyV2);
        metaRecord = { ...metaRecord, dailyMigratedV2: true };
        metaDirty = true;
        void storage.setDailyV2(dailyV2).catch(() => undefined);
      }
      const passport: PassportState = passportStored && passportStored.v === 1 && Array.isArray(passportStored.earned) ? passportStored : { v: 1, earned: [] };
      // Coarse return tracking (UTC day granularity only).
      const today = utcDayKey(new Date());
      const lastOpen = metaRecord.lastOpenDay;
      if (lastOpen && lastOpen !== today) {
        const gap = Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastOpen}T00:00:00Z`)) / 86400000));
        track('subsequent_day_return', { returnGap: gap === 1 ? '1' : gap === 2 ? '2' : gap <= 6 ? '3-6' : '7+' });
      }
      if (lastOpen !== today) {
        metaRecord = { ...metaRecord, lastOpenDay: today };
        metaDirty = true;
      }
      if (metaDirty) void storage.setMeta(metaRecord).catch(() => undefined);
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
        daily: legacyDaily,
        dailyV2,
        passport,
        installId: metaRecord.installId ?? '',
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
      if (restored?.plan.dailyDate) {
        try {
          const res = resolveDaily(restored.plan.dailyDate);
          const rec = dailyV2.find((r) => r.dailyId === restored.plan.dailyDate);
          set({
            intent: { kind: 'daily', seed: res.seed, difficulty: res.difficulty, opponents: [...res.opponents], dailyId: restored.plan.dailyDate, dailyResolution: res, official: !rec?.official },
          });
        } catch {
          /* the day is no longer resolvable; the session still plays from its saved state */
        }
      }
      if (!restored && session) {
        void storage.clearSession().catch(() => undefined);
        get().toast({ text: 'A saved game from an older version could not be restored and was cleared.', kind: 'warning', duration: 6000 });
      }
      // Network features start after local state is ready; they never block or affect gameplay.
      void startCommunityAndAnalytics({
        installId: metaRecord.installId ?? '',
        appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
        isNative,
        settings: mergedSettings,
      }).then(() => track('app_opened', { platform: isNative ? 'android' : 'web' }));
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
