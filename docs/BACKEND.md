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
