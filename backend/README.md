# VANDE community API (Cloudflare Workers + D1)

Anonymous, opt-in aggregate results for the daily crisis. **Nothing in this directory is deployed automatically.**
The game is fully playable without it; the client treats every failure as "no community data".

## What it stores

One row per `(day, installation)`: `submission_id` (hash computed on the device), `daily_id`, `content_version`,
`app_version`, `mode`, `score`, `band`, `outcome`, `fingerprint`, `strategy`, `received_hour` (UTC hour).
One aggregate row per `(day, content version)` in `daily_stats` (counts, score sum, band/outcome/strategy/score
histograms as JSON), updated in the same request as each accepted result so that stats reads are a single-row lookup.
No names, emails, IPs, user agents or free text. Rate-limit buckets store a salted hash of the address for one day.
Rows older than 180 days (results and aggregates) are pruned by the cron trigger. Rows cannot be linked back to a
person, so there is nothing to look up or delete on request — say so in any privacy notice.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/daily/:dailyId/results` | JSON ≤ 2 KB; `201` accepted, `200` duplicate, `400` invalid, `403` origin, `413` too large, `429` rate limited, `503` no `RATE_SALT` |
| GET | `/v1/daily/:dailyId/stats?cv=<contentVersion>` | `cache-control: public, max-age=300` and cached at the edge (`x-cache: hit|miss`); percentages only when `count ≥ MIN_COHORT`; `429` after `RATE_LIMIT_READS_PER_MINUTE` uncached reads per address |
| GET | `/v1/health` | `{ ok, version, time }` |

## Commands (run from `backend/`)

```bash
npx wrangler@latest login                                   # one-time, interactive
npx wrangler@latest d1 create vande-community               # paste the id into wrangler.toml
npx wrangler@latest d1 migrations apply vande-community --local
npx wrangler@latest dev                                     # http://127.0.0.1:8787
npx wrangler@latest secret put RATE_SALT                    # any long random string
npx wrangler@latest d1 migrations apply vande-community --remote
npx wrangler@latest deploy                                  # prints https://vande-community.<account>.workers.dev
npx wrangler@latest rollback                                # previous deployment
```

Then build the game with `VITE_COMMUNITY_API_URL=https://vande-community.<account>.workers.dev`.

## Configuration

`ALLOWED_ORIGINS` (comma list; browsers must match, non-browser clients are allowed), `MIN_COHORT` (default 25),
`CONTENT_VERSIONS` (allow-list; empty accepts any well-formed version), `RATE_LIMIT_PER_MINUTE` (writes, default 30),
`RATE_LIMIT_READS_PER_MINUTE` (uncached stats reads, default 120), `RATE_SALT` (secret; **required** — without it the
worker refuses writes with `503`), `ALLOW_UNLIMITED_WRITES` (`1` accepts writes without a salt, local development only;
logged once per isolate), `VERSION`.

Migrations: `0001_init.sql` (results, rate buckets) and `0002_daily_stats.sql` (incremental aggregates, backfilled from
existing rows). Apply both with `wrangler d1 migrations apply`.

## Tests

`npx vitest run backend/test` from the repository root — an in-memory D1 stub exercises validation, dedupe, CORS,
body limits, write and read rate limiting, the fail-closed salt, cohort threshold, incremental-versus-full aggregate
equality, the edge-cache hit path, aggregate maths and pruning.

## Threat model and abuse notes

* Submissions are self-reported by the client. This is **not cheat-proof**: anyone can post a valid-looking score.
  Mitigations: strict validation, one result per installation per day, rate limiting, cohort threshold, no leaderboards
  and no per-player ranking, so a forged submission can only nudge an aggregate.
* Bulk abuse is bounded by the per-address limit and by Cloudflare's own WAF; for production add a Cloudflare
  rate-limiting rule on `/v1/daily/*/results` (the free plan includes one rule).
* No authentication by design: an auth token in a public web app would be public too.
* Cost exposure: a flood of requests could exceed the free Workers quota; set a Cloudflare usage notification and, if
  needed, flip `VITE_KILL_COMMUNITY=1` in the client build or remove the route in the dashboard (kill switch). Stats
  reads are served from the edge cache for 5 minutes and uncached reads are rate limited, so flooding `/stats` costs
  Worker requests, not database reads.
* Stats requests reach Cloudflare like any web request (the address is seen in transit, never stored). The client only
  asks for stats when the community feature is configured; it does not require the sharing opt-in because nothing about
  the player is sent.
* Client retries: the outbox retries a queued result on reconnect; the client should cap attempts per item (the lead
  owns `src/community/client.ts`) so a recovering backend never sees a retry storm.

## Cost (free tier)

Workers 100,000 requests/day, D1 5 M reads/day and 100 k writes/day, 5 GB storage. See `docs/COST.md` for 1k/10k/100k MAU.
