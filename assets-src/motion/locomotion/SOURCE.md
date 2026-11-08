# locomotion pack: provenance

Owner-made original motion, authored by MOTION (a Claude agent working for the owner) on 2026-11-03 and 2026-11-04
UTC.

- **Method.** A footstep generator driven by a ground path and a speed profile (`scripts/blender/motion/gait.py`) on
  the VC17 control rig (`scripts/blender/motion/vc17.py`). Every gait parameter is an authored key on a speed axis:
  standing, walk, jog, run, sprint.
  - **Feet.** Plants hold the shoe's touching points (heel, ball, sole tip) still in the world.
  - **Swing.** Joint-space Hermite curves through IK-solved waypoints: toe-off, heel recovery, passing, reach, strike.
    They are matched in angle and rate at both plants, with ground clearance.
  - **Legs.** Analytic two-bone IK, with a smooth hip-height guard.
  - **Upper body.** Hips, trunk, head and arms follow the stride phase.
- **Sources.** `scripts/blender/motion/locomotion.py`.
  - Build: `python3 scripts/blender/motion/build.py locomotion`, or the same bake inside Blender 5.2.3. The packed
    bytes are identical either way; this was checked on 2026-11-04.
  - Export: `node scripts/motion/export.mjs --pack locomotion`.
- **Third-party data:** none. No motion capture, Mixamo, CMU or traced footage.
  - Quaternius was evaluated and rejected. Its Universal Animation Library page says CC0, but quaternius.com/license.html
    (fetched 2026-11-03, sha256 d1b56be5228d372b049b45cc7447a823da7989a6cf7036f60cfac2284c8fcb0d) now carries the
    Quaternius Asset License v1.0. That licence is not CC0 or CC BY, and it forbids redistributing the assets, even in
    modified form.
- **Licence:** owner-made original. Register id `VANDE-MOTION-LOCOMOTION-001`.
- **Skeleton:** VC17 (MOTION-SPEC), authored in canonical axes, with no retarget.
- **Cadence and stride.** They follow published human ranges: walk 1.5 m/s at 112.5 steps/min, jog 3.3 at 163.6, run
  5.6 at 175.6, sprint 7.8 at 225. These are engineering values, not human-validated.

| clip | what | rate |
| --- | --- | --- |
| `loco_idle` | standing loop: weight shift, breathing | 15 |
| `loco_walk` | walk loop, 1.5 m/s | 30 |
| `loco_jog` | jog loop, 3.3 m/s | 60 |
| `loco_run` | run loop, 5.6 m/s | 60 |
| `loco_sprint` | sprint loop, 7.8 m/s | 60 |
| `loco_start` | standing to about 4.6 m/s; markers `go`, `exitLeftStrike` | 60 |
| `loco_stop` | run (5.6 m/s, left strike) to standing; markers `plant`, `still` | 60 |
| `loco_turn_l90` (alias `loco_turn_r90`) | turn on the spot; marker `go` | 30 |
| `loco_strafe_l` (alias `loco_strafe_r`) | sideways step-close loop, 0.85 m/s | 60 |
