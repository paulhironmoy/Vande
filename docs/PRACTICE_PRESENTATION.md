# Practice presentation: first-person stage, camera and input

Owner: the presentation workstream (`src/render3d/**`, `src/input/**`). The rules of Practice, the physics and the
screens are documented elsewhere (`docs/PRACTICE.md`, `docs/PRACTICE_PHYSICS.md`). This document specifies how a
delivery is shown and how a swing is read. Nothing here decides an outcome: the stage draws what
`src/physics` returns, and the input model produces one `NormalizedSwing` for the physics.

## Pipeline and the one implementation per concern

```
pointer / key events ──▶ src/input GestureTracker ──▶ GestureInput ──▶ normalizeGesture ──▶ NormalizedSwing
        │ (event timestamps)                                                                    │
        ├─▶ onSwingStart ─▶ PracticeStage.prepareSwing (ready grip, same frame)                 ▼
        └─▶ onIntent ─────▶ PracticeStage.beginSwing (committed provisional stroke)
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
| Bat model | `props.createBat` built from `BLADE_L`, `BLADE_W`, `EDGE_T` and `HANDLE_L`; ordered hand centres use the shared `TOP_HAND_FROM_CAP` / `LOWER_HAND_FROM_CAP` contract |
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
| `prepareSwing(atPerfMs)` | Raw press acknowledgement: the grip lifts at most 2 cm, then settles by 280 ms. Holding alone never swings. |
| `beginSwing(atPerfMs, calibrationMs = 0)` | The provisional stroke starts from the committed gesture intent's timestamp; a later swipe never inherits the held press's timing. |
| `cancelSwing()` | Clears unresolved ready/stroke cues and pending stroke latency, allowing a fresh intent on the same ball. Never changes a resolved result. |
| `play(result)` | Draws the result: bat, contact, ball, fielders, running, then the external camera. Resolves at dead ball. |
| `replay(result, { speed = 0.3, diagnostics = true, camera = 'side', assist?, tierToleranceMs? })` | Slow-motion diagnostic replay. `assist` draws the timing window the delivery was judged by. |
| `demonstrate(result, option)` | Coach demonstration of the option's engine-repeated `result`: the ordinary full striker rig and exact physics bat under the fixed `demo_side` camera, with a translucent teaching treatment only for this mode. Interruption restores the solid rig. |
| `closeUp(flight, { durationMs? })` | Training inspection under the fixed `ball_close` camera: the ball holds before release, then leaves in very slow motion with its physics seam/spin orientation. It never resolves or changes the delivery. |
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
  there for the whole delivery whatever the footwork: no bob, no lunge, no shake. Since 2026-11-03 the result's
  hand-over no longer jumps it: the eye stays where it is, then eases to the planted stance over 120 ms (see "A3 and
  its comfort guard").
- **Field of view.** Horizontal view stays between 70° and 75° on supported landscape screens. The vertical view is
  derived from the aspect ratio (at most 54° in landscape); a wide phone no longer expands the horizontal view to 97°.
  It never zooms during a delivery.
- **Gaze.** Before release, the release point sits 14° above the centre of the view. The bowler's run-up, action and
  hand are in the upper part of the frame, with the pitch below. After release the gaze follows the ball as it was
  10 ms earlier, so it is causal, never ahead of the eyes.
  - **Gain.** 0.9, rising to 1.0 within 8 → 2 m of the eye (owner option A3 for F-012, 2026-11-03); 0.65 with
    reduced motion, where A3 is not applied. The weight ramps with the ball's distance from the eye, 24 m → 12 m,
    never with time, so the gaze carries no timing cue. `gazeTrackWeight(distM, reducedMotion)` is
    (0.9 + 0.1·smoothstep(8, 2, d))·smoothstep(24, 12, d), the same as before at 8 m and beyond
    (`release/product-sequence/stage-1-practice/wedge/camera/REPORT.md` §1).
  - **Rate.** Limited to 300°/s on each axis; measured as a combined yaw-and-pitch rate it peaks at 424.26°/s
    (`camera/REPORT.md` §2). This camera still needs an independent comfort evaluation.
  - **Head-follow.** After contact the gain remains 0.9.
  - **Determinism.** The gaze is integrated on a fixed 4 ms grid from release and cached per script, so live and
    replay frames are identical.
- **No cut** from the start of the delivery until after contact or a miss: one `batter_eye` cue covers it (unit test:
  every frame is `batter_eye` and turns at most the pursuit limit).
- **Hidden.** The batter's own body and head are never drawn in first person.

#### A3 and its comfort guard (F-012, 2026-11-03)

The owner chose option A3 on the condition that the camera turns no faster (wedge prompt §10). Paths in this
subsection are under `release/product-sequence/stage-1-practice/wedge/camera/` (`REPORT.md` and its addenda 1–3). All
results are builder-measured on a desktop (headless Chromium on an M1 Pro, all four tiers). They are not phone results,
and no comfort or perception result is claimed.

A3 exactly as specified broke the owner's condition, ball by ball: a higher 60 fps pre-contact rate on 177 of 270 cases
(worst +8.3%) and a higher grid acceleration on 115 (worst ×2.0) (`REPORT.md` §2). So the A3 that ships is guarded:

- **The reference.** Each script's gaze is also integrated with the earlier rule, and that reference's own peaks set the
  limits for the same script.
- **What is limited.** Peak turn, the yaw-and-pitch step and the change of turn on the 4 ms grid; and peak turn and
  change of turn as 60 and 30 fps frames at 4 phases (`comfortFrameMs`, `comfortPhases`). The margin is 1e-4.
- **Windows.** Three nested windows from release: to the ideal contact, to the end of first person, and the whole gaze.
- **Where.** The limits start at the first step at which the ball is within 8 m, or at the hand-over. Before that, A3
  equals the earlier gaze exactly.
- **How.** `withinLimit` is one alternating projection over every constraint, including the yaw-and-pitch step
  (addendum 2).
- **The straddle budgets (P-D).** A 60 or 30 fps frame that began before the first limited step can straddle it.
  `straddleBalls` budgets every such frame at every phase: the turn by the triangle inequality, the change of turn by
  ∫|ω(s) − ω(s − T)|. They apply only within two frames of that step (addendum 2).
- **The hand-over (P-B).** `play(result)` passes the on-screen script. The gaze continues exactly from the screen, then
  is limited by the smaller of two sets of peaks. Before, the eye took the result's root offset and crouch in one
  frame: up to 0.28 m and 2.2° (addendum 1).
- **The eased eye (O-3).** `GAZE.eyeEaseMs` = 120. After a live result's hand-over the eye moves smoothly to the planted
  stance over 120 ms; it never jumps, and its speed is zero at both ends (addendum 3). The lead adopted it under a 1 ms
  out-of-view tolerance: the eased eye was worse than the earlier gaze on 3 ball-views by 1 ms offline and on 0 of 96 in
  the browser, against 37 ball-views by up to 30 ms for a fixed eye (addendum 2, filing note).
- **Reduced Motion is unchanged.** `closeGainReduced` = `trackGainReduced` = 0.65, and each script's gaze is
  bit-identical to the earlier one (unit-tested). At a hand-over the eye is held where it is, without the ease
  (addendum 3, filing note). The cost is readability: Reduced Motion players lose the ball about 10 ms earlier than in
  Normal. Whether to opt them in is the owner's decision O-1 (`REPORT.md` §3).
- **Gaze tables off the frame path (P-C).** `prewarmPracticeGaze` builds them at the idle scene, on a Reduced Motion
  change, in `bowl()` and `play()`, for replays and in the benchmark, so every frame finds its gaze built (addendum 1).
- **Result-arrival work in slices (PERF-2, 2026-11-07; builder-measured, Lite at 4× CPU; no phone).** The result's hand-over gaze is integrated lazily and its peak scan resumes in spare-time slices (`PeakScan` and `advanceGaze` in `camera.ts`; the arithmetic is unchanged, so the slices equal the whole bit for bit, tested). `buildPracticeScript` is a generator (`buildPracticeScriptSteps`, `strideGovernedSteps` in `script.ts`), so the stride plan pre-rolls in 250 ms stretches, and the live non-striker moves that a result never shows are not built. While the stage is idle it works in this order: the Director's plans that have a deadline coming (up to 2.5 ms; not in a script's first two spare slots), then the gaze (up to 2 ms), then the reach plan, then the rest of the Director's plans with what is left (`DirectorRuntime.workUrgent` / `workRest`). The tail of a result's plans is only needed as the playhead gets to it, so it comes after the camera cut's own preparation. `warmResult` dry-runs a throwaway result (the controller's `warmPhysics` result) through scripts, gaze, camera, bats, every actor's hooks and the reach plan during the setup screen, about 2.6 to 3.7 s after load at 4× in slices of at most 23 ms, and a real result cancels it. Nothing the player sees changes: 456 deliveries × 8 digests, 0 differences. Numbers in `docs/PERFORMANCE.md` §5.7.
- **The stride decision, the reach plan and forward kinematics (PERF-3, 2026-11-07; builder-measured, Lite at 4x and 6x CPU; no phone; timing indicative until the I1 window).** `buildPracticeScript` no longer makes the striker's stride decision for a result with a swing: his `moves` and `physicsBody` are accessors that make it on first read (`deferStride` in `script.ts`; `PracticeInfo.stride`, not enumerable, so the script's data is the same), and the stage makes it ahead of that in spare slices (`StrideDecision.advance`, before the reach plan) on the script's own planted-feet hook (`humansPoseHook`'s `legs`, the hook without the reach of the bat): the plans and the fit it makes are the ones his frames use, and a governed decision (14% of swings) drops them (`forget`). It is made for every script (the field inset draws him at the dead ball), but his reach plan is warmed only for a script whose camera cuts to him (`firstPersonUntil` finite, `external` not 'none'): a miss, a leave or a pad stays in the batter's eye and never poses him. The reach plan is worked out on demand (`ReachPlan.at` / `warm(from)`): a frame makes the samples of the bat's need about its time, a correction being smoothed from those within 380 ms of it. `forwardKinematics` works out only the bones whose rotation changed and their descendants. Nothing the player sees changes: 456 deliveries x 8 digests (script, gaze, replay), 456 x 15 actors' poses (asked in order, in reverse, with the decision made on the shared hook), the Director's replay-identity and honesty tests and bat-exact all pass; tests `forwardKinematics`, `strideDeferred`, `strideIdle`, `reach-lazy`. Numbers in `docs/PERFORMANCE.md` section 5.7.

Results:

- Per script, the guarded gaze is at or below the reference on every metric and phase: 0 excesses over 270 offline
  cases and in the unit tests (addendum 2).
- As displayed in the browser, 0 of 96 balls are above the earlier camera. The hand-over maxima fall from 7,286°/s and
  1.82M°/s² to 450°/s and 112.5k°/s² (addendum 2).
- **The D-1 residual, accepted by the lead.** One offline case, `rand-expert-spin-o4-b5-right`, has a pre-contact 30 fps
  rate of 296.5 against 282.5°/s (+5.0%). It is structural: the earlier camera switched scripts at 816 ms and so never
  displayed the reference's peak. Causal limits remove it but lose the ball earlier on 133 of 270 balls, by up to
  38 ms, so they were rejected. The residual is pinned, not skipped, in `camera-handover.test.ts`: within 6%
  (addendum 2).
- Out of view before the ideal contact, ref-1 to ref-6, in the browser (addendum 3):

  | View | Earlier gaze (ms) | Final (ms) |
  | --- | --- | --- |
  | 915×412 | 18 / 10.3 / 30 / 34 / 14 / 45 | 16 / 8 / 28 / 31 / 14 / 44 |
  | 640×360 | 6 / 4 / 24 / 27 / 14 / 38 | 5 / 2 / 22.9 / 24 / 14 / 37 |

- **R-C1, deferred.** The gaze work moved into `play()` and `bowl()`, which run outside frames. `play()` p50 is
  6.4–6.9 ms (at a load of 16–18) against 1.2–1.5 ms before, and `bowl()` p50 is 1.8–2.1 ms. `drawFrame` maxima stay
  below the earlier camera's. Building the result's gaze off the main thread is in the not-now register; the cost goes
  to the Track E performance evaluators and the I1 Android run as a measured risk. Device cost is UNPROVEN
  (addendum 2 and its filing note).
- Tests: `tests/unit/render3d/camera-gaze.test.ts` (10) and `camera-handover.test.ts` (8) (addendum 3).
- Size: +6,974 bytes raw and +2,624 bytes raw-DEFLATE against the earlier camera (addendum 3). The APK and installed
  sizes are UNPROVEN.

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

### The dead-ball result card (2026-11-03)

The card's edge depends on the renderer (`Play.tsx` `resultEdge`; `ResultLayer.tsx` writes it as `data-edge`).
Source: `release/product-sequence/stage-1-practice/wedge/worker/REPORT.md` item 4 and addendum 1; builder-measured.

- **Classic: the right edge.** Wholly in the right half, below the rail's right corner and above Classic's side-on
  ball-path strip.
- **Three.js and Unity: the left edge**, `min(24rem, 38% − inset)` wide, below the rail's left corner (measured as
  `--p-rail-left-bottom`). Unity's rear camera puts the batter on the right. On Three.js, the stage's own protected
  regions at the dead ball start at 38.3% of the width or later.
- **Narrow or short landscape (640 px).** The card stays clear of the rail and the ball path and stays readable: the
  decorative mini-map is hidden, the spacing is tighter, the action buttons have tighter insets (still at least 48 px),
  and words do not break inside themselves.
- A card never narrower than 18.5rem was measured and not kept: at 640 px it reaches the ball path on 2 balls and the
  pitch on 10. It is behind no flag.
- A scrolling card body takes keyboard focus (`tabIndex` 0, with a focus ring) and keeps a 4rem minimum height at short
  landscape.
- Results: the card covers the rail in 0 of 12 cases (before, 12 of 12), and `practice-layout.spec:175` passes at 640,
  844 and 915 px.
- **Risk for the evaluators** (lead ruling): for about 300 ms after the dead ball on Three.js, the first-person framing
  reaches the batter's edge on 6 of 12 balls, and no edge avoids it. Unity was not run.

**Occluders.** No external shot shows a player in its near foreground. `occludingActors()` lists any actor capsule
(radius 0.38 m, 0.05–1.9 m tall) within 1.5 m of the lens inside its view. The 3D stage hides those actors, and a unit
test proves the director's own dismissal and fielding shots have none: right- and left-handers, pace and spin, with the
keeper standing up.

### Replay cameras

`replay(..., { camera })`: `side`, the default, is a fixed three-quarter view from the off side in front of the batter
showing the incoming path, the bat path and the contact. In landscape it looks at about his belt (`REPLAY_SIDE_AIM_Y` = 0.95 m,
`camera.ts`), not at the contact's height, so the whole helmet has headroom (WEB-FIX-A fork F6, 2026-11-07; builder-measured, not
evaluator-verified): over 352 deliveries (both hands, pace and spin, drives, defences, pulls, cuts, leaves, misses, bowled, lbw) the head point
is at least 12% of the picture height from the top edge in every frame (it was 71,276 frames under, up to 31 px above the edge; now at least
95.7 px of 412, helmet crown at least 37 px), and the real stage in Chromium agrees (head point 108 to 120 px against 1.5 to 27 px). Portrait
still looks at the contact (it was never cut). The contact stays centred and sits 56% to 86% of the way down the picture; the incoming ball
enters the picture at the same time (median 108 ms before contact). **Named:** while the batter runs past the camera (25 of 352 deliveries,
0.12% of frames, about 1.1 s after the contact) a foot drops below the bottom edge for about 7 frames. **The bowler is never in this picture**
(the camera is 4.3 m from the batter and looks towards his end). Showing him needs either a camera 12 to 16 m away (the batter 50 px tall, a
face about 8 px: not recommended) or a second cue, a telephoto cut to him from behind the striker before the stroke (bowler 101 to 152 px; a
multi-cue replay plan in `session.ts` plus a new shot in `camera.ts`): an open design question, the same family as decision T0. Test:
`tests/unit/render3d/camera-side-headroom.test.ts` (8). Evidence: `release/product-sequence/stage-1-practice/wedge/humans/webfix/A/F6/F6-report.txt`. `behind` looks from behind the bowler's arm (line, swing,
turn), `top` is an overhead of the batting end (directions), and `batter` is the first-person eye with the same gaze.

## First-person bat and gloves

From contact on, the drawn bat is the physics bat (`DeliveryResult.bat`); before contact it is the presented bat below.

**The touch-down stroke** (owner decision 2026-11-04, CTL1: the bat starts moving at touch-down, and the shot commits on
lift; `src/render3d/practice/bat.ts` `TOUCHDOWN`, builder-measured, not evaluator-verified):
- **Start.** The press is the input. From the calibrated press (the instant a tap's physics swing starts), the drawn bat
  starts down the tap's straight-bat provisional swing in the next frame. This replaces the old 2 cm grip-settle cue.
- **Before a commitment.** The stroke is soft-capped at `capMs` = 50 ms of that swing's travel (`50·tanh(t/50)`), goes
  at most `reach` = 0.35 of the way to the tap's hitting pose, and never chooses a direction or a power.
- **Clear of the ball: one rule, for both renderers.** While uncommitted, the drawn bat (presented and first person)
  never comes within `clearM` = 0.15 m of the ball's centre unless the bat with no input is at least that near at that
  moment. A contact needs 0.09 m (the ball's radius plus half the blade), so a stroke can never draw a contact the
  waiting bat would not. Three parts make it:
  - the clearance test, `min(no-input distance, clearM)`, in both drawings at the frame's own time;
  - a look-ahead (`GUARD`: 120 ms along the ball's flight in 4 ms steps), which draws the stroke back at no more than
    50/120 ms of travel per ms before the ball arrives, so the bat does not snap;
  - recovery: once the ball has passed, the stroke eases back in over 1.2 m of clearance.
  When even the stroke's start would be nearer than the rule allows, the bat is drawn exactly as with no input.
  Builder sweep, 2026-11-07 (48 deliveries: both hands, pace, spin and a left-arm bowler, 2 to 11 m, two lines; 12
  presses each from 500 ms before the ideal contact to 60 ms after it; 145,152 drawn poses per setting;
  `tests/unit/render3d/touchdown-bat.test.ts` holds the rule over more than 100,000 drawn poses):

  | `clearM` | Look-ahead | Honesty violations | Frames the guard held the stroke | Largest bat step in 4 ms | Steps over 8 cm (of 72,000) |
  | --- | --- | --- | --- | --- | --- |
  | 0.09 m to 0.40 m | 120 ms | 0 at every value | 50.9% (0.09) · 51.4% (**0.15**) · 53.6% (0.40) | 0.070 to 0.080 m | 0 |
  | 0.15 m | none (instantaneous guard only) | 0 | 48.8% | 0.157 m | 215 |
  | 0.40 m | none | 0 | 50.3% | 0.158 m | 242 |

  Every value is honest (the guard enforces it); the look-ahead is what removes the pop, and a larger `clearM` only
  holds the stroke back more often. In all of the 240 presses at 90 to 250 ms before the ideal contact, the bat moved
  more than 2 mm within 17 ms of the touch at every value. Hence 0.15 m with the look-ahead, as built. The Unity world
  draws the same rule (`ProceduralPracticeWorld.GuardTouchDownPhase`, `TouchDownClearMetres`); on 2026-11-07 it still
  had 0.4 m and the instantaneous guard, a known difference.
- **Check-back.** A press that outlives the tap window (`TAP_HOLD_MS`, or the `waiting` state), or that becomes a
  pullback, is cancelled or ends in an uncommitted leave, checks back over 120 ms to the waiting or loaded pose. A held
  press never draws a shot.
- **The commitment.** The commitment can be a tap's lift (the same start, never retimed), a swipe (retimed to its own
  start, and its bearing shown), or a key. The drawn bat joins that commitment over 40 ms, done by contact. From
  contact on it is the physics bat.
- **Physics and body unchanged.** The stride still starts at `result.swing.startT`, and the physics still uses the
  stance body until then.

From the commitment, a provisional straight-bat swing follows the intent until the result arrives. The presented bat joins it from the pose it
waited in within 60 ms; if the input comes before the backlift's top, it joins from part-way up the backlift and the
closing then runs to contact. The resolved physics bat supersedes it as described below. A side-on stance holds
the hands below and beside the eyes, outside any phone's view, so
the brief's "gloves and part of the bat visible" and "visible bat response" need a presentation aid. It works like the
enlarged ball:

### The presented bat (2026-11-04, human-elements round; builder-measured, not evaluator-verified)

**Before the swing.** The drawn bat before the swing is presentation only (`src/render3d/practice/bat.ts`), and it is the same every ball:
- the orthodox grounded stance `STANCE_GROUNDED`: toe by the back foot, handle towards the front thigh, face to the bowler;
- a small tap every 2.3 s, which stops 1.1 s before the release;
- the backlift from the release to its top 250 ms later (`BACKLIFT`; TRACKB ruling, COVER-DRIVE-SPEC §2).

**The swing.** The swing becomes visible at the player's input, never before. Live, that is the calibrated press; in a replay, it is the result's swing start.
- From the pose the bat waited in, a rigid blend carries it onto the physics swing: the hands travel straight and the blade turns about them.
- The blend holds the physics' first (zone-entry) sample until the physics swing starts.
- It is complete by the physical contact or, without one, by the swing's velocity peak.
- From then on the drawn bat **is** `batAt` (`presentedBatPose`).

**Named exception (lead ruling, SYS1 / amendment 5e).** When the window from input to contact is short, that closing is fast. Learn/Play forgiveness can start the physics bat up to 82 ms before the input.
- **Bound.** The rate is at most 1.6 × (turn needed ÷ window) + the physics bat's own rate (`tests/unit/render3d/humans.test.ts`).
- **How often.** On the reference over (6 balls; errors −120 to +120 ms; attack and defence; 60 Hz; 03:10Z; 1-minute load about 20, so indicative only):
  - 35–42% of Learn/Play swings exceed 1,700°/s, for a median of 2 frames and at most 3;
  - in every such swing the excess is the catch-up;
  - the worst is about 7,900°/s, at a 2 ms window.
- **Why.** The generic waiting pose (the backlift top) is a turn of about 110–180° from the physics bat at contact, and the window is 2–200 ms (median about 120).

**First person.** The same presented bat is carried into the lower corner of the view by a pure translation, `FIRST_PERSON_LIFT` × w. Here w is 1 while waiting and 0 from 80% of the swing's travel. So the batter sees the back of his own bat, toe down, face to the bowler.

**External views.** They use the same presented bat (`externalBatPose`). It is held 350 ms after the physics bat's last sample (or until the striker sets off running, if sooner), then handed to the body's clip: over 720 ms for a batter who stays (settled 1,070 ms after the last sample) and over 320 ms once he has set off. The blend is `rigidBatBlend` with the way round of its turn fixed once for the hand-over, so the blade never jumps where the held bat is a half turn from the clip's. Presentation only: the bat is the physics bat until its last sample and for 350 ms after it (WEB-FIX-A2, 2026-11-07; see round 9 below).

**Gloves.** The gloves close round the handle (`players.holdBat`):
- a mitten-shaped batting glove with a grip channel (`GLOVE_GRIP`);
- the top hand at `TOP_HAND_FROM_CAP` and the bottom hand at `LOWER_HAND_FROM_CAP`;
- the V's turned 35° towards the outside edge;
- the arms solved to the palm point, never the wrist;
- the chest and spine leaning up to 30° each when the arms alone cannot reach.

- **Between samples (2026-11-03, phase 5b).** `batAt` in `src/render3d/practice/frame.ts` interpolates the physics bat
  samples with a quintic Hermite whose first and second derivatives come from Fornberg finite-difference weights over
  up to five knots. Because the swing's progress along its rigid screw is a quartic in time on each run, this
  reproduces the physics swing exactly. The earlier cubic Hermite with three-point tangents overshot the 900 rad/s²
  angular-acceleration cap by up to 8% (975 rad/s² on 390 of 7,560 reach-corpus cases); now 0 cases exceed it. The
  physics adds at least three interior knots to any run of 1 ms or more between authority knots
  (`presentationBatSamples`). `BatSample` and the contract are unchanged, and `frame.ts` is frozen with simulation v3.
  The full specification, for UNITY's parity mirror, is
  `release/product-sequence/stage-1-practice/wedge/physics/phase5/5b-bat-interpolation-spec.txt`; see also
  `docs/PRACTICE_PHYSICS.md`, "Phase 5b". Builder-measured; not evaluator-verified.

### The batter's body on the physics body (2026-11-04, lead rulings for 5f; builder-measured, not evaluator-verified)

The striker's drawn legs and trunk are put on the physics batter: the same pads, torso and head the collisions use
(`batterBody`, `batterBodyFrame`, `batterRootOffset`). `src/render3d/core/motion/humansHook.ts` does it, from the plan
`strikerPhysicsBody` in `src/render3d/practice/script.ts`. The bat path is unchanged.

**Before the input.** Only the generic trigger and the backlift.
- Each drawn shin axis sits on its stance pad axis (0.68 m apart), held by a constant ankle offset. The offset is
  measured 400 ms into every script and again in the ready hold.
- There is no stride, because the physics collides with the stance body until the swing starts.

**From the input.** The stride of the footwork the physics played, at its natural pace.
- It may land just after the contact.
- It is compressed into the window from the input to the physics contact or the ball's arrival (`strideWindow`), up to
  3× faster, only when either:
  - the physics has a pad or body event; or
  - the ball's drawn path would pass within 3 cm of the drawn, still-lagging leg where the physics had no pad.

  The compression is never earlier than the input.
- Each foot steps, lifted, onto its stroke pad. A foot that moves 2 cm or less stays down.
- The hips go over the physics torso base. Each shin crosses its pad at the ball's height on the hit pad.
- The spine, chest and neck lean (at most 30°, 30° and 25°) onto the physics torso top and head.
- The fit is made at the contact and faded out over 400 ms from the stroke's end or the start of the run.

**A leave.** The feet stay in the stance and the ready hold's legs are kept, whatever the footwork label says.

**Named limitation.** The physics torso capsule's bottom cap (about 0.43 m, between the legs) has no drawn surface
there, because this is a physics body-model simplification. It belongs to the owner's body-model item.

**Measured** (a 2,688-delivery corpus, both hands, about 05:50Z):
- **Pad hits on a planted swing:** gap p95 3.7 cm, max 4.3 cm. This is a named limitation within 4.5 cm; the target is
  3 cm, and the knee roll stands proud of the physics capsule.
- **A leave's stance pads:** at most 8.4 cm from the physics capsule over ball heights 0.1–0.6 m, with the stance fit at
  0.30 m, the minimax over 0.15–0.40 m. This is a named limitation: the physics capsule is vertical while the drawn
  stance shin leans, which belongs to the owner's body-model item.
- **Stride pace:** 8.3% of strides are compressed (a pad or body event, or the ball near the moving pads), at 7–15 m/s
  foot speed. The other 91.7% keep the stride's own pace (foot p95 3.0 m/s).
- **Foot slide while down:** at most 1.7 cm in compressed strides and 1.1 cm p95 in natural ones. 4% of late back-foot
  strides slide 2–6 cm into the after-stroke fade; this is open.
- **Bowler release at the palm:** stock pace 0.0 cm, yorker 0.1 cm, spin 1.8–2.0 cm, bouncer 2.0 cm (with
  `bowl_pace_bouncer`).

### Stroke overlays: one clip table for both renderers (2026-11-04, agreed by WEB-HUMANS and UNITY-2; builder-measured, not evaluator-verified)

**The clips.** The striker's hips, spine, chest, neck, head and legs play TRACKB's `batter_strokes` overlays
(BATTER-STROKES-001 v2). Each clip starts at the input, plays at 1× and begins on frame 0 of `bat_ready_hold_compact`.
The arms are reached to the presented bat and the physics bat.

**Choosing a clip.** The clip comes only from `shotFamily(swing.kind, swing.directionDeg, result.footwork)` at the
input. Loft and the outcome are ignored.
- Web: `STROKE_OVERLAYS` in `src/render3d/practice/script.ts`.
- Unity: `PackStrokeClipId` in `ProceduralPracticeWorld.cs`.

| Physics family | Footwork | Clip |
| --- | --- | --- |
| `forward_defence` | forward | `bat_fwd_defence` |
| straight, off, cover, square and on drive | forward | `bat_drive` |
| `steer`, `flick`, `glance` | forward | `bat_fwd_defence` (fallback) |
| `back_defence` | back/across | `bat_back_defence` |
| `back_drive`, `back_punch`, `back_on_punch` | back/across | `bat_backfoot_punch` |
| `cut` | back/across | `bat_backfoot_punch` (fallback) |
| `pull` | back/across | `bat_pull` |
| `hook` | back/across | `bat_pull` (fallback) |
| any family | `down_track` | none: the procedural `foot_charge` |
| sweep (forward attack, direction < −110°) | forward | none: the procedural sweep |
| leave | — | `bat_leave` on the compact ready hold, from the ball's passing − 0.13 s, never before the backlift top |

**Governed strides.** When the physics pads govern, the overlay is warped from the input to its `plant` by the smooth
warp. The minimum windows are 233.3 ms forward and 166.7 ms back. A shorter window falls back to the procedural stride,
and nothing ever leads the input.

**Open (round 2, 08:10Z).** These web gates fail:
- hands on the bat: p95 121 mm, max 368 mm, the same without the overlays. It is a regression since round 1 and is
  being bisected;
- the §9 pose caps: 40 of 192 deliveries over the speed cap, against 131 before;
- foot slide in the after-stroke fade: max 98 cm.

In Unity the leave now uses the overlay (UNITY-7): the ready hold is kept every frame and `bat_leave` overlays hips, trunk, head and legs from the ball's passing − 0.13 s (never before the ideal contact − 0.13 s) with 0.22 s fades; at the accept the bat moves 0.05 cm and the body 0° (it was 36.8 cm and 10°), and the head turns 21° by 20 frames later. Governed strides (the physics pads govern when the ball is low near the feet, or a pad or body contact is coming): **Unity (UNITY-8, 2026-11-07; builder-measured, desktop Editor, no device).** A governed stride plays the same overlay from the input, warped as the web's: clip time P(a·u + b·u²) drawn as 8 straight pieces (`ProceduralPracticeWorld.GovernedClipTime`), P the clip's `plant` marker (0.32 s forward, 0.28 s back), W = min(P, window) with the window from the input to the physics contact or the ball's arrival, whichever is first, a = 2 − W/P, b = W/P − 1 (the clip starts at 2P/W − 1 times its pace, 1.74× at the forward minimum and 2.36× at the back one, and is at 1× at the plant). The physics pads' stride lands on the same instant (`strikerStridePlantAt` = input + W). A window under 233.3 ms (forward) or 166.7 ms (back) keeps the code-authored stride that plants in it: in a 1,020-delivery matrix the governed deliveries whose input is 120 ms or more early are 100% overlay, 60 ms early 23%, on time or later 0%, so a well-timed yorker or LBW ball still plays the code-authored stride (as on the web). Evidence:
`humans/web-humans/overlay-round2-final.txt`.

### The arms and the first steps of a run (round 8, 2026-11-07; builder-measured, not evaluator-verified)

**The arms.** The two §9 ranges on a batter's arm (upper-arm twist ≤ 105° inside, wrist swing ≤ 80° inside) leave the elbow
two windows. `players.reachIK` keeps the elbow in the window it was in (`ElbowMemory`): when the previous frame is within
50 ms, it picks the elbow plane that keeps the upper arm nearest to its rotation one frame earlier, and eases back to the
glove pole's plane at 180°/s. A seek, a new script or a first frame has no previous frame and solves from the pole alone. The
wrist's range is enforced in the last passes only. The batters' hook stamps the frame time (`SampledPose.stamp`), and `holdBat`
reads and clears it. The top hand's weight on the handle lets go over 250 ms and takes hold over 120 ms. The trunk's lean towards
the bat (`solveGrips`) changes at no more than 360°/s from the frame before. Inertial switches carry the bat key (grip and
direction) and the top hand's hold with them, except into a run (`clips.ts inertiaBat`).

**The first steps of a run.** A rolling contact replaces the pinned ankle: the lowest sole point is the pivot, the ankle follows
the clip's pitch, the stance rolls on past the clip's contact until the foot has left the turf, and a swinging foot keeps its sole
2 cm off the turf. `plantFeet` (`locomotion.ts`) eases a leg's rotations in by the foot's weight, as `plantFeetLocked` does: the
IK's soft reach bends a straight leg about 24° whatever the target, so the first frame of a weight above 0 used to snap both shins
22°.

**Measured** (192 deliveries, both hands; evidence in `release/.../wedge/humans/web-humans/round8-*.txt`):
- the elbow's largest step in the trigger 24.4 → 2.2 cm, in the backlift 50.3 → 5.2 cm; elbow flip frames 1,408 → 196;
- deliveries over the §9 speed caps 13 → 0; hands on the bat p95 0.0 mm (the largest single frame 54 → 70 mm at the swing's
  start, the price of holding the trunk lean);
- shoe-point slide from the first stance to toe-off: striker p50 4.3 → 1.1 cm (max 19.3 → 8.7), non-striker p50 15.5 → 2.0 cm
  (max 65.2 → 21.7); crease times still met to 1 ms.

**Named limitations.**
- Wrist swing above 85° in 23 of 14,016 frames (10 of 192 deliveries, worst 104.3°): the forearm lies along the blade and the
  glove closes at 110° to the handle, so no swivel or roll fits. It needs the reach planner or a wrist degree of freedom.
- Run start: 5 of 13 striker runs and 6 of 13 non-striker runs are over 2 cm. The sprint root outruns the run clip's first stride,
  so the pinned foot is left about 1 m behind and drags before it catches up.
- 196 elbow flip frames remain in the stroke and after it (the largest step 53.2 cm), mostly swivel-window swaps (round 9 below: 36 in the same kind of 192-delivery set).
- The leave stance pad gap stays at 7.1 cm (the physics capsule is vertical and the drawn back shin leans about 30°).

**Round 9: glove flips, the bat's hand-over and the replay camera** (WEB-FIX-A and WEB-FIX-A2, 2026-11-07; builder-measured on three sets: 6 reel balls, a 192-delivery corpus of 60,720 frames and a 240-delivery wide sweep; not evaluator-verified; no device). Found by the motion reel (F4, F5, F6). Four causes: (1) the bat key was rebuilt at every inertial switch without `bat.face`, and a face-or-no-face cross-fade switched at w = 0.5 (the leave's bat turned 72.6° about its blade in one frame at the input and the gloves closed with their backs to the face); (2) `holdBat` ignored the key's face (73° at the hand-over end); (3) `relaxGrip` clamped the glove roll by the sign of the wanted angle, which flips by 120° where it crosses ±180° (both arms rest there), and `reachIK` searched the elbow plane in 5° steps and leapt to the other window by 145° of forearm; (4) topology: in the hand-over to the rest the (elbow swivel, glove roll) pairs can split into two windows, and with no look-ahead the arm takes the other one in a frame.
- Fixes: the face is kept and decays with the blade (`hintFace`, `keyFace`, `inertiaBat`; `blendPose` blends a one-sided face with the other side's hint); `holdBat` honours the key's face; the glove roll is a state (`ElbowMemory.rollPrev/Now`) that drifts at most 360°/s and is held inside the arc on the circle; `armGeometry` is split out of `reachIK` (which gains `forcePhi`); `seekClearance` keeps both ranges 10° clear in small moves with §9 first (the plane of an arm that stays, with no roll move and within 10° of the memory's, is found to 0.01°: IDLE-ARMS found that the 6-step search left ±0.4°, which rippled the standing batter's top arm at half the frame rate, 0.2° rms at 30 Hz, so his arms rotated 14.6 against 8.6°/s between balls; now 8.7°/s, and at 30, 60 and 120 fps 8.0, 8.7 and 9.5 against 8.9, 14.8 and 23.4 before; test `idle-arms.test.ts`); `reachableRoll` follows a fast forearm turn; `easeLean` is idempotent for a frame posed twice.
- The bat's hand-over (`bat.ts`): `BAT_RELEASE_MS` 320 → **720 ms for a batter who stays** (settled 1,070 ms after the last sample; a test pins at most 1,100 ms) and a new `BAT_RUN_RELEASE_MS` 320 ms once he has set off (with one blend for both, one running delivery's bat lagged the body that left it and the palm gap reached 21 to 30 mm). The way round of the blend's turn is fixed once for the hand-over by the clip's orientation half way through it: the blade no longer jumps where the held bat is a half turn from the clip's (7 of 432 deliveries by 39 to 62° at 320 ms, 19 of 432 by up to 138° at 720 ms; now none over 25° and bit-identical where it never flipped).
- Measured, at the 15:11Z tree → after WEB-FIX-A → after A2 (elbow flips / forearm-hand turns over 60° in a frame / top glove over 25° a frame while holding): the 6 reel balls 21 → 20 → 2 / 27 → 7 → 3 / 19 → 14 → 3 (checkpoint: 84 turns); the 192 corpus 196 → 176 → 36 / 595 → 94 → 35 / 611 → 199 → 90, palm-to-handle max 53.0 → 20.0 → 20.0 mm; the 240 sweep 390 → 374 → 34 / 885 → 136 → 42; balls that end early (bowled, lbw, pad, body, 76 of them) forearm/hand turns over 60° 36 → 6, arm turns over 25° 794 → 205, the bowled ball's 70 mm palm frame gone. Cost: the striker's pose 77 → 137 µs a frame, only in external views; the initial bundle unchanged; lazy chunks +4.2 kB raw / +1.7 kB gzip and +812 B / +277 B.
- **Named limits:** of the 36 flips left in the 192 set, 28 are in the physics swing's first moves (60 to 200 ms after the input, the arms chasing the exact bat), 4 in the hold and hand-over and 4 while running (0.19 a delivery); every LEAVE has two top-glove turns of about 58° about 1.5 s after the release (the clip's own bat settles, the top wrist reaches its 85° limit and the arm takes the other window), the remedy being to re-author the leave's rest clip so the top hand is off the handle; a look-ahead swivel planner was measured and rejected (at most 22% of the hand-over's flips for about 23 times its 3 ms budget); the hint-face singularity (a clip with no authored face while the bat points at the bowler turns the face up to 17° a frame); the non-striker shares the solver and keeps a one-frame top-glove flip at 0.2 to 0.3 s; whether a 1,070 ms settle reads as sluggish is for the evaluators. Wrist swing over 85° is 8 frames in the 192 set (it was 128).
- Tests: `batter-glove-flip` (7), `dead-ball-handover` (2), `bat-handover` (4), `bat-handover-arms` (3), `camera-side-headroom` (8), all mutation-checked. Evidence: `release/product-sequence/stage-1-practice/wedge/humans/webfix/{A,A2}/INDEX.txt`.

**Unity arms and the live hand-over** (UNITY-3, UNITY-4 and UNITY-5, 2026-11-07; builder-measured on the desktop editor in EditMode, 2 balls × 2 hands, 3,892 joint-frames; not evaluator-verified; no device).
- The visible hero arms use `ProductionHeroArm`, a port of the web's cure: the forearm turns about its hinge only and the elbow keeps its plane (`ProductionArmMemory`: within 50 ms of the previous frame the upper arm stays nearest its previous rotation, and eases back to the pole plane at 180°/s; a seek, a new script or a first frame solves from the pole alone). Forearm joint-frames over their §9 limit: 3,336 (85.7%, worst +168.2°) → 595 (15.3%) after UNITY-4, of which 591 were the free arm of the one-hand carry (cured by the retarget fix below) and 4 are the bat resting on the shoulder (the elbow folds to −175° rather than lift the hand off the bat). Hand 854 → 434 (all in the carry), upper arm 54 → 6. The web's round 8 has 0 forearm frames. Hands on the bat stay within 2 mm in the grip tests.
- **The live hand-over (UNITY-5).** In live play the pack stroke had never been used: a provisional swing returned before the pack stroke was prepared, so the body after the accept was the code-authored stroke. Now a live result plays the family's clip from the pack's load (the anticipation) from the input. The provisional swing keeps the body in that load and draws only the code-authored bat; the pelvis leans up to 25 cm toward a bat the clip body cannot reach (never rising); the accept's body hand-over takes 80 ms and the hands stay on the bat (0.00 cm from the commitment in 24 + 16 scenarios). With the torso governor disabled, over 24 scenarios (press at the swing start, commit at +50 or +120 ms, result 0, 1 or 3 frames later) the chest at the accept is 0.05–0.54× its 600°/s cap (it was 1.10–2.14×), the hips jump 0.3–4.1 cm (2.7–23 cm) and the governor holds a bone back in 0 frames (357). A result 6 or 10 frames after the commit: chest ≤ 0.86×, forearm step ≤ 65.5° (it was 177°), arms ≤ 1.92×, gloves 0.00 cm off the bat (it was 16.8 cm).
  **Hand-over to the physics bat (UNITY-7).** The committed bat was the code-authored stroke (hands 0.96 m high, a 60 cm per frame toe swoop in the 40 ms join) while the physics bat holds its zone-entry pose (hands at the ball's ideal contact plus 0.737 m, 3 cm of hand travel) until 40 ms before contact; and `AcceptResult`'s own pose solves overwrote the arms' elbow memory, so the next frame's elbow plane came from a pose that was never drawn (120–155° flips). Each alone fixed nothing. Fixed together: `ProductionPredictedSwingBat` (the contact bat predicted from the aim, hands eased like the presented bat over the bat's travel time, the blade held 30° back until the last 40 ms) with a per-hand reach clamp of 0.64 m from its own shoulder (0.68 m leaves the gloves 1.7 mm off the handle and 0.72 m leaves them 7.9 cm off, so the constant has a cliff just above it), and the elbow memory captured at the start of `AcceptResult` and restored at its end. With the host's start time (the press), both hands, results 0, 1, 3, 5, 6, 7 and 10 frames after a 50 or 120 ms commit: at the accept the arms are at most 1.95× their cap (it was 5.72×), the forearm step at most 58.6° (171.6°), the bat step 33 cm (94 cm), the palm jump 40 cm (82 cm), and the gloves 0.00 cm off the handle. The forearm step is at most 100° in every class (the 150° exception is gone; that class is now 82°) and the arms are at most 1.5× in 54 of 56 classes. The older probes send the commit time as the start (5.29× → 2.72×, 142.5° → 81.7°); the host sends the press, which is the better case. The committed bat is now the predicted physics bat while the touch-down hitting pose is still the code-authored contact bat; the 40 ms join bridges the two, and aligning them is a candidate.
  **Named limit:** thin-edge, 50 ms commit, result 3 frames later (both hands) is 1.95× and 58.6°, because the physics bat is 0.65 m from the left shoulder while the load body holds 0.64 m, so the bat travels 33 cm at the accept; the prediction is the ideal-arrival contact, so lofts and misses put the physics hands 20–45 cm away; and the stroke's own downswing frames reach 1.9–3.3× the cap in every variant.
- **Two defects of the pack stroke on short traces (UNITY-8).** (1) A bowled or LBW ball ends the trace long before the stroke's clip does; when the dead ball came in the frame the stroke was drawn, the dead-ball recovery re-posed the hero from the code-authored reference and the hips jumped 36 cm in one frame and the gloves were 31 cm off the handle: the recovery now begins a frame later and the inertial hand-over blends it out of the stroke (`recoveryBeginDeferred`). (2) Once the physics bat's knots were used up (a pad or LBW contact, a miss) the stroke drew the bat's FIRST sample, the zone-entry pose behind the batter, a 1.3 m jump of the blade (the golden complete-miss replay: 137 cm in one frame): it now holds the last knot (`PresentedBatHeldAt`). Both are general (natural strides too). **The reach clamp is pinned.** `ProceduralPracticeWorld.PredictedBatReachDefaultMetres` (0.64 m) is tied by `ProductionPredictedReachPinTests` to the hero's measured glove reach (the farthest a grip target can be put from its shoulder with the glove within 5 mm: 0.678 m minimum over both hands and four directions, 0.775 m maximum): the clamp must be at least 2 cm and at most 12 cm inside it (3.8 cm today), so a skeleton or scale change fails loudly. `ProductionLiveHandOverTests` also plays the host's convention (the press as the swing's start; the older tests send the commit time) over accepts 0, 1, 3, 5, 6, 7 and 10 frames.
- **Retarget defect (fixed, UNITY-5).** `Synchronize` did not undo the parent limb's correction, so a canonical-zero hero forearm stood 39.4° off the upper arm (the hand's long axis 13.9° off the forearm). It now writes `rest · inverse(parent correction) · q · correction`, and the hand has its own correction that takes its long axis to down (MOTION-SPEC §1). Forearm joint-frames over their §9 limit, 2 balls × 2 hands: fielders 85.4% → 0.0%, keeper 78.1% → 0%, bowler non-delivery arm 30.3% → 0.4%, non-striker free arm 44.3% → 0%, striker carry arm 15.2% → 0%. Before and after stills of a fielder, the keeper, the bowler and the non-striker are in `release/product-sequence/stage-1-practice/wedge/humans/unity5/sheets/`. Still open: the striker's gripping-hand wrist swing (11.2% of his hand joint-frames), and props that follow the driver rig instead of the hero (the fielder's cap floats above the head in the run and the throw; the keeper's pads and gloves float 5–10 cm).
- **Props and the gripping-hand wrist (UNITY-7).** The striker is drawn as the bat mesh, the skinned body, the eyes and the hero's cricket gear, all skinned to the 75 hero bones (the 87 procedural helmet, pad, glove and shoe renderers are not drawn), so the gap is zero by construction. The pace bowler is the skinned body and eyes only. The spin bowler's cap followed the driver's head and was 1.06, 2.45, 1.44, 4.46, 4.68 and 6.50 cm off the hero's at the run-up, gather, release, +0.20 s, +0.45 s and walk-back; it now follows the hero's head (0.00 cm). Keeper and fielder props were not measured. The striker's gripping-hand wrist swing stays at 434 of 3,892 hand joint-frames (11.2%, worst +35.4°; 342 in the stroke and hold): raising the grip roll bound from 60° to 75° did not change it, so the binding range is the forearm-to-handle angle, and it needs the reach planner or a wrist degree of freedom.
- **Result-arrival latency (UNITY-5, read-only; Editor on Mono on a desktop Mac; Android UNPROVEN).** After the commit the result takes about 130–230 ms (8–14 frames) to arrive: the worker physics 24–44 ms; the same 280–410 KB payload canonicalised and hashed 3–4 times in JS (10–16 ms); the native hop; then Unity's main thread, which decodes the 310–456 KB packet (strict managed parse and SHA-256 75–125 ms, adapter 11–21 ms, accept 6–12 ms) in one frame in which neither the world nor the camera advances. Contact is 67–130 ms after the input, so a typical result arrives after contact and the accept fast-forwards; the 0-, 1- and 3-frame classes above are the optimistic case. Done since (UNITY-6, same method): the decode is 12–20 ms and off the main thread for packets of 160 K characters and more, a result's main-thread cost is about 1.5–2.5 ms, and the wall time from receipt to acceptance is 13–20 ms (adapter plus accept 3.5–9.4 ms, was 9–20); the contract stays v6. **Late results (UNITY-6, read-only):** a result that arrives after contact leaves the drawn ball on its pre-contact line through the bat, 0.3–0.9 m past it at 6 frames after the commit and 1.4–4.7 m at 10 to 14, then it snaps 0.5–5.7 m (up to 8 m) in one frame; the bat and camera do not jump. Since fixed (UNITY-7, see "Late results" above): no ball position the physics has not produced is drawn. Done since (HOP-1, node on this Mac, median of 7 chains over the 7 goldens, 3 processes): the JS work between the resolved result and the bytes handed to the native bridge went from 21.4 ms to 5.7 ms for a `host.result` and from 20.4 ms to 1.5 ms for a `host.replay`, by canonicalising and hashing the {record, result} text once per result (a made resolution is remembered by object identity, with a 32-bit fingerprint of every number as the guard against a change after hashing), by not re-unpacking a packet that `packUnityPracticeMessage` has just produced, and by comparing made resolutions by their cached text. The wire format, the packet bytes and the contract version are unchanged. Left in the 5.7 ms: one canonicalisation (2.3 ms), the flight comparisons (2.1 ms) and the packing and send overhead (1.3 ms). The Android validator on a desktop JVM (read-only): 3.8–5.9 ms warm, 7.7–11.6 MB of garbage per packet, 52–57 ms on the first call of a fresh JVM; an envelope-only reader would take 0.9–2.0 ms with 25 times less garbage, and it waits for a device number. Phones: **UNPROVEN**. A stroke-first split of the packet is a bridge contract change and waits for the lead's decision. Evidence: `.../humans/unity5/f3/`.

**Pre-input honesty (open; for the independent evaluators).**
- The reach plan's lead-in begins 630 ms before the input. In a replay, the drawn body differs in that window between two inputs
  of one stroke (trunk and legs by a few degrees, glove roll up to 30°); before the window the poses are identical to 0.25°.
  Whether live play shows any of it at the result's arrival is **UNPROVEN**.
- The physics `batterRootOffset` can place the stance up to 18 cm elsewhere when a stroke is coming, and the drawn stance follows
  it from the first frame of a result script: a possible tell in replays. How live play handles the result's arrival is
  **UNPROVEN**.

**Edge flash.** When a bat, edge or pad contact is outside the view, which is the usual case in first person, its flash
is drawn at the bottom edge of the view at the contact's horizontal screen position. It is keyed to the contact's
scene time, like its sound.

## Field inset (2026-11-04, PIP; builder-measured, not evaluator-verified)

**What it shows.** A small overhead picture of the whole field, so every player is visible even when the main view
cannot show them. It contains:
- the 11 fielders (warm white), the keeper (an amber square) and the bowler (grey);
- both batters (cyan, the striker ringed) and both umpires (small and dark);
- the ball (white with a halo) and its live path after contact;
- the rope, the ring and the pitch.

The bowler is at the top and +x is on the right, as in first person.

**Honesty.**
- Positions are the physics positions (`evaluateActor(track, t).pos`), with no body offset.
- The ball comes from `sampleBall`.
- The path after contact is the physics ball, revealed only up to now.
- The "fielded" ring appears at the physics catch or field event.
- Overlapping markers are eased apart by at most 1.5 marker radii, about 3–4 m at this scale. This is a display convention for the evaluators to judge.

**One model for every tier** (`src/render3d/fallback2d/topDown.ts`). The inset moves through five moments:

| Moment | When | What the inset does |
| --- | --- | --- |
| calm | before the ball | normal |
| quiet | the run-up, Delivery Quiet Mode | 55% opacity, the field frozen as set at the release, same size and place |
| hidden | the release until the fielding camera takes over | not drawn: the ball outranks the interface |
| chase | after the fielding camera takes over | live play |
| full | the dead ball | the full picture |

- **Premium and Balanced:** the ground is an orthographic overhead pass, captured between balls only (`src/render3d/three/pip.ts`). Live markers are painted every frame.
- **Lite and Classic:** a plain painted field.
- **Classic:** shows the inset only before the ball and in the run-up. After a stroke, its main view is already top-down.

**Placement and protection.**
- **Position:** a square in the top right, below the rail, with side clamp(88, 29vh, 148) px.
- **Floor:** its bottom stays above 55% of the height. It needs at least 72 px; with less room (for example at 200% text on phones) it isn't drawn, and the conditions control's radar shows the players instead.
- **Region guard:** a per-frame guard (`insetBlocked`, with a 300 ms hold) moves it out of every protected region: the first-person bat, gloves and forearms, the pitch strips, the ball path to the bat, the release, the contact, and the bowler.
- **Accessibility:** it is a picture only, aria-hidden, with no pointer events and no text.
- **Where it appears:** only on the live screen: never in replay, Coach or pause, and never on Unity's web shell.
- **Other UI:** the dead-ball card reads `[data-pip]` at runtime and never covers it.

**Measured** (after6, headless Chromium, 640/844/915 × four tiers × both hands; load 5–13):
- 0 frames overlapping a protected region in 24 cases.
- PERF1 p95 is 16.7–16.8 ms before and after.
- The initial bundle is unchanged at 409.1 kB; +5.2 KB gzip, all in lazy chunks.

**Run-up budget (owner decision 2026-11-04).** During the run-up the inset hides wherever the rail plus the inset
would exceed 8% of the screen (`FIELD_PIP_QUIET_BUDGET`, measured on the rail as drawn, at every text size), and the
conditions control's radar shows the fielders instead. Measured (after7, 24 cases):
- the run-up coverage is 6.6% at 640, where the inset is hidden (was 11.3%);
- 4.6% at 844, hidden (was 8.5%);
- 7.8% at 915, where it is shown;
- 0 protected-region overlaps in every moment.

At 200% text the inset has no room, the radar shows all 11 fielders, and the enlarged rail alone covers 16.9%: the
accessibility floors come first.

**Open.** At a left-hander's dead ball, the region guard can hold the inset aside for 300 ms or more while the radar
shows only the ground. This is cosmetic. The inset has not yet been probed on the fully integrated tree; that happens
in the integration pass.

## The face-and-life Director (LIFE-1 to LIFE-3, 2026-11-07; builder-measured, not evaluator-verified)

One system makes the bowler's and the batter's faces and ambient life (`src/render3d/core/motion/director/`, one switch `director.enabled`; the Unity port contract is `director/3`, frozen by `tests/unit/render3d/director/golden.test.ts`). It is a pure function of the person, the delivery key (`deliveryTakeKey`, FNV-1a32, splitmix32) and the scene time: a replay draws what the live frame drew. A plan is baked off the frame path in 64-step slices (about 3 ms of CPU for a delivery plan at 1×, 12 ms at 4×), read in O(1) with no allocation, and **served while it is baked**: a deadline forces at most the few slices the trace is behind by (measured at Lite 4×: forced work 13.8 ms a delivery before, 1.4 to 1.9 ms after).

**Known limit (integration pass, 2026-11-08).** A page's first delivery, replayed by one jump of the manual clock, differs from its later replays at the same replay time by 23 of 329,160 pixels in a test screenshot (largest channel delta 16 of 255, in the batter's helmet region): its script is not baked yet when that frame is drawn. Deliveries 2 and 3 are byte-identical, and so are all three when the clock advances every 50 ms as it does in play, which is how `tests/e2e/render3d-practice.spec.ts` ("replay frames are identical at the same replay time") now runs. The cause inside the Director (the time-budgeted bake in `humansHook.ts`, or state that a jump skips) is not established, and whether a player could see the difference is not established either.

**Honesty rules that bind it.**
- It reads nothing about the ball, plan or result before they are visible.
- Gaze and head follow the visible ball with a latency of 125 to 165 ms and carry it on at its own velocity from a latency ago (a constant-velocity extrapolation of the public ball state at t − lag, never the plan, the bounce or the result).
- Reactions start no sooner than `outcomeAt` plus a seeded 180 to 380 ms. The plan may read the outcome's category in `plan.ts` alone, and the tests prove it changes nothing before `outcomeAt` + 180 ms; the bowler's plan stays outcome-blind.
- The quiet windows (the batter from 600 ms before the release to 800 ms after the stroke; the bowler through the run-up to 150 ms after the release) are exactly zero for every channel that moves the torso, hips, arms or hands.
- Reduced Motion has zero life displacement, no fidgets, no glances to the side, and expressions 1.5 times slower.

**What the player can see.** The first-person view shows none of the batter's face, the bowler's head is 6 to 7 px, and the web "side" replay shows the batter 28 to 36 px tall, so no expression shows at the default viewport (an expression needs a head of about 38 px; decision T0, a face-forward close-up, is open).
- The head and eyes follow the ball with the lid and gaze shader (`uLidL`, `uLidR`, `uGaze`). Against the ball as it is now, the head's error is p50 5.7° and p95 13.9° over 192 real-physics deliveries (it was 10.8° and 32.3°).
- A delivery's first frames continue from the head the scene before ended with (a 400 ms decaying offset, live only): the worst bone at frame 0 is p95 2.75° (it was 15.05°; the Director off 4.08°).
- **The head pass** (`stage/pose.ts`) turns the neck (35%) and the head (65%) to the plan's direction within the body's reach, on the finished bones. Three rules came from the motion reel (WEB-FIX-B, 2026-11-07): a look pulled in from behind the chest keeps the plan's **world** pitch (blended in over a chest-frame yaw of 85° to 165°; inside 85° nothing changes), so the head no longer hangs 85° to 89° down; a turn near 180° is tapered to nothing (`turnHead`), because the axis of a half turn is undefined and the neck and head used to take 61° and 106° in one frame; and the neck and head rate limiter (`limitHead`, 10° a frame) is idempotent for a re-posed frame, as the reel's two-pass camera draws every frame twice. Head pass alone, 118 deliveries in three scripts: steps over 40° 57 runs (max 139.6°) → 0 (max 38.3°); head more than 55° below the horizon after a turn 65 runs (max 89°) → 1 (55°); the striker's head more than 60° down 26 of 118 replays (86°) → 0 (51°); the bowler's head within 10° of the batter from gather to release 4,428 of 4,428 frames, unchanged. The core and its golden are untouched. Test: `bowlerFollowThrough.test.ts`.
- Between balls both players fidget (weight shift, stance adjust, shoulder roll, a sigh), glance to the side (18 to 34°, not in Reduced Motion) and breathe, all drawn from the ball's key, so no two balls repeat and a scene does not repeat within or across its 60 s laps (rolling plans).
- After the result the batter reacts in proportion: a posture lift or slump of up to 4.5° or 5°, the head up or down 6°, a shake after the worst results, a breath out (six, four, runs, dot, leave, close call, wicket). His face (concentration, effort from his own swing input, frustration, relief, celebration) is mixed into the face shader's `uExpr` only for a head of about 38 px or more (`detailForPx`, 15% hysteresis).
- No new asset, bone or morph target; no face-forward camera.

**Unity** (UNITY-E1 and UNITY-E2, 2026-11-07; builder-gated in the Editor on an M1 Pro; not evaluator-verified; no device). The C# core matches the web exactly (golden 5 of 5, a 490-plan corpus with 0 steps on all 24 channels) and is wired into the rig and the world (`docs/DIRECTOR-UNITY-PORT.md` section 13). What the Unity cameras can show is driven (head and gaze through the neck and head bones, breath, sway, posture, twist, fidgets, glances, the idle-to-delivery seam, reactions, Reduced Motion); the lid, gaze-shader, eye and expression channels are not driven unless decision T0 is taken. Gates held with the Director on against off: release time error 0.0 ms, pre-input honesty 0.000° / 0.000 mm (byte-identical), touch-down sweep 72,576 checks with 0 violations, the quiet windows (the bowler's trunk, hips, legs, bat and root bit-identical in 0 of 153 frames in 14 runs), Reduced Motion (every bone but the neck and head bit-identical), replay identity (593 of 593 and 770 of 770 frames bit-equal), hands on the bat at most 0.52 mm (gate 2 mm), no allocation in the frame path. Decisions beyond the web: the striker's head holds still in space from the press to the result (the world already holds his body in the load; the head moves at most 0.85° there, and 24 existing hand-over tests need it), a world-speed guard on the head where the clip's own chest already turns faster than the cap, and a seam for the striker and the scene between balls. MOTION-SPEC §9 is measured on a clip's local bone rotations and the Unity gates on the world rotation of the visible joints: both are reported. The Unity head never hangs more than 60° below the horizon after a turn (bowler 44.5°, striker 36.4° over 14 golden runs). **Not met:** the rig's life costs 8 to 12 µs per actor-frame while it is on (target 5 µs; the whole tick median moves by +14 µs); **named residuals:** the left-hander's walk-back head world speed 1,273 and 1,042°/s against 1,036 and 833 with the Director off, and a planted-foot slide metric for the right-hander's thin edge that moved from 0.600 to 1.609 cm (gate 2.0) because the life's hip roll shifts foot height by up to 3.3 mm and so changes which frames count as planted (the quiet-window feet are bit-identical). Unity IL +43,520 B on top of the core's +41,984 B; APK, fresh-install, IL2CPP and every phone figure are UNPROVEN.

**Not done** (reasons in `P3-GATES.txt` section 6): a bat tap or grip adjustment (the glove solve holds the hands), the bowler's mark or sleeve and ball adjustments (no free-arm channel and no new bones), a ±3% run-up cadence (the run is stride-governed and the release exact, outside the Director), reactions through existing clips (they would move the bat key), and a bowler reaction (he stays outcome-blind).

Evidence: `release/product-sequence/stage-1-practice/wedge/humans/director/P3-GATES.txt`; tests `tests/unit/render3d/director/*` and `directorStage.test.ts`. Size by the cost-test method: 37,417 B raw / 15,888 B gzip (fflate level 9: pure JavaScript, the same bytes on every Node version) of the 40 KiB raw / 16,000 B gzip budget (40,960 / 16,000 B). The gzip budget was 15 KiB counted with Node's zlib (lead ruling 2026-11-07), which left 6 B of headroom on Node 26 (15,354 B) but not on Node 22, which CI runs: the unchanged bundle gzips to 15,469 B there, so the old check failed in CI; on 2026-11-08 the lead re-based it to the deterministic count (112 B of headroom, 0.7%), and any later Director change must still first shrink something else, +11.2 kB raw / +4.2 kB gzip shipped in the lazy stage chunks over the start of P3, initial bundle +0 raw. Cost per actor per frame: +2.9 µs for the bowler and +3.2 µs for the striker (gate 5 µs), 0 B per frame.

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
| Armed press | Pointer-down: `onSwingStart` starts the bounded touch-down stroke (owner decision 2026-11-04, CTL1). Lifting without movement within `TAP_HOLD_MS` commits a defence, timed from the same press. Moving past the threshold commits an attack through `onIntent`. A longer unmoved hold is anticipation, not a shot (`waiting`: the stroke checks back). `docs/PRACTICE_INPUT.md` is authoritative for the current read thresholds. |
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
- **Touch-down** (owner decision 2026-11-04, CTL1). The press starts the bounded touch-down stroke at the press minus
  calibration (`prepareSwing(atPerfMs, calibrationMs)`), which is a tap's own physics start. It never starts a contact
  on its own; see "The touch-down stroke" above.
- **Swing start.** The committed intent starts at its event timestamp minus calibration (`normalizeGesture`), and the
  provisional bat starts at the same calibrated instant (`beginSwing(atPerfMs, calibrationMs)`). The touch-down stroke
  joins it over 40 ms.
- **Provisional swing.** A straight-bat downswing toward where the ball will be, taking `batTravelMs('defend', 0)`
  (120 ms) to the hitting area, with a quick start so the bat visibly answers in the next frame. When the result
  arrives after gesture normalization, the drawn bat blends into the physics bat within 45 ms and no later than
  physical contact, and is the physics bat from then on.
- **Late results.** With a very large calibration offset (over about 80 ms), the physics contact can fall before the
  result is known. The stage never rewinds: cues that are already due fire at once, and the ball continues from the
  result's samples. **Unity (UNITY-7, 2026-11-07; builder-measured in the Editor on Mono, no device):** from the ball's ideal arrival at the committed swing's footwork contact plane (`ProductionBatterBodyModel.IdealTimeFor`; hits land within a frame of it), or when the delivery's flight data is used up, until the result is accepted, the ball, its readability rings, the focus ring and the inset marker are not drawn, so a ball position the physics has not produced is never shown; the accept's `playback.Seek` shows the ball at its physics position (0.0 mm in 221 of 224 probe rows; the other 3 are the keeper's held ball, identical before and after). Before, the ball was drawn after the contact in 73 of 112 committed rows (up to 29 frames, 2.11 m past the contact point) and hung at the end of the flight data for up to 19 frames in all 56 no-swing and all 56 press-and-cancel rows; now it is 0 frames for a swing committed before the ball reached the bat, and at most 4 frames (2.09 m) where no swing was committed before the flight data ended. Results that arrive before the bat give bit-identical frames (16 of 16). Evidence: `release/product-sequence/stage-1-practice/wedge/humans/unity7/a/`.
- **A result that arrives late on Unity** (UNITY-9, 2026-11-07; builder-measured in the Editor, results 0 to 60 frames after the commit; not evaluator-verified). The accept's own re-sample of the code-authored backlift (the "posture is visible at once" step) moved the bat 0.67 m in one frame when the committed swing had already drawn it near the contact; the carry restored it only where the trace's stroke is the pack's. The bat is now put back on screen after that re-sample for every live result with a timed stroke; a result that arrives after the contact has no contact left to be exact at, so the carry takes the bat to the physics bat at a swing's pace (4 m/s and 480°/s on average, at most 0.7 s) once TRACKB's stroke is no longer drawing the bat (while it is, the short carry stays: a stretched carry still running when the stroke's window ended snapped the rest of its offset in one frame, the thin-edge upper arm 177°, a result 8 frames after the commit), and the recovery from the follow-through begins at the accept (it was driven by trace time and found part-way through in its first frame). 60 frames late: bat step 66 → 6.6 cm, hands 177° → 28° in the accept frame. Seams `LateSettleBatRestore`, `LateSettleCarry`, `LateSettleRecovery` (`LateResultSettleEnabled` = all three). The host's classes (6 to 14 frames) are unchanged. **Not changed, by rule: the bowler's and the fielders' roots are the physics path**, so a result 30 to 60 frames late moves the bowler 70 to 96 cm after a hit ball and 161 to 166 cm after a bowled miss at the accept; easing his offset could not be guaranteed never to change the hands-to-ball alignment where he touches the ball (a pickup at 1.078 s is 0.13 s after a 30-frame-late accept), so it is not shipped. Whether a real host's result is ever 30 to 60 frames late is **UNPROVEN** (a phone measurement decides it, together with the stroke-first packet question).
- **Measured latency.** `stats().lastInputToBatMs` runs from the touch-down (the press's own event timestamp) to the
  first frame whose drawn bat moves because of the input (owner decision 2026-11-04, CTL1). "Moves" means the
  first-person bat differs by more than 2 mm, at the toe or the grip, from the bat drawn with no input; a grip cue
  cannot satisfy it.
  - A commitment re-stamps it only when the bat had returned to rest first: a held press or a pullback, then a later
    swing. That later swing is measured from its own input.
  - The metric ends at the moment the first frame showing the bat moving has been submitted (`performance.now()`
    after the draw).
  - Measured from touch-down (FEEL-1, 2026-11-07; builder-measured, not evaluator-verified). Method: `scripts/perf/practice-frames.mjs`
    with real CDP touches (`Input.dispatchTouchEvent`), Chromium 156 on Metal, 915×412 at 2.625×, every ball swung; each run's
    1-minute load is in its JSON, and a run taken above load 20 is marked indicative only. "Before" is the tree of 2026-11-07T02:45Z
    (build 4a376ae+e5dba9cdf3db); "after" has this pass's `bat.ts`, `session.ts` and `delivery.ts` on it.
    - **Balanced Lite at 4× CPU throttle: the CTL1 gate (p95 ≤ 50 ms over ≥ 50 swings).** Before, 90 swings in two runs: p50 40.1,
      p95 53.9, max 55.6 ms, 11 over 50 ms. After, 120 swings in two runs: p50 33.6, p95 50.2, max 56.0 ms,
      7 over 50 ms. Four runs of 30 to 60 swings on the new code gave a p95 from 47.9 to 54.9 ms,
      so the spread between runs is as large as the change: one run does not decide this gate, and on this harness it is not met with margin.
    - **Where it goes** (a timing probe built into each tree, 30 swings each at 4×; p50 / p95 in ms, before → after):
      - the browser's input dispatch, from the event's timestamp to our handler (Event Timing's input delay): 26.7 / 34.2 → 28.8 / 39.2. It is
        outside the app's code and varies by 5 ms or more between runs;
      - the wait for the next frame (0 when the browser dispatches the press just before a frame, 8 to 14 ms when it does not): 0.9 / 12.9 → 10.3 / 12.7;
      - the frame's draw, to the moment the bat is seen moving: 5.5 / 6.7 → 4.8 / 6.3, of which the clearance guard 0.8 / 2.1 → 0.4 / 1.3.
      The app controls about 5 ms of a 40 to 55 ms figure. This pass took about 0.7 ms of it: the guard shares its work between its probes
      (`bat.ts` `guardDrawing`), and a press no longer reads storage for its calibration (`DeliveryRunner.armedCalibrations`).
    - **1× CPU, 50 swings per tier** (p50 / p95 / max in ms; the tier's rubric limit is 50, Classic 67):
      - Balanced Lite: before 42.1 / 49.4 / 51.4; after 40.1 / 49.7 / 51.0
      - Balanced Standard: before 43.1 / 51.5 / 52.0; after 37.7 / 49.7 / 51.3
      - Premium: before 42.6 / 50.9 / 51.4; after 43.3 / 49.5 / 51.1
      - Classic: before 26.2 / 34.5 / 35.0; after 24.9 / 32.0 / 33.7
    - History (TAP, 2026-11-04, another tree): p95 96.8, 109.3, 115.6 and 78.6 ms on Premium, Standard, Lite and Classic before the touch-down start existed, and
      49.0, 45.6, 49.3 and 34.8 ms after it.
    - In the TAP matrix the stage figure was within the 8 ms granularity of Event Timing's pointerdown → next paint: the bat moves in the first
      paint after the press is handled. Add a display frame for photons.
    - PERF-2 (2026-11-07; Lite, 4× and 1×): Event Timing's input delay is p50 26–27 / p95 33–34 ms on the 3D tiers (Classic 8–11 / 16–33) and our handler takes 0–1 ms; before the swing the main thread is 68% idle. So about 27 ms of the figure is the browser's input and frame pipeline and nothing cheap is left in our code. Drawing inside the input handler would shorten this stage metric by the wait for the next frame, but PERF-2 judged that it would not change when the frame reaches the display, so it was **not** done (lead ruling 2026-11-07): the metric must not improve unless the player's experience improves.
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
  - Drawn 22% larger than its collision radius, with a minimum diameter of 3.6 CSS pixels in both live renderers.
  - Two code-built surface hemispheres: a lower-roughness maintained side and a weathered side, plus three restrained
    scuff marks. At release the maintained pole follows `BallFlight.seam.shine` and the great-circle seam follows
    `BallFlight.seam.axis`; they, the raised seam and the ball body then rotate rigidly about `ballRotation(flight)`.
    A scrambled cutter therefore wobbles by the physics-declared relationship instead of pinning the seam to spin.
    Red and white variants retain distinct side and seam tones.
  - A dark, screen-sized rim and surround against the pitch; the size, shade curve and optional focus aid share
    `practice/ballLook.ts`. Screenshot contrast still needs independent verification. The camera A/B of 2026-11-03
    found contrast below 3:1 identically before and after A3, so it predates A3: Lite at 844×390 (ref-1 release 2.03,
    ref-5 bounce 2.16, ref-6 release 1.74) and Balanced ref-5 bounce (2.56–2.85). These are diagnostics (the disc
    against the median of a ring), not certification (`camera/REPORT.md` §5, READ2).
  - A ground shadow, crisp low and fainter high.
  - No additive glow. One faint trace on every tier: 6 samples, 14 ms apart, quadratic opacity falloff.
  - The rigid surface turns about the physics rotation (`ballRotation`, release then after the bounce), at a readable
    rate capped at 6 rps for pace and 8 for spin. That distinction retains an upright angled seam as well as the
    visible wobble of a scrambled seam.
- **Pitch mark.** Practice leaves a small static scuff where the ball pitches. Its effects layer emits no live-delivery
  particles; the ball stays unobstructed.
- **Learn landing cue.** Only with `learnCue`: a green ring at the pitch point from release until just after the bounce.
- **Sight screens.** Dark behind a white ball; off-white behind a red one. The ball's drawn colour follows the setup.
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

  **Release height and side** come from the physics release point (lead ruling 2026-11-04).
  - **Scale.** The bowler's rig is scaled to his own stock release height (`bowlerScale`,
    `src/render3d/practice/script.ts`): his physics release height divided by the height of the ball in his rig's hand at
    the release marker at scale 1, clamped to [0.95, 1.12] for pace and spin alike.
  - **The ball in the hand.** The ball is the hand joint plus (0, −0.085, 0.03) in the hand's frame (`BALL_IN_HAND`): the
    same point as MOTION-BOWL and Unity, and where every held ball is drawn.
  - **Placement.** A rigid ground shift puts that ball at `release.p` in x and z. The composed run-up's ground track is
    scaled with the rig.
  - **Height left over** (lead ruling 2026-11-07). The residual is the physics release point minus the palm as drawn at the
    release: a yorker about 2.6 cm lower, a bouncer higher, a wrist cue's shift, up to 8 cm. It is taken up in the last
    200 ms before the release by the trunk's side flexion (at most 6°) and a rigid shoulder turn, never by the elbow,
    forearm, hand, feet or hips. A straight arm cannot change its hand height by its elbow, and the earlier arm IK folded
    it (see "Measured"). A bouncer adds up to 5° of trunk extension and side-flexion away from the bowling arm.
  - **Feet.** They stay planted, and the body is never lifted.
  - **Run-up start.** The run-up starts mid-walk at rate 1.0 (the owner's "rolling start", with the 1.5 s cap kept): a
    constant offset (`preRoll`, 0.68 s for pace and 0.47 s for spin), an 800 ms root launch from rest, and a 300 ms inertial
    hand-over from a standing idle clip. The release time and the release point are unchanged.
  - **Measured** (builder, 432 deliveries, the drawn picture, not the hooked pose; not evaluator-verified; evidence in
    `release/.../wedge/humans/bowler/GATES-after.md`):
    - the palm is within 0.16 cm (pace) and 0.02 cm (spin) of the physics release point, and the ball leaves from the first
      flight sample;
    - the elbow bend changes by at most 1.3° (pace) and 3.3° (spin) from the arm's horizontal to the release (the Laws allow
      15°; before: up to 101°), turns at most 58°/s (pace) and 141°/s (spin) in the last 150 ms, and the upper arm at most
      1,514°/s; the palm keeps the clip's speed through the release; the idle loop no longer pops the arm;
    - the cadence of the first three run-up steps is at most 1.00× the MOTION-SPEC §9 band (before: up to 1.52×) and the
      root's peak 0.2 s acceleration is at most 5.3 m/s² (before: 14.1). **Named limitation:** the drawn hips' acceleration
      (7.6–8.4 m/s² for pace) is above the 6 m/s² target because it includes the gait's own bob.
  - The bouncer uses MOTION-BOWL's `bowl_pace_bouncer`, whose cue is in the clip.
  - **Unity** (2026-11-07, builder-measured on the desktop editor in EditMode, 12 cases at 60 Hz; not evaluator-verified; no device).
    The same two fixes are ported: `ProductionBowlerRunUp` (a constant `preRoll` at rate 1.0, a root launch from rest, a 300 ms
    inertial hand-over from the idle pose) and `ProductionCharacterRig.ReachReleaseWithTrunkAndShoulder` (trunk side flexion at most
    6°, then a rigid shoulder turn; never the elbow).
    - Unity's own release residual was already 0.000 cm inside the physics geometry (the body scale fits the height and the anchor
      fits x and z); the old arm IK ran only when the body-scale clamp [0.95, 1.12] bound, and then folded the elbow 44–109°. The
      residual reach now closes tangential errors of up to 9 cm to at most 0.02 cm and a 2 cm vertical error to 0.17 cm with the elbow
      unchanged. **Named limitation:** a 9 cm radial residual leaves 6–7 cm; it never occurs inside the physics geometry.
    - Cadence of steps 1–3 against the §9 band 1.32–1.42× → 0.95–1.01×; the root's peak 0.2 s acceleration 11.5–12.7 → 4.99–5.43
      m/s²; the worst bone from the idle pose to delivery frame 0 62.9° → 0.96°; release time error 0.0 ms; the other 12 humans are
      unchanged.
    - Differences from the web: the root launch is 0.9 s (the web's is 0.8 s; at 0.8 s three of 12 Unity cases, the tallest bowlers at
      scale 1.12, exceeded 6 m/s²); the visible start mark is nearer (pace 11.2 → 9.7 m, spin 4.7 → 3.1 m), as on the web.
  - **After the release: the follow-through and what comes next** (web, WEB-FIX-B, 2026-11-07; builder-measured on 118 deliveries in the live,
    played and replay scripts and on four motion-reel clips; not evaluator-verified; no device). The bowler fields his own bowling. His first
    path move used to start at blend 0 with heading 0, which cut the follow-through off in one frame (forearms 57–65°, upper arm 41°,
    heading 7–26°); the aim clips behind his chase, throw and celebration had three more defects (a one-sided aim switched whole at
    w = 0.5; a throw aim interpolated the long way, 168–175° flips; a shortest-arc twist sweeping at 46–48° a frame at the top of a
    celebration).
    - The first chase move blends for at least 120 ms (`FOLLOW_HANDOVER`, `handOverFollowThrough()` in `script.ts`) and
      `ActorTrack.headingFade` carries the old heading in and fades it out over 300 to 900 ms; the walk after the follow-through turns at
      no more than 180°/s with a smooth ease (`Move.turnEase`; `addWalkBack`, `composedBowlerRun`). A 280 ms blend made the first step's
      thigh lunge worse (26° → 41°), so it is 120 ms.
    - His arm aims are short-way and weighted (`setWeightedAims` in `clips.ts`, switched on by the stage for the bowler only), and his arm
      bones are held to 1,440°/s from release + 160 ms (`limitArms`, `armsFreeAt`). The keeper, fielders and batters are bit-identical
      (456 deliveries × every other actor: 0 differ; the bowler's pose is unchanged before release + 250 ms).
    - Measured, replay script, BEFORE → AFTER: bone steps over 25° a frame from release + 300 ms 93 runs / 895 frames / max 174.6° →
      42 runs / 72 frames / max 58.4°, **all of them legs** (run-cycle peaks of 25–35° and three foot plants of 42–58°); arms, trunk,
      neck and head 0 frames. The four reel clips: 8 → 0, 19 → 0, 31 → 2, 39 → 2 bone-frames (legs). Heading steps over 3° a frame: the
      hand-over snap of 7–26° is gone and the live script has none (532 frames → 0, max 3.0°).
    - **Named limits (lead ruling 2026-11-07):** (1) the heading gate as written (at most 3° a frame in a replay) is **not met**: the 3,960
      frames left (max 8.2°) are the sustained fielding turn rates of `fielding.ts`, 3.8–8.2° a frame (228–492°/s), with no snap; a baked
      heading limiter on his track would cost 1–3 ms on the result build and was not added; the evaluators judge whether his chase turn
      looks human. (2) The leg run-cycle peaks belong to the locomotion owner (FootPlan under a root that outruns the walk clip). (3) The
      keeper and the fielders share the legacy aim defects; switching the flag on for them changes 77 keeper and 70 fielder digests of 456,
      so it waits for an evaluator look and is outside the one-batter, one-bowler wedge.
    - Evidence: `release/product-sequence/stage-1-practice/wedge/humans/webfix/B/INDEX.txt`; tests `tests/unit/render3d/bowlerFollowThrough.test.ts`
      (14, each name carries its reason). The Lite 4× browser ABBA was not re-run (the node 1× result-path timing is unchanged: build 2.37 vs
      2.27 ms, draw 4.05 vs 4.04 ms).
  - **After the release on Unity** (UNITY-9, 2026-11-07; builder-measured in the Editor on Mono, a scan of every frame of both actors on 10 deliveries x 2 hands x Director on and off x results 0 to 60 frames late; not evaluator-verified; no device).
    - The bowler's heading, once the planner has him (his first non-"set" physics sample, 0.91 s after the release in the goldens), is drawn by a turn follower, not by the old 0.35 s slerp: it turns at most 270°/s, reaches that rate at 1,500°/s² and eases in over the last 54° (`ProceduralPracticeWorld.FollowHeadingDegrees`; seam `BowlerHeadingFollowerEnabled`). His pose still blends from the follow-through over 0.35 s. His hips now turn at most 10.2° a frame after a hit ball on every golden (§9 cap 10); the old slerp from the follow-through heading to the planner's moving heading turned them 20.5°, 24.3° and 25.4° in one frame at release + 1.1 to 1.2 s.
    - A fielder's throwing palm (the bowler's included) still reaches the physics release point 0.25 s either side of the release (0.080 m at the throw, was 0.079; the third man's 0.0808 m, was 0.0812), but the goal now turns about the shoulder (its direction along the shortest arc, its distance linearly) instead of along the straight line, which passed 3 to 13 cm from the shoulder when the clip's hand and the release point lay on either side of it. The elbow's bend is the clip's, carried once onto the goal line; the trunk joins in only as the goal passes the arm's reach; after the release only the offset the release left fades (`ReachPalmTo`, `ReachPalmFollowing`; seams `ThrowReachFollowsThrough`, `ThrowReachStablePole`). The defensive-tap bowler's left upper arm turned 164° and 178° in one frame (a 5-frame flicker of the elbow plane) before; now 22°.
    - Between balls the striker's hand-over to the waiting stance moves the bat too and takes 0.4 s (`IdleHandOverMovesBat`); before, every ball's end jumped the bat 32 cm and 141° in the first frame and the arms 90° to 132° (205 frames over 60° in the scan, now 0).
    - Scan totals over the 240 runs, before → after: bowler one-frame turns over 60° 448 → 216, over 1.25× the cap 122 → 15, head world speed over 720°/s 287 → 24; striker over 60° 1,265 → 559, glove off the grip over 2 cm 44 → 4, hips or root jumps over 5 cm 302 → 226. **Named, not fixed:** the gripping-hand wrist over 85° (185 to 236 frames per run in strokes, a plateau of 100° for 156 to 212 frames in the recovery; the loft peaks at 152° for 61 frames), the stroke's own downswing (the blade's last 40 ms: arms 88° to 129° in 1 to 2 frames at release + 450 to 467 ms, 152 frames over 60°, 4.29× the cap for the hands), the striker's 59 cm root rebase at the thin-edge run start, and the thin-edge arms 71° to 121° at release + 0.87 to 0.93 s for a result 10 to 14 frames late (in the baseline too). Evidence: `release/product-sequence/stage-1-practice/wedge/humans/unity9/EVIDENCE-INDEX.txt`; tests `ProductionPopFixTests` (17, each also plays the seam off and asserts the old defect); the scanner `Editor/Evidence/VandeHumansEvidence.Pops.cs`. Runtime source +19,429 B, IL +4,608 B (Release-style compile 912,896 → 917,504); APK and phone figures UNPROVEN.
  - **Left-arm bowlers** are drawn left-armed.

### Unity live surface: ball readability and light (2026-11-03)

Sources: `release/product-sequence/stage-1-practice/wedge/unity/phase2/REPORT.md` (with addendum 2) and
`textures/REPORT.md` (addendum of 09:55Z). Builder-measured in the desktop Unity editor; not evaluator-verified.

- **The Day sun.** Unity's Day sun is now the web's: azimuth 58°, elevation 54° (`SunKey(58, 54)`, a port of the web's
  `sunDir`; `src/render3d/three/stadium.ts` `LOOKS.day`). The old key put the sun behind the bowler, mirrored along the
  pitch, so the batter saw the ball's unlit side.
- **The dark shade.** Unity ports the web's `PRACTICE_BALL.shade`: a dark camera-facing ring, never a glow. Unlike the
  web it is drawn halfway along the ball's sight line towards the camera, so the pitch cannot hide its lower half. The
  evaluators should check that it never overlays an object between the camera and the ball (phase 2, risk 6).
- **Contrast** (Unity's disc method, WCAG, a 1830×824 render, refs 1–6 on Lite, Standard and High):

  | Moment | Before | After |
  | --- | --- | --- |
  | Release | 3.6–4.7 | 9.5–10.4 |
  | Bounce | 1.54–2.15 | 4.50–5.72 |
  | 5 m before contact | 1.47–2.51 | 4.46–6.47 |

  That meets the 3:1 builder target at release, bounce and 5 m on every tier and ball. Ref-6 is hidden behind the
  batter at contact in both builds.
- **The Day plate** (`UNITY-TEX-STADIUM-DAY-003`) was re-lit with `SunKey(58, 54)` and adopted, because all 51 gate
  cells stayed the same (difference 0.000).
- **LateAfternoon.** Unity's late light now matches the web (`SunKey(104, 15)`) and the regenerated sky. Under it the
  white ball reads below 3:1 at bounce and 5 m in 29 of 54 rows. **Lead ruling:** Practice plays only in Day light,
  and LateAfternoon is not offered in Practice until it passes ball readability (at least 3:1 at release, bounce and
  5 m on every tier). The ruling gates any future light option and is in the not-now register.

## Quality profiles

| Profile | Internal height | DPR cap | Shadows | Crowd | Player LOD | Particles | Trace |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lite | 540–720 | 2 | none (blob shadows only) | 1400, static | 9 m | 0.25 | 6 |
| standard | 720–900 | 2 | key light, 1024 | 3600, animated | 22 m | 0.8 | 6 |
| high | 900–1440 | 2.5 | key light, 2048, light shafts | 6500, animated | 40 m | 1.2 | 6 |

- **Pixel ratio.** `practicePixelRatio` holds the drawing buffer's shorter side inside the band (and under the cap),
  so a high-DPR phone is never rendered at a resolution nobody can see. Every profile runs at 60 fps; readability
  settings are the same in all three. MSAA is fixed when the context is made: lite starts without it.
- **Benchmark.** `benchmark(ms)` plays the real scene (the bowler running in and bowling, the field set, the batter's
  eye). It runs for `ms` and also until it has `PERF_WARMUP_FRAMES` + 6 frames, capped at 6 s, so a software renderer
  at 2–8 fps is still measured on real frames. `src/perf` classifies; the stage computes no tiers.

### Stage 0 integration repairs

- Creating the 3D stage also preloads Classic's code, with failed preloads retryable. This removes a later code fetch
  when a warmed session changes to Classic offline. The UI still owns calm recovery if initial loading fails.
- Mount warms every quality profile and both LODs, including hidden effects and shadow passes. Runtime browser
  instrumentation must verify zero shader links inside deliveries; source-level warm-up is not a measured pass.
- The resolved emotion plan now supplies timestamped `moment`, `context` and contact metadata to the existing
  soundscape. The live 3D crowd follows that soundscape's state; muted/custom sinks and replays use the script clock.
  Boundary celebration begins at confirmation, and a carry reaction uses only distance the ball has already travelled.
- The 3D stage connects pitch, ball-dependent sight screens, environment and Delivery Quiet Mode to the existing
  stadium hooks. Quiet mode freezes decorative boards and scenery, while cricket reactions follow physical events.
- Tests in `presentationIntegration.test.ts` cover actual mesh scale across all profiles/viewports, no Practice glow,
  equal trace constants, focus toggles without material recompilation, and causal boundary timing. These are automated
  checks, not visual acceptance or a player-experience score.

## Classic 2D (below the cutoff, or no WebGL 2)

`Fallback2DPracticeStage` implements the same interface on Canvas 2D and plays the same scripts from the same
physics data:

- **Live.** The batter's view through the same camera director, projected through a pinhole onto simple shapes: the
  sight screen, pitch and creases, the far stumps, the players, the outlined ball with its shadow and a tapered trace,
  the Learn ring, and the first-person bat and gloves.
- **After contact.** The shared top-down painter shows the field, with the side-on height inset.
- **Replay.** A steady top-down view of the batting end, with the incoming, outgoing and bat paths, the ideal and actual
  contact, and the intended and actual directions.
- **Coach demonstration.** The same `demo_side` camera as 3D projects the complete striker silhouette and the exact
  resolved bat path; only the striker is translucent. It remains a deliberately economical Canvas rendering, but no
  longer falls back to the generic top-down match view.
- **Training close-up.** The same `ball_close` camera shows the held release orientation, then the sampled flight. A
  large code-drawn ball separates polished and rough halves, seam and scuffs. Classic projects the rotated
  `BallFlight.seam.axis` and `shine` through the active camera basis, including seam foreshortening and which half faces
  the batter; it does not infer both from a single flat spin angle.
- **Tests.** A unit test checks that the 2D painter draws the ball at the projected position of the result's own
  sample and that the held training close-up uses the declared close-up size.

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
its root is placed so that hand is at the mirrored release point. The non-striker stands on the side away from the bowler's real arm (x = −1.15 m for right-arm, +1.15 m for
left-arm), whatever the striker's hand.

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
- **Camera (2026-11-03).** The D-1 residual (one offline case, +5% at 30 fps) is accepted. `play()` costs about 6.5 ms on
  the desktop main thread (R-C1, deferred). Reduced Motion keeps the earlier gaze and loses the ball about 10 ms earlier
  than Normal (owner decision O-1). The constitution's Quiet Mode says "Do not move the camera"; the batter's-eye gaze
  is existing design, and A3 adds a little motion near contact, so the owner and the evaluators should confirm it
  (`camera/REPORT.md` §8, R8).
- **Result card.** For about 300 ms after the dead ball on Three.js the first-person framing reaches the card's edge on
  6 of 12 balls (see "The dead-ball result card").
