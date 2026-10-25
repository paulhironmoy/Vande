# Community backend — architecture, API, data and operations

The community backend is an optional Cloudflare Worker with a D1 (SQLite) database that stores **anonymous,
opt-in official daily results** and returns **aggregate statistics**. The game never depends on it: with
`VITE_COMMUNITY_API_URL` unset the client code path is inert, and with it set every failure degrades to
"no community data" without touching play, completion, persistence or sharing.

## Architecture

```
Browser / Android app                           Cloudflare
┌──────────────────────────┐   POST results   ┌──────────────┐   parameterised SQL   ┌──────────┐
│ src/community/client.ts  │ ───────────────▶ │ Worker       │ ────────────────────▶ │ D1       │
│  • opt-in gate           │ ◀─────────────── │ backend/src  │ ◀──────────────────── │ 3 tables │
│  • 5 s timeout           │   GET stats      │  no framework│   1-row stats lookup   └──────────┘
│  • outbox (offline)      │                  │  edge cache  │
│  • 10-min stats cache    │                  │  CORS, limits│
│                          │                  │  cron prune  │
└──────────────────────────┘                  └──────────────┘
```

* **Separate origin.** The API lives on `*.workers.dev` (or a custom host), never under the site origin, so the
  service worker's navigation fallback cannot intercept it. The SW additionally registers a `NetworkOnly` route for
  that origin.
* **Client** (`src/community/`): `submitOfficialResult` runs after an official completion when
  `settings.communitySharing === 'on'`; `fetchDailyStats` feeds `<CommunityComparison>`; `flushOutbox` retries on
  `online`/visibility. The storage adapter defaults to localStorage and can be swapped (`setCommunityStorage`).
* **Worker** (`backend/src/index.ts`): plain `fetch` handler, strict validation, `INSERT OR IGNORE` dedupe, an
  incremental `daily_stats` row updated in the same request as each accepted result (one statement, atomic JSON
  counters, so concurrent inserts never lose an update), stats served from a one-row lookup and cached at the edge
  (`caches.default`, 300 s, keyed by URL with CORS headers re-applied per request), D1-backed rate limiting with salted
  address hashes for writes (30/min) and for uncached reads (120/min), fail-closed writes when `RATE_SALT` is missing,
  cron pruning.

## API contract

See `backend/README.md` for the table; the request body is exactly `DailyResultSubmission` (`src/community/types.ts`
= `backend/src/contract.ts`). Accepted `dailyId` window: today − 2 … today + 1 (UTC). `submissionId` = first 32 hex
characters of `sha256(installId + ':' + dailyId)`, computed on the device.

Stats response (`DailyStats`): `count`, `minCohort`, `ready`, `asOf`, and only when `ready`: `scoreBands` (five
bands, percentages), `outcomes` (percentages), `strategyMix` (restraint / mixed / force / passive), `median` (exact,
from the stored score histogram). Responses carry `x-cache: hit|miss`; a hit costs no database work and is not rate
limited. `POST` answers `503 service not configured` when no `RATE_SALT` secret exists (set `ALLOW_UNLIMITED_WRITES=1`
only for local development; the worker warns once per isolate).

**Privacy note for stats reads.** `GET /stats` is a plain request: Cloudflare sees the client address in transit (as
for any web request) and nothing is stored. The client sends it whenever the comparison panel renders in a build with
`VITE_COMMUNITY_API_URL` set; it does not require the sharing opt-in because the request carries nothing about the
player (only the day and content version). This flow is listed in `docs/PRIVACY.md`.

## D1 schema and migrations

`backend/migrations/0001_init.sql` creates `daily_results` and `rate_buckets`; `0002_daily_stats.sql` creates
`daily_stats` (one row per day and content version: `count`, `score_sum`, `bands_json`, `outcomes_json`,
`strategies_json`, `scores_json`, `updated_at`) and backfills it from existing rows in SQL. Apply with
`npx wrangler d1 migrations apply vande-community --remote`. If a `daily_stats` row is ever missing (a day written
between the deploy and the migration), the worker falls back to the full `GROUP BY` scan for that read; running the
backfill statement from `0002` again restores the row.

Retention: `daily_results` rows are deleted 180 days after `received_hour`, `daily_stats` rows 180 days after
`updated_at`, `rate_buckets` after 24 hours. Aggregates therefore never outlive the raw rows they summarise.

Write cost per accepted result: one `daily_results` insert, one `daily_stats` upsert and one `rate_buckets` upsert
(three row writes). Read cost per uncached stats request: one `rate_buckets` upsert and one `daily_stats` row.

## Deploy, rollback, kill switches

Deploy and rollback commands are in `backend/README.md` (`wrangler deploy`, `wrangler rollback`). Kill switches, from
fastest to slowest: (1) build the client with `VITE_KILL_COMMUNITY=1` (or clear `VITE_COMMUNITY_API_URL`) and
redeploy the static site; (2) set `MIN_COHORT` very high to hide percentages; (3) disable the Worker route in the
Cloudflare dashboard; (4) `wrangler delete`.

## Abuse and threat model

Self-reported scores are not verifiable; the design limits damage rather than preventing forgery: one row per
installation per day, strict shapes, rate limits on writes and on uncached reads, cohort thresholds, no leaderboard,
no ranking. No authentication is used because a public web client cannot keep a secret. Nothing identifying is stored,
so a breach of the database exposes only bands, outcomes and letter patterns. A deployment without `RATE_SALT` refuses
writes rather than silently running unlimited. Flooding `/stats` for one day is absorbed by the edge cache and the read
limiter, so it costs Worker requests (free up to 100 k/day) rather than database reads. The client's outbox should cap
retry attempts per queued item so that a recovering backend never receives a retry storm.

## Local development without the backend

Leave `VITE_COMMUNITY_API_URL` empty. The comparison panel renders nothing, submissions are skipped, and all tests run
against the in-memory D1 stub (`backend/test/d1-memory.ts`).

## Verified dares (Lite): deployment-ready, switched off

Verified dares let the server, not the friend's own app, choose and grade the Lite twist question, and sign the reply
so the helper's app can trust it offline. They are the prerequisite for ever giving Helper points value (a
leaderboard, a prize, anything public). **Nothing is deployed.** They stay off until all of these hold:
`DARE_SIGNING_KEY` is set on the Worker, the app is built with `VITE_COMMUNITY_API_URL`, `VITE_LITE_VERIFIED_DARES=1`
and `VITE_DARE_PUBLIC_KEY`, the community kill switch is off, and the player has switched on **Share anonymous
results**. Any failure (offline, timeout after 3 s, 4xx/5xx, a signature that does not match the build key) falls back
to the local twist and an unsigned reply; play never waits on the network.

### Pieces

| Where | What |
| --- | --- |
| `src/community/liteDareProtocol.ts` | Wire types, validation patterns and the canonical signed string, shared by app and Worker |
| `src/community/liteDares.ts` | Client: `verifiedDaresEnabled`, `liteDeviceKey`, `startVerifiedAttempt`, `gradeVerifiedAttempt`, `verifyReplySignature` / `replyVerification` (offline), `fetchLiteGoal` |
| `src/components/game/community/LiteGoal.tsx` | "Today X% of dare answers found the best move", rendered only when enabled, opted in and `ready` |
| `backend/src/liteDares.ts` | Routes, validation, replay check, twist draw and grading, goal, cleanup |
| `backend/src/signing.ts` | ECDSA P-256 / SHA-256 signing with the JWK secret (WebCrypto) |
| `backend/migrations/0003_lite_dares.sql` | `lite_attempts`, `lite_goal` |
| `scripts/lite-dare-keys.mjs` | Prints a fresh key pair and the install commands; writes nothing |

**No hand copies of game rules.** The Worker imports the app's own `src/engine`, `src/lite/replay.ts`,
`src/lite/points.ts`, `src/lite/twists.ts` (and the twist pool JSON), `src/share/dare.ts` and the card kinds through the
`@/` alias (`backend/tsconfig.json` `paths`, which wrangler's esbuild bundler reads). Type-only shims in
`backend/src/shims/` cover the few browser globals those modules mention in browser-only code, and the `[define]` table
in `wrangler.toml` replaces Vite's `import.meta.env` (`DEV=false`, `BASE_URL="/"`). A local bundle check with the
repository's own bundler (rolldown, same alias and defines) produced a 1.43 MB worker (275 kB gzip, under the 3 MB
free-plan script limit) that ran start, grade, verify and cleanup end to end under Node; `wrangler deploy --dry-run`
is the check to repeat before the first real deploy.

### Flow and the calls the app makes

```
friend answers the dared question      startVerifiedAttempt({ optedIn, installId, dare, nonce, answerPath, claim })
  POST /v1/lite/attempts               -> { attemptId, twistId, kind, nonce, points, best, verified, created }
                                          use twistId + nonce for this dare; null -> local twist as today
friend answers or skips the twist,     gradeVerifiedAttempt({ optedIn, installId, dare, attemptId, twistAnswer })
then sends the reply                   -> { points, best, twistId?, twist, nonce, verified, sig, graded }
  POST /v1/lite/attempts/:id/grade        build the R2 reply from these values + sig; null -> unsigned reply
helper opens the reply link            verifyReplySignature(reply)   (offline, public key only)
                                          true -> awardHelperReply(..., verified = true)
anyone, Lite start / dare landings     <LiteGoal optedIn={...} />    GET /v1/lite/goal/:day (edge-cached)
```

`optedIn` is `useApp.getState().settings.communitySharing === 'on'` and `installId` is `useApp.getState().installId`.
`answerPath` is the tokens the friend applied from the dared moment: clue scans `e<i>` then exactly one answer token
for the dared step (`d<i>-<o>` or `r<i>-<o>`). `claim` is what the local reveal computed: the answer's points, its
best-move flag and the action kind of the best move (`rule` for fair-play steps).

### Endpoint contract

| Method | Path | Body | Answers |
| --- | --- | --- | --- |
| POST | `/v1/lite/attempts` | `{ v: 1, dare: { seed, path, step, deadline }, deviceKey, nonce, answerPath, claim: { points, best, kind } }` | `201` created, `200` existing attempt (same device key + dare: same attempt, twist and nonce back, whatever the new body says), `400` invalid or does not replay, `403` origin, `413` > 2 KB, `429` > `RATE_LIMIT_DARES_PER_MINUTE`, `503` not configured / switched off |
| POST | `/v1/lite/attempts/:attemptId/grade` | `{ v: 1, deviceKey, twistAnswer: 'a'..'d' \| null }` | `200` graded (`graded: true`) or the stored result of an earlier grade (`graded: false`, same signature, never regraded), `404` unknown attempt or a different device key (same answer, so attempt ids leak nothing), `409` twist no longer in the pool, `400`, `413`, `429`, `503` |
| GET | `/v1/lite/goal/:day` | none (UTC `YYYY-MM-DD`) | `{ day, answers, minCohort, ready, best?, share?, asOf }`; `best` and `share` only when `answers ≥ MIN_COHORT`; `cache-control: public, max-age=300`, edge-cached like daily stats, uncached reads rate limited |

`deviceKey` = `sha256(installId + ':' + dareIdentity(dare))` as 64 lowercase hex, computed on the device. The same
device gets unrelated keys for different dares, so attempts cannot be linked across dares, and the install id never
leaves the device. The twist is drawn by the server with `crypto.getRandomValues` from the live twists of the kind
(any kind if none), using the same `pickTwist` as the app.

### What the signature covers, and the marker

```
vande-lite-dare|1|<marker>|<dareIdentity>|<points>|<0|1>|<twistId or ~>|<r|w|s>|<nonce>
```

`dareIdentity` is `seed36:path:step:deadline36` (`dareIdentity` in `src/lite/twists.ts`); chain and hint are not
covered, so passing a dare on never invalidates a reply. The rematch deadline is not covered (it is the friend's own
clock). The signature is ECDSA P-256 / SHA-256, raw r‖s as 128 lowercase hex, prefixed by the marker, and travels in
the R2 reply's `_x` field (`sig` = marker + hex, 129 characters):

* `v` = **dare + twist verified**: the server replayed the dare and the friend's answer with the app's engine, so the
  points and best-move flag are the server's, and it drew and graded the twist.
* `t` = **twist verified**: the server drew and graded the twist; move points and the move's best flag are as the
  friend's app claimed. Fair-play answers are still scored from the content (that needs no replay), and the answer
  must name a real option of the dared question.

The marker is inside the signed string, so it cannot be swapped. `replyVerification(reply)` returns `'dare+twist'`,
`'twist'` or `null`; `gradeVerifiedAttempt` checks every signature against the build's public key before returning it,
so a key mismatch produces unsigned replies instead of links that fail later.

### Replay CPU, and why the free-plan default signs `t`

Replaying a dare costs CPU in proportion to how far into the chapter the dared question is (the engine ticks the whole
game up to that moment). Measured on a development machine (`backend/test/liteDares.test.ts` logs it on every run):

| Dared question | Game tick | Replay + scoring |
| --- | --- | --- |
| First question | 8 | ≈ 0.8 ms |
| Third question | 48 | ≈ 4 ms |
| Fair-play moments mid-chapter | 70–95 | ≈ 7–11 ms |
| Last question | 145 | ≈ 20 ms (up to ≈ 45 ms median, 130 ms worst, in a minified bundle on a busy machine) |

The Workers **free** plan allows 10 ms of CPU per request, so roughly the second half of the chapter would fail. The
default (`LITE_VERIFY_REPLAY = "0"`) therefore does not replay and signs `t`; the no-replay checks cost about 0.003 ms.
On **Workers Paid** (30 s default CPU limit) set `LITE_VERIFY_REPLAY = "1"` to sign `v`. Signing itself is well
under a millisecond.

### D1 schema and cleanup

`0003_lite_dares.sql` adds `lite_attempts` (one row per `(dare_key, device_key)`, `UNIQUE`; the dare's seed, path,
step and deadline; nonce; answer path; recorded points and best flag; kind; twist id; marker; then, once graded, the
twist answer, outcome `r|w|s`, the stored signature and `graded_at`) and `lite_goal` (one row per UTC day: `answers`,
`best`, `updated_at`). Grading is a single `UPDATE … WHERE outcome IS NULL`, so concurrent grades cannot double-count;
the goal row moves only for the call that graded. The daily cron deletes attempts after **7 days** and goal rows after
180 days. Apply with `npx wrangler d1 migrations apply vande-community --remote` (documented; not run).

Writes per answered dare: start = attempt insert + rate bucket (2 rows); grade = attempt update + goal upsert + rate
bucket (3 rows): **5 rows written, 2 requests**. Goal reads: 1 rate bucket + 1 row on an edge-cache miss.

### Secrets, keys and enabling (documented, not run)

```bash
node scripts/lite-dare-keys.mjs                     # prints a fresh pair + the commands below; writes nothing
cd backend && npx wrangler secret put DARE_SIGNING_KEY   # paste the private JWK line
npx wrangler d1 migrations apply vande-community --remote
npx wrangler deploy
# app build: VITE_COMMUNITY_API_URL=…  VITE_LITE_VERIFIED_DARES=1  VITE_DARE_PUBLIC_KEY=04…
```

The private key exists only as the Worker secret; the public key is public. Rotating: install a new pair and rebuild
the app; replies signed with the old key stop verifying and simply count as local replies.

### Threat model (what verification does and does not stop)

* **Stops**: inventing a "cracked the twist" reply without a server-graded twist; retrying the twist on the same device
  (one attempt per device key per dare, graded once); swapping the twist or its answer key client-side; editing any
  signed field of a reply; (with `v`) claiming points or a best move the replay does not show.
* **Does not stop**: a second device or a made-up install id (a new device key = a new attempt; the per-dare and daily
  caps bound the payoff); live coaching; reading answers from the app bundle.
* **The twist answer key also ships in the app** for offline play. Anything with real value (prizes, a public
  leaderboard) must serve twists and their answers from the server only, and should require `v` signatures. See
  `docs/COMPETITION-READINESS.md`.

### Switching it off

Fastest first: set `KILL_LITE_DARES = "1"` and redeploy the Worker (start and grade answer 503; apps fall back to
local twists within one request), or delete the `DARE_SIGNING_KEY` secret (same effect, no redeploy); rebuild the app
without `VITE_LITE_VERIFIED_DARES`; or remove the Worker route. Replies already signed keep verifying offline with the
built-in public key. Details in `docs/ROLLBACK.md`.
