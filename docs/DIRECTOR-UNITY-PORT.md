# The Director for Unity: porting contract (contract `director/3`, LIFE-3, 2026-11-07)

Status: the web Director is frozen at this contract by `tests/unit/render3d/director/golden.test.ts` and its fixture
`tests/unit/render3d/director/fixtures/golden.json` (17.5 kB). The C# core of this contract exists (UNITY-E1, 2026-11-07: `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Director/`, generated parameters by `scripts/director-unity-params.mjs`, parity with the web on the golden fixture and on a 490-plan corpus: 0 steps on all 24 channels, V8 against Mono on arm64 macOS); the stage binding (sections 8 to 10) was built by UNITY-E2 (2026-11-07, builder-gated in the Unity Editor, no device, not evaluator-verified): section 13 says what exists and which decisions go beyond the web.
Builder statements only: nothing here is a human result or an evaluator's finding. Every number is an engineering value, not human-validated.

## 0. What is ported, and from where

| Web file (`src/render3d/core/motion/director/`) | What it is | Port as |
| --- | --- | --- |
| `seeds.ts`, `noise.ts` | FNV-1a 32, the delivery key, splitmix32 draws, value noise, breath wave | pure static functions |
| `channels.ts`, `params.json` | the 24 channels with their Int16 scales; every tunable number | `params.json` copied verbatim (read at start; no number in code) |
| `plan.ts` | one actor's events for one script: blinks, fixations, microsaccades, fidgets, the reaction | `BuildEvents(anchors) -> Events` |
| `bake.ts` | the 240 Hz integration that writes the Int16 trace at 60 Hz | `BakeSteps` (a resumable iterator: it is sliced in the web) |
| `director.ts` | `sample`, `sampleWrapped`, `detailForPx`, `startPrepare` / `PlanJob` | the same |
| `stage/runtime.ts` | anchors from a script, plans per script kind, hand-over, seam, laps, effort, detail | the Unity stage binding |
| `stage/pose.ts`, `stage/face.ts` | life pass (bones), head pass (neck/head/eyes), expression mix | the Unity pose pipeline |
| `three/players.ts` `limitHead`, `setRigFace` | the neck and head rate limiter, the face uniforms | rig side |

Pure function of (person look seed, delivery key, anchors, scene time). No clock, no `Math.random`, no platform random, no frame count.
A replay rebuilds the same plan from the same key and anchors and draws the same pixels (bit for bit in the same engine).

## 1. Conventions

- Scene time `t` in milliseconds on the script clock (the clip clock, never the wall clock). The plan's trace covers `[start, end]`.
- Angles in degrees in the actor's role frame: the world axes turned so that +z points down the pitch to the opponent. **Yaw + turns left,
  pitch + looks down (a lean forward), roll + tilts to the right shoulder.** Roll is about the line of sight against the level.
- The role frame is the **pre-mirror** frame: left-handers and left-arm bowlers are posed mirrored by the stage after the hooks, so `aim`,
  `visibleBall`, the face yaw sign and every number in the plan are in the right-handed frame; the stage mirrors the pose afterwards.
- Bone Eulers (degrees, XYZ, relative to rest): spine, neck, head X + leans forward, Y + turns left, Z + bends right (core/skeleton.ts).
- Channels are stored as Int16: `stored = clamp(round(value / SCALE[c]), -32767, 32767)`; `value = stored * SCALE[c]`.

## 2. Keys and draws (exact)

- `fnv1a32(s)`: h = 0x811c9dc5; for each UTF-16 code unit c: h ^= c; h = (h * 0x01000193) mod 2^32 (unsigned). Test vectors: `seeds.test.ts`.
- Delivery key: `deliveryTakeKey({seed, overIndex, ballIndex})` = `"{seed}#{overIndex|-}.{ballIndex|-}"`, or `"unseeded"` when the seed is empty.
  Web: `seed = flight.seed`, `overIndex`/`ballIndex` unset in the Practice stage, so the key is `"{seed}#-.-"` (as the sound takes use it).
  A scene between balls uses `"{bowlerLookSeed}|idle.{n}"` (n counts scenes from 1) and, for rolling laps, `"{key}.{lap}"` for lap >= 1.
- Person key: `pk = fnv1a32("life|person|{lookSeed}|{role}")` (role is `bowler` or `striker`; `lookSeed` is the actor's look seed).
- Ball key: `bk = fnv1a32("{deliveryKey}|life|{pk}")` (pk as a decimal integer).
- `mix(seed, k)` = output k (from 0) of splitmix32 seeded `seed`, stateless: z = (seed + imul(k+1, 0x9e3779b9)) mod 2^32; z = imul(z ^ (z >>> 16), 0x85ebca6b);
  z = imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) as uint32. `u01(seed,k) = mix(seed,k) / 2^32`; `range(seed,k,lo,hi) = lo + (hi-lo) u01`.
  `gauss(seed,k) = (u01(seed,3k) + u01(seed,3k+1) + u01(seed,3k+2) - 1.5) * 2` (Irwin-Hall of three, bounded +-3). `lognorm(mean, cv, z)`: s2 = ln(1+cv^2);
  exp(ln(mean) - s2/2 + sqrt(s2) z).
- Streams (all fixed indices, so a draw never depends on how many others were taken): person traits `pk` indices 0..7 (plan.ts `persons`); per-ball draws
  `s = mix(bk,1)` indices 0..37 (`draws`, a 36-float array); blink gaps/shapes/doubles/relief `mix(bk,11..14)`; fixations `mix(bk,21)` (sequential counter), `22` (blink-with-shift flag),
  `23` (timing of the ball fixations, the outcome gaze: index 5), `24` (side glances); microsaccades `31`, `32`; shift blinks `mix(bk,12)` and `mix(bk,41)`;
  head drift `51`; sway `52`; fidgets `62` (amplitudes, 8 per event), `63` (gaps; first-event draw index 1000), `64` (kind); reaction `71`.
  The list of draws is the code of `plan.ts`: port that file line by line; `golden.json` checks it.

## 3. Noise and waves (`noise.ts`)

- `quint(f) = f^3 (f (6f - 15) + 10)`; `vnoise(seed, x)`: i = floor(x); a = 2 u01(seed,i) - 1; b = 2 u01(seed,i+1) - 1; a + (b-a) quint(x - i).
- `fractal(seed, tS, x0, spacing[], amp[]) = sum_k amp[k] vnoise(seed + 977 k, tS/spacing[k] + x0)`.
- `skewSin(cycles, skew) = sin(2 pi cycles + skew sin(2 pi cycles))`.
- Min-jerk `mj(x) = 6x^5 - 15x^4 + 10x^3` clamped to [0,1]; `smooth(x) = 3x^2 - 2x^3` clamped; `soft(x, limit)`: linear to 75% of the limit, then
  `0.75L + 0.25L (1 - exp(-(|x| - 0.75L) / (0.25L)))` with the sign of x (bake.ts).

## 4. Channels (24 Int16 per frame, 60 Hz; `channels.ts`)

| # | name | unit (value = stored * SCALE) | SCALE | notes |
| --- | --- | --- | --- | --- |
| 0-2 | headYaw, headPitch, headRoll | deg | 1/512 | **'space' mode: the head in space** (role frame), soft-limited to 62 / 40 / 12 deg; 'overlay' mode (tests only) is the correction to add to `clipHead` |
| 3-6 | eyeYawL (3), eyePitchL (4), eyeYawR (5), eyePitchR (6) | deg | 1/512 | only 'overlay' mode writes them; 'space' mode: zero, the stage takes the eyes from 10, 11 and the head it drew (`eyesFor`) |
| 7, 8 | blinkL, blinkR | 0 open .. 1 closed | 1/16384 | shader lids; the left and right differ by the skew (+-12 ms) |
| 9 | lidFollow | -1..1 | 1/16384 | 'overlay' mode only |
| 10, 11 | gazeYaw, gazePitch | deg | 1/128 | 'space' mode: the raw gaze (gaze + microsaccades + eye drift); 'overlay': head + eyes as achieved |
| 12 | breath | deg of chest swing, + inhale | 1/4096 | zero in the quiet windows and in Reduced Motion |
| 13, 14 | swayX, swayZ | mm of root shift, X + to the actor's left, Z + toward the opponent | 1/1024 | includes the weight-shift and stance fidgets; gated |
| 15 | swayRoll | deg of hips roll, + to the right | 1/4096 | includes the weight-shift fidget; gated |
| 16 | exertion | 0..1.5 | 1/8192 | raises the breath rate and depth; not gated |
| 17-21 | xConcentration, xEffort, xFrustration, xRelief, xCelebration | weights 0..1 | 1/16384 | zero below the detail level 2; xEffort is **never in a plan** (the stage adds it, section 9) |
| 22 | posture | deg, + lifts the chest, - drops the shoulders | 1/4096 | fidgets and the reaction; gated |
| 23 | twist | deg of upper-body turn about the vertical, + to the left | 1/4096 | fidgets; gated |

`detail` (0 head and life only, 1 plus eyes and lids, 2 plus expressions) is a read-time mask in `sample`: level < 2 reads channels 17-21 as 0, level < 1 reads 3-9 as 0.
`detailForPx(px, prev?)`: thresholds `params.detail.px = [12, 38]` (CSS px of the head on screen), hysteresis 15%: with a previous level a level is entered at
threshold * 1.15 and left at threshold * 0.85. The expressions are only drawn for a head of about 38 px or more.

## 5. Anchors and callbacks

`DirectorAnchors` (types.ts), times in scene ms, `null` = does not exist / is not known yet: `role, person, key, start, end, gather, release, swing, contact, taskEnd,
outcomeAt, outcome, dead, strokeEnd, runs, runStart, followEnd, seamMs, headMode ('space' in the stage), reducedMotion, headPx`. The web builds them in
`practice/script.ts directorSpec` (what is known when) and `stage/runtime.ts anchors` (the callbacks). A live delivery has no `swing, contact, taskEnd (the unhit ball's
passing instead), outcomeAt, outcome, dead, strokeEnd`; the plan built from it and the plan built from the result agree until the first moment the result matters
(`takeOver`: min of contact + 125, outcomeAt + 180, dead + 125, the live flight's end + 125, the live task end + 138, the stroke end).
**Honesty (binding, H1-H7): nothing may read the plan, the speed, length, line, variation or result before it is visible; gaze and head follow the ball only with a latency
of 125..165 ms; the bowler looks at the batter, never the pitch spot; reactions start no sooner than outcomeAt + a seeded 180..380 ms; the quiet windows are zero.**

Callbacks Unity must supply (all write into a preallocated array; none may allocate in the frame path; all are called from the bake, off the frame path):

- `aim(target 'opponent'|'hand', tMs, out[yaw,pitch]) -> bool`: the direction from the actor's eye to (a) the opponent's eye (the bowler looks at the batter's stance eye,
  the batter at the bowler's head as drawn at t), (b) the bowling hand (batter only) as a **generic** action (rises over the last 650 ms before the release; never the
  true release point). Constants in `runtime.ts`: eye height 1.675 rig-heights; hand height 1.05..2.2, side 0.22, forward 0.12 (times the rig scale).
- `visibleBall(tMs, out[yaw,pitch], aheadMs = 0) -> bool`: the direction from the actor's eye (at `tMs + aheadMs`) to the ball **as the script draws it at `tMs`**
  (in the generic bowling hand before the release), false while it is not drawn. With `aheadMs > 0` (the web passes the pursuit lag, params `gaze.leadX = 1`): the ball's
  position carried on at the constant velocity it had at `tMs`, measured from the ball as drawn at `tMs` and 10 ms earlier (nothing later than `tMs`), and **no extrapolation for
  a sample across a change of holder or of kind** (the hand to the air). No ground clamp, no use of the plan, the bounce or the result.
- `clipHead(tMs, out[yaw,pitch,roll])`: only in 'overlay' mode (tests). The stage uses 'space' mode and never calls it.

## 6. The plan (events), then the bake

Events (`plan.ts`; float32 arrays): `fix` [t0, target, mode, lag, blinkFlag] (targets 0 opponent, 1 hand, 2 ground, 3 ball, 4 side glance, whose lag column is the signed yaw
offset), `blink` [t0, close, hold, open, depth, skew], `micro` [t0, dx, dy], `fidget` [t0, kind, dur, a, b, c, dir, 0] (kinds 0 weight shift, 1 stance adjust, 2 shoulder roll,
3 sigh), `react` [t0, valence, strength, rise, hold, decay, shake deg, shake Hz, head pitch deg, exhale, relief, concentration] (none or one), `draw[36]`, `amp[8]`.
Fixation timelines differ by situation (the code is the spec): a scene between balls (dwell, ground, hand, side glances, ends on the opponent so the loop does not jump);
the bowler (gather look at the batter at gather - 640..-560 ms, the ball 130..190 ms after the release, back to the opponent, the ground, then idle dwell after
`followEnd`); the batter (dwell on the bowler / hand, the ball from release - 140..-60 ms, then from `outcomeAt` + the reaction latency the ground or the bowler by the
outcome's `groundP`, or after `dead`). No blink falls inside the task window (bowler: gather - 120 .. release + 150; batter: release - 150 .. task end + 150) or across the loop seam.

Bake (`bake.ts bakeSteps`): integrate at 240 steps/s, write a frame every `240/hz` steps (hz = 60). Per step: (1) take the fixations whose start has come; (2) the gaze:
a saccade (main sequence duration `22 + 2.7 A` ms, never above 700 deg/s, shaped `mj(u^0.82)`), smooth pursuit capped at 110 deg/s with a catch-up saccade when the error passes
5 deg and 120 ms have passed since the last one (a new fixation waits for the eyes to be free); (3) the head in space: a critically damped follower of the gaze delayed by
the neck lag (20..45 ms), omega = 1000 / tau (tau 170 ms bowler, 60 ms batter; x1.5 in Reduced Motion), target = delayed gaze minus the comfort zone (3.6 deg yaw, 2.7 pitch),
speed cap 360 deg/s, **plus the smooth-pursuit feed-forward** `ffX * (2/omega) * filtered ball-target angular velocity` (not in Reduced Motion; the velocity comes only from
the ball target, restarts after a saccade, ignores steps over 8 deg in one step); (4) a frame: head drift (fractal), microsaccades and eye drift, lids from the blinks (min-jerk
close, hold, opening with exponent .75), exertion pulses, **life gain** (ramp in over 400 ms; batter zero from release - 900 .. -600 to stroke end + 800 .. +1400; bowler zero from the
run start - 300 to release + 150, back over 450 ms; zero in Reduced Motion), breath and sway (fractal, 3 octaves), the fidgets (bell `mj(u/.38)(1-mj((u-.62)/.38))`, the sigh
asymmetric), the reaction (posture, head pitch offset, the shake `sin(2 pi f u) sin(pi u / shakeMs)`, the exhale pulse), the expression weights. Reduced Motion: no drift, no
microsaccades, no fidgets, no shake, no side glance, expressions' ramps 1.5x slower.
**Do not simplify: port the code. The order of the draws and the floating-point expressions are the contract.**

## 7. Reading the trace

- `sample(plan, t, out, detail)`: f = (t - t0) hz / 1000 clamped to [0, n-1]; i = floor(f), i clamped to n-2; linear between frames i and i+1; times outside the plan hold the end frames.
- `sampleWrapped(plan, t, loopMs, fadeMs=600, out, scratch, detail, next = plan)` for a scene that loops: in the last 600 ms the value fades (smoothstep) into
  `sample(next, t - loopMs)`; the plan starts at `-600` (a pre-roll) so the end reaches the value the next lap starts from. Rolling laps: `next` is the following lap's plan.
- O(1), no allocation, 0 B per frame, <= 5 microseconds per actor per frame (web test).

## 8. The runtime (when plans exist; `stage/runtime.ts`)

- Plans are baked **off the frame path, in slices** (64 integration steps = 267 ms of script a slice; the first slice of a plan is 63 steps, and overlay mode starts with 32 clip reads; the web runs them in the spare time of frames with a budget): a scene between balls
  when it is shown; a delivery in the run-up (nothing in `bowl()`); a result's plans in the spare time after the result arrives, copying the live trace up to `untilMs` (`reuse`).
- A plan with a **deadline** (a delivery's 700 ms, a result's `untilMs`) is **served while it is being baked** from its deadline on: the frame asks for the trace up to
  `t + 100 ms` and bakes at most the slices that are missing; the spare time bakes it 300 ms past its deadline before finishing any plan. In the web a deadline forces at most
  a few slices (measured at Lite 4x CPU: 1.4 to 1.9 ms per delivery inside the draw hooks, instead of 13.8).
- **Seam** (live deliveries only): at the first frame of a delivery that follows another scene the head pass remembers the head the scene before ended with (its role-frame yaw, pitch,
  roll after the rate limit), computes the offset `o = h0 - (the head the first frame finds)`, and adds `o * (1 - smooth(t / 400 ms))` to the head turn. Replays and results have none:
  a live ball and its replay differ in the first 400 ms by at most `o` and not at all after.
- **Re-posing a frame** (the web's two-pass reel camera, a hand-over that re-poses a rig outside a frame): the neck and head limiter is idempotent for a frame time it has already seen
  (section 9, rule 3), so the second pass neither adds a step to the limiter's state nor makes the head lag.
- **Effort** (batter): `0.6 * smooth((t - swing)/120) * (1 - smooth((t - end)/500))`, end = stroke end or contact (+900 ms without), x1.5 slower in Reduced Motion; added to channel 18 at read time
  at detail 2. Nothing before his own input.
- **Weight** of the head pass: a delivery's script fades the head in from the clip over its first 400 ms (`smooth(t/400)`); a scene shown for the first time fades in over 500 ms; otherwise 1.
- **Detail by head size**: the stage computes each head's size on screen every frame and calls `detailForPx` with hysteresis (section 4).
- **Rolling laps**: a scene between balls goes round every 60 s; the next lap is a plan of its own (key `"{key}.{lap}"`) baked ahead and faded into at the seam.

## 9. The stage binding (what the bones and the shader get)

- `applyLife(pose, ch, w, scale)` (a pose hook, before the planted feet and the arm IK, pre-mirror): root x += swayX/1000/scale, root z += swayZ/1000/scale; hips Z += swayRoll,
  spine Z += -0.6 swayRoll; chest X += -0.65 breath, spine X += -0.35 breath; spine X += -0.4 posture, chest X += -0.6 posture; spine Y += 0.4 twist, chest Y += 0.6 twist (all `* w`).
- Head pass (`turnHead`, on the **finished** bones after the arm IK and the glove solve): measure the head's line of sight and roll in the role frame; the plan's head in space
  brought inside the neck's range relative to the chest (yaw +-85 deg, soft out to 165 where it returns to the front; pitch 55 down, 60 up; `knee` easing at 90% of the limit);
  turn the neck 35% and the head 65% of the remaining rotation (yaw about the vertical, then pitch about the new left axis, then roll about the new line of sight), scaled by `w`
  and by 0.5 in Reduced Motion; **then** hold the neck and head to MOTION-SPEC section 9 (`limitHead`: 600 deg/s, +5000 deg/s^2, brake 6000 deg/s^2 for the batter always and for the
  bowler from 150 ms after the release; a bone remembered from a frame at most 50 ms earlier is continued).
  **Three rules added by WEB-FIX-B (2026-11-07; the cause of the head hanging down and of the one-frame head flip at a heading of +-180 deg; the core and its golden are unchanged; port all three):**
  1. *The pulled look keeps the plan's world pitch* (`reachable()` in `stage/pose.ts`). A plan target behind the chest is pulled to the chest front, but the pitch used to stay the
     chest-frame pitch measured behind it (64 deg for a plan of 24), which clamped to 55 plus the chest lean and hung the head 85 to 89 deg down. Now, after `y2 = yawReach(yc)`:
     `h` = the world y of the chest-frame direction `(sin y2, 0, cos y2)`, rotated by the accumulated hips * spine * chest rotation; `pw = planPitch + asin(clamp(h, -1, 1))` in degrees;
     `pk = pc + (pw - pc) * smoothstep((|yc| - 85) / (165 - 85))`; `p2 = knee(pk - mid, half) + mid`. For `|yc| <= 85` the weight is 0 and nothing changes (the live look at the batter is
     bit-equal).
  2. *A turn near 180 deg tapers to nothing* (`turnHead`). After `angle = 2 * atan2(|r|, w)`: `angle *= smoothstep((pi - angle) * 2)` (identity below 151 deg, 0 at 180 deg). The axis of
     a rotation of exactly 180 deg is undefined, and split 35% / 65% it showed as neck 61 deg and head 106 deg in one frame; the rate limiter hides it in a single pass but not
     in a two-pass camera.
  3. *Posing a frame twice equals posing it once* (`limitHead`, section 8). Each bone's state from the start of a frame is kept; a call with the same frame time (+-0.5 ms) restarts
     from it instead of continuing from the first pass's result.
  Measured on the web (118 deliveries in three scripts; builder, not evaluator-verified), head pass alone: neck or head step over 40 deg 57 runs (max 139.6) -> 0 (max 38.3); head more than
  55 deg below the horizon after the turn 65 runs (max 89) -> 1 (55); the striker's head more than 60 deg below 26 of 118 replays (86) -> 0 (51); the bowler's head within 10 deg of the
  batter from the gather to the release 4,428 of 4,428 frames both before and after. Test to copy: `tests/unit/render3d/bowlerFollowThrough.test.ts` (heading sweeps through +-180 deg at
  chest leans 0 / 35 / 55; head pass alone under 40 deg a frame; as drawn at most 12 deg a frame and the head never more than 60 deg down; posing a frame twice equals once).
- Eyes (`eyesFor`): gaze minus the head as drawn, soft-limited to +-35 deg yaw / 28 pitch (10 in Reduced Motion); iris offset `0.0115 m * sin(angle)` (x for yaw, -y for pitch);
  the upper lid follows a downward look (`lid = blink + (1 - blink) * 0.4 * follow`, follow = max(0, clamp(pitch/30, -1, 1) * 0.5)). Unity: use its own eye rig; the numbers are the web shader's.
- Expression mixer (`mixFace`): `uExpr = clamp(0.7 * sum_i w_i * E_i, -1, 1)` with E = concentration [-0.6,-0.1,0,0.35], effort [-0.9,-0.5,0.45,0.6], frustration [-1,-0.8,0.15,0.2],
  relief [0.7,0.6,0.25,0], celebration [0.9,1,0.9,0.25]; the four numbers are brow (+ raise / - frown, x0.004 m), mouth curve (+ smile, x0.0045 m), mouth open (x0.008 m), eyes squeezed
  (eye height x(1 - 0.55 w)). A Unity rig with blendshapes maps the same four numbers; **no morph pack and no new bones were added for this contract** (decision T0 open).

## 10. Where it plugs in on the Unity side (expected; as built: section 13)

- The pose pipeline in `Runtime/Presentation/Production/Characters/ProductionCharacterRig.cs` (`SampleAndApply` line ~703 and `ApplyPose` ~490, with `ProductionFootLock`, `ProductionHeroArm`,
  `SetCanonicalBatPose` ~1537, `ProductionBatterBodyModel`, `ProductionGaitPresenter` for the run-up): the life pass after clip sampling and before the planted-foot and arm solves; the head pass
  last, on the finished bones. Not in the release-point measurement (the web keeps the planted feet and the release hand identical with or without the Director).
- The plan requests where a script is built: `bowl()` (queue only), the result (hand-over), replay / demo / close-up (bake at once, off the live path), the scene between balls (when shown).
- Callbacks from the script's ball track (`sampleBall` equivalent) and the actors' tracks (`evaluateActor` equivalent), in the pre-mirror frame.
- The Reduced Motion setting and the camera's head sizes on screen are inputs.

## 11. Golden fixture and tolerances

`golden.json`: 5 cases (striker six with the extrapolated pursuit, striker wicket in Reduced Motion, bowler, two scenes between balls with the seam, one with a 20 px head) each with the key, person, anchors, the
test world (`tests/unit/render3d/director/world.ts`: a ballistic ball with one bounce, the bowler's head and hand, the batter's eye; about 150 lines to port), the plan events (float32) and 14..30 exact trace frames
(Int16 x 24) plus an FNV-1a32 hash of the whole trace's bytes. A port matches: keys exactly; events within 1e-3; trace samples within 2 steps; the hash only in the same engine. Any change on the web side
fails `golden.test.ts` and must be a deliberate new freeze (`UPDATE_GOLDEN=1`, new `contract` string).

## 12. What the port must not do

Add bones or a morph pack; read the plan, result or ball earlier than the rules above; use `Random`, `Time.time`, the frame count or the wall clock; bake in the frame that builds a result script;
allocate per frame; change a parameter without a new freeze; show expressions for a head under about 38 px; drift or fidget in Reduced Motion.

## 13. The Unity stage binding as built (UNITY-E2, 2026-11-07; builder-measured in the Unity Editor on an Apple M1 Pro; not evaluator-verified; no device)

1. **Where it lives.** `Runtime/Presentation/Production/Director/Stage/` (`StageTypes`, `StageDirectorWorld`, `DirectorStageRuntime` = `runtime.ts`, `StageSpecs`, `DirectorStageGeometry`, `DirectorLife`, `DirectorHeadPass`) and the world partial
   `Runtime/Presentation/ProceduralPracticeWorld.Director.cs`. Two edited files carry the hooks: `ProceduralPracticeWorld.cs` (partial; `ConfigureScene`, `BeginDelivery`, `AcceptResult`, a `Tick` wrapper) and
   `ProductionCharacterRig.cs` (`DirectedLife`, `PoseSerial`, `TryGetVisibleHeadBones`, `ApplyDirectedLifeToDrivers`, `FollowHeadPassWithCap`, life-free recovery bases). The core (`Director*.cs`) is untouched.
2. **Frames.** The core works in the web's physics frame; Unity's world is that frame reflected in x by `PresentationMirror` (-1 right-hander, +1 left-hander). A world quaternion maps to the physics frame by (x, m y, m z, w) and the head
   pass's turn maps back the same way. The pointing error against the plan is 0.0000 deg for both roles and both mirrors.
3. **The frame, in order.** Top of `Tick` (`DirectorBeginFrame`): the head passes are taken off the bones (`Undo`), the clock advances, the script and scene time are chosen, the plans are sampled, each rig's life is set (with the seam).
   The world poses the frame as it always did; the rig adds the life inside `ApplyPoseInternal` after the joints are assigned and before the hero is synchronised and before every planted-foot and arm solve. End of `Tick`
   (`DirectorEndFrame`): the head pass LAST on the finished bones, the cap re-placed on the head, then the spare-time bakes (a 0.5 ms budget, at least one 64-step slice). Neither pass runs in a release-point measurement.
4. **Plans.** `BeginDelivery` and `AcceptResult` only queue. A result stands on the live plans (bit-equal until the take-over) while its own are baked in spare slices (a result with no spare time at all replays the integrator once, about
   12 slices, 0.4 ms on the Mac); a replay or demo is built from the result alone with the same key (`DeliveryTakeKey(seed, null, null)`); the scene between balls is baked ahead while the ball is on. Any exception switches the Director off for
   the session (`DirectorFail`); the world draws as it always did.
5. **Honesty.** The ball a plan sees is the ball as drawn: visible until the earlier of the flight's end and the earliest contact plane, whatever swing is committed; the live spec has no contact, outcome, dead ball or stroke end; the result
   geometry uses the flight until the first touch, then the trace ball. Pre-input honesty is byte-identical to the Director-off world (0.000 deg / 0.000 mm).
6. **Quiet windows.** The plan's life channels are zero (striker release - 600 ms to stroke end + 800 ms, bowler run start to release + 150 ms); the drawn trunk, hips, legs, bat and root are bit-identical to the Director-off world there
   (the bowler 0 of 153 frames in 14 runs; the striker 2 of 2,362 frames, at most 0.0002 mm); the arms carry the world's own arm-IK memory of the breathing before the window (at most 0.26 mm in 8 of 14 runs; up to 10.1 mm and 2.5 deg in
   isolated frames of the other 6), the hands at most 0.011 mm, and the gloves stay on the handle within 0.52 mm (gate 2 mm).
7. **The head pass** is the web's with the three rules of section 9 (the pulled look keeps the plan's world pitch; a turn near 180 deg tapers; a frame posed twice equals once, in the bone caps and in every other piece of the pass's state), the bone
   caps (600 deg/s, 5,000 deg/s^2, brake 6,000 deg/s^2 for the striker always and the bowler from release + 150 ms), and the world guard below. `Undo`/`Redo`: the turn is taken off the bones before the next frame's solves (the arms' IK on a held
   pose and the neck clearance must not read it) and given back on the re-posed bones after `AcceptResult`.
8. **Decisions beyond the web (lead rulings 2026-11-07; each has a builder seam).**
   - *The striker's head holds still in space from the press to the result* (`DirectorHoldsHeadInCommittedSwing`, default true): UNITY-5's rule "through the committed swing, until the result, the torso is where the press left it" applied to the head;
     entry = the brake's stopping point, release = a smoothstep over 200 ms from rest. Without it the head follows the ball 7 to 29 deg before a result that arrives 3 to 10 frames after the commitment and 24 existing hand-over tests fail; with it the head
     moves at most 0.85 deg from the commitment to the result (40 classes). A replay has no press, so a live ball and its replay differ in the head in that window only, as they already differ in the body there.
   - *A delivery with no flight or no ideal contact is not directed*, and a result continues only a directed delivery (or is a replay): the legacy tests' hand-made deliveries run undirected.
   - *The head world-speed guard.* The bone caps are local (MOTION-SPEC section 9 measures a clip's local bones); a viewer sees the world rotation, where neck and head add (735 to 762 deg/s seen on a hold release against 720). Where the head the
     world drew already turns faster than the cap in the world, the Director adds nothing to it; elsewhere the bone caps alone apply (a general world cap made local pops of 477 deg/s a frame, over the 300 deg/s spec cap). **UNITY-9 (2026-11-07) widened it:** the guard that kept the Director from adding to a body already turning faster than the cap now also holds the head to 600 deg/s in the world when the body is quiet (the neck's 600 and the head's 600 add: the bowler's look back through the walk-back drew 930 to 1,430 deg/s, now at most 600.2 on ten cases; `DirectorHeadPass.WorldCapEnabled`, world seam `DirectorHeadWorldCapEnabled`). **Named residual:** the
     left-hander's grounded-attack and complete-miss walk-back, 1,273 and 1,042 deg/s against 1,036 and 833 with the Director off (+23% and +25%), because the clip's own chest turns at about 790 deg/s there (1,450 for the right-hander).
   - *The life has a seam* at the idle-to-delivery switch for the striker and for the scene between balls (400 ms, the head's decay); the bowler's life is zero from his first run-up frame by the quiet-window rule, so his hand-over landmark jump
     goes from 0.31 cm to 0.39 to 1.00 cm (gate 3 cm).
9. **Reduced Motion.** Zero life displacement; the head pass halves its turn (`RmGainX` 0.5); every bone but the neck and head is bit-identical to the Director-off world in every frame (14 runs).
10. **Builder seams.** `DirectorEnabled` (env `VANDE_DIRECTOR=off`, Editor and development builds only; a device build is always on), `DirectorHoldsHeadInCommittedSwing`, `DirectorHeadLimiterEnabled` / `DirectorHeadPass.LimiterEnabled`, `DirectorFailureForEvidence`.
11. **Cost (Unity Editor Mono on an M1 Pro; indicative).** Tick median 1.07 ms off against 1.08 ms on (+14 us; mean +63 us with the bakes). Plan sampling and life set 0.9 us and the head pass 2.9 us a frame per actor (3.8 us; target 5: met); the rig's life
    2.3 us a pose, 2 to 3.6 poses a frame while the life is on, so 8 to 12 us per actor-frame (target 5: **not met** while the life is on; the saving is known: apply the life during the joint assignment instead of reading back). Bakes: 94 of 954 frames carry
    a slice (p95 0.51 ms); the accept frame bakes nothing. No allocation in the world's frame path, the rig's life, the stage or the head pass (an IL scan; gen-0 count 0). Size: runtime source +160,381 B; the whole Runtime compiled in Release +43,520 B (899,584
    against 856,064) on top of U-E1's +41,984 B. APK, fresh-install and IL2CPP deltas and every phone CPU, memory and thermal figure are UNPROVEN.
12. **Tests and evidence.** 99 tests (`Tests/EditMode/Director/{DirectorHeadPassTests, DirectorStageRuntimeTests, DirectorLifeRigTests, StageAllocationScan}.cs`, `Tests/EditMode/DirectorWorldTests.cs`); probes
    `Editor/Evidence/VandeHumansEvidence.Director.cs`. Full EditMode 1,369 total / 1,360 pass / 4 stale fail / 5 skipped (baseline 1,270 / 1,261 / 4 / 5); `release/product-sequence/stage-1-practice/wedge/humans/unity-e2/GATE-TABLE.md` has every gate
    before and after. Replay identity: a live result plan and its replay plan 593 of 593 and 770 of 770 frames bit-equal, two replays 0 of 720 frame-rigs differ.
