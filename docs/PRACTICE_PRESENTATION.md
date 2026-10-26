# Practice presentation: first-person stage, camera and input

Owner: the presentation workstream (`src/render3d/**`, `src/input/**`). The rules of Practice, the physics and the
screens are documented elsewhere (`docs/PRACTICE.md`, `docs/PRACTICE_PHYSICS.md`). This document specifies how a
delivery is shown and how a swing is read. Nothing here decides an outcome: the stage draws what
`src/physics` returns, and the input model produces one `NormalizedSwing` for the physics.

## Pipeline and the one implementation per concern

```
pointer / key events ──▶ src/input GestureTracker ──▶ GestureInput ──▶ normalizeGesture ──▶ NormalizedSwing
        │ (event timestamps)                                                                    │
        └─▶ onSwingStart ─▶ PracticeStage.beginSwing (provisional bat, same frame)               ▼
                                                                         src/physics resolveDelivery
BallFlight (fixed before the batter acts) ─▶ PracticeStage.bowl            │
DeliveryResult ─────────────────────────────▶ PracticeStage.play / replay ◀┘
```

| Concern | The one implementation |
| --- | --- |
| Input (touch, mouse, pen, keyboard) | `src/input` (`GestureSurface`, `GestureTracker`, `normalizeGesture`, `calibrationFromTaps`) |
| 3D scene (stadium, players, ball, stumps, effects) | `src/render3d/three/stageScene.ts`, shared by the match renderer and the Practice stage |
| Camera director | `src/render3d/core/camera.ts`: match shots and Practice shots (`batter_eye`, `practice_stumps`, `replay_*`) |
| Choreography model | `src/render3d/core/choreo.ts` `BallScript`; Practice builds it from physics data (`practice/script.ts`) |
| Every ball flight (match replays, live balls, Practice) | `src/physics`; the match reaches it through `src/render3d/core/trajectory.ts` (see "Match balls through the physics") |
| Replay timeline | `src/render3d/core/timeline.ts` `replayTimeline`: one progressive object shared by the reveal screen and the renderer |
| 2D presentation | `src/render3d/fallback2d/topDown.ts` (match fallback and Classic Practice), plus `batterView.ts` |
| Cricket geometry | `src/physics/geometry.ts`, re-exported by `src/render3d/core/ground.ts` (pitch, creases, stumps, ball, rope, ring); the stadium shader and both 2D painters draw the creases from it |
| Bat model | `props.createBat` built from `BLADE_L`, `BLADE_W`, `EDGE_T` and `HANDLE_L`; hands at `HANDS_FROM_TOP` |
| Device classification | `src/perf` (the stage only measures: `benchmark` returns raw frame intervals) |
| Sound and haptics | `src/audio` (the stage schedules them; `practice/audio.ts` maps each feel to existing voices and patterns) |

## Stage API (`src/render3d/practice/types.ts`)

`createPracticeStage({ force2d? }): Promise<PracticeStage>` from `@/render3d`. It loads the 3D stage (three.js) only
when WebGL 2 works and `force2d` is not set; otherwise it loads Classic 2D. Both stages implement the same interface:

| Member | Behaviour |
| --- | --- |
| `mount(canvas, { profile, handedness, reducedMotion, learnCue })` | Creates the renderer, builds every player and compiles every shader up front, then starts the frame loop. 3D failure: throws and emits `fallback`. Give a 2D stage a fresh `<canvas>`: a canvas that had a WebGL context has no 2D context. |
| `setScene({ field, bowler, conditions, handedness })` | Field in the batter's frame (as `autoField` returns it); the scene between balls. |
| `bowl(flight)` | Run-up and action; resolves `{ releasePerfMs }` at the scheduled release (a timer, not a frame). `releasePerfMs()` is known at once. |
| `beginSwing(atPerfMs, calibrationMs = 0)` | The provisional bat moves from the next frame. `atPerfMs` is the raw event timestamp. |
| `play(result)` | Draws the result: bat, contact, ball, fielders, running, then the external camera. Resolves at dead ball. |
| `replay(result, { speed = 0.3, diagnostics = true, camera = 'side', assist?, tierToleranceMs? })` | Slow-motion diagnostic replay. `assist` draws the timing window the delivery was judged by. |
| `setProfile(id)` | Applies on the next frame between balls; queued during a live delivery and applied at dead ball. |
| `benchmark(ms)` | Plays the benchmark scene and returns raw `frameMs`, `shaderCompileMs`, `contextLosses`, `renderer`, `webgl2` and `hardware` (from `@/perf`). |
| `stats()` | `fps`, `avgFrameMs`, `p95FrameMs`, `spikes` (via `@/perf` `frameStats`), `lastInputToBatMs`, `renderer`, `profile`, `drawCalls`, `contextLosses`. |
| `on('contextlost' \| 'contextrestored' \| 'fallback')` | `fallback` after 3.5 s without a restored context, or after three frames in a row throw. |
| `setSink(sink \| null)` | Audio and haptics; defaults to `src/audio`. `null` mutes the stage. |
| `simToPerf(t)`, `perfToSim(ms)` | The delivery's timebase. |
| `setTimeScale(k)` | Test hook only (simulation seconds per real second). |
| `dispose()` | Settles every pending promise quietly (never rejects) and releases the GPU context. |

## Camera specification

### The batter's eye (live, from the start of the run-up)

- **Position.** From the physics stance head (`batterBody(null).head`, `src/physics/bat.ts`): the eye is 6 cm above the
  head's centre, 1.68 m above the crease (always clamped to the brief's 1.65–1.75 m), 0.2 m to the batter's leg side of
  middle stump, 1.2 m in front of the stumps. A left-hander's eye is the mirror image (+0.2 m). The camera stays
  there for the whole delivery whatever the footwork: no bob, no lunge, no shake.
- **Field of view.** A constant 54° vertical in landscape; narrower screens widen it so the horizontal view stays at
  least 70°, capped at 75°. It never zooms.
- **Gaze.** Before release, the release point sits 14° above the centre of the view. The bowler's run-up, action and
  hand are in the upper part of the frame, with the pitch below. After release the gaze follows the ball as it was
  35 ms earlier, so it is causal, never ahead of the eyes.
  - **Gain.** 0.72 (0.35 with reduced motion). The weight ramps with the ball's distance from the eye, 19 m → 9 m,
    never with time, so the gaze carries no timing cue.
  - **Rate.** Limited to smooth pursuit (150°/s).
  - **Head-follow.** After contact the gain rises to 0.8.
  - **Determinism.** The gaze is integrated on a fixed 4 ms grid from release and cached per script, so live and
    replay frames are identical.
- **No cut** from the start of the delivery until after contact or a miss: one `batter_eye` cue covers it (unit test:
  every frame is `batter_eye` and turns at most the pursuit limit).
- **Hidden.** The batter's own body and head are never drawn in first person.

**Geometry note.** The physics contact planes are 1.05–2.9 m in front of the stumps and the head is 1.2 m in front of
them, so the ideal contact is almost directly under the eyes, about 75° below the line to the bowler. No forward view
on a phone frame can show the instant of contact. With this gaze, measured on real `flight()` deliveries:

- the ball stays in view from release until 18–45 ms before contact at pace (about 0.7–1.7 m out);
- for spin it stays in view until 3–6 ms before contact;
- the bounce sits 55–77% down the frame for good to full lengths;
- the release sits about 26% from the top.

A unit test enforces "in view until at least 60 ms before contact". The contact itself is shown by the edge flash
(below), the sound and the haptic, and in the diagnostic replay.

### After contact

| Delivery | Camera after first person |
| --- | --- |
| Bat (middle or edge) | Head-follow for 450 ms, then the fielding chase camera (`fielder_follow`); `broadcast_end` with reduced motion |
| Bowled | First person holds 160 ms after the stumps break, then `practice_stumps`: low, in front and square of the striker's wicket on the batter's off side (mirrored for a left-hander). The broken stumps and the ball are central; the keeper (standing up to spin) is clear behind, the batter clear to the side. |
| Leave, miss, pad | First person to the end |

**Occluders.** No external shot shows a player in its near foreground. `occludingActors()` lists any actor capsule
(radius 0.38 m, 0.05–1.9 m tall) within 1.5 m of the lens inside its view. The 3D stage hides those actors, and a unit
test proves the director's own dismissal and fielding shots have none: right- and left-handers, pace and spin, with the
keeper standing up.

### Replay cameras

`replay(..., { camera })`: `side`, the default, is a fixed three-quarter view from the off side in front of the batter
showing the incoming path, the bat path and the contact. `behind` looks from behind the bowler's arm (line, swing,
turn), `top` is an overhead of the batting end (directions), and `batter` is the first-person eye with the same gaze.

## First-person bat and gloves

The drawn bat is the physics bat (`DeliveryResult.bat`). Before the result arrives it is a provisional straight-bat
swing from the press (below). A side-on stance holds the hands below and beside the eyes, outside any phone's view, so
the brief's "gloves and part of the bat visible" and "visible bat response" need a presentation aid. It works like the
enlarged ball:

- While the batter waits and early in the swing, the first-person bat is drawn at **true pose + w × (READY − STANCE)**,
  at a fixed bat length. READY puts the gloves in the lower corner of the view (the right corner for a right-hander),
  with the blade angling up and out of the frame.
- `w` is 1 while waiting and falls to exactly 0 between 20% and 80% of the swing's travel (`batTravelMs`). From before
  the hitting area to the follow-through, the drawn bat is the physics bat.
- External cameras and replays never use it: they place the physics bat exactly (`placeBatSpan`) and the batter's hands
  reach for it with IK.

**Edge flash.** When a bat, edge or pad contact is outside the view, which is the usual case in first person, its flash
is drawn at the bottom edge of the view at the contact's horizontal screen position. It is keyed to the contact's
scene time, like its sound.

## Input mapping (`src/input`)

`GestureSurface` covers the lower part of the landscape screen (`heightFraction`, default 0.46, measured up from the
bottom), so the finger is never over the delivery. It sets `touch-action: none`, takes pointer capture, reads each
event's own `timeStamp`, and reads coalesced pointer events. Nothing waits for pointer-up. Samples are dropped once the
gesture is emitted; they are never stored or sent.

| Constant (`src/input/constants.ts`) | Value | Meaning |
| --- | --- | --- |
| `MOVE_THRESHOLD` | 4% of the surface's shorter side, 7–18 px | Movement that makes a press a flick |
| `TAP_DECIDE_MS` | 50 | A press that has not crossed the threshold by then is a tap |
| `READ_WINDOW_MS` | 40 | Direction, speed and length are read over this much movement |
| `READ_GRACE_MS` | 25 | A flick that stops moving is emitted this long after the window |
| `ONSET_SPEED_PX_PER_MS` | 0.08 | Speed that marks the start of an intentional movement |
| `POWER_SPEED` | 1.2 → 9 surface lengths/s | Linear to power `ATTACK_MIN_POWER` (0.12) → 1 |
| `DEFEND_POWER` | 0.2 | A tap's fixed bat speed |
| `ELEVATION` | ground 0–0.3, lofted 0.45–1 | By length 0.06–0.32 of the shorter side (see below) |

**States.**

| Input | How it is read |
| --- | --- |
| Armed press | Pointer-down: swing start, reported at once through `onSwingStart`. Not beyond the threshold within 50 ms, or lifted without moving: a **tap**, the defensive straight bat. Beyond it: a **flick**, emitted when samples cover 40 ms of movement, at pointer-up, or 25 ms after the window if the finger stopped. |
| Resting finger | A finger already down when the surface is enabled. Only its first intentional movement starts a swing, never a tap. Lifting a resting finger is not a shot. |
| No input | A leave (the caller passes `swing = null`). |

**Mapping.** All times are performance-clock milliseconds and all distances CSS px.

- `startT = (start − calibrationMs − releasePerfMs) × timeScale / 1000`. Here `start` is the pointer-down, or the
  onset of a resting finger's movement, or the key's timestamp.
- **Direction.** `atan2(dx, −dy)` over the first 40 ms of movement: screen-up is 0 (straight) and toward screen-right is
  +. A right-hander's off side is screen-right; a left-hander's direction is mirrored (−).
- **Power.** The flick's average speed over the window in surface lengths per second, mapped linearly from 1.2 → 9
  onto 0.12 → 1.
- **Elevation.** The window only sees about 40 ms of a flick, so length is read as "did it end or keep going". A short
  flick, lifted or stopped inside the window, stays along the ground: 0–0.3 by length. A long flick, still travelling
  at the window's end at ≥ 50% of its average speed, is lofted: 0.45–1 by length.
- **Rounding.** `startT` to 0.1 ms, direction to 0.1°, power and elevation to 0.001. No −0 is ever produced.

**Keyboard.** Keys are listened to on the window while the surface is enabled, and never from text fields.

| Key | Effect |
| --- | --- |
| Space, Enter | Defence, with exactly the same start rule and bat travel as a tap (unit test: a key at t equals a tap at t). Auto-repeat is ignored. |
| W, ↑ | Forward; pressed twice within 350 ms, down the track |
| S, ↓ | Back |
| The off-side arrow (D or → for a right-hander, A or ← for a left-hander) | Across |
| The leg-side arrow | Automatic again |

Footwork chosen this way applies to that one delivery and overrides the on-screen `footwork` prop.

**Calibration.** `calibrationFromTaps(errorsMs)`, where each error is the tap's timestamp minus the ball's
line-crossing time (+ means late). Attempts with |error| > 300 ms are rejected; the result is the median, clamped to
[−60, 220] ms, as `{ offsetMs, attempts }`. Store it per pointer type: a keyboard has less latency than a touch screen.

## Reaction time and latency

- **Timebase.** `bowl()` fixes `startPerfMs`, the release's scene time and the time scale. Every frame draws the
  simulation at its own timestamp: `perfToSim(frameTime)`, never a frame count. Timers resolve the promises, so they
  keep time without frames.
- **Swing start.** The swing starts at the event timestamp minus calibration (`normalizeGesture`), and the
  provisional bat starts at the same calibrated instant (`beginSwing(atPerfMs, calibrationMs)`).
- **Provisional swing.** A straight-bat downswing toward where the ball will be, taking `batTravelMs('defend', 0)`
  (120 ms) to the hitting area, with a quick start so the bat visibly answers in the next frame. When the result
  arrives (normally 40–55 ms after the press) the drawn bat blends into the physics bat within 45 ms, and is the
  physics bat from then on.
- **Late results.** With a very large calibration offset (over about 80 ms), the physics contact can fall before the
  result is known. The stage never rewinds: cues that are already due fire at once, and the ball continues from the
  result's samples.
- **Measured latency.** `stats().lastInputToBatMs` runs from the event timestamp to the moment the first frame
  showing the bat moving has been submitted (`performance.now()` after the draw).
  - On this Mac (Metal, 60 Hz) it is 15–18 ms in 3D and 9–16 ms in Classic 2D, steady state. Add one to two display
    frames for photons: about 35–50 ms in total, inside the brief's 50–70 ms.
  - The first press after a page load can take 130–460 ms: `src/audio` creates its AudioContext and noise buffer in
    the first pointerdown. In the app an earlier menu tap normally pays that cost.

## Feedback, keyed to simulation time

`practice/feedback.ts` turns each `SimEvent` into one scene event at its simulation timestamp, and the contact into one
feel. The session schedules each cue for its exact performance time, using a timer inside the frame it falls in rather
than "the next frame", so the visual, the sound and the haptic land together.

| Feel | Visual | Sound (src/audio) | Haptic |
| --- | --- | --- | --- |
| Sweet spot (middle, perfect) | Bright flash and sparks | Bat crack and bright ring | Firm pulse plus a beat (`double`) |
| Middle | Flash | Bat crack and ring | One medium pulse |
| Edge | Small flash | Thin edge click | One short tick |
| Pad | Grey puff | Pad thud | Light tap |
| Miss | — | Swish | None |
| Bowled | Stumps and bails fly, LED flash | Stumps, bails, roar | Heavy |
| Catch | Gold ring at the hands | Catch, roar | Heavy |
| Four / six | Boards flash, six fireworks | Roar and drums | Success |

The stage owns these. The UX controller plays no bat or edge sound or haptic of its own.

## Readability

- **Ball.**
  - Drawn 22% larger than its collision radius (`visualScale` 1.22 in every profile).
  - A dark outline (inverted hull) against the tan pitch and the dark sight screen.
  - A ground shadow, crisp low and fainter high.
  - A soft glow and a short, faint, thin trace (5–6 samples × 14 ms).
  - The seam turns about the physics spin vector (`BallFlight.spin`, release then after the bounce), at a readable
    rate capped at 6 rps for pace and 8 for spin.
- **Pitch mark.** Practice uses a brief low dust puff where the ball pitches. The match's growing ring would mark the
  landing spot through the batter's decision.
- **Learn landing cue.** Only with `learnCue`: a green ring at the pitch point from release until just after the bounce.
- **Sight screens.** Dark sight screens stand behind both ends (the stadium already had them).
- **Bowler.** One action per bowler for the whole over (pace long or short run, side-on for controlled pace,
  off-spin, leg-spin). The run-up and arm speed never change, so the delivery is not announced. Legitimate cues live in
  the hand around release: about 260 ms before to 220 ms after, on the right-arm bones before a left-arm bowler is
  mirrored.

  | Variation | Release cue |
  | --- | --- |
  | Outswing, inswing | Wrist angled to ∓16° |
  | Cutter | Wrist cocked 24° |
  | Slower ball | Hand rolled 58° |
  | Bouncer | Back arched, wrist back |
  | Yorker | Wrist flicked down |
  | Finger spin | Rip; a flighted ball has the fingers under it, a quicker one is flatter |
  | Wrist spin | Rip; the googly shows the back of the hand |

  Release height and side come from the physics release point. The bowler's root is placed so the bowling hand, measured
  on the bowler's own rig at the release marker, is at `release.p`. A left-arm bowler is drawn left-armed.

## Quality profiles

| Profile | Internal height | DPR cap | Shadows | Crowd | Player LOD | Particles | Trace |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lite | 540–720 | 2 | none (blob shadows only) | 1400, static | 9 m | 0.25 | 5 |
| standard | 720–900 | 2 | key light, 1024 | 3600, animated | 22 m | 0.8 | 5 |
| high | 900–1440 | 2.5 | key light, 2048, light shafts | 6500, animated | 40 m | 1.2 | 6 |

- **Pixel ratio.** `practicePixelRatio` holds the drawing buffer's shorter side inside the band (and under the cap),
  so a high-DPR phone is never rendered at a resolution nobody can see. Every profile runs at 60 fps; readability
  settings are the same in all three. MSAA is fixed when the context is made: lite starts without it.
- **Benchmark.** `benchmark(ms)` plays the real scene (the bowler running in and bowling, the field set, the batter's
  eye). It runs for `ms` and also until it has `PERF_WARMUP_FRAMES` + 6 frames, capped at 6 s, so a software renderer
  at 2–8 fps is still measured on real frames. `src/perf` classifies; the stage computes no tiers.

## Classic 2D (below the cutoff, or no WebGL 2)

`Fallback2DPracticeStage` implements the same interface on Canvas 2D and plays the same scripts from the same
physics data:

- **Live.** The batter's view through the same camera director, projected through a pinhole onto simple shapes: the
  sight screen, pitch and creases, the far stumps, the players, the outlined ball with its shadow and a tapered trace,
  the Learn ring, and the first-person bat and gloves.
- **After contact.** The shared top-down painter shows the field, with the side-on height inset.
- **Replay.** A steady top-down view of the batting end, with the incoming, outgoing and bat paths, the ideal and actual
  contact, and the intended and actual directions.
- **Tests.** A unit test checks that the 2D painter draws the ball at the projected position of the result's own
  sample.

## Diagnostic replay

`buildDiagnostics(result)` is pure data in the world frame, and the overlays reveal themselves in step with the replay:

- the incoming path (cyan) and where the ball pitched;
- the outgoing path (amber);
- the timing window along the path, when `assist` (and `tierToleranceMs`) is given: the bands the delivery was
  judged by (`activeBands` from `src/physics/timing.ts`), green for solid and bright for perfect;
- the ideal contact (white ring) against the actual contact (gold): that gap is the timing;
- the bat's sweet-spot path (pink), with five ghost bats;
- the bat face at contact (mint arrow);
- the intended direction (white dashes) against the actual direction (amber arrow);
- for a pad or body ball, the physics `batterBody` capsules;
- for an LBW decision, the impact, the unimpeded flight from impact to the stumps plane (red when hitting, white when
  missing), the projected point, and the stumps outline (`STUMPS_W` × `STUMPS_TOP`).

The overlays carry no text; the HUD over the canvas names things.

The replay plays from 0.9 s before release to 1.6–3.2 s after contact. Only the window from 150 ms before release to
450 ms after contact is slowed (`speed`). The stadium clock runs on replay time too, so a replay frame depends on
nothing but the result and the replay time (unit test, and an e2e test comparing pixels at the same replay time).

## Match balls through the physics

The match replay and the live ball draw no curves of their own. Every segment that moves the ball is a `'path'` of
physics samples (`BallSeg` is `'hand' | 'path' | 'gone'`); `sampleBall` interpolates them by time (binary search,
since the delivery samples every 1 ms and the post-contact flights every 5 ms). `src/render3d/core/trajectory.ts` is
the adapter:

- `buildFlight(path, family, releaseToContactMs, conditions)` calls `flightFromPath`: the ball meets the contact plane at
  exactly `releaseToContactMs` (the time taps are validated against), on the server's line, at the height the pitch
  allows (the fit reports it). A ball nothing touches flies on through `simulate` into the keeper's gloves, who steps
  into its line. A yorker or a full toss pitches after the contact plane, so it has no bounce event before contact and
  `times.bounce` equals `times.contact`. The seam turns about the physics' own spin axis, the release spin to the pitch
  and the spin off it after (capped at a readable rate).
- `aimPath(from, { p, mode }, opts)` calls `aimShot`. The outcome comes first: the engine has already decided where the
  ball goes, and the physics finds the launch that gets it there. The choreography is then timed from the arrival
  (`tArrive`), not from a formula:

| Fate | Physics path after the bat |
| --- | --- |
| dot (blocked or padded) | `ground` to rest just in front |
| fielded, runs | `ground`, still running at 30 km/h (stop), 50 km/h (dive) or 10 km/h (chase) when the fielder can be there in time, else rolling to rest at the spot; then a `carry` throw (6–22°, higher the longer) into the keeper's gloves |
| four | `bounce_then_rope`: along the ground (3°) or lofted, landing short (22°) |
| six | `carry` into the stands at the engine's distance (34°, then 40°, 28° and 46° if needed) |
| caught | `carry` to the catcher's hands: a skier 50–62°, an edge behind 4°, otherwise a firm low catch; the celebration toss is an 86° `carry` without spin |
| bowled | through the gate, the delivery itself until the stumps; played on, a −8° `carry` off the inside edge; then `ground` dribbling away |
| lbw | `ground` off the pad, away on the leg side |
| run out | `ground` to the fielder, a flat `carry` direct hit (4–12°), `ground` on past the stumps |

- `flyFrom(from, v, seconds)` runs `simulate` alone for the sealed live shot: only its first moments show, launched off
  the bat. Nothing in it can hint at runs or wickets.

Fits and aims are pure, so they are cached. The flight is cached per `BallPath` object, and the aims by their inputs.
A live shot rebuilding its script at the tap therefore does not fit again, and a second build of the same replay
costs about 1 ms.

### The progressive replay timeline

Ball scripts now cost real time to build, so the reveal must not wait for the whole match. `replayTimeline(log, mode)`
returns one object per log and mode, and the reveal screen and the renderer share it, so their times always agree.
At creation it builds the intro, the cards and the first ball. Every later ball is built in idle time, in order
(`requestIdleCallback`, one ball per slice or more while the browser stays idle). Until then, a ball holds a
provisional length estimated from its fate.

Any query that needs a moment exactly first builds whatever comes before it: `locate`, `scoreAt`, a pending ball's
`script`, `resultTime`, `completeTimeline`, and the renderer's `seek`, `renderAt` and `timeline()`. Its answer is
therefore always the one the complete timeline gives. Building a ball shifts only what comes after it. The playhead
is always in the exact part, and a provisional end is never treated as the end. Each build bumps `version` and
notifies `onTimelineChange` subscribers asynchronously; the reveal screen re-renders through
`useSyncExternalStore`. The scrubber is the neutral track, and the total time is shown only once the result is known,
so provisional lengths are never visible. A seek from the scrubber or the ball row completes the timeline first.
Highlights (`renderAt`, render-service) read the complete, deterministic timeline. `buildTimeline(log, mode)`
without `progressive` still builds everything at once.

## Left-handers

Physics runs in the striker's own frame (right-handed). For a left-hander the stage mirrors x → −x for every position it
draws: ball, bat, fielders, events, field layout and the eye. Bearings flip sign and spin axes become (x, −y, −z). The
batter's clips play mirrored. The bowler's body keeps its real arm, so a right-arm bowler stays visibly right-armed, and
its root is placed so that hand is at the mirrored release point.

## Measurements (this Mac: Apple M1 Pro, Chromium; viewport 844×390 CSS at 3× DPR)

| Stage, profile | Renderer | fps | p95 frame | Spikes > 50 ms | Drawing buffer | Input → bat frame (steady) |
| --- | --- | --- | --- | --- | --- | --- |
| 3D lite | Metal (hardware) | 60 | 16.8 ms | 0 | 1558×719 | 15–16 ms |
| 3D standard | Metal (hardware) | 60 | 16.8 ms | 0 | 1688×780 | 17–18 ms |
| 3D high | Metal (hardware) | 60 | 16.7 ms | 0 | 2110×975 | 16–17 ms |
| 3D lite | SwiftShader (software) | 8.3 | 217 ms | 49 of 50 | 1558×719 | 82–692 ms |
| 3D standard | SwiftShader (software) | 2.2 | 817 ms | all | 1688×780 | 388–696 ms |
| 3D high | SwiftShader (software) | 1.3 | 900 ms | all | 2110×975 | 743–885 ms |
| Classic 2D, any profile | Canvas 2D | 60 | 16.8 ms | 0 | up to 1688×780 | 9–16 ms |

Notes on the table:
- Shader compile time: 35 ms with a warm shader cache, about 1.4 s cold (ANGLE → Metal).
- `runDeviceBenchmark` on this Mac gives Full (60 fps, event-to-frame 25 ms). Under SwiftShader it gives Below
  (`software_renderer`, `fps_below_cutoff`, `frame_spikes`, `input_latency_severe`), which is correct: software
  rendering is below the cutoff, and Classic runs at 60 fps there.
- These are desktop numbers. No physical Android device was measured by this workstream.

## Tests and the dev harness

- **Unit tests.**
  - `tests/unit/input/` covers the mapping, mirroring, tap versus flick, timing from timestamps, resting fingers,
    keyboard parity, calibration, the tracker's emission rules and the React surface.
  - `tests/unit/render3d/practice.test.ts` covers eye height and offsets in the physics head, no cut and the pursuit
    limit, the ball in view to the hitting area, dismissal cameras free of occluders, physics positions drawn exactly,
    fielders on their paths, the bat blend, the hand at the release point, profiles and pixel ratios, the time
    mapping, deterministic replay frames, feel timing, the slow-device benchmark, loop robustness, dispose and Classic
    2D.
  - `tests/unit/render3d/practiceFixtures.ts` holds BallFlight and DeliveryResult fixtures for tests only, never
    imported by production code.
- **e2e.** `tests/e2e/render3d-practice.spec.ts` starts its own Vite dev server (port 5298, reloads off). On Chromium's
  default software GL it drives the 3D and 2D stages, the benchmark (Below because of the software renderer, never
  `no_frames`) and the replay determinism check.
- **Dev harness.** `src/render3d/dev/practice.html` with `practice.ts` is dev-only. It is served by the Vite dev server,
  is not a build input, and is never shipped; it is typechecked with the app. It drives the real stage on a manual
  clock for exact screenshots: `?stage=3d|2d&profile=…&hand=…&family=pace|spin&clock=manual|real&learn=1`.
  Deliveries come from the real `flight()`; until `resolveDelivery` is complete, results come from the test fixtures.

## Known limitations

- The instant of contact is not visible in first person (see the geometry note). It is shown by the edge flash, the
  sound and the haptic, the head-follow and the replay.
- The provisional swing is a straight-bat path. When the physics exports its bat track builder
  (`buildBatTrack`/`batPose`), the provisional swing will use the physics bat for a provisional tap, so a real tap needs
  no blend at all.
- The 2D bowler is a simple figure: its arm shows the delivery stride, not the wrist cues.
- MSAA cannot change after mount: a device that starts in lite stays without MSAA if it later moves to standard.
