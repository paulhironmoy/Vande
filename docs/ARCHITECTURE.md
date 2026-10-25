# VANDE: Republic Under Pressure — Architecture & Conventions

Independent civic-strategy game. React 19 + TypeScript + Vite 8 + PixiJS 8 + IndexedDB + Capacitor 8.
Zero backend. Everything (simulation, opponents, persistence, sharing, daily challenge) runs locally.

This document is the contract between the parallel work packages. Read it fully before writing code.

## 1. Frozen contracts

* `src/engine/types.ts` — domain types. **Frozen.** Do not edit. If you need an additional type, define it in your own
  area (e.g. `src/map/localTypes.ts`) and mention it in your final report.
* `src/app/storeTypes.ts` — the Zustand store shape used by every screen. **Frozen** (implemented by the app-shell package).
* `src/styles/tokens.css` — design tokens. **Frozen** (additive proposals go in your report).
* This document.
* `src/lite/contracts.ts` — Lite twist, ledger, toughness and picture types (lead-owned, see §12).

Deliberate, additive change to `src/engine/types.ts` for Lite pictures: the optional `SimpleOption.label` and
`SimpleOption.visual` fields and the `OptionVisual` type. Nothing existing changed shape.

## 2. Work packages & file ownership (strict)

| Package | Owns (write access) |
| --- | --- |
| ENGINE | `src/engine/**` (except `types.ts`), `src/content/index.ts`, `src/content/schema/**`, `tests/unit/engine/**`, `tests/unit/fixtures/**` |
| CONTENT-1/2/3 | `src/content/scenarios/examination-crisis.json` / `electoral-dispute.json` / `information-storm.json` |
| MAP | `src/map/**` |
| APP-SHELL | `src/main.tsx`, `src/App.tsx`, `src/app/**` (except `storeTypes.ts`), `src/styles/base.css`, `src/styles/utilities.css`, `src/components/ui/**`, `src/audio/**`, `src/screens/Launch/**`, `src/screens/Intro/**`, `src/screens/Home/**`, `src/screens/Settings/**`, `src/screens/About/**`, `tests/unit/app/**` |
| PLAY-UI | `src/screens/Play/**`, `src/components/play/**`, `tests/unit/play/**` |
| RESULTS-UI | `src/screens/OpponentSelect/**`, `src/screens/Briefing/**`, `src/screens/ChapterResult/**`, `src/screens/FinalResult/**`, `src/screens/Daily/**`, `src/screens/Challenge/**`, `src/screens/Republic/**`, `src/screens/History/**`, `src/components/results/**`, `src/components/opponents/**`, `src/components/republic/**`, `src/share/**`, `tests/unit/share/**` |
| PLATFORM | `public/**`, `src/components/brand/**`, `src/pwa/**`, `scripts/**`, `android/**`, `capacitor.config.ts`, `docs/RELEASE.md`, `docs/ROLLBACK.md`, `docs/ANDROID.md`, `docs/PRIVACY.md` |
| E2E (later) | `tests/e2e/**` |

Rules for every package:

* Never run `npm install`/`npm uninstall` (the lockfile is shared). If you need a package, say so in your report.
* Never run `git commit`, `git add` or `git push`. The integrator commits.
* Never edit files you do not own. If you need a change elsewhere, describe it precisely in your report.
* Type-check your own files with `npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "src/<your-area>"` — the whole
  project will not compile until all packages land, so filter to your paths and make sure *yours* are clean.
* Import other packages through the contracts below. Where a module you depend on does not exist yet, code against the
  contract; do not create stubs inside someone else's area.
* Keep everything JSON-serialisable in state. No classes in state. No `Date` objects in state (use ISO strings or ticks).
* All user-visible copy is English, plain language, no jargon, no placeholder text (never "Lorem", "TODO", "Coming soon").
* No real individual, organisation, party, community or religion is named or implied. Opponents are behaviours.
  Human characters are fictional, named by role plus a first name (e.g. "Registrar Meenakshi", "Inspector Arjun").
* Protesters, students, citizens and communities are people. Abstract "bugs"/glyphs represent only fabricated evidence,
  manipulation, incitement, impersonation and hidden coordination — never people.

## 3. Engine API (`src/engine/index.ts`)

Pure, deterministic, side-effect free. `GameState` is plain data. 1 tick = 1 game second. Chapter duration = 180 ticks.

```ts
export * from './types';
// PRNG (sfc32 with 4×uint32 state). Serialisable.
export function hashString(s: string): number;                 // uint32
export function createRng(seed: number): RngState;
export function rngFloat(r: RngState): { value: number; next: RngState }; // [0,1)
export function rngInt(r: RngState, minInclusive: number, maxInclusive: number): { value: number; next: RngState };
export function newSeed(): number;                            // non-deterministic (crypto/Math.random); UI only

// Scenarios
export function getScenario(id: ScenarioId): Scenario;        // synchronous import of the JSON files
export function listScenarios(): Scenario[];                  // chapter order
export function validateScenario(json: unknown): { ok: boolean; errors: string[] };

// Lifecycle (all pure — return new state)
export function createGame(config: GameConfig, scenario: Scenario): GameState;   // status 'briefing'
export function reduce(state: GameState, action: PlayerAction, scenario: Scenario): GameState;
export function tick(state: GameState, scenario: Scenario, n?: number): GameState; // advances only while status === 'running'; sets 'ended' at duration

// Derived views
export function derivePulse(state: GameState): Pulse;
export function deriveMapState(state: GameState, scenario: Scenario, focus?: string): MapState;
export function evidenceActions(state: GameState, scenario: Scenario, evidenceId: string):
  { verb: EvidenceVerb; label: string; enabled: boolean; hint?: string; compareWith?: string }[];
export function confidenceWarning(state: GameState, scenario: Scenario, option: DecisionOption):
  { level: 'none' | 'caution' | 'warning'; text: string };
export function timeLeft(state: GameState): number;           // ticks

// Results
export function chapterScore(scores: Scores): number;         // balance-weighted 0..100
export function classifyOutcome(scores: Scores): RepublicOutcome;
export function computeChapterResult(state: GameState, scenario: Scenario): ChapterResult;
export function carryScores(prev: Scores): Scores;            // regress toward 50 (prev*0.6 + 50*0.4), used between chapters
export function computeCampaignResult(chapters: ChapterResult[], meta: { mode: GameMode; seed: number; difficulty: Difficulty; opponents: OpponentId[]; id: string; completedAt: string }): CampaignResult;
export function updateRepublic(prev: RepublicCondition, result: CampaignResult | ChapterResult): RepublicCondition;
export function describeCondition(rep: RepublicCondition): { label: string; summary: string }; // "Steady", "Strained"...

// Challenges & daily
export function encodeChallenge(spec: ChallengeSpec): string; // short, URL-safe, with checksum
export function decodeChallenge(code: string): ChallengeSpec | null;
export function getDailySpec(date: Date): DailySpec;          // local calendar day; deterministic
export function dateKey(date: Date): string;                  // YYYY-MM-DD local

// Metadata
export const OPPONENTS: Record<OpponentId, OpponentMeta>;
export const DIFFICULTY_META: Record<Difficulty, { label: string; description: string }>;
export const DEFAULT_OPPONENTS: OpponentId[];                 // ['exploiter','disinfo']
export const PACE_MS: Record<TimerPace, number>;              // standard 1000, relaxed 1500, extended 2000
```

Engine behaviour that the UI and tests rely on:

* `createGame` carries `config.carryScores` when present, otherwise `scenario.startingScores`. Opponent plays are scheduled
  deterministically from the seed at creation (`OpponentRuntime.schedule`), with difficulty scaling counts/intensity.
* `reduce({type:'start'})` → status `running`. `pause`/`resume` toggle status. `tick` is a no-op unless `running`.
* Each tick: scheduled events fire; opponent plays fire (and may be re-weighted by `memory` of recent player `ActionTag`s);
  decisions appear/expire (expired → `defaultOption`, `auto: true`); delayed effects apply when due; signals progress;
  district crowd/mood/services drift toward values implied by scores; `history` sampled every 5 ticks.
* `decide`: validates the pending decision, applies option effects, `falseAccusationEffects` when tag `accusation` and any
  `requiresEvidence` item has truth `false`/`misleading` and is not in player-state `manipulated` (i.e. the player acted on
  a false basis), `disproportionateEffects` when `proportionateIf` fails for tags `force`/`detention`/`suppressive`,
  marks `unverifiedBasis` when relied-on evidence is `unverified`/`unknown`. Sets `lastFeedback`. Opens `undo` when
  `undoTicks` set. Pushes the decision's `rightsMomentId` to `pendingRightsIds`.
* `evidence` verbs: `inspect` reveals metadata; if any `anomaly` the state becomes `manipulated` (when truth is false/
  misleading) else `unverified` stays. `compare` with an available `corroboratedBy` id → `resolvedState` (verified when an
  official/institution source corroborates, else corroborated); with a `contradictedBy` id → `manipulated` (false) or
  `unknown` (unknowable). `preserve` sets preserved (immune to destroy plays). `unresolved` toggles the marker.
* Score deltas are clamped to 0..100. False accusations always reduce `freedom` and `trust`. Disproportionate force always
  reduces `freedom` and `trust` and increases `stats.disproportionateActions`.
* Chapter ends when `tick >= duration` → status `ended` and any pending decisions auto-resolve.
* `chapterScore = clamp(round(mean - 0.35 * (mean - min)))`.
* `classifyOutcome`: resilient if min ≥ 55 and mean ≥ 68; else the dominant weakness: evidence lowest & < 45 → manipulated;
  economy lowest & < 45 → economically-disrupted; freedom high (≥ 60) and safety < 45 → free-fragile; safety ≥ 60 and
  (freedom < 50 or trust < 45) → order-without-trust; trust or grievance lowest → institutionally-weakened; fallback by
  weakest dimension mapping (freedom→order-without-trust, safety→free-fragile).
* Determinism: identical `GameConfig` + identical action sequence (same ticks) ⇒ deep-equal final state. Never read
  `Date`, `Math.random` or wall clock inside the engine (only `newSeed`).

## 4. The city (shared by all three scenarios)

One city, identical ids and positions in every scenario. Positions are normalised (x right, y down), designed for a 16:10 map.

| id | name | kind | x | y | institution |
| --- | --- | --- | --- | --- | --- |
| `campus` | University Quarter | campus | 0.18 | 0.30 | University Registrar |
| `hospital` | Civil Hospital | hospital | 0.58 | 0.12 | Civil Hospital |
| `civic` | Civic Square | civic | 0.50 | 0.44 | District Collectorate |
| `market` | Market Street | market | 0.80 | 0.34 | — |
| `records` | Records Office | records | 0.22 | 0.70 | Election Records Office |
| `transit` | Central Transit Hub | transit | 0.48 | 0.78 | Transit Authority |
| `media` | Press Enclave | media | 0.82 | 0.70 | Press Club |

Roads: `r-campus-civic`, `r-civic-market`, `r-civic-transit`, `r-transit-media`, `r-market-media`, `r-campus-records`,
`r-records-transit`, `r-civic-hospital`, `r-market-hospital` (ids are `r-<from>-<to>`).

## 5. Scenario authoring guide (CONTENT packages)

Each scenario is one JSON file conforming exactly to `Scenario` in `src/engine/types.ts`. Target counts:

* `duration`: 180. `startingScores`: around 55–65 each, reflecting the chapter's pressure (e.g. grievance 40 in ch1).
* 7 districts (copy the table above; baselines 0..1: crowd 0.05–0.4, trust 0.4–0.7, services 0.7–1).
* 10–12 evidence items: 6–8 organic (`availableAt` spread 4..150), 3–5 opponent-injected (`injectedBy`, no `availableAt`).
  Each false/misleading item must have at least one `anomaly` metadata row **or** a `contradictedBy` source (preferably
  both) so a careful player can expose it. True items should have `corroboratedBy` pointing at an official/institution
  source that arrives at some point. Mark 2–3 items `perishable: true` (CCTV, server logs, ballots). `resolutionNote`
  explains plainly what verification showed.
* 9–11 decisions: 6–8 organic (`triggerAt` 8..165, roughly every 20 ticks), 2–3 opponent bait decisions (no `triggerAt`;
  referenced by `opponentPlays` of kind `decision`). Each has 2–4 options with distinct philosophies: lawful proportionate
  response, dialogue/transparency, indiscriminate suppression (`disproportionate`/`suppressive`/`censorship`), wait.
  Suppression options must carry heavy `freedom`/`trust` costs and often delayed backlash; waiting too long must carry
  `safety`/`economy`/`grievance` costs. Use `requiresEvidence` on accusation/enforcement options and give them
  `falseAccusationEffects` (freedom −12..−18, trust −10..−16, evidence −8..−12). Use `proportionateIf` + `disproportionateEffects`
  for force (proportionate only when a violence flag is set). `expiresAfter` 20–35. `defaultOption` is the "wait" option.
  Use `undoTicks: 5` only on reversible communications/logistics, never on force, detention or accusations.
* 3 rights moments attached via `rightsMomentId` to decisions in the middle/late game. Plain-language, 3 options, one
  correct. `source` points at an official portal (e.g. `https://www.indiacode.nic.in/` for the Constitution of India,
  `https://main.sci.gov.in/` for Supreme Court judgments, `https://www.eci.gov.in/` for elections,
  `https://presscouncil.nic.in/` for press norms). `contentDate`: "2026-10-23".
* 10–14 events with `mapEffects` (crowd, mood, road, service, incident, signal, institution) so the map visibly changes.
  Incidents should depend on flags (e.g. `condition: { notFlag: 'grievance-acknowledged' }`).
* 12–16 opponent plays, ≥ 2 per opponent, windows inside 20..160, with `respondsTo` tags so opponents adapt
  (exploiter → `wait`; provocateur → `force`,`wait`; disinfo → `accusation`,`communication`; sabotage → `wait`,`service`;
  overreaction → `force`,`detention`,`suppressive`).
* Resolution rules: 4–6 each for resolved/unresolved/rightsProtected/rightsHarmed; 5–6 improvements (conditions on flags,
  stats are not available — use flags you set via options). Closing lines for good/mixed/poor.
* Flags are kebab-case strings. Reference only ids that exist in the same file. `defaultOption` must be an option id.
  `rightsMomentId` must exist in `rightsMoments`. `corroboratedBy`/`contradictedBy`/`unlocksEvidence` reference evidence ids.
  `target` of plays reference evidence/event/decision ids of the matching kind.

Pacing template (ticks): 0–10 opening crowd + 2 evidence + first decision (t≈8); 15–60 evidence every ~12 ticks,
decision every ~20; 60–120 escalation, manipulated evidence, bait decisions, first rights moment; 120–170 resolution
decisions (investigation outcome, communication, restore services); 170–180 closing events.

## 6. Store contract (`src/app/storeTypes.ts`, implemented in `src/app/store.ts`)

Screens read state with `useApp(selector)` and call actions from `useApp.getState()` or selectors. See the file.
Navigation is state-driven: `navigate(screen)` pushes a history entry; `back()` pops. The hardware/browser back button
and Capacitor's `backButton` both call `back()`. URL paths mirror screens (see `src/app/routes.ts`).

Game loop (`src/app/gameLoop.ts`): a single `setInterval` at 250 ms reads `performance.now()`, computes elapsed ticks
at `PACE_MS[settings.timerPace]` and calls `tickGame(n)` for all elapsed ticks (no cap below the chapter duration).
It pauses automatically on `visibilitychange` (hidden) and resumes on the player's explicit action. This design lets
Playwright's `page.clock.fastForward()` drive the game in tests.

## 7. Design language — "Civic Cinematic"

Tokens live in `src/styles/tokens.css`. Use them; never hard-code colours or durations.

* Surfaces: layered midnight/navy gradients, fine grid texture (`--texture-grid`), subtle grain (`--texture-grain`),
  edge illumination (`--edge-light` 1px inset top highlight), controlled glass only for floating sheets/cards
  (`--surface-glass` + `backdrop-filter` guarded by `@supports`). Depth via `--shadow-*` and glows `--glow-*`.
* Type: Manrope Variable (`--font-sans`), Noto Sans Devanagari (`--font-devanagari`) for the single Devanagari accent
  "वन्दे". Tabular numerals (`font-variant-numeric: tabular-nums`) for every score and timer. Minimum essential text
  size 14px (`--text-sm`). Body 16px. All sizes in `rem` so text scaling to 200% works. Line-height ≥ 1.4.
* Colour meaning: Freedom luminous blue, Safety teal, Trust violet-blue, Economy emerald, Legitimacy ice blue, danger
  crimson. Saffron/green only as 1–2px accents or small marks. Never a tricolour band.
* Motion: controls 150–220 ms (`--dur-control`), panels 250–450 ms (`--dur-panel`), spring only for direct
  manipulation (drag/tray). All animation respects `html[data-motion="reduced"]` and `prefers-reduced-motion`.
  Nothing blocks input; no fake loading.
* Component CSS: colocated CSS Modules (`X.module.css`). No global class names except in `base.css`/`utilities.css`.
* Touch targets ≥ 44×44 px (`--tap`). Visible focus (`--focus-ring`), keyboard operable, `aria-*` semantics, state never
  by colour alone (icon + label + colour). High contrast via `html[data-contrast="high"]`. Colour-blind safe variant via
  `html[data-cb="1"]`.
* Layouts: mobile first, no horizontal scroll (`overflow-x: clip` on `html`), safe-area insets (`env(safe-area-inset-*)`),
  one-thumb reach on mobile (primary controls in the lower 40%). Desktop (≥ 1024px): map ~62% left, right rail for
  evidence/decisions, status visible.

## 8. Test ids (`data-testid`) — stable contract for e2e

Launch `launch-screen`, `logo`. Intro `intro-screen`, `intro-next`, `intro-begin`. Home `home-screen`, `home-continue`,
`home-start-campaign`, `home-daily`, `home-republic`, `home-settings`, `home-history`, `home-personal-best`, `home-condition`.
Opponents `opponents-screen`, `opponent-card-<id>`, `opponent-toggle-<id>`, `difficulty-<id>`, `opponents-confirm`.
Briefing `briefing-screen`, `briefing-skip`, `briefing-start`. Play `play-screen`, `status-bar`, `timer`, `pulse`,
`pulse-values`, `map`, `map-district-<id>`, `evidence-tray-toggle`, `evidence-tray`, `evidence-card-<id>`,
`evidence-detail`, `evidence-action-<verb>`, `evidence-back`, `decision-card-<id>`, `decision-option-<optionId>`,
`confidence-warning`, `undo`, `pause`, `resume`, `feed`, `rights-moment`, `rights-option-<id>`, `rights-continue`.
Chapter result `chapter-result-screen`, `chapter-score`, `chapter-continue`. Final `final-result-screen`, `final-score`,
`final-outcome`, `final-replay`, `final-challenge`, `final-home`, `share-card-preview`, `share-button`, `copy-link`.
Daily `daily-screen`, `daily-play`, `daily-date`. Challenge `challenge-screen`, `challenge-accept`. Republic
`republic-screen`, `republic-reset`, `republic-export`, `republic-delete`. History `history-screen`, `history-entry-<id>`.
Settings `settings-screen`, `setting-<key>` (key = Settings field). About `about-screen`. `toast`, `update-banner`.

**Lite** (`/lite`; new in the incentives upgrade marked ★):

* Screen `lite-screen` with `data-step` = `start`, `dare-landing`, `reply-landing`, `rematch`★, `rematch-result`★,
  `begin`, `clue`, `clue-result`, `decision`, `feedback`, `rights`, `rights-result`, `twist`★, `twist-result`★,
  `ended`; `data-dare="true"` while a dare is being played.
* Run `lite-start`, `lite-next`, `lite-check`, `lite-skip-clue`, `lite-option-<optionId>` (`data-visual="true"` on a
  picture card), `lite-rights-<optionId>`, `lite-points`, `lite-reveal`, `lite-reveal-<optionId>` (`data-best`,
  `data-mine`), `lite-dare`, `lite-tier`★ (`data-tier` = `tricky` / `tough` / `boss`), `lite-insight`★,
  `lite-insight-gain`★.
* Result `lite-result`, `lite-score` (`data-value`), `lite-result-insight`★ (`data-value`), `lite-challenge`,
  `lite-again`, `lite-home`, `how-points-result`★.
* How points work★ `how-points-open` (start screen, HUD, dare and reply landings), `how-points-sheet`,
  `how-points-<rule>` with rule = `move`, `clue-bonus`, `streak`, `clues`, `fair-play`, `end`, `insight`, `no-loss`,
  `helper`, `challenger`, `sharing`.
* Start stats `helper-stats`, `challenger-stats`★.
* Dare landing and the friend's answer `dare-countdown`, `dare-hint-reveal`, `dare-hint`, `dare-accept`,
  `dare-result` (`data-win`), `dare-first-answer`★, `trade-locked`★, `twist-start`★, `dare-reply`,
  `challenger-award`★, `dare-pass`, `dare-full`.
* Twist and rematch questions★ (`TwistQuestion`): `twist-question` / `rematch-question` (`data-twist` = twist id,
  `data-answered`), `twist-option-<a–d>` / `rematch-option-<a–d>`, `twist-result` / `rematch-result`
  (`data-right`), `twist-actions`.
* Dare sheet `dare-sheet`, `dare-slot-<1–3>`, `dare-incentive`, `dare-preview`, `dare-hint-none`, `dare-hint-<0–2>`,
  `dare-share`, `dare-share-<channel>`, `dare-share-copy` (channel = `whatsapp`, `telegram`, `x`, `sms`, `email`).
* Reply sheet `reply-sheet`, `reply-lead`★, `reply-countdown`, `reply-twist`★, `reply-share`,
  `reply-share-<channel>`, `reply-share-copy`.
* Reply landing `reply-twist`★, `reply-award`, `reply-award-note`★, `helper-stats`, `rematch-offer`★,
  `rematch-countdown`★, `rematch-accept`★, `rematch-verdict`★, `reply-dare-more`, `lite-start`, `how-points-open`.
* Challenge sheet `lite-share-sheet`, `lite-share`, `lite-share-<channel>`, `lite-share-copy`, `lite-share-save`,
  `lite-share-preview`, `lite-share-code`, `lite-share-copy-code`.
* Pictures carry `data-pictogram="<actor>.<action>.<object>"` on the decorative pictogram and `data-visual="true"` on
  the question's card row.

## 9. URLs

`/` launch → home; `/intro`, `/home`, `/opponents`, `/briefing`, `/play`, `/chapter`, `/result`, `/daily`, `/republic`,
`/history`, `/settings`, `/about/<page>`, `/c/<code>` challenge. Query `?c=<code>` is also accepted (robust on any static
host). `?screen=daily` opens the daily screen (PWA shortcut). `BASE_PATH` (e.g. `/Vande/`) prefixes all of these.
Lite: `/lite`, `/lite/<L1 code>` friend challenge, `/lite/dare/<I1 code>` dare, `/lite/reply/<R1 or R2 code>` reply
and rematch (§12).

## 10. Brand component contract (`src/components/brand/Logo.tsx`)

```ts
export function Logo(props: { size?: number; animated?: boolean; variant?: 'dark' | 'light' | 'mono'; title?: string; className?: string }): JSX.Element;
export function Wordmark(props: { compact?: boolean; className?: string }): JSX.Element; // "VANDE" / "VANDE//REPUBLIC"
```

## 11. Simple play style (plain-language layer)

`Settings.playStyle` is `'simple'` (default for new players) or `'full'`. The simulation, seeds and challenge codes are
identical in both; only presentation and pacing change.

* Vocabulary for the UI lives in `src/app/simple.ts` (`useSimple()`, `pick()`, `SIMPLE_DIMENSIONS`, `SIMPLE_STATES`,
  `SIMPLE_VERBS`, `SIMPLE_OPPONENTS`, `SIMPLE_OUTCOMES`, `cityMood()`, `starsFor()`, `SIMPLE_UI`). Target reading level:
  a confident eight-year-old — sentences of at most 12 words, common words, no legal or policy jargon.
* Scenario copy carries an optional `simple` layer (see `SimpleDecision`, `SimpleEvidence`, `SimpleRightsMoment`,
  `SimpleScenario` in `src/engine/types.ts`, plus `simple` strings on events and resolution rules). The validator requires
  every option id to be covered when a decision or rights moment has a `simple` block. Screens always fall back to the
  full text when a `simple` field is missing.
* `Settings.autoPauseOnDecision` ("Wait for me", default on): `tickGame` pauses the clock whenever a new decision or
  rights moment appears and sets `autoPaused`; the store resumes automatically when the player answers. Switching play
  style through `setPlayStyle()` sets auto-pause (simple → on) and timer pace (simple → relaxed).
* `html[data-style="simple"]` enlarges tap targets, radii and the base font (settingsEffects adds a 6.25 % boost that
  composes with the text-size setting). Test ids never change between styles; a few exact strings are kept in both
  ("Educational content—not legal advice", "Simulated range — not real players", "I held the Republic together. Can you?").

## 12. Lite (gamified Chapter 1, `/lite`)

Lite plays `examination-crisis` one moment at a time in `src/screens/Lite/LitePlayScreen.tsx` (the run, dare landing
and friend flow) and `src/screens/Lite/ReplyLanding.tsx` (Helper award and rematch). Rules and numbers:
`docs/LITE-INCENTIVES.md`. Tiers: `docs/LITE-TOUGHNESS.md`. Pictures: `docs/LITE-VISUALS.md`. Prize prerequisites:
`docs/COMPETITION-READINESS.md`.

### Modules (`src/lite/`, all pure except the two storage stores)

| Module | Role |
| --- | --- |
| `points.ts` | Every player-visible number (`LITE_POINTS`, `INSIGHT`, `FRIEND_POINTS`), move evaluation (`evaluateMove`, `evaluateAll`, `bestOf`, `rankOf`), `insightFor`, and `pointsRules()` for the How points work card |
| `contracts.ts` | Shared types: twists and attempts, the R2 fields, the award ledger, the toughness manifest, picture plans |
| `toughness.ts` | `tierOf`, `closeCallMargin` from the committed manifest; the generator (`computeToughness`, `bestMoveKindSurvey`) |
| `replay.ts` | Pure replay of a Lite path, mirroring the store and the screen (`startLiteGame`, `advanceToPending`, `applyToken`, `replayDare`) |
| `twists.ts` | Twist draws matched to the dared move's kind, the one-attempt-per-device-per-dare store, rematch records (`vande:lite-twists`) |
| `twistValidate.ts` | Twist pool validator and coverage |
| `ledger.ts` | Helper and Challenger awards with caps, dedupe and upgrades (`vande:lite-awards`, migrated from `vande:lite-helper`) |
| `visuals.ts` | The all-or-none picture gate `visualPlanFor`, `validateVisuals`, `visualCoverage` |

### Content

`src/content/lite/twists.json` (+ `twists.schema.json`), `src/content/lite/toughness.json` (generated),
`src/content/lite/visualVocabulary.ts`, and the optional `label` / `visual` fields in the `simple` layer of
`examination-crisis.json` (schema in `src/content/schema/scenario.schema.json`).

### Components

`src/components/game/twist/TwistQuestion` (the friend's twist and the helper's rematch), `src/components/game/points/
HowPointsSheet`, `src/components/game/pictograms/Pictogram` (+ `glyphs.tsx`), the optional `visual` prop on
`src/components/game/cards/ActionCard`, and `onShared` plus the reply-mode copy on `src/components/game/dare/DareSheet`.

### Data flow

1. **Own run.** Each decision shows its tier (`tierOf`). On an answer the screen evaluates every move from the same
   state, scores the pick (`movePoints`, clue ×2, `streakMultiplier`) and adds Insight (`insightFor` with the reveal
   rank). The reveal ranks every move. `visualPlanFor` decides per question whether cards show pictures. The result
   shows the score, then Insight separately; `lite_completed` carries the picture/text counts.
2. **Dare.** The helper shares an `I1` link (`DareSheet`). Sending a dare earns nothing.
3. **Friend.** `/lite/dare/<code>` replays the helper's path (same seed, same moves), shows the tier without the
   multiplier, and records the friend's first answer with a fresh nonce (`recordDareAnswer`). After the reveal the
   friend may take one twist (`drawTwist`, `answerTwist`). The reply sheet builds an `R2` code. The first successful
   share calls `onShared`, which awards Challenger points (`awardChallenger`) and, with trade-results on, unlocks
   "who won".
4. **Helper.** `/lite/reply/<code>` awards Helper points once (`awardHelperReply`: caps, dedupe, upgrades). When the
   friend took a twist, the helper is dared back on it (`ensureRematch`, `answerRematch`). Rematches earn nothing.
5. **Network.** None of this calls the network. Analytics events fire only when analytics are configured and allowed.
   Verified dares (server-graded, signed replies) are specified as deployment-ready and off (`docs/BACKEND.md`).

### Scripts

`node scripts/lite-toughness.mjs [--check] [--survey]` regenerates or checks the toughness manifest and reports
best-move kinds for twist coverage. `node scripts/lite-visuals-report.mjs [ids…] [--all]` prints picture coverage and
tagging errors.
