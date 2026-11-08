# result_moments pack: provenance

Owner-made original motion, authored by ASSETS-MOTION (a Claude agent working for the VANDE owner) on 2026-11-08 UTC for Target
Chase. Register id `VANDE-MOTION-RESULT-MOMENTS-001` (the row is applied by the lead).

- **Method.** Original keyframes on the VC17 control rig (`scripts/blender/motion/vc17.py`), written as code:
  - foot plants with heel strike and heel peel, and analytic two-bone leg IK; the celebrations rise onto the toes on the same sole tip,
    so nothing slides and nothing leaves the ground;
  - explicit FK arms (upper-arm direction in the chest frame, shoulder twist, elbow flex, wrist), keyed per component, so the elbow and
    the hand lag the shoulder and no elbow-pole flips can occur;
  - the walk-off from the gait generator (`gait.Stepper`, `profile_path`, `gait_controls`) on a speed profile, with a slowed cadence;
  - a small deterministic wander (three incommensurate sines, a fraction of a degree) on the trunk, neck, head and hips, so a hold is
    never a freeze and nothing repeats; it fades in over 0.45 s and keeps 15% of itself in the last 0.6 s;
  - the bat key of the two batter clips from the right hand's own forward kinematics: `bat.grip` is the palm centre (0.065 m along the
    hand), `bat.dir` is keyed in the chest frame (the bat trails the arm), the wrist bends only as far as the bat needs (the bat stays
    34 degrees off the hand's long axis where that is possible), `bat.face` is the hand's inward axis made square to the blade.
- **Source.** `scripts/blender/motion/result_moments.py`. Bake: `python3 -I scripts/blender/motion/build.py result_moments` (plain Python
  3.11, standard library only; Blender is not needed). Pack: `node scripts/motion/export.mjs --pack result_moments`. Checks:
  `python3 -B -m unittest discover -s scripts/blender/motion -p 'result_moments_test.py'`, `npm run motion:check`, `npm run motion:test`,
  `node scripts/motion/popscan.mjs public/practice/motion/result_moments.vmp`.
- **Third-party data:** none. No motion capture, no Mixamo, no CMU, no Quaternius, no traced footage, nothing from ANT CRICKET.
- **Licence:** owner-made original.
- **Skeleton:** VC17 (MOTION-SPEC), authored directly in canonical axes; no retarget.
- **Handedness.** A right-handed batter and a right-arm bowler. A left-hander and a left-arm bowler are mirrored by the stage as a
  whole actor (`track.mirror`, the canonical mirror, section 3), so a left-arm bowler raises his own left arm.
- **Placement.** In place (the ground track is zero) except `bat_walk_off`, whose ground track is the walk (straight ahead, no yaw).

| clip | what | length | markers (s) | rate, codec | ground |
| --- | --- | --- | --- | --- | --- |
| `bat_celebrate_win` | The striker, the winning run is scored. A beat to register it (the head follows the ball away, the weight sinks), a coil, then the bat arm sweeps up and out to about 155 degrees (the bat trails it through the horizontal and ends up and out), the heels rise, the head goes back, the left fist pumps forward and down, a second smaller pump, a sweep of the head to the crowd, a long exhale, the bat comes down to the side with the left arm falling after it, a deep breath, a settle to a carry stand. Bat in the bottom hand, the top hand free. | 3.6 | `peak` 0.95, `fist` 1.35, `rest` 2.30 | 30 Hz, 2 | none |
| `bat_walk_off` | The striker, the chase is lost (a wicket, or the last ball bowled with the target not reached). Stillness and a long exhale, the head drops, the shoulders round, a slow head shake of about 14 degrees, the weight onto the left foot, the first step with the right at 1.55 s, a slow walk at 1.0 m/s and 96 steps/min with a low shuffling swing and the bat trailing, a stop on a closing step, a glance back, a last breath. Bat in the bottom hand, the top hand free. | 5.4 | `slump` 0.90, `step` 1.55, `stop` 4.90 | 30 Hz, 2 | 2.45 m straight ahead (+Z), yaw 0 |
| `bowl_celebrate_defend` | The bowler, the chase is defended. He looks to where it happened, sinks and breathes in, then the bowling arm drives up with an open hand, the left fist pumps across the body, the heels rise, the head goes back, a second pump, the torso turns to his team, both hands come together in a clap, then to the hips with a long exhale. No ball. | 3.4 | `peak` 0.85, `clap` 1.85, `rest` 2.40 | 30 Hz, 2 | none |
| `bowl_disappointed` | The bowler, the batter wins. He watches it go (the head follows it away, still), the head drops, the shoulders slump, both hands go to the hips with the elbows out, the weight settles on one leg, a slow head shake, the left hand rubs the back of the neck, a deep breath in and out, the arms fall, the head comes level. No ball. | 3.4 | `slump` 0.70, `rest` 2.60 | 30 Hz, 2 | none |

## Reading the clips

- **One-handed batter clips.** `bat_celebrate_win` and `bat_walk_off` hold the bat in the bottom hand only: the top hand is free and its
  arm is the clip's own. The web names them in `ONE_HAND_BAT_CLIPS` (`src/render3d/core/motion/library.ts`, which sets
  `MotionSource.oneHand`); Unity names the same two in its one-hand carry (`BatterOneHandCarry`). Every other pack clip with a bat key
  is drawn with both hands on the handle.
- **Frame 0** of each clip is an at-ease stand (the same stand family as `loco_idle`), so the runtime's inertial hand-over (260 ms)
  from `bat_rest`, a run's pull-up or a follow-through has little to bridge. The last frame is a settled stand (or, for the walk-off, a
  stop) and the move holds it to the end of the scene: no clip returns to a rest clip that would put the top hand back on the handle.
- **Reduced Motion.** A consumer may hold the marker frame (`peak` for the two celebrations, `slump` for the walk-off and the
  disappointment) over the same window (MOTION-SPEC section 6). Nothing in the clips needs to change.
- **The head.** The face-and-life Director's head pass turns the neck and head within the body's reach on the finished bones, so the
  head and gaze authored here are what Unity and a Director-off stage show; with the Director on they are a fallback it may override.
- **Honesty.** None of the clips implies a shot, an outcome or a timing: they start only after the physics event that earns them
  (`practice/resultMoments.ts`), and they are generic (the same clip for every way of winning, every way of losing).
- **Ranges (builder measurements, section 9 of the spec).** Arms are authored to at most 1,200 deg/s (the stage holds the bowler's
  arms to 1,440 after the release); the bottom palm stays within 0.6005 m of its shoulder (a straight arm and the palm; the stage's
  carried-bat key is 0.62 m) and its wrist swing within 29.1 degrees. Per-clip numbers and the pop scan are in
  `release/product-sequence/stage-3-chase/ASSETS-MOTION/` (`INDEX.txt`).
