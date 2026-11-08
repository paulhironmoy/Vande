"""Headless proof that Blender + MPFB + the MakeHuman CC0 system assets work (Blender background mode).

Usage:
  blender -b --factory-startup --python-exit-code 3 --python scripts/blender/mpfb_smoke.py -- <out-dir>

Creates a basic MPFB human (male macro, CC0 young_african_male skin, brown eyes, eyebrows, eyelashes), adds the
built-in MakeHuman `default` rig with its CC0 weights, and exports it as glTF binary and FBX into <out-dir>.
Writes <out-dir>/smoke.json with the counts and file hashes. Nothing here ships; it proves the toolchain only.
"""

import hashlib
import json
import os
import sys

import addon_utils
import bpy
from mathutils import Vector


def out_dir():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 1:
        raise SystemExit("usage: -- <out-dir>")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0]


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def evaluated_bounds(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    zs = [(obj.matrix_world @ v.co).z for v in mesh.vertices]
    n = len(mesh.vertices)
    ev.to_mesh_clear()
    return min(zs), max(zs), n


def main():
    out = out_dir()
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    from bl_ext.user_default.mpfb.services import HumanService, LocationService, TargetService  # noqa: E402

    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    macro = TargetService.get_default_macro_info_dict()
    macro.update({"gender": 1.0, "age": 0.5, "muscle": 0.6, "weight": 0.5, "height": 0.6})
    basemesh = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    data = LocationService.get_user_data()
    HumanService.set_character_skin(os.path.join(data, "skins", "young_african_male", "young_african_male.mhmat"),
                                    basemesh, skin_type="GAMEENGINE")
    for kind, name in (("Eyes", "low-poly"), ("Eyebrows", "eyebrow001"), ("Eyelashes", "eyelashes01")):
        folder = {"Eyes": "eyes", "Eyebrows": "eyebrows", "Eyelashes": "eyelashes"}[kind]
        mhclo = os.path.join(data, folder, name, name + ".mhclo")
        if os.path.exists(mhclo):
            HumanService.add_mhclo_asset(mhclo, basemesh, asset_type=kind, subdiv_levels=0, material_type="GAMEENGINE")
    rig = HumanService.add_builtin_rig(basemesh, "default", import_weights=True)

    zmin, zmax, verts = evaluated_bounds(basemesh)
    record = {
        "blender": bpy.app.version_string,
        "blender_build_hash": bpy.app.build_hash.decode() if isinstance(bpy.app.build_hash, bytes) else bpy.app.build_hash,
        "mpfb_version": ".".join(str(x) for x in addon_utils.module_bl_info(
            sys.modules["bl_ext.user_default.mpfb"]).get("version", ())) or "2.0.18",
        "objects": sorted(o.name for o in bpy.data.objects),
        "basemesh_vertices_evaluated": verts,
        "stature_m": round(zmax - zmin, 4),
        "feet_z_m": round(zmin, 4),
        "rig_bones": len(rig.data.bones),
        "rig_bone_sample": [b.name for b in rig.data.bones][:12],
        "armature_modifier": any(m.type == "ARMATURE" for m in basemesh.modifiers),
    }

    glb = os.path.join(out, "mpfb-smoke.glb")
    fbx = os.path.join(out, "mpfb-smoke.fbx")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_skins=True,
                              export_apply=False, export_animations=False)
    bpy.ops.export_scene.fbx(filepath=fbx, use_selection=True, add_leaf_bones=False, bake_anim=False)
    record["exports"] = {os.path.basename(p): {"bytes": os.path.getsize(p), "sha256": sha256(p)} for p in (glb, fbx)}

    # Re-import the GLB into an empty scene: the export must round-trip a skinned mesh and the full armature.
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    record["glb_reimport"] = {
        "armatures": len(arms),
        "bones": len(arms[0].data.bones) if arms else 0,
        "meshes": len(meshes),
        "skinned_meshes": sum(1 for m in meshes if any(md.type == "ARMATURE" for md in m.modifiers)),
    }
    ok = (record["rig_bones"] > 0 and record["glb_reimport"]["bones"] == record["rig_bones"]
          and record["glb_reimport"]["skinned_meshes"] >= 1 and 1.5 < record["stature_m"] < 2.1)
    record["pass"] = ok
    with open(os.path.join(out, "smoke.json"), "w") as f:
        json.dump(record, f, indent=2)
    print("SMOKE_RESULT " + json.dumps(record))
    if not ok:
        raise SystemExit("smoke test failed")


main()
