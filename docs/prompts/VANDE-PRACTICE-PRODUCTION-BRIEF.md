You are the lead game director, principal UX designer, gameplay engineer, technical artist, audio director, Android performance engineer, QA lead and multi-agent orchestrator for VANDE Cricket.

Your job is not to create another prototype or merely produce recommendations. Inspect the existing repository, preserve the working cricket engine, and implement a production-quality Practice experience that reaches these player-facing targets:

| Dimension | Minimum target |
|---|---:|
| UX | 9.2/10 |
| Minimalistic flow | 9.5/10 |
| Cricket artifact experience | 9.0/10 |
| Player experience | 9.0/10 |

The experience must feel calm, premium and intentional—closer to Apple-level product discipline than a crowded mobile cricket game. It must also deliver a convincing first-person batting experience rather than hiding weak gameplay beneath menus, currencies, animations or decorative UI.

Repository and operating rules

1. Work inside the existing VANDE repository.
2. Begin by auditing the current implementation, git status, architecture, tests, assets and active processes.
3. Stop only development servers, emulators or test processes associated with this repository. Never terminate unrelated processes.
4. Preserve user changes and proven components.
5. Reuse the existing deterministic delivery physics, batting controls, scoring, fielding, replay, persistence, offline support and device-tier system where they are sound.
6. Refactor or remove redundant code only after proving it is unused.
7. Do not rewrite stable engine code merely to make the architecture look cleaner.
8. Do not return only a plan. Audit, implement, test, visually inspect and iterate.
9. Do not use copyrighted game assets or identifiable real-player likenesses without explicit rights. Create original, licensed or procedurally generated assets.
10. Avoid adding recurring infrastructure. Practice must continue to work locally and offline.
11. Use multiple specialist agents where supported, with clear ownership:
    - UX and information architecture
    - Gameplay and coaching
    - 3D art, lighting and animation
    - Audio and match emotion
    - Android/web performance and accessibility
    - Testing and visual evaluation
12. The lead agent must integrate and review all work. Agents must not independently redesign shared contracts or edit the same files without coordination.

Primary product structure

Replace the ambiguous launch decision with:

VANDE
├── Practice
│   ├── Quick Practice
│   ├── Predefined Over
│   └── Random Over
└── Chase
    ├── 1-over challenge
    ├── 2-over challenge
    └── 5-over challenge

If Chase is not yet implemented, show it as a restrained “Coming next” destination without pretending it works. Practice remains the implementation priority.

A new player must reach the first playable delivery with no more than:

1. Launch
2. Select Practice
3. Select Quick, Predefined or Random
4. Play

Do not expose technical language such as rendering tiers, GPU checks, frame thresholds or software graphics unless a device genuinely fails. Run capability detection discreetly. When fallback is necessary, explain it in friendly product language and provide one clear action.

UX target: 9.2+

Create and enforce an interface constitution:

- One primary action per screen.
- No more than two secondary actions visible at once.
- Cricket field and ball remain the visual priority.
- Use progressive disclosure for advanced configuration.
- Maintain consistent spacing, typography, radii, elevation, colour and motion.
- Every control must communicate what it changes and why it matters.
- Essential information must remain readable without covering the bowler, ball, pitch or batter’s hitting area.
- Replace large blocking post-ball modals with a compact results layer that can expand for coaching details.
- Respect safe areas, landscape orientation, small Android screens, touch targets and system navigation.
- Use restrained animation with meaningful motion—never decorative clutter.
- Provide haptic, visual and audio confirmation for selections and shots.
- Support reduced motion, text scaling, colour-safe status communication and captions for essential audio cues.
- Make pause, restart, exit and sound controls easy to find without dominating gameplay.
- Prevent accidental exits and preserve an unfinished over locally.
- Make loading, errors and fallback states feel intentional and branded.

Minimalistic-flow target: 9.5+

The Practice configuration should present only essential choices:

Quick Practice:
- Begin immediately using balanced defaults.

Predefined Over:
- Configure six deliveries using a fast visual sequence.
- Each ball exposes only four primary attributes:
  - Bowler style
  - Pace band
  - Line
  - Length
- Swing, seam, spin, variation and bounce should appear contextually, not as a permanent wall of controls.
- Allow copying, editing and reordering deliveries.
- Show the completed over as six compact delivery chips.

Random Over:
- Select difficulty and pitch.
- Optionally constrain bowling type.
- Clearly state that each delivery will remain unknown until release.

During play, keep a restrained persistent status strip showing:

- Score, wickets and over
- Target when relevant
- Pitch type
- Bowler style and pace band
- Field preset
- Practice or Coach status

Do not expose the exact upcoming random delivery.

Artifact-experience target: 9.0+

Replace placeholder-looking and primitive cricket presentation with a coherent, premium visual system.

Required cricket artifacts:

- Proportional adult batter and bowler models
- Original, believable faces without copying identifiable players
- Correct body anatomy, hands, grip and stance
- Detailed helmet, grille, pads, gloves, shoes and jersey
- Realistic bat profile, handle, grip, edges, toe, decals and material response
- Cricket ball with visible seam, leather texture and controllable polished side
- Correctly proportioned stumps, bails, crease markings and pitch
- Pitch surfaces for green, hard, dry, dusty and balanced conditions
- Readable outfield boundaries, sight screens and fielding positions
- Coherent stadium architecture, crowd silhouettes, lighting and atmosphere
- Fielders that occupy recognizable positions rather than appearing decorative

Use physically coherent materials, lighting, shadow direction and scale. The ball must remain visible from release through impact. Use contrast, controlled motion blur, depth cues and an optional subtle focus aid—but do not turn the ball into an arcade projectile.

Create scalable quality tiers:

- Premium: full materials, crowd, shadows and richer animation
- Balanced: optimized materials, controlled crowd density and reduced effects
- Classic: clear 2D/low-cost presentation retaining identical delivery physics and scoring

Degradation must remove visual expense before compromising timing, input or ball readability.

Player-experience target: 9.0+

The batter must experience and respond to:

- Pace
- Release point
- Line
- Length
- Bounce
- Seam
- Conventional swing
- Cutters
- Off-spin and leg-spin
- Pitch condition
- Timing window
- Bat angle
- Footwork intent
- Shot direction
- Field placement
- Risk versus reward

Do not generate arbitrary outcomes. Every delivery and result must be explainable from delivery parameters, player input and controlled assistance.

The batting view must:

- Use a credible first-person batter perspective.
- Keep the bowler’s approach and release readable.
- Show the ball continuously whenever physically plausible.
- Provide sufficient input allowance for mobile reaction time without making outcomes automatic.
- Support touch, mouse and keyboard consistently.
- Make defensive, grounded, lofted and leave intentions understandable with minimal controls.
- Distinguish early, ideal and late timing.
- Communicate edges, misses, mistimed shots and clean contact through animation, sound and feedback.
- Favour enjoyable scoring at beginner difficulty while preserving cricket logic.
- Increase challenge through better bowling and smaller assistance—not hidden randomness.

Coach Mode

Coach Mode must teach, demonstrate and allow deliberate improvement.

For every ball:

1. Preserve the exact deterministic delivery definition and seed.
2. Explain pace, line, length, movement, bounce and field context.
3. Explain what the player did.
4. Identify the primary mistake, not a generic list.
5. Recommend the best shot, footwork, bat path, timing and safe scoring region.
6. Show a short visual demonstration from the batting perspective.
7. Provide “Replay exact ball.”
8. Recreate the identical release, trajectory, bounce and field.
9. Compare the new attempt with the previous attempt.
10. Show improvement using simple language.

A player must be able to practise the identical ball repeatedly until the response improves. Practice history should influence a local form profile containing meaningful skills such as pace timing, short-ball response, spin reading and off-side placement. Do not create a fake global rating disconnected from actual performance.

Field communication

- Show the field before the over in a clean interactive map.
- Clearly identify gaps and high-risk regions.
- Keep a small field indicator accessible during play.
- After contact, show the actual ball path and responsible fielder.
- Coach recommendations must account for the current field.
- Never recommend a shot directly toward a protected region without explaining the risk.

Match emotion and audio

Implement an adaptive audio system for:

- Run-up and delivery anticipation
- Bat impact quality
- Edges and misses
- Dot balls
- Boundaries
- Sixes
- Wickets
- Close calls
- Milestones and final-over pressure

Crowd intensity must respond to context and decay naturally. Do not play maximum crowd noise after every event. Mix must preserve the important sounds of release, bounce and contact. Supply independent music, effects, crowd and haptic settings.

Performance requirements

Target representative Indian Android hardware:

- Balanced tier: stable 45–60 FPS during live delivery
- Lower supported tier: stable 30 FPS or a clear Classic fallback
- Input-to-feedback latency must remain consistent
- No gameplay-time network dependency
- No shader compilation stutter during a delivery
- Preload required assets before the over
- Respect practical memory limits and recover cleanly after backgrounding
- Web and Android must share gameplay rules and deterministic delivery results
- Do not claim device coverage without testing representative profiles

Verification and scoring

Create a repeatable evaluation rubric and score the actual implementation—not intentions.

UX:
- First-ball time
- Navigation comprehension
- Information readability
- Accessibility
- Recovery from interruption
- Player-test task completion

Minimalistic flow:
- Number of decisions before play
- Visible controls per state
- Configuration time
- Backtracking and abandonment
- Interface obstruction during delivery

Artifact experience:
- Cricket correctness
- Geometry and proportions
- Material quality
- Animation quality
- Ball readability
- Lighting coherence
- Quality-tier consistency

Player experience:
- Input confidence
- Delivery readability
- Outcome explainability
- Coaching usefulness
- Exact-ball reproducibility
- Emotional response
- Performance stability

A target score is achieved only when evidence supports it. Do not assign 9+ because the feature exists.

Definition of done

The task is complete only when:

- All four target dimensions reach or exceed their required scores through evidence.
- Launch and Practice flows are visually coherent and usable.
- Exact-ball Coach Mode works deterministically.
- Premium, Balanced and Classic presentations are functional.
- Automated tests, type checking and production builds pass.
- Core gameplay is tested at multiple viewport sizes and performance profiles.
- Screenshots or recordings cover launch, configuration, live batting, field view, coaching, replay and fallback.
- No broken buttons, placeholder screens, fake data or misleading “coming soon” interactions remain.
- Existing working functionality has not regressed.
- The final report lists:
  - What was reused
  - What was changed
  - What was removed
  - Test and performance results
  - Before-and-after scores
  - Remaining risks
  - Exact files changed

Work in audited stages, but continue autonomously through implementation and verification. If a requirement cannot honestly reach 9+ because a necessary professional asset or physical-device test is unavailable, implement the strongest production-ready foundation possible, state the specific evidence gap and do not inflate the score.
