# MOTION-SPEC: the shared VANDE human-motion format (VC17 skeleton, VMP1 packs)

Owner: MOTION. Status: **v1.3.1**, 2026-11-04 (UTC). Every human clip for either renderer follows this spec.

Changes in v1.3.1 (lead ruling). No pack or format change.
- §6: the v1.2.1 striker footwork exception is SUPERSEDED as of 2026-11-04 04:59Z.
  - In physics 5f the collision body is the stance until the swing itself starts, so the stride starts at the input.
  - Before the input there is only the generic trigger (about 3 cm or less) and the backlift.
  - The `bat_trigger` exception (v1.2) stays.

Changes in v1.3 (lead ruling). No pack or format change.
- §3: the rule for Unity. UNITY measured that the Unity production rigs' L/R labels are anatomically mirrored
  (`rigLabelsAnatomical = false`). With the Unity world now reflected (option A), the Unity adapter applies the
  canonical mirror to every pack pose at sampling, bat tracks included.

Changes in v1.2.5 (lead ruling). No format change.
- §9: the explosive class is now an explicit, reasoned list of clip ids (`EXPLOSIVE` in `scripts/motion/metrics.mjs`,
  printed by the tests), with no pattern matching and no speed rule. Any change to a cap or to this list needs a lead
  ruling first. MOTION-BOWL's spin deliveries, follow-throughs and walks stay at 300.

Changes in v1.2.3. No format change. These are reader rulings from the C# port (MOTION-CS); `vmp.ts` implements
them.
- Readers renormalise every direction track (kind 2) after interpolation.
- Stored yaw must be continuous: the exporter rejects a jump of 90° or more between frames or across the loop seam.
- An overlay whose mask leaves out the hips writes neither the root (hips offset) nor the ground.
- Position tracks (kind 1) scale with body scale. The Unity driver's 0.9836 leg factor applies only to hips x/z and
  the ground, never to tracks.
- A mirror alias's directory byte count must equal its source's, and readers reject a mismatch.

Changes in v1.2.2. No format change.
- §9: a stated cadence band for sideways step-close shuffles, which are not forward gaits.

Changes in v1.2.1. No format change.
- §6: the lead's second striker-only exception: physics-read footwork before the input.

Changes in v1.2. None of them changes the binary format.
- §6: the lead's anticipation exception for `bat_trigger`.
- §5.5: an optional `bat.face` direction track.
- §9: the plant point is redefined as a rigid shoe's touching points. Root speed is measured over 1/30 s windows,
  because of the 1 mm track quantisation. A stated angular-acceleration cap is added for fast-running legs.

Changes in v1.1. None of them changes the binary format.
- §5.5: `bat.grip` is the **bottom (lower) hand** centre, matching `BatKey.grip`.
- §7: a loop source carries a closing frame.
- §9: foot slide is measured at the ball of the foot.
Change requests go to MOTION through the lead. Physics stays authoritative and frozen: nothing here moves a
release, a contact, a fielder's path or a run. A clip only draws a body on top of physics times and positions.

Users of this spec: MOTION-BOWL (bowler, non-striker), TRACKB (batter stance, trigger, backlift), WEB-HUMANS,
WEB-FIELD and UNITY (integration).

## 1. The canonical skeleton: VC17

VC17 is the 17-bone hierarchy that both renderers already drive:
- Three.js: `BONE_NAMES` / `SKELETON` in `src/render3d/core/skeleton.ts`, consumed through `SampledPose`.
- Unity: `ProductionCharacterJoint` in `ProductionCharacterContracts.cs`. These are the driver joints of
  `ProductionCharacterRig`. The 75-bone hero skeleton (VSK1) maps onto them through
  `ProductionHeroSkeletonInstance.Synchronize`.

VC17 adds no bones. Both renderers use the same bone ids in the same order.

| id | bone | parent | rest offset, canonical = Three.js (m) | Unity driver offset (m) | Unity joint |
| --- | --- | --- | --- | --- | --- |
| 0 | hips | none | (0, 0.98, 0) | (0, 0.96, 0) | Hips |
| 1 | spine | hips | (0, 0.11, 0) | same | Spine |
| 2 | chest | spine | (0, 0.20, 0) | (0, 0.21, 0) | Chest |
| 3 | neck | chest | (0, 0.235, 0) | same | Neck |
| 4 | head | neck | (0, 0.085, 0.012) | same | Head |
| 5 | upperArmL | chest | (0.205, 0.182, −0.012) | (0.205, 0.18, −0.012) | UpperArmLeft |
| 6 | forearmL | upperArmL | (0, −0.285, 0) | same | ForearmLeft |
| 7 | handL | forearmL | (0, −0.255, 0) | (0, −0.25, 0) | HandLeft |
| 8 | upperArmR | chest | (−0.205, 0.182, −0.012) | (−0.205, 0.18, −0.012) | UpperArmRight |
| 9 | forearmR | upperArmR | (0, −0.285, 0) | same | ForearmRight |
| 10 | handR | forearmR | (0, −0.255, 0) | (0, −0.25, 0) | HandRight |
| 11 | thighL | hips | (0.095, −0.065, 0) | (0.095, −0.055, 0) | ThighLeft |
| 12 | shinL | thighL | (0, −0.43, 0) | same | ShinLeft |
| 13 | footL | shinL | (0, −0.42, 0) | (0, −0.415, 0) | FootLeft |
| 14 | thighR | hips | (−0.095, −0.065, 0) | (−0.095, −0.055, 0) | ThighRight |
| 15 | shinR | thighR | (0, −0.43, 0) | same | ShinRight |
| 16 | footR | shinR | (0, −0.42, 0) | (0, −0.415, 0) | FootRight |

The comment in `skeleton.ts` says "19 bones"; the array holds 17. VC17 is the 17 in the array.

**Actor frame.** Y is up, +Z is the character's forward and +X is the character's left. Units are metres. Both rigs
use these numbers.

**Rest pose.**
- Standing, arms hanging, every rest rotation identity.
- Limb bones (arms, legs) point along local −Y, and spine, neck and head along +Y.
- The foot bone sits at the ankle; the shoe extends along +Z.
- The planted ankle height at rest is 0.065 m (Three.js) or 0.060 m (Unity driver).

**Rotations.** Each bone's rotation is a unit quaternion (x, y, z, w), local to its parent and relative to rest.
Because rest is identity, the rotation is also the bone's local rotation:
- Three.js: `bone.quaternion = q`, as `applyPose` already does.
- Unity driver: `joint.localRotation = new Quaternion(x, y, z, w)`. Copy the components unchanged; see §3.
- Unity hero (VSK1): for an arm bone `Synchronize` writes `rest · inverse(parent correction) · q · correction` (UNITY-5, 2026-11-07), so a canonical-zero forearm stands straight on its upper arm; the hand has its own correction that takes its long axis (wrist to middle finger) to down. Feed it the driver. Before UNITY-5 it wrote `rest · q · correction`, which left every arm the grip IK did not solve with a 39.4° elbow offset at canonical zero.

**Euler numbers are authoring sugar only.** `clips.ts` writes Euler degrees in order XYZ (three.js), and its sign
conventions are in the `skeleton.ts` header.
- Unity's `Quaternion.Euler(x, y, z)` composes in ZXY order. It agrees with three.js only when one axis is non-zero.
- So never send Euler triples to Unity. VMP1 carries quaternions.
- Note for UNITY: the hand port in `ProductionFieldingClips.cs` passes the web's XYZ Euler to `Quaternion.Euler`.
  Its multi-axis keys therefore differ slightly from the web. One example is `spine:38,40,0` in the throw.

**Body scale.** Players are scaled per rig (`rig.scale` on the web). Hips offsets and ground travel scale with the rig;
rotations do not. Playback rate for a speed-matched loop is `rate = v / (scale · clip.speedMps)` (§6).

## 2. Retarget maps

| Target | Mapping | Rest difference handled by |
| --- | --- | --- |
| Three.js rig (`players.ts`) | bone id i → `rig.bones[i]` (same order) | none; canonical = Three.js |
| Unity driver rig | id i → `ProductionCharacterJoint` i (same order) | leg length 0.900 vs 0.915 m: multiply ground travel and hips x/z by **0.9836**; leave hips y unscaled, because the driver hips sit 0.02 m lower and the ankles 5 mm lower, so planted feet stay planted |
| Unity hero (VSK1, MakeHuman, 75 bones) | the driver through `Synchronize` (the 17 semantic ids) | VSK1's A-pose arms: `canonicalRestCorrections` with the parent-correction undo (UNITY-5) and a hand correction. Scale travel by hero leg length ÷ 0.915 (UNITY measures it) |
| Blender authoring armature `VC17` | identical names, offsets mapped by B(x, y, z) = (x, −z, y) (+90° about X, det +1, no mirror) | Blender bone rolls are arbitrary; the exporter converts through world-space deltas (§8) |
| VMA1 semantic bones (old CMU exporter, now frozen) | root→hips; spine_lower→spine; spine_upper+chest→chest; neck_lower+neck_upper→neck; head→head; clavicle+upper_arm→upperArm; forearm→forearm; wrist+hand→hand; upper_leg→thigh; lower_leg→shin; foot+toes→foot | reference only; **no new CMU use** |
| CC0 source rigs (for example Quaternius) | the per-source table lives in `assets-src/motion/locomotion/SOURCE.md` | world-space delta retarget with rest alignment (§8) |

## 3. Handedness and the mirror

**The canonical mirror** is the one operation every mirror uses: left-handed batters, left-arm bowlers, a left dive
from a right dive, and a left take from a right take. It is exactly `mirrorSampledPose` in `clips.ts`:

1. Swap the L and R bones (upperArm, forearm, hand, thigh, shin, foot).
2. Change every quaternion (x, y, z, w) to (x, −y, −z, w).
3. Negate hips offset x and ground x, and negate ground yaw.
4. Swap `footL`↔`footR` and `handL`↔`handR` in the contact bits (§5.4).
5. Mirror vector tracks: positions as (−x, y, z), directions as (−x, y, z).
6. Keep markers unchanged.

Unity's `ProductionFieldingClips.Mirror` does the same on its Euler form.

**Physics frame.**
- The physics runs in the right-handed striker's frame: +Z towards the striker and +X towards his off side.
- Three.js draws a left-hander as x → −x (`docs/PRACTICE_PRESENTATION.md` § Left-handers).
- Unity's `ToUnity` does the same.
- The bowler keeps his real arm: mirror his pose only when the bowler's own arm is left.

**Rule for Unity (v1.3, lead ruling 2026-11-04).** Unity production rigs: apply the canonical mirror at sampling,
bat tracks included (x → −x).
- **Why.** UNITY measured the rigs from the knees, independently of their labels, and found that their L/R labels are
  anatomically mirrored (`rigLabelsAnatomical = false`). The VC17 layout (face +Z, "left" at local +X) was copied into
  left-handed Unity, where +X is the character's right.
- **What happens.** With the Unity world reflected (option A), every pack pose passes through the mirror above in
  UNITY's adapter: swap L/R, (x, −y, −z, w), hips and ground x negated, yaw negated, contact bits swapped, tracks
  (−x, y, z).
- **What does not change.** The packs and the web are unchanged. A left-hander's or left-side clip's own mirror is
  applied as usual and composes with this one: two mirrors cancel.

**Parity warning for UNITY (v1.0, kept for the record). It is now resolved by the rule above.**
- Unity is a left-handed engine. `ToUnity` passes right-hander positions unchanged (x → x), and no camera or scene
  reflection exists in `Assets/VandePractice`, according to a grep for `projectionMatrix`, `invertCulling` and
  negative scale.
- A numerically identical scene therefore renders in Unity as the mirror image of the Three.js render. A right-handed
  striker would then look left-handed, with the off side on the left of the rear camera's screen. This may be part
  of the owner's complaint that the bat is held the wrong way.
- Verification: take one capture from behind a right-hander. Expected: the off side is on screen right, the right
  hand is the lower hand on the handle, and the bowler's arm is correct.
- Possible fix: if the capture is wrong, convert the whole world with x → −x and every pose with the canonical mirror
  above. The fix is the same for every clip in this spec, so no clip needs re-authoring.

## 4. Files, packs and ownership

| Path | What | Owner |
| --- | --- | --- |
| `scripts/motion/` | exporter `export.mjs`, decoder/sampler `vmp.ts` (erasable TypeScript, runs in Node 26 and drops into `src/`), naturalness metrics `metrics.mjs`, tests `*.test.mjs`, C# reference decoder `scripts/motion/unity/VandeMotionPack.cs` (outside Assets; UNITY copies it) | MOTION |
| `scripts/blender/motion/` | `vc17.py` (armature, IK control rig and bake library), plus one authoring script per pack | MOTION; MOTION-BOWL and TRACKB add `bowler_*.py`, `batter_*.py` with lead approval |
| `assets-src/motion/<pack>/` | VMS1 source JSON per clip (§7) plus `SOURCE.md` (provenance, licence, retarget table) | `locomotion/`, `fielder/`, `keeper/`: MOTION. `bowler/`, `nonstriker/`: MOTION-BOWL. `batter/`: TRACKB |
| `public/practice/motion/<pack>.vmp` | web packs, fetched lazily, never in the initial bundle | MOTION builds them; each pack's author owns its sources |
| `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Motion/<pack>.bytes` | the same bytes as the web pack (Unity TextAsset), plus `.meta` with deterministic GUIDs | MOTION |

The packs are `locomotion`, `fielder`, `keeper`, `bowler`, `nonstriker` and `batter`. Clip ids are `snake_case` and
unique across all packs:
- `loco_*`
- `fld_*`
- `kp_*`
- `bowl_*`
- `ns_*`
- `bat_*`

Building: `node scripts/motion/export.mjs [--pack <name>] [--check]`. The build reads
`assets-src/motion/<pack>/*.vms.json` and writes both outputs byte-identically. With `--check` it verifies that the
committed outputs match and exits non-zero otherwise.

## 5. The binary format: VMP1 pack holding VMC1 clips

All values are little-endian. Readers must check every length and reject trailing bytes. `i16` is two's complement
and `f32` is IEEE-754.

### 5.1 Pack header (32 bytes)

| off | type | field |
| --- | --- | --- |
| 0 | char[4] | `VMP1` |
| 4 | u16 | version = 1 |
| 6 | u16 | header bytes = 32 |
| 8 | u16 | bone count = 17 |
| 10 | u16 | clip count N (entries, including mirror aliases) |
| 12 | u32 | skeleton id = FNV-1a-32 of the ASCII string `VC17:hips,spine,chest,neck,head,upperArmL,forearmL,handL,upperArmR,forearmR,handR,thighL,shinL,footL,thighR,shinR,footR` |
| 16 | u32 | string table offset |
| 20 | u32 | string table bytes |
| 24 | u32 | total bytes (the file length) |
| 28 | u32 | CRC-32 (IEEE) of bytes [32, total) |

After the header come N directory entries of 16 bytes each:

| off | type | field |
| --- | --- | --- |
| 0 | u16 | clip name (string index) |
| 2 | u16 | entry flags: bit0 = mirror alias |
| 4 | u32 | clip record offset (from the start of the file); for an alias, the record of the source clip |
| 8 | u32 | clip record bytes (an alias repeats the source's) |
| 12 | u16 | alias source clip name (string index), or 0xFFFF |
| 14 | u16 | reserved = 0 |

An alias plays its source through the canonical mirror (§3). That stores `fld_dive_l` as `mirror(fld_dive_r)` for no
extra bytes. The marker times are the same.

**String table.** u16 count, then for each string a u16 byte length followed by ASCII bytes. Index 0 is the empty
string.

### 5.2 Clip record (VMC1): header (48 bytes)

| off | type | field |
| --- | --- | --- |
| 0 | char[4] | `VMC1` |
| 4 | u16 | clip name (string index; for an alias, the source's name) |
| 6 | u16 | flags (below) |
| 8 | u16 | sample rate in Hz: 15, 20, 30 or 60 |
| 10 | u16 | frame count F ≥ 2 |
| 12 | u32 | bone mask: bit i set means bone i is stored and driven by this clip |
| 16 | u8 | quaternion codec: 1 = 32-bit smallest-three 10/10/10; 2 = 48-bit smallest-three 15/15/15 |
| 17 | u8 | track count T (vector tracks, §5.5) |
| 18 | u16 | marker count M |
| 20 | f32 | duration in seconds: a loop is F / rate (frame F ≡ frame 0); a one-shot is (F − 1) / rate |
| 24 | f32 | `speedMps`, mean ground speed over the clip (loops: the cycle) along the travel direction; 0 if none |
| 28 | f32 | travel x (m): ground displacement per loop cycle or over the clip (end − start) |
| 32 | f32 | travel z (m) |
| 36 | f32 | travel yaw (degrees; + turns towards +X, the character's left) |
| 40 | f32 | cycle steps, the number of foot strikes per loop cycle (2 for gaits); 0 if none |
| 44 | u16 | role (string index), for example `fielder` or `keeper`; informative only |
| 46 | u16 | reserved = 0 |

| bit | name | meaning |
| --- | --- | --- |
| 0 | loop | the clip wraps; travel accumulates by (travel x, z, yaw) per cycle |
| 1 | ground | the ground track is not all zero (the clip travels or turns) |
| 2 | mirrorable | the clip may be mirrored (left side, left-hander); a bowler action with the real arm is not |
| 3 | overlay | apply only the masked bones on top of a base pose (an upper-body layer); unmasked bones are left to the base. If the mask leaves out the hips (bit 0), the root and the ground are left to the base too (v1.2.3) |
| 4 | phase0LeftStrike | a gait loop whose frame 0 is the left foot strike and whose half-cycle is the right foot strike; all gait loops set it so they stay phase-synced |

After the header come the M markers (8 bytes each), then the T track descriptors (4 bytes each), then the frames
(§5.3).

Marker:

| off | type | field |
| --- | --- | --- |
| 0 | u16 | name (string index) |
| 2 | u16 | reserved = 0 |
| 4 | f32 | time in seconds, 0 ≤ t ≤ duration |

Track descriptor:

| off | type | field |
| --- | --- | --- |
| 0 | u16 | name (string index) |
| 2 | u16 | kind: 1 = position, 1 mm per unit; 2 = direction, 1/32767 per unit |

### 5.3 Frame layout

Each frame holds the fields below in order. The stride is 14 + B·Q + 6·T bytes, where B is the number of bones in
the mask and Q is 4 bytes for codec 1 or 6 for codec 2.

| field | type | meaning |
| --- | --- | --- |
| ground x, z | i16 ×2 | metres × 1000. The **ground track**: where the character's ground origin is, in the clip's start frame (frame 0 = (0, 0)) |
| ground yaw | i16 | degrees × 100. The heading of the ground origin (+ = towards +X) |
| hips x, y, z | i16 ×3 | metres × 1000. The **hips offset** from the rest hips position (0, 0.98, 0), in the ground origin's frame. This is `SampledPose.root` |
| contacts | u8 | bit0 footL, bit1 footR, bit2 handL, bit3 handR, bit4 kneeL, bit5 kneeR, bit6 body (hip, side or chest on the ground) |
| reserved | u8 | 0 |
| bone quaternions | B × codec | the masked bones in id order, local to the parent, relative to rest; hips is relative to the ground origin |
| vector tracks | T × i16 ×3 | in the ground origin's frame |

Limits: |ground| ≤ 32.767 m, |hips offset| ≤ 32.767 m, |yaw| ≤ 327.67°. The exporter rejects any clip outside them.

### 5.4 Quaternion codecs (smallest three)

Encoding:
1. Normalise q.
2. Find i, the index of the largest |component| (0 = x, 1 = y, 2 = z, 3 = w; the first one wins a tie).
3. If q[i] < 0, negate q.
4. Encode the other three components in index order as `v = round((c·√2 + 1) / 2 · (2^n − 1))`, clamped to
   [0, 2^n − 1].

Decoding:
1. Compute each stored component as `c = (v / (2^n − 1) · 2 − 1) / √2`.
2. Compute `q[i] = √max(0, 1 − Σc²)`.
3. Normalise.

| codec | n | layout | worst angular error per joint |
| --- | --- | --- | --- |
| 1 | 10 | one u32 = `i << 30 \| a << 20 \| b << 10 \| c` | ≤ 0.21° worst case, about 0.07° typical (measured on 2,000 random rotations) |
| 2 | 15 | three u16: w0 = `(i & 1) << 15 \| a`, w1 = `(i >> 1) << 15 \| b`, w2 = `c` (bit 15 of w2 = 0) | ≤ 0.01° worst case |

Use codec 2 for close-up roles (`batter`, `bowler`). Codec 1 is allowed for distant roles (`fielder`, `keeper`,
`locomotion`, `nonstriker`) when the measured foot-slide and pop metrics still pass after quantisation (§9).

### 5.5 Vector tracks (optional)

| name | kind | use |
| --- | --- | --- |
| `bat.grip` | position | the batter's **bottom (lower) hand centre** on the handle, in the actor frame. This is `BatKey.grip`: `LOWER_HAND_FROM_CAP` = 0.125 m below the handle cap (`props.placeBat`, stageScene `reachIK`). It is not the top hand |
| `bat.dir` | direction | from the lower hand towards the toe; this is `BatKey.dir` |
| `bat.face` | direction | optional (v1.2): the blade face's outward unit normal, from which the backlift's open face can be drawn. Its cost is 4 B per clip plus 6 B per frame. Readers without it behave as before; `vmp.ts` returns it as `bat.face` and mirrors it to (−x, y, z) |
| `ball.hand` | position | where the ball sits in the bowling or throwing hand (for alignment checks only) |

Other names need MOTION's approval. A bat track never replaces the physics bat: from the swing on, the bat drawn is
`batAt` (frozen `frame.ts`), and the body's hands reach it with IK.

**`bat.face` must survive blends (WEB-FIX-A, 2026-11-07).** A reader that rebuilds the bat key at an inertial switch must keep the face (it decays with the blade, not instantly), and a cross-fade between a clip with a face and one without blends the one-sided face with the other side's hint (the direction the grip would give), never switches at w = 0.5. Without this the leave's bat turned 72.6° about its blade in one frame at the input and the gloves closed with their backs to the face; the glove roll is also a state (it drifts at most 360°/s and is held inside the wrist arc on the circle), not a clamp chosen by the sign of the wanted angle, which flips by 120° where that angle crosses ±180°.

## 6. Sampling and use

**Time.**
- One-shot: t is clamped to [0, duration]. The frame position is f = t · rate.
- Loop: t wraps by duration. The frame after F − 1 is frame 0 plus one cycle's travel.
- To interpolate between frames ⌊f⌋ and ⌊f⌋+1:
  - Quaternions use nlerp on the same hemisphere (slerp is allowed).
  - Ground, hips and tracks interpolate linearly; yaw is unwrapped first.
  - Contacts take the nearer frame.
- Sampling is a pure function of (clip, t). It must give the same result at 30, 60 or 120 Hz rendering.

**Into `SampledPose` (web):**
- `q` = the decoded quaternions. Bones outside the mask are identity, or untouched for an overlay clip.
- `root` = the hips offset, × scale.
- `aimR`, `aimL` and `bat` = null, unless the `bat.*` tracks exist.
- `twoHands` = true.
- The ground track is returned separately as `{ x, z, yawDeg }`.

**Into Unity:**
- `ProductionCharacterPose.Rotations[i]` = q, with the components unchanged.
- `RootOffset` = the hips offset, × 0.9836 on x and z (§2).

**Physics-driven actors (fielders, keeper, running batters).**
- The physics path places the actor and its heading. The clip's ground track is ignored: in-place use.
- Locomotion loops are speed-matched. Use `rate = v / (scale · speedMps)` and blend neighbouring gaits by speed with
  phase sync. Every gait loop sets `phase0LeftStrike`, so the normalised phases align.
  - Walk loops cover 0.5–2.2 m/s.
  - Jog loops cover 2.2–4.2 m/s.
  - Run loops cover 4.2–6.6 m/s.
  - Sprint loops cover from 6.6 m/s.
  - Clamp the rate to [0.75, 1.3] of the clip's own rate, and cross-fade to the next gait outside that range.
- Event markers align a one-shot to the physics time of that event, as `clipMarker` does today. Examples are
  `collect`, `release`, `catch`, `take` and `reach`.
- A dive's travel comes from the physics path. The hips offset of every dive clip stays within |x|, |z| ≤ 0.08 m.

**Clip-driven actors** (the non-striker backing up, a fielder walking in, the bowler walking back) may apply the ground
track. They must still end exactly where the physics or the field layout puts them: correct the residual over the
final 0.3 s at no more than 0.3 m/s.

**Honesty.**
- No clip may imply a shot, an outcome or a timing that physics did not produce.
- **Lead ruling, v1.2: a single exception.** The striker's `bat_trigger` may start up to 0.55 s before the presented
  release, on all of these conditions:
  - it is identical for every delivery, with no dependence on line, length, speed or bounce;
  - it is anchored to the bowler's presented release, which the run-up already shows;
  - the feet are planted before the release;
  - it never moves towards the ball's line.

  The exception does not extend to fielders or the keeper.
- **SUPERSEDED (lead ruling 2026-11-04 04:59Z; see the decision log). No longer in force.** The stride starts at the
  input; before it there is only the generic `bat_trigger` (about 3 cm or less) and the backlift. The text below is
  kept for the record only.
  **Lead ruling, v1.2.1: striker footwork before the input.** The striker's lower-body footwork may start before the
  player's input: a forward press and stride, or back and across. All of these conditions apply:
  - The footwork is chosen by the physics length read alone, independent of the input, the tier and the level.
  - It starts no earlier than the physics read commit (release + 150 ms), and plants by the ball's ideal arrival at
    the batter's plane.
  - It is generic per footwork; everything specific to the stroke family starts at the input.
  - The arms and the bat stay gated on the input.

  The stroke overlays carry a footwork segment ending at a marker (proposed `stride_end`, to be agreed by TRACKB and
  WEB-HUMANS), then a family segment ending at `contact`. Fielders and the keeper keep the unchanged rule.
- Anticipation clips (walk-in, set, ready) are generic. They must not start before the physics release, and they must
  not lean towards where the ball will go.
- A reaction plays only after the physics event it reacts to.

**Reduced Motion.** Consumers may replace loops with their frame 0, and one-shots with their marker frame held over the
same physics window. Clips need no change.

## 7. The source format: VMS1 (JSON, one file per clip)

The Blender bake writes this format; others may hand-author it.

`assets-src/motion/<pack>/<clip>.vms.json`:

```json
{
  "format": "VMS1",
  "id": "fld_throw_over",
  "pack": "fielder",
  "role": "fielder",
  "skeleton": "VC17",
  "sampleRate": 60,
  "loop": false,
  "mirrorable": true,
  "overlay": false,
  "codec": 1,
  "boneMask": "all",
  "speedMps": 0,
  "cycleSteps": 0,
  "markers": { "release": 0.42 },
  "mirrorAliases": { "fld_throw_over_l": "mirror" },
  "frames": {
    "ground": [[0, 0, 0]],
    "hips": [[0, -0.06, 0]],
    "contacts": [3],
    "q": [[0, 0, 0, 1]]
  },
  "tracks": {},
  "provenance": {
    "author": "MOTION (Claude agent for the owner)",
    "method": "original keyframes in Blender 5.2.3",
    "script": "scripts/blender/motion/fielder.py",
    "licence": "owner-made original",
    "sources": []
  }
}
```

Field rules:
- `ground` holds [x, z, yawDeg] per frame.
- `hips` holds [x, y, z] in metres per frame.
- `q` holds, per frame, the 17 quaternions [x, y, z, w] in id order: a flat array of 68 numbers.
- Numbers are rounded to 6 decimals, so the bake is byte-stable.
- A loop source carries one extra **closing frame** F, which equals frame 0 plus one cycle of travel.
  - The exporter checks the seam: every bone within 0.5°, hips within 2 mm, equal contacts.
  - It then derives the travel (x, z, yaw) from frame F − frame 0 and drops frame F.
  - A one-shot's travel is its last frame minus its first.
- `codec` defaults to 2.
- Set `"phase0LeftStrike": true` on gait loops.
- `tracks` maps a name to `{ "kind": "position" | "direction", "frames": [[x, y, z], …] }`.

A third-party source must name its URL, licence, retrieval date and SHA-256 in `provenance.sources`. Only CC0,
CC BY or owner-made sources are allowed. Mixamo is forbidden, and CMU needs a ruling by the owner.

## 8. Authoring and retarget method (Blender)

`scripts/blender/motion/vc17.py` builds the VC17 armature with the canonical offsets. It also builds a control rig:
- two-bone IK legs, with world-space foot controllers and knee poles;
- optional arm IK, with hand controllers and elbow poles;
- FK spine, neck and head.

Clips are original keyframes on that control rig.

The bake evaluates every frame with constraints applied, then:
1. Computes each bone's armature-space delta D = M_pose · M_rest⁻¹.
2. Converts D to canonical axes with B⁻¹ (§2).
3. Sets each local quaternion to D_parent⁻¹ · D_bone, which is valid because canonical rest is identity.
4. Separates the ground track from the hips: the ground track is the hips projected to the floor, smoothed with a
   0.25 s centred window, plus the facing yaw. The hips offset is the hips relative to the ground track.

A planted foot keeps its controller fixed in world space, so it cannot slide except through quantisation.

**Retargeting a source rig** (for example a CC0 glTF) uses the same deltas, plus rest alignment:
1. For each mapped bone, compute A, the shortest-arc rotation that takes the VC17 rest direction to the source rest
   direction (twist taken from the source's forward axis).
2. Set the canonical world rotation to W = D_src · A.
3. Rescale the root by 0.915 ÷ source leg length.
4. Detect contacts (ankle height < rest + 3 cm and speed < 0.25 m/s).
5. Pin the planted feet with the IK legs, then bake.

## 9. Naturalness metrics

`scripts/motion/metrics.mjs` measures every clip on the **decoded** bytes, after quantisation. It runs forward
kinematics on the canonical skeleton, applies the ground track (travel mode) and samples at 60 Hz.

| metric | definition | cap / pass |
| --- | --- | --- |
| Foot-plant slide | the shoe is rigid and rocks on its heel (−0.05 m), ball (+0.135 m) and sole tip (+0.20 m), all at the sole (0, −0.065, ·) in the foot frame. While the foot's contact bit is set, each of these points that is within 1.2 cm of the ground must stay put: the slide is its max horizontal distance from where it first touched in that run | **< 2.0 cm** |
| Foot ground height | during contact, ankle height − rest ankle height (0.065 m) | within [−1.0, +2.5] cm (the heel may lift at toe-off) |
| Pose pop (angular speed) | the angle between consecutive 60 Hz samples, × 60, per bone | throwing and bowling arm (upperArm, forearm, hand) ≤ 1800°/s; other limbs ≤ 1200°/s; hips, spine and chest ≤ 600°/s; neck and head ≤ 720°/s. Loops are also checked across the wrap |
| Pop (angular acceleration) | the change of the angular-velocity vector between consecutive 60 Hz frames | ≤ 300°/s per frame on any bone (no step discontinuities). Stated engineering cap (lead-approved), not human-validated: only the clips in the explosive list below may reach ≤ 650°/s per frame, and only on the limbs listed. Reported per clip either way |
| Root speed smoothness | the change in horizontal speed between consecutive frames, with each speed taken over a centred 1/30 s window. A single 60 Hz frame would read the 1 mm storage step as ±0.06 m/s of noise. Measured on the ground track and on the hips (ground + offset) | ground ≤ 0.15 m/s per frame (9 m/s²); hips ≤ 0.30 m/s per frame |
| Stride and cadence | per gait loop: cadence = cycleSteps / duration × 60 spm; step length = speed / (cadence / 60) | walk 1.3–1.7 m/s at 100–125 spm; jog 2.8–3.8 m/s at 150–175; run 5.0–6.5 m/s at 165–190; sprint 7.2–8.2 m/s at 190–240; step length ÷ leg length (0.915 m) in [0.7, 2.4] |
| Lateral shuffle (v1.2.2) | a gait loop that travels more along x than z (a step-close, feet never crossing) is checked against this band, not the forward-gait bands. Stated engineering band, not human-validated | 0.8–2.5 m/s at 180–340 spm, step ÷ leg length in [0.2, 1.2] |
| Joint limits | hinges by Euler XYZ (canonical signs); ball joints by swing cone and twist | knee (shin) X ∈ [−5°, 155°], \|Z\| ≤ 10°; elbow (forearm) X ∈ [−150°, 5°], \|Z\| ≤ 12°; ankle (foot) X ∈ [−40°, 60°]; hip (thigh) swing ≤ 135°, twist ≤ 50°; shoulder swing ≤ 185°, twist ≤ 110°; wrist swing ≤ 85°; spine and chest each ≤ 75° total; neck and head ≤ 80°. Hips are free |
| Self-penetration | the wrist to the torso axis segment (hips to neck), excluding contact frames | ≥ 0.09 m |

**Explosive class.** This is the complete list; changing it needs a lead ruling.

| clip | limbs | reason |
| --- | --- | --- |
| `loco_run` | legs | running at 5.6 m/s: foot strike and late-swing knee check |
| `loco_sprint` | legs | sprinting at 7.8 m/s: foot strike and late-swing knee check |
| `loco_start` | legs | explosive start from standing |
| `fld_sprint_start` | legs | explosive start from the ready stance |
| `fld_turn_run_r`, `fld_turn_run_l` | legs | explosive drop-step turn and sprint away |
| `kp_dive_r`, `kp_dive_l` | legs and arms | ballistic full-length dive, in place (§6), recovery within `DIVE.recoverS` |
| `fld_dive_r`, `fld_dive_l` | legs and arms | ballistic full-length dive, in place (§6), recovery within `DIVE.recoverS` |
| `bowl_run` | legs | running at ≥ 4.5 m/s (lead ruling 2026-11-04): 5.0 m/s |
| `bowl_stride` | legs | running at ≥ 4.5 m/s (lead ruling 2026-11-04): 6.2 m/s |
| `bowl_pace` | legs | running at ≥ 4.5 m/s (lead ruling 2026-11-04): the last-stride bound and the front-foot block at 6.2 m/s |
| `ns_run` | legs | running at ≥ 4.5 m/s (lead ruling 2026-11-04): 5.2 m/s |
| `fld_dive_fast_r`, `fld_dive_fast_l` | legs and arms | ballistic dive and scramble within `DIVE.recoverS` (lead ruling 2026-11-04) |
| `fld_dive_scramble_r`, `fld_dive_scramble_l` | legs and arms | ballistic dive and scramble within `DIVE.recoverS` (lead ruling 2026-11-04) |
| `bowl_pace_bouncer` | legs | the bouncer variant of `bowl_pace`: same run-in, bound, front-foot block and release (lead ruling 2026-11-04: same gates as `bowl_pace`) |
| `ns_turn` | legs | 180° turn and push-off from standing to run speed, an explosive start like `loco_start` and `fld_turn_run` (lead ruling 2026-11-04) |

Not in the class (lead ruling): `bowl_jog`, `bowl_start`, `bowl_off`, `bowl_leg`, every follow-through and walk,
`ns_backup`, `ns_ground` and `ns_walk_back`. Arms and torso stay at 300 in every clip except the dives.

**Ground-step report-only list** (lead ruling 2026-11-04). `GROUND_STEP_REPORT_ONLY` in `metrics.mjs` lists the
clips whose ground-track speed step is measured and printed but not gated. Every other gate still gates them. Changing
the list needs a lead ruling.

| clip | reason |
| --- | --- |
| `ns_turn` (and its alias `ns_turn_r`) | An in-place clip. At runtime the root is `sprintProfile` with 10 m/s² braking, forced by a named limitation of the physics running model (no braking; see PRACTICE_PHYSICS, Named limitations). Revisit when running gains braking. |

Every clip reports its values in `release/product-sequence/stage-1-practice/wedge/humans/motion/metrics.json` together
with the build id, UTC time and `uptime`. A failing clip does not ship. These are measurements, not certification:
the independent evaluators score naturalness.

**Pose pop (whole-delivery scan; UNITY-9, 2026-11-07, optional gate).** A bone's one-frame turn at or above the smaller of 25° and its per-frame cap and at least 3 times its quiet neighbours' steps (arms 25°, legs 20°, hips, spine and chest 10°, neck and head 12° a frame); any one-frame step of 60° or more; a hips or root displacement change over 5 cm in a frame; a head turning faster than 720°/s in the world; a glove more than 2 cm off the grip; a wrist swing over 85°. The scanner is `Editor/Evidence/VandeHumansEvidence.Pops.cs` (Unity) and `S/humans/webfix/{A,B}` harnesses (web); both report measurements, not certification.

## 10. Size budgets

| Item | Budget |
| --- | --- |
| Web initial bundle | **0 bytes** added. Packs are fetched on first use (Practice 3D only, never Classic) |
| `locomotion.vmp` | ≤ 40 KB |
| `fielder.vmp` | ≤ 72 KB |
| `keeper.vmp` | ≤ 40 KB |
| `bowler.vmp` | ≤ 72 KB (73,728 B). Raised twice by lead ruling on 2026-11-04: to 64 KB, then to 72 KB for the bouncer. Any further bowler clip needs a new ruling |
| `nonstriker.vmp` and `batter.vmp` | ≤ 48 KB each |
| Unity (`Resources/Motion/*.bytes`) | the same bytes; MOTION's three packs total ≤ 152 KB raw |

The Unity total is reported as raw and as deflate bytes against the 2.37 MB APK headroom. SIZE-50 and REACH-90 stay
UNPROVEN.

## 11. Clip ids and status (as of 2026-11-04 03:20Z)

**`locomotion.vmp`** (MOTION; 33,351 B; sha `bad9e2…`)

| id | what |
| --- | --- |
| `loco_idle` | loop, 15 Hz |
| `loco_walk` | loop; 1.5 m/s at 112.5 spm |
| `loco_jog` | loop; 3.3 m/s at 163.6 spm |
| `loco_run` | loop; 5.6 m/s at 175.6 spm |
| `loco_sprint` | loop; 7.8 m/s at 225 spm |
| `loco_start` | markers `go`, `exitLeftStrike`; it ends on a left strike at about 4.6 m/s |
| `loco_stop` | markers `plant`, `still`; it enters from the run loop's left strike |

Held back (they fail the pop gate): `loco_turn_l90` / `loco_turn_r90` and `loco_strafe_l` / `loco_strafe_r`. The 180° turn
is dropped; playing the 90° turn twice covers it. No backpedal.

**`fielder.vmp`** (MOTION; 62,570 B; sha `bcf079d1…`)

| id | what |
| --- | --- |
| `fld_ready` | loop |
| `fld_walk_in` | loop, 1.3 m/s |
| `fld_set` | marker `set` |
| `fld_sprint_start` | markers `go`, `exitLeftStrike` |
| `fld_decel_stop` | markers `plant`, `still` |
| `fld_return` | loop, 1.3 m/s |
| `fld_pickup_2h` | marker `collect`; ends in `gather` |
| `fld_pickup_1h` | marker `collect`; 3.5 m/s, starts and ends on a left strike |
| `fld_long_barrier` | marker `collect`; ends in `gather` |
| `fld_turn_run_r` | alias `fld_turn_run_l`; markers `go`, `exitLeftStrike` |

**`fielder_actions.vmp`** (MOTION-FIELD2): `fld_catch_low`, `fld_throw_over`, then the flick, the dives with the get-up,
the high catch and the celebration as they pass.

**`keeper.vmp`** (MOTION-KEEPER): the `kp_*` ids as briefed.

**Other packs**
- `batter.vmp` and `batter_strokes.vmp`: TRACKB.
- `bowler.vmp` and `nonstriker.vmp`: MOTION-BOWL. Both are PENDING_FIX until they pass the gates.

`_r` and `_l` name the side relative to the character, before any handedness mirror.
