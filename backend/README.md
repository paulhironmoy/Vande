# VANDE community API (Cloudflare Workers + D1)

Anonymous, opt-in aggregate results for the daily crisis. **Nothing in this directory is deployed automatically.**
The game is fully playable without it; the client treats every failure as "no community data".

## What it stores

One row per `(day, installation)`: `submission_id` (hash computed on the device), `daily_id`, `content_version`,
`app_version`, `mode`, `score`, `band`, `outcome`, `fingerprint`, `strategy`, `received_hour` (UTC hour).
One aggregate row per `(day, content version)` in `daily_stats` (counts, score sum, band/outcome/strategy/score
histograms as JSON), updated in the same request as each accepted result so that stats reads are a single-row lookup.
No names, emails, IPs, user agents or free text.

* **Rate-limit buckets.** They exist only where the Workers Rate Limiting bindings are absent, plus the per-day goal
  cap. Each holds a salted hash of the network (an IPv4 address or an IPv6 /64) for one window, and is deleted after
  24 hours.
* **Retention.** The daily cron prunes results and aggregates older than 180 days, in batches within
  `CLEANUP_MAX_QUERIES` statements.
* **No requests about a person.** Rows cannot be linked back to a person, so there is nothing to look up or delete on
  request. Say so in any privacy notice.

Verified dares (Lite, off until `DARE_SIGNING_KEY` is set) add `lite_attempts`: one row per `(dare, device key)` with
the dare's game moves, the friend's reply nonce, answer, recorded points and best flag, the drawn twist and, once
graded, its outcome and the stored signature. The device key is `sha256(installId:dareIdentity)` made on the device, so
one device's attempts on different dares cannot be linked. Times are kept to the hour, and rows are deleted after 7
days. `lite_goal` keeps one row of counts per UTC day (answers, best moves found) for 180 days. It counts only
replay-verified answers, at most 3 per network per UTC day (a salted per-day key in `rate_buckets`). Details:
`docs/BACKEND.md`, "Verified dares".

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/daily/:dailyId/results` | JSON ≤ 2 KB, read as a stream; `201` accepted, `200` duplicate, `400` invalid, `403` origin, `413` too large, `429` per-network limit or global ceiling, `503` no `RATE_SALT` |
| GET | `/v1/daily/:dailyId/stats?cv=<contentVersion>` | `cache-control: public, max-age=300` and cached at the edge (`x-cache: hit|miss`); percentages only when `count ≥ MIN_COHORT`; `429` after `RATE_LIMIT_READS_PER_MINUTE` uncached reads per network, or above the global ceiling |
| POST | `/v1/lite/attempts` | verified dares, start: JSON ≤ 2 KB with `contentVersion`; `201` created, `200` existing attempt (idempotent per device key + dare), `400` invalid / does not replay, `409` content version differs from the Worker's (the body names the Worker's), `429`, `503` without `DARE_SIGNING_KEY` or `RATE_SALT`, or with `KILL_LITE_DARES=1` |
| POST | `/v1/lite/attempts/:attemptId/grade` | verified dares, grade: the body carries the dare again (the attempt is looked up by dare and device key); graded once, then the stored result (same signature); `404` unknown attempt, other device key or dare, malformed id; `409` twist gone; same `400`/`413`/`429`/`503` rules |
| GET | `/v1/lite/goal/:day` | today's goal counts: replay-verified answers only (≤ `LITE_GOAL_PER_ADDRESS_PER_DAY` per network per UTC day); `best`/`share` only from `MIN_COHORT`; edge-cached 300 s. With replay off it answers `active: false` (cached an hour, no database work) and the app stops asking for the day |
| GET | `/v1/health` | `{ ok, version, time }` |

## Commands (run from `backend/`)

```bash
npx wrangler@latest login                                   # one-time, interactive
npx wrangler@latest d1 create vande-community               # paste the id into wrangler.toml
npx wrangler@latest d1 migrations apply vande-community --local
npx wrangler@latest dev                                     # http://127.0.0.1:8787
npx wrangler@latest secret put RATE_SALT                    # any long random string
node ../scripts/lite-dare-keys.mjs                          # verified dares only: prints a key pair (writes nothing)
npx wrangler@latest secret put DARE_SIGNING_KEY             # verified dares only: paste the private JWK line
npx wrangler@latest d1 migrations apply vande-community --remote
npx wrangler@latest deploy                                  # prints https://vande-community.<account>.workers.dev
npx wrangler@latest rollback                                # previous deployment
```

Then build the game with `VITE_COMMUNITY_API_URL=https://vande-community.<account>.workers.dev`.

## Configuration

`ALLOWED_ORIGINS` (comma list; browsers must match, non-browser clients are allowed), `MIN_COHORT` (default 25),
`CONTENT_VERSIONS` (allow-list; empty accepts any well-formed version), `RATE_SALT` (secret; **required**: without it
the worker refuses writes with `503`), `ALLOW_UNLIMITED_WRITES` (`1` accepts writes without a salt, local development
only; logged once per isolate), `VERSION`.

Limits, per network (an IPv4 address or an IPv6 /64), for the D1 fallback:

* `RATE_LIMIT_PER_MINUTE` (writes, default 30);
* `RATE_LIMIT_READS_PER_MINUTE` (uncached reads, default 120);
* `RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE` (1,200) and `RATE_LIMIT_GLOBAL_READS_PER_MINUTE` (2,400), the global ceilings.

The `[[ratelimits]]` bindings `RL_WRITE`, `RL_READ`, `RL_DARE` and `RL_GLOBAL` are the production limiter: no D1
writes, per Cloudflare location, wrangler 4.36.0 or later. Without one, the D1 fallback applies.

Other settings:

* `CLEANUP_MAX_QUERIES` (45): D1 statements one daily cleanup may run. Raise it on Workers Paid as traffic grows.
* `[observability]`: Workers Logs off on purpose; see `docs/BACKEND.md`, "Logs and observability".

Verified dares:

* `DARE_SIGNING_KEY` (secret, P-256 private JWK; required);
* `KILL_LITE_DARES` (`1` = off);
* `LITE_VERIFY_REPLAY` (`1` = replay before signing; Workers Paid only, see the CPU table in `docs/BACKEND.md`);
* `RATE_LIMIT_DARES_PER_MINUTE` (default 60);
* `LITE_GOAL_PER_ADDRESS_PER_DAY` (default 3; `0` stops the goal).

The Worker bundles app modules (`src/engine`, `src/lite`, `src/share/dare.ts`, the twist pool) through the `@/` alias in
`tsconfig.json`; `[define]` in `wrangler.toml` replaces Vite's `import.meta.env`. Check the bundle locally before the
first deploy with `npx wrangler@latest deploy --dry-run --outdir /tmp/vande-worker` (local only, uploads nothing).

Migrations: `0001_init.sql` (results, rate buckets), `0002_daily_stats.sql` (incremental aggregates, backfilled from
existing rows), `0003_lite_dares.sql` (verified-dare attempts and the daily goal) and `0004_cheaper_writes.sql`.
`0004` rebuilds rate buckets, attempts and the goal as WITHOUT ROWID tables with no extra index, so each row written
costs one billed row; it is not additive, see `docs/ROLLBACK.md`. Apply all with `wrangler d1 migrations apply`.

## Tests

`npx vitest run backend/test` from the repository root — an in-memory D1 stub exercises validation, dedupe, CORS,
body limits, write and read rate limiting, the fail-closed salt, cohort threshold, incremental-versus-full aggregate
equality, the edge-cache hit path, aggregate maths and pruning. `backend/test/liteDares.test.ts` covers verified dares:
start and grade, idempotency, one attempt per device key per dare, replay parity with the app on every answer of whole
chapters, tampered and malformed payloads, signatures (and every field they cover), fail-closed secrets, the kill
switch, rate limits, the goal cohort and cache, retention, and logs the replay CPU cost.

`backend/test/d1Rows.test.ts` runs the Worker on real SQLite with the real migrations (`backend/test/d1-sqlite.ts`). It
measures rows written per operation the way D1 bills them, which gives the numbers in `docs/COST.md`, and it checks
that the cleanup seeks by key or index. The client side (including a round trip through this Worker and the offline
verifier) is in `tests/unit/community/liteDares.test.ts`.

## Threat model and abuse notes

* Submissions are self-reported by the client. This is **not cheat-proof**: anyone can post a valid-looking score.
  Mitigations: strict validation, one result per installation per day, rate limiting, cohort threshold, no leaderboards
  and no per-player ranking, so a forged submission can only nudge an aggregate.
* Bulk abuse is bounded by per-network limits (IPv4 address or IPv6 /64) and by global ceilings, which address
  rotation cannot pass. Only `cf-connecting-ip` is read; `X-Forwarded-For` is ignored.
* Once the API runs on a custom domain in a Cloudflare zone, add a WAF rate-limiting rule (the free plan includes one):
  path starts with `/v1/`, counted per IP. WAF rules do not apply to `*.workers.dev`. See `docs/BACKEND.md`.
* No authentication by design: an auth token in a public web app would be public too.
* Cost exposure: a flood of requests could exceed the free Workers quota; set a Cloudflare usage notification and, if
  needed, flip `VITE_KILL_COMMUNITY=1` in the client build or remove the route in the dashboard (kill switch). Stats
  reads are served from the edge cache for 5 minutes and uncached reads are rate limited, so flooding `/stats` costs
  Worker requests, not database reads.
* Stats requests reach Cloudflare like any web request; the address is seen in transit and never stored. The app asks
  for stats only for players who switched on sharing, although the endpoint itself needs nothing.
* Client retries: the outbox retries a queued result on reconnect; the client should cap attempts per item (the lead
  owns `src/community/client.ts`) so a recovering backend never sees a retry storm.

* Verified dares make the twist server-chosen and server-graded and sign the reply; they cannot stop a second device
  or a made-up install id (new device key, new attempt), and the twist answer key also ships in the app. Anything with
  real value must serve twists and answers from the server only (`docs/BACKEND.md`, threat model).

## Cost (free tier)

Workers: 100,000 requests a day. D1: 5 M rows read and 100,000 rows written a day, and 500 MB per database (5 GB per
account). `docs/COST.md` has measured rows per operation and totals from 1k to 1M MAU.
