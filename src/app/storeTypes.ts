/**
 * Store contract — implemented in src/app/store.ts (APP-SHELL package).
 * Screens import `useApp` from '@/app/store' and select from this shape.
 */
import type {
  CampaignProgress,
  CampaignResult,
  ChapterResult,
  ChallengeSpec,
  DailyRecord,
  DailySpec,
  Difficulty,
  GameState,
  HistoryEntry,
  MapState,
  OpponentId,
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
  | { name: 'challenge'; code: string }
  | { name: 'republic' }
  | { name: 'history'; entryId?: string }
  | { name: 'settings' }
  | { name: 'about'; page: AboutPage };

export type ScreenName = Screen['name'];

/** What the player is setting up on the opponent screen. */
export interface PendingIntent {
  kind: 'campaign' | 'daily' | 'challenge';
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
  daily: DailyRecord[];
}

export interface Actions {
  // navigation
  navigate(screen: Screen, opts?: { replace?: boolean }): void;
  back(): boolean; // returns false when at root (native layer may exit app)
  // first run
  completeIntro(): void;
  // setup
  beginCampaignSetup(): void; // -> opponents screen with campaign intent
  beginDailySetup(): void; // -> briefing directly (daily uses fixed opponents)
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
  resetRepublic(): Promise<void>;
  exportData(): Promise<string>; // JSON string of all local data
  deleteAllData(): Promise<void>;
  // hydration (called once by App)
  hydrate(): Promise<void>;
}

export type AppState = SessionSlice & UiSlice & DataSlice & Actions;
