# VANDE: the cover drive reference slice (master prompt v2)

You are working in the VANDE repository, `/Users/hironmoy/Vande/Vande`, branch `cricket-rebuild`. Your job is one
right-handed, front-foot cover drive that becomes the quality reference for every batting stroke in VANDE. It must
look human, respond to the player's input, agree exactly with the physics, and feel earned. Success is shown in the
running game, with evidence. Code volume and feature count do not count.

## 0. How to use this prompt

- **Authority.** These outrank this prompt, in this order. If anything here conflicts with them, they win; report the
  conflict and don't work around it.
  1. `AGENTS.md`
  2. `docs/VANDE-PRODUCT-SEQUENCE.md`, where Stage 1 (Practice quality) is active and later stages are closed
  3. `docs/VANDE-EXPERIENCE-CONSTITUTION.md`
  4. `docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md`
  5. `docs/ANDROID_SIZE_AND_REACH.md`
  6. `docs/ARCHITECTURE.md` (file ownership)
  7. The locked rubrics in `release/player-experience/`
- **Facts.** The facts in §2 are a snapshot taken on 2026-11-01. Verify each one before you rely on it, and report any
  that changed.
- **Definition of done.** Every criterion in §7 passes on one build id (`release/player-experience/tools/build-id.sh`),
  with evidence recorded in the `AGENTS.md` format. The owner has signed off on the standard captures (§7-H). No new
  Critical or High finding is open.
- **Labels.** Results that need real players or physical phones stay PROVISIONAL until those exist. Never estimate a
  human or device result.

## 1. Mission

- **The long-term ambition:** VANDE's batting should beat Real Cricket, World Cricket Championship 3 and Dream Cricket
  on feel, credibility and depth. VANDE wins on the quality of batting, not on feature count.
- **The immediate goal:** one cover drive, against one known delivery, that a real cricketer would recognise and enjoy.
  Don't start another stroke until this one passes.
- **The player should feel:** "I read the ball, chose the drive, timed it, and earned that boundary." A button press
  never produces a scripted four.

What players find satisfying, in order:
1. The feel and sound of middling the ball.
2. Elegant timing.
3. Reading the bowler.
4. The reward for the right shot.
5. Tension from difficult balls.
6. The ball racing through the field.
7. A crowd reaction proportional to the moment.
8. Visible improvement.
9. Wanting the next ball.

## 2. What already exists (verify, then build on it)

### Architecture

| Layer | Current state | Paths |
| --- | --- | --- |
| Gameplay truth | TypeScript is authoritative for input normalisation, delivery physics, contact, scoring, dismissals, Coach facts and replay. Deterministic RK4 at 1 ms. `PRACTICE_SIM_VERSION` is 3 (in flight; not yet frozen). | `src/physics/**`, `src/practice/game/**`, `src/contracts/practice.ts` |
| Renderers | Three.js first-person Batter Eye stage; Classic 2D fallback; Unity presentation, opt-in and gated. | `src/render3d/**`, `src/render3d/fallback2d/**`, `unity/VandePractice/` |
| Unity integration | Unity 6000.3.27f1 (rev 672d562a42a7), Built-in Render Pipeline, legacy input. Mounted as Unity-as-a-Library in the Capacitor activity. It plays a validated canonical trace from TypeScript, and it must never score, reroll or change an outcome (contract v6 / Practice sim v3). Unity is rejected on phones with 3 GB of RAM or less and on non-ARM64; those keep Three.js or Classic. | `docs/decisions/UNITY-PRACTICE-INTEGRATION.md`, `docs/UNITY_PRACTICE_STATUS.md`, `unity/VandePractice/README.md` |

### The cover drive in physics

- **Stroke selection.** `shotFamily()` in `src/physics/shot.ts` picks `cover_drive` for a front-foot attack aimed at
  35°–75° (positive bearings are the off side).
- **Reach.** The reach at the contact plane is in `SHOT_FORMS.cover_drive` in `src/physics/constants.ts`:
  x 0.04–0.50 m, y 0.04–0.40 m, lofted y 0.10–0.34 m. A ball outside the reach meets an edge, the toe, the shoulder or
  nothing, and the swept collision decides which.
- **Timing.** Real-mode bands are `TIMING_BANDS.real`: perfect within ±25 ms, solid within ±55 ms, edge within ±80 ms,
  and a miss beyond that.
  - Early timing closes the face towards leg; late timing opens it.
  - Learn and Play widen the bands; Real never does.
  - The line read commits 150 ms before contact in every mode (`COMMIT_BEFORE_MS`).
- **One-command checks.** `node scripts/practice-properties.mjs` runs the exploit, gradient, gap, dominance and
  difficulty properties (FAIR6, EX5, EX6, EX7, EX9).

### The canonical delivery

`ref-1` in `src/practice/game/reference.ts` is a full outswinger, pitched up 3 m, starting on off stump and moving away
late. It is the textbook cover-drive ball. The other five reference balls are the wrong-ball tests:

- ref-2: inswinger at the stumps;
- ref-3: hard length;
- ref-4: cutter;
- ref-5: bouncer;
- ref-6: yorker.

### Input

- `src/input/**`. The spec, `docs/PRACTICE_INPUT.md`, is the source of truth for the gesture-to-stroke mapping
  (grounded or lofted, power, footwork) and for timing.
  - An attack's time is the interpolated start of the forward movement. A pull-back or hold before it only sets the
    anchor, and a press held without moving waits.
  - Event timestamps are used throughout, so frame cadence never retimes a stroke.
- Unity captures raw touch in its lower 46%. Its legacy touch path samples once per rendered frame, which is open
  finding F-003.

### Unity characters

- **The hero.** It uses MakeHuman v1.3.0 CC0 anatomy with a 75-bone skeleton, packed into the VPM3 binary format at
  LOD0–4. The gear and the VBT1 bat are original VANDE art.
  - Built by the Node exporters `scripts/export-unity-production-*.mjs`.
  - Provenance: `docs/ASSET_REGISTER.md` and `docs/licenses/vande-production-hero/hero-bundle-provenance.json`.
  - Status: TECHNICAL CANDIDATE, visually unproven.
- **Motion.**
  - The stroke is code-sampled in `ProductionCharacterMotion.cs` (`BatterStroke`), with named markers: backlift, foot
    plant, contact and follow-through.
  - An analytic two-hand grip solve holds the bat, and the body blends to the canonical trace over 80 ms.
  - Two CMU reference motions add a low-weight layer: a jog for the run-up and a baseball swing for weight transfer.
    The register states neither is a cricket action.
- **Known gaps.** `UNITY_PRACTICE_STATUS.md` records:
  - procedural rigs;
  - no production FBX or GLB models;
  - no motion-capture clips;
  - no production skin, cloth or gear materials;
  - synthesised audio.

  This is the "mannequin and robot" problem.

### Unity camera

- **Unity.** The live batting camera in `ProceduralPracticeWorld.cs` is a rear three-quarter view behind the striker:
  4.10 m back, 1.70 m to the side, 1.68 m high, with a 58° horizontal field of view. It frames the helmet and the
  complete feet.
- **Three.js.** The live view is first-person Batter Eye.
- **The conflict.** The locked rubric's EMB1 assumes Batter Eye, so the two renderers disagree. See decision D2.

### Evidence tools

- Unity EditMode suite (222 tests at last record; batch command in `unity/VandePractice/README.md`).
- The TypeScript unit suite (about 1,700 tests).
- TypeScript and Unity shared goldens: `tests/fixtures/unity-practice/practice-v3.json` and
  `scripts/practice-unity-goldens.mjs`.
- Android size and preflight scripts in `scripts/`.
- The findings ledger, `release/player-experience/shared/technical/FINDINGS.md`.
- Scheduling for heavy jobs, `release/product-sequence/QUIET-WINDOW.md`.

### Machine and tools

- **Installed:** Unity 6000.3.27f1 with Android Build Support, Android Studio's JDK 21, and the emulator AVD
  `vybe-pixel-api36-arm64`.
- **Not installed or not available:**
  - Blender (free; installing it needs approval);
  - motion capture;
  - a physical test phone.
- **Paid tools are excluded by owner rule** (§3.5). That includes Character Creator, paid motion-capture services
  and asset purchases.

### Open findings that touch this slice

- **F-012:** the ball's size and contrast at release.
- **CTL1:** input-to-bat proxies are 112–118 ms at p95. These are not presented-frame measurements.
- **Frame hitches:** 54 long animation frames over 100 ms around dead ball.
- **Bowler release:** a recorded continuity failure in the bowler's release.

Don't hide or "fix" these by changing thresholds.

## 3. Boundaries (non-negotiable)

1. **Physics decides.** Animation follows the authoritative TypeScript trace.
   - Don't use Unity PhysX for gameplay.
   - Never change physics, timing, scoring or outcomes to suit an animation.
   - Never stretch bones, float feet or move the ball to hide a mismatch.
2. **Stage 1 only.** No Chase, challenges, daily features, sharing, accounts or monetisation. Put later-stage ideas in
   the not-now register of the product sequence.
3. **Preserve working systems.** Don't rewrite or delete the Three.js or Classic paths, the bridge contract, or the
   tests. All three renderers must show the same outcome for the same trace.
4. **Assets.**
   - Only original assets, or free-licensed ones under the rule in §3.5. Register each in `docs/ASSET_REGISTER.md` with source, licence,
     hash and status.
   - No real player's likeness, team kit, logo or broadcast footage.
   - Reference video must be recorded by the owner with the subject's consent, or carry a free licence that allows
     commercial use.
5. **Free only (owner rule, 2026-11-01).**
   - Never use paid software, subscriptions, services, asset purchases or paid APIs.
   - Use only free tools, and only assets whose terms allow commercial use at no cost:
     - CC0;
     - CC-BY, with the attribution recorded in `docs/ASSET_REGISTER.md`;
     - material the owner made or filmed with consent.
   - A free tier of a commercial service counts only if its terms grant commercial use at no cost and need no
     payment details. Otherwise leave it out.
   - Models, datasets and tools licensed for non-commercial or research use only are excluded.
   - If a criterion cannot be met by free means, report the gap. Never work around this rule.
6. **Owner approval is still needed before:**
   - installing any software, free software included (Blender first);
   - committing, pushing or publishing.

   Between approvals, keep reversible checkpoints: a patch file of `git diff` plus the build id, in your scratch
   directory.
7. **Android limits.** The installed size must stay at or under 50,000,000 bytes, and India reach at or above 90.0%.
   Report the size delta of every asset change, and never estimate installed size.
8. **Documentation.** Write no new top-level docs.
   - Specs go into existing docs:
     - `docs/UNITY_PRACTICE_EXPERIENCE.md` for the stroke and camera;
     - `docs/PRACTICE_PHYSICS.md`, only if physics truly changes, and that needs a version bump and the owner's
       approval;
     - `docs/ASSET_REGISTER.md` for assets.
   - Evidence goes only under `release/cover-drive/<checkpoint>/`, with one `REPORT.md` per checkpoint.
9. **Shared machine.**
   - Run heavy jobs one at a time, under `nice -n 15`, inside a reserved quiet window.
   - Record `uptime` with every timing.
   - A timing taken at a load average above 20 is indicative only.

## 4. Owner decisions

Each decision has a default so work can start. Ask the owner once, at the start, listing them together. Apply the
default if no answer comes.

| ID | Decision | Default | Why |
| --- | --- | --- | --- |
| D1 | Which renderer carries the high-fidelity cover drive | The Unity presentation, with Three.js and Classic staying coherent with the same trace at their own fidelity | Unity already has the hero rig, the gear and the stroke markers; Three.js remains the fallback |
| D2 | Camera during live batting | Change no live camera in this slice. Judge the stroke from (a) the current Unity rear three-quarter view, (b) Batter Eye (hands, gloves, bat, front pad) and (c) the inspection and replay views in Appendix B. The owner then picks the live view, and EMB1 is amended only by the owner if the rear view wins. | The camera decides how much full-body realism matters, and the current rubric conflicts with the Unity camera |
| D3 | Character source (free only) | Repair the existing MakeHuman CC0 hero in Blender, using Blender's free MakeHuman add-on (MPFB, CC0 assets) where it helps. If the Phase 2 gate fails twice: try a CC0 or CC-BY game-ready human that passes the licence rule in §3.5. If that also fails, propose a free fallback for the owner to choose: a helmeted, distance-appropriate look with no face close-ups. | No cost, clean provenance, and the rig already exists. Don't assume the hero is salvageable: let the gate decide. |
| D4 | Motion source (free only) | Key the cover drive by hand in Blender from owner-recorded reference: a club cricketer, with consent, filmed on a phone in its slow-motion mode from side-on, front-on and behind, at least 5 good drives. Open-source pose-from-video tools may draft the keys only if their code and model weights are licensed for commercial use. Free CMU motion capture may serve non-cricket motions (walks, jogs) as it does now. | Clean rights and real cricket biomechanics. A pose draft is only a starting point; hand-keyed refinement and owner review decide. |
| D5 | Installs | Request approval to install Blender 5.2 LTS (free, GPL), from https://www.blender.org/download/lts/ (5.2.3 as of 2026-10-22). If MPFB doesn't support 5.2 yet, use 4.5 LTS instead. Nothing paid, ever (§3.5). | Blender is required for Phases 2–3 |
| D6 | Human reviewers | The owner is creative director and signs every checkpoint. An optional unpaid review by a volunteer club cricketer or coach, with consent. Independent evaluator agents check every measurable criterion. Real players come later, in the Stage 1 study. | Visual judgement cannot be automated |
| D7 | Size budget for this slice | At most +2,000,000 bytes on the Unity-inclusive APK, measured | Keeps the 50 MB gate reachable |

## 5. Working method

- **Small steps.** Each change is small and checkable on its own. Never certify your own work. An independent
  evaluator, or the owner for visual judgement, accepts it.
- **The loop, for every change:**
  1. Reproduce the baseline with the fixed scenario (§8).
  2. Capture the standard set (Appendix B) plus telemetry.
  3. Name the defect, with evidence.
  4. Make the smallest correction.
  5. Rerun the identical scenario.
  6. Capture again.
  7. Compare side by side.
  8. Report improvements and regressions.
  9. Ask for the owner's visual approval where judgement is needed.
- **Tests aren't realism.** Passing unit tests never proves realistic animation. Telemetry gates catch defects; the
  owner's eyes judge quality.
- **Automate the repetitive work.**
  - Blender in background mode with Python scripts committed alongside the exporters in `scripts/`.
  - Unity in batch mode for tests, scenario runs and captures.
  - Make every capture reproducible from a single command.
- **Reading, optional.** These may be read for practices to apply. Record which you read and what you applied, and
  never claim to have read a page you couldn't open.
  - OpenAI, "Building games with Astra";
  - "Making of PolyFish";
  - "Game dev with Claude: a retrospective";
  - Levy Street, "Building games with AI";
  - OpenAI, "Harness engineering".

## 6. Phases and exit gates

Don't start a phase until the previous one exits.

| Phase | Work | Exit |
| --- | --- | --- |
| P0 Discovery and baseline (read-only) | Verify §2. Inventory the batter assets, rig, motion code and cameras. Find which tools generated which assets; mark unknown provenance as unknown. Capture the baseline cover drive on ref-1 in Unity and Three.js (Appendix B). Rank the 20 biggest quality problems by visual impact, gameplay impact, severity, confidence, effort, cost, regression risk and dependencies, separating confirmed from hypothesis. | `release/cover-drive/p0/REPORT.md`, the owner's answers to D1–D7, no code changed |
| P1 Scenario, telemetry and capture rig | A deterministic cover-drive scenario: ref-1, a fixed seed and match state, Real mode, right-handed, a white ball under the default field, with input offsets as the only variable. Add the per-frame telemetry of §8 and the capture rig of Appendix B, reusing the existing hooks, evidence classes and goldens. | One command reproduces the baseline bit-identically twice |
| P2 The batter at rest | Decide D3 with evidence. Fix proportions, posture, grip, deformation, materials and idle life. | §7-A passes, and the owner rates the at-rest captures ≥ 4/5 |
| P3 The stroke, without a ball | The seven stages: stance, recognition, stride, downswing, contact pose, follow-through, recovery. Author them from the D4 reference and integrate them as the cover-drive clip for the vertical-bat drive family, driven by the existing markers and the canonical trace. Use limited IK only for small corrections. | §7-B passes, and the owner rates each stage ≥ 4/5 |
| P4 Coherence and interactivity | Drive the stroke from the authoritative trace for every timing, contact kind and delivery. Show edges and misses honestly, and show the wrong-ball consequences that physics decides. | §7-C and §7-D pass |
| P5 Feel | Contact sound and haptic, the post-contact camera, crowd proportion, and an optional replay of exceptional shots. | §7-E passes, and the owner rates feel ≥ 4/5 |
| P6 Device, performance and size | Frame budget across complete deliveries including dead ball, memory, size delta, and parity with the fallbacks. | §7-F and §7-G pass, and an emulator run is recorded. A physical phone is required before release. |
| P7 Independent acceptance | Independent evaluator agents rerun everything on the frozen build, and the owner signs off. | §7-H and §7-I pass. Then the next stroke family may start (Appendix A). |

## 7. Acceptance criteria

All criteria are on one build id. Measurements come from telemetry at 60 Hz unless stated. "Owner rating" uses the
1–5 sheet in Appendix B.

### A. The batter at rest

| ID | Criterion |
| --- | --- |
| A1 | **Proportions.** Stature 1.70–1.90 m. Head height 1/7–1/8 of stature. Arm span within ±5% of stature. Hip height 0.47–0.53 of stature. |
| A2 | **Stance.** Feet 0.30–0.45 m apart. Knees flexed 10–25°. Head roll ≤ 5°. Eyes level and facing the bowler. Bat grounded near the back toe or held in a backlift, as authored. |
| A3 | **Grip.** Both hands on the handle with no gap over 5 mm. Top hand above the bottom hand, 0–40 mm apart. Correct for a right-hander, mirrored exactly for a left-hander. No finger through the handle. |
| A4 | **Interpenetration.** No intersection over 5 mm between body, gear and bat in the stance, contact or follow-through poses (automated mesh-distance check). |
| A5 | **Life.** Breathing and weight shift of 0.5–2 cm, never frozen for more than 2 s, never a visibly identical loop (varied period). |
| A6 | **Owner judgement.** "A person, not a mannequin" rated ≥ 4/5 on the front, side and face captures under identical lighting. |

### B. The stroke, without a ball (ref-1 timing and stride)

| ID | Criterion |
| --- | --- |
| B1 | **Planted feet.** Front foot slide ≤ 1.0 cm from plant to recovery. Back foot may lift its heel and pivot on the ball of the foot with ≤ 2 cm translation. No sinking or floating over 1 cm. |
| B2 | **Joint limits.** Elbow and knee hyperextension ≤ 5°. No joint outside its anatomical range. |
| B3 | **Smoothness.** No joint rotation over 15° in one frame, except the bat's deceleration at contact. No pose step over 2° at any blend boundary. |
| B4 | **Kinematic sequence.** In the downswing, peak angular velocities run proximal to distal: pelvis, then torso, then lead arm, then bat. |
| B5 | **Head.** Lateral head movement ≤ 4 cm in the downswing, and the head within ±10 cm of the front knee's line at contact. |
| B6 | **Stride.** Stride 0.30–0.45 × stature, landing within 20° of the line to the contact point. |
| B7 | **Bat.** Long axis within 20° of vertical at contact. Face direction within ±10° of the physics bat face from the trace. Full face at ideal timing. |
| B8 | **Weight.** The ground projection of the centre of mass is within 10 cm of the front foot's support area at contact. |
| B9 | **Finish.** Hands finish high, above the front shoulder. Balanced recovery within 1.0 s of contact, with no snap (B3). |

### C. Coherence with the authoritative trace

| ID | Criterion |
| --- | --- |
| C1 | **Contact time.** The visible contact frame is within ±1 rendered frame of the TypeScript contact time. Sound and haptic within 20 ms (COH6). |
| C2 | **Contact pose.** The rendered bat is within 3 cm and 5° of the physics bat at contact (COH5). The rendered ball is within max(2 px, half its diameter) of the projected physics position throughout (COH2). |
| C3 | **IK budget.** Corrections stay ≤ 8 cm at the hands and ≤ 12° per joint relative to the authored clip. Anything larger needs a clip variant; log every case. |
| C4 | **Honesty.** On a physics miss the rendered bat never touches the ball (clearance at least one ball radius plus 1 cm). On an edge, contact is visible on the edge region. |
| C5 | **Authority.** No code path where animation changes contact, outcome or score. The TypeScript goldens, the Unity trace-digest parity and the EditMode suite pass. |

### D. Interactivity (ref-1, Real)

| ID | Criterion |
| --- | --- |
| D1 | **Timing sweep.** Input offsets from −120 to +120 ms in 5 ms steps (49 runs). The presented contact class matches physics in 100% of runs: middle within ±25 ms; solid middle within ±55; edge within ±80; miss beyond. The presentation shows physics; it never relabels. |
| D2 | **Direction.** At ideal timing the ball exits at 35°–75°, along the ground. Early timing runs straighter and late timing squarer or onto an edge, in the direction physics produces. |
| D3 | **Wrong ball.** A fixed cover-drive input is the best response to no more than 3 of the 6 reference balls (EX7). Across 100 random Club overs it scores under 2 boundaries per over (FAIR6), via `practice-properties.mjs`. |
| D4 | **Variation.** At 120, 135 and 150 km/h; on off stump, 4th stump and wide; full, good and short; with swing, seam and spin: the stride and contact height follow the ball within reach. Outside reach the presentation shows the edge or miss physics decided, never a perfect drive. |
| D5 | **No auto-reward.** A boundary only ever follows ideal timing, a suitable ball and a gap. Zero scripted outcomes (SYS2). |

### E. Feel

| ID | Criterion |
| --- | --- |
| E1 | **Contact feedback.** A middle contact uses the 'sweet' sound and haptic signature; edges, blocks and misses are distinct (FBK1), within the C1 timing. |
| E2 | **Camera.** No camera movement between release and contact beyond ≤ 2 cm of head motion. Ball-follow starts at least 150 ms after the visible contact, eases in and out, and finishes before the next ball. Reduced Motion removes it. |
| E3 | **Crowd.** Proportional to the moment (EMO1), with no reaction before the ball reaches the rope. |
| E4 | **Replay.** An optional replay of an exceptional shot from the identical trace, side-on, at 1× and 0.5×. One tap skips it, and it never blocks the next ball. |
| E5 | **No arcade effects.** No trails, bursts or slow motion in live play beyond the existing readability aids. |

### F and G. Device, performance, size and accessibility

| ID | Criterion |
| --- | --- |
| F1 | **Frame budget.** Over complete deliveries including the dead-ball transition: p95 ≤ 22.2 ms and no frame over 50 ms (Balanced). Engineering evidence comes from the emulator; release evidence needs a physical phone. |
| F2 | **Size.** At most +2,000,000 bytes on the APK (D7), measured with the repo's size scripts. SIZE-50 must not regress. |
| F3 | **Memory.** Peak delivery memory up by no more than 30 MB (`dumpsys meminfo`). |
| F4 | **Parity.** Three.js and Classic show the same outcomes for the same traces (goldens). Low-memory routing to Classic is unchanged. CTL1 is no worse than the P0 baseline. |
| G1 | **Accessibility.** Reduced Motion, captions, sound off and haptics off lose no information (A11Y4, A11Y5). |

### H and I. Human review and engineering gates

| ID | Criterion |
| --- | --- |
| H1 | **Owner rating.** Every one of the seven stages, "a person, not a mannequin", and the feel are rated ≥ 4/5. Ratings use the standard videos: 1×, 0.25×, and side by side with the D4 reference. |
| H2 | **Human scores stay PROVISIONAL.** Player-experience scores for the drive stay PROVISIONAL until the Stage 1 player study (10 rookies and 10 experts on phones) includes it. |
| I1 | **Engineering.** All of these pass, with no new Critical or High finding open and evidence recorded for each: `npm run typecheck:all`; `npm test`; Unity EditMode (batch); the shared goldens; `practice-properties.mjs`; the Android size check; `node scripts/scan-secrets.mjs`. |

## 8. Required scenarios and telemetry

### Scenarios

Each scenario is runnable by one command, deterministic, and captured per Appendix B.

1. The batter standing still.
2. The cover drive with no ball.
3. The cover drive against ref-1.
4. Early input.
5. Ideal input.
6. Late input.
7. The wrong ball: ref-3, ref-5 and ref-6.
8. Speeds of 120, 135 and 150 km/h.
9. Foot slide.
10. Bat and ball contact synchronisation.
11. Camera tracking after contact.
12. Frame time on the emulator.

### Telemetry, per frame (JSON lines, under the scratch directory)

- the build id and scenario id;
- time on the trace clock and on the frame clock;
- the input timestamp and the normalised swing;
- the animation clip and its normalised time;
- the transforms of all 75 joints, compressible to key joints;
- foot positions and their contact flags;
- the bat transform and face normal;
- the ball position and velocity;
- the physics contact time, point and kind;
- the IK correction magnitudes;
- the camera pose;
- frame time and memory.

Keep only summaries and selected captures under `release/`.

## 9. Reporting

### Each checkpoint `REPORT.md`

- the build id and UTC time;
- what changed and why (the defect it addresses);
- before and after captures, side by side;
- telemetry against criteria, pass or fail with numbers;
- regressions;
- owner ratings;
- open risks;
- the size delta.

### The final report

- whether each criterion is PROVEN, PROVISIONAL or NOT PROVEN;
- the asset provenance;
- the owner's sign-off;
- the remaining gaps;
- the proposed next stroke family.

Never claim a visual improvement without rendered evidence, or a performance improvement without measurement.

## Appendix A. The shot taxonomy and the roadmap

The physics models 16 families (`ShotFamily` in `src/physics/shot.ts`):

- forward and back defence;
- straight, off, cover, square and back drives;
- steer;
- on drive;
- flick;
- glance;
- back-foot punches (off and on side);
- cut;
- pull or clip;
- hook or back glance.

Elevation turns any of them into a lofted version, and a leave is no swing.

Animate only strokes the physics supports. Sweeps, reverse strokes, switch hits, ramps and scoops, the helicopter,
the upper cut and evasive ducks need new physics forms first. Those are a physics change, with an owner decision and
a version bump.

### Motion families, in build order (each reuses this slice's framework)

1. **Vertical-bat front-foot drives:** cover (this slice), then off, straight, on, square, and the lofted versions.
2. **Defence:** forward and back.
3. **Back-foot vertical:** punches and the back drive.
4. **Horizontal bat:** cut, pull, hook.
5. **Wrist:** flick, glance, clip, steer.
6. **Leave.**
7. **Later, after physics adds them:** sweeps, reverses, scoops and ramps, evasive responses.

Separate animation assets are justified only where the biomechanics truly differ. The footwork, contact, timing,
bat geometry, camera, audio and telemetry layers are shared.

## Appendix B. The standard capture set

- **Lighting.** Identical for every before-and-after pair: the default day light and the stadium background.
- **Seven stills, at 1920×1080 and 915×412:**
  1. full body, front;
  2. full body, side;
  3. face close-up;
  4. batting stance;
  5. contact pose;
  6. follow-through;
  7. the in-game batting view, from the current live camera and from Batter Eye.
- **Three videos, at 60 fps:**
  - the full stroke at 1×;
  - the full stroke at 0.25×;
  - side by side with the D4 reference.
- **The owner's rating sheet (1–5 each):**
  - each of the seven stages;
  - "a person, not a mannequin";
  - grip;
  - balance;
  - timing feel;
  - contact feel;
  - "would a club cricketer recognise this drive?"
