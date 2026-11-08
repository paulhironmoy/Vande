# Camera batting (`src/input/camera`)

The camera is one more input type next to touch, mouse, pen and keyboard (owner decision 2026-11-08). The player chooses it; it is never the
default and never required. Web: mouse (default) and camera. Android: touch (default) and camera. Keyboard always works. The camera becomes
**one virtual finger** on a fixed virtual surface and ends as a `NormalizedSwing` with `pointer: 'camera'`, made by the same `GestureTracker` and
`normalizeGesture` as every other input: one authority, no hidden assistance, replays keep the swing and never a picture.
Owner of this document and of `src/input/camera/**`: CAMERA-CORE. Written 2026-11-08T09:15Z; the evidence copy with the research is
`release/product-sequence/stage-3-chase/CAMERA/CAMERA-DESIGN.md`. **Nothing here says how a person experiences camera batting: that is UNPROVEN.**

## 1. Pose engine

- **Engine:** `@mediapipe/tasks-vision` **0.10.35** (exact pin; Apache-2.0; the last 0.10 release, 2026-04-27; the first line with a module-worker loader), the
  **Pose Landmarker Lite** bundle `pose_landmarker_lite.task` (float16, 5,777,746 B). Not 0.10.32 (ANT's: no module loader) and not 1.2.2 (14.6 MB WASM, four days old).
  Files, sizes, sha256 and licences: `docs/licenses/mediapipe-tasks-vision-0.10.35/NOTICE.md`. All three parts are stated Apache-2.0; the model's licence is written in its
  model card only (open risk, reported in the notice).
- **Model limits (the card's own):** one person, within about 4 m, head visible, z not metric (x and y only are used), Lite is the least accurate variant and varies
  by region, skin tone and gender. That is why the camera is opt-in and touch/mouse stay available at all times.
- **Worker:** a module Web Worker started from a `blob:` URL made of `worker.bin` (`src/input/camera/pose.worker.ts` bundled with the MediaPipe JS and the Emscripten
  loader inlined; `worker-src blob:` already allows it, no CSP or service-worker change). It fetches nothing: the page passes the WASM and the model as bytes. MediaPipe's
  creation call skips script loading when `wasmLoaderPath` is empty and `self.ModuleFactory` is set, and Emscripten reads `self.Module.wasmBinary`; both are set before every
  creation (MediaPipe clears them). **This depends on internals of 0.10.35**; the model smoke test under the production CSP is the check (§11).
- **Delegate:** GPU first, then CPU (`delegate: 'auto'`); the one chosen is reported (`ready.delegate`, `session.stats().delegate`). **Warm-up:** one detection on a blank
  picture before the first real frame. Options: `VIDEO` mode, one pose, detection, presence and tracking confidence 0.55, no segmentation.
- **Protocol:** `CAMERA_PROTOCOL = 1` in `protocol.ts`; a worker and a page that disagree refuse each other. Only numbers come back (33 x [x, y, z, visibility] and
  durations); the worker's `performance.now()` has another origin, so it never returns timestamps of its own.

## 2. Loading

- **The pack** (`models/pose/0.10.35/`, built by `scripts/camera/pack.mjs`, described in the app by `__CAMERA_PACK__`): `engine.bin` (the module-variant WASM, gzip-9: 3,273,970 B,
  11,153,641 B unpacked), `worker.bin` (gzip, about 84.5 KB, 323 KB unpacked), `model.bin` (the `.task` file as it is, 5,777,746 B). **Download about 9.14 MB** against 17.3 MB raw.
  `.bin` names so no host re-compresses them: the bytes on the wire equal the bytes stored and the progress is exact.
- **Unpacking:** `DecompressionStream('gzip')` (Chrome 80+, Safari 16.4+, Firefox 113+, Android WebView 80+). A browser that can run the engine's WASM SIMD (Chrome 91+, Safari 16.4+,
  Firefox 89+) has it except Firefox 89 to 112: there the camera option is hidden as `unsupported` (no uncompressed fallback: 17 MB would break the size promise).
- **Download:** each missing file is fetched with a stall timer (8 s without a byte), one retry, cancel, exact progress, a sha256 check before it is stored, and a free-space check
  (3 times the pack). Nothing is fetched before `start()`; a cold first ball makes 0 camera requests. A wrong hash is refused (`verify_failed`) and nothing is kept.
- **Storage:** IndexedDB (`vande-camera`), keyed by pack id; older ids are deleted on every start; "Clear Practice data" deletes it (`forgetCameraPack`). **Not Cache Storage:**
  in the Android shell `src/pwa/register.ts` deletes every Cache Storage key at every launch (R-4). Offline Practice works after one download.
- **Never precached, never in the first install:** `vite.config.ts` `globIgnores` has `models/**`; the default Android build removes `models/pose` (`dropWebOnlyAssets`) and shows no
  Camera option. `VITE_CAMERA_BUNDLED=1` (the owner's sideload build, `docs/ANDROID_RELEASE.md`) keeps the files in the app and reads them same-origin each time (no download, no copy).
  `VITE_CAMERA_MODEL_BASE_URL=https://...` (a store build) adds that origin to `connect-src` and downloads from it; **not exercised in this run** (nothing is deployed): UNPROVEN.
- **Headers:** `public/_headers` sends `Permissions-Policy: camera=(self)` (it said `camera=()`, which blocks the camera for the whole site).

## 3. Camera capture

Front camera only, 640 x 480 at up to 30 fps. A ladder of requests, never `exact`, never audio: 640x480@30, 640x480, 320x240, user-facing only, any. An over-constrained request steps down;
a rear camera (`facingMode: 'environment'` or a back/rear label) is skipped for a front device, else the failure is `rear_only`. Errors are named for the UI: `blocked`
(NotAllowed/Security), `none`, `busy` (NotReadable/Abort), `unsupported`, `insecure`, `offline`, `space`, `download_failed`, `verify_failed`, `engine_failed`, `black`, `too_slow`
(`types.ts` `CameraProblem`). Frames come from `requestVideoFrameCallback` (a 30 Hz timer where it is missing); each picture is shrunk to 384 px wide (`createImageBitmap`), posted to the worker
and closed there; while the worker is busy new frames are dropped, never queued, so latency cannot build up. The worker reads a 16 x 12 shrink's mean brightness every 15th frame (black
picture: privacy shutter or cover; dim: poor light); only that number leaves the worker. The camera stops on `stop()` (CAMERA-UX calls it when the page hides or the player leaves);
`start()` after `stop()` works. In-app browsers are detected by CAMERA-UX before `start()`. On Android the session first asks ANDROID's permission helper (`VandeCameraAccess`: status, request, open settings, no capture, R-14).

## 4. Pose to GestureSamples

Landmarks used: shoulders 11/12, wrists 15/16, elbows (a reach check), nose (framing). Sides are found from picture position (the model labels by layout), so a mirrored or raw feed gives the same player coordinates.
`u` = shoulder width in the picture (slow average, frozen while a contact is open), so distance from the camera does not change power. Hand point = visibility-weighted mean of the usable wrists
(weight 0 at 0.5, 1 at 0.8; a wrist farther than 2.2 u from its shoulder is an outlier). Player's right is +x; hands up is +rise. Everything is in `src/input/camera/constants.ts`.

| Player does | Mapper sends the tracker | Tracker/normalizer result |
| --- | --- | --- |
| hands still in front | nothing (the rest anchor follows them; a dead-band of 0.04 u holds the output) | nothing |
| hands rise 0.25 u on 2 frames while the delivery is live | `pointerDown` at the last still frame, then the rise as moves: y = 130 + 156 px per u of rise (a held peak), x damped by 0.5 | `swingStart` cue, `loading`, then `tracking` once held |
| hands already up and still when the ball is released | press at the release moment, one move | the same |
| hands held at the top | held samples | `tracking` (hold time never enters the read) |
| hands come down: at least 0.2 u below the top, 2 frames, fast enough (1.4 u/s after a backlift of 0.6 u or more, 2.0 u/s after 0.35 to 0.6 u), decided within 300 ms of the top; waving cannot repeat a stroke because a new contact needs the hands to rest first | the frames from the top are replayed with their own times, straight-line samples every 5 ms, forward gain 7 on both axes | `committing`; the swing starts at the true onset; direction, power, elevation from the first 40 ms |
| a small backlift (under 0.6 u) then a gentle push (0.5 to 2.0 u/s) | a tap at the top's time (`cancel`, `down`, `up` 40 ms later) | the defensive straight bat (`kind: 'defend'`) |
| big backlift, hands lowered slowly | the held samples, then `pointerUp` | `intentional_leave`: no swing, never the legacy behind-square flick |
| small raise and lower, a fidget | `cancel` | nothing; the delivery stays armed |
| tracking lost (no valid pose for 300 ms), or a jump no person makes | `cancel` (an uncommitted contact leaves the delivery armed; after commit the tracker keeps the swing) | |

- **Direction** is the slope of sideways against down over the whole descent seen at the decision (least squares through the top, about 66 to 100 ms at 30 fps), replayed as a straight line.
  Camera noise swamps the sideways movement of the first 40 ms alone: with 0.02 to 0.035 u of landmark noise the first-40-ms bearing had a standard deviation of 35 degrees; this estimate gives 6 to 10 degrees (synthetic, `tests/unit/input/camera/mapper.test.ts`).
- **Power** is the tracker's own log-mapped speed of the first 40 ms after the swing's start. With the gain of 7, a 140 ms downswing reads about 1.0, 200 ms 0.77, 250 ms 0.64, 300 ms 0.55, 400 ms 0.41, 600 ms 0.22 (30 fps, synthetic). **The gain is UNPROVEN for real people.**
- **The defence boundary (2026-11-08, after SYNTH-VIDEO-5).** The rendered defence was read by the pose model as a 0.45 u backlift, exactly the old boundary, so noise decided and it read as a weak attack. The boundary is now 0.6 u, chosen from geometry and measurement and not from the clips: a defensive lift is the hands going from the waist to about the chest (0.3 to 0.5 u), an attacking backlift goes to the shoulders or above (0.8 u and more), the pose model's wrist error is 0.035 to 0.09 u RMS with 0 to 27 ms of lag, and the shoulder width in the picture can differ by 12 to 18% from the player's proportions, so a class needs a margin of about 0.1 u on both sides; 0.6 u is the middle of the gap. Tests: a gentle push after 0.3, 0.4 or 0.45 u is a defence in at least 90% of noisy trials also when measured 18% bigger; an attack after 0.8 u or more is an attack. **A real player's small backlift may still sit near the boundary (UNPROVEN); a backlift of 0.5 to 0.6 u measured 18% bigger already reads as an attack.**
- **Elevation (loft)** is the tracker's: backlift height (pullback depth) plus early speed, capped by power. **The owner's brief says "follow-through height". That cannot be done under the one authority:** the swing is emitted 40 ms
  after its start and the follow-through comes 100 to 300 ms later; waiting would delay the swing and the bat, or need a second elevation authority. Decision C-01: backlift height is the loft signal.
- **Handedness** is applied once, by the tracker and `normalizeGesture`, exactly as for a finger (a left-hander swinging to their own left gets the off side). **Mirror:** raw and mirrored feeds give equal swings.
- **Readiness port (for CAMERA-UX and the flow):** `PoseReadiness` in `types.ts` (`inFrame`, `shoulders`, `battingHand`, `head`, `distance`, `headroom`, `handsReadyZone`, `still`, `poorLight`, `stableMs`, `ready` after 400 ms stable). **Tracking lost:** `CameraSessionStatus.lost`.
- **One contact at a time:** the camera does not open a contact while a finger, mouse or pen is down (`pointerIsDown`); the flow accepts one gesture per delivery.

## 5. Timestamps

Every sample carries the frame's **capture time**, not the time inference finished, so a late frame keeps the moment the player moved (`time.ts` `normalizeFrameTime`): `captureTime` from `requestVideoFrameCallback`
when it is present and sane, else `presentationTime`, else the callback time; a time in the future or older than 500 ms is replaced by the callback time (the fake camera device reports `captureTime` up to about 14 ms ahead:
it is clamped, not rejected); strictly increasing (+0.5 ms). All on the main thread's `performance.now()` clock, the same as pointer events. The tracker decides from sample times only, so delivery delay changes when it learns, never what it decides (tested: 0 and 90 ms of delay give equal swings).

## 6. Smoothing

No low-pass filter on what the tracker reads: it would delay and shrink exactly the first 40 ms. The only shaping, identical on every delivery and for every player: the dead-band (0.04 u, 0 ms delay), a plausibility gate on the wrist (no smoothing), the held peak while loaded,
the whole-descent direction estimate (causal; it adds 0 ms to the swing's start and uses frames already seen at the decision), and straight-line samples every 5 ms between two real frames (so the tracker's "silence" rule, which assumes a 33 ms gap is a pause, does not place the start late).
**Cost, measured on synthetic traces:** at 30 fps the swing's start is within about -15 to +12 ms of the true onset (standard deviation 6 ms), power varies by about +-0.1 with the frame phase; at 60 fps half of that; at 15 fps it is rough (power sd 0.3): below 20 fps the camera is not offered ("too slow").

## 7. Calibration

`src/input/calibration.ts` has a **`camera`** modality (`MODALITIES`, `resolveCalibrations`): its own offset, stored by `src/practice/store/calibration.ts`, applied to camera swings only (touch, mouse, pen, keyboard unchanged, regression tests). It is **0 until measured, never borrowed from touch, never estimated**.
A camera attempt's error is the swing's implied contact time minus the line crossing: `calibrationError(contactPerfMs, crossPerfMs)`, the same helper the tap test uses; the screen that runs it belongs to its owner.

## 8. Latency budget, plainly: the camera cannot meet CTL1 by construction

CTL1 (locked rubric): input to the first presented frame with the bat moving, p95 <= 50 ms on Premium and Balanced, <= 67 ms on Classic, measured from the event timestamp. For a finger the event is the touch-down. For the camera the earliest honest event is the frame that
**proves** the movement: the mapper needs 2 valid frames to see a rise and 2 to 3 to see a stroke, which is **66 to 100 ms at 30 fps and 33 to 50 ms at 60 fps before any inference**, then capture-to-callback, bitmap, worker inference, the way back and the stage's own frame (up to 16.7 ms).
The sensor's exposure, readout and USB delay come first and are invisible to the page. **Camera batting therefore does not meet CTL1 as written, and no locked rubric is relaxed here.** Measured stages and numbers: `release/product-sequence/stage-3-chase/CAMERA/INDEX.txt` (rows CAM-13, CAM-14).

| Stage | Where | Value |
| --- | --- | --- |
| 1 light to sensor timestamp | outside JavaScript | UNMEASURED (no real camera was used); calibration absorbs the constant part |
| 2 frame callback after capture time | `now - captureTime` | fake device only: -13 to +10 ms (SYNTH-VIDEO probe); real cameras UNPROVEN |
| 3 bitmap and transfer | main thread | not timed on its own; inside the pipeline row below |
| 4 inference | worker | CPU delegate p50 15.1 to 15.4 ms, p95 15.6 to 16.7, p99 17.9 to 38.0 (headless Chromium on this Mac, a fake camera at 30 fps, 2026-11-08); GPU delegate on software graphics p50 83.4 ms, p95 111.7 (a real GPU is UNPROVEN, so the session switches once to CPU when the GPU one is slow) |
| 5 result, mapper, tracker | main thread | p50 0.4 us, p95 1.2 us, p99 3.0 us per frame over 102,000 synthetic frames |
| 6 frames to recognise the stroke | design | 66 to 100 ms at 30 fps |
| 7 stage frame to bat | stage `lastInputToBatMs` | up to 16.7 ms at 60 Hz (not run for the camera: UNPROVEN) |
| 2 to 4 together | frame time to landmarks back on the page | p50 19.4 to 27.3 ms, p95 28.4 to 33.4 ms (CPU, fake device, includes up to one 33 ms frame wait) |

**Options for the owner (nothing is chosen for him):** (A) keep the rubric as written and report the camera as failing CTL1 with its measured stage numbers, accepting that the camera modality carries its own latency under CTL9; (B) shrink what can be shrunk (60 fps capture, GPU delegate, 256 px frames:
this narrows stages 3, 4 and 6 but cannot reach 50 ms) and report it; (C) amend the rubric text so that for the camera the event is the frame that proves the onset (a rubric change is the owner's decision, never mine). Predicting the player's movement was considered and rejected (hidden help). **What stays exact:** the swing's start is on the capture clock, so a late detection does not make a late swing; only the visible bat is later than for a finger.

## 9. Renderers

Three.js and Classic receive the same swing through the existing cues (`onSwingStart`, `onIntent`, `onContactState`, `onGesture`) from `session.bat`; no renderer reads landmarks. Unity: a camera swing is a `NormalizedSwing`; the bridge carries no input modality (`host.provisional_swing`), so **no packet or validator change is needed** (UNITY's review and tests, `S/chase/requests/UNITY-camera-with-unity.md`).
Whether the WebView can keep a `getUserMedia` stream while Unity renders on Android: **no blocker found** (Unity is a same-activity overlay, the WebView is never paused), **UNPROVEN on a device**; React is hidden under the Unity layer during live and dead ball, so the camera screens must work from the DOM before and between balls. In this run the camera is never used under Unity (9.1); the camera driver still does not arm while `flow.stageOwnsInput()`, and no native camera plugin is built.

### 9.1 Camera while Unity renders: it does not (R-43, STAGE-CAMERA)

Owner brief 2, section 8. The Unity stage owns the batting input and hides React, so the camera's consent, readiness and lost-tracking cards could not be seen under it. The rule: **while Camera is the control in force the stage is a web renderer (Three.js tiers or Classic, whatever the device check allows), never Unity, even in a Unity-linked build; Unity stays touch-only in this run.** No native code, no bridge, contract, physics or result change; the swing is the same `NormalizedSwing`, which the bridge would also carry unchanged (code-read; `getUserMedia` under the overlay has no blocker in code, UNPROVEN on any device, and we do not use it).
How (`src/practice/ui/flow/stageHost.ts`; the camera question goes to the gate PracticeApp already gives the flow): with Camera in force at stage creation the factory is asked with `skipUnity`, and a Unity measurement left by an earlier visit with a finger is not used to profile the web renderer. When the control becomes Camera while Unity is the stage (setup screen, Settings or the between-balls chip) the host swaps once, at the next ball, through `applyPending`, the path a renderer fallback takes. It never swaps inside a delivery (the control guard refuses a change then, and the host acts only between balls). Only the renderer changes: the quality, the timing help and the device check stay as they were. One calm notice, `camera_web`, says it (the dead-ball note). When the control moves away from Camera the web renderer stays for the rest of the visit (no swap back); the next visit starts normally, so Touch is on Unity again.
For the Unity-linked sideload builds (b: `--preview --unity`; c: `--preview --unity --everything`; Camera is offered only in a build that carries the pose pack): Touch plays on Unity exactly as before; Camera plays on Three.js or Classic, so its cards show as on the web and `data-vande-practice-renderer` is `three-webgl` or `classic` (never `unity-native`) while Camera is in force. The first Camera ball after Touch pays one stage rebuild. Tests: `tests/unit/practice/ui/flow/stageHost.camera.test.ts`. **UNPROVEN:** anything on a phone or the emulator (how long the rebuild takes, memory, heat, whether the web stage holds its frame rate with the pose model running).

## 10. Owners and contracts

| Path | Owner | Notes |
| --- | --- | --- |
| `src/input/camera/**`, `tests/unit/input/camera/**`, `scripts/camera/**`, this document | CAMERA-CORE | worker, loader, store, capture, session, mapper, driver, synthetic traces |
| `src/practice/ui/camera/**` | CAMERA-UX | consent, guide, preview, download, readiness card, troubleshooting; reads `CameraSession` (`createCameraSession`) |
| camera e2e and fixtures | SYNTH-VIDEO | VC17 renders; `window.__vandeCamera` exists in test builds only (`VITE_PRACTICE_TEST_HOOKS=1`) |
| control choice | CONTROLS | |
| `src/contracts/practice.ts`, `flow/types.ts`, `store/calibration.ts`, `PRACTICE_KEYS.camera` | lead (R-9, done) | `'camera'` is the fifth input modality; no other contract changes |
| `vite.config.ts` (plugin, `globIgnores`, `dropWebOnlyAssets`, CSP origin), `public/_headers`, `package.json` (one exact dependency), notices, `scripts/check-bundle-size.mjs` | CAMERA (R-4, R-8, R-25) | smallest edits, listed in the final report |

Contract version: unchanged; Unity bridge v7 is UNITY's and unaffected. Size and frame-time risk: first load 0 bytes (`models/**` never precached, 0 requests on a cold first ball); the pack is 9.14 MB only after the player chooses Camera; frame time with the camera on is measured in §11.

## 11. Test and measurement plan

- **Unit (`tests/unit/input/camera`):** mapper and classes (drive, pull, loft, defence, leave; 30 trials each; right and left; mirrored and raw; near and far; noise, dropped and late frames; lost tracking; byte-equal second run), 160 no-swing traces (0 swings), integration with the real tracker, `normalizeGesture` and the frozen physics with replay, host and GPU-to-CPU fallback, loader (progress, stall, retry, tamper, cancel, cache, bundled), capture ladder and rear skip, the whole session with a fake worker, time normalization, calibration.
- **Test hook (test builds only, `VITE_PRACTICE_TEST_HOOKS=1`):** `window.__vandeCamera.inject(frames, { width, height })` plays `{ dtMs, landmarks: number[] | null }[]` (flat 33 x [x, y, z, visibility]; null = nobody in the picture) on the page clock, with each frame's scheduled time as its capture time, into the same path a worker result takes (mapper, tracker, readiness, lost) while the session is running; worker results are dropped meanwhile; `injecting` is a boolean getter. The branch is compiled out of production builds; `tests/unit/input/camera/hooks.test.ts` proves the guard (no hook without the flag), a drive trace giving one swing, and null frames giving lost.
- **Model smoke test (`scripts/camera/smoke.mjs`, through `heavy.sh`):** the real engine and model in headless Chromium under the production CSP and `Permissions-Policy`, a fake camera (a looped video of a public-domain photograph; the repository's camera e2e uses VC17 renders), first and second start (IndexedDB cache hit: 0 bytes), CPU and GPU delegates, a throttled 4G profile. Results and their evidence fields: `INDEX.txt`.
- **UNPROVEN:** how it feels, whether people control power and direction, real webcams and phones, battery and heat, Safari, Edge, the store-build download, a real Android WebView, the Unity-overlay camera.
