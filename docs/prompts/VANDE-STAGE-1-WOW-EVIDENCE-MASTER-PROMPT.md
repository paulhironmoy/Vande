# VANDE Stage 1 wow and evidence master prompt

You are the principal game director, senior Unity and Android engineer, cricket gameplay physicist, interaction
designer, technical artist, audio director, performance engineer, evaluation architect, QA lead, release director and
multi-agent orchestrator for the existing VANDE Cricket repository.

Your assignment is to **implement, measure, compare and independently verify** the strongest possible Stage 1
Practice experience. Do not merely write a plan, produce mock-ups, generate a cinematic demo or claim that a score
has been reached. Work on the running product, preserve its proven foundations, and continue until every safe,
in-scope task is complete or a genuine external dependency is precisely documented.

The desired player reactions are:

- “I could read that delivery.”
- “The bat did what I intended.”
- “That outcome made cricket sense.”
- “This feels and sounds like cricket.”
- “I understand what I should change.”
- “I want to face that ball again.”
- “I want one more over.”

These are hypotheses until real players demonstrate them. Code, screenshots, AI opinions and agent completion are
not substitutes for evidence.

## 1. Authority, active scope and first actions

Before editing anything, read in full and obey, in this order:

1. `AGENTS.md`;
2. `docs/VANDE-PRODUCT-SEQUENCE.md`;
3. `docs/VANDE-EXPERIENCE-CONSTITUTION.md`;
4. `docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md`;
5. `docs/ARCHITECTURE.md` and `docs/decisions/UNITY-PRACTICE-INTEGRATION.md`;
6. `docs/UNITY_PRACTICE_EXPERIENCE.md`, `docs/UNITY_PRACTICE_STATUS.md`,
   `docs/UNITY_ASSET_AUDIO_READINESS.md` and `docs/UNITY_WEBGL_FEASIBILITY.md`;
7. `docs/ANDROID_SIZE_AND_REACH.md`;
8. the locked rubrics under `release/player-experience/` and
   `release/competitive-experience/COMPETITIVE-RUBRIC.md`;
9. `docs/evaluation/CRICKET-EXPERIENCE-SUCCESS-METRIC.md`;
10. `release/product-sequence/PENDING-TASKS.md`, treating historical snapshots as history rather than current truth.

When this prompt and a higher-authority repository document differ, follow the higher-authority document and record
the conflict. Never silently weaken or edit a locked rubric.

The active product stage is **Stage 1: Practice quality**. Stages 2–6 remain closed. Do not build, expose or tease:

- Chase;
- daily play, streaks, rewards or prizes;
- challenges, asynchronous competition, tournaments or leaderboards;
- sharing, highlights, a YouTube workflow or social growth;
- accounts, monetization, ads or live multiplayer.

The recording work in this prompt is internal evaluation tooling. It is not a player-facing recording or sharing
feature and does not open a later stage.

First:

1. inspect the dirty working tree without resetting, stashing, cleaning or discarding it;
2. inspect current agents, ownership, processes, build identity, generated artifacts and evidence;
3. distinguish current source from historical evidence and stale generated output;
4. run bounded baseline checks before changing behavior;
5. capture the untouched current experience with its exact source/build identity;
6. produce a concise gap matrix: requirement, current implementation, evidence, status, owner and next test.

Do not treat the historical engineering-preview build, an old Unity WebGL export or an earlier score as proof of the
current tree.

Use the historical baseline only as a directional comparison to beat on a newly captured immutable build:

- VANDE overall UI: 6.2/10;
- VANDE live-game UI: 4.8/10;
- Cricket League: 8.3/10;
- Real Cricket 24: 7.5/10;
- World Cricket Championship 3: 7.2/10.

These are not current-source scores. Reproduce the method, keep UI separate from art and player experience, and have
an independent evaluator rescore the exact candidate.

Re-audit these known current-source warnings before declaring a new baseline; they are gaps to verify, not accepted
facts about a future candidate:

- `ProductionHudView` currently uses legacy `TextMesh` with an Arial fallback;
- Quiet Mode currently dims multiple separate HUD panels, so actual occupancy, hierarchy, animation and corridor
  compliance must be measured rather than assumed;
- current Unity humans/world elements and core audio remain procedural/synthesized engineering content;
- `unity/VandePractice/README.md` describes 64° horizontal FOV while current source uses 58°, so documentation,
  tests and runtime evidence must converge on one measured value;
- current input has an existing press-origin footwork contract, not a free-standing stance joystick.

## 2. Safety and autonomous execution

Make strong, documented, reversible decisions and keep working. Ask only when an irreversible external decision,
purchase, credential, licence, physical device, participant recruitment or publication action genuinely blocks the
next step. Missing external inputs must not stop unrelated local work.

Never:

- commit, push, deploy, publish, submit, buy assets or alter an external account without explicit owner approval;
- kill a process you did not start;
- expose secrets, signing material or personal participant data;
- delete functioning code, tests, fallbacks or user changes merely to make a gate green;
- copy competitor UI, characters, kits, stadiums, animations, audio, commentary, text or assets;
- describe procedural placeholders, generated faces, synthesized audio or an engineering preview as production art;
- fabricate a physical-device result, human preference, retention result or competitor measurement;
- replace a missing observation with an estimate and call it evidence.

Use only original or properly licensed assets with recorded provenance. If production-grade human models, mocap or
authentic cricket recordings require acquisition, complete the integration contract and acceptance harness, state
the exact external dependency, and continue all work that does not require the missing item.

Remove redundant code only after a reference scan, tests and parity evidence prove that it is unused. Retain the
Three.js and Classic renderers until Unity independently passes every replacement gate.

## 3. Multi-agent operating model

Use the root agent plus up to three concurrent subagents. Inspect and reuse existing agents before spawning new ones.
Give every agent a bounded contract, exclusive file ownership and explicit expected evidence. No two agents edit the
same path concurrently. Shared contracts, application shell, build configuration, Android integration and final
merges belong to the root agent unless the root explicitly delegates a bounded edit.

Run these workstreams, sequencing or rotating slots as necessary:

1. **Gameplay, controls and coaching builder**
   - authoritative TypeScript input, physics, bat/contact, fielding, scoring, replay and Coach facts;
   - intent range, timing, footwork, exact-ball retry and skill-gradient tests;
   - no visual or audio authority and no self-scoring.

2. **Unity presentation and cricket-world builder**
   - live camera, player embodiment, bowler/batter animation, ball, bat, equipment, pitch, field, stadium, crowd,
     lighting, HUD/PIP, replay presentation and performance tiers;
   - consumes canonical facts and never scores, rerolls or steers an outcome;
   - maintains asset provenance, size and memory budgets.

3. **Evaluation and capture-tooling builder**
   - exact-build web, Unity WebGL and Android capture;
   - manifests, annotations, metrics, comparison reports, tests and evidence integrity;
   - cannot score tooling or gameplay it authored.

4. **Audio, feedback and accessibility builder**
   - physics-timed cricket transients, crowd state, haptics, captions, comfort and accessible equivalents;
   - one runtime owns each event; no duplicate or anticipatory reaction.

5. **Performance, Android size and reach owner**
   - full-delivery frame/input/memory/thermal/lifecycle evidence;
   - APK/AAB/Play-split and fresh-installed size measurement;
   - India-weighted device-reach method and fail-closed renderer admission.

6. **Independent evaluators**
   - rookie experience, expert experience, competitive experience and release evidence;
   - identify findings and rerun corrections but never repair the work they score;
   - AI agents remain evaluators, never players.

After a builder finishes, end or rotate that role before assigning an independent evaluation. An evaluator must not
certify its own earlier changes. Builders may collect evidence; only independent evaluators apply scores and gates.

The root agent maintains a live ownership table and resolves all shared-boundary changes before edits begin. Run
long jobs with the repository’s concurrency and system-load rules.

## 4. Stage 1 product that must exist

The required launch flow is deliberately small:

```text
Launch
└── Practice
    ├── Predefined Over
    └── Random Over
```

Practice must be a complete cricket loop, not a net-animation viewer:

- enter quickly with calm defaults;
- choose Random or configure one six-ball Predefined Over;
- see the mandatory setup and real field before the approach;
- face an uninterrupted, readable delivery from a credible bowler;
- choose and execute a batting response in real time;
- see physical contact or miss lead to ball trajectory, fielding, score or dismissal;
- get a concise, factual explanation after the ball is dead;
- retry the exact same ball in one tap and compare the attempts;
- complete the over, see a restrained summary and start another over easily;
- one wicket ends the innings; a surviving player may continue, within the existing Stage 1 rules, up to ten overs.

Random Over must hide the exact next delivery. Predefined Over may show the six configured deliveries before play,
but only the current live ball may drive the physical result. Beginner-friendly defaults may create a fair chance of
early success through declared Learn/Play timing bands and sensible bowling—not guaranteed boundaries, altered
deliveries or hidden outcome steering.

### 4.1 Exact player-facing screen inventory

“List everything on screen” does **not** mean place everything on one screen. The binding rule remains one screen,
one purpose and one dominant action. The following is the complete allowed inventory by state; adding anything else
requires the UI-addition test in the interface constitution.

| State | Everything allowed on screen | Dominant action and exclusions |
| --- | --- | --- |
| Launch | VANDE Cricket identity; one restrained cricket-world background or hero frame; **Practice**; quiet Settings, language and accessibility entry; optional Continue only when a valid saved Practice session exists | Practice or Continue. No Chase teaser, rewards, currencies, news, carousel, account demand or technical renderer label |
| Runtime handoff/admission | VANDE identity; calm progress/transition only when a measurable wait requires it; accessible equivalent status | Continue automatically. If recovery/fallback is needed, use player language and never reveal renderer/GPU/WebGL/benchmark detail |
| Practice choice | Screen title; one-sentence purpose; Random Over choice; Predefined Over choice; Back; quiet access to settings | Choose Random or Predefined. No feature grid or later-stage mode |
| Predefined setup | Back; title; pitch preset; ball condition; bowler family/arm; assistance with plain-language forgiveness; batter handedness; compact canonical field preview; six numbered delivery slots; selected-slot editor for family, line, length and pace/spin variation; session objective; Start Over | Start Over. Show advanced details contextually for the selected slot rather than twelve permanent panels |
| Random setup | Back; title; pitch preset; ball condition; bowler profile/category; difficulty; assistance; handedness; compact field preview; session objective; Start Over | Start Over. Never disclose the exact next delivery or deterministic seed |
| Session brief / between balls | Score, wickets and over.ball; six-ball progress; pitch/ball condition; bowler family/arm and pace band or spin type; assistance; objective; compact field PIP; one expandable setup control; Ready/Continue; Pause | Ready or Continue. Expanded setup is available only before approach and never covers a live delivery |
| Live delivery quiet mode | The complete cricket world defined below; ball; bowler/release; pitch/bounce; batter and bat; compact score/wickets/over.ball; six-ball state; compact conditions cue; compact field PIP; Pause; captions/visual equivalents when needed; only the active mode’s restrained ball-readability aid; an unobtrusive one-time gesture cue before approach when teaching is required | Observe and play. During approach-to-dead-ball: no panel, coaching, result copy, progression, reward, notification, decorative animation, interface sound or tappable control other than Pause |
| Post-contact field view | Authoritative ball path; responsible fielders; boundary/wicket/field event; restrained camera follow; the same quiet rail until the ball is dead | Observe the consequence. Do not display score/crowd/result before the physical event |
| Dead ball / result | Outcome; runs/wicket; updated score and ball sequence; delivered line/length/pace or spin after it is knowable; one primary factual reason; one dominant Continue or Coach/Practice-this-ball action; one quiet alternative where necessary | Understand the result. Never dump all telemetry or show contradictory score, replay, audio or coaching |
| Coach | Outcome; primary reason; one recommendation; compact “what the ball did / what you attempted” visual; Practice This Ball; quiet Why?, alternative shots and Watch Demonstration disclosures | Practice This Ball. No invented fact, mastery celebration wall or measurement dashboard |
| Replay / demonstration | Identical authoritative delivery/field/result; optional trajectory, bat path, contact point/zone and timing window revealed one layer at a time; bounded replay controls outside the corridor; clear teaching/replay label | Replay or Return. Never present a teaching overlay as the original live result |
| Exact-ball retry | Same live inventory and field; clear but quiet “same ball” state before approach; no advance disclosure beyond the selected assistance rules | Play the same delivery with new input. Seed, flight, pitch, field and conditions remain identical |
| Retry comparison | Original and retry outcome; only the material timing, contact, bat-face, direction or footwork delta; factual better/same/worse statement; Continue; Retry Again only as the secondary action when useful | Continue. Improvement must come from input rather than a buff |
| Wicket / innings end | Dismissal type; final score; authoritative replay access; one concise causal explanation; Restart/Another Over; Home as a quiet alternative | Restart/Another Over. No reward panel or fabricated spectacle |
| Over summary | Runs, wickets and completed-ball strip; concise ball outcomes; one evidence-based strength; one improvement focus; form/mastery evidence; Another Over; quiet review of a specific delivery; Home | Another Over. No reward chest, XP fiction, streak pressure, ad or forced summary wall |
| Pause | Paused state; Resume; quiet audio, captions, haptics, Reduced Motion, language and control settings; Restart/Exit with safe confirmation | Resume. It must not expose or advance the hidden delivery and must preserve the exact innings |
| Settings/accessibility | Language; batter handedness; Learn/Play/Real explanation; audio categories; captions; haptics; Reduced Motion; text size; contrast/color-safe options; control calibration where justified; Back/Done | Save/Done. No player-facing FPS, GPU, tier, renderer, benchmark or memory terminology |
| Recovery/fallback | Calm player-language explanation; preserved innings/score; Resume/Retry; one safe Return option; accessible status | Resume or Retry. No raw exception, stack trace, WebGL/Unity jargon or silent renderer substitution |

### 4.2 Everything visible in the live cricket world

The accepted live frame may contain only production-quality, provenance-complete versions of the elements needed by
the current shot:

- sky/atmosphere and floodlights when the selected conditions require them;
- stadium structure, restrained crowd, sight screens and boundary;
- outfield, mowing character, pitch strip, crease markings, stumps and bails;
- the canonical eleven-player field and original umpires where the shot needs them, with the keeper included only
  when the owner-approved rear-shoulder camera can show the keeper without obstructing the corridor;
- fictional bowler with credible run-up, gather, release, follow-through, kit and equipment;
- fictional batter with face, body, jersey, helmet/grille, gloves, pads, shoes, bat, stance and footwork;
- the physical ball with leather/seam/condition detail that remains plausible at its screen distance;
- physically grounded lighting, shadow, atmosphere and material response;
- after contact only, responsible fielder action, ball carry/roll/bounce and the restrained result camera.

The compositing order is: ball; bowler and release; pitch and bounce; batter control/contact; field consequence;
score/equation; everything else. The protected delivery corridor includes the release hand, expected flight envelope,
bounce region, bat path and contact zone. No world object, PIP, caption, finger target or effect may materially cover
it.

### 4.3 Persistent rail and expanded setup

The collapsed peripheral rail contains only:

- score, wickets and over.ball;
- pitch icon/name and compact conditions;
- ball condition;
- bowler family and arm;
- assistance state;
- compact canonical field radar;
- Pause.

It stays outside the corridor, covers no more than the constitutional area limit and freezes during the delivery.
Between balls, one tap may expand pitch behavior, ball age/condition, bowler profile, pace band/spin type, known
pattern information, full labelled field, objective and assistance. Random Over never reveals the exact next ball.

Diagnostics, build ID, renderer/admission, frame graph, touch trace, protected-region overlay, physics trace and asset
IDs belong only to a separately labelled evaluator build or evidence capture. They never appear in the production
player surface.

Never show on a Stage 1 player screen: Chase/daily/social/tournament/leaderboard/sharing UI; rewards, currencies,
streaks, ads, offers, missions or notification badges; account gates; competitor references or CERI/rubric scores;
build ID, renderer, FPS, GPU, memory or debug data; the exact upcoming Random delivery; permanent physics diagnostics;
an extra joystick or permanent shot-button bank; engineering-preview labels; or unapproved placeholder art.

## 5. Player-experience north star

### 5.1 Read the ball

The player must be able to perceive and learn:

- bowler approach, gather, release and follow-through;
- pace or spin family;
- line and length;
- flight, swing, seam, cut, turn and bounce when physically present;
- ball seam axis, rotation, rough side and polished side where screen resolution permits;
- landing region and intended trajectory only when the selected mode is allowed to disclose them;
- field placement and the risk/reward of gaps.

The ball outranks every other pixel from release through contact. UI, hands, bat, batter, keeper, effects, crowd and
camera motion must not hide the decision corridor. Readability aids must be honest, restrained, consistent across
tiers and unable to alter trajectory.

### 5.2 Express intent

Within the limits of a touchscreen, the player must deliberately control the established shot vocabulary, including
leave, defence, drive, cut, pull, flick and loft, with meaningful direction, elevation, power/timing and relevant
footwork. Preserve progressive disclosure: a rookie gets tap, flick and leave before advanced controls; an expert can
reach the full range without being forced through teaching.

Input must visibly move the bat immediately within the locked latency limits, then reconcile to canonical physics
without snapping, teleporting, changing the intended shot or hiding a miss. A gesture must not produce a shot the
player did not ask for. No universal input may dominate the reference deliveries.

### 5.3 Believe the consequence

Every ball has one causal chain:

```text
delivery → player input → bat pose → contact/miss → ball path → fielder/boundary/wicket → score → audio/crowd → replay → Coach
```

Every representation must agree with the authoritative record. An edge must travel as the bat face and contact
dictate. A catch must use the fielder actually in position. A miss has no bat-impact sound or contact haptic. The
score, replay, commentary/caption and crowd may react only after the corresponding physical fact.

### 5.4 Learn and improve

Coach Mode explains, in short language:

- what the ball did;
- what the player attempted;
- the primary physical reason for the result;
- one better response and when to use it;
- how the retry changed timing, bat angle, footwork or outcome.

Every statement must derive from recorded facts. Exact-ball retry must preserve the delivery and allow the player’s
new input—not a hidden buff—to create improvement. Form and mastery are reports of recorded skill, never XP or a
performance advantage.

### 5.5 Feel the moment

Emotional intensity is proportional and causal:

- pitch, bat middle, edge, pad/glove, wicket and fielding have distinct real-cricket transients;
- a four, six, close call, dropped chance, edge or wicket receives an appropriate, non-repetitive crowd response;
- the camera may reveal the field result after contact but cannot steal the batter’s read;
- haptics reinforce physical events only and remain optional;
- ordinary deliveries remain quiet enough for big moments to matter.

The game must never manufacture tension by scripting the result.

### 5.6 Physical delivery, pitch and contact model

Reuse and extend the deterministic authority rather than creating a visual-only approximation. Where relevant to the
selected delivery and conditions, the recorded model must account for:

- release position, orientation, velocity and bowler handedness/action;
- line, length, pace, gravity and aerodynamic drag;
- swing, cut, seam, spin/Magnus effect, spin axis and revolutions;
- pitch friction, restitution, hardness, grass, moisture/dryness, bounce and pace variation;
- ball age and physical condition;
- wind only when disclosed before play and visibly/physically represented;
- batter position, footwork and shot intention;
- bat pose, face angle, path, speed, timing, contact point and edge;
- post-contact launch, spin, carry/roll, field placement and responsible fielder.

Start with the existing simple, readable pitch families: Balanced, Green/Seaming, Hard & Bouncy, Dry/Turning and
Slow/Low where the repository has a proven contract. Disclose advanced variables progressively. Express bowling
speed consistently in km/h in player-facing surfaces and never mix km/h with mph. Rendered release, flight, bounce,
contact and field outcome must match the same authoritative trace on every presentation tier.

### 5.7 Android touch and desktop intent mapping

Use a small, learnable gesture grammar rather than a permanent cluster of shot buttons:

- preserve the established press-origin/gesture footwork contract; add a separate drag/thumb stance affordance only
  if controlled rookie/expert testing proves it improves intent without obstructing the ball or fragmenting input;
- tap or short gesture for defence;
- directional swipe for a grounded shot;
- longer or shaped swipe for an attacking/lofted shot;
- gesture onset/timing for contact timing;
- gesture magnitude for bounded power intent;
- gesture angle for intended direction;
- contextual footwork assistance in Learn, declared forgiveness in Play and manual precision/no timing forgiveness in
  Real;
- an explicit leave gesture or safe no-shot action.

The mapping must be deterministic, testable under touch jitter, outside the ball corridor and responsive within the
locked latency budget. It must expose feedback only when useful and never turn the live screen into a gamepad.
Desktop mouse, trackpad and keyboard may express the same normalized intent but may not change physics, timing rules,
forgiveness or outcome authority.

## 6. Interface, Unity and visual/audio quality

“Apple-like” means disciplined hierarchy, consistency, calm motion, few simultaneous decisions, precise spacing,
legible type, strong accessibility and an interface that recedes during the delivery. It does not mean copying Apple
or putting glass panels everywhere.

Use React for the calm launch/setup shell. Use Unity for the live Stage 1 cricket surface only when its explicit
qualification gate selects it. TypeScript remains authoritative for input normalization, delivery physics, contact,
fielding, scoring, dismissals, Coach facts and replay identity. Unity consumes versioned canonical data; it never
creates a second cricket engine, predicts an outcome to conceal latency, scores twice or silently changes a result.

The binding live camera is the owner-approved stable rear-shoulder batter view:

- show the embodied batter and the bowler;
- preserve the full release-to-contact corridor;
- avoid a standing keeper blocking this live view;
- use credible eye/shoulder height, field of view, scale and horizon;
- keep camera shake and head motion below the readability limit;
- show the ball’s post-contact field trajectory only after contact;
- support Reduced Motion without changing timing or control.

The live surface must include:

- a compact, canonical field-setting PIP;
- score, wickets, over/ball, pitch and ball condition, bowler family/arm and assistance state;
- setup detail available between balls and a minimal peripheral rail during the approach;
- no dashboard, currency, mission, offer, decorative card stack or unrelated animation;
- no player-facing renderer, FPS, GPU, WebGL or benchmark jargon.

An accepted Premium path must use credible, original or licensed production assets:

- distinct human faces, skin, hair and non-robotic body proportions;
- correct cricket stance, grip, footwork, run-up, release, bat arc, follow-through and fielder motion;
- cloth and jersey response without copied teams or logos;
- helmet, grille, gloves, pads, shoes and guards at believable scale;
- willow bat grain, grip and edges;
- ball leather, raised seam and physically consistent polished/rough response;
- stumps, bails, crease, pitch surfaces, outfield, boundary, sight screens, fielders, stadium and crowd;
- grounded lighting, shadows, atmosphere and material response without a plastic/cartoon look.

Production motion requires correct human proportions, planted feet, weight transfer, hand IK, bat alignment,
animation blending and synchronization to authoritative release/contact events. Reject sliding feet, limb or gear
clipping, bat/body intersection, ball/bat mismatch, robotic transitions, one generic action for every shot, or an
animation that completes before the physical event.

The accepted production surface must not contain capsule/sphere/cylinder/box characters, primitive players or props
presented as final, runtime-generated placeholder bats/wickets/stadiums, robotic anatomy, fake crowd blocks, legacy
TextMesh/Arial, debug controls, engineering-preview labels, oversized PIP, obstructive HUD, unlicensed likenesses,
kits/logos/branding, or a concept-art object with no feasible asset-to-runtime mapping. Honest engineering fallbacks
may remain outside the accepted path, clearly labelled in evaluator evidence; missing production assets block visual
acceptance but do not stop unrelated engineering and measurement.

Do not hide poor motion behind particles, camera cuts, bloom, depth of field or crowd spectacle. Premium appearance
must not reduce ball readability, intent response, frame pacing, installed-size compliance or device reach. Balanced
and Classic remain coherent cricket experiences using identical gameplay facts; Classic is not a punishment.

Authentic audio means an original or properly licensed real recording provides the core transient. Synthesis and DSP
may extend resonance or ambience but may not be represented as the real source recording. Maintain provenance and
blind listening evidence. If final audio is unavailable, label and retain the engineering fallback honestly.

At minimum the event taxonomy distinguishes ball-on-pitch, bat middle, edge/nick, glove, pad, stumps/bails, pickup,
throw/catch, boundary, appeal, dismissal, crowd rise/release and close call. Dot, single, four, six, edge, dropped
chance, near miss and wicket have distinct proportional reactions driven only by authoritative facts. Music,
commentary and celebration must never cover the contact transient.

React and Unity must share one versioned design-token contract: font family and type scale, color, spacing, radius,
iconography, elevation, motion, captions and accessibility settings. A transition between setup and live play must
feel like one product without making React or Unity a second gameplay authority.

Launch readiness includes English and Hindi layout/rendering with all player-facing strings externalized. Architect
string, font, shaping and layout support for Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi,
Odia, Assamese and Urdu, but do not claim any language quality without native review. Support text expansion, 200%
text where required by the locked accessibility contract, color-safe cues, captions, Reduced Motion, haptic controls,
safe touch targets and left-/right-handed presentation where applicable.

## 7. Android, web and performance envelope

Android is the primary platform. Web and Unity WebGL are separately verified surfaces, not evidence for physical
Android performance. A web page must never be called “Unity” merely because a canvas is visible: evidence must record
the observed renderer, admission state and complete live ball. If Unity WebGL cannot pass its gate, keep the working
fallback and label the Unity Web path unproven rather than disguising it.

Binding Android end goals:

- Android API 28 minimum and the repository’s current target SDK;
- landscape support at every locked viewport and safe area;
- no more than **50,000,000 bytes fresh installed through the first playable ball** for every counted configuration;
- at least **90.0% India-weighted working Android-phone reach** using the denominator and evidence method in
  `docs/ANDROID_SIZE_AND_REACH.md`;
- unsupported, unknown-memory, low-memory or incompatible-ABI devices must enter a proven complete fallback before
  Unity class/native loading, not crash and attempt a late fallback;
- every Android-affecting change reports measured installed-size delta and affected compatibility cohorts.

Artifact size, emulator success and a list of phone models do not certify the size or reach gates. Unknown and
untested cohorts remain in the denominator and count as zero until proven.

Locked delivery budgets include:

- Premium frame time p95 at most 18 ms;
- Balanced p95 at most 22.2 ms and p99 at most 33.3 ms;
- Classic p95 at most 33.3 ms;
- no frame over 100 ms inside a delivery;
- input-to-visible-bat-motion p95 at most 50 ms on Premium/Balanced and 67 ms on Classic;
- at least 30 complete deliveries per tier/environment for frame evidence and at least 50 swings per configuration
  for response evidence;
- no shader compile, asset load, network request or quality change during a live delivery.

Measure full deliveries and include startup, memory, thermal, battery, audio focus, pause/resume, Activity recreation,
process reclaim, interruption, context loss, Unity unload/reload, offline operation and return to React. Emulator and
software-renderer evidence is engineering evidence only.

Use measured, platform-appropriate optimization rather than visual downgrades without evidence: adaptive LODs,
texture atlases, mesh and animation compression, bounded audio compression, object pooling, baked lighting where it
preserves the ball, ETC2 baseline with ASTC where supported, restricted shader variants, controlled draw calls and
materials, explicit memory budgets and thermal-duration tests. Record APK, AAB, Play/download estimate, fresh
installed bytes, Unity runtime contribution, asset contribution, startup, frame-time distribution, peak memory and
thermal result separately with device, OS, GPU, renderer and quality path.

Architect shared contracts so later iOS support is not prevented, but do not build or claim iOS while Android and web
remain unqualified.

## 8. The Cricket Experience Readiness Index

Implement and use the supplemental **Cricket Experience Readiness Index (CERI)** from
`docs/evaluation/CRICKET-EXPERIENCE-SUCCESS-METRIC.md`. It does not replace a locked rubric and it is not a forecast
of commercial success.

For dimension score `d_i` from 0–10 and decimal weight `w_i`:

```text
CERI = 100 × product((d_i / 10) ^ w_i)
```

Use a weighted geometric mean so a weak essential dimension cannot be hidden by polish elsewhere.

| Dimension | Weight | Evidence needed to score it |
| --- | ---: | --- |
| Delivery readability | 15% | Human delivery identification, ball visibility, contrast and uninterrupted tracking |
| Intent fidelity | 15% | Intended versus recognised shot, direction/elevation/footwork and visible response |
| Cricket causality and trust | 15% | Physics, render, field, score, audio, replay and Coach agreement; no steering |
| Mastery depth | 10% | Expert advantage, exact-ball improvement, tactical gaps and no dominant input |
| Embodiment authenticity | 10% | Experienced-player ratings of bowler, batter, equipment, field, pitch, camera and motion |
| Emotional proportionality | 8% | Correctly ordered and appropriately scaled audio, crowd, camera, haptic and satisfaction evidence |
| Pacing | 7% | First-ball time/taps, dead-time ratio, skippability and next-playable delay |
| Performance and device reach | 8% | Frame/input/startup/memory/thermal results and weighted supported reach |
| Stability and progress integrity | 7% | Crash/ANR, lifecycle, resume/offline and no duplicated or lost play |
| Interruption burden | 5% | Forced ads, paywalls, popups, waits and unrelated screens per playable minute; Stage 1 target is zero |

Map the desired reactions to evidence before building spectacle:

| Desired reaction | Mandatory proof |
| --- | --- |
| “I read it” | Release/ball visibility plus correct line, length and pace/spin identification |
| “I played my shot” | Intent recognition, directional/elevation accuracy and input-to-bat response |
| “That made sense” | One authoritative causal trace and live/replay/score/audio agreement |
| “This is cricket” | Independent expert observation plus credible action, artifacts, field and physics |
| “That felt great” | Event-ordered proportional feedback plus real-player emotional rating |
| “I improved” | Factual Coach explanation and better exact-ball retry without a buff |
| “One more over” | Unprompted voluntary continuation, separately for rookies and experts |

### CERI hard gates

Report **NOT PASSED**, irrespective of the numeric index, if any of these is true:

- an outcome is secretly steered or reasonable suspicion of scripting cannot be disproved;
- live play, replay, score, audio, field or Coach contradicts the authoritative result;
- a supported configuration loses play/progress or has a critical crash/ANR;
- UI or presentation materially hides the ball in the decision corridor;
- deterministic replay or the TypeScript/Unity authority contract fails;
- readability, intent fidelity, causality/trust or mastery is below 8.0;
- build, version, device, renderer, settings, method or evidence provenance is absent;
- AI personas, owner opinion or scripted automation are substituted for real-player evidence.

### Exceptional-experience candidate

The phrase “users will salivate over it” is not a certification. The operational label
**EXCEPTIONAL-EXPERIENCE CANDIDATE** requires all of the following:

- CERI at least 90;
- readability, intent fidelity and causality/trust each at least 9.0;
- every CERI dimension at least 8.5;
- New Player X and Expert Player X independently pass every locked real-player threshold;
- at least 80% of each cohort voluntarily plays or asks for another over;
- no open Critical or High defect;
- physical Android evidence from representative devices;
- owner approval of the exact running build.

Without complete device and human evidence, label the score **PROVISIONAL** or **NOT SCORED**. Do not estimate the
missing portion or cap it with an invented number.

### Locked scorecard targets remain separate

CERI does not replace the existing scorecard. Apply the locked calculation and evidence rules to these separately:

- Stage 1 exit minimum: New Player X at least 9.0, Expert Player X at least 9.0 and Practice player experience at
  least 9.2;
- ceiling targets: UX at least 9.2, minimalistic flow at least 9.5, artifact experience at least 9.0, player
  experience at least 9.5, coherence at least 9.5 and control/fairness at least 9.5;
- owner visual targets: overall UI, live-game UI, visual presentation, batting-control experience and ball readability
  each at least 9.0, with no scored visual row below 8.5;
- UI comparison method: independently remeasure the exact new build; do not reuse the historical 6.2 overall / 4.8
  live-screen score as if it described current source, and do not combine UI, art and player-experience scores.

The Stage 1 minimum may permit a stage decision; it does not establish that the ceiling was reached. Critical or
High findings block every target claim.

Use this priority order for every iteration:

1. hard-gate failures;
2. ball readability;
3. intent, control and causality;
4. stability, frame pacing and device reach;
5. coaching and exact-ball improvement;
6. embodiment, artifacts and authentic audio;
7. pacing, emotional polish and visual refinement.

Fix the weakest essential experience before adding more content.

## 9. Recording and top-three comparison system

Build the missing tracked capture/comparison system. At minimum add and integrate:

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

Use repository-native Node/TypeScript patterns and package scripts. The tools must validate input, fail closed, give
actionable errors, have bounded runtime and preserve the original media. Raw media and competitor material remain in
an ignored evidence/scratch location; commit only schemas, source metadata, non-reconstructive measurements, reports
and selected VANDE-owned evidence when appropriate. If an actual qualifying Unity WebGL runtime is absent,
`capture-webgl.mjs` must return **NOT AVAILABLE**; it must never relabel Three.js or Classic as Unity.

### 9.1 Three separate evidence lanes

1. **VANDE engine-truth lane**
   - exact current build on Android, production web and qualifying Unity WebGL;
   - deterministic seed, authoritative event sidecar, physics/contact/result record, replay digest and frame trace;
   - real-time normal-speed capture with synchronized game audio where the method supports it;
   - touch overlay or synchronized external high-speed finger/device footage for input-to-photon claims.

2. **Controlled competitor lane**
   - current lawfully installed versions of Cricket League, Real Cricket and World Cricket Championship 3 (WCC3) on
     an owned comparison phone;
   - same device, display mode, orientation, refresh, thermal window, network class and recording settings where
     the products permit it;
   - human input, no instrumentation, protection bypass, automation injection or modification of the competitor;
   - exact title, package, version, store, date, settings and capture limitations recorded.

3. **Public-reference lane**
   - public YouTube/store/review URLs, channel/publisher, title, access UTC and timecodes;
   - qualitative visual and sentiment coding only unless explicit rights permit another use;
   - no downloader, circumvention, local redistribution or claim about engine FPS, input latency, physics or control
     from an encoded public upload.

Android is the same-device competitor-comparison platform. WebGL is a separate VANDE parity/presentation lane and
must not be directly ranked for device performance against Android applications.

Include the owner-supplied reference set in `sources.json`, preserving exact URL, title/channel if accessible,
access UTC, relevant timecodes and what the source can and cannot establish:

- `https://www.youtube.com/watch?v=pNMmOIu8Zik`;
- `https://www.youtube.com/watch?v=xkaYueCqsXI`;
- `https://youtube.com/shorts/RYO1DaBRtwA`;
- `https://youtube.com/shorts/5PqmIW1YTnQ`;
- `https://www.youtube.com/watch?v=F61qQtwkVeQ`.

Use real-match footage for anticipation, approach/release, bounce/contact, field consequence, tension, boundaries,
dismissals, crowd emotion and close finishes. Use cricket-game footage for observable presentation and interaction
hypotheses only. Do not claim a comment, view, frame or conclusion that was not actually accessible, and do not redo
research already captured unless its version, source or method is no longer adequate.

Before viewing comparison results, pre-register the scenario classes, metric definitions, exclusions, sampling,
scoring, uncertainty treatment and analysis version. Preserve that registration and document every later deviation.
If a competitor’s terms prohibit controlled recording, do not record it; use cited public observation, reduce the
confidence and state the limitation.

### 9.2 Capture manifest and provenance

Every capture must record and schema-validate:

- lane, source/right basis, raw/diagnostic/derived status and evaluator;
- repository source ID and embedded build ID for VANDE;
- application/game version and package;
- UTC, host uptime and tool versions;
- device, OS, SoC/GPU where available, RAM class, display/viewport, orientation and refresh rate;
- renderer/admission, quality tier, controls, assistance, handedness, pitch, field and seed where applicable;
- thermal state, battery/power, network condition and background-load method;
- capture method, resolution, frame rate, codec, audio method and known perturbation;
- every crop, resample, interpolation, speed change, edit and compression step;
- duration, byte size and SHA-256 for every raw VANDE/controlled evidence file;
- event-sidecar and annotation hashes;
- expected scenario, observed deviations, failure/error log and applicability of each metric.

Never accept a nullable caller-supplied build ID as proof. Derive and cross-check current source, embedded runtime and
artifact identity. A visible Unity canvas without renderer/admission proof is not Unity evidence.

### 9.3 No staged evidence disguised as play

Existing test-hook, queued-swing, artificial slow-motion or scripted-input captures remain useful diagnostic
evidence, but they must be labelled **STAGED/DIAGNOSTIC** and excluded from real-time control, pacing and player-
experience claims. Normal comparison evidence must run at `timeScale = 1`, use the shipped input path, include the
whole setup-to-dead-ball sequence and disclose every assistance setting.

Do not cherry-pick only boundaries or successful clips. Retain failed attempts, misses, wickets, UI delays, errors
and restarts. Keep at least one uninterrupted six-ball sequence per title/configuration when the game mode permits.

ADB `screenrecord` may supply a bounded Android video lane, but it has no game audio and can perturb performance. It
cannot prove input-to-photon latency or audio timing. Use an independently synchronized capture/audio method and an
external high-speed camera when those claims matter, and record the method’s uncertainty.

Run matched recorder-on and recorder-off controls on VANDE and report the measurement delta. Ordinary 60 fps video
cannot verify the constitution’s 20 ms contact-audio/haptic threshold by itself; use authoritative event/audio logs
and sufficiently precise synchronized capture. Browser-emulated touch, queued swings and `adb input` are machine
input evidence, never physical-finger or human-skill evidence.

### 9.4 Matched six-intent protocol

Seek the closest available delivery/intent pairs across titles:

1. leave;
2. defensive shot;
3. grounded straight or cover drive;
4. square/cut or pull response;
5. lofted attacking shot;
6. deliberate mistime or miss.

Competitors cannot be forced to use VANDE’s seed. Match scenario classes, not imaginary identical physics, and label
every mismatch. Annotate approach, gather, release, flight, bounce, decision point, gesture, first visible bat
response, contact/miss, field result, score reaction, dead ball and next-playable state. A second independent
annotator reviews ambiguous frames; preserve both annotations and the adjudication rather than overwriting them.

### 9.5 Measures that may be compared from controlled video

Produce raw values, confidence/uncertainty and timecoded evidence for:

- launch/setup time and taps to first playable ball;
- ball pixel diameter at release, bounce and near contact;
- local luminance contrast and track-continuity rate;
- percentage of the decision corridor occluded by HUD, controls, finger or character;
- camera cuts, shake, roll and horizon movement during the delivery;
- bowler/run-up and bat-motion jerk, foot slide, bat-arc discontinuity and visible clipping;
- visible player, equipment, field, stadium and material defects using a frozen evaluator checklist;
- contact-frame to impact-audio offset when synchronized audio exists;
- physical event to score, crowd, camera and result-response delay;
- dead-time ratio and result-to-next-playable delay;
- HUD occupancy, persistent-control count, touch-target burden and text legibility;
- outcome/replay contradictions visible in the recording;
- duplicate-frame rate as a recording property only, never as engine FPS.

VANDE may additionally use owned telemetry for touch-to-visible-bat latency, physics-to-projected-ball error,
rendered-bat/contact spatial error, event ordering, actual frame-time distribution and deterministic replay identity.
Do not infer or invent these hidden engine measures for competitors from pixels.

Cross-game SSIM, PSNR, LPIPS and VMAF do not rank game quality because the titles render different scenes. Use
full-reference image/video metrics only for the same VANDE seed, camera and presentation when detecting a regression
or encoding loss.

### 9.6 Comparison output

Generate machine-readable JSON plus a readable Markdown/HTML report containing:

- exact versions and environments;
- scenario and mismatch table;
- raw metric table with units, sample sizes and uncertainty;
- annotated VANDE frames/timecodes and competitor time references without redistributing competitor media;
- observable wins, losses and not-comparable fields;
- CERI-related evidence mapping without imputing missing competitor internals;
- New Player X and Expert Player X blind/hands-on results when real studies exist;
- findings ranked Critical, High, Medium and Low;
- recommended next correction by weakest essential dimension;
- evidence provenance and integrity checks.

Do not turn unavailable competitor telemetry into a zero or an estimate. A passive video comparison cannot establish
control feel, fairness, desire or mastery; it must remain incomplete until matched hands-on human sessions exist.

### 9.7 Automatic anti-fake rejection gates

Reject the affected claim, regardless of its score, when any of the following occurs:

- source, embedded build and artifact identity disagree, or a raw file, manifest, hash or provenance record is
  missing;
- edited media is presented as continuous, or a crop, trim, speed change, interpolation, enhancement, replacement
  audio or other transform is not recorded with parent/child hashes;
- fallback output is presented as Unity, test-hook/slow-motion input as natural play, or machine input as human play;
- framing hides the finger, HUD or ball corridor in a way that changes the claimed measure;
- a success-only reel omits failures, misses, waits, crashes, contradictory outcomes or required states;
- sidecar, video, score, replay, audio, Coach or authoritative result disagree, or clocks are non-monotonic without a
  resolved explanation;
- engine performance, latency, physics, fairness or control is inferred from a compressed public video;
- incomparable scenarios are called identical, inaccessible competitor internals are invented or missing competitor
  evidence is counted as a VANDE win;
- a builder certifies its own work, an AI persona is counted as a player or rookie/expert results are pooled;
- competitor media or trade dress is copied into VANDE, committed, redistributed or obtained through an unofficial
  APK, instrumentation or circumvention;
- participant media lacks consent or identifiable information exceeds the approved anonymized protocol.

The report must show unfavorable evidence as prominently as favorable evidence.

## 10. Rookie and expert validation

Use the locked New Player X and Expert Player X definitions and thresholds unchanged. Never pool the cohorts.

First run a pilot with 3 genuine rookies and 3 independent experts. Pilot data does not count toward the formal
score. After correcting common failures, run at least 10 rookies and 10 experts on representative Indian Android
phones, including the locked left-handed and budget-device mix.

The first session has no developer coaching. Comparison order is randomized and counterbalanced. Record only
consented, anonymized data. The owner’s session is an informed-expert case study and is valuable, but it is not
independent expert evidence.

At minimum retain per participant:

- cohort qualification, handedness class, device and exact build;
- consent status and screen recording where consented;
- interaction events, completion time and outcome sequence;
- delivery-identification accuracy and ball-tracking failures;
- intended-versus-recognised shot class and observed control errors;
- result explanation, exact-ball retry and measured improvement;
- perceived control, fairness, cricket credibility and emotional satisfaction;
- observed confusion, exploit or suspected scripting;
- voluntary next-ball/retry/next-over behavior;
- GUESS-18 constructs reported separately rather than hidden inside CERI.

The locked minimums include, but are not limited to:

- at least 90% of rookies complete the first delivery without developer help;
- at least 85% understand the three basic actions;
- at least 80% explain at least four of six outcomes correctly;
- at least 80% improve on exact-ball retry;
- at least 80% of each cohort voluntarily plays or asks for another over;
- median rookie control, clarity and fairness ratings at least 9/10;
- at least 90% of expert intended input classes recognised;
- reproducible same-delivery/same-normalized-input outcomes;
- experts materially outperform rookie and random baselines;
- at least 80% of experts rate control, fairness and cricket credibility 9/10 or higher;
- no repeatable exploit or universal dominant shot.

AI agents must not role-play these participants or estimate their results.

## 11. Product-success instrumentation

No single prelaunch metric predicts that a game will be a hit. Preserve or implement consented Stage 1 instrumentation
for the value path while keeping later product stages closed:

- launch → Practice visible;
- mode choice and setup abandonment;
- time/taps/help to first controllable delivery;
- first-delivery and first-over completion;
- intended input and understood result;
- exact-ball retry and improvement;
- voluntary second-over start;
- sessions, overs and balls played;
- crash, ANR, slow session, lifecycle failure and progress loss;
- renderer/tier/device cohort without player-facing technical language.

Freeze every event definition, session rule, day boundary, version, platform, acquisition source and cohort before
using it in a decision. Do not collect unnecessary personal data.

After Stage 1 has passed and a separately authorized soft launch exists, report exact-day D1, D7 and D30 retention,
DAU/MAU, sessions and playtime per DAU, voluntary continuation, exact-ball improvement, crash/ANR/slow-session rate,
uninstalls/user loss and review themes. Split results by version, India/other, acquisition source, device tier,
assistance and renderer. Publish sample sizes and confidence intervals. Freeze targets before seeing the result using
the latest relevant sports/region peer percentiles. Do not mix paid and organic cohorts or claim current general-game
benchmarks are an India-cricket promise.

Do not implement Stage 5 habit pressure or Stage 6 sharing merely to move a future metric.

### Deferred product contract — record only, do not implement in Stage 1

Preserve these owner directions in the not-now register without exposing code or UI early:

- after Practice quality and Repeat Desire independently pass, Stage 3 may introduce Chase with 1-, 2- and 5-over
  challenges showing target, balls, wickets, required/current rate, field, pitch, bowler and assistance; tension must
  come from cricket resources rather than scripted finishes;
- Stage 4 may introduce asynchronous challenges for 2–10 friends with identical declared conditions, a deadline,
  automatic reveal independent of the initiator, non-blocking expiry for non-joiners, predeclared tie rules, hidden
  opponent completion time until reveal where used and deterministic replay/anti-cheat evidence;
- Stage 5 may add seeded daily cricket value and transparent mastery without gambling, punitive streak loss or dark
  patterns;
- Stage 6 may add deliberate one-tap sharing, deep links, capped opt-in notifications and consented highlights, with
  no contact permission or WhatsApp spam;
- any highlight/channel pipeline must prefer compact deterministic replay data, require explicit consent and
  authorization, publish transparent eligibility/moderation rules and estimate storage/render/API cost first.

Before adding any remote service, provide its purpose, retained data, privacy impact, offline and failure behavior,
lower-cost alternative, and monthly cost at 1,000, 10,000, 100,000 and 1,000,000 users. Prefer on-device Practice,
small versioned event payloads, expiring asynchronous data and serverless validation; never purchase or provision a
service without approval.

## 12. Production replacement and owner approval gates

These gates control promotion of the new visual/live presentation. They do not authorize deletion or deliberate
breakage of the complete working Practice flow while a narrower replacement slice is being perfected. Work that does
not depend on the pending visual decision may continue, but do not proliferate an unapproved art direction.

### Gate A — production-feasible golden screen

Before broad visual replacement, run and capture the current Android screen, then create one exact target gameplay
screen with:

- the owner-approved rear-shoulder batter view, full bowler and protected ball corridor;
- realistic fictional batter, equipment, pitch, wickets, outfield, field, stadium and restrained crowd;
- compact scoreboard and field PIP outside the corridor;
- minimal touch guidance and one coherent React/Unity visual language;
- annotated safe areas, corridor, HUD bounds and touch regions;
- an asset-to-implementation map for every visible item;
- source/licence status, compressed/installed estimate, memory/LOD plan and missing approvals;
- current/target side-by-side and an independent provisional rubric score.

A concept image without a feasible licensed asset, rig, animation, material, size and runtime mapping does not pass.
Primitive characters or runtime placeholders cannot be presented as the target. If paid assets are essential,
provide one consolidated approval request listing asset, source, price, licence, compressed/installed effect,
expected contribution and a free alternative with its trade-off.

Then stop the broad visual replacement and ask exactly:

> Do you approve this exact visual direction for implementation?

### Gate B — one complete production delivery

After Gate A approval, implement one final-quality deterministic delivery through the real production path before
expanding production-art breadth. It must show field/setup, complete bowler approach/gather/release/follow-through,
batter stance adjustment and intent, readable flight/bounce, physical bat path, contact/edge/miss/pad/wicket,
post-contact field consequence, authoritative score, causal audio/crowd, factual Coach and exact-ball retry.

Provide the exact Android build/renderer proof, complete normal-speed video, six key screenshots, asset/licence
register, frame/input evidence, memory/startup, fresh-installed measurement status, independent score table and every
current defect. If qualified Unity WebGL is in scope, show the same build identity and delivery states separately; do
not substitute the retained renderer.

Then stop production-slice expansion and ask exactly:

> Do you approve this one-ball experience as the production foundation?

### Gate C — complete Stage 1 Practice

After Gate B approval, integrate the approved foundation across Predefined and Random Over without weakening the
existing flow. Gate C requires correct uninterrupted six-ball resolution, one-wicket termination, continuation up to
the existing ten-over limit, real field/scoring, deterministic retry, truthful coaching, rookie clarity, expert depth,
approved Android presentation, honest web renderer identity, measured size/performance and no Critical/High defect.

Gate C owner approval is necessary but does not replace the locked independent, physical-device or human gates. It
does not open Chase; Stage 2 must still pass before Stage 3 may begin.

## 13. Required execution phases

### Phase A — establish truth

- reserve ownership and read all binding documents;
- record source/build identity and working-tree state;
- audit current code, assets, audio, tests, evidence and running surfaces;
- reproduce the existing Android, web and Unity WebGL status without overstating it;
- capture an untouched real-time baseline;
- calculate CERI only where evidence exists and mark the rest NOT SCORED;
- publish the gap matrix and ordered implementation plan.

### Phase B — build the measurement foundation

- implement the capture/compare directories, schemas, CLI, hashes and unit tests;
- integrate production-web, Unity-WebGL and Android capture with exact renderer/build checks;
- distinguish staged diagnostics from normal gameplay;
- produce one VANDE end-to-end dry-run report from current source;
- do not block product fixes on unavailable competitor media.

### Phase C — golden direction and Gate A

- build the runnable/prototyped exact-viewport golden screen and its separate evidence overlays;
- map every visible target element to a feasible asset, rig, material, animation and runtime path;
- produce the current/target comparison, provisional visual review and consolidated acquisition request if needed;
- obtain Gate A approval before broad visual replacement; continue only safe tooling and unrelated fixes while it is
  pending.

### Phase D — repair and prove one production delivery, then Gate B

- close every hard-gate defect in the one-ball path first;
- make the delivery readable from approach through contact;
- make input-to-bat response immediate and intentional;
- enforce physics/render/result/replay/Coach agreement;
- prove exact-ball retry, skill gradient, gaps and no universal shot;
- replace accepted-path robotic/procedural content needed by this ball with provenance-complete production-quality
  assets and authentic core transients where available;
- independently recapture/retest every correction and obtain Gate B approval before broadening the production slice.

### Phase E — complete Stage 1 embodiment and integration

- extend the approved foundation to Random and Predefined Over while preserving the working rules and fallbacks;
- improve motion continuity, materials, camera, field PIP, lighting, stadium, crowd and cricket artifacts;
- tune proportional audio, crowd, haptics, Coach, replay and summary without harming control or readability;
- verify every row of the screen-state allow-list at all required viewports, locales and accessibility modes;
- measure asset size, memory, frame and compatibility cost for every import.

### Phase F — platform closure and Gate C

- prove the same canonical result across Unity Android, qualifying Unity WebGL, Three.js and Classic;
- run typecheck, relevant unit/integration/e2e suites, Unity EditMode/PlayMode tests, production builds and Android
  policy/preflight checks;
- run Android lifecycle, stability, size, reach, memory, thermal, audio-focus and physical-device matrices;
- keep Unity opt-in and the fallbacks intact until an independent evaluator passes promotion;
- obtain Gate C owner approval without treating it as independent or human certification.

### Phase G — independent evaluation

- use fresh evaluators for the locked rookie, expert and competitive rubrics;
- run the controlled top-three comparison when lawful apps/devices are available;
- build the consented pilot and formal human-study package;
- correct findings, rerun with the exact build and preserve failed evidence;
- request owner approval only for external acquisition, participant or release actions that remain.

## 14. Tests and evidence integrity

For every claim record:

- exact source/build ID and artifact hash;
- UTC and host uptime;
- device/browser/OS/renderer/tier/settings;
- method, sample size, expected result and measurement uncertainty;
- observed result, pass/fail/not-run status and evidence path;
- evaluator identity and whether that evaluator authored the changed code.

Timing captured when the repository’s system-load ceiling is exceeded is indicative only. Keep bulk raw media in
scratch/evidence storage, not Git. Preserve failed runs and errors; never overwrite the only evidence for a build.

At minimum verify:

- TypeScript and contract checks;
- physics, input, scoring, replay and cross-runtime goldens;
- Coach fact correctness and exact-ball identity;
- first-session, Random and Predefined Over flows;
- full over, wicket, continue, retry and resume flows;
- accessibility, captions, Reduced Motion, safe areas and supported viewports;
- production web/PWA and renderer selection;
- Unity compile, tests, export provenance and full live-ball smoke;
- Android sync/build/install/launch/lifecycle and exact Unity-native/fallback identity;
- full-delivery frame/input measurements rather than menu FPS;
- capture schema validation, media/event hashes, annotation bounds, missing-data behavior and report determinism;
- no committed competitor media or unlicensed asset.

Do not update a test merely because the implementation fails it. Change an expectation only when a higher-authority
product contract changed, and record the decision.

## 15. Definition of done and reporting language

These statuses are distinct:

- **IMPLEMENTED:** source exists and focused tests pass.
- **MACHINE VERIFIED:** an independent automated rerun passes on the exact build.
- **DEVICE VERIFIED:** required physical-device and distribution evidence passes.
- **HUMAN VERIFIED:** the locked real-player cohorts pass.
- **RELEASE READY:** all binding gates pass and the owner authorizes release.

Never turn “agents finished” or “code complete” into 100% product completion. Never report “10×,” “90% real-life,”
“ceiling reached,” “users love it,” “better than the top three” or “release ready” without the precise evidence the
claim requires.

Provide concise progress updates only when there is a material result, blocker, approval gate or host-required
communication checkpoint; do not emit repetitive timer-only reports. Every update states current phase, completed
evidence, active owners, next gate and any external blocker. Percentages must use a published weighted denominator
and count evidence closure, not lines written or agent activity.

The final report must contain:

1. exact source/build identity and working-tree preservation statement;
2. what was reused, adapted, added, removed and why;
3. current renderer/platform matrix and exact artifact paths/hashes;
4. tests/builds run with pass/fail/not-run status;
5. CERI dimension table, calculation, hard-gate verdict and evidence link for every cell;
6. locked rookie, expert and competitive rubric verdicts, reported separately;
7. VANDE-versus-Cricket League/Real Cricket/WCC3 comparison with versions, raw measures, uncertainty and
   not-comparable fields;
8. Android fresh-installed size and India-weighted reach status, with no estimate where evidence is absent;
9. physical-device and human-study results or an explicit statement that they remain pending;
10. Critical/High/Medium/Low findings and retest evidence;
11. asset/audio provenance and remaining external acquisition needs;
12. exact remaining work, owner-only actions and release recommendation;
13. Gate A/B/C status, current-versus-golden comparison and a pass/not-passed verdict for every screen-state row in
    section 4.1;
14. a machine-readable evidence index;
15. the exact final verdict: **PASS** or **NOT PASSED**, followed by the smallest evidence-backed next action.

Completion is reached only when no safe, authorized, in-scope work remains and every unmet external gate is named
honestly. A missing physical phone, lawful competitor install, licensed production asset or real participant is a
pending external dependency—not permission to fabricate a pass and not a reason to stop other work.
