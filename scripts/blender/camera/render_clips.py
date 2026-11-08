"""Poses the camera-fixture actor from VC17 clips and renders the frames (SYNTH-VIDEO). Blender background mode.

Usage (run through the shared heavy-job wrapper; one job renders every clip, so Blender starts once):
  Blender -b --factory-startup --python-exit-code 3 --python scripts/blender/camera/render_clips.py -- \
      <actor.blend> <out-dir> [--clips id,id,...] [--samples 24] [--sheet id] [--skip-done]

Writes <out-dir>/frames/<clip>/0000.png ..., <out-dir>/gt/<clip>.gt.json (the picture position of every shoulder, elbow, wrist,
hip and the head, taken from the posed body: the ground truth the pose model is compared with) and <out-dir>/render-meta.json.
--sheet id[,id] renders eight frames of each named clip across its stroke (sheet/<id>-NN.png) to look at the pose, nothing else.

How the pose gets onto the body. The clip is VC17 (swing_clips.py): 17 local quaternions per frame. FK gives the world rotation of
every VC17 bone. The torso, neck and head bones of the 75-bone body take that world rotation (shared geodesically over the bones
that cover one VC17 bone) on top of their own rest orientation; every arm and leg segment is AIMED along the world direction of the
matching VC17 limb bone (so the body's A-pose rest and its slightly longer arms do not matter); the feet take the world rotation;
twist bones, fingers and clavicles follow their parents. The hips offset moves the root. Nothing about the ball, a result or the
mapper is used anywhere.
"""
import json
import math
import os
import sys
import time

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fixture_scene as FS  # noqa: E402
import swing_clips as SC  # noqa: E402

vc17 = SC.vc17

CONV = Quaternion((1.0, 0.0, 0.0), math.pi / 2.0)  # canonical (x, y, z) -> Blender (x, -z, y), MOTION-SPEC section 2


def q_blender(q):
    """A canonical rotation (x, y, z, w) as a Blender-axes quaternion."""
    return CONV @ Quaternion((q[3], q[0], q[1], q[2])) @ CONV.inverted()


def v_blender(v):
    return Vector((v[0], -v[2], v[1]))


# Hero bone -> VC17 bone groups.
TORSO_GROUPS = [  # (previous VC17 bone, VC17 bone, [(hero bone, fraction of the way from previous to this)])
    (None, 'hips', [('root', 1.0)]),
    ('hips', 'spine', [('spine05', 0.5), ('spine04', 1.0)]),
    ('spine', 'chest', [('spine03', 1 / 3), ('spine02', 2 / 3), ('spine01', 1.0)]),
    ('chest', 'neck', [('neck01', 1 / 3), ('neck02', 2 / 3), ('neck03', 1.0)]),
    ('neck', 'head', [('head', 1.0)]),
]
AIM = {  # hero bone -> VC17 limb bone whose world direction (local -Y) it takes
    'upperarm01.L': 'upperArmL', 'lowerarm01.L': 'forearmL', 'upperarm01.R': 'upperArmR', 'lowerarm01.R': 'forearmR',
    'upperleg01.L': 'thighL', 'lowerleg01.L': 'shinL', 'upperleg01.R': 'thighR', 'lowerleg01.R': 'shinR',
}
FOOT = {'foot.L': 'footL', 'foot.R': 'footR'}
GT_BONES = {  # name -> hero bone whose head is the joint
    'shoulderL': 'upperarm01.L', 'shoulderR': 'upperarm01.R', 'elbowL': 'lowerarm01.L', 'elbowR': 'lowerarm01.R',
    'wristL': 'wrist.L', 'wristR': 'wrist.R', 'hipL': 'upperleg01.L', 'hipR': 'upperleg01.R',
    'kneeL': 'lowerleg01.L', 'kneeR': 'lowerleg01.R', 'head': 'head',
}
SHEET_TIMES = [0.5, 1.7, 2.1, 2.25, 2.35, 2.6, 3.2, 3.9]


def log(*parts):
    print('[render]', time.strftime('%H:%M:%S', time.gmtime()), *parts, flush=True)


class Actor:
    def __init__(self):
        self.rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        self.rig.rotation_mode = 'QUATERNION'
        ident = Matrix.Identity(4)
        if any(abs(self.rig.matrix_world[i][j] - ident[i][j]) > 1e-5 for i in range(4) for j in range(4)):
            raise SystemExit('the rig object is not at the identity transform')
        for pb in self.rig.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        self.rest = {b.name: b.matrix_local.to_3x3() for b in self.rig.data.bones}
        self.rest_head = {b.name: b.head_local.copy() for b in self.rig.data.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in self.rig.data.bones}
        order = []
        seen = set()

        def visit(name):
            if name in seen:
                return
            if self.parent[name]:
                visit(self.parent[name])
            seen.add(name)
            order.append(name)

        for b in self.rig.data.bones:
            visit(b.name)
        self.order = order
        self.shoes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('FIX_shoes')]
        self.meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('FIX_wall')
                       and not o.name.startswith('FIX_floor')]
        self.ground_fix = 0.0

    def targets(self, frame):
        """World deltas (Quaternion) and limb directions (Vector) of VC17 for one authored frame (Blender axes)."""
        local = {b: tuple(frame['q'][k * 4:k * 4 + 4]) for k, b in enumerate(vc17.BONES)}
        ground = tuple(frame['ground'])
        hips_off = tuple(frame['hips'])
        P, W = vc17.fk(ground, hips_off, local)
        D = {b: q_blender(W[b]) for b in vc17.BONES}
        down = {b: (q_blender(W[b]) @ Vector((0.0, 0.0, -1.0))) for b in vc17.BONES}  # canonical -Y limb axis in Blender axes
        move = v_blender((hips_off[0] + ground[0], hips_off[1], hips_off[2] + ground[1]))
        return D, down, move

    def pose(self, frame):
        D, down, move = self.targets(frame)
        # Desired cumulative world delta per hero bone for the torso chain, geodesic shares.
        delta = {}
        for prev, cur, bones in TORSO_GROUPS:
            d0 = D[prev] if prev else Quaternion()
            for hero, frac in bones:
                delta[hero] = d0.slerp(D[cur], frac)
        Q = {}  # posed armature-space orientation of every hero bone (3x3)
        for name in self.order:
            par = self.parent[name]
            follow = (Q[par] @ self.rest[par].inverted() @ self.rest[name]) if par else self.rest[name]
            if name in delta:
                Q[name] = delta[name].to_matrix() @ self.rest[name]
            elif name in FOOT:
                Q[name] = D[FOOT[name]].to_matrix() @ self.rest[name]
            elif name in AIM:
                cur = follow @ Vector((0.0, 1.0, 0.0))  # head to tail of the bone
                want = down[AIM[name]]
                Q[name] = cur.rotation_difference(want).to_matrix() @ follow
            else:
                Q[name] = follow
            pb = self.rig.pose.bones[name]
            if par:
                basis = self.rest[name].inverted() @ self.rest[par] @ Q[par].inverted() @ Q[name]
            else:
                basis = self.rest[name].inverted() @ Q[name]
                pb.location = self.rest[name].inverted() @ (move + Vector((0.0, 0.0, self.ground_fix)))
            pb.rotation_quaternion = basis.to_quaternion()
        bpy.context.view_layer.update()

    def lowest_shoe_z(self):
        deps = bpy.context.evaluated_depsgraph_get()
        zmin = 1e9
        for o in self.shoes or self.meshes:
            ev = o.evaluated_get(deps)
            me = ev.to_mesh()
            zmin = min(zmin, min((o.matrix_world @ v.co).z for v in me.vertices))
            ev.to_mesh_clear()
        return zmin

    def ground(self, frame):
        """Constant lift so the soles stand on the floor in this clip's first frame."""
        self.ground_fix = 0.0
        self.pose(frame)
        self.ground_fix = -self.lowest_shoe_z()
        self.pose(frame)

    def set_visible(self, visible):
        for o in self.meshes:
            o.hide_render = not visible
            o.hide_viewport = not visible

    def gt(self, scene, cam):
        out = {}
        for name, bone in GT_BONES.items():
            head = self.rig.matrix_world @ self.rig.pose.bones[bone].head
            x, y, depth = FS.project_to_pixels(scene, cam, head)
            out[name] = [round(x, 2), round(y, 2), round(depth, 3)]
        return out


def read_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(argv) < 2:
        raise SystemExit('usage: -- <actor.blend> <out-dir> [--clips a,b] [--samples n] [--sheet id] [--skip-done]')
    opts = {'blend': argv[0], 'out': argv[1], 'clips': None, 'samples': 24, 'sheet': None, 'skip_done': '--skip-done' in argv,
            'exposure': FS.LIGHT['exposure']}
    if '--exposure' in argv:
        opts['exposure'] = float(argv[argv.index('--exposure') + 1])
    if '--clips' in argv:
        opts['clips'] = argv[argv.index('--clips') + 1].split(',')
    if '--samples' in argv:
        opts['samples'] = int(argv[argv.index('--samples') + 1])
    if '--sheet' in argv:
        opts['sheet'] = argv[argv.index('--sheet') + 1]
    return opts


def main():
    opts = read_args()
    out = os.path.abspath(opts['out'])
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(opts['blend']))
    scene = bpy.context.scene
    FS.setup_render(scene, 640, 480, opts['samples'])
    scene.view_settings.exposure = opts['exposure']
    FS.clear_room()
    FS.build_room(scene)
    actor = Actor()
    meta = {'blender': bpy.app.version_string, 'engine': scene.render.engine, 'samples': opts['samples'], 'clips': {}}
    ids = opts['sheet'].split(',') if opts['sheet'] else (opts['clips'] or [c for c in SC.CLIPS if c != 'rh_drive_dim'])
    t_all = time.time()
    for cid in ids:
        if cid == 'empty_room':
            continue  # the empty room has no actor: it is rendered after the loop
        doc = SC.author(cid)
        view = doc['view']
        done_marker = os.path.join(out, 'frames', cid, 'done.json')
        if opts['skip_done'] and os.path.exists(done_marker) and not opts['sheet']:
            log(cid, 'already rendered, skipped')
            continue
        cam = FS.make_camera(scene, view)
        n = doc['frameCount']
        picks = list(range(n))
        folder = os.path.join(out, 'frames', cid)
        if opts['sheet']:
            picks = [min(n - 1, int(round(t * SC.FPS))) for t in SHEET_TIMES]
            folder = os.path.join(out, 'sheet')
        os.makedirs(folder, exist_ok=True)
        actor.set_visible(True)
        actor.ground(doc['frames'][0])
        gt = []
        t0 = time.time()
        for k, i in enumerate(picks):
            actor.pose(doc['frames'][i])
            scene.render.filepath = os.path.join(folder, ('%s-%02d.png' % (cid, k)) if opts['sheet'] else ('%04d.png' % i))
            bpy.ops.render.render(write_still=True)
            gt.append({'i': i, 'joints': actor.gt(scene, cam)})
            if k % 30 == 29:
                log(cid, 'frame', k + 1, 'of', len(picks), '%.1f s' % (time.time() - t0))
        if not opts['sheet']:
            os.makedirs(os.path.join(out, 'gt'), exist_ok=True)
            with open(os.path.join(out, 'gt', cid + '.gt.json'), 'w') as f:
                json.dump({'format': 'VANDE-CAMFIX-GT1', 'id': cid, 'view': view, 'fps': SC.FPS,
                           'width': scene.render.resolution_x, 'height': scene.render.resolution_y,
                           'frames': gt}, f, separators=(',', ':'))
            with open(done_marker, 'w') as f:
                json.dump({'frames': len(picks), 'seconds': round(time.time() - t0, 1)}, f)
        meta['clips'][cid] = {'frames': len(picks), 'seconds': round(time.time() - t0, 1), 'view': view}
        log(cid, 'done', len(picks), 'frames in %.1f s' % (time.time() - t0))
        bpy.data.objects.remove(cam, do_unlink=True)
    if not opts['sheet'] and (opts['clips'] is None or 'empty_room' in (opts['clips'] or [])):
        # The empty room: the same camera, nobody in it. One frame; the encoder repeats it with sensor noise.
        cam = FS.make_camera(scene, 'mid')
        actor.set_visible(False)
        folder = os.path.join(out, 'frames', 'empty_room')
        os.makedirs(folder, exist_ok=True)
        scene.render.filepath = os.path.join(folder, '0000.png')
        bpy.ops.render.render(write_still=True)
        actor.set_visible(True)
        meta['clips']['empty_room'] = {'frames': 1, 'view': 'mid'}
        bpy.data.objects.remove(cam, do_unlink=True)
    meta['totalSeconds'] = round(time.time() - t_all, 1)
    with open(os.path.join(out, 'render-meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('RENDER_OK', json.dumps({'seconds': meta['totalSeconds'], 'clips': len(meta['clips'])}), flush=True)


main()
