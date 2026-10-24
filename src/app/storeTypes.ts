/**
 * Store contract — implemented in src/app/store.ts (APP-SHELL package).
 * Screens import `useApp` from '@/app/store' and select from this shape.
 */
import type {
  CampaignProgress,
  CampaignResult,
  ChapterResult,
  ChallengeSpec,
  DailyAttemptResult,
  DailyId,
  DailyRecord,
  DailyRecordV2,
  DailyResolution,
  DailySpec,
  Difficulty,
  GameState,
  HistoryEntry,
  MapState,
  OpponentId,
  PassportAccomplishment,
  PassportState,
  PersonalBests,
  PlayerAction,
  Pulse,
  RepublicCondition,
  Scenario,
  Settings,
} from '@/engine/types';

export type AboutPage = 'privacy' | 'disclosure' | 'accessibility' | 'attribution' | 'support' | 'version';

export type Screen =
  | { name: 'launch' }
  | { name: 'intro' }
  | { name: 'home' }
  | { name: 'opponents' }
  | { name: 'briefing' }
  | { name: 'play' }
  | { name: 'chapter-result' }
  | { name: 'final-result'; resultId?: string }
  | { name: 'daily' }
  /** Skippable cold open shown right before a daily attempt starts. */
  | { name: 'daily-open' }
  | { name: 'calendar' }
  | { name: 'passport' }
  | { name: 'challenge'; code: string }
  | { name: 'republic' }
  | { name: 'history'; entryId?: string }
  | { name: 'settings' }
  | { name: 'about'; page: AboutPage };

export type ScreenName = Screen['name'];

/** What the player is setting up on the opponent screen. */
export interface PendingIntent {
  kind: 'campaign' | 'daily' | 'challenge';
  /** Daily quick play: the resolved canonical daily and whether this attempt will be official. */
  dailyId?: DailyId;
  dailyResolution?: DailyResolution;
  official?: boolean;
  /** Daily challenge from a friend: hidden until completion. */
  friend?: { score: number; fingerprint: string; outcome?: string };
  seed: number;
  difficulty: Difficulty;
  opponents: OpponentId[];
  /** Challenge or daily details when relevant. */
  challenge?: ChallengeSpec;
  daily?: DailySpec;
}

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'success' | 'warning' | 'danger';
  /** ms; 0 = sticky */
  duration: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface SessionSlice {
  /** The current campaign/daily/challenge progress (persisted). */
  campaign?: CampaignProgress;
  scenario?: Scenario;
  game?: GameState;
  pulse?: Pulse;
  map?: MapState;
  /** Latest chapter result (shown on the chapter-result screen). */
  lastChapter?: ChapterResult;
  /** Latest campaign result (shown on the final-result screen). */
  lastCampaign?: CampaignResult;
  /** Chapter result awaiting the player's "continue". */
  intent?: PendingIntent;
  /** Set after a daily attempt completes: which record it produced and whether it was official. */
  lastDaily?: {
    dailyId: DailyId;
    official: boolean;
    result: DailyAttemptResult;
    record: DailyRecordV2;
    friend?: PendingIntent['friend'];
    /** Change in the five long-term Republic measures caused by this (official) result. */
    republicDelta?: Partial<RepublicCondition>;
  };
  /** Accomplishments awarded by the most recent completion (for the result screen). */
  newAccomplishments: PassportAccomplishment[];
}

export interface UiSlice {
  screen: Screen;
  /** Screens the player can go back to (most recent last). */
  stack: Screen[];
  toasts: Toast[];
  /** Gameplay context preserved across rotation/layout changes. */
  openEvidenceId?: string;
  trayOpen: boolean;
  focusDistrict?: string;
  /** True once persistence has loaded; screens render skeleton-free after this. */
  hydrated: boolean;
  firstRun: boolean;
  updateAvailable: boolean;
  /** Reduced motion resolved against system preference. */
  reducedMotion: boolean;
  isNative: boolean;
  online: boolean;
  /** True while the clock is paused automatically for a new decision (Simple play style). */
  autoPaused: boolean;
}

export interface DataSlice {
  settings: Settings;
  republic: RepublicCondition;
  bests: PersonalBests;
  history: HistoryEntry[];
  /** Legacy v1 records (local-date keyed); kept read-only after migration. */
  daily: DailyRecord[];
  /** Daily Quick Play records keyed by canonical UTC daily id. */
  dailyV2: DailyRecordV2[];
  passport: PassportState;
  /** Locally generated, rotatable anonymous installation id (never sent raw). */
  installId: string;
}

export interface Actions {
  // navigation
  navigate(screen: Screen, opts?: { replace?: boolean }): void;
  back(): boolean; // returns false when at root (native layer may exit app)
  // first run
  completeIntro(): void;
  // setup
  beginCampaignSetup(): void; // -> opponents screen with campaign intent
  beginDailySetup(): void; // legacy entry: now equivalent to startDailyQuickPlay()
  /** Daily Quick Play: resolve today's canonical daily, prepare the session, show the cold open. No opponent setup. */
  startDailyQuickPlay(): void;
  /** Daily Quick Play for a specific canonical id (challenge links, calendar replays); practice when an official result exists. */
  startDailyById(dailyId: DailyId, opts?: { friend?: PendingIntent['friend'] }): boolean;
  /** From the cold open (or its skip) → running game. */
  beginDailyPlay(): void;
  beginChallenge(code: string): boolean; // -> briefing; false if code invalid
  setIntentOpponents(opponents: OpponentId[]): void;
  setIntentDifficulty(d: Difficulty): void;
  confirmSetup(): void; // creates CampaignProgress + first chapter game -> briefing
  // game lifecycle
  continueCampaign(): void; // resumes persisted campaign -> briefing or play
  startChapter(): void; // from briefing -> play (status running)
  dispatch(action: PlayerAction): void; // engine reduce + persist
  tickGame(n: number): void;
  pauseGame(): void;
  resumeGame(): void;
  endChapter(): void; // compute ChapterResult -> chapter-result screen
  nextChapter(): void; // from chapter-result: next chapter briefing or final result
  abandonCampaign(): void;
  replayLast(): void; // same seed/opponents/difficulty
  // ui context
  setOpenEvidence(id?: string): void;
  setTrayOpen(open: boolean): void;
  setFocusDistrict(id?: string): void;
  toast(t: Omit<Toast, 'id'> & { id?: string }): void;
  dismissToast(id: string): void;
  setUpdateAvailable(v: boolean): void;
  // data
  updateSettings(patch: Partial<Settings>): void;
  /** Switches play style and applies its defaults (pace, auto-pause). */
  setPlayStyle(style: Settings['playStyle']): void;
  setCommunitySharing(value: 'on' | 'off'): void;
  setReminders(enabled: boolean, hour?: number): void;
  /** Replaces the anonymous installation id with a fresh one. */
  rotateInstallId(): Promise<void>;
  /** Persists newly earned accomplishments (ids already present are ignored). */
  awardAccomplishments(items: PassportAccomplishment[]): void;
  resetRepublic(): Promise<void>;
  exportData(): Promise<string>; // JSON string of all local data
  deleteAllData(): Promise<void>;
  // hydration (called once by App)
  hydrate(): Promise<void>;
}

export type AppState = SessionSlice & UiSlice & DataSlice & Actions;
