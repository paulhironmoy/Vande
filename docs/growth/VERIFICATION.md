# Verification: determinism, re-simulation, anti-cheat and CPU

> **Stage 4–6, not active: paths in this document refer to code that is not built.** The owner's product sequence
> keeps these stages closed; see [VANDE-PRODUCT-SEQUENCE.md](../VANDE-PRODUCT-SEQUENCE.md) and the
> [docs index](../README.md).

> **Status: Stage 4–6 design, not authorized for build.** Building waits for the stage gates in
> `docs/VANDE-PRODUCT-SEQUENCE.md`. Everything here belongs to Stage 4 (asynchronous competition) unless a section
> says otherwise.

## 1. Authoritative model (decision)

| Rule | Detail |
| --- | --- |
| The server's result is official | The Durable Object that owns the attempt re-simulates every ranked delivery. It uses the stored over definition, the submitted swing and the pinned sim version. |
| The client resolves locally as well | The batting screen runs the same Practice pipeline (`flight` → `resolveDelivery`), so the result appears with no network wait. |
| Reconciliation is per ball | Each swing request returns the official verdict and its `resultDigest`. On a mismatch the client replaces the shown result in place ("Checked: 2 runs"; copy TBD) and keeps the official one. The mismatch is counted as `verify_mismatch` with the sim version, engine family and tier, never an id. |
| The reveal re-checks everything | Before publishing, the object re-runs every attempt end to end. That costs about 15 ms per attempt warm (§6). |
| Expected mismatch rate is zero | The arithmetic is bit-identical (§2). An alert fires above 1 per 10,000 balls, and so does any flight-digest refusal (§4, item 3). |

Rejected alternatives:
- **Client-authoritative with server spot checks.** A modified client could submit any outcome.
- **Server-only simulation, with the client waiting for each result.** It adds 100–500 ms to every shot on Indian mobile networks and destroys the batting feel.
- **Trusting the client's flight.** The server always recomputes flights from the definition.

## 2. Determinism audit

Scope: the working tree on 2026-10-25 at 20:51 PDT, with `PRACTICE_SIM_VERSION = 1` and shot geometry partly landed (`src/physics/shot.ts` present).

Code that runs during verification:
- `flight()`: `delivery.ts`, plus `ball.ts` (RK4) and `solveRelease` (Newton).
- `resolveDelivery()`: `contact.ts`, `bat.ts`, `shot.ts`, `collision.ts`, `impact.ts`, `lbw.ts`, `ball.ts`, `fielding.ts`, `running.ts`, `scoring.ts`, and `physicsBowler` in `field.ts`.
- `autoField` and `validateField`; `validateOver` and `ballSeed` in `src/practice/game/overs.ts`.
- `rngFromKey` (`src/engine/prng.ts`, SHA-256 from `src/engine/sha256.ts` plus sfc32).

| Check | Result | Notes |
| --- | --- | --- |
| `Math.sin/cos/tan/exp/pow/log/atan/atan2/asin/acos/hypot/cbrt/tanh…` | **None** in the files above, nor in `src/practice/coach` | Trigonometry, exp and log come from `src/physics/vec.ts` (`dsin`, `dcos`, `datan`, `datan2`, `dasin`, `dacos`, `dexp`, `dtanh`, `dlog`). These use only + − × ÷, `Math.sqrt` and `Math.round`. |
| `**` (Number::exponentiate is implementation-approximated) | **None** in resolution | One use in `src/perf/classify.ts`, which rounds benchmark numbers for display; not resolution. |
| `Math.random` | Only `newSeed()` in `prng.ts` | UI seeds only, never inside the simulation. |
| Clocks | None in physics or game | `src/practice/coach/analyze.ts` reads `performance.now()` to slice coach work across frames. It must not change results (Stage 4 test V-07). |
| Locale, `Intl`, `toLocaleString` | None | |
| Frame-rate coupling | None | Fixed 1 ms RK4 (`SIM_DT`). Flights are sampled every step, post-contact every 5 steps. Swing time is the event timestamp minus the release on the stage timebase, which "never depends on frames" (`src/render3d/practice/session.ts`). |
| Iteration order | Deterministic | Map/Set keep insertion order and `Object.keys` order is spec-defined. Sorts are stable (ES2019) and use numeric or id tie-breaks (`fielding.ts:645`, `resolve.ts:123`). |
| Module state | Order-independent | `field.ts` keeps `strokeTables`, a pure function of constants. |
| Input normalisation | Engine-dependent, **outside** verification | `src/input/normalize.ts` uses `Math.hypot` and `Math.atan2`. It runs only on the client, before the swing is recorded, and rounds to 0.1 ms, 0.1° and 0.001. The server never re-runs it: the contract boundary is the normalised swing. |
| Number → string | Last digit not normatively unique | ECMA-262 leaves the least significant digit open. Hashes and canonical forms therefore use integers only (`CONTRACTS.md` §1). |
| Tier-dependent parameters | `tierToleranceMs` | `activeBands` widens Learn and Play by it. Real ignores it in the 20:2x tree, matching binding policy §7. Quality profiles change rendering only; the ball trace is drawn per profile but is not physics. Ranked policy in §5. |
| Handedness | Mirroring at two points | Physics always runs in the striker's right-handed frame. Mirroring happens only in `frameArm` (`delivery.ts`) and `physicsBowler` (`field.ts`). |
| Floating-point semantics | Safe | ECMAScript requires an IEEE-754 double per operation and forbids FMA contraction. JS engines do not flush subnormals. |
| Over generation | Version-dependent | `generateOver` keys its RNG with `PRACTICE_SIM_VERSION`, so the same seed gives another over in another version. Definitions are therefore **stored**, never regenerated. |
| Per-ball seeds | Stored explicitly | `ballSeed()` is a derivation rule that could change; each ball's seed is stored. |

**Assumptions about internals.** Re-check all of these when Stage 4 opens; the golden suite enforces them.

| # | Assumption |
| --- | --- |
| A1 | `flight` and `resolveDelivery` stay pure functions of their arguments, with no hidden state that affects results. |
| A2 | All randomness in resolution comes from `seed` and `lookSeed` through `rngFromKey`. |
| A3 | `shot.ts` and later additions follow the same arithmetic rules. |
| A4 | Every outcome-changing edit bumps `PRACTICE_SIM_VERSION`; the golden vectors fail otherwise. |
| A5 | Handedness enters only through `frameArm` and `physicsBowler`. The mirror-fair policy (§5) depends on this. |
| A6 | `tierToleranceMs` is only an argument, never global state. |
| A7 | Coach analysis is display-only and never part of verification. |
| A8 | The Practice flow can accept an external delivery source and swing sink: a "ranked session" adapter, landed by root after Stage 1. |

## 3. Deterministic math layer (decision: no new library)

`src/physics/vec.ts` already is the vendored deterministic layer. To keep it that way:
- **Static scan test** (`tests/unit/sim/noApproximatedMath.test.ts`). It fails on `Math.{sin,cos,tan,exp,expm1,pow,log,log1p,log2,log10,atan,atan2,asin,acos,sinh,cosh,tanh,hypot,cbrt,random}` or `**` in `src/physics/**`, `src/practice/game/**`, `src/sim/**` and `src/sim-frozen/**`. Comments are excluded.
- **Golden vectors and runtime self-checks** (§4).

Rejected alternatives:
- **A vendored fdlibm or crlibm port.** Unneeded: the functions exist, with relative error ≤ 1e-15, tested in `tests/unit/physics/vec.test.ts`.
- **Fixed-point physics.** A rewrite with no evidence that it is needed.
- **WebAssembly physics.** Bundle and tooling cost. The JS path is already deterministic.

## 4. Proving cross-engine equality

1. **Golden vectors** (`tests/golden/sim-v<N>.json`). About 300 deliveries:
   - every variation × pitch, both handedness values, all three assistance levels;
   - leaves, pads, LBW, bowled, edges, catches, boundaries;
   - swings at every timing-band edge ±0.1 ms, and the mirror-fair pairs.
   - Each case stores `resultDigest`: SHA-256 over little-endian Float64 bits written with `DataView`, covering the contact, the exit, the events, the outcome and the last ball sample. Never over printed numbers.
   - The **physics digest** of a sim version is the SHA-256 of all case digests.
   - The file is regenerated only by a version bump (`node scripts/sim-golden.mjs`; the existing `npm run sim:golden` belongs to the old engine), and its review is part of the bump.
2. **Runners.** Every runner must produce identical case digests:

   | Runner | Engine | Location |
   | --- | --- | --- |
   | Node (Vitest) | V8 | `tests/unit/sim/golden.test.ts` |
   | Playwright Chromium, WebKit, Firefox | V8, JavaScriptCore, SpiderMonkey | `tests/e2e/determinism.spec.ts` (a static test page that runs the suite). CI must add `npx playwright install webkit firefox`. |
   | Android WebView | V8 on ARM64 | `scripts/android-determinism.sh` on the emulator now, on physical phones when available |
   | workerd | V8 in the Worker runtime | A `wrangler dev --local` script, or `@cloudflare/vitest-pool-workers` (a new dev dependency, needs approval) |
3. **In the field.**
   - A **per-ball flight digest** is checked before bowling. The client computes the flight and compares it with `ChallengeBall.flight`. On a mismatch the ball is not bowled and ranked play is disabled on that device ("Play this challenge in the browser instead").
   - A **per-session self-test** runs 12 golden cases before the first ranked attempt of a session (about 15 ms).
   - The **physics digest** is checked at attempt start. A client with another digest for the pinned version gets `version_mismatch`.

## 5. Ranked fairness policy

This is the recommendation. Owner decision O2 in `README.md`.

| Topic | Recommendation | Rejected alternatives |
| --- | --- | --- |
| Assistance | Pinned per challenge for every participant. The setter's choice, default **Play**. Today's Over: Play. | Each player picks their own: different rules, so not comparable. |
| Device allowance (Learn and Play) | **Zero in ranked for every participant.** Binding policy §7 keeps the declared allowance for Practice. Ranked results are compared, so everyone plays identical bands. The device tier is recorded per attempt for fairness analysis. | (b) The declared allowance, latched and shown in the reveal: self-declared, and a cheater always declares the highest. (c) Real only in ranked: too hard as the mass-market default. |
| Handedness | **Mirror-fair.** A left-hander faces the exact mirror image: the participant's bowler is the canonical bowler with the arm mirrored, so `frameArm` and `physicsBowler` restore the canonical striker-frame bowler. Flights, fields and outcomes are bit-identical (golden pairs prove it). | The same real-world bowler for both: cricket-real, but not the identical six deliveries the brief requires. |
| Calibration | The swing's `startT` already includes the calibration, which happens on the client and cannot be verified. The attempt records `calibrationMs`, the server bounds it to −60…220 ms (`CALIBRATION`) and flags anything outside. | Server-applied calibration: adds no security, since raw times can be faked too. |
| Pointer kind and tier | Recorded per attempt (`touch`, `mouse`, `pen`, `keyboard`; Premium, Balanced or Classic). Watch the score distributions; split boards only if a gap is measured. | Separate boards from day one: fragments small groups. |
| Rules | Super Over: six legal balls, and the second wicket ends the innings (remaining balls are dead). Ranking: runs ↓, wickets ↑, completion order ↑. The **rule** is shown before play; completion times stay concealed until the reveal (sequence doc, Stage 4). | One wicket ends it: too punishing for six balls. Unlimited wickets with a penalty: not cricket. |

## 6. CPU budget and where verification runs

**Measurement.** An uncommitted scratch script, bundled with rolldown 1.2.15 from the real `src/physics` and `src/practice/game/overs.ts`. Stage 4 commits it as `scripts/sim-bench.mjs` and reruns it on an idle machine and on a budget Android phone. Method:
- Per over: `randomOver` (Play, open level), then 6 × `flight` and 6 × `resolveDelivery`.
- Swing mix: 12% leaves, 23% defends, the rest attacks; timing error ~N(0, 30 ms); auto field; one over in five left-handed.
- CPU from `process.cpuUsage()`, so it is CPU time, not wall time.

**Machine:** Apple M1 Pro (8 performance + 2 efficiency cores), 32 GB, macOS (Darwin 24.6), Node v26.0.0.

**Load:** heavy. The load average was 120–165 during the runs (about nine other agents). Read the figures as pessimistic.

| Measurement (per over = 6 flights + 6 resolves) | CPU ms |
| --- | --- |
| Warm, 195 overs: median / min / p95 / max | **15.4** / 10.5 / 26.3 / 39.6 |
| — flights only, median | 8.5 |
| — resolves only, median (what a cached-flight verifier pays) | 6.5 |
| Cold, first over in a fresh process (6 runs) | 117–149 (median ≈ 129) |
| Interpreter only (`--jitless`), worst case for a fresh isolate | 169–221 |
| `randomOver` generation: median / p95 (bouncer length solves) | 0.06 / 6.9 |
| Verifier bundle: `flight`, `resolveDelivery`, `replayDelivery`, `autoField`, `validateField`, `validateOver`, `ballSeed` | 63.2 KB minified, 24.8 KB gzip |

**Platform limits** (Cloudflare docs, checked 2026-10-25; see `README.md` sources):

| Context | Limit |
| --- | --- |
| Workers Paid, HTTP request | 30 s CPU by default, configurable to 5 min |
| Durable Object | 30 s CPU per request or alarm by default, configurable to 5 min; alarm wall time 15 min |
| Queue consumer | 30 s CPU by default, configurable to 5 min; 15 min wall clock |
| Workers Free | 10 ms. Cold verification would fail, so Workers Paid is required, as already planned. |

**Pricing:**
- Worker CPU: 20 ms costs $0.0000004 per over ($0.02 per million CPU-ms; 30M CPU-ms included each month).
- Inside a Durable Object, compute is billed as duration: 128 MB × 0.02 s = 0.0025 GB-s, about $0.00000003.

**Decision.**
- Verify **synchronously in the owning Durable Object, per ball**, as each swing arrives: about 1–3 ms warm.
- Re-check the whole attempt at the reveal.
- A Queue consumer re-audits flagged or top-board attempts asynchronously, and re-runs them under newer code to detect drift.

**Rejected alternatives:**
- **Verifying in the stateless Worker.** It adds a hop and splits authority for little CPU gain.
- **Only verifying in a Queue after the attempt.** Results would be shown before they are official, and ordering would be harder.

**Daily setter.** The Today's Over story validator (Stage 5) costs about 1,150 resolves per candidate over: about 1.25 s, estimated from the measured 1.08 ms per resolve. It runs offline (in CI or the owner's machine), or in a Queue consumer with `limits.cpu_ms` raised. Never in a request.

## 7. Anti-cheat

### 7.1 Legal input sequences

- **One attempt per player per challenge** and one per day for Today's Over. The `OverDO` id or the attempt id enforces it (`BACKEND.md`).
- **Balls in order.** Ball *i + 1* is issued only after ball *i* is answered or settled. Each ball has one signed, single-use `ballToken` (`bt2`, HMAC from `TOKEN_KEYS`, purpose `ball`). Its claims are `{a, i, t, r, v}`: attempt, index, token id, issue time and sim version.
- **Swing validation** (integer wire form, `CONTRACTS.md` §1):
  - `k` is `defend` or `attack`.
  - A defend must be exactly the tap shape: `dir 0`, `pow 200`, `elev 0`.
  - `t` lies between −1.0 s and `stumpsT + 0.5 s`.
  - `dir` lies in −1800…1800; `pow` and `elev` lie in 0…1000.
  - `fw` is in the `Footwork` enum, and `decision` must agree with `k` (a leave has a null swing).
  - Anything else is refused (400) and the ball settles as a leave after three invalid answers, as `MAX_INVALID_SHOTS` does today.

### 7.2 Impossible reaction patterns

All of these are **flags**, never automatic result changes.

| Signal | Rule (initial thresholds, calibrate in Stage 4) |
| --- | --- |
| Bullseye timing | ≥ 4 of 6 swings within ±3 ms of ideal. With a human σ of about 25 ms, P ≈ 0.001 per attempt. Same idea as the old `timingAudit`. |
| Too-consistent player | Timing-error σ below 8 ms across ≥ 10 ranked attempts. |
| Too-optimal choices | Over ≥ 20 attempts, mean expected runs of the chosen swings ≥ 90% of the coach optimum. Computed offline in the audit queue. |
| Superhuman start | A pace swing starting under 100 ms after release, with on-target direction and perfect timing, on ≥ 2 balls. |
| Impossible wall clock | Swing arrived sooner after the ball was issued than the run-up plus the flight allow (scene release time from `practiceReleaseScene` + `idealContactT` − 300 ms network slack). The client skipped the presentation. |
| Slowed time | Wall time from issue to swing consistently above twice the scene's expected time, with near-perfect timing: a client running the stage slower. Weak alone; combined with bullseyes it is strong. |

### 7.3 Replayed and duplicate submissions

- Every mutation carries an `Idempotency-Key`. Ball requests use object-scoped idempotency records stored in the DO, as `MatchDO` does today.
- The same answer for an answered ball returns the stored verdict. A different answer is refused with `409 already_answered`.
- A token from another attempt or ball, or a retired token id, gets the same `404`.

### 7.4 Expired attempts

Server timestamps decide everything.

| Window | Default | Effect |
| --- | --- | --- |
| `BALL_LIVE_MS` | 20 s after issue | Answered within it: live. |
| `BALL_LATE_MS` | 10 min after issue | Answered within it: accepted and flagged `late` (an offline queue). Later, the ball settles as a leave. |
| Challenge deadline | 6, 12, 24 or 48 h | No ball is issued after it. Starting is refused when less than 3 minutes remain (the UI says so first). |
| `DEADLINE_GRACE_MS` | 2 min | A ball issued before the deadline may still be answered (late rules apply). The reveal waits for this grace. |
| Today's Over | The day close (00:00 IST, owner decision O3) + 2 min | As above. |

Irregular balls (late, expired or invalid) are counted per attempt. An attempt with more than one irregular ball still counts in friend challenges, but is kept off public boards (the existing `MAX_IRREGULAR_BALLS` idea).

### 7.5 Modified clients

**Can be stopped:**
- forged outcomes (server re-simulation);
- changed deliveries (server-held definition, commit–reveal, flight digests);
- extra attempts;
- replays and duplicates;
- answers outside the windows;
- self-declared assistance or allowance (server policy);
- skipped presentation (wall-clock floor).

**Cannot be stopped:**
- a bot that reads the flight and swings perfectly. The client must know the ball to draw it; this is inherent to a client-rendered reaction game;
- visual overlays;
- reading each ball at release;
- automation from the outside (auto-clickers, a camera robot).

Only statistics (§7.2) can catch these.

**Play Integrity: not for Stage 4.** Recommendation, owner decision O9.
- It attests a genuine Play-installed binary on a genuine device: standard requests take a few hundred ms, with 10,000 requests a day by default.
- But the mobile-web fallback, a core acquisition path, cannot use it, so a cheater simply plays in a browser.
- Revisit only for public prize competitions, which are not planned. If ever used, it would be an optional "verified device" mark on public boards, never a gate on friend play.

### 7.6 Suspicious leaderboard activity

1. **Flag.** The automatic signals in §7.2 and §7.4 are written as attempt flags (closed codes).
2. **Hold.** A flagged attempt stays on friend and group boards (people know each other) but is hidden from city and national boards until reviewed. The player sees "Being checked" on their own entry only.
3. **Review.** A new queue in the admin console (Cloudflare Access) shows the per-ball timing histogram, the wall-clock record, pointer and tier, and the player's history.
   - Actions: clear; exclude from public boards for that day; suspend from public boards for N days. Every action is audited.
   - Appeals go through the existing report flow.
4. **Never** silently change a friend challenge's official result.

### 7.7 Whole-over payload or per-ball streaming (decision: per-ball streaming)

| | Per-ball streaming (chosen) | Whole-over payload |
| --- | --- | --- |
| Spoilers and pre-reading | A modified client sees only the ball it must face now | It can read all six at the start |
| Human rehearsal | Limited to one ball, within the 20 s live window | All six could be rehearsed offline before playing |
| Bots | Not stopped (the ball is known at release) | Not stopped |
| Offline robustness | Needs a round trip before each ball. It is hidden behind the run-up (about 2 s), and the bowler waits at the top of the mark if the plan has not arrived. Never interrupted mid-ball. An answer made offline is queued and accepted within `BALL_LATE_MS` (flagged). | Plays fully offline once started |
| Requests per attempt | 13 (start, then 6 × issue and 6 × swing) | 2 |
| Trust | Commit–reveal: a signed commit at start, and the definition and salt after the attempt. The server cannot change ball 6 after seeing ball 1. | Same |

**Practice stays entirely offline and separate.** No ranked state ever touches Practice storage, and Practice never needs the network (`docs/PRACTICE.md` §6).
