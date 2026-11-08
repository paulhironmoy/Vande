# Build plan: phases, agents, tests, definition of done, evaluation

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. Stage 4 opens only after Stage 3 passes, Stage 5 after asynchronous play is
> dependable, and Stage 6 after players return for the game itself. This plan supersedes the earlier "build once
> Practice is green".

## 1. Phases

| Phase | Opens when | Work | Exit evidence |
| --- | --- | --- | --- |
| **4.0 Contracts** | Stage 4 opens (decision log) | Root lands four things. (1) `CONTRACTS.md` §1–3, §5 (rivalry and series), §7 (S4 routes) and §8–9. (2) The S4 flags. (3) `src/core/` moves of `prng`, `sha256` and `canonical`, with shims. (4) The **ranked-session adapter** into the Practice flow, agreed with the Practice owners (assumption A8): an external delivery source and a swing sink, with nothing else changed. | Typecheck; every existing suite green |
| **4.1 Foundations** (parallel) | 4.0 merged | Sim integrity, the `OverDO` backend, links and the web preview, the client challenge flow, analytics and ops (roster §2) | Unit and backend tests per area |
| **4.2 Integration** | 4.1 merged | Multi-context flows against the local backend. Golden suites across engines. Cost test units. Device checks. | `release/product-sequence/stage-4-async/` |
| **4.3 Stage 4 gate** | 4.2 passes | Playtests: groups complete challenges with no coordination or intervention, plus the §5 evaluation | Gate decision by the owner |
| **4.4 Retirement** | Gate passed and the owner approves the list | `MIGRATION.md` §4 deletions, in order | Proof list in the decision log |
| **5.x Daily ritual** | Stage 5 opens | Today's Over (setter, sealing, boards), rhythm, Coach Ball, the first pushes (`NOTIFICATIONS.md`), home row 5 | `stage-5-daily/` |
| **6.x Social growth** | Stage 6 opens | Tournaments, clips and `/b/` links, Open Graph previews and share cards, the three group-share moments, opt-in boards, the publishing programme | `stage-6-social/` |

## 2. Agent roster

At most six at a time, root included. Ownership is exclusive; root integrates and reviews. Practice paths
(`src/practice/**`, `src/physics/**`, `src/render3d/**`, `src/input/**`, `src/perf/**`) stay with the Practice
workstream. Growth agents never edit them; changes go through root.

**Stage 4:**

| Agent | Owns | Also |
| --- | --- | --- |
| Root (lead and integrator) | `src/contracts/**`, `src/app/**`, `src/App.tsx`, `src/core/**`, `android/**` (App Links paths), `package.json`, `vite.config.ts`, `backend/wrangler.toml`, `docs/growth/**` | `tests/e2e/flow-growth-*.spec.ts` |
| sim-integrity | `src/sim/**` (wire codec, registry, flight and result digests, self-test), `src/sim-frozen/**` (generated), `scripts/{freeze-sim,sim-bench,sim-golden}.mjs`, `tests/golden/**`, `tests/unit/sim/**`, `tests/e2e/determinism.spec.ts`, `scripts/android-determinism.sh` | The static math scan |
| backend-over | `backend/src/over/**` (OverDO, attempt engine, reveal, rematch, rivalry, series), `backend/migrations/0009_growth.sql`, `backend/test/over*.test.ts`, the growth section of `backend/test/cost.test.ts` | |
| links-web | `backend/src/links/**` (preview HTML, `assetlinks.json` route, codes, claims), `src/platform/{deepLinks,installReferrer,shareMoments,share}.ts`, `src/net/shared/ids.ts`, `tests/unit/platform/**`, `backend/test/links*.test.ts` | |
| client-growth | `src/growth/**` (preview, ranked attempt runner over the adapter, challenge view, reveal, rematch, rivalry, home v2), `src/net/v2.ts`, `src/net/routes.ts`, `src/i18n/growth/**`, `tests/unit/growth/**`, `tests/e2e/growth-*.spec.ts` | |
| analytics-ops | `src/analytics/**`, `backend/src/metrics/**` (`/v2/m`, `metrics_daily` cron), `backend/src/ops/metrics.ts`, `src/admin/**` (Growth and Cost views), `tests/unit/analytics/**`, `backend/test/metrics*.test.ts` | |

**Stage 5:**
- root;
- backend-today: `backend/src/today/**`, `scripts/todays-over-setter.mjs`;
- client-daily: `src/growth/today/**`, `src/growth/rhythm/**`;
- coach-ball: `src/growth/coach/**`, plus one new file `src/practice/coach/daily.ts`, only with the Practice owners' agreement;
- notifications: `backend/src/ops/{notifyPolicy,messages,queues,push}.ts`, `src/platform/push.ts`; Android strings through root;
- analytics-ops.

**Stage 6:**
- root;
- tournaments: `backend/src/tournament/**`, `src/growth/tournament/**`;
- clips: `src/highlight/**`, `src/growth/clips/**`, `backend/src/clips/**`;
- previews: `backend/src/links/og*.ts`, `public/og/**`;
- publishing: `backend/src/highlights/**`, `render-service/**`;
- analytics-ops.

Shared rules carried over from `docs/ARCHITECTURE.md`:
- no commits, pushes or deploys without the owner;
- never two Playwright or Gradle runs at once;
- contract changes go through root.

## 3. The brief's TESTING list, mapped to concrete tests

| # | Brief item | Test type and location |
| --- | --- | --- |
| T-01 | Deterministic cross-platform challenges | Golden vectors: `tests/unit/sim/golden.test.ts` (Node), `tests/e2e/determinism.spec.ts` (Chromium, WebKit, Firefox), `scripts/android-determinism.sh` (WebView), and a workerd script. Mirror-fair pairs are included. |
| T-02 | Same-over reproduction | `tests/unit/sim/sameOver.test.ts`: definition plus wire swings → identical verdicts after encode and decode, current and frozen. `backend/test/overReplay.test.ts`: two participants with identical swings get identical verdicts. |
| T-03 | Challenge creation and expiration | `backend/test/overLifecycle.test.ts` (harness clock): 6, 12, 24 and 48 h deadlines; `expired` with no joins; `void` when the setter never finishes; starting refused with under 3 minutes left |
| T-04 | Automatic reveal | Same file: the early reveal at the slot when every seat has finished; the reveal at T + 2 min; alarms firing with no requests |
| T-05 | Initiator abandonment | Same file: the setter silent after opening, and the reveal still happens; no cancellation after the first join (`403`); revoke only before |
| T-06 | Invited player never joining | Same file: 3 seats, 1 join; reveal at T + 2 min; the never-joined are not listed |
| T-07 | Joined player not completing | Same file: DNP at T + 2 min, partial balls shown, ranked last |
| T-08 | Rematches | `backend/test/overRematch.test.ts` (one offer; same or new over; the requester plays first). `tests/e2e/flow-growth-rematch.spec.ts` (two browser contexts). |
| T-09 | Ties and concealed tie-breakers | `tests/unit/growth/ranking.test.ts` (runs, wickets, completion; equal ms falls back to the id). A backend scan that no view ever contains a completion time. The rule string on the preview. |
| T-10 | Web-to-Android continuation | e2e: claim-code issue and redeem. `scripts/android-continuation.sh`: App Link `adb shell am start -d https://<host>/o/<code>`, and the referrer via a debug override of `VandeInstallReferrer`. **Manual on a phone:** the WhatsApp in-app browser → Play → first launch path, recording whether the referrer survives. |
| T-11 | Expired and forged links | `backend/test/links.test.ts`: unknown, expired and revoked codes get an identical answer; a forged token's MAC is refused; rate limits. e2e: the ended-challenge preview. |
| T-12 | Offline interruption and retry | `tests/unit/growth/attemptOutbox.test.ts`. `tests/e2e/growth-offline.spec.ts`: `setOffline` between balls (the bowler waits) and during a ball (a leave after `BALL_LATE_MS`). Backend: late flags. |
| T-13 | Duplicate submissions | `backend/test/overIdempotency.test.ts`: the same key replays; the same answer replays; a different answer gets `409`; token reuse and other-attempt tokens are refused |
| T-14 | Group tournaments | `backend/test/tournament.test.ts`: 3 and 10 members, league points, knockout byes, DNP, the creator absent. A flow with 3 contexts. |
| T-15 | Notification limits | `backend/test/notifyV2.test.ts`: toggles; timezone quiet hours across midnight; caps of 2 and 4; one digest a day; one closing reminder per round; nudge caps; blocked senders |
| T-16 | Privacy deletion | `backend/test/deletionGrowth.test.ts`: seats become "Deleted player"; DNP; rivalry anonymised; `play_days` and clips gone; the R2 archive rewritten; export contents |
| T-17 | Abuse blocking | `backend/test/blocksGrowth.test.ts`: the blocked cannot join; no nudges or rematches; report-queue entries. Rate-limit cases. |
| T-18 | Low-end Android performance | The device plan (`docs/VANDE-PRODUCT-SEQUENCE.md` §7, budget phone): the attempt runner keeps Balanced p95 ≤ 22.2 ms; the first ball within 30 s of the link on throttled 4G. The emulator is engineering evidence only. |
| T-19 | Accessibility and localisation | `tests/e2e/growth-a11y.spec.ts` (axe on the preview, attempt, reveal and home). `tests/unit/i18n/growth.test.ts` (en, hi and hi-Latn complete). 200% text. Keyboard attack in ranked play. |
| T-20 | Existing Practice regressions | Every growth PR runs the full Practice unit, render and `--project practice` suites unchanged. A static test: growth code imports Practice only through the adapter, and ranked state is never written to Practice storage. |

**Added by this design:**
- the approximated-math scan;
- the wire codec round trip;
- flight-digest refusal;
- the runtime self-test;
- `version_mismatch` refusal;
- coach slicing does not change results (V-07);
- `homeAction`, `rhythm` and the decisive-ball pure functions;
- the cost-test growth units;
- the D1 query budget per invocation.

## 4. Definition of done (the brief's 17 items)

| # | Item | Stage | Where it is satisfied | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Practice stable and offline | All | §5 of `MIGRATION.md`; T-20 | Practice suites, the offline e2e |
| 2 | A deterministic six-ball challenge can be created | 4 | `LIFECYCLE.md` §1; `CONTRACTS.md` §2–3 | T-01, T-02, T-03 |
| 3 | Opened from WhatsApp or a browser with minimal friction | 4 (link), 6 (previews) | `LINKS.md` §4–5, §7 | T-10, T-11, the first-playable-delivery gate (`ANALYTICS.md` §4) |
| 4 | Fair, reproducible play on web and Android | 4 | `VERIFICATION.md` §2–5 | T-01, T-02 across engines |
| 5 | Automatic reveal without the creator | 4 | `LIFECYCLE.md` §1.2 | T-04, T-05 |
| 6 | Missing participants cannot block a result | 4 | `LIFECYCLE.md` §1.2 | T-06, T-07 |
| 7 | Rematch and rivalry history | 4 | `LIFECYCLE.md` §1.7, §2 | T-08 |
| 8 | Today's Over | 5 | `LIFECYCLE.md` §3 | Setter tests, boards and thresholds tests |
| 9 | Coach Ball uses real weakness data | 5 | `LIFECYCLE.md` §7 | Unit tests on fixture FormSamples; evidence thresholds |
| 10 | Quiet tournaments for up to ten | 6 | `LIFECYCLE.md` §4 | T-14 |
| 11 | Highlights deep-link to the exact ball | 6 | `LIFECYCLE.md` §5; `LINKS.md` §1 | `/b/` landing e2e; the exact-ball replay digest equals the source |
| 12 | Consensual, rate-limited notifications and sharing | 5–6 | `NOTIFICATIONS.md`; `LINKS.md` §10 | T-15; share-cap tests |
| 13 | Analytics measures the whole loop | 4–6 | `ANALYTICS.md` | Dashboard queries return on staging data |
| 14 | Tests and builds pass | All | §3 | CI on one build id |
| 15 | Security, privacy and abuse controls | 4–6 | `VERIFICATION.md` §7; `BACKEND.md` §3, §5 | T-11, T-13, T-16, T-17 |
| 16 | Cost estimates and limits documented | 4 | `BACKEND.md` §6 | Re-measured cost test |
| 17 | Nothing fake or misleading presented as complete | All | Labels (§5) | The evaluator's report |

## 5. Independent evaluation

- **Who:** a separate evaluator agent per stage gate, never an implementer of that stage. It uses the locked rubrics (`release/player-experience/ceiling-rubric.md`, `DUAL-CEILING-RUBRIC.md`, `release/competitive-experience/COMPETITIVE-RUBRIC.md`) and the brief's seven dimensions.
- **Evidence:**
  - recorded end-to-end flows on one build id;
  - test reports;
  - **moderated playtests** with at least 10 New Player X and 10 Expert Player X on representative Indian Android phones, after a 3 + 3 pilot;
  - for the recipient path: real WhatsApp-to-play sessions;
  - production dashboards, once they exist.
- **Labels** (sequence doc):
  - **VERIFIED** needs reproducible evidence, including real players where the gate requires them.
  - Any score above 8.8 without real players is at most **PROVISIONAL**.
- **What stays UNPROVEN until production data exists:**
  - **Virality, Engagement, Daily return and Shareability.**
  - **Every validation-gate metric** in `ANALYTICS.md` §4: first-over completion, second over, sharing, open rate, recipient completion, rematch, group participation, D1/D7/D30, DAU/MAU, organic acquisition, crash-free sessions. Each needs the minimum samples listed there.
  - **Player experience, UX and Minimalistic flow** can reach PROVISIONAL from playtests, and VERIFIED only with the real-player gate evidence.
- **Reporting:** a before-and-after table with the label per dimension, the exact next experiment, and the open risks. Nothing is averaged across player types.
