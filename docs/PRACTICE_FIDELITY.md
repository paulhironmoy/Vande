# Practice fidelity: the Real-Match Fidelity Score and how Practice is validated

The North Star (docs/prompts/VANDE-PRACTICE-NORTHSTAR.md) defines success as player belief, control and genuine
learning, judged by people, not by code inspection, screenshots or automated tests. This document defines the score,
the evidence each category needs, and the study protocol. Automated tests and the in-app tester mode only support it.

## The score (100 points; release target 90)

| Category | Points | What is judged | Evidence |
| --- | --- | --- | --- |
| Ball perception | 20 | Pickup from the hand, pace, line and length, seam and shine, swing, seam movement, cut, drift, dip, turn, bounce, without labels | Testers identify broad line and length (target 85%) and major movement after training (target 80%); nobody reports the interface obscuring the ball |
| Player control and agency | 20 | Input moves the bat at once; footwork, decision, direction, elevation and power are the player's own | Testers feel their input controlled the shot (target 90%); nobody believes outcomes were scripted; measured input-to-bat latency |
| Cricket decision authenticity | 15 | Leave, defend and attack are the right cricket choices for the ball; the same swipe against every ball fails | Experienced players rate tactical fidelity (target 9/10); the physics property tests (same swipe fails, reading succeeds) |
| Field and condition awareness | 10 | The field, gaps, protected zones and conditions are understood before and during the over | Testers understand the setup and score (target 90%) |
| Player and equipment realism | 10 | Bowler, batter, keeper, umpires, bat, ball, stumps, ground and stadium look credible at gameplay distance and in close-ups | docs/ASSET_REGISTER.md acceptance status; experienced players' visual rating |
| Audio, crowd and haptics | 10 | Release, pitch, contact, crowd rhythm and haptics follow the physical event and the match moment | Experienced players' emotional-fidelity rating (target 9/10) |
| Coaching and learning value | 10 | Coach Mode explains why, recommends a better response that really works, and repetition produces improvement | Testers understand why after Coach Mode (target 90%); improvement against the repeated ball within five attempts (target 80%) |
| Continuity and absence of friction | 5 | Launch to first ball, resume, errors, orientation and recovery | Observed sessions; time to first delivery; no technical loss after a pause, crash or rotation |

**Gate:** no category may compensate for a failure in ball visibility, control or fairness. A failure there fails
the release whatever the total.

**Performance gate:** supported low-tier Android devices hold a stable 30 fps and capable devices target 60 fps,
measured on physical phones (docs/PRACTICE.md §9). An emulator or a desktop browser is not evidence.

## Validation study

The study is the Stage 1 human gate of `docs/VANDE-PRODUCT-SEQUENCE.md`. Its runnable package is
`release/player-experience/shared/playtest/`, owned by the Player Experience Director. The package holds:

- the protocol, screeners and quotas;
- consent and anonymization;
- the rookie and expert session scripts, with no coaching in the first session;
- the observation sheet and questionnaires;
- the participant record;
- randomization;
- the analysis plan, fixed before any data exists.

`release/` is not under version control. The package is copied into the repository when the owner approves a commit.

- **Pilot:** 3 New Player X (rookies) and 3 Expert Player X. Fix the common problems before formal sessions; pilot
  data never counts.
- **Formal:** at least 10 rookies and 10 independent experts, on representative Indian Android phones. Desktop is an
  extra block only.
  - The rookies include at least 5 cricket fans who are not serious gamers and at least 5 general mobile gamers.
  - The experts are cricket-game players.
  - Include at least 2 left-handed players and at least 3 budget phones.
  - The owner's own session is an "informed expert" case study and is not counted.
- **Session outline:**
  1. Launch to the first ball, unaided.
  2. The reference over: full outswinger, inswinger at the stumps, hard length, cutter, bouncer, yorker.
  3. After each ball, the tester names the line, the length and the main movement.
  4. Coach Mode on a failed ball, then up to five exact-ball attempts.
  5. The questionnaires.
- **Recording:** the hidden tester mode records the answers, interaction events and observed continuation on the
  device only, and exports them as JSON. Nothing is sent anywhere.
- **No data, no result.** With no testers there is no data, and results are never estimated or filled in.

The scoring law for the study's gates is in the locked rubrics:

- `release/player-experience/ceiling-rubric.md` (H gates);
- `release/player-experience/DUAL-CEILING-RUBRIC.md` §5 (rookie and expert thresholds).

## Success thresholds (from the North Star)

| Measure | Threshold |
| --- | --- |
| Understand the setup and score | ≥ 90% |
| Feel their input controlled the shot | ≥ 90% |
| Correctly identify broad line and length | ≥ 85% |
| Recognise major delivery movement after training | ≥ 80% |
| Understand why after Coach Mode | ≥ 90% |
| Improve against the repeated delivery within five attempts | ≥ 80% |
| Believe an outcome was scripted | none |
| Report the interface obscured the ball | none |
| Experienced players' perceptual, tactical and emotional fidelity | ≥ 9/10 each |
| Low-tier Android frame rate | stable 30 fps |
| Capable devices | 60 fps target |

## Status

Not yet validated. No tester sessions or physical-device measurements have been carried out. The study package is
prepared but has not been run, and it needs real participants recruited by the owner. Engineering evidence
(physics property tests, Coach Mode goldens, layout and accessibility checks, emulator and desktop frame rates) is
recorded in docs/PRACTICE.md, docs/PRACTICE_PHYSICS.md, docs/PRACTICE_COACH.md and docs/PRACTICE_PRESENTATION.md, and
does not count towards the score.
