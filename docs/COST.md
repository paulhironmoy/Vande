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

## Controls

* Cloudflare: set a usage notification (Workers requests, D1 reads) in the account dashboard; the free plan simply
  throttles above quota — it never bills.
* PostHog: set a billing limit of $0–$10 in project settings; add `VITE_ANALYTICS_SAMPLE` style sampling if volumes grow
  (not implemented; events are small).
* Kill switches: `VITE_KILL_COMMUNITY=1`, `VITE_KILL_ANALYTICS=1` at build time; Worker route disable in the dashboard.
* Backend: `RATE_LIMIT_PER_MINUTE` (writes) and `RATE_LIMIT_READS_PER_MINUTE` (uncached reads) bound per-address
  abuse; the edge cache (300 s) absorbs repeated stats reads; a deployment without `RATE_SALT` refuses writes.
* Client: the outbox should cap retry attempts per queued result (lead-owned) so a recovering backend is not flooded.

## Operating targets

Early pilot: $0–5/month. Meaningful growth (≤ 100 k MAU): under $25/month with the assumptions above (at most
$5 Workers Paid + a small PostHog overage), excluding unusually high analytics volume. The binding free-tier limit is
D1's 100 k row writes/day, reached at roughly 110 k MAU with full opt-in; everything else has at least a 10× margin.
