# Cost model

**Local/offline configuration: $0 recurring.** Static hosting on GitHub Pages or Cloudflare Pages is free; the game
makes no network requests beyond its own files.

## Assumptions per monthly active user (MAU)

| Driver | Value |
| --- | --- |
| Daily starts | 12 / month |
| Official completions | 8 / month |
| Result submissions (opt-in) | 1 per official completion |
| Stats fetches | 2 per completion (result screen + a later look); edge cache 5 min per data centre, so only a small share reaches D1 |
| Database writes per accepted result | 3 rows (result insert, incremental `daily_stats` upsert, rate-bucket upsert) |
| Database work per uncached stats read | 1 rate-bucket write + 1 `daily_stats` row read (cache hits cost nothing) |
| Uncached stats reads | ≈ 2 % of stats fetches at 1k MAU, ≈ 5 % at 10k, ≈ 10 % at 100k (more data centres warm the cache as traffic spreads) |
| Analytics events | 25 / month |
| Storage per result row | ≈ 160 bytes |

## Free-tier limits used

Cloudflare Workers Free: 100,000 requests/day, 10 ms CPU/request. D1 Free: 5 M rows read/day, 100 k rows written/day,
5 GB. Cloudflare Pages / GitHub Pages: free. PostHog Cloud Free: 1 M events/month, 1-year retention.
Local notifications: free (device-side).

## Estimates

| MAU | Worker requests/day | D1 rows written/day | D1 rows read/day | Analytics events/month | Expected cost |
| --- | --- | --- | --- | --- | --- |
| Offline only | 0 | 0 | 0 | 0 | $0 |
| 1,000 | ≈ 800 (270 POST + 530 GET) | ≈ 820 | ≈ 300 | 25,000 | $0 |
| 10,000 | ≈ 8,000 | ≈ 8,400 | ≈ 3,000 | 250,000 | $0 |
| 100,000 | ≈ 80,000 | ≈ 86,000 | ≈ 33,000 | 2.5 M | $0–13: PostHog overage ≈ 1.5 M events ($0–8, or sample to stay free); D1 writes sit at ≈ 86 % of the free 100 k/day, so a launch spike or growth past ≈ 110 k MAU needs Workers Paid ($5/month, 50 M writes/month) |

How the numbers are built: POST/day = MAU × 8 completions ÷ 30 × opt-in share (100 % assumed, the worst case);
rows written = POST × 3 + uncached GET × 1; rows read = POST × 1 (rate-bucket `RETURNING`) + uncached GET × 2. Stats
reads no longer scale with the number of results that day: each uncached read touches one `daily_stats` row instead of
scanning every result, so D1 reads stay far below the 5 M/day limit at every size.

## Verified dares (Lite), when switched on

Off by default and not deployed; with it off nothing below applies. Assumptions, per monthly player who has opted in,
in a build with verified dares: **8 answered dares a month**, each answered dare later graded (worst case), and 4 goal
reads a month (mostly edge-cache hits, but every read is a Worker request).

| Per answered dare | Requests | D1 rows written | D1 rows read |
| --- | --- | --- | --- |
| start (`POST /v1/lite/attempts`) | 1 | 2 (attempt insert, rate bucket) | ≈ 3 (bucket `RETURNING`, two attempt lookups) |
| grade (`POST /v1/lite/attempts/:id/grade`) | 1 | 3 (attempt update, goal upsert, rate bucket) | ≈ 2 |
| **total** | **2** | **5** | **≈ 5** |

(The earlier estimate of about four writes per dare left out the daily goal row; the code writes five.)

Per player per day that is 8 × 2 / 30 + 4 / 30 ≈ **0.67 requests** and 8 × 5 / 30 ≈ **1.33 rows written**, on top of
the daily-results load above (≈ 0.8 requests and ≈ 0.86 writes per player per day). CPU: well under 1 ms per request
in the default mode; with `LITE_VERIFY_REPLAY=1` a start replays the dare (≈ 1–20 ms, more on the last questions),
which is why that mode needs Workers Paid from day one.

| Monthly players (all opted in) | Dare requests/day | Dare rows written/day | All rows written/day (with daily results) | Expected cost |
| --- | --- | --- | --- | --- |
| 1,000 | ≈ 670 | ≈ 1,330 | ≈ 2,200 | $0 |
| 10,000 | ≈ 6,700 | ≈ 13,300 | ≈ 22,000 | $0 |
| 45,000 | ≈ 30,000 | ≈ 60,000 | ≈ 99,000 | $0, at the free 100 k writes/day limit |
| 100,000 | ≈ 67,000 | ≈ 133,000 | ≈ 219,000 | $5 (Workers Paid; ≈ 6.6 M writes and ≈ 4.4 M requests a month are inside its allowance) |
| 1,000,000 | ≈ 670,000 | ≈ 1.33 M | ≈ 2.2 M | ≈ $31/month in total: $5 + requests ≈ 44 M/month ($10.20 over the 10 M included) + writes ≈ 66 M/month ($15.80 over the 50 M included) + CPU ≈ $0.30 |

So: free up to about **45,000** monthly players (corrected from the earlier "about 50,000", because of the fifth write),
then a flat **$5/month** up to about 230,000 players (where requests pass Workers Paid's 10 M a month), and about
**$31/month** in total at one million (corrected from "about $22", for the same reason plus the goal reads). With
`LITE_VERIFY_REPLAY=1` the $5 plan is needed from the start; at one million players the extra CPU adds about $1.
Paid-plan prices as used here (check the current Cloudflare pricing page before relying on them): Workers Paid $5/month
including 10 M requests ($0.30 per extra million) and 30 M CPU-ms ($0.02 per extra million); D1 on Workers Paid
including 25 billion rows read and 50 M rows written a month ($1.00 per extra million rows written). Attempts live 7
days (≈ 300 bytes each, ≈ 0.6 GB at one million players), inside the 5 GB included.

## Controls

* Cloudflare: set a usage notification (Workers requests, D1 reads) in the account dashboard; the free plan simply
  throttles above quota — it never bills.
* PostHog: set a billing limit of $0–$10 in project settings; add `VITE_ANALYTICS_SAMPLE` style sampling if volumes grow
  (not implemented; events are small).
* Kill switches: `VITE_KILL_COMMUNITY=1`, `VITE_KILL_ANALYTICS=1` at build time; Worker route disable in the dashboard.
* Backend: `RATE_LIMIT_PER_MINUTE` (writes) and `RATE_LIMIT_READS_PER_MINUTE` (uncached reads) bound per-address
  abuse; the edge cache (300 s) absorbs repeated stats reads; a deployment without `RATE_SALT` refuses writes.
* Verified dares: `RATE_LIMIT_DARES_PER_MINUTE` (60) bounds start and grade per address; `KILL_LITE_DARES=1` or
  removing `DARE_SIGNING_KEY` turns them off server-side (503, apps fall back to local); leaving
  `LITE_VERIFY_REPLAY` at `0` keeps CPU within the free plan.
* Client: the outbox should cap retry attempts per queued result (lead-owned) so a recovering backend is not flooded.

## Operating targets

Early pilot: $0–5/month. Meaningful growth (≤ 100 k MAU): under $25/month with the assumptions above (at most
$5 Workers Paid + a small PostHog overage), excluding unusually high analytics volume. The binding free-tier limit is
D1's 100 k row writes/day, reached at roughly 110 k MAU with full opt-in; everything else has at least a 10× margin.
With verified dares switched on, the same limit is reached at about 45 k MAU, after which Workers Paid ($5/month) covers
growth to about 230 k MAU; the ≤ 100 k MAU target stays under $25/month.
