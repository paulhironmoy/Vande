"""MOTION-BOWL: key the bowler and non-striker VMS1 clips onto a VC17 armature in Blender and save the editable .blend.

    blender -b --factory-startup --python-exit-code 3 --python scripts/blender/motion/bowler_blend.py -- \
        <vms_root> <out_dir>

<vms_root> holds bowler/ and nonstriker/ folders of *.vms.json (assets-src/motion by default). One action per clip,
60 fps scene, markers as timeline markers. Canonical (x, y, z) maps to Blender (x, -z, y) (MOTION-SPEC §2); the pose
basis of each bone is Rb^-1 * B(q) * Rb (§8), the hips also get the ground track and hips offset as location.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bowler_kin as K  # noqa: E402

CONV = Quaternion((1.0, 0.0, 0.0), math.pi / 2)


def B(v):
    return Vector((v[0], -v[2], v[1]))


def Bq(q):
    return CONV @ Quaternion((q[3], q[0], q[1], q[2])) @ CONV.inverted()


def build_armature():
    arm = bpy.data.armatures.new("VC17")
    ob = bpy.data.objects.new("VC17", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    world = []
    for i, name in enumerate(K.BONES):
        p = K.PARENT[i]
        world.append(K.OFFSET[i] if p < 0 else K.vadd(world[p], K.OFFSET[i]))
    first_child = {}
    for i in range(len(K.BONES)):
        if K.PARENT[i] >= 0:
            first_child.setdefault(K.PARENT[i], i)
    for i, name in enumerate(K.BONES):
        eb = arm.edit_bones.new(name)
        eb.head = B(world[i])
        if name.startswith("foot"):
            tail = K.vadd(world[i], (0.0, -0.05, 0.15))
        elif name.startswith("hand"):
            tail = K.vadd(world[i], (0.0, -0.08, 0.0))
        elif name == "head":
            tail = K.vadd(world[i], (0.0, 0.2, 0.0))
        elif name == "chest":
            tail = world[K.IDX["neck"]]
        else:
            tail = world[first_child[i]]
        eb.tail = B(tail)
        eb.roll = 0.0
        if K.PARENT[i] >= 0:
            eb.parent = arm.edit_bones[K.BONES[K.PARENT[i]]]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob, arm


def key_clip(ob, arm, doc, frames):
    rest = {b: arm.bones[b].matrix_local.to_quaternion() for b in K.BONES}
    act = bpy.data.actions.new(doc["id"])
    act.use_fake_user = True
    ob.animation_data_create()
    ob.animation_data.action = act
    step = 60 // doc["sampleRate"]
    for f, fr in enumerate(frames):
        frame = 1 + f * step
        g = fr["ground"]
        for i, b in enumerate(K.BONES):
            pb = ob.pose.bones[b]
            local = fr["q"][i]
            if i == 0:
                local = K.qmul(K.qy(g[2]), local)
            pb.rotation_quaternion = rest[b].inverted() @ Bq(local) @ rest[b]
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            if i == 0:
                off = K.vadd((g[0], 0.0, g[1]), K.qrot(K.qy(g[2]), fr["hips"]))
                pb.location = rest[b].inverted() @ B(off)
                pb.keyframe_insert("location", frame=frame)
    for name, t in doc["markers"].items():
        bpy.context.scene.timeline_markers.new(f"{doc['id']}:{name}", frame=1 + int(round(t * 60)))
    return len(frames)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    root = argv[0] if argv else os.path.join(HERE, "..", "..", "..", "assets-src", "motion")
    out = argv[1] if len(argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    report = {}
    for pack in ("bowler", "nonstriker"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = 60
        ob, arm = build_armature()
        d = os.path.join(root, pack)
        n = 0
        for f in sorted(os.listdir(d)):
            if not f.endswith(".vms.json"):
                continue
            doc, frames = K.read_vms(os.path.join(d, f))
            n += key_clip(ob, arm, doc, frames)
        path = os.path.join(out, f"vande-motion-{pack}.blend")
        bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
        report[pack] = {"blend": path, "keyedFrames": n, "bytes": os.path.getsize(path)}
    print(json.dumps({"blender": bpy.app.version_string, "packs": report}))


main()
