# Practice physics

The deterministic, cricket-specific physics behind Practice batting: the delivery from the bowler's hand, the
virtual bat, the swept bat–ball collision, the contact and the ball off the bat, and LBW. Fielding, running,
scoring and dismissals (src/physics/field, fielding, running, scoring, resolve) are described by their own module
docs; this page covers the modules below. There is exactly one implementation of each concern and one source of
constants and timing windows (`src/physics/constants.ts`).

| Module | Responsibility |
| --- | --- |
| `constants.ts` | Every cricket constant and timing window used by Practice (the renderer's ground geometry re-exports them) |
| `vec.ts` | Vectors and deterministic `sin/cos/atan2/exp/tanh` (bit-identical on every JavaScript engine) |
| `ball.ts` | The one ball integrator: delivery flight, ball off the bat, bounces, roll, rope, stumps (`integrateBall`, `simulate`) |
| `delivery.ts` | Release per bowler, variation and ball, the aiming solver, `flight()`, `flightMovement()`, the seam cue (`seamCue`, `ballRotation`) |
| `bat.ts` | `batTravelMs`, footwork, the batter's body (`batterBody`), the read, the face, the bat track (`batPose`) |
| `shot.ts` | The stroke a swing plays (`shotFamily`) and its reach and aim (`planShot`): shot geometry |
| `collision.ts` | Continuous (swept) collision of the ball with blade, handle and gloves, pads, body and head |
| `impact.ts` | One impulse model for every contact (restitution, friction, spin) |
| `contact.ts` | `strike()`: the batter plays or leaves a delivery; contact kind, exit velocity and spin, the report |
| `timing.ts` | Active bands, SwingTiming classification, the Learn/Play forgiveness map |
| `lbw.ts` | Law 36 decision from the physics |
| `matchPath.ts` | `flightFromPath`: a multiplayer `BallPath` flown through the same physics (match reveals, replays, highlights) |
| `aim.ts` | `aimShot`: outcome-first post-contact flights (the server has decided where the ball goes) |
| `probe.ts` | Allocation-free probe runs and sampled traces of the same ball model, for the match solvers |

`scripts/practice-physics-check.mjs` measures the timing windows the physics produces (see "Measured windows").

## The wedge physics repair (2026-11-03): simulation v3, frozen

**Status: simulation v3 is frozen at 2026-11-04T06:30Z, after freeze amendment 5f.** The authoritative set is
`phase5/FROZEN-5f.repo.sha256`: every `src/physics/*.ts` and `src/render3d/practice/frame.ts`, with repo-relative
paths, so `shasum -a 256 -c` checks it from the repo root. A byte-for-byte copy is tracked as `docs/FROZEN-5f.sha256`;
`npm run frozen:check` (`scripts/check-frozen.mjs`) verifies it from a clone, and the static job of CI runs it. The lead verified it, 25/25, on build
`38924bd+c64d60881c28`. `contact.ts`, `resolve.ts`, `fielding.ts` and `collision.ts` differ from 5e. The matching
Unity inputs are `reach-proxies-v3.json` `f78959b2…` and `practice-v3.json` `56f580ab…` (payload `4f1e2bb5…`). Any
physics change after the freeze needs a new lead decision, and it invalidates any evaluator verdict that cites this
freeze (`phase5/REPORT.md`, the sections "Freeze amendment 5e" and "Freeze amendment 5f").

History of the freeze (each earlier hash file is superseded):
- 11:52Z: first freeze, build `38924bd+46096a294997` (`phase5/FROZEN-physics.sha256`). The builder's own verdict had
  been "not ready" until the lead ruled on conditions 3 and 4 of the continuity rule and on the cut; those rulings
  are recorded below.
- 12:45Z: reopened for a narrow phase 5b, because the rebuilt reach corpus failed its invariant gate.
- 13:20Z: re-frozen after phase 5b, build `38924bd+4e2c5f78913e` (`phase5/FROZEN-physics-5b.sha256`).
- 13:35Z: amendment 5c, fielding only (`phase5/FROZEN-5c.repo.sha256`; only `fielding.ts` differs from 5b).
- 15:22Z: amendment 5d, control honesty (`phase5/FROZEN-5d.repo.sha256`).
- 2026-11-04 02:49Z: amendment 5e, whole-swing forgiveness and no phantom bounce (`phase5/FROZEN-5e.repo.sha256`).
- 2026-11-04 06:30Z: amendment 5f, causality: no touch before the input; stance body before the swing; keeper `shortM` and
  height reach (`phase5/FROZEN-5f.repo.sha256`).

Every number in this section is a builder observation on a desktop (Apple M1 Pro, Node 26). No evaluator has verified
it, and no device or human result is claimed. Contract v6 and `PRACTICE_SIM_VERSION` 3 are unchanged. Sources, under
`release/product-sequence/stage-1-practice/wedge/physics/`: `REPORT.md` (phase 1), `phase2/REPORT.md`,
`phase3/REPORT.md`, `phase4/REPORT.md` and `phase5/REPORT.md`, with the lead's rulings in their filing notes.

Some sections below still describe the earlier model, for example the bat translating along the line through the
hitting zone. Where they conflict, this section and "Timing bands" are current.

### Phase 1: the bat-speed collapse

- **Root cause: the hand reach.** `BAT_HAND_REACH_SOLVE_M` was 0.453 m, so the lower hand could not go below 0.80 m
  and a vertical bat's sweet spot could not go below about 0.19 m. The cover drive fell back to a slow, fail-closed
  whiff: on ref-2 it met the ball at 6.59 m/s instead of the requested 24.8 (`REPORT.md` §1).
- **Reach.** `BAT_HAND_REACH_M` 0.454 → 0.57 m (solve value 0.569). That is the anthropometric shoulder-to-wrist chain
  of a 1.78 m body, 0.186 H + 0.146 H = 0.591 m (Drillis & Contini; Winter, Table 4.1), less the rig's 20.1 mm elbow
  reserve. The crouch cap stays 0.18 m, the contract v6 bound.
- **Kinematic caps.** Point speed 30 → 40 m/s, point acceleration 400 → 1,500 m/s², angular speed 25 → 40 rad/s and
  angular acceleration 250 → 600 rad/s². The grip caps were unchanged. Phase 3 then scaled every acceleration cap by
  ×1.5 (below).
- **Hips.** On a forward or down-the-track stride the torso base now sits between the feet, 65/35 towards the front
  foot.
- **Planner.** An exhausted work ledger returns the best stroke already certified instead of discarding it; contact
  locations are tried nearest the sweet spot first at every speed; `FALLBACK_WORK_LIMIT` 160 → 320.
- **`STUMP_H`** 0.711 → 0.7112 m (Law 8: 71.12 cm).
- **Result.** In-reach attacks played at the requested speed: 1 of 87 → 73 of 87 (planner census, 720 swings).

### Phase 2: the face closes through the stroke, and limit strokes

- **Face yaw.** The timing face yaw now converts from per millisecond of error to swing time with ×(U + vLine)/U. It had
  been 3.3× too slow at 24.8 m/s (`phase2/REPORT.md` §1).
- **Projected face.** Vertical attacks solve their face through the surface velocity their path really has.
- **Limit strokes.** A stroke the planted body cannot carry is played at its limit instead of as a parked whiff: first
  at the requested speed at its own aim, then halfway to the reach centre, then at the reach centre; failing those, a
  fixed 7-step speed bisection finds the fastest certified version. The shoulder-anchored whiff stays only as the
  fail-closed last resort. Attack whiffs: 401 (before phase 1) → 51 (phase 1) → 9 (phase 2, all out of reach).
  Defence whiffs: 145 → 10 → 0.
- **Pins.** The 27 obsolete pins of the collapsed planner were refrozen with their protected properties kept; none was
  deleted (`phase2/REPORT.md` §4).

### Phase 3: the smooth speed peak, the bands, `played_on` and continuity

- **C1 speed peak.** A smoothstep speed profile on all three paths replaces the linear "tent". To keep each ramp's
  average acceleration and length, the acceleration caps were scaled ×1.5: grip 300, point 2,250 and angular
  900 rad/s² (confirmed by the lead). At the old caps, 74 of 864 swings had silently lost speed. Drive bat speed through
  the window: p10 70 → 83 km/h, median 76 → 84 (`phase3/REPORT.md` §1).
- **Bands and labels.** See "Timing bands".
- **`played_on`.** `judge` emits `played_on` when a ball played onto the stumps came off the middle; edges keep their
  old diagnosis. On the reference over all 10 middle played-ons read `played_on` (`phase3/REPORT.md` §4). Contract v6's
  closed `CoachingReason` list carries it, as the lead amended it (`coaching/RERUN-REPORT.md`, filing note).
- **A continuous fallback.** The fallback first plays the fastest certified version of the stroke at its own aim. On
  the dense 1 ms sweep (refs 1–6, the 45° and straight drives, Real and Play, 3,408 points) islands fell from 49 to 0,
  and the ref-1 45° drive is a middle at every millisecond (`phase3/REPORT.md` §3). Side effect: strokes at their
  anatomical limit now often fend the ball on the middle at a few km/h. The coach gates praise and picks on the
  measured speed (`docs/PRACTICE_COACH.md`).
- **`shotFamily`** and the `ShotFamily` type are exported from `src/physics/index.ts`.

### Phases 4 and 5: continuity, the toe and the yorker

Phase 4 diagnosed these items and planned them; PHYS2 landed them in phase 5, the yorker at 10:31Z and the rest at
11:33Z, in `bat.ts`, `batGeometry.ts`, `constants.ts`, `contact.ts` and `delivery.ts` (`phase5/REPORT.md`;
`phase5/landed.json`).

- **(a) The same-geometry speed ceiling.** The first failing candidate keeps its own geometry. Its fastest certified
  line speed is found by an 8-step bisection, with the full body solve and the dense reach scan, and `track.speed` now
  records the speed achieved. Before, the planner threw that certified track away and rebuilt the stroke with new
  geometry, the tier switch behind 22 places where planned bat speed jumped by more than 2 m/s from one millisecond to
  the next (`phase4/REPORT.md` item 2).
- **(b) Worst-sample reach.** The body solve also constrains hand reach at the worst dense sample. This was the
  1–3 mm follow-through failure.
- **(c) Mistimed attacks replay the on-time plan:** the same contact location u, face roll, aim family,
  handle-and-rotation split and speed, plus the same-geometry ceiling. The on-time root is kept where it certifies;
  otherwise the body is re-solved. Re-solved bodies can jump between neighbouring milliseconds, but the bat path is
  unaffected. Holding the body fixed throughout was tried first and rejected: it drove ref-1 Real down to 0.7 m/s at
  −20 ms. This removes the candidate switch at −14/−15 ms on ref-1 Real (bladeU 0.141 → 0.149, bearing 54.1° → 51.8°;
  `phase4/REPORT.md` item 3).
- **(d) A rounded toe** for the ball collision: `BLADE_TOE_R` = 10 mm. It is an assumption; no verifiable public source
  was found. Anatomy keeps the enclosing box, which is conservative. The sharp toe edge had switched the contact
  normal and given a 9.7° bearing step at −29/−30 ms on ref-1 Real (`phase3/exit-bearing.txt`). Toe traverse at ref-1
  Real (`phase5/REPORT.md` item 4):

  | Toe radius | Bearing steps across the toe (°/ms) | Peak step |
  | --- | --- | --- |
  | 0 (square) | 4.7 / 8.1 / 5.0 | 8.1° |
  | 5 mm | rising to 8.1 | 8.1° |
  | **10 mm (chosen)** | 6.1 / 5.6 / 4.0 / 2.4: a smooth decreasing run | 6.1° |
  | 20 mm | falling from 5.3; the early window ends at −29 ms | 5.3° |

  The normal turns at roughly the relative speed ÷ (ball radius + r), so no radius up to 20 mm reaches a step of
  2°/ms or less.
- **(e) Toe-end hits.** A vertical bat's toe-end hit within the blade width is `middle`. Before, its inside or outside
  label came from the sign of a near-zero offset. A contact on the toe cap (bladeU < 0) is likewise `middle`, with
  bladeU reported, because contract v6 has no toe kind (lead ruling, phase-3 filing note). A `toe` kind is in the
  not-now register.
- **Yorkers.** See "Yorkers" below.

### Phase 5b: the presented bat and continuous admission (re-frozen at 13:20Z)

Source: `phase5/REPORT.md`, the lead's note of 12:45Z and the "Phase 5b" section. Builder-measured.

- **Why.** PHYS2 rebuilt the 7,560-case reach corpus, the Unity golden prerequisite. Its producer is now in the repo,
  untracked: `scripts/practice-reach-corpus.test.ts`, with provenance from Codex, 2026-11-01. On the first freeze, 585
  cases failed the invariant gate, which requires 0. 390 were presented angular acceleration: the drawn bat reached up
  to 975 rad/s² against the 900 cap, because `batAt` in `src/render3d/practice/frame.ts` interpolated the 4 ms samples
  with a cubic that overshot, while the physics track itself stayed within the cap. 213 presented and 31 physics-track
  cases were anatomy gaps: torso and pad clearance dipped up to 0.024 mm below zero between the 0.5 ms admission
  samples. The failures began in phase 3, when the speed profile started to reach the cap exactly.
- **(A) The bat on screen.** `batAt` is now a quintic Hermite with Fornberg first and second derivatives over up to
  five knots. The swing's progress along its rigid screw is a quartic in time on each run, so this reproduces the
  physics swing exactly: 0 presented cases now exceed the 900 rad/s² cap (390 before). The physics side,
  `presentationBatSamples` in `bat.ts`, adds at least three interior knots to any run of 1 ms or more between two
  authority knots. The specification for UNITY's parity is `phase5/5b-bat-interpolation-spec.txt`; `BatSample` and the
  contract are unchanged.
- **(B) Admission is continuous.** It now has a proven lower bound on every lattice interval, and bisects wherever the
  bound is unproven: 0 gap cases (244 before). The census moved a little: accepted bat contacts 1,585 → 1,588, hashes
  `e14b8bec` / `8fe0a8d7`. **Corrected in 5d:** the 5b bound used a lower curvature bound, which cannot limit a dip
  between samples; it now uses an upper one (see "Amendment 5d").
- **(C) The goldens script.** The jq `maxBuffer` is now 256 MB; no gate changed.
- **The reach corpus.** Two passes (13:00–13:04Z), 7,560 cases each, deterministic, and every gate is 0, including the
  invariant failures (585 before). `reach-proxies-v3.json` was rewritten (`6c7443c2…`).
- **Guards.** 0 exceptions and 0 non-finite results; equality 732/732; 0 unexplained islands; `resolveDelivery` p90
  22.2–22.6 ms against 23.6–24.1 ms for phase 3 in the same runs. That is about 15% over phase 5 alone, the cost of
  continuous admission (`docs/PERFORMANCE.md` §5.6).
- **Bands** are unchanged. **Continuity:** conditions 1 and 2 pass, and conditions 3 and 4 pass as the lead amended
  them; 5b did not change them.
- **Full vitest** (13:04:50–13:17:38Z): 2 failed, 2,191 passed, 5 skipped. The failures are the named cut and
  `unityPracticeGolden`, which waits for UNITY's `--write` against the new `batAt`. Typecheck rc 0
  (`phase5/vitest-full-summary-5b.txt`).
- **Re-runs ordered on 5b:** UNITY's `--write`, its 14 stale tests and the parity mirror of the interpolation; COACH's
  final run; FIELD's re-measure; and TRACKB's P1 baseline.

### Amendment 5c: the dive drawn (fielding only, 13:35Z)

Sources: `phase5/REPORT.md`, "Freeze amendment 5c"; `fielding/REPORT.md` addenda 4 and 5. Builder-measured.

- **The defect.** A ball below the 0.12 m feet-catch minimum can only be taken by a dive. When the chosen take-off had
  no hip travel, it fell at the same instant as the take, the take sample overwrote the `dive` sample, and the drawn
  path showed no dive. In `rand#912` the keeper takes a ball at 0.097 m while running at 6.5 m/s, then stops dead at
  12.7 m/s², 2.12× his class limit (2 of 3,325 struck balls on 5b).
- **The fix.** `src/physics/fielding.ts` (`2640d7bf…`) draws a dive's take-off no later than 0.05 s before the take
  (`diveDrawT`, `DIVE_DRAW_MIN_S`), at his position on the run and never before he can move. Only the path changes;
  the decision code is untouched.
- **Proof that outcomes are unchanged.** All 3,325 struck balls are byte-identical in play, events, ball samples and
  dead time. Only 7 primary-fielder dive paths change, and the 951 keeper takes are identical. The peak acceleration
  ratio is back to 1.041×.
- **Tests.** `fieldingBudget.test.ts` now checks that every dive take has a drawn `dive` sample before it, bounds the
  drawn carry, and adds the fast-keeper case: 77/77, typecheck rc 0.

### Amendment 5d: control honesty (frozen at 15:22Z)

Source: `phase5/REPORT.md`, "Freeze amendment 5d"; evidence `phase5/5d-evidence.json`. Builder-measured.

- **Why.** I1's CI showed CTL3 (bearing p90 29.7°) and CTL4 (ρ of power against exit speed, −0.918) failing. PHYS2's
  bisection shows both broke at **phase 1**: the earlier PASS relied on a bat that went where a human body cannot.
  - Delivery 0: the ball is 0.13 m high at the forward plane. A grounded straight bat there needs the hands
    0.67–0.71 m from the shoulders, against 0.57 m of reach, a 0.18 m crouch cap and no hip flexion.
  - The −60° pull at ref-3: the ball is level with the body.
  - Phase 5's ceiling set the face for the requested speed, not the speed played, so capped strokes flew off at the
    wrong bearing (−88° to −96° instead of −60°).
- **(A) Capped strokes are honest.** A capped stroke's face is solved for the speed it actually plays, and every
  ceiling bisects a fixed 0.5–32 m/s grid. A capped stroke now saturates instead of falling with more power.
- **(B) The 5b admission bound, corrected.** It now uses an upper curvature bound,
  C = |p″|max + |p′|²max ÷ (0.075 m / 2). Two 1–2 µm physics-track dips the corpus found are re-planned. Cost: about
  10% of p90.
- **Results.**
  - Reach corpus: 2 passes, every gate 0; outcomeHash `a97a8fde`.
  - Golden: `--write` and `--check` pass, the TypeScript golden is 2/2, and the thin edge is unchanged.
  - Guards: 0 exceptions and 0 non-finite; equality 732/732; the dense sweep has **0 islands and 0 speed steps**, so
    the named ref-4 island and speed step of phase 5 are gone; island census 13; **slow middles 335** (525 before);
    `resolveDelivery` p90 21.9–22.0 ms (phase 3: 23.6–24.3 in the same runs).
  - Bands still valid. Census refrozen: accepted bat contacts 1,588 → 1,576.
- **Control rubric lines (non-strict).**
  - **CTL3: FAIL.** The bearing now follows the gesture (p90 0.4°, median 0.0°), but only 55 of the 64 cases are
    middles, against the 60 needed: the capped −60° pulls miss.
  - **CTL4: FAIL.** The minimum ρ(power → exit speed) is 0.267. Delivery 0 is capped at about 32 km/h at every level (it
    saturates; it no longer falls), delivery 1 saturates at the top, and delivery 2 is monotonic.
  - Elevation ρ 1.000, the "10% faster" check, CTL2 and EX2: PASS.
- **Lead ruling.** CTL3 and CTL4 remain an **honest FAIL**, and the test cases are not changed. The fix is the
  body-model contract change already in the not-now register: hip flexion or deeper crouch, plus a per-stroke contact
  plane. It is the owner's top decision, because it reverses "contract v6 everywhere" (`docs/LAUNCH_BLOCKERS.md`).
- **Full vitest** (15:06–15:19Z): the named cut failure; `shot.test.ts` "meets a yorker" was re-pinned with a written
  reason (the capped loft is now 0.64 of the drive's speed, so its bound rose from 0.6 to 0.7; it is still a capped
  prod); and COACH's `properties.test.ts:207`, whose fixed sample no longer contains a well-played case, is routed to
  COACH. Typecheck rc 0.

### Amendment 5e: whole-swing forgiveness and the unreached bounce (frozen at 2026-11-04T02:49Z)

Source: `phase5/REPORT.md`, "Freeze amendment 5e"; evidence `phase5/5e-evidence.json` and `phase5/bands-5e.txt`.
These are builder-measured; the lead checked run2's gates. Against 5d, only `bat.ts` and `resolve.ts` differ. `frame.ts`
and the other 22 physics files are byte-identical. Real is identical to 5d, so the bands and the census need no refreeze.

- **SYS1: whole-swing forgiveness (`bat.ts`).**
  - Before 5e, Learn and Play moved only the arrival at the zone, so the forgiven swing was a different, shorter or
    longer swing from Real's.
  - Now Learn and Play play the Real swing for the band-mapped error. The whole swing, start and arrival together,
    shifts by forgive(e) − e. Travel stays `batTravelMs`. The raw error is kept for the label and the record.
  - On run1, 1,170 of 1,170 Learn/Play results equal Real at the mapped error: contact, runs, dismissal, and exit speed and bearing to 1e-6.
    The physics digest is identical. Run2's figures are in `phase5/5e-evidence.json`.
  - Largest start shift (active edge − 55 ms; a late swing starts earlier, an early one later):

    | Tier tolerance | Learn | Play |
    | --- | --- | --- |
    | 0 ms | 62 ms | 31 ms |
    | 12 ms | 74 ms | 43 ms |
    | 20 ms | 82 ms | 51 ms |

  - **Presentation rule (lead).** A Learn/Play physics bat may start before the player's input, by up to these shifts.
    The presented bat must still never move before the input. It starts visibly at the input and catches up to `batAt`
    by contact (WEB-HUMANS' presented bat; UNITY's equivalent).
- **COH4: no phantom bounce (`resolve.ts`, `dropUnreachedBounce`).** The planned pitch bounce is removed when the ball
  meets the bat, pad or body, hits the stumps or reaches the keeper before it would pitch. Run1: 0 phantom and 0
  missing bounces over 540 cases. Test change: `resolve.test.ts` `bowled_on` now requires a bat contact; the reason is
  written in the test.
- **Label audit, corrected after EVAL-PHYS-5E.** Of 1,755 results, 627 read solid or perfect with no bat contact, and
  none comes from the assistance; the evaluator confirms both totals. The split by reason depends on which test runs
  first: "late movement beat the read" is 3/2/0 (Learn/Play/Real) only when reach is tested first, and 47/42/24 when
  the read is tested first. The builder's earlier table is withdrawn.
  - **The "face window narrower than the band" class (62, 9 of them in Real) is not covered by the ref-5 ruling.** That
    ruling covers a perfect label on an off-sweet *contact*. Here there is no contact at all, and in 6 of 12 tuples the
    on-time contact is an edge. This class needs its own ruling, and is open (lead, 2026-11-04).
- **Independent verdict (EVAL-PHYS-5E, `eval-phys-5e/VERDICT.md`).**
  - **PASS:** SYS1, COH4, Real unchanged, the Unity goldens, the suites and FAIR1/FAIR2.
  - **FAIL:** causality. 337 of 2,880 late Learn/Play swings meet the ball before the input, so COH5 fails on stage. Bat
    contacts after the stumps also occur. Amendment 5f supersedes 5e for this.
  - **FAIR6 at Play:** UNPROVEN on 5e.
  - **A pre-existing Real continuity break** (ref-4 straight drive: the bearing flips at +1.0 ms, and the contact moves from
    the corner to the face between +2.6 and +3.8 ms) breaks rule (i) on 5d and 5e alike. It is a named limitation,
    pending its own physics round.

- **Not landed: CTL4 toe-clear ordering.** It raised delivery 0 from 3.0 to 15.4–20.5 m/s, but CTL4 still failed
  (ρ 0.740). It also broke ★ CTL2 lofted (11/15), added 6 Play islands and moved 166 census cases. It was reverted. The
  patch is kept for the body-model round. CTL3 and CTL4 remain an honest FAIL (see "Amendment 5d").

### Amendment 5f: causality, no touch before the input (frozen at 2026-11-04T06:30Z)

Source: `phase5/REPORT.md`, "Freeze amendment 5f". These are builder runs checked by the lead; an evaluator re-check
is pending.

- **Why.** EVAL-PHYS-5E and WORKER found that on 5e a late Learn/Play swing could meet the ball before the player's
  input (337 of 2,880 late swings), and that a swing started after the stumps could still change the result. The
  presented bat cannot honestly draw a contact before the input, so COH5 failed.
- **The causal cap (`contact.ts`).** Forgiveness is reduced so that the first touch (bat, pad or body) is at or after
  the raw input. The search scans a 4 ms grid of absolute errors and then bisects, so the reduction is the least on that
  grid: EVAL-PHYS-5F (interim) finds that in 17 of 600 capped cases it is up to 2.3 ms more than strictly needed. The record declares
  `rawMs`, `mappedMs` and `effectiveMs`, and the result is bit-identical to Real at `effectiveMs`. With realistic timing
  it never binds (1,170/1,170). On the late grid it binds in 8.3% of rows, with a median reduction of 26.6 ms.
- **The body (`collision.ts` `sweepFrom`).** The stance body applies until the swing's own start; the footwork body
  collides only from then on.
- **Leave-equivalence (`resolve.ts`).** If the ball hit the stumps or the stance body before the raw input, the result
  is exactly the leave's. The swing is drawn as the raw swing from the input and touches nothing.
- **The keeper (`fielding.ts`).**
  - `shortM` now includes height (`catchMaxH` 2.4 m standing, `catchDiveMaxH` 1.8 m diving).
  - The `keeper_take` event carries `shortM` only when it is above 0 (contract v6, additive).
  - No outcome changes.
- **Continuity exception (lead ruling, recorded after the result).** One new island and four series of speed steps at
  the causal boundary, where the input passes the moment the bat would meet the ball. Real makes the same switch.
  Overall, islands fall from 216 to 140.
- **Presentation consequences** (`docs/PRACTICE_PRESENTATION.md`):
  - the drawn stride starts at the input;
  - before the input, only the trigger and the backlift;
  - a leave stays in the stance.

### The amended monotonic and continuity rule (lead ruling)

How exit bearing and contact may change with timing. The base rule is recorded in `phase3/exit-bearing.txt`:
monotonic only where the ball meets the face inside the edge band; beyond that, toe and heel mishits may be
non-monotonic if they are deterministic, have no discontinuity larger than the neighbouring 1 ms steps imply, and
report the contact location (bladeU). The lead amended it into four conditions (the phase-3 and phase-4 filing notes,
PHYS2's phase-5 messages, and the freeze note in `phase5/REPORT.md`):

1. No step may come from a planner candidate switch or a geometry switch.
2. Inside the face region, no per-millisecond step in bearing, contact point or bat speed may be larger than 1.5× the
   larger of its two neighbouring steps.
3. **As amended at the freeze:** a counter-trend from the material model (`faceCor` and `swingArm` falling towards the
   toe) is allowed when it is smooth under condition 2 and its total excursion stays within 2°. The earlier figure of
   0.3°/ms per step was the lead's guess, not physics, and is withdrawn.
4. **As amended at the freeze:** the contact point's motion stays within 1.1× its kinematic bound, and the bound
   includes the blade-rotation term: the along-blade ball speed × the meeting-time shift, plus the blade's turn between
   the two meeting poses.

Measured on the 14 strokes that meet the ball in the face region (`phase5/REPORT.md`, item 3):
- condition 1 passes: 0 local reversals (phase 3 had two, of 2.27° and 2.48°, with the contact jumping 8–12 mm back up
  the blade);
- condition 2 passes;
- condition 3: 7 strokes have counter-trend steps of 0.33–0.64°/ms, always at the toe-side end of the sweet region,
  with a maximum excursion of 1.92°. They failed the withdrawn wording and meet the amended rule;
- condition 4: on 10 strokes (ref-1 and ref-2) the contact moves by the old bound plus a near-constant 0.34–0.56 mm/ms,
  which is the blade-rotation term. They meet the amended rule; ref-6 passed either way (ratio ≤ 0.93).

Towards the toe the restitution falls (0.52 → 0.18) and so does the effective mass (0.60 → 0.46), so a mishit there can
exit squarer (`phase3/exit-bearing.txt`).

### Yorkers (lead ruling (a), phase 4)

- **Root cause.** Auto footwork used to dig yorker lengths out from the back plane, 1.05 m in front of the stumps. A
  grounded straight bat there puts the handle against the torso capsule and 5 cm in front of the shoulders, so every
  candidate fails the anatomy certificate, and the fallback passed 11–13 cm over the ball (`phase4/REPORT.md` item 1).
- **The ruling, landed.** Auto footwork smothers yorker lengths on the forward stride (landed at 10:31Z). ref-6 stays
  a yorker by delivery. Its "at the toes" property is measured at the batter's stance plane (`batterBody(null).stance.z`,
  1.1 m in front of the stumps), with the threshold unchanged (below 0.15 m): it measures 0.072 m there. At the auto
  contact plane on the forward stride the ball is now at 0.198 m. `reference.test.ts` also checks that auto footwork
  meets ref-6 forward and that an on-time auto drive meets it with the bat (`phase5/REPORT.md`, item 1).
- **A named limitation.** The back-plane dig-out needs hip flexion, or crouch beyond the contract's 0.18 m, which the
  body model does not have. The coach never recommends it. A body-model change is a contract change and is in the
  not-now register.

### Named limitations

- **Running has no braking or turn (`running.ts`, recorded 2026-11-04).** Each run is a sprint from standing over
  `RUN_M` = 16.5 m (5.5 m/s² to 7.5 m/s) that ends at full speed at the completion. A `TURN_S` = 0.15 s dwell
  follows, then the next run starts from rest. There is no positional path, only completion times. So the speed
  implied at each turn reverses instantly, and runs after the first are about 0.4–0.6 s quicker than a run with a
  real braking and turning phase. Presentation keeps the physics times exactly. To brake at a bounded 10 m/s², it
  draws the runners' cruise at up to about 8.2–8.7 m/s, faster than the model's 7.5 (WEB-HUMANS,
  `practice/nonStriker.ts` `sprintProfile`). Fixing this changes run and run-out outcomes. It is scoped after 5f
  as a separate amendment, which needs its own lead decision.
- **The ref-5 hook** is the exception to the bands. Its sweet window is [−8, +8] ms and its face window [−17, +60], so
  Real's perfect band (14 ms) is wider than its sweet window. The lead accepted the exception; per-family bands are in
  the not-now register (`phase3/REPORT.md` §2).
- **The back-foot cut at the short wide ball** (8 m, 0.45 m wide, about 0.34 m outside off stump at waist height) is a
  **named limitation of contract v6** (lead ruling at the freeze). With the face set for the requested 100° exit, every
  horizontal-class blade axis puts the hands 0.85–0.98 m from the shoulders, against a reach of 0.57 m, so even a
  stopped bat fails; the only reachable axis is near-vertical, which is a steer. A real batter meets this ball about
  0.4 m in front of his body, which needs a stroke-dependent contact plane or body placement: a contract change, in the
  not-now register (`phase5/REPORT.md`, item 5; `phase4/REPORT.md` item 5).
  - `shot.test.ts` "cuts the short wide ball" stays failing, unchanged and unskipped. It was the only failure in the
    phase-5 full vitest (11:37–11:49Z). After 5d the golden passes again; the only other open failure is COACH's
    `properties.test.ts:207` (see "Amendment 5d").
  - The coach does not recommend the stroke, because `soundAtCentre` rejects slow fends.
  - The owner decides whether the checkpoint commit may carry this one failing test.
- **Control (CTL3 and CTL4): an honest FAIL since phase 1.** Capped strokes cannot reach a low ball at the forward
  plane or a ball level with the body, within 0.57 m of reach, the 0.18 m crouch cap and no hip flexion. The fix is the
  body-model contract change, the owner's decision (see "Amendment 5d").
- **Slow middles.** Middle contacts with the bat under 20 km/h: 452 before phase 5, 525 on phase 5, **335 on the frozen
  5d physics**. The coach does not praise or recommend them (`phase5/REPORT.md`).
- **The phase-5 named island is gone.** The ref-4 Play 45° drive at +4 ms took the outside edge as the read jumped onto
  the post-bounce line; on 5d the dense sweep has 0 islands and 0 speed steps. The guard stays "0 unexplained
  islands".
- **Out of reach.** 9 of 720 out-of-reach attacks still whiff, fail-closed (`phase2/REPORT.md` §3).
- **ref-3 top edges.** On the phase-2 Real drive sweep, 9 of the 10 boundaries were top edges flying fine off ref-3's
  rising hard-length ball. Physically plausible, but flagged for the evaluators (`phase2/REPORT.md` §9).

### Guards on the frozen physics

Measured on a byte-identical scratch copy, 11:18–11:24Z, at a load of 6.6–10.2 (`phase5/REPORT.md`):

| Guard | Phase 5 (frozen) | Phase 3 |
| --- | --- | --- |
| Reference properties | 4/4 | 4/4 |
| Exceptions | 0 of 9,504 swings | 0 |
| Non-finite results | 0 of 1,008 | 0 |
| Equality with the full-scan reference | 732/732, 0 differences | 732/732 |
| Dense-sweep islands | 1, named (above) | 0 |
| Dense speed steps over 2 m/s | 1 (ref-4 Real 45° drive, 16 → 17 ms, 12.55 → 10.48 m/s; it meets condition 2) | 22 |
| Island census | 15 | 20 |
| `resolveDelivery` p90 / p99, same interleaved runs | 19.3–19.5 / 26 ms | 24.7–25.1 / 69 ms |

- The census was refrozen in phase 5 (hashes 33d848e / ae1c5291): miss 4,482, middle 1,260, pad 650, inside edge 85,
  outside edge 23, leading edge 147, body 843, top edge 70; 1,585 accepted bat contacts. The minimum accepted
  clearance fell from 0.21 mm to 1.7e-11 m, because roots now sit on the reach boundary; that still passes the −1e-9
  gate.
- **After phase 5b:** the census moved to 1,588 accepted bat contacts (hashes `e14b8bec` / `8fe0a8d7`), and
  `resolveDelivery` p90 was 22.2–22.6 ms (see "Phase 5b").
- **After 5d (the frozen state):** 1,576 accepted bat contacts; 0 exceptions, 0 non-finite, equality 732/732; 0
  islands and 0 speed steps in the dense sweep; island census 13; slow middles 335; `resolveDelivery` p90
  21.9–22.0 ms (see "Amendment 5d").
- `resolveDelivery` cost by phase is in `docs/PERFORMANCE.md` §5.6.
- **After the freeze**, the evaluators rerun W0, COACH2, FAIR6 and Track E on the re-frozen build, UNITY regenerates
  the golden fixture against the new `batAt`, and the one local checkpoint commit the owner approved may be made once
  the tests pass (wedge prompt §10, O7; see the cut above).

## Frame, units and determinism

World frame as in `src/contracts/practice.ts`: metres and seconds, origin at the pitch centre on the ground, +Y up,
+Z towards the striker (striker's stumps at z = +10.06), +X the striker's off side. Physics always runs in the
striker's own right-handed frame: for a left-handed striker the caller mirrors presentation (x → −x), and
`flight({ ..., handedness: 'left' })` mirrors the real bowler's arm (a right-arm bowler bowls as a left-armer in
that frame). Plan lines and variations are batter-relative: `lineM` + is this striker's off side; an outswinger
leaves this batter. Bearings are degrees from straight down the ground (towards the bowler, −z), + to the off side.

Determinism: every trajectory is integrated with classical RK4 on a fixed step `SIM_DT` = 1 ms, with events (bounce,
stumps plane, rope, rest) located inside the step and the remainder of the step completed, so samples always sit on
the grid t0 + i·dt. The physics uses only IEEE-754 basic arithmetic and `Math.sqrt` (both correctly rounded) and the
polynomial `dsin/dcos/datan2/dexp/dtanh` of `vec.ts` (accurate to ~1e-16; tested against `Math`): no `Math.sin`,
`Math.pow`, `**`, `Math.hypot`, `Date` or `Math.random`. Seeded variation (the seam's landing, a bowler's build)
comes from `rngFromKey` of `src/engine/prng.ts` (SHA-256 seeded sfc32), the repository's one PRNG. The same delivery
seed and normalized swing therefore reproduce the identical result on every device and browser.

## The ball

In the air (`ball.ts`), per unit mass:

- gravity, g = 9.81 m/s²;
- quadratic drag, a = −½ρC_dA|v|v/m with ρ = 1.18 kg/m³, C_d = 0.38, A = πR², R = 0.036 m, m = 0.16 kg;
- Magnus lift along ω × v with C_L = min(0.30, 1.0·S), S = R|ω⊥|/|v| (spin parameter): drift (side-spin), dip
  (top-spin) and the carry of back-spin;
- swing (before the first bounce only): a horizontal side force ½ρC_sA|v|²·(up × v̂) with a signed coefficient from the
  seam's presentation; it fades above 34 m/s to 55% at 42 m/s, as the boundary layer turns turbulent on both sides.

Bounce on the pitch strip (|x| ≤ 1.525 m) or the outfield:

- normal: v_y' = −e·v_y (pitch restitution per condition, outfield 0.40);
- along the line of travel: Coulomb friction μ·(1 + e)|v_y| up to the impulse that would make the ball roll (sphere
  I = 0.4 mR²): the ball loses pace off the pitch; only 35% of that impulse spins the ball (`PLOUGH_SPIN_FRACTION`),
  because a ball arriving at pace digs in and the friction acts above its lowest point; a rigid-sphere bounce would
  turn seam-up back-spin into ≈ 40 rev/s of top-spin and a post-bounce dip that real trajectories do not show;
- across the line: a partial rolling constraint, `turnGrip`·u_l/3.5 (capped at 0.6 of the normal impulse), where u_l is
  the contact point's sideways slip from the rifle (side) spin: this is the turn. The spin changes accordingly;
- on the first pitch bounce of a delivery, the seam deflection: the ground velocity rotates by `seamDev` radians.

On the ground: rolling resistance plus grass drag, a = 0.5 + 0.35·v (m/s²), integrated exactly per step; a 90 km/h
ground stroke rolls ≈ 62 m. The ball stops below 0.15 m/s. The rope is the circle of radius 62 m about the pitch
centre; `boundary.onFull` is true only if the ball has not touched the ground since it started (a ball that starts on
the grass is grounded). The stumps plane crossing (z = 10.06) is interpolated within the step; `detectStumps` finds a
ball hitting the striker's stumps (sub-sampled, so it cannot pass through them).

### Pitch conditions

| Condition | Restitution | Friction | Seam grip (rad) | Turn grip | Swing × |
| --- | --- | --- | --- | --- | --- |
| Balanced | 0.60 | 0.30 | 0.014 | 0.55 | 1.00 |
| Green | 0.58 | 0.27 | 0.026 | 0.45 | 1.45 |
| Hard & Bouncy | 0.67 | 0.25 | 0.012 | 0.50 | 0.85 |
| Turning | 0.55 | 0.40 | 0.012 | 0.95 | 0.80 |

Calibration targets (all asserted in `tests/unit/physics/delivery.test.ts`): a good length (6 m) passes the stumps at
0.55–0.8 m (top of the stumps); a bouncer pitched 10.5 m from the stumps reaches the batter at chest height
(1.2–1.5 m) and one at 11.5 m at head height (1.5–1.85 m) for 125–145 km/h; pace loses ≈ 15–20% from hand to
stumps (drag ≈ 9%, the pitch ≈ 9%); Green swings ≈ 1.45× and seams ≈ 1.8× Balanced; Turning turns ≈ 1.6–2×.

## Deliveries

`releaseFor(plan, bowler, conditions, seed, handedness)` builds the physical release, and `solveRelease` aims it:

- Hand position, over the wicket: pace 2.05–2.30 m high, 0.42 m to the arm's side of middle, 1.40 m in front of the
  bowler's stumps; spin 1.80–2.00 m, 0.30 m, 1.28 m. The height and width are the bowler's build (from `lookSeed`), the
  same for every ball he bowls; a right-arm bowler releases on the striker's off side (+x), a left-armer on the leg
  side. Bouncers stand 4 cm taller, yorkers 2 cm lower.
- Speed: exactly `plan.speedKph`; `release.speedKph` is |v| at release, never a label.
- Spin and swing per variation (pace): stock, seam-up back-spin 13 rev/s and a little natural swing either way;
  outswing / inswing, C_s = 0.13 × condition, seam at ±18°; seam, upright seam (17 rev/s), small swing and 1.7× seam
  deflection, never near zero; cutter, 11 rev/s mostly rifle spin (off-cutter in, leg-cutter away, seeded 60/40), so it
  grips and cuts; slower, tumbling 6 rev/s with over-spin, no swing (it dips, and it is slower: that is its disguise);
  bouncer and yorker, stock spin.
- Spin (rate 28 rev/s finger, 30 rev/s wrist): split into rifle (turn), top (dip) and side (drift) components. Stock:
  0.62/0.55/0.25; flighted: slower, more over-spin; quicker: flatter, more rifle; top-spinner: mostly over-spin (dips,
  bounces, barely turns); arm ball: back-spin with the seam upright, swings with the arm, does not turn; wrong'un:
  googly (wrist) or carrom ball (finger), turning the other way. Turn direction is by spin type and (mirrored) arm: an
  off-break, into the batter, comes from a right-arm finger spinner or a left-arm wrist spinner. The ball drifts
  against the turn.
- Seam landing (which way it seams) is seeded per delivery and part of the locked over; it never depends on the swing.
- Aiming: Newton's method on the release elevation and azimuth, with the full integrator (drag, Magnus, swing, seam,
  turn), so the ball pitches at `plan.lengthM` in front of the striker's stumps and crosses the stumps plane at
  `plan.lineM` to well under a centimetre (tested for every variation and condition). About 2.5 ms per delivery.

- The ball (`flight({ ..., ball })`, the over's `BallCondition`, default `DEFAULT_BALL` = new white): a new ball is
  exactly the calibration above; a worn one (about 40+ overs: the shine gone, the seam flatter) keeps 60% of its swing
  coefficient and 75% of its seam deviation (`BALL_AGE_FACTORS`). It moves the same way, only less: there is no
  reverse swing. Spin, the cutter's grip and the pitch do not change with age. The colour is presentation only.

`flight()` returns the contract's `BallFlight` plus `spin: { release, afterBounce }` (rad/s vectors), with dense 1 ms
samples to 0.3 m past the stumps, the bounce, `stumpsT`, `wouldHitStumps` (any part of the ball on the stumps or
bails) and `idealContactT`. `flightMovement()` gives the coaching numbers: movement in the air (swing or drift),
movement off the pitch (seam or turn) and the height at the bat.

### The seam cue (`BallFlight.seam`)

The batter's legitimate cues, derived by `seamCue()` from the very values the physics flies (unit vectors in the
striker frame, at release), so what is drawn always agrees with how the ball moves:

- `axis`, the seam plane's normal, signed so that axis · spin ≥ 0. A seam-up pace ball (stock, outswing, inswing,
  seam, bouncer, yorker) spins about it: the back-spin axis (horizontal, square to the line of travel f) turned about
  the vertical by the seam angle `release.seamDeg` (+ towards slip, − towards fine leg), −cos θ·l + sin θ·f with
  l = up × f, so the seam holds its angle all the way. The cutter and the slower ball present the same seam, but the
  fingers or the hand spin the ball about the physics' spin vector instead, so the seam wobbles. A spinner's seam is
  normal to its spin axis.
- `shine`, the pole of the polished half: exactly ±axis (the seam divides the two halves), on the side away from the
  physics' own swing (conventional swing goes towards the rough side): shine · (up × v̂) has the sign opposite to the
  swing coefficient. With no swing, +axis.
- `wobble`, the angle between the seam's normal and the axis the ball spins about, over 90°: 0 for seam-up and spin
  deliveries; 0.89 for the cutter (82% rifle spin under a seam presented at 25°), 0.64 for the slower ball.
- A worn ball keeps the same seam, shine and wobble; it moves less (the renderer shows its age).

The physics flies a seam-up ball's spin as pure back-spin at its rate: the angled seam's rifle part (rate × sin θ, up
to 31% for an 18° swinger) adds no Magnus force, and the model gives a seam-up ball no grip from it. So the drawn
rotation is `ballRotation(flight)`: a seam-up pace ball turns about `seam.axis` at the physics' rate (its seam holds
still and its shine stays on one side), every other ball turns exactly about the physics' spin vector (before and after
the bounce), so a scrambled seam wobbles by exactly `seam.wobble` × 90°. For a left-handed striker, presentation
mirrors `axis` and `shine` as positions (x → −x) and rotation vectors as axial vectors ((x, y, z) → (x, −y, −z)).
Multiplayer flights (`flightFromPath`) carry the same cue from their fitted swing and spin (a new white ball).

## Reaction time and the timing reference

Real flight times are kept (release to the ideal contact, measured and tested): stock pace 0.46–0.58 s across
120–152 km/h (the brief's 0.42–0.63 s), spin 0.67–0.94 s across 75–98 km/h (0.66–0.97 s). Slower balls are genuinely
slower: a 90 km/h pace ball takes ≈ 0.73 s (bounded by `SLOW_PACE_MAX_FLIGHT_S` = 0.8 s). Any pace ball the physics
models lies in `PACE_KPH` = 90–155 km/h; spin in `SPIN_KPH` = 75–98 km/h.

The ideal contact is where the ball crosses the batter's contact plane: 1.80 m in front of the stumps on a forward
stride, 1.05 m on the back foot, 1.50 m playing across, 2.90 m down the track. Automatic footwork goes forward to
lengths fuller than 5.2 m (pace) or 6.2 m (spin) and back to anything shorter. Yorkers (≤ 1.8 m) were dug out from the
crease; since 2026-11-03 they are smothered on the forward stride (lead ruling (a); see "Yorkers"). `flight.idealContactT` is the time for the automatic footwork; a manual footwork uses its own plane
(`idealTimeFor`). The swing's virtual contact time is

    virtualContactTime = swing.startT + batTravelMs(kind, power)

with `batTravelMs` = 120 ms for a defensive tap and 120 + 30·power ms for an attacking flick (a harder hit needs a
bigger backlift, so it must start earlier). `swing.startT` is on the simulation clock with the device calibration
offset already applied by the input layer (from high-resolution event timestamps, never frame numbers); the physics
adds no latency of its own. The timing error is `virtualContactTime − idealT` (ms, + late).

## The virtual bat

`buildBatTrack(flight, swing, opts)` produces a continuous rigid-bat track, `batPose(track, t)` → grip (top of the
handle), toe, face normal, sampled as `BatSample[]` for presentation (every 4 ms) and evaluated exactly by the
collision.

1. The read. The batter places the bat where he judges the ball will cross his contact plane. He judges length,
   bounce and pace from the flight he has seen (height and arrival are the real ones); the line is his prediction at
   the commit time, 150 ms before the bat arrives, the same at every level (one read model: the levels differ only by
   their declared timing bands). International batsmen could not adjust to a deviation off the pitch within about
   190 ms (P. McLeod, "Visual reaction time and high-speed ball games", Perception 16, 1987). He predicts the line from
   the ball's sideways motion at the commit, with the swing he has seen curving it on while it is in the air, and, when
   he committed before it pitched, plays for the bowler's stock ball: the deviation off the pitch the stock ball's spin
   would give on this pitch, through the same bounce physics (`readExpectation`; resolveDelivery always passes the
   bowler). Whatever departs from that after the commit beats the bat honestly: swing beyond the curve he saw, the seam
   landing of a full ball, the wrong'un and the arm ball, extra or less turn.
2. The stroke (see "Shot geometry"). The kind, direction, elevation, power and footwork the player chose fix the
   stroke: a vertical or a horizontal blade and a reach in the line and height of the ball. The sweet spot aims at
   the read clamped into that reach, so a ball outside it meets the bat that far from the sweet spot (an edge, the
   toe, the shoulder or the gloves) or passes it. A ball above a vertical bat's reach is met on the rising part of the
   swing's arc: the face is opened by acos(1 − Δ/R), R = 2.5 m (`SWING_ARC_R`), and the ball pops up.
3. The face. Attack: the face for which a sweet-spot hit leaves at the flick's bearing and at an elevation of
   −3° + 38°·elevation (along the ground … lofted) plus any pop-up, found by a damped Newton solve through the impact
   model with the bat moving along the ball's line at the speed that gives the face the flick's bat speed (8 +
   24·power m/s; ×0.75 for a vertical-bat stroke off the back foot, `BACK_FOOT_PUNCH`, which has no stride to swing
   through; up to 1.6× that along the line for angled faces). Defence: a dead bat (2 m/s, soft hands) square to the
   line, 8° over the ball and only 8% of the way towards the aim, because a dead bat turns any face angle into a large
   deflection. The toe never goes below the ground, so a yorker is met near the toe.
4. Timing. In the hitting zone the bat moves along the ball's line; timing error moves it across the line and rotates
   its face at fixed rates (per ms of the physical error ε at which the ball would meet it): across the face 0.98 mm/ms
   (the face edge at the solid limit), towards the toe 7 cm·(ε/80)², face yaw 0.30°/ms (early closes the face towards
   leg, late opens it) and tilt 0.20°/ms (early up, late down). The face rotates about the virtual ball centre, so the
   ball meets the face exactly at the designed offset. The drift runs towards the off side for straight and off-side
   strokes (late → outside edge, early → inside edge), towards leg for leg-side strokes (early → the leading edge, late
   → inside edge), upwards on the pull (late → top edge) and downwards on the cut (late → the bottom edge, behind).
5. Outside the zone the bat blends from its waiting pose (picked up behind the batter, out of the ball's path, as
   batters hold it in the bowler's delivery stride; a swing that starts too late therefore misses rather than
   blocking the ball with a grounded bat) through the backlift (at least 15 ms) and on into the follow-through over the
   front shoulder; defence holds its block. A swing with non-finite fields is treated as a leave.

The batter's body (`batterBody(footwork, flight)`): vertical pad capsules (radius 7.5 cm, 6–62 cm high), a torso
capsule and the head sphere (centre 1.62 m in the stance, 1.52 m leaning into a forward stride). On a stride the front
pad goes just inside the ball's line with the bat beside it; a leave is played from the stance (`batterBody(null)`).
Manual footwork that fights the length (forward to ≥ 7 m, back to ≤ 3.5 m, down the track to pace) costs balance,
which lowers the effective bat mass and restitution.

## Collision

`collision.ts` sweeps the ball (linear between flight samples) against the blade (a 0.56 × 0.108 × 0.05 m box), the
handle and gloves (a 5 cm capsule), both pads, the torso and the head by conservative advancement: at time t the
separation d(t) (distance from the ball centre to the nearest surface minus R) is evaluated on the exact bat pose, and
time advances by d / v_max, where v_max bounds the closing speed (ball speed plus 1.3× the fastest bat point over the
interval plus 4 m/s). The step can never jump past a contact, so no ball tunnels at any speed or sample spacing
(tested: a 160 km/h ball sampled every 20 ms against a 15 cm pad, and the same bat contact at 155 km/h with 1 ms
and 8 ms samples). Contact is declared at 10 µm separation; the result has the time, the ball state, the surface point
and normal, and for the blade its local coordinates and region (face, edge, back, toe, shoulder).

## Contact and the ball off the bat

`strike(flight, swing | null, { assist, tierToleranceMs })`:

- Kind: the face → `middle`; the edge on the off side of a vertical bat → `outside_edge` (`leading_edge` when the face
  is closed beyond 20° to leg), the leg side → `inside_edge`; a horizontal bat's upper edge, the shoulder, handle or
  gloves → `top_edge`, its lower edge → `outside_edge` on off-side strokes and `inside_edge` on leg-side ones; pads →
  `pad`; torso or head → `body`; nothing → `miss`; no swing → `leave` (or `pad`/`body` if the ball comes into him).
  Since 2026-11-03 a vertical bat's toe-end hit within the blade width, and any toe-cap contact (bladeU < 0), is
  `middle` with bladeU reported: contract v6 has no toe kind (see "The wedge physics repair").
- Exit: one impulse model (`impact.ts`) at the contact point, along the surface normal: relative velocity including
  the ball's spin (so incoming spin makes the ball squirt off the face), restitution, the bat's effective mass and
  Coulomb friction 0.25 up to rolling; spin changes with the friction torque. Restitution 0.52 at the sweet spot
  (Penrose et al.; Mehta & Pallis), falling quadratically along the blade to 35% at 15 cm towards the handle and at
  10 cm towards the toe (the free end, where the blade vibrates most), and by up to 35% across it. Effective mass
  0.6 kg at the sweet spot (bat and hands), set by the measured collision efficiency of a held cricket bat: a ball
  meeting a still bat at 100 km/h comes back at about 20 km/h, and off a moving bat it leaves at about 0.2 × its speed
  + 1.2 × the bat's (R. Cross, "Physics of cricket", University of Sydney); (e − m/M)/(1 + m/M) = 0.2 with e = 0.52
  gives M ≈ 0.6 kg. Less across the face; 0.22 kg on an edge (the bat twists), restitution 0.32 on edges; defence: the
  same 0.6 kg with soft-hands restitution 0.30, so the ball dies on the bat; gloves 0.2 and 0.5 kg; pads 0.25 against
  an immovable surface. Balance scales mass and restitution.
- The swing's arc (`swingArm`): the bat turns about an instantaneous centre near the hands, 0.84 m above the sweet
  spot (`SWING_PIVOT_M`: the bottom hand is 0.64 m above it, the centre about 0.2 m further back as the hands move
  forward). A point of the blade moves at (its distance from the centre) / 0.84 m of the sweet spot's speed and
  presents (0.84 m / distance)² of its effective mass (capped at 4×): a ball met up the blade meets a slower, heavier
  bat and comes off weak; one met towards the toe meets a quicker, lighter one. The track's pose still translates
  rigidly through the zone (so the timing windows are unchanged); the arc acts in the impact. Exit speeds: a
  power-0.7 drive leaves at about 130–135 km/h, a full-power hit at about 160 km/h (reported sixes: about 120–140 km/h).
- Report: timing error against the ideal contact for the footwork played, `timing` = the band of that raw error
  (`perfect`/`solid`/`mistimed`, `missed` beyond the edge band, `none` for a leave: it describes the swing, so a
  perfectly timed swing beaten by seam reads `perfect` + `miss`; since 2026-11-03 the label rule `metTiming` also
  applies, see "Timing bands"), contact point, `bladeU` (0 toe … 1 top of the blade, sweet spot 0.22; below 0 on the
  toe cap), face bearing, bat and exit speed, exit bearing and elevation, and the intended bearing (always the
  player's flick, for coaching). `quality.sweet` marks a hit within 6 cm along and 2.5 cm across the sweet spot.
- Also returned: the bat samples, `exit` (pass it to `simulate`), the first pad or body `impact` with its rebound, the
  closest approach on a miss (`delta` = ball − bat: + y over the bat), the footwork played and the bat track.

## Shot geometry

`shot.ts`: the stroke is the player's choice and fixes where the bat can go; it never adapts to the ball.
`shotFamily(kind, direction, footwork)` names the stroke (front foot: straight drive within 15° of straight, off drive
to 35°, cover drive to 75°, square drive to 125°, steer finer; on drive to −35°, flick to −125°, glance finer. Back
foot and across: back-foot drive within 15°, the off-side punch to 70°, the cut squarer; the on-side punch to −45°, the
pull to −115°, the hook finer; a defence forward or back). Each stroke is one bat, vertical or horizontal, with a reach
at the contact plane in the line `x` (m from middle stump, + off side) and the height `y` of the ball
(`SHOT_FORMS`), set by orthodox batting (MCC Coaching Manual: play with the line; drive the ball pitched up; go back to
the ball short of a length; cut the short wide ball; pull and hook the short ball at the body) in the bat's and the
body's geometry:

| Stroke | Bat | Line x (m) | Height y (m) | Lofted y (m) |
| --- | --- | --- | --- | --- |
| Forward defence / back defence | vertical | −0.32 … 0.50 | 0 … 0.95 / 0 … 1.28 | (no loft) |
| Straight drive (front) | vertical | −0.12 … 0.20 | 0 … 0.40 | 0.08 … 0.36 |
| Off drive / cover drive | vertical | 0 … 0.30 / 0.04 … 0.50 | 0 … 0.40 / 0.04 … 0.40 | 0.08 … 0.36 / 0.10 … 0.34 |
| Square drive / steer | vertical | 0.16 … 0.70 / 0.15 … 0.70 | 0.04 … 0.42 / 0.04 … 0.70 | 0.12 … 0.34 / 0.20 … 0.45 |
| On drive / flick / glance | vertical | −0.22 … 0.08 / −0.48 … 0.05 / −0.55 … 0 | 0 … 0.40 / 0 … 0.70 / 0 … 0.80 | 0.08 … 0.36 / 0.10 … 0.45 / 0.15 … 0.55 |
| Back-foot drive / on-side punch | vertical | −0.12 … 0.22 / −0.24 … 0.08 | 0 … 1.10 | 0.20 … 0.32 |
| Off-side punch (back) | vertical | 0.04 … 0.50 | 0.62 … 1.15 | 0.75 … 0.95 |
| Cut | horizontal | 0.18 … 0.85 | 0.55 … 1.40 | 0.80 … 1.50 |
| Pull: a clip below 0.85 m, a pull above | vertical / horizontal | −0.48 … 0.06 / −0.48 … 0.30 | 0 … 0.95 / 0.85 … 1.50 | 0.25 … 0.50 / 0.90 … 1.45 |
| Hook: a glance below 1 m, a hook above | vertical / horizontal | −0.55 … 0.02 / −0.50 … 0.22 | 0 … 1.10 / 1.10 … 1.85 | 0.25 … 0.60 / 1.10 … 1.80 |

- The batter aims the sweet spot at his read clamped into the reach (`planShot`): inside it nothing changes; outside it
  the ball meets the bat as far from the sweet spot as it lay outside, which the swept collision turns into an edge, a
  toe, a shoulder, the gloves or a miss. A drive at a bouncer finds the shoulder or the gloves, a cut at a yorker
  passes over it, a pull at a full ball goes over it, a flick from outside off takes the leading edge, a cover drive at
  a ball on the stumps the inside edge or the gate.
- Lofting (elevation from 0.08, a horizontal launch, to 0.45, 15°, `SHOT_LOFT_FROM`/`SHOT_LOFT_FULL`) narrows the
  heights to the lofted ones: the face opens only on the rising part of the arc, so a vertical bat lofts the half-volley
  (on a stride) and almost nothing off the back foot; a good-length ball is lofted by getting to the pitch of it, or
  with a horizontal bat.
- A harder swing narrows every reach towards its middle by 0.35 × power² of its half-width (`SHOT_POWER_SHRINK`): it is
  committed earlier and adjusts less. A defence is not narrowed.
- A ball above a vertical bat's reach pops up (see "The virtual bat"), the classic drive on the up; a horizontal bat
  takes the top edge instead.
- Measured at perfect timing (`tests/unit/physics/shot.test.ts`, Real): a straight, cover or lofted drive at a
  head-high bouncer never makes middle contact (top edge or miss), the hook does; the cut and the lofted hit at a yorker
  miss or edge, a straight push digs it out near the toe; pull and flick at a full ball on off stump edge or miss, the
  drives meet it in the middle; only the cut middles the short wide ball; the lofted hit at a hard length never finds
  the sweet spot.
- The timing windows (`scripts/practice-physics-check.mjs`) are unchanged to the millisecond: the strokes there are
  inside their reach.
- Since 2026-11-03 two of these statements no longer hold as written. The yorker is met on the forward stride (see
  "Yorkers"). The cut at the short wide ball is a named limitation of contract v6: `shot.test.ts` "cuts the short wide
  ball" stays failing, unchanged and unskipped (see "Named limitations").

## Assistance

Real is pure physics plus the measured latency compensation (the calibration offset in `startT`). Since 2026-11-03
the Real bands are the measured windows of the bat on the reference over, and the bat's own rates are fixed separately
by `BAT_TIMING_CALIBRATION` (see "Timing bands"). Learn and Play keep the same geometry and make the swing more
forgiving in time: `forgive(e, bands)` maps the player's error piecewise-linearly through the active band edges onto
the Real band edges (slope 1 beyond), and the bat reaches the zone at `idealT + forgive(e)`. Since amendment 5e the whole
swing shifts with it (start and arrival together), so a Learn/Play swing is exactly the Real swing at the mapped error. So a Learn swing at the
edge of Learn's perfect band (31 ms late) plays exactly like a Real swing at the edge of Real's (14 ms late): the bat
really is moved (the track shows it), the face errors shrink with it (aim and face correction), and the effective
hitting window is larger. The intended direction is never
changed; a mistimed shot goes where the forgiven physics sends it. Every level reads the ball the same way (the 150 ms
commit), so reading late movement learnt in Learn transfers to Real. The Assisted performance tier adds its
`tierToleranceMs` (the declared device allowance) to all three band edges of Learn and Play; Real applies no
forgiveness on any tier (`activeBands('real', tol)` ignores it). The record keeps the raw tolerance.

## Timing bands (2026-11-03)

The lead ruled that the declared bands follow the physics: recalibrate them to the physical windows, and never label
a block that meets the ball "missed" (`physics/phase2/REPORT.md`, filing note). They are frozen with simulation v3 and
unchanged by phases 5b and 5d, and still valid on 5d (`physics/phase5/REPORT.md`, freeze note, "Phase 5b" and
"Freeze amendment 5d"). Paths in this section are under
`release/product-sequence/stage-1-practice/wedge/`. All results are builder-measured.

| Level | Perfect (ms) | Solid (ms) | Edge (ms) | Before 2026-11-03 |
| --- | --- | --- | --- | --- |
| Real | 14 | 29 | 55 | 25 / 55 / 80 |
| Play | 20 | 40 | 86 | 35 / 75 / 125 |
| Learn | 31 | 58 | 117 | 55 / 110 / 170 |

- **Labels and physics are separate.** `TIMING_BANDS` holds the label bands above. The bat's own calibration, how timing
  error moves it across the line and rotates its face, is `BAT_TIMING_CALIBRATION` = {perfect 25, solid 55, edge
  80} ms, frozen separately, so the physics at Real did not change (`physics/phase3/REPORT.md` §2).
- **How the bands were set.** From the minima of the in-reach attacking windows on the reference over: perfect inside
  every sweet window, solid inside every face window, and edge at least every face extent, so that a "missed" label
  never comes with a face hit (`physics/phase2/REPORT.md` §5). Solid is 29 ms, not 30, because after the C1 speed peak
  the ref-1 drive's face window ends at +29 ms.
- **The device allowance** (`tierToleranceMs`) is added to the band edges at Learn and Play only. Real applies no
  forgiveness on any tier.
- **The label rule** (`metTiming`): a bat contact is never "missed", so an attacking edge beyond the edge band reads
  "mistimed"; and a block met on the face is at least "solid" (`physics/phase3/REPORT.md` §2 and the lead's rulings in
  its filing note). Before, misses at −55…−45 and +35…+55 ms were labelled "solid", and blocks that met the ball were
  labelled "missed" on 71–114 of the milliseconds (`physics/phase2/REPORT.md` §5, §8).
- **The exception.** The ref-5 hook's sweet window is narrower than Real's perfect band (phase 3: [−8, +8] ms; phases
  5 and 5b: [−7, +8], `physics/phase5/bands.txt` and `bands-5b.txt`). The lead accepted it; per-family bands are in the
  not-now register. Its face window is now [−39, +80], so solid ⊆ face holds there too.
- **On the frozen physics** (phase 5, and again after 5b) the bands are unchanged and still valid at all three levels.
  The Real ref-1 drive's sweet window is [−16, +14] and its face window ends at +29 ms: the report gives [−30, +29]
  (`physics/phase5/REPORT.md`), and the band check gives [−35, +29] (`phase5/bands-5b.txt`).
- **Effects elsewhere.** The coach's execution spread is no longer clipped to a band, and form samples are versioned 3,
  because they are graded against the bands they carry (`docs/PRACTICE_COACH.md`). `docs/PERFORMANCE.md` §1.4 carries
  the device allowance.

Physical windows of the Real cover drive (55°, power 0.7) on phase 2, against the retired bands
(`physics/phase2/REPORT.md` §5):

| Ball | Sweet | Face | Any bat contact |
| --- | --- | --- | --- |
| ref-1 | [−19, +14] | [−34, +30] | [−41, +31] |
| ref-2 | [−23, +18] | [−40, +36] | [−46, +36] |
| ref-6 | [−36, +20] | [−52, +32] | [−58, +33] |

## Measured windows

**Historical.** The windows and bands in this section are the v2 check, measured before 2026-11-03 against the
retired bands. The current bands and windows are under "Timing bands".

`node scripts/practice-physics-check.mjs` sweeps the timing error from −260 to +260 ms in 1 ms steps through
`strike()` and reports the contiguous window around zero where the ball meets the sweet spot (perfect), the middle
(solid) and any part of the bat (edge), on a 136 km/h stock ball at a good length (6.5 m) and an 85 km/h off-break
pitched up (4 m: a spinner is driven from the pitch of the ball; at a good length it is above a front-foot drive's
reach), each with its seam landing square (seed 't3') so that nothing off the pitch beats the committed read, and the
batter playing for the bowler's stock ball. Pace, straight drive (v2):

| Level (bands) | Perfect | Solid | Edge |
| --- | --- | --- | --- |
| Learn (55/110/170) | −57 … +53 | −113 … +108 | −167 … +147 |
| Play (35/75/125) | −37 … +33 | −77 … +74 | −122 … +123 |
| Real (25/55/80) | −26 … +24 | −56 … +54 | −78 … +79 |

The full off-break: perfect −30 … +16 (Real), −42 … +23 (Play), −65 … +36 (Learn); solid −59 … +30, −83 … +42 and
−119 … +65: the same widths a little early, because the batter plays for the stock ball and this one turns a little
differently. A ball whose seam lands at an angle, or a variation, moves the windows: late movement beats the read.

The bat calibration's edge (80 ms, now `BAT_TIMING_CALIBRATION.edgeMs`) is the geometry's own limit: the ball could touch the edge until its centre is one radius
beyond the face, (54 + 36)/54 × 55 = 91.7 ms, if the face stayed square; but it rotates 0.30°/ms with the error and
presents the edge obliquely, E = 91.7·cos(0.30°·E) ≈ 80 ms. Angled strokes are less forgiving on the side the face
opens (a cover drive in Real: edge −141 … +63), and against late movement the windows shift (a seaming ball beats a
Real batter who committed before it pitched). Learn's late edge against pace stops near +150 ms: a swing that late
only starts as the ball passes the batter.

## LBW

`lbw(flight, impact, { shotOffered })` (Law 36), in order: the ball must not pitch outside the line of leg stump
(whole ball outside; ignored if it struck the batter on the full); the first interception by the person must be in
line (any part of the ball within the line of the stumps), or outside off only when no shot was offered, never outside
leg; and the projection, which is the delivery's own flight continued past the impact with the same physics (the
flight samples are the unimpeded trajectory), must touch the stumps or bails. The reason is the first failing check
(`pitched_outside_leg`, `impact_outside_leg`, `impact_outside_off`, `missing`, `high`) or `out`.

## Multiplayer match paths (one engine for both modes)

The multiplayer renderer (reveals, replays, highlights) flies the frozen engine's deliveries through this physics
instead of a hand-built curve. The server is authoritative there: it decided the delivery and validates taps against
`releaseToContactMs`, so `flightFromPath(path, { family, releaseToContactMs, handedness?, seed?, conditions? })`
fits a physical release to the server's `BallPath`:

- hard targets: the ball crosses the contact plane (`CONTACT_Z`) at `releaseToContactMs`, pitches at
  z = −PITCH_HALF + `bounceAtM` and passes the bat at `lineAtBatM`, released at `releaseHeightM` from the match's
  right-arm-over spot (`MATCH_RELEASE`, mirrored for a left-handed striker; path values are batter-relative);
- soft targets: `heightAtBatM`, `swingM` (applied as the air side force; for spinners it is their drift) and `turnM`
  (a bounce deflection; the surface's turn grip is off so the spin, drawn and flown from `spinRpm`, cannot add to it);
- unknowns: release speed, elevation, azimuth and the pitch's restitution for that one ball, bounded to 0.45–0.75.
  This is the only place a pitch parameter is fitted rather than predicted: in multiplayer the server's height at the
  bat is authoritative, so the bounce matches it as far as a real pitch can. When the server asks for more bounce than
  0.75 allows (full balls on hard and green pitches), restitution stays at the bound and the height is the nearest the
  pitch gives; the hard targets are always met.
- Newton's method with a finite-difference Jacobian, then one or two corrections of the swing and deflection; about
  3 ms per delivery. Engine pitches map to conditions as green → green, hard → hard, slow → turning (every engine
  pitch has an equivalent); weather is already folded into the server's path.

Measured over every engine variant, intensity, length and pitch (`tests/unit/physics/matchPath.test.ts`: 288 paths
including loose executions; every line and weather too in a full 2592-path sweep): arrival within 0.03 ms of
`releaseToContactMs` (median 1.5 µs), bounce within 0.5 mm and line within 0.1 mm, swing and turn within 5 mm; the
height at the bat within 2 cm for 68% of paths and at worst 17.5 cm low (bounce held at 0.75); the release speed (always the simulated one, reported in `fit.speedKph`) is on
average 6 km/h from the engine's displayed `speedKph` (−22 … +12 km/h), because the engine's flight-time multipliers
(a slow pitch ×1.06, a short length ×1.05) slow the whole flight, which honest physics can only do with a slower
release. A yorker's `bounceAtM` (18.7 m) lies beyond the contact plane, so it reaches the bat just before pitching.

## Outcome-first shots

`aimShot(from, { p, mode }, opts?)` finds the launch velocity whose `simulate()` trajectory reaches a point the
server has chosen, so the reveal shows real flight, bounces and roll timed by its own `tArrive`:

| Mode | Meaning | Default launch elevation |
| --- | --- | --- |
| `carry` | through `p` in the air (a catch at hand height) | 8° + 0.5° per metre, 8–50° |
| `ground` | along the ground to rest at `p`, or passing it at `arriveSpeedKph` (a pickup) | −4° |
| `bounce_then_rope` | lands first, then crosses the rope in `p`'s direction (default 30 km/h at the rope) | 5° |
| `over_rope` | crosses the rope on the full at `p` (`p.y` is the height over the rope) | 32° |

Reaching a point leaves one free parameter, so the elevation (given, or the default, with fallbacks) chooses the
trajectory; the solver then finds the speed (bracketed secant, Illinois) and corrects the azimuth for any sideways
drift. Default spin is 15 rev/s of back-spin on carries and sixes, none on ground strokes. When no speed up to
`maxSpeedKph` (165 km/h) at any tried elevation works, it returns the nearest trajectory with `feasible: false` and
`errorM`, the miss distance. About 0.2–1 ms per shot (see "Match physics performance"); deterministic.

## Match physics performance

A replay timeline builds every ball of a match synchronously, so the two solvers iterate on cheap probes and make
one output run each:

- `probe.ts` runs the same ball model (integrateBall's own `accel()` and `bounce()`, RK4, the bounce located inside
  the step and the step completed) with state in local numbers, no samples, only the events a residual needs (the
  first bounce, a plane or distance crossing located on its own side of a bounce, the rope, rest), a configurable
  step, and the roll in closed form (a = rollDecel + rollDrag·v: distance and speed are exponentials, the stopping
  time a logarithm, `dlog` in `vec.ts`). At a 1 ms step a probe equals integrateBall bit for bit in the air; at the
  probe steps it differs by well under a millimetre.
- `flightFromPath` iterates on 8 ms probes (Newton with the Jacobian reused across iterations and the swing/turn
  correction passes) and makes one integrateBall run on the 1 ms grid for its output; the fit report is measured on
  that output.
- `aimShot` iterates on probes (8 ms; carries and sixes take about fifty steps to the target whatever the flight
  time, 4–20 ms, and stop there), brackets the speed around a closed-form first guess (drag-free ballistics, the
  inverted roll), and produces its trajectory with `trace()`, the same model stepped at the output spacing
  (`sampleEvery` × 1 ms, 5 ms by default; at 1 ms identical to `simulate` in the air) with the roll sampled in closed
  form.
- Practice never uses probes or traces: `flight`, `strike`, `simulate` and `resolveDelivery` are unchanged bit for bit.

`node scripts/match-physics-bench.mjs` (24 engine balls of every variant, 2.5 aims each: catches, a 56° skier, ground
strokes, a long roll, a pickup, a four, a six, a 42 m throw) enforces the 3 ms per-ball budget;
`tests/unit/physics/matchPerf.test.ts` asserts it with CI headroom (best of five, median under 8 ms). On an M1 Pro,
warm: per ball 10.3 ms median (12.7 mean, 22.8 max) before, 1.24 ms median (1.30 mean, 2.0 max) after;
`flightFromPath` 3.3 → 0.55 ms, `aimShot` 2.8 → 0.24 ms (the skier 10.9 → 0.67 ms, a six 7.3 → 0.46 ms, a long roll
2.1 → 0.22 ms).

## Reference over

`REFERENCE_OVER` (`src/practice/game/reference.ts`) is the gold-standard vertical slice: the same six balls every time,
bowled by one tall right-arm fast bowler (look seed `vande-reference-bowler-51`: a 2.30 m release, 0.42 m to the off
side of middle, the top of `RELEASE_GEOMETRY.pace`) with a new white ball on the balanced pitch, over seed
`vande-reference-over-v1-1496`. Each plan is ordinary (`validateOver` accepts it, source `reference`) and each ball's
seed is `ballSeed(over, i)`; the plans and the over are deep-frozen. Speeds are the honest variation speeds of a
139.5 km/h stock ball (`variationKph`). The bouncer's length is `bouncerLength` for an arrival at head height
(`BODY.headY`, 1.62 m), frozen at 10.72 m. Measured with `flight()` and `flightMovement()` from the batter's end
(`tests/unit/practice/game/reference.test.ts`), right-handed batter; a left-hander gets the same shapes to within
1 mm of movement and 1 cm of height:

| Ball | Plan (variation, length, line) | km/h | Start line → line at stumps | In the air | Off the pitch | Off the release line at the bat | Height at the bat (plane) | Release → bat | Hits | Seam wobble |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref-1 full outswinger | outswing, 3.00 m, 0.36 m | 137.5 | 0.09 → 0.36 m | +18.8 cm | +0.5 cm | +22.0 cm, 74% of it in the second half of the flight | 0.18 m (forward, 1.80 m) | 0.470 s | no | 0 |
| ref-2 inswinger | inswing, 4.50 m, 0.02 m | 137.5 | 0.30 → 0.02 m | −16.2 cm | −0.8 cm | −23.0 cm, 74% late | 0.37 m (forward) | 0.476 s | yes (0.55 m high) | 0 |
| ref-3 hard length | stock, 7.95 m, 0.08 m | 139.5 | 0.01 → 0.08 m | +1.7 cm | +2.9 cm | +6.6 cm | 0.93 m, rising at 2.8 m/s (back, 1.05 m) | 0.513 s | no (1.02 m) | 0 |
| ref-4 cutter | cutter (leg-cutter), 6.00 m, 0.10 m | 126.9 | 0.04 → 0.10 m | −1.2 cm | +8.5 cm | +4.8 cm | 0.65 m (back) | 0.551 s | yes (0.73 m, top of off) | 0.89 |
| ref-5 bouncer | bouncer, 10.72 m, 0.04 m | 141.5 | −0.01 → 0.04 m | +0.8 cm | +2.2 cm | +4.6 cm | 1.62 m (back) | 0.537 s | no (1.73 m) | 0 |
| ref-6 yorker | yorker, 0.90 m, 0.02 m | 139.5 | 0.11 → 0.02 m | −7.7 cm | −0.4 cm | −7.6 cm | 0.06 m, before it pitches (back) | 0.481 s | yes (0.14 m) | 0 |

The start line is where the release direction alone would reach the stumps; movement is + towards the off side; "in
the air" and "off the pitch" are `flightMovement`'s `airM` and `pitchM`; the height is at the ideal contact for the
automatic footwork (forward stride 1.80 m or back foot 1.05 m in front of the stumps).

- The outswinger starts on off stump and is still 34 cm wide of the middle at the bat after leaving the batter late:
  drive it with the swing or leave it. The swing force grows as drag slows the ball towards the 34 m/s where swing is
  fullest, so the movement is late. Its seam is angled towards slip with the shine on the leg side.
- The inswinger starts 30 cm outside off, swings 23 cm back and hits middle at 0.55 m. Its seam points towards fine
  leg, with the shine on the off side.
- The hard length climbs to 0.93 m at the back-foot plane, waist high on the batter (torso 0.70–1.42 m), at
  110 km/h and still rising. That is the low end of the brief's rib-to-waist range: rib height (≥ 1.0 m) would need
  ≈ 8.3–8.6 m from this release, past the 8 m the rules allow a ball that is not a bouncer (`PACE_OTHER_LENGTH_M`,
  and `lengthBand` calls 8 m a bouncer). The tall release is what gets it this high (2.09 m gives 0.84 m at 8 m).
- The cutter is 9% slower, and almost all its movement comes off the pitch: a seeded leg-cutter whose rifle spin grips
  and whose seam lands away, 8.5 cm from middle-and-off to clip off stump. Its seam is scrambled (wobble 0.89).
- The bouncer arrives at head height on the line of middle stump. A leave from the stance clears the stance head
  (centre −0.20 m, 1.62 m, 1.2 m in front of the stumps) by 10.7 cm, passing 26 cm from it; on that line it can be
  hooked.
- The yorker swings 7.7 cm in, reaches the back-foot plane at 6 cm, 4 ms before it pitches, and hits the base of
  middle stump. Since 2026-11-03 automatic footwork meets it on the forward stride, where it is 0.198 m high, and its
  "at the toes" property is measured at the batter's stance plane, 1.1 m in front of the stumps: 0.072 m against the
  unchanged 0.15 m threshold (`release/product-sequence/stage-1-practice/wedge/physics/phase5/REPORT.md`, item 1).

The over seed was chosen, as a good bowler lands his seam, so that each ball's seeded parts support its intent:
- the outswinger's seam lands slightly away (landing +0.15, swing at 0.94 of the full coefficient);
- the inswinger's lands slightly in (−0.15, swing 0.99);
- the hard length seams 2.9 cm away;
- the cutter is a leg-cutter (60/40 off/leg draw: leg) whose seam lands away (+0.52);
- the bouncer's seam is nearly neutral (+0.14);
- the yorker's natural swing is inward.

`overPattern(plan)` gives the over's known pattern as closed facts read off the plans: for this over, mainly at the
stumps (5 of 6), swing both ways, 2 short balls of which 1 is a bouncer, 1 yorker, 1 change of pace, 126.9–141.5 km/h.
It is for the reference and built overs only; a random over's deliveries are never revealed.

## Calibration targets and the release gates

The physics design targets (adopted by the lead) and their real-cricket references, with what v2 measures. The
measurements are reproducible with one command, `node scripts/practice-properties.mjs` (FAIR6 exploit search, EX5
skill gradient and the FAIR6 coach clause, EX6 gaps, EX7, EX9; `--only=` and `--json=` for subsets and raw data; run
it under `nice` on the shared machine). Policies: the expert plays the coach's recommended shot (src/practice/coach) with
a seeded timing error of σ 20 ms; the rookie plays a seeded attacking intent that ignores the ball with σ 60 ms; random
input draws everything; fixed inputs are the 586-input grid of `fixedInputGrid()` (stroke families by direction,
elevation, power and footwork, defences and the leave). Each over is played in full whatever happens (dismissals are
counted, not stopping the over).

References (international cricket, ESPNcricinfo aggregates of matches 2005–2014): T20I about 7.3 runs an over with a
wicket every 18 balls; ODI 4.8 runs an over, a wicket every 37 balls; Test 3.1, every 65 balls. IPL 2023: boundaries
on about 17–20% of balls. Sixes leave the bat at about 120–140 km/h (reported estimates).

| Target | v2, Club | v2, Expert |
| --- | --- | --- |
| Best fixed input: under 2 boundaries an over (FAIR6), at σ 0 and σ 20 ms | 1.36 / 1.17 | 1.37 / 1.05 |
| Expert policy: 6–9 runs an over, a wicket every 25–45 balls, boundaries on 12–18% of balls | 9.5, every 67, 25% | 7.4, every 55, 19% |
| Coach-optimal play: about 12 runs an over at most | 11.8 | 9.9 |
| Rookie: at most half the expert's runs, at least twice his dismissals (EX5: ≥ 2×, ≤ ½) | 3.0 (3.2×), every 4 balls (0.05×) | 2.6 (2.9×), every 3 (0.05×) |
| Random input (EX5) | 1.7 runs an over (5.7×), every 3 balls | 1.6 (4.7×), every 3 |
| Coach play against the best fixed input, expected runs of a one-wicket ten-over innings (FAIR6) | 118 against 22: 5.3× | 99 against 18.5: 5.3× |
| Aimed into a gap against a protected fielder, runs a shot and catches (EX6) | 2.28 against 0.67: 3.4×; 0% against 2.7% | 2.37 against 0.70: 3.4×; 0% against 2.8% |
| No fixed input best on 4 or more of the 6 reference balls (EX7) | at most 3 | |

- Always defending (auto footwork) makes 0.1–0.5 runs an over and is out on 0–2% of balls; always leaving scores
  nothing and is bowled on 39–47% of balls.
- Counted over every ball of the over, the coach makes 11.8 runs an over against the best fixed input's 9.5 (Club);
  that input is out on 28% of balls. Per scoring shot, a stroke into a gap makes 2.3 runs against 2.2–2.65 for the rare
  stroke that beats a protected fielder (fielders stop cleanly or not at all). The two readings of these clauses are
  with the lead.
- The commit is 150 ms (McLeod 1987); late movement beats a committed bat, which is where the expert's dismissals
  come from.

## Known limitations

- The ball is a sphere with a smooth-sphere Magnus law and a constant drag coefficient; seam effects are a side force
  and a bounce deflection, not a resolved boundary layer. There is no reverse swing: a worn ball swings the same way
  as a new one, less. A wobble-seam delivery is not bowled; the cutter's and the slower ball's scrambled seams are a
  presentation of their spin (they do not swing).
- The pitch is uniform: no cracks, foot-marks or variable bounce; the outfield is flat and uniform.
- The bat is a rigid box with an empirical restitution map, not a vibrating beam; the batter's body is capsules.
  Since 2026-11-03 the box's toe is rounded for the ball collision (`BLADE_TOE_R` 10 mm, an assumption with no verified
  source); anatomy keeps the enclosing box. The
  swing's arc acts in the impact (speed and mass along the blade) while the bat's pose translates through the zone.
- The batter's read is a model (one 150 ms commit and sideways extrapolation), not measured human data; it is a little
  later than McLeod's ≈190 ms for international batsmen, so late movement beats this batter slightly less often than a
  real one.
- Shot geometry is a reach per stroke (a box in line and height at the contact plane), not a full arm-and-bat
  kinematic chain; a stroke's reach does not depend on the batter's height or reach, which are the same for every
  player.
- Fielders never collide. Since 2026-11-03 their runs brake and curve, a dropped or fumbled ball rolls on through the
  one integrator, and throws carry an error and may come in on one bounce (`docs/PRACTICE_RULES.md`, "Fielding
  model").
- Timing windows are exact for straight-bat strokes on predictable deliveries; angled strokes and moving balls are
  intentionally different, as in cricket.
- Not modelled: the ball hitting the pad after an edge (bat-pad), the bowler's foot (no-balls), wides, or air density
  and humidity per venue (Green's extra swing stands in for conditions).
- Named limitations of the frozen simulation v3 (see "The wedge physics repair"): no toe contact kind (toe hits are
  `middle` with bladeU); no back-plane yorker dig-out (no hip flexion, crouch capped at 0.18 m); the back-foot cut at
  the short wide ball cannot be reached within the 0.18 m root retarget; CTL3 and CTL4 fail honestly, because capped
  strokes cannot reach a low ball at the forward plane or a ball level with the body; the ref-5 hook's sweet window is
  narrower than the perfect band; and slow middles (335 under 20 km/h in the census on 5d).
