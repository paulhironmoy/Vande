# Practice: offline first-person batting

Owner of this document: the Practice UX workstream (`src/practice/ui`, `src/practice/store`, `src/perf`,
`src/i18n/practice`, `src/platform/orientation.ts`). Contract: `src/contracts/practice.ts`. Brief:
`docs/prompts/VANDE-PRACTICE-PROMPT.md`. Companion documents: `docs/PRACTICE_RULES.md` (overs, field, fielding,
running, scoring, replay), `docs/PRACTICE_PHYSICS.md` (delivery and contact physics, timing windows) and
`docs/PRACTICE_PRESENTATION.md` (camera, stage, input mapping in detail).

Status, honestly: everything below is implemented and covered by automated tests on a desktop browser and headless
Chromium (software rendering). **No physical Android device has been tested yet** (section 9 is the plan). No user
test has been run; the success metrics in section 7 are targets, not results.

---

## 1. Architecture: one implementation per concern

| Concern | The one implementation | Notes |
| --- | --- | --- |
| Delivery physics, bat–ball collision, fielding, running, scoring, dismissals, cricket constants and timing windows | `src/physics` | Deterministic in (record) → result |
| Over generation, the one-wicket innings state machine, summaries, coaching evidence, replay | `src/practice/game` | Pure reducer over `PracticeInningsState` |
| Normalized input (touch, mouse, pen, keyboard) | `src/input` (`GestureSurface`, `normalizeGesture`, `calibrationFromTaps`) | |
| Renderer, cameras, first-person stage and its 2D Classic implementation | `src/render3d` (`createPracticeStage`) | Plays its own delivery sound and haptics |
| Device benchmark and quality classifier | `src/perf` | Thresholds exported as named constants |
| Screens, flow controller, launch choice | `src/practice/ui` | Binds the modules above in one file: `ports.ts` |
| Local persistence (innings, settings, calibration, Build an Over draft, metrics) | `src/practice/store` | localStorage only; nothing is sent |
| Practice copy (en, hi, hi-Latn) | `src/i18n/practice` | Status: `src/i18n/practice/STATUS.md` |
| Landscape lock | `src/platform/orientation.ts` | Capacitor Screen Orientation on Android; Screen Orientation API in fullscreen on the web |

The flow controller (`src/practice/ui/flow/controller.ts`) sees the other workstreams only through structural
interfaces (`flow/types.ts`), so its unit tests run against fixtures, and `ports.ts` is the single place the real
modules are bound (the compiler checks every binding).

Per ball:

```
over plan (fixed before ball 1)
  → physics.flight(plan, bowler, conditions, seed, handedness)         the ball, fixed before the batter acts
  → innings: deliveryStarted, SAVED                                     in-flight protection
  → stage.bowl(flight) → release (performance.now() clock)
  → GestureSurface armed → onSwingStart → stage.beginSwing              the bat moves at once
  → onGesture → input.normalizeGesture(…, calibration)                  one NormalizedSwing for every device
  → physics.resolveDelivery(flight, swing, field, …, tier tolerance)    contact, ball, fielders, runs or wicket
  → innings: deliveryResolved(record), SAVED                            before anything shows the result
  → stage.play(result)                                                  the scoreboard changes after this
  → coaching card, announcement, local metrics, analytics
  → the next ball (quality changes are applied here, never during a ball)
```

## 2. Product rules (summary; the full rules are in docs/PRACTICE_RULES.md)

- A one-wicket innings of up to ten six-ball overs, starting at 0. Runs accumulate across overs. One wicket ends the
  innings at once; no second batter.
- Every over is fixed before its first ball (Random or Built) and is played in full before the next over can be
  chosen, unless the batter is out.
- Practice bowls no wides and no no-balls (all six balls are legal). See PRACTICE_RULES.md, "Wides and no-balls".
- The field is automatic (balanced for the bowler and the pitch); beginners never set it. A field radar shows it
  briefly before each over.
- Runs come from the physics (bat → ball flight → fielder interception → automatic running); no probability tables.
- No save-scumming. The in-flight flag is saved before a delivery is bowled and the result is saved before it is
  shown. Closing, reloading, killing the app, leaving to the menu, or the app going to the background during a
  delivery (the HOME button, a phone call, the screen locking) all resolve that ball as a leave through the physics
  (`resumeInnings`), exactly the same way. Leaving mid-delivery and continuing in the same visit settles the ball at
  once, so it can never be bowled again.
- That leave is a real leave: a ball that would have hit the stumps bowls the batter and ends the innings (seen on the
  Android emulator: HOME during a straight ball, out). This is deliberate. If an interruption paused or cancelled the
  ball instead, quitting at the right moment would be a way to escape a delivery after seeing it; and the outcome is
  always decided by the physics, never by the app. The player is told plainly: the pause panel says "The app was
  interrupted during that delivery, so it counted as a leave.", and on the next start the resume card says "The ball
  in play when the app closed counted as a leave." Nothing can be paused during a delivery from inside the app.
- Practice This Delivery and Repeat a Ball re-bowl the same plan and seed with a new swing, in a training context that
  never touches the innings, its storage or its score ("Practice ball · does not count").

## 3. User flows

**Launch.** On a normal start (the app opened at its root), before any sign-in, account, age question, network or
configuration, the shell shows `LaunchChoice`: **Practice** ("Experience batting") or **Skip** ("Continue to VANDE").
Deep links (invites, matches, cups, highlights, shared matches, `/practice` and every other path) never show it. Skip
continues to the existing home flow (onboarding on a new device). Practice needs nothing else.

**First session (guided).** Tapping Practice on a device that has not batted goes straight to batting (no menu):
Balanced pitch, Learn assistance, "Watch the ball. Tap to defend. Flick to hit.", one readable stock ball as a
separate non-scoring warm-up, then "What happened" (the result explained from the physics' evidence with one tip),
then the guided six-ball over, which counts. No field radar, RPM, energy, speed sliders or settings appear. After it,
the over summary offers **Next over** (a random over) first and **Build the next over** second. The landscape lock is
requested inside the Practice tap, while the browser still allows fullscreen. Target: the first delivery within about
ten seconds of the tap (measured as `practice_first_delivery.ttfdBucket` and in the local metrics).

**Menu** (portrait is fine): **Quick random over** ("Six unknown deliveries", primary), **Build an over** ("Define all
six deliveries", secondary), the pitch (optional and secondary: Balanced by default, Green, Hard & Bouncy, Turning),
an innings in progress with **Continue innings** / **New innings** (confirmed; the old score is final), the timing
check and Practice settings. Starting a new innings while one is saved always asks first. For a quicker first ball the
launch choice fetches Practice's own code when idle (no three.js), and the menu fetches the stage's code
(`preloadPracticeStage`). Neither adds bytes: the Android bundle is local and the web's service worker precaches every
chunk; they only make the code ready sooner.

**Build an Over.** One bowler for the whole over: pace or spin (pace band, spin type and arm under "More bowler
options"). For each of six slots: tap a target on the pitch map (the striker's stumps at the bottom, the batter's off
side on the off side, the legal area and length bands drawn from the game's own limits; arrow keys move it), pick a
delivery (plain names; hints under "More"), **Save to ball n**. The honest speed for the choice is shown ("About 136
km/h"). Any ball can be edited or replaced; the order is exact or shuffled once at the start. The draft is kept on the
device. Changing the bowler type asks before clearing the balls chosen for the other type.

**Live batting** (landscape): if Practice was opened with no tap yet (a direct link or a reload), one "Start batting"
tap comes first, so the audio unlock (its first press creates the audio engine) never lands on a swing; the Practice,
Quick random over and Continue taps normally carry it. Then the stage's canvas full screen; the GestureSurface across the lower part (the finger
never covers the delivery); a minimal scoreboard (score, overs, this over's balls as shaped badges, the bowler and the
pitch); Pause between balls (never during a delivery); the field radar before each over (about 2.4 s, or "Bat"); after
each ball a concise card at the top right that does not cover play: **PERFECT · Found the cover gap · FOUR**, **LATE ·
Outside edge · Caught behind**, **SOLID CONTACT · Hit directly to cover · DOT BALL** (timing in ms on a smaller line;
a not-out pad hit says why, e.g. "Not out LBW: it pitched outside leg stump"), with **Next ball** and **Slow-motion
replay**. The next ball follows by itself after 3 s. In portrait without a lock, "Turn your phone sideways" holds the
delivery until landscape ("Continue anyway" is offered on desktop browsers only).

**End of a survived over:** total score, overs left, balls faced, boundaries, timing summary (Perfect, Solid,
Mistimed, Missed, Left), scoring areas (a wagon wheel by the physics' regions, with the runs in words), the weakest
delivery (the game's ranking) with a repeat button, **Next over**, **Build the next over**, **Replay this over**,
**Repeat a ball** (1–6, non-scoring) and **End innings** (confirmed).

**After a dismissal:** "Out · Caught behind", the final score, "Survived 3 overs and 4 balls", why it happened (the
delivery, its movement when it mattered, the timing, the contact, aim against direction, how it was out, one tip),
**Watch the dismissal** (slow motion with diagnostics), **Practice this delivery** and **Start new innings**.

**After ten overs:** the complete summary (runs, balls, strike rate, boundaries, best over, timing, scoring areas,
runs in each over) and **Start new innings**.

**Replays.** Replay This Over plays the six recorded balls in order through `stage.replay`; single-ball replays open
in slow motion with the diagnostics on (ball trajectory, bat path, contact point and bat face drawn by the stage;
timing, contact, bat face angle, aim against direction, bat and delivery speed and where on the blade listed beside
it). Every replay re-simulates the record, so it is the identical delivery and swing.

**Panels and notices.** Modal panels (pause, the field radar, the warm-up explanation, the start tap, the
compatibility message) sit on a strong dim above the HUD, and a notice (an interrupted ball, a resumed leave, a step
down in graphics) is shown inside the open panel, never under it (`tests/e2e/practice-layout.spec.ts` checks it at
915×412 and 2400×1080). A notice clears when the next ball starts.

**Resume.** The innings is saved after every change. Opening Practice again offers to continue it; a ball that was in
flight is shown as resolved ("The ball in play when the app closed counted as a leave."). Going to the background
(HOME, a reload, which also fires "hidden" first) settles the ball as a leave at once and saves it with a marker, so
even when the OS kills the app before the player returns, the next start still says so. Persistence uses
localStorage, which Android's WebView commits to disk lazily: a hard kill within about a second of a write can lose
that write (seen on the emulator with a force-stop about 0.1 s after a write; HOME followed by an OS kill about 3 s
later kept it). The write order makes the realistic windows seconds wide: the in-flight flag is written as the
run-up starts and the record as soon as the swing is resolved. If the in-flight write itself is lost, the kill came
within a second of the run-up starting, several seconds before the ball would have been released, so the same fixed
ball is bowled again without the player having seen it leave the hand; if the record is lost, in-flight protection
still resolves the ball as a leave.

**Timing check** (optional): "Tap when the moving ball crosses the line", five counted taps (up to eight tries). Each
error is the tap's own event timestamp minus the moment the ball crossed (computed from the animation's start, never
from a frame); `calibrationFromTaps` (src/input) takes the median, clamped. Stored on the device and applied by
`normalizeGesture` and the stage's provisional bat.

**Settings:** assistance (Learn, Play, Real; from the next innings), batting hand (from the next innings), Learn's
landing cue, graphics (Automatic, High, Standard, Lite, Classic, never more than the device check allows; applied
before the next ball), the device check (tier and frame rate; run again), the timing check, **Clear Practice data**.
Five taps on the device-check line open the local diagnostics (assessment, reasons, this session's per-delivery frame
rates, the last input-to-bat latency, and the local counts).

## 4. Input mapping (summary; details in docs/PRACTICE_PRESENTATION.md, "Input mapping")

| Action | Touch | Mouse | Keyboard |
| --- | --- | --- | --- |
| Defend (straight bat) | Tap (lifted, or still for about 50–60 ms) | Click | Space or Enter |
| Attack | Flick: direction = intended scoring direction and swing plane, speed = bat speed, length = ground or lofted | Mouse flick, mapped to the same normalized values | |
| Leave | No gesture | No input | No key |
| Footwork | Automatic (Learn, Play); optional manual in Real | | WASD or arrows |

The swing starts at pointer-down (or a resting finger's first intentional movement); direction is read from the first
~40 ms of movement; nothing waits for pointer-up; timing uses the events' own high-resolution timestamps, never frame
numbers; the virtual bat travels about 120–150 ms (physics). The leave deadline (just after the ball passes the
stumps) is judged the same way: a swing whose press began before it still counts even if a busy main thread delivers
its gesture late, and input already queued is handled before a leave is declared (found in a software-rendered test
run where a late release callback had turned in-time swings into leaves; unit-tested). The keyboard uses the same start-time rule and bat travel,
so it has no immediate-contact advantage. The stage moves the bat provisionally from `beginSwing` and records the
first frame showing it moving (`stats().lastInputToBatMs`, the input-to-bat metric).

## 5. Quality tiers and the 45 fps cutoff (src/perf)

`runDeviceBenchmark` runs while "Preparing the pitch…" shows, once per app version (cached on the device; re-run from
settings). It plays the stage's benchmark scene at Standard (1.4 s), measures frame intervals, spikes, shader
compilation and context losses (through the stage), the event-to-frame response (a task queued like an input event,
to the second animation frame after it, while the scene renders), and reads `navigator.deviceMemory`. A Full result
with headroom is confirmed with 0.9 s at High; a result held back only by its frame rate gets 0.9 s at Lite. The GPU
renderer string comes from `readGpuRenderer` and `isSoftwareRenderer` (SwiftShader, llvmpipe, lavapipe, softpipe,
Basic Render, Apple Software Renderer, Mesa offscreen); the stage uses the same functions.

| Tier | Rule (`classifyDevice`, constants in `src/perf/thresholds.ts`) | What the player gets |
| --- | --- | --- |
| **Full Batter View** | ≥ 55 fps average, no one-second window under 50, ≤ 2 spikes over 50 ms, hardware WebGL 2, no context loss, event-to-frame ≤ 50 ms | First-person stage at Standard (High only if measured at High; Lite on a ≤ 3 GB phone); no extra tolerance |
| **Assisted Performance** | 45–54 fps, or a dip, spikes, one context loss, 50–100 ms response, or < 2 GB reported | First-person stage at Lite (reduced resolution, static crowd, simplified lighting, minimal particles), +12 ms timing tolerance, the stage's stronger readability |
| **Below cutoff** | < 45 fps average, no WebGL 2, a software rasteriser, ≥ 2 context losses, or > 100 ms response | Never first-person express bowling: a plain compatibility message ("What the check found") and **Classic practice** (the stage's 2D implementation, same physics, rules and scoring), +20 ms tolerance |

The tolerance is recorded in every `DeliveryRecord.tierToleranceMs`, so replays stay exact. During the session the
monitor samples frame intervals while each delivery plays; between balls it steps down (never up): High → Standard
under 55 fps, Full → Assisted under 50, Assisted → Classic under 45, each on the median of the last three deliveries;
two context losses go straight to Classic. A renderer fallback (lost context) switches to Classic before the next
ball. Settings can only choose less than the device earned. Nothing changes during a delivery.

Software rendering in emulators and headless browsers says nothing about phones: the e2e suite fixes the tier through
the test hooks, and performance must be measured on the devices in section 9.

## 6. Android and browser support

| | Requirement |
| --- | --- |
| Minimum | Android 9 (API 28), 3 GB RAM, hardware WebGL 2 / OpenGL ES 3 |
| Recommended | Android 11 or later, 4 GB RAM |
| Target | Android 16 (API 36) |
| Landscape | `@capacitor/screen-orientation` locks landscape for live batting (in `capacitor.settings.gradle` since `cap update`); menus rotate freely. On Android 16 large screens the lock may be ignored (platform behaviour); the turn-your-phone overlay covers it |
| Lifecycle | Android pause (Capacitor `pause` and `visibilitychange`) mid-delivery resolves the ball as a leave and pauses; a kill is resolved on the next start |
| Web | The same build: Chrome and Edge lock in fullscreen; elsewhere the overlay asks for landscape; desktop browsers play in their window |
| Offline | Practice needs no network after installation (the service worker precaches every chunk on the web; the Android bundle is local) |

**Emulator evidence (2026-10-25, re-run on the final build; not a physical device).** `scripts/android-practice.sh` builds a debug APK (bundle in
`dist-android`, WebView debugging only in that build), installs it with `adb install -r` (app data kept: it never clears
or uninstalls) and drives the real WebView with real `adb` touches. On the `vybe-pixel-api36-arm64` emulator (Android 16,
API 36, `-gpu host`: OpenGL ES Translator on an Apple M1 Pro, WebView 133.0.6943.137) all six checks passed:

| Check | Result |
| --- | --- |
| Launch choice on a cold start | shown; Practice opens with no account, network or age question |
| Landscape | `mCurrentRotation=ROTATION_90` once Practice is chosen |
| A real tap | the ball is bowled and resolved by the physics (one run: "Solid defence · dot ball"; the final run: "Through the shot too early · 1 run") |
| HOME mid-delivery, then back | paused; the ball counted as a leave; nothing left in flight |
| Process killed mid-delivery (`am kill` after HOME), relaunched | the resume card; the in-flight ball counted as a leave |
| Logcat | no `FATAL EXCEPTION`, no ANR |

The emulator's translated GL measured 41.5 fps on the benchmark, so it is (correctly) Below and plays Classic. The 3D
first-person stage was also run in the Android WebView by substituting a Full assessment for one session (restored
afterwards): it rendered, bowled and resolved a delivery. Not covered: API 28 to 35 (no system image installed) and any
physical device; see §9.

## 7. Privacy, analytics and local metrics

Practice sends nothing unless analytics is configured and the player opted in (the app's consent; Do Not Track and
Global Privacy Control respected). Events (`src/contracts/analytics.ts`), all with `mode: 'practice'` and closed,
coarse properties only: `practice_opened`; `practice_first_delivery` (`ttfdBucket`); `practice_tier` (`tier`,
`quality`, `fpsBucket`, and `reason` on a step down); `renderer_fallback` (`reason`); `practice_delivery` (`assist`,
`tier`, `timing`, `intentMatch`, `outcome`, `latencyBucket`); `practice_wicket`, `practice_over_completed`,
`practice_next_over` (`overNumber`); `practice_replay`; `practice_innings_completed` (`overNumber`, `durationBucket`,
`outcome: 'out'` for a dismissal). Never raw gestures, timestamps, seeds, renderer strings, ids or anything personal.

On the device only (`src/practice/store/metrics.ts`): counts (sessions, deliveries, warm-ups, repeats, overs, wickets,
innings, Next Over choices, replays, fallbacks), a 25 ms timing-error histogram, timing early/on time/late, contact
kinds, intent on target/near/off target (within 15° / 35° of the actual exit direction), input-to-bat latency buckets,
time-to-first-delivery buckets and tiers. "Clear Practice data" and the app's "Delete local data" remove them.

Validation targets from the brief (not yet measured with users or devices): first delivery under 10 s; 85% of test
users hitting two different regions after one over; 90% understanding why they missed; 70% choosing Next Over;
input-to-visible bat under about 50–70 ms on supported devices; 55+ fps on the primary mass-market tier; under 5% of
deliveries feeling inconsistent with intent.

## 8. Accessibility

- Menus, Build an Over, settings and the timing check are ordinary screens with a level-one heading, labelled
  controls, radiogroups with arrow keys (SegmentedControl), ≥ 44 px targets and confirmations for anything final.
- Every outcome is announced in a polite live region ("Late. Outside edge. Caught behind. Score 23 for 1."), as is each
  run-up. The scoreboard has a full spoken label; outcome badges have shapes and text, never colour alone; the
  coaching card's tone is backed by its words and a shaped badge; radar fielders differ by shape as well as colour.
- Android Back and Escape: never during a delivery; otherwise close the replay, pause, then leave (the innings stays
  saved). Dialogs and sheets close first.
- Reduced motion (setting or system) goes to the stage (calmer cameras) and stills the UI's animations; the timing
  check keeps its essential moving ball. High contrast swaps glass for solid surfaces with stronger edges. Text size
  scales every screen; summaries scroll in landscape.
- The pitch map is keyboard-operable (arrow keys) and states its target in words; the GestureSurface accepts Space
  and Enter (defend) and WASD/arrows (footwork).
- Hindi and Hinglish are complete; other languages show Practice in English (see `src/i18n/practice/STATUS.md`).

## 9. Physical-device test plan (not yet carried out)

Nothing in this section has been run on a phone. Each row is to be run on a real device and recorded with the device
model, Android version, OEM skin, GPU, refresh rate, the diagnostics screen's numbers, and the date.

| Class | Example targets | Skins to cover | What to check |
| --- | --- | --- | --- |
| Legacy 3 GB, Android 9/10 | Redmi 9A (Helio G25, PowerVR GE8320), Samsung Galaxy A10s (PowerVR) | MIUI, One UI Core | Tier (expect Below or Assisted), Classic plays, no crash on context loss, kill and resume |
| 4 GB budget | Redmi 10 / 12C (Helio, Mali-G52), Realme C-series (Mali-G57), Infinix Hot / Tecno Spark (Helio G-series) | HyperOS/MIUI, realme UI, XOS / HiOS | Assisted vs Full, input-to-bat latency, thermal step-down across ten overs |
| 4–6 GB mass-market | Samsung Galaxy A14/A15 (Mali-G57/G68), Vivo Y-series (Adreno 610), Moto G-series (Adreno 619) | One UI, Funtouch OS, near-stock | 55+ fps target, ≤ 70 ms input to bat, landscape lock, background pause |
| 6–8 GB mid-range | Redmi Note 12/13 (Adreno 619/710), Samsung A34/A54 (Mali-G68), OnePlus Nord CE (Adreno 642L), iQOO Z (Adreno 619/642L) | HyperOS, One UI, OxygenOS/ColorOS, Funtouch | High headroom check, 90 Hz behaviour |
| High-end | Samsung S-series (Adreno/Xclipse), OnePlus flagship (Adreno 7xx) | One UI, OxygenOS | 120 Hz pacing, High profile, long sessions |

Coverage required across the set: Mali, Adreno and PowerVR GPUs; Android 9/10, 11–13 and 14–16; 60, 90 and 120 Hz
displays; OEM battery savers (some cap the WebView at 30 fps, which must classify as Below rather than stutter).

Script per device: fresh install → launch choice → Practice → note time to the first ball (≤ 10 s target) → warm-up
and guided over → Random Over → Build an Over (pace and spin) → a dismissal → Practice This Delivery → Replay This
Over → ten overs once per class (watch the diagnostics' per-delivery fps for thermal steps) → home button mid-delivery
and return (leave + pause) → kill mid-delivery and reopen (leave on resume) → airplane mode → timing check →
TalkBack pass on the menu, summaries and outcome announcements → large text. Record performance separately from
correctness.

## 10. Tests

| Kind | Where | Covers |
| --- | --- | --- |
| Unit | `tests/unit/perf/*` | Software renderers, every tier rule and edge (55/50/45 fps, spikes, context loss, latency, memory, warm-up), frame statistics, the benchmark's High and Lite confirmation runs, the cache per app version, the session monitor's step-downs (never up), the frame sampler |
| Unit | `tests/unit/practice/store/*` | Settings, calibration, innings persistence with in-flight round trip, tampered and corrupt data, other simulation versions discarded, the Build an Over draft, clearing everything, metric buckets and aggregates (no gestures or ids) |
| Unit | `tests/unit/practice/ui/*` | The controller on fixtures: guided warm-up (not counted) then the guided over, the save-before-bowl and save-before-show ordering, the scoreboard waiting for the stage, one wicket ending the innings, ten overs, auto-advance, no pause mid-delivery, reload and leave mid-delivery as a leave, hiding mid-delivery, repeats never touching the innings, Replay This Over, the device check once per version, Below → Classic, WebGL failure, quality changes only between balls, the audio warm-up tap before the first delivery, an in-time swing never lost to a late release callback or a busy main thread, a ball settled as the app went away still explained after a kill, analytics vocabulary; the launch choice and its route rule; the coaching words (the brief's three cards, LBW not-outs, swing and seam for pace against drift and turn for spin); Practice copy completeness and placeholders |
| E2E (`practice` project) | `tests/e2e/practice-*.spec.ts` | `launch`: Practice vs Skip, the first ball with no account/age/settings and time to first delivery under 10 s, deep links, axe. `overs`: Random Over on the first-person stage, a full over and the next; Build an Over (spin, edit, shuffle); a dismissal with its replay, explanation and Practice This Delivery; Replay This Over and repeating a ball; ten overs. `resume`: reload mid-delivery → leave, never a fresh ball; background → leave + pause. `offline`: plays fully offline after install. `input-touch`: touch flick and tap through the GestureSurface, the one "Start batting" tap before the first swing when no press has warmed audio, the portrait overlay. `input-desktop`: mouse flick, click, Space. `layout`: no notice under a panel at 915×412 and 2400×1080. `webgl`: no WebGL 2 → compatibility message → Classic |

Run: `npx vitest run tests/unit/perf tests/unit/practice` and `E2E_OUT=test-results-practice npx playwright test
--project=practice` (it builds `dist-practice` with `VITE_PRACTICE_TEST_HOOKS=1` and previews it on 4176). The test
hooks (`src/practice/ui/testHooks.ts`) exist only in that build: production builds contain none of their code
(checked by grepping a production build). In headless Chromium the first-person stage renders through SwiftShader,
which keeps the main thread busy: the specs therefore wait on the controller's own state (`waitFor`), check
short-lived UI afterwards through a recorder, run the long flows on the Classic stage, and expect the session monitor
to step a software-rendered first-person stage down to Classic after a few balls (it does, which also exercises the
thermal monitor). None of this is evidence about phones.

## 11. Known limitations

- No physical-device validation yet (section 9); all frame-rate evidence so far is from desktop GPUs or SwiftShader.
- The event-to-frame measurement in the benchmark cannot see the touch digitiser or the display; the real
  input-to-bat latency is measured by the stage on each swing and reported in buckets.
- `navigator.deviceMemory` rounds down to a power of two and caps at 8, so a 3 GB phone reports 2 and is rendered at
  Lite; memory pressure itself cannot be observed from the web.
- A stage failure during a run-up (the graphics context dying) resolves that ball as a leave, like any interruption.
- The calibration is one offset for all input types (touch usually has more latency than a keyboard).
- Practice copy is complete in English, Hindi and Hinglish; the other eight app languages show Practice in English.
- On Android 16 large-screen devices the orientation lock may be ignored by the platform; the overlay then asks.
