# Sealed Six — Game Rules (engine v1)

Root decisions in sections 1, 2, 7 and 8 are frozen. The gameplay workstream owns the numbers; every number here is
the value in `src/engine/v1/tables.ts` and is justified by the 100,000-match simulation (section 12). Any change that
can alter an outcome becomes a new engine version (section 8); v1 is frozen by a golden replay fixture.

Sign convention used everywhere below: a factor is **+ when it helps the batter** and **− when it helps the bowler**.

## 1. A match

- Two one-over innings. Each player bowls one sealed six-ball over and bats against the opponent's sealed over.
- An innings is six balls; it is over early when two wickets fall. **To keep wickets sealed, the batter always faces
  all six balls and then the Super Ball**: balls after the second wicket are *dead balls* — bowled and answered as
  usual, with normal timing and contact feedback, but they score nothing, never take a wicket and are left out of the
  scorecard and the replay. No extras in v1: a badly executed ball becomes a *loose ball* (easier to hit) instead of a
  wide or no-ball, so every over is exactly six deliveries.
- Both innings are played asynchronously and independently; neither batter knows the other's score (it is sealed).
  During your own innings you do not see your runs or wickets either — only how you timed it and how you connected.
- **Result**: more runs wins. Tie → each player's precommitted **Super Ball** is bowled to the other (played as the
  seventh ball of each batting innings, always faced, counted only on a tie); more Super Ball runs wins. Still tied →
  fewer wickets lost in the main innings wins → more boundaries (fours and sixes) in the main innings → a tie stands.
- **Player of the Match** (section 9): runs scored + 8 per wicket taken + 1 per dot ball bowled − ½ per run conceded,
  +4 for the winner, plus the Super Ball when it counted.

## 2. Sealing (fairness)

- The server generates a 128-bit match seed at creation and commits it before any plan is locked. **The seed stays
  secret until the reveal** (knowing it would let a client predict the draws).
- Locking an over: the server validates the plan, canonicalises it, adds a random salt, computes
  `SHA-256(canonical plan + salt)`, signs `matchId|player|hash|engine`, and stores the plan encrypted at rest. The
  commit hash is shown to both players. A locked plan can never change.
- Canonical plan: only the known fields (`v`, `field`, `balls`, `superBall`; per ball `variant`, `line`, `length`,
  `intensity`, `intent`, `gesture{pointer,samples}`), object keys sorted, no whitespace, numbers as JSON prints them
  (`canonicalPlan`). `commitHash` uses WebCrypto (`globalThis.crypto.subtle`) and falls back to the bundled SHA-256
  where WebCrypto is unavailable (identical result, tested against FIPS vectors and WebCrypto).
- At the reveal, plans and salts are published inside the replay log so anyone can recompute the hashes.
- The batter receives each delivery only when it is bowled (a signed, single-use ball token). The bowler's gesture,
  intent and execution stay sealed until the reveal.
- During batting the batter sees timing and contact feedback only. **Runs and wickets stay sealed until the reveal.**

## 3. Bowling

Per delivery the bowler chooses a delivery, line, length, intensity and intent, and performs the release gesture.
Once per over the bowler chooses the field. The batter sees the field from the first ball, and sees each delivery's
variant, line, length and intensity as it is bowled; **intent and execution stay hidden**.

| Delivery | Family | Lengths | Speed km/h (intensity 1 / 2 / 3) | Energy (1 / 2 / 3) | Character |
| --- | --- | --- | --- | --- | --- |
| Good length | pace | full, good, short | 126 / 136 / 145 | 1 / 2 / 3 | The honest stock ball. Seams on Green. |
| Yorker | pace | full | 128 / 138 / 147 | **3 / 4 / 5** | The premium weapon: deadly when perfect, a gift when loose. Best on Hard. |
| Bouncer | pace | short | 129 / 139 / 148 | 2 / 3 / 4 | Hurries batters on Hard; sits up on Slow; safe to leave. |
| Slower ball | pace | full, good, short | 100 / 108 / 115 | 2 / 3 / 4 | Deceives and grips on Slow. |
| In-swing | swing | full, good, short | 118 / 128 / 137 | 2 / 3 / 4 | Into the pads: LBW and bowled. Swings most on Green and humid days. |
| Out-swing | swing | full, good, short | 118 / 128 / 137 | 2 / 3 / 4 | Away from the bat: edges to the slips. |
| Off-spin | spin | full, good, short | 78 / 85 / 93 | 1 / 2 / 3 | Turns in; grips on Slow. |
| Leg-spin | spin | full, good, short | 76 / 83 / 91 | 1 / 2 / 3 | Turns away; edges and stumpings. |

- **Intensity**: pace and swing 1 change-up, 2 stock, 3 express; spin 1 flighted (more turn, invites the charge), 2
  stock, 3 quick and flat (smothers sweeps). Higher intensity is faster and harder to time, and costs 1 more energy.
- **Line**: wide outside off, off stump, middle, leg. **Length**: full, good, short (a short spinner is a long hop; a
  short swing ball barely swings).
- **Intent** (hidden): *attack* hunts wickets (wicket chances ×1.25) but leaks more boundaries (×1.1); *contain* dries
  up runs (boundaries ×0.8, wickets ×0.8); *setup* is a sighter for the next ball (wickets ×0.75, boundaries ×1.15) and
  pays off only when the **next ball is an attacking ball that contrasts with it** (section 5.5).
- **Energy budget: 15** for the six main balls. The most expensive ball, an express yorker, costs 5 (six of them would
  need 30); even six stock yorkers (24) or six stock swingers (18) do not fit. The **Super Ball** has its own
  allowance: any delivery costing **at most 3**.
- **Unlocks**: Good length, Yorker, Bouncer and Off-spin from the start; the other four are earned by bowling in an
  official match (a Friend Duel or a Group Cup), never bought (`UNLOCKS`, `unlocksEarned(log, player)` in
  `src/engine/advice.ts`):

  | Delivery | Earned by |
  | --- | --- |
  | Slower ball | an over that concedes 6 runs or fewer (the batter played every ball) |
  | In-swing | a batter bowled or LBW |
  | Out-swing | a batter caught |
  | Leg-spin | a wicket with Off-spin |

  Run-outs are not the bowler's; nothing counts from an Auto Over or off balls Auto XI batted. The platform calls
  `unlocksEarned` when an official match is revealed and adds the result to the player's unlocks. Unlocks add
  variety, never statistical power: the simulation's best starter-only over is within 0.42 runs of the best over with
  everything unlocked on every pitch (section 12).

### 3.1 Fields

| Zone | Attacking | Balanced | Sweeper |
| --- | --- | --- | --- |
| Third man | gap | deep | deep |
| Point | ring | ring | deep |
| Cover | ring | ring | deep |
| Mid-off | ring | **gap** | ring |
| Mid-on | ring | ring | **gap** |
| Midwicket | ring | **gap** | deep |
| Square leg | ring | ring | ring |
| Fine leg | gap | deep | deep |
| Slips catch a thin edge | 50 % | 35 % | 12 % (keeper only) |
| Close catchers take a defensive edge | 8 % | 3 % | 0 % |

Where the nine fielders stand for display (the field map and the 3D view) is `FIELD_POSITIONS`
(`src/engine/fieldDisplay.ts`, exported from `@/engine`): a bearing from the striker (0 = straight, positive = off
side) and a distance in metres, in the renderer's convention. It matches this table exactly — a ring fielder inside
the circle for every ring zone, a boundary rider for every deep zone and nobody at all in a gap — plus two slips and a
gully (attacking) or one slip (balanced), who catch edges and cover no zone. `tests/unit/engine/fieldDisplay.test.ts`
checks the coverage, that every fielder stands inside its zone for the batting swipe and for the renderer, and the
distances.

*Gap*: nothing there — runs, and fours for well-timed shots. *Ring*: an inner fielder stops ground shots (mostly dots
and singles) and catches mistimed lofts, but a powerful shot can beat him. *Deep*: a boundary rider gives easy ones
and twos, cuts off most fours and catches mistimed lofts. **Attacking** catches edges but has no one in the deep;
**sweeper** stops fours but leaks singles and twos and almost never catches an edge; **balanced** sits between.

### 3.2 Execution: the release meter

The bowler's gesture is performed while planning, once per delivery (the UI allows no retries). Press and hold: a
needle rises linearly from 0 % at the press to 100 % at 1,000 ms; the sweet spot is at **800 ms**. Release:

- quality = `clamp(1 − |release − 800 ms| / 160 ms, 0, 1)`, rounded to 3 decimals;
- **perfect** within ±24 ms (quality ≥ 0.85), **good** within ±80 ms (≥ 0.5), otherwise **loose**.

What the grade does to the ball (the *execution factor*, applied to the batter's shot):

| Grade | Effect |
| --- | --- |
| Perfect | the ball hits its mark: −0.45 × precision (yorker 1.2, bouncer/slower/swing 1.0, good length/spin 0.9) |
| Good | as planned; a good-but-not-perfect yorker is a touch full (+0.2 for attacking shots) |
| Loose | a gift: +0.75 × severity (yorker 1.3, slower/leg-spin 1.2, bouncer 1.1, swing/off-spin 1.0, good length 0.8) × line (wide outside off 1.3, leg 1.1); full effect for attacking shots, 60 % for a rotate, 30 % for a defence |

In the replay a loose ball visibly misses its mark (over-pitched, dragged short or drifting on the pads).

## 4. Batting

Per delivery the batter chooses a shot (defend, rotate strike, drive, cut or pull, sweep, loft, or leave), a target
zone and taps for timing. The batter sees the field, the delivery as it is bowled and how many balls are left — not
the score, not wickets, not the bowler's intent or execution.

| Shot | Legal zones | What it is for |
| --- | --- | --- |
| Defend | — | Survive a dangerous ball; about 1 in 6 runs a single. Protects the wicket (edge/lbw/bowled chances ×0.35). |
| Rotate | all eight | Work a single or two into space; low risk (×0.6). On the last ball the batters run on anything. |
| Drive | point, cover, mid-off, mid-on, midwicket | Front foot to full and good lengths, along the ground. |
| Cut / pull | third man, point, cover, midwicket, square leg, fine leg | Back foot to short and wide balls. |
| Sweep | third man, point (reverse), midwicket, square leg, fine leg | Against spin and full balls; LBW risk if missed. |
| Loft | all eight | In the air for four or six; needs the right length *and* timing, otherwise it is caught. |
| Leave | — | Zero runs. Totally safe outside off stump; dangerous on the stumps (bowled/lbw). |

**Play with the line.** Each shot has natural zones for each line (e.g. drive: wide → point/cover, off stump →
cover/mid-off, middle → mid-off/mid-on, leg → mid-on/midwicket; short balls are lofted only as hooks to the leg side or
upper-cuts over point and third man). Aiming elsewhere is allowed but plays across the line: matchup −0.3 and higher
LBW/bowled risk. `NATURAL_ZONES` and `LEGAL_ZONES` are exported from `@/engine` for the UI.

**Timing.** Every revealed delivery carries its flight time and timing windows (half-widths around the ideal contact
moment). The tap error grades as **perfect** (within ± perfect), **good** (± good), **early/late** (± edge),
**very early/very late** (beyond), or **no shot** (no tap). Windows: perfect = 30 ms (pace), 32 ms (swing), 34 ms
(spin) × intensity (1: 1.10, 2: 1.00, 3: 0.88) × delivery (yorker 0.9, slower and bouncer 0.95) × pitch (Hard 0.95,
Slow 0.85) × weather (dew 1.05); good = perfect × 2.6; edge = good × 2.

| Delivery (stock) | Flight Green / Hard / Slow | Windows on Green: perfect / good / edge |
| --- | --- | --- |
| Yorker | 493 / 473 / 522 ms | ±27 / ±70 / ±140 ms |
| Good length | 515 / 495 / 546 ms | ±30 / ±78 / ±156 ms |
| Bouncer | 540 / 518 / 572 ms | ±29 / ±74 / ±148 ms |
| Slower ball | 649 / 623 / 688 ms | ±29 / ±74 / ±148 ms |
| In-swing / Out-swing | 548 / 526 / 580 ms | ±32 / ±83 / ±166 ms |
| Off-spin | 870 / 835 / 922 ms | ±34 / ±88 / ±177 ms |
| Leg-spin | 891 / 855 / 944 ms | ±34 / ±88 / ±177 ms |

The express yorker on Hard is the hardest ball to time: 444 ms flight, perfect window ±23 ms.

### 4a. Input gestures (the UI must produce exactly these traces)

**Bowling execution — the release meter** (section 3.2). The trace is every pointer sample from the press (`t = 0`)
to the release (the last sample): 2–120 samples, 40–1,500 ms long. The pad may be dragged (a run-up) but movement is
optional. Keyboard: hold Space, samples at a fixed point. `EXECUTION_METER` is exported for the UI.

**Batting — swipe and release.** The trace is the pointer path of the shot; the finger lift (last sample) is the timing
tap, and `tapMs` is measured from the rendered release to that lift. Surface coordinates are batter's-view: x to the
right = off side of the right-handed batter, y downwards, "up the screen" = towards the bowler. The swipe direction
(first → last sample) picks one of eight 45° sectors, clockwise from straight up: mid-off, cover, point, third man,
fine leg, square leg, midwicket, mid-on (`zoneFromSwipe` / `swipeVectorForZone`). A swipe of at least 0.06 surface
units must agree with the chosen zone within one sector (keyboard exempt; tap-only traces from zone buttons are
accepted). Defend and leave have no zone. `tapMs` must be within `[0, releaseToContactMs + 600]` (no taps before the
release); `clientElapsedMs` must be at least `tapMs`, at least the trace duration and at most 10 minutes; a tap needs at
least one trace sample.

**Every trace** (both gestures) is rejected for: timestamps not strictly increasing (non-monotonic or duplicated),
a first sample not at `t = 0`, coordinates outside 0..1 or non-finite, more than 120 samples, teleports (faster than 3
surface widths per 100 ms between samples), durations outside the bounds above (batting traces at most 4,000 ms), an
unknown pointer type, and robotic patterns (six or more samples with perfectly constant intervals *and* perfectly
linear motion). A plan is also rejected when six or more of its seven releases land within ±2 ms of the sweet spot
(superhuman consistency) or when it reuses an identical gesture of four or more samples.

### 4b. Interrupted and dead balls

- **A ball you see and don't play is a leave; only a ball never answered is a safe dot.** A delivery the batter faces
  without making a shot before the late limit (the app sends the chosen shot with no tap, or a Leave) is graded
  `no_shot` and resolved as a leave: safe outside off stump, but a straight ball can bowl the batter or trap them LBW.
  Only a ball revealed but never answered at all (the app closed, the connection lost past the live window, the batting
  deadline reached, or too many invalid answers) resolves as a safe dot: timing `interrupted`, never a wicket.
- Those settlements are not free in ranked play: an **expired or invalid settlement counts against eligibility exactly
  like a late answer**. More than one late, expired or invalid answer in either innings makes the match ineligible for
  the Daily Top 100 (section 14.2; the platform passes all three in the late count).
- After the second wicket the remaining main balls are **dead**: the batter still faces and answers them, the
  feedback (timing, contact) is computed exactly as for a live ball, but they score nothing and are left out of the
  innings summary and the replay. The Super Ball is always live.

## 5. Outcome model

Each ball is resolved from the shot-vs-delivery **matchup**, **timing**, the bowler's **execution**, **pitch** and
**weather**, the **field** in the target zone, shot **risk**, **sequencing** (set-ups and repeats) and the innings
situation (**new batter**, **last ball**). The engine builds the complete probability distribution of results, then
one seeded draw picks the result. Every factor is reported in the tactical explanation.

### 5.1 Contact (stage 1)

- **Matchup** `m` (−1..1): shot vs length + shot vs delivery + shot vs line + intensity (+ long-hop bonus for short
  spin, −0.3 against the line). Examples: drive a half-volley outside off +0.6, cut a wide off-spin long hop +0.8,
  pull a bouncer on middle +0.15 (on leg +0.35), loft a yorker −0.25, drive a bouncer −0.95.
- **Situational advantage** `A` = execution + 0.8 × pitch + 0.6 × sequencing − 0.2 on a new batter's first ball.
- **P(middle)** = base by timing (perfect 0.88, good 0.74, early/late 0.42, very early/late 0.12) + shot ease (defend
  +0.10, rotate +0.05, drive 0, cut/pull −0.02, sweep −0.03, loft −0.06) + 0.25 × m + 0.25 × A, clamped to 3–96 %.
- The rest splits into thick edge, thin edge, pad and clean miss by shot (e.g. loft: mostly skied thick edges and
  misses; sweep: pads), delivery (out-swing and leg-spin find edges, in-swing and off-spin find pads, yorkers pads and
  stumps, bouncers top edges), timing (early → leading/thick edges, late → thin edges and pads), pitch (Green: more
  thin edges; Slow: more thick edges and pads) and line (wide balls are missed, never padded).

### 5.2 Result (stage 2)

- **Power** of a middled shot = 0.25 + 0.45 × timing power (perfect 1, good 0.55, early/late 0.15) + 0.4 × m + 0.25 × A
  + pitch (Hard +0.1, Slow −0.1) + pace on the ball (express +0.06, change-up −0.04, flighted +0.04, flat −0.03).
- **Ground strokes** (drive, cut/pull, sweep): four chance = a + b × power² by the zone's coverage — gap 0.14 + 0.65 p²,
  ring 0.06 + 0.45 p² (2 % uppish catch), deep 0.04 + 0.25 p², ring + deep 0.02 + 0.06 p²; otherwise ones, twos and
  threes in a gap, dots and singles at a ring fielder, ones and twos to a deep fielder.
- **Rotate**: mostly singles (gap: 54 % ones, 36 % twos; ring: 72 % ones, 20 % dots); run-out 2 % (×1.5 at a ring
  fielder, ×0.5 in a gap, +4 % if mistimed). **Last ball and Super Ball scramble**: a fielded dot becomes a single
  (80 %) or a run out (20 %).
- **Loft**: clearance c = power + 0.4 × m. Six chance = 1.25 × (c − 0.25), capped at 60 % (halved to a deep fielder);
  four chance = 0.12 + 0.35 × (c − 0.2) (halved to a deep fielder); caught = base + miss × (1 − c)² (gap 0.02 + 0.28,
  ring 0.04 + 0.43, deep 0.12 + 0.53; ×1.4 on Green for balls 1–3).
- **Edges**: thin edges are caught by the slips per field (×1.15 Green, ×1.1 Hard, ×0.85 Slow; ×0.8 off spin;
  defensive edges ×0.35), else race fine or are stopped; thick edges are caught at gully/point (drive), fine leg or
  third man (top-edged pull or sweep, more when a deep fielder is there), or skied (loft: 20–45 % caught).
- **Pad**: LBW = line (off 0.22, middle 0.32, leg 0.06, wide 0) × length (full 1.2, short 0.2) × delivery (in-swing
  1.35, yorker 1.25, off-spin 1.2, leg-spin 0.7, out-swing 0.6, bouncer 0) × shot (sweep 1.25, cut/pull 0.7) × pitch
  (Slow 1.15, Hard 0.8) × shot exposure × 1.3 across the line.
- **Miss**: bowled = line (off 0.30, middle 0.42, leg 0.08, wide 0.01) × length × delivery × pitch × exposure, or
  **stumped 45 %** when a batter charged a spinner (drive or loft to a flighted or full spinner) and missed.
- **Leave**: would hit = line (off 0.08, middle 0.45, leg 0.03, wide 0) × delivery (in-swing ×2, off-spin ×1.6,
  yorker ×1.3, out-swing ×0.4, leg-spin ×0.5, bouncer 0) × length (short ×0.1) × pitch × execution; 55 % bowled, 45 %
  lbw.
- **Intent** multiplies every wicket and boundary chance (section 3); after a contrasting set-up the strike ball's
  wicket chances are ×1.2 more. All other results rescale so each distribution sums to 1.

### 5.3 Pitch and weather (factor `pitch`, batter's view)

| Delivery | Green | Hard | Slow | Humid | Dew |
| --- | --- | --- | --- | --- | --- |
| Good length (seam) | −0.35 | +0.05 | +0.15 | −0.05 | +0.03 |
| In-swing / Out-swing | −0.35 | +0.05 | +0.10 | −0.15 | +0.03 |
| Yorker | 0 | −0.15 | +0.20 | 0 | +0.03 |
| Bouncer | 0 | −0.50 | +0.30 | 0 | +0.03 |
| Slower ball | +0.05 | 0 | −0.35 | 0 | +0.05 |
| Off-spin | +0.20 | +0.10 | −0.50 | 0 | +0.15 |
| Leg-spin | +0.20 | +0.05 | −0.45 | 0 | +0.15 |

Plus: on Green the new ball (balls 1–3) swings and seams 30 % more and 20 % less afterwards, and lofts are riskier
early; express pace is −0.1 on Hard and +0.1 on Slow; shot adjustments — Green drive −0.08, loft −0.1, cut/pull +0.05;
Hard cut/pull +0.1, sweep −0.1; Slow sweep +0.2, rotate +0.12, loft −0.35, drive and cut/pull −0.05. Short swing balls
keep only 30 % of their swing help. Weather is always shown and small.

### 5.4 Situation

- **New batter**: the first ball faced by each batter (ball 1, and the ball after the first wicket) is slightly harder
  (A −0.2).
- **Last ball** (ball 6 and the Super Ball): the batters run on anything (scramble, 5.2).
- **Wickets in hand** and **balls remaining** also shape decisions: the first wicket is cheap, the second ends the
  innings (later balls are dead), and the last ball costs nothing to lose — so batters can, and should, take more risk
  as the over runs out.

### 5.5 Sequencing

- **Set-up**: a set-up ball that was not loose, followed immediately by an *attacking* ball that contrasts with it —
  in length (short ↔ full), pace (18 km/h or more), movement (in-swing ↔ out-swing, off-spin ↔ leg-spin) or line (two
  lines apart) — gives the strike ball sequencing −0.5 and wicket chances ×1.2. No contrast, or a non-attacking next
  ball, pays nothing. Set-ups cannot chain.
- **Repeats**: each time the batter has already seen the *same* delivery (variant + length + line) in this over, the
  ball is easier: sequencing +0.25, +0.45, +0.6 (third repeat and beyond).

### 5.6 Factors and explanations

Every ball reports `matchup`, `timing` (perfect 1, good 0.55, early/late −0.25, very −0.75, no shot −1), `execution`,
`pitch`, `field` (ground shot: gap +0.6, deep +0.15, ring −0.35, ring + deep −0.6; loft: gap +0.7, ring +0.35, deep
−0.45, both −0.6; defend: attacking −0.25, balanced −0.1, sweeper +0.1), `setup` (sequencing) and `risk` (shot base:
leave 0.05, defend 0.08, rotate 0.2, drive 0.35, cut/pull and sweep 0.45, loft 0.65; +0.3 × bad matchup, +0.15 across
the line). The one-line `explainKey` names the factor that pushed the result hardest in its direction (weighted by
its real effect on contact and power); catches in the deep, slip catches, stumpings, run outs and leaves explain
themselves. All keys: `EXPLAIN_KEYS` (80); commentary keys: `COMMENTARY_KEYS` (34), both exported for i18n. Player-facing copy for every key lives in
`src/i18n/engine/<locale>.json` (section 15).

## 6. Presentation cues

Every outcome carries complete `BallCues`: bowler action (pace long/short run, swing side-on, off-spin, leg-spin), the
executed ball path, batter animation and footwork (forward, back, across for the sweep, charge down the track, still
for a leave), the ball's fate (zone, runs, bounce, six distance 64–104 m, wicket kind and fielder), crowd 0..1,
celebration, slow motion (wickets, sixes, last-ball and Super Ball boundaries), Key Moments membership and a camera
plan on a fixed timeline (run-up 1,300–2,200 ms by action, release, bounce, contact, aftermath, celebration).
`ballTimeline(outcome, conditions)` returns the release, bounce, contact and end times. At the reveal the match log
also upgrades the turning point, the winning hit (a milestone celebration), the last ball of a close finish and both
Super Balls to Key Moments in slow motion.

## 7. Interruptions and deadlines

- App closed or network lost mid-ball: a shot already made is queued and submitted idempotently (accepted as a late
  answer while the live window allows). **A ball you see and don't play is a leave** (it can be out if it is straight);
  **only a ball never answered is a safe dot** (dot ball, never a wicket). No match is lost to a suspension, but expired
  and invalid settlements count against Top 100 eligibility like late answers (at most one per innings, section 4b).
  `resolveNextBall` never throws on validated inputs and is idempotent once an innings is complete.
- Missed lock deadline in a Group Cup: **Auto Over** (a server-generated, starter-only, pitch-aware over with an
  ordinary release and no set-ups) is sealed for that player. It is deliberately never better than a typical player's
  over (simulation: it concedes 0.3–0.85 runs more than the median human-style over). Missed batting deadline: **Auto
  XI** bats the remaining balls with a cautious policy: it reads the ball, aims at a gap in the visible field half of
  the time and times the ball like a casual player (an average human beats it 66 % of the time). Late play after a
  deadline is allowed as unofficial practice. Neither Auto side ever moves a rating or counts for the Top 100.
- **Recognising stand-ins in a replay** (no log field needed): the platform keys each Auto XI proposal with
  `autoXiSeed(log.seed, seat, ball)` (`${seed}:auto-xi:${seat}:${ball}`), and Auto XI is deterministic, so
  `autoXiBalls(log)` finds the balls whose input is identical to Auto XI's proposal (a person cannot produce the same
  trace). An Auto Over is `commits[p].auto`; Training has `trainingAutoBalls` (section 16). The reveal labels all of
  these "Auto" (`auto.tag`). If the platform ever changes the Auto XI key, it must use `autoXiSeed`.

## 8. Determinism and versions

- Results are a pure function of (engine version, seed, conditions, both plans, validated inputs). Each ball draws
  from `sfc32` seeded by SHA-256 of `vande/v1/ball|seed|innings|ball`; exactly five floats are drawn per ball in a fixed
  order (result, two for the executed path, six distance, camera variety). Only basic arithmetic is used in anything
  that affects an outcome (no `Math.exp`/`Math.log`/trigonometry, whose last digits differ between JavaScript engines),
  and no `Math.random`, `Date`, DOM or Node API.
- Versioned rules registry (`src/engine/registry.ts`): every engine version that has replays stays registered;
  `verifyMatchLog` always uses the version recorded in the log. A rule change copies `v1/` to `v2/`, changes `v2`,
  bumps `ENGINE_VERSION` (root) and registers v2. The SHA-256, sfc32 and canonical-JSON primitives are frozen for all
  versions.
- `verifyMatchLog` recomputes both commit hashes, re-validates both plans and every stored input, re-plays both
  innings from the log's own seed and inputs and rebuilds the whole log; any difference fails.
- The golden fixture `tests/unit/engine/fixtures/golden-v1.json` (a normal duel, a Super Ball tie, an all-out innings
  with dead balls, unanswered balls) must verify forever; `node scripts/simulate-golden.mjs` checks it against the
  engine (never rewrite it for v1).
- `buildMatchLog` takes inputs in play order — one entry per resolved ball (balls 0–5 including dead balls, then the
  Super Ball), `null` where the ball was never answered; the log stores the answered inputs keyed by their own ball.

## 9. Results, Player of the Match and scores

- **Result ladder**: runs → Super Ball runs → fewer wickets lost → more boundaries → tie. `marginRuns` is the run
  difference (or the Super Ball difference); 0 for the later rungs.
- **Player of the Match** points = runs scored + 8 × wickets taken + 1 × dot balls bowled − ½ × runs conceded + 4 for
  the winner; when the Super Ball counted, + its runs − ½ × Super Ball runs conceded + 4 for a Super Ball wicket. Level
  → more runs scored → more wickets taken → a coin from the match seed.
- **Turning point**: the ball that moved the projected margin most towards the eventual winner (projected margin =
  runs so far + 1.9 per remaining ball with two wickets in hand, 1.6 with one).
- **Daily Six score** = 10 per run + 4 per four + 8 per six + 12 per wicket still in hand (max 432). Each daily
  attempt must use a fresh, secret server seed.
- **Top 100 components** (`matchPerformance`, each 0..1): *tactical efficiency* — half batting decisions (how close
  each shot and zone were to the best option for that ball, judged at good timing, with a wicket valued by the balls
  left) and half bowling choices (how hard each delivery was to score from compared with every delivery of the same
  energy cost and intent); *clutch* — results in the last two balls of each innings and the Super Ball when it counted
  (batting: runs; bowling: dots and wickets), +0.15 for winning a close match (≤ 3 runs or a tie-break); *execution* —
  half the bowler's mean release quality, half the batter's timing on shots played (perfect 1, good 0.75, early/late
  0.35, very 0.1).

## 10. Daily Six and Practice Ghosts

- **Daily Six** (`dailyChallenge(day, serverSalt?)`): three sealed overs — A pace and bounce, B movement and variety,
  C spin and guile — adapted to the day's pitch and always executed good or perfect (no hidden loose balls); weather is
  50 % clear, 25 % humid, 25 % dew. **With the server's secret salt** (official play) the weather, the overs and the pitch
  order are unpredictable from the client bundle; each pitch still appears exactly once in every block of three days.
  **Without a salt** it is the deterministic practice version a client can build offline (pitch = day number since 1970
  mod 3). In simulation a thinking batter of average timing scores A 104, B 104, C 97 on average.
- **Daily commits and replays**: `dailyCommits(day, serverSalt)` gives the three overs' commit hashes (salt derived
  one-way from the day, the attempt and the server salt) for the platform to publish, signed, when the day opens.
  `buildDailyLog` builds the solo replay (kind `daily`): players[1] is the Daily Six setter, the setter's over is the
  only plan, innings[1] is empty, no Super Ball, `result.decidedBy = 'forfeit_none'`, **`result.dailyScore` is the
  Daily Six score** and `result.marginRuns` is 0; the closing commentary is `commentary.daily_score`. `verifyMatchLog`
  checks the over against its commit, re-plays every ball, checks `dailyScore` and `marginRuns` (errors
  `result.daily_score`, `result.daily_margin_not_zero`) and rebuilds the log; the server salt never appears in a log.
  Duel and cup results never carry `dailyScore`. Each attempt still needs a
  fresh, secret server seed.
- **Ghosts** (`GHOSTS`, offline, deterministic plans and batting). Given the field (`ghostBat(id, seed, delivery,
  field)`), a ghost aims at the gaps with a probability that grows with its difficulty ("field sense"); without it, at
  its favourite zones. Difficulty comes from timing, execution and plans:

| Ghost | Difficulty | Bowls | Bats | Field sense | Average human wins |
| --- | --- | --- | --- | --- | --- |
| The Anchor (`anchor`) | 1 | tidy contain overs: good length, off-spin on Slow | defends and nudges, loose timing | 20 % | 79 % |
| The Swinger (`swinger`) | 2 | both-way swing, attacking field on Green/humid | drives handsomely | 40 % | 51 % |
| The Enforcer (`enforcer`) | 2 | bouncers and yorkers to a sweeper on Hard | swings hard at everything | 40 % | 49 % |
| The Trickster (`trickster`) | 3 | spin, slower balls and set-ups | sweeps and places into gaps, sharp timing | 70 % | 34 % |
| The Maestro (`maestro`) | 3 | the right plan for each pitch | reads the ball and the field | 90 % | 32 % |

## 11. Tactical cheat-sheet

The best shot for a batter of average timing against each kind of ball (share of lines and fields where it is the
best answer; value ≈ expected runs per ball after the wicket risk). Generated from the engine.

| Ball | Green | Hard | Slow |
| --- | --- | --- | --- |
| Yorker | drive it straight (or sweep fine), ≈1.6 | drive, ≈1.6 | drive or sweep, ≈1.6 |
| Full good-length ball (half-volley) | **loft**, ≈3.1 | **loft**, ≈3.7 | **loft**, ≈2.9 |
| Good length | cut or drive, ≈1.7 | cut or drive, ≈2.0 | **drive**, ≈1.8 |
| Short good-length | loft (hook/upper-cut) or cut, ≈2.4 | hook, ≈3.1 | **cut/pull**, ≈2.2 |
| Bouncer | hook or pull, ≈2.5 | hook or pull, ≈2.2 | hook or pull, ≈2.1 |
| Slower ball, good length | drive or cut, ≈1.8 | drive or cut, ≈1.8 | drive, ≈1.4 |
| Slower ball, full | loft, ≈2.7 | loft, ≈3.0 | drive or sweep, ≈1.7 |
| Swing, full | loft, ≈2.9–3.0 | loft, ≈3.5–3.6 | loft, ≈2.6–2.7 |
| Swing, good length | drive (in-swing) / cut or drive (out-swing), ≈1.6 | drive or cut, ≈2.0 | drive, ≈1.7 |
| Off-spin, full / short | loft, ≈3.7 | loft, ≈3.7 | loft or cut, ≈2.0–2.1 |
| Off-spin, good length | drive or sweep, ≈2.0 | drive or sweep, ≈2.1 | drive or sweep, ≈1.5 |
| Leg-spin, good length | cut or drive, ≈2.0 | cut or drive, ≈2.1 | cut or drive, ≈1.5 |

Rules of thumb:

- **Bowling.** Green: seam and swing, full and good lengths, an attacking field (edges carry), early. Hard: yorkers
  and bouncers, express pace, a sweeper or attacking field — but every half-volley is hit out of the ground. Slow: spin
  and slower balls, back of a length, a sweeper or balanced field; yorkers and pace lose their bite. Everywhere: mix
  your deliveries (repeats get lined up), pair a set-up with a contrasting attacking ball, bowl to your field (wide lines
  to a sweeper, straight lines to an attacking field), and remember your release — a loose yorker is a full toss.
- **Batting.** Read the length first: full → drive or loft, short → cut, pull or hook, yorker → squeeze it. Aim for
  the gaps you can see in the field and play with the line. Leave only wide balls. Be braver as the over runs out — the
  last ball costs nothing to lose. On Slow, keep the ball on the ground and sweep the spinners; on Hard, timing races
  away; on Green, beware the new ball.

## 12. Balance and fairness simulation

**Command** (Node 23.6 or newer runs the TypeScript engine directly; `scripts/simulate-loader.mjs` resolves `@/` and
extensionless imports):

```
node scripts/simulate-balance.mjs                    # 100,000 mixed matches + every experiment (~45 s on 10 cores; npm run sim)
node scripts/simulate-balance.mjs --matches=20000 --cell=600 --json=report.json
node scripts/simulate-golden.mjs                     # golden replay fixture still matches the engine (npm run sim:golden)
node scripts/simulate-ranking.mjs                    # Daily Top 100: grinding and collusion checks (~20 s, section 14)
npx vitest run tests/unit/engine                     # unit, property, determinism, golden and smoke-simulation tests
```

The script exits with status 1 when a hard check fails. Options: `--matches`, `--cell` (innings per experiment cell),
`--workers`, `--key` (changes every random draw), `--iterations` (optimiser), `--json`.

**Method.** Every match runs through the public engine API exactly like a real one (reveal → input → validate →
resolve → log), with every ball checked for impossible outcomes and one match in 500 fully audited (real commit
hashes, `verifyMatchLog`, and a tamper check). Players combine a batting strategy and timing skill (timing spread 95 /
55 / 30 ms, plus a capped bias after a change of pace) with a bowling strategy and release skill (spread 70 / 35 /
18 ms). Batting strategies: random shots, a thinking heuristic (reads the ball and the field), an oracle that picks
the best expected-value option for what it can see (never the sealed intent, execution, score or wickets), fixed shots
(always defend/rotate/drive/cut/sweep/loft), Auto XI and the five ghosts. Bowling strategies: random legal overs,
eleven hand-made archetypes (stock, pace barrage, yorker spam, bouncer spam, swing only, spin only, slower mix, contain
all, attack all, set-up combos, starter mix), an optimiser (simulated annealing over overs and fields against the
average oracle batter, per pitch and weather, with and without unlocks), Auto Over and the ghosts. Conditions are
uniform over 3 pitches × 3 weathers. Dominance experiments put each bowling policy against oracle batters (60 % average,
20 % skilled, 20 % unskilled) and each batting policy against a reference bowling mix, 1,500 innings per pitch.

**Headline results** (engine v1, key `v1`, 100,000 mixed matches, 1,162,871 balls):

| Measure | Result |
| --- | --- |
| Innings runs | mean 8.24, sd 5.08, median 8, 10th–90th percentile 2–15, max 36 |
| Wickets per innings | 0: 58.5 %, 1: 29.9 %, all out: 11.5 % (mean 0.53) |
| Per ball | dot 26.9 %, 1: 28.3 %, 2: 15.8 %, 3: 2.9 %, 4: 14.5 %, 6: 2.5 %, wicket 9.1 % |
| Boundaries per innings | 0.99 (0.85 fours, 0.15 sixes) |
| By pitch | Green 8.05 runs / 0.58 wkts, Hard 8.97 / 0.49, Slow 7.71 / 0.52 |
| By weather | clear 8.28, humid 8.04, dew 8.41 |
| Wicket kinds | caught 59 %, bowled 22 %, lbw 12 %, run out 5 %, stumped 2 % |
| By skill (oracle choices) | unskilled / average / skilled timing: Green 9.6 / 11.5 / 13.8, Hard 10.4 / 13.1 / 15.2, Slow 8.5 / 10.5 / 12.5 runs |
| Strategy | thinking batter 8.6, oracle 11.9, random 4.5, always-defend 1.0 runs per innings; a thinking player beats a random one 90 % |
| First player | seat 0 wins 49.9 % of decided matches (z = −0.61); identical players 50.5 % of 9,856 (z = 0.95) |
| Super Ball | needed in 6.2 % of matches; decided by runs 93.8 %, Super Ball 4.5 %, wickets 0.9 %, boundaries 0.3 %, tie 0.6 % |
| Impossible outcomes | 0; 200 full audits, 0 failures |
| Pitch adaptation | overs built for another pitch concede 15.5 % (Green), 35.2 % (Hard), 17.1 % (Slow) more |
| Single-over dominance | none (no pitch-blind over within 3 % of the best on every pitch) |
| Shot dominance | reading the ball beats the best fixed shot by 32.9 % (Green, best fixed: cut/pull), 18.2 % (Hard: loft), 25.6 % (Slow: drive) |
| Unlocks | best starter-only over concedes −0.20 / −0.14 / +0.42 runs vs the best over with all variants |
| Bowling execution | same over, unskilled / average / skilled release: Green 10.1 / 8.7 / 7.8, Hard 11.4 / 9.2 / 7.9, Slow 9.1 / 7.8 / 7.4 conceded |
| Skill | a skilled human beats an average one 66 % |

**What the simulation found and how it was fixed** (each loop: change the numbers, re-run, until every check passed):

1. *Lofting dominated* — the best response to 83 % of deliveries, even yorkers. Fixed by the clearance model (a loft
   needs the right length as well as timing), quadratic mishit catches, and hooks/upper-cuts as the only lofts off short
   balls.
2. *Defensive shots lost wickets* (9.5 % a ball) — shot exposure (defend ×0.35, rotate ×0.6).
3. *Execution and pitch barely mattered* — weights raised (execution 1.0, pitch 0.8, set-up 0.6) and the matchup given
   its own contact and power weights.
4. *Short or wide balls to a sweeper field everywhere* — deep fielders concede twos and some fours, the sweeper leaks a
   straight gap, hooks are rewarded, short swing balls barely swing, short spinners are long hops.
5. *Yorkers too strong for their price* — base energy 3, a good-not-perfect yorker is a touch full, and the yorker became
   a Hard-pitch weapon (+0.2 on Slow).
6. *Set-ups on every ball* — a set-up now pays only on the next attacking ball, needs a contrast and cannot chain; the
   set-up ball itself is a sighter.
7. *Repeats dodged by alternating* — repeats count every earlier sighting of the same variant, length and line.
8. *The Hard-pitch over looked best on every pitch* — partly an artefact (an uncapped change-of-pace bias in the human
   model and a scripted reference batter); the bias is capped at 40 ms, dominance is judged against oracle batters, and
   the yorker's pitch dependence was added. Now every pitch's own over wins there by 15–35 %.
9. *Unlocks gave a 0.67-run edge on Slow* — off-spin (a starter) made slightly stronger than the slower ball there.
10. *Auto Over was as good as a typical over* — ordinary release, no set-ups, plainer templates.
11. *Ghost difficulty out of order* — skills retuned so difficulty 1 < 2 < 3.
12. *Sealed wickets* — dead balls added (root contract); simulated batters no longer see the score or wickets.

The CI guard `tests/unit/engine/balance-smoke.test.ts` replays 2,000 mixed matches (about 5 s) and fails if scoring,
wickets, boundaries, ties, seat fairness, skill or strategy drift out of the tuned bounds.

## 13. Anti-cheat notes and known limits

- The revealed delivery includes the ideal contact time (the renderer needs it), so a modified client could tap
  perfectly. Single inputs cannot prove this; `timingAudit(pairs)` flags an innings with five or more taps within ±3 ms
  of ideal for the platform's rate limiting. Execution gestures have the plan-level superhuman and duplicate checks.
- Official Daily Six play must pass the server salt: without it the overs are computable from the client bundle (that
  unsalted version is only for offline practice). Executions are fixed good-or-perfect either way, and the per-attempt
  seed must be a fresh server secret.
- An unanswered ball is a safe dot (no match is lost to a suspension), so a player could close the app on a dangerous
  delivery to dodge it. Expired and invalid settlements therefore count against Top 100 eligibility like late answers
  (section 4b), and clients must resume a revealed ball from durable storage after a restart (Daily Six included).
- A daily replay reveals that over's intents to anyone who reads it; the day's overs are shared, so the platform should
  release attempt logs to other players only after the day closes (the player's own log can be shown at once).

## 14. Ranking: ratings and the Daily Top 100

`src/engine/ranking.ts` — pure and deterministic (basic arithmetic only; the Elo curve uses a bundled `exp`). The
platform feeds it; purchases, adverts and cosmetics are never inputs (the input types have no field for them, and
extra fields are ignored).

### 14.1 Rating (Elo)

- Everyone starts at **1200**; ratings never fall below 100.
- After a rated match each side moves by `K × (result − expected)`, with result 1 / ½ / 0 and
  `expected = 1 / (1 + 10^((opponent − you) / 400))` (difference capped at ±800).
- **K-factor**: 40 for a player's first 10 rated matches, 24 up to 30, then 16. Each side uses its own K.
- **Only real duels and cup matches are rated.** A match with an Auto Over or Auto XI side, late or practice play, ghost
  matches, Daily Six and training never move a rating (`isRated`, `updateRatings`).

### 14.2 Daily Top 100

**Eligible matches**: duels and cup matches with no Auto side, no practice or late play, at most one late, expired or
invalid answer in either innings (the platform counts all three in `lateAnswers`), and neither innings flagged by
`timingAudit`. Per day, only the **first two matches against the same
opponent** count, and only the **first five eligible matches** (in play order) are considered.

**Match score** (0–100):

```
100 × ( 0.25 × win + 0.15 × opponent strength + 0.20 × tactical′ + 0.10 × importance + 0.15 × clutch′ + 0.15 × execution′ )
```

- *win*: 1 won, ½ tied, 0 lost. *Opponent strength*: the Elo chance the opponent had of beating you, counted on a win
  (half on a tie) — beating a stronger player is worth more.
- *Tactical efficiency, clutch, execution* come from `engine.matchPerformance` (section 9), stretched onto their
  meaningful range (`v′ = (v − from) / (1 − from)`, from = 0.5, 0.2 and 0.4) because everyone who plays sensibly scores
  high on the raw scale.
- *Importance*: duel 0.4, cup group 0.7, cup final 1.0.
- **Effort gate (anti-collusion)**: if the opponent's tactical efficiency is below 0.5, or more than 0.2 below their own
  typical effort (the platform's long-term median when supplied, otherwise their median over at least three eligible
  matches that day), the match earns **no win and no opponent-strength credit** — a win over someone who did not try is
  not a win.

**Day score** = the best three match scores among the first five eligible matches (0–300). **Ranking** sorts by day
score, then best single match, then counted wins, then mean tactical efficiency, then player id (stable; never by
time). `rankTop100(players, limit, longTermEffort)` returns contract `Top100Entry` rows with the counted matches, the
best match and the mean components.

### 14.3 Simulation: grinding cannot buy rank, colluding gains nothing

`node scripts/simulate-ranking.mjs` (≈ 20 s) builds a pool of 1,000 real engine matches — skilled, average and casual
honest players, plus two kinds of partner who throw matches (*hard*: blocks or leaves everything; *soft*: random shots
and loose bowling, so it still looks like play) — scores both sides with `matchPerformance`, then resamples days. It
exits with status 1 if either property fails.

| Matches played that day | Skilled | Average | Casual |
| --- | --- | --- | --- |
| 1 | 62 | 47 | 34 |
| 3 | 187 | 141 | 104 |
| 5 | 207 | 170 | 133 |
| 8 / 12 / 20 | 207 / 207 / 207 | 170 / 171 / 171 | 131 / 132 / 132 |

Mean day score. Beyond five matches nothing changes (20 vs 5: within ±1 point, sampling noise). Between three and five,
a bad match can be dropped (+20 to +29), but skill matters more: a skilled player with three matches (187) outscores an
average player grinding twenty (171). In 40 simulated days of 3,000 players each playing 1–20 matches, skilled players
(15 % of players) took 87 % of Top 100 places, average players 12.5 %, casual players 0.2 %; a skilled player's chance
of a place was 27.0 % with 5 matches, 27.2 % with 8, 27.0 % with 12 and 28.0 % with 20 (sampling noise ±1.5).

| A colludes with a partner (2 of 5 matches) | A's day score honest | Colluding, no baseline | Same-day baseline | Long-term baseline | Pair honest → colluding |
| --- | --- | --- | --- | --- | --- |
| Skilled A, hard tank | 207 | 195 (−13) | 191 (−16) | 191 (−16) | 379 → 332 |
| Skilled A, soft tank | 207 | 205 (−2) | 197 (−10) | 194 (−13) | 379 → 336 |
| Average A, hard tank | 171 | 152 (−19) | 148 (−23) | 147 (−24) | 340 → 287 |
| Average A, soft tank | 171 | 170 (−1) | 157 (−14) | 151 (−20) | 340 → 293 |

Throwing matches never helps the beneficiary and always costs the pair; the effort gate, the two-per-opponent cap and the
five-match window together leave nothing to buy.

## 15. Player-facing text

Everything the engine emits has copy in `src/i18n/engine/<locale>.json` (278 keys per locale, ICU-lite): delivery,
line, length, intensity, intent, field, shot, zone, pitch, weather, timing, contact, execution and dismissal names
with one-line hints; the five ghosts; the Auto label for stand-ins (`auto.tag`, `auto.batted`, `auto.bowled`); the
planner advice (`advice.*`, section 17); all 80 `EXPLAIN_KEYS`; all 34 `COMMENTARY_KEYS`; and a `guide.*` tactics guide
written for a 12-year-old. English, Hindi and Hinglish are complete; Bengali, Telugu, Marathi, Tamil, Gujarati,
Kannada, Malayalam and Punjabi are complete machine drafts that need human linguistic QA (`src/i18n/engine/STATUS.md`).

- Commentary placeholders are limited to params the engine always sends with that key (ball lines: `runs`, `shot`,
  `variant`, `speed`, `batter`, `bowler`; `zone` only for middled fours, sixes and punished loose balls; `fielder` only
  for catches that name one; `distance` only for sixes). `explain.*` takes no params.
- `tests/unit/engine/i18n-engine.test.ts` checks key parity and placeholders in every locale and renders every
  commentary event of the golden replays, 160 simulated matches and a Daily Six attempt in every locale.


## 16. Training (the tutorial)

`src/engine/training.ts` builds the first-run tutorial as a real, verifiable match. It works offline and imports only
the v1 modules it needs: no ranking, simulation, registry, verifier or Daily Six code (the training tests check that
import graph). Its own code is 2.1 KB gzip, or 19.4 KB with the engine modules it uses; the full `@/engine` entry is
22.6 KB (minified with rolldown, gzip level 9). Training is never rated or ranked (section 14.1).

- **`trainingSetup(seed?)`** returns `{ conditions, ghostId, coachOver, lesson, seed }`:
  - **`conditions`**: `TRAINING_CONDITIONS`, Hard and clear.
  - **`ghostId`**: `TRAINING_GHOST_ID`, The Anchor (`anchor`, difficulty 1), who coaches.
  - **`coachOver`** (`trainingCoachOver()`, fixed): the over the player bats against. Balanced field, 11 energy,
    Super Ball 3, starter variants only, human-like releases. Ball 1 is a half-volley: good length, full, off
    stump, intensity 1, a good (not perfect) release. Then come a bouncer, an honest good length, an off-spin set-up,
    the yorker it sets up and a short wide one to cut; the Super Ball is a yorker.
    A drive at ball 1 towards mid-off, timed within about 40 ms, averages 2.9 runs and is out 2 % of the time; a defend
    is almost always safe.
  - **`lesson`**: `TRAINING_LESSON`, below.
  - **`seed`**: a fresh 128-bit hex seed from `crypto.getRandomValues` (`newTrainingSeed()`). Bat with this seed and
    `coachOver`, for example `localInnings({ plan: setup.coachOver, conditions: setup.conditions, seed: setup.seed,
    maxBalls: 1 })`, so that the ball in the log is the ball the player saw.
- **`TRAINING_LESSON`** holds the suggested deliveries for the player's own over:
  - **`choices`**: one lesson ball per starter, all intensity 2 and attack. Good length off/good, yorker middle/full,
    bouncer off/short, off-spin off/good.
  - **`rest`**: balls 2–6, costing 8 in all, so any starter delivery at any intensity fits the budget. Good length,
    off-spin, a short set-up, then a full yorker on off stump, then a wide full ball.
  - **`superBall`**: good length, full, off, intensity 2.
  - **`field`**: balanced.
- **`trainingPlan(lessonBall, gesture, seed)`** returns the player's `OverPlan`:
  - Ball 1 is `lessonBall` with the player's own release-meter gesture. A missing gesture, or one the engine cannot
    read, becomes an ordinary release.
  - The other balls get ordinary releases: 35 ms spread, deterministic from `seed`, never within ±2 ms of the sweet
    spot.
  - So the over always passes `validatePlan(plan, STARTER_VARIANTS)`. It throws for a non-starter variant or an
    illegal length.
- **`trainingCoachRef(alias, kit)`** returns the coach's `PlayerRef`: `ghost_anchor`, kind `ghost`.
- **`trainingAutoBalls(log)`** returns `{ batted, bowled }` by ball number (6 = Super Ball): the balls of the player's
  innings that Auto XI batted, and the deliveries of the player's over that the lesson bowled for them (all but the
  lesson ball). It re-runs the same deterministic policies on the log, so the log needs no extra fields; the reveal labels
  those balls "Auto".
- **`buildTrainingLog({ setup, player, coach, plan, inputs, finish?, hour?, salts? })`** returns
  `Promise<MatchEventLog>`, kind `training`.
  - **Innings 0**: the player's real `inputs` against `coachOver`, in play order as `localInnings().inputs()` records
    them. Each is re-validated; null or invalid means unanswered. The rest of the innings is batted by Auto XI
    (`finish: 'auto'`, the default) or left unanswered (`'leave'`, safe dots).
  - **Innings 1**: the coach bats the player's over with The Anchor's policy (`ghostBat`, seeing the field). The
    coach's answer to the lesson ball is `log.innings[1].balls[0]`.
  - **Commits**: both overs are committed with fresh random 128-bit salts (or `salts`), `keyId: 'local'` and no
    signature. Hour stamps default to `TRAINING_HOUR`.
  - **Result**: the log is built by `buildMatchLog`, and `verifyMatchLog` accepts it, also after a JSON round trip. It
    throws if either over is not legal with the starter variants.
  - **Balance**: with an ordinary release, The Anchor scores 0.7–1.1 runs off the lesson ball on average. The bouncer
    takes a wicket 16 % of the time, the yorker 11 %, good length and off-spin 5–6 %. With Auto XI batting the
    player's whole innings, the player wins about 4 training matches in 5.

## 17. Bowling advice (the planner)

`src/engine/advice.ts` turns the engine's own model into short, plain advice for the bowling planner. It is pure and
deterministic, and every line is a heuristic, never a promise about an outcome (the planner says so). Copy keys are
`advice.*` in `src/i18n/engine`. `tests/unit/engine/advice.test.ts` checks each claim against the model and the
simulation.

- **`unlockHint(variant)`**: how a locked delivery is earned (section 3), shown on its card; null for a starter.
- **`pitchHints(conditions)`**: one line for the pitch and one for the weather when it matters (`PITCH_ADVICE` lists
  the balls each line recommends and warns against):
  - **Green**: seam and swing on a good length, most of all in the first three balls (the new ball); spin is easier
    to hit.
  - **Hard**: yorkers and bouncers bite; a full ball that is not a yorker is easy to smash.
  - **Slow**: spin and slower balls grip; fast short balls and full swing sit up to be hit.
  - **Humid**: the ball swings more. **Dew**: a wet ball, so batting is easier and spinners suffer most.

  Checks: every ball a hint recommends is harder to score from (the batter's best response, best line, pace and field)
  than every ball it warns against, on every pitch in every weather; the simulation's best over for each pitch reads
  "good fit for this pitch"; an over of the balls a hint warns against concedes more than a run more; humid air
  helps the swing-only over most, and dew makes every over easier to hit and the spin-only over most of all.
- **`overSummary(over, conditions, { unlocked })`**: the over at a glance (families, energy of 15, lengths, number
  of lines, field, Super Ball) and up to three honest reads, most important first:

  | Read | When (`ADVICE` thresholds) | Backed by |
  | --- | --- | --- |
  | Predictable | the same delivery (variant, length and line) 3+ times | repeats get easier to hit (5.5) |
  | Against this pitch | 2+ balls the pitch hint warns against | the pitch checks above |
  | Ball N is easy to hit here | a ball scoring under 0.25 against every ball of its energy cost and intent, and 0.6 runs worse than the best of them | bowling choice (the Top 100 measure); swapping it for that best ball concedes less in the simulation, every time (237 of 237 random overs, 1.8 runs on average) |
  | Wasted set-up / set-up ready | a set-up not followed by a contrasting attacking ball / one that is | 5.5 |
  | Field suits better | another field saves 0.6+ runs of the batter's best response over the six balls | the simulation agrees in 151 of 151 suggestions (1.2 runs on average) |
  | All-out attack / playing it safe | 5+ attacking / containing balls | intent multipliers (section 3) |
  | Energy left | 3+ energy unused | the simulation's best overs use 14 or 15 |
  | Good fit for this pitch | 3+ balls the pitch hint recommends, none it warns against, no easy ball, no repeats | the pitch checks above |

  The comparisons use only the deliveries the player has unlocked. Over random legal overs, the mean choice score
  (`pitchFit`) correlates −0.92 to −0.96 with the runs the simulation's oracle batter scores.
