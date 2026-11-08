# Wicketkeeper clips (pack `keeper`)

Owner: MOTION-KEEPER, a Claude agent working for the VANDE owner on MOTION's format.

**Licence.** Owner-made original. There is no third-party motion, no motion capture, no Mixamo, no CMU data and no
download of any kind.

**How the clips are made.** Each clip is keyed controls in `scripts/blender/motion/keeper.py`. The engine is
MOTION's VC17 control rig (`vc17.py`):
- two-bone IK legs on world-fixed foot plants;
- arm IK on glove targets;
- FK spine, neck and head.

The clips are baked to VMS1 (MOTION-SPEC v1.2.4) and exported to VMP1, codec 1.

**What `keeper.py` adds**, all in its own code:
- glove-centre targets with finger and palm directions;
- wrist rotations interpolated by swing and twist relative to the forearm;
- heel pitch keyed over time on a planted foot;
- FK legs placed from ankle targets during the dive.

**Rebuild:**
- Quick bake, no Blender: `python3 scripts/blender/motion/build.py keeper`
- Blender bake, which also writes the editable `.blend`: `Blender --background --factory-startup --python scripts/blender/motion/build.py -- keeper --blend <dir>`
- Pack, which writes the web `.vmp` and the Unity `.bytes`/`.meta`: `node scripts/motion/export.mjs --pack keeper`
- Measurements, not certification: `node scripts/motion/metrics.mjs public/practice/motion/keeper.vmp`

## The keeper

He is a right-handed keeper in his own actor frame: +Z faces the bowler and +X is his left.
- `_r` clips go to his right (−X).
- The `_l` ids are canonical-mirror aliases (§3) and cost no bytes.
- A left-handed striker mirrors the whole scene as usual.

| id | kind | rate | what | markers |
| --- | --- | --- | --- | --- |
| `kp_crouch_back` | loop, 2.4 s | 15 Hz | Standing back to pace. A deep balanced squat on the balls of the feet: heels up 24°, feet 0.40 m apart and turned out 16°, knees over the toes, hips at 0.46 m. Gloves are together low between the knees, fingers down and palms to the bowler. Head still and level. Breathing and a ±6 mm settle | none |
| `kp_crouch_up` | loop, 2.4 s | 15 Hz | Standing up to spin: closer, lower (hips 0.42 m) and more compact, gloves nearer the ground | none |
| `kp_rise` | one-shot, 0.60 s | 30 Hz | He stays down until the ball pitches, then rises with it into the set half-crouch (hips 0.68 m, gloves together at 0.59 m) | `bounce` 0.05, `set` 0.45 |
| `kp_shuffle_l` | loop, 0.40 s | 60 Hz | Crouched side shuffle to his left at 1.5 m/s. Step-close: the lead foot steps out, the trail foot closes, and the feet never cross. On the balls of the feet. The hips ease as each foot lands and surge between strikes; the head stays level | none (frame 0 = left strike); `kp_shuffle_r` is the mirror alias |
| `kp_take_waist_r` | one-shot, 1.0 s | 60 Hz | Below the waist: fingers down, palms to the ball, the head moving into its line. The gloves give back about 0.18 m with the ball, then he stands holding it | `take` 0.26; `kp_take_waist_l` is the mirror alias |
| `kp_take_chest_r` | one-shot, 1.0 s | 60 Hz | Above the chest: the hands turn from fingers-down to fingers-up as they rise, palms to the ball, thumbs together. The give draws them back and down, then he stands with the ball | `take` 0.30; `kp_take_chest_l` is the mirror alias |
| `kp_dive_r` | one-shot, 1.25 s | 60 Hz | A dive to his right. He loads and drives off the near (right) foot, the left foot leaving first. He flies flat with both gloves at full stretch, palms to the ball. He lands on his right side holding the ball up off the ground, draws it in, comes up onto his knees, puts the left foot through and stands | `reach` 0.26, `land` 0.42, `up` 1.12; `kp_dive_l` is the mirror alias |

`kp_stump` (§11) is deliberately not built:
- the frozen physics never produces a stumping;
- WEB-FIELD will never wire it;
- so it would only add bytes to the web pack and the Android APK.

## Seams

These are measured on decoded bytes; the angle is the largest per-bone difference.

| From | To | Difference |
| --- | --- | --- |
| `kp_crouch_back` frame 0 | `kp_rise` frame 0 | 0.04° |
| `kp_rise` end | frame 0 of `kp_take_*` | 0.04° |
| `kp_rise` end | frame 0 of `kp_dive_r` | 0.04° |
| `kp_crouch_*` | wrap of its own loop | 0.04° |
| `kp_crouch_up` | `kp_rise` at the bounce | 9°, 4 cm |
| `kp_crouch_up` | take frame 0 | 47°, 26 cm |
| crouch or set | shuffle | 40–42°, 8–14 cm |

- **Every take and the dive start from the same set half-crouch.** So `kp_rise` hands over to any of them with no
  pop.
- **Spin (`kp_crouch_up`).** Warping `kp_rise` from the bounce keeps him low until the ball pitches. Skipping the rise
  and going straight to the take's frame 0 is the larger jump in the table. The integrator is told this.
- **Shuffle.** The jump in the table is a real stance change, so it needs the integrator's cross-fade.
- **End poses.** The takes and the dive all end standing with the ball, so they blend into the idle. The dive's end
  differs from a take's by 16° at the feet, because its feet are staggered.

## Honesty (MOTION-SPEC §6)

- **Crouches.** They are generic holds, identical for every delivery, and lean nowhere.
- **Rise.** The rise starts at `bounce`, the physics bounce. Before it the pose is the crouch.
- **Takes and dive.** These are reactions aligned on the physics: a take is aligned on `take` (physics `keeper_take`),
  and a dive on `reach` (the physics path's dive → take).
- **Everything is in place.** No ground track except the shuffle's cycle travel, which is for speed matching only and
  is ignored by physics-driven consumers.
- **The dive's hips offset** stays within |x| ≤ 0.07 m and |z| ≤ 0.06 m, so the physics path carries the dive.
- **The dive's `up`** is 0.86 s after `reach`, within the physics recovery (`DIVE.recoverS` 0.8 s; dive clips land
  and rise in 0.78–0.95 s).

## Gates

The gates are MOTION-SPEC v1.2.4 §9, applied to decoded bytes. Two of them are stated engineering bands, not
human-validated:
- `kp_shuffle_l` is checked against the lateral band of v1.2.2: 0.8–2.5 m/s at 180–340 steps/min, step/leg 0.2–1.2.
- `kp_dive_r` is in the explosive class of v1.2.4: arms and legs may change by up to 650°/s per frame, and the torso
  and head stay at 300.

The numbers are in
`release/product-sequence/stage-1-practice/wedge/humans/motion-keeper/`. They are builder measurements, not
certification.
