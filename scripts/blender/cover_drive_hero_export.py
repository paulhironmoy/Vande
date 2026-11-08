"""Cover-drive P2 exporter: the Blender hero -> GLB (review) and skin JSON per runtime file for the VSK1/VPM3 encoder.

Usage:
  blender -b --factory-startup --python-exit-code 3 --python scripts/blender/cover_drive_hero_export.py -- \
      <hero.blend> <out-dir>

Writes:
  hero.glb               rest-pose skinned hero + 75-bone armature + the idle action + the bat + gear (review only)
  hero-skin-lod0.json    body, kit, shoes and hair, face-protected collapse decimation to ~32,000 triangles (P2 r2:
                         the close-up ceiling is 40,000 with eyes, gear and bat)
  hero-skin-lod1.json    the same to ~5,000 triangles (the live batter), face-protected
  hero-eyes.json         MPFB low-poly eyes, rigid on the head bone, protected shader region 16
  hero-eye-left.json     quarantined independently pivotable proof eye (not wired to runtime)
  hero-eye-right.json    quarantined independently pivotable proof eye (not wired to runtime)
  hero-face-rig.json     gaze contract plus per-LOD blink masks (proof metadata; VPM3 has no morph payload)
  hero-gear-lod0.json    the refitted original VANDE gear (helmet, gloves, pads), from VANDE_gear
  hero-gear-lod1.json    the same from the refitted live gear (VANDE_gearL1)
  hero-export.json       counts, regions, face-protection retention and drift, what was left out
Then run scripts/cover-drive/encode-hero.mjs.

Coordinates: MakeHuman OBJ is y-up and faces +z; MPFB converts it to Blender as (x, -z, y). The existing Node
exporters write MakeHuman coordinates straight into Unity, so Unity = (bx, bz, -by) here.
Body regions follow scripts/export-unity-production-character-v3.mjs: 0 skin, 1 jersey, 2 trousers, 3 shoes/feet,
11 hair. Gear keeps its original regions. Eyebrow and eyelash alpha cards are left out (no runtime alpha shader).

Face protection: a vertex group (weight 1) of spheres round the measured eye centres, brow, nose tip and mouth, given
to the collapse decimator inverted (the decimator's group marks where it may collapse; measured: without inversion it
kept only 36% of the face at LOD0 and could not reach LOD1's target). Retention is the share of source triangles fully
inside the protected spheres that survive; drift is the largest distance of a decimated protected vertex from the
source surface.
"""

import json
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

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
INDEX = {n: i for i, n in enumerate(V3_BONE_NAMES)}
LOWER = {n for n in V3_BONE_NAMES if n == "root" or n.startswith(("pelvis.", "upperleg", "lowerleg"))}
TARGETS = {"lod0": 32000, "lod1": 5000}
# Protected landmark radius per LOD. At LOD1 the face must not starve the body: the current runtime's LOD1 policy keeps
# 969 face triangles out of 4,999, so LOD1 protects the landmark cores only.
PROTECT_RADIUS_SCALE = {"lod0": 1.0, "lod1": 0.45}
PROTECT_FACTOR = 100.0


def unity(v):
    return [round(v.x, 7), round(v.z, 7), round(-v.y, 7)]


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 2:
        raise SystemExit("usage: -- <hero.blend> <out-dir>")
    os.makedirs(argv[1], exist_ok=True)
    return argv


def region_of(obj, dominant):
    n = obj.name.lower()
    if "shoes" in n:
        return 3
    if "short02" in n or "hair" in n:
        return 11
    if "casualsuit" in n or "cricket_kit" in n:
        return 2 if dominant in LOWER else 1
    return 0


def rest_mesh(obj, rig, ratio=None, protect=None):
    """The object in the rig's rest pose with its masks applied, optionally collapse-decimated, triangulated."""
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    mod = None
    if ratio is not None and ratio < 1.0:
        mod = obj.modifiers.new("export_decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        if protect is not None:
            # Blender's collapse decimator decimates where the group weight is high, so the face group is inverted:
            # face weight 1 -> influence 0 (kept), the rest -> full influence.
            mod.vertex_group = protect
            mod.invert_vertex_group = True
            mod.vertex_group_factor = PROTECT_FACTOR
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=deps)
    if mod is not None:
        obj.modifiers.remove(mod)
    rig.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.transform(obj.matrix_world)
    return me


def weights_of(obj, v, groups):
    entries = [(INDEX[groups[g.group]], g.weight) for g in v.groups
               if g.group in groups and groups[g.group] in INDEX and g.weight > 1e-6]
    if not entries:
        raise SystemExit("vertex without game-bone weight in " + obj.name)
    return entries


def mesh_records(obj, me, base_index, region_fn):
    """Vertices split per UV corner (Unity needs one UV per vertex), weights from the 75 game-bone groups."""
    groups = {g.index: g.name for g in obj.vertex_groups}
    uv = me.uv_layers.active.data if me.uv_layers.active else None
    me.calc_loop_triangles()
    vertices, indices, remap = [], [], {}
    for tri in me.loop_triangles:
        for loop_index in tri.loops:
            loop = me.loops[loop_index]
            vi = loop.vertex_index
            u = (round(uv[loop_index].uv.x, 6), round(uv[loop_index].uv.y, 6)) if uv else (0.0, 0.0)
            key = (vi, u)
            if key not in remap:
                v = me.vertices[vi]
                entries = weights_of(obj, v, groups)
                dominant = V3_BONE_NAMES[max(entries, key=lambda e: (e[1], -e[0]))[0]]
                remap[key] = base_index + len(vertices)
                vertices.append({"position": unity(v.co), "uv": [u[0], u[1]], "region": region_fn(vi, dominant),
                                 "weights": [[b, round(w, 6)] for b, w in sorted(entries, key=lambda e: (-e[1], e[0]))]})
            indices.append(remap[key])
    return vertices, indices


def write_skin(path, rig, vertices, indices, parts, extra=None):
    bones = []
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    for name in V3_BONE_NAMES:
        b = rig.data.bones[name]
        parent = b.parent.name if b.parent else None
        bones.append({"name": name, "parent": INDEX[parent] if parent else -1,
                      "head": unity(rig.matrix_world @ b.head_local)})
    rig.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    payload = {"schema": "vande.cover-drive.hero-skin.v1", "coordinates": "unity (x, y up, z), metres",
               "bones": bones, "vertices": vertices, "indices": indices, "parts": parts}
    if extra:
        payload.update(extra)
    with open(path, "w") as f:
        json.dump(payload, f)


# ---- face protection ---------------------------------------------------------------------------------------------

def face_landmarks(rig, body, eyes):
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = eyes.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [eyes.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    left = [p for p in pts if p.x > 0]
    right = [p for p in pts if p.x <= 0]
    el = sum(left, Vector()) / len(left)
    er = sum(right, Vector()) / len(right)
    mid = (el + er) / 2.0
    ev = body.evaluated_get(deps)
    me = ev.to_mesh()
    bpts = [(i, body.matrix_world @ v.co) for i, v in enumerate(me.vertices)]
    ev.to_mesh_clear()
    rig.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    nose_c = [p for _, p in bpts if abs(p.x) < 0.012 and mid.z - 0.065 < p.z < mid.z - 0.01]
    nose = min(nose_c, key=lambda p: p.y)
    mouth_c = [p for _, p in bpts if abs(p.x) < 0.03 and nose.z - 0.065 < p.z < nose.z - 0.02]
    mouth = min(mouth_c, key=lambda p: p.y)
    brow = mid + Vector((0.0, -0.01, 0.035))
    return {"eyeL": (el, 0.030), "eyeR": (er, 0.030), "brow": (brow, 0.035), "nose": (nose, 0.028),
            "mouth": (mouth, 0.032)}


def add_protect_group(body, rig, marks, name="vande_protect"):
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    # Original vertex indices: evaluate with masks off so indices match the base mesh.
    masks = [m for m in body.modifiers if m.type == "MASK" and m.show_viewport]
    for m in masks:
        m.show_viewport = False
    deps = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(deps)
    me = ev.to_mesh()
    pts = [body.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    for m in masks:
        m.show_viewport = True
    rig.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    grp = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
    inside = [i for i, p in enumerate(pts) if any((p - c).length <= rad for c, rad in marks.values())]
    grp.add(inside, 1.0, "REPLACE")
    return grp.name, len(inside)


def in_marks(p, marks):
    return any((p - c).length <= rad for c, rad in marks.values())


def protected_tris(me, marks):
    me.calc_loop_triangles()
    return sum(1 for t in me.loop_triangles if all(in_marks(me.vertices[v].co, marks) for v in t.vertices))


def blink_masks(vertices, marks):
    """Create deterministic eyelid morph weights in the exported LOD's own vertex index space.

    VPM3 does not carry blend shapes today.  The masks therefore travel as proof metadata beside the candidate and
    cannot affect the live build.  A later Unity integration may use the exact indices only after extending and
    independently testing the format; until then this is an auditable face-rig input, not a runtime claim.
    """
    result = {}
    for key in ("eyeL", "eyeR"):
        centre = unity(marks[key][0])
        entries = []
        for index, vertex in enumerate(vertices):
            if vertex["region"] != 0:
                continue
            p = vertex["position"]
            dx = (p[0] - centre[0]) / 0.036
            dy = (p[1] - centre[1]) / 0.022
            dz = p[2] - centre[2]
            radial = dx * dx + dy * dy
            # The skin lid is in front of the rigid eyeball in Unity +Z.  Excluding the rear of the head prevents a
            # spherical landmark test from pulling unrelated skull vertices into the morph.
            if radial > 1.0 or dz < -0.002 or dz > 0.040:
                continue
            weight = max(0.0, 1.0 - radial) ** 0.5
            delta_y = (centre[1] - p[1]) * 0.78 * weight
            if abs(delta_y) < 0.00005:
                continue
            entries.append({"vertex": index, "weight": round(weight, 5),
                            "blinkDeltaM": [0.0, round(delta_y, 6), round(-0.0006 * weight, 6)]})
        result[key] = entries
    return {"schema": "vande.cover-drive.face-mask.v1", "space": "exported VPM3 bind vertices",
            "proofOnly": True, "runtimeBinding": None, "blink": result,
            "counts": {k: len(v) for k, v in result.items()}}


def export_body_lod(rig, parts, body, marks, protect, target, path):
    """Bisect one collapse ratio (shared by every part) so the total lands on the target triangle count."""
    total_full = 0
    full = {}
    for obj in parts:
        me = rest_mesh(obj, rig)
        full[obj.name] = me
        me.calc_loop_triangles()
        total_full += len(me.loop_triangles)
    src_protected = protected_tris(full[body.name], marks)
    src_tree = BVHTree.FromPolygons([v.co for v in full[body.name].vertices],
                                    [list(t.vertices) for t in full[body.name].loop_triangles])
    lo, hi = 0.0, 1.0
    best = None
    for _ in range(12):
        ratio = (lo + hi) / 2.0
        meshes = {o.name: rest_mesh(o, rig, ratio, protect if o == body else None) for o in parts}
        tris = 0
        for me in meshes.values():
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
        if best is not None:
            for me in best[2].values():
                bpy.data.meshes.remove(me)
        best = (ratio, tris, meshes)
        if tris > target:
            hi = ratio
        else:
            lo = ratio
        if abs(tris - target) <= target * 0.004 and tris <= target:
            break
    ratio, tris, meshes = best
    if tris > target:
        # Final step down to the last ratio that met the target.
        for me in meshes.values():
            bpy.data.meshes.remove(me)
        ratio = lo
        meshes = {o.name: rest_mesh(o, rig, ratio, protect if o == body else None) for o in parts}
    body_me = meshes[body.name]
    kept = protected_tris(body_me, marks)
    drift = 0.0
    for v in body_me.vertices:
        if in_marks(v.co, marks):
            loc, _, _, d = src_tree.find_nearest(v.co)
            if loc is not None:
                drift = max(drift, d)
    verts, idx, per = [], [], {}
    for obj in parts:
        me = meshes[obj.name]
        v, i = mesh_records(obj, me, len(verts), lambda vi, dom, o=obj: region_of(o, dom))
        per[obj.name] = {"vertices": len(v), "triangles": len(i) // 3}
        verts.extend(v)
        idx.extend(i)
    face_rig = blink_masks(verts, marks)
    if any(face_rig["counts"][eye] <= 0 for eye in ("eyeL", "eyeR")):
        raise SystemExit("%s produced an empty blink mask: %s" % (os.path.basename(path), face_rig["counts"]))
    write_skin(path, rig, verts, idx, per, {"faceRigProof": face_rig})
    for me in list(meshes.values()) + list(full.values()):
        bpy.data.meshes.remove(me)
    return {"target": target, "ratio": round(ratio, 5), "vertices": len(verts), "triangles": len(idx) // 3,
            "parts": per, "sourceTriangles": total_full,
            "faceProtection": {"sourceProtectedTriangles": src_protected, "keptProtectedTriangles": kept,
                               "retention": round(kept / src_protected, 4) if src_protected else None,
                               "maxDriftM": round(drift, 5)}, "faceRigProof": face_rig}


def export_rigid(obj, rig, path, region, bone):
    me = rest_mesh(obj, rig)
    verts, idx = mesh_records(obj, me, 0, lambda vi, dom: region)
    for v in verts:
        v["weights"] = [[INDEX[bone], 1.0]]
    write_skin(path, rig, verts, idx, {obj.name: {"vertices": len(verts), "triangles": len(idx) // 3}})
    bpy.data.meshes.remove(me)
    return {"vertices": len(verts), "triangles": len(idx) // 3}


def export_eye_pair(obj, rig, out):
    """Keep the compatible combined eye mesh and also emit independently pivotable left/right proof meshes."""
    me = rest_mesh(obj, rig)
    verts, idx = mesh_records(obj, me, 0, lambda vi, dom: 16)
    for v in verts:
        v["weights"] = [[INDEX["head"], 1.0]]
    combined_path = os.path.join(out, "hero-eyes.json")
    write_skin(combined_path, rig, verts, idx, {obj.name: {"vertices": len(verts), "triangles": len(idx) // 3}})
    report = {"combined": {"vertices": len(verts), "triangles": len(idx) // 3}, "split": {}}
    for side, positive in (("left", True), ("right", False)):
        chosen = []
        for offset in range(0, len(idx), 3):
            tri = idx[offset:offset + 3]
            centre_x = sum(verts[i]["position"][0] for i in tri) / 3.0
            if (centre_x > 0.0) == positive:
                chosen.extend(tri)
        used = sorted(set(chosen))
        remap = {old: new for new, old in enumerate(used)}
        side_verts = [verts[i] for i in used]
        side_idx = [remap[i] for i in chosen]
        if not side_verts or not side_idx:
            raise SystemExit("failed to split %s eye mesh" % side)
        pivot = [round(sum(v["position"][axis] for v in side_verts) / len(side_verts), 7) for axis in range(3)]
        path = os.path.join(out, "hero-eye-%s.json" % side)
        write_skin(path, rig, side_verts, side_idx,
                   {obj.name + "." + side: {"vertices": len(side_verts), "triangles": len(side_idx) // 3}},
                   {"proofOnly": True, "eye": side, "pivot": pivot, "runtimeBinding": None})
        report["split"][side] = {"file": os.path.basename(path), "vertices": len(side_verts),
                                  "triangles": len(side_idx) // 3, "pivot": pivot}
    split_triangles = sum(item["triangles"] for item in report["split"].values())
    if split_triangles != report["combined"]["triangles"]:
        raise SystemExit("split eye triangles %d != combined %d" %
                         (split_triangles, report["combined"]["triangles"]))
    report["splitTrianglesEqualCombined"] = True
    bpy.data.meshes.remove(me)
    return report


def glb_node_names(path):
    """Read the JSON chunk of a GLB and return its node names without a third-party parser."""
    with open(path, "rb") as f:
        payload = f.read()
    if len(payload) < 20 or payload[:4] != b"glTF":
        raise SystemExit("invalid GLB proof output")
    offset = 12
    while offset + 8 <= len(payload):
        length, kind = struct.unpack_from("<II", payload, offset)
        offset += 8
        chunk = payload[offset:offset + length]
        offset += length
        if kind == 0x4E4F534A:  # JSON
            document = json.loads(chunk.decode("utf8").rstrip(" \t\r\n\x00"))
            return {node.get("name") for node in document.get("nodes", []) if node.get("name")}
    raise SystemExit("GLB proof output has no JSON chunk")


def export_gear(obj, rig, path):
    me = rest_mesh(obj, rig)
    attr = me.attributes.get("vande_region")
    regions = [d.value for d in attr.data] if attr else [0] * len(me.vertices)
    verts, idx = mesh_records(obj, me, 0, lambda vi, dom: regions[vi])
    write_skin(path, rig, verts, idx, {obj.name: {"vertices": len(verts), "triangles": len(idx) // 3}})
    bpy.data.meshes.remove(me)
    return {"vertices": len(verts), "triangles": len(idx) // 3}


def main():
    blend, out = args()
    bpy.ops.wm.open_mainfile(filepath=blend)
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(
        m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
    eyes = next(o for o in meshes if "poly" in o.name.lower())
    gear0 = next((o for o in meshes if o.name == "VANDE_gear"), None)
    gear1 = next((o for o in meshes if o.name == "VANDE_gearL1"), None)
    body = next(o for o in meshes if o.name == "Human")
    left_out = [o.name for o in meshes if any(k in o.name.lower() for k in ("eyebrow", "eyelash"))]
    parts = [o for o in meshes if o.name not in left_out and o not in (eyes, gear0, gear1)]
    marks = face_landmarks(rig, body, eyes)
    record = {"blender": bpy.app.version_string, "leftOutOfRuntimeMesh": left_out,
              "leftOutReason": "eyebrow and eyelash alpha cards need a shader the runtime does not have",
              "faceLandmarks": {k: {"centre": [round(x, 4) for x in c], "radiusM": rad} for k, (c, rad) in marks.items()},
              "protectFactor": PROTECT_FACTOR, "protectRadiusScale": PROTECT_RADIUS_SCALE}
    face_contract = {
        "schema": "vande.cover-drive.face-rig-proof.v1",
        "classification": "QUARANTINED_GATE_A_PROOF_INPUT",
        "coordinates": "unity (x, y up, z), metres",
        "runtimeBinding": None,
        "skeleton": {"headBone": "head", "jawBone": "jaw", "bodyBoneCount": len(V3_BONE_NAMES)},
        "gaze": {"forward": [0.0, 0.0, 1.0], "maxYawDeg": 12.0, "maxPitchUpDeg": 8.0,
                 "maxPitchDownDeg": 12.0,
                 "note": "owner-authored proof bounds; the two split meshes enable independent pivots"},
        "blink": {"closeMs": 70, "holdMs": 40, "openMs": 100,
                  "note": "owner-authored proof cadence; per-LOD vertex deltas are not in VPM3"},
        "expressions": {"implemented": False,
                        "reason": "the present VPM3 format has neither blend-shape payloads nor a facial-bone set"},
        "lods": {},
    }
    for lod, target in TARGETS.items():
        lod_marks = {k: (c, rad * PROTECT_RADIUS_SCALE[lod]) for k, (c, rad) in marks.items()}
        protect, protected_vertices = add_protect_group(body, rig, lod_marks, "vande_protect_" + lod)
        lod_record = export_body_lod(rig, parts, body, lod_marks, protect, target,
                                     os.path.join(out, "hero-skin-%s.json" % lod))
        face_contract["lods"][lod] = lod_record.pop("faceRigProof")
        record[lod] = lod_record
        record[lod]["protectedVertices"] = protected_vertices
    record["eyes"] = export_eye_pair(eyes, rig, out)
    face_contract["eyes"] = record["eyes"]["split"]
    with open(os.path.join(out, "hero-face-rig.json"), "w") as f:
        json.dump(face_contract, f, indent=1)
    if gear0 is not None:
        record["gearLod0"] = export_gear(gear0, rig, os.path.join(out, "hero-gear-lod0.json"))
    if gear1 is not None:
        record["gearLod1"] = export_gear(gear1, rig, os.path.join(out, "hero-gear-lod1.json"))
    bpy.ops.object.select_all(action="SELECT")
    glb_path = os.path.join(out, "hero.glb")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True,
                              export_skins=True, export_animations=True, export_apply=False)
    glb_names = glb_node_names(glb_path)
    missing_glb_face_cards = [name for name in left_out if name not in glb_names]
    if missing_glb_face_cards:
        raise SystemExit("proof GLB lost face cards: " + ", ".join(missing_glb_face_cards))
    record["proofGlbFaceCards"] = {"included": left_out, "missing": [],
                                    "note": "proof GLB only; the VPM3 runtime still excludes alpha cards"}
    record["glbBytes"] = os.path.getsize(glb_path)
    with open(os.path.join(out, "hero-export.json"), "w") as f:
        json.dump(record, f, indent=1)
    print("HERO_EXPORT_OK", json.dumps({k: record[k] for k in ("lod0", "lod1", "eyes")})[:900])


main()
