# bowler pack: provenance

Owner-made original motion, authored by MOTION-BOWL (a Claude agent working for the owner) on 2026-11-03/04 UTC.

- Method: procedural keyframe curves (pelvis, spine, arms, wrists), foot plants that hold the shoe still
  (heel strike, flat, heel-off rocking on the sole tip), analytic two-bone leg IK, joint-space swing legs with a
  ground-clearance pass, and a light low-pass on the arms and head. Sources: `scripts/blender/motion/bowler_*.py`
  (`bowler_build.py` writes these VMS1 files; `bowler_blend.py` keys them onto the VC17 armature in Blender 5.2.3).
- Third-party data: none. No motion capture, no Mixamo, no CMU, no Quaternius, no traced footage.
- Licence: owner-made original.
- Skeleton: VC17 (MOTION-SPEC v1.2.2), authored directly in canonical axes; no retarget.
- Right-arm, over the wicket. A left-arm bowler plays the same clips through the canonical mirror (§3).

| clip | what | rate | codec |
| --- | --- | --- | --- |
| bowl_start | standing at the top of the mark, rock back, walk in, jog; hands over at `exitR` (jog phase 0.5) or `exitL` (phase 0) | 60 | 1 |
| bowl_jog, bowl_run, bowl_stride | approach gait loops at 3.0, 5.0 and 6.2 m/s, frame 0 = left strike, ball carried in the right hand | 30/60/60 | 1 |
| bowl_pace | last-stride set, pace: entry left strike at 6.2 m/s, gather, bound, back-foot contact, front-foot landing at the crease, release (peak arm speed) with the front leg braced, the front heel up on the ball of the foot, the trunk flexed laterally away from the bowling arm and the arm within 10 deg of vertical (ball 2.15 m at scale 1; lead ruling 2026-11-04), follow-through start | 60 | 2 |
| bowl_pace_follow | decelerating follow-through to a stop, veering away from the pitch; trailing heel lifts at the stop | 60 | 1 |
| bowl_pace_bouncer | the pace bouncer: bowl_pace's run-in, markers and release time, released 4.4 cm higher (ball 2.194 m at scale 1): a shorter last stride, the front leg straighter and the heel higher, the pelvis tilted back, the arm 7.5 deg from vertical and the wrist cocked back (lead ruling 2026-11-04) | 60 | 1 |
| bowl_pace_bouncer_follow | the bouncer's follow-through until its frames equal bowl_pace_follow's (`join` = carry on in bowl_pace_follow at that time) | 60 | 1 |
| bowl_off / bowl_leg | last-stride set, finger spin / wrist spin, entry at the jog | 60 | 2 |
| bowl_spin_off_follow / bowl_spin_leg_follow | spin follow-through to a stop | 60 | 1 |
| bowl_turn_pace / bowl_turn_spin | from the follow-through's last frame: a wait, a 160 deg turn to the left on the spot in two low steps (heel lifted, pivot on the ball), into bowl_walk_back at `exitL` (loop phase 0) or `exitR` (phase 0.5); the spin turn serves both spin actions | 30 | 1 |
| bowl_walk_back | relaxed walk back to the mark (loop, 1.35 m/s, no ball) | 30 | 1 |

Release geometry at rig scale 1 (ball in the hand, BALL_IN_HAND = (0, -0.085, 0.03) in the hand frame):
pace 0.31 m ahead of the front ankle, 1.96 m high; finger spin 0.25 m ahead, 1.84 m; wrist spin 0.20 m ahead, 1.80 m.
The delivery clips start exactly in the approach loop's pose at its left strike (the swinging leg is pinned to the
loop's state), so loop -> delivery joins without a pop; bowl_start's exitL / exitR poses match the jog loop to 1.2 deg.
The run-up parametrisation and its fit are in `scripts/blender/motion/bowler_runup.py`.
