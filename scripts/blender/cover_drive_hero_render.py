"""Cover-drive P2 at-rest captures (Appendix B), rendered in Blender under one fixed day light.

Usage:
  blender -b --factory-startup --python-exit-code 3 --python scripts/blender/cover_drive_hero_render.py -- \
      <hero.blend> <current-hero.obj | -> <out-dir> [--video]

Renders, at 1920x1080 and 915x412, from four fixed cameras placed relative to each hero's own feet:
  body-front (camera square on the off side, facing the chest), body-side (from the bowler's end), face (close-up,
  from the bowler's end, where the head is turned) and stance (three-quarter).
Passes: the candidate hero textured; the candidate in a uniform clay material; and, when an OBJ of the current
production hero is given (CoverDriveCaptureRig.ExportCurrentHeroAtRest), the current hero in the same clay material,
the same light and the same camera placement, so geometry, proportion and posture compare like for like.
--video also renders the candidate's idle (10 s, 60 fps, 960x540, body-front) as numbered frames.
Writes render-meta.json with every light, camera and engine setting.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

LIGHT = {"sunElevationDeg": 48.0, "sunAzimuthDeg": -35.0, "sunStrength": 3.0, "sunAngleDeg": 1.2,
         "sunColour": [1.0, 0.96, 0.9], "skyColour": [0.55, 0.68, 0.86], "skyStrength": 0.9,
         "groundColour": [0.20, 0.30, 0.14], "clayColour": [0.62, 0.60, 0.57]}
SIZES = [("1920x1080", 1920, 1080), ("915x412", 915, 412)]


def args():
    """-- <hero.blend> <current.obj|-> <out-dir> [--video] [--prefix candidate] [--no-clay] [--views a,b]"""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 3:
        raise SystemExit("usage: -- <hero.blend> <current.obj|-> <out-dir> [--video] [--prefix p] [--no-clay] [--views a,b]")
    rest = argv[3:]
    opts = {"video": "--video" in rest, "clay": "--no-clay" not in rest, "prefix": "candidate", "views": None}
    if "--prefix" in rest:
        opts["prefix"] = rest[rest.index("--prefix") + 1]
    if "--views" in rest:
        opts["views"] = rest[rest.index("--views") + 1].split(",")
    return argv[0], (None if argv[1] == "-" else argv[1]), argv[2], opts


def engine():
    items = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for e in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        if e in items:
            return e
    return "CYCLES"


def _srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# Region roles and sRGB colours read (read-only) from UNITY's VandeProductionCharacter.shader regionColour(): 4 pads,
# 5 gloves, 6 helmet shell, 7 metal grille, 13 straps, 14 helmet padding. The Unity project is in gamma colour space,
# so the sRGB values are converted to linear for Blender. Same table as cover_drive_hero.py.
GEAR_PALETTE = {k: _srgb_to_linear(v) for k, v in {
    4: (0.90, 0.89, 0.83), 5: (0.84, 0.82, 0.76), 6: (0.035, 0.106, 0.188), 7: (0.66, 0.69, 0.72),
    13: (0.08, 0.09, 0.11), 14: (0.08, 0.075, 0.07)}.items()}


def apply_gear_palette():
    """Gear region colours (UNITY's shader roles), applied at render time so every build renders with the same
    palette, including builds made before the palette was corrected."""
    for m in bpy.data.materials:
        if m.name.startswith("VANDE_gear_region_") and m.use_nodes:
            region = int(m.name.split("_")[-1].split(".")[0])
            colour = GEAR_PALETTE.get(region)
            bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if colour and bsdf is not None:
                bsdf.inputs["Base Color"].default_value = (*colour, 1.0)


# The kit the game ships (P2 r4, lead ruling): UNITY's regionColour() for region 1 (jersey: _KitPrimary navy with
# _KitSecondary chevron, placket, rear yoke and side seams) and region 2 (trousers: _Trousers with a side seam), in
# Unity bind space (x lateral, y up, z forward), read only from VandeProductionCharacter.shader. Computed in sRGB as
# the gamma-space shader does, then converted to linear. Per-vertex, so the chevron edge is softer than the shader's
# per-pixel band; the sub-percent weave and fold terms are left out. Regions follow the exporter: casual-suit vertices
# whose dominant bone is root, pelvis, upper or lower leg are trousers (2), the rest jersey (1).
KIT_SRGB = {"primary": (0.055, 0.19, 0.34), "secondary": (0.93, 0.52, 0.12), "trousers": (0.035, 0.11, 0.20)}
KIT_DETAIL = 0.72
LOWER_PREFIXES = ("pelvis.", "upperleg", "lowerleg")


def _smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def _mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def kit_colour_srgb(region, x, y, z):
    if region == 2:
        seam = 1.0 - _smoothstep(0.008, 0.020, abs(abs(x) - 0.115))
        return tuple(c * (1.0 + seam * 0.035) for c in KIT_SRGB["trousers"])
    front = _smoothstep(0.03, 0.08, z)
    rear = 1.0 - _smoothstep(-0.06, 0.015, z)
    chevron = (1.0 - _smoothstep(0.012, 0.032, abs(y - 1.34 + abs(x) * 0.62))) * front
    placket = ((1.0 - _smoothstep(0.007, 0.016, abs(x))) * _smoothstep(1.29, 1.37, y) *
               (1.0 - _smoothstep(1.51, 1.58, y)) * front)
    yoke = (1.0 - _smoothstep(0.010, 0.026, abs(y - 1.505 + abs(x) * 0.15))) * rear
    seam = ((1.0 - _smoothstep(0.010, 0.024, abs(abs(x) - 0.185))) * _smoothstep(1.17, 1.28, y) *
            (1.0 - _smoothstep(1.54, 1.61, y)))
    kit = _mix(KIT_SRGB["primary"], KIT_SRGB["secondary"], chevron * 0.9)
    kit = _mix(kit, KIT_SRGB["secondary"], yoke * 0.18 * KIT_DETAIL)
    kit = _mix(kit, KIT_SRGB["secondary"], seam * 0.14 * KIT_DETAIL)
    return _mix(kit, KIT_SRGB["secondary"], placket * 0.26)


def apply_kit_palette():
    """Paint the casual suit with the shipped kit colours (a point colour attribute feeding the kit material)."""
    counts = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH" or "casualsuit" not in obj.name.lower():
            continue
        names = {g.index: g.name for g in obj.vertex_groups}
        attr = obj.data.color_attributes.get("vande_kit") or obj.data.color_attributes.new("vande_kit", "FLOAT_COLOR",
                                                                                             "POINT")
        mw = obj.matrix_world
        n1 = n2 = 0
        for v in obj.data.vertices:
            weights = [(g.weight, names.get(g.group, "")) for g in v.groups if g.weight > 1e-6]
            dominant = max(weights)[1] if weights else ""
            region = 2 if dominant == "root" or dominant.startswith(LOWER_PREFIXES) else 1
            p = mw @ v.co
            c = _srgb_to_linear(kit_colour_srgb(region, p.x, p.z, -p.y))
            attr.data[v.index].color = (*c, 1.0)
            n1 += region == 1
            n2 += region == 2
        for slot in obj.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue
            node = nt.nodes.new("ShaderNodeAttribute")
            node.attribute_type = "GEOMETRY"
            node.attribute_name = "vande_kit"
            nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = 0.9
        counts[obj.name] = {"jerseyVertices": n1, "trouserVertices": n2}
    return counts


def setup_world(scene):
    scene.render.engine = engine()
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = 64
    else:
        try:
            scene.eevee.taa_render_samples = 64
        except AttributeError:
            pass
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("VANDE_day") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (*LIGHT["skyColour"], 1.0)
    bg.inputs["Strength"].default_value = LIGHT["skyStrength"]
    sun_data = bpy.data.lights.new("VANDE_sun", "SUN")
    sun_data.energy = LIGHT["sunStrength"]
    sun_data.color = LIGHT["sunColour"]
    sun_data.angle = math.radians(LIGHT["sunAngleDeg"])
    sun = bpy.data.objects.new("VANDE_sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(90 - LIGHT["sunElevationDeg"]), 0.0, math.radians(LIGHT["sunAzimuthDeg"]))
    bpy.ops.mesh.primitive_plane_add(size=40.0, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "VANDE_ground"
    gm = bpy.data.materials.new("VANDE_ground")
    gm.use_nodes = True
    bsdf = next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*LIGHT["groundColour"], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    ground.data.materials.append(gm)


def clay():
    m = bpy.data.materials.new("VANDE_clay")
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*LIGHT["clayColour"], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.7
    return m


def cameras_for(feet_mid, head):
    h = feet_mid + Vector((0.0, 0.0, 0.92))
    return {
        "body-front": (h + Vector((0.55, -4.6, 0.05)), h + Vector((0.05, 0.0, 0.0)), 28.0),
        "body-side": (h + Vector((4.6, -0.35, 0.05)), h + Vector((0.0, -0.1, 0.0)), 28.0),
        "stance": (h + Vector((3.1, -3.6, 0.35)), h + Vector((0.0, -0.08, 0.0)), 28.0),
        "face": (head + Vector((0.80, -0.22, 0.02)), head + Vector((0.0, 0.0, -0.01)), 22.0),
    }


def place_camera(scene, cam, eye, target, fov_deg):
    """fov_deg is the VERTICAL field of view, so the full body fits every aspect ratio."""
    cam.data.sensor_fit = "VERTICAL"
    cam.location = eye
    direction = (target - eye).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.angle = math.radians(fov_deg)
    scene.camera = cam


def render(scene, path, w, h):
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def hero_objects():
    return [o for o in bpy.data.objects if o.type == "MESH" and o.name not in ("VANDE_ground",)
            and not o.name.startswith("current_")]


def evaluated_points(objs):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        pts.extend(o.matrix_world @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    return pts


def feet_and_head(objs):
    pts = evaluated_points(objs)
    low = [p for p in pts if p.z < 0.10]
    mid = sum(low, Vector()) / max(1, len(low))
    mid.z = 0.0
    top = max(p.z for p in pts)
    head_pts = [p for p in pts if p.z > top - 0.25]
    head = sum(head_pts, Vector()) / max(1, len(head_pts))
    head.z = top - 0.12
    return mid, head


def import_current(obj_path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=obj_path, forward_axis="NEGATIVE_Z", up_axis="Y")
    objs = [o for o in bpy.data.objects if o not in before]
    for o in objs:
        o.name = "current_" + o.name
    # Unity +Z (the rig's forward) maps to Blender -Y through the OBJ export (x mirrored) and this import, which is
    # the MPFB front too, so the current hero needs no re-orientation.
    bpy.context.view_layer.update()
    return objs


def set_hidden(objs, hidden):
    for o in objs:
        o.hide_render = hidden
        o.hide_viewport = hidden


def override_material(objs, mat):
    saved = {}
    for o in objs:
        saved[o.name] = [s.material for s in o.material_slots]
        if not o.material_slots:
            o.data.materials.append(mat)
        for s in o.material_slots:
            s.material = mat
    return saved


def restore_material(objs, saved):
    for o in objs:
        for s, m in zip(o.material_slots, saved.get(o.name, [])):
            s.material = m


def main():
    blend, current_obj, out, opts = args()
    video = opts["video"]
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=blend)
    scene = bpy.context.scene
    scene.frame_set(1)
    apply_gear_palette()
    kit_counts = apply_kit_palette()
    setup_world(scene)
    cam = bpy.data.objects.new("VANDE_camera", bpy.data.cameras.new("VANDE_camera"))
    scene.collection.objects.link(cam)
    cam.data.clip_start = 0.05
    candidate = [o for o in hero_objects() if not o.hide_render]
    mid, head = feet_and_head([o for o in candidate if o.name != "VANDE_bat" and not o.name.startswith("VANDE_gear")])
    views = cameras_for(mid, head)
    if opts["views"]:
        views = {k: v for k, v in views.items() if k in opts["views"]}
    clay_mat = clay()
    files = []
    for view, (eye, target, fov) in views.items():
        place_camera(scene, cam, eye, target, fov)
        for label, w, h in SIZES:
            path = os.path.join(out, "%s-%s-%s.jpg" % (opts["prefix"], view, label))
            render(scene, path, w, h)
            files.append(os.path.basename(path))
    if opts["clay"]:
        saved = override_material(candidate, clay_mat)
        for view, (eye, target, fov) in views.items():
            place_camera(scene, cam, eye, target, fov)
            path = os.path.join(out, "clay-%s-%s-1920x1080.jpg" % (opts["prefix"], view))
            render(scene, path, 1920, 1080)
            files.append(os.path.basename(path))
        restore_material(candidate, saved)
    if current_obj and opts["clay"]:
        current = import_current(current_obj)
        set_hidden(candidate, True)
        override_material(current, clay_mat)
        gear = [o for o in current if "Gear" in o.name]
        body_only = [o for o in current if o not in gear]
        cmid, chead = feet_and_head([o for o in body_only if "Bat" not in o.name])
        for variant, hidden in (("current", gear), ("current-geared", [])):
            set_hidden(current, False)
            set_hidden(hidden, True)
            for view, (eye, target, fov) in cameras_for(cmid, chead).items():
                place_camera(scene, cam, eye, target, fov)
                path = os.path.join(out, "clay-%s-%s-1920x1080.jpg" % (variant, view))
                render(scene, path, 1920, 1080)
                files.append(os.path.basename(path))
        set_hidden(current, True)
        set_hidden(candidate, False)
    if video:
        for view in ("body-front",):
            eye, target, fov = views[view]
            place_camera(scene, cam, eye, target, fov)
            frames_dir = os.path.join(out, "idle-%s-%s" % (opts["prefix"], view))
            os.makedirs(frames_dir, exist_ok=True)
            scene.render.resolution_x, scene.render.resolution_y = 960, 540
            scene.render.image_settings.file_format = "JPEG"
            scene.render.filepath = os.path.join(frames_dir, "")
            scene.frame_start, scene.frame_end = 1, 600
            bpy.ops.render.render(animation=True)
    meta = {"engine": scene.render.engine, "blender": bpy.app.version_string, "light": LIGHT,
            "cameras": {k: {"eye": list(v[0]), "target": list(v[1]), "fovDeg": v[2]} for k, v in views.items()},
            "colourManagement": scene.view_settings.view_transform, "files": files,
            "kitPalette": {"source": "VandeProductionCharacter.shader regionColour() regions 1-2, sRGB to linear",
                           "srgb": KIT_SRGB, "kitDetail": KIT_DETAIL, "counts": kit_counts},
            "classification": "BUILDER_OBSERVATION_NON_HUMAN"}
    with open(os.path.join(out, "render-meta-%s.json" % opts["prefix"]), "w") as f:
        json.dump(meta, f, indent=1)
    print("HERO_RENDER_OK", len(files))


main()
