# fielder_actions pack: provenance

Owner-made original motion, authored by MOTION-FIELD2 (a Claude agent working for the owner) on 2026-11-04 UTC. It
starts from MOTION's first drafts in the same file.

- **Method.** Original keyframes on the VC17 control rig (`scripts/blender/motion/vc17.py`):
  - foot plants with heel strike, heel peel and pivot;
  - analytic two-bone leg IK, handed over to keyed FK legs frame by frame where a foot leaves the ground;
  - explicit FK arms (upper-arm direction in the chest frame, shoulder twist, elbow flex), so no elbow-pole flips;
  - for the fast pair, one continuous clip split into two (`Segment`), so the hand-over is exact in pose and velocity.

  The source is `scripts/blender/motion/fielder_actions.py`. `python3 scripts/blender/motion/build.py fielder_actions`
  writes these VMS1 files.
- **Third-party data:** none. No motion capture, no Mixamo, no CMU, no Quaternius and no traced footage.
- **Licence:** owner-made original. Register id `VANDE-MOTION-FIELDER-ACTIONS-001`.
- **Skeleton:** VC17 (MOTION-SPEC), authored directly in canonical axes, with no retarget.
- **Handedness.** A right-handed fielder. The `_l` names and left-handers play through the canonical mirror (§3).
- **Placement.** In place: the physics places the fielder, the ground track is zero, and consumers ignore it (§6).

| clip | what | markers | rate | codec |
| --- | --- | --- | --- | --- |
| `fld_throw_over` | Overarm throw at the target (+Z). It starts from `fielder_common.gather(-72)` and the feet where `fld_pickup_2h` ends. A long-arm take-back, a front-foot stride, the hips then shoulders turn, release high in front, follow-through and a back-foot step-through. Hips offset is (0, −0.16, 0.24) m at `release` and (0, −0.07, 0.44) m at the end (decoded). | `release` 0.66 s | 60 | 1 |
| `fld_flick_under` | Underarm flick at the stumps (+Z) from low beside the ball: a short back-swing as the front foot steps at the target, the ball hand swings through low, follow-through at the target and a back-foot step-through. Release hand about 0.60 m high and 0.60 m ahead. Hips offset is (0, −0.24, 0.16) m at `release` and (0, −0.13, 0.30) m at the end. | `release` 0.36 s | 60 | 1 |
| `fld_dive_r` (alias `fld_dive_l`) | Full-length dive to his right from the ready stance. A load, then a push from the near (right) foot while the far knee drives; the body lays out on its side with both arms at full stretch, lands on the right forearm, hip and side, and draws the ball in. In place: the hips offset is at most 0.07 m in x and 0 in z (MOTION-SPEC §6 dive rule). | `reach` 0.46 s, `land` 0.58 s | 60 | 1 |
| `fld_getup_r` (alias `fld_getup_l`) | Up from the dive. It starts exactly on `fld_dive_r`'s last frame. The right hand pushes on the ground, the left foot comes through, a moment on the right knee, then he stands into a slightly staggered ready stance with the ball in the left hand. Hips offset at the end is (0, −0.13, 0.15) m. | `up` 1.20 s | 60 | 1 |
| `fld_dive_fast_r` (alias `fld_dive_fast_l`) | The fast dive (lead ruling 2026-11-04). The same load, push and reach as `fld_dive_r`, landing on the right side. It is the first half of one continuous dive-and-scramble, split at 0.65 s, just after the landing. Hand over to `fld_dive_scramble_r` at its last frame, with no cross-fade. Hips offset is at most 0.07 m in x and 0.03 m in z. | `reach` 0.46 s, `land` 0.58 s | 60 | 1 |
| `fld_dive_scramble_r` (alias `fld_dive_scramble_l`) | The scramble up, the second half. He rolls up off the right forearm while the ball is drawn in, both feet come under him (left, then right) at their ready-stance spots, and he rises. He is on his feet at `up`, 0.8 s after `reach` (physics `DIVE.recoverS`), and ends exactly in the ready stance. The hand-over to `fld_ready` or `fld_sprint_start` has 0.0 mm of foot movement. Hips offset is at most 0.05 m in x and 0.03 m in z. | `up` 0.61 s | 60 | 1 |
| `fld_catch_high` | High catch: up on the toes, head back, both hands up in front of the face with the fingers up (wrists about 0.18 m above and 0.38 m in front of the head joint), then the hands give down to the chest as the knees soften. FK arms. | `catch` 0.40 s | 30 | 1 |
| `fld_catch_low` | Low catch in front: knees bend, hands meet low with the fingers down, then the ball comes up to the chest. | `catch` 0.36 s | 30 | 1 |
| `fld_celebrate` | A short, contained celebration after a catch. It starts on `fld_catch_low`'s last pose: the ball hand drops to the hip, one fist pump to head height, then the arms settle by the sides. Nothing is aimed at the batter. | `peak` 0.46 s | 30 | 1 |
