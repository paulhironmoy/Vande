# Cost model

**Local/offline configuration: $0 recurring.** Static hosting on GitHub Pages or Cloudflare Pages is free; the game
makes no network requests beyond its own files.

The database numbers on this page are **measured, not estimated**. `backend/test/d1Rows.test.ts` runs the real Worker
against the real migrations in SQLite and counts rows the way D1 bills them: one row for the table plus one for every
index an `INSERT`, `UPDATE` or `DELETE` touches, and deletes count. `npx vitest run backend/test/d1Rows.test.ts
--silent=false` prints the tables below, and the test fails if a schema or statement change writes more. Earlier
versions of this page counted 3 rows per daily result and 4 per verified dare; they left out the index rows and the
cleanup's deletes.

## Prices and limits used

As of October 2026; check Cloudflare's pricing pages before relying on them.

| | Free | Workers Paid ($5/month minimum) |
| --- | --- | --- |
| Worker requests | 100,000 a day | 10 M a month included, then $0.30 per million |
| Worker CPU | 10 ms per request | 30 M CPU-ms a month included, then $0.02 per million |
| D1 rows written | 100,000 a day | 50 M a month included, then $1.00 per million |
| D1 rows read | 5 M a day | 25 billion a month included, then $0.001 per million |
| D1 storage | 500 MB per database, 5 GB per account | 5 GB included, then $0.75 per GB-month; 10 GB per database at most |
| D1 queries per Worker invocation | 50 | 1,000 |
| Workers Rate Limiting bindings (`[[ratelimits]]`) | write nothing to D1; no separate charge listed | same |
| Workers Logs | **off in this Worker**; 200,000 events a day if switched on | off; 20 M events a month included, then $0.60 per million (moves to Cloudflare Observability pricing on 1 December 2026) |
| Cloudflare / GitHub Pages | free | free |
| PostHog Cloud | 1 M events a month, 1-year retention | — |

## Assumptions per monthly active player (MAU)

| Driver | Value |
| --- | --- |
| Official daily results submitted (opt-in) | 8 a month, with 100 % opt-in assumed (the worst case) |
| Stats fetches | 16 a month (2 per result). Every fetch is a Worker request; only an edge-cache miss touches D1: about 2 % of fetches at 1k MAU, 5 % at 10k, 10 % from 100k |
| Answered verified dares (only when switched on) | 8 a month, each started and graded (2 requests) |
| Goal reads (only when verified dares are on) | 4 a month |
| CPU | about 1 ms per request on average; a replayed start (`LITE_VERIFY_REPLAY=1`) about 10 ms on average (0.6 ms for the first question, 20 ms for the last) |
| Storage | about 300 bytes per result row with its three indexes (232 measured, tightly packed), 650 per attempt (456 packed), 80 per rate bucket. Results are kept 180 days, attempts up to 8 |
| Analytics events | 25 a month |

## Rows written per operation (measured)

**Bindings** is the production setup: the `[[ratelimits]]` bindings in `backend/wrangler.toml` count requests in
Cloudflare's rate limiter, which writes nothing to D1. **D1 limits** is the fallback when the bindings are missing: each
check upserts a bucket row (one per network, one for the global ceiling) that the cleanup deletes later. **Cleanup**
is the daily cron deleting the same rows after their retention. A delete is billed like an insert, so it counts here.

Rows per affected row, by table:

| Table | Insert | Update | Delete | Why |
| --- | --- | --- | --- | --- |
| `lite_attempts` | 1 (was 4) | 1 | 1 (was 4) | WITHOUT ROWID, keyed by `(dare_key, device_key)`, no other index (migration 0004) |
| `rate_buckets` | 1 (was 3) | 1 | 1 (was 3) | WITHOUT ROWID, no window index (0004) |
| `lite_goal` | 1 (was 2) | 1 | 1 (was 2) | WITHOUT ROWID (0004) |
| `daily_results` | 4 | — | 4 | the table, the `submission_id` key and two indexes; unchanged |
| `daily_stats` | 2 | 1 | 2 | the table and its `(daily_id, content_version)` key; the counter update touches no index |

Rows per operation. The test runs 50 players on 50 networks. Rows they share (the day's `daily_stats` row, the goal
row, the global-ceiling bucket) are spread across them, which is where the .02s come from:

| Operation | Setup | First request | Second request | Cleanup, later | **Total** |
| --- | --- | --- | --- | --- | --- |
| Answered dare, default mode (`t`) | bindings | start 1 | grade 1 | 1 | **3** |
| Answered dare, default mode (`t`) | D1 limits | start 3 | grade 3 | 2.02 | **8.02** |
| Answered dare, replay mode (`v`) | bindings | start 1 | grade 3 (attempt, goal-cap bucket, goal row) | 2.02 | **6.02** |
| Answered dare, replay mode (`v`) | D1 limits | start 3 | grade 5 | 3.04 | **11.04** |
| Daily result | bindings | submit 5.02 (result 4, stats 1.02) | — | 4.04 | **9.06** |
| Daily result | D1 limits | submit 7.02 | — | 5.06 | **12.08** |
| Uncached stats read | bindings | 0 | — | 0 | **0** |
| Uncached stats read | D1 limits | 2 | — | 1.02 | **3.02** |
| Goal read | goal off (the default) | 0, answered without touching D1 | — | — | **0** |
| Uncached goal read | goal on, D1 limits | 2 | — | 1.02 | **3.02** |

Rows read stay far inside the allowances. Lookups read a row or two, the edge cache absorbs repeated stats reads, and
the cleanup seeks by key or index instead of scanning: bucket keys start with their window's minute, and
`lite_attempts` is walked once per run with a cursor. That is roughly 160,000 rows read a day at the free plan's
ceiling (limit 5 M), and about 5 M a day at one million players (about 154 M a month, against 25 billion included).

## Totals

### Daily results only (verified dares off, today's default)

Per player per month: 24 requests, 72.48 rows written with the bindings, about 24 CPU-ms and 14.4 KB stored.

| MAU | Requests a day | Rows written a day | Stored | Expected cost |
| --- | --- | --- | --- | --- |
| Offline only | 0 | 0 | 0 | $0 |
| 1,000 | 800 | 2,416 | 14 MB | $0 |
| 10,000 | 8,000 | 24,160 | 144 MB | $0 |
| 100,000 | 80,000 | 241,600 | 1.44 GB | $5 (Workers Paid: writes pass the free 100,000 a day; 2.40 M requests and 7.25 M rows a month are inside the allowance) |
| 1,000,000 | 800,000 | 2,416,000 | 14.4 GB, over D1's 10 GB per database; 7.2 GB with results kept 90 days | **$33.33 a month** with 90-day results: $5 + 24 M requests ($4.20) + 72.48 M rows ($22.48) + 7.2 GB ($1.65) |

* **Free plan ceiling: about 34,700 MAU.** The 500 MB database fills first; writes would allow 41,391 and requests
  125,000.
* **$5 range: to about 347,000 MAU**, where storage passes the 5 GB included (then $0.75 per GB). Requests pass the
  10 M included at 416,667 MAU and writes the 50 M at 689,845. The 10 GB database limit is reached at about 694,000
  MAU with 180-day retention.

### With verified dares, default mode (`t`)

Per player per month: 44 requests, 96.48 rows written, about 44 CPU-ms and 15.8 KB stored.

| MAU | Requests a day | Rows written a day | Stored | Expected cost |
| --- | --- | --- | --- | --- |
| 1,000 | 1,467 | 3,216 | 16 MB | $0 |
| 10,000 | 14,667 | 32,160 | 158 MB | $0 |
| 100,000 | 146,667 | 321,600 | 1.58 GB | $5 (4.40 M requests and 9.65 M rows a month, inside the allowance) |
| 1,000,000 | 1,466,667 | 3,216,000 | 15.8 GB, too big for one database; 8.59 GB with 90-day results | **$64.65 a month** with 90-day results: $5 + 44 M requests ($10.20) + 96.48 M rows ($46.48) + 44 M CPU-ms ($0.28) + 8.59 GB ($2.69) |

* **Free plan ceiling: about 31,100 MAU** (writes 31,095; storage 31,672; requests 68,182).
* **$5 range: to about 227,000 MAU**, where requests pass 10 M a month. Just past it the extra is pennies ($5.04 at
  230,000 MAU). Storage passes 5 GB at 316,723 MAU and writes pass 50 M at 518,242.

### With verified dares, replay mode (`v`, Workers Paid from the start)

Replaying the last questions of a chapter takes more than the free plan's 10 ms of CPU, so this mode needs Workers
Paid at any size. Per player per month: 44 requests, 120.64 rows written, about 116 CPU-ms and 15.8 KB stored.

| MAU | Rows written a day | Expected cost |
| --- | --- | --- |
| 1,000 | 4,021 | $5 |
| 10,000 | 40,213 | $5 |
| 100,000 | 402,133 | $5 (12.06 M rows and 11.6 M CPU-ms a month, inside the allowance) |
| 1,000,000 | 4,021,333 | **$90.25 a month** with 90-day results: $5 + requests ($10.20) + 120.64 M rows ($70.64) + 116 M CPU-ms ($1.72; $3.32 if every start replayed the last question) + storage ($2.69) |

* **$5 range: to about 227,000 MAU** (requests). CPU passes 30 M ms at 258,621 MAU and writes at 414,456.

### Without the Rate Limiting bindings (D1 limits only)

Assumes 10 % of stats and goal reads miss the edge cache.

| Configuration | Rows written per MAU-month | Free plan ceiling | Writes allowance on Paid | 1M MAU, 90-day results |
| --- | --- | --- | --- | --- |
| Daily results only | 101.47 | 29,565 | 492,747 | $62.36 |
| With verified dares (`t`) | 165.63 | 18,112 | 301,874 | $133.92 |
| With verified dares (`v`) | 191.00 | Paid only | 261,780 | $160.73 |

The bindings roughly halve the database bill, so keep them configured. If a binding call fails, the Worker falls back
to D1 buckets for that request rather than skipping the limit.

### Storage at scale

Daily results are kept 180 days, so they take most of the space: about 14.4 KB per player. At the free plan's 500 MB
database limit that is about 34,700 MAU (31,700 with verified dares); on Workers Paid the 10 GB database limit is
reached at about 633,000 to 694,000 MAU. Before that, lower `RESULT_RETENTION_DAYS` (`backend/src/contract.ts`) to 90
days, which halves the space; the one-million totals above assume it. Attempts add about 1.4 KB per player (they live
at most 8 days) and rate buckets almost nothing.

## Abuse exposure

Per-network limits stop one network: an IPv4 address or an IPv6 /64. Rotating addresses gets past them, so global
ceilings bound the total. With the bindings, `RL_GLOBAL` allows 1,200 POSTs a minute per Cloudflare location. A
sustained flood of fresh daily results at that rate writes at most about 8.7 M rows a day per location. Other floods
write less: 5.2 M for replay grades, 1.7 M for dare starts.

* **Free plan:** the daily quota runs out and the API stops answering until the next UTC day. Play is unaffected, and
  nothing is billed.
* **Workers Paid:** about $8.70 a day in writes plus $0.52 in requests, per location, while the flood lasts.

To limit that exposure:

* set the global ceilings (`RL_GLOBAL` and `RATE_LIMIT_GLOBAL_*`) to about twice your real peak;
* set Cloudflare billing notifications;
* keep the kill switches ready.

A WAF rate-limiting rule (`docs/BACKEND.md`, "Abuse and threat model") blocks floods before they reach the Worker, but
it needs the API on a custom domain in a Cloudflare zone.

## Controls

* **Cloudflare:** set usage notifications (Workers requests, D1 rows written, storage) in the account dashboard. The
  free plan stops at its quotas and never bills.
* **PostHog:** set a billing limit of $0–$10 in project settings. If volumes grow, add `VITE_ANALYTICS_SAMPLE`-style
  sampling (not implemented; events are small). At 100k MAU, 25 events a month each is 2.5 M events, about 1.5 M over
  the free 1 M. Sample to stay free.
* **Kill switches:**
  * at build time: `VITE_KILL_COMMUNITY=1`, `VITE_KILL_ANALYTICS=1`;
  * on the Worker: `KILL_LITE_DARES=1`, or remove `DARE_SIGNING_KEY`. The dare endpoints then answer 503 and apps fall
    back to local play;
  * in the Cloudflare dashboard: disable the Worker route.
* **Backend limits:**
  * per-network limits with the D1 fallback: `RATE_LIMIT_PER_MINUTE` (30), `RATE_LIMIT_READS_PER_MINUTE` (120) and
    `RATE_LIMIT_DARES_PER_MINUTE` (60). With the bindings, the binding's own limit applies;
  * global ceilings: `RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE` (1,200) and `RATE_LIMIT_GLOBAL_READS_PER_MINUTE` (2,400), or
    the `RL_GLOBAL` binding;
  * the edge cache (300 s) absorbs repeated reads;
  * a deployment without `RATE_SALT` refuses writes.
* **Replay CPU:** leaving `LITE_VERIFY_REPLAY` at `0` keeps CPU within the free plan.
* **Cleanup budget:**
  * `CLEANUP_MAX_QUERIES` (45) is the number of D1 statements one daily cleanup may run, each deleting up to 2,000
    rows. It stays under the free plan's 50 queries per invocation and clears up to 90,000 rows a run.
  * With the bindings, about 0.53 rows per player expire each day (0.8 in replay mode). On Workers Paid, raise the
    budget (up to 1,000) past about 110,000 MAU in replay mode or 170,000 in the default mode. One million players
    need about 270 statements a day in the default mode and 400 in replay mode.
  * The cleanup handles the most personal data first and leaves rate buckets for last.
  * A run that runs out of budget reports `cleanup_incomplete: 1` and logs a warning; the next run continues.
* **Client:** the outbox should cap retry attempts per queued result (lead-owned) so that a recovering backend is not
  flooded.

## Operating targets

* **Early pilot:** $0 a month on the free plan, with verified dares in the default mode.
* **Meaningful growth (up to 100k MAU):** $5 a month for Workers Paid plus any PostHog overage, under $25 a month.
* **Where the free plan ends:** at about 31,000 MAU with verified dares, or 34,700 without. D1's 100,000 writes a day
  and its 500 MB database limit are reached at about the same size, so move to Workers Paid before either.
* **Workers Paid:** stays at $5 to about 227,000 MAU with verified dares (347,000 without), then grows slowly.
* **One million players:** about $65 a month in the default mode ($90 in replay mode, $33 without verified dares).
  This assumes the 90-day results retention that one database then needs.
