# Practice Coach Mode: the exact-ball engine

Code: `src/practice/coach/**` (import from `@/practice/coach`). Tests: `tests/unit/practice/coach/**`. Contract:
`src/contracts/practice.ts` (CoachAnalysis, CoachOption, CoachRead, CoachRecommendation, PrimaryInsight,
AttemptComparison, MasteryState, FormReport). The briefs: `docs/prompts/VANDE-PRACTICE-NORTHSTAR.md` ("Exact-ball
Coach Mode", "Form means real improvement", UNDERSTAND and MASTER), the interface constitution §14 and the production
brief's "Coach Mode" and "Field communication".

Coach Mode explains one delivery and the player's attempt at it. It covers what the ball did, what the player read,
what they attempted and why it went as it did. It then shows the recommended, safest and higher-scoring responses.

Every alternative is a real `resolveDelivery` simulation of a real `NormalizedSwing` against the exact same delivery
(flight, ball, field, pitch, handedness, assistance and tier tolerance). Nothing is looked up and no outcome is invented.

The engine is pure and deterministic, and the physics frame applies throughout: + x and + bearings are the striker's
off side, and a left-hander is mirrored by the presentation, as for every `DeliveryResult`.

| Module | Responsibility |
| --- | --- |
| `facts.ts` | What the ball did, measured on the flight that was bowled (`ballFacts`) |
| `cricket.ts` | Line-and-length orthodoxy (`ATTACK_ARCS`, across the line, across the movement, footwork) |
| `field.ts` | The field from the physics' `fieldIntent()`: gaps to aim at, protected arcs |
| `candidates.ts` | The candidate grid and each candidate's swing at its ideal timing |
| `simulate.ts` | The simulations: the grid, then the finalists' execution spreads (a generator, so it can be sliced) |
| `options.ts` | The three picks and the contract's `CoachOption`; `optionOf` |
| `read.ts` | The read verdicts and the why |
| `analyze.ts` | `analyzeBall`, `analyzeBallInSlices`, the per-delivery cache |
| `insight.ts` | `primaryInsight` (the dead-ball card) and `compareAttempts` |
| `mastery.ts` | `MASTERY_RULE` and the mastery functions |
| `form.ts` | `formSample`, `formFromAttempts`, `FORM_RULES` |
| `tip.ts` | The tip: one measured fact and one action (`praiseEarned`, `unwarnedRisks`, `spokenAction`, `zonePhrases`); `analyze.ts` exposes it as `coachTip` |
| `quality.ts` | The measured contact in one place (`requestedKph`, `slowFend`, `inSweetZone`, `offTheToe`, `cleanByMeasure`) |

## The wedge changes of 2026-11-03 (builder-measured; nothing certified)

This section records what the Practice wedge changed on 2026-11-03. Every number is builder evidence. No evaluator has
verified it, and no human result is claimed. Sources, under `release/product-sequence/stage-1-practice/wedge/`:
`coaching/REPORT.md`, `coaching/RERUN-REPORT.md`, the four notes in `coaching/INTERIM-P2-ADDENDUM.md` ("note 1" to
"note 4" below), `worker/REPORT.md` addenda 2 and 3, and `flow/REPORT.md` items 7 and 20.

### Praise and mastery follow the measured contact

- `quality.ts` holds the measured contact in one place. The tip's praise, `soundAtCentre` and `metStandard` all use it,
  so they agree (note 4).
- A contact is clean by measure only when all of these hold (note 3):
  - the bat met the ball at no less than 50% of the requested bat speed (`PRAISE_MIN_SPEED_SHARE`); the requested
    speed comes from the physics' own formula (`requestedKph`);
  - an attacking stroke met it no more than 6 cm off the sweet zone along the blade;
  - it did not come off the toe (bladeU < 0).
- Blocks are exempt. `requestedKph` is null for a block (`worker/REPORT.md` addendum 2).
- Why 50%: middled attacks fall into two clusters. 196 of 797 met the ball below 30% of the requested speed, and 532
  above 60% (note 3).
- **Praise.** A stroke that fails the measure is never praised. The tip states the measurement instead, for example
  "The bat met it at only 33 km/h, not the 76 km/h you swung: defend on the front foot." (note 3). The tick, the green,
  "Clean contact this time" and the "better" chime follow the measurement, not the contact label (`worker/REPORT.md`
  addendum 2).
- **No praise on an unwarned risk** (owner decision, wedge prompt §10). `unwarnedRisks` lists the risks in the
  attempt's own spread that the recommended response does not carry. `praiseEarned` is false for `well_played` or
  `repeat_it` while that list is not empty, and `spokenAction` then says the recommended response itself. The
  recommendation does not change; the card withholds the tick and the green (`flow/REPORT.md` item 20).
- **Mastery (WA7).** `metStandard(analysis, measuredClean?)` no longer counts a contact under 50% of the requested
  speed, outside the sweet zone or off the toe; blocks are exempt. `MASTERY_RULE.success` gains
  `strokeMeasuredClean: true` (note 4). The coach loop passes the tip's `cleanContact` into `recordAttempt`, the only
  place an attempt is recorded (`worker/REPORT.md` addendum 3). Without it, the contact label still decides.
- **The chime.** The mastery sound and haptic play only when the comparison's verdict is 'better'
  (`masteryConfirmation`). Stage progression itself still follows every recorded attempt by `MASTERY_RULE`
  (`flow/REPORT.md` item 7).
- Stable signatures (note 4): `praiseEarned(analysis, rec, tip?)`, `compareAttempts(prev, next, { previous?, next? })`,
  `metStandard(analysis, measuredClean?)`, `masteryAttempt(analysis, stage, tip?)`,
  `recordAttempt(state, analysis, stage, tip?)`.

### Recommended picks are never slow fends

- `soundAtCentre` (`options.ts`) now requires a stroke to reach at least 50% of its requested bat speed at its own
  ideal point. The rule covers the recommended pick and the higher-scoring alternatives. Blocks are exempt (note 4).
- Builder-measured on the same 102 analyses (the reference over at 5 levels, plus 72 Club balls; note 4):

  | | Before | After |
  | --- | --- | --- |
  | Recommended attacks | 28 | 23 |
  | … that are slow fends | 6 | **0** |
  | … off the sweet zone or toe | 8 | 3 |
  | Higher-scoring alternatives | 74 | 79 |
  | … that are slow fends | 7 | **0** |
  | … off the sweet zone or toe | 27 | 19 |

- The rule gates speed only. Three Club strokes at full speed but off the sweet zone (bladeU 0.057, 0.097 and 0.387)
  stay recommended; the tip's sweet-zone gate still withholds their praise (note 4).
- Earlier the same day, `soundAtCentre` gained the aim rule: a stroke must leave its ideal point within
  `AIMED_WITHIN_DEG` = 90° of its aim (`wentWhereAimed`, from the recorded exit and intended bearings). Null or NaN
  decides nothing (`coaching/RERUN-REPORT.md` §1, item 7).

### Robust first, and the protected-arc rule

- Among responses with no misread, one that works at every point of its spread (`worksAcrossSpread`) comes first,
  preferring one clear of protected arcs (`coaching/REPORT.md` §3.3, fix 1).
- Owner decision (wedge prompt §10): a robust stroke outranks the protected-arc rule. The golden now reads "a protected
  aim is allowed only if the stroke works at every point of its spread", re-simulated (`coaching/RERUN-REPORT.md` §3,
  item 2).
- The coach never recommends leaving a ball that would hit the stumps while any response plays at it
  (`coaching/REPORT.md` §3.3, fix 2).

### The spread is decoupled from the bands

`spreadOf(c)` always uses the human error model: timing 0, ±20 and ±40 ms, aim ±10°. It is never clipped to a band,
and `SimContext.solidMs` is removed. This is the lead's ruling 1 (note 1, §4). It matters because Real's solid band is
now 29 ms, narrower than the ±40 ms spread (`docs/PRACTICE_PHYSICS.md`, "Timing bands").

### Versioned records: old data is dropped quietly

| Record | Version | Why | What happens to old data |
| --- | --- | --- | --- |
| Form samples | `FORM_SAMPLE_VERSION` = 3 (`form.ts:30-36`) | Each sample is graded against the bands it carries, so version-2 and version-3 samples are not comparable | `store/form.ts` drops samples of another version on load (note 2) |
| Mastery state | `MASTERY_SUCCESS_VERSION` = 2, carried in `masteryKey`: `sim3\|m2\|seed\|hand\|assist` | A success now means measured clean contact | State saved under the old key is never found again, so a fresh state starts at stage 1; nothing is reinterpreted (note 4; `worker/REPORT.md` addendum 3) |

The store envelope's own `v: 2` is a separate number and is unchanged (note 2).

### The tip (`tip.ts`): one measured fact, then one action

- `coachTip` (in `analyze.ts`) builds the tip. It is one sentence: one measured fact, then one action, the
  recommendation as `spokenAction` says it (`coaching/REPORT.md` §3.3, fix 3).
- The facts come from the coach's memoised re-simulation of the record, never from a result a caller hands in. A
  source scan finds no ball id or seed in the tip code or its copy.
- The fact depends on the action kind:

  | Action kind | Fact |
  | --- | --- |
  | Timing (`play_earlier`, `play_later`) | The ms early and where the ball went, or the ms late and the face angle |
  | Length | Where it pitched against the feet |
  | `play_straighter` | The movement or the line it went across |
  | A different decision | The movement that beat the bat, then the length, the line, the timing; then the risk of a stroke that worked; otherwise the physics' reason |

- **Fact order** (note 3): wrong-ball facts first; then the measured timing, for a swing outside the solid band; then
  the movement.
- **Played on.** A ball played onto the stumps off the middle reads "you played it onto the stumps"
  (`practice.tip.where.played_on`), never a "beaten" name. The physics now emits the `played_on` reason itself, and
  contract v6's closed `CoachingReason` list carries it (`coaching/RERUN-REPORT.md` filing note;
  `physics/phase3/REPORT.md` §4). The tip's own workaround for an old "beaten" reason is kept as defence in depth
  (note 1).
- **Toe contact.** When bladeU < 0 the tip says "It came off the toe of the bat". The keys are
  `practice.tip.where.toe`, `practice.tip.fact.slow`, `.toe`, `.off_sweet_toe` and `.off_sweet_handle` (note 3).
- Example sentences, Play ref-1 (note 3):
  - "63 ms early, and it took the outside edge: leave it, it is passing off stump."
  - "63 ms late, with the bat face 0° off your line: leave it, it is passing off stump."
- The words are `practice.tip.*` in en, hi and hi-Latn. **The hi and hi-Latn lines are AI-written and need a native
  speaker's review.** Their correctness is UNPROVEN (note 3; `coaching/RERUN-REPORT.md` §1).
- **Risk display (lead ruling 2026-11-04).** A risk that rounds to 0% is never shown as 0%; it reads "under 2%"
  (`practice.option.numbers`, an ICU `=0` branch in en, hi and hi-Latn). The coach's grid cannot see failures thinner
  than its spacing: on the evaluators' finer grid, 10 of 33 recommended swings fail at 0.08–1.74% (named limitation
  L-D1, `COACH2-FINAL.md` §7d). The test is `tests/unit/practice/coach/risk-display.test.tsx`. The hi and hi-Latn lines
  join the native-review list.

### Card rules that changed

- **Timing tips** (`insight.ts`, recommendation step 3):
  - a timing tip is given only for the recommended stroke itself: the same decision, aim within 10° and lofting, the
    same played feet, and the recommendation survives its ideal point. A different stroke falls to the aim or the
    decision rule (note 1);
  - the recommended stroke timed inside the band but out (caught or played on), with an error of at least 5 ms, gets
    `play_later` or `play_earlier` (`coaching/RERUN-REPORT.md` §1);
  - the recommended stroke played beyond ±2σ of the spread (40 ms) gets a timing tip whatever its label, because the
    recommendation was never verified that far out (note 2).
- `repeat_it` only for an attempt timed inside the solid band (note 3).
- `get_back` or `get_forward` for the recommended aim played on the other feet; the recommended block for a block
  played on the other feet (note 3).
- `play_straighter` only when the attempt was actually played across the line or the movement (`playedAcross`)
  (note 1).
- The movement read is 'wrong' only when the bat was actually beaten (a miss, pad, body or edge). A ball played on off
  the middle is not a movement misread (`coaching/RERUN-REPORT.md` §1, `read.ts`).

### Yorkers

The coach follows the physics' automatic forward footwork at a yorker (`docs/PRACTICE_PHYSICS.md`, "Yorkers").
`candidates.ts` never gives a yorker a back-plane response. Automatic footwork is used only where it resolves forward;
otherwise the forward foot is explicit. On the tree of 10:28Z, ref-6 recommends a forward block at all five levels
(note 4). That tree followed PHYS's 10:24Z revert, before the forward smother was landed again at 10:31Z under the
lead's ruling (a). On the frozen physics, auto footwork meets ref-6 forward (`physics/phase5/REPORT.md`, item 1); the
coach's ref-6 recommendation on the frozen build is in COACH's final run, which is not filed yet.

### Where the reading runs

The reading (the analysis, the tip, the form sample and the demonstration) now runs on the work thread from the dead
ball (`INSIGHT_OFFTHREAD_AFTER_DEAD_MS` = 0). The main-thread fallback is the earlier path, unchanged: it starts
1000 ms after the dead ball (`INSIGHT_AFTER_DEAD_MS`), in 8 ms slices, and yields through a MessageChannel
(`worker/REPORT.md` item 2; `flow/REPORT.md` item 15). See `docs/ARCHITECTURE.md`, "The work thread".

### Builder results and open items

- **COACH2**, on the 10:28Z tree: 90/90, and the four-mistakes check passes. The 12 coach files, 4 UI copy files,
  `mastery-confirmation` and `store/records`: 235/235 (note 4). That tree's physics was not yet frozen.
- **On the frozen physics** (simulation v3, frozen at 11:52Z), PHYS2's full vitest of 11:37–11:49Z had no coach2 or
  properties failures: every coach test passed (`physics/phase5/REPORT.md`, "Final checks"). COACH's own final COACH2
  evidence run on the frozen build, with its table, is not filed yet.
- **Slow middles rose** on the frozen physics: 452 → 525 middle contacts with the bat under 20 km/h in the census, and
  toe-end hits are now `middle` with bladeU < 0. The measured-contact gates above are what keep them from being praised
  or recommended (`physics/phase5/REPORT.md`, freeze note and requests).
- COACH2 at 100% means 100% at the sampled spread points. A denser check found failures between them, for example
  Learn ref-2's recommended on-drive caught at −24, −26 and −28 ms (`coaching/RERUN-REPORT.md` §5, risk 3).
- The COACH2 proof covers keyboard input only, not touch.
- FAIR6's coach clause and EX7 have not been rerun since these changes: **UNPROVEN**, for the evaluators.
- Stumpings (owner decision O9b, wedge prompt §10): evaluators measure EPX-R7 first. If the exposure is not zero, the
  coach stops recommending `down_track` until stumpings exist.

## The analysis

`analyzeBall(record, result?)` builds the delivery from the record with `practiceFlight(record)`. That call flies the
record's ball, so a worn ball's smaller swing is what gets analysed.

The attempt is always the record's swing re-simulated (about 1 ms). A `result` may be passed for convenience but is
never trusted, so the analysis is a function of the record alone, and a stale or foreign result (another assistance
level, another physics version) can never leak into it. The analysis then assembles:

- `ball`: release speed; where the ball pitched (PITCH_HALF − bounce z); its line at the stumps; its movement in the
  air and off the pitch (`flightMovement`); its height at the bat; and whether it would hit the stumps. Internally the
  coach also measures:
  - the net sideways movement against the release line;
  - the movement the batter plays: the larger of the air and pitch movement, since a spinner's drift and turn can
    cancel in the net but the batter plays the turn;
  - what moved the ball most: swing, seam, cut, turn or drift (none under 5 cm).
- `attempted`: decision (leave, defend, attack), the footwork played, direction, elevation, power, the signed timing
  error, and the attempt's contact, timing band, runs and dismissal. `attempted.spread` is the player's own stroke,
  re-timed to its ideal and judged over the same execution spread as the options (null for a leave).
- `read` and `why`: see below.
- `options`: the recommended, safest and higher-scoring responses.

The alternatives depend only on the delivery and its settings, never on the swing. They are cached per exact ball (16
deliveries, LRU), so a repeat's analysis costs about a millisecond (the attempt's own simulation). Every analysis gets
its own copy of the options.

## The read

Each verdict is 'right', 'wrong' or 'unclear', inferred from what the player did against the ball that was bowled.
Footwork the physics chose, a leave's timing or a tap's straight bat are not the player's choices, so they give no
evidence.

| Read | Right | Wrong | Unclear |
| --- | --- | --- | --- |
| length | manual footwork equals the physics' own for this length | manual footwork fights the length: forward to a short ball or bouncer, back to a full ball, down the track to pace or to a short ball | automatic footwork, a leave, the grey zone |
| line | left a ball that misses; played one that would hit; a stroke in the line of the ball | left a ball that would hit; across the line (a leg-side swing below −25° at a ball 6 cm outside middle, a cut above 65° at a straight ball, an off-side swing above 45° at a ball going 15 cm down leg); a block at a ball more than 8 cm wide of the stumps | — |
| pace | timing inside the active solid band | mistimed or missed (beyond it) | a leave |
| movement | left a ball that moved and missed; played it off the middle | left a ball the movement brought onto the stumps; beaten by swing, seam or turn; a stroke to leg (below −20°) at a ball moving away, or square on the off side (above 40°) at a ball coming in | the movement played is under 5 cm |
| bounce | a ball 1.0 m or higher at the bat (`BEATEN_BY.highAtBatM`): left when it misses, or played off the middle | forward to it, a block at 1.35 m or higher (fending at it), beaten over the top, top edge, hit on the body, left onto the stumps | normal height, unless the physics says beaten by bounce |

**Why** (`CoachingReason[]`, most important first). The physics' own reason (`src/physics/scoring.ts`) leads when it
names a cause: a technical diagnosis, a decision (left and bowled, padded up), or what a good stroke earned. When the
attempt went wrong (a dismissal, a miss, pad, body or an edge), the misreads that explain it follow: beaten by bounce,
swing, seam or turn (by what moved the ball), played across the line, then too early, too late or beaten by pace.

The misread leads instead in two cases, so the card's primary reason says why, not what:

- the physics' reason only says how the ball was caught ('edged_behind', 'edged_to_slip', 'caught_in_the_ring',
  'caught_in_the_deep');
- the batter's response fought the bounce of a short ball and the physics gave a technical diagnosis (beaten by swing,
  seam, turn or pace, too early or late, missed a straight ball, across the line). Then `beaten_by_bounce` leads.
  Example: forward to a bouncer, hit on the body by a ball that seamed in.

A good stroke is explained by its outcome alone.

## The candidate grid

Each candidate is a real `NormalizedSwing`. It is timed at the ideal for its own footwork
(`idealTimeFor(flight, footwork) − batTravelMs`), in the input layer's precision (0.1 ms, 0.1°, 0.001).

| Response | Grid |
| --- | --- |
| leave | no swing |
| defend | the input's tap (power 0.2, straight bat) × footwork: automatic, and the other foot |
| attack | footwork × direction × stroke. Footwork: automatic, plus the other foot on a good length, plus down the track to a spinner's non-short ball (ground strokes only). Directions: straight (0°, the full face: the answer to movement), the centres of `fieldIntent()` gaps at least 10° wide within ±140° (widest first), and the middle of the line's orthodox arc when no direction lies inside it; at most nine, and directions within 8° merge. Strokes: along the ground (elevation 0) at power 0.55 and 0.9; lofted over the top (elevation 0.75, power 0.85) and chipped over the ring (0.55, power 0.8), both only with the line. Every stroke is one the input can produce (`canPlay` of `src/input`: a lofted swipe is always a hard one). |

That is about 27–45 candidates per ball, and about 65–110 simulations with the execution spreads.

## Risk and expected runs: the execution spread

Every candidate is simulated once at its ideal point. The finalists are then judged over a realistic execution spread
(`EXECUTION_SPREAD`, the lead's F-005 decision). The finalists are: the leave, both blocks, the best four orthodox
strokes clear of protected arcs (the best two orthodox ones if none is clear), and the three highest-scoring strokes
that play with the line, among those that survived their ideal point off the middle.

- **Timing:** a player's error is Gaussian with σ = 20 ms (the examiners' human-timing model). It is sampled at 0,
  ±σ and ±2σ with weights exp(−k²/2) (written out, so every engine weighs them identically). Since 2026-11-03 it is
  never clipped to a band (see "The spread is decoupled from the bands").
- **Aim:** ±10° (weights ½ for the intended direction, ¼ for each side), sampled at the ideal timing and at ±σ.
- That is 11 points for a stroke, 5 for a block (a straight tap: timing only) and 1 for the leave. Each point is a
  real simulation, weighted by the product of its weights.

The numbers:

- `dismissalRisk` is the weighted share of the spread dismissed. `expectedRuns` is the weighted mean runs, a dismissal
  counting 0. A response that only works at its ideal point cannot win.
- `risks` (CoachRisk) say why: 'into_protected_region' (the aim lies inside a `fieldIntent()` protected arc: ring
  arcs for a ground stroke, a boundary rider's for a lofted one), 'can_be_caught', 'can_edge', 'can_be_bowled',
  'can_be_lbw' (anywhere in the spread).
- `outcome`, `contact`, `contactPoint`, `contactT` and `region` are the ideal point's: what the demonstration plays.
  `contactPoint` and `contactT` are null unless the bat met the ball; `region` is null unless the option scores.

## The picks (`options.ts`, `PICK`)

- **Recommended:** the response with the highest value over its spread.
  - The value is expected runs − 24 × risk (the one wicket of a Practice innings) − 1 × the share off the middle, plus
    a small bonus (`PICK.orthodoxyBonusRuns` = 0.25) for orthodox line-and-length cricket, which only breaks near-ties.
  - It must keep the **two hard coaching rules**:
    - play with the line and the movement, enforced through the coach's own read: the coach never recommends a
      response its read would call a misread (across the line or the movement, fishing at a wide ball, feet that fight
      the length, fending at a head-high ball, leaving a ball that hits);
    - never aim into a protected arc.
  - It must also survive its ideal point off the middle (or as a clean leave of a ball that misses), since the
    demonstration plays it, and be dismissed in at most `PICK.recommendMaxRisk` = 0.12 of its spread.
  - Since 2026-11-03 (above): a robust response (`worksAcrossSpread`) comes first, and every tier requires
    `soundAtCentre`, which for a stroke means at least 50% of its requested bat speed and an exit within 90° of its
    aim at its own ideal point.
  - Ties go to the lower risk, then leave before block before stroke.
  - When nothing qualifies, the conditions relax in order: a protected aim (the option then carries
    'into_protected_region'); the read, keeping the line; the line; the risk cap; soundness. It never aims into a
    protected arc unless its risks say so.
- **Safest:** the lowest risk among sound responses first. Then a leave before a block before a stroke, then clean
  contact, then runs.
- **Higher scoring:** the most expected runs within `PICK.higherScoringMaxRisk` = 0.25, strictly more than the
  recommended, from a response the coach's read finds no misread in. Since 2026-11-03 it must also be sound at its
  ideal point along its aim (`soundAtCentre`), so it is never a slow fend.

`options[0]` is always the recommended. The safest and higher-scoring appear only when they are different responses.
`optionOf(analysis, kind)` resolves a merged kind: a missing safest is the recommended; a missing higher-scoring is the
listed option that scores most.

### Orthodoxy (`cricket.ts`)

The physics decides what each response produces. Orthodoxy says which responses a coach calls correct cricket, and
since the shot geometry landed it only breaks near-ties (the bonus above). The exceptions are its two hard rules:
across the line or the movement, and a protected aim.

- A ball that misses the stumps can be left.
- A block is for a ball that would hit, or one passing within 8 cm of the stumps below 1.35 m.
- An attacking stroke is orthodox along the ground (elevation ≤ 0.3) inside `ATTACK_ARCS` for the measured length and
  line band (`lengthBand` and `lineBand` of `src/practice/game/overs.ts`), and never across the line or the movement.
  When the ball moves, the arc opens 30° further on the side it moves to (play with the swing, the seam or the turn).
- Across the line: a leg-side swing below −25° at a ball 6 cm outside middle, a cut above 65° at a straight ball, or
  an off-side swing above 45° at a ball going 15 cm down leg.
- Across the movement: to leg (below −20°) against a ball moving away, square on the off side (above 40°) against one
  coming in.

| Length | Down leg | Leg stump | Middle | Off stump | Outside off | Wide outside off |
| --- | --- | --- | --- | --- | --- | --- |
| full (and down the track to spin) | −150…−30 | −90…10 | −50…30 | −5…60 | 10…80 | 20…95 |
| good | −150…−25 | −110…−20 | block or leave | block or leave | block or leave | 55…120 (cut) |
| short | −150…−45 | −115…−30 (pull) | −115…−30 (pull) | 15…75 (punch) | 55…125 (cut) | 55…125 (cut) |
| bouncer, yorker | leave or duck, dig out | | | | | |

Footwork: automatic is always orthodox. So is a manual choice equal to the physics', and either foot on a good length.
Down the track is orthodox to a spinner's non-short ball.

## The card: one insight (`insight.ts`)

`primaryInsight(analysis)` returns `{ reason: why[0], timingMs (signed, rounded; null for a leave), recommendation }`:
exactly one reason and one recommendation (COACH1, RK4). The recommendation always describes options[0]: its
decision, footwork, aim, safe scoring region and lofting (null aim and region for a block or a leave). The UI words it
in one line. Every kind follows from recorded fields, and the first rule that applies decides it:

0. A different response from the recommended one that worked (not out, off the middle, with runs for a stroke) and
   is worth as much over the execution spread: `well_played`. The attempt's own stroke, re-timed to its ideal and
   judged over the same spread, is `attempted.spread` (risk, expected runs, risks). Its value, expected runs − 24 ×
   risk, is within 0.25 runs of the recommended's, with no misread and no protected aim. When a stroke worked but is
   not well played, `attempted.spread` says why it was lucky: a protected aim, a risk, less value (RK-F06).
1. A different decision:
   - the recommended response is a leave: `leave_over_the_top` (1.0 m or higher at the bat, or in line with the
     stumps and still missing them: it goes over the top), `leave_down_leg` (outside the line on the leg side) or
     `leave_outside_off`;
   - the player left a ball that hits the stumps: `play_at_the_stumps`;
   - otherwise `defend_forward` / `defend_back` (by the recommended footwork), or `attack_the_gap`.
2. A leave like the recommended one: `repeat_it`.
3. Manual footwork that fought the length (the length read is wrong): `get_forward` / `get_back`.
4. Timing beyond the solid band, or solid but off the middle: `play_earlier` / `play_later`, with `shiftMs` =
   max(1, round(|error|)).
5. Across the line or the movement (the line or movement read is wrong): `play_straighter`.
6. A block: `repeat_it` when it met the standard, otherwise the recommended block.
7. A lofted stroke (elevation ≥ 0.45) caught or scoring nothing, when the recommended stroke keeps the ball down:
   `keep_it_down`.
8. The standard met (survived, off the middle), with the recommended aim (within 10°) or as many runs as it earns:
   `repeat_it`. Otherwise `aim_for_the_gap`.

`compareAttempts(previous, next)` compares two attempts at the exact ball against the recommended response. Its
changes are recorded deltas, most important first:

- 'survived_now' / 'out_now' (the dismissal);
- 'decision_right_now' / 'decision_wrong_now';
- 'footwork_right_now' / 'footwork_wrong_now' (the recommended footwork, without fighting the length);
- 'clean_contact_now' / 'contact_worse' (the middle of the bat, or a leave of a ball that misses; judged by the
  measured contact when the caller passes each tip's `cleanContact`);
- 'timing_closer' / 'timing_further' (|error| changed by 5 ms or more; `timingMs` = |previous| − |next|);
- 'more_runs' / 'fewer_runs' (`runsDelta`, a dismissal counting none).

The verdict is the most important change's: 'better' for an improvement, 'worse' for a regression, 'same' when nothing
changed (`['same_again']`). Swapping the attempts swaps the verdict (COACH5).

## Mastery (`MASTERY_RULE`)

A **success** is no dismissal, the recommended decision, and the middle of the bat, or a leave of a ball that misses the
stumps (`metStandard`). Since 2026-11-03 a stroke's contact must also be clean by measure when the tip is passed: at
least 50% of the requested bat speed, in the sweet zone and not off the toe; blocks are exempt (above). Attempts are played at assistance stages 1 (full trajectory and ghost movement), 2 (pitch and
contact markers), 3 (contact cue only) and 4 (none).

- **Advance** one stage after **2 consecutive successes** at the current stage. A failure resets the run. `nextStage`
  replays the whole history, so the stored stage is never trusted on its own.
- A player who chooses less help moves on to that stage. Attempts with more help than the stage reached do not count.
- **Mastered** requires stage 4 and **at least 3 successes in its last 4 attempts** there. The fewest attempts that can
  master a ball is nine (2 + 2 + 2 + 3), so one lucky result can never be mastery. Once shown, mastery stays shown.
- `masteryProgress(state)` gives the stage, the run, the successes still needed, attempts at the stage, and the recent
  successes at stage 4. `masteryEvent(prev, next)` gives 'stage_up', 'mastered' or null, for audio and haptics.
- `masteryKey(record)` is `sim3|m2|seed|hand|assist`: the simulation version, `MASTERY_SUCCESS_VERSION` (2), and the
  exact ball under the settings that change its physics. A key in the old format is never found again (above).
- `isMasteryState` validates stored state.

## Form (`form.ts`)

Each innings ball and each mastery attempt leaves one `FormSample`: compact, versioned JSON (`FORM_SAMPLE_VERSION` 3
since 2026-11-03; samples of another version are dropped on load) with no gestures and no timestamps. It is built by `formSample({ record, result?, analysis }, { source: 'innings' } | { source: 'mastery',
stage })`. Like the analysis, it re-simulates the record's swing rather than trusting a passed result.
`formFromAttempts(samples)` returns the report.

Each skill's score is the mean of its last 30 evidence values (0–100), with at least 3 required. `samples` counts its
evidence. `trend` is the latest 8 values against the 8 before (fewer when there are fewer), from 8 values. Samples that
fail `isFormSample` are ignored.

Assistance gates the evidence (`FORM_RULES.minStage`): an innings ball counts as stage 4. Recognition never counts at
stage 1 or 2, because the trajectory or the markers showed the answer; timing never counts with the contact cue
(stage 3).

| Skill | Evidence (per sample) | Min. stage |
| --- | --- | --- |
| line_length | the line verdict, and the length verdict when decided (right 100, wrong 0) | 3 |
| pace_timing | against pace: inside the perfect band 100, solid 70, edge band 30, beyond 0 | 4 |
| swing_seam | pace balls that swung or seamed: the movement verdict | 3 |
| cut | cutters: the movement verdict (and the pace verdict at stage 4) | 3 |
| spin_reading | spin: the movement verdict (and the pace verdict at stage 4) | 3 |
| short_ball | short-pitched balls: the bounce verdict | 3 |
| footwork | manual footwork only: the length verdict (automatic footwork is not the player's choice) | 3 |
| timing | every swing: 100 × (1 − \|error\| / edge band) | 4 |
| bat_face | attacking strokes off the middle: 100 within 5° of the aim, 0 from 30°; edges 0 | 1 |
| off_side_placement | off-side strokes (aim ≥ 10°) off the middle: found runs 100, else 0 | 2 |
| direction | attacking strokes: with the line and movement 100, across 0 | 2 |
| field | attacking strokes: the aim's clearance from the protected ring arcs, 0 at −2° … 100 at 6° | 2 |
| running | never: running is automatic in Practice (score null, samples 0) | — |

Form is a report only. Nothing in `src/physics` or `src/practice/game` imports the coach; a source scan in
`tests/unit/practice/coach/form.test.ts` enforces it. So form can never improve contact, widen timing windows, reduce
movement, weaken the bowler, move fielders or change outcomes. The analysis itself reads nothing but the record and the
swing: no difficulty, innings or form state.

## Determinism, slicing and cost

The same record gives a byte-identical analysis, whether cold, cached or sliced (tested through `JSON.stringify`).
Rounding never produces negative zero. `analyzeBallInSlices(record, result?, { sliceMs = 8, signal, yieldTo })` runs
the same generator, yielding to the event loop between simulations (`scheduler.yield()` where available). Slicing only
decides when to yield, never what is simulated, and the AbortSignal rejects with an AbortError.

Cost, measured in plain Node on the M1 Pro (the browser's V8 is comparable), with each run's `uptime`. Measurements
above a 1-minute load of 20 are indicative only (AGENTS.md):

- about 65–110 simulations per ball, with the execution spread;
- per new ball over 240 random-over balls on every pitch and level: median 98 ms, p90 138 ms, p95 148 ms, max 186 ms,
  mean 98 ms (build 38924bd+9b8fa695e33c, 2026-10-26T05:07Z, load 8.0: valid);
- a repeat of an analysed ball: about 12 ms (the attempt and its own stroke over the spread);
- the first ball of a session also pays JIT warm-up.

On a phone, `analyzeBallInSlices` keeps every slice near 8 ms, so the analysis never stalls a frame. Vitest runs the
same code about 3.5× slower (its module runner), so the cost test only guards against blow-ups.

## Golden over

`tests/unit/practice/coach/golden.test.ts` plays the reference over (`REFERENCE_OVER`) at Play and Real:

- every recommended response, replayed, survives with good contact (middle, or a clean leave of a ball that misses);
- leaving the inswinger is `left_and_bowled` with `beaten_by_swing`, a wrong line and a wrong movement read, and
  `play_at_the_stumps`;
- leaving the cutter or the yorker is bowled, with `play_at_the_stumps`;
- getting forward to the bouncer reads the length and the bounce wrong, and the recommendation never asks to get
  forward: it is a back-foot response or a leave (`get_back` for a forward stroke). Whenever it goes wrong it is
  explained by `beaten_by_bounce`;
- a pull across the full outswinger and a lunge forward to the hard length are misreads;
- every recommended stroke keeps the hard rules: with the line and the movement, and clear of protected arcs unless it
  works at every point of its spread (owner decision, 2026-11-03);
- no recommended attack on the reference over is a slow fend, and a fixed-candidate test checks that a slow fend loses
  to a block (`coaching/INTERIM-P2-ADDENDUM.md` note 4).

The recommended responses themselves are in the analysis (the golden prints them). They follow the physics, so they
change when it does: the table is refreshed with each physics version.

The tests assert behaviour, not these numbers, so they stay valid when the physics changes.

## Verification

One command reruns everything: `npx vitest run tests/unit/practice/coach`.

| File | Checks |
| --- | --- |
| `analyze.test.ts` | the ball off its flight; the worn ball; the attempt; options re-simulate exactly; picks; the recommended sound and clear of protected arcs; independence from the swing; byte-identical determinism (cold, cached, sliced); abort; cost |
| `read.test.ts` | each read verdict and the why |
| `insight.test.ts` | the card's reason, timing and recommendation kinds; compareAttempts |
| `coach2.test.ts` | COACH2: for every reference ball, three failures each, at Play, Real and Learn, and with a 15 ms tier tolerance. The failed attempt's recommendation, executed through `repeatDelivery` (the recorded assistance and tolerance), succeeds and then reads `repeat_it` |
| `properties.test.ts` | COACH5: every change is a recorded delta and the verdict is the most important one, over 400+ attempt pairs. FAIR3 and COACH1: the ball, the attempt, every why entry and every recommendation kind trace to recorded fields |
| `mastery.test.ts` | COACH6: the stages step down, repeatable execution, nine attempts at least, sticky mastery, events, stored state |
| `form.test.ts` | COACH7: evidence per skill, the stage gating, the trend, the stored samples; the source scan (no feedback into physics or game) |
| `golden.test.ts` | the reference over at Play and Real (above) |
| `coach2-cover-drive.test.ts` | COACH2 for the cover drive: 90 cases through the shipped `GestureTracker` (keyboard input), four mistakes per ball, the recommendation executed at every spread point, and each tip rendered as one sentence in en, hi and hi-Latn. `COACH2_TABLE=<path>` writes the table |
| `tip-facts.test.ts`, `played-on.test.ts` | The tip's measured facts and actions, including the slow, toe and off-sweet facts; a ball played on is never read as beaten |
| `golden.test.ts`, `mastery.test.ts` (2026-11-03 additions) | No recommended attack is a slow fend; a measured slow fend is not a mastery success and never advances a stage; blocks are exempt |

## Limitations

- **The physics sets the ceiling.** With version 1's generous strokes, a perfectly timed lofted hit cleared the rope
  off almost any ball. The shot geometry (version 2, landing) makes strokes fit where the ball is. The coach needs no
  change for it: its picks follow the simulated runs and risk.
- **Risk is a model of execution.** The spread is the examiners' σ 20 ms timing model and ±10° of aim, sampled at 11
  points. It is not a measured human distribution, and a nervous or a fast-learning player is wider or narrower.
- **FAIR6 depends on what "expected runs" counts.** In the latest probe (σ 20 ms, build 38924bd+9b8fa695e33c,
  load 8: valid), with every candidate playable, recommended play made 0.9–1.1× the runs per ball of the best fixed
  input, with 25–75× fewer dismissals (0.006–0.017 against 0.45–0.48 a ball). Per innings of one wicket, it is
  20× or more. Even pure expected-value play, with no risk penalty, reaches only about 1.2 runs a ball in Real: on
  that build the physics, not the coach's caution, caps how much a good stroke earns.
- **The grid is coarse:** directions from the field's gaps, two ground powers, two lofted strokes. 'across' footwork,
  uppish strokes and sweeps are not tried.
- **The read is an inference.** It is honest about evidence ('unclear' when the player's action did not decide it), but
  it judges actions, not what the player saw.
- **The physics batter cannot duck or sway.** A head-high bouncer at the body is not a clean leave, so the coach may
  recommend a stroke or a block there.
- **The physics batter cannot dig a yorker out from the back plane** (no hip flexion; crouch capped at 0.18 m). The
  coach never recommends it (`physics/phase4/REPORT.md`, lead ruling).
- **The Hindi and Hinglish tips are AI-written** and await a native speaker's review.
- **The spread is sampled at 11 points.** A denser check finds failures between them (above).
