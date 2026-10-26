# Practice rules: overs, field, fielding, running, scoring

Owner: physics (field and rules). Code: `src/physics/{field,fielding,running,scoring,resolve,index}.ts` and
`src/practice/game/**`. Contract: `src/contracts/practice.ts`. Delivery physics, bat contact and the LBW law are in
`docs/PRACTICE_PHYSICS.md`.

Practice is resolved entirely on the device and entirely from the simulated play:

```
flight (delivery.ts) + NormalizedSwing ─► bat path, swept collision, contact (bat/collision/contact.ts)
   ─► struck ball flight and roll (ball.ts) ─► fielding (fielding.ts) ─► running (running.ts) or the rope
   ─► outcome and coaching (scoring.ts)            all assembled by resolveDelivery (resolve.ts)
```

There is one implementation of each concern: one scoring and dismissal pipeline (`scoring.ts`, `judge`), one over
and innings state machine (`src/practice/game/innings.ts`), one replay representation (the contract's
`DeliveryRecord`), one region classification (`regionOf`, used for the aim, the outcome and the coaching), and one
seeded random source (`src/engine/prng.ts`, keyed by SHA-256). No runs value, boundary, catch or wicket is ever drawn
from a probability table: every one is read off the simulated ball, bat and fielders.

## Innings rules

- A Practice innings is one wicket and up to ten six-ball overs. The batter starts at 0; runs accumulate across overs.
- Every over is chosen before it starts (Quick Random Over, Build an Over, or the guided first over) and is fixed: its
  six deliveries never change after the batter acts.
- A full over must be finished before another is chosen, unless the batter is out.
- One wicket ends the innings at once: no second batter. After ten completed overs the innings is complete.
- A player may abandon an unfinished innings; it ends with the score so far.
- State machine (`inningsReducer`, pure): `choosing_over` → `chooseOver` → `batting` → six balls → `over_complete`
  → `nextOver` → `choosing_over`; a wicket on any ball → `out`; the tenth over completed → `complete`; `abandon` from
  any unfinished state → `complete`. An action that is not allowed leaves the state unchanged; `inningsError` says why
  (for example `finish_the_over_first`, `delivery_not_started`, `not_this_delivery`).
- A resolved delivery is accepted only if it is the next ball of the current over, it was started, and its record
  matches the over (plan, seed, bowler, field, pitch, assistance, handedness).

## Wides and no-balls

Practice bowls no wides and no no-balls: every generated or built delivery is legal, so all six balls of an over
count. The generator and Build an Over keep every delivery inside `BUILD_LIMITS` (line at the stumps between 0.30 m
down the leg side and 0.50 m outside off stump; length 0.4–13 m for pace, 1.5–7 m for spin). A yorker pitches within
the physics' `YORKER_MAX_LENGTH` (1.8 m) and every other pace ball except the bouncer between 1.8 and 8 m. A bouncer's
length is solved against the real flight (`bouncerLength`) so that it arrives at the batter between the top of his
shoulder (`BODY.torsoTop`, 1.42 m) and the top of his head (`BODY.headY + BODY.headR`, 1.74 m): a genuine bouncer that
is never above head height, so never a no-ball (Law 21.10). At most two bouncers are allowed in a built over and at
most one in a random over. Speeds stay within what the physics models: spin within `SPIN_KPH` (75–98 km/h) and pace
within `PACE_KPH` (90–155 km/h; the stock bands are `PACE_BANDS_KPH`), so a Learn slower ball stops at 90 km/h.
`validateOver` rejects anything else.

Practice has no extras of any kind: no wides, no-balls, byes, leg byes or penalty runs. A ball the batter misses or
leaves is taken by the keeper and is dead; a ball that hits the pad or body and is not out is dead. There are no
stumpings and no run-outs (running is automatic and always safe, see below).

## Overs

### Quick Random Over (`randomOver`)

Seeded and deterministic: the same seed, pitch, assistance level and beginner flag always give the same over. One
bowler bowls all six balls.

- Bowler: a spinner with probability 0.40 on a balanced pitch, 0.25 on green and hard pitches and 0.65 on a turner,
  unless the family is given. Pace bands at Play are controlled, fast or express (beginners: controlled or fast); at
  Real mostly fast or express; at Learn the bowler is genuinely slower. Spinners are finger (off-break; the wrong'un
  is the carrom ball) or wrist (leg-break; the wrong'un is the googly). Beginners always face a right-arm bowler.
- A balanced over, not six extremes: two or more stock balls, the bowler's natural movement (outswing or inswing, the
  seam ball, or for a spinner flight and a quicker ball) once or twice, and one or two change-ups (cutter, slower ball,
  bouncer, yorker; arm ball, top-spinner, wrong'un). Change-ups are chosen without repeats and weighted by the pitch
  (bouncers on hard pitches, cutters on green and turning ones). A bouncer aims to arrive between 1.48 m and 1.66 m
  (seeded), its length solved for this bowler, speed, line, seed and pitch.
- Beginners: the first ball is a stock ball, two change-ups are never bowled back to back, at most one bouncer or
  yorker is bowled, only one change-up is bowled, and at Learn the spinner's wrong'un and the bouncer are left out.
- Honest speeds (km/h, the number the screen shows is the speed the physics bowls): pace stock balls controlled
  120–130, fast 131–141, express 142–152 (`PACE_BANDS_KPH`); spin stock balls finger 80–90, wrist 76–86. Learn bowls
  genuinely slower: pace 100–114, spin 75–78 (the bottom of `SPIN_KPH`). Variations are relative to the stock ball
  (cutter ×0.91, slower ball ×0.80, flighted −7, quicker +8, arm ball +5 …), each with a jitter of up to ±1 km/h.
- Each ball's physics seed is `ballSeed(over, i)`, the first 128 bits (hex) of SHA-256 of the over seed and the index.

### The guided first over (`guidedStart`)

A non-scoring warm-up stock ball (just outside off stump on a good length, Learn pace, its own seed), then the guided
over that counts: a Learn-pace right-arm bowler on a balanced pitch bowling stock balls and his natural swing only
(source `guided`).

### Build an Over

- One family and bowler for the whole over (`bowlerFor`); `variationsFor(family, spinType)` lists the deliveries.
- Each ball is a tap on the pitch map (`targetFromTap`: across from the leg-side edge to the off-side edge, up from
  the striker's stumps to 11 m) and a variation; `buildBall` clamps the target to the legal area (and to the right
  length for a yorker) and sets the honest speed for the variation and band (Learn slower).
- Six balls are locked with `buildOver`, in the exact order or shuffled once (seeded Fisher–Yates), and validated.
  Each bouncer's length is solved on the innings' pitch to arrive at 1.57 m (its tapped line is kept). Until it is
  locked any ball can be edited or replaced; after it is locked the over is fixed.

## Field layouts (`autoField`)

The automatic field depends on the bowler (mirrored into the striker's frame for a left-hander) and the pitch, and is
deliberately classic: a ring that saves singles with clear gaps, one or two boundary riders, and close catchers only
where the conditions bring edges or bat-pad chances. Bearings are from the striker (0 = straight, + = off side) and
distances in metres from the physics' `STRIKER_REF` (the front of his popping crease, the renderer's reference too);
boundary riders stand 4 m inside the 62 m rope.

| Field | Close | Ring | Deep |
| --- | --- | --- | --- |
| Pace, balanced (and turning) | keeper back, 1 slip | point 97°/21, cover 63°/23, mid-off 21°/25, mid-on −21°/25, midwicket −62°/23, square leg −97°/21 | third man 132°, fine leg −148° |
| Pace, green | keeper back, 2 slips, gully 122°/14 | point, cover, mid-off, mid-on, square leg | fine leg |
| Pace, hard and bouncy | keeper further back, 1 slip, gully 120°/14 | point, cover, mid-off, mid-on, midwicket | deep square leg −100°, fine leg −150° |
| Spin turning in (off-break), balanced | keeper up, 1 slip | point 95°/19, cover 62°/21, mid-off 20°/22, mid-on −20°/22, midwicket −60°/21, square leg −95°/19 | deep midwicket −52°, long-off 12° |
| Spin turning in, turning pitch | keeper up, 1 slip, short leg −100°/5 | point, cover, mid-off, mid-on, midwicket, square leg −112°/19 | deep midwicket |
| Spin turning away (leg-break), balanced | keeper up, 1 slip | as above | deep cover 66°, long-on −12° |
| Spin turning away, turning pitch | keeper up, 1 slip, silly point 78°/4.5 | as above | deep cover |

The keeper stands 9 m (controlled), 12 m (fast) or 15 m (express) behind the stumps for pace, 2 m further back on a
hard pitch, and 0.8 m behind them for spin. The bowler starts from the end of his follow-through. A spinner turns the
ball in to the striker (off-break) when he is a right-arm finger or left-arm wrist spinner, away otherwise.
`validateField` checks eleven fielders with one keeper and one bowler, unique ids, contract roles, everyone inside the
rope and nobody but the keeper and bowler on the pitch.

## Fielding model (`simulateFielding`)

Deterministic, with no random numbers: a pure function of the field and the struck ball's trajectory (sampled at the
integrator's fixed step until the ball stops or reaches the rope).

Each fielder reacts, then runs straight to where he can take the ball, accelerating to his top speed:

| Class | Reaction (s) | Accel. (m/s²) | Top speed (m/s) | Catch reach feet / dive (m) | Highest catch feet / dive (m) | Stop reach feet / dive (m) | Throw (m/s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keeper | 0.15 | 6.0 | 6.5 | 1.1 / 2.6 | 2.4 / 1.8 | 0.9 / 2.3 | 18 |
| Close catcher (slip, gully, short leg, silly point) | 0.18 | 5.0 | 6.5 | 0.95 / 2.3 | 2.3 / 1.6 | 0.75 / 1.9 | 20 |
| Ring | 0.28 | 5.5 | 7.5 | 0.95 / 2.3 | 2.5 / 1.6 | 0.75 / 1.9 | 25 |
| Deep (over 38 m from the striker) | 0.32 | 5.5 | 8.0 | 1.0 / 2.4 | 2.6 / 1.6 | 0.8 / 2.0 | 27 |
| Bowler (in his follow-through) | 0.30 | 4.5 | 7.0 | 0.9 / 2.1 | 2.4 / 1.5 | 0.75 / 1.8 | 22 |

- **Catches.** A catch is possible while the ball is still in the air (before its first bounce after the bat), inside
  the rope, between 0.12 m and the fielder's highest catch (a dive takes balls from 0.08 m up to his diving height).
  A fielder can take it at time t if the ground distance to the ball, less his reach, is no more than the distance he
  can run by t. The earliest fielder who can get there takes it; a team-mate who can take it on his feet within
  0.35 s of a dive calls for it. A diving fielder dives where the ball is least stretched for.
- **Drop rule (honest and deterministic).** A chance goes down when the ball arrives faster than the fielder can hold
  (feet / dive, m/s: keeper 40/34, close 37/31, bowler 32/26, ring 33/26, deep 30/24), when a dive needs more than
  80 % (keeper), 70 % (close) or 65 % (others) of the extra dive reach, when the fielder has less than 0.12 s between
  his reaction and the ball arriving (keeper and close catchers excepted), or when a ball below 0.3 m arrives faster
  than 22 m/s (keeper excepted). The dropped ball falls at his feet; he gets up and picks it up (0.9 s, 1.4 s after a
  dive). The result records why (`too_fast`, `full_stretch`, `no_time`, `low_and_fast`).
- **Ground fielding.** After the first bounce, the earliest fielder to reach the ball's path stops it, on his feet if
  he can (taking balls bouncing up to 2 m) or with a dive (balls below 0.7 m) if that is at least 0.25 s sooner. A ball
  that comes to rest is collected by whoever gets there first. Nobody reaching it before the rope means a boundary.
- **The return.** Ball in hand after 0.55 s (clean stop), 1.1 s (diving stop) or 0.7 s (collecting a still ball); it
  then goes to whichever set of stumps it reaches first with the keeper or bowler there to take it (each needs to run
  to his stumps and be set, 0.2 s). A keeper or bowler who fields it himself can run it to his own stumps. The throw
  is a ballistic arc at the thrower's average horizontal speed. The moment the ball is back at the stumps is the
  return time the batters' running is judged against, and the moment the ball is dead.
- **The keeper** takes every ball that passes the bat (moving across, or diving if it is beyond his reach); there are
  no byes, so the ball is dead in his gloves.
- **Paths.** Every fielder gets a `FielderPath` from release to the end of play: set, run, dive, catch / drop / pickup,
  throw, idle or celebrate. The nearest team-mate backs up the fielder going for the ball, the keeper and bowler run
  to their stumps for the throw, and the two nearest fielders chase a ball heading for the rope.

## Running model (`autoRuns`)

The batters run automatically: never a Run, Cancel or Dive control, and never a run-out. A run is completed only if
the batters would make their ground at least 0.45 s before the ball is back at the stumps. Run times come from a
sprint model of a batter in pads with a bat: 0.35 s to finish the stroke and call, then 5.5 m/s² up to 7.5 m/s over
16.5 m (17.68 m between the popping creases less the bat stretched over the line), plus 0.15 s per turn: about 3.2 s
for one run, 6.3 s for two and 9.3 s for three. At most three are run; a boundary scores 4 or 6 whatever was run.

## Scoring and dismissals (`judge`)

The one pipeline, in this order:

1. **Bowled**: the delivery hits the stumps without touching bat or batter (including a ball the batter left), or it
   is played on: after an edge (or a dead-batted block) the struck ball runs or flies into the striker's stumps. The
   stumps test is swept across each integration step, so a fast deflection cannot pass through them.
2. **Off the pad, or LBW**: the delivery hits pad or body first. Its rebound is carried on by the integrator; if it
   runs or deflects onto the stumps it is **bowled** (Law 32), whatever the LBW verdict. Otherwise the delivery
   physics' LBW law (`lbw.ts`, see `docs/PRACTICE_PHYSICS.md`) decides; not out is a dead ball (no leg byes). The
   decision (out, reason, impact point, projected point at the stumps) is kept in `DeliveryResult.lbw` for the
   diagnostic replay, and its reason in `Coaching.lbw` so a not-out card can say why (for example
   `pitched_outside_leg`, `missing`).
3. **Caught**: the struck ball is caught before it bounces (fielding model above). By the keeper, or by a slip off an
   edge: `caught_behind`. By anyone else: `caught`. A dropped chance is not out.
4. **Boundary**: the struck ball reaches the rope: 6 if it never touched the ground, otherwise 4.
5. **Runs**: otherwise the runs the batters safely completed (0–3).
6. A ball that never touched the bat and missed the stumps and the batter is taken by the keeper: 0, dead.

### Regions

`regionOf(bearing)` (bearing from the striker, + = off side): `straight` within 8°, `behind` beyond 165°, otherwise
mid-off / mid-on up to 40°, cover / midwicket to 80°, point / square leg to 115°, third man / fine leg beyond. The same
function classifies where the player aimed (`intendedBearingDeg`), where the ball went and the coaching zone.

### Coaching reasons

Each reason is chosen from what physically happened and can be explained with the measured facts
(`coachingFacts(result)` in `src/practice/game/coaching.ts`: timing error, aim against exit bearing, the movement in the
air and off the pitch measured by the delivery physics (`flightMovement`), the fielder, the return time).

| Reason | When |
| --- | --- |
| `cleared_the_rope` | Six (zone = where it went) |
| `found_the_gap` | Four with no fielder within 2.5 m of stopping it, or 1–3 runs (zone) |
| `beat_the_field` | Four that a fielder got within 2.5 m of stopping, or runs after a dropped chance (fielder named) |
| `hit_to_fielder` | Good contact, fielded, no run (fielder named) |
| `solid_defence` | A defensive stroke met on time, no run |
| `caught_in_the_ring` / `caught_in_the_deep` | Caught from a good stroke, inside / beyond 38 m |
| `edged_behind` / `edged_to_slip` | Edge caught by the keeper / a slip or gully |
| `mistimed_lofted` | A lofted stroke mistimed and caught, or fielded without a run; a top edge caught off a ball that was not short |
| `too_early` / `too_late` | The timing was off (beyond the solid window, by its sign) and nothing else explains it better; never for a miss or edge timed perfect or solid |
| `beaten_by_pace` | Late against pace of 140 km/h or more |
| `beaten_by_seam` / `beaten_by_turn` | The ball deviated 5 cm or more off the pitch (pace / spin) the way it beat the bat; for a swing timed right, any deviation that way (from 0.5 cm) |
| `beaten_by_swing` | The ball moved 10 cm or more in the air the way it beat the bat (spin drift of 8 cm counts as turn); timed right, from 1 cm |
| `beaten_by_bounce` | The ball passed over the bat (`miss.delta`), was 1.0 m or higher at the bat, or pitched 7.5 m or shorter; a top edge caught off such a ball |
| `played_across_the_line` | A leg-side swing at a ball 6 cm or more outside the line of middle, a cut at a straight ball, a leading edge caught, LBW playing across, or a miss timed right with no movement to blame |
| `missed_straight_ball` | The bat missed a ball that was going on to hit the stumps |
| `left_well` | Left a ball that missed the stumps (or hit the pad not out) |
| `left_and_bowled` | Left a ball that hit the stumps |
| `pad_in_line` | Out LBW |

Coaching `timing` is `on_time` for perfect or solid contact, otherwise `early` or `late` by the sign of the timing
error, and `null` for a leave. "The way it beat the bat" uses the strike's miss geometry (`miss.delta`, ball minus bat
at the closest approach: over it, or past the off or the leg side of it) or the edge it took (outside edge = off side,
inside edge = leg side): a ball that seamed away but beat the inside of the bat was not beaten by the seam.

## LBW

LBW is decided by the delivery physics (`lbw.ts`) from the pad or body impact and the projected path of the ball:
the scoring takes its verdict as given and never second-guesses it. Out is `lbw` with the reason `pad_in_line` (or
`played_across_the_line` when the swing went across the line); not out is a dead ball with no runs. Either way the
ball's rebound off the pad or body is simulated (`simulate` with the impact's `vOut` and `spinOut`) for a second, and
a rebound onto the stumps is bowled. A leave is played from the stance, so a ball on leg stump left onto the pad is out
LBW and one sliding down leg is not out (`missing`).

## Replay representation

The one replay representation is the contract's `DeliveryRecord`: the delivery (plan, seed, bowler, pitch, field),
the settings that change the physics (handedness, assistance, the performance tier's extra tolerance) and the
`NormalizedSwing` (or null for a leave), plus the result summary (runs, dismissal). `replayDelivery(record)`
re-simulates it through the same `resolveDelivery` and reproduces the original `DeliveryResult` exactly, deep-equal:
the same contact, trajectory, fielding, events and score. `PRACTICE_SIM_VERSION` is recorded and bumped whenever a
rule or physics change could alter a replayed outcome; an innings saved under another version is discarded by the
store. "Replay This Over" re-simulates the over's records (`replayOver`); `verifyRecord` checks a record's summary.

"Practice This Delivery" (`repeatDelivery(record, swing)`) bowls the same delivery (same plan and seed, same field)
with a new swing in a training context that never touches the innings.

## Save-scumming protection

- The over is fixed before the first ball and each delivery's flight is fixed before the batter acts.
- `deliveryStarted` sets `inFlight` the moment a delivery starts, and the store saves it before the ball is bowled.
- `resumeInnings` resolves an in-flight delivery as a **leave** through the physics, deterministically: quitting or
  killing the app mid-ball never earns a second attempt, and a ball that was going to hit the stumps still bowls you.
- A resolved record must be the started ball of the current over, so a delivery cannot be resolved twice or swapped.
- Replays and repeats are non-scoring; abandoning ends the innings.

## Summaries

- Over (`overSummary`): runs, balls, fours, sixes, dots, timing distribution (perfect, solid, mistimed, missed, left),
  scoring areas (runs and balls per region), the weakest delivery (a wicket, then a miss or a pad, an edge, a mistimed
  stroke…, earliest on a tie) and any dismissal.
- Innings (`inningsSummary`): score, balls faced and overs notation ("3.4"), completed overs, balls survived, fours,
  sixes, dots, strike rate, timing and scoring areas overall, every over's summary, and the dismissal (how, why, the
  fielder, the ball number and its overs notation).

Both accept already-resolved results (to avoid re-simulating) and otherwise re-simulate from the records.

## Checking the scoring against the physics

`node scripts/practice-scoring-check.mjs [--n=4000] [--json=out.json]` runs many deliveries (random overs on every
pitch and assistance level) against six scripted strokes each (a well-timed drive into the widest gap, a drive at a
ring fielder, a well-timed lofted hit, a mistimed stroke 70–120 ms off, a defensive block, a leave) through the real
pipeline, prints the outcome distribution per stroke (runs, dismissals, contact, coaching reasons), and checks the
evidence that the score came from the physics: every six crossed the rope on the full and every four after a bounce;
every catch was taken before the ball bounced by a fielder whose path reaches it; runs equal the run events and every
run was completed with the safety margin before the ball came back; moving the nearest fielder onto the line of a
boundary drive turns the very same stroke into something else; replays are byte-identical. It reports the share of
well-timed attacking strokes that leave the bat within 10° of the intended bearing, and exits non-zero if any
evidence check fails.

## Known limitations

- No byes, leg byes, wides, no-balls, stumpings or run-outs (by design for this slice).
- Fielders run in straight lines and never collide; a dropped catch always falls at the fielder's feet.
- Throws are always accurate; the batters' running assumes a perfect return to the stumps (hence the safety margin).
- The fielding constants are calibrated to first-class standards, not measured from players.
