# Player experience: the integrated assessment

Owner: the Player Experience Director, an independent evaluator who builds nothing that is scored here.

Scoring law:

- `release/player-experience/ceiling-rubric.md`, the Player experience dimension (§6.1);
- `release/player-experience/DUAL-CEILING-RUBRIC.md`, the cross-persona checks X1–X3;
- the lead's interpretations in `release/player-experience/RULINGS.md`.

Evidence:

- `release/player-experience/px/EVIDENCE.md` (in the format of ceiling rubric §8);
- the real-player package: `release/player-experience/shared/playtest/`.

**Every score here is an engineering estimate, with human validation pending.** No real player has taken part, and no
physical phone has been measured.

**State on 2026-10-26 04:15Z:**

- **Baseline:** assessed on the committed 38924bd.
- **Integrated tree:** not scoreable yet (R11). Snapshot t2 (03:19Z) builds but stops at phase `ready` without
  bowling (ledger F-023). The lead will send a fingerprinted Stage 0 checkpoint build id, and the full cross-system
  pass runs on it.

---

## 1. The player-experience journey

The chain a delivery must survive, and what the player has to perceive at each link:

| # | Moment | The player must… | Systems that must agree |
| --- | --- | --- | --- |
| 1 | Launch → Practice → Random or Predefined Over → setup | know what to press and what the over will test | UX (launch, home, setup), field intelligence, physics (over plans) |
| 2 | Bowler approach | sense pace or spin, the arm and the run-up rhythm, with anticipation | presentation (bowler action), audio (crowd anticipation) |
| 3 | Release | see the hand, the release point and the wrist cue | presentation (rig at `release.p`), physics (release) |
| 4 | Ball recognition | follow a readable ball: line, length, swing, bounce | presentation (ball size and contrast, camera, gaze), physics (flight) |
| 5 | Decision | choose leave, defend or attack, and where | coach (teaching beforehand), field intelligence |
| 6 | Input | express that choice with a tap, a flick or nothing | input (gesture read), UX (teaching the gesture) |
| 7 | Bat movement | see the bat answer at once, the way they meant | input → stage (`beginSwing`), physics bat track |
| 8 | Contact or miss | hear and feel exactly when and how well they hit it | physics (contact), presentation (feedback cues), audio (feel, haptics) |
| 9 | Cricket outcome | watch the ball go where the bat sent it and the field react credibly | physics (exit, fielding, running), presentation (cameras, fielders) |
| 10 | Score | see the score change only after the physical outcome | UX (board), physics (events) |
| 11 | Emotion | get a reaction proportional to the event | audio (emotion machine), presentation (crowd) |
| 12 | Explanation | know what happened and why, in one line | UX (result layer), coach (primary insight) |
| 13 | Exact-ball retry | face the identical ball again at once | coach loop, physics (repeat), stage |
| 14 | Improvement | see measurable improvement, honestly compared | coach (comparison, mastery), physics |
| 15 | Another over | want to play again, with no reward driving it | everything above |

The two paths of the dual rubric:

- **Rookie:** launch → Practice → minimal setup → one demonstration → a readable ball → one understandable action → a
  clear outcome → why → retry the exact ball → improve → complete the over → another over.
- **Expert:** launch → Practice → skip the teaching → choose or build an over → read the bowler, seam, line, length and
  field → deliberate footwork, timing, direction, elevation and power → a credible outcome → exact evidence → retry →
  mastery → a harder over.

### The first-ball lesson (2026-11-08; owner brief, Stage 1)

Before the very first ball a player ever faces, and only then, a card (`src/practice/ui/lesson`) teaches the control in
use: a ghost finger, pointer, pen, key press or pair of hands doing the move in a loop that waits. It is pre-delivery
pacing and presentation only: the ball is not bowled while the card is open, and the delivery, its physics and its result
are the same with or without it (`tests/e2e/lesson-first-ball.spec.ts`, same seed and swing, same flight and result).

- **The move** is the one the game reads (docs/PRACTICE_INPUT.md): pull down, hold, flick up; the start of the flick sets
  direction, power and loft (three short words on the picture). The drawn stroke is replayed through the real tracker
  and normalizer in a unit test on five screen sizes and both hands (a firm, grounded drive 12° to the off side).
- **The player may try it** on the real batting area: a dry swing, read by the same tracker and normalizer, said back as
  "You played: ...", nothing bowled. A tap, a pull-back let go, or Space gets one plain line and costs nothing. Doing
  nothing changes nothing: no timer, no penalty; the ghost goes on. Ball 1 starts when the player presses "Bowl the first
  ball". "Skip all teaching" ends it for good. The card follows the input actually used (a moving mouse, a pen, a key, a
  finger) and starts on the control chosen for the device.
- **After the ball**, for the first over (six balls) with teaching on, the dead-ball card says the timing in plain words
  in proportion to the error: the size is the measured error inside the bands the delivery was judged by (on time, a
  touch, early or late, much too early or late: the same comparison as the physics' `classifyTiming`, so it only grows
  with the error), the side is the sign of the error, with the coach's number and the bands drawn as a scale. It appears
  with the dead-ball card (after the outcome is shown) and stays as long as the card does; early and late differ in
  words and in which side of the scale the marker sits, never by colour alone. There is no cue during the run-up or the
  flight (Delivery Quiet Mode). A press before the bowler released is said once on that dead ball ("Too soon ... try
  again"): it was not a shot, the ball is bowled and scored exactly as with no input, and "Practice this ball" retries the
  identical ball without touching the score.
- **Reduced Motion** draws the move as a still with numbered points; screen readers get the lesson as text. The card is
  a lazy chunk, absent from the initial transfer. Whether new players understand the first ball is UNPROVEN until
  observed (`release/player-experience/shared/playtest/`).

## 2. System-to-perception dependency map

| Perception | Breaks when… | Owner (files) | Criteria | Evidence so far |
| --- | --- | --- | --- | --- |
| "I can see the ball" | It is under 3 px or below 3:1 contrast; the camera is too wide | presentation (`render3d/core/camera.ts`, `render3d/three/ball.ts`) | READ1–READ3, EMB1 | QA E-RK-047…061 (READ2 fails everywhere); E-PX-006 (horizontal FOV 97°) |
| "My swipe meant that shot" | The gesture read differs from intent | input (`src/input/normalize.ts`, `tracker.ts`) | RK3, EX1, CTL2, CTL4, CTL9 | E-PX-001, E-PX-002 (F-002, F-003) |
| "The bat moved when I touched" | Input-to-bat latency; the bat looks like a prop | input, presentation (`practice/bat.ts`) | CTL1, EMB2, EMB3 | Not yet measured on the tree (needs the stats hook) |
| "That was fair" | A fixed shot farms runs; hidden assistance | physics (`src/physics/**`), coach | FAIR6, EX7, SYS1, CTL8 | E-PX-003 (F-001, F-004, F-005); expert E-EXP-001/002/005 |
| "I heard and felt the hit" | Feel timing or signature wrong | presentation (`practice/feedback.ts`), audio (`src/audio/**`) | COH6, FBK1 | E-PX-005: timing passes; the block plays the sweet feel (F-022) |
| "The crowd reacted to what happened" | Look-ahead; disproportion | audio (`src/audio/emotion.ts`), presentation (crowd) | COH9, FBK3 | E-PX-005 (F-007 on 38924bd); audio reports a new machine |
| "The score is right, and on time" | Score before the outcome | UX (board), physics | FAIR4, COH8 | E-PX-005: passes on 38924bd |
| "I'm a batter, not a floating camera" | No hands or gloves; a primitive bat; a fish-eye view | presentation (art helper) | EMB1–EMB5, ART3 | E-PX-006 (EMB1 fails); E-PX-007 screenshots (a block bat with a blue cylinder grip, no hands) |
| "I know why" | The coach contradicts the facts or the summary | coach, UX | FAIR3, COACH1, F6 | E-PX-007 (the leave called "weakest"; gap advice with no field shown) |
| "Retrying helps" | The retry is not identical; the advice loses to a fixed swipe | coach, physics | COACH2, COACH4 | QA E-RK-046 (identical retry, one tap); E-PX-003 (coach 0.45× a fixed swipe on v1) |
| "I want another over" | Frustration, confusion, a flat climax | all | RK6, EX11, the H gate | Human-only (pending) |

## 3. Current integrated findings

The Release Director's ledger (`release/player-experience/shared/technical/FINDINGS.md`) is authoritative for status.
These are the findings this assessment raised or depends on most.

| Ledger | Sev | Finding (the player's view) | Evidence |
| --- | --- | --- | --- |
| F-002 | Critical | An ordinary phone swipe is heard as a lofted, near-full-power shot. Ground needs a sub-40 ms flick. A 70 ms rest before a swipe turns it into a block. The keyboard cannot attack | E-PX-001, E-PX-002 |
| F-003 | High | The same finger motion reads differently at a different event cadence | E-PX-002 |
| F-001 / F-004 | Critical | One fixed swipe farms runs: lofted straight 4.3–4.5 runs per ball with 56–61% sixes; grounded cover about 75% fours | E-PX-003 |
| F-005 / F-021 | High | The coach's recommended play earns about 0.45× the runs of the dumb swipe (v1) | E-PX-003 |
| F-007 | High | The crowd ramps to near maximum for any big hit, a routine four included, before the rope; a caught ball is cheered as a boundary until the catch | E-PX-005 |
| F-022 | High | A perfectly timed defensive block plays the sweet-spot crack and the heavy double haptic, like a six | E-PX-005 |
| (new, sent to the lead) | High | The batter-eye horizontal FOV is 97° on phones and 84° on 16:9 (EMB1 allows 55–75°). It is a likely root cause of the 2 px ball (READ2) | E-PX-006 |
| F-023 | Critical (to recheck) | The integrated snapshot t2 stops at `ready` and bowls nothing | E-PX-004 |
| (baseline only) | Medium | First session on 38924bd: "Now aim your flick towards a gap" while no field is shown; a "Well left" ball named the weakest delivery; a tier step-down changed the timing tolerance in the middle of the over | E-PX-007 |

## 4. Finding owner and status

| Finding | Owner | Status (2026-10-26 04:15Z) | Retest I will run |
| --- | --- | --- | --- |
| F-002, F-003 | Input agent (`src/input/**`) | Open. Design decided by the lead: a swipe is ground, loft is distinct, power continuous, the keyboard attacks | E-PX-001 matrix plus a jittered novice corpus (≥ 300 gestures, RK3), an 8-class expert corpus (EX1), and real touch at two cadences (E-PX-002) |
| F-001, F-004 | Physics | Open. v2 is held until FAIR6, EX5, EX6 and EX7 pass in physics' own runs | E-PX-003 on v2, plus a FAIR6 run of 100 Club overs |
| F-005, F-021 | Coach (after physics) | Open | E-PX-003 "reader" against the fixed inputs |
| F-007 | Audio, presentation | Audio reports its emotion machine in place: six 0.92 > four 0.74 > single 0.45 > dot 0.33, expectation ≤ about 0.6 before the rope | The coherence probe on the tree, through `window.__vandeAudio.log()` |
| F-022 | Presentation (`contactFeel`), audio | Audio has a "block" feel and a tap haptic; presentation must emit it | The coherence probe: a defend gives 'block' |
| FOV (EMB1) | Presentation | Sent | E-PX-006 on the tree at 5 viewports and both hands |
| F-023 | UX | Open until the checkpoint | session-v2 on the checkpoint |

## 5. Perceived-control assessment

**The physics is not the weak link; the read of the player's finger is.**

- On 38924bd (`src/input` is unchanged in the tree), the input layer turns natural phone swipes into the strongest
  shot in the game:
  - an 80–200 px swipe over 90–120 ms reads elevation 0.94–1.0 and power 0.8–1.0;
  - even a gentle 30 px push is lofted;
  - power is effectively binary: a tap is 0.2, almost any swipe 0.8–1.0;
  - a grounded drive needs an unnatural flick lifted within 40 ms, or a flick-and-hold.
- Nothing on screen says what the game heard. The result never names "lofted" or "full power". So when a ball the
  player meant to push along the ground goes into the air, they have no way to learn why.
- Direction itself follows the gesture well: 45° gave an exit of 43.8°, and −50° gave −55.3°.
- A finger that rests about 70 ms before swiping produces a block. "I swiped and it blocked" is exactly the
  inexplicable outcome this role must flag.
- Desktop and accessibility:
  - The keyboard can defend but never attack, so a keyboard-only player cannot score off their own intent.
  - Calibration is one offset for every modality. A touch calibration shifts mouse and keyboard swings early by the
    latency difference.

**Verdict:** input does not yet feel direct and fair in its consequences, although the bat responds quickly. F-002
is Critical under R7, and caps this dimension at 8.5 until it is closed and retested.

## 6. Fairness assessment

- **Determinism holds:**
  - FAIR1 and FAIR2 pass in Node and desktop Chromium (expert E-EXP-004);
  - the exact retry is identical (QA E-RK-046);
  - the score changes only after the physical outcome: 1.7–5.7 ms after the rope or catch (E-PX-005).
- **Fairness of the cricket does not hold yet:**
  - A fixed lofted straight swipe made 4.3–4.5 runs per ball, with 56–61% sixes, at σ 15 ms in every assistance
    level (E-PX-003, v1).
  - The coach's recommended play made 1.8–2.0, so a player who listens to the coach is punished relative to one who
    swipes the same way at everything.
  - This is the opposite of the North Star's rule that "a player repeating the same swipe against every delivery must
    fail".
  - FAIR6 and EX7 fail, and SYS1 fails on both trees (expert E-EXP-005, F-019: undeclared line-read assistance).
- **The forgiveness policy is now binding:** Real has none on any tier; Learn and Play are declared and latched per
  over. On 38924bd I saw the tier step down in the middle of an over with a notice, which changed the tolerance for
  the remaining balls (E-PX-007). The latch fixes that in the tree (QA E-RK-046 reports it latched and recorded).

**Verdict:** the outcomes are honest physics, but the physics plus the input currently reward one dumb gesture. That
breaks fairness as players experience it. It is to be retested on v2 together with F-002.

## 7. Embodiment assessment

Measured through the live camera on 38924bd (E-PX-006):

- **Right:**
  - eye 1.68 m, 2 cm behind the popping crease;
  - no head translation, no roll;
  - correct mirroring for a left-hander;
  - a causal gaze that follows the ball (−13° → −33° pitch during the delivery; −13° → −20° with reduced motion).
- **Wrong:** the horizontal field of view is 97° on a 915×412 phone and 84° on 16:9 (EMB1 allows 55–75°).
  - The far end therefore looks small and distant: QA measured the bowler at about 25×43 px and the ball at 1.9–2.2 px
    at release.
  - It reads as a fish-eye camera rather than a batter's eyes.
  - A 75° cap would enlarge every distant object 1.48×.
- **The body (screenshots in E-PX-007):** the first-person "body" is a block-shaped bat with a blue cylinder grip in
  the lower-right corner, with no hands, gloves or arms. At contact the head-follow camera pitches down onto the bare
  pitch surface, which is disorienting (`shots/06-ball1-after-input.png`).

**Verdict:** a camera controlling a floating bat, not yet a batter. EMB1 fails, and EMB2 (gloves, hands, grip) is not
met in the baseline art. The tree's art changes are unassessed until the checkpoint.

## 8. Difficulty and frustration assessment

From E-PX-003 (v1 physics; strategy simulations, which are not players):

- **Too easy for the wrong reason.**
  - A novice-like timing spread (σ 50 ms) with the default lofted swipe still made 3.9 runs per ball on Learn and
    2.6 on Real.
  - Dismissals came at 0.12 per ball on Learn and 0.27 on Real. With one wicket ending the innings, that is about a
    47% (Learn) and 15% (Real) chance of surviving the first over.
  - So the experience swings between "everything goes for six" and "out in the first over". This is unconfirmed until
    v2 and F-002 land.
- **Help between balls.** Help is offered between balls by design: assistance stages, the demonstration, Coach Mode.
  Nothing I observed changes during a ball. The only change between balls on 38924bd was the tier step-down
  (E-PX-007), now latched per over.
- **Trapped in a difficulty.** That cannot be judged until Random Over's difficulty choice works. Expert E-EXP-003
  found Expert identical to Club (F-013).

## 9. Emotional-coherence assessment

E-PX-005 (38924bd, recording sink):

- **The timing of reactions is excellent:**
  - the contact sound and haptic come 0.3–1.4 ms from the physics contact;
  - the boundary or six cue 0.1–1.9 ms after the rope;
  - the score 1.7–5.7 ms after the rope or catch.
- **The proportions are not:**
  - The crowd ramps after every attacking contact to 0.96 for a six and for a routine four alike, reaching 0.9 or more
    0.5–0.8 s before the rope.
  - A ball that is then caught is cheered to 0.92 until the catch.
  - A solid defensive block gets the sweet-spot crack and the heavy double haptic. The emotional grammar flattens:
    every middled ball "feels" like a six.
  - This is the "World Cup final after every boundary" the role warns against.
- **The tree:** Audio reports a new emotion machine (six 0.92 > four 0.74 > single 0.45 > dot 0.33, no look-ahead,
  wicket silence within 150 ms) and a distinct block feel. Both are unverified until the checkpoint run, which reads
  `window.__vandeAudio.log()`.

## 10. Exact-ball learning assessment

- **What works:**
  - On 38924bd+ed57266747c6, QA found the exact retry one tap from the result, identical in flight and result, with
    the comparison reading "same" (E-RK-046).
- **What fails, cross-system:**
  - The coach's recommendation was worth less than half a fixed swipe on v1 (F-005, F-021). Until v2 and the
    robustness rule land, "improving" by following the coach can lower the player's score. That teaches the wrong
    lesson.
- **Not yet assessed on the tree:**
  - assistance stages 1–4 and their visual step-down;
  - the demonstration (F-009: it draws the plain scene);
  - mastery that requires repetition.

## 11. Device and input findings

| Area | Finding | Evidence |
| --- | --- | --- |
| Touch | The gesture read (F-002) and its cadence dependence (F-003) | E-PX-001, E-PX-002 |
| Mouse | The same read on a 1280×720 surface (shorter side 331 px) gives lower power for the same pixels: 0.44–0.55 for the swipes that read 0.8–0.97 on a phone. Mouse and phone players get different power for the same motion | E-PX-001 (desktop rows) |
| Keyboard | Defence only; no attack | Code path: `src/input/tracker.ts` key() → emitKeyboard → readGesture → tap; E-PX-001 note |
| Trackpad, pen | Untested (they need a human run) | — |
| Calibration | One offset for every modality | `src/practice/store/calibration.ts`; flow `delivery.ts` |
| Hands | The camera and eye mirror correctly | E-PX-006 |
| Tiers | On 38924bd a mid-over step-down changed the tolerance; perf reports 5 shader links during a delivery after Standard → Lite on the emulator (F-017), and a 22 fps first ball of a new innings (F-018) | E-PX-007; perf's emulator runs |
| Small or large screens | The field of view is wider on wide screens (97°), so a large phone sees a smaller ball than a 16:9 desktop | E-PX-006 |
| Reduced motion | The gaze excursion falls from 20° to 7°; there is still no translation and no roll | E-PX-006 |
| Audio and haptics off | Not yet tested on the tree | — |

## 12. Human-playtest protocol

The Stage 1 package is `release/player-experience/shared/playtest/` (prepared, not run). It contains:

- the protocol and screeners (pilot 3 + 3; formal at least 10 rookies, of whom at least 5 are fans who are not gamers
  and at least 5 general gamers, and at least 10 experts);
- the Indian Android phone rule (at least 3 budget phones), with at least 2 left-handers;
- consent and anonymization;
- the rookie and expert scripts, with no coaching in the first session, mapped to gates 1–11 and 1–12;
- the observation sheet;
- the questionnaires: a one-tap schedule by over, plus Q1–Q16 with exact wording;
- the participant record (DUAL §7);
- randomization, with a reproducible script;
- the analysis plan, which computes every threshold before any data exists;
- the tester-mode fields agreed with UX;
- a competitor-comparison placeholder for the analyst's protocol.

"Started another over voluntarily" is observed by the app (`next_over_voluntary`), never asked.

## 13. Evidence collected

The cross-system evidence is in `release/player-experience/px/EVIDENCE.md`:

- E-PX-001 (gesture read);
- E-PX-002 (live touch);
- E-PX-003 (fixed input against the coach);
- E-PX-004 (t2 not scoreable);
- E-PX-005 (coherence timing, feel, crowd);
- E-PX-006 (the camera);
- E-PX-007 (the first session).

Tools are in `px/tools/`, and the first-session captures in `release/player-experience/2026-10-25-head-baseline/`.

Cited from the other evaluators:

- QA, Rookie Examiner (`rookie/EVIDENCE.md`):
  - E-RK-047…061 (READ2 fails on every viewport and tier);
  - E-RK-002…036 (corridor and info-rail measurements);
  - E-RK-045/046 (exact retry);
  - E-RK-062…064 (asset register and placeholders).
- Expert Examiner (`expert/EVIDENCE.md`):
  - E-EXP-001/002 (EX7, FAIR6);
  - E-EXP-003 (difficulty);
  - E-EXP-004 (determinism);
  - E-EXP-005 (forgiveness, SYS1);
  - E-EXP-006 (version bump).
- Performance: the HEAD Metal matrix and the emulator runs, engineering evidence only, never phone.

## 14. Current score by dimension

Ceiling rubric §6.1, Player experience (target 9.5; the Stage 1 gate is 9.2):

| Build | Score | Label | Why |
| --- | --- | --- | --- |
| 38924bd (baseline) | **2.1 / 10** (`release/player-experience/px/SCORE-38924bd.md`); capped at 8.5 by R7 in any case | NOT PROVEN | Open Critical findings in control and scoring (F-001, F-002, F-004) and readability (F-012). ★ criteria fail: READ2, CTL2, FAIR6 (via CTL). Most criteria are not yet measured, and those score 0 under R1 |
| Integrated tree | Not scoreable (R11) | — | It does not bowl (F-023). Scoring starts on the lead's Stage 0 checkpoint build |

The cross-persona checks (dual rubric) are not yet assessable on the integrated tree:

- **X1** (the expert skips teaching in one tap);
- **X2** (the rookie is not shown the full control system early);
- **X3** (every fix retested on the other cohort).

On 38924bd, the guided first session gives an expert no skip before the warm-up ball: the warm-up and the guided over
are forced on first run, which would fail X1. That flow is being replaced.

## 15. Validated versus unvalidated claims

| Claim | Label | Basis |
| --- | --- | --- |
| Contact sound and haptic land within 20 ms of the physics contact (38924bd) | PROVISIONAL (engineering, one configuration) | E-PX-005 |
| The score changes only after the physical outcome (38924bd) | PROVISIONAL (engineering) | E-PX-005; FAIR4 |
| Results are deterministic and the retry is exact | PROVISIONAL (engineering; Android pending) | E-EXP-004, E-RK-046 |
| Input expresses the player's intent | NOT PROVEN (fails) | E-PX-001, E-PX-002 |
| Outcomes are fair, with no dominant shot | NOT PROVEN (fails on v1) | E-PX-003, E-EXP-001/002 |
| The ball is readable | NOT PROVEN (fails) | E-RK-047…061, E-PX-006 |
| The player feels like a batter | NOT PROVEN (EMB1 fails; EMB2 not met) | E-PX-006, E-PX-007 |
| Emotion is proportional | NOT PROVEN (fails on 38924bd; the tree is untested) | E-PX-005 |
| Failure teaches; retry improves | NOT PROVEN (the coach underperforms a fixed swipe on v1) | E-PX-003 |
| Players want another over | NOT PROVEN (human-only; no sessions) | — |
| Any human-rated measure | NOT PROVEN (no participants) | — |

## 16. Remaining blockers

1. A Stage 0 checkpoint build that typechecks, bowls and completes an over (F-023, F-010).
2. F-002: the input read (Critical). A rookie cannot control ground or air, and cannot defend reliably with a resting
   finger.
3. F-001, F-004, F-005, F-021: physics v2 and coach robustness. No dominant shot, and the coach's play must beat every
   fixed input by at least 2×.
4. F-012 together with the EMB1 FOV: a readable ball on every tier, preferably by an honest field of view first.
5. F-007 and F-022: proportional emotion and distinct contact signatures, verified on the tree.
6. EMB2 and EMB3: visible gloves, hands and a credible bat, plus swing and footwork that follow input.
7. Human evidence: every H gate is pending until the Stage 1 study runs on Indian Android phones.
8. Physical-device evidence: CTL1 touch latency and PERF D gates on a phone.

### What 9.5 needs, exactly

- **Engineering:**
  - every ★ criterion of CTL, COH, READ and PERF at ≥ 9 on the checkpoint build across the §3 matrix;
  - no open Critical or High finding;
  - FAIR6 and EX7 passing on v2 with the new input read;
  - READ2 at ≥ 3 px and ≥ 3:1 on every tier;
  - CTL1 p95 ≤ 50 ms by the rulings' method, then on a phone with a high-speed camera.
- **Human:**
  - the formal Stage 1 study (at least 10 + 10 on Indian Android phones) meeting every §6.1 H gate, including:
    - at least 90% feeling in control and understanding their input;
    - at least 85% calling outcomes fair;
    - at least 55% starting another over unprompted;
    - at least 80% improving within five attempts;
    - experts' fidelity ratings of at least 9.
  - No participant reports a scripted outcome or a hidden ball.
