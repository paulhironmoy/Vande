# Striker stroke overlays (pack `batter_strokes`)

Owner: TRACKB. Licence: owner-made original, made for VANDE by a Claude agent for the owner. No third-party
motion and no motion capture: each clip is keyed controls in `scripts/blender/motion/batter_strokes.py`, solved per
frame with two-bone IK on VC17 (`scripts/blender/motion/batter_vc17lib.py`, with the anticipation solver of
`batter_anticipation.py`) and baked to VMS1 (MOTION-SPEC v1.3.1).

Rebuild:
- Bake: `blender -b --factory-startup --python scripts/blender/motion/batter_strokes.py -- bake <dir> --assets assets-src/motion/batter_strokes`
- Pack: `node scripts/motion/export.mjs --pack batter_strokes`

## What the clips are

Overlay one-shots at 60 Hz. The mask is hips, spine, chest, neck, head and both legs; the arms and hands are left to
the base pose, and the renderer reaches them to the physics bat (`batAt`). Right-handed and `mirrorable`; a
left-hander plays them through the canonical mirror. In place: the ground track is zero.

Frame 0 of every clip equals frame 0 of `bat_ready_hold_compact` (pack `batter`) on every masked bone.

Every clip starts at the player's input (physics 5f: the collision body is the stance until the swing starts; lead
rulings 2026-11-04 04:59Z and ~05:55Z). Nothing moves before the input. The stride is authored at natural pace and is
compressed only when the physics has a pad or body event before the plant.

## Clips

| id | footwork | length | what | markers (s from the input) |
| --- | --- | --- | --- | --- |
| `bat_drive` | forward | 0.92 s | The front foot strides low (5 cm lift) 0.26 m towards the bowler, toe up in the air, heel first, and rocks flat; the weight goes forward over a bending front knee (hips 0.24 m forward and 0.10 m down over 0.45 s); the back heel lifts on the sole tip and the back foot pivots 25°; the head goes down over the front knee; after contact the trunk turns through towards the target | `heel` 0.24, `plant` 0.32, `contact` 0.37 |
| `bat_fwd_defence` | forward | 0.82 s | The same stride; after contact the head stays down over the front knee and the trunk holds | `heel` 0.24, `plant` 0.32, `contact` 0.37 |
| `bat_backfoot_punch` | back | 0.83 s | The back foot steps 8 cm back and 6 cm across (3 cm lift); the front foot stays; the body comes up tall on the back foot (hips 0.10 m back); after contact the chest turns a little towards off | `plant` 0.28, `contact` 0.33 |
| `bat_pull` | back | 0.88 s | The same back-and-across step; the hips open early and turn through 45° after contact on the back foot, which lifts its heel and pivots 40° on the sole tip; the front foot comes round towards leg after contact | `plant` 0.28, `contact` 0.33 |
| `bat_back_defence` | back | 0.78 s | The same step; the head goes down over the ball and the body holds tall | `plant` 0.28, `contact` 0.33 |
| `bat_leave` | none | 0.85 s | The body stays in the stance throughout and the bat stays at the compact top, already behind the body and out of the ball's line (bat tracks `bat.grip`, `bat.dir`, `bat.face`, constant, since a leave has no physics bat); the head turns to watch the ball past from the nominal passing (lead ruling 2026-11-04 ~06:40Z: no grip roll) | `contact` 0.13 (nominal ball passing) |

In every stroke the back knee turns with the pelvis, so the back hip's twist stays inside the §9 cap (50°): drive
and forward defence peak at 39.6°, the pull at 44.4°.

## Markers and timing

- **Natural pace (the default).** Play the clip at 1x from the player's input. The stride plants at `plant`. The
  authored contact (`contact`, the plant + 50 ms) is where the family's follow-through starts; the physics contact
  usually comes earlier (input to contact: p5 67–74 ms, median about 130 ms), so the drawn foot is often still in
  the air at the physics contact (lead ruling 2026-11-04 ~05:55Z).
- **Compressed (pad or body event before the plant, about 8% of strides).** Warp input -> `plant` into the shorter
  window, then play at 1x. The shortest windows that keep every §9 gate at 1x (and every longer window also passes):

  | Clips | Natural input -> plant | Linear warp | Smooth warp (speed 1x at the plant) |
  | --- | --- | --- | --- |
  | `bat_drive`, `bat_fwd_defence` | 320 ms | 216.7 ms | 233.3 ms |
  | `bat_backfoot_punch`, `bat_pull`, `bat_back_defence` | 280 ms | 150.0 ms | 166.7 ms |

  Shorter windows break the leg angular-acceleration cap at lift-off (thigh/shin), or the hips speed step at the
  plant. No explosive cap is used. Below these, the plant cannot be natural in the window: report it, never lead
  the input.
- **The leave.** Play at 1x from the input. There is no physics contact to align; `contact` is nominal.
- **Frame 0.** Every clip starts from `bat_ready_hold_compact` frame 0; the masked bones match it (decoded: at most
  0.039°, the codec step).

## Honesty

- No clip implies a shot, an outcome or a timing that physics did not produce: the clip is chosen from the swing the
  player made, and the follow-through follows the stroke family only, never the outcome.
- The leave keeps the body in the stance throughout; there is no stride-and-leave variant.
- The back-foot strokes step back and across (cricket). Where the physics has a pad/body event, or the ball passes
  near the drawn legs, the physics pads govern (lead ruling 2026-11-04 ~05:55Z).

## Measurements

Decoded pack, `scripts/motion/metrics.mjs` (MOTION-SPEC v1.3.1 gates): 6/6 PASS. Bake 11
(`batter_strokes.py`, Blender 5.2.3, 2026-11-04T06:33:53Z). The search, the compression logs and the per-clip
numbers are in the bake's `bake-report.json` (evidence: `release/product-sequence/stage-1-practice/wedge/humans/
trackb/strokes/`).

**The leave's arms.** The leave holds the compact top, so the hands and wrists are exactly those of
`bat_ready_hold_compact` frame 0 (wrist swing at most 79°, cap 85°; no grip roll beyond the compact top's). Bake 11's
shoulder-arms leave (the blade tilted 60° toe-up) needed about 42° of grip roll, because the bottom wrist is already
cocked 79° at the compact top; the lead chose the hold instead. Re-bake: bake 12, 2026-11-04T07:12:26Z; the other
five clips are byte-identical to bake 11.
