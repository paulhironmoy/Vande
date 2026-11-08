# Practice performance, device tiers and accessibility verification

Owner: the performance and accessibility workstream (`src/perf/**`, `scripts/perf/**`, `scripts/android-practice.*`,
`tests/unit/perf/**`, `tests/e2e/perf-*`, `tests/e2e/a11y-*`). This document records how Practice chooses its graphics,
how it is measured, every measured number with the command that produced it, and what is still unmeasured.

**Read this first.** Every number below comes from an Apple M1 Pro MacBook Pro (headless Chromium 156, macOS 15.7) or
from the Android emulator on that Mac. **None of it is evidence of phone performance.** A desktop GPU is not a Mali,
Adreno or PowerVR GPU; CPU throttling slows JavaScript but not the GPU; the emulator translates OpenGL ES to the Mac's
GPU. The tests that only a physical phone can answer are listed in [§9](#9-physical-device-tests-still-required).

## 1. Tiers

### 1.1 What the player sees

Players see four words only: **Automatic**, **Premium**, **Balanced** and **Classic**. Tiers, profiles, frame rates
and GPU names stay in the hidden diagnostics screen, except when a device genuinely fails, and then in product language
with one action ("This device is switching to Classic graphics for smoother batting.").

| Player-facing tier | Rendering (src/perf/tiers.ts `TIER_RENDERING`) | What it draws |
| --- | --- | --- |
| **Premium** | first-person stage, profile `high` | full materials, 2048 key-light shadows, light shafts, 6500 animated crowd, players at full detail to 40 m, 900–1440 px internal height |
| **Balanced** | first-person stage, profile `standard` or `lite` | Standard: 1024 shadows, 3600 animated crowd, detail to 22 m, 720–900 px. Lite: blob shadows, 1400 static crowd, detail to 9 m, 540–720 px, no MSAA when it starts there |
| **Classic** | the 2D stage | the same physics, deliveries, timing windows and scoring on a Canvas 2D batter's view |

The one mapping lives in `src/perf/tiers.ts` and is exported from `@/perf`. Settings use these functions:

- `tierChoices(assessment)` gives the options to offer;
- `qualityChoiceForTier` and `tierChoiceFor` translate between a pick and the stored setting;
- `effectiveTier` gives what will be drawn;
- `tierChanged` decides whether a step down is worth one calm notice between balls.

Unit tests: `tests/unit/perf/tiers.test.ts`.

### 1.2 Selection (once per app version, discreetly)

The device check runs while the pitch is prepared. It plays the real scene (`benchmark.ts`, `classify.ts`, unchanged).

| Earned | Rule |
| --- | --- |
| Premium | Full Batter View at Standard (55+ fps, no 1 s window under 50, at most 2 frames over 50 ms, hardware WebGL 2, a stable context, event-to-frame ≤ 50 ms) **with headroom** (58+ fps, p95 ≤ 18.5 ms, no spikes, 8 GB reported, shaders ≤ 800 ms), confirmed by a second run at High |
| Balanced (Standard) | Full Batter View at Standard without the High confirmation |
| Balanced (Lite) | Full on a phone that reports 2 GB or less; or Assisted: 45–54 fps, a dip, spikes, one context loss, 50–100 ms response, or under 2 GB |
| Classic | Below: no WebGL 2, a software rasteriser, under 45 fps at Standard and again at Lite, two context losses, or over 100 ms response |

Settings never offer more than the device earned. A device that earned Balanced is offered Automatic, Balanced and Classic.

### 1.3 Degradation: visual expense goes first

`SessionMonitor` (`monitor.ts`) judges the median frame rate of the last three deliveries. It steps down between balls
only, and never steps up:

| Step | When | What is removed |
| --- | --- | --- |
| Premium → Balanced (Standard) | under 55 fps | 2048 → 1024 shadows, light shafts, crowd 6500 → 3600, player detail 40 → 22 m, particles, internal resolution |
| Premium or Balanced (Standard) → Balanced (Lite) | under 50 fps | the shadow map (blob shadows remain), crowd animation, crowd 3600 → 1400, detail 22 → 9 m, particles, resolution |
| Balanced (Lite) → Classic | under 45 fps once Assisted, or a second context loss at any level | the 3D stadium, players and lighting |

Never reduced at any step (`INVARIANTS`):

- the ball: drawn 1.22× with its outline, ground shadow and trace;
- the physics and its timing windows;
- the input path;
- the bowler's release cues;
- the timing of sound and haptics.

The ball trace is currently 5 samples at α 0.30 in Lite and Standard and 6 at α 0.32 in High and Classic. The lead has
ruled that it must be identical in every tier, and the change is with the presentation workstream ([§8](#8-findings-raised)).

### 1.4 The device allowance (per-tier timing tolerance): rationale, bounds and the binding policy

**Policy (binding, from the lead):**

- **Real** applies **zero** timing forgiveness on every tier. The physics ignores the device allowance at Real from
  `PRACTICE_SIM_VERSION` 2.
- **Learn** and **Play** keep their declared bands plus the declared device allowance.
- UX latches the allowance once per over: a step down mid-over never changes the windows of the balls still to come
  in that over.
- `src/perf` keeps producing it as `DeviceAssessment.toleranceMs` (`toleranceFor`).

**Bounds.** The allowance is one of three values: 0 ms (Full Batter View), +12 ms (Assisted,
`PERF_ASSISTED_TOLERANCE_MS`) or +20 ms (Classic, `PERF_CLASSIC_TOLERANCE_MS`). There is nothing in between and
nothing larger.

- It is added to each timing band at Learn (perfect 31, solid 58, edge 117 ms) and Play (20, 40, 86 ms), through
  `src/physics/timing.ts` `activeBands`. These are the bands set on 2026-11-03 and frozen with simulation v3; before,
  they were Learn 55/110/170 and Play 35/75/125 (`docs/PRACTICE_PHYSICS.md`, "Timing bands"). Real's bands are
  14/29/55 ms and take no allowance.
- It is recorded with every delivery (`DeliveryRecord.tierToleranceMs`), so a replay is judged exactly as it was played.
- It never changes the delivery, the flight or the input timestamps. Only the bands widen.

**Rationale: an assist for less capable presentations, not a correction of measured delay.**

1. A swing is timed from the input event's own timestamp (`normalizeGesture`), never from a frame. A busy main thread
   or a slow frame therefore cannot make a swing late. The harness confirms that frames run late under load
   ([§5](#5-results)); the swing time is unaffected by construction.
2. Constant display latency (panel, compositor, touch digitiser) differs per device. The player's own timing check
   removes it (`calibrationMs`, bounded to −60…+220 ms).
3. What a lower frame rate does change is how often the ball is seen.
   - At 45 fps the ball is redrawn every 22.2 ms instead of every 16.7 ms.
   - So the drawn image is on average 2.8 ms older (half the interval), and the frame-to-frame jitter has a standard
     deviation of 6.4 ms instead of 4.8 ms (interval/√12).
   - These figures are arithmetic on the frame intervals, not phone measurements. They are well under 12 ms.
4. Classic usually runs at 60 fps ([§5](#5-results)). Its +20 ms therefore compensates the 2D view's weaker depth cues,
   not latency.

So the allowance is a declared gameplay assist at Learn and Play. At Real, the level whose bands are the physical ones
(`PHYSICAL_BANDS`), no device gets one, which is the fairness the ranked physics challenges need.

## 2. Targets

| Source | Target | Criterion |
| --- | --- | --- |
| Production brief | Balanced holds a stable 45–60 fps during the live delivery | PERF1: Balanced p95 ≤ 22.2 ms and p99 ≤ 33.3 ms |
| Production brief, North Star | The lower tier holds a stable 30 fps or falls back to Classic | PERF1: Classic p95 ≤ 33.3 ms; the monitor's step-downs ([§1.3](#13-degradation-visual-expense-goes-first)) |
| North Star | Capable devices hold 60 fps | PERF1: Premium p95 ≤ 18 ms |
| Rubric PERF1 | No frame over 100 ms inside a delivery | at least 30 deliveries per tier and environment, from 1 s before release to the outcome |
| Rubric PERF2 | No quality change mid-delivery | stage, tier, drawing buffer and profile at release equal to those at dead ball |
| Rubric PERF3 | Identical input timestamps give identical results at 30 and 60 fps | `tests/e2e/perf-practice-determinism.spec.ts` |
| Production brief, rubric PERF4 | No gameplay-time network, asset load or shader compile during a delivery | Resource Timing and `linkProgram` inside deliveries; play with the network blocked |
| Production brief, rubric PERF5 | Recover from backgrounding and context loss with the over intact | `tests/e2e/perf-practice-runtime.spec.ts`; HOME on the emulator |
| Rubric PERF6 | The Android build plus the emulator smoke and lifecycle pass | `scripts/android-practice.sh` |
| Rubric CTL1 | Input to visible bat: p95 ≤ 50 ms on Premium and Balanced, ≤ 67 ms on Classic | the stage's `lastInputToBatMs`, ≥ 50 swings per configuration |
| Production brief | Respect practical memory limits | JS heap and WebGL bytes per delivery, a ten-over session ([§5.5](#55-memory-and-a-long-session)) |

## 3. Method

### 3.1 The harness (`scripts/perf/`)

| File | What it does |
| --- | --- |
| `observer.js` | A passive recorder, added before any page script. It changes nothing the app renders. Each WebGL wrapper calls the original with the same arguments and returns its result; the hot bind calls are wrapped without clock reads or allocation; canvases are held weakly. It records rAF timestamps (the cadence the app's own monitor samples), phase changes (the play screen's data attributes, or the test API's state), Long Tasks, Long Animation Frames with their slowest scripts, Event Timing (input delay, handler time, time to the next paint), Resource Timing, drawing-buffer size changes, `linkProgram` and `compileShader` calls, slow status queries, and the bytes the app holds in textures, renderbuffers and buffers per context, minus lost contexts |
| `practice-lib.mjs` | The GPU and viewport profiles, the browser, seeding a device check, walking the real UI to the next delivery, real touches through CDP (`Input.dispatchTouchEvent`), and the window statistics |
| `practice-frames.mjs` | One run: N complete deliveries batted with flicks and taps timed around the ideal contact (from the test API's `lastFlight`). Per delivery it reports the run-up-to-dead-ball, release-to-dead-ball and PERF1 windows; programs linked; long tasks; loads; quality changes; the stage's `lastInputToBatMs` (when the build has `stats()`); the JS heap; and WebGL memory |
| `practice-matrix.mjs` | Runs a set of profiles one at a time, with a fresh browser per run |
| `practice-report.mjs` | Markdown tables from a results directory |
| `perf-evidence.mjs` | Evidence records in the rubric's §8 format, plus distributions and 1 ms histograms per tier and environment |
| `practice-profile.mjs`, `profile-modules.mjs` | The CPU profiler around contact, and the time inside each long frame split by source module (needs an unminified build) |
| `run-perf.sh` | **One command:** build id and uptime, the test-hooks build of this tree, the evidence matrix, then the records into `release/player-experience/shared/perf/<build id>/` |
| `run-a11y.sh` | **One command:** the accessibility and robustness specs in an isolated Playwright run, then their evidence records |
| `android-frames.mjs` (with `scripts/android-practice.*`) | The recorder inside the Android WebView, `dumpsys gfxinfo` per delivery, HOME between balls, and airplane mode |

The build measured is the Practice **test-hooks build of the same tree** (`VITE_PRACTICE_TEST_HOOKS=1`), which the rubric
allows for instrumentation. With no configuration, its hooks do nothing: the real device check runs, time is real,
seeds are random and every swing comes from a real touch. The harness only calls the read-only functions `state()`,
`stats()` and `lastFlight()`.

"Forced" tiers store a device check that earned Premium and pick the tier in Practice settings, as a player on such a
device could. The session monitor still runs and may step the session down, which the per-delivery rows show.

### 3.2 What each profile represents, and what it does not

| Profile | Represents | Does not represent |
| --- | --- | --- |
| **Metal** (`--use-angle=metal --enable-gpu`, headless) | The real M1 Pro GPU through ANGLE: real shader compiles, real GPU timing and backpressure | Any phone GPU. The M1 Pro is many times faster than a Mali-G52 or PowerVR GE8320. Headless frames come from a synthetic 60 Hz begin-frame source, not a display |
| **SwiftShader** (`--use-angle=swiftshader`) | A device with no usable GPU, and the floor of the software path. It exercises the fallback to Classic | Phone performance. The 3D stage runs at 2–8 fps here, which is correctly Below |
| **CPU 4× and 6×** (`Emulation.setCPUThrottlingRate`) | JavaScript, layout and the main thread of budget phones; 4–6× an M1 Pro core is roughly a 2019–2021 Cortex-A53/A55 big core | The GPU, which is never throttled; thermal throttling; memory bandwidth; Android's input pipeline |
| **Viewports** (640×360 at 2×, 844×390 at 3×, 915×412 at 2.625×, 1280×800 at 1.5×, 1920×1080 at 1×) | Layout and drawing-buffer sizes; `practicePixelRatio` holds the buffer height in each profile's band | Panel refresh rates (60/90/120 Hz), notches, OEM skins |
| **Android emulator** (`vybe-pixel-api36-arm64`, `-gpu host`, 4 or 2 cores, 2 GB) | The real Capacitor app, WebView 133, Android's input pipeline (`adb shell input`), lifecycle, airplane mode and gfxinfo | A phone GPU. The emulator translates GLES to the Mac's GPU |

Each timing record carries the machine's `uptime`. The Mac is shared by several agents, and load averages of 6–13
were typical during these runs.

## 4. How to rerun (one command each)

| What | Command | Output |
| --- | --- | --- |
| Frame times per tier (PERF1), quality changes (PERF2), loads and shader programs (PERF4), input to bat (CTL1), startup | `scripts/perf/run-perf.sh evidence` (about 100 min; `quick`: about 15) | `release/player-experience/shared/perf/<build id>/EVIDENCE.md`, `distributions.json`, `histograms.csv`, `EVIDENCE-STARTUP.md`; copies in `release/product-sequence/stage-0/perf/`; raw runs in `test-results-perf/runs-<build id>-<set>/` |
| Accessibility (A11Y1–A11Y7) and robustness (PERF2–PERF5) specs | `scripts/perf/run-a11y.sh [a11y\|perf\|all]` (about 20 min) | `release/player-experience/shared/perf/<build id>/EVIDENCE-E2E-<what>.md` and the Playwright JSON report |
| Android smoke, lifecycle and frames | `BOOT=1 HOOKS=1 scripts/android-practice.sh <out> --perf --recheck` (add `CORES=2` for the 2-core run) | `<out>/android-<label>.json`, screenshots, logs |
| Unit tests | `npx vitest run tests/unit/perf` | the tier mapping, classifier, benchmark, cache, monitor and frame statistics |

Run them only in a quiet window (`release/product-sequence/QUIET-WINDOW.md`). Every record carries `uptime`, and a
1-minute load above 20 marks a measurement as indicative only (AGENTS.md).

## 5. Results

### 5.1 Before: the committed build (HEAD 38924bd)

These are a first look before the integrated tree. Each row is one run of 6 complete deliveries, not the 30 that PERF1
requires.

- Command: `node scripts/perf/practice-matrix.mjs --dist <HEAD snapshot>/dist-perfh --set core`
- Profile: Metal, 915×412 at 2.625×, real CDP touches
- Load: the 1-minute load average was 6–13, so these are not indicative-only measurements
- The device check: it ran for real on this Mac and earned Premium at every CPU throttle (60 fps, high_headroom)
- Statistics: computed over the run-up-to-dead-ball window, with "flight" meaning release to dead ball
- Input to bat: not measured. The committed build has no `stats()` read; the integrated build has one.

| CPU | Tier forced | Drawing buffer | Median fps (lowest ball) | p95 / worst frame (ms) | Frames > 33 / > 50 ms | Flight p95 / worst (ms) | Lowest 1 s window (fps) | Programs linked in deliveries | Long tasks (max ms) | WebGL MB at ball 1: textures and buffers + drawing buffer (est.) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1× | Premium | 2287×1030, MSAA | 60.0 (60.0) | 16.8 / 16.8 | 0 / 0 | 16.7 / 16.8 | 60 | 0 | 0 | 41.6 + 98.8 |
| 1× | Balanced (Standard) | 1830×824, MSAA | 60.0 (60.0) | 16.8 / 16.8 | 0 / 0 | 16.8 / 16.8 | 60 | 0 | 0 | 17.9 + 63.3 |
| 1× | Balanced (Lite) | 1599×720 | 60.0 (60.0) | 16.8 / 16.8 | 0 / 0 | 16.8 / 16.8 | 60 | 0 | 0 | 4.4 + 13.2 |
| 1× | Classic | Canvas 2D | 60.0 (60.0) | 16.8 / 16.8 | 0 / 0 | 16.8 / 16.8 | 60 | 0 | 0 | – |
| 4× | Premium | 2287×1030, MSAA | 60.0 (59.5) | 16.8 / 66.6 | 2 / 1 | 16.8 / 66.6 | 55 | 0 | 2 (76) | 41.9 + 98.8 |
| 4× | Balanced (Standard) | 1830×824, MSAA | 60.0 (59.8) | 16.8 / 50.0 | 1 / 0 | 16.8 / 50.0 | 58 | 0 | 1 (58) | 17.9 + 63.3 |
| 4× | Balanced (Lite) | 1599×720 | 60.0 (59.8) | 16.8 / 50.1 | 1 / 1 | 16.8 / 50.1 | 58 | 0 | 0 | 4.4 + 13.2 |
| 4× | Classic | Canvas 2D | 60.0 (59.8) | 16.8 / 50.0 | 1 / 0 | 16.8 / 50.0 | 58 | 0 | 0 | – |
| 6× | Premium | 2287×1030, MSAA | 59.8 (59.1) | 16.8 / 100.1 | 3 / 3 | 16.8 / 100.1 | 50 | 0 | 3 (115) | 41.9 + 98.8 |
| 6× | Balanced (Standard) | 1830×824, MSAA | 59.4 (58.7) | 16.8 / 83.3 | 3 / 3 | 16.8 / 83.3 | 53 | 0 | 3 (93) | 17.9 + 63.3 |
| 6× | Balanced (Lite) | 1599×720 | 59.3 (58.7) | 16.8 / 100.0 | 3 / 3 | 16.8 / 100.0 | 54 | 0 | 3 (106) | 6.4 + 13.2 |
| 6× | Classic | Canvas 2D | 59.8 (59.4) | 16.8 / 100.0 | 1 / 1 | 16.8 / 100.0 | 55 | 0 | 1 (106) | – |

What this shows:

- The p95 holds at one display frame everywhere. The tail is CPU work at and after bat-ball contact, not the GPU: the
  same 50–133 ms frames appear in Lite and in Classic.
- Long Animation Frames, and a CPU profile of an unminified build at 6× (`scripts/perf/practice-profile.mjs`), name
  the work:
  - the swing's resolution, 60–70 ms after touch-down (the gesture handler's task with its microtasks: `strike`,
    `buildBatTrack`, `simulateFielding`, `integrateBall` in the physics; `buildGaze` and `seenBall` in render3d);
  - three.js skinning each player mesh on the CPU to compute its bounding sphere the first time it is drawn
    (`applyBoneTransform` from `projectObject`, 53 ms at 6×).
- Both are worst in the first delivery of a session.
- A dismissal builds a new stage and WebGL context for the next innings. The old context is force-lost and freed.
  - These runs used an earlier recorder that did not yet subtract lost contexts, so the table gives the memory at
    ball 1.
  - The new context recompiles its 28 programs: 25 at Lite, where there are no shadow variants.
- The drawing buffer is the largest single cost: about 99 MB at Premium with MSAA on this viewport.
  - This is an estimate: front and back colour, depth, and 4× multisampled colour and depth, from the canvas size and
    the context's attributes. Browsers do not expose GPU memory.
  - Textures and buffers are counted exactly as the app allocates them: 41.6 MB at Premium (most of it the 2048 shadow
    map), 17.9 MB at Standard and 4.4 MB at Lite.

See [§8](#8-findings-raised) for the owners and fixes.

### 5.2 The integrated tree (quiet window)

The evidence runs on the integrated tree happen in the quiet window (`release/product-sequence/QUIET-WINDOW.md`).
Their records are in `release/player-experience/shared/perf/<build id>/` and `release/product-sequence/stage-0/perf/`.
The tables below are copied from those records.

### 5.3 Input to bat

The stage measures `lastInputToBatMs`: from the event timestamp to the first submitted frame with the bat moving. The
harness reads it after every batted delivery. Builds before the integrated tree have no read for it, so §5.1 does not
report it.

The integrated tree was checked once at a load of 22, so these numbers are indicative only: 41.1, 18.7 and 49.0 ms over
three swings (Metal, 1×, Balanced Standard). The CTL1 statistics (p95 over ≥ 50 swings per configuration) come from the
quiet-window run.

Two parts of the latency are not visible here:

- Event Timing's pointerdown-to-next-paint is the browser's own view of the time to the presented frame; it is recorded
  per delivery as `downToPaint`.
- The touch digitiser and the display are visible to neither measure ([§9](#9-physical-device-tests-still-required),
  D3).

### 5.4 Shader compilation during a delivery (PERF4)

| Build | Where | Programs linked inside deliveries | When |
| --- | --- | --- | --- |
| HEAD 38924bd | Metal, 15 runs, 90 deliveries | 0 | 28 programs linked at mount, before ball 1 |
| HEAD 38924bd | Emulator, 4 cores, fresh check (Standard benchmark, then Lite) | 5 in delivery 1, then 0 | after the change from Standard to Lite (F-017) |
| 38924bd+3b91691a5867 | Metal, 1×, Standard | 4 in delivery 1, then 0 | −1605…−1595 ms from release (the run-up begins); a 133 ms frame |
| 38924bd+3b91691a5867 | SwiftShader, Standard stepping down to Lite | 4 in delivery 1; 16 in the first Lite delivery | −2387…−2248 ms, then +193 and +1105…+1113 ms around contact |

The method is the recorder's wrapped `linkProgram`, timestamped against the phase log. The link calls themselves are
cheap, because the cost comes when a program is first used. The proof of a hitch is the long frame in the same delivery.
Both cases are with the presentation workstream ([§8](#8-findings-raised)).

### 5.5 Memory and a long session

- Textures, buffers and renderbuffers are counted exactly as the app allocates them, per context, minus lost contexts.
  The drawing buffer is estimated from its size and attributes.
- HEAD, Metal, 915×412, at ball 1:
  - Premium: 41.6 MB, plus about 99 MB of drawing buffer with MSAA;
  - Balanced (Standard): 17.9 MB plus about 63 MB with MSAA;
  - Balanced (Lite): 4.4 MB plus about 13 MB, with no MSAA when it starts at Lite;
  - Classic: no WebGL.
- On the emulator, a session that started at Standard and settled at Lite kept its MSAA context for the whole first
  innings: 1726×720, antialias true. Its next innings, built at Lite, has no MSAA. That is about 55 MB against about
  15 MB of drawing buffer (an estimate).
- JS heap (Performance.getMetrics, no forced GC): 7–9 MB in Classic sessions and 14–44 MB in first-person sessions,
  varying with the collector's timing.
- `tests/e2e/perf-practice-runtime.spec.ts` "[MEM]" checks two Classic overs after a forced GC: heap growth under 3 MB,
  under 300 DOM nodes and under 60 listeners. It passed in a functional run on the working tree at about 04:00Z on
  2026-10-26, which is not an evidence run; the evidence run follows in the quiet window.
- The ten-over first-person session (`practice-frames.mjs --deliveries 60 --gc-every 6`) is part of the quiet-window
  run.

### 5.6 Physics cost per delivery (`resolveDelivery`), 2026-11-03

Builder-measured in plain Node on the M1 Pro: the same 270 fixed inputs, with the trees interleaved where stated. None
of it is a phone result. Sources, under `release/product-sequence/stage-1-practice/wedge/physics/`: `REPORT.md` §5,
`phase2/REPORT.md` §6, `phase3/REPORT.md` §5, `phase5/REPORT.md` (including its "Phase 5b" and "Freeze amendment
5d" sections), `guards.json`, `5b-guards.json` and `5d-evidence.json`.

| Run | Tree | p50 (ms) | p90 (ms) | p99 (ms) | Load (1 min) |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | before → after | 23.7 → 6.0 | 61–67 → 28–31 | 110–115 → 89–90 | 12.9–18.5 |
| Phase 2 | phase 1 → phase 2 | 5.9 → 6.5 | 27.6–28.2 → 32.0–33.7 | 88.3–89.0 → 80.5–83.0 | 7.9–9.0 |
| Phase 3, interleaved | phase 1 / phase 2 / phase 3 | 5.52–5.64 / 5.90–5.94 / 3.30–3.31 | 26.4–26.5 / 31.2–31.3 / 24.3–24.7 | — | 4.7–5.7 |
| Phase 5 (first freeze, 11:52Z; superseded), interleaved | phase 3 / phase 5 | 3.29–3.33 / 3.84 | 24.7–25.1 / 19.3–19.5 | 68–69 / 26 | 6.6–10.2 |
| Phase 5b (re-frozen 13:20Z; superseded), interleaved | phase 3 / phase 5b | 3.22–3.31 / 3.80–3.84 | 23.6–24.1 / 22.2–22.6 | 67–68 / 29 | 3.6–4.3 |
| **Phase 5d (frozen sim v3, 15:22Z)**, interleaved | phase 3 / phase 5d | 3.20–3.22 / 3.93 | 23.6–24.3 / 21.9–22.0 | 65–66 / 27–28 | 4.5–4.8 |

- Phase 1 counted 182–188 of 270 calls over 8 ms before and 106–107 after.
- Every speed-up was checked exact: 732 of 732 cases bit for bit against the reference (phases 1, 3, 5, 5b and 5d).
- Phase 5b's p90 is about 15% over phase 5 alone: that is the cost of continuous admission (a proven bound on every
  lattice interval, with bisection where it is unproven). It stays within the +10% guard against phase 3 in the same
  runs (`phase5/5b-guards.json`).
- Phase 5d corrected that admission bound to an upper curvature bound, at a cost of about 10% of p90, and solves a
  capped stroke's face for the speed it plays. Its p90 of 21.9–22.0 ms is the figure for the frozen simulation v3
  (`phase5/5d-evidence.json`).
- **Where it runs.** Since 2026-11-03 the live ball's `resolveDelivery` runs in the work thread
  (`docs/ARCHITECTURE.md`, "The work thread"), so this cost no longer stalls frames during the live ball: builder-measured,
  0 main-thread physics calls in the live ball on every tier, and the longest live frame gap fell from 32–54 ms to
  18–21 ms on the desktop (`release/product-sequence/stage-1-practice/wedge/worker/REPORT.md` §3). The result must still be in hand before the physical contact;
  the tightest margin measured with hooked swings was 8.4 ms. That browser evidence predates the frozen physics.
- In the browser the worker's own compute was p50 5.7 / p90 18.0 ms against 5.8 / 17.4 ms on the main thread, on the
  04:19Z snapshot's physics (`release/product-sequence/stage-1-practice/wedge/worker/REPORT.md` §3).

### 5.7 The result-arrival frame at Lite 4× (PERF-2, 2026-11-07)

Builder-measured, not evaluator-verified; Chromium 156 on Metal, 915×412 at 2.625×, Balanced Lite, every ball swung, `scripts/perf/practice-frames.mjs`; the shared machine's load was 1.5–4.2; no phone: **UNPROVEN**.
"Before" is the tree of 2026-11-07T07:21Z (build 4a376ae+fd062ec8b284); "after" adds PERF-2's five source files (the resumable gaze scan, the generator form of `buildPracticeScript`, the idle order and `warmResult`).
Evidence: `release/product-sequence/stage-1-practice/wedge/perf/PERF-2/PERF-2-INDEX.txt`.

| Gate (4× CPU unless noted) | Before | After | Verdict |
| --- | --- | --- | --- |
| `play()` frame median (ms), n = 60 per run, two runs | 50.0 | 33.4 | met, thin: 55% of frames take two frames or fewer; one run split 15/15 (41.7) |
| Frames over 100 ms, n = 60 | 0/60 (worst 99.9–100.0) | 0/60 (worst 83.3) | met (n = 120: 2 → 0; frames over 50 ms 62 → 17) |
| First delivery after load, 8 fresh pages | worst frame 116.7–133.4 ms, 8/8 over 100 | 50–83.4 ms, 0/8 over 100 | met |
| 6× CPU, 30 deliveries × 2 runs: deliveries with a frame over 100 ms | 8/30 and 6/30 | 2/30 and 3/30 | **not met** (gate ≤ 1/30); what is left are camera-cut-window frames and first deliveries |
| CTL1 p95, 1× CPU, Lite | 49.9 / 50.2 | 44.8 / 50.9 | equal to before: the same build varies by ±3 ms from run to run, so a strict ≤ 50 cannot be shown on this harness |
| What the player sees | | 456 deliveries × 8 digests: 0 differences | unchanged |

Where the time went (unminified profile at 4x, mean per result frame; the profiler inflates by about 1.6x): the result's hand-over gaze (`prewarmPracticeGaze`) 19.6 -> 2.3 ms; `play()` 53.9 -> 35.1 ms; the whole frame 99.2 -> 77.7 ms.
Still there after PERF-2: `strideGoverned` 17.7 ms in the message task (the FootPlan's first pose 9.1 ms, then 74 poses at 0.1 ms), about 14 ms in the first draw (14 actors' plans from t = 0) and, at 6x, the striker's whole reach plan in the camera-cut frame (85 ms of a 102 ms frame).
**PERF-3 (2026-11-07), indicative until the I1 window.** Three changes, none visible to the player (456 deliveries x 8 digests and 456 x 15 actors' poses bit-identical):
(1) `forwardKinematics` works out only the bones a change reaches (`Joints.from`); it was 45% of the result path (47% of that inside the pelvis trials of the reach plan).
(2) The striker's stride decision is no longer made in the message task: his `moves` and `physicsBody` wait on it (`PracticeInfo.stride`), the stage makes it in spare slices on the script's own planted-feet hook, whose plans the frames then use, and a read of either makes it whole first.
(3) The reach plan is worked out on demand: a frame makes the samples about its time, the stage warms from the camera cut on, and a script that never cuts (a miss, a leave, a pad) builds none.
Node, 1x, hot, medians per swung delivery (loads 2-5, Unity not excluded): the script build in `play()` 5.98 -> 2.24 ms; the reach plan 20.7 -> 10.6 ms; a cut frame with nothing prepared 21.0 -> 12.7 ms; the first draw 3.94 -> 3.86 ms (unchanged).
Browser, Lite (Unity overlap not excluded, loads 2-6): 4x n=12, a result-arrival frame of at most 2 frames 11/12 (the base in a run overlapped by Unity: 11/30, median 50 ms); 6x n=15 each: result-arrival frame median 83.4 -> 50.0 ms, deliveries with a frame over 100 ms 2/15 -> 0/15, cut-window worst frame 100 -> 33.4 ms.
Size: the initial `index.js` is unchanged (376,552 B raw); the lazy chunks grow by 2,315 B raw / 855 B gzip.
Still open: the first draw (about 24 ms at 4x: 12 step plans and two foot plans integrated from the start), the message task's fielders (4.0), non-striker (3.1) and bowler's run (2.2 ms), and the idle budget (`session.ts`: min(4 ms, 12 ms - draw) a frame, about nothing at 6x in steady state).
The warm-up's effect on the time to the first playable ball, and every PERF-3 timing, is re-measured in the integration pass (`release/product-sequence/stage-1-practice/wedge/perf/PERF-3/i1-timing.sh`).

## 6. Accessibility verification

`tests/e2e/a11y-practice-screens.spec.ts` walks every Practice screen through the real UI, at 640×360 (the smallest
supported landscape phone), with landscape safe-area insets emulated (`Emulation.setSafeAreaInsetsOverride`: left
44, right 24, bottom 20 px). The screens are:

- the Practice home (the launch screen since Stage 1);
- the over editor;
- the setup with its field map;
- the live status strip;
- the results layer, compact and expanded;
- the expanded setup between balls;
- Coach Mode;
- mastery after an exact-ball attempt;
- the over summary;
- settings.

It runs in English, Hindi and Hinglish, at normal text and at 1.3× text with high contrast and reduced motion; and at
200% text in English and Hindi. On each screen it checks:

| Rubric | Check | How |
| --- | --- | --- |
| A11Y3 | axe | WCAG 2.0/2.1/2.2 A and AA rules. Serious and critical violations fail; the rest are reported |
| A11Y3 | Outcome announcements | The polite live region's changes, timed against the phase log, must never fall while the ball is live |
| A11Y7 | Touch targets ≥ 48 dp | Every visible control's hit area is probed with `elementFromPoint` 24 px either side of its centre, so an invisible enlarged area counts; inline links in running text are exempt. The brief's floor is 44 px |
| A11Y1, U3 | No truncation | Text clipped by its own box (ellipsis, hidden overflow, line clamps), and text or controls cut off by the viewport where nothing scrolls |
| A11Y1 | 200% text | The app's own root scale (`--text-scale`, which sizes `html`) at 2, beyond the settings' 1.3 |
| U3 | Landscape safe areas | No control or text in the inset bands, unless it sits in scrollable content that can be brought out of them |
| A11Y6 | Colour-safe status | Every `data-tone` status also has words |
| A11Y4 | Reduced motion | No running CSS animation or transition longer than 0.2 s |
| U6 | High contrast | No translucent blurred surface (`backdrop-filter`) remains |
| A11Y2 | Keyboard | Tab reaches every visible control (radio groups take one stop), with no positive tabindex and a visible focus ring. Skipped mid-delivery, where only pause is meant to be operable |

`tests/e2e/a11y-practice-captions.spec.ts` (A11Y5) checks two things. With captions on, a delivery's essential cues
appear as words in the status strip area, never over the play. With captions off, nothing is captioned.

The findings go to the UX workstream with the file and selector ([§8](#8-findings-raised)). This workstream edits no
UI file.

## 7. Android (emulator)

- Command: `BOOT=1 HOOKS=1 scripts/android-practice.sh <out> --perf [--recheck] [--deliveries 6]`, with `CORES=2` for
  reduced cores.
- Boot: `vybe-pixel-api36-arm64`, headless (`-no-window`), `-gpu host`, a cold boot with no snapshots, 2 GB RAM.
  Android 16 (API 36), WebView 133.0.6943.137.
- Install: the app goes on with `adb install -r` only. App data is kept: never `pm clear`, never uninstall.
- `--recheck` removes only the cached device check (`vc:practice:perf`), as Settings' "check again" does, so the check
  runs on this boot's CPU count.
- Each delivery is batted with a real `adb shell input tap`, through Android's own input pipeline.
- The recorder runs inside the WebView, and `dumpsys gfxinfo` is reset at each run-up.

| Run (HEAD 38924bd, debug, read-only test API) | Result |
| --- | --- |
| 4 cores, cached device check (Below, 41.5 fps, so Classic) | All checks pass: launch, landscape (ROTATION_90), a real tap resolved, HOME mid-delivery then pause and a leave, kill mid-delivery then resume with a leave, logcat clean. Six Classic deliveries ran at 55.9–60 fps in the WebView, with gfxinfo p95 of 23 ms and 0–7 janky frames each. HOME between balls mid-over and back left the innings key unchanged, and the next ball resolved. In airplane mode three balls resolved and no request left the app's own origin |
| 4 cores, fresh device check | Full at **Lite** (56 fps, `lite_rerun`, event-to-frame 26.2 ms, shaders 1085 ms cold): **Balanced** on the first-person stage. Deliveries mostly ran at 54–60 fps (p95 16.7–33 ms). Delivery 1 linked **5 shader programs** (F-017). The first delivery of a new innings ran at **22 fps**, with 17 frames over 50 ms and a worst frame of 300 ms (F-018). The first innings kept its **MSAA** context at Lite. Airplane mode: three balls resolved, and no request left the origin |
| 2 cores | No result. With the host's load average at 100–130, the app answered no tap for two minutes, so the run measured the machine; it was stopped. To be repeated in the quiet window |

The emulator translates OpenGL ES to the Mac's GPU, and its 2 or 4 vCPUs share the Mac with the GPU translation. Its
frame rates say nothing about a Mali or Adreno phone ([§9](#9-physical-device-tests-still-required)).

## 8. Findings raised

Each finding went to its owner, with evidence and a proposed fix, and was copied to the lead. Status is as of the last
update of this document.

| # | Finding | Evidence | Owner | Proposed fix | Status |
| --- | --- | --- | --- | --- | --- |
| P1 | The ball trace differs by tier (READ3 ★). Lite and Standard draw 5 samples at α 0.30; High draws 6 at α 0.32; Classic is hard-coded at 6 × 14 ms with a linear falloff | `core/quality.ts` PRACTICE_PROFILES; `three/ball.ts:147`; `fallback2d/batterView.ts:206–220` | presentation | One exported ball-style constant read by all three profiles and the 2D view, with a unit test | The lead ruled it must be identical; open |
| P2 | MSAA is fixed at mount. A session whose check ends at Lite keeps 4× MSAA, about 40 MB more drawing buffer (est.) | Emulator context log: 1726×720 with antialias true for the first innings, false for the next | presentation | Rebuild without MSAA before ball 1 when the verdict is Lite; after a later step-down, rebuild at the next over | open |
| P3 | The swing's resolution runs in the gesture task at contact: 46–51 ms at 4× and 65–87 ms at 6× (LoAF), 142 ms in the first unminified profile | `practice-frames.mjs` LoAF; `practice-profile.mjs` | physics, UX | Warm the resolve paths during setup now; move resolveDelivery to a Worker as the structural fix (physics prefers this) | Done by the WORKER track on 2026-11-03, builder-measured on the desktop ([§5.6](#56-physics-cost-per-delivery-resolvedelivery-2026-11-03)); phones UNPROVEN |
| P4 | three.js skins each player mesh on the CPU for its bounding sphere the first time it is drawn, mid-delivery: `applyBoneTransform`, 53 ms at 6× | CPU profile; stack: projectObject, render, drawFrame | presentation | Give each SkinnedMesh a precomputed bounding sphere (`players.ts` around line 430) | open |
| P5 | A new stage per innings recompiles shaders and repeats the first-render costs. The first ball of a new innings ran at 22 fps (worst frame 300 ms) on the emulator | Context log; the emulator run | UX | Keep the stage across innings | lead's F-018; UX now keeps the stage across innings |
| P6 | Shader programs are compiled inside deliveries: after Standard → Lite (5 on the emulator, 16 on SwiftShader), and 4 at the first run-up on the working tree, which HEAD did not do (a 133 ms frame on Metal) | Timestamped `linkProgram` calls against the phase log ([§5.4](#54-shader-compilation-during-a-delivery-perf4)) | presentation | Make prewarm cover everything a delivery draws, and rerun it after every profile change | lead's F-017; open |
| P7 | With the network gone mid-session, a new innings hung on "Getting the ground ready…": the Classic stage chunk is fetched lazily | Diagnostic run: `Fallback2DPracticeStage-*.js` and `topDown-*.js` failed with net::ERR_FAILED | UX (error state), presentation (preload) | A calm error with Try again (done); preload the 2D module after the 3D mount | UX fixed (a); (b) open |
| P8 | High supersamples on small screens. At 640×360 and 2×, High renders 900 px for a 720 px panel | `practicePixelRatio`: the High band's minimum is 900. Code reading only, to be confirmed by the drawing buffer the 640×360 run records | presentation | Cap the internal height at the native height | low priority; open |
| P9 | The machine's load made timing meaningless at times (a 1-minute load of 264) | `uptime` in every record | lead | A quiet window for the evidence runs | granted |
| P10 | A11Y7: field-map targets on setup under 48 dp: fielder labels 17–18 px tall, gaps 25–28 px wide | a11y journey, all 8 variants | UX | A hit area of at least 48 × 48 per tappable fielder or gap, or one map control with a list | open |
| P11 | A11Y3, axe serious: label-content-name-mismatch on the status strip's conditions button (`practice-conditions`). The visible "Balanced · New ball" is not in its name "Conditions: Balanced pitch, New ball…" | axe on the results layer, Coach Mode and mastery, all variants | UX | Build the name from the visible strings, plus extra text in aria-describedby | open |
| P12 | U2: the status strip cannot be tapped between balls, because the stage canvas intercepts the pointer | Playwright: `<canvas data-testid="practice-canvas">` from `<div aria-hidden="true" class="_stage…">` intercepts pointer events | UX | The HUD above the stage for hit-testing, or `pointer-events: none` on the stage wrapper | open |
| P13 | A11Y7: "Watch the dismissal" (`practice-replay-dismissal`) is 200×44 px | a11y journey | UX | min-height 48 px | open |
| P14 | A11Y5: with captions on, none was ever shown, because the stage's default sink was not the captioning sink | Captions spec; a MutationObserver on `practice-captions` | audio (with the lead's approval in render3d) | The default sink is now `createPracticeSink`; the captions gate reads the stored setting, so captions work muted and before the audio unlocks | fixed; both specs pass |
| P15 | `play(result)` now builds the result's camera gaze on the main thread: p50 6.4–6.9 ms (at a load of 16–18) against 1.2–1.5 ms before, and `bowl()` p50 1.8–2.1 ms. Both run outside frames; `drawFrame` maxima stay below the earlier camera's | `release/product-sequence/stage-1-practice/wedge/camera/REPORT.md` addendum 2 | presentation | Build the result's gaze in the work thread (R-C1) | Deferred by the lead to the Track E performance evaluators and the I1 Android run, as a measured risk; in the not-now register |

## 9. Physical-device tests still required

Nothing in this document was measured on a phone. Each item below is open until it has been run on real devices from
the classes in `docs/PRACTICE.md` §9 (legacy 3 GB PowerVR; 4 GB Mali-G52/G57; 4–6 GB Mali-G68 or Adreno 610/619;
6–8 GB Adreno 642L/710; a 120 Hz flagship). Record the device, Android version, OEM skin, GPU, refresh rate, the
diagnostics screen's numbers and the date.

| # | What only a phone can show | Why the desktop or emulator says nothing | How to run it |
| --- | --- | --- | --- |
| D1 | **PERF1 on mobile GPUs**: p95 and p99 per tier over ≥ 30 deliveries, and the 100 ms rule, on Mali, Adreno and PowerVR | The M1 Pro GPU is never the bottleneck here; the emulator translates GLES to it | The debug build with `HOOKS=1` and `scripts/android-practice.sh <out> --perf --deliveries 30` against a USB-attached phone (the same recorder and gfxinfo) |
| D2 | **The device check's verdict**: which tier each class earns, and whether a 3 GB phone reporting 2 GB is held at Lite | `navigator.deviceMemory`, GPU strings and frame rates differ per phone | The diagnostics screen after a fresh install; `--recheck` |
| D3 | **Input to photon** (CTL1 end to end): touch digitiser, Android's input pipeline, the WebView and the display | The stage times event to submitted frame; desktop CDP touches skip the digitiser, and headless has no display | A 240 fps camera filming a finger tap and the bat, ≥ 50 swings per tier; compared with the stage's `lastInputToBatMs` |
| D4 | **Thermal step-down over ten overs**: the monitor's decisions and the per-delivery fps as the phone warms | Desktops do not throttle like phones | Ten overs on each class, reading the diagnostics' recent fps each over |
| D5 | **Shader compile time on mobile drivers**: the cold first launch and the time to the first ball (≤ 10 s target) | ANGLE/Metal compiles 28 programs in about 50 ms warm; Mali and Adreno drivers are far slower when cold | A fresh install, the time from the Practice tap to the first ball |
| D6 | **Memory pressure on 3 GB phones**: High with MSAA holds about 100 MB in its drawing buffer alone ([§5.5](#55-memory-and-a-long-session)); is the app killed in the background? | Desktop memory is unlimited; the emulator has 2 GB but a host GPU | HOME for 5 minutes with other apps opened, then return; `dumpsys meminfo` |
| D7 | **Refresh rates and battery savers**: 90/120 Hz pacing; OEM savers that cap the WebView at 30 fps must land on Classic, not stutter | Headless renders at a synthetic 60 Hz | Each class with the saver on and off |
| D8 | **TalkBack and system font size**: outcome announcements in order, and 200% system font through the WebView's text zoom | Headless has no screen reader; the desktop 200% check uses the app's own root scale | TalkBack on, then font size at maximum |
| D9 | **The orientation lock on Android 16 large screens** | The emulator is a phone profile | A foldable or a tablet |
| D10 | **The work thread on phones** (2026-11-03): the swipe-to-result margin with real swipes, the worker's memory (one more isolate and up to 4 kept results), and CPU contention while the coach reads | Only hooked swings were measured, on an M1 Pro with spare cores | Real swipes on each class, with the stage's timing log, `dumpsys meminfo` and frame pacing during the reading (`release/product-sequence/stage-1-practice/wedge/worker/REPORT.md` §7) |
