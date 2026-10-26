# Practice physics

The deterministic, cricket-specific physics behind Practice batting: the delivery from the bowler's hand, the
virtual bat, the swept bat–ball collision, the contact and the ball off the bat, and LBW. Fielding, running,
scoring and dismissals (src/physics/field, fielding, running, scoring, resolve) are described by their own module
docs; this page covers the modules below. There is exactly one implementation of each concern and one source of
constants and timing windows (`src/physics/constants.ts`).

| Module | Responsibility |
| --- | --- |
| `constants.ts` | Every cricket constant and timing window used by Practice (the renderer's ground geometry re-exports them) |
| `vec.ts` | Vectors and deterministic `sin/cos/atan2/exp/tanh` (bit-identical on every JavaScript engine) |
| `ball.ts` | The one ball integrator: delivery flight, ball off the bat, bounces, roll, rope, stumps (`integrateBall`, `simulate`) |
| `delivery.ts` | Release per bowler and variation, the aiming solver, `flight()`, `flightMovement()` |
| `bat.ts` | `batTravelMs`, footwork, the batter's body (`batterBody`), the read, the face, the bat track (`batPose`) |
| `collision.ts` | Continuous (swept) collision of the ball with blade, handle and gloves, pads, body and head |
| `impact.ts` | One impulse model for every contact (restitution, friction, spin) |
| `contact.ts` | `strike()`: the batter plays or leaves a delivery; contact kind, exit velocity and spin, the report |
| `timing.ts` | Active bands, SwingTiming classification, the Learn/Play forgiveness map |
| `lbw.ts` | Law 36 decision from the physics |
| `matchPath.ts` | `flightFromPath`: a multiplayer `BallPath` flown through the same physics (match reveals, replays, highlights) |
| `aim.ts` | `aimShot`: outcome-first post-contact flights (the server has decided where the ball goes) |
| `probe.ts` | Allocation-free probe runs and sampled traces of the same ball model, for the match solvers |

`scripts/practice-physics-check.mjs` measures the timing windows the physics produces (see "Measured windows").

## Frame, units and determinism

World frame as in `src/contracts/practice.ts`: metres and seconds, origin at the pitch centre on the ground, +Y up,
+Z towards the striker (striker's stumps at z = +10.06), +X the striker's off side. Physics always runs in the
striker's own right-handed frame: for a left-handed striker the caller mirrors presentation (x → −x), and
`flight({ ..., handedness: 'left' })` mirrors the real bowler's arm (a right-arm bowler bowls as a left-armer in
that frame). Plan lines and variations are batter-relative: `lineM` + is this striker's off side; an outswinger
leaves this batter. Bearings are degrees from straight down the ground (towards the bowler, −z), + to the off side.

Determinism: every trajectory is integrated with classical RK4 on a fixed step `SIM_DT` = 1 ms, with events (bounce,
stumps plane, rope, rest) located inside the step and the remainder of the step completed, so samples always sit on
the grid t0 + i·dt. The physics uses only IEEE-754 basic arithmetic and `Math.sqrt` (both correctly rounded) and the
polynomial `dsin/dcos/datan2/dexp/dtanh` of `vec.ts` (accurate to ~1e-16; tested against `Math`): no `Math.sin`,
`Math.pow`, `**`, `Math.hypot`, `Date` or `Math.random`. Seeded variation (the seam's landing, a bowler's build)
comes from `rngFromKey` of `src/engine/prng.ts` (SHA-256 seeded sfc32), the repository's one PRNG. The same delivery
seed and normalized swing therefore reproduce the identical result on every device and browser.

## The ball

In the air (`ball.ts`), per unit mass:

- gravity, g = 9.81 m/s²;
- quadratic drag, a = −½ρC_dA|v|v/m with ρ = 1.18 kg/m³, C_d = 0.38, A = πR², R = 0.036 m, m = 0.16 kg;
- Magnus lift along ω × v with C_L = min(0.30, 1.0·S), S = R|ω⊥|/|v| (spin parameter): drift (side-spin), dip
  (top-spin) and the carry of back-spin;
- swing (before the first bounce only): a horizontal side force ½ρC_sA|v|²·(up × v̂) with a signed coefficient from the
  seam's presentation; it fades above 34 m/s to 55% at 42 m/s, as the boundary layer turns turbulent on both sides.

Bounce on the pitch strip (|x| ≤ 1.525 m) or the outfield:

- normal: v_y' = −e·v_y (pitch restitution per condition, outfield 0.40);
- along the line of travel: Coulomb friction μ·(1 + e)|v_y| up to the impulse that would make the ball roll (sphere
  I = 0.4 mR²): the ball loses pace off the pitch; only 35% of that impulse spins the ball (`PLOUGH_SPIN_FRACTION`),
  because a ball arriving at pace digs in and the friction acts above its lowest point; a rigid-sphere bounce would
  turn seam-up back-spin into ≈ 40 rev/s of top-spin and a post-bounce dip that real trajectories do not show;
- across the line: a partial rolling constraint, `turnGrip`·u_l/3.5 (capped at 0.6 of the normal impulse), where u_l is
  the contact point's sideways slip from the rifle (side) spin: this is the turn. The spin changes accordingly;
- on the first pitch bounce of a delivery, the seam deflection: the ground velocity rotates by `seamDev` radians.

On the ground: rolling resistance plus grass drag, a = 0.5 + 0.35·v (m/s²), integrated exactly per step; a 90 km/h
ground stroke rolls ≈ 62 m. The ball stops below 0.15 m/s. The rope is the circle of radius 62 m about the pitch
centre; `boundary.onFull` is true only if the ball has not touched the ground since it started (a ball that starts on
the grass is grounded). The stumps plane crossing (z = 10.06) is interpolated within the step; `detectStumps` finds a
ball hitting the striker's stumps (sub-sampled, so it cannot pass through them).

### Pitch conditions

| Condition | Restitution | Friction | Seam grip (rad) | Turn grip | Swing × |
| --- | --- | --- | --- | --- | --- |
| Balanced | 0.60 | 0.30 | 0.014 | 0.55 | 1.00 |
| Green | 0.58 | 0.27 | 0.026 | 0.45 | 1.45 |
| Hard & Bouncy | 0.67 | 0.25 | 0.012 | 0.50 | 0.85 |
| Turning | 0.55 | 0.40 | 0.012 | 0.95 | 0.80 |

Calibration targets (all asserted in `tests/unit/physics/delivery.test.ts`): a good length (6 m) passes the stumps at
0.55–0.8 m (top of the stumps); a bouncer pitched 10.5 m from the stumps reaches the batter at chest height
(1.2–1.5 m) and one at 11.5 m at head height (1.5–1.85 m) for 125–145 km/h; pace loses ≈ 15–20% from hand to
stumps (drag ≈ 9%, the pitch ≈ 9%); Green swings ≈ 1.45× and seams ≈ 1.8× Balanced; Turning turns ≈ 1.6–2×.

## Deliveries

`releaseFor(plan, bowler, conditions, seed, handedness)` builds the physical release, and `solveRelease` aims it:

- Hand position, over the wicket: pace 2.05–2.30 m high, 0.42 m to the arm's side of middle, 1.40 m in front of the
  bowler's stumps; spin 1.80–2.00 m, 0.30 m, 1.28 m. The height and width are the bowler's build (from `lookSeed`), the
  same for every ball he bowls; a right-arm bowler releases on the striker's off side (+x), a left-armer on the leg
  side. Bouncers stand 4 cm taller, yorkers 2 cm lower.
- Speed: exactly `plan.speedKph`; `release.speedKph` is |v| at release, never a label.
- Spin and swing per variation (pace): stock, seam-up back-spin 13 rev/s and a little natural swing either way;
  outswing / inswing, C_s = 0.13 × condition, seam at ±18°; seam, upright seam (17 rev/s), small swing and 1.7× seam
  deflection, never near zero; cutter, 11 rev/s mostly rifle spin (off-cutter in, leg-cutter away, seeded 60/40), so it
  grips and cuts; slower, tumbling 6 rev/s with over-spin, no swing (it dips, and it is slower: that is its disguise);
  bouncer and yorker, stock spin.
- Spin (rate 28 rev/s finger, 30 rev/s wrist): split into rifle (turn), top (dip) and side (drift) components. Stock:
  0.62/0.55/0.25; flighted: slower, more over-spin; quicker: flatter, more rifle; top-spinner: mostly over-spin (dips,
  bounces, barely turns); arm ball: back-spin with the seam upright, swings with the arm, does not turn; wrong'un:
  googly (wrist) or carrom ball (finger), turning the other way. Turn direction is by spin type and (mirrored) arm: an
  off-break, into the batter, comes from a right-arm finger spinner or a left-arm wrist spinner. The ball drifts
  against the turn.
- Seam landing (which way it seams) is seeded per delivery and part of the locked over; it never depends on the swing.
- Aiming: Newton's method on the release elevation and azimuth, with the full integrator (drag, Magnus, swing, seam,
  turn), so the ball pitches at `plan.lengthM` in front of the striker's stumps and crosses the stumps plane at
  `plan.lineM` to well under a centimetre (tested for every variation and condition). About 2.5 ms per delivery.

`flight()` returns the contract's `BallFlight` plus `spin: { release, afterBounce }` (rad/s vectors), with dense 1 ms
samples to 0.3 m past the stumps, the bounce, `stumpsT`, `wouldHitStumps` (any part of the ball on the stumps or
bails) and `idealContactT`. `flightMovement()` gives the coaching numbers: movement in the air (swing or drift),
movement off the pitch (seam or turn) and the height at the bat.

## Reaction time and the timing reference

Real flight times are kept (release to the ideal contact, measured and tested): stock pace 0.46–0.58 s across
120–152 km/h (the brief's 0.42–0.63 s), spin 0.67–0.94 s across 75–98 km/h (0.66–0.97 s). Slower balls are genuinely
slower: a 90 km/h pace ball takes ≈ 0.73 s (bounded by `SLOW_PACE_MAX_FLIGHT_S` = 0.8 s). Any pace ball the physics
models lies in `PACE_KPH` = 90–155 km/h; spin in `SPIN_KPH` = 75–98 km/h.

The ideal contact is where the ball crosses the batter's contact plane: 1.80 m in front of the stumps on a forward
stride, 1.05 m on the back foot, 1.50 m playing across, 2.90 m down the track. Automatic footwork goes forward to
lengths fuller than 5.2 m (pace) or 6.2 m (spin), back to anything shorter, and digs yorkers (≤ 1.8 m) out from the
crease. `flight.idealContactT` is the time for the automatic footwork; a manual footwork uses its own plane
(`idealTimeFor`). The swing's virtual contact time is

    virtualContactTime = swing.startT + batTravelMs(kind, power)

with `batTravelMs` = 120 ms for a defensive tap and 120 + 30·power ms for an attacking flick (a harder hit needs a
bigger backlift, so it must start earlier). `swing.startT` is on the simulation clock with the device calibration
offset already applied by the input layer (from high-resolution event timestamps, never frame numbers); the physics
adds no latency of its own. The timing error is `virtualContactTime − idealT` (ms, + late).

## The virtual bat

`buildBatTrack(flight, swing, opts)` produces a continuous rigid-bat track, `batPose(track, t)` → grip (top of the
handle), toe, face normal, sampled as `BatSample[]` for presentation (every 4 ms) and evaluated exactly by the
collision.

1. The read. The batter places the bat where he judges the ball will cross his contact plane. He judges length,
   bounce and pace from the flight he has seen (height and arrival are the real ones); the line is his extrapolation
   of the ball's sideways motion at the commit time: Learn tracks the real ball, Play commits 40 ms and Real 80 ms
   before the bat arrives. Late swing, drift, seam or turn after that beat the bat honestly.
2. The face. Attack: the face for which a sweet-spot hit leaves at the flick's bearing and at an elevation of
   −3° + 38°·elevation (along the ground … lofted), found by a damped Newton solve through the impact model with the
   bat moving along the ball's line at the speed that gives the face the flick's bat speed (8 + 24·power m/s, up to
   1.6× that along the line for angled faces). Defence: a dead bat (2 m/s, soft hands) square to the line, 8° over the
   ball and only 8% of the way towards the aim, because a dead bat turns any face angle into a large deflection.
   Balls above ≈ 0.9 m are met with a horizontal blade (pull, hook, cut); lower ones with a vertical blade; the toe
   never goes below the ground, so a yorker is met near the toe.
3. Timing. In the hitting zone the bat moves along the ball's line; timing error moves it across the line and rotates
   its face at fixed rates (per ms of the physical error ε at which the ball would meet it): across the face 0.98 mm/ms
   (the face edge at the solid limit), towards the toe 7 cm·(ε/80)², face yaw 0.30°/ms (early closes the face towards
   leg, late opens it) and tilt 0.20°/ms (early up, late down). The face rotates about the virtual ball centre, so the
   ball meets the face exactly at the designed offset. The drift runs towards the off side for straight and off-side
   strokes (late → outside edge, early → inside edge), towards leg for leg-side strokes (early → the leading edge, late
   → inside edge), upwards on the pull (late → top edge) and downwards on the cut (late → the bottom edge, behind).
4. Outside the zone the bat blends from its waiting pose (picked up behind the batter, out of the ball's path, as
   batters hold it in the bowler's delivery stride; a swing that starts too late therefore misses rather than
   blocking the ball with a grounded bat) through the backlift (at least 15 ms) and on into the follow-through over the
   front shoulder; defence holds its block. A swing with non-finite fields is treated as a leave.

The batter's body (`batterBody(footwork, flight)`): vertical pad capsules (radius 7.5 cm, 6–62 cm high), a torso
capsule and the head sphere (centre 1.62 m in the stance, 1.52 m leaning into a forward stride). On a stride the front
pad goes just inside the ball's line with the bat beside it; a leave is played from the stance (`batterBody(null)`).
Manual footwork that fights the length (forward to ≥ 7 m, back to ≤ 3.5 m, down the track to pace) costs balance,
which lowers the effective bat mass and restitution.

## Collision

`collision.ts` sweeps the ball (linear between flight samples) against the blade (a 0.56 × 0.108 × 0.05 m box), the
handle and gloves (a 5 cm capsule), both pads, the torso and the head by conservative advancement: at time t the
separation d(t) (distance from the ball centre to the nearest surface minus R) is evaluated on the exact bat pose, and
time advances by d / v_max, where v_max bounds the closing speed (ball speed plus 1.3× the fastest bat point over the
interval plus 4 m/s). The step can never jump past a contact, so no ball tunnels at any speed or sample spacing
(tested: a 160 km/h ball sampled every 20 ms against a 15 cm pad, and the same bat contact at 155 km/h with 1 ms
and 8 ms samples). Contact is declared at 10 µm separation; the result has the time, the ball state, the surface point
and normal, and for the blade its local coordinates and region (face, edge, back, toe, shoulder).

## Contact and the ball off the bat

`strike(flight, swing | null, { assist, tierToleranceMs })`:

- Kind: the face → `middle`; the edge on the off side of a vertical bat → `outside_edge` (`leading_edge` when the face
  is closed beyond 20° to leg), the leg side → `inside_edge`; a horizontal bat's upper edge, the shoulder, handle or
  gloves → `top_edge`, its lower edge → `outside_edge` on off-side strokes and `inside_edge` on leg-side ones; pads →
  `pad`; torso or head → `body`; nothing → `miss`; no swing → `leave` (or `pad`/`body` if the ball comes into him).
- Exit: one impulse model (`impact.ts`) at the contact point, along the surface normal: relative velocity including
  the ball's spin (so incoming spin makes the ball squirt off the face), restitution, the bat's effective mass and
  Coulomb friction 0.25 up to rolling; spin changes with the friction torque. Restitution 0.52 at the sweet spot
  (Penrose et al.; Mehta & Pallis), falling quadratically along the blade to 35% at ±15 cm and by up to 35% across
  it; effective mass 0.95 kg at the middle (bat and hands), less across the face, 0.35 kg on an edge (the bat
  twists), restitution 0.32 on edges; defence 0.30 and 0.70 kg; gloves 0.2 and 0.5 kg; pads 0.25 against an
  immovable surface. The bat velocity is that of the contact point on the moving bat. Balance scales mass and
  restitution.
- Report: timing error against the ideal contact for the footwork played, `timing` = the band of that raw error
  (`perfect`/`solid`/`mistimed`, `missed` beyond the edge band, `none` for a leave: it describes the swing, so a
  perfectly timed swing beaten by seam reads `perfect` + `miss`), contact point, `bladeU` (0 toe … 1 top of the blade,
  sweet spot 0.22), face bearing, bat and exit speed, exit bearing and elevation, and the intended bearing (always the
  player's flick, for coaching). `quality.sweet` marks a hit within 6 cm along and 2.5 cm across the sweet spot.
- Also returned: the bat samples, `exit` (pass it to `simulate`), the first pad or body `impact` with its rebound, the
  closest approach on a miss (`delta` = ball − bat: + y over the bat), the footwork played and the bat track.

## Assistance

Real is pure physics plus the measured latency compensation (the calibration offset in `startT`). The Real bands
are the calibration of the bat geometry. Learn and Play keep the same geometry and make the swing more forgiving in
time: `forgive(e, bands)` maps the player's error piecewise-linearly through the band edges (active perfect → 25 ms,
solid → 55 ms, edge → 80 ms, slope 1 beyond) and the bat reaches the zone at `idealT + forgive(e)`, so a Learn swing
55 ms late plays exactly like a Real swing 25 ms late: the bat really is moved (the track shows it), the face errors
shrink with it (aim and face correction), and the effective hitting window is larger. The intended direction is never
changed; a mistimed shot goes where the forgiven physics sends it. Learn also reads the line perfectly and Play
commits later than Real. The Assisted performance tier adds its `tierToleranceMs` to all three band edges of the
active level (so the map stretches accordingly, even in Real), and records it in the replay.

## Measured windows

`node scripts/practice-physics-check.mjs` sweeps the timing error from −260 to +260 ms in 1 ms steps through
`strike()` and reports the contiguous window around zero where the ball meets the sweet spot (perfect), the middle
(solid) and any part of the bat (edge), on a 136 km/h stock ball at a good length (6.5 m) and an 85 km/h off-break:

| Level (bands) | Perfect | Solid | Edge |
| --- | --- | --- | --- |
| Learn (55/110/170) | −54 … +55 | −110 … +109 | −164 … +152 (spin ±165) |
| Play (35/75/125) | −35 … +34 | −75 … +74 | −121 … +123 |
| Real (25/55/80) | −25 … +24 | −55 … +54 | −78 … +79 |

The Real edge band (80 ms) is the geometry's own limit: the ball could touch the edge until its centre is one radius
beyond the face, (54 + 36)/54 × 55 = 91.7 ms, if the face stayed square; but it rotates 0.30°/ms with the error and
presents the edge obliquely, E = 91.7·cos(0.30°·E) ≈ 80 ms. Angled strokes are less forgiving on the side the face
opens (a cover drive in Real: edge −141 … +63), and against late movement the windows shift (a seaming ball beats a
Real batter who committed before it pitched). Learn's late edge against pace stops near +150 ms: a swing that late
only starts as the ball passes the batter.

## LBW

`lbw(flight, impact, { shotOffered })` (Law 36), in order: the ball must not pitch outside the line of leg stump
(whole ball outside; ignored if it struck the batter on the full); the first interception by the person must be in
line (any part of the ball within the line of the stumps), or outside off only when no shot was offered, never outside
leg; and the projection, which is the delivery's own flight continued past the impact with the same physics (the
flight samples are the unimpeded trajectory), must touch the stumps or bails. The reason is the first failing check
(`pitched_outside_leg`, `impact_outside_leg`, `impact_outside_off`, `missing`, `high`) or `out`.

## Multiplayer match paths (one engine for both modes)

The multiplayer renderer (reveals, replays, highlights) flies the frozen engine's deliveries through this physics
instead of a hand-built curve. The server is authoritative there: it decided the delivery and validates taps against
`releaseToContactMs`, so `flightFromPath(path, { family, releaseToContactMs, handedness?, seed?, conditions? })`
fits a physical release to the server's `BallPath`:

- hard targets: the ball crosses the contact plane (`CONTACT_Z`) at `releaseToContactMs`, pitches at
  z = −PITCH_HALF + `bounceAtM` and passes the bat at `lineAtBatM`, released at `releaseHeightM` from the match's
  right-arm-over spot (`MATCH_RELEASE`, mirrored for a left-handed striker; path values are batter-relative);
- soft targets: `heightAtBatM`, `swingM` (applied as the air side force; for spinners it is their drift) and `turnM`
  (a bounce deflection; the surface's turn grip is off so the spin, drawn and flown from `spinRpm`, cannot add to it);
- unknowns: release speed, elevation, azimuth and the pitch's restitution for that one ball, bounded to 0.45–0.75.
  This is the only place a pitch parameter is fitted rather than predicted: in multiplayer the server's height at the
  bat is authoritative, so the bounce matches it as far as a real pitch can. When the server asks for more bounce than
  0.75 allows (full balls on hard and green pitches), restitution stays at the bound and the height is the nearest the
  pitch gives; the hard targets are always met.
- Newton's method with a finite-difference Jacobian, then one or two corrections of the swing and deflection; about
  3 ms per delivery. Engine pitches map to conditions as green → green, hard → hard, slow → turning (every engine
  pitch has an equivalent); weather is already folded into the server's path.

Measured over every engine variant, intensity, length and pitch (`tests/unit/physics/matchPath.test.ts`: 288 paths
including loose executions; every line and weather too in a full 2592-path sweep): arrival within 0.03 ms of
`releaseToContactMs` (median 1.5 µs), bounce within 0.5 mm and line within 0.1 mm, swing and turn within 5 mm; the
height at the bat within 2 cm for 68% of paths and at worst 17.5 cm low (bounce held at 0.75); the release speed (always the simulated one, reported in `fit.speedKph`) is on
average 6 km/h from the engine's displayed `speedKph` (−22 … +12 km/h), because the engine's flight-time multipliers
(a slow pitch ×1.06, a short length ×1.05) slow the whole flight, which honest physics can only do with a slower
release. A yorker's `bounceAtM` (18.7 m) lies beyond the contact plane, so it reaches the bat just before pitching.

## Outcome-first shots

`aimShot(from, { p, mode }, opts?)` finds the launch velocity whose `simulate()` trajectory reaches a point the
server has chosen, so the reveal shows real flight, bounces and roll timed by its own `tArrive`:

| Mode | Meaning | Default launch elevation |
| --- | --- | --- |
| `carry` | through `p` in the air (a catch at hand height) | 8° + 0.5° per metre, 8–50° |
| `ground` | along the ground to rest at `p`, or passing it at `arriveSpeedKph` (a pickup) | −4° |
| `bounce_then_rope` | lands first, then crosses the rope in `p`'s direction (default 30 km/h at the rope) | 5° |
| `over_rope` | crosses the rope on the full at `p` (`p.y` is the height over the rope) | 32° |

Reaching a point leaves one free parameter, so the elevation (given, or the default, with fallbacks) chooses the
trajectory; the solver then finds the speed (bracketed secant, Illinois) and corrects the azimuth for any sideways
drift. Default spin is 15 rev/s of back-spin on carries and sixes, none on ground strokes. When no speed up to
`maxSpeedKph` (165 km/h) at any tried elevation works, it returns the nearest trajectory with `feasible: false` and
`errorM`, the miss distance. About 0.2–1 ms per shot (see "Match physics performance"); deterministic.

## Match physics performance

A replay timeline builds every ball of a match synchronously, so the two solvers iterate on cheap probes and make
one output run each:

- `probe.ts` runs the same ball model (integrateBall's own `accel()` and `bounce()`, RK4, the bounce located inside
  the step and the step completed) with state in local numbers, no samples, only the events a residual needs (the
  first bounce, a plane or distance crossing located on its own side of a bounce, the rope, rest), a configurable
  step, and the roll in closed form (a = rollDecel + rollDrag·v: distance and speed are exponentials, the stopping
  time a logarithm, `dlog` in `vec.ts`). At a 1 ms step a probe equals integrateBall bit for bit in the air; at the
  probe steps it differs by well under a millimetre.
- `flightFromPath` iterates on 8 ms probes (Newton with the Jacobian reused across iterations and the swing/turn
  correction passes) and makes one integrateBall run on the 1 ms grid for its output; the fit report is measured on
  that output.
- `aimShot` iterates on probes (8 ms; carries and sixes take about fifty steps to the target whatever the flight
  time, 4–20 ms, and stop there), brackets the speed around a closed-form first guess (drag-free ballistics, the
  inverted roll), and produces its trajectory with `trace()`, the same model stepped at the output spacing
  (`sampleEvery` × 1 ms, 5 ms by default; at 1 ms identical to `simulate` in the air) with the roll sampled in closed
  form.
- Practice never uses probes or traces: `flight`, `strike`, `simulate` and `resolveDelivery` are unchanged bit for bit.

`node scripts/match-physics-bench.mjs` (24 engine balls of every variant, 2.5 aims each: catches, a 56° skier, ground
strokes, a long roll, a pickup, a four, a six, a 42 m throw) enforces the 3 ms per-ball budget;
`tests/unit/physics/matchPerf.test.ts` asserts it with CI headroom (best of five, median under 8 ms). On an M1 Pro,
warm: per ball 10.3 ms median (12.7 mean, 22.8 max) before, 1.24 ms median (1.30 mean, 2.0 max) after;
`flightFromPath` 3.3 → 0.55 ms, `aimShot` 2.8 → 0.24 ms (the skier 10.9 → 0.67 ms, a six 7.3 → 0.46 ms, a long roll
2.1 → 0.22 ms).

## Known limitations

- The ball is a sphere with a smooth-sphere Magnus law and a constant drag coefficient; seam effects are a side force
  and a bounce deflection, not a resolved boundary layer. Reverse swing and wobble seam are not modelled.
- The pitch is uniform: no cracks, foot-marks or variable bounce; the outfield is flat and uniform.
- The bat is a rigid box with an empirical restitution map, not a vibrating beam; the batter's body is capsules.
- The batter's read is a model (commit times per level and sideways extrapolation), not measured human data.
- Timing windows are exact for straight-bat strokes on predictable deliveries; angled strokes and moving balls are
  intentionally different, as in cricket.
- Not modelled: the ball hitting the pad after an edge (bat-pad), the bowler's foot (no-balls), wides, or air density
  and humidity per venue (Green's extra swing stands in for conditions).
