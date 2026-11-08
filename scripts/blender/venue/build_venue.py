"""VANDE venue builder (ASSETS-VENUE): one 6-degree wedge of the stadium bowl, at two levels of detail, plus the gap wedge.

Original geometry generated from code (no downloaded model, no third-party texture). The wedge is the repeating module of
the baked venue: two stepped tiers (14 and 13 rows), the back wall, the parapet and the roof with its trusses, centred on
azimuth 0 so that the web stage and Unity place 60 of them by rotating about +Y. Level 2 is the gap wedge (back wall,
parapet and roof only, no tiers): the three wedges behind each end, where the sight screen stands, take it. Ambient occlusion is computed per vertex
with a BVH ray cast against the wedge and its neighbours (no GPU, no Cycles), so the ring shades as one piece.

The numbers are those of src/render3d/core/venueGeometry.ts (a unit test compares the `constants` block written here).

Usage (from the repository root):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 3 \
      --python scripts/blender/venue/build_venue.py -- <out-dir> [--fbx]

Writes <out-dir>/wedge.json (the input of scripts/venue/pack.mjs: positions, UVs, vertex colours = baked AO, indices, per LOD)
and, with --fbx, <out-dir>/wedge-lod0.fbx and wedge-lod1.fbx for Unity.

Frames: the file uses the web stage's world frame (+Y up, azimuth 0 towards +z, (r sin a, y, r cos a)); Blender objects are
created as (x, -z, y) so that Blender's glTF/FBX axis conversion (and the Unity export) returns the same orientation.
UVs follow the glTF convention (v down from the top of the image); the atlas has two rows (lower tier, upper tier) of
VARIANTS tiles; every tier vertex carries tier = 1 so the web shader can shift a whole instance to another variant.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BOUNDARY_R = 62.0
WEDGE = math.pi / 30.0  # 6 degrees
HW = WEDGE / 2.0
WEDGES = 60
VARIANTS = 4
TIERS = {
    "lower": {"r0": BOUNDARY_R + 8, "r1": BOUNDARY_R + 27, "y0": 1.2, "y1": 10.5, "rows": 14},
    "upper": {"r0": BOUNDARY_R + 30, "r1": BOUNDARY_R + 47, "y0": 13.5, "y1": 27.0, "rows": 13},
}
ROOF = {"rInner": BOUNDARY_R + 37, "rOuter": BOUNDARY_R + 48.5, "y": 30.6, "h": 5.5}
BACK_WALL = {"r": BOUNDARY_R + 47.6, "y0": 24.0, "y1": 29.0}
PARAPET = {"r": BOUNDARY_R + 7.5, "y0": 0.0, "y1": 1.6}
# Atlas: two rows (lower, upper) of VARIANTS tiles, glTF uv convention; a 4 x 4 px white patch in the bottom-right corner
# (WHITE_UV) for every surface that is not a crowd tier.
ATLAS_W, ATLAS_H = 1024, 512
WHITE_UV = (1.0 - 2.0 / ATLAS_W, 1.0 - 2.0 / ATLAS_H)
BASE = {
    "wall": (0.15, 0.16, 0.26),
    "parapet": (0.12, 0.17, 0.23),
    "roof_under": (0.09, 0.08, 0.23),
    "roof_top": (0.19, 0.20, 0.31),
    "truss": (0.11, 0.11, 0.21),
}
AO_RAYS = int(os.environ.get("VENUE_AO_RAYS", "24"))  # 24 for the shipped bake; fewer only for quick dry runs
AO_DISTANCE = 12.0
AO_FLOOR = 0.5


def P(a, r, y):
    return (math.sin(a) * r, y, math.cos(a) * r)


def blender_vec(p):
    return Vector((p[0], -p[2], p[1]))


def tile_rect(tier, variant):
    """uv rectangle (u0, v0, u1, v1) of a tile, glTF convention."""
    row = 0 if tier == "lower" else 1
    return (variant / VARIANTS, row * 0.5, (variant + 1) / VARIANTS, (row + 1) * 0.5)


class Soup:
    def __init__(self):
        self.pos, self.uv, self.tier, self.base, self.idx = [], [], [], [], []
        self._key = {}

    def vertex(self, p, uv, tier, base):
        key = (round(p[0], 4), round(p[1], 4), round(p[2], 4), round(uv[0], 5), round(uv[1], 5), tier, base)
        i = self._key.get(key)
        if i is None:
            i = len(self.pos)
            self._key[key] = i
            self.pos.append(p)
            self.uv.append(uv)
            self.tier.append(tier)
            self.base.append(base)
        return i

    def tri(self, a, b, c, facing):
        pa, pb, pc = (Vector(self.pos[i]) for i in (a, b, c))
        if (pb - pa).cross(pc - pa).dot(Vector(facing)) < 0:
            b, c = c, b
        self.idx += [a, b, c]

    def quad(self, vs, facing):
        self.tri(vs[0], vs[1], vs[2], facing)
        self.tri(vs[0], vs[2], vs[3], facing)

    def normals(self):
        acc = [Vector((0.0, 0.0, 0.0)) for _ in self.pos]
        for t in range(0, len(self.idx), 3):
            a, b, c = self.idx[t : t + 3]
            pa, pb, pc = (Vector(self.pos[i]) for i in (a, b, c))
            n = (pb - pa).cross(pc - pa)
            for i in (a, b, c):
                acc[i] += n
        return [n.normalized() if n.length > 1e-9 else Vector((0.0, 1.0, 0.0)) for n in acc]


def tier_uv(tier, a, y, variant=0):
    t = TIERS[tier]
    u0, v0, u1, v1 = tile_rect(tier, variant)
    fu = (a + HW) / WEDGE
    fh = (y - t["y0"]) / (t["y1"] - t["y0"])
    return (u0 + fu * (u1 - u0), v0 + (1.0 - fh) * (v1 - v0))


def build(lod):
    """The wedge at a level of detail: lod 0 steps the rows (3 segments across), lod 1 slopes each tier (2 segments), lod 2 has
    no tiers (the gap behind the sight screens: back wall, parapet and roof)."""
    s = Soup()
    seg = 3 if lod == 0 else 2
    angles = [-HW + WEDGE * i / seg for i in range(seg + 1)]

    def tier_vertex(tier, a, r, y):
        return s.vertex(P(a, r, y), tier_uv(tier, a, y), 1, (1.0, 1.0, 1.0))

    def flat_vertex(a, r, y, base):
        return s.vertex(P(a, r, y), WHITE_UV, 0, base)

    for name, t in TIERS.items():
        if lod == 2:
            break
        if lod == 0:
            for k in range(t["rows"]):
                ra = t["r0"] + (t["r1"] - t["r0"]) * k / t["rows"]
                rb = t["r0"] + (t["r1"] - t["r0"]) * (k + 1) / t["rows"]
                ya = t["y0"] + (t["y1"] - t["y0"]) * k / t["rows"]
                yb = t["y0"] + (t["y1"] - t["y0"]) * (k + 1) / t["rows"]
                for i in range(seg):
                    a0, a1 = angles[i], angles[i + 1]
                    am = (a0 + a1) / 2
                    toward_field = (-math.sin(am), 0.0, -math.cos(am))
                    s.quad(
                        [tier_vertex(name, a0, ra, ya), tier_vertex(name, a1, ra, ya), tier_vertex(name, a1, ra, yb), tier_vertex(name, a0, ra, yb)],
                        toward_field,
                    )
                    s.quad(
                        [tier_vertex(name, a0, ra, yb), tier_vertex(name, a1, ra, yb), tier_vertex(name, a1, rb, yb), tier_vertex(name, a0, rb, yb)],
                        (0.0, 1.0, 0.0),
                    )
        else:
            dr, dy = t["r1"] - t["r0"], t["y1"] - t["y0"]
            for i in range(seg):
                a0, a1 = angles[i], angles[i + 1]
                am = (a0 + a1) / 2
                s.quad(
                    [tier_vertex(name, a0, t["r0"], t["y0"]), tier_vertex(name, a1, t["r0"], t["y0"]), tier_vertex(name, a1, t["r1"], t["y1"]), tier_vertex(name, a0, t["r1"], t["y1"])],
                    (-math.sin(am) * dy, dr, -math.cos(am) * dy),
                )

    for i in range(seg):
        a0, a1 = angles[i], angles[i + 1]
        am = (a0 + a1) / 2
        inward = (-math.sin(am), 0.0, -math.cos(am))
        w = BACK_WALL
        s.quad([flat_vertex(a0, w["r"], w["y0"], BASE["wall"]), flat_vertex(a1, w["r"], w["y0"], BASE["wall"]), flat_vertex(a1, w["r"], w["y1"], BASE["wall"]), flat_vertex(a0, w["r"], w["y1"], BASE["wall"])], inward)
        p = PARAPET
        s.quad([flat_vertex(a0, p["r"], p["y0"], BASE["parapet"]), flat_vertex(a1, p["r"], p["y0"], BASE["parapet"]), flat_vertex(a1, p["r"], p["y1"], BASE["parapet"]), flat_vertex(a0, p["r"], p["y1"], BASE["parapet"])], inward)
        rf = ROOF
        low, high = rf["y"] - rf["h"] / 2, rf["y"] + rf["h"] / 2
        under = [flat_vertex(a0, rf["rOuter"], low, BASE["roof_under"]), flat_vertex(a1, rf["rOuter"], low, BASE["roof_under"]), flat_vertex(a1, rf["rInner"], high, BASE["roof_under"]), flat_vertex(a0, rf["rInner"], high, BASE["roof_under"])]
        s.quad(under, (0.0, -1.0, 0.0))
        top = [flat_vertex(a0, rf["rOuter"], low, BASE["roof_top"]), flat_vertex(a1, rf["rOuter"], low, BASE["roof_top"]), flat_vertex(a1, rf["rInner"], high, BASE["roof_top"]), flat_vertex(a0, rf["rInner"], high, BASE["roof_top"])]
        s.quad(top, (0.0, 1.0, 0.0))

    if lod == 0:
        # Three trusses under the roof: thin square bars from the back of the roof to its lip.
        rf = ROOF
        low, high = rf["y"] - rf["h"] / 2, rf["y"] + rf["h"] / 2
        c = BASE["truss"]
        for a in (-HW * 0.66, 0.0, HW * 0.66):
            hw = 0.14 / rf["rInner"]
            corners = ((-hw, 0.0), (hw, 0.0), (hw, -0.5), (-hw, -0.5))
            ends = [(flat_vertex(a + da, rf["rOuter"], low + dy, c), flat_vertex(a + da, rf["rInner"], high + dy, c)) for da, dy in corners]
            tangent = (math.cos(a), 0.0, -math.sin(a))
            facings = ((0.0, 1.0, 0.0), tangent, (0.0, -1.0, 0.0), (-tangent[0], 0.0, -tangent[2]))
            for j in range(4):
                n = (j + 1) % 4
                s.quad([ends[j][0], ends[n][0], ends[n][1], ends[j][1]], facings[j])
    return s


def occluder_tree(soup):
    verts, faces = [], []
    for k in (-2, -1, 0, 1, 2):
        c, sn = math.cos(k * WEDGE), math.sin(k * WEDGE)
        base = len(verts)
        for (x, y, z) in soup.pos:
            # a wedge `k` places along the ring: rotate about +Y by k * WEDGE
            verts.append(Vector((x * c + z * sn, y, -x * sn + z * c)))
        for t in range(0, len(soup.idx), 3):
            faces.append(tuple(base + i for i in soup.idx[t : t + 3]))
    return BVHTree.FromPolygons(verts, faces)


def ambient_occlusion(soup, tree):
    normals = soup.normals()
    state = 12345
    out = []
    for i, p in enumerate(soup.pos):
        n = normals[i]
        t = n.cross(Vector((0.0, 1.0, 0.0)) if abs(n.y) < 0.9 else Vector((1.0, 0.0, 0.0))).normalized()
        b = n.cross(t)
        origin = Vector(p) + n * 0.03
        hits = 0
        for _ in range(AO_RAYS):
            state = (state * 1103515245 + 12345) & 0x7FFFFFFF
            u1 = state / 0x7FFFFFFF
            state = (state * 1103515245 + 12345) & 0x7FFFFFFF
            u2 = state / 0x7FFFFFFF
            rr, phi = math.sqrt(u1), 2.0 * math.pi * u2
            d = (t * (rr * math.cos(phi)) + b * (rr * math.sin(phi)) + n * math.sqrt(max(0.0, 1.0 - u1))).normalized()
            if tree.ray_cast(origin, d, AO_DISTANCE)[0] is not None:
                hits += 1
        out.append(AO_FLOOR + (1.0 - AO_FLOOR) * (1.0 - hits / AO_RAYS))
    return out


def dump(soup, ao):
    col = []
    for i, ao_i in enumerate(ao):
        base = soup.base[i]
        col += [round(base[0] * ao_i, 4), round(base[1] * ao_i, 4), round(base[2] * ao_i, 4)]
    return {
        "triangles": len(soup.idx) // 3,
        "vertices": len(soup.pos),
        "pos": [round(c, 3) for p in soup.pos for c in p],
        "uv": [round(c, 5) for uv in soup.uv for c in uv],
        "tier": soup.tier,
        "col": col,
        "idx": soup.idx,
    }


def blender_object(soup, ao, name):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(blender_vec(p)) for p in soup.pos], [], [tuple(soup.idx[t : t + 3]) for t in range(0, len(soup.idx), 3)])
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    colors = mesh.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="POINT")
    for i, ao_i in enumerate(ao):
        base = soup.base[i]
        colors.data[i].color = (base[0] * ao_i, base[1] * ao_i, base[2] * ao_i, 1.0)
    for loop in mesh.loops:
        u, v = soup.uv[loop.vertex_index]
        uv_layer.data[loop.index].uv = (u, 1.0 - v)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: build_venue.py -- <out-dir> [--fbx]")
    out = os.path.abspath(argv[0])
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    soups = [build(0), build(1), build(2)]
    tree = occluder_tree(soups[0])
    aos = [ambient_occlusion(s, tree) for s in soups]
    doc = {
        "version": 1,
        "generator": "scripts/blender/venue/build_venue.py",
        "blender": bpy.app.version_string,
        "constants": {
            "boundaryR": BOUNDARY_R,
            "wedgeRad": WEDGE,
            "wedges": WEDGES,
            "tiers": TIERS,
            "roof": ROOF,
            "backWall": BACK_WALL,
            "parapet": PARAPET,
        },
        "atlas": {"w": ATLAS_W, "h": ATLAS_H, "variants": VARIANTS, "whiteUv": WHITE_UV, "tiles": {t: [tile_rect(t, v) for v in range(VARIANTS)] for t in TIERS}},
        "lods": [dump(s, a) for s, a in zip(soups, aos)],
    }
    with open(os.path.join(out, "wedge.json"), "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print("wedge.json: " + ", ".join("lod%d %d tris %d verts" % (i, l["triangles"], l["vertices"]) for i, l in enumerate(doc["lods"])))
    if "--fbx" in argv:
        for lod, (soup, ao) in enumerate(zip(soups, aos)):
            for o in list(bpy.context.scene.objects):
                bpy.data.objects.remove(o, do_unlink=True)
            obj = blender_object(soup, ao, "VandeWedge_LOD%d" % lod)
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            path = os.path.join(out, "wedge-lod%d.fbx" % lod)
            bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"MESH"}, apply_unit_scale=True, bake_space_transform=True, axis_forward="-Z", axis_up="Y", add_leaf_bones=False, mesh_smooth_type="OFF")
            print("wrote", path, os.path.getsize(path), "bytes")


main()
