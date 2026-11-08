"""Builds the camera-fixture actor: the owner-made MPFB character on the game's 75-bone skeleton, in plain kit, ready to pose.

Usage (Blender background; run through the shared heavy-job wrapper):
  Blender -b --factory-startup --python-exit-code 3 --python scripts/blender/camera/build_actor.py -- <out-dir>
      [--skin young_african_male] [--tests]

Writes <out-dir>/actor.blend, <out-dir>/actor-rig.json (the rest pose of every bone in armature space, so the clip renderer can aim
VC17 directions onto it) and <out-dir>/actor-build.json (configuration, timings, provenance). With --tests it also renders the rest
pose from the mid, near and far views (actor-test-*.png).

This is the body, skin, eyes, brows, lashes, hair, kit and shoes part of scripts/blender/cover_drive_hero.py, copied so that file
(a build script that runs on import) stays untouched; there is no bat and no grip solve. Sources: MPFB 2.0.18 (GPL-3.0-or-later
tool; its base mesh, targets, rigs and weights are CC0) and the MakeHuman system asset pack (CC0), both recorded in
docs/ASSET_REGISTER.md. Nothing is traced or rotoscoped from footage. Deterministic for a given Blender + MPFB + asset pack.
"""
import json
import math
import os
import sys
import time

import addon_utils
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixture_scene as FS  # noqa: E402

CONFIG = {
    "statureTargetM": 1.78,
    "macro": {"gender": 1.0, "age": 0.5, "muscle": 0.66, "weight": 0.44, "proportions": 0.75, "cupsize": 0.5,
              "firmness": 0.5, "race": {"asian": 0.50, "african": 0.25, "caucasian": 0.25}},
    "skin": "young_african_male",
    "skinValueLift": 1.12,
    "eyes": "low-poly",
    "eyebrows": "eyebrow001",
    "eyelashes": "eyelashes01",
    "hair": "short02",
    "hairValue": 0.22,
    "clothes": ["female_sportsuit01", "shoes05"],
    "kitAsset": "female_sportsuit01",
    "kitColour": [0.012, 0.030, 0.075],
    "trouserColour": [0.007, 0.018, 0.045],
    "shoeColour": [0.82, 0.82, 0.80],
    "eyeColourGrade": {"hue": 0.535, "saturation": 0.55, "value": 0.52, "saturationThreshold": 0.20},
    "lowerArmLengthTarget": 0.12,
}

V3_BONE_NAMES = [
    "root", "pelvis.L", "pelvis.R", "spine05", "spine04", "spine03", "spine02", "spine01", "neck01", "neck02",
    "neck03", "head", "jaw", "clavicle.L", "shoulder01.L", "upperarm01.L", "upperarm02.L", "lowerarm01.L",
    "lowerarm02.L", "wrist.L", "clavicle.R", "shoulder01.R", "upperarm01.R", "upperarm02.R", "lowerarm01.R",
    "lowerarm02.R", "wrist.R", "metacarpal1.L", "metacarpal2.L", "metacarpal3.L", "metacarpal4.L",
    "finger1-1.L", "finger1-2.L", "finger1-3.L", "finger2-1.L", "finger2-2.L", "finger2-3.L", "finger3-1.L",
    "finger3-2.L", "finger3-3.L", "finger4-1.L", "finger4-2.L", "finger4-3.L", "finger5-1.L", "finger5-2.L",
    "finger5-3.L", "metacarpal1.R", "metacarpal2.R", "metacarpal3.R", "metacarpal4.R", "finger1-1.R",
    "finger1-2.R", "finger1-3.R", "finger2-1.R", "finger2-2.R", "finger2-3.R", "finger3-1.R", "finger3-2.R",
    "finger3-3.R", "finger4-1.R", "finger4-2.R", "finger4-3.R", "finger5-1.R", "finger5-2.R", "finger5-3.R",
    "upperleg01.L", "upperleg02.L", "lowerleg01.L", "lowerleg02.L", "foot.L", "upperleg01.R", "upperleg02.R",
    "lowerleg01.R", "lowerleg02.R", "foot.R",
]

LOG = []


def log(*parts):
    line = " ".join(str(p) for p in parts)
    LOG.append(line)
    print("[actor]", line, flush=True)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: -- <out-dir> [--skin name] [--tests]")
    out = argv[0]
    if "--skin" in argv:
        CONFIG["skin"] = argv[argv.index("--skin") + 1]
    if "--clothes" in argv:
        CONFIG["clothes"] = argv[argv.index("--clothes") + 1].split(",")
        CONFIG["kitAsset"] = CONFIG["clothes"][0]
    if "--kit-colour" in argv:
        CONFIG["kitColour"] = [float(x) for x in argv[argv.index("--kit-colour") + 1].split(",")]
    CONFIG["exposures"] = [float(x) for x in argv[argv.index("--exposures") + 1].split(",")] if "--exposures" in argv else [0.0]
    os.makedirs(out, exist_ok=True)
    return out, "--tests" in argv


def update():
    bpy.context.view_layer.update()


def mpfb():
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    from bl_ext.user_default.mpfb.services import HumanService, LocationService, TargetService  # noqa: E402
    return HumanService, LocationService, TargetService


def evaluated_z_range(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    zs = [(obj.matrix_world @ v.co).z for v in me.vertices]
    ev.to_mesh_clear()
    return min(zs), max(zs)


def create_body(HumanService, TargetService):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    macro = TargetService.get_default_macro_info_dict()
    macro.update({k: v for k, v in CONFIG["macro"].items() if k != "race"})
    macro["race"] = dict(CONFIG["macro"]["race"])
    lo, hi = 0.0, 1.0
    basemesh = None
    stature = 0.0
    for _ in range(14):
        h = (lo + hi) / 2.0
        macro["height"] = h
        if basemesh is not None:
            bpy.data.objects.remove(basemesh, do_unlink=True)
        basemesh = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
        zmin, zmax = evaluated_z_range(basemesh)
        stature = zmax - zmin
        if stature < CONFIG["statureTargetM"]:
            lo = h
        else:
            hi = h
    log("height macro", round(macro["height"], 6), "stature", round(stature, 4))
    return basemesh, macro, stature


def add_assets(HumanService, LocationService, basemesh):
    data = LocationService.get_user_data()
    rig = HumanService.add_builtin_rig(basemesh, "default", import_weights=True)
    HumanService.set_character_skin(os.path.join(data, "skins", CONFIG["skin"], CONFIG["skin"] + ".mhmat"), basemesh,
                                    skin_type="GAMEENGINE")

    def mhclo(folder, name, kind):
        path = os.path.join(data, folder, name, name + ".mhclo")
        if not os.path.exists(path):
            raise SystemExit("missing asset " + path)
        return HumanService.add_mhclo_asset(path, basemesh, asset_type=kind, subdiv_levels=0, material_type="MAKESKIN")

    mhclo("eyes", CONFIG["eyes"], "Eyes")
    mhclo("eyebrows", CONFIG["eyebrows"], "Eyebrows")
    mhclo("eyelashes", CONFIG["eyelashes"], "Eyelashes")
    mhclo("hair", CONFIG["hair"], "Hair")
    for name in CONFIG["clothes"]:
        mhclo("clothes", name, "Clothes")
    return rig, data


def reduce_to_game_skeleton(rig):
    keep = set(V3_BONE_NAMES)
    bones = rig.data.bones
    missing = [n for n in V3_BONE_NAMES if n not in bones]
    if missing:
        raise SystemExit("default rig lacks game bones: " + ", ".join(missing))

    def retained(name):
        b = bones[name]
        while b is not None and b.name not in keep:
            b = b.parent
        return b.name if b is not None else "root"

    mapping = {b.name: retained(b.name) for b in bones if b.name not in keep}
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(
        m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
    for obj in meshes:
        groups = obj.vertex_groups
        for source, target in mapping.items():
            src = groups.get(source)
            if src is None:
                continue
            dst = groups.get(target) or groups.new(name=target)
            for v in obj.data.vertices:
                for g in v.groups:
                    if g.group == src.index and g.weight > 0.0:
                        dst.add([v.index], g.weight, "ADD")
            groups.remove(src)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    for name in [b.name for b in eb if b.name not in keep]:
        bone = eb[name]
        for child in list(bone.children):
            parent = bone.parent
            while parent is not None and parent.name not in keep:
                parent = parent.parent
            child.parent = parent
        eb.remove(bone)
    bpy.ops.object.mode_set(mode="OBJECT")
    names = [b.name for b in rig.data.bones]
    log("skeleton reduced:", len(mapping), "bones merged away;", len(names), "remain")
    if sorted(names) != sorted(V3_BONE_NAMES):
        raise SystemExit("reduced skeleton differs from the game skeleton")
    return mapping


# ---- materials (simple Principled look, as the hero proof renders) -----------------------------------------------

def principled(name, colour, roughness=0.8, normal_image=None, ao_image=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if ao_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = ao_image
        tex.image.colorspace_settings.name = "Non-Color"
        mul = nt.nodes.new("ShaderNodeMixRGB")
        mul.blend_type = "MULTIPLY"
        mul.inputs[0].default_value = 1.0
        mul.inputs[1].default_value = (*colour, 1.0)
        nt.links.new(tex.outputs["Color"], mul.inputs[2])
        nt.links.new(mul.outputs["Color"], bsdf.inputs["Base Color"])
    if normal_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = normal_image
        tex.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.8
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def load_image(folder, filename):
    path = os.path.join(folder, filename)
    return bpy.data.images.load(path, check_existing=True) if os.path.isfile(path) else None


def tint_base_colour(m, value):
    if not m or not m.use_nodes:
        return
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    if not bsdf.inputs["Base Color"].is_linked:
        col = bsdf.inputs["Base Color"].default_value
        bsdf.inputs["Base Color"].default_value = (col[0] * value, col[1] * value, col[2] * value, col[3])
        return
    link = bsdf.inputs["Base Color"].links[0]
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Value"].default_value = value
    nt.links.new(link.from_socket, hsv.inputs["Color"])
    nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])


def grade_eye_colour(m):
    """The CC0 iris is red-brown in a proof render: a recorded HSV grade on the coloured pixels only (as the hero)."""
    if not m or not m.use_nodes:
        return
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None or not bsdf.inputs["Base Color"].is_linked:
        return
    source = bsdf.inputs["Base Color"].links[0].from_socket
    grade = CONFIG["eyeColourGrade"]
    separate = nt.nodes.new("ShaderNodeSeparateColor")
    separate.mode = "HSV"
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Hue"].default_value = grade["hue"]
    hsv.inputs["Saturation"].default_value = grade["saturation"]
    hsv.inputs["Value"].default_value = grade["value"]
    gate = nt.nodes.new("ShaderNodeMath")
    gate.operation = "GREATER_THAN"
    gate.inputs[1].default_value = grade["saturationThreshold"]
    mix = nt.nodes.new("ShaderNodeMixRGB")
    nt.links.new(source, separate.inputs["Color"])
    nt.links.new(separate.outputs[1], gate.inputs[0])
    nt.links.new(source, hsv.inputs["Color"])
    nt.links.new(source, mix.inputs[1])
    nt.links.new(hsv.outputs["Color"], mix.inputs[2])
    nt.links.new(gate.outputs[0], mix.inputs[0])
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])


def style_materials(data):
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        lname = obj.name.lower()
        if "sportsuit" in lname or "casualsuit" in lname:
            folder = os.path.join(data, "clothes", CONFIG["kitAsset"])
            normal = load_image(folder, CONFIG["kitAsset"] + "_normal.png")
            ao = load_image(folder, CONFIG["kitAsset"] + "_ao.png")
            jersey = principled("FIX_jersey_navy", CONFIG["kitColour"], 0.78, normal, ao)
            trousers = principled("FIX_trousers_navy", CONFIG["trouserColour"], 0.82, normal, ao)
            obj.data.materials.clear()
            obj.data.materials.append(jersey)
            obj.data.materials.append(trousers)
            groups = {g.index: g.name for g in obj.vertex_groups}
            if "sportsuit" in lname:
                # The CC0 athletic proxy has a crop-length top: lower its spine02 hem to the waistband (as the hero build).
                hem = []
                for vertex in obj.data.vertices:
                    dominant = (groups.get(max(vertex.groups, key=lambda item: item.weight).group, "")
                                if vertex.groups else "")
                    if dominant == "spine02":
                        hem.append(vertex)
                floor = min((vertex.co.z for vertex in hem), default=0.0)
                for vertex in hem:
                    weight = max(0.0, min(1.0, (floor + 0.09 - vertex.co.z) / 0.09))
                    if weight > 0.0:
                        vertex.co.z -= 0.18 * weight
                obj.data.update()
            for polygon in obj.data.polygons:
                lower = 0.0
                upper = 0.0
                for vi in polygon.vertices:
                    for weight in obj.data.vertices[vi].groups:
                        name = groups.get(weight.group, "")
                        if name.startswith(("upperleg", "lowerleg", "pelvis")):
                            lower += weight.weight
                        else:
                            upper += weight.weight
                polygon.material_index = 1 if lower > upper else 0
            obj.name = "FIX_kit"
            continue
        if "shoes" in lname:
            folder = os.path.join(data, "clothes", "shoes05")
            normal = None
            if os.path.isdir(folder):
                for f in sorted(os.listdir(folder)):
                    if f.endswith("_normal.png"):
                        normal = load_image(folder, f)
                        break
            mat = principled("FIX_shoes_white", CONFIG["shoeColour"], 0.6, normal)
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            obj.name = "FIX_shoes"
        elif "short02" in lname or "hair" in lname:
            for slot in obj.material_slots:
                tint_base_colour(slot.material, CONFIG["hairValue"])
        elif "low-poly" in lname:
            for slot in obj.material_slots:
                grade_eye_colour(slot.material)
    body = next(o for o in bpy.data.objects if o.type == "MESH" and o.name == "Human")
    for slot in body.material_slots:
        tint_base_colour(slot.material, CONFIG["skinValueLift"])


def dump_rig(rig):
    rows = {}
    for b in rig.data.bones:
        m = b.matrix_local
        rows[b.name] = {
            "parent": b.parent.name if b.parent else None,
            "head": [round(x, 6) for x in b.head_local],
            "tail": [round(x, 6) for x in b.tail_local],
            "matrix": [[round(c, 7) for c in row] for row in m],
        }
    return {"objectMatrixWorld": [[round(c, 7) for c in row] for row in rig.matrix_world], "bones": rows}


def main():
    t0 = time.time()
    out, tests = args()
    HumanService, LocationService, TargetService = mpfb()
    body, macro, stature = create_body(HumanService, TargetService)
    body.name = "Human"
    path = os.path.join(LocationService.get_mpfb_data("targets"), "arms", "measure-lowerarm-length-incr.target.gz")
    TargetService.load_target(body, path, weight=CONFIG["lowerArmLengthTarget"])
    update()
    rig, data = add_assets(HumanService, LocationService, body)
    reduce_to_game_skeleton(rig)
    style_materials(data)
    update()
    t_built = time.time()
    rig_dump = dump_rig(rig)
    with open(os.path.join(out, "actor-rig.json"), "w") as f:
        json.dump(rig_dump, f, indent=1)
    meshes = sorted(o.name for o in bpy.data.objects if o.type == "MESH")
    scene = bpy.context.scene
    FS.setup_render(scene, 640, 480)
    FS.build_room(scene)
    blend = os.path.join(out, "actor.blend")
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    t_saved = time.time()
    timings = {"buildS": round(t_built - t0, 1), "saveS": round(t_saved - t_built, 1)}
    if tests:
        for view in ("mid", "near", "far"):
            cam = FS.make_camera(scene, view)
            for exposure in CONFIG["exposures"]:
                scene.view_settings.exposure = exposure
                tag = "" if len(CONFIG["exposures"]) == 1 else "-e%g" % exposure
                scene.render.filepath = os.path.join(out, "actor-test-%s%s.png" % (view, tag))
                t1 = time.time()
                bpy.ops.render.render(write_still=True)
                timings["render_" + view + tag + "S"] = round(time.time() - t1, 2)
            scene.view_settings.exposure = 0.0
            bpy.data.objects.remove(cam, do_unlink=True)
    record = {
        "blender": bpy.app.version_string, "mpfb": "2.0.18", "engine": scene.render.engine, "config": CONFIG,
        "macroSolved": macro, "statureM": round(stature, 4), "meshes": meshes, "bones": len(rig.data.bones),
        "timings": timings, "log": LOG, "classification": "BUILDER_OBSERVATION_NON_HUMAN",
    }
    with open(os.path.join(out, "actor-build.json"), "w") as f:
        json.dump(record, f, indent=1)
    print("ACTOR_BUILD_OK", json.dumps(timings), flush=True)


main()
