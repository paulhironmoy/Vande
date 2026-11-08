# Target Chase: the screens and the flow (Practice UI)

Owner: the Chase UI workstream (`src/practice/ui/chase/**`, `tests/unit/practice/ui/chase/**`, `tests/e2e/chase-*.spec.ts`).
The rules, the target table and the seeds are `docs/PRACTICE_CHASE.md` (`src/practice/chase`); this page is only what the
player sees and how the Practice flow carries it. Decisions made for the owner are `UI-01` to `UI-14` in the program's
decision log; the evidence is `release/product-sequence/stage-3-chase/CHASE-UI/`.

## The journey

1. **Practice home.** Random Over (the one dominant action), Predefined Over, **Chase** (`practice-chase`): a quiet third
   choice with COPY's one line ("Reach a target in 12 balls. One wicket."). A chase left half way shows as a resume card
   ("Chase in progress", "Need X off Y balls", Continue); starting anything else from there asks first and drops it.
2. **Briefing** (the setup screen, `data-testid="practice-setup"`): the target, "Need X off 12 balls", the rules, that the
   target never changes, and why there is no retry (`practice-chase-brief*`). The Random Over's choices are not offered:
   the seed sets the two overs. Assistance can still be chosen here, before ball 1 only, as in Practice.
3. **Play.** The rail's left cluster keeps the score and the over's six ball marks and adds **Need X off Y balls** with
   the rate it asks for (`practice-chase-need*`). There is no second mode label while the chase is on (the line says it;
   "Chase" shows after it ends). The numbers change when the stage has shown the ball. They are drawn like the rest of the
   rail: not drawn from release to the dead ball; in Delivery Quiet Mode dimmed and reduced to one short line ("15 off 12",
   the rate hidden), so the rail stays under 8% of the screen at 640x360. They carry no colour for pressure and no motion.
   After ball 6 the card's action is "Next over" and the second over (its bowler and field, from the seed) starts with no
   summary and no setup between; the flow sets it on the stage first, as Play does for any over (`setSceneFor`).
4. **Dead-ball card.** The usual outcome and tip. There is **no "Practice this ball"**; a caption says so
   (`practice-chase-no-practice`). The pause offers Resume and Leave, never "Restart over". The deciding ball's action is
   "See result". The coach speaks about THIS ball only: the green-tick confirmation of a repeated response reads "that was
   the coach's choice for this ball" and the first alternative shot is tagged "Coach's pick for this ball" (R-44 item 5:
   the coach's choice played on every ball almost never wins a chase, so nothing may read as the way to win;
   `chase/scope.ts`, `Alternatives chase`). The card's words then differ from the tip's own sentence, in a chase only.
5. **The deciding ball, then the result.** "See result" replays the deciding ball in slow motion (the same result the live
   ball had; diagnostics on for a loss, off for a win), holds the last frame 0.7 s and opens the win or loss screen
   (`practice-chase-result`): the title, the score and the target, for a win the balls to spare, for a loss ONE sentence on
   what decided it, the twelve balls as marks, **Try this chase again** (primary), **Back to Practice** (secondary) and one
   quiet disclosure "Deciding ball" (watch it again; practise it: practice only, back to this screen).
6. **Try this chase again** is the same seed, target and balls, straight to ball 1 (no briefing). A new Chase from the home
   draws another seed.

## State

`FlowState.chase: ChaseFlow | null` (`flow/state.ts`): `state` (CHASE-CORE's `ChaseState`, **as shown**: it changes in the
same update as the board, at the dead ball), `previous` (the last finished result of this seed on this device, for "last
try"), `summary` (set when decided). The innings stays the one saved truth; the shown chase is
`chaseFromInnings(definition, innings)` read at the dead ball. `FlowScreen` has one new value, `'chase_result'`.
`ChaseDriver` (`chase/driver.ts`, `flow.chase`) holds the chase-specific sequencing and works through the flow's public
methods; the flow has hook calls at `init`, `prepareOver`, `play`, `bowlNext` (context, the shown chase), `nextBall`,
`restartOver` (refused), `handleDeadBallAction` (practice refused), `continueInnings`, `leave`, `discardInnings`,
`closeFinished`, `persist` (a chase saves under its own key).

## The one sentence of a loss

`chase/attribution.ts` + `chase/words.ts`. A wicket: "Out: <how>. <the coach's reason line>[, <measured ms early or late>]."
Balls ran out: the group of the physics' own closed reasons that at least two dot balls share (timing, the bowler beat the
bat, line, fielder, defence), else the plain count of dot balls, nothing when every ball scored. Never a blame word, never an
inferred cause, the same record gives the same sentence. COPY's `why.hard` is not used: the reference batter's rate is never
shown to a player.

## Storage (this device only, nothing is sent)

`vc:practice:chase` (the chase being batted: its definition and innings, resumed like the innings: a ball in flight when the
app went away is a leave) and `vc:practice:chase-history` (the last result for each seed and difficulty, 32 at most, no
ranking). "Delete local data" clears both.

## Stage and bridge hooks

`PracticeStageLike.presentChaseMoment(moment)` (once, at the deciding dead ball), `replay(result, { chaseMoment })` (the
deciding ball's replay), `StageScene.chase` and the resolution's `chase` block for Unity (`chase/unity.ts`).

## Test builds

`window.__vandePractice.startChase(seed?, { direct? })`, `chaseLog()` (an entry whenever the screen, phase, balls committed or
balls shown change: the order the shown chase follows the innings), `state().chase`, and the config key `chaseSeed`.
Fixed swing lists for the e2e: `tests/e2e/chase-paths.ts` (method: the CHASE-UI evidence folder, `PATHS.md`).
Run the unit tests: `npx vitest run tests/unit/practice/ui/chase`; the journeys: `npx playwright test --project=practice
tests/e2e/chase-flow.spec.ts` (own port and dist: `E2E_PRACTICE_PORT`, `E2E_PRACTICE_DIST`, `E2E_OUT`).

## Not done here

No camera or lesson work, no new analytics event (contracts are closed), no per-chase audio (COPY's crowd reacts at the
confirmed outcome inside `src/audio`), no leaderboard, streak, share card, reward or count of any kind.
