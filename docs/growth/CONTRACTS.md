# Challenge contracts (proposed TypeScript)

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. When Stage 4 opens, root lands these files in `src/contracts/` before any agent
> starts. They build on `src/contracts/practice.ts` as of 2026-10-25, where `PRACTICE_SIM_VERSION` is still 1 and is
> expected to become 2. Stage tags: **[S4]** asynchronous competition, **[S5]** daily ritual, **[S6]** social growth.

Contents:
1. Wire format
2. Over definition and commitment
3. Challenges, attempts, verdicts, reveal
4. Today's Over
5. Rivalries, series, tournaments, clips
6. Home action, rhythm, Coach Ball, notifications
7. API v2 route map
8. Ids
9. Versioning and migration rules

## 1. Wire format [S4] (decision: integers only)

Every number that reaches the physics, a digest or a signature travels as a **safe integer in a fixed unit**. The
client must resolve its own ball with the *decoded* values. Then client and server simulate identical doubles: an
integer divided by a power of ten is correctly rounded on every engine. JSON's float printing is not normatively
unique (`VERIFICATION.md` §2).

Rejected alternatives:
- **Raw floats.** Canonical hashing would depend on number printing.
- **Raw gesture samples.** Privacy (they are behavioural data), size, and the normaliser is engine-dependent.

```ts
// src/contracts/challenge.ts (proposed) — ROOT-OWNED
import type {
  AssistLevel, BallCondition, BowlerProfile, ContactKind, Decision, DeliveryVariation, Difficulty, Dismissal,
  FielderRole, Footwork, Handedness, PitchCondition, SwingKind,
} from './practice';
import type { AvatarSpec, FieldZone } from './cricket'; // move FieldZone and AvatarSpec out of cricket.ts before it is retired

export const CHALLENGE_CONTRACT_VERSION = 1 as const;

/** Units of the integer wire format (value_on_wire = round(value × scale)). */
export const WIRE_SCALE = {
  /** NormalizedSwing.startT (s after release) → 0.1 ms. Matches src/input PRECISION.startT = 1e-4. */
  startT: 10_000,
  /** degrees → 0.1° (PRECISION.directionDeg). */
  deg: 10,
  /** power, elevation 0..1 → 0.001 (PRECISION.unit). */
  unit: 1_000,
  /** metres → cm (plan line/length are round2 in src/practice/game/overs.ts; fielder x/z are round2 in autoField). */
  cm: 100,
  /** km/h → 0.1 km/h (plan speeds are round1). */
  kph: 10,
  /** milliseconds → 0.1 ms (timing errors in verdicts). */
  ms: 10,
} as const;

/** A safe integer (validated with Number.isSafeInteger). */
export type Int = number;

export interface WirePlan {
  v: DeliveryVariation;
  /** lengthM × 100 (cm in front of the striker's stumps). */
  len: Int;
  /** lineM × 100 (cm, + towards the batter's off side). */
  line: Int;
  /** speedKph × 10. */
  kph: Int;
}

export interface WireFielder { id: string; role: FielderRole; x: Int; z: Int }   // cm, physics frame
export interface WireField { id: string; f: WireFielder[] }                         // exactly eleven

/** A NormalizedSwing on the wire. A leave is `null`, never a swing. */
export interface WireSwing {
  k: SwingKind;
  /** startT × 10^4: release-relative, calibration already applied (may be negative). */
  t: Int;
  /** directionDeg × 10, −1800..1800 (batter's own frame). */
  dir: Int;
  /** power × 1000, 0..1000; a defend is exactly 200 (DEFEND_POWER). */
  pow: Int;
  /** elevation × 1000, 0..1000; a defend is 0. */
  elev: Int;
  fw: Footwork;
}
```

Codec rules for `src/sim/wire.ts`, a pure module owned by the sim-integrity agent:
- `encode*` rounds with `Math.round(v × scale)`.
- `decode*` divides by the scale and refuses non-safe integers and out-of-range values.
- `decodeSwing(encodeSwing(s))` must deep-equal `s` for every swing `normalizeGesture` can produce. A unit test proves it over a generated corpus.

## 2. Over definition and commitment [S4]

```ts
/** One delivery: what the batter will face (released to the client only when it is bowled). */
export interface ChallengeBall {
  plan: WirePlan;
  /** Physics seed of this ball, stored (never re-derived: ballSeed() may change between versions). 32 hex. */
  seed: string;
  /**
   * First 16 bytes (hex) of SHA-256 over the flight's defining doubles (release p and v, bounce t and p,
   * idealContactT, stumpsT, wouldHitStumps, sample count, last sample p and v) as little-endian Float64.
   * The client computes the flight and must match this before bowling (VERIFICATION.md §4, item 3).
   */
  flight: string;
}

export interface RankedRules {
  balls: 6;
  /** Super Over: the second wicket ends the innings; the remaining balls are dead. */
  wickets: 2;
  /** Pinned for every attempt. */
  assist: AssistLevel;
  /** Ranked attempts resolve with tierToleranceMs = 0 on every device (owner decision O2). */
  allowance: 'zero';
  /** Left-handers face the exact mirror image (the bowler's arm mirrored), so striker-frame physics is identical. */
  handedness: 'mirror';
  /** The ranking order. It is shown before play; completion times stay concealed until the reveal. */
  rank: readonly ['runs_desc', 'wickets_asc', 'completion_asc'];
}

/**
 * Everything needed to play and verify the over, in the RIGHT-HANDED striker's frame. Participant-independent:
 * a left-handed participant plays it with `mirrorArm(bowler)` and handedness 'left', which restores this frame.
 */
export interface OverDefinition {
  contract: typeof CHALLENGE_CONTRACT_VERSION;
  /** The PRACTICE_SIM_VERSION every attempt is played and verified with. Never changes for this over. */
  sim: number;
  /** The golden physics digest of that sim version (VERIFICATION.md §4). */
  physics: string;
  source: 'random' | 'curated' | 'same_over' | 'clip';
  difficulty: Difficulty;
  conditions: PitchCondition;
  ball: BallCondition;
  bowler: BowlerProfile;
  field: WireField;
  balls: [ChallengeBall, ChallengeBall, ChallengeBall, ChallengeBall, ChallengeBall, ChallengeBall];
  rules: RankedRules;
}

/**
 * Commit–reveal. commit = hex(SHA-256(canonicalJson(definition) + '|' + salt)), with 128-bit salt and canonicalJson as
 * in src/engine/canonical.ts (sorted keys, integers only). sig = ECDSA P-256 (SIGNING_KEY) over
 * `vc-over|1|<scopeId>|<sim>|<commit>`; public keys at GET /v1/keys.
 */
export interface OverCommitment { scopeId: string; sim: number; commit: string; sig: string; keyId: string }

/** Given to a player after their own attempt, and to every participant at the reveal. */
export interface OverReveal { definition: OverDefinition; salt: string }
```

The brief's list of over fields maps onto the definition like this:

| Brief field | Where it lives |
| --- | --- |
| Seed | `balls[i].seed` |
| Bowler | `bowler` |
| Release | Derived by the physics, pinned by `balls[i].flight` |
| Pace | `plan.kph` |
| Line and length | `plan.line`, `plan.len` |
| Swing, seam or spin | `plan.v`, plus `ball` (age) and `conditions` |
| Pitch | `conditions` |
| Bounce | Derived, pinned by `flight` |
| Field | `field` |
| Difficulty and assistance | `difficulty`, `rules.assist` |

## 3. Challenges, attempts, verdicts and the reveal [S4]

```ts
export type DeadlineHours = 6 | 12 | 24 | 48;
export type ChallengeState = 'setting' | 'open' | 'revealed' | 'expired' | 'void';
export type SeatState = 'joined' | 'playing' | 'finished' | 'dnp';

export interface CreateChallengeRequest {
  /** Opponents: 1 (a duel) … 10 (a group). */
  seats: number;
  /** Default 24. */
  deadlineHours: DeadlineHours;
  /** Omitted: random pitch. */
  conditions?: PitchCondition;
  /** Default 'club'. */
  difficulty?: Difficulty;
  /** Default 'play'. */
  assist?: AssistLevel;
  rematchOf?: string;
  /** With rematchOf: replay the same definition. */
  sameOver?: boolean;
  seriesId?: string;
}

/** The setter plays first (the target must exist and be server-verified before any link is issued). */
export interface CreateChallengeResponse { challengeId: string; attemptId: string; commitment: OverCommitment }

/** Public preview (GET /v2/c/:code, no auth): enough to understand the challenge in seconds, nothing private. */
export interface ChallengePreview {
  code: string;
  state: 'open' | 'full' | 'ended';
  setter: { alias: string; avatar: AvatarSpec };
  /** To win: more runs; equal runs → fewer wickets; still equal → whoever finished first (rule shown, times hidden). */
  target: { runs: number; wickets: number };
  format: { balls: 6; wickets: 2 };
  conditions: PitchCondition;
  /** As seen by a right-handed batter; a left-hander is told they face the mirror image. */
  bowler: Pick<BowlerProfile, 'family' | 'paceBand' | 'spinType' | 'arm'>;
  assist: AssistLevel;
  /** ISO, minute resolution. */
  deadlineAt: string;
  seatsLeft: number;
  sim: number;
}

/** Shared by Sealed Over and Today's Over attempts (one engine: backend/src/over/attempt.ts). */
export interface AttemptHeader {
  attemptId: string;
  scope: { kind: 'challenge'; challengeId: string } | { kind: 'today'; dayId: string };
  sim: number;
  physics: string;
  commitment: OverCommitment;
  /** The participant's own frame: the canonical bowler with the arm mirrored for a left-hander. */
  bowler: BowlerProfile;
  field: WireField;
  conditions: PitchCondition;
  ball: BallCondition;
  rules: RankedRules;
  handedness: Handedness;
  startedAt: string;
  deadlineAt: string;
  issued: number;
  answered: number;
}

export interface BallIssue {
  attemptId: string;
  index: 0 | 1 | 2 | 3 | 4 | 5;
  plan: WirePlan;
  seed: string;
  flight: string;
  /** bt2.<kid>.<{a,i,t,r,v}>.<mac>, single use. */
  token: string;
  issuedAt: string;
  liveForMs: number;
  lateForMs: number;
}

export type QualityTierId = 'premium' | 'balanced' | 'classic';
export type PointerKind = 'touch' | 'mouse' | 'pen' | 'keyboard';

export interface BallAnswer {
  token: string;
  index: number;
  decision: Decision;
  /** Null for a leave; must agree with decision. */
  swing: WireSwing | null;
  /** The client's own resolution, for mismatch detection only (never trusted). */
  client: {
    runs: number;
    dismissal: Dismissal | null;
    /** resultDigest (VERIFICATION.md §4, item 1). */
    result: string;
    /** calibrationMs × 10. */
    calibration: Int;
    tier: QualityTierId;
    pointer: PointerKind;
  };
}

/** The official result of one ball (integers for everything numeric). */
export interface BallVerdict {
  index: number;
  runs: 0 | 1 | 2 | 3 | 4 | 6;
  dismissal: Dismissal | null;
  contact: ContactKind;
  region: FieldZone | 'straight' | 'behind' | null;
  /** End bearing × 10 and end distance in cm, for the shot map. */
  endBearing: Int | null;
  endCm: Int | null;
  /** Signed timing error × 10 (ms; + late), null for a leave. */
  timingErr: Int | null;
  result: string;
  /** The client's digest matched. */
  match: boolean;
  /** Answered after the live window. */
  late: boolean;
  /** 'leave' when the ball settled without an answer (expired, invalid ×3, deadline). */
  settled: 'leave' | null;
  inningsDone: boolean;
  total: { runs: number; wickets: number };
}

export interface RevealedAttempt {
  playerId: string;
  alias: string;
  role: 'setter' | 'player';
  status: 'finished' | 'dnp';
  rank: number | null;
  runs: number;
  wickets: number;
  handedness: Handedness;
  /** Six entries; null for a ball never faced (dead after the second wicket, or DNP). */
  balls: Array<{ decision: Decision; swing: WireSwing | null; verdict: Omit<BallVerdict, 'match' | 'inningsDone' | 'total'> } | null>;
  tier: QualityTierId;
  pointer: PointerKind;
}

export interface ChallengeReveal {
  challengeId: string;
  over: OverReveal;
  attempts: RevealedAttempt[];
  /** Set only when a tie-break decided an order: who, and by which rule (never the times themselves). */
  tieBreak: { players: string[]; by: 'wickets' | 'completion' } | null;
  /** The ball that decided first against second (LIFECYCLE.md §1.6). */
  decisive: { index: number; winner: string; versus: string } | null;
  rematch: RematchOffer | null;
  series: SeriesView | null;
  rivalry: RivalryLine | null;
}

export interface RematchOffer { challengeId: string; fromPlayerId: string; sameOver: boolean; expiresAt: string }
```

## 4. Today's Over [S5]

```ts
export interface TodaysOver {
  /** The global id: the IST calendar day (owner decision O3). */
  dayId: string;
  /** Curation revision before opening; immutable once open. */
  rev: number;
  sim: number;
  commitment: OverCommitment;
  conditions: PitchCondition;
  bowler: Pick<BowlerProfile, 'family' | 'paceBand' | 'spinType' | 'arm'>;
  /** ISO; the UI shows a clock time in the player's timezone, never a countdown (Stage 5 rules). */
  resetsAt: string;
  mine: { state: 'available' | 'in_progress' | 'finished' | 'missed'; attemptId: string | null; runs?: number; wickets?: number };
  /** After the ranked attempt only: the full over for unlimited offline practice. */
  reveal: OverReveal | null;
}

export type BoardScope = 'friends' | 'group' | 'city' | 'national';
export interface BoardView {
  dayId: string;
  scope: BoardScope;
  /** False when the privacy threshold is not met: no entries, at most your own percentile. */
  shown: boolean;
  entries: Array<{ rank: number; alias: string | null /* null unless the player opted into public boards */; runs: number; wickets: number; you: boolean }>;
  /** Only when at least 20 ranked players. */
  yourPercentile: number | null;
  total: number;
}
```

## 5. Rivalries, series, tournaments and clips [S4–S6]

```ts
/** [S4] One per pair of players; from 1v1 Sealed Overs (series games included). */
export interface RivalryView {
  rival: { playerId: string; alias: string; avatar: AvatarSpec };
  record: { wins: number; losses: number; ties: number };
  /** Newest last; at most five. */
  last5: Array<'W' | 'L' | 'T'>;
  streak: { holder: 'you' | 'rival'; length: number } | null;
  bestChase: { by: 'you' | 'rival'; runs: number; challengeId: string } | null;
  closest: { margin: number; challengeId: string } | null;
  /** At most three, newest first. */
  decisive: Array<{ challengeId: string; index: number; fact: DecisiveFact }>;
  /** Your best and their best conditions (≥ 2 games). */
  preferred: { you: PitchCondition | null; rival: PitchCondition | null };
  series: SeriesView | null;
  pendingRematch: RematchOffer | null;
}

export type DecisiveFact = 'six_vs_wicket' | 'boundary_vs_dot' | 'survived_vs_out' | 'runs_gap' | 'tie_break';
export interface RivalryLine { kind: 'leads' | 'trails' | 'level'; you: number; rival: number; alias: string }

/** [S4] Optional best-of-3 or best-of-5 between two players. */
export interface SeriesView {
  seriesId: string;
  bestOf: 3 | 5;
  you: number;
  rival: number;
  ties: number;
  /** 1-based. */
  game: number;
  state: 'active' | 'won' | 'lost' | 'shared' | 'abandoned';
  nextSetter: 'you' | 'rival';
}

/** [S6] Quiet group tournaments for 3–10 players. */
export type TournamentFormat = 'league' | 'knockout';
/** Copy-only templates over the two formats. */
export type TournamentTemplate = 'one_over_league' | 'knockout_cup' | 'weekend_series' | 'alumni' | 'friends_championship' | 'office_family';
export interface TournamentView {
  tournamentId: string;
  name: string;
  template: TournamentTemplate;
  format: TournamentFormat;
  members: Array<{ playerId: string; alias: string; seed: number | null }>;
  state: 'gathering' | 'running' | 'complete' | 'cancelled';
  startsAt: string;
  rounds: Array<{ index: number; challengeId: string | null; opensAt: string; closesAt: string; revealedAt: string | null }>;
  table: Array<{ playerId: string; points: number; runs: number; played: number; dnp: number; rank: number }> | null;
  bracket: Array<{ round: number; ties: Array<{ a: string | null; b: string | null; challengeId: string | null; winner: string | null }> }> | null;
  final: { winner: string; ranking: string[]; bestSix: ClipRef | null; bestDefence: ClipRef | null } | null;
}

/** [S6] A playable moment: the exact ball (or over) behind a highlight. */
export type MomentKind = 'last_ball_win' | 'six_under_pressure' | 'perfect_yorker' | 'edge_or_close_call' | 'collapse_and_recovery' | 'impossible_defence' | 'group_winning_ball';
export interface ClipRef { code: string; challengeId: string | null; dayId: string | null; index: number; kind: MomentKind }
export interface ClipPublic {
  code: string;
  kind: MomentKind;
  /** Score and requirement at the moment (from the verified record). */
  context: { runs: number; wickets: number; ballsLeft: number; needed: number | null };
  /** The sharer's alias; other players' aliases only with their consent. */
  by: string | null;
  /** The exact delivery, playable unranked. */
  ball: { definition: Omit<OverDefinition, 'balls'>; delivery: ChallengeBall };
  /** Whether "play the whole over" is offered (the sharer allowed it). */
  overPlayable: boolean;
}
```

## 6. Home action, rhythm, Coach Ball and notifications

```ts
// src/contracts/growth.ts (proposed) — ROOT-OWNED

/** [S4–S5] The single contextual primary action on home (LIFECYCLE.md §9; pure, deterministic). */
export type HomeAction =
  | { kind: 'your_turn'; challengeId: string; deadlineAt: string }
  | { kind: 'reveal_result'; challengeId: string }
  | { kind: 'continue_rivalry'; rivalId: string; reason: 'rematch_waiting' | 'series_game' | 'recent'; challengeId: string | null }
  | { kind: 'play_todays_over'; dayId: string };

export interface HomeInputs {
  nowMs: number;
  /** Not yet played, deadline still ahead. */
  turns: Array<{ challengeId: string; deadlineMs: number; createdMs: number; rivalId: string | null; seriesId: string | null }>;
  reveals: Array<{ challengeId: string; revealedMs: number; viewed: boolean }>;
  rivals: Array<{ rivalId: string; lastPlayedMs: number }>;
  today: { dayId: string; available: boolean; played: boolean } | null;
}
export type HomeActionFn = (i: HomeInputs) => HomeAction | null; // null → Practice is the primary

/** [S5] A recovery-friendly rhythm (no punishment for a missed day). */
export interface RhythmInputs {
  /** Local calendar days with at least one meaningful over (six balls). */
  playedDays: readonly string[];
  /** Local YYYY-MM-DD. */
  today: string;
}
export interface Rhythm {
  /** Unbroken span of played or covered days ending today or yesterday. */
  runDays: number;
  /** One automatic grace day per ISO week (Monday first). */
  graceUsedThisWeek: boolean;
  week: Array<{ day: string; state: 'played' | 'grace' | 'missed' | 'today' | 'future' }>;
  daysThisWeek: number;
  totalDays: number;
  bestRun: number;
}

/** [S5] Today's Personal Coach Ball, chosen on the device from local evidence (never sent). */
export type WeaknessId = 'late_inswing_defence' | 'short_ball_reaction' | 'off_spin_reading' | 'front_foot_timing' | 'off_side_placement' | 'lofted_shot_risk' | 'yorker_survival';
export interface CoachBallPick {
  day: string;
  weakness: WeaknessId;
  /** The exact ball, from a real DeliveryRecord the player failed. */
  recordKey: string;
  why: { failures: number; of: number; meanTimingMs: number | null };
  /** Shown only when the evidence threshold is met (LIFECYCLE.md §7). */
  progress: { before: number; after: number; nBefore: number; nAfter: number } | null;
}

/** [S5–S6] Notification kinds (NOTIFICATIONS.md). */
export type GrowthNotifyKind = 'your_turn' | 'reveal_ready' | 'rematch_requested' | 'series_game' | 'tournament_closing' | 'tournament_digest' | 'nudge' | 'cricket_moment';
export interface NotifyPrefsV2 {
  enabled: boolean;
  /** IANA zone from the device, e.g. 'Asia/Kolkata'. */
  timeZone: string;
  /** HH:MM local; null = none. */
  quietHours: { start: string; end: string } | null;
  kinds: Record<GrowthNotifyKind, boolean>;
  /** Local hour for the once-a-day group digest. */
  digestHour: number;
}

/** Feature flags (MIGRATION.md §2): server-provided, with client defaults; every one is off until its stage opens. */
export type GrowthFlag =
  | 'growth.sealed_over' | 'growth.rivalries' | 'growth.series' | 'growth.home_v2'
  | 'growth.todays_over' | 'growth.coach_ball' | 'growth.rhythm' | 'growth.notifications_v2'
  | 'growth.tournaments' | 'growth.clips' | 'growth.publishing' | 'growth.anon_counters'
  | 'legacy.sealed_six' | 'legacy.daily_six' | 'legacy.cups' | 'legacy.rooms' | 'legacy.top100' | 'legacy.youtube';
export interface ClientConfig {
  flags: Record<GrowthFlag, boolean>;
  sims: { current: number; supported: number[] };
  minClient: { android: number; web: string };
}
```

## 7. API v2 route map [S4–S6]

The `/v1` auth, profile, push, report and block routes stay as they are. The new resources live under `/v2`. Rules for every mutation:
- an `Idempotency-Key` header (a UUID);
- JSON bodies of 4 KB or less;
- unknown fields refused;
- server timestamps only;
- stable error codes, from the existing `ApiErrorCode` plus `already_answered`, `full`, `ended` and `blocked`.

```ts
export interface ApiRoutesV2 {
  'GET /v2/config': [void, ClientConfig];
  // [S4] Sealed Over
  'POST /v2/challenges': [CreateChallengeRequest, CreateChallengeResponse];
  'GET /v2/challenges/:id': [void, ChallengeView];               // participant view (state, seats, my attempt; reveal once revealed)
  'POST /v2/challenges/:id/link': [void, { code: string; url: string }];       // after the setter finished; idempotent
  'POST /v2/challenges/:id/revoke': [void, { ok: true }];                      // setter, before anyone joins: stop new joins
  'GET /v2/c/:code': [void, ChallengePreview];                                 // public, rate-limited
  'POST /v2/c/:code/join': [{ playNow: boolean }, { challengeId: string; attemptId: string }];
  'POST /v2/challenges/:id/rematch': [{ sameOver: boolean; bestOf?: 3 | 5 }, CreateChallengeResponse];
  'GET /v2/challenges/:id/reveal': [void, ChallengeReveal];
  // [S4] Attempts (Sealed Over and Today's Over share these)
  'GET /v2/attempts/:id': [void, AttemptHeader];
  'POST /v2/attempts/:id/bowl': [{ index: number }, BallIssue];               // returns the same ball if already issued
  'POST /v2/attempts/:id/swing': [BallAnswer, BallVerdict];
  // [S4] Rivalries
  'GET /v2/rivalries': [void, RivalryView[]];
  'GET /v2/rivalries/:playerId': [void, RivalryView];
  // [S4] Web-to-app continuation without tokens in URLs (LINKS.md §8)
  'POST /v2/claims': [void, { code: string; expiresAt: string }];             // shown in the browser, typed in the app
  'POST /v2/claims/redeem': [{ code: string }, { ok: true }];
  // [S5] Today's Over
  'GET /v2/today': [void, TodaysOver];
  'POST /v2/today/attempt': [void, { attemptId: string }];
  'GET /v2/today/boards/:scope': [{ groupId?: string }, BoardView];
  'GET /v2/rhythm': [void, { playedDays: string[] }];                         // server half of the rhythm (dates only)
  'POST /v2/rhythm': [{ playedDays: string[] }, { ok: true }];                // device half (Practice), dates only
  // [S5–S6] Notifications
  'GET /v2/notify': [void, NotifyPrefsV2];
  'POST /v2/notify': [NotifyPrefsV2, NotifyPrefsV2];
  // [S6] Tournaments
  'POST /v2/tournaments': [{ name: string; template: TournamentTemplate; format: TournamentFormat; maxPlayers: number; rounds: number; pace: 'sprint' | 'daily' | 'weekend' }, { tournamentId: string; code: string; url: string }];
  'GET /v2/tournaments/:id': [void, TournamentView];
  'GET /v2/g/:code': [void, { name: string; template: TournamentTemplate; members: number; startsAt: string; state: TournamentView['state'] }];
  'POST /v2/g/:code/join': [void, { tournamentId: string }];
  'POST /v2/tournaments/:id/nudge/:playerId': [void, { ok: true }];           // private reminder, capped
  // [S6] Clips and the share cap
  'POST /v2/clips': [{ challengeId?: string; dayId?: string; index: number; kind: MomentKind; overPlayable: boolean }, ClipRef];
  'GET /v2/b/:code': [void, ClipPublic];
  'POST /v2/moments': [{ scopeId: string; moment: 'invite' | 'reminder' | 'reveal' | 'final' }, { allowed: boolean }];
  // Anonymous milestone counters (ANALYTICS.md, "Three sources" and §1; owner/legal decision O4)
  'POST /v2/m': [{ events: AnonCounter[] }, { ok: true }];
}

export interface ChallengeView {
  challenge: {
    id: string;
    state: ChallengeState;
    seats: number;
    joined: number;
    finished: number;
    deadlineAt: string;
    target: { runs: number; wickets: number } | null;
    commitment: OverCommitment;
    rules: RankedRules;
  };
  me: { role: 'setter' | 'player'; seat: SeatState; attemptId: string | null };
  reveal: ChallengeReveal | null;
}
export interface AnonCounter {
  e: string;          // closed vocabulary (ANALYTICS.md §1)
  c?: string;         // cohort day YYYY-MM-DD (first-open day)
  p?: 'web' | 'pwa' | 'android';
  s?: 'organic' | 'challenge' | 'today' | 'clip' | 'tournament';
  b?: string;         // closed bucket value
}
```

## 8. Ids [S4–S6]

These follow `src/net/shared/ids.ts`: a one-letter kind and 128 random bits in lowercase base32.

| Kind | Format | Notes |
| --- | --- | --- |
| Challenge | `o` + 26 | Random |
| Attempt | `a` + 26 | Random for challenges. Today's Over: base32 of HMAC(`TOKEN_KEYS` purpose `attempt`, `dayId|uid`) truncated to 128 bits, so a player has exactly one per day and the id reveals nothing. |
| Tournament | `t` + 26 | |
| Series | `y` + 26 | |
| Challenge link code | 10 base32 (50 bits) | As `invite_codes` |
| Tournament link code | 10 base32 | |
| Clip code | `[a-z0-9]{8}` | As highlight codes |
| Claim code | 8 base32 (40 bits), shown as `XXXX-XXXX` | 10 minutes, single use |

## 9. Versioning and migration rules [S4]

1. **Two versions, never mixed up.**
   - `CHALLENGE_CONTRACT_VERSION` is the shape. Bump it only when you add or remove fields, and keep readers for one older version.
   - `sim` (`PRACTICE_SIM_VERSION`) is the outcome physics. Bump it on any rule or physics change that can alter a replayed outcome (practice.ts already says so). Golden vectors enforce this.
2. **Pinned for life.** A challenge, a series game and a Today's Over day keep the `sim` they were created with until they are revealed and archived. Every attempt in them is played and verified with it. Versions are never mixed within one challenge.
3. **Frozen bundles.**
   - When `sim` changes after launch, `scripts/freeze-sim.mjs <N>` copies the outgoing physics into `src/sim-frozen/v<N>/`. It includes `src/physics/**`, the used parts of `src/practice/game/overs.ts` and `src/engine/prng.ts`/`sha256.ts`, with rewritten imports, and it is never edited afterwards.
   - `src/sim/registry.ts` maps each version to its bundle and golden digest.
   - The Worker bundles every version that still has a live scope (about 25 KB gzip each).
   - The web app lazy-loads frozen chunks.
   - The Android build carries the current version and the two previous ones.
4. **Clients that cannot play.**
   - A client without the pinned version is refused at attempt start (`version_mismatch`). It offers "Update the app", or "Play in the browser"; the web always carries every live version.
   - The server issues new scopes with `sim = current`. A new version becomes current only once 95% of active clients report supporting it (`x-vande-sims` request header).
5. **Voiding a version** after a serious bug or exploit (an operator action, audited):
   - Not-yet-started attempts are re-pinned to the new version, and recorded attempts are re-simulated from their stored inputs under it. Inputs are kept, so this is deterministic.
   - The reveal states "Results re-checked with updated physics".
   - Today's Over for that day becomes unranked.
6. **Before launch.** Nothing is live, so the expected 1 → 2 bump needs no frozen bundle: Stage 4 starts at whatever version is current.
7. **Unknown fields are refused everywhere** (strict decoding). Additions arrive behind a contract version.
