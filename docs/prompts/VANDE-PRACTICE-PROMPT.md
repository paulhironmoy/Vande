# VANDE Practice brief (verbatim from the owner, 2026-10-25)

This instruction supersedes every previous task, plan, prompt, and implementation run for VANDE.

You are the lead gameplay engineer, game designer, graphics engineer, mobile performance engineer, test engineer, and technical product owner for VANDE Cricket.

Your assignment is to IMPLEMENT—not merely describe—a production-quality, offline-first Practice batting experience for the existing VANDE web and Android application.

Use multiple specialised agents where useful, but centrally coordinate them. Give each agent non-overlapping file ownership. Do not permit two agents to edit the same subsystem simultaneously. Suggested workstreams:

- Architecture and repository audit
- Deterministic cricket physics and scoring
- First-person camera, input and 3D presentation
- Practice UX, Android performance, accessibility and automated testing

The lead agent owns integration, contract changes, validation and final quality. Continue until the complete vertical slice is functional and verified. Do not stop after producing a plan.

## PRODUCT OBJECTIVE

Build the best possible first-person cricket batting experience available on an ordinary Android phone or desktop browser.

The player must feel:

"I watched the delivery leave the bowler's hand, read the ball, played my own shot, and understand exactly why it produced that result."

The experience should aim to be dramatically better than mainstream mobile cricket games in perceived control, immediacy, clarity and immersion. Do not claim "10× better" merely because features exist. Build measurable advantages.

Do not attempt to reproduce VR hardware. Bring VR-like visual presence, physical contact and agency to a standard phone/browser using simple controls.

## EXISTING TECHNOLOGY

Work inside the current VANDE repository. Reuse its architecture wherever appropriate:

- React
- TypeScript
- Vite
- Three.js
- Capacitor Android
- Existing stadium, pitch, ball, bat, player and fielding assets
- Existing deterministic replay architecture
- Existing audio and Capacitor haptics
- Existing cricket contracts, conditions, fields and simulations
- Existing quality scaling and 2D fallback

Do not replace the application with Unity, Unreal, Flutter or another engine.

The current live batting architecture is outcome-first: the engine determines the shot/timing/contact and asks the renderer to display it. The new Practice experience must invert this:

Player input
→ moving virtual bat
→ physical bat–ball collision
→ outgoing ball trajectory
→ fielding result
→ runs or wicket
→ replay and coaching

Preserve existing replay and multiplayer behaviour unless an intentional compatible contract extension is needed. Do not break unrelated VANDE modes.

## EXACT USER EXPERIENCE

At application launch, show a clean choice:

[ PRACTICE ]
Experience batting

[ SKIP ]
Continue to the existing VANDE home experience

Do not require login, account creation, network access or configuration before Practice.

Practice should work offline after installation.

When Practice is selected, show:

[ QUICK RANDOM OVER ]
Six unknown deliveries

[ BUILD AN OVER ]
Define all six deliveries

Pitch conditions must be optional and secondary:

- Balanced — default
- Green — more seam and swing
- Hard & Bouncy — more pace and bounce
- Turning — more grip and spin

Do not force the player to configure the pitch before beginning.

## RANDOM OVER

Generate and lock all six deliveries before the first ball.

The six deliveries must remain fixed. The game must never change a delivery after observing the batter's action.

Use a deterministic seed so the over can be replayed exactly.

Use one bowler family throughout an over:

Pace bowler variations may include:

- Stock delivery
- Outswing or inswing
- Seam delivery
- Cutter
- Slower ball
- Bouncer
- Yorker
- Controlled, fast or express pace

Spin bowler variations may include:

- Stock spin
- Flighted delivery
- Quicker delivery
- Top-spinner
- Arm ball
- Googly, carrom ball or equivalent legitimate variation for that bowler

Generate balanced cricket overs rather than six arbitrary extremes. Avoid impossible or unfair sequences in beginner practice.

The batter must not know the exact delivery beforehand. The bowler's action, wrist, release, pace, flight and ball trajectory must provide legitimate visual clues.

## BUILD AN OVER

Allow the player to construct six deliveries without intimidating controls.

For each delivery:

1. Choose pace or spin bowler family for the over.
2. Tap a target line and length.
3. Choose a simple delivery intent or variation.
4. Save the ball into one of six positions.

The same bowler family must bowl the complete over.

Support:

- Exact order
- Shuffle the chosen six deliveries
- Edit or replace any delivery before beginning

The default screen must remain simple. Advanced pace, spin, swing and seam details may be progressively disclosed.

Once batting starts, the player must complete the full over before configuring another over unless dismissed.

## INNINGS RULES

Practice is a one-wicket innings.

- The player begins at 0 runs.
- Runs accumulate across overs.
- A complete over contains six legal balls.
- If dismissed at any time, the innings ends immediately.
- If the player survives, show the accumulated score and allow configuration of the next over.
- Continue for up to ten overs.
- After ten completed overs, finish the innings and show the complete summary.
- No second batter appears after a wicket.
- Wides or no-balls, if included, must follow an explicitly documented rule and must not consume a legal ball.
- Persist an in-progress Practice innings locally so an accidental app pause does not erase progress.
- Do not permit save-scumming or replaying an in-progress delivery for a better score.

At the end of each survived over show:

- Total score
- Balls faced
- Boundaries
- Timing summary
- Scoring areas
- Weakest delivery
- Next Over
- Replay This Over
- Repeat a specific ball in a non-scoring training context

After dismissal show:

- Final score
- Overs and balls survived
- Dismissal replay
- Why the dismissal happened
- Practice This Delivery
- Start New Innings

## FULL-FIELD PRACTICE

This is not net practice.

Every scoring over must include:

- Complete cricket field
- Appropriate field placement
- Visible fielders
- Boundary
- Real ball trajectory
- Fielder interception
- Stops
- Catches
- Automatic running
- Boundaries
- Wickets
- Immediate scoring outcome
- Scoreboard and match context

Before each over, briefly show the field or provide a small readable field radar. Do not require beginners to set the field.

Initially use an automatic balanced field appropriate to the bowler and conditions.

Automatic running should determine 0, 1, 2 or 3 runs using ball speed, placement and fielder interception. Do not add Run, Cancel or Dive controls to the beginner experience.

The score must emerge from the physical play:

Bat–ball contact
→ exit velocity and direction
→ ball flight or roll
→ fielder paths and interception
→ running or boundary
→ score

Do not choose runs using an opaque random probability table.

## TRUE FIRST-PERSON BATTER VIEW

During every live delivery, place the camera at the batter's approximate eye position.

Requirements:

- Landscape gameplay
- Menus may remain portrait
- Camera approximately 1.65–1.75 metres above the crease
- Appropriate lateral offset for right- and left-handed batters
- Bowler clearly visible
- Release hand readable
- Pitch, crease and peripheral stumps visible
- Gloves and part of the bat visible
- Batter's head/body hidden from the first-person camera
- No camera cut from the start of the delivery until after contact or miss
- Stable camera with minimal shake
- No artificial zoom toward the ball
- Gentle head-follow after contact
- External fielding camera only after the immediate first-person contact moment

The player must see the ball continuously from release to the hitting area.

Improve small-screen readability without corrupting physics:

- Rendered ball may appear approximately 20–25% larger than its collision radius.
- Maintain high contrast against pitch and sight screen.
- Provide a short, subtle motion trace where needed.
- Render a clear ball shadow.
- Use readable release animations.
- Do not display a permanent landing marker outside Learn assistance.

## BATTING CONTROLS

Use one shared normalized input model for mobile and desktop.

Mobile:

- Tap → defensive straight-bat action
- Flick → attacking shot
- Flick direction → swing plane and intended scoring region
- Flick velocity → bat speed
- Flick elevation/length → controlled ground stroke versus lofted stroke
- No gesture → leave
- Keep active gesture input in the lower portion of the screen so the finger does not cover the delivery

Desktop/browser:

- Click → defence
- Mouse flick → attacking swing
- Mouse direction and velocity map to the same normalized values as touch
- No input → leave
- Optional WASD/arrow input may control advanced footwork
- Keyboard input must not gain an immediate-contact advantage

Do not make the user select named strokes while the ball approaches. Contextually select drive, cut, pull, hook, flick, defence or another legitimate animation from:

- Delivery line
- Delivery length
- Footwork
- Swing direction
- Bat angle
- Timing

The game may select an appropriate animation, but it must never silently change the player's scoring intention.

## REACTION TIME AND CONTROL ALLOWANCE

Preserve authentic ball-flight time while accounting for the extra time required to enter a touchscreen or mouse gesture.

Use real approximate flight timing:

- Fast bowling: approximately 0.42–0.63 seconds depending on pace, release and trajectory
- Spin: approximately 0.66–0.97 seconds depending on pace and flight

Do not wait for pointer-up to determine timing.

Use:

1. Pointer-down or the first intentional movement to identify swing initiation.
2. The first 30–50 ms of movement to infer direction.
3. A virtual bat travel duration of approximately 120–150 ms.
4. Physical collision when the virtual bat reaches the ball.

Model:

virtualContactTime =
swingStartTimestamp
+ virtualBatTravelTime

Use original high-resolution event timestamps. Timing must not depend on the rendered frame number.

Provide an optional calibration:

"Tap when the moving ball crosses the line."

Use several attempts to estimate device/input timing offset. Store the median locally.

Suggested assistance bands:

Learn:
- Perfect approximately ±55 ms
- Solid approximately ±110 ms
- Edge/mistime up to approximately ±170 ms
- Slower genuine bowling
- Automatic footwork
- Optional landing cue

Play:
- Perfect approximately ±35 ms
- Solid approximately ±75 ms
- Edge/mistime up to approximately ±125 ms
- Authentic delivery timing
- Automatic contextual footwork

Real:
- Perfect approximately ±25 ms
- Solid approximately ±55 ms
- Physical collision and measured latency compensation only
- No landing marker
- Optional manual footwork

Do not label a slowed 110 km/h delivery as 150 km/h.

Bowler animation must provide authentic advance information through run-up, action, wrist, release height and variation disguise.

## PHYSICS

Create a deterministic cricket-specific physics layer separated from rendering.

Ball physics must account for:

- Initial release position and velocity
- Gravity
- Aerodynamic swing
- Spin and Magnus effect
- Drift and dip
- Seam orientation
- Pitch friction
- Pitch restitution
- Bounce
- Post-bounce seam movement
- Post-bounce turn
- Outfield friction
- Boundary collision/detection

Bat contact must account for:

- Bat transform
- Bat-face angle
- Bat velocity
- Ball velocity
- Sweet-spot position
- Contact location
- Timing
- Foot balance
- Incoming spin
- Resulting exit velocity, spin and direction

At fast-bowling speeds, a ball moves too far between ordinary rendered frames for naive collision detection. Use fixed simulation steps and continuous/swept collision detection so the ball cannot tunnel through the bat.

Do not introduce a large general-purpose physics engine unless profiling proves it is necessary. Prefer a compact deterministic cricket solver.

The same delivery seed and normalized swing input must reproduce the identical outcome in replay and tests.

## CONTACT AND FEEDBACK

Support believable:

- Sweet spot
- Inside edge
- Outside edge
- Top edge
- Leading edge
- Pad
- Miss
- Bowled
- LBW only if implemented correctly
- Caught
- Grounded stroke
- Lofted stroke

Synchronize visual contact, audio and haptics to the same simulation timestamp.

Create distinct feedback for:

- Sweet spot
- Edge
- Pad
- Miss
- Bowled
- Catch
- Boundary

After each Practice delivery, show concise coaching without obscuring play:

Examples:

PERFECT
Found the cover gap
FOUR

LATE
Outside edge
Caught behind

SOLID CONTACT
Hit directly to cover
DOT BALL

The player must understand why the delivery produced its result.

Provide slow-motion diagnostic replay showing:

- Ball trajectory
- Bat path
- Contact point
- Bat-face angle
- Timing
- Intended scoring direction
- Actual direction

## ANDROID AND BROWSER SUPPORT

Use the existing shared Three.js/Capacitor implementation.

Recommended official support:

- Android 9 / API 28 minimum
- Android 11 or later recommended
- Target Android 16 / API 36
- 3 GB physical RAM minimum
- 4 GB RAM recommended
- Hardware WebGL 2 / OpenGL ES 3 required

Do not classify performance purely by model name or phone price.

Run a short benchmark while displaying:

"Preparing the pitch…"

Measure:

- Hardware WebGL 2
- GPU renderer
- Shader compilation
- Frame time
- Frame spikes
- Memory pressure
- WebGL context loss
- Input-to-render response

Performance tiers:

Full Batter View:
- 55 FPS or higher average
- No sustained fall below 50 FPS
- Hardware renderer
- Stable context

Assisted Performance:
- 45–54 FPS
- Reduced resolution and effects
- Static crowd
- Simplified lighting
- Minimal particles
- Slight additional calibrated timing tolerance
- Stronger readability assistance

Below cutoff:
- Below 45 sustained FPS
- Software renderer such as SwiftShader, Lavapipe or llvmpipe
- Repeated context loss
- Severe input latency

Do not present authentic first-person express bowling below the acceptable cutoff. Offer a clear Classic/Assisted Practice fallback or compatibility message.

Prioritize in this order:

1. Input responsiveness
2. Stable frame rate
3. Ball readability
4. Physics
5. Player animation
6. Lighting and shadows
7. Crowd and cosmetic effects

Never sacrifice reaction-time fairness for graphical detail.

Continue monitoring performance through a ten-over session because thermal throttling may appear later.

Do not change physics or quality in the middle of a live delivery. Apply changes between balls.

## QUALITY PROFILES

Lite:
- Target 60 FPS
- Approximately 540–720p internal rendering
- Static crowd
- No dynamic stadium shadows
- Simple player shadows
- Low-detail fielders
- Minimal particles
- Reduced textures

Standard:
- 60 FPS
- Approximately 720–900p internal rendering
- Limited shadows
- Moderate crowd and effects
- Standard models

High:
- 60 FPS
- Capped high-resolution rendering
- Higher-detail players
- Better shadows and effects
- Never render excessive device pixel ratio without visible benefit

## DEVICE TEST MATRIX

Test capability classes and major Indian OEM software variants:

- Samsung One UI
- Xiaomi/Redmi/POCO HyperOS or MIUI
- Vivo/iQOO Funtouch OS
- OPPO/Realme/OnePlus ColorOS family
- Motorola near-stock Android
- Infinix/Tecno/Itel software

Cover:

- Legacy 3 GB device
- 4 GB budget device
- 4–6 GB current mass-market device
- 6–8 GB mid-range device
- High-end device
- Mali GPU
- Adreno GPU
- PowerVR where available
- Android 9/10 floor
- Android 11–13
- Android 14–16
- 60 Hz, 90 Hz and 120 Hz displays

Use emulator testing for automation, but do not claim physical-device validation unless it actually happened.

## FIRST-TIME EXPERIENCE

A new player should reach the first delivery within approximately ten seconds after selecting Practice.

First session:

1. Enter Balanced pitch automatically.
2. Use Learn assistance.
3. Show one-line instruction:
   "Watch the ball. Tap to defend. Flick to hit."
4. Deliver one readable stock ball.
5. Explain the outcome.
6. Continue into the six-ball over.
7. Do not expose fields, RPM, energy, exact speed sliders or advanced settings.

After the guided over, make Random Over the primary action and Build an Over secondary.

## SUCCESS METRICS

Instrument privacy-respecting local analytics/events for:

- Time from Practice selection to first delivery
- Frame-rate tier
- Renderer fallback
- Input-to-visible bat response
- Delivery completion
- Over completion
- Wicket
- Next Over selection
- Replay selection
- Timing distribution
- Directional intent versus actual exit direction

Do not collect raw gestures, personal data or unnecessary device identifiers.

Target:

- First delivery in under 10 seconds after Practice selection
- New player understands the control after one ball
- At least 85% of test users can intentionally hit two different field regions after one over
- At least 90% understand why they missed after feedback
- At least 70% voluntarily choose Next Over
- Input-to-visible bat response under approximately 50–70 ms on supported devices
- Stable 55+ FPS on the primary mass-market tier
- Fewer than 5% of tested deliveries feel inconsistent with user intent
- Strong preference over leading mobile cricket batting controls in direct user testing

These are validation objectives. Do not fabricate user-test results.

## SCOPE CONTROL

Build this Practice vertical slice completely.

Do not expand this task into:

- New multiplayer architecture
- New tournament systems
- Monetization
- Advertising
- YouTube uploads
- Social channels
- New authentication
- Team licensing
- Commentary libraries
- Career mode
- Manual running
- Manual field placement
- VR
- iOS-native work

Practice must not require additional backend infrastructure. It should resolve locally and work offline.

Preserve current application features and contracts wherever possible.

Use only original, repository-owned or properly licensed assets. Do not copy competitor assets, trademarks, player likenesses, animations, audio or proprietary UI.

## IMPLEMENTATION PROCESS

1. Read all repository instructions and relevant architecture completely.
2. Audit current Practice, engine, renderer, fielding, audio, Android and test code.
3. Document what can be reused and what must change.
4. Establish non-overlapping agent ownership.
5. Produce a concise implementation plan and immediately execute it.
6. Build the smallest genuine vertical slice first: one batter, one pace bowler, balanced pitch, batter-eye camera, one live physical delivery, flick/tap input, bat–ball collision, fielding outcome, score.
7. Validate that vertical slice before adding variations.
8. Add the complete launch and ten-over Practice flow.
9. Add random and built overs.
10. Add spin, conditions, assistance and performance tiers.
11. Add automated tests and Android verification.
12. Inspect the experience visually throughout implementation.
13. Continue correcting defects until all completion criteria are satisfied.

Do not substitute a menu prototype, predetermined animation, random score generator or fake collision for the required experience.

Do not leave core behaviour as TODOs, placeholders or mocked production paths.

## TESTING REQUIREMENTS

Unit tests: seeded random-over determinism; valid six-ball over construction; pace and spin delivery generation; ball trajectory; bounce; swing; spin; continuous bat collision; timing classification; contact classification; exit direction; field interception; boundaries; automatic running; dismissals; one-wicket innings termination; over progression; ten-over termination; local persistence and safe resume; quality-tier classification.

Integration tests: Practice versus Skip at launch; Random Over; Build an Over; full six-ball completion; dismissal on any ball; surviving into the next over; completing ten overs; Replay This Over; repeat specific delivery; offline practice; landscape gameplay; Android lifecycle pause/resume; WebGL failure fallback.

Browser end-to-end tests for mobile and desktop input.

Run and fix: TypeScript checks; unit tests; full application build; existing test suite; Playwright tests; render-service tests where affected; Android sync; debug APK build; Android emulator smoke test.

Do not weaken, skip or delete existing tests simply to obtain green results.

Record performance separately from correctness. Software-rendered emulators do not prove physical-device performance.

## DOCUMENTATION

Practice product rules; input mapping; reaction-time model; physics model; determinism and replay; camera specification; quality tiers; Android support matrix; performance cutoff; accessibility; known limitations; physical-device test plan. Final implementation report: what was implemented, what was reused, files and contracts changed, test results, build results, performance evidence, Android evidence, remaining genuine risks, physical-device validation still required. Do not report 100% completion if real bat collision, full-field scoring, Android verification, or another required component is missing.

## DEFINITION OF DONE

1. The old implementation run and background work are stopped safely.
2. Existing user changes remain preserved.
3. The app launches into Practice or Skip.
4. Random Over locks six unknown deterministic deliveries.
5. Build an Over allows six predefined deliveries.
6. The batter completes one full over before choosing the next.
7. Score accumulates for up to ten overs.
8. One wicket immediately ends the innings.
9. The player sees a genuine first-person batter view.
10. The ball travels continuously from the bowler's hand.
11. Tap/flick/mouse input moves a real virtual bat.
12. Physical collision produces the ball outcome.
13. Full-field play produces actual runs, boundaries and catches.
14. Practice gives immediate scoring and diagnostic feedback.
15. Replay reproduces the identical delivery and swing.
16. The experience works offline.
17. Android and browser share one normalized gameplay model.
18. Performance tiers and the 45 FPS cutoff function.
19. Existing unrelated VANDE functionality continues working.
20. All relevant automated checks and builds pass.
21. Remaining physical-device testing is reported honestly.
22. No core requirement is represented by a placeholder or fabricated test result.

## REDUNDANT CODE REMOVAL (addendum)

Do not leave parallel legacy and replacement implementations after the migration.

Before deleting anything: map all imports, runtime consumers, tests and build references; determine whether the code is genuinely obsolete or still supports replay, multiplayer, highlights, fallback rendering or another existing feature; migrate remaining consumers to the new shared implementation; run relevant tests before and after removal; never delete code merely because its name appears old.

Consolidate toward exactly one authoritative implementation for each concern: one deterministic delivery-physics engine; one bat–ball collision solver; one normalized mobile/desktop input model; one scoring and dismissal pipeline; one over/innings state machine; one camera-director system; one performance benchmark and quality classifier; one replay representation; one source of cricket constants and timing windows.

Remove when genuinely superseded: previous Practice screens and flows; outcome-first live batting paths that have no remaining consumer; duplicate shot-resolution logic; duplicate random-over generators; obsolete input handlers; unused camera modes created only for the replaced experience; dead types, contracts, adapters and feature flags; unused CSS, translations, tests and assets; dependencies used exclusively by deleted code; temporary migration scaffolding; commented-out implementations; unreachable fallbacks.

Preserve outcome-first presentation code only where it remains legitimately necessary for deterministic replay, highlights or existing multiplayer. Refactor it to consume the new authoritative event representation instead of duplicating cricket logic.

Do not create directories named `legacy`, `old`, `v2`, `new`, `backup` or similar as a substitute for completing the migration.

Use repository searches, TypeScript checks, coverage information and build analysis to identify dead code. Do not rely solely on filenames.

At completion, report: files deleted; files consolidated; dependencies removed; approximate source lines before and after; production bundle size before and after; any apparently redundant code retained; the exact active consumer requiring retained code.

All existing tests must pass after cleanup. Add tests before deleting old code when its required behaviour is not already protected.

The task is not complete while two production implementations perform the same responsibility without a documented, necessary reason.
