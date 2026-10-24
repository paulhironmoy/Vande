/**
 * VANDE: Republic Under Pressure — shared domain types.
 *
 * This file is the contract between the content (JSON scenarios), the engine
 * (deterministic simulation), the map renderer and the React UI.
 * Everything here must stay plain-data (JSON serialisable): no classes, no functions.
 */

// ---------------------------------------------------------------------------
// Dimensions & scores
// ---------------------------------------------------------------------------

/** The six Republic dimensions. Values are always clamped to 0..100. */
export type Dimension = 'freedom' | 'grievance' | 'safety' | 'evidence' | 'trust' | 'economy';

export const DIMENSIONS: readonly Dimension[] = ['freedom', 'grievance', 'safety', 'evidence', 'trust', 'economy'] as const;

export const DIMENSION_LABELS: Record<Dimension, string> = {
  freedom: 'Constitutional freedom',
  grievance: 'Grievance resolution',
  safety: 'Public safety',
  evidence: 'Evidence accuracy',
  trust: 'Public trust',
  economy: 'Economic continuity',
};

export type Scores = Record<Dimension, number>;
export type ScoreDelta = Partial<Record<Dimension, number>>;

// ---------------------------------------------------------------------------
// Opponents & difficulty
// ---------------------------------------------------------------------------

export type OpponentId = 'exploiter' | 'provocateur' | 'disinfo' | 'sabotage' | 'overreaction';
export const OPPONENT_IDS: readonly OpponentId[] = ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'] as const;

export type Difficulty = 'measured' | 'standard' | 'severe';
export const DIFFICULTIES: readonly Difficulty[] = ['measured', 'standard', 'severe'] as const;

export interface OpponentMeta {
  id: OpponentId;
  name: string;
  /** One line: what it does. */
  behavior: string;
  /** How it pressures the player (one line). */
  pressure: string;
  /** Baseline difficulty label shown on the card. */
  baseDifficulty: 'Low' | 'Medium' | 'High';
  /** Visual signal pattern used by the card animation and map signals. */
  signal: 'pulse' | 'spike' | 'swarm' | 'fracture' | 'bait';
  /** Which player tendencies this opponent exploits (keys of PlayerTendencies). */
  exploits: ActionTag[];
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type ConfidenceState = 'verified' | 'corroborated' | 'unverified' | 'manipulated' | 'unknown';
export const CONFIDENCE_STATES: readonly ConfidenceState[] = ['verified', 'corroborated', 'unverified', 'manipulated', 'unknown'] as const;

export type EvidenceTruth = 'true' | 'false' | 'misleading' | 'unknowable';
export type SourceType = 'official' | 'institution' | 'press' | 'organizer' | 'citizen' | 'anonymous' | 'leak' | 'business' | 'emergency';
export type EvidenceVisualType = 'photo' | 'document' | 'recording' | 'message' | 'chart' | 'map' | 'ledger' | 'video';

export interface EvidenceMetadata {
  label: string;
  value: string;
  /** True when inspecting this field reveals an inconsistency. */
  anomaly?: boolean;
}

export interface ScenarioEvidence {
  id: string;
  title: string;
  source: string;
  sourceType: SourceType;
  /** In-world clock label, e.g. "09:42". */
  time: string;
  /** Short claim (max ~140 chars). */
  claim: string;
  /** State displayed when the card arrives. */
  initialState: ConfidenceState;
  /** What is actually the case. */
  truth: EvidenceTruth;
  /** State reached after thorough verification (inspect + compare). */
  resolvedState: ConfidenceState;
  /** Tick at which the card becomes available (ignored when injected by an opponent play). */
  availableAt?: number;
  /** When set, this item only appears via an opponent play of that opponent. */
  injectedBy?: OpponentId;
  metadata: EvidenceMetadata[];
  /** Comparing with any of these (if available) moves the item toward `resolvedState`. */
  corroboratedBy?: string[];
  /** Comparing with any of these (if available) exposes the item as manipulated/unknown. */
  contradictedBy?: string[];
  visual: { type: EvidenceVisualType; caption: string };
  district?: string;
  /** Narrative flags set when the item reaches its resolved state. */
  setsFlagsOnResolve?: string[];
  /** If true the Sabotage Network may destroy it unless preserved. */
  perishable?: boolean;
  /** Short plain-language note shown once resolved. */
  resolutionNote: string;
}

export interface EvidenceState {
  id: string;
  visible: boolean;
  arrivedAt: number;
  state: ConfidenceState;
  inspected: boolean;
  compared: boolean;
  preserved: boolean;
  markedUnresolved: boolean;
  destroyed: boolean;
  /** Set when a decision used this item as its basis. */
  usedInDecision?: string;
  /** Tick when the state last changed (for UI animation). */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type ActionTag =
  | 'proportionate'
  | 'disproportionate'
  | 'suppressive'
  | 'force'
  | 'detention'
  | 'accusation'
  | 'transparent'
  | 'investigative'
  | 'dialogue'
  | 'service'
  | 'communication'
  | 'legal-process'
  | 'protect-press'
  | 'protect-assembly'
  | 'wait'
  | 'censorship'
  | 'relief';

export interface Condition {
  flag?: string;
  notFlag?: string;
  anyFlag?: string[];
  minScore?: ScoreDelta;
  maxScore?: ScoreDelta;
  /** Only when this opponent is selected. */
  opponent?: OpponentId;
  /** Only when this opponent is NOT selected. */
  notOpponent?: OpponentId;
  /** Evidence item must be in one of these states. */
  evidence?: { id: string; states: ConfidenceState[] };
}

export type MapEffectKind =
  | 'crowd' // magnitude: delta crowd (-1..1) at district
  | 'mood' // mood: new mood at district
  | 'road' // road: id, status
  | 'institution' // district: institution responds (pulse)
  | 'service' // district, magnitude delta services (-1..1)
  | 'signal' // from,to,signal kind
  | 'incident' // district, incident kind | null
  | 'trust' // district magnitude delta
  | 'action'; // actionKind at district (deploy, dialogue, announce, investigate, restore, protect, relief)

export type DistrictMood = 'calm' | 'tense' | 'volatile' | 'hopeful';
export type RoadStatus = 'open' | 'congested' | 'closed';
export type IncidentKind = 'vandalism' | 'clash' | 'fire' | 'outage' | 'intimidation';
export type SignalKind = 'rumor' | 'manipulated' | 'verified' | 'official';
export type MapActionKind = 'deploy' | 'dialogue' | 'announce' | 'investigate' | 'restore' | 'protect' | 'relief' | 'legal';

export interface MapEffect {
  kind: MapEffectKind;
  district?: string;
  road?: string;
  from?: string;
  to?: string;
  magnitude?: number;
  mood?: DistrictMood;
  status?: RoadStatus;
  signal?: SignalKind;
  incident?: IncidentKind | null;
  action?: MapActionKind;
}

export interface DelayedEffectSpec {
  afterTicks: number;
  effects: ScoreDelta;
  message: string;
  condition?: Condition;
  mapEffects?: MapEffect[];
  setsFlags?: string[];
}

export interface DecisionOption {
  id: string;
  /** Direct action title, imperative, max ~48 chars. */
  title: string;
  /** One-line consequence preview (what will visibly happen), max ~110 chars. */
  preview: string;
  /** The right or responsibility involved, e.g. "Article 19(1)(b) — peaceful assembly". */
  authority: string;
  tags: ActionTag[];
  /** Evidence this option relies on. If any is not verified/corroborated a confidence warning is shown. */
  requiresEvidence?: string[];
  effects: ScoreDelta;
  /** Applied instead of `effects` when the option is an accusation and the relied-on evidence is false/misleading. */
  falseAccusationEffects?: ScoreDelta;
  /** Applied in addition to `effects` when the option is force/detention and `proportionateIf` is not met. */
  proportionateIf?: Condition;
  disproportionateEffects?: ScoreDelta;
  delayed?: DelayedEffectSpec[];
  mapEffects?: MapEffect[];
  /** Immediate consequence text shown after choosing (max ~140 chars). */
  consequence: string;
  /** Allows a short undo window (ticks). Only for reversible, non-coercive actions. */
  undoTicks?: number;
  /** Evidence items made available by this option. */
  unlocksEvidence?: string[];
  setsFlags?: string[];
  clearsFlags?: string[];
}

export type Urgency = 'low' | 'medium' | 'high';

export interface ScenarioDecision {
  id: string;
  title: string;
  /** 1–2 sentences of situation. */
  situation: string;
  district?: string;
  /** Tick at which the decision appears (ignored when triggered by flag or opponent play). */
  triggerAt?: number;
  /** Appears when this flag becomes set. */
  triggerFlag?: string;
  condition?: Condition;
  /** Ticks before the decision auto-resolves with `defaultOption`. */
  expiresAfter: number;
  defaultOption: string;
  urgency: Urgency;
  options: DecisionOption[];
  /** Optional in-flow rights moment shown after this decision resolves. */
  rightsMomentId?: string;
}

export interface DecisionState {
  id: string;
  status: 'pending' | 'resolved' | 'expired';
  appearedAt: number;
  expiresAt: number;
  chosenOption?: string;
  decidedAt?: number;
  /** True when auto-resolved because the player did not act. */
  auto?: boolean;
  /** Set when the choice created a false accusation. */
  falseAccusation?: boolean;
  /** Set when the choice was disproportionate force. */
  disproportionate?: boolean;
  /** Set when the choice was taken on evidence that was not yet verified/corroborated. */
  unverifiedBasis?: boolean;
}

// ---------------------------------------------------------------------------
// Rights moments
// ---------------------------------------------------------------------------

export interface RightsOption {
  id: string;
  text: string;
  correct: boolean;
  feedback: string;
}

export interface RightsMoment {
  id: string;
  /** Situational question, plain language. */
  question: string;
  options: RightsOption[];
  /** The principle explained plainly (1–2 sentences). */
  principle: string;
  /** Why it mattered in this situation (1–2 sentences). */
  why: string;
  source?: { label: string; url: string };
  /** ISO date of the content review. */
  contentDate: string;
}

export interface RightsMomentState {
  id: string;
  status: 'pending' | 'answered';
  appearedAt: number;
  chosenOption?: string;
  correct?: boolean;
}

// ---------------------------------------------------------------------------
// Events & opponent plays
// ---------------------------------------------------------------------------

export type EventKind = 'crowd' | 'rumor' | 'service' | 'road' | 'institution' | 'news' | 'incident' | 'relief';

export interface ScenarioEvent {
  id: string;
  at: number;
  kind: EventKind;
  /** Feed line shown to the player (max ~120 chars). */
  message: string;
  condition?: Condition;
  effects?: ScoreDelta;
  mapEffects?: MapEffect[];
  setsFlags?: string[];
  clearsFlags?: string[];
}

export type OpponentPlayKind = 'inject-evidence' | 'event' | 'decision' | 'destroy-evidence';

export interface OpponentPlay {
  id: string;
  opponent: OpponentId;
  kind: OpponentPlayKind;
  /** Evidence id (inject/destroy), event id, or decision id depending on kind. */
  target: string;
  /** Scheduling window in ticks. */
  earliest: number;
  latest: number;
  /** Relative weight when the opponent chooses plays (default 1). */
  weight?: number;
  /** Player tendency that makes this play more likely (memory). */
  respondsTo?: ActionTag[];
  /** Only playable in difficulties >= this. */
  minDifficulty?: Difficulty;
  condition?: Condition;
  /** Feed line when the play fires (optional; events/evidence have their own text). */
  message?: string;
}

// ---------------------------------------------------------------------------
// Scenario (static content)
// ---------------------------------------------------------------------------

export type ScenarioId = 'examination-crisis' | 'electoral-dispute' | 'information-storm';
export const SCENARIO_IDS: readonly ScenarioId[] = ['examination-crisis', 'electoral-dispute', 'information-storm'] as const;

export type DistrictKind = 'campus' | 'civic' | 'market' | 'transit' | 'media' | 'records' | 'residential' | 'industrial' | 'hospital';

export interface ScenarioDistrict {
  id: string;
  name: string;
  kind: DistrictKind;
  /** Normalised map position 0..1 (x right, y down). */
  x: number;
  y: number;
  /** Starting values 0..1. */
  baseline: { crowd: number; trust: number; services: number };
  /** Name of the institution located here, if any (e.g. "District Collectorate"). */
  institution?: string;
}

export interface ScenarioRoad {
  id: string;
  from: string;
  to: string;
}

export interface ResolutionRule {
  condition: Condition;
  text: string;
}

export interface Scenario {
  id: ScenarioId;
  chapter: 1 | 2 | 3;
  title: string;
  subtitle: string;
  /** Ticks (1 tick = 1 game second). 180–240. */
  duration: number;
  briefing: {
    grievance: string;
    knownFacts: string[];
    unverifiedClaims: string[];
    responsibility: string;
    /** Three-minute objective, one line. */
    objective: string;
    /** Opening cinematic lines, 3–5 short lines (shown progressively). */
    lines: string[];
  };
  startingScores: Scores;
  districts: ScenarioDistrict[];
  roads: ScenarioRoad[];
  evidence: ScenarioEvidence[];
  decisions: ScenarioDecision[];
  rightsMoments: RightsMoment[];
  events: ScenarioEvent[];
  opponentPlays: OpponentPlay[];
  resolution: {
    resolved: ResolutionRule[];
    unresolved: ResolutionRule[];
    rightsProtected: ResolutionRule[];
    rightsHarmed: ResolutionRule[];
    improvements: ResolutionRule[];
    /** Closing line variants by outcome band. */
    closing: { good: string; mixed: string; poor: string };
  };
}

// ---------------------------------------------------------------------------
// Game configuration & runtime state
// ---------------------------------------------------------------------------

export type GameMode = 'campaign' | 'daily' | 'challenge' | 'replay';

export interface GameConfig {
  scenarioId: ScenarioId;
  /** 32-bit unsigned seed. */
  seed: number;
  difficulty: Difficulty;
  opponents: OpponentId[];
  mode: GameMode;
  /** Scores carried in from the previous chapter (campaign) — otherwise the scenario's startingScores are used. */
  carryScores?: Scores;
}

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface DistrictState {
  id: string;
  crowd: number; // 0..1
  mood: DistrictMood;
  trust: number; // 0..1
  services: number; // 0..1
  institutionActiveUntil: number; // tick
  incident: IncidentKind | null;
  /** Last action shown at this district. */
  lastAction?: { kind: MapActionKind; at: number };
}

export interface Signal {
  id: string;
  from: string;
  to: string;
  kind: SignalKind;
  startedAt: number;
  endsAt: number;
}

export type FeedKind = 'event' | 'decision' | 'consequence' | 'delayed' | 'evidence' | 'opponent' | 'rights' | 'system';

export interface FeedItem {
  id: string;
  tick: number;
  kind: FeedKind;
  text: string;
  /** Dimensions that moved (for icons/colours; magnitude not shown pre-decision). */
  dims?: Dimension[];
  /** Direction hint per dimension. */
  direction?: Partial<Record<Dimension, 'up' | 'down'>>;
}

export interface DelayedEffect {
  id: string;
  dueAt: number;
  effects: ScoreDelta;
  message: string;
  condition?: Condition;
  mapEffects?: MapEffect[];
  setsFlags?: string[];
  /** Decision/option that scheduled it. */
  sourceId: string;
}

export interface OpponentRuntime {
  id: OpponentId;
  /** Scheduled plays: play id -> tick. */
  schedule: Record<string, number>;
  fired: string[];
  /** Recent player tags observed (most recent last). */
  memory: ActionTag[];
  /** 0..1 intensity derived from difficulty and memory. */
  intensity: number;
}

export interface ScoreSample {
  tick: number;
  scores: Scores;
}

export interface GameStats {
  decisionsMade: number;
  decisionsExpired: number;
  falseAccusations: number;
  disproportionateActions: number;
  unverifiedActions: number;
  manipulationsDetected: number;
  manipulationsSucceeded: number;
  evidenceResolved: number;
  evidencePreserved: number;
  evidenceDestroyed: number;
  rightsCorrect: number;
  rightsTotal: number;
}

export interface ActionFeedback {
  tick: number;
  title: string;
  text: string;
  dims: Dimension[];
  direction: Partial<Record<Dimension, 'up' | 'down'>>;
  warning?: 'false-accusation' | 'disproportionate' | 'unverified-basis';
  mapEffects?: MapEffect[];
}

export type GameStatus = 'briefing' | 'running' | 'paused' | 'ended';

export interface UndoWindow {
  decisionId: string;
  optionId: string;
  expiresAt: number;
  /** Serialised snapshot (GameState without `undo`) taken before the decision. */
  snapshot: Omit<GameState, 'undo'>;
}

export interface GameState {
  version: 1;
  config: GameConfig;
  tick: number;
  duration: number;
  status: GameStatus;
  rng: RngState;
  scores: Scores;
  history: ScoreSample[];
  districts: Record<string, DistrictState>;
  roads: Record<string, RoadStatus>;
  signals: Signal[];
  evidence: Record<string, EvidenceState>;
  decisions: Record<string, DecisionState>;
  /** Pending decisions in display order (oldest first). */
  pendingDecisionIds: string[];
  rights: Record<string, RightsMomentState>;
  pendingRightsIds: string[];
  feed: FeedItem[];
  flags: Record<string, true>;
  delayed: DelayedEffect[];
  opponents: Record<string, OpponentRuntime>;
  /** All player actions in order (for replay and determinism tests). */
  log: PlayerAction[];
  stats: GameStats;
  lastFeedback?: ActionFeedback;
  undo?: UndoWindow;
  /** Monotonic counter used for ids generated inside the engine. */
  counter: number;
}

export type EvidenceVerb = 'inspect' | 'compare' | 'preserve' | 'unresolved' | 'clear-unresolved';

export type PlayerAction =
  | { type: 'start'; tick: number }
  | { type: 'decide'; tick: number; decisionId: string; optionId: string }
  | { type: 'undo'; tick: number }
  | { type: 'evidence'; tick: number; evidenceId: string; verb: EvidenceVerb; compareWith?: string }
  | { type: 'rights'; tick: number; momentId: string; optionId: string }
  | { type: 'pause'; tick: number }
  | { type: 'resume'; tick: number };

// ---------------------------------------------------------------------------
// Derived views for the UI and the map
// ---------------------------------------------------------------------------

export interface Pulse {
  /** 0..1 — 1 means all six dimensions are close together and healthy. */
  balance: number;
  /** Per-dimension recent change (points per ~15 ticks), negative = falling. */
  momentum: Scores;
  /** 0..1 — volatility of recent changes plus active incidents. */
  instability: number;
  /** Overall direction of the mean over the recent window. */
  direction: 'rising' | 'steady' | 'falling';
  /** Mean of the six dimensions. */
  mean: number;
  weakest: Dimension;
  strongest: Dimension;
}

export interface MapDistrictView {
  id: string;
  name: string;
  kind: DistrictKind;
  x: number;
  y: number;
  crowd: number;
  mood: DistrictMood;
  trust: number;
  services: number;
  institution?: string;
  institutionActive: boolean;
  incident: IncidentKind | null;
  lastAction?: { kind: MapActionKind; at: number };
  /** Number of pending decisions located here (for a marker). */
  pendingDecisions: number;
  /** Number of unresolved visible evidence items located here. */
  openEvidence: number;
}

export interface MapRoadView {
  id: string;
  from: string;
  to: string;
  status: RoadStatus;
}

export interface MapSignalView {
  id: string;
  from: string;
  to: string;
  kind: SignalKind;
  /** 0..1 progress along the path at the current tick. */
  progress: number;
}

export interface MapState {
  tick: number;
  districts: MapDistrictView[];
  roads: MapRoadView[];
  signals: MapSignalView[];
  /** Overall 0..1 city "health" used for ambient lighting. */
  health: number;
  /** Recent actions to animate (last ~10 ticks). */
  recentActions: { district: string; kind: MapActionKind; at: number }[];
  /** Highlighted district (selected by the player), if any. */
  focus?: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type RepublicOutcome =
  | 'resilient'
  | 'free-fragile'
  | 'order-without-trust'
  | 'manipulated'
  | 'institutionally-weakened'
  | 'economically-disrupted';

export const OUTCOME_LABELS: Record<RepublicOutcome, string> = {
  resilient: 'Resilient Republic',
  'free-fragile': 'Free but Fragile',
  'order-without-trust': 'Order without Trust',
  manipulated: 'Manipulated Republic',
  'institutionally-weakened': 'Institutionally Weakened',
  'economically-disrupted': 'Economically Disrupted',
};

export interface ManipulationOutcome {
  evidenceId: string;
  title: string;
  opponent: OpponentId;
  /** True when the manipulation achieved its goal (acted upon or never exposed). */
  succeeded: boolean;
  note: string;
}

export interface KeyDecision {
  decisionId: string;
  optionId: string;
  title: string;
  optionTitle: string;
  /** Net absolute score impact (sum of |delta| across dims, including delayed effects attributed). */
  impact: number;
  tick: number;
  flags: ('false-accusation' | 'disproportionate' | 'unverified-basis' | 'auto')[];
}

export interface ChapterResult {
  scenarioId: ScenarioId;
  chapter: 1 | 2 | 3;
  config: GameConfig;
  scores: Scores;
  startScores: Scores;
  /** 0..100 chapter score (balance-weighted). */
  score: number;
  resolved: string[];
  unresolved: string[];
  manipulations: ManipulationOutcome[];
  rightsProtected: string[];
  rightsHarmed: string[];
  improvement: string;
  closing: string;
  keyDecision?: KeyDecision;
  /** Evidence that mattered but was never resolved by the player. */
  missedEvidence: { id: string; title: string; note: string }[];
  stats: GameStats;
  durationTicks: number;
  completedAt: string; // ISO timestamp (wall clock, not used in scoring)
}

export interface CampaignResult {
  id: string; // uuid-ish local id
  mode: GameMode;
  seed: number;
  difficulty: Difficulty;
  opponents: OpponentId[];
  chapters: ChapterResult[];
  finalScores: Scores;
  /** 0..100 */
  score: number;
  outcome: RepublicOutcome;
  mostConsequential?: KeyDecision & { scenarioId: ScenarioId };
  missedEvidence: { scenarioId: ScenarioId; id: string; title: string; note: string }[];
  valuesProtected: string[];
  hardestDecision?: string;
  completedAt: string;
  challengeCode: string;
}

// ---------------------------------------------------------------------------
// Challenges & daily
// ---------------------------------------------------------------------------

export interface ChallengeSpec {
  v: 1;
  /** 'campaign' plays all three chapters; otherwise a single scenario. */
  scenario: ScenarioId | 'campaign';
  seed: number;
  difficulty: Difficulty;
  opponents: OpponentId[];
  /** Challenger's score 0..100 (optional for fresh challenges). */
  score?: number;
}

export interface DailySpec {
  /** YYYY-MM-DD in local time. */
  date: string;
  scenarioId: ScenarioId;
  seed: number;
  difficulty: Difficulty;
  opponents: OpponentId[];
  title: string;
  /** Simulated comparison band (NOT real players) — low/high scores 0..100. */
  simulatedBand: { low: number; high: number; typical: number };
}

// ---------------------------------------------------------------------------
// Persistence (local only)
// ---------------------------------------------------------------------------

export type TimerPace = 'standard' | 'relaxed' | 'extended';
export type TextScale = 1 | 1.25 | 1.5 | 2;

export interface Settings {
  reducedMotion: 'system' | 'on' | 'off';
  highContrast: boolean;
  textScale: TextScale;
  sound: boolean;
  haptics: boolean;
  captions: boolean;
  timerPace: TimerPace;
  /** Show numeric values on the Pulse without hover. */
  alwaysShowValues: boolean;
  colourBlindSafe: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  reducedMotion: 'system',
  highContrast: false,
  textScale: 1,
  sound: true,
  haptics: true,
  captions: true,
  timerPace: 'standard',
  alwaysShowValues: false,
  colourBlindSafe: false,
};

/** Long-term Republic condition, updated after every completed campaign or chapter. 0..100 each. */
export interface RepublicCondition {
  freedom: number;
  safety: number;
  trust: number;
  economy: number;
  legitimacy: number;
  /** Count of completed campaigns. */
  campaigns: number;
  /** Count of completed chapters/dailies. */
  crises: number;
  updatedAt: string;
}

export interface CampaignProgress {
  id: string;
  config: Omit<GameConfig, 'scenarioId' | 'carryScores'>;
  /** Index of the chapter currently in progress (0..2). */
  chapterIndex: number;
  completed: ChapterResult[];
  /** Serialised in-progress game, if any. */
  game?: GameState;
  startedAt: string;
  updatedAt: string;
}

export interface DailyRecord {
  date: string;
  score: number;
  outcome: RepublicOutcome;
  completedAt: string;
}

export interface PersonalBests {
  campaign?: { score: number; outcome: RepublicOutcome; at: string };
  daily?: { score: number; date: string };
  chapters: Partial<Record<ScenarioId, { score: number; at: string }>>;
}

export interface HistoryEntry {
  id: string;
  kind: 'campaign' | 'daily' | 'challenge' | 'chapter';
  title: string;
  score: number;
  outcome?: RepublicOutcome;
  completedAt: string;
  campaign?: CampaignResult;
  chapter?: ChapterResult;
  challengeCode?: string;
}
