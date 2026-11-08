"""Cover-drive P2: arm-chain measurements of saved hero builds, against the physics reach definition.

Usage:
  blender -b --factory-startup --python-exit-code 3 --python scripts/blender/cover_drive_measure.py -- \
      <out.json> <label>=<hero.blend> [<label>=<hero.blend> ...]

The physics plans the lower hand with a usable reach of 0.57 m: the anthropometric shoulder-to-wrist chain for a
1.78 m body (upper arm 0.186 H plus forearm 0.146 H = 0.591 m; Drillis & Contini; Winter, Table 4.1) minus a 20 mm
elbow reserve (release/product-sequence/stage-1-practice/wedge/physics/REPORT.md). So the comparable number is the
rest-pose distance from the shoulder joint (upperarm01 head) through the elbow (lowerarm01 head) to the wrist joint
(wrist head), measured along the chain.
"""

import json
import sys

import bpy


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out, pairs = argv[0], argv[1:]
    result = {"definition": "rest pose; shoulder = upperarm01 head, elbow = lowerarm01 head, wrist = wrist head; "
                            "chain = |shoulder-elbow| + |elbow-wrist|; physics needs >= 0.591 m (0.57 m usable)"}
    for pair in pairs:
        label, path = pair.split("=", 1)
        bpy.ops.wm.open_mainfile(filepath=path)
        rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        bones = rig.data.bones
        rec = {}
        for side in ("L", "R"):
            sh = rig.matrix_world @ bones["upperarm01." + side].head_local
            el = rig.matrix_world @ bones["lowerarm01." + side].head_local
            wr = rig.matrix_world @ bones["wrist." + side].head_local
            kn = rig.matrix_world @ bones["finger3-1." + side].head_local
            rec[side] = {"upperArmM": round((el - sh).length, 4), "forearmM": round((wr - el).length, 4),
                         "shoulderToWristChainM": round((el - sh).length + (wr - el).length, 4),
                         "shoulderToWristStraightM": round((wr - sh).length, 4),
                         "wristToKnuckleM": round((kn - wr).length, 4)}
        sh_l = rig.matrix_world @ bones["upperarm01.L"].head_local
        sh_r = rig.matrix_world @ bones["upperarm01.R"].head_local
        rec["shoulderJointSeparationM"] = round((sh_l - sh_r).length, 4)
        rec["meetsPhysics0591"] = min(rec[s]["shoulderToWristChainM"] for s in ("L", "R")) >= 0.591
        result[label] = rec
    with open(out, "w") as f:
        json.dump(result, f, indent=1)
    print("MEASURE_OK", json.dumps(result))


main()
