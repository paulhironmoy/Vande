# VANDE Cricket: Visual System

Owner: experience workstream. Covers the renderer decision, the design system ("Indian night cricket"), the 3D match
renderer, audio and haptics, accessibility, localisation support and the screens. Code: `src/render3d`, `src/ui`,
`src/styles`, `src/screens`, `src/audio`, `src/i18n`.

---

## 1. Renderer decision (measured spike)

**Decision: Three.js r186 (WebGL 2), lazy-loaded, with a Canvas 2D fallback.** Babylon.js 9.30.0 was the alternative.

Both engines rendered the same minimal scene: a lit pitch and ground, six stumps, a moving ball, a directional light
with a 1024 shadow map, and an animated glTF character (an original, script-generated skinned cricketer: 19 bones,
3,692 triangles, a code-authored run cycle, 107 KB GLB). Each was built with Vite 8 (minified), served with gzip, and
measured in Playwright 1.64.1 Chromium at **390×844, DPR 2**, renderer pixel ratio capped at 1.5, on an Apple M1 Pro.
"Slow 4G" = 150 ms RTT, 1.6 Mbps (Lighthouse mobile preset). SwiftShader (software rendering) stands in for a weak
GPU. Three runs per row, medians. The spike was a one-off: its throwaway harness and raw data are not kept in the
repository, and this table is the record.

| Scene, condition | Three.js | Babylon.js (code-split) | Babylon.js (single bundle) |
| --- | --- | --- | --- |
| JS loaded for first frame, gzip | **152.6 KB, 1 file** | 401–456 KB, 57 files | 612.6 KB, 1 file |
| All JS emitted, gzip | 156 KB | 693 KB (128 files) | 613 KB |
| Time to first frame, 4x CPU + Slow 4G (1 / 12 characters) | **1,540 / 1,589 ms** | 3,741 / 3,840 ms | 4,094 / 4,207 ms |
| Time to first frame, 6x CPU + Slow 4G (1 / 12) | **1,637 / 1,713 ms** | 3,924 / 4,252 ms | 4,378 / 4,533 ms |
| JS per frame, 12 characters, 4x CPU (mean / p95) | **1.82 / 2.5 ms** | 2.96 / 3.9 ms | 2.55 / 3.4 ms |
| JS per frame, 12 characters, 6x CPU (mean / p95) | **2.53 / 3.7 ms** | 4.53 / 5.9 ms | 3.91 / 5.3 ms |
| SwiftShader, 1 character (fps) | **53** | 42 | 42 |
| SwiftShader, 12 characters (fps) | **29.2** | 25.5 | 25.6 |
| Draw calls (1 / 12 characters) | 18 / 40 | 18 / 40 | 18 / 40 |
| WebGL context loss + restore | Recovers (events seen, ~123 frames after restore, identical pixels) | Recovers (same) | n/a |

Both hit vsync (60 fps) on the M1 GPU at every CPU throttle, so the differentiators are download, startup and CPU per
frame, all of which favour Three.js by roughly 2–3x. Both load glTF animation, both recover from context loss, both
work in Capacitor's Android WebView (WebGL 2). Three.js is the smallest approach that meets every criterion in the
brief, and its modular API keeps the renderer behind our own interface (`MatchRenderer`), so it can be swapped later.

Consequences: three.js r163+ requires **WebGL 2**; devices without it get the 2D presentation (`webglAvailable()` probes
WebGL 2 only). **PixiJS is no longer imported anywhere** in `src` or `tests`, and `pixi.js` is no longer listed in `package.json`.

### The production renderer, measured

Production build of the renderer harness (`vite build`, minified, gzip -9), same phone profile (390×844, DPR 2.625),
full fixture replay playing, M1 Pro. "Main thread" is Chrome's TaskDuration per rendered frame.

| Chunk | gzip | brotli | Loaded |
| --- | --- | --- | --- |
| `ThreeMatchRenderer` (three.js + the 3D layer) | **152.9 KB** | 126.6 KB | lazily, when a match stage mounts |
| Shared core (timeline, choreography, clips, cameras) + engine | 45.3 KB | 39.3 KB | with the first screen that needs it |
| `Fallback2DRenderer` | 2.8 KB | 2.5 KB | only without WebGL 2 / after a fallback |
| Session (playback clock, live state) | 3.7 KB | 3.3 KB | with the stage |
| Screens + design system + React (gallery build, incl. dev fixtures) | 108.9 KB | 95.0 KB | per route (root decides splitting) |
| CSS (all screens and components, 3 files) | 16.7 KB | 15.2 KB | |
| Locale catalogs | hi 8.3, hi-Latn 7.0, others ~2.0 KB | | on demand |

**App shell cost.** A separate build of a shell that renders only the design system (`UiProvider`, primitives, tokens,
English catalog) is **82.9 KB gzip JS + 5.6 KB CSS**, of which React 19 + ReactDOM alone is 67.4 KB: the design system
adds about 15.5 KB (7 KB of it the English catalog). It contains no engine and no three.js code: `src/ui` keeps local
copies of the swipe sectors, legal zones and release meter, and the gameplay screens register the engine's own rules
at load time (`src/screens/engineRules.ts`); a unit test asserts the local tables match the engine exactly.

| Quality | GPU | CPU throttle | Renderer fps | Main thread / frame | Draw calls |
| --- | --- | --- | --- | --- | --- |
| Standard | M1 (Metal) | 1x | 60 | 1.3 ms | 63 |
| Standard | M1 | 4x | 60 (rAF 59.2) | 6.5 ms | 63 |
| Standard | M1 | 6x | 60 (rAF 58.5) | 10.8 ms | 63 |
| Low (30 fps cap) | M1 | 4x | 30 | 5.9 ms | 51 |
| Low | M1 | 6x | 30 | 7.3 ms | 51 |
| Auto | M1 | 6x | 60 (stays Standard) | 7.1 ms | 51 |
| Standard | SwiftShader | 1x | ~6 | n/a (GPU-bound) | 53 |
| Low | SwiftShader | 1x | 30 (adaptive resolution) | 1.1 ms | 42 |
| Auto | SwiftShader | 1x | 30 (probe picks Low, no MSAA) | 1.1 ms | 47 |
| Auto | SwiftShader | 4x | 30 | 4.0 ms | 46 |

These are proxies. **Physical low- and mid-tier Android devices must still be measured** before release (Mali-G52/G57,
Adreno 610/618 class); see the measurement scripts in section 10.

---

## 2. Design system: "Indian night cricket"

A floodlit night game, not a dashboard: deep indigo atmosphere, electric cyan for interaction, amber floodlight warmth
for the moments that matter, restrained glass (only over the 3D stage) and glow (focus, the primary action, live
moments). Tokens live in `src/styles/tokens.css`; components in `src/ui`.

**Colour roles**

| Role | Token | Use |
| --- | --- | --- |
| Night | `--c-night-990…600` | Backgrounds, surfaces, stands |
| Interaction | `--c-cyan-500/400/300` | Primary buttons, focus ring, selected states, live cues |
| Floodlight | `--c-amber-500/400/300` | Hero/irreversible actions (Lock over, Rematch), energy, Player of the Match |
| Outcomes | `--o-dot`, `--o-run`, `--o-four` (cyan), `--o-six` (amber), `--o-wicket` (crimson), `--o-super` (violet) | Ball badges, graphics |
| Feedback | `--f-success`, `--f-warning`, `--f-danger` | Status and validation |

**Never colour alone.** Every outcome has its own shape and text: dot = circle with "•", runs = circle with the number,
four = rounded square "4", six = hexagon "6", wicket = diamond "W", sealed = hexagon with a lock, upcoming = dashed
ring, current = pulsing ring (static with reduced motion). Badges are images with full labels ("Ball 5: Bowled").
Factor bars carry "+ / − / =" and side labels; the energy meter states "2 of 15 left" / "Over budget by 2".

**Type.** Manrope Variable (bundled) for Latin; Noto Sans Devanagari (bundled, `local()` first) for Hindi and Marathi;
platform Noto families with Windows/Apple fallbacks for Bengali, Telugu, Tamil, Gujarati, Kannada, Malayalam and
Gurmukhi. Scale: 12 / 14 / 16 / 18 / 22 / 28 / 36 / 52 px (rem, scales with the Text size setting). Display
weights 750–820 with tight tracking for scores and headings; uppercase micro-labels with tracking for Latin only
(Indic locales get zero tracking and taller line height so conjuncts and matras never collide).

**Space, shape, motion.** 4 px grid tokens, radii 10–28 px, 48 px minimum targets (56/64 px for hero actions), primary
actions in a bottom thumb zone with safe-area padding. Motion: 90 / 170 / 300 / 620 ms with an out-curve and a spring
for pops; `data-motion="reduced"` (setting or system preference) collapses durations to ~0.

**Modes.** High contrast (`data-contrast="high"`): solid surfaces, brighter text and outcome colours, 2 px edges, no
glass or texture, white focus ring, check mark on switches. Reduced motion: calmer cameras (no orbits or follow-cams),
no camera shake or particle bursts, still celebration frames, no pulsing. Text size: 1 / 1.15 / 1.3.

**Components** (`src/ui`): Button (primary, accent, secondary, ghost, danger, link; sm–xl; loading), IconButton, Card
and CardButton, Chip, Dialog and Sheet (focus trap, Escape, restore focus, drag-to-close), Field, SegmentedControl
(radiogroup, arrow keys), Switch, ToastHost, ScreenShell (sticky header, `<main>`, sticky thumb-zone footer),
StateView (all 14 required states: loading, offline, reconnecting, empty tournament, pending opponent, locked, deadline
expired, reveal ready, error and retry, consent declined, upload queued, upload failed, muted group, reduced motion),
StatusBanner, Icon (original 24 px set incl. bat, ball, stumps, field, seal, energy, slow-mo), Avatar (generated SVG
portrait), OutcomeBadge, BallTimeline, EnergyMeter, FieldMap, ZonePad, ExecutionMeter, ScoreBug, UiProvider.

**Generated avatars** (`src/ui/avatar`): deterministic traits from a seed (eight Indian skin tones, hair styles,
beards, brows, eyes, face shapes, headwear including a patka, expression, height). The same traits drive the 2D portrait
and the 3D player. Eight original kit palettes and five patterns (plain, stripes, hoops, chevron, sash); no real team
colour schemes. No uploads, no likenesses.

---

## 3. The 3D match renderer

`src/render3d` implements the frozen `MatchRenderer` contract (`src/contracts/renderer.ts`) twice: `ThreeMatchRenderer`
(3D) and `Fallback2DRenderer` (Canvas 2D). `createMatchRenderer()` picks one and dynamic-imports it, so the app shell
never contains 3D code. Both play the same pure, testable core:

| Module | Role |
| --- | --- |
| `core/ground.ts` | World frame (origin mid-pitch, +Y up, striker at +z, **+x = off side** of a right-hander), pitch and crease dimensions, zone bearings, field settings → 9 fielder spots placed from the engine's own display mapping (`FIELD_POSITIONS`, `src/engine/fieldDisplay.ts`), so the gaps on the field map and in 3D are the gaps the engine plays (Balanced really is open at mid-off and midwicket). Close catchers (slips, gully) catch edges and field no zone |
| `core/trajectory.ts` | `BallPath` → a delivery flight that reaches the contact plane at exactly `releaseToContactMs` (what the batter times against), with swing in the air, turn off the pitch, bounce and carry to the keeper |
| `core/clips.ts`, `skeleton.ts`, `quat.ts` | 17-bone skeleton and 48 code-authored clips: run/jog/walk cycles, five bowling actions (long and short pace, side-on swing, off-spin, leg-spin), batting footwork (forward, back, across, charge, still, sweep) layered under seven shots (block, push, drive, cut, pull, sweep, loft, leave) whose bat follows a keyed path held by two-arm IK, fielding (ready, dive, high and chest catches, pick-up, throw), keeping (crouch, take, stumping), umpire signals (four, six, out), celebrations (jump, aeroplane run, clap, hands on head, appeal, raised bat, walk-off) |
| `core/actors.ts` | Per-player timed moves (clip, root path, heading, crossfade); evaluated as a pure function of time |
| `core/choreo.ts` | The choreographer: one engine outcome (or live delivery) → a script of actor moves, ball segments, stump hits, sound/haptic events, crowd envelope, overlay graphics and slow motion. Every fate is staged: dots (blocked, beaten, fielded with dives and throws), 1–3 runs (batters running and crossing, chase, throw back), fours (ground or one bounce, chase and dive at the rope, umpire signal, batters meeting mid-pitch), sixes (into the stands, fireworks, umpire signal), bowled (flying stumps and LED bails), caught (close or skied, catch and toss), lbw (appeal, finger), stumped, run out (direct hit) |
| `core/timeline.ts` | `MatchEventLog` + `ReplayMode` → segments (intro, innings cards, balls, innings break, Super Ball, result), strike rotation and new batters, score before/after each ball, Key Moments selection, slow-motion time warp (invertible), `locate`, `scoreAt`, `resultTime` |
| `core/camera.ts` | Director: every `CameraShot` as a pure function of the script (broadcast end, bowler follow, batter close, side on, stump cam, aerial, fielder follow, crowd, celebration) plus a batter's-eye `batting_pov` for live play and a `result_push` for the held breath before a result; deterministic shake. Portrait (aspect under 0.9: phones and the 9:16 Short) has its own framing for every shot: closer and narrower, the subject in the middle of the frame, the side-on wide replaced by a raised three-quarter view on the striker that leans towards the ball while it is near, the chase camera tighter, the aerial lower, the crowd cutaway replaced by a medium three-quarter front shot of the player at the heart of the moment, and the live batting view a step closer |
| `core/engineBridge.ts` | Aligns each ball to the engine's own per-ball timeline (`RUN_UP_MS`, `ballTimeline`): release and contact land exactly where the engine's camera cues expect them, and engine cues are re-timed onto the animated aftermath |
| `core/quality.ts` | Presets and the adaptive controller (section 4) |
| `core/session.ts` | Shared playback: replay clock (play, pause, seek, speed), live batting state, contract events, sound-cue dispatch |
| `three/*` | Stadium, procedural players, props and effects, renderer |
| `fallback2d/*` | The 2D presentation |

**Stadium** (all procedural, no external assets): indigo sky with a warm city horizon and stars; floodlit grass with
mowing stripes, concentric outfield rings and the 30-yard dashes; a pitch whose surface reads Green (grass tinge),
Hard (lighter, polished) or Slow (dry, cracked, footmarks) with painted creases; rope and two LED ribbon boards
(our own brand only) that flash cyan for fours, amber for sixes, crimson for wickets; two tiers of stands painted by a
shader that draws a seated crowd per seat cell (filtered at distance) with phone-light sparkles that grow with
excitement; an animated instanced crowd in the lower tier (bob and raised arms driven by the crowd envelope); pavilions
with lit windows behind the dark sight screens; six floodlight towers with light banks, glows and (Standard+) soft light
shafts. Night cricket's multiple player shadows are drawn as blob shadows radiating from the towers (2 or 4 per player),
plus a real shadow map on Standard+.

**Players**: one skinned mesh per player (one draw call), built in code from primitives with blended joint weights;
five gear variants (batter with helmet, grille, pads and gloves; keeper; fielder with cap; bowler; umpire with hat) and
two LODs. A patched PBR material paints kit colours and patterns, skin, hair, beard and a simple face from bind-pose
coordinates (crisp at any distance, no textures), and lights them to read on a dark outfield within the same one draw
call: a cool floodlight rim (brighter on upward-facing surfaces, because the lights are high), a soft sky and
grass-bounce fill so dark kits keep their colour on the shadow side, and a touch of contact shadow at the feet. Bats are placed from the clip's bat key
and both hands reach the handle with two-bone IK; bowlers' arms windmill through angle-interpolated aims.

**Ball**: seamed white ball with spin, a camera-facing trail sampled from the script (seek-safe), a cyan glow at
distance, a bounce ring, bat-impact flash and sparks. **Stumps**: instanced stumps and bails that break with closed-form
arcs and LED flashes.

**Live batting** (`prepareInnings`, `bowl`, `showShot`): the bowler runs in and releases at the engine's run-up time;
`released` resolves with the scheduled release time; the ball meets the contact plane at exactly `releaseToContactMs`;
`showShot` swings so the contact frame lands on the player's tap. **Nothing after the shot can reveal the result:**
about 0.25–0.33 s after contact the ball dissolves into a cyan seal ring, no stumps break, no boundary, catch or
fireworks events exist in live scripts (unit-tested).

**Determinism** (`renderAt(ms)` drives offline YouTube rendering): every visual is a function of (script, time): actor
poses, ball, trail, particles (seeded per burst), stumps, crowd and boards (shader time = timeline time), cameras. The
session never reads the wall clock in `renderAt` (tested with a clock that throws), and the e2e suite asserts identical
pixels for the same `renderAt` time after other frames. Found and fixed during this work: three.js r186 can skip a
shared skeleton's update for one frame after a shadow pass (its frame counter increments between projection and the
shadow map), so the renderer updates each visible skeleton explicitly.

**Failure handling**: no WebGL 2 → the factory returns the 2D renderer; a lost context that is not restored within
3.5 s emits `fallback` (`context_lost`); repeated draw errors emit `fallback` (`error`); sustained very low frame rate in
Low, after adaptive resolution reaches its floor, emits `fallback` (`low_fps`). `MatchStage` swaps to the 2D view at the
same replay time and reports the reason (for the `renderer_fallback` analytics event).

**Replay modes**: `full`, `key_moments` (key balls with trimmed run-ups) and `result_only`; slow motion is baked into
the timeline around decisive moments (rate 0.3) and `play(speed)` adds user slow motion (0.5x, 0.25x).

**The held breath.** Every replay's result opens with a 1.4 s beat (`RESULT_BEAT_MS`, the result segment's `beat`): the
crowd hushes, a low riser and a heartbeat build (`tension` cue), the camera pushes in from behind the bowler's arm
towards the batter's end (a still frame with reduced motion), and the picture darkens at the edges. Then the result
lands (`result` cue: a hit, a roar and a success haptic), the result card rises and the celebrations start. During the
beat everything up to the last ball is shown and nothing about the result is: the disclosure, the live region, the
total and the card all wait for it. Commentary that carries the result ("The chase falls 5 runs short.", "… gets home
with 2 balls to spare!", the winner, the turning point, Player of the Match, the Daily score) waits for the card too,
on the innings-end card and during the beat alike, and "Locked together … Super Ball" waits for the Super Ball's card;
the live region follows the same rule. The highlight starts its result card after the beat.

---

## 4. Quality modes

| Preset | fps cap | Pixel ratio | Shadows | Blob shadows | Crowd instances | Particles | Trail | LOD distance | Light shafts | MSAA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 30 | 1 (adaptive down to 0.6) | none | 2 | 1,400 static | 35% | 14 | 14 m | off | off |
| Standard | 60 | 1.5 | 1024 PCF | 4 | 3,600 animated | 100% | 26 | 26 m | on | on |
| High | 60 | 2 | 2048 PCF | 4 | 6,500 animated | 140% | 36 | 40 m | on | on |

`auto` probes the GPU before creating the WebGL context (MSAA cannot change later) and starts from the device
assessment `src/perf` measured for this app version (Below plays Low; the Lite, Standard and High profiles play Low,
Standard and High); with no assessment yet it starts in Standard, or in Low on a software renderer (`isSoftwareRenderer`).
It then samples real frame intervals: after a 45-frame grace period, two seconds of p75 above budget (20 ms at 60,
40 ms at 30: `src/perf`'s 50 fps floor) steps down one level, never up (no oscillation). In Low, sustained frames over
40 ms lower the render resolution in 20% steps to 0.6; only frames over 50 ms (`src/perf`'s spike) at that floor
trigger the 2D fallback. Offline rendering pins a fixed preset. `stats()` reports measured fps, frame ms, draw calls
and the active quality.

---

## 5. Audio and haptics (`src/audio`)

All match sound is synthesised in Web Audio (no recordings, no copyrighted audio): a three-band crowd bed that breathes
and follows the renderer's crowd envelope; bat crack (transient plus two wooden resonances and a thump; brighter for
perfect timing); a sweet-spot ring for the middle of the bat; the swing's swish; edge click; pad thud; ball bounce;
stumps clatter; bails clicks with a rising LED zing; gloves pop; boundary roar with a generic dhol-style drum pattern;
six roar; appeal swell; fireworks; the held breath's riser and heartbeat and the result's hit; and the brand "seal"
chime (also played when an over locks). Impacts drop pitch in slow motion. Cues are scheduled from script events while
playing (never during seek or `renderAt`).

**The batter's own feel** (`playSwingFeel`, `playContactFeel`). At the moment of the tap, before the server answers:
the predicted outcome's haptic and the sound the shot is predicted to make (`predictContact`: the crack, an edge, a
swish; a leave is silent). When the sealed answer lands it is upgraded: the middle of the bat rings; an edge the tap did
not predict ticks. The live stage's own bat and edge cues and its pad haptic are skipped
(`MatchAudio({ liveContact: true })`), so there is never a second crack or a stray buzz.

Each outcome has one readable haptic pattern (`src/audio/feel.ts`), and no two patterns ever start within 60 ms of
each other (short buzzes closer than that blur into one):

| Outcome | Pattern | Web (`navigator.vibrate`) | Android (Capacitor Haptics) |
| --- | --- | --- | --- |
| Edge (thick or thin) | one short tick | `[10]` | light impact |
| Middle of the bat | one medium pulse | `[24]` | medium impact |
| Middle, perfect timing | a firmer pulse, then a short beat 70 ms later | `[32, 70, 14]` | heavy impact, light at +102 ms |
| Leave, a miss, the pad | nothing | | |

The tap plays the predicted outcome's pattern; when the answer is a different outcome its pattern plays at least
60 ms after the first one ends (`createFeelScheduler`: a pattern asked for too soon waits, and a newer one replaces any
still waiting); the same outcome plays nothing more. An edge is therefore one tick, not a burst.

**One mix** (`src/audio/mix.ts`). The action (every cue) goes through its own compressor; the crowd bed sits 8 LU under
it, so no cue is buried; then a makeup gain and a limiter. The highlight renders the action and the bed to separate
channels, balances them exactly and masters the result offline (`src/audio/loudness.ts`: ITU-R BS.1770-4 K-weighted,
gated integrated loudness and a 4x oversampled true peak, then a look-ahead true-peak limiter): about **-14 LUFS
integrated, at most -1 dBTP** (YouTube's playback level, with room for the AAC encode). A full duel's Short measured
-14.1 LUFS and -1.1 dBTP, with the bed raised 9.8 dB and at most 4.7 dB of limiting (it was -25.2 LUFS before). The
live graph cannot measure itself ahead of time, so it uses the gains that render measured (`MIX.liveBedGain`,
`MIX.liveMakeupDb`); `node scripts/perf/highlight.mjs` prints them again after a voice changes.

**Settings and the device.** Sound and Vibration each follow their own setting (the batter's feel too). Nothing plays
before the first user gesture. Nothing plays or vibrates while the app is in the background: the audio context
suspends when the page is hidden and resumes (if Sound is on) when it returns. Where the browser has the Audio Session API
the app joins the `ambient` session, so the ringer switch mutes it and the player's own music keeps playing. Android's
WebView plays through the media stream, so the media volume (and muting it) applies like any game, and the system's
"Vibration and haptics" switch silences the haptics (the Vibrator honours it). Haptics: light at the tap and on edges,
medium or heavy for the middle of the bat, heavy on stumps and catches, success on boundaries and on the result, light
on seal.

---

## 6. Accessibility

WCAG-minded throughout: 48 px targets; visible focus ring (and a real outline in forced colours); Sheet/Dialog focus
trap and restore; radiogroups with arrow keys (shot chips, field, line, length, pace, intent, aim ring); the release
meter and BAT surface work from the keyboard (hold Space; arrows aim, Space plays the shot; keyboard traces use the
contract's `keyboard` pointer); accessible names include visible text (axe `label-content-name-mismatch` clean); every
screen has a `<main>` and a level-one heading; outcome badges are labelled images; live regions announce aim,
commentary and sealed feedback; reduced motion and high contrast as above; Indic line-height and no letter-spacing.
`tests/e2e/ux-renderer.spec.ts` runs axe on every screen (no serious or critical violations allowed) including the
Hindi, Hinglish, high-contrast and reduced-motion variants.

---

## 7. Localisation support

`src/i18n` provides ICU-lite messages: arguments, `number`, `plural` with exact matches and `#`, and `select`. `Intl` handles numbers (with Indian grouping), dates, relative time and lists. Catalogs are lazy-loaded with an English fallback, and unknown engine keys get a generic fallback, so a raw key never shows.

The app translator merges two sources per locale:

- my app catalogs (`catalogs/<locale>.ts`);
- gameplay's engine copy (`engine/<locale>.json`): the cricket vocabulary, hints, ghosts, explanations, commentary and the guide.

The social workstream keeps `social.*` and `banter.*` in its own catalogs. It loads them through `loadSource('social', …)` and its own hook.

`tests/unit/ui/i18n-sources.test.ts` fails on:

- a key defined by both the app and engine catalogs;
- a key outside its source's reserved prefixes;
- a placeholder mismatch.

English, Hindi and Hinglish app copy is complete (676 keys). Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Malayalam and Punjabi cover the core UI (81 keys) and are **machine-drafted, requiring human linguistic QA**. Settings marks them "(draft)". Per-locale status, sources and reserved prefixes are in `src/i18n/STATUS.md`.

---

## 8. Screens and routes (`src/screens`)

The root shell (`src/App.tsx`) renders `experienceRoutes` from `src/screens/routes.ts`:

- Every route is its own lazy chunk.
- A route waits for its translations before rendering. Screens without cricket vocabulary skip waiting for the engine copy.
- First paint carries no engine and no three.js.
- `home` is a tiny eager entry: a first-time visitor goes straight to onboarding without downloading the hub.

| Route | Path | Screen | States covered |
| --- | --- | --- | --- |
| `home` | `/` | Hub | A hierarchy, not a grid: "Your move" (the most urgent match with something to do or watch, bigger, with what to do next), then the Daily Six card (attempts left, best, streak, the server's reset time), then other matches by urgency with honest phase lines (see the next table), then the modes (Friend Duel as the hero, Group Cup, Practice Ghosts and Training as rows, never a lone tile), then Daily Top 100, Leaderboards, Profile. The opponent's rematch offer is a card ("{name} wants a rematch") that opens its invitation; the hub looks again at its next reveal time. A first visit says "Welcome", later ones "Welcome back". States: loading, offline, offline-only build, signing up, alias rejected (AliasFix), empty, error and retry |
| `onboarding` | `/start` | First run | The neutral age question first (VANDE Cricket is for players aged 18 and over: docs/PRIVACY_AND_CONSENT.md): the year of birth, empty, with no example year and nothing that says which answer lets you in; the month and day only for the year someone turns 18. Then one neutral check for every answer ("You entered 2012. Is that right?", Yes or Change year), so a typo cannot lock anyone out and the check says nothing about which answer passes; only Yes keeps it. Only the outcome is kept (`localStorage` `vc:age`: `adult` or `under`, never the year), and the sign-up sends `adultConfirmed` from it. Under 18: "VANDE Cricket is for players aged 18 and over" and a kind line, nothing to retry (deleting this device's data resets it). "Already played? Recover your account" is offered on the age screen too and skips it. A small Privacy link. Then the language (top right, the device's language by default, drafts marked), alias, generated avatar and starter kit (48 px swatches). When online, the guest account is created on the spot (a rejected alias stays on screen). Offline, the player continues locally and signs up automatically later (`useAccountSync`). Then Training, or back to the link that brought the player. "Already played? Recover your account" (only when Google or passkeys are configured): the provider's sign-in, `POST /v1/auth/google` or `/v1/auth/passkey`, `net.session.adopt`, `GET /v1/me` into the store player, then home. Cancelled, failed, offline and "no player linked" each say so and change nothing; a profile that fails to load drops the adopted session again |
| `training` | `/train` | Training | Bat, bowl and reveal in under a minute, offline. The engine's tutorial (`src/engine/training.ts`) supplies the coach's over, the lesson ball and a log that `verifyMatchLog` accepts. The reveal plays its Key Moments with the "sealed and verified" proof, then a recap of the player's shot and of the coach's answer to their delivery. Practice releases may be retried, and are labelled as practice. At large text the bowl step keeps the choice, the meter and "Watch the reveal" on one screen (names only on the delivery cards with the chosen one's hint below them, a smaller meter, the button pinned to the bottom). "In play" during bat and bowl. Analytics consent is asked once at the end (equal-weight choices, never blocking, only when analytics is configured) |
| `duel_new` | `/duel` | Friend Duel | Pitch or "Surprise me", and weather. `POST /v1/duels` with `attributionCode` when started from a highlight. Then the invite panel: WhatsApp first, the share sheet with the card image, copy link and QR code. Needs online; offline-only build; signing up |
| `invite` | `/i/:token` | Invitation | A language switch in the header. Spoiler-free preview (inviter, conditions, expiry, how it works; cup invites have their own third step), playable in the browser with no install; never crashes while the preview is on its way. Quick alias and avatar step (with the same neutral age question and its "Is that right?" check on a first visit; under 18, the kind stop and no account), then accept and go to the match (or the cup). Install link secondary, carrying the invite through the Play referrer. A privacy policy link in the footer. Links carry a 10-character code or a long signed token; an unknown code and an expired invite answer alike ("This invite has expired or isn't valid"), so codes cannot be enumerated. States: expired or invalid, already accepted, own invite, offline |
| `match` | `/m/:id` | Every phase | See the next table |
| `replay` | `/m/:id/replay`, `/key`, `/result` | Reveal | The reveal in its default mode (`defaultRevealMode`: Key Moments for duels, cups, ghosts and Training; Full for a Daily), Key Moments, or the result, verified locally (`engine.verifyMatchLog`), with the rematch state. Still-sealed, private (someone else's match: the server's 403 or 404), offline and error states |
| `shared` | `/s/:code` | Shared match | For anyone, no sign-in: a spoiler-safe landing ("{A} vs {B}: watch who won", moderated names from `GET /v1/s/:code`, conditions, no score), the reveal (verified on the device; the log shown with the moderated names), practice against either over on the device (`practiceAgainst`, unofficial), and Play VANDE Cricket. Broken link, offline and offline-only build states |
| `daily` | `/daily` | Daily Six | Conditions, attempts (pips), best, streak, India-time reset, fairness proof (the three over commits). Starts or resumes an attempt (the server returns the attempt in progress). Six balls, no Super Ball; the server decides when the attempt ends. The revealed ball is kept in IndexedDB, so a restarted app resumes the same ball instead of losing it to a leave. Answers go through the outbox. Result card with score, best (only a counted score; "No counted score yet today" until one counts) and streak. An attempt with more than one late, expired or invalid ball is shown plainly as not counting on the boards (the attempt is used up, the streak is kept). Then the proof line "Sealed before you batted" (the replay's over commit equals the commit published when the day opened, and the replay verifies). Then Watch (the replay shows the attempt's score, one innings and no Player of the Match), Share (once per attempt), Leaderboards and Try again |
| `ghosts` | `/ghosts` | Practice Ghosts | Choose one of the engine's five ghosts (names, styles, difficulty) and the conditions. Plan and lock, hashed locally with a salt fixed at the lock, so the replay's commit is the hash shown then. Bat six balls and the Super Ball, then the ghost bats against your over. The full log is built and verified by the engine. Reveal, Rematch, and a "beat my over" card. Fully offline |
| `settings` | `/settings` | Settings | Language (drafts marked); graphics, sound, vibration, reduced motion, high contrast, text size; analytics consent (only when configured); push on/off and quiet hours (`GET/POST /v1/push/settings`, Android only); sign-in and devices: "Sign out other devices" (`net.revokeOthers()`, then how many), and "Sign out of this device" (`net.signOut()`, local data and the player cleared, back to `/start`) offered plainly only when `Profile.linked` has Google or a passkey; a guest account is told it cannot be recovered after signing out and pointed to linking on the profile or Delete account; the privacy policy (`privacy.html`); export (`POST /v1/me/export`); delete account (`DELETE /v1/me`, session cleared, `setPlayer(null)`; finished matches, rooms and highlights then show "Deleted player", so the other player keeps their replay) or delete local data (which also forgets the age answer), and the web deletion page (`delete-account.html`) for anyone who has uninstalled; independence and fair-play statements, version, rules engine; How to play (engine guide); open-source licences: the full `third-party-notices.txt` (every npm package and Android library with its licence text), searchable, after a note on the fonts and the app's own artwork and sound. The legal pages open in a new tab on the web and in the system browser on Android: from the hosted site when `VITE_PUBLIC_WEB_ORIGIN` is set, otherwise the copy bundled with the build (`src/screens/common/legal.ts`) |
| `not_found` | anything else | Not found | Way home |

Match phases (`/m/:id`) show only what the server shows a participant: lock and innings flags, commit hashes and public deadlines. In production the opponent's flags appear up to ten minutes after the fact, so every line about the opponent says what has been received ("has locked their over", "No sealed over from {name} yet", "No innings from {name} yet"), never that they have not done something, never "just now" or "is batting", and never a request to wait or refresh. The screen polls on its own. "Remind {name}" is offered only while `reminderFor(view)` gives them a task (lock or bat), before its deadline and once per match, worked out on every poll.

| Phase | What the player sees |
| --- | --- |
| `awaiting_opponent` | The invite panel again, from the invite saved when the duel was created. The plan card, because an over can be locked before the friend joins |
| `planning`, not locked | Plan card with the lock deadline, then the planner. "In play" from the planner onwards. Android Back returns to the match, not out of it. One release per ball (GAME_RULES 3.2): the meter locks once a ball's release is recorded, and the draft (with its releases) stays on the device until the lock, so leaving the planner cannot reset a release. Training keeps retries, labelled as practice |
| `planning`, locked | "Your over is sealed" with the commit hash (copyable, explained), whether the opponent has locked (yes or no only), and the deadline. After the first locked duel, the notification prompt (once, equal choices) |
| `batting` | Innings card (or "Continue from ball n"), then the live innings. The first ball is fetched on Start because it carries the field. A ball revealed before the app was closed is resumed. A shot made offline is queued and sent later; the screen shows "Saved, sends when you reconnect" and continues when it lands |
| `awaiting_reveal` | Honest anticipation: whether the opponent has batted, and the round's reveal time (cups) or "the reveal gets a time for you both once they have batted, or when batting closes at …" (duels). Once a duel's `deadlines.revealAt` is set (both innings in, as far as this player may know), "Both innings are in" and a countdown to that shared slot ("The reveal is at 21:45 · in 3 minutes", by the second in the last two minutes); the route fetches the match again at the slot (`src/screens/match/revealSlot.ts`) and rolls into the reveal, and the hub looks again at its next reveal time so "Watch it" appears on time. One WhatsApp reminder per match, before the batting deadline. No score of either side |
| `revealed` | Reveal (verified), Share (the final card, once per match), Rematch (`POST /v1/matches/:id/rematch`) |
| `expired` | "Nobody joined before the deadline, so there is no result" or, when both joined but neither locked an over (the server expires such a duel), "Neither of you locked an over before the deadline, so there is no result"; new duel, Practice Ghosts |

The screen components stay prop-driven and are reused by the routes: `OnboardingScreen`, `TrainingScreen` (now with `onStep`, `onFirstDelivery` and `doneExtra`), `BowlingPlannerScreen`, `BattingScreen` (`includeSuperBall` adds the Super Ball slot), `RevealScreen` (`onEnded` for `replay_completed`), `MatchStage`, `SettingsPanel` and `localInnings`. Dialogs, sheets, the planner, the innings and full-screen replays register `useBackHandler`, so Android Back closes them first.

Analytics events sent through `services.analytics` (never with hidden choices):

- tutorial: `tutorial_started`, `tutorial_completed`, `first_delivery`;
- invites: `invite_created`, `invite_opened` (with the attribution code), `invite_accepted`;
- play: `over_locked`, `innings_completed`, `reveal_watched`, `replay_completed`, `rematch`, `renderer_fallback`;
- sharing and notifications: `share_initiated`, `share_completed` (with the channel), `reminder_sent`, `notification_opt_out`.

### Test ids (stable, for the cross-workstream flow suite)

| Area | `data-testid` |
| --- | --- |
| Hub | `home-screen`, `home-match-card` (with `data-match-id`, `data-status`, and `data-featured` on today's match), `home-daily-card`, `home-duel`, `home-cup`, `home-ghosts`, `home-training`, `home-top100`, `home-leaderboards`, `home-profile`, `home-profile-link`, `home-settings` |
| First run | `age-screen`, `age-year`, `age-month`, `age-day`, `age-continue`, `age-confirm`, `age-confirm-yes`, `age-confirm-change`, `age-privacy`, `age-stop`, `age-stop-privacy`, `onboarding-privacy`, `onboarding-screen`, `onboarding-alias`, `onboarding-shuffle`, `onboarding-language` (the header picker), `onboarding-submit`, `onboarding-recover`, `recover-sheet`, `recover-google`, `recover-passkey`, `recover-result` (with `data-reason`: cancelled, failed, offline, no_account), `alias-fix`, `alias-fix-input`, `alias-fix-save` |
| Training | `training-to-reveal`, `training-continue`, `training-done`, `training-duel`, `training-daily`, `training-home`, `consent-prompt`, `consent-accept`, `consent-decline` |
| Duel and invite | `duel-new-screen`, `duel-pitch-any`, `duel-pitch-green`, `duel-pitch-hard`, `duel-pitch-slow`, `duel-create`, `invite-panel`, `invite-whatsapp`, `invite-share`, `invite-sent`, `invite-copy`, `invite-qr`, `invite-qr-code`, `invite-plan`, `invite-screen`, `invite-preview`, `invite-age-year`, `invite-age-confirm`, `invite-age-confirm-yes`, `invite-age-confirm-change`, `invite-age-stop`, `invite-alias`, `invite-accept`, `invite-install`, `invite-language`, `invite-privacy` |
| Match | `match-screen`, `match-phase` (with `data-phase`), `match-plan-card`, `match-plan`, `match-sealed`, `match-commit`, `match-bat-card`, `match-bat-start`, `match-awaiting-reveal`, `match-reveal-countdown` (with `data-reveal-at`), `match-rivalry`, `match-nudge`, `match-training`, `push-prompt`, `push-accept`, `push-decline` |
| Planner | `planner-screen`, `plan-ball-0`..`plan-ball-6` (with `data-done`), `execution-meter`, `plan-lock`, `plan-lock-dialog`, `plan-lock-dialog-confirm`, `plan-lock-dialog-cancel`, `planner-locked`, `plan-coach`, `plan-coach-ok` |
| Batting | `batting-screen` (with `data-phase`: loading, ready, fetching, runup, live, submitting, feedback, done, error), `bat-hit` (with `data-live` while the ball is live), `bat-shot-<shot>`, `bat-next`, `bat-retry`, `bat-done`, `bat-coach`, `bat-feedback`, `bat-feedback-detail`, `bat-timing-meter` |
| Reveal | `reveal-screen`, `reveal-play`, `reveal-skip`, `reveal-scrub`, `reveal-ticks`, `reveal-elapsed`, `reveal-total` (only once the result is known), `reveal-breath` (the held breath), `reveal-result-card`, `reveal-share`, `reveal-rematch` (with `data-state`: idle, sent, offered) |
| Shared match | `shared-screen`, `shared-landing`, `shared-watch`, `shared-practice-0`, `shared-practice-1`, `shared-practice-result`, `shared-play` |
| Daily Six | `daily-screen`, `daily-attempts`, `daily-start`, `daily-resume`, `daily-proof`, `daily-result-screen`, `daily-result`, `daily-breakdown`, `daily-rank`, `daily-watch`, `daily-share`, `daily-leaderboards`, `daily-again` |
| Ghosts | `ghosts-screen`, `ghost-<id>` (anchor, swinger, enforcer, trickster, maestro), `ghost-start` |
| Settings | `settings-screen`, `settings-quality-<auto/low/standard>`, `settings-sound`, `settings-haptics`, `settings-reduced-motion`, `settings-high-contrast`, `settings-text-size-<1/1.15/1.3>`, `settings-language`, `settings-analytics`, `settings-push`, `settings-quiet`, `settings-quiet-start`, `settings-quiet-end`, `settings-revoke-others`, `settings-revoked`, `settings-logout`, `settings-logout-dialog`(`-confirm`/`-cancel`), `settings-logout-guest`, `settings-link-profile`, `settings-export`, `settings-export-link`, `settings-delete`, `settings-delete-dialog`(`-confirm`/`-cancel`), `settings-privacy-policy`, `settings-delete-web`, `settings-guide`, `settings-licences`, `settings-licences-sheet`, `licences-search`, `licences-full` |
| Shell and other | `update-banner`, `update-later`, `update-now`, `not-found-screen`, `not-found-home`, `highlight-preview`, `highlight-play` |

Dev-only pages (Vite dev server, not in any build) are unchanged: `src/screens/dev/harness.html` and `src/screens/dev/gallery.html`. `src/screens/dev/fixtures.ts` is a development fixture and is never imported by shipped screens.

---

## 9. Sharing

**Cards** (`src/screens/share/cards.ts`) are drawn locally on a canvas at 1080x1350 (4:5): floodlights, the pitch, the mark and wordmark, the avatars, and a call to action with a link that opens in the browser.

- **Invite:** the challenge and the conditions. A Group Cup invite (`InvitePanel kind="cup"` with `cupName`) has its own copy: the cup's name, "Join the cup", round robin, one sealed over per round before its deadline, the final for the top two; the share text names the cup too.
- **Match:** sealed until the reveal (names and the seal only, no score, result or Player of the Match), then the scores, the result and Player of the Match.
- **Daily Six:** score, best and streak.
- **Practice:** "Beat my over?".

Each card has a pure model function (unit-tested, including spoiler safety) and a renderer that waits for the bundled fonts. One-line text always fits its space (`fitLine`): smaller type first, then the middle of a long link elided (the full link travels in the message).

**The cap** (`src/screens/share/share.ts`) uses the platform's `canShare`, `shareMoment` and ledger for every share, with or without the card image: the server-kept claim (`POST /v1/matches/:id/moments`, registered by the net layer, answered within 1.5 s) and this device's ledger, which decides alone offline. There is at most one invitation, one optional deadline reminder (before the deadline only) and one final share per match. The final share needs the reveal.

- WhatsApp opens `wa.me` with the message ready, and the player picks the chat.
- The share sheet carries the card image.
- Copying the link and the QR code (uqr 0.1.3, MIT, lazy) are not messages, so they stay available.
- Nothing is sent automatically and no contacts are read.

The Daily Six and practice cards are capped at one share per attempt or match.

**The result link is public and spoiler-safe.** Sharing a revealed match asks the server for its link (`POST /v1/matches/:id/share`, one per match, idempotent) and shares that `/s/:code` URL, which works for anyone (see the `shared` route), never `/m/:id/replay` (only its two players can open that). The message says what the card shows ("Swing King beat Night Owl by 6 runs. Watch the reveal."). Every share that does not go out says so in a toast (cancelled, failed, offline, already used); none is silent.

**Rematch.** `MatchView.rematch` drives the reveal's rematch action (`rematchState`): none yet, Rematch creates one; mine, "Rematch sent · send it again" opens it to send; the opponent's, "{name} wants a rematch · Accept" is the screen's primary action and opens its invitation (the invite flow at `inviteUrl`).

---

## 10. Highlight composer (`src/highlight`)

`render.html` (web builds only) exposes `window.__vcHighlight`, which implements `HighlightRenderHost`. The platform's render service drives it frame by frame at 1080x1920, 30 fps.

- **`load(input)`:**
  - prepares the replay timeline (renderer offline mode: fixed size, preserved drawing buffer, no adaptive quality, no wall clock);
  - plans the cut (`plan.ts`);
  - refuses an input without `aliases` (two non-empty moderated names);
  - loads the bundled fonts, the translations for `input.locale`, both avatars and the QR code;
  - resolves `{ durationMs, fps: 30 }`. `durationMs` is 30–60 s and a whole number of frames.
- **`frame(t)`:**
  - renders the 3D frame for the cut's replay time into a hidden canvas;
  - copies it into the visible canvas and draws the broadcast overlay;
  - waits one animation frame for the compositor.

  It is pure in `t`: frames are identical whatever was drawn before, which unit and e2e tests check.
- **`audio()`:** returns a 16-bit PCM WAV (base64), exactly `durationMs` long. It is the game's own synthesised crowd, bat, stumps, roars, drums, fireworks and seal chime, scheduled on the highlight clock with an `OfflineAudioContext`, the action and the crowd on separate channels, then balanced (the crowd 8 LU under the action) and mastered to about -14 LUFS with the true peak at or under -1 dBTP (section 5). `audioReport()` returns how it was mastered (loudness, true peak, the bed's balance, the gain and the deepest limiting).

The cut is:

0. **The hook** (1.8 s, from the very first frame, no fade from black): the top-ranked ball (the same ranking as the cut), from a second before its decisive moment, with "Coming up" and its badge (OUT, SIX, FOUR, PERFECT) landing at about 1 s. The full clip follows later in the cut.
1. Identity intro: mark, VANDE CRICKET, Sealed Six, the fixture and day, both players with avatars and their Top 100 ranks, and the conditions.
2. The best balls in match order, scored as follows: turning point +12, wicket +10, six +9, four +7, Super Ball +6, perfect dot ball +4. Each clip runs from just before the release to the aftermath, with the replay's own slow motion. Overlays: score bug, "Innings 1 · Ball 4 · batter vs bowler · delivery → shot", a turning-point tag, and FOUR / SIX (with distance) / OUT (kind) / PERFECT badges.
3. Result.
4. Player of the Match, with runs and wickets.
5. Standings movement, when given.
6. "Can you beat them?" with the attributed URL and its QR code.

**Portrait framing.** The 3D picture uses the director's portrait shots (section 3): the side-on wide that left about 45% of the frame as grass is now a raised three-quarter view on the striker; the crowd cutaway (flat figures, the sky and an empty foreground in a tall frame) is now a medium three-quarter front shot of the player at the heart of the moment, with the stand behind; batter close-ups, the chase camera and the aerial are closer and narrower; the subject sits in the middle of the frame, clear of the header and score bug above and the caption below. Check a cut with `node scripts/perf/highlight.mjs [log.json] [out-dir]`: it renders a contact sheet (the hook, each scene's start and middle), prints the camera shot behind each frame, and writes and measures the WAV.

Every name on screen (intro, score bug, ball captions, result line, Player of the Match) is drawn from `input.aliases`, the moderated current display names in `log.players` order, never `log.players[].alias` (the match-time alias may have changed since or never been checked). Quiet matches stretch the cards to reach 30 s. Essential text stays clear of the Shorts UI at the bottom and right. Measured on the fixture match: load about 3 s and frames about 20 ms on a desktop GPU; the soundtrack renders and masters in a few seconds (a 58 s cut is a 10 MB WAV).

`HighlightPreview` (`src/highlight/HighlightPreview.tsx`) plays the same composer at half resolution (540x960) inside a 9:16 frame, with play/pause and a scrubber. The social consent screen uses it with the same `HighlightRenderInput`. Lazy-load `@/highlight`, because it pulls in the 3D renderer.

---

## 11. Brand

The mark is an amber hexagon seal (six sides for the Sealed Six) holding a white match ball whose seam forms a V. It is defined once in code (`src/ui/brand/mark.ts`). The same geometry draws:

- the in-app `Logo` (mark and wordmark);
- share cards, highlight overlays and QR centres;
- every exported file.

The wordmark is Manrope ExtraBold "VANDE" over tracked amber "CRICKET". In the SVG files it is outlined, so no font is needed. All marks are original, with no official cricket IP.

Generated files, all written by `npm run assets` (see [Regenerating the brand files](#regenerating-the-brand-files)):

- `public/brand/`:
  - `logo.svg`, `logo-light.svg`: the mark;
  - `logo-dark.svg`: the mark on a night tile;
  - `logo-mono.svg`: one colour;
  - `lockup.svg`, `lockup-on-light.svg`;
  - `lockup-social.svg`: 1200x630, replacing the old lockup.
- `store-assets/` (outside `public/`, so they never ship in the APK or the service-worker precache):
  - `icon-1024.png`: the Play listing icon;
  - `feature-graphic.png`: 1024x500, the game's own 3D frame with the lockup, no essential text near the edges.
- `public/icons/`: `favicon.svg`, `favicon-32.png`, `icon-192.png`, `icon-512.png` (rounded), `maskable-512.png` (mark inside the 80% safe zone), `apple-touch-icon.png` (180, full-bleed).
- `public/og/og-card.png`: 1200x630, from a 3D frame, quantised to 181 KB.
- Android, every density from ldpi to xxxhdpi:
  - `mipmap-*/ic_launcher.png` and `ic_launcher_round.png`;
  - adaptive layers `ic_launcher_foreground.png` and `ic_launcher_background.png` (108 dp, the mark inside the 66 dp safe zone), plus `ic_launcher_monochrome.png` for themed icons;
  - `mipmap-anydpi-v26/ic_launcher(_round).xml`, which use those layers without insets;
  - `drawable*/splash.png` at every existing size, portrait, landscape and night.

The stadium's LED boards were mirrored when seen from the field. They are fixed with a negative texture repeat, so "VANDE CRICKET · SEALED SIX · LOCK YOUR OVER · REVEAL THE RIVALRY" reads correctly.

### Regenerating the brand files

```bash
npx playwright install chromium   # once, if the e2e browsers are not installed yet
npm run assets                    # node scripts/brand/build.mjs, from anywhere in the repo
```

The generator is `scripts/brand/build.mjs`. It uses dev dependencies only:

- `fontkit` outlines the wordmark from the static Manrope 700 and 800 cuts in `@fontsource/manrope`;
- `sharp` rasterises the icons, launcher layers and splashes;
- Chromium from `@playwright/test` renders the two photographic files.

It starts its own Vite dev server on a free local port, with no watcher, no HMR and its own cache in `node_modules/.vite-brand`. Through it, it loads `src/ui/brand/mark.ts` and serves the dev harness. It writes all 74 files listed above, then stops the server. The OG card and the feature graphic use the harness replay frame at 43.633 s. A run takes about 15 s on an Apple silicon Mac.

To change the brand:

1. Edit the geometry or colours in `src/ui/brand/mark.ts`. The app, share cards and highlight overlays use it directly.
2. Run `npm run assets`.
3. Commit the regenerated files with the change. The next Gradle build picks up the Android launcher icons and splashes.

Repeat runs on the same machine produce byte-identical files. On another GPU, only the two photographic PNGs can differ, by a few pixel values. The old generator (`scripts/generate-assets.mjs` and `scripts/brand.mjs`) drew the previous brand and has been removed.

---

### Reveal: nothing given away, and short where it should be

- The scrubber runs on a **neutral track** (`src/screens/reveal/track.ts`): every match is laid out alike (intro, six fixed slots per innings, a Super Ball zone that is always there "if needed", the result), so the thumb's position and the marks never hint at a tie or an innings that ended early. Slots a replay does not play are passed over only when playback reaches them. The time shows what has been played; the total appears only once the result is known.
- **Training's reveal** plays the player's own two balls (the one they batted, the one they bowled), then the result: about half a minute instead of 43–61 s. `cutReplay(log, include)` replaces the Key Moments pick for that log object, so the screen and the renderer play the same cut; Full replay still plays every ball.
- **Auto** balls are captioned in the delivery timeline and said to screen readers ("Batted automatically", "Bowled automatically") through `BallSlot.note`.

### Scrubber marks on a narrow phone

Played boundaries and wickets are labelled marks on the scrubber (4, 6, W). When balls sit close together on a narrow
track, labels that would touch give way to the more telling one (W over 6 over 4, the later on a tie) and the others
become slim ticks in their colour (`layoutTicks`, measured against the scrubber's real width): nothing is hidden and
nothing prints as "4 4W4 4". The mode buttons wrap as whole words ("Key moments" never breaks), and the Hindi rematch
line keeps "चाहते हैं" together.

### Batting feel

The tap is felt and heard at once (section 5) and upgraded when the sealed answer lands. After each ball the feedback
says, never runs or wickets: the timing and the contact ("Perfect · Middle of the bat"), the shot and where it was
aimed with how early or late the tap was ("Drive towards Cover · 12 ms late", "Right on time" within 3 ms), and a timing
meter: early on the left, perfect in the middle, late on the right, the bands the delivery's own `perfectMs`, `goodMs`
and `edgeMs`, and a marker where the tap landed. The server's grade is the truth, so the marker is kept inside that
grade's band (`timingMark`): a perfect never shows as 40 ms late. The marker pops in with the control duration (none
with reduced motion); the meter is decorative for screen readers because the line above it says the same.

### Large text and focus

- Between balls, Play and Next ball take BAT's place (the same big surface), so they are always on screen; the stage gives up height as the text grows (`--text-scale`), and the controls fit a 360×780 phone at 130% and 150% without scrolling (e2e: `large text 130%/150%`).
- Segmented options wrap onto more rows instead of overlapping, and the planner's field choice has its own row. Buttons break a word only when it cannot fit at all. Training's steps show the current one in full and the others by number.
- Keyboard focus is visible on every control: ghost, link and icon buttons (their resting shadow is `0 0 #0000`, a valid list entry, not `none`), card buttons, segments and shot chips (e2e: `keyboard focus is visible`).
- The reveal on desktop gives the stage most of the width and keeps it in view; controls, actions, the result and the scorecard form one column beside it.

### Contact without a stall

Under SwiftShader, the first ball's contact used to block for 100–650 ms (`getProgramInfoLog`): the driver finished linking the trail, flash, seal ring and particle shaders on their first use, which is the moment of contact. The renderer now compiles every material and touches each program while the stage loads (`ThreeMatchRenderer.prewarm`). Measured with the dev harness (live, SwiftShader, CPU profile around contact): 642–657 ms in `getProgramInfoLog` before, none after, and no long tasks in the 1.8 s after the shot.

---

## 12. First-paint budget (measured)

The app's production build (`vite build --outDir dist-exp`) was served with gzip and static-host SPA fallback by
`scripts/perf/first-paint.mjs`. The measurement used a cold cache with the service worker blocked, at 390x844 and DPR
2.625. "Useful shell" means the screen's own content is visible. Medians of 3 runs (re-measured on 25 October 2026,
after the age question, the legal links and the larger English catalog):

| Profile | Returning player, hub | First visit, age question | Invite link |
| --- | --- | --- | --- |
| Slow 4G (150 ms RTT, 1.6 Mbps) + 4x CPU | **2.0 s** (FCP 0.69 s, 195 KB) | **2.0 s** (FCP 0.67 s, 193 KB) | **1.5 s** (FCP 0.69 s, 180 KB) |
| Fast 4G (60 ms RTT, 9 Mbps) + 4x CPU | **0.9 s** (FCP 0.25 s) | **0.9 s** (FCP 0.25 s) | **0.4 s** (FCP 0.24 s) |

All are under the 2.5 s target even on the pessimistic profile. On the first paint
(`node scripts/check-bundle-size.mjs dist-exp`):

- the shell entry is **109 KB gzip** (about 112 KB at gzip's default level): React 19, the root shell, the design
  system, platform, net, analytics and the first-run screens;
- a preloaded shared chunk is 25 KB (the locale table, the English app catalog and the brand mark);
- CSS is 9.8 KB;
- route chunks are 1–9 KB.

The whole initial transfer, fonts included, is 377 KB against a 450 KB budget (Latin-script players skip the Devanagari
faces). No engine (24 KB) and no three.js (150 KB) load until a screen needs them. The engine's English copy (9 KB)
loads in the background and blocks only screens with cricket vocabulary.

---

## 13. Assets and licences

- Players, animations, stadium, crowd, props, effects, icons, avatars, kits, the mark, share cards, highlight overlays and every sound are **original work generated in code** in this repository. No third-party models, textures, motion capture, sounds, music, commentary, teams, players, kits, stadiums or broadcaster graphics are used. LED boards show only VANDE Cricket branding.
- Starter kits use the server's palette (`src/net/shared/kits.ts`, id `starter`), so `PATCH /v1/me` accepts them.
- Fonts: Manrope (SIL Open Font License 1.1, via `@fontsource-variable/manrope`; the static 700 and 800 cuts from `@fontsource/manrope`, a dev dependency, are used only by the brand generator to outline the wordmark) and Noto Sans Devanagari (SIL OFL 1.1, via `@fontsource/noto-sans-devanagari`). Other Indic scripts use fonts already on the device.
- Libraries: three.js (MIT), React (MIT), Zustand (MIT), uqr (MIT, QR codes), idb (ISC) and the Capacitor plugins (MIT). Settings shows the full `public/third-party-notices.txt` (generated by `scripts/generate-notices.mjs`: every production npm package and Android library with its licence text, the fonts' OFL in full), searchable by name or licence, after a note that the artwork, players, stadiums and sounds are the app's own. Offline before the file was ever fetched, a short list stands in.
- No files were added under `public/assets`.

## 14. How to check it

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run tests/unit/render3d tests/unit/ui      # renderer, i18n sources, components, screens, journeys, routes
# e2e on your own build, port and results folder (never the shared dist/):
npx vite build --outDir dist-exp && E2E_PORT=4182 E2E_DIST=dist-exp E2E_OUT=test-results-exp \
  npx playwright test tests/e2e/ux- --project=chromium
npx vite --port 5199    # dev pages: /src/screens/dev/harness.html, /src/screens/dev/gallery.html, /render.html
npm run assets          # regenerate every brand file (section 11)
# online journeys by hand: node backend/local/serve.mjs --web-origin http://127.0.0.1:5200 and
# VITE_API_LOCAL=1 npx vite --port 5200
```

The measurement scripts behind this document are in `scripts/perf/` (each serves or builds what it needs and stops it
afterwards):

- `first-paint.mjs [build-dir]`: section 12 (`RUNS=5 VERBOSE=1` for more runs and the files loaded);
- `stage-height.mjs [build-dir]`: Training's batting layout at 100%, 130% and 150% text;
- `contact.mjs [runs]`: long tasks and the hottest functions at the moment of contact, under SwiftShader;
- `highlight.mjs [log.json] [out-dir]`: a Short's contact sheet, the camera shot behind each frame, and the mastered
  soundtrack's loudness (section 10);
- `serve.mjs`: the shared static server (gzip, SPA fallback) and Playwright loader.

The renderer spike (section 1) was a one-off and its harness is not kept.
