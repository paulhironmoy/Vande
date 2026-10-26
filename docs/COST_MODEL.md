# Cost model

Status: wave C (adds ratings, the Daily Top 100, highlight rendering and YouTube uploads, R2 replay archive) on top of
duels, Group Cups, Cricket Rooms, Daily Six, leaderboards and notifications. Platform-owned. Targets from the brief: **about $25 a month expected, $100 a month ceiling
through early launch, billing alerts at $25, $50 and $100, no always-on servers.** Everything here is serverless and
billed per use; nothing is deployed yet, so every number is an estimate built from measured units.

## Measured units

From `npx vitest run backend/test/cost.test.ts --silent=false` (the real Worker and MatchDO code on the real D1
migrations in SQLite, rows counted with D1's billing rule: one row per affected row plus one per index touched) and
`backend/test/realEngine.test.ts` (replay size with the real engine).

| Operation | D1 rows written | Notes |
| --- | --- | --- |
| Guest sign-up | 9 | account (+ player id index), session (+ uid index), idempotency claim (+ expiry index) and completion, audit row, daily-cap bucket |
| Refresh | 4 | session rotation, idempotency claim (+ index) and completion |
| Create duel | 7 | idempotency (3), audit, daily-cap bucket, creator's match-list row, the short invite code |
| Accept invite | 3 | two match-list rows, audit |
| Lock an over | 3 | two match-list rows, audit |
| Bat an innings (7 balls) | 2 | match-list rows when the innings completes (balls themselves write no D1 rows) |
| Last innings + reveal | 9 | match-list rows, audit, result row (+ day index), friends (both directions), both players' ratings (trigger); plus 1 R2 class A write (replay archive) |
| Profile edit | 4 | account update, idempotency (3) |
| Share a moment | 1 | the first time a player opens a moment's share (share_moments); asking again writes nothing |

Per duel (two players, both innings, reveal), measured: **32 Worker requests, 32 match-object requests (+6 room-object
requests), 53 Durable Object keys written (the test caps it at 55), 27 D1 rows written, 1 R2 write**; stored per revealed match ≈ 7 KB compressed replay (real engine; 45 KB of
JSON uncompressed) + ≈ 7 KB of match state after the reveal-time compaction. Planning figures below add the
invite preview, about six match views and four list reads per duel: **45 Worker requests and 40 Durable Object
requests per duel**. With the D1 rate-limit fallback instead of bindings the same flow writes 146 D1 rows (two
sign-ups included), which is why production uses the Rate Limiting bindings.

**Production timing** (the activity jitter, `ACTIVITY_JITTER_S` 60–600 s, and the duel reveal slot,
`DUEL_REVEAL_SLOT_S` 300 s; both are off in the tests above and in local runs). Each lock and each finished innings
becomes visible to the opponent at its own later time, and the reveal waits for its slot, so a duel gets **up to 5
alarm invocations** (two lock and two completion visibility times and the reveal slot; fewer when a request arrives
first) and the meta writes they make. Measured from creation to reveal (`cost of production timing`): 3 alarms,
**58 Durable Object keys written against 54** for the same duel revealed at once, and the same D1 rows (29 against 30:
a player's match-list row is rewritten only when their own view changes). The reveal slot's alarm is one of the five.
The anonymous rate-limit binding (`RL_GLOBAL_ANON`) is one more binding call on anonymous requests and on failed
sign-ins, not billed separately.

Per active player per day, outside matches: about 7 requests (two refreshes, profile and list reads) and 8 D1 rows.
Notifications: about 5 queue messages per duel, 3 queue operations each.

### Social product (measured, `backend/test/cost.test.ts`)

| Unit | Worker requests | Durable Object requests | DO keys written | D1 rows written | D1 rows read |
| --- | --- | --- | --- | --- | --- |
| Cup fixture (4-player cup, 7 fixtures incl. final, everyone playing) | ≈ 45 | ≈ 32 match + 11 cup + 5 room | ≈ 51 | ≈ 19 (match lists, result, friends, audit) | small |
| Cup creation + joins (per player) | 1 | 2 (cup, room) | — | ≈ 2 (cup membership, idempotency) | small |
| Daily Six attempt (start, 7 balls, result) | 16 | 16 | 26 | 10 (claim, score + histogram trigger, streak, finish) | small |
| Leaderboard read (national or city) | 1 | 0 | 0 | 0 | ≈ 200 top rows + a few hundred histogram rows |
| Room view / reaction / banter | 1 | 1 | 1 (post or reaction) | 0 (settings: 1) | 1 (blocks) |

Daily Six attempt objects delete themselves 30 days after their reveal (their scores live in D1), so Daily Six never
accumulates object storage.

### Daily Top 100 and highlights (measured, `backend/test/cost.test.ts`)

| Unit | D1 rows written | Other |
| --- | --- | --- |
| Cutoff, per ranked player | ≈ 3 (entry + index, badge) | one read of the day's results (≈ 1 row read per finished match) |
| Cutoff, per highlight job | ≈ 9 (job + 4 indexes + 2 unique keys + day row share) | up to 1 cup object request (fixture label); 1 push per ranked player |
| Consent (first / last participant, incl. automatic checks) | 4 / 14 | 1 R2 read (replay) + `verifyMatchLog` (≈ 5 ms CPU) |
| Render claim / upload + complete | 4 / 5 | the MP4 streamed into R2 (1 class A write; 10–30 MB) |
| Admin approval | 8 | |
| YouTube upload + publish | 11 | 1 R2 head + 1 range read per 8 MiB chunk (class B), 1 room post, 2 pushes |
| Per published highlight, end to end | ≈ 55 | ≈ 5 R2 operations, ≈ 20 MB stored for 72 h |

At 100 highlights a day: ≈ 5,500 D1 rows a day (≈ 165 K a month, inside the included 50 M), ≈ 15 K R2 operations a
month (included) and ≈ 2 GB of temporary video at any time (≈ $0.03 a month). The cutoff itself writes ≈ 1,200 rows
a day for 100 ranked players and ≈ 80 jobs.

**R2 replay archive**: one class A write per revealed duel or cup match (≈ 7 KB gzip). At 10,000 DAU (≈ 150 K matches a
month) that is ≈ 150 K class A operations (included up to 1 M) and ≈ 1 GB a month of storage (≈ $0.015 per GB-month,
growing by about that each month: ≈ $0.20 a month after a year). Daily Six replays are not archived unless
`ARCHIVE_DAILY_LOGS=1` (≈ 600 K more writes a month at 10,000 DAU, ≈ $0 within the free 1 M, then $4.50 / M).

**Render job (Google Cloud Run jobs, asia-south1 list prices as understood when writing; verify)**: ≈ $0.000018 per
vCPU-second and ≈ $0.000002 per GiB-second after the monthly free tier (180,000 vCPU-seconds, 360,000 GiB-seconds).
A 45 s Short renders in about 2–3 minutes on 4 vCPU / 4 GiB (1,350 frames of SwiftShader WebGL, CDP capture and x264):
≈ 600 vCPU-seconds and 600 GiB-seconds per highlight. 100 a day → ≈ 1.8 M vCPU-seconds and 1.8 M GiB-seconds a month →
≈ (1.8 M − 0.18 M) × $0.000018 + (1.8 M − 0.36 M) × $0.000002 ≈ **$32 a month**, plus image storage in Artifact Registry
(< $1). At 5 uploads a day (default YouTube quota) the job stays inside the free tier. Levers: JPEG capture (default),
`preset veryfast` (≈ 30 % less CPU), rendering only approved-for-upload ranks while the quota is small.

**YouTube**: the Data API is not billed; the constraint is quota (YOUTUBE_OPERATIONS.md: 5 uploads a day by default,
250,000 units a day requested for 100).

## Price assumptions (Cloudflare Workers Paid list prices as understood when writing; verify before launch)

| Item | Included per month | Then |
| --- | --- | --- |
| Workers Paid plan | — | $5.00 base |
| Worker requests | 10 M | $0.30 / M |
| Worker CPU | 30 M CPU-ms | $0.02 / M CPU-ms |
| Durable Object requests | 1 M | $0.15 / M |
| Durable Object duration | 400 K GB-s | $12.50 / M GB-s |
| DO SQLite storage: rows written / read | 50 M / 25 B | $1.00 / M; $0.001 / M |
| DO stored data | 5 GB-month | $0.20 / GB-month |
| D1 rows written / read | 50 M / 25 B | $1.00 / M; $0.001 / M |
| D1 storage | 5 GB | $0.75 / GB-month |
| R2 | 10 GB-month, 1 M class A, 10 M class B | $0.015 / GB-month, $4.50 / M, $0.36 / M (no egress fees) |
| Queues | 1 M operations | $0.40 / M operations |
| Workers Logs | 20 M events | $0.60 / M |
| Analytics Engine | 10 M data points | $0.25 / M |
| Rate Limiting bindings, cron triggers | — | no separate charge at the time of writing |

Outside Cloudflare: FCM is free; Google sign-in is free; PostHog's free tier covers 1 M events a month (analytics are
opt-in); the YouTube Data API is quota-limited, not billed. The highlight render job (Cloud Run) is ≈ $0 at the default
quota (5 Shorts a day) and ≈ $32 a month at 100 Shorts a day (above).

## Scenarios

Assumption per active player per day (social mix): one match (a duel or a cup fixture; each match has two players, so
matches per day = DAU / 2), two Daily Six attempts, three leaderboard reads, four room views, plus sessions and
profile (≈ 7 requests). Per match: 45 Worker requests, ≈ 40 Durable Object requests (match, cup and room objects)
plus up to 5 alarm invocations (production timing), ≈ 53 + 4 (production timing) + 10 (room) DO rows written, ≈ 22 D1
rows written. The table below predates production timing: it adds ≈ 0.75 M DO requests (≈ $0.11) and ≈ 0.9 M DO rows
(included) a month at 10,000 DAU, and ≈ 2.25 M requests (≈ $0.34) and ≈ 2.7 M rows (≈ $2.70) at 30,000 DAU. Month 1 has no accumulated storage; month 12 adds a year of
stored matches and match-list rows.

| | 1,000 DAU | 10,000 DAU | 30,000 DAU |
| --- | --- | --- | --- |
| Matches (duels + cup fixtures) per month | 15 K | 150 K | 450 K |
| Daily Six attempts per month | 60 K | 600 K | 1.8 M |
| Worker requests | 2.1 M (incl.) | 20.6 M → $3.17 | 61.7 M → $15.50 |
| Worker CPU (≈ 2.5 ms avg) | incl. | 51 M ms → $0.42 | 154 M ms → $2.48 |
| Durable Object requests | 1.7 M → $0.11 | 17.3 M → $2.44 | 51.8 M → $7.61 |
| DO rows written | 2.5 M (incl.) | 24.8 M (incl.) | 74.3 M → $24.25 |
| D1 rows written | 1.2 M (incl.) | 11.9 M (incl.) | 35.7 M (incl.) |
| D1 rows read (≈ 400 per leaderboard read) | incl. | 0.4 B (incl.) | 1.1 B (incl.) |
| Queues (≈ 7 messages per match, 3 operations each) | incl. | 3.2 M → $0.86 | 9.5 M → $3.38 |
| Analytics Engine | incl. | ≈ 5 M (incl.) | ≈ 15 M → $1.25 |
| Workers Logs (sampling 1.0) | incl. | 20.6 M → $0.33 | 61.7 M → $24.99 (≈ $0 at 0.3) |
| **Month 1 total** | **≈ $5** | **≈ $12** | **≈ $85** (≈ $60 with log sampling) |
| **Month 12 without archival** | **≈ $5** | **≈ $17** | **≈ $108** (≈ $83 with sampling) |
| **Month 12 with archival and 180-day lists** | **≈ $5** | **≈ $13** | **≈ $63** |
| Highlights at 100 a day (render job; D1, R2 and queues are within the included amounts) | + ≈ $32 | + ≈ $32 | + ≈ $32 |

So the launch target (about $25) holds comfortably past 10,000 daily players while YouTube allows only the default 5
uploads a day (the render job then stays in its free tier). With the quota extension for 100 Shorts a day the render
job adds ≈ $32: about $45 at 10,000 DAU, still under the $100 ceiling; at 30,000 DAU the ceiling needs log sampling
and archival. At scale the dominant lines are Durable Object rows written (≈ 67 per match with production timing,
26 per Daily attempt) and Worker requests; the first levers below address both.

## Levers (in order of payoff)

0. **Fewer DO writes per ball**: today each `next` and each `shot` writes the innings record (two keys per ball).
   Writing the reveal of the next ball and the answer of this one in one record per ball, or batching both into one
   request (the next item), halves the dominant cost at scale.
1. **Drop old match objects after 30 days**: every duel and cup replay is now archived to R2 at the reveal
   (`logs/<matchId>.json.gz`) and highlights read it from there, so a match object could `storage.deleteAll()` a month
   after its reveal and serve old reveals from R2 (needs a read path in `GET /v1/matches/:id/reveal`): bounds DO
   storage to about a month of matches; R2 at $0.015/GB is 13× cheaper.
2. **Shorter match-list retention or compact views** (`match_players.view_json` is the full MatchView): 180 days
   instead of 400 halves D1 storage.
3. **Log sampling**: `head_sampling_rate = 0.2–0.4` in `[observability]` once traffic grows; errors are still counted
   unsampled in Analytics Engine.
4. **Fewer round trips per ball**: a later protocol option is to return the next delivery with a shot's answer when
   the client asks for it (halves batting requests); views are already pushed via notifications rather than polled.
5. **Rate Limiting bindings, not D1 buckets** (already the production path): the D1 fallback triples D1 writes.
6. Already done: per-ball idempotency records live in the innings record (cut DO writes per duel from 106 to 50),
   reveal-time compaction (stored state per match from ~30 KB to ~7 KB plus the replay), Analytics Engine sampling
   for high-volume counters, WITHOUT ROWID tables with few indexes.

## Alerts and guard rails (activation)

* Cloudflare dashboard → Notifications → Billing: usage-based billing alerts at **$25, $50 and $100** for the
  account; also per-product usage alerts for Workers, Durable Objects and D1.
* Google Cloud (Cloud Run render job, FCM project): budget with alerts at $10, $25, $50; cap the render job with
  `MAX_JOBS` and the scheduler's window, and keep `--max-retries 0` (the Worker retries failed renders itself).
* Abuse cannot run the bill up silently: global ceilings (`RL_GLOBAL`), per-network and per-account limits, daily
  caps, and the zone WAF rule. Kill switches: `VITE_KILL_ONLINE=1` for clients, unsetting `RATE_SALT` (503 for all).
* Re-measure after any schema or protocol change: the cost test locks its numbers and fails when a change writes
  more rows; update this file with the new table.
