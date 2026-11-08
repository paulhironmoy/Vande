# Backend: data model, API, operations, retention, deletion and costs

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. Nothing here is deployed; deploying needs the owner (`docs/LAUNCH_BLOCKERS.md`).

It extends the existing Worker (`backend/`): the `/v1` auth, profile, push, report and block routes, the security
modules, the guards, and ops (audit, metrics, queues, cron). New resources live under `/v2` (`CONTRACTS.md` §7).

## 1. Durable Objects

| Object | Key | Owns | Patterns reused from `MatchDO` and `CupDO` |
| --- | --- | --- | --- |
| **`OverDO`**, `challenge` mode [S4] | Challenge id `o…` | Everything listed below | One-at-a-time op queue, batched storage writes, object-scoped idempotency records, `bt` ball tokens, invite codes, activity jitter, the reveal slot, gzip compaction |
| **`OverDO`**, `today_attempt` mode [S5] | `idFromName(attemptId)`, where the attempt id is derived from the day and the player | One ranked attempt: the same per-ball engine, and the definition read once from D1 and cached in memory | Writes `today_scores` once at the finish. Deletes its storage 7 days after the day closes. |
| **`TournamentDO`** [S6] | `t…` | Membership, schedule alarms, one `OverDO` per round (league) or per tie (knockout), table, bracket, final | `CupDO` structure; `schedule.ts` pace presets; round reveal |

What the `OverDO` in `challenge` mode owns:
- the sealed definition (AES-GCM, HKDF purpose `challenge`, AAD `id|sim|commit`), its salt and commitment;
- the seats;
- every attempt's per-ball state;
- the deadline and reveal alarms;
- the reveal and the rematch offer;
- unique-opener hashes, deleted at the reveal;
- writes to D1: players, results, rivalry, series.

**Durable Object duration billing.** Per the pricing page (Oct 2026), objects are billed while "actively running or…
idle in memory but unable to hibernate". An idle object becomes eligible to hibernate after 10 s with no pending
I/O, timers or standard WebSockets. So:
- **Never use `setTimeout` or `setInterval`, and never hold outbound connections, in these objects.** Use storage alarms only.
- Requests to other objects (room, cup) are best-effort calls that finish before the response.

Breaking this rule costs about $2,150 a month at 1M MAU: 15.3M attempts × 90 s × 0.125 GB × $12.50 per million GB-s.
`docs/COST_MODEL.md` does not count duration today. Add it.

## 2. D1 tables (migration `0009_growth.sql` and later; 0001–0008 are kept as they are)

| Table | Key | Purpose | Retention |
| --- | --- | --- | --- |
| `challenges` | `challenge_id` | Lists, cron cleanup: creator uid, state, seats, deadline, sim, rematch/series/tournament links | 400 days |
| `challenge_players` | (`uid`, `challenge_id`), with an index on `challenge_id` | The home list: role, seat state, runs, wickets, rank, a redacted `view_json` | 400 days |
| `challenge_codes` | `code` | Code → challenge, signed token, expiry, revoked | Deleted the day after expiry |
| `today_overs` | `day` | rev, sim, commitment and signature, encrypted definition, story report, state, approver | 400 days (the definition is public after the day) |
| `today_scores` | (`day`, `uid`), with an index (`day`, `runs` DESC, `wickets`) | Boards: runs, wickets, concealed finish ms, city, flags, counted | 90 days (boards readable for 30) |
| `today_score_counts` | (`day`, `runs`, `wickets`) | Histogram for ranks and percentiles, kept by triggers, as `daily_score_counts` | 90 days |
| `rivalries` | (`uid_lo`, `uid_hi`) | Record, last5, streak, best chase, closest, decisive (JSON, ≤ 3), preferences, version | Until either account is deleted (then that side is anonymised) |
| `series` | `series_id` | The pair, best-of, score, state, next setter, game ids | 400 days |
| `play_days` | (`uid`, `day`) | The rhythm: local dates only | 400 days |
| `clip_codes` [S6] | `code` | Owner, scope, ball, kind, `over_playable`, alias consent snapshot | 90 days after the last open |
| `tournaments`, `tournament_players` [S6] | `tournament_id`; (`uid`, `tournament_id`) | Membership and lists | 400 days |
| `nudges` [S6] | (`from_uid`, `to_uid`, `scope_id`) | Nudge caps | 7 days |
| `claims` [S4] | `code` | Web-to-app claim code: uid, expiry, tries | 1 day |
| `metrics_daily` | (`day`, `metric`, `dims`) | Aggregates for the dashboards (counts only, no ids) | 400 days |
| `notify_prefs` (new columns) | `uid` | `time_zone`, `kinds_json`, `digest_hour` | With the account |

Reused unchanged: `accounts`, `sessions`, `identities`, `groups`, `group_members`, `blocks`, `reports`, `friends`
(now "completed a challenge together"), `push_tokens`, `idempotency`, `audit_log`, `share_moments` (moments add
`reveal`), `attribution_daily`.

**D1 limits to watch** (docs, Oct 2026):
- the database is at most 10 GB;
- an invocation runs at most 1,000 queries.

The estimates in §6 reach about 12 GB of storage and about 530 writes per second at peak at 1M MAU. **Plan the split
at about 300k MAU:** shard the hot write tables (`today_scores`, `play_days`, `challenge_players`) by uid hash across
2–4 databases, or move the per-day boards into one DO per day shard. Below 100k MAU a single database is comfortable
(about 53 writes per second at peak).

## 3. API properties (every `/v2` route)

| Property | How |
| --- | --- |
| Versioned | `/v2` path. `CHALLENGE_CONTRACT_VERSION` in bodies. Unknown fields refused. Responses carry `sim` and `contract`. |
| Idempotent and retry-safe | `Idempotency-Key` (a UUID) on every mutation. D1-scoped for Worker routes, object-scoped for `OverDO` routes. The same request replays the stored response; a different body gets `409`. A swing for an answered ball gets the stored verdict, or `409 already_answered` if it differs. |
| Server timestamps | Every transition is stamped by the server clock. Views use minutes; exact ms never leave the object (completion order is used only inside the ranking). |
| Validated | Structural checks before the engine. Integer wire format. Bodies of 4 KB or less (8 KB for a swing). JSON only. |
| Rate-limited | Existing bindings (`RL_NET`, `RL_INVITE`, `RL_PLAYER`, `RL_GLOBAL*`) plus the new daily caps (`LINKS.md` §6). |
| Authentication separate from public tokens | Challenge and tournament codes only ever *show* a preview and *ask* to join. Joining needs a bearer access token. Codes never grant an account. |
| Optimistic local recovery | The client stores attempt progress (issued and answered balls, pending swing) in IndexedDB. It resumes from `GET /v2/attempts/:id`, and the outbox retries queued swings with their original idempotency keys. |
| Fail closed | A missing secret (`TOKEN_KEYS`, `DATA_KEYS`, `SIGNING_KEY`) disables exactly the routes that need it (`503`), as today. |
| Kill switches | Flags from `GET /v2/config` (`MIGRATION.md` §2) and `VITE_KILL_ONLINE=1` on the client. Practice keeps working. |

## 4. Operations: cost dashboards and alerts

- **Billing alerts** (the owner sets them up): usage-based notifications at **$25, $50 and $100**, plus per-product usage alerts for Workers, Durable Objects, D1, R2 and Queues. This is the existing plan.
- **Admin console, Cost view:**
  - a daily read of the Cloudflare GraphQL Analytics API: Worker requests, CPU-ms, DO requests, rows written, D1 rows written and read, R2 operations, Queue operations, Analytics Engine points;
  - the projected monthly cost against the §6 prices.
  - Alert when the 7-day projection goes above the budget.
- **Unit-cost drift:** `backend/test/cost.test.ts` gains the growth units (rows per attempt, per challenge, per reveal) and fails if a change writes more. Production alerts when the rows-per-attempt measured from the counters moves more than 20% from the locked value.
- **Metrics** (Analytics Engine, no ids): `over_created`, `ball_issued`, `ball_answered` (live, late, settled), `verify_mismatch`, `flight_mismatch`, `version_refused`, `reveal`, `dnp`, `expired`, `rematch`, `board_read`, `flag` (by code), `review_action`, `notify_*` (existing), `share_moment`.

## 5. Retention and account deletion

The retention periods are in the §2 table. In addition:
- **Challenge objects** delete their storage 30 days after the reveal.
  - Before deleting, they archive the reveal (definition, salt, verdicts and swings; about 2 KB gzip) to R2 `logs/o/<id>.json.gz`.
  - That archive is kept 400 days, for rivalries and disputes.
- **Unique-opener hashes** are HMAC(rotating daily salt, IP/64 + UA), held only in the challenge object and deleted at the reveal.
- **Idempotency** 24 h, and **audit** 180 days (existing).

**Account deletion** (`DELETE /v1/me`, extended):
- **Every `OverDO` the player sits in:** the seat becomes "Deleted player". An attempt in progress becomes DNP. The archive in R2 is rewritten.
- **Today:** `today_scores` rows are deleted, and the attempt objects forget the player.
- **Rivalries and series:** this player's side is anonymised (`x:deleted`). The other player keeps their history against "Deleted player".
- **Deleted outright:** `play_days`, `clip_codes` (their links stop working), `claims`, `nudges` and push prefs.
- **Tournaments:** the member becomes "Deleted player", and future rounds count them as DNP.
- **Export** (`POST /v1/me/export`) gains: challenges and seats, attempts (own swings and verdicts), rivalries, series, Today scores, play days, clips, notification prefs.
- **Privacy notice additions:** the per-ball inputs (normalised swing, no raw gestures), the rhythm dates, and the timezone.

## 6. Cost bands (estimates)

**Method:** the `docs/COST_MODEL.md` approach.
- Per-action units are modelled on the **measured** units in that file (`backend/test/cost.test.ts` on real SQLite).
- Prices: Cloudflare docs checked on 2026-10-25 (Workers Oct 2, DO Oct 18, D1 Apr 21, Queues Apr 21, R2 Oct 1, Analytics Engine Apr 23, Observability from 2026-12-01).
- The figures were computed by a script, not by hand. It is an uncommitted scratch script; Stage 4 adds it as `scripts/growth-cost-model.mjs` and reruns it with measured units.
- **All are ESTIMATES until Stage 4 measures the real units.**

**Assumptions per daily active player per day:**

| Item | Value |
| --- | --- |
| Ranked attempts | 1.7 (0.7 Today's Over + 1.0 challenge) |
| Challenges created | 0.3 |
| Link opens | 0.6 |
| Joins | 0.6 |
| Reveals | 0.3 |
| Reveal views | 0.8 |
| Board reads | 1 |
| Session and profile requests | 7 (the existing figure) |

**Units per action:**

| Action | Requests | DO rows | D1 rows written | DO active time | Other |
| --- | --- | --- | --- | --- | --- |
| Attempt | 13 | 17 | 7 | about 0.21 s | |
| Challenge creation | 2 | 6 | 8 | | |
| Reveal | | 3 | 7 | | 2.5 queue messages |
| Board read | | | | | About 400 D1 rows read |

**Other inputs:**
- 6 Analytics Engine points per daily player after sampling;
- logs sampled at 0.1;
- the DO duration estimate assumes hibernation-eligible objects.

| | 1,000 MAU | 10,000 MAU | 100,000 MAU | 1,000,000 MAU |
| --- | --- | --- | --- | --- |
| DAU at DAU/MAU 0.3 (the brief's gate) | 300 | 3,000 | 30,000 | 300,000 |
| Worker requests a month | 0.3 M | 3.0 M | 30 M | 300 M |
| DO requests / DO rows written | 0.2 M / 0.3 M | 2.2 M / 3.0 M | 22 M / 30 M | 220 M / 298 M |
| D1 rows written / read | 0.2 M / 0 | 2.3 M / 0.04 B | 23 M / 0.4 B | 230 M / 4.0 B |
| DO duration | 450 GB-s | 4.5 K GB-s | 45 K GB-s | 452 K GB-s |
| **Monthly cost at DAU/MAU 0.3** | **≈ $5** (base plan only) | **≈ $5.20** | **≈ $15** | **≈ $610** |
| **Monthly cost at DAU/MAU 0.2** | ≈ $5 | ≈ $5.10 | ≈ $11 | ≈ $370 |

The 1M MAU line at 0.3:

| Line | Monthly |
| --- | --- |
| DO rows written | $248 |
| D1 rows written | $180 |
| Worker requests | $87 |
| DO requests | $33 |
| CPU | $14 |
| Analytics Engine | $11 (not billed yet) |
| R2 | $8.50 |
| Queues | $7.70 |
| DO storage | $6.50 |
| D1 storage | $5.30 |
| DO duration | $0.65 |
| Logs | $0 (within 50 GB) |
| Base | $5 |

**Not included:**
- a domain (about $10–30 a year, unverified);
- PostHog beyond its free tier, if consented analytics is enabled;
- the optional publishing programme ($0 at the default YouTube quota, and about $32 a month at 100 Shorts a day, per `COST_MODEL.md`);
- FCM (free);
- clips ($0, rendered on the device).

**Levers, in order of payoff:**
1. Merge `swing` with the next `bowl` when the player is ready. That gives 7 requests and rows per attempt instead of 13 and 17: about −40% of the two largest lines.
2. One DO storage row per request.
3. Fewer D1 indexes, and one attempt-summary write.
4. Shard D1 at about 300k MAU (§2).
5. Lower log sampling.
