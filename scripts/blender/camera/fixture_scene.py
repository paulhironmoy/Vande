"""Shared scene set-up for the camera fixtures (SYNTH-VIDEO): the room, the light, the webcam, the render settings.

Imported by build_actor.py and render_clips.py (Blender background mode). Everything here is fixed numbers, no random
numbers, so a render is repeatable on the same Blender, GPU and driver. All lengths are metres. The actor stands at the
origin facing -Y (the MakeHuman front), so a camera at -Y looking towards +Y sees the actor's front, and the actor's
own left (+X) appears on the RIGHT of an unmirrored picture, as in a real webcam stream.
"""
import math

import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swing_clips as SC  # noqa: E402

# The webcam. Horizontal field of view 62 degrees: the lens src/input/camera/constants.ts (READY) assumes.
WEBCAM = {"hfovDeg": 62.0, "heightM": SC.CAMERA_HEIGHT_M}
# Camera placements (distance, tilt, picture size, lens): one source of truth, swing_clips.CAMERA_VIEWS.
VIEWS = SC.CAMERA_VIEWS
LIGHT = {
    "wallLinear": (0.58, 0.55, 0.50),  # slightly warm light grey
    "floorLinear": (0.30, 0.24, 0.18),
    "wallDistanceM": 1.3,  # behind the actor
    "keyWatts": 700.0,
    "fillWatts": 220.0,
    "worldStrength": 0.45,
    "exposure": 0.0,  # stops; set from the look study (a global scale of every light)
}


def engine():
    items = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for e in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        if e in items:
            return e
    return "CYCLES"


def _principled(name, colour, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = roughness
    return m


def _plane(name, size_x, size_z_or_y, location, rotation, material):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size_x, size_z_or_y, 1.0)
    o.data.materials.append(material)
    return o


def _area(name, location, target, watts, size):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = watts
    d.size = size
    d.shape = "SQUARE"
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = location
    direction = Vector(target) - Vector(location)
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


def setup_render(scene, width, height, samples=24):
    scene.render.engine = engine()
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.fps = 30
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.filter_size = 1.0
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = samples
    else:
        try:
            scene.eevee.taa_render_samples = samples
        except AttributeError:
            pass
    for obj, attr in ((scene.render, "use_motion_blur"), (scene.eevee, "use_motion_blur")):
        try:
            setattr(obj, attr, False)  # motion blur OFF: a webcam in a bright room has little, and the pose model sees edges
        except AttributeError:
            pass
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = LIGHT["exposure"]
    scene.view_settings.gamma = 1.0


def clear_room():
    """Removes the room objects (FIX_wall, FIX_floor, FIX_key, FIX_fill) so build_room can recreate them with the current numbers."""
    for o in list(bpy.data.objects):
        if o.name.startswith(("FIX_wall", "FIX_floor", "FIX_key", "FIX_fill")):
            bpy.data.objects.remove(o, do_unlink=True)


def build_room(scene):
    """Wall, floor, key and fill light, a grey world. Returns the created objects."""
    made = []
    wall = _principled("FIX_wall", LIGHT["wallLinear"], 0.92)
    floor = _principled("FIX_floor", LIGHT["floorLinear"], 0.85)
    # The wall faces -Y (towards the camera): a plane turned +90 degrees about X has its normal on -Y.
    made.append(_plane("FIX_wall", 9.0, 5.0, (0.0, LIGHT["wallDistanceM"], 2.0), (math.radians(90), 0.0, 0.0), wall))
    made.append(_plane("FIX_floor", 9.0, 9.0, (0.0, -1.0, 0.0), (0.0, 0.0, 0.0), floor))
    made.append(_area("FIX_key", (-1.5, -2.3, 2.6), (0.0, 0.0, 1.4), LIGHT["keyWatts"], 2.0))
    made.append(_area("FIX_fill", (1.9, -2.0, 1.5), (0.0, 0.0, 1.3), LIGHT["fillWatts"], 2.5))
    world = bpy.data.worlds.new("FIX_world") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.62, 0.64, 0.66, 1.0)
    bg.inputs["Strength"].default_value = LIGHT["worldStrength"]
    return made


def make_camera(scene, view="mid"):
    v = VIEWS[view]
    cam = bpy.data.objects.new("FIX_camera", bpy.data.cameras.new("FIX_camera"))
    scene.collection.objects.link(cam)
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.angle = math.radians(v["hfovDeg"])
    cam.data.clip_start = 0.05
    cam.data.clip_end = 40.0
    cam.location = (0.0, -v["distanceM"], WEBCAM["heightM"])
    cam.rotation_euler = (math.radians(90.0 + v["tiltDeg"]), 0.0, 0.0)
    scene.camera = cam
    scene.render.resolution_x = v["width"]
    scene.render.resolution_y = v["height"]
    return cam


def project_to_pixels(scene, cam, world_point):
    """World point to picture pixels (x right, y down, origin top-left) and the depth in metres."""
    from bpy_extras.object_utils import world_to_camera_view

    co = world_to_camera_view(scene, cam, Vector(world_point))
    w = scene.render.resolution_x
    h = scene.render.resolution_y
    return (co.x * w, (1.0 - co.y) * h, co.z)
