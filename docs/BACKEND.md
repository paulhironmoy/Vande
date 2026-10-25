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
│  • opt-in gate           │ ◀─────────────── │ backend/src  │ ◀──────────────────── │ 5 tables │
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
  (`caches.default`, 300 s, keyed by URL with CORS headers re-applied per request). Limits (`backend/src/guards.ts`)
  are keyed by network (an IPv4 address or an IPv6 /64, as a salted hash): 30 writes and 120 uncached reads a minute
  per network, under global ceilings for all clients together. The Workers Rate Limiting bindings count them, with D1
  buckets as the fallback. Writes fail closed when `RATE_SALT` is missing. Request bodies are streamed and cut off at
  2 KB, and a daily cron prunes old rows within a statement budget.

## API contract

See `backend/README.md` for the table; the request body is exactly `DailyResultSubmission` (`src/community/types.ts`
= `backend/src/contract.ts`). Accepted `dailyId` window: today − 2 … today + 1 (UTC). `submissionId` = first 32 hex
characters of `sha256(installId + ':' + dailyId)`, computed on the device.

Stats response (`DailyStats`): `count`, `minCohort`, `ready`, `asOf`, and only when `ready`: `scoreBands` (five
bands, percentages), `outcomes` (percentages), `strategyMix` (restraint / mixed / force / passive), `median` (exact,
from the stored score histogram). Responses carry `x-cache: hit|miss`; a hit costs no database work and is not rate
limited. `POST` answers `503 service not configured` when no `RATE_SALT` secret exists (set `ALLOW_UNLIMITED_WRITES=1`
only for local development; the worker warns once per isolate), `413` when the body passes 2 KB (it is read as a
stream and cut off there, whatever `content-length` says), and `429` over the per-network limit or the global ceiling
(`busy, try again in a minute`). A day id with malformed percent-encoding answers `400`, and an unexpected error answers
`500` with CORS headers, so the app sees a failure it can handle.

**Privacy note for stats reads.** `GET /stats` is a plain request that carries only the day and content version.
Cloudflare sees the client address in transit, as for any web request. Nothing about the request is stored except,
on an edge-cache miss, a salted per-network rate-limit count. The app sends it only when the comparison panel
renders, and `CommunitySlot` renders the panel only for players who switched on **Share anonymous results**. The
endpoint itself needs nothing. This flow is listed in `docs/PRIVACY.md`.

## D1 schema and migrations

| Migration | What it does |
| --- | --- |
| `0001_init.sql` | `daily_results` (one row per installation per day; `submission_id` key, indexes on `(daily_id, content_version)` and `received_hour`) and `rate_buckets` |
| `0002_daily_stats.sql` | `daily_stats`, one row per day and content version (`count`, `score_sum`, `bands_json`, `outcomes_json`, `strategies_json`, `scores_json`, `updated_at`), backfilled from existing rows in SQL |
| `0003_lite_dares.sql` | `lite_attempts` and `lite_goal` (verified dares) |
| `0004_cheaper_writes.sql` | Rebuilds `rate_buckets` (empty), `lite_attempts` and `lite_goal` as WITHOUT ROWID tables keyed by what they are looked up by, with no other index. Attempt times become UTC hours; existing attempts and goal rows are copied |

Apply with `npx wrangler d1 migrations apply vande-community --remote` (documented; not run).

**Missing `daily_stats` rows.** If a row is ever missing (a day written between the deploy and migration `0002`), the
worker falls back to the full `GROUP BY` scan for that read. Running the backfill statement from `0002` again restores
the row.

**String quoting in the fallback statements.** They compare with `''`, not `""`. SQLite builds without double-quoted
string literals (the recommended setting) read `""` as a column name and fail. Running the statements on real SQLite
(`backend/test/d1-sqlite.ts`) caught this.

### Retention and cleanup

The daily cron (`17 3 * * *`, `scheduled()` in `backend/src/index.ts`) deletes:

* verified-dare attempts after 7 days;
* goal rows, `daily_results` (by `received_hour`) and `daily_stats` (by `updated_at`) after 180 days, so aggregates
  never outlive the raw rows they summarise;
* rate buckets after 24 hours.

The cleanup runs once a day, so a row can outlive its limit by up to a day: attempts live up to about 8 days, buckets
up to 2. Deleted rows can still be restored with D1 Time Travel for its window: 30 days on Workers Paid, 7 on Free.

**Batches seek, they never scan.** Deletes run in batches of 2,000 rows, and each batch finds its rows by key or index:

* bucket keys start with their window's minute in base 36, so expired buckets are a key range;
* `daily_results` uses its `received_hour` index;
* `lite_attempts` has random keys, so a run walks it once with a cursor on `dare_key`.

`backend/test/d1Rows.test.ts` checks these query plans.

**Statement budget.** One run spends at most `CLEANUP_MAX_QUERIES` statements (45, under the free plan's 50 queries per
invocation). Personal data goes first (attempts and goal rows, then results and aggregates) and rate buckets last.
Each step is caught on its own, so one failing table never stops the others. The run returns:

* rows deleted per step (`-1` for a step that failed);
* `queries_left`;
* `cleanup_incomplete`: 1 when rows were left for the next run. The run also logs a warning then.

**Rows written.** Measured on the real migrations by `backend/test/d1Rows.test.ts`, with deletes included (totals in
`docs/COST.md`):

* An accepted result costs 5.02 rows: the result row with its three index entries, plus the day's `daily_stats` row.
  Its cleanup costs 4.04 more, so 9.06 in all, or 12.08 with the D1 fallback limits.
* An uncached stats read writes nothing with the bindings, and 3.02 rows with the D1 fallback.

## Deploy, rollback, kill switches

Deploy and rollback commands are in `backend/README.md` (`wrangler deploy`, `wrangler rollback`). Kill switches, from
fastest to slowest: (1) build the client with `VITE_KILL_COMMUNITY=1` (or clear `VITE_COMMUNITY_API_URL`) and
redeploy the static site; (2) set `MIN_COHORT` very high to hide percentages; (3) disable the Worker route in the
Cloudflare dashboard; (4) `wrangler delete`.

## Abuse and threat model

Self-reported scores are not verifiable. The design limits damage rather than preventing forgery: one row per
installation per day, strict shapes, cohort thresholds, no leaderboard and no ranking. No authentication is used,
because a public web client cannot keep a secret. Nothing identifying is stored, so a breach of the database exposes
only bands, outcomes and letter patterns. A deployment without `RATE_SALT` refuses writes rather than silently running
unlimited.

Limits live in `backend/src/guards.ts`, `backend/src/ratelimit.ts` and `backend/src/http.ts`.

**Per network.** The key comes from `cf-connecting-ip` only; `X-Forwarded-For` is ignored, because anyone can send it.
The address is reduced to its network:

* an IPv4 address (an IPv4-mapped IPv6 address counts as IPv4);
* an IPv6 /64. One home or device on IPv6 controls a whole /64, so keying single IPv6 addresses would let it rotate
  freely.

A request without a usable address shares the fixed key `no-address`. The key is salted and hashed before use, and the
address is never stored.

**Global ceilings.** Rotating beyond one /64 gets past the per-network limits (an IPv6 /48 holds 65,536 of them), so
there is a ceiling across all clients:

* all POSTs together: key `all-writes`, 1,200 a minute;
* all uncached reads together: key `all-reads`, 2,400 a minute with D1 limits, or the `RL_GLOBAL` binding's 1,200.

Above the ceiling the API answers `429 busy, try again in a minute`, and apps fall back to local play. With the binding
the ceiling applies per Cloudflare location. `docs/COST.md` ("Abuse exposure") says what a flood at the ceiling can
cost.

**Bindings first, D1 as fallback.** The Workers Rate Limiting bindings count requests without writing to D1: `RL_WRITE`,
`RL_READ`, `RL_DARE` and `RL_GLOBAL` in `wrangler.toml` (wrangler 4.36.0 or later). Their counters are per Cloudflare
location and approximate. Without a binding, or when a binding call fails, the Worker counts in D1 buckets instead, so a
limit is never skipped. The goal cap is per day and always uses D1, because bindings only allow 10- or 60-second
periods.

**WAF rule, recommended once the API has a custom domain.** Cloudflare WAF rate-limiting rules work on zones, not on
`*.workers.dev`, so this needs the API on a custom domain in a Cloudflare zone. That means buying a domain, which has
not been done. The free plan includes one rule:

> URI Path starts with `/v1/`, counted by IP: more than 30 requests in 10 seconds → block for 10 seconds.

Blocked requests never reach the Worker and cost nothing. It is the only defence that also saves Worker requests.

**Other floods and retries.** Flooding `/stats` for one day is absorbed by the edge cache and the read limiter, so it
costs Worker requests (free up to 100 k a day) rather than database work. The client's outbox should cap retry attempts
per queued item, so that a recovering backend never receives a retry storm.

## Logs and observability

Workers Logs are **off** in `backend/wrangler.toml` (`[observability] enabled = false`, `invocation_logs = false`).
New Workers have them on by default. Invocation logs would keep every request's method and URL (the grade URL holds
the attempt id) with request and response metadata: 3 days on Free, 7 on Paid. `docs/PRIVACY.md` says the backend
keeps no such per-request record.

The Worker's own warnings hold no addresses, ids or secret text. They cover a missing salt, an unusable signing key
(with a fixed reason), a failed cleanup step and a used-up cleanup budget. `npx wrangler tail` shows them live without
storing anything.

To debug with stored logs, knowingly:

1. Update `docs/PRIVACY.md` first.
2. Set `enabled = true` and keep `invocation_logs = false`, so only those warnings are stored.
3. Deploy.
4. Switch it off again when done.

## Local development without the backend

Leave `VITE_COMMUNITY_API_URL` empty. The comparison panel renders nothing and submissions are skipped. The tests
use two stand-ins for D1:

* the in-memory stub `backend/test/d1-memory.ts`;
* `backend/test/d1-sqlite.ts`, real SQLite (`node:sqlite`) with the real migrations, which counts rows written the way
  D1 bills them.

## Verified dares (Lite): deployment-ready, switched off

Verified dares let the server, not the friend's own app, choose and grade the Lite twist question, and sign the reply
so the helper's app can trust it offline. They are the prerequisite for ever giving Helper points value (a
leaderboard, a prize, anything public). **Nothing is deployed.** They stay off until all of these hold:

* `DARE_SIGNING_KEY` is set on the Worker;
* the app is built with `VITE_COMMUNITY_API_URL`, `VITE_LITE_VERIFIED_DARES=1` and at least one public key
  (`VITE_DARE_PUBLIC_KEYS` or `VITE_DARE_PUBLIC_KEY`);
* the community kill switch is off;
* the player has switched on **Share anonymous results**.

Two moments can wait on the network: drawing the twist and signing the reply, each for at most 3 s. Everything else in
play is local. Any failure falls back to the local twist and an unsigned reply: offline, no answer in time, 4xx/5xx, a
content-version mismatch, or a signature that no build key verifies.

### Pieces

| Where | What |
| --- | --- |
| `src/community/liteDareProtocol.ts` | Wire types, validation patterns and the canonical signed string, shared by app and Worker |
| `src/community/liteDares.ts` | Client: `verifiedDaresEnabled`, `liteDeviceKey`, `startVerifiedAttempt`, `gradeVerifiedAttempt`, `verifyReplySignature` / `replyVerification` (offline), `fetchLiteGoal` |
| `src/components/game/community/LiteGoal.tsx` | "Today X% of dare answers found the best move", rendered only when enabled, opted in and `ready` |
| `backend/src/liteDares.ts` | Routes, validation, replay check, twist draw and grading, goal, cleanup |
| `backend/src/signing.ts` | ECDSA P-256 / SHA-256 signing with the JWK secret (WebCrypto), and the key id |
| `backend/src/guards.ts`, `ratelimit.ts`, `http.ts` | Fail-closed salt; per-network and global limits (bindings, D1 fallback); network keys; streamed body limit; cleanup batches |
| `backend/migrations/0003_lite_dares.sql`, `0004_cheaper_writes.sql` | `lite_attempts`, `lite_goal`; `0004` makes them WITHOUT ROWID tables |
| `backend/test/d1Rows.test.ts`, `d1-sqlite.ts` | Rows written per operation and cleanup query plans, measured on real SQLite with the real migrations |
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
helper opens the reply link            replyCountsAsVerified(reply)  (offline, public key only)
                                          true only for a valid 'dare+twist' signature
                                          -> awardHelperReply(..., verified = true); a valid 'twist'
                                          signature is not a verified award (points are claimed)
anyone, Lite start / dare landings     <LiteGoal optedIn={...} />    GET /v1/lite/goal/:day (edge-cached;
                                          replay-verified answers only, so hidden on the free-plan default)
```

`optedIn` is `useApp.getState().settings.communitySharing === 'on'` and `installId` is `useApp.getState().installId`.
`answerPath` is the tokens the friend applied from the dared moment: clue scans `e<i>` then exactly one answer token
for the dared step (`d<i>-<o>` or `r<i>-<o>`). `claim` is what the local reveal computed: the answer's points, its
best-move flag and the action kind of the best move (`rule` for fair-play steps).

### Endpoint contract

| Method | Path | Body | Answers |
| --- | --- | --- | --- |
| POST | `/v1/lite/attempts` | `{ v: 1, contentVersion, dare: { seed, path, step, deadline }, deviceKey, nonce, answerPath, claim: { points, best, kind } }` | `201` created; `200` existing attempt (same device key and dare: the same attempt, twist and nonce come back, whatever the new body says); `400` invalid or does not replay; `403` origin; `409 { error: 'content version mismatch', contentVersion }` when the app's content differs from the Worker's; `413` body over 2 KB (read as a stream and cut off there); `429` per-network limit (`RATE_LIMIT_DARES_PER_MINUTE`) or global ceiling; `503` not configured or switched off |
| POST | `/v1/lite/attempts/:attemptId/grade` | `{ v: 1, dare: { seed, path, step, deadline }, deviceKey, twistAnswer: 'a'..'d' \| null }` | `200` graded (`graded: true`), or the stored result of an earlier grade (`graded: false`, same signature, never regraded); `404` for an unknown attempt, another device key, another dare or a malformed id (one answer for all, so attempt ids leak nothing); `409` twist no longer in the pool; `400`, `413`, `429` and `503` as above |
| GET | `/v1/lite/goal/:day` | none (UTC `YYYY-MM-DD`) | `{ day, active, answers, minCohort, ready, best?, share?, asOf }`. **Counts only replay-verified (`v`) graded answers**, at most `LITE_GOAL_PER_ADDRESS_PER_DAY` (3) per network per UTC day, so claimed results never move it. When the deployment does not replay (the free-plan default) or the cap is `0`, it answers `active: false` with `cache-control: public, max-age=3600` without touching D1; the app remembers that for the day and stops asking. Otherwise `best` and `share` appear only when `answers ≥ MIN_COHORT`, with `cache-control: public, max-age=300`, edge-cached like daily stats, uncached reads rate limited |

`v` in the bodies is the request format, still 1. The signed string below is protocol 2. Grade looks the attempt up
by `(dare_key, device_key)`, the table's primary key. `dare_key` is the first 32 hex of
`sha256(dareIdentity(dare))`, from the dare in the body. The attempt id in the path must match the stored one.

`deviceKey` = `sha256(installId + ':' + dareIdentity(dare))` as 64 lowercase hex, computed on the device. The same
device gets unrelated keys for different dares, so attempts cannot be linked across dares, and the install id never
leaves the device. The twist is drawn by the server with `crypto.getRandomValues` from the live twists of the kind
(any kind if none), using the same `pickTwist` as the app.

### What the signature covers (protocol 2), and the marker

```
vande-lite-dare|2|<marker>|<keyId>|<issueDay>|<dareIdentity>|<points>|<0|1>|<twistId or ~>|<r|w|s>|<nonce>
```

* `dareIdentity` is `seed36:path:step:deadline36` (`dareIdentity` in `src/lite/twists.ts`). Chain and hint are not
  covered, so passing a dare on never invalidates a reply. The rematch deadline is not covered either: it is the
  friend's own clock.
* `keyId` is 8 lowercase hex: the first 4 bytes of the SHA-256 of the signing key's uncompressed public point. It is
  the first 8 characters of the fingerprint `scripts/lite-dare-keys.mjs` prints.
* `issueDay` is the UTC day the server signed, as days since 1970-01-01 in 4 base-36 characters.

The signature is ECDSA P-256 / SHA-256, raw r‖s as 128 lowercase hex. It travels in the R2 reply's `_x` field as
`<marker><keyId><issueDay><128 hex>`, which is 1 + 8 + 4 + 128 = **141 characters**.

The helper's app checks a reply offline:

1. It picks the build key whose id matches; a build can hold several during a rotation (`docs/ROLLBACK.md`).
2. It rejects an unknown key id, and an issue day later than tomorrow (UTC).
3. It verifies the signature.

Protocol 1 signatures (129 characters, no key id) are not accepted. None were ever issued, because nothing was
deployed.

The marker says what the server verified:

* `v` = **dare + twist verified**: the server replayed the dare and the friend's answer with the app's engine, so the
  points and best-move flag are the server's, and it drew and graded the twist.
* `t` = **twist verified**: the server drew and graded the twist; move points and the move's best flag are as the
  friend's app claimed. Fair-play answers are still scored from the content (that needs no replay), and the answer
  must name a real option of the dared question.

The marker is inside the signed string, so it cannot be swapped. `replyVerifiedScope(reply)` (alias
`replyVerification`) returns `'dare+twist'`, `'twist'` or `null`. **For awards only `'dare+twist'` counts as verified**
(`replyCountsAsVerified(reply)`): a `'twist'` signature proves the server graded the twist, but the move points and
best flag in it are the friend's claim. `verifyReplySignature(reply)` only answers whether the signature is valid, for
either scope. `gradeVerifiedAttempt` checks every signature against the build's public keys before returning it, so a
key mismatch produces unsigned replies instead of links that fail later.

**Content version.** The start request carries `contentVersion` (`liteContentVersion()` in
`src/community/liteDareProtocol.ts`): `<engine version>-<hash of the Lite scenario>-<hash of the twist pool>`. The
Worker bundles the same modules and compares the two. A mismatch answers `409` with the Worker's version, for example
when the app and the Worker were built from different content during a staggered deploy. The app then uses its local
twist, so a dare is never graded against content other than the one it was played on.

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

Since migration `0004`, `lite_attempts` is a WITHOUT ROWID table with primary key `(dare_key, device_key)` and no
other index. Each row holds:

* the dare's seed, path, step and deadline;
* the nonce and the answer path;
* the recorded points and best flag, the kind, the twist id and the marker;
* once graded: the twist answer, the outcome `r|w|s` and the stored signature.

Its times are UTC hours (`created_hour`, `graded_hour`). `lite_goal` is one row per UTC day (`answers`, `best`,
`updated_at`).

Grading is a single `UPDATE … WHERE dare_key = ? AND device_key = ? AND attempt_id = ? AND outcome IS NULL`, so
concurrent grades cannot double-count. The goal row moves only when all of these hold:

* the call is the one that graded;
* the attempt is a `v` attempt;
* that network is still under its daily goal cap. The cap is a salted per-day key in `rate_buckets` (scope `goal`,
  window = the UTC day), pruned once its day is more than 24 hours old.

Without `RATE_SALT` (local development) nothing is counted, because the cap could not be applied. The daily cleanup
deletes attempts after 7 days and goal rows after 180 ("Retention and cleanup" above).

Rows written per answered dare, measured by `backend/test/d1Rows.test.ts`, including the cleanup's delete:

| | With the bindings | With D1 limits |
| --- | --- | --- |
| Default mode (`t`) | 3: start 1, grade 1, cleanup 1 | 8.02 |
| Replay mode (`v`) | 6.02: start 1, grade 3 (attempt, goal-cap bucket, goal row), cleanup 2.02 | 11.04 |

Each answered dare is 2 requests. Goal reads write nothing while the goal is off (the default). `docs/COST.md` has the
totals.

### Secrets, keys and enabling (documented, not run)

```bash
node scripts/lite-dare-keys.mjs                     # prints a fresh pair + the commands below; writes nothing
cd backend && npx wrangler secret put DARE_SIGNING_KEY   # paste the private JWK line
npx wrangler d1 migrations apply vande-community --remote
npx wrangler deploy
# app build: VITE_COMMUNITY_API_URL=…  VITE_LITE_VERIFIED_DARES=1  VITE_DARE_PUBLIC_KEYS=04…
```

The private key exists only as the Worker secret; the public key is public. If the secret is not a usable private
key, the dare endpoints answer 503, and the Worker warns once with a fixed reason, never quoting the secret.

To rotate keys without breaking replies already out, see "Rotating the signing key" in `docs/ROLLBACK.md`. The new
public key ships next to the old one, and only then does the secret change.

### Threat model (what verification does and does not stop)

* **Stops**: inventing a "cracked the twist" reply without a server-graded twist; retrying the twist on the same device
  (one attempt per device key per dare, graded once); swapping the twist or its answer key client-side; editing any
  signed field of a reply; (with `v`) claiming points or a best move the replay does not show.
* **Does not stop**: a second device or a made-up install id (a new device key = a new attempt; the per-dare and daily
  caps bound the payoff); live coaching; reading answers from the app bundle.
* **The shared goal** counts only replay-verified answers, at most 3 per network (an IPv4 address or an IPv6 /64) per
  UTC day, so claimed results (`t`) can never move it. Scripted but genuine answers from many networks could still
  nudge it; the cohort threshold, the per-network cap and the global ceiling bound that.
* **The twist answer key also ships in the app** for offline play. Anything with real value (prizes, a public
  leaderboard) must serve twists and their answers from the server only, and should require `v` signatures. See
  `docs/COMPETITION-READINESS.md`.

### Switching it off

Fastest first: set `KILL_LITE_DARES = "1"` and redeploy the Worker (start and grade answer 503; apps fall back to
local twists within one request), or delete the `DARE_SIGNING_KEY` secret (same effect, no redeploy); rebuild the app
without `VITE_LITE_VERIFIED_DARES`; or remove the Worker route. Replies already signed keep verifying offline with the
built-in public key. Details in `docs/ROLLBACK.md`.
