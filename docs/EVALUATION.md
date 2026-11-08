# Practice evaluation: method, narrative and scores (QA and Rookie Experience Examiner)

Owner: QA, acting as the Rookie Experience Examiner. I score the rookie rubric (R1–R7, RK1–RK6) and three ceiling
dimensions: UX, Minimalistic flow and Artifact experience.

**Authority.** Two locked rubrics bind every score here:

- `release/player-experience/ceiling-rubric.md`: rules R1–R11, severity and closure, the configuration matrix, the
  evidence format and the criteria catalogue;
- `release/player-experience/DUAL-CEILING-RUBRIC.md`: the Rookie and Expert rubrics, SYS1/SYS2, the forgiveness
  policy, and X1–X3.

This document keeps the method, the narrative and the score tables. Where it seems to differ from a locked rubric,
the rubric wins. Interpretations I had to make are listed in §4 and were sent to the Release Director.

Other evaluators own the rest:

| Area | Owner |
| --- | --- |
| Expert rubric, coherence (COH), control and fairness (CTL/FAIR) | Expert Experience Examiner |
| Cross-system Player experience, X1–X3, the real-player package | Player Experience Director (`docs/PLAYER_EXPERIENCE.md`) |

Where my scores cite their evidence, the citation names their evidence id.

**What counts.** I evaluate the running build, never code, specifications or claims (R2). AI and scripted runs are
evaluator evidence, never real-player evidence. Until real players complete the study, every human gate (H) is
pending and every score above 8.8 is at most PROVISIONAL. There are no physical phones, so every device gate (D) is
pending.

## 1. Builds and labels

| Label | What | Build id | How it was built |
| --- | --- | --- | --- |
| `before-38924bd` | main before this work: the pushed, CI-green state | `38924bd` | `git archive 38924bd` into the scratchpad, `npm ci`, `VITE_PRACTICE_TEST_HOOKS=1 npx vite build --outDir dist-eval`, served on :4211 |
| `before-38924bd-prelock` | the same build, captured before the rubric lock at the original brief's viewports (640×360, 915×412, 1280×720, 2400×1080) | `38924bd` | as above |
| `snap-HHMM` | a current-tree snapshot, labelled **in-progress** | `scripts/build-id.sh` before and after copying (must match) | `scripts/eval/snapshot.sh <dir> 4213`: copy the tree, typecheck (recorded), test-hooks build (`dist-eval`) and production build (`dist-prod`), serve on :4213 |

**R11:**

- A snapshot whose typecheck fails in product code scores 0 on every criterion that code touches. The failing files
  are named with each snapshot's scores.
- Vite builds without typechecking, so a snapshot can run while failing R11. Its captures are still evidence of
  behaviour; they just cannot earn credit for what the failing code touches.

## 2. Evidence

- **Register:**
  - `release/player-experience/rookie/EVIDENCE.md`, in ceiling-rubric §8 format;
  - stable ids E-RK-###, kept in `evidence.json` and rendered by `node scripts/eval/evidence.mjs render`.
- **Run folders:** `release/player-experience/rookie/runs/<label>/`, containing:
  - `run.json`: arguments, build id, browser and uptime at start;
  - `log.txt`: every line carries the load average;
  - `metrics/*.json`;
  - `shots/<viewport>/*.png`;
  - `shots/closeups/*.png`;
  - `video/*.webm`.
- **Uptime:** every timing record carries `uptime` or the load average (R10). The machine is shared: loads from
  9 to 167 were seen on 2026-10-26, and timings taken under heavy load are flagged in the scores.
- **Browser:** Playwright 1.64.1 Chromium.
  - Hardware GPU: `channel: 'chromium'` (new headless) renders through ANGLE Metal on the Apple M1 Pro.
  - The headless shell renders through SwiftShader. It is used only for the software-graphics fallback path.
  - Neither is evidence about phones.

## 3. Method

### 3.1 Driving the app

- **Builds:** everything runs against the test-hooks build of the scored tree.
  - Its product code is identical to the production build.
  - The hooks only fix the device tier and seed and scale time; they do not change rules or physics.
  - Window: `__VANDE_PRACTICE_TEST__` is set before page scripts run; `__vandePractice` exposes state, swing queueing
    and waits.
- **Waits:** the controller's phase or screen. The hooks' own `waitFor` races a 16 ms poll of `state()` that knows
  both trees' phase names (the rebuilt hooks' phase list is stale). See `scripts/eval/lib/env.mjs`.
- **Personas:**
  - New player: empty storage and the real device check.
  - Returning player: `vc:practice:settings = {v:1, guidedDone:true}`, with the tier fixed by the hooks.
- **Driver (`scripts/eval/lib/driver.mjs`):** follows either tree's flow by test id first, then by accessible name.
  - For every press it logs the forward alternatives on screen (enabled, reachable controls other than navigation).
    A press made with two or more forward alternatives counts as a decision.
  - Eager runs press each action as soon as it shows, which gives the mechanical time.
  - Patient runs wait 4 s before each confirmation, so screens that advance by themselves cost no tap. This gives
    the required taps.
- **Viewports:**
  - The locked matrix: 640×360, 844×390 and 915×412 (DPR 2, touch), and 1280×800 and 1920×1080 (DPR 1, mouse).
  - Portrait 390×844 for the rotate prompt.
  - The pre-lock captures also hold 1280×720 and 2400×1080.

### 3.2 Probes (in the page, read-only; `scripts/eval/lib/probe-*.js`)

- **Finding the controller and stage:**
  - The `PracticeFlow` comes from React's fiber on `[data-testid=practice-canvas]` (`memoizedProps.flow`). Its
    stage is `flow.stage`.
  - In 3D: `stage.stage.camera`, the rig map and the bones, and `renderer`.
  - In Classic: `stage.eye.project`.
- **Regions, per animation frame and through the live camera:**
  - the ball: the live flight's samples at `stage.perfToSim(now)`, with its radius including the 1.22 visual scale;
  - the bowler: rig bones padded by 0.15 m (in Classic, a body envelope round the release);
  - the pitch: Law 6, 20.12 × 3.05 m, cut where it passes behind the eye;
  - the hitting area: 0.9–3.0 m in front of the stumps, ±0.9 m, 0–1.4 m.
- **UI:** painted boxes only: text runs, and filled, bordered, shadowed or blurred boxes, images and svg. The
  transparent gesture layer paints nothing and is not counted.
- **Corridor (rubric §5):** the union of discs of radius (ball radius + 24 px) at the ball's on-screen position in
  every frame from release until it leaves the frame or meets the bat or keeper. READ1 and M5 fail if any UI box
  touches it in any delivery frame.
- **Ball pixels (READ2):**
  - In 3D, the stage renderer's `render` is wrapped on this page instance only. Right after each frame is drawn, a
    patch round the projected ball is read with `gl.readPixels`.
  - In Classic, the 2D canvas is read each frame.
  - Contrast is the mean relative luminance of the ball's inner disc against a ring 4–9 px outside it (WCAG
    formula). Size is the projected diameter in CSS px.
  - The three moments are release, bounce and 5 m before the ideal contact.
- **Census of each captured state:**
  - every visible, reachable control: name, size, ≥ 44/48 px, and visual weight (area × fill contrast);
  - text blocks, words and font sizes;
  - truncated, clipped, off-screen or overlapping text;
  - running animations;
  - visible modal dialogs.
- **Scene audit:** every mesh's geometry, world size and position, triangles, materials and texture maps, and the
  rigs' bone extents. Close-ups are one-off renders through a cloned camera, read back in the same task. Nothing in
  the product is changed.
- **Flight hash:** seed, plan, release, bounce, ideal contact, stumps time and every sample (rounded to 1e-6), via
  FNV-1a. Equal hashes mean an identical delivery.

### 3.3 Modules (`node scripts/eval/run.mjs --only <module>`)

| Module | Produces | Criteria it feeds |
| --- | --- | --- |
| `flow` | Steps, decisions, required taps and mechanical first-ball time per persona and mode, on the hardware GPU and on SwiftShader. A custom six-ball configuration task. | F1, F2, M1, M3, U1 |
| `capture` | Every state at every viewport, plus a video: launch, Practice, Random setup, Predefined, settings, setup and field, run-up, flight, after contact, result, Why, replay, close-up, Coach Mode, demonstration, exact retry, pause, over summary, Classic, first session, fallbacks, tiers. | U2, U3, U6, M2, F3, F4, F8, RK1, RK2, RK6, ART3–ART5, inspection |
| `obstruction` | Per-frame corridor, bowler, pitch and hitting-area cover, info-rail share, modals and animations during the delivery; READ2 pixels and ball style. | READ1–READ3, M5, F7 |
| `a11y` | axe (WCAG 2.2 AA tags) per state; text at 1.0, 1.3 and 2.0; touch targets; a keyboard-only path to the first ball. | A11Y1–A11Y3, A11Y7, U4 |
| `determinism` | Words against the record over six swings; flight hashes and results across tiers; exact repeats, including after a reload. | RK4, RK5, F6, COACH1, COACH4, CTL5 (sample) |
| `recovery` | Background and reload mid-delivery, portrait between balls, offline and network use during a delivery, leaving mid-over. | U5, PERF5 |
| `scene` | Scene audit against the Laws, budgets, and close-ups per quality. | ART1, ART2, ART3, ART6, READ5 |
| `perf` | Stage frame stats, long tasks, shader programs compiled during a delivery, input to bat, memory. Desktop GPU, a 4× CPU proxy and SwiftShader. | Supporting only: PERF1 needs 30 deliveries per tier, and the D gate needs phones |

## 3a. The production brief's sub-metrics, mapped to the locked criteria

The production brief (`docs/prompts/VANDE-PRACTICE-PRODUCTION-BRIEF.md`) asks for a rubric covering its sub-metrics.
The locked rubrics now define the anchors (R5: 10 / 9 / 8 / 6 / 3 / 0) and the weights, so this table only says
where each sub-metric is measured and what evidence it needs.

Evidence classes:

- **A:** automated, by the scripts above;
- **I:** evaluator inspection against the written criterion, using the captured states;
- **H:** real players, per the study protocol;
- **D:** physical phones.

An H or D sub-metric without its evidence is an evidence gap. It is never filled in, and it keeps the dimension at
most PROVISIONAL above 8.8 (R4). A failed H gate caps the dimension at 8.0.

| Brief dimension (target) | Sub-metric | Locked criteria | Class | How it is measured here |
| --- | --- | --- | --- | --- |
| UX (9.2) | First-ball time | U1 = F1, F2; H gate: median under 30 s | A + H | `flow`: required taps (patient run) and launch → first release (eager, and with a 2 s dwell per decision), hardware GPU and SwiftShader |
| | Navigation comprehension | U2 ★; H gate: ≥ 90% understand the navigation | A/I + **H** | `census.mjs`: heading, one dominant action, a way back per state; dead controls by inspection |
| | Information readability | U3 | A + I | Status-strip content in the live states, outside the corridor (`obstruction`), contrast (axe and pixels) |
| | Accessibility | U4 = mean of A11Y1–A11Y7 | A (+ D for TalkBack) | `a11y`: axe per state, text at 1.3 and 2.0, keyboard path, 48 dp targets; reduced motion and captions by run |
| | Recovery from interruption | U5 ★ | A (+ D: an Android kill on a phone) | `recovery`: background or reload mid-delivery, portrait, offline, leaving mid-over |
| | Player-test task completion | UX H gate: ≥ 90% complete the first over unaided | **H** | Gap until the study |
| Minimalistic flow (9.5) | Decisions before play | M1 | A | `flow`: taps and decisions per mode |
| | Visible controls per state | M2 | A + I | `census.mjs` (quiet navigation not counted, by ruling) |
| | Configuration time | M3; H gate: median Predefined setup ≤ 90 s | A + **H** | `flow` config task: taps and time for six custom deliveries at 1 s per decision |
| | Backtracking and abandonment | M4; H gate: abandonment ≤ 10% | A/I + **H** | Undo of every setup step without losing choices (inspection run); abandonment needs players |
| | Obstruction during delivery | M5 ★ | A | `obstruction`: the corridor every frame, rail ≤ 8% |
| Artifact (9.0) | Cricket correctness | ART1 ★ | A | `scene`: meshes against Law dimensions, fielders against named positions |
| | Geometry and proportions | ART2 | A + I | Rig heights and limb ratios; close-ups |
| | Material quality | ART3 | I | Checklist on Premium and Balanced close-ups (`scene`) |
| | Animation quality | ART4 | I | Run-up, gather, release, follow-through, fielders, keeper and umpires in captures and video |
| | Ball readability | READ group | A | `obstruction`: READ1–READ3; READ4 from the run-up timeline; READ5 from the close-up |
| | Lighting coherence | ART5 | A + I | Light inventory (one key light, shadows) and close-ups |
| | Quality-tier consistency | ART6, READ3 | A | The same seed per tier: flight hashes and results identical; ball style per tier |
| | (gate) | ART7 ★ | A | `docs/ASSET_REGISTER.md` against the scene audit; no placeholder in a player-facing view |
| Player experience (9.0 in the production brief; 9.5 in the ceiling rubric, scored by the Player Experience Director) | Input confidence | CTL1 ★, CTL2 ★, CTL5 ★, CTL9, RK3; H gate: ≥ 90% feel in control | A + **H** + D | RK3 touch corpus with CTL1 per swing (ruling 1); the Expert Examiner's CTL runs |
| | Delivery readability | READ1–READ4; H gate: ≥ 85% read line and length | A + **H** | as above |
| | Outcome explainability | F6, RK4, COACH1, FAIR3 | A + **H** | `rookie` failure run (60 balls); the Expert Examiner's SYS2 run |
| | Coaching usefulness | COACH2 ★, COACH4 ★, COACH5, RK5; H gate: ≥ 80% improve within 5 attempts | A + **H** | `rookie` retry (the coach's own option executed on the identical ball) |
| | Exact-ball reproducibility | FAIR2 ★, COACH4 ★ | A | Flight hashes and results, from the result layer and the coach screen |
| | Emotional response | FBK1–FBK5, COH9, R6; H gate: emotional fidelity ≥ 9/10 | A + **H** | The audio owner's hooks-build log, or the Director's sink on 38924bd (ruling 4) |
| | Performance stability | PERF1–PERF6; D gate | A + **D** | Desktop and emulator numbers are supporting only; phones are the gate |

## 4. Interpretations, approximations and what cannot be measured here

The Release Director's rulings are recorded in `release/player-experience/RULINGS.md`. They are interpretations,
not amendments.

| Item | How it is measured here | Ruling |
| --- | --- | --- |
| M2 "≤ 1 primary and ≤ 2 secondary actions" | Quiet navigation and disclosure controls (back, settings, pause, "Why?") are not counted. The stricter "one secondary only where genuinely necessary" is checked under U6. | Ruled |
| F3 | Stage 1 removes the Chase teaser, so F3 = the launch offers Practice only, with no Chase element and no dead control. | Ruled |
| M1 | Taps from launch to the first release on the shortest path (patient run). Retested once the Stage 1 launch lands (Practice → Predefined or Random; Random's one-tap default). | Retest pending |
| CTL1 | The Event Timing API (input to next paint) where the paint is verified to show the moving bat: the stage's first moving-bat frame comes no later than that paint. Otherwise the stage's `lastInputToBatMs` plus one frame at the measured rate. The raw lower bound is never reported against the threshold. True display latency is the D gate. | Ruled |
| RK4 / F6 "exactly one next action" | Exactly one recommendation in the reason. The result's buttons are counted under M2. | Ruled |
| FBK1, COH9 (and EMO1) | The audio owner's hooks-build event log once it exists. Until then, the Player Experience Director's recording sink (setSink, px/E-PX-005), reproduced on the scored build. | Ruled |
| CTL9 trackpad | Untested: capped at 8 under R5. | Ruled |
| A11Y3 | axe on every state plus the live-region checks. TalkBack is a pending device check. | Ruled |
| Corridor "to the bat or keeper" | The ball's on-screen positions from release until it leaves the frame or the delivery leaves the live phase. First person cannot show the instant of contact, which is under the eyes. | As measured |
| READ2 contrast | WCAG relative luminance: the mean of the ball's inner disc against a ring 4–9 px out, read from the rendered frame. The peak inner pixel is also reported. | As measured |
| H and D gates | No real players and no physical phones. | Pending everywhere |
| Timings | AGENTS.md: a measurement taken at a 1-minute load above 20 is indicative only. Each timing records its load. | Applied |

## 5. Scoring procedure

1. **Collect.** Run the modules on the scored build. Bulk captures go to scratch (`EVAL_BULK`). Summaries and
   selected captures go to `release/player-experience/rookie/runs/<label>/`.
2. **Register.** Each measured fact becomes an evidence item (E-RK-###) with build id, UTC time, device, settings,
   method, expected, observed, result and path.
3. **Score.** Each criterion gets a 0–10 score using the R5 anchors and the item ids. The criteria go in
   `release/player-experience/rookie/criteria-<label>.json`, which `scripts/eval/score.mjs` reads:
   - R1: no evidence gives 0.
   - R6: a ★ criterion below 7 fails its dimension.
   - R7: an open Critical defect caps every dimension it touches at 8.5.
   - R8: 9.5 needs every ★ at 9 or more.
   - Labels follow §7. Above 8.8 the label is at most PROVISIONAL while the H and D gates are pending.
4. **Findings.** Failures become findings for the owning agent (§7 of this document), copied to the lead, and are
   closed only by the five closure steps. Corrections made for the expert side are retested on the rookie ★
   dimensions (X3) before closing.

## 6. Findings filed by the Rookie Examiner

Severity follows ceiling-rubric §4. The ledger ids (F-###) are the Release Director's. Closure needs all five
steps: evidence, correction, independent reproduction, new evidence, and green regression suites.

| Id | Finding | Severity | Owner | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| RK-F01 / F-012 | READ2: the ball is under 3 px at release on phone viewports, and contrast is about 1.0–2.3:1 at the bounce and 5 m before the bat, on every tier. Probable root cause: a 97° phone horizontal FOV (E-PX-006; EMB1 allows 55–75°). | Critical | Presentation (a30bf90e5af1e867d) | E-RK-001…036, 047…061 (38924bd), 065…079 (snapshot) | Open. Release contrast improved on the snapshot |
| RK-F02 | Innings balls and exact repeats were built without `toleranceMs`, so the device allowance was neither applied nor recorded. | High | Practice UX (a0b07fe431c1b0a76) | Retest E-RK-045, E-RK-046 | Fixed and retested (steps 1–4). Step 5, the regression suites, is pending |
| RK-F03 | ART7 gate: no `docs/ASSET_REGISTER.md`; the 38924bd first-person bat and glove read as placeholders. | Critical | Presentation | E-RK-062…064 | Open |
| RK-F04 / F-023 | A new player who taps Play on Setup as soon as it appears is stuck in `ready` on a black stage in 9 of 10 runs (Play is enabled about 2.2 s before the stage is ready). | Critical | Practice UX, with presentation | E-RK-080; flow E-RK-083… | Open |
| RK-F05 / F-029 | Predefined "Your own six": choosing the delivery before the pitch commits an extra ball and silently drops the last one. | High | Practice UX | E-RK-082 | Open |
| RK-F06 / F-030 | After a FOUR: "✓ Leave it: it is passing off stump" beside "Good length, on off stump". The card also overlaps the conditions chip and cuts off "Why?" at 915×412. | High | Coach (acd0cb5c5cdd7cbcb); layout: Practice UX | E-RK-092 | Open |
| RK-F07 | At 640×360 the result card's actions ("Practice this ball", "Next ball") are off-screen after every ball; only the conditions chip and pause can be reached. | High | Practice UX | E-RK-100 | Open |
| F-014 (lead) | M5: the info rail covers more than 8% of phone screens during the delivery: 38924bd 8.7–19.1%, snapshot 9.8–10.7%. | High | Practice UX | E-RK-049, 052, 055 (38924bd); 067, 070, 073 (snapshot) | Open; evidence attached |
| F-031 (lead) | M2 and U2 on the over summary: 7–10 actions (six ball chips plus the over choices), and no visible way back at 640 and 915. | Medium | Practice UX | E-RK-093, E-RK-094 | Open |
| F-032 (lead) | A11Y7: launch and settings controls are 44 px tall, under 48 dp. | Medium | Practice UX | E-RK-095 | Open |
| F-033 (lead) | RK2: 34 unglossed jargon hits in first-session text, e.g. "He can bowl: Outswinger, Inswinger, Seamer, Cutter…" and "it swings and seams most". | High (rookie) | Practice UX, with coach copy | E-RK-097 | Open |
| F-034 (lead) | F8: "Recommended: the benchmark six" on Predefined Over. Ruling 7: strict, a fail held at 6 until renamed ("the reference six"). | Medium | Practice UX | E-RK-096 | Open |

Findings from the other evaluators are cited in the scores rather than duplicated:

- F-022: FBK1, a defence feels "sweet" like a six (E-PX-005).
- F-007: COH9, crowd look-ahead (E-PX-005).
- CTL2: grounded input carries more than 15 m in 43% of middled shots (E-EXP-009).
- F-002: the keyboard has no attack, so CTL9 fails for the keyboard.

## 7. Evidence gaps (not scored, never estimated)

- **Real players (H gates):**
  - every rookie real-player measure (DUAL-CEILING-RUBRIC §5);
  - the UX H gate (first over unaided, navigation, median time to the first delivery);
  - the Minimalistic flow H gate (setup abandonment, median Predefined setup time);
  - the Artifact H gate (experienced players' visual rating).
  - No participants have taken part, so nothing is stated or estimated.
- **Physical phones (D gates):**
  - PERF's 30/60 fps on low-tier and capable phones;
  - CTL1 touch latency on a phone, including the display and digitiser;
  - TalkBack (A11Y3);
  - three budget Android phones in the study.
  - The emulator is not a phone for these gates.
- **Untested inputs:** trackpad (CTL9, capped at 8 by ruling).
- **Measurement conditions:** the shared machine reached a load of 300. Timings taken above a 1-minute load of 20
  are indicative only (AGENTS.md) and carry their load in the evidence.

## 8. Regression suites that must stay green

The lead runs the technical gate. These are the commands, with isolated ports and folders so they never collide with
another agent's run:

| Suite | Command |
| --- | --- |
| Typecheck | `npm run typecheck:all` |
| Unit | `npm test` |
| Render | `npm run test:render` |
| Production build and bundle budget | `npm run build` (then `node scripts/check-bundle-size.mjs`) |
| E2E chromium | `npm run build -- --outDir dist-eval && E2E_PORT=4212 E2E_DIST=dist-eval E2E_OUT=test-results-eval npx playwright test --project=chromium` |
| E2E practice | `E2E_PRACTICE_PORT=4215 E2E_PRACTICE_DIST=dist-practice-eval E2E_OUT=test-results-eval-practice npx playwright test --project=practice` |
| E2E social | `E2E_API_PORT=4216 E2E_API_DIST=dist-api-eval E2E_OUT=test-results-eval-social npx playwright test --project=social` |
| Flow (two phones, real backend) | `E2E_OUT=test-results-eval-flow npm run test:flow`. It uses fixed ports 8787 and 4174, so run it only when no other flow run is active. |
| Android lifecycle smoke | `scripts/android-practice.sh`. It needs the emulator slot, which the lead schedules. |

## 9. Rerunning the evaluation

```bash
# A snapshot of the current tree (build id checked before and after the copy), served on a free port
scripts/eval/snapshot.sh /path/to/scratch/snap-HHMM 4214

# Evidence (bulk captures to EVAL_BULK; summaries to release/player-experience/rookie/runs/<label>/)
EVAL_BULK=/path/to/scratch/eval-bulk nice -n 15 node scripts/eval/run.mjs \
  --base http://localhost:4214 --label snap-HHMM --build-id "$(scripts/build-id.sh)" \
  --only capture,flow,obstruction,rookie,a11y,recovery,scene,determinism

# Before-the-work baseline (git archive of 38924bd, test-hooks build, served on 4211)
EVAL_BULK=... nice -n 15 node scripts/eval/run.mjs --base http://localhost:4211 --label before-38924bd --build-id 38924bd

# Offline scans, evidence register and scores
node scripts/eval/scan.mjs <label>                                 # F8 technical wording, RK2 jargon
node scripts/eval/evidence.mjs render                              # EVIDENCE.md from evidence.json
node scripts/eval/score.mjs release/player-experience/rookie/criteria-<label>.json
```

Run one evaluation at a time (the runner opens one browser at a time). Check
`release/product-sequence/QUIET-WINDOW.md` first: run nothing while it says ACTIVE.
