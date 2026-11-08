# Analytics: taxonomy, funnels, dashboards and the validation gates

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. Scores and gates use the sequence's labels: **VERIFIED** (reproducible, with real
> players where needed), **PROVISIONAL** (internal or automated only) and **UNPROVEN** (no adequate evidence). Every
> production metric below is **UNPROVEN** until production data exists. The growth brief's "unvalidated" maps to
> UNPROVEN.

## Three sources (nothing personal in any of them)

| Source | What it holds | Consent | Status |
| --- | --- | --- | --- |
| **S — Server-derived aggregates** | Counts computed from the state the server already keeps to run the game: challenges, seats, attempts, reveals, rematches, joins, preview opens deduplicated per challenge, Today attempts, rhythm days. Written nightly into `metrics_daily` as counts only. | None needed: no new data is collected, only aggregates of operational records | Recommended |
| **A — Anonymous milestone counters** (`POST /v2/m`) | Id-free counter events with closed vocabularies (below), stored in Analytics Engine. Each milestone fires **at most once per install**, deduplicated by a flag on the device and tagged with the install's **cohort day**, so the counts are devices without any identifier. | **Owner and legal decision O4.** Recommended: on by default, disclosed in the notice, with a "Help count anonymously" switch in Settings, and honouring DNT/GPC. This changes today's posture, where all client analytics is opt-in. | Decision needed |
| **P — PostHog** (existing, opt-in) | The closed dictionary below, with the monthly-rotating id | Opt-in, unchanged | Exists |

Without **A**, the Practice-side and retention gates can only be measured on the consenting subset, which is biased.
The social-loop funnels (**S**) do not need **A** or **P**.

## 1. Event taxonomy (extends `src/contracts/analytics.ts`)

New **P** events, closed names:

| Event | When |
| --- | --- |
| `app_launch` | Every app start |
| `first_delivery` | Existing |
| `practice_*` | Existing |
| `challenge_created` | The setter finished; the link exists |
| `share_initiated` / `share_completed` | Existing; `mode` gains `sealed_over`, `tournament`, `today`, `clip` |
| `challenge_link_opened` | The preview rendered (web or app) |
| `challenge_started` | The first ball was issued to a non-setter |
| `challenge_completed` | |
| `challenge_abandoned` | DNP, or left mid-over |
| `reveal_watched` | Existing; `mode` gains `sealed_over` |
| `rematch` | Existing; adds `sameOver` |
| `group_created` / `group_joined` / `group_completed` | |
| `todays_over_started` / `todays_over_completed` | |
| `coach_ball_shown` / `coach_ball_repeat` | |
| `highlight_created` / `highlight_shared` / `highlight_opened` | |
| `notification_opened` | Replaces `reminder_opened`; carries `kind` |
| `notification_settings_changed` | Carries `kind` |
| `error` | Closed `reason` |
| `crash` | Existing |
| `practice_tier` | Existing |

**New properties.** All are closed vocabularies:
- `mode` adds `sealed_over`, `todays_over`, `tournament`, `coach`, `clip`;
- `source`: `organic`, `challenge`, `today`, `clip`, `tournament`;
- `kind`: the `GrowthNotifyKind`s;
- `seats`: `1`, `2-4` or `5-10`;
- `deadlineHours`: `6`, `12`, `24` or `48`;
- `resultBand`: `won`, `lost`, `tied` or `dnp`;
- `sameOver`: `yes` or `no`;
- `experience`: `unset`, `new` or `expert`, a self-declared optional band (see Stage 5);
- `ttfbBucket` (time to first ball): `<10s`, `10-20s`, `20-30s`, `30-60s` or `>60s`.

**A counters** (`AnonCounter.e`). All are once per install unless marked "each":

| Counter | Meaning |
| --- | --- |
| `ms_first_open` | Carries `s` (source) and `p` |
| `ms_first_delivery` | Carries `b` = `ttfbBucket` |
| `ms_first_over` | |
| `ms_second_over_same_session` | |
| `ms_first_share` | |
| `ms_first_challenge_done` | Setter or recipient |
| `ms_recipient_first_ball` | Carries `b` = link open → first ball bucket |
| `ms_return_d1`, `ms_return_d7`, `ms_return_d30` | An open on exactly day N after first open |
| `active_day` | Each local day, once |
| `active_month` | Each calendar month, once |
| `session_start` | Each |
| `session_crash` | Each session, at most once |
| `push_state` | Each open, carrying `b` = `granted`, `denied` or `disabled`, and a volume bucket |

Every counter carries only `c` (the cohort day), `p` (platform), `s` and `b`. **No** ids, exact timestamps, IP
storage, aliases, scores, seeds or swings. Requests are rate-limited per network, and IPs are used transiently, only
for the limiter, as today.

## 2. The six funnels

Each step is counted within the stated window. Every dashboard cell with fewer than 20 units is hidden.

| # | Funnel | Steps and source | Window | Dimensions |
| --- | --- | --- | --- | --- |
| F1 | New player → first delivery → first over | `ms_first_open` → `ms_first_delivery` → `ms_first_over` (A), grouped by cohort day | 24 h from first open | platform, source, tier |
| F2 | Challenge creator → share | challenges created (S) → invite moment claimed (S, `share_moments`) → ≥ 1 unique non-setter preview open (S) | Creation → deadline | seats, deadline |
| F3 | Link recipient → play → complete | unique non-setter opens (S, opener-hash deduplicated per challenge) → joins (S) → first ball issued (S) → finished (S) | Within the deadline | platform (web or app), tier |
| F4 | Reveal → rematch | reveals viewed by ≥ 1 participant (S) → rematch created within 24 h (S) → the rematch's first non-requester attempt finished (S) | 24 h, then the rematch deadline | sameOver |
| F5 | Daily Over → next-day return | Accounts with `today` finished on day D (S) → accounts with any ranked play or synced rhythm day on D+1 (S, `play_days`) | Cohort of day D | experience (if set) |
| F6 | Group invitation → tournament completion | Tournaments created (S) → started (≥ 3 joined) → members finishing ≥ 1 round → members finishing every round → tournament complete (S) | Tournament life | size, format |

## 3. Dashboards

The admin console gets a Growth tab, behind Cloudflare Access. The Worker reads Analytics Engine SQL and
`metrics_daily`. The tab has:
- the six funnels as step bars, with conversion and a 95% interval;
- cohort triangles for D1, D7 and D30;
- the gate table in §4, with each status (VERIFIED, PROVISIONAL or UNPROVEN) and its sample size;
- notification health (`NOTIFICATIONS.md` §6);
- cost (`BACKEND.md` §4);
- integrity: `verify_mismatch`, `flight_mismatch` and flags.

Data is aggregate only, and nothing can be exported per person.

## 4. How each validation gate in the brief is computed

| Gate (brief target) | Formula | Source | Minimum sample before a status |
| --- | --- | --- | --- |
| First playable delivery < 30 s | p75 of `ms_first_delivery.b` (new installs) and of `ms_recipient_first_ball.b` (link recipients); target p75 < 30 s | A | 500 devices per platform |
| First-over completion 80% | `ms_first_over` ÷ `ms_first_delivery`, per cohort | A | 500 |
| Immediate second over 55% | `ms_second_over_same_session` ÷ `ms_first_over` | A | 500 |
| Players sharing a challenge 20% | `ms_first_share` ÷ `ms_first_over` within 7 days of first open (A); cross-checked with distinct sharers ÷ weekly active accounts (S) | A, S | 1,000 |
| Shared-link open rate 35% | Challenges with ≥ 1 unique non-setter open within 24 h ÷ challenges with an invite moment claimed | S | 300 challenges |
| Link recipients completing 60% | Finished non-setter attempts ÷ unique non-setter opens, within the deadline | S | 300 opens |
| Reveal-to-rematch 50% | Rematches created within 24 h ÷ revealed challenges viewed | S | 300 reveals |
| Group participation 65% | Finished round attempts ÷ (joined members × rounds opened) | S | 30 tournaments |
| D1 45%, D7 22–28%, D30 10–15% | `ms_return_dN` ÷ `ms_first_open`, on **exactly day N**, per cohort. The rolling "on or after" variant is reported beside it. | A (and S for accounts) | 1,000 per cohort week |
| DAU/MAU 30% | Mean daily `active_day` count over the month ÷ the month's `active_month` count | A | One full month |
| Organic share-driven acquisition 30% | `ms_first_open` with `s` ∈ {challenge, today, clip, tournament} ÷ all `ms_first_open`. The install referrer `vc_*` and the landing route set `s`. | A | 1,000 installs |
| Crash-free sessions 99.5% | 1 − `session_crash` ÷ `session_start` | A | 10,000 sessions |

**The stage exit gates add these:**
- **Stage 4** — "Groups complete challenges reliably, without coordination, confusion or manual intervention".
  - F3 completion and F6 participation.
  - The share of reveals that needed no support action (S: zero admin actions).
  - Error rates on attempt routes.
  - Moderated playtest observation of the recipient path.
- **Stage 5** — D1, D7 and D30 **separately for New and Expert Player X**.
  - In playtests: the tester cohorts (`src/practice/store/tester.ts`).
  - In production: the optional self-declared `experience` band on A and P events.
  - Also daily completion (`todays_over_completed` ÷ started), the source of return, and time to first ball.
- **Stage 6:**
  - shares per completed session;
  - challenge acceptance (F3 joins ÷ opens);
  - recipient activation (recipients who finish ≥ 1 more over within 7 days ÷ recipients who finished);
  - rematches (F4);
  - group mute and complaint signals (mute toggles and reports per 1,000 group members);
  - **retained users from shares** (D7 of `s ≠ organic` cohorts), not raw clicks.

## 5. Privacy rules (binding for this design)

- **No PII, contacts or message contents, ever.** No contact access exists, and share texts are never logged.
- No aliases, player ids, challenge ids, seeds, swings, exact times or IPs in analytics. Server metrics carry route patterns and closed codes only (existing rule).
- Cohort granularity is a day. Dashboard cells with fewer than 20 units are hidden (k-anonymity).
- Opener deduplication uses HMAC(daily rotating salt, IP/64 + UA), held only in the challenge object and deleted at the reveal. It cannot link a device across challenges or days.
- **Practice sends nothing** unless A or P is enabled. When it does, it sends only the counters above: Practice stays offline-first.
