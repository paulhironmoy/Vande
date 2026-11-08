# VANDE: get the shot right (the Practice wedge implementation prompt, v2)

**v2 (2026-11-02), owner decisions:**
- The complaints study's findings are folded in (§2, §5 rules 10–13, §7.6, WA13, WA14).
- Claude is the lead and runs this prompt with Claude agents (§0).
- Unity contract v6 everywhere: TypeScript, C# and the Android validator (§0).

You are working in the VANDE repository, `/Users/hironmoy/Vande/Vande`, branch `cricket-rebuild`.

**Your job:** make VANDE the cricket game where a player gets one shot truly right, through practising the exact same
ball again and coaching tips that provably work. It must happen in a world that looks, moves and sounds like real
cricket. Start with the cover drive.

Success is shown in the running game, with evidence. Code volume, feature count and agent opinion do not count.

## 0. How to use this prompt

- **Authority.** These outrank this prompt, in this order. If this prompt conflicts with them, they win. Report the
  conflict to the lead; don't work around it.
  1. `AGENTS.md`;
  2. `docs/VANDE-PRODUCT-SEQUENCE.md` (Stage 1, Practice quality, is active; Stages 2–6 are closed);
  3. `docs/VANDE-EXPERIENCE-CONSTITUTION.md`;
  4. `docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md`;
  5. `docs/ANDROID_SIZE_AND_REACH.md`;
  6. `docs/ARCHITECTURE.md` (exclusive file ownership);
  7. the locked rubrics in `release/player-experience/` and `release/competitive-experience/`. Never edit them.
- **Where this prompt sits.** It is a feature brief. It sets the goal, the order of work and the wedge's acceptance
  checks (§9). It narrows the focus of two existing briefs and relaxes nothing in either:
  - `docs/prompts/VANDE-STAGE-1-WOW-EVIDENCE-MASTER-PROMPT.md` covers the whole Stage 1 product and its evidence
    system.
  - `docs/prompts/VANDE-COVER-DRIVE-PROMPT.md` is the detailed spec for Track B (the batter), amended in §6.

  If two briefs conflict, stop and ask the lead. Don't choose one yourself.
- **Facts.** §3 is a snapshot taken on 2026-11-01. Verify each fact before relying on it, and report any that have
  changed.
- **Who runs it.** Claude is the lead. Claude agents run the tracks, one agent per track, with exclusive files
  (§8.2). Independent Claude evaluator agents, never the builders, run Track E.
- **Work in flight.** Codex is changing Unity contract v6 and simulation v3 in `src/physics/**`,
  `src/contracts/**`, `src/practice/unity/**`, `src/practice/ui/flow/**`, `src/i18n/practice/*/play.ts`, the Unity
  bridge and runtime, and its tests.
  - Wedge tracks never edit those files.
  - Request any change to them through the lead, with the evidence for why it is needed.
  - Before editing any file, check that nobody else changed it in the last 30 minutes. If someone did, don't edit
    it; report it to the lead.
- **Contract v6 everywhere.** TypeScript, C# and the Android validator all accept contract 6 only. v6 adds
  `host.demonstration` and `host.demonstration_cancel`, which are host-to-Unity and delivery-scoped. The Android
  validator was moved to v6 on 2026-11-02; its instrumented test still needs a device or emulator run.
- **Labels.**
  - Anything that needs real players or physical phones stays PROVISIONAL or UNPROVEN until that evidence exists.
  - Never estimate a human, device, size or reach result.
  - Builders never certify their own work.

## 1. The wedge (owner, 2026-11-01)

**The owner's words, typos corrected:**

> Practice only. Get the shot right, by re-practice and coaching tips that actually work. Not another scripted
> nonsense game. No game has achieved this.

**The four pillars:**
1. Practice and coaching to perfection.
2. A realistic field view.
3. Realistic human players.
4. Truly real cricket artifacts: bat, ball, gear, stumps, pitch and ground. Sound is part of this pillar.

All of it is free-only (§6.4). None of it may reduce ball readability or break the Android gates.

**The player's promise:**

> I read the ball, chose the shot, timed it and earned it. When I didn't, I knew exactly why, and I fixed it on the
> same ball.

## 2. Why this wins

**The evidence so far.** The samples are small and not random, so treat them as indicative. Each comes from
`release/competitive-experience/competitors/*.md` §11.
- **Real Cricket:**
  - Reviewers write "This game feels completely scripted." (E-CB-RC-080, -081).
  - High-rated batters are out "even when I play with good timing and proper shot direction" (E-CB-RC-093).
- **Cricket League:** fairness doubts (bots, rigging, inconsistent outcomes) appear in 5 of the 12 reviews shown on
  its listing pages.
- **WCC3:** ad complaints dominate its inline reviews (E-CB-WCC-020 to -024).
- **The complaints study** (`release/competitive-experience/complaints-study/REPORT.md`): 378 primary reviews of the
  three top Android cricket games, plus 114 from a flagship.
  - Most top complaints (bugs, money, ads, cheating, connection) cannot happen in VANDE's offline, ad-free Practice.
  - What does apply is cricket that does not follow from what the player did. Outcome realism is the top realism
    concern (19.3% of reviews); look and sound are minor (5.3%).
  - Its five patterns: the result did not follow from my input; the computer gets a better deal; cricket's events
    are wrong or missing (no edges, no run-outs, impossible catches); fielders do not look like they are trying; the
    ball does not look like the speed it claims.
  - These are now anti-fake rules 10–13 (§5) and Track F (§7.6).

**Two kinds of realism matter:**
1. **Cause and effect.** The result must visibly follow from what the player did.
   - The top games can't fix this without a rebuild.
   - VANDE already has it in the physics. The wedge's job is to make players feel it and believe it.
2. **Look and sound.** It must look, move and sound like cricket on TV. This is VANDE's weakest area today.

**Fantasy first, then mastery.** The first ball must feel like cricket, including the crack of the bat and the ball
racing away, before any coaching registers. Mastery is the reason to stay. A Practice-only game that teaches but
doesn't thrill will not be replayed.

## 3. What exists today (verify each item)

| Piece | Where | State on 2026-11-01 |
| --- | --- | --- |
| **One-gesture input:** press, pull back, push forward; timing is taken from the forward onset; a quick lift is a defence and no reversal is a leave | `src/input/**`, `docs/PRACTICE_INPUT.md` | Built |
| **Authoritative physics:** 16 shot families; cover drive is front foot at 35–75°; real-mode timing bands 25/55/80 ms | `src/physics/**` | Built; simulation v3 in progress (Codex) |
| **Exact-ball retry:** `repeatDelivery`, `verifyRecord` | `src/practice/game/replay.ts` | Built |
| **Coach engine:** candidate responses, each simulated against the exact delivery over an execution spread (timing σ 20 ms plus aim error); recommendations include `well_played`; demonstrations | `src/practice/coach/**`, `docs/PRACTICE_COACH.md` | Built |
| **Mastery:** assistance stages 1–4 (stage 1 has a full trajectory and ghost movement, stage 4 has none); mastering a ball needs at least 9 attempts; form is a report only | `src/practice/coach/**`, `docs/PRACTICE_COACH.md` "Mastery" | Built |
| **Retry comparison:** better, worse or same, from recorded deltas | `docs/PRACTICE_COACH.md` | Built |
| **Reference over:** ref-1 full outswinger, ref-2 inswinger, ref-3 hard length, ref-4 cutter, ref-5 bouncer, ref-6 yorker | `src/practice/game/reference.ts` | Built |
| **Unity live camera:** a stable rear-shoulder batter view | Decision log, 2026-10-28; `docs/ARCHITECTURE.md` | Owner decision |
| **Batter:** MakeHuman CC0 hero with a 75-bone rig and a code-sampled `BatterStroke` | Unity project; `scripts/export-unity-production-*.mjs` | Works, but looks robotic |
| **Sound:** every sound is synthesised in code | `docs/AUDIO.md`; `docs/UNITY_ASSET_AUDIO_READINESS.md` §1 | Not authentic. No recorded transient exists |
| **World:** procedural pitch, stadium, players and props | `src/render3d/**` | Development quality |
| **Cover-drive motion reference:** 14 CC BY-SA Wikimedia Commons club drives, measured for timing, with angles from the literature | `release/cover-drive/reference/COVER-DRIVE-SPEC.md`, `REPORT.md` | Reference only, never shipped |
| **Android** | `release/*.apk`; `docs/ANDROID_SIZE_AND_REACH.md` | Installed size and India reach UNPROVEN; emulator evidence only |
| **Real players and physical phones** | `release/player-experience/shared/playtest/` | The package exists; it has never been run |

## 4. The loop

Every ball runs this loop. Perfect it for the cover drive first. Change no screen inventory: the loop lives inside
the existing Stage 1 launch flow (Practice → Predefined Over or Random Over).

| # | Step | What the player sees and hears | Binding rule | Rubric |
| --- | --- | --- | --- | --- |
| 1 | **Read** | Run-up, release, flight, seam, bounce | Nothing in the corridor. Same readability on every tier. | READ1–READ3 |
| 2 | **Play** | One gesture; the batter responds instantly | Any assistance is visible, fixed before release and recorded. Real mode has none. | CTL1, SYS1, CTL8 |
| 3 | **Consequence** | Contact, ball path, fielders, score | Physics alone decides. The animation follows the trace. Sound and haptic come within 20 ms of contact, never on a miss. The crowd reacts only after the ball arrives. | COH1–COH7, COH6, SYS2 |
| 4 | **Why** | One sentence with measured facts and one next action, e.g. "31 ms late, so the face opened: outside edge." | One primary reason, taken from recorded facts. | COACH1, RK4, F6, FAIR3 |
| 5 | **The right response, on the same ball** | A demonstration of the recommended response on the identical delivery, played by the same renderer and batter | The recommendation succeeds in physics across the execution spread. | COACH2, COACH3 |
| 6 | **Retry** | One tap from the result to the identical ball | The delivery is bit-identical. Only the player's new input can improve the result. | RK5, FAIR2, COACH4 |
| 7 | **Measured improvement** | "Better: 24 ms closer, middled, 4 runs" | The verdict comes from recorded deltas. The mastery confirmation plays only for a "better" verdict, at a proportional level. | COACH5, constitution "Proportional feedback" |
| 8 | **Mastery as a report** | Assistance stage, successes still needed, mastered | No XP and no buffs. Mastery comes only from recorded attempts. | COACH6, COACH7 |

**Not in Stage 1.** These are Stage 2 and go to the not-now register:
- automatic progression to harder balls;
- coach goals;
- personal bests;
- streaks of any kind.

## 5. Anti-fake rules (hard, in every track)

These are what players call fake in other games, turned into prohibitions. Each must be tested.

1. **No outcome steering.** No adaptive difficulty or rubber-banding, no rating- or stat-based outcomes, no
   guaranteed boundaries, and no difficulty change during a ball (SYS1, SYS2, FAIR5).
2. **No hidden help.** No shot magnetism, auto-timing or invisible assistance (constitution law 4).
3. **Same input, same result.** Identical on every run and every renderer (FAIR1, FAIR2, and the renderer goldens).
4. **Every dismissal is explainable** from the recorded facts, in one sentence (F6, RK4).
5. **No canned outcome animation.**
   - The stroke is driven by the trace.
   - Edges look like edges; misses never touch the ball.
   - Stride and contact height follow the ball (cover-drive prompt C4, D4).
6. **No untested tips.**
   - Every tip passes COACH2 on that exact ball.
   - Generic advice such as "time it better" is not allowed.
   - Tip text is a plain-language rendering of the engine's recommendation and facts, never hand-written per ball.
7. **No unearned praise.** "Well played" or "Better" appears only when the recorded data says so (COACH5).
8. **No noise.**
   - Feedback is proportional, with no celebration beyond the moment.
   - No arcade trails, bursts or slow motion in live play (cover-drive prompt E5).
9. **No reward machinery.** No coins, energy, ads, paywalls, streaks or XP (product sequence, Stage 1 prohibitions).

From the complaints study (2026-11-02):

10. **A real event mix.** The cover drive carries real risk.
    - A drive at a ball that is not pitched up, or away from the body, finds the edge.
    - A drive straight at cover is stopped.
    - No fixed input farms runs (FAIR6, EX7).
    - Edges, catches and dropped catches happen at credible rates, decided only by physics.
11. **Fielders who are trying, and no superheroes.**
    - They move with credible urgency, pick up, throw and react after the ball.
    - Every catch and stop is within the physics reach. Nothing flies, and nothing is impossible.
12. **The ball looks like the speed it claims and reads from the hand.**
    - Apparent pace on screen matches the stated km/h.
    - The delivery type reads from the release (READ1–READ3).
13. **No padding between balls.** No animation or screen that lengthens the time between balls without serving the
    loop in §4.

## 6. The cover drive: from Blender to the game

**The rule that ties it together: physics decides and the animation follows.**

```
Built once (Mac):  footage spec ─► Blender: MakeHuman hero on the game's skeleton, cover drive hand-keyed to the
                   spec, markers (backlift · foot plant · contact · follow-through) ─► repo exporters ─► Unity
Every ball (phone): gesture ─► TypeScript input + physics decide the shot, contact time and point, and the outcome
                   ─► trace ─► Unity plays the one clip, time-warped so its markers land on the physics times,
                   with hands nudged ≤ 8 cm onto the physics bat ─► contact sound and haptic at the physics contact
```

### 6.1 Follow the cover-drive prompt

Follow `docs/prompts/VANDE-COVER-DRIVE-PROMPT.md` phases P0–P7 exactly. The amendments in §6.2–§6.5 apply. Each was
adopted on 2026-11-01, and the owner may reject any of them.

### 6.2 Decisions now settled

- **D2, the camera.** The live view is the stable rear-shoulder batter view, by the owner's decision of 2026-10-28.
  - Also judge the stroke in the inspection views of Appendix B (side-on, front-on, behind).
  - Locked criterion EMB1 describes a first-person eye position. Report that conflict to the evaluators and the
    owner, and don't edit the rubric.
- **D4, the motion source.** The owner cannot film, so the reference is `COVER-DRIVE-SPEC.md`.
  - Hand-key the drive in Blender against the spec's numbers and its three "things that make it look human".
  - The footage is CC BY-SA reference. Never ship it, trace it, or rotoscope it into an asset.
  - MediaPipe (Apache-2.0) was used only to measure the footage. The keys must be hand-authored.

### 6.3 Criteria replaced by the footage spec

The spec's automatic checks R-T1 to R-F2 are added to §7-B as evaluator telemetry checks.

| ID | Was | Becomes | Spec source |
| --- | --- | --- | --- |
| A2 | Feet 0.30–0.45 m apart; knees 10–25° | Feet 0.40–0.60 m apart; knees 20–45° | §1: elite means 0.46–0.52 m; knees 30–50° |
| B4 | Pelvis, torso, lead arm, bat, in that order | Pelvis, then thorax and lead wrist together (within 25 ms), then rear wrist, then bat. The bat's peak comes 30–0 ms before contact. | §4, R-T6 |
| B6 | Stride 0.30–0.45 × stature | Base 0.40–0.55 × stature at contact, measured foot centre to foot centre. Front-foot plant 40–120 ms before contact. | §3, R-P4, R-T3 |
| B7 | Bat within 20° of vertical | Bat 10–30° from vertical at contact, handle ahead of the blade | §5, R-P7 |
| B8 | Centre of mass within 10 cm of the front foot's support | Centre of mass 60–74% of the base from the back foot (about 5–20 cm behind the front heel). Head 0–10 cm behind the front-knee line. | §5, R-P6, R-P8 |

### 6.4 Free only

The owner's rule of 2026-11-01 (cover-drive prompt §3.5):
- Allowed: CC0; CC-BY with the attribution in `docs/ASSET_REGISTER.md`; work the owner made.
- Not allowed: paid tools, services or assets; non-commercial licences; research-only licences.

### 6.5 One clip covers every outcome

- Early, perfect, late, edged and missed all use the same clip, placed in time by the physics.
- Inverse kinematics corrects at most 8 cm at the hands and 12° per joint. Anything bigger needs a clip variant;
  log every case.
- Keep the other 15 shot families working on the current stroke. Don't regress them.
- The next family starts only after the cover drive passes P7 (cover-drive prompt Appendix A).

## 7. The other pillars

### 7.1 Coaching that provably works (Track A)

**The four mistakes behind most failed cover drives.** Each mistake must end in a tested tip, a demonstration on the
same ball, a one-tap retry and a measured comparison.

| Mistake | Physics signature | The tip names | The engine's response |
| --- | --- | --- | --- |
| **Too early** | Negative timing error beyond the solid band. The ball goes straighter or in the air off the inside half. | The measured error in ms and where the ball went | Same shot, later. The demonstration shows the ideal contact. |
| **Too late** | Positive timing error. The face opens, and the ball goes squarer or onto the outside edge. | The ms late and the face angle | Same shot, earlier |
| **Wrong ball** | Driving a ball that is too short (ref-3) or too wide: a top or outside edge, or beaten | Its length or line against the drive's reach | `get_back`, `leave_outside_off` or `defend_back`, as the engine selects |
| **Beaten by late swing or seam** | ref-1: the ball moves after the read, and the bat chases it | The measured late movement | Play later and straighter, or leave, as the engine selects |

**Rules:**
- The copy renders the engine's `CoachRecommendationKind` and its facts in plain language, in en, hi and hi-Latn.
- One sentence, one action (RK4).
- Never hand-author a tip for a specific ball.

**Proof:**
- COACH2 by script: on each reference ball, play each applicable mistake (at least three failure types per ball),
  then play the recommendation. It must succeed in 100% of cases.
- The drive's checks also pass: FAIR6 (no farming) and EX7 (a fixed drive is the best answer to no more than 3 of
  the 6 reference balls).
- Human proof comes later: at least 80% of players improve on the repeated ball within five attempts
  (`ceiling-rubric.md` §6.1).

### 7.2 Sound that is real (Track C)

**Inventory, in priority order:**
1. The middled "tock".
2. Thick edge.
3. Thin nick.
4. Toe or bottom of the bat.
5. Defensive block.
6. Pad.
7. Glove or body.
8. Play and miss: the bat's whoosh, then the keeper's gloves.
9. Pitch bounce, hard and soft.
10. Stumps and bails.
11. Boundary rope or boards.
12. Crowd layers.
13. Bowler footsteps and the delivery grunt.
14. Fielder calls and appeals.

Running calls and commentary are out of scope.

**Sourcing:**
- Use free libraries, such as freesound.org, filtered to CC0 or CC-BY only.
- Record per file: URL, author, licence, date, attribution text and SHA-256. Licence register first, code second.
- Never ship broadcast audio, CC BY-SA or non-commercial audio. Commons footage audio may be analysed as reference,
  for example for decay times and spectra, but never shipped.

**Processing:**
- 3–5 takes per contact kind.
- The take is chosen deterministically from the delivery record, so an exact replay sounds identical.
- Loudness normalised as in `docs/AUDIO.md`.
- The synthesised voices stay as the fallback.
- Labels stay honest (`UNITY_ASSET_AUDIO_READINESS.md` §1).

**Acceptance:**
- COH6: contact sound within 20 ms.
- FBK1: distinct signatures per contact kind.
- The owner's blind A/B against the synthesised set rates the recordings "sounds like cricket" at least 4/5.
- The size delta is measured.

### 7.3 A realistic field view (Track D)

- **Camera:** the rear-shoulder live camera, with credible eye and shoulder height, field of view, scale and horizon.
  The post-contact follow stays restrained (cover-drive prompt E2).
- **Field and dimensions:**
  - The field is the white-ball layout from `src/physics/field.ts`.
  - Dimensions follow the Laws (ART1): pitch 20.12 × 3.05 m, creases, stumps 71.12 × 22.86 cm.
- **Materials and light:** ground materials from CC0 sources (Poly Haven, ambientCG; verify the licence per asset),
  with daylight that feels real and a restrained crowd.
- **Readability A/B per tier, before and after every visual change:** the ball's apparent size and contrast through
  the corridor must not fall below the W0 baseline (READ1–READ3). Reject any realism change that lowers them.
- **Apparent pace (rule 12):** measure the ball's on-screen travel time from release to the batter against the
  physics flight time at the stated km/h. Report any mismatch the camera or rendering causes.
- **Fielders (rule 11):** credible urgency, pick-up, throw and post-ball reactions on the physics paths. Remove
  straight-line robot running and instant perfect throws where the physics trace allows it. Change no physics.

### 7.4 Real artifacts (Track D)

- Bat within Law 5. Pads, gloves, and a helmet with a grille. Stumps and bails at the Laws' dimensions. Pitch wear.
- The ball's seam angle and shiny side show the physics state that produces the swing.
- Every item has a size-measured LOD per tier.
- Every item is in the asset register.

### 7.5 Realistic humans (Track B)

- The batter follows §6.
- The bowler must stay readable at release. Improve the bowler's look or motion only if W0 ranks it among the top
  problems.
- No real player's likeness, kit or logo.
- MetaHuman needs an owner decision (§10). By default it isn't used.

### 7.6 Rules authenticity: wides, no-balls and run-outs (Track F)

**Why.** By design, Practice has no wides, no-balls, byes, run-outs or stumpings (`docs/PRACTICE_RULES.md` lines
41–56). A reviewer calls a wrongly called wide "not cricket" (E-CS-052), another says a run-out is "impossible …
unless the game lags" (E-CS-059), and wrong calls are a top rules complaint (RP-RULE, 5.3%). An Expert Player X will notice.

**Track F's job:**
1. Write a rules specification for how wides, no-balls and run-outs would be decided from physics facts only:
   - wides from the ball's line against the wide guidelines and the batter's movement (Law 22);
   - no-balls from the bowler's front-foot position and the ball's height (Law 21);
   - run-outs from the fielders' physics paths, throws and the batters' running (Law 38).
2. Say exactly which files each would change, how the Coach would explain each one in one sentence, and what the
   tests would be.
3. Add an Expert Player X authenticity check to the evaluator plan. It tests for the absence or presence of each rule
   and never estimates a human result.
4. Make no change to `src/physics/**`, `src/contracts/**` or `docs/PRACTICE_RULES.md`. Those changes go through the
   lead and wait until Codex's simulation v3 is frozen.

**Scope decision.** O9 (§10).

## 8. Order of work and parallel tracks

### 8.1 Phases

| Phase | Work | Exit |
| --- | --- | --- |
| **W0 Truth and baseline** (read-only, one agent) | Verify §3. Record the build id. Capture the whole loop on ref-1 to ref-6: current tip text, demonstration, retry taps, comparison, sounds, field view, readability numbers per tier. Rank the 20 biggest problems across all four pillars. Read the complaints study if it exists. W0 also serves as cover-drive P0. | `release/product-sequence/stage-1-practice/wedge/w0/REPORT.md` and `release/cover-drive/p0/REPORT.md`; no code changed |
| **Track A Coaching** | §7.1 for the cover drive | `wedge/coaching/REPORT.md`, with COACH1–COACH7 evidence |
| **Track B Batter** | Cover-drive prompt P1–P4 with §6. Blender is needed from P2. | `release/cover-drive/p1` to `p4/REPORT.md` |
| **Track C Sound** | §7.2: the licence register first, then integration | `wedge/sound/REPORT.md` |
| **Track D Field and artifacts** | §7.3 and §7.4, including fielders and apparent pace | `wedge/world/REPORT.md` |
| **Track F Rules authenticity** | §7.6: specification and evaluator check only | `wedge/rules/REPORT.md` |
| **Track E Evidence** (independent evaluators only) | Rerun every check on each checkpoint's build. Builders never do this. | A verdict appended to each REPORT.md |
| **I1 Integration** | One frozen build: cover-drive P5–P7, §9 and both Android preflights | `wedge/i1/REPORT.md` |
| **Stage 1 human study** (owner-run) | Pilot with 3 + 3 testers, then 10 New Player X and 10 Expert Player X, on representative Indian Android phones | `release/player-experience/shared/playtest/` |

### 8.2 How the work runs

- **Order:**
  - W0, Track A, Track C and Track F start together.
  - Track D and Track B's P1 start after W0, because they need its readability baseline and captures. B's P2 waits
    for Blender.
  - I1 waits for all tracks.
  - Cause and effect come before polish: an open coaching, fairness, event-mix, fielder or readability failure
    outranks any look-and-sound work.
- **Ownership:** one agent per track, with exclusive files. Codex's in-flight files (§0) are excluded from every
  track.
  - A: `src/practice/coach/**`, `src/i18n/practice/*/coach.ts` and `tests/unit/practice/coach/**`. Coach UI in
    `src/practice/ui/**` outside `flow/**`, through the lead.
  - F: `release/product-sequence/stage-1-practice/wedge/rules/**` only.
  - B: Unity character and stroke files, plus the Blender scripts in `scripts/`.
  - C: `src/audio/**`, Unity audio and the sound register.
  - D: `src/render3d/**` materials and props, plus the Unity world.

  Shared files go through the lead: contracts, the app shell, config, Android, the asset register and the docs named
  in the cover-drive prompt §3.8.
- **Machine:**
  - At most 5 builder agents plus evaluators.
  - At most 2 heavy jobs at once (Unity batch, Blender background, Gradle, Playwright), each under `nice -n 15`.
  - Record `uptime` with every timing.

## 9. Wedge acceptance (all on one build id)

| ID | Check | Evidence |
| --- | --- | --- |
| WA1 | **No scripted outcomes:** no outcome-steering path in code, and assistance is recorded per delivery | SYS1, SYS2, FAIR5, CTL8 |
| WA2 | **Determinism and exact retry**, in the engine and on screen | FAIR1, FAIR2, COACH4 |
| WA3 | **One plain reason** for each of the four cover-drive mistakes, with measured facts | COACH1, RK4, F6 |
| WA4 | **Tips work:** 100% scripted success | COACH2, FAIR6, EX7 |
| WA5 | **Demonstration on the identical ball**, played by the embodied batter | COACH3 |
| WA6 | **One-tap retry and an honest comparison.** The mastery confirmation plays only on "better". | RK5, COACH5 |
| WA7 | **Honest mastery:** at least 9 attempts, no XP and no buffs | COACH6, COACH7 |
| WA8 | **The drive looks human:** cover-drive prompt §7 A–D with §6.3, and owner ratings of at least 4/5 | Cover-drive P4 and P7 |
| WA9 | **It sounds like cricket:** recorded and licensed, synchronised, distinct, owner blind A/B at least 4/5 | §7.2, COH6, FBK1 |
| WA10 | **A real field, and no loss of readability** on any tier | ART1, READ1–READ3 |
| WA11 | **Platform:** frame budgets, input latency, parity with Three.js and Classic, size delta measured. Installed size and reach stay UNPROVEN until Play-split or device evidence exists. | Product sequence §7, PERF1–PERF4, CTL1 |
| WA12 | **Players improve:** at least 80% within five attempts on the repeated ball. PROVISIONAL until the study is run. | Stage 1 human study |
| WA13 | **Credible events and fielders:** anti-fake rules 10 and 11, by script on the reference over and in captures | FAIR6, EX7, COH1–COH7 |
| WA14 | **Rules authenticity:** Track F's specification, and the Expert Player X check run by evaluators | §7.6 |

**When WA1–WA11 pass,** the wedge's engineering is done. The Stage 1 gate (9.0 / 9.0 / 9.2) still needs WA12 and the
independent evaluators.

## 10. Owner decisions and actions

| # | Item | Default if no answer |
| --- | --- | --- |
| O1 | Install Blender 5.2 LTS, then MPFB (cover-drive D5) | Track B stops at P1 |
| O2 | A MetaHuman test | Not used. If yes: a licence-text review first, then a size and performance test only; nothing ships without approval. |
| O3 | Renderer for the high-fidelity drive (D1) | Unity; Three.js and Classic stay coherent with the trace |
| O4 | Reviewers (D6) | The owner, plus an optional volunteer club cricketer with consent |
| O5 | Size budgets | Cover drive at most +2,000,000 bytes (D7). Track C and Track D propose measured budgets in W0. |
| O6 | Accept the §6.3 criteria changes | Applied unless the owner rejects them |
| O7 | Approve commits, physical phones and testers | Nothing is committed; the device and human gates stay UNPROVEN |
| O8 | FAIR6 rulings: per ball vs per innings, and the 10% clause | Evaluators report both readings |
| O9 | Build wides, no-balls and run-outs in Stage 1, after Track F's specification | Specification only; nothing built |

**Decided on 2026-11-02:** the complaints study is folded in; Claude leads and runs this prompt with Claude agents;
contract v6 everywhere, including Android.

**Decided on 2026-11-03** (the owner accepted the lead's recommendations):
- **Takeover.** Claude agents take over Codex's in-flight files: physics, flow, Unity and the bridge. Codex had been
  idle on them.
- **Agents.** As many agents as needed; the limit of two heavy jobs at once still holds.
- **The physics fix.** No freeze until it lands.
- **Camera (F-012).** Use option A3 (gaze gain 1.0 within 8→2 m of the eye) in Three.js, after a browser A/B on
  every tier. A1 is rejected for comfort.
- **Coach.**
  - A robust stroke outranks the protected-arc rule. The Play ref-2 golden is updated, with a reason, on the
    repaired physics.
  - No "well played" when the shot carried a risk that the recommendation did not warn about.
- **O1.** Install Blender LTS and MPFB.
- **O9 and O9b.**
  - O9 stays specification only.
  - Stumpings: evaluators measure EPX-R7 first. If the exposure is not zero, the Coach stops recommending
    `down_track` until stumpings exist.
- **Sound.** O-C1 yes (free Freesound, CC0 or CC BY only), O-C2 only if O-C1 finds nothing, O-C3 yes (owner
  recordings), O-C4 no.
- **Textures.** The OpenAI-generated Unity textures are not allowed under free-only. They are replaced with CC0 or
  original procedural textures.
- **O7.** One local checkpoint commit is approved once simulation v3 is frozen and the tests pass. No push.
- **Defaults.** All other decisions keep their defaults: D1 Unity, D6 the owner reviews, D7 +2 MB, no MetaHuman,
  §6.3 accepted, and FAIR6 reported both ways.

## 11. Reporting

**Every checkpoint `REPORT.md` contains:**
- the build id, UTC time, device or browser, settings, method, expected, observed, pass or fail, and paths
  (`AGENTS.md`);
- the size delta and the affected compatibility cohorts;
- open risks;
- what is next.

**Progress:**
- Report progress only as checkpoints with an evaluator verdict. Never as a percentage of code written.
- Say plainly what was skipped and what failed.

## 12. Not now (send to the lead for the not-now register)

- Harder-ball progression, coach goals and personal bests (Stage 2).
- Chase.
- Daily features.
- Challenges, duels and leaderboards.
- Sharing.
- Accounts and monetisation.
- Commentary.
- Licensed teams or players.
- Career mode.
- Strokes the physics doesn't model (sweep, reverse sweep, scoop, switch hit).
