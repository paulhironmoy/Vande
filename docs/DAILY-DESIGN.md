# Daily Quick Play, Progression and Growth — Design, Contracts and Ownership

Lead-owned document for the daily-retention upgrade. Read fully before editing. Nothing in this upgrade may be
deployed, pushed or purchased without explicit authorisation; implement deployment-ready code and docs only.

## 1. Player journey (target)

Home → **Play Today's Crisis** (one tap) → skippable cold open (3 lines, ≤ 8 s) → play (first decision at tick 3–5;
in Simple style the clock waits) → ~110 ticks ≈ 2–3 minutes in Simple → result: official (first completion) or
practice → Republic change + ethical feedback → spoiler-free fingerprint share → optional real community comparison
→ calendar/mosaic progress → reason to return tomorrow (new crisis at 00:00 UTC, "next crisis in Xh").

## 2. Contracts (frozen unless the lead changes them)

* `src/engine/types.ts` — `DailyId` (UTC `YYYY-MM-DD`), `DailyCrisis`, `DailySchedule`, `DailyResolution`,
  `FingerprintCode`, `DailyAttemptResult`, `DailyRecordV2`, `PassportState`, `DailyStats`, `ScoreBand`,
  `ScenarioId` now includes `` `daily:${dayId}` `` (`isDailyScenarioId`). Settings gained `communitySharing`,
  `analyticsOptOut`, `remindersEnabled`, `reminderHour`.
* `src/app/storeTypes.ts` — new screens `daily-open`, `calendar`, `passport`; `PendingIntent.dailyId/dailyResolution/
  official/friend`; `lastDaily`, `newAccomplishments`; `dailyV2`, `passport`, `installId`; actions
  `startDailyQuickPlay`, `startDailyById`, `beginDailyPlay`, `setCommunitySharing`, `setReminders`,
  `rotateInstallId`, `awardAccomplishments`.
* `src/app/flags.ts` — build-time feature flags and kill switches (community, analytics, reminders).
* `src/analytics/types.ts` — closed event and property dictionary; `src/analytics/index.ts` exports `track`,
  `setAnalyticsEnabled`, `analyticsStatus` (no-op until the analytics package replaces the internals).

### 2.1 Engine additions (Agent 2)

```ts
// src/engine/daily.ts (rewritten) + src/engine/dailyCompiler.ts + src/engine/dailyValidate.ts
export const DAILY_CONTENT_VERSION: string;
export function dailyIdFor(date: Date): DailyId;                 // UTC date
export function resolveDaily(dailyId: DailyId): DailyResolution; // deterministic; schedule.json pinned > rotation
export function dailyScenarioId(dayId: string): DailyScenarioId; // `daily:${dayId}`
export function compileDaily(day: DailyCrisis, resolution: DailyResolution): Scenario; // pure, validated
export function getDailyScenario(dailyId: DailyId): { scenario: Scenario; resolution: DailyResolution; day: DailyCrisis };
export function getScenario(id: ScenarioId): Scenario; // existing; MUST also resolve `daily:<dayId>` via the compiler (memoised)
export function computeFingerprint(state: GameState, scenario: Scenario): string; // one FingerprintCode per decision in id order of appearance
// ChapterResult gains `fingerprint: string` (set by computeChapterResult).
export function getDailySpec(date: Date): DailySpec; // keep for the legacy screen until the UI switches; may delegate to resolveDaily
export function nextDailyAt(dailyId: DailyId): string; // ISO of next 00:00 UTC
```

Fingerprint letters: for each resolved decision in order of appearance — `W` if expired/auto or the chosen option has
tag `wait`; `X` if the option has `disproportionate`, `suppressive` or `censorship`, or the decision was flagged
`disproportionate`/`falseAccusation`; `P` if `force`/`detention` with proportionality satisfied; `E` if
`investigative`/`legal-process`/`accusation` (verified); `S` if `service`/`relief`/`protect-assembly`/`protect-press`;
`D` for `dialogue`/`transparent`/`communication`. Priority when several apply: X > W > P > E > S > D.

Seed: `hashString(\`vande-daily-v2:${dailyId}:${dayId}:${day.version}\`)`. Difficulty `standard`. Opponents from the day.

### 2.2 Persistence (lead)

IndexedDB `vande` → **version 2**: new stores `dailyV2`, `passport`, `community` (stats cache keyed by dailyId),
`outbox` (pending submissions), plus `meta.installId`/`installIdRotatedAt`. Migration on first hydrate after upgrade:
every legacy `daily` record `{date, score, outcome, completedAt}` → `DailyRecordV2 { v:2, dailyId: date, official: {…,
fingerprint: 'legacy', contentVersion: 'v1', mode: 'full', scores: zeros} }`. Legacy records are never deleted.
Memory/localStorage fallback mirrors the same stores. `exportData()` includes everything; `deleteAllData()` clears all.

### 2.3 Official / practice semantics (lead, store `nextChapter`)

* An attempt starts when the player leaves the cold open (`beginDailyPlay`); `DailyRecordV2.startedAt` is set but
  nothing is locked. Abandoning (home, refresh without finishing, delete) never creates a result.
* Completion = the engine reaches `ended` and `nextChapter` runs for mode `daily`.
* If the record has no `official`, this completion becomes `official` (immutable: later completions never modify it).
  Otherwise the attempt is practice: `practice.attempts++`, `practice.best` replaced only when the score is higher.
* `PersonalBests.daily` tracks the best **official** score. History entries mark practice runs as "Practice".
* The result screen labels the run "Official result" or "Practice", and shows both when useful.

### 2.4 Community API (Agent 3 implements client + backend; lead keeps this contract)

Base URL `VITE_COMMUNITY_API_URL` (separate origin from the site, so the service worker never intercepts it).

```
POST /v1/daily/:dailyId/results
  body (≤ 2 KB JSON): { v: 1, dailyId, contentVersion, submissionId (32 hex = sha256(installId + ':' + dailyId)),
                        score (int 0..100), outcome, fingerprint (^[DESPXW]{1,12}$), mode ('simple'|'full'),
                        appVersion, platform ('web'|'android') }
  201 accepted | 200 duplicate (same submissionId) | 400 invalid | 403 origin | 413 too large | 429 rate limited
GET  /v1/daily/:dailyId/stats → DailyStats (ready=false and no percentages when count < MIN_COHORT (25))
GET  /v1/health → { ok: true, version }
```
Server stores only: submission_id (hash), daily_id, content_version, app_version, mode, score, band, outcome,
fingerprint, received_hour (UTC hour, no minutes). No IPs (rate-limit keys are salted hashes pruned within 24 h).
Retention: raw rows 180 days; aggregates indefinitely. The client queues submissions offline (`outbox`) and flushes
on reconnect; stats are cached with `asOf` and labelled as such. Everything degrades silently: no network feature
may block play, completion, persistence or sharing.

### 2.5 Analytics (Agent 3)

Adapter selection: no-op unless `flags.analyticsConfigured && !settings.analyticsOptOut && !DNT/GPC`. Distinct id =
`sha256(installId + ':' + monthKey)` (rotates monthly; enough for D1/D7 within a month, documented). Events and
property keys are restricted to `src/analytics/types.ts`; tests assert payload privacy.

## 3. Ownership (strict; shared files route through the lead)

| Owner | Files |
| --- | --- |
| Lead | `src/engine/types.ts`, `src/app/storeTypes.ts`, `src/app/store.ts`, `src/app/persistence.ts`, `src/app/routes.ts`, `src/app/flags.ts`, `src/app/gameLoop.ts`, `src/App.tsx`, `src/analytics/types.ts`, `package.json`, this doc, integration tests `tests/unit/integration/**`, e2e integration specs |
| Agent 1 (daily UX, progression) | `src/screens/Daily/**` (launcher + cold open `DailyOpenScreen`), `src/screens/Calendar/**`, `src/screens/Passport/**`, `src/screens/Home/**`, `src/components/daily/**` (incl. `DailyResultPanel` used by FinalResult), `src/components/progression/**`, `src/progression/**` (passport rules, calendar derivation), `src/reminders/**`, Settings screen sections for reminders/community/analytics toggles (`src/screens/Settings/**`), `src/screens/FinalResult/**` (daily branch), `tests/unit/progression/**`, `tests/e2e/daily-*.spec.ts` |
| Agent 2 (content engine) | `src/engine/daily.ts`, `src/engine/dailyCompiler.ts`, `src/engine/dailyValidate.ts`, `src/engine/scenario.ts` (daily resolution in getScenario), `src/engine/scoring.ts` (fingerprint only), `src/content/daily/**`, `src/content/index.ts`, `scripts/validate-daily.mjs`, `tests/unit/engine/daily*.test.ts`, `docs/CONTENT-DAILY.md` |
| Agent 3 (share, community, analytics, backend, privacy) | `src/share/**`, `src/community/**`, `src/analytics/**` (except `types.ts`), `src/engine/challenge.ts`, `src/screens/Challenge/**`, `src/components/results/ShareSheet.*`, `backend/**`, `.env.example`, `src/pwa/sw.ts` (NetworkOnly route only), `docs/BACKEND.md`, `docs/ANALYTICS.md`, `docs/COST.md`, `docs/PRIVACY.md`, About privacy/disclosure text (`src/screens/About/**`), `tests/unit/{share,community,analytics}/**`, `backend/test/**` |

Rules: no `git` commands, no `npm install` (ask the lead), never edit another owner's files, keep every existing
test id, keep Simple and Full styles working, keep offline play working, no new runtime dependencies without the lead.

## 4. Acceptance tests per phase

* Engine: deterministic `resolveDaily`/`compileDaily` (deep-equal twice; identical headless runs), schedule ≥ 30 days
  with no `dilemmaKey` repeat in any 30-window, every compiled day passes `validateScenario` + daily rules, balance
  harness across all days (principled ≥ 60, beats suppressive and idle by ≥ 12), first decision ≤ tick 6, duration
  100–120, fingerprint letters.
* Store: v1→v2 migration, official immutability (second completion with a higher score leaves `official` intact and
  fills `practice`), abandon does not lock, UTC id reset, multi-completion idempotence, outbox persistence.
* UI: Home primary CTA `daily-play-today` → `daily-open-screen` (skip `daily-open-skip`, start `daily-open-start`) →
  `play-screen` with the first decision within 30 s of real time at relaxed pace; result screen `daily-result` with
  `daily-official-label` / `daily-practice-label`; calendar `calendar-screen` with `calendar-day-<dailyId>`; passport
  `passport-screen`; reminders off by default (`setting-remindersEnabled`).
* Share/community: fingerprint card 1200×630 renders locally with alt text; daily challenge code round-trips and hides
  the friend's score until completion; stats show "Not enough results yet" under the cohort; backend handler tests for
  validation, dedupe, rate limit, CORS, cohort; analytics no-op/opt-out/privacy tests.
