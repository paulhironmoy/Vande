# nonstriker pack: provenance

Owner-made original motion, authored by MOTION-BOWL (a Claude agent working for the owner) on 2026-11-04 UTC.

- Method: as the bowler pack (`scripts/blender/motion/nonstriker_clips.py` on the `bowler_gait.py` engine), plus
  two-bone arm IK that holds the bat's toe on the ground behind the crease.
- Third-party data: none. Licence: owner-made original. Skeleton VC17, canonical axes, no retarget.
- A right-handed partner with the bat in his right hand; all clips are mirrorable (a left-hander).
- Clip frame: he faces +Z (down the pitch). In `ns_stance` and `ns_backup` the popping crease is z = +1.0 m in the
  clip's start frame; the bat toe stays grounded at z <= 0.94 m and both feet stay behind the line until `release`.
- Tracks: `bat.grip` (the hand holding the bat), `bat.dir` (grip to toe).

| clip | what | rate |
| --- | --- | --- |
| ns_stance | loop: at the crease, bat grounded behind the line | 15 |
| ns_backup | backs up with the bowler, bat sliding but grounded behind the crease until `release`, then out to `ready` | 30 |
| ns_ready | loop: out of the ground after the release, weight forward | 15 |
| ns_run | loop: running between the wickets, 5.2 m/s, bat carried | 60 |
| ns_ground | from the run: braking strides, slides the bat over the far crease (`ground`; the crease is 4.56 m ahead of the clip origin), stops (`stop`) with the heels lifted | 60 |
| ns_turn | in place (MOTION-SPEC §6: the runtime drives the root from its sprint profile and takes this clip's yaw): from a right strike at 8.7 m/s, braking at 10 m/s² over three strides onto the planted left foot, the bat toe grounded over the line at rest (`ground` = `dwell_start`), a 0.15 s pivot on the left forefoot (`dwell_end`), the right foot round in a low arc landing facing back (`push`), and a 7 m/s² push-off into ns_run at phase 0.5 (`exitR`); `ns_turn_r` is its mirror (a right turn); explosive class, legs only; ground step report-only (lead rulings 2026-11-04) | 60 |
| ns_walk_back | steps back to the crease after the ball (four calm backward steps) and grounds the bat (`grounded`) | 30 |
