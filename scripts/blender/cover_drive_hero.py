"""Cover-drive P2: the batter at rest, built in Blender with MPFB on the game's 75-bone skeleton.

Usage (Blender background; run through the shared heavy-job wrapper):
  blender -b --factory-startup --python-exit-code 3 --python scripts/blender/cover_drive_hero.py -- build <out-dir>

Writes <out-dir>/hero.blend, <out-dir>/hero-build.json (configuration, provenance and the automated §7-A
measurements) and <out-dir>/hero-build.log.txt. Rendering and export are separate scripts
(cover_drive_hero_render.py, cover_drive_hero_export.py) that open hero.blend.

Everything is deterministic for a given Blender + MPFB + asset pack: no random numbers, fixed configuration below.
Sources: MPFB 2.0.18 (GPL-3.0-or-later tool; its bundled base mesh, targets, rigs and weights are CC0), the MakeHuman
system asset pack (CC0, every asset checked by install_mpfb_system_assets.py) and original geometry made here (the
bat). Nothing is traced or rotoscoped from footage; the pose numbers come from
release/cover-drive/reference/COVER-DRIVE-SPEC.md §1 and the wedge §6.3 amendments.
"""

import json
import hashlib
import math
import os
import sys

import addon_utils
import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vande_vpm3  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# --------------------------------------------------------------------------------------------------------------------
# Configuration (all hand-chosen; every number is recorded in hero-build.json)
# --------------------------------------------------------------------------------------------------------------------

CONFIG = {
    "statureTargetM": 1.78,  # matches ProductionCharacterRig.ReferenceHeightMetres and the physics body frame
    "macro": {"gender": 1.0, "age": 0.5, "muscle": 0.66, "weight": 0.44, "proportions": 0.75, "cupsize": 0.5,
              "firmness": 0.5, "race": {"asian": 0.50, "african": 0.25, "caucasian": 0.25}},
    "skin": "young_african_male/young_african_male.mhmat",
    "skinValueLift": 1.12,
    "eyes": "low-poly", "eyeMaterial": "brown",
    # The CC0 `brown_eye.png` iris is conspicuously red in the proof renderer.  Preserve that exact source, but grade
    # only saturated pixels in the Blender proof material towards a darker, lower-saturation brown.  The VPM3 format
    # does not carry this shader graph, so the receipt must continue to report the live eye-material binding as absent.
    "eyeColourGrade": {"hue": 0.535, "saturation": 0.55, "value": 0.52, "saturationThreshold": 0.20},
    "eyebrows": "eyebrow001", "eyelashes": "eyelashes01", "hair": "short02",
    "clothes": ["female_sportsuit01", "shoes05"],
    # The proof candidate must use maps authored for the exact garment UVs.  The old live bundle contains
    # male_casualsuit06 maps while this body wears male_casualsuit01, so those maps are deliberately not reused.
    "kitPbr": {"asset": "female_sportsuit01", "normalFile": "female_sportsuit01_normal.png",
               "aoFile": "female_sportsuit01_ao.png",
               "proofResolution": 512, "licence": "CC0-1.0"},
    "kitColour": [0.012, 0.030, 0.075],  # original VANDE navy cricket jersey (linear albedo)
    "trouserColour": [0.007, 0.018, 0.045],
    "kitAccentColour": [0.68, 0.18, 0.055],
    "shoeColour": [0.82, 0.82, 0.80],
    "hairColour": [0.035, 0.028, 0.024],
    # Stance, COVER-DRIVE-SPEC §1 with wedge §6.3: feet 0.40-0.60 m (elite mean 0.46-0.52), knees 20-45° (30-50 elite),
    # thorax forward 31-49°, pelvis/shoulders ~20° open, head level facing the bowler.
    # P2 r4: knees 32 -> 37° and thorax 34 -> 40° lower the shoulders so the bottom hand can reach a grip 0-40 mm
    # below the top hand (A3); both stay inside §6.3 and COVER-DRIVE-SPEC §1. stanceBefore is r3's, measured for the
    # before/after comparison.
    "stance": {"ankleSeparationM": 0.50, "kneeFlexTargetDeg": 37.0, "thoraxPitchTargetDeg": 40.0,
               "openDeg": 18.0, "frontFootOpenDeg": 14.0, "headDownDeg": 6.0},
    "stanceBefore": {"kneeFlexTargetDeg": 32.0, "thoraxPitchTargetDeg": 34.0},
    # VBT1 bat (original): 0.86 m total, blade 0.56 x 0.108 x 0.050 m, handle 0.30 m (radius 0.0165 m).
    "bat": {"totalM": 0.86, "bladeM": 0.56, "widthM": 0.108, "depthM": 0.050, "handleRadiusM": 0.0165,
            "toe": [-0.17, -0.21, 0.004], "top": [-0.035, -0.31, 0.846], "tiltMaxDeg": 6.0, "tiltStepDeg": 3.0},
    # armChain: IK chain length from lowerarm02 (4 = elbow and shoulder joint; 5 adds shoulder01, letting the shoulder
    # girdle depress and protract as a batter's does), shoulderStiffness: IK stiffness on shoulder01 when included.
    # joint: the two hands' grip positions (from the handle top) searched together (P2 r4). keepRule: which spacing
    # round the build keeps: "gloved" (A, lead ruling: the in-game gloved grip first, then the least overlap, then the
    # bare grip) or "bare" (the bare digits first, then the least overlap).
    "grip": {"topHandFromTopM": 0.045, "bottomHandFromTopM": 0.150, "armChain": 5, "shoulderStiffness": 0.3,
             "joint": {"L": [0.045, 0.060], "R": [0.16, 0.18, 0.20, 0.22]}, "keepRule": {"A": "gloved", "C": "bare"},
             # The mitts are padded: before the posed push-out the seat lets a glove sit up to this far into the
             # handle (the push-out then moves the glove surface out of the bat, A4 checks it).
             "mittPaddingM": 0.008},
    # Reach: physics plans the lower hand with 0.57 m usable reach (0.591 m arm, 20 mm elbow reserve) for 1.78 m.
    "lowerArmLengthTarget": 0.12,
    "hairValue": 0.22,
    "idle": {"seconds": 10.0, "fps": 60, "keyEvery": 6},
    # P2 r2: variant A keeps MakeHuman's shoulders; variant B narrows them (CC0 torso/measure-shoulder-dist-decr)
    # until the arm span is within +/-5% of stature while shoulder-to-palm reach stays >= 0.591 m.
    "variant": "A",
    "variantB": {"spanTargetOverStature": 1.045, "reachMinM": 0.591},
    # Variant C: the physics' own reach definition governs. The rest-pose shoulder (upperarm01 head) -> elbow
    # (lowerarm01 head) -> wrist chain must reach the anthropometric 0.591 m (0.57 m usable after the 20 mm elbow
    # reserve; release/product-sequence/stage-1-practice/wedge/physics/REPORT.md), via CC0 measure-upperarm-length-incr.
    "variantC": {"chainTargetM": 0.593},
    # Gate-A v2 combines the physics-compatible C arm chain with shoulder narrowing.  The resulting span remains
    # inside the adult anthropometric +/-5% band without weakening the physics reach contract.
    # The symmetric hand-size target moves the wrist about 2.1 mm inward, so D solves a 0.5955 m pre-hand chain;
    # the final post-target chain retains margin over the binding 0.591 m physics floor.
    "variantD": {"chainTargetM": 0.5955, "spanTargetOverStature": 1.045},
    # Finger-by-finger closing on the handle (A3): stop at contact, never through.
    "closing": {"stepDeg": 3.0, "maxDeg": 110.0, "contactM": 0.0015, "penetrationLimitM": 0.0015},
    # Original VANDE gear and eyes refitted from the current runtime files (read-only inputs).
    "currentHero": "unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters",
    "gearClearanceM": 0.003,
    "gearMaxPushM": 0.015,
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
    print("[hero]", line)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2 or argv[0] != "build":
        raise SystemExit("usage: -- build <out-dir> [--variant A|B|C|D]")
    if "--variant" in argv:
        CONFIG["variant"] = argv[argv.index("--variant") + 1]
        if CONFIG["variant"] not in ("A", "B", "C", "D"):
            raise SystemExit("variant must be A, B, C or D")
    os.makedirs(argv[1], exist_ok=True)
    return argv[1]


def r(x, n=5):
    return None if x is None else round(float(x), n)


def update():
    bpy.context.view_layer.update()


# --------------------------------------------------------------------------------------------------------------------
# MPFB human
# --------------------------------------------------------------------------------------------------------------------

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
    # Solve the height macro so the evaluated stature lands on the target (bisection; deterministic).
    lo, hi = 0.0, 1.0
    basemesh = None
    for step in range(14):
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
    log("height macro", r(macro["height"], 6), "stature", r(stature, 4))
    return basemesh, macro, stature


def lengthen_lower_arms(TargetService, LocationService, basemesh):
    path = os.path.join(LocationService.get_mpfb_data("targets"), "arms", "measure-lowerarm-length-incr.target.gz")
    TargetService.load_target(basemesh, path, weight=CONFIG["lowerArmLengthTarget"])
    update()
    log("lower-arm length target", CONFIG["lowerArmLengthTarget"])


def add_assets(HumanService, LocationService, basemesh):
    data = LocationService.get_user_data()
    rig = HumanService.add_builtin_rig(basemesh, "default", import_weights=True)
    HumanService.set_character_skin(os.path.join(data, "skins", CONFIG["skin"]), basemesh, skin_type="GAMEENGINE")

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


# --------------------------------------------------------------------------------------------------------------------
# 163-bone MakeHuman default rig -> the game's 75-bone skeleton (weights merged into the nearest retained ancestor)
# --------------------------------------------------------------------------------------------------------------------

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
    merged = 0
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
                        merged += 1
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
    log("skeleton reduced", len(mapping), "bones merged away;", merged, "weight entries moved;", len(names), "remain")
    if sorted(names) != sorted(V3_BONE_NAMES):
        raise SystemExit("reduced skeleton differs from the game skeleton")
    return mapping


# --------------------------------------------------------------------------------------------------------------------
# Materials (simple, Unity-Built-in-compatible look: albedo + normal; no render-only tricks)
# --------------------------------------------------------------------------------------------------------------------

def principled(name, colour, roughness=0.8, normal_image=None, ao_image=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if ao_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = "VANDE_matching_garment_AO"
        tex.image = ao_image
        tex.image.colorspace_settings.name = "Non-Color"
        mul = nt.nodes.new("ShaderNodeMixRGB")
        mul.name = "VANDE_AO_times_kit_colour"
        mul.blend_type = "MULTIPLY"
        mul.inputs[0].default_value = 1.0
        mul.inputs[1].default_value = (*colour, 1.0)
        nt.links.new(tex.outputs["Color"], mul.inputs[2])
        nt.links.new(mul.outputs["Color"], bsdf.inputs["Base Color"])
    if normal_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = "VANDE_matching_garment_normal"
        tex.image = normal_image
        tex.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.8
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def find_image(folder, suffix):
    for f in sorted(os.listdir(folder)):
        if f.endswith(suffix):
            return bpy.data.images.load(os.path.join(folder, f), check_existing=True)
    return None


def require_image(folder, filename):
    """Load exactly one named source map from exactly one asset folder; suffix matching is not sufficient here."""
    path = os.path.realpath(os.path.join(folder, filename))
    if os.path.dirname(path) != os.path.realpath(folder) or not os.path.isfile(path):
        raise SystemExit("missing exact source image " + path)
    return bpy.data.images.load(path, check_existing=True)


def tint_base_colour(m, value):
    """Scale the value of a material's (possibly textured) base colour through a Hue/Saturation node."""
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
    """Make the source CC0 red-brown iris read as natural dark brown in Blender proof renders.

    The source image is neither replaced nor silently baked.  A saturation mask leaves the sclera unchanged and
    applies an explicitly recorded HSV grade only to coloured pixels.  This is a proof-material treatment; VPM3 has
    no material payload, which is intentionally recorded as a runtime-binding blocker by the candidate receipt.
    """
    if not m or not m.use_nodes:
        raise SystemExit("the selected CC0 eye material has no node graph")
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None or not bsdf.inputs["Base Color"].is_linked:
        raise SystemExit("the selected CC0 eye material has no linked base-colour source")
    source = bsdf.inputs["Base Color"].links[0].from_socket
    grade = CONFIG["eyeColourGrade"]
    separate = nt.nodes.new("ShaderNodeSeparateColor")
    separate.name = "VANDE_eye_source_HSV"
    separate.mode = "HSV"
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.name = "VANDE_natural_dark_brown_iris"
    hsv.inputs["Hue"].default_value = grade["hue"]
    hsv.inputs["Saturation"].default_value = grade["saturation"]
    hsv.inputs["Value"].default_value = grade["value"]
    gate = nt.nodes.new("ShaderNodeMath")
    gate.name = "VANDE_iris_saturation_mask"
    gate.operation = "GREATER_THAN"
    gate.inputs[1].default_value = grade["saturationThreshold"]
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.name = "VANDE_original_sclera_dark_brown_iris"
    nt.links.new(source, separate.inputs["Color"])
    nt.links.new(separate.outputs[1], gate.inputs[0])
    nt.links.new(source, hsv.inputs["Color"])
    nt.links.new(source, mix.inputs[1])
    nt.links.new(hsv.outputs["Color"], mix.inputs[2])
    nt.links.new(gate.outputs[0], mix.inputs[0])
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])


def style_materials(data):
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        lname = obj.name.lower()
        if "casualsuit" in lname or "sportsuit" in lname:
            asset = CONFIG["kitPbr"]["asset"]
            folder = os.path.join(data, "clothes", asset)
            normal = require_image(folder, CONFIG["kitPbr"]["normalFile"])
            ao = require_image(folder, CONFIG["kitPbr"]["aoFile"])
            jersey = principled("VANDE_original_cricket_jersey_navy", CONFIG["kitColour"], 0.78, normal, ao)
            trousers = principled("VANDE_original_cricket_trousers_navy", CONFIG["trouserColour"], 0.82,
                                  normal, ao)
            obj.data.materials.clear()
            obj.data.materials.append(jersey)
            obj.data.materials.append(trousers)
            groups = {g.index: g.name for g in obj.vertex_groups}
            hem_report = None
            if "sportsuit" in lname:
                # The CC0 athletic proxy has a crop-length top.  Extend only its lower spine02 hem down to the
                # trouser waistband, preserving topology/UVs and all authored shoulder/sleeve construction.
                hem = []
                for vertex in obj.data.vertices:
                    dominant = (groups.get(max(vertex.groups, key=lambda item: item.weight).group, "")
                                if vertex.groups else "")
                    if dominant == "spine02":
                        hem.append(vertex)
                floor = min((vertex.co.z for vertex in hem), default=0.0)
                moved = 0
                for vertex in hem:
                    weight = max(0.0, min(1.0, (floor + 0.09 - vertex.co.z) / 0.09))
                    if weight > 0.0:
                        vertex.co.z -= 0.18 * weight
                        moved += 1
                obj.data.update()
                hem_report = {"movedVertices": moved, "maxExtensionM": 0.18,
                              "method": "owner-authored smooth lower-hem extension to waistband; topology/UVs retained"}
                obj["vande_cricket_hem_extension"] = json.dumps(hem_report)
            for polygon in obj.data.polygons:
                lower = 0
                upper = 0
                for vi in polygon.vertices:
                    for weight in obj.data.vertices[vi].groups:
                        name = groups.get(weight.group, "")
                        if name.startswith(("upperleg", "lowerleg", "pelvis")):
                            lower += weight.weight
                        else:
                            upper += weight.weight
                polygon.material_index = 1 if lower > upper else 0
            obj.name = "VANDE_cricket_kit_cc0_derivative"
            obj.data.name = obj.name + "_mesh"
            continue
        elif "shoes" in lname:
            folder = os.path.join(data, "clothes", "shoes05")
            mat = principled("VANDE_shoes_white", CONFIG["shoeColour"], 0.6, find_image(folder, "_normal.png"))
        elif "short02" in lname or "hair" in lname:
            for slot in obj.material_slots:
                tint_base_colour(slot.material, CONFIG["hairValue"])
            continue
        elif "low-poly" in lname:
            for slot in obj.material_slots:
                grade_eye_colour(slot.material)
            continue
        else:
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    # Skin: lift the CC0 dark-skin albedo slightly towards a medium-brown tone (a value multiply, recorded).
    body = next(o for o in bpy.data.objects if o.type == "MESH" and o.name == "Human")
    for slot in body.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None or not bsdf.inputs["Base Color"].is_linked:
            continue
        link = bsdf.inputs["Base Color"].links[0]
        hsv = nt.nodes.new("ShaderNodeHueSaturation")
        hsv.inputs["Value"].default_value = CONFIG["skinValueLift"]
        nt.links.new(link.from_socket, hsv.inputs["Color"])
        nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def kit_uv_report():
    """Describe the exact garment UV set that the proof normal/AO pair addresses.

    This is deliberately recorded from the fitted mesh rather than inferred from an asset name.  It prevents a
    future pipeline change from silently pairing one MakeHuman garment with another garment's maps again.
    """
    kit = next(o for o in bpy.data.objects if o.type == "MESH" and "cricket_kit" in o.name.lower())
    uv = kit.data.uv_layers.active
    if uv is None:
        raise SystemExit("the fitted kit has no active UV layer")
    points = [(d.uv.x, d.uv.y) for d in uv.data]
    outside = sum(1 for x, y in points if x < -1e-6 or x > 1.0 + 1e-6 or y < -1e-6 or y > 1.0 + 1e-6)
    return {"object": kit.name, "uvLayer": uv.name, "uvCorners": len(points),
            "uRange": [r(min(x for x, _ in points), 6), r(max(x for x, _ in points), 6)],
            "vRange": [r(min(y for _, y in points), 6), r(max(y for _, y in points), 6)],
            "outsideUnitSquare": outside}


def export_kit_proof_maps(data, out):
    """Write compact, quarantined copies of the *matching* CC0 kit maps beside the candidate blend.

    These are proof outputs, never Unity Resources.  Blender performs the resize so the recipe is available on every
    machine that can build the candidate; every source and derivative byte is hashed in hero-build.json.
    """
    cfg = CONFIG["kitPbr"]
    folder = os.path.join(data, "clothes", cfg["asset"])
    result = {"asset": cfg["asset"], "licence": cfg["licence"], "resolution": cfg["proofResolution"],
              "uv": kit_uv_report(), "maps": {}}
    for role, filename in (("normal", cfg["normalFile"]), ("ao", cfg["aoFile"])):
        source = os.path.realpath(os.path.join(folder, filename))
        if os.path.dirname(source) != os.path.realpath(folder) or not os.path.isfile(source):
            raise SystemExit("missing exact matching %s map %s" % (role, source))
        image = bpy.data.images.load(source, check_existing=False)
        proof = image.copy()
        proof.name = "VANDE_gate_a_%s_%s" % (cfg["asset"], role)
        proof.scale(cfg["proofResolution"], cfg["proofResolution"])
        target = os.path.join(out, "hero-kit-%s-%d.png" % (role, cfg["proofResolution"]))
        proof.filepath_raw = target
        proof.file_format = "PNG"
        proof.save()
        result["maps"][role] = {
            "sourceId": "makehuman-system-assets-cc0/clothes/%s/%s" % (cfg["asset"], os.path.basename(source)),
            "sourceBytes": os.path.getsize(source), "sourceSha256": sha256_file(source),
            "proofFile": os.path.basename(target), "proofBytes": os.path.getsize(target),
            "proofSha256": sha256_file(target),
        }
        bpy.data.images.remove(proof)
        bpy.data.images.remove(image)
    # Owner-original, deterministic mobile proof map.  The small crossed weave breaks the plastic single-value
    # surface while remaining subtle at gameplay distance.  This is a generated asset, not a third-party texture.
    import numpy as np
    size = cfg["proofResolution"]
    yy, xx = np.indices((size, size))
    weave = (((xx % 12) < 2) | ((yy % 12) < 2)).astype(np.float32)
    value = np.clip(0.76 + weave * 0.08, 0.0, 1.0)
    pixels = np.empty((size, size, 4), dtype=np.float32)
    pixels[:, :, 0] = value
    pixels[:, :, 1] = value
    pixels[:, :, 2] = value
    pixels[:, :, 3] = 1.0
    rough = bpy.data.images.new("VANDE_original_cricket_fabric_roughness", width=size, height=size, alpha=True)
    rough.pixels.foreach_set(pixels.ravel())
    rough_path = os.path.join(out, "hero-kit-roughness-%d.png" % size)
    rough.filepath_raw = rough_path
    rough.file_format = "PNG"
    rough.save()
    result["maps"]["roughness"] = {
        "sourceId": "owner-original/procedural-crossed-fabric-weave-v1",
        "sourceBytes": 0,
        "sourceSha256": None,
        "proofFile": os.path.basename(rough_path),
        "proofBytes": os.path.getsize(rough_path),
        "proofSha256": sha256_file(rough_path),
        "licence": "VANDE-owner-original",
    }
    bpy.data.images.remove(rough)
    kit_object = next(o for o in bpy.data.objects if o.type == "MESH" and "cricket_kit" in o.name.lower())
    result["construction"] = {
        "geometryBase": "CC0 female_sportsuit01 athletic fitted mesh",
        "derivative": "owner-authored cricket jersey/trouser material separation and navy sports treatment",
        "licence": "CC0-1.0 + VANDE-owner-original derivative",
        "noTeamKit": True,
        "noSponsor": True,
        "noTrademark": True,
        "hemExtension": json.loads(kit_object.get("vande_cricket_hem_extension", "null")),
    }
    return result


def eye_colour_proof(data):
    """Record the exact CC0 input and the non-destructive proof-only eye grade."""
    source = os.path.realpath(os.path.join(data, "eyes", "materials", CONFIG["eyeMaterial"] + "_eye.png"))
    expected_parent = os.path.realpath(os.path.join(data, "eyes", "materials"))
    if os.path.dirname(source) != expected_parent or not os.path.isfile(source):
        raise SystemExit("missing exact CC0 eye source " + source)
    return {
        "sourceId": "makehuman-system-assets-cc0/eyes/materials/" + os.path.basename(source),
        "sourceBytes": os.path.getsize(source),
        "sourceSha256": sha256_file(source),
        "proofShaderGrade": CONFIG["eyeColourGrade"],
        "sourcePreserved": True,
        "runtimeBinding": None,
        "note": "saturation-masked proof shader grade; no derived eye texture and no VPM3 material payload",
    }


def symmetrize_visual_mesh(obj, max_pair_distance=0.12):
    """Average existing left/right geometry pairs without changing topology, UVs or licence identity."""
    tree = KDTree(len(obj.data.vertices))
    for vertex in obj.data.vertices:
        tree.insert(vertex.co, vertex.index)
    tree.balance()
    pairs = []
    pre = []
    used = set()
    for vertex in obj.data.vertices:
        if vertex.index in used or vertex.co.x <= 1e-6:
            continue
        mirrored = Vector((-vertex.co.x, vertex.co.y, vertex.co.z))
        point, other, distance = tree.find(mirrored)
        if other is None or other == vertex.index or distance > max_pair_distance:
            continue
        opposite = obj.data.vertices[other]
        if opposite.co.x >= -1e-6:
            continue
        used.update((vertex.index, other))
        pairs.append((vertex.index, other))
        pre.append(distance)
    for left, right in pairs:
        a = obj.data.vertices[left].co.copy()
        b = obj.data.vertices[right].co.copy()
        half_x = (abs(a.x) + abs(b.x)) * 0.5
        y = (a.y + b.y) * 0.5
        z = (a.z + b.z) * 0.5
        obj.data.vertices[left].co = Vector((half_x, y, z))
        obj.data.vertices[right].co = Vector((-half_x, y, z))
    for vertex in obj.data.vertices:
        if abs(vertex.co.x) <= 1e-6:
            vertex.co.x = 0.0
    obj.data.update()
    return {"object": obj.name, "pairs": len(pairs),
            "preMaxM": r(max(pre), 5) if pre else 0.0,
            "method": "owner-authored coordinate averaging of existing mirror pairs; topology/UVs unchanged"}


# --------------------------------------------------------------------------------------------------------------------
# The bat (original VANDE geometry, VBT1 dimensions)
# --------------------------------------------------------------------------------------------------------------------

def make_bat():
    c = CONFIG["bat"]
    bm = bmesh.new()
    handle_len = c["totalM"] - c["bladeM"]
    # Handle: 16-sided cylinder from the top (z = blade + handle) down to the shoulder (z = blade).
    seg = 16
    rings = []
    for z in (c["bladeM"] + handle_len, c["bladeM"] - 0.02):
        ring = [bm.verts.new((c["handleRadiusM"] * math.cos(2 * math.pi * k / seg),
                              c["handleRadiusM"] * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)]
        rings.append(ring)
    for k in range(seg):
        bm.faces.new((rings[0][k], rings[0][(k + 1) % seg], rings[1][(k + 1) % seg], rings[1][k]))
    bm.faces.new(list(reversed(rings[0])))
    # Blade: flat face (−y), a raised spine on the back (+y), slightly rounded edges; 14 stations from shoulder to toe.
    half_w = c["widthM"] / 2.0
    prof = []
    for k in range(9):
        u = -1.0 + 2.0 * k / 8.0
        x = half_w * u
        back = c["depthM"] * (0.34 + 0.66 * (1.0 - u * u) ** 0.6)
        prof.append((x, back))
    stations = []
    for s in range(14):
        t = s / 13.0
        z = c["bladeM"] * (1.0 - t)
        taper = 1.0 if t < 0.85 else 1.0 - 0.35 * (t - 0.85) / 0.15
        shoulder = 0.55 + 0.45 * min(1.0, t / 0.08)
        ring = []
        for (x, back) in prof:
            ring.append(bm.verts.new((x * shoulder, (back - c["depthM"] * 0.42) * taper * shoulder, z)))
        for (x, back) in reversed(prof):
            ring.append(bm.verts.new((x * shoulder, -c["depthM"] * 0.42 * shoulder, z)))
        stations.append(ring)
    n = len(stations[0])
    for s in range(len(stations) - 1):
        a, b = stations[s], stations[s + 1]
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(stations[0])
    bm.faces.new(list(reversed(stations[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("VANDE_bat")
    bm.to_mesh(me)
    bm.free()
    bat = bpy.data.objects.new("VANDE_bat", me)
    bpy.context.scene.collection.objects.link(bat)
    bat.data.materials.append(principled("VANDE_bat_willow", [0.80, 0.66, 0.43], 0.55))
    # Place: toe near the back toe, handle top in front of the hips; face normal (−y local) towards the bowler.
    toe = Vector(c["toe"])
    top = Vector(c["top"])
    axis = (top - toe).normalized()
    face_hint = Vector((1.0, -0.35, 0.0)).normalized()
    face = (face_hint - axis * face_hint.dot(axis)).normalized()
    side = axis.cross(face).normalized()
    rot = Matrix((side, -face, axis)).transposed().to_4x4()
    bat.matrix_world = Matrix.Translation(toe) @ rot
    update()
    return bat, toe, axis, face


# --------------------------------------------------------------------------------------------------------------------
# Posing helpers
# --------------------------------------------------------------------------------------------------------------------

def world_head(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].head


def world_tail(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].tail


def rotate_world(rig, name, axis, angle_deg):
    """Rotate a pose bone about a world axis through its head (rig at identity transform)."""
    pb = rig.pose.bones[name]
    head = pb.head.copy()
    rot = Matrix.Rotation(math.radians(angle_deg), 4, axis.normalized())
    pb.matrix = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ pb.matrix
    update()


def flexion(rig, a, b, c):
    p0, p1, p2 = world_head(rig, a), world_head(rig, b), world_head(rig, c)
    return 180.0 - math.degrees((p0 - p1).angle(p2 - p1))


def empty(name, location):
    e = bpy.data.objects.new(name, None)
    e.location = location
    bpy.context.scene.collection.objects.link(e)
    return e


def apply_visual_pose(rig):
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.visual_transform_apply()
    for pb in rig.pose.bones:
        for con in list(pb.constraints):
            pb.constraints.remove(con)
    bpy.ops.object.mode_set(mode="OBJECT")
    update()


def leg_ik(rig, side, target, pole):
    pb = rig.pose.bones["lowerleg02." + side]
    con = pb.constraints.new("IK")
    con.target = target
    con.pole_target = pole
    con.pole_angle = math.radians(-90)
    con.chain_count = 4
    return con


def arm_ik(rig, side, target, pole):
    pb = rig.pose.bones["lowerarm02." + side]
    con = pb.constraints.new("IK")
    con.target = target
    con.pole_target = pole
    con.pole_angle = math.radians(-90)
    con.chain_count = 4
    return con


# --------------------------------------------------------------------------------------------------------------------
# Stance (hand-keyed against COVER-DRIVE-SPEC §1; right-handed; chest towards −y (off side), bowler towards +x)
# --------------------------------------------------------------------------------------------------------------------

def pose_stance(rig, bat_toe, bat_axis):
    st = CONFIG["stance"]
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    update()
    rest_ankle_l = world_head(rig, "foot.L")
    rest_ankle_r = world_head(rig, "foot.R")
    ankle_z = (rest_ankle_l.z + rest_ankle_r.z) / 2.0
    half = st["ankleSeparationM"] / 2.0
    # Side-on: rotate the whole body so the left shoulder points at the bowler (+x): the MakeHuman front is −y and
    # its left is +x already, so side-on means the feet line along x. Open the hips/shoulders by openDeg towards +x.
    root = rig.pose.bones["root"]
    tgt_l = empty("ik_foot_L", Vector((half, rest_ankle_l.y, ankle_z)))
    tgt_r = empty("ik_foot_R", Vector((-half, rest_ankle_r.y, ankle_z)))
    pole_l = empty("pole_knee_L", Vector((half + 0.05, -1.0, 0.5)))
    pole_r = empty("pole_knee_R", Vector((-half - 0.05, -1.0, 0.5)))
    leg_ik(rig, "L", tgt_l, pole_l)
    leg_ik(rig, "R", tgt_r, pole_r)
    rotate_world(rig, "root", Vector((0, 0, 1)), st["openDeg"])
    # Crouch: lower the root until the mean knee flexion reaches the target (bisection on the drop).
    lo, hi = 0.0, 0.25
    base_loc = root.location.copy()
    for _ in range(18):
        drop = (lo + hi) / 2.0
        root.location = base_loc
        update()
        root_head = root.head.copy()
        pbm = root.matrix.copy()
        pbm.translation = root_head + Vector((0.0, -0.035, -drop))
        root.matrix = pbm
        update()
        knee = (flexion(rig, "upperleg01.L", "lowerleg01.L", "foot.L") +
                flexion(rig, "upperleg01.R", "lowerleg01.R", "foot.R")) / 2.0
        if knee < st["kneeFlexTargetDeg"]:
            lo = drop
        else:
            hi = drop
    log("crouch drop", r(drop, 4), "knee flex", r(knee, 2))
    # Feet: toes towards the off side (−y), the front foot opened towards the bowler.
    for side, open_deg in (("L", st["frontFootOpenDeg"]), ("R", 0.0)):
        pb = rig.pose.bones["foot." + side]
        head = pb.head.copy()
        direction = Vector((math.sin(math.radians(open_deg)), -math.cos(math.radians(open_deg)), 0.0))
        cur = (pb.tail - pb.head)
        cur_h = Vector((cur.x, cur.y, 0.0)).normalized()
        yaw = math.degrees(math.atan2(cur_h.cross(direction).z, cur_h.dot(direction)))
        rotate_world(rig, "foot." + side, Vector((0, 0, 1)), yaw)
    # Thorax forward pitch: distribute over spine04..spine01 about the open lateral axis until the thorax line
    # (spine03 head -> neck01 head) is thoraxPitchTargetDeg from vertical.
    lateral = Matrix.Rotation(math.radians(st["openDeg"]), 3, "Z") @ Vector((1, 0, 0))

    def thorax_pitch():
        v = world_head(rig, "neck01") - world_head(rig, "spine03")
        return math.degrees(v.angle(Vector((0, 0, 1))))

    for _ in range(12):
        err = st["thoraxPitchTargetDeg"] - thorax_pitch()
        if abs(err) < 0.3:
            break
        for name in ("spine04", "spine03", "spine02", "spine01"):
            rotate_world(rig, name, lateral, err / 4.0)
    log("thorax pitch", r(thorax_pitch(), 2))
    return lateral, thorax_pitch


def head_frame(rig, eye_l, eye_r):
    """Face forward (head→eye midpoint, horizontal) and the eye line, from the eye meshes' centres."""
    mid = (eye_l + eye_r) / 2.0
    fwd = mid - world_head(rig, "head")
    return fwd, (eye_l - eye_r)


def mesh_centre(obj, group_hint):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [obj.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    if group_hint == "L":
        pts = [p for p in pts if p.x > 0] or pts
    else:
        pts = [p for p in pts if p.x <= 0] or pts
    return sum(pts, Vector()) / len(pts)


def eye_centres(rig):
    eyes = next(o for o in bpy.data.objects if o.type == "MESH" and "poly" in o.name.lower())
    # Eye mesh: two balls. Split by the head's local lateral axis using the rest-pose bones.
    deps = bpy.context.evaluated_depsgraph_get()
    ev = eyes.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [eyes.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    centre = sum(pts, Vector()) / len(pts)
    # Farthest-pair split.
    a = max(pts, key=lambda p: (p - centre).length)
    left = [p for p in pts if (p - a).length < (p - (2 * centre - a)).length]
    right = [p for p in pts if (p - a).length >= (p - (2 * centre - a)).length]
    ca = sum(left, Vector()) / len(left)
    cb = sum(right, Vector()) / len(right)
    # .L is the character's left (+x at rest).
    return (ca, cb) if ca.x >= cb.x else (cb, ca)


def frame_matrix(forward, up):
    f = forward.normalized()
    u = (up - f * up.dot(f)).normalized()
    side = f.cross(u).normalized()
    return Matrix((f, u, side)).transposed()


def up_frame(up, forward):
    """Frame with the head's up axis primary and the face direction taken perpendicular to it."""
    u = up.normalized()
    f = (forward - u * forward.dot(u)).normalized()
    side = f.cross(u).normalized()
    return Matrix((f, u, side)).transposed()


def pose_head(rig):
    """Turn the head to face the bowler (+x), nodded headDownDeg forward, eyes level. The head's frame is its skull
    axis (head bone, primary) and the face direction perpendicular to it (towards the eye midpoint), shared 30/20/50
    over neck01, neck02 and head. A full-frame solve cannot flip the head over, and using the skull axis as primary
    keeps the gaze from tilting up (the eyes sit above the head bone's midpoint)."""
    st = CONFIG["stance"]
    d = math.radians(st["headDownDeg"])
    desired = up_frame(Vector((math.sin(d), 0.0, math.cos(d))), Vector((math.cos(d), 0.0, -math.sin(d))))
    for _ in range(5):
        el, er = eye_centres(rig)
        mid = (el + er) / 2.0
        up = world_tail(rig, "head") - world_head(rig, "head")
        current = up_frame(up, mid - world_head(rig, "head"))
        rot = (desired @ current.inverted()).to_quaternion()
        axis, angle = rot.to_axis_angle()
        if math.degrees(angle) < 0.3:
            break
        for name, share in (("neck01", 0.3), ("neck02", 0.2), ("head", 0.5)):
            rotate_world(rig, name, axis, math.degrees(angle) * share)
    el, er = eye_centres(rig)
    mid = (el + er) / 2.0
    up = world_tail(rig, "head") - world_head(rig, "head")
    fwd = mid - world_head(rig, "head")
    fwd = fwd - up.normalized() * fwd.dot(up.normalized())
    roll = math.degrees(math.asin(max(-1.0, min(1.0, (el.z - er.z) / max(1e-6, (el - er).length)))))
    yaw_to_bowler = math.degrees(math.atan2(fwd.y, fwd.x))
    gaze_pitch = math.degrees(math.atan2(fwd.z, fwd.xy.length))
    up_ok = up.z > 0
    log("head roll", r(roll, 2), "yaw from bowler line", r(yaw_to_bowler, 2), "gaze pitch", r(gaze_pitch, 2),
        "head upright", up_ok)
    if not up_ok:
        raise SystemExit("head solve left the head inverted")
    pose_head.gaze_pitch = gaze_pitch
    return roll, yaw_to_bowler


# --------------------------------------------------------------------------------------------------------------------
# Grip: IK the wrists onto the handle, then search wrist roll and finger curl to close the hands on it
# --------------------------------------------------------------------------------------------------------------------

FINGERS = ["finger2", "finger3", "finger4", "finger5"]


def hand_vertices(body, rig, side):
    """Indices of body vertices dominated by this hand (wrist, metacarpal and finger groups)."""
    names = {n for n in V3_BONE_NAMES if n.endswith("." + side) and (n.startswith("wrist") or n.startswith("finger")
                                                                       or n.startswith("metacarpal"))}
    idx = {g.index for g in body.vertex_groups if g.name in names}
    helper = body.vertex_groups.get("body")
    out = []
    for v in body.data.vertices:
        if helper is not None and not any(g.group == helper.index and g.weight > 0.5 for g in v.groups):
            continue
        w = sum(g.weight for g in v.groups if g.group in idx)
        if w > 0.6:
            out.append(v.index)
    return out


def evaluated_points(obj, indices=None):
    """Deformed world positions. With indices, MASK modifiers are disabled so original indices stay valid."""
    masks = [m for m in obj.modifiers if m.type == "MASK" and m.show_viewport] if indices is not None else []
    for m in masks:
        m.show_viewport = False
    try:
        deps = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(deps)
        me = ev.to_mesh()
        mw = obj.matrix_world
        if indices is None:
            pts = [mw @ v.co for v in me.vertices]
        else:
            pts = [mw @ me.vertices[i].co for i in indices]
        ev.to_mesh_clear()
    finally:
        for m in masks:
            m.show_viewport = True
    return pts


def handle_distance(p, top, axis, radius):
    """Signed distance from p to the capped handle cylinder (top cap at the handle end, open into the blade below),
    negative inside, and the axial coordinate measured down from the top."""
    d = p - top
    along = -d.dot(axis)
    radial = (d + axis * along).length
    if along >= 0.0:
        return radial - radius, along
    # Above the handle end: distance to the top disc.
    if radial <= radius:
        return -along, along
    return math.hypot(radial - radius, along), along


def curl_fingers(rig, side, amount_deg, thumb_deg):
    for f in FINGERS:
        for seg, share in ((1, 0.9), (2, 1.1), (3, 0.8)):
            pb = rig.pose.bones["%s-%d.%s" % (f, seg, side)]
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (math.radians(amount_deg * share), 0.0, 0.0)
    for seg, share in ((2, 0.6), (3, 0.8)):
        pb = rig.pose.bones["finger1-%d.%s" % (seg, side)]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (math.radians(thumb_deg * share), 0.0, 0.0)
    update()


def grip_score(body, rig, side, verts, top, axis, radius, band):
    pts = evaluated_points(body, verts)
    near = 0
    pen = 0.0
    gap_sum = 0.0
    cnt = 0
    for p in pts:
        s, along = handle_distance(p, top, axis, radius)
        if band[0] - 0.03 <= along <= band[1] + 0.03:
            cnt += 1
            if s < 0:
                pen = max(pen, -s)
            if s < 0.006:
                near += 1
            gap_sum += max(0.0, s)
    if cnt == 0:
        return 1e9, {}
    # Wants many vertices near the surface, little penetration, small mean gap.
    # Penetration up to 4 mm (skin compression) is cheap, beyond it heavy; contact is rewarded.
    score = (100.0 * pen if pen <= 0.004 else 0.4 + 2000.0 * (pen - 0.004)) + 30.0 * (gap_sum / cnt) - 0.01 * near
    return score, {"penetrationM": pen, "meanGapM": gap_sum / cnt, "verticesWithin6mm": near, "inBand": cnt}


def palm_side_sign(rig, side):
    """The palm side, by a physical test: make a trial fist of the middle finger both ways about the knuckle line;
    flexion is the way that brings the fingertip close to the palm (hyperextension sends it far behind the hand).
    Returns the sign for direction x across. Call with the fingers at rest; they are restored."""
    names = ["finger3-%d.%s" % (k, side) for k in (1, 2, 3)]
    saved = {n: rig.pose.bones[n].matrix_basis.copy() for n in names}
    palm = (world_head(rig, "metacarpal3." + side) + world_tail(rig, "metacarpal3." + side)) / 2.0
    best = None
    for sign in (1.0, -1.0):
        for n, m in saved.items():
            rig.pose.bones[n].matrix_basis = m
        update()
        across = (world_head(rig, "finger2-1." + side) - world_head(rig, "finger5-1." + side)).normalized()
        for n, deg in zip(names, (70.0, 90.0, 60.0)):
            rotate_world(rig, n, across, sign * deg)
        d = (world_tail(rig, names[-1]) - palm).length
        if best is None or d < best[0]:
            best = (d, sign)
    for n, m in saved.items():
        rig.pose.bones[n].matrix_basis = m
    update()
    # Convert "rotate +sign about across" into the palm normal's orientation for direction x across.
    wrist = world_head(rig, "wrist." + side)
    knuckle = world_head(rig, "finger3-1." + side)
    direction = (knuckle - wrist).normalized()
    across = (world_head(rig, "finger2-1." + side) - world_head(rig, "finger5-1." + side)).normalized()
    normal = direction.cross(across).normalized()
    pb = rig.pose.bones[names[0]]
    head, tail = pb.head.copy(), pb.tail.copy()
    moved = head + Matrix.Rotation(math.radians(best[1] * 5.0), 3, across) @ (tail - head)
    return 1.0 if (moved - tail).dot(normal) > 0 else -1.0


PALM_SIGN = {}


def hand_frame(rig, side):
    """Current hand frame: direction wrist -> middle knuckle, and the palm normal (towards the palm side)."""
    wrist = world_head(rig, "wrist." + side)
    knuckle = world_head(rig, "finger3-1." + side)
    index_k = world_head(rig, "finger2-1." + side)
    little_k = world_head(rig, "finger5-1." + side)
    direction = (knuckle - wrist).normalized()
    across = (index_k - little_k).normalized()
    normal = direction.cross(across).normalized() * PALM_SIGN.get(side, 1.0)
    return direction, normal


def orient_hand(rig, side, want_dir, want_normal):
    cur = frame_matrix(*hand_frame(rig, side))
    tgt = frame_matrix(want_dir, want_normal)
    axis, angle = (tgt @ cur.inverted()).to_quaternion().to_axis_angle()
    if angle > 1e-5:
        rotate_world(rig, "wrist." + side, axis, math.degrees(angle))


def pose_grip(rig, body, bat_toe, bat_axis, sides=("L", "R"), joint=None, gloved_eval=None, keep_rule="bare"):
    """Hands on the handle: the hand's long axis runs round the handle (tangent), the palm faces the handle axis,
    the fingers curl round it. Each hand is searched over wrap sense and contact angle round the handle, with
    penetration weighted far above every other term (A3/A4).
    joint (P2 r4): {side: [distances from the handle top]}. Every candidate of each hand is kept with its contact
    span along the handle and its skin points, and the two hands are chosen together: both hands closed, top hand
    above, 0-40 mm apart (A3), and the fewest hand-to-hand skin points within 2 mm."""
    c = CONFIG["bat"]
    g = CONFIG["grip"]
    top = bat_toe + bat_axis * c["totalM"]
    radius = c["handleRadiusM"]
    ref = Vector((0.0, 1.0, 0.0))
    ref = (ref - bat_axis * ref.dot(bat_axis)).normalized()
    cands = {}
    for side in sides:
        default = g["topHandFromTopM"] if side == "L" else g["bottomHandFromTopM"]
        positions = joint[side] if joint and side in joint else [default]
        cands[side] = []
        for from_top in positions:
            centre = top - bat_axis * from_top
            for wrap in (1.0, -1.0):
                for around in (-60, -30, 0, 30, 60):
                    out = Matrix.Rotation(math.radians(around), 3, bat_axis) @ ref
                    tangent = bat_axis.cross(out).normalized() * wrap
                    # Power grip: the handle lies across the base of the fingers, so the wrist joint sits one palm
                    # length (about 78 mm) back along the hand from the handle and a palm thickness out from it.
                    wrist_target = centre + out * (radius + 0.024) - tangent * 0.078
                    for pb in rig.pose.bones:
                        for con in list(pb.constraints):
                            pb.constraints.remove(con)
                    tgt = empty("ik_hand_" + side, wrist_target)
                    pole = empty("pole_elbow_" + side, centre + Vector((0.25 if side == "L" else -0.35, 0.45, -0.40)))
                    pb = rig.pose.bones["lowerarm02." + side]
                    con = pb.constraints.new("IK")
                    con.target = tgt
                    con.pole_target = pole
                    con.pole_angle = math.radians(-90)
                    con.chain_count = g.get("armChain", 4)
                    sh = rig.pose.bones["shoulder01." + side]
                    sh.ik_stiffness_x = sh.ik_stiffness_y = sh.ik_stiffness_z = g.get("shoulderStiffness", 0.0)
                    update()
                    apply_visual_pose(rig)
                    bpy.data.objects.remove(tgt, do_unlink=True)
                    bpy.data.objects.remove(pole, do_unlink=True)
                    for d in ("finger1", "finger2", "finger3", "finger4", "finger5"):
                        for k in (1, 2, 3):
                            fb = rig.pose.bones["%s-%d.%s" % (d, k, side)]
                            fb.rotation_mode = "XYZ"
                            fb.rotation_euler = (0.0, 0.0, 0.0)
                    update()
                    if side not in PALM_SIGN:
                        PALM_SIGN[side] = palm_side_sign(rig, side)
                    orient_hand(rig, side, tangent, -out)
                    wrist_miss = (rig.matrix_world @ rig.pose.bones["wrist." + side].head - wrist_target).length
                    names = [n for n in rig.pose.bones.keys() if n.endswith("." + side)]
                    base = {n: rig.pose.bones[n].matrix_basis.copy() for n in names}
                    residual, pen = cheap_close(rig, side, top, bat_axis, radius)
                    palm = segment_gap(rig, "metacarpal3." + side, top, bat_axis, radius, finger_r=0.012)
                    score = residual + 20.0 * pen + 2.0 * abs(palm)
                    facts = {"fingerResidualM": residual, "fingerPenetrationM": pen, "palmGapM": palm,
                             "wristToTargetM": wrist_miss, "fromTopM": from_top}
                    span, pts = None, None
                    cands[side].append({"score": score, "wrap": wrap, "around": around, "facts": facts, "base": base,
                                        "span": span, "pts": pts})
                    for n, m in base.items():
                        rig.pose.bones[n].matrix_basis = m
                    update()
    chosen = {side: min(cands[side], key=lambda k: k["score"]) for side in sides}
    joint_report = None
    if joint and "L" in sides and "R" in sides:
        # Shortlist each hand's three best orientations at each position (fast closing), then close each one for real
        # (close_fingers, as the build does) and measure its digits, its skin contact span along the handle and its
        # skin points. The fast closing alone does not predict which hands really close.
        good = {}
        for side in ("L", "R"):
            good[side] = []
            for from_top in sorted({k["facts"]["fromTopM"] for k in cands[side]}):
                at = sorted([k for k in cands[side] if k["facts"]["fromTopM"] == from_top], key=lambda k: k["score"])
                for k in at[:3]:
                    for n, m in k["base"].items():
                        rig.pose.bones[n].matrix_basis = m
                    update()
                    close_fingers(rig, body, side, top, bat_axis, radius)
                    dg = digit_gaps(rig, body, side, top, bat_axis, radius)
                    k["closedDigits"] = sum(1 for v in dg.values() if v <= 0.005)
                    k["pts"] = evaluated_points(body, hand_vertices(body, rig, side))
                    dists = [handle_distance(p_, top, bat_axis, radius) for p_ in k["pts"]]
                    along = [a_ for sd, a_ in dists if sd < 0.006]
                    k["span"] = (min(along), max(along)) if along else None
                    k["deepest"] = max(0.0, -min(sd for sd, _ in dists))
                    k["closedBase"] = {n: rig.pose.bones[n].matrix_basis.copy() for n in k["base"]}
                    if k["span"] is not None:
                        good[side].append(k)
                    for n, m in k["base"].items():
                        rig.pose.bones[n].matrix_basis = m
                    update()
        trees = {}
        ranked = []
        pairs = 0
        for cl in good["L"]:
            for cr in good["R"]:
                sep = cr["span"][0] - cl["span"][1]
                overlap = max(0.0, -sep) + max(0.0, sep - 0.040)
                above = 0 if cl["span"][0] < cr["span"][0] else 1
                key = id(cr)
                if key not in trees:
                    tree = KDTree(len(cr["pts"]))
                    for i, p_ in enumerate(cr["pts"]):
                        tree.insert(p_, i)
                    tree.balance()
                    trees[key] = tree
                close = sum(1 for p_ in cl["pts"] if trees[key].find(p_)[2] < 0.002)
                # Bare ranking: the least depth into the handle beyond 3 mm (2 mm steps), then digits closed (A3), then A3
                # spacing (in 5 mm steps), the top hand not hanging over the handle end, top hand above, then
                # hand-to-hand contact.
                overhang = 1 if cl["span"][0] < -0.005 else 0
                deep = round(max(0.0, max(cl["deepest"], cr["deepest"]) - 0.003) * 500.0)
                total = (deep, -(cl["closedDigits"] + cr["closedDigits"]), round(overlap * 200.0), overhang, above,
                         close, cl["score"] + cr["score"])
                pairs += 1
                ranked.append((total, sep, cl, cr, close))
        ranked.sort(key=lambda t: t[0])
        best = ranked[0] if ranked else None
        gloved_tried = []
        if gloved_eval is not None and ranked:
            # The six best bare pairs are also tried with the gloves on (bat seated against the gloves, with tilt).
            # keepRule "gloved" (A): the most gloves within 5 mm, then the smallest worst glove gap, then the bare
            # ranking. "bare" (C): the bare ranking, the gloves only breaking ties.
            choices = []
            for total, sep, cl, cr, close in ranked[:6]:
                for k in (cl, cr):
                    for n, m in k["closedBase"].items():
                        rig.pose.bones[n].matrix_basis = m
                update()
                g["topHandFromTopM"] = cl["facts"]["fromTopM"]
                g["bottomHandFromTopM"] = cr["facts"]["fromTopM"]
                g["bottomHandSeatFromTopM"] = r((cr["span"][0] + cr["span"][1]) / 2.0, 4)
                gl_gap, gl_tilt = gloved_eval(bat_toe, bat_axis)
                gl_ok = sum(1 for v in gl_gap.values() if v <= 0.005)
                gl_worst = max(gl_gap.values())
                gkey = (-gl_ok, round(max(0.0, gl_worst) * 1000.0) if gl_ok < 2 else 0)
                key = gkey + total if keep_rule == "gloved" else total + gkey
                choices.append((key, sep, cl, cr, close))
                gloved_tried.append({"fromTopM": [cl["facts"]["fromTopM"], cr["facts"]["fromTopM"]],
                                     "aroundDeg": [cl["around"], cr["around"]], "wrap": [cl["wrap"], cr["wrap"]],
                                     "bareDigitsClosed": cl["closedDigits"] + cr["closedDigits"],
                                     "deepestM": r(max(cl["deepest"], cr["deepest"]), 4), "separationM": r(sep, 4),
                                     "glovedGapM": {k_: r(v, 4) for k_, v in gl_gap.items()}, "seatTiltDeg": gl_tilt})
            choices.sort(key=lambda t: t[0])
            best = choices[0]
        if best is not None:
            chosen = {"L": best[2], "R": best[3]}
            g["topHandFromTopM"] = best[2]["facts"]["fromTopM"]
            g["bottomHandFromTopM"] = best[3]["facts"]["fromTopM"]
            g["bottomHandSeatFromTopM"] = r((best[3]["span"][0] + best[3]["span"][1]) / 2.0, 4)
            joint_report = {"candidates": {k: len(v) for k, v in cands.items()},
                            "closingCandidates": {k: len(v) for k, v in good.items()}, "pairsScored": pairs,
                            "positionsFromTopM": joint, "chosenFromTopM": {"L": g["topHandFromTopM"],
                                                                          "R": g["bottomHandFromTopM"]},
                            "estimatedSeparationM": r(best[1], 4), "estimatedHandToHandWithin2mm": best[4],
                            "chosenDigitsClosed": {"L": best[2]["closedDigits"], "R": best[3]["closedDigits"]},
                            "keepRule": keep_rule, "glovedTried": gloved_tried,
                            "shortlist": {sd: [{"fromTopM": k["facts"]["fromTopM"], "wrap": k["wrap"],
                                                "aroundDeg": k["around"], "closedDigits": k["closedDigits"],
                                                "deepestM": r(k["deepest"], 4), "span": [r(x, 4) for x in k["span"]],
                                                "wristToTargetM": r(k["facts"]["wristToTargetM"], 4)}
                                               for k in good[sd]] for sd in ("L", "R")},
                            "method": "fast-closing shortlist (3 per position), real closing, then pairs ranked by "
                                      "digits closed, overlap, overhang, order, depth, hand-to-hand contact"}
            log("joint grip", joint_report)
    results = {}
    for side in sides:
        k = chosen[side]
        # After the joint solve the chosen hands stay closed, so the bare seat that follows fits the bat to the
        # closed hands (and lifts any part that sits too deep) instead of to open ones.
        for n, m in (k.get("closedBase") if joint_report and k.get("closedBase") else k["base"]).items():
            rig.pose.bones[n].matrix_basis = m
        update()
        results[side] = {"wrap": k["wrap"], "aroundDeg": k["around"], "palmSign": PALM_SIGN.get(side),
                         **{kk: r(v, 5) for kk, v in k["facts"].items()}}
        log("grip", side, results[side])
    if joint_report:
        results["joint"] = joint_report
    return results, top


def seat_bat(rig, body, bat, bat_toe, bat_axis, hands=None, avoid=None, tilt=False, pen_tol=0.004):
    """Shift the bat (toe kept on the ground) so both hands touch the handle without sinking into it.
    hands: optional {side: [points]} to seat against (the gloves); default the bare hands.
    tilt: also tilt the bat about its toe (P2 r4), up to tiltMaxDeg about the two horizontal axes, so two rigid mitts
    can both meet the handle; the tilt is searched on a coarse translation grid, then the translation is refined.
    The new axis is (top - toe) of the returned pair."""
    c = CONFIG["bat"]
    g = CONFIG["grip"]
    radius = c["handleRadiusM"]
    if hands is None:
        hands = {side: evaluated_points(body, hand_vertices(body, rig, side)) for side in ("L", "R")}
    # The bottom hand's band: its measured contact span once the spacing loop has run (its target can be out of the
    # arm's reach, and a band round an unreached target holds no hand points, so that hand would be ignored).
    bottom = g.get("bottomHandSeatFromTopM", g["bottomHandFromTopM"])
    bands = {"L": (g["topHandFromTopM"] - 0.05, g["topHandFromTopM"] + 0.05),
             "R": (bottom - 0.05, bottom + 0.05)}
    def evaluate(axis, ij_range, step, centre=(0, 0), pts=None):
        u = axis.cross(Vector((0, 0, 1))).normalized()
        v = axis.cross(u).normalized()
        best = None
        for i in ij_range:
            for j in ij_range:
                cand = score_at(axis, bat_toe + u * ((centre[0] + i) * step) + v * ((centre[1] + j) * step),
                                pts or hands)
                if best is None or cand[0] < best[0]:
                    best = cand + ((centre[0] + i, centre[1] + j),)
        return best

    def score_at(axis, toe, pts):
        toe = toe + axis * ((0.004 - toe.z) / axis.z)
        top = toe + axis * c["totalM"]
        worst_pen = 0.0
        worst_gap = 0.0
        near = 0
        for side in ("L", "R"):
            smin = 1.0
            for p in pts[side]:
                s, along = handle_distance(p, top, axis, radius)
                if bands[side][0] <= along <= bands[side][1]:
                    smin = min(smin, s)
                    if s < 0.006:
                        near += 1
            worst_pen = max(worst_pen, max(0.0, -smin))
            worst_gap = max(worst_gap, max(0.0, smin))
        score = ((10.0 * worst_pen if worst_pen <= pen_tol else 10.0 * pen_tol + 200.0 * (worst_pen - pen_tol)) +
                 30.0 * worst_gap - 0.001 * near)
        if avoid:
            # The blade as its own box (r4; r3 used a capsule of the blade's half-width, which flags pads beside the
            # blade's thin face and back): width x depth (face 0.42, back 0.58 of the depth from the axis) x length
            # in the bat's frame, plus 3 mm. The penalty is the deepest pad point's depth inside it.
            fh = Vector((1.0, -0.35, 0.0)).normalized()
            fc = (fh - axis * fh.dot(axis)).normalized()
            sd_ax = axis.cross(fc).normalized()
            m_ = 0.003
            hw, yb, yf = c["widthM"] / 2.0 + m_, 0.58 * c["depthM"] + m_, 0.42 * c["depthM"] + m_
            hit = 0.0
            hr = c["handleRadiusM"] + m_
            for p in avoid:
                d = p - toe
                z = d.dot(axis)
                if z < 0.0 or z > c["totalM"]:
                    continue
                if z > c["bladeM"]:
                    # The handle: a cylinder of its radius plus 3 mm.
                    rr = (d - axis * z).length
                    if rr < hr:
                        hit = max(hit, hr - rr)
                    continue
                x = abs(d.dot(sd_ax))
                y = d.dot(-fc)
                if x < hw and -yf < y < yb:
                    hit = max(hit, min(hw - x, y + yf, yb - y))
            score += 400.0 * hit
        return (score, toe, top, worst_pen, worst_gap, near)

    tilt_deg = (0.0, 0.0)
    if tilt:
        coarse_pts = {side: pts_[::3] for side, pts_ in hands.items()}
        h1 = bat_axis.cross(Vector((0, 0, 1))).normalized()
        h2 = Vector((0, 0, 1)).cross(h1).normalized()
        steps = [-c.get("tiltMaxDeg", 6.0) + k * c.get("tiltStepDeg", 2.0)
                 for k in range(int(round(2 * c.get("tiltMaxDeg", 6.0) / c.get("tiltStepDeg", 2.0))) + 1)]
        coarse = None
        for a in steps:
            for b in steps:
                axis = (Matrix.Rotation(math.radians(a), 3, h1) @ Matrix.Rotation(math.radians(b), 3, h2) @
                        bat_axis).normalized()
                cand = evaluate(axis, range(-5, 6), 0.006, pts=coarse_pts)
                # A small preference for the least tilt among equal seats.
                cand = (cand[0] + 0.0005 * (abs(a) + abs(b)),) + cand[1:]
                if coarse is None or cand[0] < coarse[0][0]:
                    coarse = (cand, axis, (a, b))
        bat_axis = coarse[1]
        tilt_deg = coarse[2]
        ci, cj = coarse[0][6]
        best = evaluate(bat_axis, range(-3, 4), 0.003, centre=(2 * ci, 2 * cj))
    else:
        best = evaluate(bat_axis, range(-10, 11), 0.003)
    _, toe, top, pen, gap, near, ij = best
    face_hint = Vector((1.0, -0.35, 0.0)).normalized()
    face = (face_hint - bat_axis * face_hint.dot(bat_axis)).normalized()
    side_axis = bat_axis.cross(face).normalized()
    bat.matrix_world = Matrix.Translation(toe) @ Matrix((side_axis, -face, bat_axis)).transposed().to_4x4()
    CONFIG["bat"]["toe"] = [r(x, 5) for x in toe]
    CONFIG["bat"]["top"] = [r(x, 5) for x in top]
    if tilt:
        CONFIG["bat"]["seatTiltDeg"] = [r(tilt_deg[0], 2), r(tilt_deg[1], 2)]
    update()
    log("bat seat", ij, "tilt", tilt_deg, "pen", r(pen, 5), "gap", r(gap, 5), "near", near)
    seat_bat.last = {"pen": pen, "gap": gap, "near": near, "tiltDeg": tilt_deg}
    return toe, top


# --------------------------------------------------------------------------------------------------------------------
# Idle life (A5): breathing and weight shift, sum of incommensurate sines, never a visible identical loop
# --------------------------------------------------------------------------------------------------------------------

def bake_idle(rig):
    idle = CONFIG["idle"]
    scene = bpy.context.scene
    scene.render.fps = idle["fps"]
    frames = int(idle["seconds"] * idle["fps"])
    scene.frame_start = 1
    scene.frame_end = frames
    rig.animation_data_create()
    action = bpy.data.actions.new("VANDE_stance_idle")
    rig.animation_data.action = action
    rest = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in rig.pose.bones}
    root = rig.pose.bones["root"]
    chest = rig.pose.bones["spine02"]
    neck = rig.pose.bones["neck01"]
    for f in range(1, frames + 1, idle["keyEvery"]):
        t = (f - 1) / idle["fps"]
        # weight shift: 0.6-1.4 cm, periods 4.3 s and 6.7 s; breathing: periods 3.9 s and 4.6 s, ~0.8 degrees
        sx = 0.0065 * math.sin(2 * math.pi * t / 4.3) + 0.0035 * math.sin(2 * math.pi * t / 6.7 + 1.1)
        sy = 0.0030 * math.sin(2 * math.pi * t / 5.9 + 0.4)
        sz = -0.0025 * (0.5 + 0.5 * math.sin(2 * math.pi * t / 3.9 + 0.7))
        breathe = 0.55 * math.sin(2 * math.pi * t / 3.9) + 0.25 * math.sin(2 * math.pi * t / 4.6 + 2.0)
        look = 0.6 * math.sin(2 * math.pi * t / 7.3 + 0.3)
        loc0, q0 = rest["root"]
        root.location = loc0 + Vector((sx, sy, sz))
        root.keyframe_insert("location", frame=f)
        cl, cq = rest["spine02"]
        chest.rotation_quaternion = cq @ Quaternion(Vector((1, 0, 0)), math.radians(breathe))
        chest.keyframe_insert("rotation_quaternion", frame=f)
        nl, nq = rest["neck01"]
        neck.rotation_quaternion = nq @ Quaternion(Vector((0, 0, 1)), math.radians(look))
        neck.keyframe_insert("rotation_quaternion", frame=f)
    scene.frame_set(1)
    return action, frames


def measure_idle(rig, frames):
    scene = bpy.context.scene
    hips = []
    still = 0
    longest = 0
    prev = None
    for f in range(1, frames + 1):
        scene.frame_set(f)
        p = world_head(rig, "root")
        hips.append(p)
        if prev is not None:
            moved = (p - prev).length
            still = still + 1 if moved < 0.00005 else 0
            longest = max(longest, still)
        prev = p
    scene.frame_set(1)
    span = {k: max(getattr(h, k) for h in hips) - min(getattr(h, k) for h in hips) for k in "xyz"}
    horiz = max(((a - b).xy.length for a in hips[::30] for b in hips[::30]))
    return {"hipsRangeM": {k: r(v, 5) for k, v in span.items()}, "maxHorizontalShiftM": r(horiz, 5),
            "longestStillS": r(longest / CONFIG["idle"]["fps"], 4),
            "periodsS": [3.9, 4.3, 4.6, 5.9, 6.7, 7.3], "loopSeconds": CONFIG["idle"]["seconds"]}


# --------------------------------------------------------------------------------------------------------------------
# Measurements (§7-A)
# --------------------------------------------------------------------------------------------------------------------

def unclothed_points(body):
    """Evaluated body with clothing delete-masks off (MPFB's 'Hide helpers' stays on): the whole skin surface."""
    masks = [m for m in body.modifiers if m.type == "MASK" and m.name != "Hide helpers" and m.show_viewport]
    for m in masks:
        m.show_viewport = False
    try:
        return evaluated_points(body)
    finally:
        for m in masks:
            m.show_viewport = True


def t_pose_span(rig, body):
    """Arm span: straighten each arm chain along ±x (a T-pose) and measure fingertip to fingertip on the mesh."""
    chain = ["upperarm01", "upperarm02", "lowerarm01", "lowerarm02", "wrist", "metacarpal3", "finger3-1",
             "finger3-2", "finger3-3"]
    saved = {pb.name: pb.matrix_basis.copy() for pb in rig.pose.bones}
    for side, sign in (("L", 1.0), ("R", -1.0)):
        for n in chain:
            name = "%s.%s" % (n, side)
            if name not in rig.pose.bones:
                continue
            pb = rig.pose.bones[name]
            cur = (pb.tail - pb.head).normalized()
            q = cur.rotation_difference(Vector((sign, 0.0, 0.0)))
            axis, angle = q.to_axis_angle()
            if angle > 1e-5:
                rotate_world(rig, name, axis, math.degrees(angle))
    pts = unclothed_points(body)
    span = max(p.x for p in pts) - min(p.x for p in pts)
    reach = {}
    for side in ("L", "R"):
        palm = (world_head(rig, "wrist." + side) + world_head(rig, "finger3-1." + side)) / 2.0
        reach[side] = (palm - world_head(rig, "upperarm01." + side)).length
    t_pose_span.reach = reach
    for pb in rig.pose.bones:
        pb.matrix_basis = saved[pb.name]
    update()
    return span


def a1_proportions(rig, body):
    pts_all = unclothed_points(body)
    zmin, zmax = min(p.z for p in pts_all), max(p.z for p in pts_all)
    stature = zmax - zmin
    head = world_head(rig, "head")
    jaw_tail = world_tail(rig, "jaw")
    # Head height: vertex (top of skull) to the chin (lowest point of the head/jaw-weighted front vertices).
    names = {"head", "jaw"}
    idx = {g.index for g in body.vertex_groups if g.name in names}
    sel = [v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in idx) > 0.95]
    helper = body.vertex_groups.get("body")
    if helper is not None:
        in_body = {v.index for v in body.data.vertices for g in v.groups if g.group == helper.index and g.weight > 0.5}
        sel = [i for i in sel if i in in_body]
    head_pts = evaluated_points(body, sel)
    chin = min(p.z for p in head_pts) if head_pts else jaw_tail.z
    head_h = zmax - chin
    # Arm span along the rest chain (T-pose equivalent): fingertip L ... fingertip R through the shoulders.
    def chain(side):
        seq = ["clavicle", "shoulder01", "upperarm01", "upperarm02", "lowerarm01", "lowerarm02", "wrist",
               "metacarpal2", "finger3-1", "finger3-2", "finger3-3"]
        total = 0.0
        for n in seq:
            pb = rig.pose.bones["%s.%s" % (n, side)]
            total += (pb.tail - pb.head).length
        return total
    chain_span = chain("L") + chain("R") + (world_head(rig, "clavicle.L") - world_head(rig, "clavicle.R")).length
    span = t_pose_span(rig, body)
    hip = (world_head(rig, "upperleg01.L").z + world_head(rig, "upperleg01.R").z) / 2.0 - zmin
    hand_length = {side: (rig.data.bones["finger3-3." + side].tail_local -
                          rig.data.bones["wrist." + side].head_local).length for side in ("L", "R")}
    return {"statureM": r(stature, 4), "headHeightM": r(head_h, 4), "headFractionOfStature": r(head_h / stature, 4),
            "armSpanTPoseM": r(span, 4), "armSpanOverStature": r(span / stature, 4),
            "armChainLengthM": r(chain_span, 4),
            "armShoulderToPalmM": {k: r(v, 4) for k, v in t_pose_span.reach.items()},
            "wristToMiddleFingertipM": {k: r(v, 4) for k, v in hand_length.items()},
            "handLengthOverStature": {k: r(v / stature, 4) for k, v in hand_length.items()},
            "reachRequirement": "physics plans the lower hand with 0.57 m usable reach (the 0.591 m shoulder-to-wrist "
                                "chain, 0.186 H + 0.146 H, minus a 20 mm elbow reserve): needs the rest-pose chain "
                                "upperarm01 head -> lowerarm01 head -> wrist head >= 0.591 m. Shoulder-to-palm is "
                                "informational only (the r1 report used it in error).",
            "armShoulderToWristChainM": r(arm_chain(rig), 4),
            "reachMeetsPhysics": arm_chain(rig) >= 0.591,
            "hipJointHeightOverStature": r(hip / stature, 4),
            "method": "rest pose; evaluated skin with clothing masks off and MakeHuman helpers hidden; head = skull top "
                      "to the lowest head/jaw-weighted vertex; arm span = fingertip-to-fingertip x extent with both arm "
                      "chains straightened along x (T-pose); hip = hip-joint height / stature"}


def bvh_of(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(obj.matrix_world)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    ev.to_mesh_clear()
    return tree


def inside_closed(tree, p):
    """Ray-parity inside test against a closed surface (three axis rays must agree)."""
    votes = 0
    for direction in (Vector((0.0, 0.0, 1.0)), Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0))):
        hits = 0
        origin = p.copy()
        for _ in range(64):
            loc, _, _, _ = tree.ray_cast(origin, direction)
            if loc is None:
                break
            hits += 1
            origin = loc + direction * 1e-5
        votes += hits % 2
    return votes >= 2


def penetration(points, tree, closed=False):
    """Max depth of points inside `tree`. Closed surfaces use ray parity; open ones (garments, the masked body) use
    the nearest-face normal and are indicative only."""
    worst = 0.0
    count = 0
    for p in points:
        loc, normal, _, dist = tree.find_nearest(p)
        if loc is None:
            continue
        if not closed and dist > 0.03:
            continue  # an open garment or card: only a local surface can be "entered"
        inside = inside_closed(tree, p) if closed else (p - loc).dot(normal) < 0
        if inside:
            count += 1
            worst = max(worst, dist)
    return worst, count


# Winter (2009) segment mass fractions and centre-of-mass positions from the proximal end.
SEGMENTS = [("head", "head", None, 0.5, 0.081), ("trunk", "pelvis_mid", "neck01", 0.5, 0.497)] + [
    seg for side in ("L", "R") for seg in (
        ("upperarm." + side, "upperarm01." + side, "lowerarm01." + side, 0.436, 0.028),
        ("forearm." + side, "lowerarm01." + side, "wrist." + side, 0.430, 0.016),
        ("hand." + side, "wrist." + side, "metacarpal3." + side, 0.506, 0.006),
        ("thigh." + side, "upperleg01." + side, "lowerleg01." + side, 0.433, 0.100),
        ("shank." + side, "lowerleg01." + side, "foot." + side, 0.433, 0.0465),
        ("foot." + side, "foot." + side, None, 0.5, 0.0145))]


def stance_metrics(rig, roll=None, yaw=None, gaze=None):
    """The stance against A2 as amended by wedge §6.3 (feet 0.40-0.60 m, knees 20-45°, head roll <= 5°, eyes level
    and facing the bowler) and COVER-DRIVE-SPEC §1 (feet 0.46-0.60 m, knees 30-50°, thorax forward 31-49°, centre of
    mass 57-64% of the base from the back foot, pelvis and shoulders about 20° open from side-on)."""
    def point(name, tail=False):
        if name == "pelvis_mid":
            return (world_head(rig, "upperleg01.L") + world_head(rig, "upperleg01.R")) / 2.0
        return world_tail(rig, name) if tail else world_head(rig, name)
    com = Vector()
    for _, a, b, frac, mass in SEGMENTS:
        pa = point(a)
        pb_ = point(b) if b else point(a, tail=True)
        com += (pa + (pb_ - pa) * frac) * mass
    com /= sum(s[4] for s in SEGMENTS)
    back, front = world_head(rig, "foot.R"), world_head(rig, "foot.L")
    base = (front - back).xy
    frac = (com - back).xy.dot(base) / base.length_squared
    hips = (world_head(rig, "upperleg01.L") - world_head(rig, "upperleg01.R")).xy
    shoulders = (world_head(rig, "upperarm01.L") - world_head(rig, "upperarm01.R")).xy
    thorax = world_head(rig, "neck01") - world_head(rig, "spine03")
    return {"ankleSeparationM": r(base.length, 4),
            "kneeFlexDeg": {"front": r(flexion(rig, "upperleg01.L", "lowerleg01.L", "foot.L"), 2),
                            "back": r(flexion(rig, "upperleg01.R", "lowerleg01.R", "foot.R"), 2)},
            "thoraxPitchDeg": r(math.degrees(thorax.angle(Vector((0, 0, 1)))), 2),
            "centreOfMassFractionOfBaseFromBack": r(frac, 3),
            "centreOfMassHeightM": r(com.z, 4),
            "pelvisOpenFromSideOnDeg": r(math.degrees(math.atan2(abs(hips.y), hips.x)), 2),
            "shouldersOpenFromSideOnDeg": r(math.degrees(math.atan2(abs(shoulders.y), shoulders.x)), 2),
            "shoulderHeightsM": {"front": r(world_head(rig, "upperarm01.L").z, 4),
                                 "back": r(world_head(rig, "upperarm01.R").z, 4)},
            "headRollDeg": r(roll, 2) if roll is not None else None,
            "faceYawFromBowlerLineDeg": r(yaw, 2) if yaw is not None else None,
            "gazePitchDeg": r(gaze, 2) if gaze is not None else None,
            "method": "bone joints in the posed rig; centre of mass from Winter's segment fractions; base = back "
                      "ankle to front ankle in plan; open = plan angle of the hip (shoulder) joint line from the "
                      "bowler line (0 = fully side-on)"}


def measure_stance(rig, body, bat, grip, top, bat_axis, roll, yaw):
    st = {}
    la, ra = world_head(rig, "foot.L"), world_head(rig, "foot.R")
    st["ankleSeparationM"] = r((la - ra).xy.length, 4)
    st["kneeFlexDeg"] = {"front": r(flexion(rig, "upperleg01.L", "lowerleg01.L", "foot.L"), 2),
                         "back": r(flexion(rig, "upperleg01.R", "lowerleg01.R", "foot.R"), 2)}
    st["headRollDeg"] = r(roll, 2)
    st["faceYawFromBowlerLineDeg"] = r(yaw, 2)
    st["gazePitchDeg"] = r(getattr(pose_head, "gaze_pitch", None), 2)
    st["batToeHeightM"] = r(min(p.z for p in evaluated_points(bat)), 4)
    st["batToeToBackAnkleM"] = r((Vector(CONFIG["bat"]["toe"]) - ra).xy.length, 4)
    # A3: hands on the handle.
    hands = {}
    radius = CONFIG["bat"]["handleRadiusM"]
    for side in ("L", "R"):
        verts = hand_vertices(body, rig, side)
        pts = evaluated_points(body, verts)
        dists = [handle_distance(p, top, bat_axis, radius) for p in pts]
        close = [(s, a) for s, a in dists if s < 0.006 and -0.01 <= a <= CONFIG["bat"]["totalM"] - CONFIG["bat"]["bladeM"]]
        tips = {}
        for finger in ("finger2", "finger3", "finger4", "finger5", "finger1"):
            tip = world_tail(rig, "%s-3.%s" % (finger, side))
            tips[finger] = r(handle_distance(tip, top, bat_axis, radius)[0], 4)
        hands[side + "_fingertipToHandleM"] = tips
        hands[side + "_digitGapM"] = digit_gaps(rig, body, side, top, bat_axis, radius)
        hands[side] = {"minGapM": r(min(s for s, _ in dists), 5),
                       "deepestPenetrationM": r(max(0.0, -min(s for s, _ in dists)), 5),
                       "contactVertices": len(close),
                       "contactSpanAlongHandleM": [r(min(a for _, a in close), 4), r(max(a for _, a in close), 4)] if close else None}
    if hands["L"]["contactSpanAlongHandleM"] and hands["R"]["contactSpanAlongHandleM"]:
        gap = hands["R"]["contactSpanAlongHandleM"][0] - hands["L"]["contactSpanAlongHandleM"][1]
        hands["topHandAboveBottom"] = hands["L"]["contactSpanAlongHandleM"][0] < hands["R"]["contactSpanAlongHandleM"][0]
        hands["handSeparationAlongHandleM"] = r(gap, 4)
    st["grip"] = hands
    st["gripSearch"] = grip
    # A4: bat into body/clothes; hand vertices into the bat.
    bat_tree = bvh_of(bat)
    clothes = [o for o in bpy.data.objects if o.type == "MESH" and
               ("cricket_kit" in o.name.lower() or "shoes" in o.name.lower())]
    body_tree = bvh_of(body)
    st["interpenetration"] = {}
    bat_pts = evaluated_points(bat)
    for name, tree in [("body", body_tree)] + [(o.name, bvh_of(o)) for o in clothes]:
        depth, count = penetration(bat_pts, tree)
        st["interpenetration"]["bat_into_" + name] = {"maxDepthM": r(depth, 5), "vertices": count}
    for side in ("L", "R"):
        depth, count = penetration(evaluated_points(body, hand_vertices(body, rig, side)), bat_tree, closed=True)
        st["interpenetration"]["hand%s_into_bat" % side] = {"maxDepthM": r(depth, 5), "vertices": count,
                                                            "method": "ray parity against the closed bat"}
    st["interpenetration"]["note"] = ("bat-into-body and bat-into-garment use the nearest-face normal on open "
                                      "surfaces and are indicative only")
    return st


# --------------------------------------------------------------------------------------------------------------------


# --------------------------------------------------------------------------------------------------------------------
# P2 r2: variant B (narrower shoulders), finger-by-finger closing, left-hander mirror, gear and eye refit, A4 with gear
# --------------------------------------------------------------------------------------------------------------------

def target_path(LocationService, folder, name):
    return os.path.join(LocationService.get_mpfb_data("targets"), folder, name + ".target.gz")


def probe_span(HumanService, TargetService, LocationService, macro, shoulder_weight, upper_arm_weight=0.0,
               torso_weight=0.0, hand_weight=0.0):
    """Body + rig only (no clothes): T-pose arm span, shoulder-to-palm reach and stature for one shoulder weight."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    TargetService.load_target(body, target_path(LocationService, "arms", "measure-lowerarm-length-incr"),
                              weight=CONFIG["lowerArmLengthTarget"])
    if upper_arm_weight > 0:
        TargetService.load_target(body, target_path(LocationService, "arms", "measure-upperarm-length-incr"),
                                  weight=upper_arm_weight)
    if shoulder_weight > 0:
        TargetService.load_target(body, target_path(LocationService, "torso", "measure-shoulder-dist-decr"),
                                  weight=shoulder_weight)
    if torso_weight > 0:
        TargetService.load_target(body, target_path(LocationService, "torso", "torso-scale-horiz-decr"),
                                  weight=torso_weight)
    if hand_weight > 0:
        for side in ("l", "r"):
            TargetService.load_target(body, target_path(LocationService, "hands", side + "-hand-scale-decr"),
                                      weight=hand_weight)
    update()
    rig = HumanService.add_builtin_rig(body, "default", import_weights=True)
    rig.matrix_world = Matrix.Identity(4)
    update()
    pts = unclothed_points(body)
    stature = max(p.z for p in pts) - min(p.z for p in pts)
    span = t_pose_span(rig, body)
    reach = min(t_pose_span.reach.values())
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    return span, reach, stature


def arm_chain(rig):
    b = rig.data.bones
    sh, el, wr = b["upperarm01.L"].head_local, b["lowerarm01.L"].head_local, b["wrist.L"].head_local
    return (el - sh).length + (wr - el).length


def probe_chain(HumanService, TargetService, LocationService, macro, upper_weight):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    TargetService.load_target(body, target_path(LocationService, "arms", "measure-lowerarm-length-incr"),
                              weight=CONFIG["lowerArmLengthTarget"])
    if upper_weight > 0:
        TargetService.load_target(body, target_path(LocationService, "arms", "measure-upperarm-length-incr"),
                                  weight=upper_weight)
    update()
    rig = HumanService.add_builtin_rig(body, "default", import_weights=True)
    chain = arm_chain(rig)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    return chain


def solve_arm_chain(HumanService, TargetService, LocationService, macro):
    goal = (CONFIG["variantD"]["chainTargetM"] if CONFIG["variant"] == "D"
            else CONFIG["variantC"]["chainTargetM"])
    trace = []
    c0 = probe_chain(HumanService, TargetService, LocationService, macro, 0.0)
    c1 = probe_chain(HumanService, TargetService, LocationService, macro, 1.0)
    trace += [{"upperArmWeight": 0.0, "chainM": r(c0, 4)}, {"upperArmWeight": 1.0, "chainM": r(c1, 4)}]
    if c1 < goal:
        log("variant C: the full upper-arm target cannot reach the chain goal", trace)
        return 1.0, trace
    lo, hi = 0.0, 1.0
    for _ in range(10):
        w = (lo + hi) / 2.0
        c = probe_chain(HumanService, TargetService, LocationService, macro, w)
        trace.append({"upperArmWeight": r(w, 5), "chainM": r(c, 4)})
        if c < goal:
            lo = w
        else:
            hi = w
    log("variant C upper-arm weight", r(hi, 5))
    return hi, trace


def solve_shoulders(HumanService, TargetService, LocationService, macro, upper_arm_weight=0.0):
    """Smallest shoulder-narrowing weight that brings the span to the target ratio (bisection, deterministic)."""
    goal = (CONFIG["variantD"]["spanTargetOverStature"] if CONFIG["variant"] == "D"
            else CONFIG["variantB"]["spanTargetOverStature"])
    span0, reach0, stature0 = probe_span(HumanService, TargetService, LocationService, macro, 0.0, upper_arm_weight)
    lo, hi = 0.0, 1.0
    trace = [{"weight": 0.0, "spanOverStature": r(span0 / stature0, 4), "reachM": r(reach0, 4)}]
    span1, reach1, stature1 = probe_span(HumanService, TargetService, LocationService, macro, 1.0, upper_arm_weight)
    trace.append({"weight": 1.0, "spanOverStature": r(span1 / stature1, 4), "reachM": r(reach1, 4)})
    if span1 / stature1 > goal:
        log("variant B: full shoulder target cannot reach the span goal", trace)
        return 1.0, trace
    for _ in range(10):
        w = (lo + hi) / 2.0
        span, reach, stature = probe_span(HumanService, TargetService, LocationService, macro, w, upper_arm_weight)
        trace.append({"weight": r(w, 5), "spanOverStature": r(span / stature, 4), "reachM": r(reach, 4)})
        if span / stature > goal:
            lo = w
        else:
            hi = w
    log("variant B shoulder weight", r(hi, 5))
    return hi, trace


def solve_torso_width(HumanService, TargetService, LocationService, macro, shoulder_weight, upper_arm_weight):
    """Use the CC0 horizontal torso target only if the shoulder-distance target cannot admit variant D."""
    goal = CONFIG["variantD"]["spanTargetOverStature"]
    lo, hi = 0.0, 1.0
    trace = []
    for weight in (0.0, 1.0):
        span, reach, stature = probe_span(HumanService, TargetService, LocationService, macro, shoulder_weight,
                                         upper_arm_weight, weight)
        trace.append({"weight": weight, "spanOverStature": r(span / stature, 4), "reachM": r(reach, 4)})
    if trace[-1]["spanOverStature"] > goal:
        log("variant D: full horizontal torso target cannot reach the span goal", trace)
        return 1.0, trace
    for _ in range(10):
        weight = (lo + hi) * 0.5
        span, reach, stature = probe_span(HumanService, TargetService, LocationService, macro, shoulder_weight,
                                         upper_arm_weight, weight)
        trace.append({"weight": r(weight, 5), "spanOverStature": r(span / stature, 4), "reachM": r(reach, 4)})
        if span / stature > goal:
            lo = weight
        else:
            hi = weight
    log("variant D horizontal torso weight", r(hi, 5))
    return hi, trace


def solve_hand_scale(HumanService, TargetService, LocationService, macro, shoulder_weight, upper_arm_weight,
                     torso_weight):
    """Finish span admission with the symmetric CC0 hand-scale target while leaving shoulder-to-wrist unchanged."""
    goal = CONFIG["variantD"]["spanTargetOverStature"]
    lo, hi = 0.0, 1.0
    trace = []
    for weight in (0.0, 1.0):
        span, reach, stature = probe_span(HumanService, TargetService, LocationService, macro, shoulder_weight,
                                         upper_arm_weight, torso_weight, weight)
        trace.append({"weight": weight, "spanOverStature": r(span / stature, 4), "reachM": r(reach, 4)})
    if trace[-1]["spanOverStature"] > goal:
        log("variant D: full symmetric hand-scale target cannot reach the span goal", trace)
        return 1.0, trace
    for _ in range(10):
        weight = (lo + hi) * 0.5
        span, reach, stature = probe_span(HumanService, TargetService, LocationService, macro, shoulder_weight,
                                         upper_arm_weight, torso_weight, weight)
        trace.append({"weight": r(weight, 5), "spanOverStature": r(span / stature, 4), "reachM": r(reach, 4)})
        if span / stature > goal:
            lo = weight
        else:
            hi = weight
    log("variant D symmetric hand-scale weight", r(hi, 5))
    return hi, trace


def segment_vertices(body, side):
    names = {"%s-%d.%s" % (d, k, side) for d in ("finger1", "finger2", "finger3", "finger4", "finger5")
             for k in (1, 2, 3)}
    idx = {g.index: g.name for g in body.vertex_groups if g.name in names}
    helper = body.vertex_groups.get("body")
    out = {n: [] for n in names}
    for v in body.data.vertices:
        if helper is not None and not any(g.group == helper.index and g.weight > 0.5 for g in v.groups):
            continue
        best = None
        for g in v.groups:
            if g.group in idx and (best is None or g.weight > best[1]):
                best = (idx[g.group], g.weight)
        if best is not None and best[1] > 0.4:
            out[best[0]].append(v.index)
    return out


def gaps(body, groups, top, axis, radius):
    """Min signed handle distance per vertex group, from one evaluation."""
    allidx = sorted({i for g in groups.values() for i in g})
    if not allidx:
        return {k: 1.0 for k in groups}
    pts = dict(zip(allidx, evaluated_points(body, allidx)))
    return {k: (min(handle_distance(pts[i], top, axis, radius)[0] for i in v) if v else 1.0)
            for k, v in groups.items()}


SEGMENT_CAP_DEG = {1: 90.0, 2: 100.0, 3: 80.0}
THUMB_CAP_DEG = {1: 45.0, 2: 60.0, 3: 70.0}


def flex_axis(rig, side, digit, name):
    """Anatomical flexion axis (world) and the sign that moves the segment tip towards the palm."""
    direction, normal = hand_frame(rig, side)
    across = (world_head(rig, "finger2-1." + side) - world_head(rig, "finger5-1." + side)).normalized()
    if digit == "finger1":
        seg = (world_tail(rig, name) - world_head(rig, name)).normalized()
        axis = seg.cross(normal).normalized()
    else:
        axis = across
    pb = rig.pose.bones[name]
    head, tail = pb.head.copy(), pb.tail.copy()
    rot = Matrix.Rotation(math.radians(2.0), 3, axis)
    moved = head + rot @ (tail - head)
    sign = 1.0 if (moved - tail).dot(normal) > 0 else -1.0
    return axis, sign


def thumb_axis(rig, side, name, top, axis, radius):
    """The thumb opposes the fingers, so its closing axis is probed: of its two anatomical candidates (across the
    palm normal, and the knuckle line), each way, the one that brings the thumb tip towards the handle."""
    direction, normal = hand_frame(rig, side)
    across = (world_head(rig, "finger2-1." + side) - world_head(rig, "finger5-1." + side)).normalized()
    seg = (world_tail(rig, name) - world_head(rig, name)).normalized()
    tip = "finger1-3." + side
    best = None
    for cand in (seg.cross(normal).normalized(), across):
        for sign in (1.0, -1.0):
            rotate_world(rig, name, cand, sign * 6.0)
            d = segment_gap(rig, tip, top, axis, radius)
            rotate_world(rig, name, cand, -sign * 6.0)
            if best is None or d < best[0]:
                best = (d, cand, sign)
    return best[1], best[2]


def segment_gap(rig, name, top, axis, radius, finger_r=0.0085):
    """Bone-geometry stand-in for a finger segment's skin gap to the handle (segment line minus a finger radius)."""
    a, b = world_head(rig, name), world_tail(rig, name)
    return min(handle_distance(a + (b - a) * t, top, axis, radius)[0] for t in (0.0, 0.33, 0.66, 1.0)) - finger_r


def cheap_close(rig, side, top, axis, radius):
    """Fast closing on bone geometry (used to score hand orientations); returns the summed residual gaps."""
    c = CONFIG["closing"]
    total = 0.0
    worst_pen = 0.0
    for digit in ("finger2", "finger3", "finger4", "finger5", "finger1"):
        for k in (1, 2, 3):
            name = "%s-%d.%s" % (digit, k, side)
            ax, sign = flex_axis(rig, side, digit, name)
            cap = (THUMB_CAP_DEG if digit == "finger1" else SEGMENT_CAP_DEG)[k]
            chain = ["%s-%d.%s" % (digit, j, side) for j in range(k, 4)]
            angle = 0.0
            while angle + c["stepDeg"] <= cap and segment_gap(rig, name, top, axis, radius) > c["contactM"]:
                rotate_world(rig, name, ax, sign * c["stepDeg"])
                if min(segment_gap(rig, n, top, axis, radius) for n in chain) < -c["penetrationLimitM"]:
                    rotate_world(rig, name, ax, -sign * c["stepDeg"])
                    break
                angle += c["stepDeg"]
        for k in (2, 3):
            g = segment_gap(rig, "%s-%d.%s" % (digit, k, side), top, axis, radius)
            total += max(0.0, g)
            worst_pen = max(worst_pen, -g)
    return total, worst_pen


def close_fingers(rig, body, side, top, axis, radius, contact_sets=None,
                  digits=("finger2", "finger3", "finger4", "finger5", "finger1")):
    """Key each finger segment, proximal to distal, about its anatomical flexion axis (the knuckle line; the thumb's
    own axis across the palm normal), towards the palm, until its own surface touches the handle (gap <= contactM),
    never letting the finger go through (penetration > penetrationLimitM) and never past an anatomical cap.
    contact_sets: optional {segment bone: [vertex ids]} on another mesh (the gloves) to use as the touching surface;
    then `body` is that mesh."""
    c = CONFIG["closing"]
    segv = contact_sets if contact_sets is not None else segment_vertices(body, side)
    report = {}
    for digit in digits:
        for k in (1, 2, 3):
            name = "%s-%d.%s" % (digit, k, side)
            own = segv.get(name, [])
            distal = [i for j in range(k, 4) for i in segv.get("%s-%d.%s" % (digit, j, side), [])]
            if not distal:
                continue
            if not own:
                own = distal
            ax, sign = flex_axis(rig, side, digit, name)
            if digit == "finger1":
                ax, sign = thumb_axis(rig, side, name, top, axis, radius)
            cap = (THUMB_CAP_DEG if digit == "finger1" else SEGMENT_CAP_DEG)[k]
            g = gaps(body, {"own": own, "all": distal}, top, axis, radius)
            angle = 0.0
            # A segment that starts inside the handle is first opened (extended) until it is clear: no finger through.
            opened = 0.0
            while g["all"] < -c["penetrationLimitM"] and opened < 30.0:
                rotate_world(rig, name, ax, -sign * c["stepDeg"])
                opened += c["stepDeg"]
                g = gaps(body, {"own": own, "all": distal}, top, axis, radius)
            angle = -opened
            stop = "cap"
            if g["own"] <= c["contactM"]:
                stop = "already in contact" if opened == 0.0 else "opened clear, in contact"
            while stop == "cap" and angle + c["stepDeg"] <= cap:
                rotate_world(rig, name, ax, sign * c["stepDeg"])
                g2 = gaps(body, {"own": own, "all": distal}, top, axis, radius)
                if g2["all"] < -c["penetrationLimitM"]:
                    rotate_world(rig, name, ax, -sign * c["stepDeg"])
                    stop = "would penetrate"
                    break
                angle += c["stepDeg"]
                g = g2
                if g["own"] <= c["contactM"]:
                    stop = "contact"
                    break
            report[name] = {"deg": r(angle, 1), "stop": stop, "ownGapM": r(g["own"], 4), "fingerMinGapM": r(g["all"], 4)}
    return report


def digit_gaps(rig, body, side, top, axis, radius):
    segv = segment_vertices(body, side)
    groups = {}
    for digit in ("finger1", "finger2", "finger3", "finger4", "finger5"):
        groups[digit] = [i for k in (2, 3) for i in segv.get("%s-%d.%s" % (digit, k, side), [])]
    return {k: r(v, 4) for k, v in gaps(body, groups, top, axis, radius).items()}


# ---- left-hander -------------------------------------------------------------------------------------------------

def mirror_table(LocationService):
    pairs = {}
    with open(os.path.join(LocationService.get_mpfb_data("mesh_metadata"), "hm08.mirror")) as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2:
                a, b = int(parts[0]), int(parts[1])
                pairs[a] = b
                pairs.setdefault(b, a)
    return pairs


def bones_parent_first(rig):
    out = []
    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)
    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    return out


def flip_to_left(rig):
    """Mirror the posed armature for a left-hander: each bone takes its partner's pose reflected through the
    character's sagittal plane, then the character turns 180° about z. Net effect: the world mirror y -> -y."""
    S = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))
    posed = {pb.name: pb.matrix.copy() for pb in rig.pose.bones}
    basis = {pb.name: pb.matrix_basis.copy() for pb in rig.pose.bones}
    for name in bones_parent_first(rig):
        partner = name
        if name.endswith(".L"):
            partner = name[:-2] + ".R"
        elif name.endswith(".R"):
            partner = name[:-2] + ".L"
        rig.pose.bones[name].matrix = S @ posed[partner] @ S
        update()
    rig.matrix_world = Matrix.Rotation(math.pi, 4, "Z")
    update()
    return basis


def restore_right(rig, basis):
    rig.matrix_world = Matrix.Identity(4)
    for pb in rig.pose.bones:
        pb.matrix_basis = basis[pb.name]
    update()


def left_hander(rig, body, bat, LocationService, out):
    """Build the left-hander from the right-hander's stance and verify it is the exact mirror. Saves hero-left.blend."""
    D = Matrix.Diagonal((1.0, -1.0, 1.0, 1.0))
    pairs = mirror_table(LocationService)
    n = len(body.data.vertices)
    rh_body = evaluated_points(body, list(range(n)))
    others = [o for o in bpy.data.objects if o.type == "MESH" and o not in (body, bat) and
              not o.name.startswith("VANDE_gearL1")]
    rh_other = {o.name: [D @ p for p in evaluated_points(o)] for o in others}
    # The bat follows the right wrist: capture its right-hander transform BEFORE the flip moves the wrist.
    bat_world = bat.matrix_world.copy()
    bat_parent = (bat.parent, bat.parent_type, bat.parent_bone)
    basis = flip_to_left(rig)
    lh_body = evaluated_points(body, list(range(n)))
    errs = []
    worst = {}
    helper = body.vertex_groups.get("body")
    names = {g.index: g.name for g in body.vertex_groups}
    for i in range(n):
        j = pairs.get(i)
        if j is None:
            continue
        v = body.data.vertices[i]
        if helper is not None and not any(g.group == helper.index and g.weight > 0.5 for g in v.groups):
            continue
        e = (lh_body[i] - (D @ rh_body[j])).length
        errs.append(e)
        if e > 0.005:
            dom = max((g for g in v.groups if names.get(g.group) in V3_BONE_NAMES), key=lambda g: g.weight, default=None)
            key = names[dom.group] if dom is not None else "?"
            worst[key] = max(worst.get(key, 0.0), e)
    errs.sort()
    other = {}
    for o in others:
        pts = rh_other[o.name]
        tree = KDTree(len(pts))
        for k, p in enumerate(pts):
            tree.insert(p, k)
        tree.balance()
        lh = evaluated_points(o)
        d = sorted(tree.find(p)[2] for p in lh)
        other[o.name] = {"maxNearestM": r(d[-1], 5), "p95NearestM": r(d[int(0.95 * (len(d) - 1))], 5)}
    # The bat is not on the left wrist bone in this file: mirror the right-hander's bat in world space.
    bat.parent = None
    bat.matrix_world = D @ bat_world
    update()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "hero-left.blend"), compress=True, copy=True)
    restore_right(rig, basis)
    # Back to the right-hander: re-parent the bat to the right wrist at its original world transform.
    parent, ptype, pbone = bat_parent
    if parent is not None:
        bat.parent = parent
        bat.parent_type = ptype
        bat.parent_bone = pbone
        update()
    bat.matrix_world = bat_world
    update()
    result = {
        "method": "LH = each bone takes its partner's pose mirrored through the sagittal plane, then a 180° turn about "
                  "z; compared with the RH stance mirrored y -> -y. Body: exact hm08 mirror vertex pairs. Other "
                  "meshes: nearest-point distance (asymmetric garment details show up here).",
        "bodyPairs": len(errs),
        "bodyErrorsOver5mmByBone": {k: r(v, 4) for k, v in sorted(worst.items(), key=lambda kv: -kv[1])[:12]},
        "bodyMaxErrorM": r(errs[-1], 6) if errs else None,
        "bodyP95ErrorM": r(errs[int(0.95 * (len(errs) - 1))], 6) if errs else None,
        "otherMeshes": other,
    }
    log("left-hander", json.dumps(result)[:400])
    return result


# ---- gear and eyes refit -----------------------------------------------------------------------------------------

GEAR_PIECES = {"head": "helmet", "wrist.L": "glove_L", "wrist.R": "glove_R",
               "lowerleg01.L": "pad_L", "lowerleg01.R": "pad_R"}
# Gear region roles and colours read (read-only) from UNITY's
# Runtime/Presentation/Resources/VandeProductionCharacter.shader regionColour(): 4 pads, 5 gloves, 6 helmet shell,
# 7 metal grille, 13 straps, 14 helmet padding. The shader's sRGB defaults (the project is in gamma colour space) are
# converted to linear for Blender.
def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


GEAR_COLOURS = {k: srgb_to_linear(v) for k, v in {
    4: (0.90, 0.89, 0.83), 5: (0.84, 0.82, 0.76), 6: (0.035, 0.106, 0.188), 7: (0.30, 0.33, 0.37),
    13: (0.08, 0.09, 0.11), 14: (0.08, 0.075, 0.07)}.items()}
GRILLE_REGION = 7


class ProceduralGearMesh:
    """Small deterministic owner-original cricket-equipment builder in rig-local metres."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.bones = []
        self.regions = []

    def vertex(self, point, bone, region):
        self.vertices.append(tuple(point))
        self.bones.append(bone)
        self.regions.append(region)
        return len(self.vertices) - 1

    def ellipsoid(self, centre, radii, bone, region, segments=20, rings=10, theta_end=math.pi):
        base = len(self.vertices)
        for ring in range(rings + 1):
            theta = theta_end * ring / rings
            st, ct = math.sin(theta), math.cos(theta)
            for segment in range(segments):
                phi = 2.0 * math.pi * segment / segments
                p = Vector((centre.x + radii.x * st * math.cos(phi),
                            centre.y + radii.y * st * math.sin(phi),
                            centre.z + radii.z * ct))
                self.vertex(p, bone, region)
        for ring in range(rings):
            a = base + ring * segments
            b = a + segments
            for segment in range(segments):
                n = (segment + 1) % segments
                self.faces.append((a + segment, a + n, b + n, b + segment))

    def tube(self, start, end, radius, bone, region, sides=10):
        axis = end - start
        if axis.length < 1e-6:
            return
        axis.normalize()
        helper = Vector((0.0, 0.0, 1.0)) if abs(axis.z) < 0.9 else Vector((0.0, 1.0, 0.0))
        u = axis.cross(helper).normalized()
        v = axis.cross(u).normalized()
        rings = []
        for centre in (start, end):
            ring = []
            for side in range(sides):
                angle = 2.0 * math.pi * side / sides
                ring.append(self.vertex(centre + radius * (u * math.cos(angle) + v * math.sin(angle)),
                                        bone, region))
            rings.append(ring)
        for side in range(sides):
            n = (side + 1) % sides
            self.faces.append((rings[0][side], rings[0][n], rings[1][n], rings[1][side]))
        c0 = self.vertex(start, bone, region)
        c1 = self.vertex(end, bone, region)
        for side in range(sides):
            n = (side + 1) % sides
            self.faces.append((c0, rings[0][n], rings[0][side]))
            self.faces.append((c1, rings[1][side], rings[1][n]))


def procedural_cricket_gear(rig, lod):
    """Build a cricket-specific helmet, grille, gloves and pads; no downloaded geometry is used."""
    low = lod == "lod1"
    # Keep the complete gear inside the prior production triangle envelopes (L0 <= 5,996; L1 <= 2,196).
    segments, rings, sides = ((10, 5, 6) if low else (20, 10, 8))
    g = ProceduralGearMesh()
    bones = rig.data.bones

    # Helmet: rounded shell ending above the ears, proportional steel grille, padding and a chin strap.
    head = bones["head"]
    centre = head.head_local + Vector((0.0, -0.002, 0.078))
    g.ellipsoid(centre, Vector((0.108, 0.112, 0.128)), "head", 6,
                segments=segments, rings=rings, theta_end=1.92)
    front_y = centre.y - 0.122
    x_edge = 0.094
    z_levels = (centre.z - 0.004, centre.z - 0.070)
    for z in z_levels:
        # A shallow bow around the face reads as a real cage instead of a flat white fence.
        points = [Vector((x, front_y - 0.008 * (1.0 - (x / x_edge) ** 2), z))
                  for x in (-x_edge, -0.047, 0.0, 0.047, x_edge)]
        for a, b in zip(points, points[1:]):
            g.tube(a, b, 0.0028 if not low else 0.0032, "head", 7, sides=sides)
    vertical_x = (-0.070, 0.0, 0.070)
    for x in vertical_x:
        g.tube(Vector((x, front_y, centre.z + 0.025)),
               Vector((x, front_y, centre.z - 0.095)), 0.0026 if not low else 0.003, "head", 7, sides=sides)
    for sign in (-1.0, 1.0):
        g.tube(Vector((sign * x_edge, front_y, centre.z + 0.015)),
               Vector((sign * 0.105, centre.y - 0.012, centre.z - 0.002)), 0.0030, "head", 7, sides=sides)
        g.tube(Vector((sign * 0.090, centre.y - 0.010, centre.z - 0.028)),
               Vector((sign * 0.050, centre.y - 0.108, centre.z - 0.145)), 0.0038, "head", 13, sides=sides)
    g.tube(Vector((-0.078, centre.y - 0.010, centre.z - 0.018)),
           Vector((0.078, centre.y - 0.010, centre.z - 0.018)), 0.008, "head", 14, sides=sides)

    # Pads: a curved shield, raised cane rolls, knee protection and visible rear straps on both legs.
    for side in ("L", "R"):
        shin = bones["lowerleg01." + side]
        ankle = bones["foot." + side].head_local
        top = shin.head_local + Vector((0.0, -0.055, 0.055))
        bottom = ankle + Vector((0.0, -0.052, 0.055))
        mid = (top + bottom) * 0.5
        length = max(0.32, (top - bottom).length)
        g.ellipsoid(mid, Vector((0.078, 0.026, length * 0.50)), "lowerleg01." + side, 4,
                    segments=segments, rings=rings)
        for dx in (-0.043, 0.0, 0.043):
            g.tube(Vector((mid.x + dx, mid.y - 0.031, bottom.z + 0.035)),
                   Vector((mid.x + dx, mid.y - 0.031, top.z - 0.035)), 0.011,
                   "lowerleg01." + side, 4, sides=sides)
        g.ellipsoid(Vector((mid.x, mid.y - 0.020, top.z + 0.005)), Vector((0.068, 0.027, 0.052)),
                    "lowerleg01." + side, 4, segments=segments, rings=rings)
        for z in (mid.z - 0.085, mid.z + 0.085):
            g.tube(Vector((mid.x - 0.073, mid.y + 0.020, z)),
                   Vector((mid.x + 0.073, mid.y + 0.020, z)), 0.006,
                   "lowerleg01." + side, 13, sides=sides)

    # Gloves: a fitted palm/cuff plus independent padded guards for every finger segment.
    for side in ("L", "R"):
        wrist = bones["wrist." + side]
        palm_end = bones["finger3-1." + side].head_local
        palm = (wrist.head_local + palm_end) * 0.5
        g.ellipsoid(palm, Vector((0.045, 0.024, 0.052)), "wrist." + side, 5,
                    segments=segments, rings=rings)
        g.tube(wrist.head_local - Vector((0.0, 0.0, 0.025)), wrist.head_local + Vector((0.0, 0.0, 0.025)),
               0.034, "wrist." + side, 13, sides=sides)
        digits = ("finger1", "finger2", "finger3", "finger4", "finger5")
        for digit in digits:
            for index in (1, 2, 3):
                name = "%s-%d.%s" % (digit, index, side)
                bone = bones[name]
                g.tube(bone.head_local, bone.tail_local, 0.009 if digit != "finger1" else 0.008,
                       name, 5, sides=sides)

    me = bpy.data.meshes.new("VANDE_procedural_cricket_gear_" + lod)
    me.from_pydata(g.vertices, [], g.faces)
    me.update()
    for polygon in me.polygons:
        polygon.use_smooth = True
    uvl = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        point = me.vertices[loop.vertex_index].co
        uvl.data[loop.index].uv = ((point.x + 1.0) % 1.0, (point.z + 1.0) % 1.0)
    materials = {}
    for region in sorted(set(g.regions)):
        roughness = 0.30 if region == 7 else (0.48 if region == 6 else 0.62)
        materials[region] = len(me.materials)
        me.materials.append(principled("VANDE_original_gear_region_%d_%s" % (region, lod),
                                      GEAR_COLOURS[region], roughness))
    attr = me.attributes.new("vande_region", "INT", "POINT")
    for index, region in enumerate(g.regions):
        attr.data[index].value = region
    for polygon in me.polygons:
        polygon.material_index = materials[g.regions[polygon.vertices[0]]]
    obj = bpy.data.objects.new("VANDE_gear" if not low else "VANDE_gearL1", me)
    bpy.context.scene.collection.objects.link(obj)
    for index, bone in enumerate(g.bones):
        group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
        group.add([index], 1.0, "REPLACE")
    obj["vande_regions"] = json.dumps({str(k): v for k, v in materials.items()})
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    obj.parent = rig
    return obj, {"vertices": len(g.vertices), "triangles": sum(len(face) - 2 for face in g.faces),
                 "ownerOriginal": True, "recipe": "procedural-cricket-gear-v2", "lod": lod}


def build_procedural_cricket_gear(rig):
    lod0, report0 = procedural_cricket_gear(rig, "lod0")
    lod1, report1 = procedural_cricket_gear(rig, "lod1")
    update()
    return {"lod0": lod0, "lod1": lod1}, {
        "source": "VANDE-owner-original procedural geometry; no third-party model, scan, team kit or trademark",
        "licence": "VANDE-owner-original",
        "recipe": "procedural-cricket-gear-v2",
        "lod0": report0,
        "lod1": report1,
        "inputs": {},
    }


def to_blender(u):
    return Vector((u[0], -u[2], u[1]))


def to_unity(b):
    return (b.x, b.z, -b.y)


def piece_region(bone_name):
    if bone_name in ("head", "jaw", "neck03"):
        return "head"
    for side in ("L", "R"):
        if bone_name.endswith("." + side):
            if bone_name.startswith(("wrist", "metacarpal", "finger")):
                return "wrist." + side
            if bone_name.startswith("lowerleg"):
                return "lowerleg01." + side
    return None


def umeyama(a, b):
    """Similarity (s, R, t) minimising |s R a + t - b|^2 (numpy; Umeyama 1991)."""
    import numpy as np
    A = np.asarray(a, dtype=float)
    B = np.asarray(b, dtype=float)
    ma, mb = A.mean(0), B.mean(0)
    A0, B0 = A - ma, B - mb
    cov = B0.T @ A0 / len(A)
    U, S, Vt = np.linalg.svd(cov)
    d = np.ones(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        d[2] = -1
    R = U @ np.diag(d) @ Vt
    var = (A0 ** 2).sum() / len(A)
    s = float((S * d).sum() / var)
    t = mb - s * R @ ma
    res = np.sqrt((((s * (R @ A.T)).T + t - B) ** 2).sum(1).mean())
    return s, R, t, float(res)


def refit_gear(rig, body):
    """Refit the original VANDE gear (helmet, gloves, pads) from the current runtime files onto the new body.
    Each piece gets the similarity transform that best maps the current body's region (head, hand, shin) onto the
    new body's, through exact UV correspondence (both bodies are the MakeHuman hm08 mesh), then a push-out pass
    clears it from the new skin and clothes by gearClearanceM. Skin weights keep their V3 bone indices."""
    import numpy as np
    base = os.path.join(REPO, CONFIG["currentHero"])
    files = {k: os.path.join(base, f) for k, f in (("skeleton", "hero-skeleton.bytes"), ("body", "hero-lod0.bytes"),
                                                    ("gear0", "hero-gear-lod0.bytes"), ("gear1", "hero-gear-lod1.bytes"))}
    import hashlib
    provenance = {k: {"path": os.path.relpath(v, REPO), "sha256": hashlib.sha256(open(v, "rb").read()).hexdigest()}
                  for k, v in files.items()}
    old_body = vande_vpm3.read_vpm3(files["body"])
    gear = {"lod0": vande_vpm3.read_vpm3(files["gear0"]), "lod1": vande_vpm3.read_vpm3(files["gear1"])}
    # New body rest positions (Unity coordinates) keyed by UV.
    rig.data.pose_position = "REST"
    update()
    n = len(body.data.vertices)
    rest = evaluated_points(body, list(range(n)))
    rig.data.pose_position = "POSE"
    update()
    uv = body.data.uv_layers.active.data
    by_uv = {}
    for loop in body.data.loops:
        key = (round(uv[loop.index].uv.x, 4), round(uv[loop.index].uv.y, 4))
        by_uv.setdefault(key, loop.vertex_index)
    pairs = {}
    for v in old_body["vertices"]:
        key = (round(v["uv"][0], 4), round(v["uv"][1], 4))
        j = by_uv.get(key)
        if j is None:
            continue
        dom = V3_BONE_NAMES[v["bones"][max(range(4), key=lambda q: v["weights"][q])]]
        region = piece_region(dom)
        if region is None:
            continue
        pairs.setdefault(region, []).append((v["bindPos"], to_unity(rest[j])))
    transforms = {}
    for region, pr in pairs.items():
        s_, R_, t_, res = umeyama([a for a, _ in pr], [b for _, b in pr])
        transforms[region] = (s_, R_, t_)
        angle = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(R_) - 1) / 2))))
        log("gear fit", region, "pairs", len(pr), "scale", r(s_, 4), "rotDeg", r(angle, 2), "rmsM", r(res, 4))
        transforms[region + "/report"] = {"pairs": len(pr), "scale": r(s_, 5), "rotationDeg": r(angle, 3),
                                          "translationM": [r(x, 4) for x in t_], "residualRmsM": r(res, 5)}
    # Surfaces to clear (rest pose, Blender coordinates).
    rig.data.pose_position = "REST"
    update()
    surfaces = {"body": bvh_of(body)}
    for o in bpy.data.objects:
        if o.type == "MESH" and ("cricket_kit" in o.name.lower() or "shoes" in o.name.lower()):
            surfaces[o.name] = bvh_of(o)
    objects = {}
    pushes = {}
    for lod, mesh in gear.items():
        groups = {}
        for vi, v in enumerate(mesh["vertices"]):
            dom = V3_BONE_NAMES[v["bones"][max(range(4), key=lambda q: v["weights"][q])]]
            region = piece_region(dom) or dom
            groups.setdefault(region, []).append(vi)
        positions = [None] * len(mesh["vertices"])
        for region, vids in groups.items():
            s_, R_, t_ = transforms[region]
            for vi in vids:
                p = np.asarray(mesh["vertices"][vi]["bindPos"], dtype=float)
                q = s_ * (R_ @ p) + t_
                positions[vi] = to_blender(q)
        pushed = 0
        max_push = 0.0
        for vi, p in enumerate(positions):
            region = None
            dom = V3_BONE_NAMES[mesh["vertices"][vi]["bones"][0]]
            for name, tree in surfaces.items():
                loc, normal, _, dist = tree.find_nearest(p)
                if loc is None or dist > 0.05:
                    continue
                signed = (p - loc).dot(normal)
                if signed < CONFIG["gearClearanceM"]:
                    push = min(CONFIG["gearMaxPushM"], CONFIG["gearClearanceM"] - signed)
                    p = p + normal.normalized() * push
                    pushed += 1
                    max_push = max(max_push, push)
            positions[vi] = p
        pushes[lod] = {"pushedVertices": pushed, "maxPushM": r(max_push, 4)}
        me = bpy.data.meshes.new("VANDE_gear_" + lod)
        tris = [tuple(mesh["indices"][i:i + 3]) for i in range(0, len(mesh["indices"]), 3)]
        me.from_pydata([tuple(p) for p in positions], [], tris)
        me.update()
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = mesh["vertices"][me.loops[li].vertex_index]["uv"]
        mats = {}
        for region_id in sorted({v["region"] for v in mesh["vertices"]}):
            m = principled("VANDE_gear_region_%d" % region_id, GEAR_COLOURS.get(region_id, (0.8, 0.8, 0.8)), 0.55)
            mats[region_id] = len(me.materials)
            me.materials.append(m)
        for poly in me.polygons:
            poly.material_index = mats[mesh["vertices"][poly.vertices[0]]["region"]]
        obj = bpy.data.objects.new(("VANDE_gear" if lod == "lod0" else "VANDE_gearL1"), me)
        bpy.context.scene.collection.objects.link(obj)
        for vi, v in enumerate(mesh["vertices"]):
            for b, w in zip(v["bones"], v["weights"]):
                if w > 0:
                    name = V3_BONE_NAMES[b]
                    grp = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                    grp.add([vi], w / 255.0, "ADD")
        obj["vande_regions"] = json.dumps({str(k): v for k, v in mats.items()})
        attr = me.attributes.new("vande_region", "INT", "POINT")
        for vi, v in enumerate(mesh["vertices"]):
            attr.data[vi].value = v["region"]
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        obj.parent = rig
        objects[lod] = obj
    rig.data.pose_position = "POSE"
    update()
    report = {"inputs": provenance, "fits": {k: v for k, v in transforms.items() if k.endswith("/report")},
              "pushOut": pushes, "clearanceM": CONFIG["gearClearanceM"], "maxPushM": CONFIG["gearMaxPushM"],
              "vertexCounts": {k: len(v["vertices"]) for k, v in gear.items()},
              "triangleCounts": {k: len(v["indices"]) // 3 for k, v in gear.items()}}
    return objects, report


def articulate_gloves(rig, body, gear_obj):
    """Give the refitted gloves the hand's finger weights (nearest skin vertex in the rest pose, hand bones only), so
    gloved fingers follow the finger keys instead of staying a rigid wrist mitt."""
    hand_bones = {n for n in V3_BONE_NAMES if n.startswith(("wrist", "metacarpal", "finger", "lowerarm02"))}
    rig.data.pose_position = "REST"
    update()
    n = len(body.data.vertices)
    rest = evaluated_points(body, list(range(n)))
    names = {g.index: g.name for g in body.vertex_groups}
    tree = KDTree(n)
    candidates = 0
    for i, v in enumerate(body.data.vertices):
        if any(names.get(g.group) in hand_bones and g.weight > 0.3 for g in v.groups):
            tree.insert(rest[i], i)
            candidates += 1
    tree.balance()
    gpts = evaluated_points(gear_obj)
    rig.data.pose_position = "POSE"
    update()
    gnames = {g.index: g.name for g in gear_obj.vertex_groups}
    changed = 0
    for vi, v in enumerate(gear_obj.data.vertices):
        dom = max(v.groups, key=lambda g: g.weight) if v.groups else None
        if dom is None or not gnames[dom.group].startswith("wrist"):
            continue
        _, j, d = tree.find(gpts[vi])
        if j is None or d > 0.03:
            continue
        src = [(names[g.group], g.weight) for g in body.data.vertices[j].groups if names.get(g.group) in hand_bones]
        total = sum(w for _, w in src)
        if total <= 0:
            continue
        for g in list(v.groups):
            gear_obj.vertex_groups[g.group].remove([vi])
        for name, w in src:
            grp = gear_obj.vertex_groups.get(name) or gear_obj.vertex_groups.new(name=name)
            grp.add([vi], w / total, "REPLACE")
        changed += 1
    update()
    return {"gloveVerticesReweighted": changed, "handSkinCandidates": candidates}


def glove_contact_sets(gear_obj, side):
    """Glove vertices per finger segment (dominant weight), the touching surface for the gloved closing."""
    names = {g.index: g.name for g in gear_obj.vertex_groups}
    out = {}
    for v in gear_obj.data.vertices:
        if not v.groups:
            continue
        dom = max(v.groups, key=lambda g: g.weight)
        name = names[dom.group]
        if name.startswith("finger") and name.endswith("." + side):
            out.setdefault(name, []).append(v.index)
    return out


def glove_points(gear_obj, side):
    names = {g.index: g.name for g in gear_obj.vertex_groups}
    idx = [v.index for v in gear_obj.data.vertices if v.groups and
           names[max(v.groups, key=lambda g: g.weight).group].endswith("." + side) and
           names[max(v.groups, key=lambda g: g.weight).group].startswith(("wrist", "metacarpal", "finger"))]
    return idx


def a4_with_gear(rig, body, bat, gear_obj):
    """A4 with gear on, in the stance pose. Closed bat: ray parity. Open skin/garment surfaces: nearest-face normal
    (indicative). Gloves are rigid wrist mitts, so the hands inside them are by design."""
    out = {}
    gear_pts = evaluated_points(gear_obj)
    regions = {}
    for vi, v in enumerate(gear_obj.data.vertices):
        best = max(v.groups, key=lambda g: g.weight) if v.groups else None
        name = gear_obj.vertex_groups[best.group].name if best else "?"
        regions.setdefault(GEAR_PIECES.get(piece_region(name) or name, name), []).append(vi)
    bat_tree = bvh_of(bat)
    surfaces = {"body": bvh_of(body)}
    for o in bpy.data.objects:
        if o.type == "MESH" and ("cricket_kit" in o.name.lower() or "shoes" in o.name.lower()):
            surfaces[o.name] = bvh_of(o)
    for piece, vids in sorted(regions.items()):
        rec = {}
        pts = [gear_pts[i] for i in vids]
        for name, tree in surfaces.items():
            depth, count = penetration(pts, tree)
            rec["into_" + name] = {"maxDepthM": r(depth, 4), "vertices": count}
        depth, count = penetration(pts, bat_tree, closed=True)
        rec["into_bat"] = {"maxDepthM": r(depth, 4), "vertices": count}
        out[piece] = rec
    return out



# --------------------------------------------------------------------------------------------------------------------
# P2 r3: per-finger keys, hand spacing, covered-face removal and a posed push-out for the gear
# --------------------------------------------------------------------------------------------------------------------

def digit_gap(rig, body, side, digit, top, axis, radius):
    segv = segment_vertices(body, side)
    ids = [i for k in (2, 3) for i in segv.get("%s-%d.%s" % (digit, k, side), [])]
    allids = [i for k in (1, 2, 3) for i in segv.get("%s-%d.%s" % (digit, k, side), [])]
    g = gaps(body, {"d": ids, "all": allids}, top, axis, radius)
    return g["d"], g["all"]


def per_finger_keys(rig, body, side, top, axis, radius, limit=0.005):
    """For each digit still more than `limit` from the handle, key its base segment's abduction (about the palm
    normal through the knuckle, -36..+36 degrees) and re-close that digit, keeping the best contact without
    penetration. A hand-keyed per-finger pass, reproducible from this search."""
    c = CONFIG["closing"]
    report = {}
    for digit in ("finger2", "finger3", "finger4", "finger5"):
        gap, _ = digit_gap(rig, body, side, digit, top, axis, radius)
        if gap <= limit:
            continue
        names = ["%s-%d.%s" % (digit, k, side) for k in (1, 2, 3)]
        start = {n: rig.pose.bones[n].matrix_basis.copy() for n in names}
        best = (gap, None, {n: m.copy() for n, m in start.items()})
        for ang in range(-36, 37, 6):
            for n in names:
                pb = rig.pose.bones[n]
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (0.0, 0.0, 0.0)
            update()
            _, normal = hand_frame(rig, side)
            if ang:
                rotate_world(rig, names[0], normal, float(ang))
            close_fingers(rig, body, side, top, axis, radius, digits=(digit,))
            g, gall = digit_gap(rig, body, side, digit, top, axis, radius)
            if gall >= -c["penetrationLimitM"] and g < best[0]:
                best = (g, ang, {n: rig.pose.bones[n].matrix_basis.copy() for n in names})
        for n, m in best[2].items():
            rig.pose.bones[n].matrix_basis = m
        update()
        report[digit] = {"before": r(gap, 4), "after": r(best[0], 4), "abductionDeg": best[1]}
    return report


def hand_spans(rig, body, top, axis, radius):
    spans = {}
    pts = {}
    for side in ("L", "R"):
        idx = hand_vertices(body, rig, side)
        ps = evaluated_points(body, idx)
        pts[side] = ps
        along = [a for p in ps for (sd, a) in [handle_distance(p, top, axis, radius)] if sd < 0.006]
        spans[side] = (min(along), max(along)) if along else None
    tree = KDTree(len(pts["R"]))
    for i, p in enumerate(pts["R"]):
        tree.insert(p, i)
    tree.balance()
    dmin = min(tree.find(p)[2] for p in pts["L"])
    close = sum(1 for p in pts["L"] if tree.find(p)[2] < 0.002)
    sep = (spans["R"][0] - spans["L"][1]) if spans["L"] and spans["R"] else None
    return {"L": spans["L"], "R": spans["R"], "separationM": sep, "handToHandMinM": dmin,
            "handToHandVerticesWithin2mm": close}


def ray_hits(tree, origin, direction, max_dist):
    loc, normal, index, dist = tree.ray_cast(origin, direction, max_dist)
    return (loc is not None), index


def cover_mask(gear_obj, targets, max_dist=0.03, always=None):
    """Covered-face removal: hide (MASK) the skin, garment and hair vertices that lie under the gear in the stance
    pose. A skin or garment vertex is covered when a ray along its outward normal meets the gear within max_dist,
    except through the helmet's metal grille (the face must stay). Hair is covered when an upward ray meets the
    helmet. always: optional {object name: [vertex indices]} hidden regardless (the hands inside the gloves: the
    mitts do not follow the bare fingers, so any finger left visible pokes out of the glove). Returns counts per
    object."""
    tree = bvh_of(gear_obj)
    deps = bpy.context.evaluated_depsgraph_get()
    ev = gear_obj.evaluated_get(deps)
    me = ev.to_mesh()
    regions = {}
    mats = json.loads(gear_obj["vande_regions"])
    inv = {v: int(k) for k, v in mats.items()}
    poly_region = [inv.get(p.material_index, -1) for p in me.polygons]
    ev.to_mesh_clear()
    counts = {}
    for obj in targets:
        masks = [m for m in obj.modifiers if m.type == "MASK" and m.show_viewport]
        for m in masks:
            m.show_viewport = False
        ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        om = ev.to_mesh()
        mw = obj.matrix_world
        hair = "short02" in obj.name.lower() or "hair" in obj.name.lower()
        covered = []
        for v in om.vertices:
            p = mw @ v.co
            if hair:
                hit, idx = ray_hits(tree, p, Vector((0.0, 0.0, 1.0)), 0.2)
            else:
                n = (mw.to_3x3() @ v.normal).normalized()
                hit, idx = ray_hits(tree, p + n * 0.0005, n, max_dist)
            if hit and (idx is None or idx >= len(poly_region) or poly_region[idx] != GRILLE_REGION):
                covered.append(v.index)
        ev.to_mesh_clear()
        for m in masks:
            m.show_viewport = True
        if always and obj.name in always:
            covered = sorted(set(covered) | set(always[obj.name]))
        grp = obj.vertex_groups.get("vande_covered") or obj.vertex_groups.new(name="vande_covered")
        grp.add(covered, 1.0, "REPLACE")
        mod = obj.modifiers.get("VANDE covered by gear") or obj.modifiers.new("VANDE covered by gear", "MASK")
        mod.vertex_group = grp.name
        mod.invert_vertex_group = True
        counts[obj.name] = len(covered)
    update()
    return counts


def skin_matrix(rig, obj, v, names):
    m = Matrix(((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
    total = 0.0
    for g in v.groups:
        name = names.get(g.group)
        if name not in rig.pose.bones or g.weight <= 0:
            continue
        pb = rig.pose.bones[name]
        b = (pb.matrix @ rig.data.bones[name].matrix_local.inverted()).to_3x3()
        m = m + b * g.weight
        total += g.weight
    if total <= 0:
        return Matrix.Identity(3)
    return m * (1.0 / total)


def posed_pushout(rig, gear_obj, surfaces, bat, clearance=0.003, passes=5, reach=0.04):
    """Push gear vertices out of the skin, the garments and the closed bat in the stance pose. Each posed
    displacement is mapped back to the rest pose through the vertex's own skinning matrix, so the corrected gear
    deforms with the rig. Open surfaces use the nearest-face normal within `reach`; the bat uses ray parity."""
    names = {g.index: g.name for g in gear_obj.vertex_groups}
    history = []
    for k in range(passes):
        P = evaluated_points(gear_obj)
        trees = [bvh_of(o) for o in surfaces]
        bat_tree = bvh_of(bat) if bat is not None else None
        moves = {}
        for vi, p in enumerate(P):
            d = Vector()
            for tree in trees:
                loc, normal, _, dist = tree.find_nearest(p)
                if loc is None or dist > reach:
                    continue
                sd = (p - loc).dot(normal)
                if sd < clearance:
                    d += normal.normalized() * (clearance - sd)
            if bat_tree is not None:
                loc, normal, _, dist = bat_tree.find_nearest(p)
                if loc is not None and dist < reach and inside_closed(bat_tree, p):
                    d += (loc - p) + normal.normalized() * clearance
            if d.length > 1e-6:
                moves[vi] = d
        history.append({"pass": k + 1, "moved": len(moves), "maxMoveM": r(max((d.length for d in moves.values()), default=0.0), 4)})
        if not moves:
            break
        for vi, d in moves.items():
            v = gear_obj.data.vertices[vi]
            v.co = v.co + skin_matrix(rig, gear_obj, v, names).inverted() @ d
        gear_obj.data.update()
        update()
    return history


def main():
    out = args()
    HumanService, LocationService, TargetService = mpfb()
    body, macro, stature = create_body(HumanService, TargetService)
    shoulder = {"weight": 0.0, "trace": []}
    upper_arm = {"weight": 0.0, "trace": []}
    torso_width = {"weight": 0.0, "trace": []}
    hand_scale = {"weight": 0.0, "trace": []}
    if CONFIG["variant"] in ("C", "D"):
        w, trace = solve_arm_chain(HumanService, TargetService, LocationService, macro)
        upper_arm = {"weight": r(w, 5), "trace": trace}
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    if CONFIG["variant"] in ("B", "D"):
        w, trace = solve_shoulders(HumanService, TargetService, LocationService, macro,
                                   upper_arm["weight"] if CONFIG["variant"] == "D" else 0.0)
        shoulder = {"weight": r(w, 5), "trace": trace}
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    if CONFIG["variant"] == "D" and shoulder["weight"] >= 0.999:
        w, trace = solve_torso_width(HumanService, TargetService, LocationService, macro,
                                     shoulder["weight"], upper_arm["weight"])
        torso_width = {"weight": r(w, 5), "trace": trace}
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    if CONFIG["variant"] == "D" and torso_width["weight"] >= 0.999:
        w, trace = solve_hand_scale(HumanService, TargetService, LocationService, macro,
                                    shoulder["weight"], upper_arm["weight"], torso_width["weight"])
        hand_scale = {"weight": r(w, 5), "trace": trace}
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    body.name = "Human"
    lengthen_lower_arms(TargetService, LocationService, body)
    if shoulder["weight"] > 0:
        TargetService.load_target(body, target_path(LocationService, "torso", "measure-shoulder-dist-decr"),
                                  weight=shoulder["weight"])
        update()
    if upper_arm["weight"] > 0:
        TargetService.load_target(body, target_path(LocationService, "arms", "measure-upperarm-length-incr"),
                                  weight=upper_arm["weight"])
        update()
    if torso_width["weight"] > 0:
        TargetService.load_target(body, target_path(LocationService, "torso", "torso-scale-horiz-decr"),
                                  weight=torso_width["weight"])
        update()
    if hand_scale["weight"] > 0:
        for side in ("l", "r"):
            TargetService.load_target(body, target_path(LocationService, "hands", side + "-hand-scale-decr"),
                                      weight=hand_scale["weight"])
        update()
    rig, data = add_assets(HumanService, LocationService, body)
    mapping = reduce_to_game_skeleton(rig)
    style_materials(data)
    visual_symmetry = []
    if CONFIG["variant"] == "D":
        for obj in bpy.data.objects:
            if obj.type == "MESH" and ("cricket_kit" in obj.name.lower() or "short02" in obj.name.lower()):
                visual_symmetry.append(symmetrize_visual_mesh(obj))
        update()
    kit_pbr_proof = export_kit_proof_maps(data, out)
    eye_colour = eye_colour_proof(data)
    rig.matrix_world = Matrix.Identity(4)
    update()
    a1 = a1_proportions(rig, body)
    log("A1", a1)
    bat, bat_toe, bat_axis, bat_face = make_bat()
    # r4: the r3 stance's metrics first (before), then the r4 stance (after); both measured before the grip.
    stance_before = None
    if CONFIG.get("stanceBefore"):
        current = dict(CONFIG["stance"])
        CONFIG["stance"].update(CONFIG["stanceBefore"])
        pose_stance(rig, bat_toe, bat_axis)
        apply_visual_pose(rig)
        rb, yb = pose_head(rig)
        stance_before = stance_metrics(rig, rb, yb, getattr(pose_head, "gaze_pitch", None))
        stance_before["params"] = dict(CONFIG["stance"])
        CONFIG["stance"].clear()
        CONFIG["stance"].update(current)
    lateral, thorax = pose_stance(rig, bat_toe, bat_axis)
    apply_visual_pose(rig)
    roll, yaw = pose_head(rig)
    stance_after_pre_grip = stance_metrics(rig, roll, yaw, getattr(pose_head, "gaze_pitch", None))
    stance_after_pre_grip["params"] = dict(CONFIG["stance"])
    # A3, bare hands: open the fingers, then key them closed one segment at a time on the seated handle.
    def open_fingers():
        for side in ("L", "R"):
            for d in ("finger1", "finger2", "finger3", "finger4", "finger5"):
                for k in (1, 2, 3):
                    pb = rig.pose.bones["%s-%d.%s" % (d, k, side)]
                    pb.rotation_mode = "XYZ"
                    pb.rotation_euler = (0.0, 0.0, 0.0)
        update()
    # r4: refit the gear before the grip, so grip candidates and spacing rounds can also be tried with the gloves on
    # (the in-game grip). The refit and the glove weights are made in the rest pose, so they do not depend on the
    # grip. The gear objects are left out of hero-bare.blend.
    radius = CONFIG["bat"]["handleRadiusM"]
    objects_before_gear = set(bpy.data.objects)
    gear_objects, gear_report = (build_procedural_cricket_gear(rig) if CONFIG["variant"] == "D"
                                 else refit_gear(rig, body))
    gear_report["glovesLod0"] = articulate_gloves(rig, body, gear_objects["lod0"])
    gear_report["glovesLod1"] = articulate_gloves(rig, body, gear_objects["lod1"])
    gear_new = [o for o in bpy.data.objects if o not in objects_before_gear]
    gear0 = gear_objects["lod0"]
    glove_idx = {side: glove_points(gear0, side) for side in ("L", "R")}
    gnames = {g.index: g.name for g in gear0.vertex_groups}
    pad_idx = [v.index for v in gear0.data.vertices if v.groups and
               gnames[max(v.groups, key=lambda g: g.weight).group].startswith("lowerleg")]
    keep_rule = CONFIG["grip"].get("keepRule", {}).get(CONFIG["variant"], "bare")

    def gloved_trial(toe_, axis_):
        """Seat the bat against the gloves (with tilt), close the gloved thumbs, measure each glove's gap to the
        handle, then restore the bare state exactly. The fingers stay as the bare hand closed them: the glove's
        finger bank follows the finger bones, so it wraps the handle with them (opening them first would lay the
        finger bank across the handle)."""
        pose_snap = {n: pb.matrix_basis.copy() for n, pb in rig.pose.bones.items()}
        bat_snap = bat.matrix_world.copy()
        cfg_snap = json.loads(json.dumps(CONFIG["bat"]))
        gl = {side: evaluated_points(gear0, glove_idx[side]) for side in ("L", "R")}
        top0 = toe_ + axis_ * CONFIG["bat"]["totalM"]
        diag = {}
        for side in ("L", "R"):
            dd = [handle_distance(p_, top0, axis_, radius) for p_ in gl[side]]
            diag[side] = {"minGapM": r(min(d for d, _ in dd), 4), "alongRangeM": [r(min(a for _, a in dd), 3),
                                                                                  r(max(a for _, a in dd), 3)],
                          "points": len(dd)}
        log("gloved trial start", diag, "bands", CONFIG["grip"]["topHandFromTopM"],
            CONFIG["grip"].get("bottomHandSeatFromTopM"))
        t_toe, t_top = seat_bat(rig, body, bat, toe_, axis_, hands=gl, avoid=evaluated_points(gear0, pad_idx),
                                tilt=True, pen_tol=CONFIG["grip"]["mittPaddingM"])
        t_axis = (t_top - t_toe).normalized()
        tilt_ = seat_bat.last["tiltDeg"]
        for side in ("L", "R"):
            close_fingers(rig, gear0, side, t_top, t_axis, radius, contact_sets=glove_contact_sets(gear0, side))
        res = {side: gaps(gear0, {"glove": glove_idx[side]}, t_top, t_axis, radius)["glove"] for side in ("L", "R")}
        for n, m in pose_snap.items():
            rig.pose.bones[n].matrix_basis = m
        bat.matrix_world = bat_snap
        CONFIG["bat"].clear()
        CONFIG["bat"].update(cfg_snap)
        update()
        return res, tilt_
    # r4: the bare seats keep the bat (blade and handle) out of the legs and the clothes (the lower stance brings the
    # knees and the trunk towards the bat). Hand and forearm skin and the sleeves round the wrists are left out: the
    # hands hold the handle.
    held = ("wrist", "metacarpal", "finger", "lowerarm")
    leg_points = []
    for o in [body] + [o for o in bpy.data.objects if o.type == "MESH" and "cricket_kit" in o.name.lower()]:
        names = {g_.index: g_.name for g_ in o.vertex_groups}
        idx = []
        for v in o.data.vertices:
            if not v.groups:
                continue
            dom = names.get(max(v.groups, key=lambda g_: g_.weight).group, "")
            if o is body and not dom.startswith(("upperleg", "lowerleg")):
                continue
            if dom.startswith(held):
                continue
            idx.append(v.index)
        leg_points += evaluated_points(o, idx[::3])
    grip, top = pose_grip(rig, body, bat_toe, bat_axis, joint=CONFIG["grip"].get("joint"), gloved_eval=gloved_trial,
                          keep_rule=keep_rule)
    bat_toe, top = seat_bat(rig, body, bat, bat_toe, bat_axis, avoid=leg_points)
    for o in [o for o in bpy.data.objects if o.type == "EMPTY"]:
        bpy.data.objects.remove(o, do_unlink=True)
    open_fingers()
    closing = {side: close_fingers(rig, body, side, top, bat_axis, radius) for side in ("L", "R")}
    perfinger = {side: per_finger_keys(rig, body, side, top, bat_axis, radius) for side in ("L", "R")}
    # A3 spacing: top hand above, 0-40 mm apart, no overlap. While the contact spans overlap (or sit more than 40 mm
    # apart), move the bottom hand's target, re-solve its arm, re-seat the bat and re-close both hands (at most three
    # moves). Every round is snapshotted and also tried with the gloves on. The kept round follows keepRule:
    #   gloved (A): the most gloves within 5 mm of the handle, then the smallest worst glove gap, then the least overlap,
    #               then the most bare digits within 5 mm;
    #   bare (C):   the most bare digits within 5 mm, then the least overlap, then the fewest hand-to-hand vertices
    #               within 2 mm.
    spacing = []
    snapshots = []
    rounds = CONFIG["grip"].get("spacingRounds", 6)
    for round_ in range(rounds):
        sp = hand_spans(rig, body, top, bat_axis, radius)
        dg = {side: digit_gaps(rig, body, side, top, bat_axis, radius) for side in ("L", "R")}
        closed_digits = sum(1 for side in dg for v in dg[side].values() if v <= 0.005)
        sep = sp["separationM"]
        overlap = (max(0.0, -sep) + max(0.0, sep - 0.040)) if sep is not None else 1.0
        if sp["R"]:
            CONFIG["grip"]["bottomHandSeatFromTopM"] = r((sp["R"][0] + sp["R"][1]) / 2.0, 4)
        gl_gap, gl_tilt = gloved_trial(bat_toe, bat_axis)
        gl_ok = sum(1 for v in gl_gap.values() if v <= 0.005)
        gl_worst = max(gl_gap.values())
        within2 = sp["handToHandVerticesWithin2mm"]
        spacing.append({"round": round_, "bottomHandFromTopM": r(CONFIG["grip"]["bottomHandFromTopM"], 4),
                        "digitsWithin5mm": closed_digits, "digitGapM": dg,
                        "spanL": [r(x, 4) for x in sp["L"]] if sp["L"] else None,
                        "spanR": [r(x, 4) for x in sp["R"]] if sp["R"] else None,
                        "separationM": r(sep, 4) if sep is not None else None, "overlapM": r(overlap, 4),
                        "handToHandMinM": r(sp["handToHandMinM"], 4), "handToHandVerticesWithin2mm": within2,
                        "bottomWristToTargetM": r(grip["R"].get("wristToTargetM", 0.0), 4),
                        "glovedGapM": {k: r(v, 4) for k, v in gl_gap.items()}, "glovedSeatTiltDeg": gl_tilt})
        if keep_rule == "gloved":
            key = (gl_ok, -round(max(0.0, gl_worst) * 1000.0) if gl_ok < 2 else 0, -round(overlap * 1000.0),
                   closed_digits, -within2)
        else:
            key = (closed_digits, -round(overlap * 1000.0), -within2)
        snapshots.append((key, round_, {n: pb.matrix_basis.copy() for n, pb in rig.pose.bones.items()},
                          bat.matrix_world.copy(), bat_toe.copy(), top.copy(), json.loads(json.dumps(CONFIG["bat"])),
                          CONFIG["grip"]["bottomHandFromTopM"], CONFIG["grip"].get("bottomHandSeatFromTopM"),
                          json.loads(json.dumps(grip)), closing, perfinger))
        if sep is None or overlap == 0.0 or round_ == rounds - 1:
            break
        # Move the bottom hand's target by the overlap plus 10 mm (or back towards 20 mm apart), at most 40 mm a round.
        if sep < 0.0:
            CONFIG["grip"]["bottomHandFromTopM"] += min(0.040, -sep + 0.010)
        else:
            CONFIG["grip"]["bottomHandFromTopM"] -= min(0.040, sep - 0.020)
        res, top = pose_grip(rig, body, bat_toe, bat_axis, sides=("R",))
        grip.update(res)
        # Close the moved hand before seating, so the seat fits the bat to a closed hand (as after the joint solve).
        close_fingers(rig, body, "R", top, bat_axis, radius)
        bat_toe, top = seat_bat(rig, body, bat, bat_toe, bat_axis, avoid=leg_points)
        open_fingers()
        closing = {side: close_fingers(rig, body, side, top, bat_axis, radius) for side in ("L", "R")}
        perfinger = {side: per_finger_keys(rig, body, side, top, bat_axis, radius) for side in ("L", "R")}
    best = max(snapshots, key=lambda s_: s_[0])
    (_, best_round, pose_b, bat_mw, bat_toe, top, bat_cfg, bottom_from_top, seat_from_top, grip_b, closing,
     perfinger) = best
    for n, m in pose_b.items():
        rig.pose.bones[n].matrix_basis = m
    bat.matrix_world = bat_mw
    CONFIG["bat"].clear()
    CONFIG["bat"].update(bat_cfg)
    CONFIG["grip"]["bottomHandFromTopM"] = bottom_from_top
    CONFIG["grip"]["bottomHandSeatFromTopM"] = seat_from_top
    grip.clear()
    grip.update(grip_b)
    update()
    sp = hand_spans(rig, body, top, bat_axis, radius)
    spacing.append({"final": True, "keptRound": best_round, "keepRule": keep_rule,
                    "bottomHandFromTopM": r(CONFIG["grip"]["bottomHandFromTopM"], 4),
                    "spanL": [r(x, 4) for x in sp["L"]] if sp["L"] else None,
                    "spanR": [r(x, 4) for x in sp["R"]] if sp["R"] else None,
                    "separationM": r(sp["separationM"], 4), "handToHandMinM": r(sp["handToHandMinM"], 4),
                    "handToHandVerticesWithin2mm": sp["handToHandVerticesWithin2mm"]})
    log("spacing", json.dumps(spacing)[:500])
    log("closing bare", json.dumps(closing)[:400])
    stance = measure_stance(rig, body, bat, grip, top, bat_axis, roll, yaw)
    stance["perFingerKeys"] = perfinger
    stance["handSpacing"] = spacing
    stance["thoraxPitchDeg"] = r(thorax(), 2)
    stance["fingerClosing"] = closing
    stance["metricsBefore"] = stance_before
    stance["metricsAfterPreGrip"] = stance_after_pre_grip
    stance["metricsAfter"] = stance_metrics(rig, roll, yaw, getattr(pose_head, "gaze_pitch", None))
    log("stance", json.dumps(stance)[:600])
    # The bare file has no gear: unlink the gear objects for the save (unlinked objects are not written), then relink.
    unlinked = []
    for o in gear_new:
        for coll in list(o.users_collection):
            coll.objects.unlink(o)
            unlinked.append((coll, o))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "hero-bare.blend"), compress=True, copy=True)
    for coll, o in unlinked:
        coll.objects.link(o)
    update()
    # Gear on (the in-game configuration: the batter always wears gloves): seat the bat against the gloves, tilting
    # it as well as translating it (r4), and close the gloved thumbs on the handle.
    bare_axis = bat_axis.copy()
    gloves = {side: evaluated_points(gear0, glove_idx[side]) for side in ("L", "R")}
    pads = evaluated_points(gear0, pad_idx)
    bat_toe, top = seat_bat(rig, body, bat, bat_toe, bat_axis, hands=gloves, avoid=pads, tilt=True,
                            pen_tol=CONFIG["grip"]["mittPaddingM"])
    bat_axis = (top - bat_toe).normalized()
    closing_gear = {side: close_fingers(rig, gear0, side, top, bat_axis, radius,
                                        contact_sets=glove_contact_sets(gear0, side)) for side in ("L", "R")}
    log("closing gloved", json.dumps(closing_gear)[:400])
    # r3: covered-face removal under the gear, then a posed push-out of both gear LODs (stance pose).
    cover_targets = [body] + [o for o in bpy.data.objects if o.type == "MESH" and
                              ("cricket_kit" in o.name.lower() or "short02" in o.name.lower())]
    hand_skin = hand_vertices(body, rig, "L") + hand_vertices(body, rig, "R")
    covered = cover_mask(gear0, cover_targets, max_dist=(0.06 if CONFIG["variant"] == "D" else 0.03),
                         always={body.name: hand_skin})
    gear_report["handSkinHiddenUnderGloves"] = len(hand_skin)
    surfaces = [body] + [o for o in bpy.data.objects if o.type == "MESH" and
                         ("cricket_kit" in o.name.lower() or "shoes" in o.name.lower())]
    if CONFIG["variant"] == "D":
        # The original procedural pieces are authored around the exact rest rig.  A one-sided right-hand push-out
        # would bake pose asymmetry into the source mesh and break left-handed parity; validate their clearances
        # directly below instead.
        pushout = {"lod0": [], "lod1": [], "symmetryPreserved": True}
    else:
        pushout = {"lod0": posed_pushout(rig, gear0, surfaces, bat, passes=10),
                   "lod1": posed_pushout(rig, gear_objects["lod1"], surfaces, bat, passes=10)}
    # The push-out moves the gloves off the handle where they sank into it: re-seat the bat against the pushed-out
    # gloves (avoiding the pads), then a final push-out so nothing re-enters the bat.
    gloves = {side: evaluated_points(gear0, glove_idx[side]) for side in ("L", "R")}
    pads = evaluated_points(gear0, pad_idx)
    bat_toe, top = seat_bat(rig, body, bat, bat_toe, bat_axis, hands=gloves, avoid=pads, tilt=True)
    bat_axis = (top - bat_toe).normalized()
    if CONFIG["variant"] == "D":
        pushout["lod0Final"] = []
        pushout["lod1Final"] = []
    else:
        pushout["lod0Final"] = posed_pushout(rig, gear0, surfaces, bat, passes=10)
        pushout["lod1Final"] = posed_pushout(rig, gear_objects["lod1"], surfaces, bat, passes=10)
    gear_report["coveredVerticesMasked"] = covered
    gear_report["posedPushOut"] = pushout
    log("covered", covered, "pushout", json.dumps(pushout)[:300])
    gloved = {}
    for side in ("L", "R"):
        sets = glove_contact_sets(gear0, side)
        digit_sets = {d: [i for k in (2, 3) for i in sets.get("%s-%d.%s" % (d, k, side), [])]
                      for d in ("finger1", "finger2", "finger3", "finger4", "finger5")}
        gloved[side + "_digitGapM"] = {k: r(v, 4) for k, v in gaps(gear0, digit_sets, top, bat_axis, radius).items()}
        whole = {"glove": glove_points(gear0, side)}
        gloved[side + "_gloveMinGapM"] = r(gaps(gear0, whole, top, bat_axis, radius)["glove"], 4)
    gloved["fingerClosing"] = closing_gear
    gloved["batToe"] = [r(x, 4) for x in bat_toe]
    gloved["batAxis"] = [r(x, 4) for x in bat_axis]
    gloved["seatTiltDeg"] = CONFIG["bat"].get("seatTiltDeg")
    gloved["batAxisChangeFromBareDeg"] = r(math.degrees(bare_axis.angle(bat_axis)), 2)
    a4_gear = a4_with_gear(rig, body, bat, gear0)
    log("A4 with gear", json.dumps(a4_gear)[:600])
    # Bat follows the right wrist (child of bone, keeps the current world transform).
    world = bat.matrix_world.copy()
    bat.parent = rig
    bat.parent_type = "BONE"
    bat.parent_bone = "wrist.R"
    update()
    bat.matrix_world = world
    update()
    lh = left_hander(rig, body, bat, LocationService, out)
    action, frames = bake_idle(rig)
    idle = measure_idle(rig, frames)
    log("idle", idle)
    gear_objects["lod1"].hide_render = True
    gear_objects["lod1"].hide_viewport = True
    blend = os.path.join(out, "hero.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    counts = {o.name: {"vertices": len(o.data.vertices), "polygons": len(o.data.polygons)}
              for o in bpy.data.objects if o.type == "MESH"}
    record = {
        "schema": "vande.cover-drive.p2.hero-build.v2",
        "classification": "BUILDER_OBSERVATION_NON_HUMAN",
        "blender": bpy.app.version_string,
        "blenderBuildHash": bpy.app.build_hash.decode() if isinstance(bpy.app.build_hash, bytes) else bpy.app.build_hash,
        "mpfb": "2.0.18",
        "variant": CONFIG["variant"],
        "config": CONFIG,
        "macroSolved": macro,
        "shoulderNarrowing": shoulder,
        "upperArmLengthening": upper_arm,
        "torsoHorizontalNarrowing": torso_width,
        "symmetricHandScaling": hand_scale,
        "armChainRestM": r(arm_chain(rig), 4),
        "skeleton": {"bones": len(rig.data.bones), "names": [b.name for b in rig.data.bones],
                     "mergedFromDefaultRig": len(mapping), "matchesGameSkeleton": sorted(b.name for b in rig.data.bones) == sorted(V3_BONE_NAMES)},
        "meshes": counts,
        "kitPbrProof": kit_pbr_proof,
        "eyeColourProof": eye_colour,
        "visualSymmetry": visual_symmetry,
        "A1": a1,
        "stance": stance,
        "gearRefit": gear_report,
        "A3_gloved": gloved,
        "A4_withGear": a4_gear,
        "leftHander": lh,
        "A5_idle": idle,
        "log": LOG,
    }
    with open(os.path.join(out, "hero-build.json"), "w") as f:
        json.dump(record, f, indent=1)
    print("HERO_BUILD_OK " + blend)


main()
