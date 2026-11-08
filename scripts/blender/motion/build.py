"""
Bakes VANDE's original motion clips to VMS1 sources (assets-src/motion/<pack>/<id>.vms.json).

  python3 scripts/blender/motion/build.py [pack ...]          bake (fast check, no Blender)
  Blender --background --factory-startup --python scripts/blender/motion/build.py -- [pack ...] [--blend DIR]
                                                              bake inside Blender 5.2 and also write an editable
                                                              .blend per pack (VC17 armature, one action per clip,
                                                              every sampled frame keyed) into DIR

Then build the binary packs with `node scripts/motion/export.mjs`.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

import vc17  # noqa: E402

PACKS = ['locomotion', 'fielder', 'fielder_actions', 'keeper']


def provenance(tool):
    return {
        'author': 'MOTION (Claude agent, for the VANDE owner)',
        'method': 'original keyframes and VANDE gait/IK authoring code; no motion capture, no third-party motion',
        'tool': tool,
        'script': 'scripts/blender/motion/build.py',
        'licence': 'owner-made original',
        'sources': [],
    }


def load_pack(name):
    mod = __import__(name)
    return mod.clips()


SRC_ROOT = os.path.join(REPO, 'assets-src', 'motion')


def bake(packs, tool):
    out = {}
    for pack in packs:
        clips = load_pack(pack)
        docs = []
        for c in clips:
            # A module may contribute to another pack's folder (fielder_actions.py -> the fielder pack).
            d = os.path.join(SRC_ROOT, c.pack)
            os.makedirs(d, exist_ok=True)
            doc = c.to_vms(provenance(tool))
            path = os.path.join(d, c.id + '.vms.json')
            with open(path, 'w') as f:
                f.write(vc17.dump(doc))
            docs.append((c, doc))
            pv = doc['provenance']['ikMaxReachErrorM']
            print(f'{c.pack}/{c.id}: {len(doc["frames"]["q"])} frames, IK reach error legs {pv["legs"]} m arms {pv["arms"]} m')
        out[pack] = docs
    return out


def blender_scene(baked, blend_dir):
    import bpy
    from mathutils import Matrix, Quaternion, Vector

    # Canonical (x, y, z) -> Blender (x, -z, y): +90 degrees about X, no mirror (MOTION-SPEC §2).
    def B(v):
        return Vector((v[0], -v[2], v[1]))

    conv = Quaternion((1.0, 0.0, 0.0), 1.5707963267948966)

    def Bq(q):
        # Rotation in canonical axes -> the same rotation in Blender axes: conv * q * conv^-1.
        return conv @ Quaternion((q[3], q[0], q[1], q[2])) @ conv.inverted()

    os.makedirs(blend_dir, exist_ok=True)
    for pack, docs in baked.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        scene.render.fps = 60
        arm = bpy.data.armatures.new('VC17')
        ob = bpy.data.objects.new('VC17', arm)
        scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode='EDIT')
        world = {}
        for b in vc17.BONES:
            p = vc17.PARENT[b]
            world[b] = vc17.OFFSET[b] if p is None else vc17.add(world[p], vc17.OFFSET[b])
        child_of = {}
        for b in vc17.BONES:
            if vc17.PARENT[b]:
                child_of.setdefault(vc17.PARENT[b], b)
        for b in vc17.BONES:
            eb = arm.edit_bones.new(b)
            eb.head = B(world[b])
            if b in ('footL', 'footR'):
                tail = vc17.add(world[b], (0.0, -0.05, 0.15))
            elif b in ('handL', 'handR'):
                tail = vc17.add(world[b], (0.0, -0.08, 0.0))
            elif b == 'head':
                tail = vc17.add(world[b], (0.0, 0.2, 0.0))
            elif b == 'hips':
                tail = world['spine']
            elif b in ('chest',):
                tail = world['neck']
            else:
                tail = world[child_of[b]]
            eb.tail = B(tail)
            eb.roll = 0.0
            if vc17.PARENT[b]:
                eb.parent = arm.edit_bones[vc17.PARENT[b]]
        bpy.ops.object.mode_set(mode='OBJECT')
        rest = {b: arm.bones[b].matrix_local.to_quaternion() for b in vc17.BONES}
        for pb in ob.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        for c, doc in docs:
            act = bpy.data.actions.new(c.id)
            act.use_fake_user = True
            ob.animation_data_create()
            ob.animation_data.action = act
            fr = doc['frames']
            step = 60 // doc['sampleRate']
            for f, (g, h, q) in enumerate(zip(fr['ground'], fr['hips'], fr['q'])):
                frame = 1 + f * step
                # Canonical world delta of each bone: D = parentD * local (rest is identity).
                D = {}
                for i, b in enumerate(vc17.BONES):
                    lq = (q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3])
                    p = vc17.PARENT[b]
                    D[b] = lq if p is None else vc17.qmul(D[p], lq)
                for i, b in enumerate(vc17.BONES):
                    pb = ob.pose.bones[b]
                    p = vc17.PARENT[b]
                    local = (q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3])
                    if p is None:
                        gq = vc17.qyaw(g[2])
                        local = vc17.qmul(gq, local)
                    # Blender basis = Rb^-1 * B(q) * Rb (MOTION-SPEC §8).
                    basis = rest[b].inverted() @ Bq(local) @ rest[b]
                    pb.rotation_quaternion = basis
                    pb.keyframe_insert('rotation_quaternion', frame=frame)
                    if p is None:
                        gq = vc17.qyaw(g[2])
                        off = vc17.add((g[0], 0.0, g[1]), vc17.qrot(gq, h))
                        pb.location = rest[b].inverted() @ B(off)
                        pb.keyframe_insert('location', frame=frame)
            for mk, mt in doc['markers'].items():
                m = scene.timeline_markers.new(f'{c.id}:{mk}', frame=1 + int(round(mt * 60)))
        path = os.path.join(blend_dir, f'vande-motion-{pack}.blend')
        bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
        print('wrote', path)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    global SRC_ROOT
    if '--src-root' in argv:
        # Drafts: bake into a scratch tree instead of the shared assets-src/motion (the packs read only the latter).
        i = argv.index('--src-root')
        SRC_ROOT = os.path.abspath(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    blend_dir = None
    if '--blend' in argv:
        i = argv.index('--blend')
        blend_dir = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    packs = [a for a in argv if not a.startswith('-')] or PACKS
    packs = [p for p in packs if os.path.exists(os.path.join(HERE, p + '.py'))]
    try:
        import bpy  # noqa: F401
        tool = 'Blender ' + '.'.join(str(x) for x in __import__('bpy').app.version)
    except ImportError:
        tool = 'python ' + sys.version.split()[0]
    baked = bake(packs, tool)
    if blend_dir:
        blender_scene(baked, blend_dir)


if __name__ == '__main__':
    main()
