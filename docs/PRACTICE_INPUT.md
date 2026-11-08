# Practice input (`src/input`)

The one input model for every batting screen. Touch, mouse, pen and keyboard become one `NormalizedSwing`
(`src/contracts/practice.ts`), which is the only batting input the physics sees. The input owner holds `src/input/**`,
`tests/unit/input/**` and this document.

This model answers findings F-002 (gesture read), F-003 (cadence), F-027 (touch footwork) and F-028 (calibration per
modality), under the lead's binding decisions of 2026-10-26.

## The model

- **One contact, one authority.** Pointer-down starts one contact. `GestureTracker` owns its state and
  `normalizeGesture` is the only pointer-to-`NormalizedSwing` authority. There is no second tap, joystick, named-shot
  selector, ball-aware correction or hidden aim assistance.
- **Pull back to load.** Intentional movement predominantly down/back enters `loading`. Pullback depth continuously
  expresses an aggression/elevation envelope; it never selects an outcome or changes the fixed delivery.
- **Holding within the live delivery is read time, not a timing penalty.** The browser/TypeScript tracker remains
  sample-driven while the delivery is live. The player may hold the loaded contact and make a small lateral expert
  stance refinement; neither enters the forward timing or power denominator. Unity transport has the separate
  three-second bound documented below.
- **Reverse into the stroke.** Upward reversal beyond the movement threshold commits the swing. `startT` is the
  interpolated moment the forward run leaves a 2.5 CSS-pixel circle around its loaded anchor, never pointer-up.
- **The first 40 ms of forward evidence is the read.** Forward bearing is scoring direction. Bounded forward path
  velocity is power. Pullback depth plus forward travel is aggression/elevation intent, bounded by execution power.
  The tracker emits as soon as the 40 ms read exists; release only closes the contact.
- **Quick release still defends.** A contact lifted within 250 ms without moving beyond the threshold is the existing
  defensive straight bat. Keyboard controls remain an accessible equivalent.
- **Choosing not to reverse is a leave once the backlift is unambiguously held/tracked.** No normalized swing is
  emitted. A one-way immediately released downward stroke remains the historical behind-square compatibility flick;
  see “Legacy compatibility”.

Pure and deterministic: the same samples always give the same swing. The read uses only the samples' own timestamps,
the exact press/lift/cancel events, and interpolation between samples.

## Cues and observable state (`GestureSurface`)

| Cue | When | Carries | Use |
| --- | --- | --- | --- |
| `onSwingStart(atPerfMs, pointer, footwork)` | Synchronously inside the pointer-down or key-down handler, before any other work (for a resting finger, when its movement is recognised) | The press's own timestamp, the modality, and the footwork known at that moment | **The touch-down cue: the stroke starts here** (owner decision 2026-11-04, CTL1). The flow calls `PracticeStage.prepareSwing(atPerfMs, calibrationMs)` and the stage moves the bat in the next frame, bounded until a commitment (see below). The modality's calibration offset is the one read when the delivery was armed (`DeliveryRunner.armedCalibrations`), so the handler does no storage read or JSON parse |
| `onContactState(state)` (optional) | Every meaningful live or terminal transition | Phase, press and timing timestamps, pullback/lateral/aggression/elevation intent, forward bearing/velocity/path power and commitment | Presentation follows the one canonical contact without interpreting raw samples itself |
| `onIntent(intent)` (optional) | Attack at forward reversal; defence when a quick press lifts unmoved | `kind`, authoritative `atPerfMs`, `pressAtPerfMs`, `pointer`, forward bearing, intent and footwork | The stage can begin the chosen stroke before normalization completes |
| `onGesture(input)` | When the gesture can be normalized (see "When the gesture is emitted") | The `GestureInput` | `normalizeGesture` and then the physics |
| `onCancel()` (optional) | Cancellation before forward commitment | No swing; clear provisional presentation | Cancellation after forward commitment does not call this or undo the swing |

The phase vocabulary is:

| Phase | Meaning |
| --- | --- |
| `ready` | Pointer/key down: the touch-down stroke has started; no shot is committed yet |
| `waiting` | An armed press stayed unmoved past `TAP_HOLD_MS`: no longer a tap and not a shot, so the stroke checks back. `atPerfMs` is always the press + `TAP_HOLD_MS`. Published once, when a sample proves the hold or, with no samples, by a timer at the press + `TAP_HOLD_MS` + `LATE_SAMPLE_WAIT_MS` |
| `loading` | Predominantly downward pullback is accumulating |
| `tracking` | Loaded contact is held or laterally refined; `pathPower` remains exactly 0 |
| `committing` | Forward reversal has crossed the commitment boundary; timing and forward evidence now exist |
| `released` | A committed/defensive contact was physically released; this does not retime it |
| `intentional_leave` | An uncommitted held/tracked backlift closed without reversal |
| `cancelled` | The pointer was cancelled; `committed` tells presentation whether the swing remains authoritative |

**Touch-down is the input; the shot commits on lift** (owner decision 2026-11-04, CTL1; it restates 2026-10-26's "the
bat responds at touch-down").

- The bat starts moving at `onSwingStart`, from the press minus the modality's calibration. That is exactly the
  instant a tap's physics swing starts: a tap's committed `onIntent` has `atPerfMs` equal to the touch-down's, and
  `normalizeGesture` gives `startT = press − calibration`. Presentation therefore never retimes a tap.
- Until a commitment the stroke is bounded and never chooses a direction or power. It is presentation's job
  (`src/render3d/practice/bat.ts` `TOUCHDOWN`) to keep the uncommitted stroke clear of the ball. The one rule, for
  every renderer: the drawn bat never comes within `clearM` = 0.15 m of the ball's centre unless the bat with no input
  is at least that near at that moment, and it draws back before the ball arrives (a 120 ms look-ahead), so a stroke
  can never draw a contact the waiting bat would not. Its details and its measurements are in
  `docs/PRACTICE_PRESENTATION.md` ("First-person bat and gloves").
- The press resolves in one of these ways:
  - a lift within the tap window commits the defence;
  - movement commits a swipe from its own later start, so the stroke carries the swipe's intent once known;
  - a pullback (`loading`), a hold past the window (`waiting`), a cancellation or an `intentional_leave` checks the
    stroke back.
- No swing ever starts before its touch-down cue minus calibration (`touchdown.test.ts`).
- The final normalized swing remains authoritative. Defence reaches the hitting area 120 ms after its start; attack
  takes 120 + 30·power ms (`batTravelMs`).
- A lift stamped inside the window but delivered after the `waiting` notice is still a tap: the decision uses event
  time. Presentation then joins the committed swing from wherever the check-back has reached.

## Reading one contact

Tap duration is measured from the press. Canonical attack duration is measured only from forward departure. Constants are in
`src/input/constants.ts`.

| Input | Read as |
| --- | --- |
| Lifted without moving beyond `MOVE_THRESHOLD`, within `TAP_HOLD_MS` (250) | Tap, emitted at the lift |
| Held without moving beyond 250 ms | Waiting: `waiting` is published once and no shot is emitted. A subsequent forward/legacy movement remains available, timed from its own start; its lift without one is `intentional_leave` (the delivery stays armed) |
| First threshold-crossing movement predominantly down (`dy / distance >= 0.72`) | Backlift: `loading`, not an attack |
| Loaded hold or small lateral movement within the live delivery | `tracking`; hold time is excluded from the future read. Browser/TS remains sample-driven; Unity transport is capped as documented below |
| Upward reversal by at least `MOVE_THRESHOLD` | Irreversible `committing`; timing begins at interpolated forward departure |
| Forward evidence reaches 30 ms | The pure read is `stable`; the tracker still targets the complete 40 ms read |
| At least 40 ms of forward samples after departure | Emit one authoritative gesture immediately; pointer-up later produces `released` only |
| Committed forward stroke released before 40 ms | Emit from the actual evidence available; normalization uses the existing 20 ms minimum denominator and never invents samples |
| Held/tracked backlift released without reversal | `intentional_leave`; no gesture |
| Finger already down when the delivery is armed | No swing until intentional movement passes the threshold. Lifting it is not a shot. Departure after a silence over 20 ms uses the following segment's speed, floored at 0.4 px/ms; never before linear interpolation from the last rest sample |
| Browser/TS cancellation before forward reversal | Abort without consuming the shot; emit `cancelled`, `committed: false` |
| Browser/TS cancellation after forward reversal | Preserve/emit the committed swing from available evidence; emit `cancelled`, `committed: true` |
| Second finger | Ignored (only the first pointer counts) |

Exactly one gesture can be emitted per armed contact. Additional moves, release or cancellation after emission cannot
produce a second swing.

**Native cancellation boundary.** Unity mirrors only the published geometric boundary needed to decide whether a
platform cancellation may discard the ephemeral raw trace: a dominant pullback followed by an upward reversal beyond
the movement threshold is irreversible. Before it, native capture clears and rearms; after it, native capture sends
the exact samples already observed, without inventing a cancellation coordinate, and spends the delivery once.
TypeScript still performs the sole normalization, physics and scoring read. Unity's boundary mirror cannot choose a
shot, aim or outcome.

## Canonical normalization: direction, power and elevation

**Reference length.** The surface's shorter side, clamped to `REFERENCE_PX` [180, 260] CSS px. Distances and speeds
are in reference lengths (RL), so one contact means much the same on any phone and large screens do not demand large
absolute travel.

| Surface (lower 46% of the viewport) | Reference length | Movement threshold | Full pullback intent (0.72 RL) | Full forward contribution (0.82 RL) |
| --- | ---: | ---: | ---: | ---: |
| 640×360 phone | 180 px | 10.8 px | 129.6 px | 147.6 px |
| 844×390 phone | 180 px | 10.8 px | 129.6 px | 147.6 px |
| 915×412 phone | 189.5 px | 11.4 px | 136.4 px | 155.4 px |
| 1280×720, 1280×800, 1920×1080 | 260 px | 15.6 px | 187.2 px | 213.2 px |

**Movement threshold.** 6% of the reference length, clamped to [10, 16] px. This is above Android's 8 dp touch slop,
so a rolling, drifting novice tap stays a tap.

**Timing.** Find the last loaded/held anchor before the continuous upward run. `commitMs` is where that run leaves a
2.5 px departure circle, interpolated between event-time samples. The hold, pullback and UI-handler delay do not enter
`startT`. A long sampling silence uses the next forward segment's speed, floored at 0.4 px/ms, and never estimates a
start earlier than linear interpolation allows.

**Direction.** `atan2(dx, −dy)` from the loaded anchor to the 40 ms forward endpoint. Screen-up is 0 (straight) and
screen-right is +. Left-handers mirror the result. Canonical tests cover forward reversal; they do not establish a
full 360° range. Behind-square/full-circle coverage applies only to legacy one-way flicks and keyboard directions.

**Power.** Sum the first 40 ms forward path, bounded to at most 1.35 times its straight reach so digitizer scribble
cannot manufacture power. `v = bounded path / forward read duration` in RL/s, with the 20 ms minimum denominator only
for a committed contact that physically ends early. It is mapped
log-linearly: `power = 0.2 + 0.8 × ln(v / 2) / ln(10)`, clamped to [0.12, 1]. So 2 RL/s gives 0.2 and 20 RL/s gives 1.

- Equal ratios of speed are equal steps of power: a 10% faster swipe is always 0.035 more power.
- Pullback and hold time never add to the stroke duration or lower its power.
- `OneGestureState.pathPower` is exactly 0 during `ready`, `loading` and `tracking`; it becomes nonzero only with
  committed forward evidence.
- The departure radius is fixed in CSS pixels while reach is reference-scaled. This introduces a small, analytically
  testable cross-surface power difference (the linear reference fixture bounds it below 0.01); it is not exact scale
  invariance.

**Aggression/elevation.** This is intent, not outcome steering:

- `pullbackIntent = clamp01(pullbackDepth / 0.72 RL)`;
- `forwardIntent = clamp01(boundedForwardPath / 0.82 RL)`;
- `aggression = clamp01(0.65 × pullbackIntent + 0.35 × forwardIntent)`;
- elevation intent stays grounded through aggression 0.42, then rises linearly to 1;
- actual normalized elevation is the lesser of that intent and the execution-power envelope
  `clamp01((power − 0.35) / 0.65)`.

Thus a deeper backlift and longer committed stroke increase loft intent continuously, while a slow drag cannot become
a guaranteed loft. Physics still decides contact, launch, fielding and score from the unchanged delivery and swing.

**Rounding.** `startT` to 0.1 ms; direction to 0.1°; power and elevation to 0.001. A −0 is never produced.

## Legacy compatibility and historical model

The canonical path above coexists inside the same tracker/normalizer with the established controls; this is one
authority with a compatibility discriminator, not two input systems:

- quick tap remains defence;
- keyboard remains accessible and deterministic;
- an initial movement that is not predominantly downward remains the old one-way flick;
- an immediately released one-way downward motion remains the old behind-square flick, because its samples are
  geometrically indistinguishable from an unheld pullback;
- a downward backlift becomes unambiguously canonical when it reverses, is laterally refined while held, contains an
  explicit stationary hold, or remains held for 250 ms.

Only the legacy flick uses the old maximum 140 ms read, stop/turn handling, full 360° bearing, and reach-based loft
curve (`LOFT_REACH.from = 1.1 RL`, `full = 1.6 RL`). Those rules do **not** describe canonical pullback/reversal.

The table below is retained as historical/legacy comparison data; it is not the canonical mapping:

| Swipe | Power | Elevation |
| --- | ---: | ---: |
| Gentle push 30 px / 80 ms | 0.20 | 0 |
| Slow drag 120 px / 250 ms | 0.41 | 0 |
| Ordinary 80 px / 90 ms | 0.49 | 0 |
| Ordinary 120 px / 120 ms | 0.54 | 0 |
| Quick flick 40 px / 30 ms | 0.64 | 0 |
| Long fast 200 px / 120 ms | 0.71 | 0 |
| Ordinary 150 px / 60 ms | 0.85 | 0 |
| Rest 70 ms, then 100 px / 100 ms | 0.39 | 0 |
| **Loft:** 340 px / 120 ms | 0.90 | 1.00 |

### Historical legacy loft gesture

For the legacy one-way flick only, at least 1.1 reference lengths of reach within its 140 ms read starts the
loft, and 1.6 or more is fully lofted. On the 915×412 phone that means beyond about 210 px, and about 300 px for a full
loft, finished within about 140 ms of movement departure.

The reference loft for corpora is 1.8 reference lengths (≈ 340 px on the phone) over 90–140 ms, in any direction,
started low in the batting area. It reads elevation 1. Jittered by ±12% in length (and with curves, short rests and any
cadence), the acceptance test requires elevation ≥ 0.45 in at least 95% of 300 trials. These are synthetic gestures,
not human recognition results.

- Ordinary swipes, up to about 200 px on a phone, read elevation 0.
- A long but slow swipe is read at 140 ms, so it stays low. Lofting is a big, quick stroke, so a lofted swipe is
  always a hard one: elevation e needs at least `minPowerForElevation(e)`, about 0.75–0.86.
- `canPlay(swing)` tells the coach whether a player can produce a swing, so demonstrations stay playable.

Do not use this legacy instruction as the canonical teaching. Canonical teaching is: “Pull back, read the ball, then
flick forward. Deeper and faster lifts more.” Human wording still requires UX review.

## Footwork

The priority order is:

1. A key pressed this delivery: W forward (twice within 350 ms, down the track), S back, the off-side letter (D for
   a right-hander, A for a left-hander) across, the leg-side letter automatic.
2. A held lateral adjustment of at least 0.06 RL, once expert `pressFootwork` is on: `across`. It changes footwork,
   never the forward scoring bearing.
3. **Where the press lands (F-027)**, once `pressFootwork` is on. Measured down the batting area from its top edge:
   above 38% steps forward, below 62% goes back, and the middle keeps the footwork as it is. The foot is known at the
   press itself (`onSwingStart`'s third argument), so the stride can start with the bat.
4. The on-screen `footwork` prop (default `auto`: the physics chooses from the length).

`pressFootwork` is **off by default**, so a rookie's press position never chooses a foot (RK2, X2). UX switches it on
when footwork is introduced, or for an expert who skips teaching (X1).

Suggested teaching: "Press high in the batting area to get forward, low to go back."

## Keyboard (for UX's help and controls text)

Keys are heard on the window while the surface is enabled. They are never read from text fields, or while Ctrl, Alt
or Meta is held.

| Key | Effect |
| --- | --- |
| Space, Enter, keypad Enter, keypad 5 | Defence: the same start rule and values as a tap at that moment |
| ↑ → ↓ ← | An attacking shot in that direction on screen (↑ straight, → off side for a right-hander, ← leg side, ↓ behind). Mirrored for a left-hander like a swipe |
| Two arrows within 40 ms | The diagonal (↑+→ cover, ↑+← midwicket, ↓+→ third man, ↓+← fine leg). Opposite arrows: the first counts |
| Keypad 1–9 | The eight directions at once (8 up, 9 up-right, 6 right … 7 up-left) |
| Shift held (or pressed within the 40 ms) | Lofted |
| W (twice: down the track), S, the off-side letter, the leg-side letter | Footwork for this delivery |

Key shots have fixed values: attack power 0.55 and elevation 0, or lofted power 0.85 and elevation 0.75. The swing
starts at the first key's own timestamp. Auto-repeat is ignored, and so is a second shot key.

Suggested help text: "Space to defend. Arrows to hit, two for a diagonal. Hold Shift to loft. W forward, S back."

## Calibration per modality (CTL9, F-028)

Each modality (touch, mouse, pen, keyboard) has its own offset, measured with that input. A swing is corrected only by
its own modality's offset; a pen uses the touch offset until it has its own.

| Helper (`src/input/calibration.ts`) | Purpose |
| --- | --- |
| `calibrationFromTaps(errors)` | The median of plausible attempts (rejects errors above 300 ms, clamps to [−60, 220]) |
| `calibrationsFromTaps([{ modality, errorMs }])` | Attempts made with mixed inputs: each modality's own median |
| `eventModality(event)` | The modality of a pointer or key event (for the calibration screen) |
| `withCalibration(set, modality, c)` | Stores one modality's result without touching the others |
| `calibrationFor(set, modality)` | The offset a swing of that modality uses |
| `resolveCalibrations(set)` | All four offsets, for `normalizeGesture`'s `calibrations` option |

`normalizeGesture(input, { releasePerfMs, calibrationMs, calibrations, handedness })` uses `calibrations[input.pointer]`
when it is given, and otherwise `calibrationMs` (the old single offset).

**Proposed storage shape (to agree with UX, who owns `src/practice/store/calibration.ts`).** Under the existing key:

```
{ v: 2, touch?: { offsetMs, attempts }, mouse?: …, pen?: …, keyboard?: … }   // CalibrationSet
```

A legacy `{ offsetMs, attempts }` is migrated to the modality it was most likely measured with: touch where
`matchMedia('(any-pointer: coarse)')` matches, else mouse.

## Cadence: the same motion reads the same

How the read stays independent of cadence:

- Every sample uses its event's own timestamp, and coalesced pointer events are read.
- In browser/TS, the press, lift and cancellation are exact events, but canonical attack timing comes from forward departure.
- The departure point and 40 ms forward endpoint are interpolated.
- Pullback and hold samples identify the loaded anchor but never enter forward duration or velocity.
- Every decision uses event timestamps, so frame batching and dispatch delay do not retime the stroke.

`one-contact.test.ts` replays the same canonical pullback/hold/lateral/reversal stream with coalesced 120, 60 and
30 Hz dispatch. The three normalized swings are exactly equal. It also asserts emission occurs 30–50 ms after the
interpolated forward onset and exactly one gesture is emitted for the contact. This is deterministic synthetic
evidence, not device input-to-photon or human-control evidence.

The table below is the retained **legacy one-way flick** cadence contract. It does not redefine the canonical 40 ms
forward read. `cadence.test.ts` compares against a 4 ms legacy digitizer stream on every surface and for touch, mouse
and pen:

| Delivery | Class, swing start, elevation | Direction | Power: lifted swipe | Power: rest, then swipe | Power: swipe that stops and stays |
| --- | --- | --- | ---: | ---: | ---: |
| Coalesced, at 120, 60 or 30 Hz | identical | identical | identical | identical | identical |
| Coalesced, 30 Hz, 20 ms late | identical | identical | ≤ 0.02 | ≤ 0.05 | identical |
| Not coalesced, 120 or 60 Hz | class/elevation same; timing sampled | ≤ 0.2° | 0.02 base | 0.03 base | 0.05 base |
| Not coalesced, 30 Hz | class/elevation same; timing sampled | ≤ 0.2° | 0.02 base | 0.07 base | 0.1 base |
| Sampled every 50 ms | class/elevation same; timing sampled | ≤ 0.2° | 0.02 base | 0.1 base | 0.17 base |

Those historical/legacy tolerances depend on the gesture:

- **Sparse samples:** departure and end each have a test bound of one sample interval plus the 4 ms reference
  resolution. Read-duration difference is independently bounded by twice that value. The power bound adds
  `0.8 / ln(10) × ln((referenceReadMs + durationUncertainty) / max(20, referenceReadMs − durationUncertainty))`
  to the historical base above. This follows the logarithmic response and is a finite-sampling safety check, not
  a perceptual acceptance budget. Sparse 20 Hz input can have a wide uncertainty envelope.
- **Known legacy quality deviations remain:** a 30 px / 80 ms minimum-jerk swipe sampled every 50 ms reads power 0.222
  versus 0.287 at 4 ms (the old 0.02 limit is exceeded). A held 50 px / 40 ms minimum-jerk swipe, 30 Hz newest-only,
  reads 0.656 versus 0.763 (the old 0.1 limit is exceeded). Both are pinned in tests, not hidden by the new bound.
- **On phones:** coalesced-event availability depends on browser, WebView, hardware and dispatch. Synthetic
  coalesced equality does not establish that all physical phones provide those samples. F-003 and device gates
  remain open pending actual-device event capture and evaluation.
- **CDP harnesses.** In a harness that dispatches moves 33–50 ms apart, the motion actually delivered is slower than
  the profile that was scripted. Compare against a replay of the same timestamps (`traceGesture`), not against the
  scripted profile.

## When the gesture is emitted, and the render

The physics bat reaches the ball 120 ms (defence) or 120 + 30·power ms (attack) after the swing's own start. When the gesture is
emitted:

| Gesture | Emitted |
| --- | --- |
| Tap, lifted | At the lift, typically 50–120 ms after the press |
| Canonical pullback only | Never as a shot; it remains loading/tracking |
| Canonical forward reversal with 40 ms evidence | As soon as the event stream covers forward onset + 40 ms, before pointer-up if the contact remains down |
| Browser/TS canonical committed stroke released/cancelled before 40 ms | At that terminal event from the evidence actually observed; commitment cannot be undone |
| Canonical held/tracked backlift released without reversal | No gesture; `intentional_leave` |
| Legacy one-way swipe, lifted | At the lift |
| Legacy one-way swipe still moving | At the first sample past its 140 ms cap, or its legacy 40 ms fallback wait |
| Arrow key | At the second arrow, or after 40 ms |
| Space | At once |
| Press held unmoved | Never; it is waiting |

Presentation follows `onContactState`, begins committed presentation from `timingAtPerfMs`, and reconciles to the
normalized swing. It must not invent a result, secretly change the delivery, use the press timestamp for a later
forward reversal, or wait for release after the tracker has emitted.

## Tests

```
npx vitest run tests/unit/input
```

All of them are deterministic: simulated clocks and seeded corpora.

Latest recorded input runs (touch-down cue, TAP; builder evidence, not an independent player-experience
certification):
- 2026-11-04T07:32:53Z, host load `6.08 5.90 6.68`: `npx vitest run tests/unit/input` gave **131/131 tests in 12 files**.
- 2026-11-04T08:01:48Z, tree `4a376ae+f7bf20e2be15`, load `9.19 9.43 8.81`: the same 12 files passed again inside a
  21-file run with `--maxWorkers=2`, and `npm run typecheck` passed.
  - That run's one failure, `tests/unit/practice/unity/stage.test.ts:551` (a pause count after `setTimeout(0)`),
    passed 3/3 when run alone.
- Earlier: build `38924bd+e47986f8daea`, 2026-10-31T05:16:58Z, 115/115.

| File | Covers |
| --- | --- |
| `one-contact.test.ts` | Canonical browser/TS phases, hold exclusion, lateral refinement, timing, power/elevation mapping, intentional leave, cancellation boundary, 30/60/120 Hz equality, exactly-one emission and compatibility |
| `normalize.test.ts` | Direction, tap or swipe, timing, power, elevation, read end, keyboard reads, `canPlay` |
| `tracker.test.ts` | Compatibility state machine: quick tap, waiting, legacy swipe, cancellation recovery, emission rules, late batches, resting finger, keyboard chords and footwork keys |
| `cadence.test.ts` | Legacy PERF3/F-003 cadence matrix and finite-sampling bounds |
| `corpus.test.ts` | Historical RK3/EX1 seeded legacy corpora, touch defences and examiner reconstruction; 360° results are legacy/keyboard evidence |
| `acceptance.test.ts` | Retained legacy E-PX-001, CTL2–CTL5, CTL9 and EX2 input-side evidence; full-circle coverage is not a canonical pullback claim |
| `calibration.test.ts` | Calibration per modality |
| `system.test.ts` | Gesture → physics on the reference over (Real) |
| `surface.test.tsx` | The DOM surface: synchronous ready cue, held finger does not shoot, keyboard attack and loft, text fields |
| `touchdown.test.ts` | The touch-down cue (CTL1): first and synchronous at the press; a tap commits at the touch-down's timestamp at every cadence and calibration; `waiting` once per press, at every cadence and with no samples; late lift still a tap; never for a pullback, flick or cancellation; key chords unaffected; no swing before its cue minus calibration over a seeded corpus |

**`system.test.ts`.** It always asserts the input's side: the physics plays the swing unchanged, and its timing error
is the normalized gesture's offset. It prints the physics-dependent rubric lines (CTL2–CTL4, EX2). Run it with
`VANDE_SYSTEM_STRICT=1` to assert those too.

**For examiners.** `src/input/normalize.ts` and `src/input/simulate.ts` load under `scripts/simulate-loader.mjs`
(Node type stripping).

- `traceGesture({ surface, samples, frameMs, coalesced, latencyMs, armAtMs, pressFootwork })` plays a stream through
  the real tracker and records `states` as well as starts/intents/emission.
- `readOneContact` exposes the pure canonical motion analysis. `readGesture` and `normalizeGesture` remain the only
  authoritative conversion to a swing.
- Use `traceGesture` for browser/TS loading/tracking, intentional leave, terminal state, cancellation and
  exactly-one-emission claims. A pure normalizer call cannot know pointer terminal semantics by itself, and this
  simulator does not prove native cancellation parity.
- In the browser/TypeScript path, do not truncate a canonical raw stream at the first movement or the legacy 140 ms
  cap. Preserve event-time samples through upward reversal and 40 ms of forward evidence, pointer-up or pointer
  cancellation, while the live delivery remains active. The Unity/native transport limit below still applies.

## What other owners need

- **UX** (`src/practice/ui`, `src/practice/store`):
  - consume `onContactState`, `onIntent` and `pressFootwork` through `GestureSurfaceProps`; presentation must not
    independently infer a shot from raw samples;
  - add `calibrations?` to `NormalizeContext`, and use `resolveCalibrations` / `calibrationFor`;
  - store the `CalibrationSet` above, with the calibration screen recording `eventModality` per attempt;
  - write the help text for the keys, loft and footwork above.
- **Presentation** (`src/render3d`):
  - start the bounded touch-down stroke at `onSwingStart` (calibrated like a tap). Check it back at `waiting`,
    `loading`/`tracking`, cancellation or an uncommitted `intentional_leave`. Join the committed stroke at `onIntent`
    without a jump, and reconcile the final normalized timing;
  - start the stride from `footwork`;
  - never let the ball pass the bat while a result is pending.
- **Coach** (`src/practice/coach/candidates.ts`): demonstrate only playable swings (`canPlay`). The grid's ground
  elevation should be 0, and its chip (0.55, 0.6) needs power 0.81 or more.
- **Physics** (`src/physics`): the strict system lines (CTL3 p90, CTL4 ρ to exit speed, EX2 exit speed and sectors)
  depend on the contact model.
- **Unity/native capture:** forward one pointer's raw event-time samples from pointer-down. Never normalize or emit a
  shot natively, and never auto-close merely because 140 ms elapsed after backward movement. One bridged raw gesture
  is strictly bounded to **3,000 ms** from its first to last sample (and 512 samples) by
  `src/contracts/unityPractice.ts` and the C# validator/buffer. Within that window, preserve the loaded contact through
  reversal and the 40 ms forward read. If the three-second span would be exceeded, cancel that native capture, clear
  provisional presentation and rearm cleanly for the still-live delivery; never send an over-limit packet or
  reinterpret the timeout as a shot. Pointer-up, pointer cancellation or TS acknowledgement also closes the native
  capture. Platform pointer cancellation always discards the native raw capture and emits no gesture before rearming;
  it does not currently preserve a possibly post-reversal swing. Native post-reversal cancellation parity is
  **UNPROVEN/open** until an owner-approved bridge design can preserve it without a second normalization authority.
- **Main** (`src/contracts/practice.ts`): `GestureInput.key`, `InputModality` and `CalibrationSet` already carry the
  shared keyboard/calibration contract. Do not add a second continuous-gesture result contract outside `src/input`.
