# Cricket experience and product-success measurement

Status: supplemental evaluation method, version 1.0  
Recorded: 2026-10-29  
Owner scope: VANDE Practice first; later product stages remain closed by `docs/VANDE-PRODUCT-SEQUENCE.md`  
Authority: this document does not replace or amend either locked player-experience rubric

## 1. Decision

Game companies use established activation, retention, engagement, quality and monetisation metrics. No credible
single metric can establish before launch that a game will become a hit. VANDE therefore uses three layers:

1. **Hard gates:** fairness, causality, stability, performance, readability and evidence integrity. A failure is not
   averaged away.
2. **Cricket Experience Readiness Index (CERI):** the supplemental 0–100 weakest-link experience score defined here.
3. **Observed product outcomes:** activation, D1/D7/D30 retention, DAU/MAU, repeat play and retained organic growth,
   measured only after representative human tests and a soft launch.

Before live cohorts exist, report CERI as **PROVISIONAL EXPERIENCE READINESS**, never as probability of commercial
success. Current VANDE is **NOT SCORED** on CERI: there is no same-build current capture package and the required
real-player and physical-phone evidence is incomplete.

## 2. Established industry metrics

| Layer | Measures | What it answers |
| --- | --- | --- |
| Acquisition | store impression-to-page, page-to-install, source and organic share | Can the proposition attract the right player? |
| FTUE activation | time/taps to first controllable ball, first intentional shot, understood result, first over complete | Does a new player reach and understand the value? |
| Engagement | sessions/DAU, session length, daily playtime, balls and overs per session | Do active players actually play? |
| Retention | exact-day D1, D7 and D30; retention curve; user loss | Do players return after novelty fades? |
| Habit | DAU/MAU, voluntary next over, exact-ball retry, next-day Practice return | Is there genuine repeat desire? |
| Quality | crash, ANR, slow sessions, frame-time tail, startup, memory, battery/thermal, rating themes | Can supported devices deliver the intended experience? |
| Growth | share/session, invite acceptance, recipient activation, recipient D7, rematch | Does sharing acquire players who stay? |
| Business, later only | payer conversion, ARPDAU, ARPPU, LTV/CPI and ROAS | Can the product fund itself without harming play? |

Definitions must be frozen before comparison: install event, exact-day versus rolling retention, UTC boundary,
session timeout, geography, platform, version, device tier and acquisition source. A metric with a different
definition is not the same metric.

### Benchmark context, not a VANDE promise

GameAnalytics' 2026 report covers 16,000+ integrated mobile games with at least 1,000 MAU, across genres, regions,
iOS and Android during 2025. Its approximate global medians were 22% D1, just under 4% D7 and 0.68–0.79% D30; its
top-quartile values were just over 30% D1, 6–7% D7 and 1.6–1.8% D30. Asia medians were 17.5%, 2.68% and 0.53%.
These are self-selected, mixed-game benchmarks, not India-cricket targets. VANDE must compare with the current Sports
and relevant regional peer percentile available at soft launch, with confidence intervals and cohort definitions.

## 3. Cricket Experience Readiness Index (CERI)

Each dimension is scored 0–10 using the running build, recorded method and independent evaluation. Let `d_i` be the
dimension score and `w_i` its decimal weight. The index is a weighted geometric mean:

```text
CERI = 100 × product((d_i / 10) ^ w_i)
```

The geometric mean makes a weak essential dimension expensive. It still does not override a hard gate.

| Dimension | Weight | Required evidence |
| --- | ---: | --- |
| Delivery readability | 15% | Correct human identification of line, length, pace/spin and movement; ball visibility and track continuity from release through contact |
| Intent fidelity | 15% | Intended shot class, direction, elevation and footwork versus recognised input and visible outcome; input-to-visible-bat response |
| Cricket causality and trust | 15% | Input → bat → contact → trajectory → field → score → audio → replay agreement; no hidden steering or contradiction |
| Mastery depth | 10% | Expert policy and players beat rookie/random baselines; exact-ball retry improves; no universal dominant input |
| Embodiment authenticity | 10% | Experienced-player ratings of bowler, batter, equipment, pitch, field, camera and motion as recognisable cricket |
| Emotional proportionality | 8% | Boundary, edge, close call and wicket presentation starts after and matches the physical event; human satisfaction/tension evidence |
| Pacing | 7% | Time and taps to first ball, delivery dead-time ratio, skippability, result-to-next-playable delay |
| Performance and device reach | 8% | Frame average/P90/P99 or p95/p99 frame time, input response, startup, memory, thermal state and weighted supported-device reach |
| Stability and progress integrity | 7% | Crash/ANR, resume, offline recovery, saved innings, no reward/progress loss |
| Interruption burden | 5% | Forced ads, paywalls, popups, waits and unrelated screens per playable minute; VANDE Stage 1 should have none |

### CERI hard gates

The result is **NOT PASSED**, regardless of the number, if any of these occur:

- hidden outcome steering or a player reasonably believes an outcome was scripted and the evidence cannot disprove it;
- live play, replay, score or audio contradicts the authoritative result;
- loss of saved play/progress or a critical crash/ANR on a supported configuration;
- the ball is materially hidden by the interface during the decision corridor;
- deterministic replay or the TypeScript/Unity authority contract fails;
- a critical core dimension—readability, intent fidelity, causality/trust or mastery—scores below 8.0;
- the build, device, renderer, settings, method or evidence provenance is missing;
- the score substitutes AI personas for real rookie or expert players.

### Exceptional-experience candidate

“An experience players will salivate over” is not a certification term. The operational candidate threshold is:

- CERI at least 90;
- readability, intent fidelity and causality/trust each at least 9.0;
- every dimension at least 8.5;
- both New Player X and Expert Player X independently pass the locked real-player thresholds;
- at least 80% of each cohort voluntarily plays or asks for another over;
- no Critical or High defect;
- physical Android evidence and owner approval of the running build.

Until those human and device gates pass, label the result **PROVISIONAL**.

## 4. Stage 1 activation and repeat scorecard

Use the existing tester mode and locked thresholds. Never average rookies and experts.

| Funnel or behaviour | Measurement |
| --- | --- |
| Launch → Practice visible | conversion and elapsed time |
| Practice visible → mode chosen | conversion, taps and abandonment |
| Setup → first controllable delivery | median time, taps, help and abandonment |
| First delivery | completion without developer help; locked target at least 90% |
| Three basic actions | rookie comprehension; locked target at least 85% |
| First over | unaided completion and outcome understanding |
| Exact-ball retry | use, correctness and improvement; locked rookie improvement target at least 80% |
| Another over | unprompted, voluntary continuation; locked target at least 80% for each cohort |
| Expert intent | recognised intended input class; locked target at least 90% |
| Control/fairness/clarity | locked cohort ratings and observed errors, not a single pooled rating |

Add the validated GUESS-18 short game-satisfaction survey to human sessions and report its constructs separately.
Do not collapse GUESS-18 into CERI in a way that hides a weak construct.

## 5. Live product outcome gate

Only after Stage 1 and its human/device gates pass, run a consented Android soft launch. Report exact-day D1, D7 and
D30 by install cohort. Split at minimum by app version, acquisition source, India/other, device tier, assistance mode,
rookie/expert classification where known and renderer.

The live decision dashboard contains:

- FTUE conversion and time between steps;
- first-over completion;
- voluntary second-over start;
- D1, D7 and D30 retention;
- DAU/MAU;
- sessions and daily playtime per DAU;
- exact-ball retry and demonstrated improvement;
- crash, ANR, slow-session, startup and uninstall/user-loss metrics;
- rating/review themes by version and device;
- later, retained share recipients rather than raw link clicks.

Freeze numeric soft-launch targets before seeing the result, using the latest relevant peer percentiles. A minimum
sample alone is not proof: publish sample sizes and confidence intervals. Do not mix paid and organic acquisition or
versions when making a product decision.

## 6. What cricket-game viewers and players respond to

### Method

The 2026-10-29 triangulation sampled the first 14–20 publicly visible comments across 11 YouTube pages, about 214
comments total, spanning official trailers, creator gameplay, tutorials/career footage and cross-title clips. It was
triangulated with Google Play, App Store and forum reviews for Real Cricket, WCC3 and Cricket League.

This is a bounded hypothesis sample, not “all videos”: visible-comment ranking bias, self-selection, language,
version drift, creator personality, trailer music, device settings and video compression all confound it. Do not
convert theme counts into population percentages.

### Recurring wow signals

1. Batting feels earned: timing, shot choice and learning visibly change the outcome.
2. Recognisable cricket specificity: distinct actions, pitch-dependent bounce/movement, real field, equipment and
   accurate review/replay rather than generic animation.
3. Broadcast/ground authenticity: credible camera, stadium, crowd, motion and commentary.
4. Immediate legibility: short time to play, understandable controls and a readable ball.
5. Clutch tension with clear consequences: close chases, edges, wickets and boundaries feel caused rather than staged.
6. Meaningful variety after the core is strong: career, tournaments, teams and tactical choice.

### Recurring rejection signals

1. Long or frequent ads and paywalls interrupting the match.
2. Scripted targets, overpowered AI, unfair matchmaking/gear, bots, hackers and disconnect losses.
3. Cricket-causality contradictions: a catch shown as a four, wrong commentary, live/replay disagreement or visually
   slow “fast” bowling.
4. Ambiguous or non-ergonomic controls and shots the player did not intend.
5. Crashes, freezes, failed loads and lost progress/rewards.
6. Repetitive actions, faces, commentary or forced replay/umpire dead time.

The central hypothesis is: **recognisable cricket specificity + intentional control + believable consequence** creates
more durable “wow” than polygon count alone. CERI is designed to test that hypothesis.

## 7. Matched gameplay recording protocol

### Three evidence lanes

1. **VANDE engine-truth lane:** deterministic record, telemetry, frame trace and recording from the exact build.
2. **Controlled competitor lane:** legally installed top-three games recorded on an owned matched phone, without
   bypassing protection or instrumenting the competitor.
3. **Public-reference lane:** YouTube/store footage and comments for qualitative coding only unless explicit rights
   permit a local copy. Never use an encoded upload to claim device FPS, touch latency or physics correctness.

### Standard capture package

For each VANDE run retain:

- build/source ID, UTC, app/game version and replay digest;
- device, OS, GPU, display/viewport, refresh rate, thermal and network state;
- renderer, quality tier, controls, assistance, pitch/field and deterministic seed;
- MP4/WebM with synchronized game audio;
- a visible touch overlay or synchronized external high-speed finger recording for latency tests;
- event sidecar for run-up start, release, bounce, input onset, visible bat onset, contact, field result, dead ball,
  result UI and next-playable state;
- physics/contact/result record, frame-time series and hashes;
- capture method, codec, resolution, frame rate, edit/compression flags and file SHA-256.

Use the same phone, orientation, resolution, refresh rate, thermal state, network condition and recording settings for
controlled competitor sessions. Record the exact competitor version and settings. Competitors cannot be forced to
use VANDE's seed, so match scenario classes and label unmatched conditions rather than claiming identical physics.

### Matched six-ball script

Seek the closest available mix of delivery/intent pairs:

1. leave;
2. defensive shot;
3. grounded straight or cover drive;
4. square/cut or pull response;
5. lofted attacking shot;
6. deliberate mistiming or miss.

Annotate approach, gather, release, flight, bounce, decision, gesture, visible bat response, contact, field result and
dead ball. Keep the whole uninterrupted sequence, not only successful highlights.

### Observable cross-game video measures

- time and taps to first playable ball;
- ball pixel diameter, local luminance contrast and track-continuity rate;
- percent of the delivery corridor occluded by HUD, controls, finger or character;
- camera cuts, shake and horizon movement during the live delivery;
- run-up/bat animation jerk, foot slide, bat-arc discontinuity and visible clipping;
- contact-frame to impact-audio offset;
- physical event to scoreboard/crowd/camera reaction delay;
- dead-time ratio and result-to-next-playable delay;
- HUD occupancy, persistent-control count and text legibility;
- duplicate-frame rate as a property of the recording, never as proof of engine FPS.

VANDE may additionally measure touch-to-visible-bat latency, physics-to-projected-ball error, bat/contact spatial error,
frame-time distribution and replay identity because it owns the ground truth. Do not assign those hidden measures to a
competitor from pixels.

Cross-game SSIM, PSNR, LPIPS or VMAF is not a quality ranking: the games render different scenes. Those full-reference
metrics are appropriate only for the same VANDE seed/camera when detecting regression or encode loss.

### Human comparison

Run randomized, counterbalanced and debranded paired clips where feasible, followed by matched hands-on sessions.
Keep New Player X and Expert Player X separate. Measure:

- delivery identification accuracy;
- intended-shot recognition;
- perceived control, trust and authenticity;
- ball-tracking failures;
- outcome comprehension;
- GUESS-18 constructs;
- voluntary next-ball, replay and next-over behaviour.

Passive video cannot establish control feel. Hands-on play is mandatory for intent fidelity and desire claims.

## 8. Existing VANDE foundation and gap

VANDE already has most of the measurement foundation:

- deterministic delivery records and exact re-simulation: `src/practice/game/replay.ts`;
- consented on-device tester events, gestures, balls, retries and voluntary continuation:
  `src/practice/store/tester.ts` and `src/practice/ui/tester/recorder.ts`;
- web screenshot/video journeys: `scripts/eval/modules/capture.mjs` and `capture-run.mjs`;
- Android build/device/screenshot/crash evidence: `scripts/android-practice.mjs`;
- browser and Android frame/performance probes under `scripts/perf/`;
- bounded Unity sampler under `unity/VandePractice/Assets/VandePractice/Runtime/Performance/`;
- deterministic frame-to-video rendering in `render-service/src/ffmpeg.ts`;
- consent-gated practice/retention analytics in `src/analytics/events.ts` and `docs/ANALYTICS.md`.

The missing piece is a tracked capture/compare runner. The implementation should add:

```text
docs/evaluation/capture-compare/
  README.md
  sources.json
  manifest.schema.json
  metrics.schema.json

scripts/eval/compare/
  capture-web.mjs
  capture-webgl.mjs
  capture-android.mjs
  normalize.mjs
  annotate.mjs
  metrics.mjs
  compare.mjs

tests/unit/evaluation/
  capture-compare.test.ts
```

Raw media belongs in a temporary/evidence workspace, not Git. Commit VANDE-owned selected captures only when needed.
Never commit competitor frames or audio. The current Android harness captures screenshots but not gameplay video;
`capture-android.mjs` should add a bounded `adb screenrecord` lane while documenting that Android's ADB recording has
no audio and can perturb the device. Use a separate synchronized audio/capture method for audiovisual evaluation.

## 9. Rights and evidence integrity

- Publicly viewable footage is not automatically licensed for download, redistribution or model training.
- Keep public-source URL, title, channel, access UTC and timecodes. Do not use a downloader or circumvent controls.
- Prefer controlled recordings made from lawfully installed apps for internal comparison, subject to their terms.
- Do not copy competitor assets, UI, audio, text or animation.
- Store derived, non-reconstructive measurements rather than competitor media.
- Record every edit, crop, resample, interpolation and compression step.
- Keep the evaluator independent of the builder.
- AI audits visible evidence only; it never becomes a player or establishes fun, desire or human preference.

## 10. Primary references

- GameAnalytics 2026 benchmarks: https://www.gameanalytics.com/cn/reports/2026-mobile-pc-gaming-benchmarks
- Unity Analytics dashboard definitions: https://docs.unity.com/en-us/analytics/dashboards/dashboards
- Firebase game/tutorial events: https://firebase.google.com/docs/reference/unity/group/event-names
- Google GUESS-18 validation: https://research.google/pubs/validation-of-the-guess-18-a-short-version-of-the-game-user-experience-satisfaction-scale-guess/
- Android game frame-rate guidance: https://developer.android.com/games/optimize/framerate
- Android vitals and Play quality: https://support.google.com/googleplay/android-developer/answer/16409982
- Android ADB screen recording: https://developer.android.com/tools/adb
- Web Vitals: https://web.dev/articles/vitals
- YouTube Terms: https://www.youtube.com/t/terms

Sentiment/gameplay sample:

- Real Cricket official/gameplay: https://www.youtube.com/watch?v=pNMmOIu8Zik,
  https://www.youtube.com/watch?v=Sbtf16ng0P0, https://www.youtube.com/watch?v=BhjSLl29sb4
- WCC3 official/gameplay/tutorial: https://www.youtube.com/watch?v=d3sXRTioQHg,
  https://www.youtube.com/watch?v=XWVZTOvGJzU, https://www.youtube.com/watch?v=9pirF02GEmg,
  https://www.youtube.com/watch?v=-KjKbDJi3vU
- Cricket League official/gameplay: https://www.youtube.com/watch?v=vdbyt4I2rYc,
  https://www.youtube.com/watch?v=laXUU92xoYI
- Real Cricket Google Play: https://play.google.com/store/apps/details?id=com.nautilus.realcricket
- WCC3 App Store: https://apps.apple.com/us/app/world-cricket-championship-3/id1514775424?see-all=reviews
- Cricket League Google Play: https://play.google.com/store/apps/details?id=com.miniclip.cricketleague
