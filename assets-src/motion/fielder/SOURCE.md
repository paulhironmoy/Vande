# fielder pack: provenance

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
- **Sources.** `scripts/blender/motion/fielder.py`, `scripts/blender/motion/fielder_common.py` (shared poses).
  - Build: `python3 scripts/blender/motion/build.py fielder`, or the same bake inside Blender 5.2.3. The packed
    bytes are identical either way; this was checked on 2026-11-04.
  - Export: `node scripts/motion/export.mjs --pack fielder`.
- **Third-party data:** none. No motion capture, Mixamo, CMU or traced footage.
  - Quaternius was evaluated and rejected. Its Universal Animation Library page says CC0, but quaternius.com/license.html
    (fetched 2026-11-03, sha256 d1b56be5228d372b049b45cc7447a823da7989a6cf7036f60cfac2284c8fcb0d) now carries the
    Quaternius Asset License v1.0. That licence is not CC0 or CC BY, and it forbids redistributing the assets, even in
    modified form.
- **Licence:** owner-made original. Register id `VANDE-MOTION-FIELDER-001`.
- **Skeleton:** VC17 (MOTION-SPEC), authored in canonical axes, with no retarget.

- **Fielder actions.** The keyframed actions (pickups, long barrier, turn and run) use plants with heel or toe pivots,
  keyed hips and trunk channels, and arm IK with elbow poles in the chest's frame. The pickups and the barrier end in
  the shared `gather` pose, where FIELD2's throw begins.
- **Placement.** Physics places every fielder; these clips keep the hips near the root. Only the gait-style clips
  carry ground travel, which physics-driven consumers ignore (MOTION-SPEC §6).

| clip | what | rate |
| --- | --- | --- |
| `fld_ready` | ready stance loop, on the balls of the feet | 20 |
| `fld_walk_in` | walking in with the bowler, 1.3 m/s loop | 30 |
| `fld_set` | from the walk-in into the ready stance; marker `set` | 60 |
| `fld_sprint_start` | from ready; markers `go`, `exitLeftStrike` | 60 |
| `fld_decel_stop` | run to a balanced half-crouch; markers `plant`, `still` | 60 |
| `fld_return` | calm walk back, 1.3 m/s loop | 30 |
| `fld_pickup_2h` | two-hand pickup into the gather; marker `collect` | 60 |
| `fld_pickup_1h` | one-hand pickup on the run at 3.5 m/s; marker `collect` | 60 |
| `fld_long_barrier` | long barrier into the gather; marker `collect` | 30 |
| `fld_turn_run_r` (alias `fld_turn_run_l`) | drop-step turn and run; markers `go`, `exitLeftStrike` | 60 |
