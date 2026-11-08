"""Read VANDE's VSK1 skeleton and VPM3 skinned-mesh files (formats of scripts/export-unity-production-character-v3.mjs).

Pure Python (no bpy), so Blender scripts and plain python3 can both use it. Positions are Unity coordinates (metres,
y up), exactly as the Node exporters wrote them.

VSK1: 32-byte header ('VSK1', u16 version, u16 bone count, u16 record bytes, u16 0, u32 0, 8-byte skeleton id,
u64 0), then per bone: i16 parent, u16 semantic, 3 f32 local position, 4 f32 local rotation (x, y, z, w).
VPM3: 32-byte header ('VPM3', u16 version, u16 bone count, u32 vertex count, u32 index count, u16 vertex bytes,
u8 influences, u8 index bytes, 8-byte skeleton id, u32 0), then 72-byte vertices (position, normal, tangent(4),
bindPos, uv, u8 region, 4 u8 bones, 4 u8 weights summing to 255, 3 pad) and u16 indices.
"""

import struct


def read_vsk1(path):
    b = open(path, "rb").read()
    if b[:4] != b"VSK1":
        raise ValueError("not a VSK1 file: " + path)
    version, count, record = struct.unpack_from("<HHH", b, 4)
    skeleton_id = b[16:24].hex()
    bones = []
    for i in range(count):
        o = 32 + i * record
        parent, semantic = struct.unpack_from("<hH", b, o)
        local = struct.unpack_from("<3f", b, o + 4)
        rot = struct.unpack_from("<4f", b, o + 16)
        bones.append({"parent": parent, "semantic": semantic, "local": local, "rotation": rot})
    # World positions (VPM3/VSK1 v1 records identity rotations, so world = sum of local offsets).
    for i, bone in enumerate(bones):
        if bone["parent"] < 0:
            bone["world"] = tuple(bone["local"])
        else:
            p = bones[bone["parent"]]["world"]
            bone["world"] = (p[0] + bone["local"][0], p[1] + bone["local"][1], p[2] + bone["local"][2])
    return {"version": version, "skeletonId": skeleton_id, "bones": bones}


def read_vpm3(path):
    b = open(path, "rb").read()
    if b[:4] != b"VPM3":
        raise ValueError("not a VPM3 file: " + path)
    version, bone_count, vcount, icount, vbytes, influences, ibytes = struct.unpack_from("<HHIIHBB", b, 4)
    skeleton_id = b[20:28].hex()
    vertices = []
    for i in range(vcount):
        o = 32 + i * vbytes
        position = struct.unpack_from("<3f", b, o)
        normal = struct.unpack_from("<3f", b, o + 12)
        tangent = struct.unpack_from("<4f", b, o + 24)
        bind = struct.unpack_from("<3f", b, o + 40)
        uv = struct.unpack_from("<2f", b, o + 52)
        region = b[o + 60]
        bones = list(b[o + 61:o + 65])
        weights = list(b[o + 65:o + 69])
        vertices.append({"position": position, "normal": normal, "tangent": tangent, "bindPos": bind, "uv": uv,
                         "region": region, "bones": bones, "weights": weights})
    base = 32 + vcount * vbytes
    indices = list(struct.unpack_from("<%dH" % icount, b, base))
    return {"version": version, "boneCount": bone_count, "skeletonId": skeleton_id, "vertices": vertices,
            "indices": indices}
