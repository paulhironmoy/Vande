You are now the RELEASE DIRECTOR and EVIDENCE AUTHORITY for VANDE Cricket’s Practice experience.

Repository:
 /Users/hironmoy/Vande/Vande

Branch:
 cricket-rebuild

MISSION

Bring the implemented Practice experience as close as realistically possible to these release targets:

- UX: 9.2+
- Minimalistic flow: 9.5+
- Artifact experience: 9.0+
- Player experience: 9.5+
- End-to-end physical coherence: 9.5+
- Perceived control and fairness: 9.5+

Then produce auditable evidence showing which targets have actually been reached.

A target written in a prompt, implemented in code, or claimed by an agent is not evidence.

Never manufacture, estimate upward, or award aspirational scores. If a target cannot be proven, report “NOT PROVEN” and identify the exact remaining validation.

OPERATING RULES

1. Continue the current multi-agent implementation. Do not restart, discard, reset, stash, overwrite or duplicate existing work.
2. Inspect the active agent tree and existing file ownership before assigning anything.
3. Do not let two agents modify the same files simultaneously.
4. Reuse the existing Physics, Interface, Presentation, Coach, Audio, Artifact, Field Intelligence, Performance, QA and Player Experience agents.
5. Add another agent only when the work is independent and has no current owner.
6. Preserve all user-owned and uncommitted changes.
7. Do not publish, deploy, buy services or make irreversible external changes.
8. Integrate in dependency order. Parallel implementation is not success if the combined product does not work.
9. Builders may not certify their own work.
10. The Player Experience Director and QA agent are independent evaluators. They may identify defects and retest corrections but must not silently repair another owner’s code.
11. Evaluate the running implementation—not specifications, intentions, screenshots alone, code volume or agent descriptions.
12. Every failed criterion must be routed to its owner, corrected, and independently retested.

PHASE 1 — FREEZE THE RUBRIC BEFORE MORE SCORING

Create:

release/player-experience/ceiling-rubric.md

Define every score as observable criteria before inspecting final results.

Use this weighted Player Experience rubric:

- Perceived control: 20%
- Physics/visual/input coherence: 15%
- Ball readability and recognition: 10%
- Batter embodiment and camera: 10%
- Contact, outcome and feedback satisfaction: 10%
- Coach Mode and exact-ball improvement: 10%
- First-session comprehension and flow: 10%
- Performance and device consistency: 10%
- Accessibility and comfort: 5%

Rules:

- Every score must cite evidence.
- No evidence means zero credit for that criterion.
- No averaging may hide a critical failure.
- Any critical defect in control, determinism, scoring, readability, build stability or supported-device operation caps Player Experience at 8.5.
- Missing real-player validation makes a score above 8.8 PROVISIONAL, never proven.
- A score of 9.5 requires all critical dimensions to be at least 9.0.
- Lock the rubric before final testing. Do not weaken it after seeing results.

PHASE 2 — ESTABLISH THE TRUE BASELINE

Record:

- Current git state
- Active agents and file ownership
- TypeScript status
- Unit, integration, rendering and end-to-end test status
- Web production build
- Android build and emulator status
- Current supported-device matrix
- Current performance results
- Current Practice flow and known defects
- Current scores with evidence
- Unsupported or unavailable validation

Save the baseline under:

release/player-experience/baseline/

Do not score partially rewritten or non-compiling code as complete.

PHASE 3 — COMPLETE AND INTEGRATE THE EXPERIENCE

Resolve the implementation in this order:

1. Restore a green typecheck and stable Practice contracts.
2. Complete the Practice flow and first-session journey.
3. Integrate deterministic physics, field intelligence and Reference Over.
4. Integrate Coach Mode, exact-ball retry, form and mastery.
5. Integrate the first-person presentation and visible batting input.
6. Complete bat, ball, seam, shine, gloves, stumps, pitch, players, field and stadium artifacts.
7. Integrate audio, crowd emotion, captions and haptics.
8. Complete device-tier, accessibility and performance behavior.
9. Run end-to-end integration and correct contradictions between systems.
10. Perform independent Player Experience and QA review.

For every delivery, verify this entire chain:

BOWLER APPROACH
→ RELEASE
→ BALL RECOGNITION
→ PLAYER DECISION
→ INPUT
→ VISIBLE BAT MOVEMENT
→ CONTACT OR MISS
→ BALL EXIT
→ FIELDING AND CRICKET OUTCOME
→ SCORE
→ AUDIO/HAPTIC/CROWD RESPONSE
→ COACH EXPLANATION
→ EXACT-BALL RETRY
→ VISIBLE IMPROVEMENT
→ DESIRE TO PLAY ANOTHER OVER

All systems must describe the same event.

PHASE 4 — NON-NEGOTIABLE ACCEPTANCE GATES

Engineering:

- Complete TypeScript check passes.
- Production web build passes.
- All relevant unit and integration tests pass.
- Practice end-to-end flow passes.
- Android build and emulator smoke flow pass.
- No critical or high-severity unresolved defects.
- No silent fallback, dead control, placeholder player-facing output or technical device terminology.
- No regression outside Practice caused by this work.

Determinism and fairness:

- A fixed delivery, settings, input and physics version reproduce the same result.
- Exact-ball replay reproduces the original delivery.
- Coaching describes recorded facts rather than inventing an explanation.
- Score changes only after the physical outcome.
- Difficulty and assistance never change secretly during a delivery.
- Repeating the same inappropriate shot must not succeed against every delivery.
- Low-end device assistance must be documented, bounded and fair.

Control:

- Tap, flick, defensive shot, grounded attack, lofted attack and leave are distinguishable.
- Direction, elevation, timing and power visibly follow player input.
- Visible bat movement begins immediately enough to establish causality.
- Early, ideal and late inputs produce understandable differences.
- Edges, misses and wickets feel caused rather than scripted.
- Left- and right-handed play remain coherent.
- Touch, mouse, keyboard and trackpad are tested independently.

Presentation:

- The player sees the bowler’s approach and release.
- The ball remains readable through flight, bounce and contact.
- Seam, shine and rotation agree with delivery movement.
- Bounce agrees with pitch, length and pace.
- Camera, crease, stumps, hands, gloves and bat create batter embodiment.
- Contact location agrees with physics, sound and haptic timing.
- Field positions agree with scoring and dismissal outcomes.
- Visual realism may not reduce ball visibility or control confidence.

First-session flow:

- Practice and Chase are unmistakably different.
- A new player understands how to tap, flick and leave without reading documentation.
- Setup contains only decisions required for the next over.
- Mandatory setup remains visible without covering the delivery.
- The player reaches a controllable delivery with minimal steps.
- The first achievable success occurs early enough to build confidence.
- Every failure produces a clear reason and useful next action.
- No modal interrupts a live delivery.

Performance and accessibility:

- Test all declared device tiers and supported screen sizes.
- Test Premium, Balanced and Classic.
- Test reduced motion, captions, muted audio and disabled haptics.
- Test 200% text, keyboard operation, focus order and screen-reader semantics.
- Record frame-time distributions across complete deliveries, not menu screens.
- No quality change may occur during a live delivery.
- Record input-to-visible-response measurements where tooling permits.
- Clearly identify anything that requires physical-device confirmation.

PHASE 5 — ADVERSARIAL PROOF

Use independent evaluators who did not build the reviewed component.

They must actively try to disprove the target scores by testing:

- Repeated identical inputs
- Incorrect shots against different lengths
- Early and late timing
- Misses, edges, wickets, fours and sixes
- Poor network or offline launch where applicable
- App backgrounding during a delivery
- Reload during an innings
- WebGL failure
- Low frame rate
- Small screens and large text
- Audio and haptics disabled
- Left-handed play
- Exact-ball replay
- Ten-over continuation
- First-time and returning-player flows

A finding is closed only when:

1. Evidence captures the failure.
2. The responsible owner implements a correction.
3. The independent evaluator reproduces the original conditions.
4. New evidence demonstrates the corrected result.
5. Regression tests remain green.

PHASE 6 — REAL-PLAYER EVIDENCE

Machine tests cannot prove delight, perceived control or desire to replay.

Prepare a blind playtest protocol for at least:

- 5 cricket-game players
- 5 cricket fans who are not serious gamers
- 5 general mobile-game players

Do not claim these tests occurred unless real participants completed them.

Measure:

- Time to first controllable delivery
- Whether the player understands the controls
- Whether the player can predict how input affects the shot
- Whether failures feel fair
- Whether the player understands why each outcome occurred
- Whether exact-ball coaching improves the next attempt
- Whether the player voluntarily starts another over
- Overall satisfaction
- Control confidence
- Ball readability
- Preference against the closest comparable cricket experience where a fair comparison is available

Record anonymized results only.

Until real-player results exist, label experiential scores above 8.8 as PROVISIONAL.

PHASE 7 — EVIDENCE PACKAGE

Create:

release/player-experience/evidence/
release/player-experience/FINAL-CEILING-REPORT.md

The package must contain, where technically possible:

- Build and test logs
- Performance measurements
- Device/browser matrix
- Screenshots at representative sizes
- Recorded full-over videos
- Android emulator recording
- Input and trajectory traces
- Deterministic replay comparisons
- Accessibility results
- Before-and-after comparisons
- Defect-and-retest records
- Human playtest protocol and actual results when available

Every evidence item must record:

- Build identifier or git state
- Date and time
- Device/browser
- Settings
- Test method
- Expected result
- Observed result
- Pass/fail
- Evidence path

FINAL REPORT

The final report must provide:

1. What was built.
2. What changed in the player’s experience.
3. Final test/build status.
4. Remaining defects and limitations.
5. Scores for every dimension.
6. Evidence supporting every score.
7. A claim matrix containing:
   - Claim
   - Required evidence
   - Available evidence
   - Result
   - Confidence
8. Separate labels for:
   - PROVEN
   - PROVISIONAL
   - NOT PROVEN
9. Exact work required to close every unproven target.
10. A direct release recommendation:
   - RELEASE
   - LIMITED BETA
   - DO NOT RELEASE

Do not say “ceiling reached” merely because all agents finished.

You may say “ceiling reached” only if:

- All engineering gates pass.
- There are no critical or high-severity defects.
- Independent adversarial evaluation passes.
- Performance and supported-device gates pass.
- Real-player evidence supports perceived control, comprehension, satisfaction and replay desire.
- Every target score is linked to reproducible evidence.

START NOW

First report:

- Current agents and ownership
- Current integration state
- Current verified baseline
- The locked scoring rubric
- The critical path to proof

Then continue autonomously through implementation, integration, correction and validation. Provide concise progress updates at meaningful milestones. Do not stop at planning, documentation or an unverified score.
