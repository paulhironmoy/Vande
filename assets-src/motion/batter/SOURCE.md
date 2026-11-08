# Batter anticipation clips (pack `batter`)

Owner: TRACKB. Licence: owner-made original, made for VANDE by a Claude agent for the owner. No third-party
motion and no motion capture: each clip is keyed controls in `scripts/blender/motion/batter_anticipation.py`, solved
per frame with two-bone IK on VC17 (`scripts/blender/motion/batter_vc17lib.py`) and baked to VMS1 (MOTION-SPEC v1.1).

Rebuild:
- Bake: `blender -b --factory-startup --python scripts/blender/motion/batter_anticipation.py -- bake <dir> --assets assets-src/motion/batter`
- Pack: `node scripts/motion/export.mjs --pack batter`

## Clips

All six clips are for a right-hander. A left-hander plays them through the canonical mirror (§3), and every clip is
`mirrorable`. They are in place: the ground track is zero, and the physics places the striker.

| id | kind | rate | what | markers |
| --- | --- | --- | --- | --- |
| `bat_stance_live` | loop, 4.0 s | 30 Hz | Grounded bat near the back toe, face to the bowler; breathing; a ±10 mm weight shift with the bat pivoting on its toe; a double bat tap; head still and level, eyes on the bowler | `tap` 1.5, `tap2` 1.9 |
| `bat_trigger` | one-shot, 0.55 s | 60 Hz | Back-and-across trigger: back foot 3 cm back and 3 cm across, front foot follows 1.5 cm; the bat lifts 3.5 cm off the ground | `set` 0.42 (feet down), `release` 0.55 |
| `bat_backlift` | one-shot, 0.60 s | 60 Hz | Levered backlift from the release: the top hand pivots back to the back hip and rises about 1 cm; the bat turns up behind through elbow flex; it keeps rising slowly after the top, with no dead stop | `release` 0, `top` 0.25, `handoff` 0.25 |
| `bat_ready_hold` | loop, 1.2 s | 30 Hz | The top of the backlift, breathing, for a leave or a late swing | none |
| `bat_backlift_compact` | one-shot, 0.25 s | 60 Hz | Compact backlift to WEB-HUMANS' `BACKLIFT_TOP` (lead request, 2026-11-04): the blade turns from the set pose to level, pointing back at the keeper, face down and a little open; hands' midpoint 6 cm towards the off side of `BACKLIFT_TOP`; hips 6 cm towards leg and the trunk 5° less forward at the top | `release` 0, `top` 0.25, `handoff` 0.25 |
| `bat_ready_hold_compact` | loop, 1.2 s | 30 Hz | The compact top, breathing; frame 0 of every `batter_strokes` clip | none |

Frame 0 of `bat_trigger` equals frame 0 of `bat_stance_live`. Frame 0 of `bat_backlift` equals the last frame of
`bat_trigger`, and frame 0 of `bat_ready_hold` equals the last frame of `bat_backlift`. Likewise frame 0 of
`bat_backlift_compact` equals the last frame of `bat_trigger`, and frame 0 of `bat_ready_hold_compact` equals the
last frame of `bat_backlift_compact`. All seams are exact in the sources (decoded: at most 0.04°, the codec step).

## Timing (align by markers)

| Clip | When it plays |
| --- | --- |
| `bat_trigger` | Align marker `release` to the physics release. It starts 0.55 s before the release, as the bowler gathers. The feet are down 0.13 s before the release, before the backlift starts. |
| `bat_backlift` | Align marker `release` to the physics release. Its top is 0.25 s after the release. |
| `bat_ready_hold` | Plays after `bat_backlift` if no swing has started. |
| `bat_backlift_compact` | Instead of `bat_backlift`: align marker `release` to the physics release; the top is 0.25 s after it. |
| `bat_ready_hold_compact` | Plays after `bat_backlift_compact` until the input. |

Against COVER-DRIVE-SPEC §2, using the frozen-5d P1 contact times:

| Speed | Contact after release | Backlift start | Top of backlift |
| --- | --- | --- | --- |
| 120 km/h | 0.539 s | −539 ms | −289 ms |
| 135 km/h | 0.479 s | −479 ms | −229 ms |
| 150 km/h | 0.431 s | −431 ms | −181 ms |

The spec windows are −560 to −367 ms for the backlift start (median −480 ms) and −300 to −133 ms for the top
(median −200 ms).

## Tracks and hand-off

`bat.grip` is the bottom-hand centre, 0.125 m below the handle cap (MOTION-SPEC v1.1 §5.5). `bat.dir` runs from the
grip to the toe. The top-hand centre is 0.1 m towards the cap.

The palms, not the wrists, sit on those points: each palm centre is 6.5 cm along a neutral wrist from the wrist joint.
VC17's 0.54 m arm cannot reach a grounded bat with the wrist joint on the handle axis. Every frame measures 0 mm from
palm centre to hand point.

**Compact clips: the grip.** A neutral wrist cannot hold the compact top: the palms would face the ground while the
forearms hang, and the bottom forearm would need more than 180° of pronation. So in the compact clips the hands are
solved from their set-pose frames, turning with the blade by 70% of its turn (`gripFollow` 0.7; the other 30%, about
27°, is the grip rolling on the handle, lead ruling 2026-11-04 06:00Z), and the wrists flex (wrist swing at most 79°,
§9 cap 85°). The palm centres stay exactly on the hand points (0 mm). The bottom elbow's pole eases from the stance
pole to (−0.55, 1.2, −0.3) (actor frame) by the top. The search is `choose_compact_offset()`: the least change
that passes §9 over the whole path, recorded in `bake-report.json` (`compactOffset`).

Once the physics bat exists (`batAt`, from the swing start), it is drawn instead and the hands reach for it. The
anticipation never reads the delivery or the player's input.

**The physics' first bat sample is a zone-entry pose.** In the frozen-5d P1 ideal case:
- it comes 0.33 s after the release;
- it is about 0.8 m forward of this backlift's top, with the blade about 83° from it.

So the integrator's swing blend must carry the bat from the anticipation pose to that first sample.

## Stance

COVER-DRIVE-SPEC §1 and wedge §6.3, measured on the bake:

| Measure | Value |
| --- | --- |
| Feet apart (side-on) | 0.50 m |
| Front foot | opened 14° |
| Knees | 34–41° |
| Thorax forward | 38–39° |
| Pelvis and shoulders open towards the bowler | 24° |
| Back shoulder | 12° lower |
| Head | yaw exactly to the bowler, roll 0°, nod 6° down |

**Grip.**
- **Orthodox.** The top (left) hand is at the top of the handle, with the bottom hand directly below.
- **Hand orientation.** The back of the top hand and the palm of the bottom hand face the same direction: towards the
  bowler, 30° to the off side. So the two Vs line up.
- **Wrists.** Both are neutral.
- **Fingers.** VC17 has none. The gloves are closed round the handle by the renderer (WEB-HUMANS `holdBat`; UNITY for
  the hero).
