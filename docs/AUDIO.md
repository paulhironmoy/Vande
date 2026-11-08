# Audio, crowd emotion and haptics

Owner: the audio workstream (`src/audio/**`, `tests/unit/audio/**`). This document specifies Practice's sound, the
crowd's emotion, the mix, the haptics and the captions. Nothing here decides or changes an outcome or its timing.
The physics resolves the delivery; the stage (`docs/PRACTICE_PRESENTATION.md`) delivers its moments at their own
simulation timestamps; audio follows.

Binding sources:

- the production brief ("Match emotion and audio");
- the interface constitution: §4 Delivery Quiet Mode, §11 motion, §12 haptics, §13 sound;
- the north star ("Emotional authenticity").

Every sound has an original synthesised voice. Licensed recordings (CC0 or CC BY, registered in
`release/product-sequence/stage-1-practice/wedge/sound/REGISTER.md`) replace a voice where they exist, chosen
deterministically from the delivery record; the synthesised voice is the fallback (see "Assets"). Today only the
crowd's applause has recordings. Until recordings replace them, every contact sound plays 3 placeholder takes
(flagged `placeholder`, labelled "not a recording"): original synthesis rendered offline by
`scripts/audio/placeholders.mjs`. `scripts/audio/ingest-recordings.mjs --apply` swaps a sound's placeholders for
recordings in one step.

**Loading (2026-11-03, SOUNDKIT; builder-measured).**
- Practice's warm-up (`installMatchAudioUnlock()`) requests every take Practice can play before the first ball. Each take is decoded once the audio graph exists, never during a delivery, and its compressed bytes are then dropped.
- Play itself issues no requests (`tests/e2e/perf-practice-runtime.spec.ts`, PERF2/PERF4).
- Decoded takes hold 2,414,608 bytes: the 54 placeholders plus the applause.
- Sealed Six's `MatchAudio` no longer fetches or holds takes.
- Offline behaviour is unchanged: the files are precached, and a take that fails to load falls back to synthesis.
- Phone timings are UNPROVEN.

## Files

| File | What it is |
| --- | --- |
| `emotion.ts` | The pure emotion model, import-safe anywhere (no Web Audio). It re-exports `emotionCore.ts` (types, sampling), `emotionMachine.ts` (transitions, the machine) and `situation.ts` (pressure from the score). |
| `practice.ts` | `createPracticeSink()`: the stage's `PracticeSink`, which owns the session's one emotion machine. |
| `engine.ts` | The one AudioContext, the four buses, the ducks, the Delivery Quiet Mode gate, voice tracking and the background rule. |
| `bank.ts` | Voice banks: the effects sprite (rendered offline) and the crowd reactions (rendered in idle slices). Two nodes per cue. |
| `crowdVoices.ts`, `dsp.ts` | The crowd reactions: deterministic DSP (voices on vowels, claps, whistles, an exhale, an intake). |
| `crowdBed.ts` | The continuous crowd murmur. It follows the machine's base curve on the audio clock. |
| `voices.ts`, `fxVoices.ts` | The synthesised cricket and interface voices (Web Audio node graphs, live and offline). |
| `feel.ts`, `haptics.ts` | The haptic patterns, the 60 ms scheduler, and Capacitor Haptics or `navigator.vibrate`. |
| `settings.ts` | The sound settings (`vc:practice:audio`). |
| `captions.ts` | The caption stream (closed keys). |
| `ui.ts` | Interface cues and Coach Mode's mastery moment. |
| `takes.ts` | Deterministic take selection: FNV-1a 32 of `deliveryKey\|sound\|occurrence`, where the key is the record's `seed#over.ball`. |
| `recorded.ts` | Loading, integrity checks (byte count and SHA-256), onset detection in the decoded buffer and scheduling of recorded takes, with the synthesised fallback. |
| `recordedManifest.ts` | The sound inventory, each kind's takes (if any) and its honest label, including the generated `CONTACT_TAKES` block of placeholder takes. |
| `match.ts` | Sealed Six: `MatchAudio`, the batter's tap feel and the seal chime (unchanged behaviour, now on the shared mix). |
| `mix.ts`, `loudness.ts` | The measured mix constants, and ITU-R BS.1770 loudness (the highlight master and the crowd renders). |
| `timingLog.ts` | Hooks build only: the event-timing log (`window.__vandeAudio`). |
| `src/render3d/practice/audio.ts` | Owned by audio since the lead's transfer: the stage's default sink, `createPracticeSink` re-exported as `createPracticeAudio`. |
| `src/render3d/practice/feedback.ts` | Owned by audio since the lead's transfer: the contact feels the stage fires. A defended middle is `block` (F-022), and each feel carries its contact and timing. |

## The emotion model (`src/audio/emotion.ts`)

There is one emotion source for Practice, and the lead's decision makes it binding:

- The Practice sink owns one machine per session.
- The 3D crowd reads the same instance through `sink.emotionNow()`.
- The machine keeps running when the sound is muted or off, in Classic and in Delivery Quiet Mode.
- It never influences physics, timing or outcomes.

### Inputs and outputs

The machine is a pure, deterministic state machine with two kinds of input.

- **Moments.** The stage's `StageMoment`s, each at the instant it physically happened. Structurally they are
  `EmotionMoment = { kind, intensity, contact?, timing?, dismissal?, runs? }`, and a type test enforces the
  compatibility.
- **Match context.** `DeliveryContext = { pressure?, milestone?, wicketEndsInnings?, runs? }`, built by
  `deliveryContext(situation)`.

Its output is `CrowdEmotion`:

| Field | Meaning |
| --- | --- |
| `phase` | `between`, `approach`, `stride`, `flight`, `contact`, `chase`, `outcome` or `reflection` |
| `mood` | `murmur`, `anticipation`, `concentration`, `breath`, `response`, `gasp`, `expectation`, `frustration`, `relief`, `applause`, `celebration`, `eruption`, `ovation`, `restless`, `silence`, `dismay` or `reflection` |
| `arousal` | 0 hushed … 1 the stadium at full voice: the crowd's intensity |
| `valence` | −1 dismay … +1 joy (a home crowd behind the batter) |
| `expectation` | 0..1, building during the approach and as a hit nears the rope |
| `outcome` | `four`, `six`, `wicket`, `close_call`, `runs`, `dot` or `leave`, from the moment it is physically confirmed; null before |
| `pressure` | 0..1, from the context |

Each moment also says what the crowd does: `reaction` (one of the crowd voices), `reactionLevel` and a crowd
`caption`.

### Closed form and decay

```
arousal(t) = base(t) + reaction(t) + tail(t)
base       approaches its target exponentially (time constant tau); after `hold`, relaxes to the resting murmur
           (time constant `relax`)
reaction   (1 − e^(−x/attack)) · e^(−x/decay), aimed so the total peaks exactly at the reaction's level
tail       the previous reaction, still decaying on its own (the base never jumps)
```

Because sampling is closed-form in time, it allocates nothing (one object, updated in place), does not depend on the
frame rate, and needs no further input to decay. A celebration relaxes to the murmur on its own.

Phase, mood and outcome switch exactly at an input's own time. A moment delivered ahead of time, for sample-accurate
audio, therefore never shows early. Applying a moment never makes the level jump; a unit test checks the level just
before and just after.

### States and transitions

| Moment | Phase, mood | Level (arousal) | Notes |
| --- | --- | --- | --- |
| `approach` | approach, anticipation | murmur → min(0.62, (rest + 0.12)·k), τ 900 ms | k = 1 + 0.35·pressure. A new delivery: the per-ball memory resets. |
| `gather` | stride, concentration | → 0.12 / k, τ 120 ms | The hush, 450 ms before release. Deeper under pressure. |
| `release` | flight, breath | → 0.07 / k, τ 90 ms | The collective breath while the ball travels. |
| `pitch` | (none) | (none) | The bounce is an effect, not a crowd beat. |
| `contact`, middle | contact, response | → (0.16 + 0.1q)·k | The breath out at the crack. No reaction yet: a block that goes nowhere gets none. |
| `contact`, edge | contact, gasp | "ooh" peaks 0.5·k | An edge is an anxious moment. |
| `pad` | contact, gasp | "ooh" 0.45·k, held | The appeal's intake, held until the decision. |
| `beaten` | contact, gasp | "ooh" (0.3 + 0.35c)·k | A close call, by closeness c. Caption `crowd_gasps` when c ≥ 0.6. |
| `carry` | chase, expectation | → (0.3 + 0.3p²)·k, never above 0.6 in all | Rising expectation, accelerating towards the rope (p = progress). The first carry lifts the crowd (`lift`). Until the outcome is confirmed, base, reaction and tail together stay at or under 0.6 (`CROWD.expectMax`), below every four: no look-ahead. |
| `fielded` after carry ≥ 0.55 | frustration | "groan" 0.46 | A ball racing to the rope and stopped: the missed opportunity. |
| `four` | outcome, celebration | 0.74 + 0.08·pressure − 0.08·fatigue, at most 0.83 | A strong release (`cheer`), then a hold of 3.4 s and a relaxation. |
| `six` | outcome, eruption | 0.92 + 0.08·pressure − 0.08·fatigue | Peak celebration (`eruption`), then a hold of 3.8 s and a relaxation. |
| `wicket` | outcome, silence → dismay | falls to 0.03 within 150 ms, with no spike | Decisive silence: crowd one-shots still sounding fade out. After 900 ms the shift (`dismay`, a low falling murmur) rises out of it, then the ground stays subdued (0.12). |
| `survived` | outcome, relief | relief 0.42 | Relief after a close call (the recovery after the breath). |
| `dot` after a shot | outcome, restless | rest + 0.02 | Mild pressure: a restless murmur, a little more with each dot in a row. A middled hit that went somewhere and came to nothing groans. |
| `dot` after a leave | outcome, murmur | rest − 0.04 | Restrained: the crowd quietly resettles. |
| `runs` | outcome, applause | 0.40 + 0.05·runs + 0.06·pressure, at most 0.6, at least rest + 0.1 | Acknowledgement: applause. |
| milestone (a four, six or runs passing 50 or 100) | ovation | +0.05, a long hold | `ovation`, with caption `milestone_fifty` or `milestone_hundred`. |
| `reflection` | reflection → between | → rest, τ 3.2 s | The settle before the next ball. Back to `between` after 4.2 s. |

**Proportional feedback (the experience constitution, EMO1).** The peaks sit in bands that never overlap, whatever
the fatigue and the pressure, so six > four > single > dot ≥ leave holds on every ball:

| Event | Band | Constitution |
| --- | --- | --- |
| Six | 0.84–1.0 | Peak celebration, never World Cup-final noise for a routine boundary |
| Four | 0.66–0.83 | Strong release |
| Single | rest + 0.1 … 0.6 | Acknowledgement |
| Dot | rest + 0.02 | Mild pressure |
| Leave | rest − 0.04 | Restrained |
| Edge | an "ooh", the `tick` haptic | Tension |
| Near miss | an "ooh", then relief | Breath and recovery |
| Wicket | silence within 150 ms, the impact, then the shift | Decisive silence, impact, then a shift in the crowd |
| Exact-ball improvement | `playMasteryFeel` on the coach's mastery event only | A satisfying mastery confirmation |

**Habituation (fatigue).** Maximum crowd noise does not follow every event. Each four adds 0.25 of fatigue and each
six 0.35, and fatigue relaxes with τ 40 s. Peaks shrink with it, inside their bands. Repeated sixes peak lower each
time, and a long break restores the crowd's voice. Unit tests cover both.

**Momentum.** A four adds 0.35, a six 0.5 and runs 0.04 per run; a dot takes 0.12 and a wicket sets −0.6. The
resting murmur is 0.3 + 0.08·pressure + 0.05·momentum⁺ + 0.012·(dot streak, up to 4), held between 0.24 and 0.42.

### Measured peaks and decay

Unit tests check these numbers. The pressure is 0, and the reflection comes 1.8 s after dead ball, as the stage
sends it.

| Ball | Peak | Rest | Half-life above rest | Time to half the peak |
| --- | --- | --- | --- | --- |
| Six | 0.92 | 0.33 | 3.0 s | 5.8 s |
| Four | 0.74 | 0.32 | 2.7 s | 7.1 s |
| Single | 0.45 | 0.30 | 1.5 s | n/a |
| Dot | 0.33 (a restless murmur) | 0.31 | n/a | n/a |
| Leave | 0.31 (resettles) | 0.31 | n/a | n/a |
| Bowled | none: 0.07 → 0.03 within 150 ms, the shift 0.20 at about +1.5 s | 0.12 (subdued) | n/a | n/a |
| Caught in the deep | none: 0.49 → 0.05 within 150 ms | 0.12 (subdued) | n/a | n/a |

No routine Practice boundary reaches the maximum: even a six off the last ball of the final over (pressure 0.35)
stays below 1.0. Only a boundary under real pressure (a close chase, a milestone) gets there.

### Match context (`src/audio/situation.ts`)

`deliveryContext({ runs, wicketsInHand, ballsLeft, target?, batterRuns? })` returns
`{ pressure, milestone, wicketEndsInnings, runs }`. The UX controller passes it to `stage.bowl(flight, ctx)`, and the
stage forwards it to `sink.context(ctx)`. Pressure (0..1) is the sum of:

| Situation | Pressure |
| --- | --- |
| Final over (1–6 balls left) | +0.25; the last ball +0.35 |
| A chase that can still be won (at most 6 a ball) | +0.20 … +0.65: most with few balls left, less when almost won |
| A chase beyond reach | +0.10 |
| The last wicket in a chase | +0.10 (a Practice innings is always one wicket, which is not extra pressure) |
| A milestone within a boundary (44–49, 94–99, …) | +0.12 |

The pressure, deliberately, changes nothing in the simulation. The same ball is bowled and judged whatever it is.

## The mix (`src/audio/engine.ts`)

```
effects voices   → level(effects)                 → duck* ─┐
crowd one-shots  → level(crowd)                   → duck  ─┤
music (the dhol) → level(music)                   → duck  ─┼→ action compressor → mix → makeup → limiter → master
interface        → level(effects × 0.8) → quiet gate → duck ─┘                        ↑
crowd bed        → bed level(crowd × MIX.liveBedGain)  → duck ─────────────────────────┘
* the effects bus is never ducked: it holds the priorities
```

There is one AudioContext. It is built in idle time (`installMatchAudioUnlock`, unchanged for callers) and resumed
by the first gesture. The compressor, makeup (+7.2 dB) and limiter are the measured `MIX` constants (`mix.ts`), so
the live mix still matches the highlight render: about −14 LUFS, at most −1 dBTP, with the bed 8 LU under the action.

### Priority (constitution §13)

| Priority | Sound | Bus |
| --- | --- | --- |
| 1 | Ball release | effects |
| 2 | Pitch contact | effects |
| 3 | Bat contact (and the pad, the stumps) | effects |
| 4 | Ball trajectory and fielding (gloves, fielded, throw, the boards) | effects |
| 5 | Player calls | (none synthesised) |
| 6 | Crowd: the bed and the reactions | crowd, bed |
| 7 | Commentary | (none) |
| 8 | Interface | interface |
| (none) | Music: the celebration dhol, only after a confirmed boundary | music |

**Ducking.** Release, pitch contact and bat contact each duck every lower bus: the crowd and the bed to 0.35
(−9 dB), the music to 0.2 (−14 dB) and the interface to silence. The duck goes in 4 ms before the sound and holds
for its length: release 220 ms, pitch 120 ms, contact 300 ms. It returns with τ 120 ms.

Nothing masks the contact:

- the crowd is at its breath (0.07) when the ball arrives and is ducked under the crack;
- the music plays only after a boundary;
- no commentary exists;
- interface sounds are gated.

**Delivery Quiet Mode (§4).** From the start of the approach to dead ball (`sink.quiet(true/false)`, driven by the
stage), the interface gate is closed:

- `playUiCue`, `playSealChime` and the seal cue are dropped;
- anything sounding on that bus fades within 20 ms;
- `playMasteryFeel` waits and plays 250 ms after quiet ends;
- the crowd-reaction bank does no rendering work.

**Levels.** A level (0..1) becomes a gain as level^1.7, so "Low" (0.5) is about −10 dB. Changes apply at once,
smoothed over 50 ms.

## Settings (`src/audio/settings.ts`)

| Field | Default | Controls |
| --- | --- | --- |
| `effects` | 1 | Release, pitch, bat contact, edges, stumps, fielding, and the interface (at 0.8 of it) |
| `crowd` | 1 | The bed and the crowd reactions |
| `music` | 1 | The celebration dhol (the only music) |
| `haptics` | true | Practice vibration |
| `releaseHaptic` | false | The optional, very subtle tick at release (§12) |
| `captions` | false | Captions for the essential cues |

- **Storage.** The settings are kept in localStorage under `vc:practice:audio` (`AUDIO_SETTINGS_KEY`), in the
  Practice conventions: `v: 1`, every read validated, anything corrupt treated as absent.
- **Master switches.** The app's Sound and Vibration switches (root store, `syncAudioSettings`) stay the masters:
  Sound off silences every bus, and Vibration off stops every haptic.
- **API.**
  - `getAudioSettings()` returns a frozen snapshot whose identity changes only on a change (React:
    `useSyncExternalStore(subscribeAudioSettings, getAudioSettings)`).
  - `setAudioSettings(patch)` validates, saves and applies at once.
  - `resetAudioSettings()` and `AUDIO_LEVELS = [0, 0.5, 1]` are the other exports.
- **Clearing.** The UX workstream adds the key to `PRACTICE_KEYS`, so that "Clear Practice data" removes it, and
  calls `resetAudioSettings()` afterwards.

## The sounds

### Contact signatures (FBK1)

Each contact sounds and feels different, and a test enforces it:

| Contact | Sound | Haptic | Caption |
| --- | --- | --- | --- |
| Sweet spot (middle, perfect) | Willow crack and a bright ring | `double` | `sweet_spot` |
| Middle | Crack and ring | `pulse` | `middle` |
| Middle, mistimed | A duller thock: less crack, more thud | `soft` | `mistimed` |
| Defensive block (the stage's `block` feel: a defended middle) | The dead bat's damped thud, short and soft | `tap` | `block` |
| Inside or leading edge | A thick edge click | `tick` | `inside_edge`, `leading_edge` |
| Outside edge | A thin edge click | `tick` | `outside_edge` |
| Top edge | A hollow tock off the shoulder, with a rattle | `tick` | `top_edge` |
| Pad or body | Pad thud, or a dull body thump | `tap` | `pad`, `body` |
| Miss | The swing's swish only (no contact sound) | none | `play_and_miss` |

The pitch sound follows the surface: a hard pitch cracks, a green one thuds softly, a turning (dry, dusty) one puffs
with grit, and a balanced one gives the original bounce. The release whoosh follows the bowler's pace.

### The crowd

The **bed** is a continuous murmur (`crowdBed.ts`): three band-passed noise layers breathing on slow LFOs, through a
brightness low-pass. Hushed is muffled (about 1 kHz) and excited is bright (up to 4 kHz). It follows the machine's
base curve on the audio clock: each transition schedules the same exponential, and the relaxation after its hold,
as AudioParam targets. It needs no frames and keeps moving in Delivery Quiet Mode.

The **reactions** are one-shots on the crowd bus at `0.8 × (0.3 + 0.7 × level)`, with ±3% rate variation:

| Reaction | Synthesis | Length | Loudness |
| --- | --- | --- | --- |
| `lift` | "eh-ah" voices rising, a few claps | 1.1 s | −21 LUFS |
| `ooh` | "oo-oh", a quick swell and fall | 1.35 s | −20 |
| `groan` | "aw", falling pitch | 1.8 s | −21 |
| `relief` | An exhale (falling low-pass) and scattered claps | 1.6 s | −23 |
| `applause` | 34 clappers | 2.5 s | −21 |
| `cheer` (four) | "ah" and "eh" choruses, 40 clappers, two whistles | 2.9 s | −17.5 |
| `eruption` (six) | Larger, brighter choruses, 60 clappers, four whistles, the stand's rumble | 3.9 s | −16 |
| `ovation` (milestone) | 64 clappers, cheering, whistles, sustained | 5.6 s | −18 |
| `dismay` (after a wicket's silence) | A low, falling "oh-aw" rising out of the silence | 1.9 s | −22 |

Each reaction is normalised to its integrated loudness (BS.1770), so the order holds however the synthesis is tuned.

**Music.** The dhol (a generic, synthesised dhol-style rhythm) plays on the music bus 250 ms after a four, and 200 ms
after a six followed by a second phrase. It never sounds before the boundary is confirmed.

## The haptic map (constitution §12)

All haptics go through one scheduler, so no two patterns ever start within 60 ms of each other. They follow the
app's Vibration switch and the Practice `haptics` setting, and never fire in the background.

| Moment | Pattern | Web vibrate (ms) | Native (Capacitor Haptics) |
| --- | --- | --- | --- |
| Release (optional, off by default) | `whisper` | [5] | vibrate 5 ms |
| Bat contact: sweet spot | `double` | [32, 70, 14] | heavy, then light at +102 ms |
| Bat contact: middle | `pulse` | [24] | medium |
| Bat contact: mistimed | `soft` | [16] | light |
| Edge (distinct, light) | `tick` | [10] | light |
| Pad or body | `tap` | [12] | light |
| Close call (`beaten`): restrained | `restrained` | [8] | light |
| Stump impact without a dismissal: sharp | `sharp` | [22] | heavy |
| Wicket: decisive | `decisive` | [40, 80, 24] | heavy, medium at +120 ms |
| Four: confirmation | `confirm` | [14, 70, 14] | medium, light at +100 ms |
| Six: stronger confirmation | `confirm_strong` | [24, 70, 24, 70, 14] | heavy, medium +110, light +220 |
| Coach mastery: restrained success | `mastery` | [8, 90, 8] | light, light at +110 ms |
| Miss, leave, navigation, score updates | none | none | none |

A bowled dismissal is felt once: the decisive pattern begins with the stumps' sharp hit. With Reduced Motion, a six
uses `confirm` instead of `confirm_strong`. No interface cue ever vibrates.

## Captions (`src/audio/captions.ts`)

`onCaption(fn)` delivers `{ id, key, kind: 'bat' | 'wicket' | 'boundary' | 'crowd' | 'coach', atMs, holdMs }` while
the Captions setting is on, and also while the sound is muted or off. The UX words the closed keys
(`CAPTION_KEYS`: `practice.caption.<key>`) and shows them in the status-strip area, never over the play.

| Group | Keys |
| --- | --- |
| Bat | `sweet_spot`, `middle`, `mistimed`, `block`, `inside_edge`, `outside_edge`, `top_edge`, `leading_edge`, `play_and_miss`, `pad`, `body` |
| Wicket | `bowled`, `caught`, `caught_behind`, `lbw`, `not_out` |
| Boundary and milestones | `four`, `six`, `milestone_fifty`, `milestone_hundred` |
| Crowd | `crowd_rises`, `crowd_gasps`, `crowd_groans`, `crowd_applauds`, `crowd_cheers`, `crowd_erupts`, `crowd_stunned`, `crowd_relieved`, `crowd_ovation` |
| Coach Mode | `mastered`, `stage_up` |

Rules:

- Nothing between the start of the approach and the contact: the release, the pitch and the flight stay free of text.
- A wicket's `crowd_stunned` is emitted with the silence; the shift needs no caption.
- Nothing before physical confirmation: a four or six at the rope, a wicket at the stumps, the catch or the decision.
- Each caption is emitted at the moment its sound plays.
- Muting the sound or turning haptics off loses no essential information (A11Y5).

## Timing (COH6) and the event-timing log

Every sink call may carry `atPerfMs`, the performance time the event belongs to. The stage knows contact times ahead,
inside its dispatch horizon, and should call early with that time.

- **Sounds.** Each sound is scheduled on the audio clock to be heard at `atPerfMs`. `perfToCtx` maps performance
  time to context time through `AudioContext.getOutputTimestamp()`, so the output latency the browser reports is
  compensated. A call that arrives late is played at once.
- **Waiting outputs.** Haptics, captions and the machine's phase, mood and outcome wait until `atPerfMs`.
- **Called ahead.** The crack is heard within 1 ms of the contact and the haptic fires on it (unit test).
- **Called at the moment.** The sound is late by the device's own reported output latency plus about 2 ms
  (unit test).
- **A miss.** It plays only the swing's swish: no contact sound and no vibration.

**The log.** It exists in the hooks build only (`VITE_PRACTICE_TEST_HOOKS=1`), as
`window.__vandeAudio.log() → AudioLogEntry[]`, with `clear()` and `emotion()`. In production the flag is a build
constant and every call is removed. Each entry is:

```
{ type: 'sound' | 'haptic' | 'crowd' | 'caption' | 'moment', name, atPerfMs, ctxTime, audioPerfMs, level, bus, detail? }
```

| Entry | Contents |
| --- | --- |
| Sounds | The effect id, the bus, the gain, the scheduled context time, and that time mapped to performance time (`audioPerfMs`, output latency included) |
| Crowd: reactions | The reaction and its level |
| Crowd: `bed` | Each bed curve and its target |
| Crowd: `level` | A 20 Hz series of the crowd's arousal, with `phase:mood` in `detail`, so a drop or a swell can be measured |
| Moments | The kind, and the arousal at that time |
| Coach | `improvement:mastered` and `improvement:stage_up`, the only confirmation events |

## Performance and robustness

- **One AudioContext.** It is built in idle time once the unlock is installed (`installMatchAudioUnlock`), so the
  first gesture only resumes it (about 0.1 ms; unit test).
- **No allocation in hot paths.**
  - Every Practice cue plays from a pre-rendered buffer with exactly two nodes, a buffer source and its gain (unit
    test).
  - The emotion machine runs in place, with one state and one sample object.
  - The bed follows scheduled AudioParam targets, with no per-frame work.
  - Haptic steps and deferred captions use `setTimeout(fn, ms, arg)`, with no closure per step.
- **The banks.**
  - **Effects sprite.** 28 voices, 9.4 s mono at the context rate, about 1.8 MB at 48 kHz. Rendered once in an
    OfflineAudioContext, off the main thread.
  - **Crowd reactions.** 9 voices, 22 s mono at 16 kHz, about 1.4 MB. Rendered by plain DSP in idle slices of at
    most a few ms (512 samples), and paused during Delivery Quiet Mode. All nine take about 180 ms of desktop CPU,
    spread over idle time.
  - **Placeholder takes.** 54 background fetches and decodes, never during a delivery, each checked by byte count and
    SHA-256; about 1.45 MB decoded (computed, not measured on a phone). The contact kinds come before the applause in
    the manifest, so the applause is ready only after the 54 contact files load; that delay is unmeasured on a phone
    (wedge `sound/SOUNDKIT-REPORT.md` §6–§7).
  - **Fallback.** Until a bank is ready, cues are synthesised live, as before.
- **The background.**
  - Going hidden stops every tracked voice, resets the ducks and suspends the context.
  - Coming back resumes it and re-syncs the bed to where the emotion curve is now, so nothing is left hanging or
    frozen.
  - Haptics never fire while hidden.
- **Sound off.** It stops every voice and suspends the context. The emotion machine keeps running.
- **Reduced Motion.** There are no fireworks sounds (their visuals are motion), and a six's haptic is `confirm`
  rather than `confirm_strong`.

## Integration API (from `'@/audio'`)

**Presentation (the stage).**

```ts
createPracticeSink(): PracticeSoundscape   // practice/audio.ts: export { createPracticeSink as createPracticeAudio }
interface PracticeSoundscape extends PracticeSink {
  cue(kind: SceneEventKind, intensity: number, rate: number, atPerfMs?: number): void;
  crowd(level: number): void;
  feel(feel: ContactFeel, intensity: number, contact?: ContactKind, timing?: SwingTiming, atPerfMs?: number): void;
  moment(m: EmotionMoment, atPerfMs?: number): void;            // the stage's StageMoment
  emotion(state: { arousal: number }): void;                    // fallback only, before the first moment
  quiet(on: boolean): void;                                     // Delivery Quiet Mode
  context(ctx: DeliveryContext & { conditions?: PitchCondition }): void;
  emotionNow(atMs?: number): Readonly<CrowdEmotion>;            // the 3D crowd's one curve
  dispose(): void;
}
```

Requests to presentation, approved by the lead:

- call `context()` in `bowl()`;
- pass the contact kind and timing to `feel()`;
- emit periodic `carry` moments carrying the current rope progress, with no look-ahead;
- call early with `atPerfMs`;
- never mute through `setSink(null)` (the crowd needs the machine), but through the settings.

Until the stage sends moments, `cue()` and `crowd()` keep the Sealed Six mapping.

**Practice UX.**

```ts
getAudioSettings() / setAudioSettings(patch) / subscribeAudioSettings(fn) / resetAudioSettings()
AUDIO_SETTINGS_KEY, AUDIO_LEVELS, DEFAULT_AUDIO_SETTINGS, type AudioSettings
onCaption(fn: (c: Caption) => void): () => void; CAPTION_KEYS; type Caption, CaptionKey, CaptionKind
playUiCue(cue: 'select' | 'confirm' | 'lock'): void           // silent in Delivery Quiet Mode, never vibrates
playMasteryFeel(event?: 'mastered' | 'stage_up'): void       // on the coach's masteryEvent only
deliveryContext(s: MatchSituation): Required<DeliveryContext> // for stage.bowl(flight, ctx)
installMatchAudioUnlock()                                     // unchanged
```

**Anywhere, with no audio graph.** `'@/audio/emotion'` exports `createEmotionMachine`, `reduceEmotion`,
`sampleEmotion`, `deliveryContext`, `matchPressure` and the types. A unit test checks that it imports nothing but
its own pure modules.

## Tests

One command runs them: `npx vitest run tests/unit/audio`, under `nice -n 15` on the shared machine.

| File | Covers |
| --- | --- |
| `emotion.test.ts` | The rhythm of a delivery and continuity. Natural decay, habituation and the non-overlapping bands. Pressure and milestones. The wicket's silence within 150 ms and its shift, a catch in the deep, close calls and frustration. The half-life of 2–8 s, no reaction before the event (early delivery), determinism, purity, the zero-allocation sample, the StageMoment type contract and import safety. |
| `contact-feel.test.ts` | F-022: a defended middle is a block, an attack keeps the sweet spot, and every bat feel carries its contact. |
| `practice-sink.test.ts` | COH6 timing, called ahead and on time. FBK1 signatures, a miss with no contact sound or vibration, the §13 ducks, Delivery Quiet Mode and mastery deferral. A six end to end (crowd, dhol, haptic, captions, nothing before the rope). A wicket end to end (impact, decisive haptic, silence, shift). The bus levels and haptic settings, the machine with the sound off, the background, and the Sealed Six fallback. |
| `haptics.test.ts` | The §12 map: one pattern each, in proportion and ordered. Native steps, and the Vibration and background rules. |
| `crowdVoices.test.ts` | Deterministic crowd renders at their loudness and under their peak, chunked equal to whole, distinct timbres and shapes. The sprite layout, the offline render, two-node playback, and the idle crowd build pausing in quiet. |
| `settings.test.ts` | Validated storage, the stable snapshot, notifications, reset, no storage. Captions only while on, and the closed keys. Match pressure and milestones. |
| `prepare.test.ts` | The idle warm-up: the first gesture only resumes the context. |
| `recorded.test.ts` | Recorded takes: FNV-1a vectors, the delivery key and exact-ball retry, spread over every take, onset detection behind codec padding, COH6 and FBK1 on the sink, muting never shifting a choice, failed, wrong-size or wrong-hash takes never played, the 14-kind inventory and honest labels, shipped files matching the manifest byte for byte, −21 LUFS ± 0.5 and peak ≤ 0.95. |
| `scripts/audio/*.test.mjs` | Node tests for the placeholder generator and the recording kit: onset, loudness, determinism, licence refusals, ingest and the one-step swap. Run with `npm run audio:tools:test`; an evaluator ran it on 2026-11-03: 28/28 pass (`release/product-sequence/stage-1-practice/wedge/eval-assets/VERDICT.md` 3.7). |

The pre-existing `tests/unit/ui/batting-feel.test.tsx` and `tests/unit/ui/loudness.test.ts` stay green.

## Assets

Every audio asset is original, synthesised in code by this repository, with no recordings, samples, sound libraries
or third-party audio, except the licensed recordings below:

- **Recorded applause:** `public/audio/cricket/applause-1.mp3` … `applause-4.mp3`, CC0 1.0 and CC BY 3.0/4.0,
  indoor audiences (not a cricket ground). Register: `release/product-sequence/stage-1-practice/wedge/sound/REGISTER.md`;
  attribution: `public/third-party-notices.txt`. The synthesised reaction's ±3 % rate now comes from the delivery
  record, not the session's reaction count. Unity plays byte-identical copies of the same four takes (Vorbis at
  24 kHz; `release/product-sequence/stage-1-practice/wedge/unity/REPORT.md` §1.2).

The original assets:

- **Effect voices:** `voices.ts` and `fxVoices.ts`, Web Audio oscillators and filtered noise.
- **Crowd reactions:** `crowdVoices.ts` and `dsp.ts`, deterministic DSP.
- **Noise:** the noise buffer comes from the engine's PRNG.
- **The dhol:** a generic dhol-style rhythm, synthesised; no recording of any performance.
- **Placeholder contact takes:** `public/audio/cricket/ph-<sound>-1..3.mp3`, 54 files (3 for each of the 18 contact
  sounds), rendered offline by `scripts/audio/placeholders.mjs` with impact and modal synthesis: no samples, downloads
  or recordings. Each is flagged `placeholder: true` and labelled "Placeholder: … not a recording", with register ids
  `TC-KK-Pnn` (wedge `sound/REGISTER.md` §8). Unity ships byte-identical copies (`IsPlaceholder` in C#). On 2026-11-03
  an evaluator re-rendered all 54 byte for byte, for the web and for Unity, and found nothing that presents them to the
  player as recordings (`release/product-sequence/stage-1-practice/wedge/eval-assets/VERDICT.md` item 5, PASS).

Licence: the project's own (UNLICENSED, proprietary to VANDE). Memory and load costs are listed under "Performance
and robustness". `docs/ASSET_REGISTER.md` carries the per-asset rows, in its "Audio" section.

## Known limitations

- **Not measured on a phone.** No physical Android device has been measured by this workstream. The output latency
  compensation, haptic latency, bank build time and loudness on a phone speaker are unverified there.
- **Calibration is not measured live.** The crowd reactions' levels relative to the effects (`CROWD_TRIM`, the
  reactions' LUFS) and the bed mapping are set by design, not by measurement of the live mix. The highlight's
  measured `MIX` gains are unchanged.
- **The crowd is synthesised.** It is convincing as texture, but a human listening test has not rated its realism.
- **No contact recordings yet.** All 18 contact sounds play placeholder takes, which no listener has rated, so WA9
  stays open. Whether audible placeholders count against ART7's "no placeholder" gate is an owner decision
  (`eval-assets/VERDICT.md` 5.5).
- **No player calls or commentary are synthesised.** Their §13 slots stay empty.
- **Replays are silent** (the stage does not call the sink). A replay soundtrack (effects only, pitched by rate) is a
  possible later addition, not in Stage 1 scope.
