"""Authoring of the camera-fixture clips as VC17 poses (SYNTH-VIDEO). Original work for VANDE; no third-party motion.

Pure Python (standard library only, plus scripts/blender/motion/vc17.py), so it runs in plain python3 (fast checks, unit tests) and
inside Blender (render_clips.py imports it). Everything is in the canonical actor frame of MOTION-SPEC: metres, Y up, +Z the
character's forward, +X the character's LEFT, so the player's right hand is on -X.

A clip is a person standing square on to a laptop camera, miming a bat with both hands: ready stance, backlift (hands rise), hold,
strike (hands come down and across, a skewed bell speed profile that peaks at contact), follow-through, slow return to the stance.
Each clip loops without a jump (the fake camera repeats its file). The hands are the driver; the torso, head, elbows and legs support
them. The numbers in STROKES are in body units u (one shoulder width, 0.41 m, the unit of src/input/camera/constants.ts) measured
from the ready hand position: +x towards the player's right, +y up, +z forward.

  python3 scripts/blender/camera/swing_clips.py --list
  python3 scripts/blender/camera/swing_clips.py --out DIR [clip-id ...]     writes DIR/<id>.pose.json
  python3 scripts/blender/camera/swing_clips.py --traces DIR [clip-id ...]  writes DIR/<id>.ideal.trace.json (the small landmark traces)
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'motion'))
import vc17  # noqa: E402

FPS = 30
U = 0.41  # the player's shoulder width in metres (2 * the VC17 shoulder offset 0.205): CAMERA's body unit
SHOULDER_Y = vc17.HIP_HEIGHT + 0.11 + 0.20 + 0.182
ARM = vc17.UPPER + vc17.FORE  # 0.54 m
REACH_MAX = 0.95 * ARM  # a wrist target farther than this from its shoulder is pulled in
REACH_MIN = 0.20
# The ready hands: belt-to-chest height, a little to the player's right, in front of the body (canonical metres).
H0 = (-0.06, 1.10, 0.20)
WRIST_HALF_GAP = 0.055  # the two hands side by side, 0.11 m apart
LOOP_S = {'stroke': 4.0, 'still': 6.0}

# Strokes: key hand positions in u from H0 (x to the player's right, y up, z forward) and timings in seconds.
# stance = seconds of ready stance before the backlift; back = backlift; hold; strike = hands from the peak to contact;
# follow = contact to the end of the follow-through; yaw/lean in degrees (+yaw = turn to the player's left, +lean = forward).
STROKES = {
    'drive': dict(stance=1.30, back=0.55, hold=0.30, strike=0.20, follow=0.40, peak=(0.50, 0.90, -0.25),
                  contact=(0.95, 0.10, 0.05), finish=(0.85, -0.20, 0.25), wind=-3.0, yaw=-9.0, lean=5.0),
    'pull': dict(stance=1.30, back=0.55, hold=0.25, strike=0.17, follow=0.35, peak=(0.55, 1.00, -0.30),
                 contact=(-0.45, 0.15, 0.35), finish=(-0.75, -0.10, 0.30), wind=-5.0, yaw=28.0, lean=6.0),
    'loft': dict(stance=1.30, back=0.60, hold=0.25, strike=0.15, follow=0.40, peak=(0.55, 1.45, -0.20),
                 contact=(0.65, 0.10, 0.45), finish=(0.45, 0.80, 0.65), wind=-3.0, yaw=-4.0, lean=7.0),
    'defence': dict(stance=1.30, back=0.40, hold=0.20, strike=0.30, follow=0.25, peak=(0.10, 0.26, -0.05),
                    contact=(0.10, 0.00, 0.45), finish=(0.10, -0.05, 0.55), wind=0.0, yaw=-1.0, lean=2.0),
    # The first defence render (kept as a second variant, DECISIONS SV-09): a 0.35 u backlift and a 0.40 s push.
    'defence_035': dict(stance=1.30, back=0.40, hold=0.20, strike=0.40, follow=0.25, peak=(0.10, 0.35, -0.05),
                        contact=(0.10, 0.00, 0.45), finish=(0.10, -0.05, 0.55), wind=0.0, yaw=-1.0, lean=2.0),
    'leave': dict(stance=1.00, back=0.50, hold=0.80, strike=None, follow=None, peak=(0.50, 0.85, -0.20),
                  contact=None, finish=None, wind=-2.0, yaw=0.0, lean=-1.0, back_to=1.60),
}

# The clip catalogue: id -> (mirror, stroke or None, seconds, view). 'mirror' makes the left-handed batter by the canonical
# mirror (MOTION-SPEC section 3), so a left-hander is exactly the right-hander's mirror image.
CLIPS = {
    'rh_drive': (False, 'drive', 4.0, 'mid'), 'rh_pull': (False, 'pull', 4.0, 'mid'),
    'rh_loft': (False, 'loft', 4.0, 'mid'), 'rh_leave': (False, 'leave', 4.0, 'mid'),
    'rh_defence': (False, 'defence', 4.0, 'mid'),
    'lh_drive': (True, 'drive', 4.0, 'mid'), 'lh_pull': (True, 'pull', 4.0, 'mid'),
    'lh_loft': (True, 'loft', 4.0, 'mid'), 'lh_leave': (True, 'leave', 4.0, 'mid'),
    'lh_defence': (True, 'defence', 4.0, 'mid'),
    'rh_defence_035': (False, 'defence_035', 4.0, 'mid'), 'lh_defence_035': (True, 'defence_035', 4.0, 'mid'),
    'rh_drive_near': (False, 'drive', 4.0, 'near'), 'rh_drive_far': (False, 'drive', 4.0, 'far'),
    'rh_drive_portrait': (False, 'drive', 4.0, 'portrait'),
    'rh_drive_dim': (False, 'drive', 4.0, 'mid'),
    'still': (False, None, 6.0, 'mid'),
}

# The webcam (one source of truth: fixture_scene.py imports these). Horizontal field of view in degrees, camera height and the
# distance to the person in metres, tilt up in degrees, picture size. 62 degrees is the lens src/input/camera/constants.ts assumes.
CAMERA_HEIGHT_M = 1.1
CAMERA_VIEWS = {
    # Tilted up 5 degrees so a standing person has the head room CAMERA's readiness check wants (noseY / shoulder width >= 0.9; found by the
    # first camera e2e run at 10:48Z: with no tilt the nose was 0.85 to 0.91 shoulder widths below the top edge, right on the threshold).
    'mid': {'distanceM': 2.0, 'tiltDeg': 5.0, 'width': 640, 'height': 480, 'hfovDeg': 62.0},
    'near': {'distanceM': 1.5, 'tiltDeg': 12.0, 'width': 640, 'height': 480, 'hfovDeg': 62.0},
    'far': {'distanceM': 3.4, 'tiltDeg': 0.0, 'width': 640, 'height': 480, 'hfovDeg': 62.0},
    'portrait': {'distanceM': 2.0, 'tiltDeg': 0.0, 'width': 480, 'height': 640, 'hfovDeg': 54.0},  # a phone held upright (assumed lens)
}
IDEAL_JOINTS = {'shoulderL': 'upperArmL', 'shoulderR': 'upperArmR', 'elbowL': 'forearmL', 'elbowR': 'forearmR',
                'wristL': 'handL', 'wristR': 'handR'}


def project(view, point):
    """A canonical-frame point (the actor stands at the origin facing +Z) to the picture of `view`: (x, y) as fractions of the
    picture, x to the right, y down, the same numbers a pose model's normalised landmarks use. The actor's left (+X) is on the right."""
    v = CAMERA_VIEWS[view]
    tilt = math.radians(v['tiltDeg'])
    x, y, z = point  # canonical; the camera looks at the actor's front, from distance d in front of it
    d = v['distanceM']
    depth = (d - z) * math.cos(tilt) + (y - CAMERA_HEIGHT_M) * math.sin(tilt)
    up = -(d - z) * math.sin(tilt) + (y - CAMERA_HEIGHT_M) * math.cos(tilt)
    tan_h = math.tan(math.radians(v['hfovDeg']) / 2.0)
    tan_v = tan_h * v['height'] / v['width']
    return (0.5 + 0.5 * x / (depth * tan_h), 0.5 - 0.5 * up / (depth * tan_v))


# ---------------------------------------------------------------------------------------------------------------------
# small maths
# ---------------------------------------------------------------------------------------------------------------------


def v3(a, b, k):
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))


def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vscale(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def seg(t, t0, t1):
    return vc17.clamp((t - t0) / (t1 - t0), 0.0, 1.0)


class SkewedBell:
    """Progress 0..1 along a path with zero speed at both ends and the peak speed at the fraction `peak_at` of the time
    (a Beta(2, 1/peak_at) distribution function, tabulated), so the hands are fastest at contact and slow after it."""

    def __init__(self, peak_at, steps=2000):
        b = 1.0 / peak_at
        xs = [i / steps for i in range(steps + 1)]
        pdf = [x * (1.0 - x) ** (b - 1.0) for x in xs]
        acc = [0.0]
        for i in range(1, steps + 1):
            acc.append(acc[-1] + 0.5 * (pdf[i] + pdf[i - 1]))
        total = acc[-1]
        self.cdf = [a / total for a in acc]
        self.steps = steps

    def __call__(self, tau):
        tau = vc17.clamp(tau, 0.0, 1.0)
        f = tau * self.steps
        i = min(int(f), self.steps - 1)
        return self.cdf[i] + (self.cdf[i + 1] - self.cdf[i]) * (f - i)


def harmonics(phase, terms):
    """Seamless loop motion: terms of (harmonic number, amplitude, phase offset); phase 0..1 over one loop."""
    return sum(a * math.sin(2.0 * math.pi * (k * phase + o)) for k, a, o in terms)


# ---------------------------------------------------------------------------------------------------------------------
# the hand path of one stroke, in u from the ready position
# ---------------------------------------------------------------------------------------------------------------------


class HandPath:
    def __init__(self, name, total):
        s = STROKES[name]
        self.s = s
        self.total = total
        self.t1 = s['stance']
        self.t2 = self.t1 + s['back']
        self.t3 = self.t2 + s['hold']
        self.peak = s['peak']
        if s['strike'] is None:  # a leave: hold, then a slow return
            self.t4 = self.t5 = self.t3
            self.t6 = self.t3 + s['back_to']
            self.bell = None
        else:
            self.t4 = self.t3 + s['strike']
            self.t5 = self.t4 + s['follow']
            self.t6 = total
            self.bell = SkewedBell(s['strike'] / (s['strike'] + s['follow']))
            wc = self.bell(s['strike'] / (s['strike'] + s['follow']))
            self.wc = wc
            hb, hc, hf = self.peak, s['contact'], s['finish']
            # Quadratic Bezier hb -> q -> hf that passes through the contact point at path parameter wc.
            self.q = tuple((hc[i] - (1 - wc) ** 2 * hb[i] - wc ** 2 * hf[i]) / (2 * (1 - wc) * wc) for i in range(3))
        self.rest_end = self.t6 if s['strike'] is None else self.t5

    def at(self, t):
        """(position in u from the ready hands, rise fraction 0..1 of the peak)."""
        s = self.s
        z = (0.0, 0.0, 0.0)
        if t < self.t1:
            return z
        if t < self.t2:
            k = vc17.smoother(seg(t, self.t1, self.t2))
            return vscale(self.peak, k)
        if t < self.t3:
            return self.peak
        if s['strike'] is None:
            if t < self.t6:
                return vscale(self.peak, 1.0 - vc17.smoother(seg(t, self.t3, self.t6)))
            return z
        if t < self.t5:
            w = self.bell(seg(t, self.t3, self.t5))
            hb, hf = self.peak, s['finish']
            return tuple((1 - w) ** 2 * hb[i] + 2 * (1 - w) * w * self.q[i] + w ** 2 * hf[i] for i in range(3))
        k = vc17.smoother(seg(t, self.t5, self.t6))
        return vscale(s['finish'], 1.0 - k)

    def markers(self):
        s = self.s
        m = {'stanceEnd': self.t1, 'backliftEnd': self.t2, 'holdEnd': self.t3}
        if s['strike'] is None:
            m['returnEnd'] = self.t6
        else:
            m.update({'contact': self.t4, 'followEnd': self.t5})
        return m


# ---------------------------------------------------------------------------------------------------------------------
# one frame of the body
# ---------------------------------------------------------------------------------------------------------------------

FEET = {'L': (+0.13, 8.0), 'R': (-0.13, -8.0)}  # lateral offset (m) and toe-out yaw (deg), canonical
KNEE_POLE = {'L': (0.18, 0.0, 1.0), 'R': (-0.18, 0.0, 1.0)}


def torso_channels(path, total):
    """Curves of the torso turn and lean over the stroke (degrees). None for a still clip."""
    s = path.s
    if s['strike'] is None:
        yaw = vc17.Curve([(0.0, 0.0), (path.t1, 0.0), (path.t2, s['wind']), (path.t3, s['wind']), (path.t6, 0.0),
                          (total, 0.0)])
        lean = vc17.Curve([(0.0, 0.0), (path.t1, 0.0), (path.t2, s['lean']), (path.t3, s['lean']), (path.t6, 0.0),
                           (total, 0.0)])
    else:
        yaw = vc17.Curve([(0.0, 0.0), (path.t1, 0.0), (path.t2, s['wind']), (path.t3, s['wind']), (path.t4, s['yaw']),
                          (path.t5, s['yaw'] * 0.85), (total, 0.0)])
        lean = vc17.Curve([(0.0, 0.0), (path.t1, 0.0), (path.t2, -s['lean'] * 0.4), (path.t3, -s['lean'] * 0.4),
                           (path.t4, s['lean']), (path.t5, s['lean'] * 0.8), (total, 0.0)])
    return yaw, lean


def pose_frame(t, total, path, yaw_c, lean_c):
    """The 17 local quaternions, the hips offset and the ground (x, z, yaw) at time t. Returns also the wrist targets used."""
    phase = (t / total) % 1.0
    # Idle life on whole harmonics of the loop, so the clip closes: breathing, a slow weight shift, a head drift.
    breathe = harmonics(phase, [(int(round(total / 4.0)), 1.0, 0.0)])  # about one breath per four seconds
    shift = harmonics(phase, [(1, 0.7, 0.10), (2, 0.3, 0.55)])
    drift = harmonics(phase, [(1, 0.6, 0.30), (3, 0.4, 0.05)])
    hips_off = (0.012 * shift, -0.025 - 0.004 * breathe, 0.006 * drift)
    yaw_t = (yaw_c(t) if yaw_c else 0.0) + 1.2 * drift
    lean_t = (lean_c(t) if lean_c else 0.0) + 0.5 * breathe
    local = {b: vc17.QI for b in vc17.BONES}
    # The hips turn 25%, spine 30%, chest 45% of the torso turn and lean.
    local['hips'] = vc17.qmul(vc17.qaxis((0, 1, 0), yaw_t * 0.25), vc17.qaxis((1, 0, 0), lean_t * 0.20))
    local['spine'] = vc17.qmul(vc17.qaxis((0, 1, 0), yaw_t * 0.30), vc17.qaxis((1, 0, 0), lean_t * 0.30))
    local['chest'] = vc17.qmul(vc17.qaxis((0, 1, 0), yaw_t * 0.45), vc17.qaxis((1, 0, 0), lean_t * 0.50))
    # The head keeps looking at the camera: it counter-turns most of the torso turn, with a small nod and drift.
    local['neck'] = vc17.qmul(vc17.qaxis((0, 1, 0), -yaw_t * 0.30 + 1.5 * drift), vc17.qaxis((1, 0, 0), -lean_t * 0.2))
    local['head'] = vc17.qmul(vc17.qaxis((0, 1, 0), -yaw_t * 0.30 + 1.0 * shift),
                              vc17.qaxis((1, 0, 0), 2.0 + 1.0 * breathe))
    ground = (0.0, 0.0, 0.0)
    P, W = vc17.fk(ground, hips_off, local)
    # Legs: both feet planted, shoulder width, toes a little out, knees a little bent (two-bone IK).
    for side in ('L', 'R'):
        x, toe_yaw = FEET[side]
        ankle = (x, vc17.ANKLE_H, 0.0)
        thigh_l, shin_l, foot_l, _err, _w = vc17.leg_ik(P['thigh' + side], W['hips'], ankle,
                                                        vc17.foot_world(toe_yaw, 0.0, 0.0), KNEE_POLE[side])
        local['thigh' + side] = thigh_l
        local['shin' + side] = shin_l
        local['foot' + side] = foot_l
    P, W = vc17.fk(ground, hips_off, local)
    # Arms: the ready hands plus the hand path, a little tremor, reach-limited; two-bone IK to each wrist.
    if path is not None:
        hu, _ = path.at(t), None
    else:
        hu = (0.0, 0.0, 0.0)
    tremor = (0.0025 * harmonics(phase, [(3, 1.0, 0.0), (5, 0.5, 0.3)]), 0.0025 * harmonics(phase, [(3, 1.0, 0.25), (4, 0.5, 0.1)]),
             0.0020 * harmonics(phase, [(2, 1.0, 0.6), (5, 0.4, 0.0)]))
    centre = (H0[0] - hu[0] * U, H0[1] + hu[1] * U, H0[2] + hu[2] * U)  # player's right is -X
    centre = vadd(centre, tremor)
    rise_frac = vc17.clamp(hu[1] / 1.0, 0.0, 1.0) if path is not None else 0.0
    targets = {}
    clamps = 0
    for side, sx in (('L', +1.0), ('R', -1.0)):
        want = vadd(centre, (sx * WRIST_HALF_GAP, 0.0, 0.0))
        sh = P['upperArm' + side]
        d = vsub(want, sh)
        dist = vc17.length(d)
        if dist > REACH_MAX:
            want = vadd(sh, vscale(d, REACH_MAX / dist))
            clamps += 1
        elif dist < REACH_MIN:
            want = vadd(sh, vscale(d, REACH_MIN / max(dist, 1e-6)))
            clamps += 1
        targets[side] = want
        pole = v3((sx * 0.45, -1.0, -0.30), (sx * 0.30, -0.80, 0.35), vc17.clamp(rise_frac, 0.0, 1.0))
        up_l, fore_l, _wf, err = vc17.arm_ik(sh, W['chest'], want, pole)
        local['upperArm' + side] = up_l
        local['forearm' + side] = fore_l
        local['hand' + side] = vc17.QI
    return local, hips_off, ground, targets, clamps


# ---------------------------------------------------------------------------------------------------------------------
# a clip
# ---------------------------------------------------------------------------------------------------------------------

MIRROR_SWAP = {'upperArmL': 'upperArmR', 'forearmL': 'forearmR', 'handL': 'handR', 'thighL': 'thighR',
               'shinL': 'shinR', 'footL': 'footR'}
MIRROR_SWAP.update({v: k for k, v in list(MIRROR_SWAP.items())})


def mirror_pose(local, hips_off, ground):
    """The canonical mirror of MOTION-SPEC section 3: swap L and R bones, (x, y, z, w) -> (x, -y, -z, w), negate hips x,
    ground x and ground yaw."""
    out = {}
    for b in vc17.BONES:
        q = local[MIRROR_SWAP.get(b, b)]
        out[b] = (q[0], -q[1], -q[2], q[3])
    return out, (-hips_off[0], hips_off[1], hips_off[2]), (-ground[0], ground[1], -ground[2])


def author(clip_id):
    """The whole clip as plain data (a dict): frames of q (17 x 4), hips offset and ground, markers and metrics."""
    mirror, stroke, seconds, view = CLIPS[clip_id]
    n = int(round(seconds * FPS))
    total = n / FPS
    path = HandPath(stroke, total) if stroke else None
    yaw_c = lean_c = None
    if path:
        yaw_c, lean_c = torso_channels(path, total)
    frames = []
    hand_u = []  # the hand centre in u from the ready position (right-hander's frame) for the metrics
    clamps = 0
    for i in range(n):
        t = i / FPS
        local, hips_off, ground, targets, c = pose_frame(t, total, path, yaw_c, lean_c)
        clamps += c
        if mirror:
            local, hips_off, ground = mirror_pose(local, hips_off, ground)
        q = []
        for b in vc17.BONES:
            qb = vc17.qcanon(local[b])
            q.extend(round(x, 6) for x in qb)
        joints_w = vc17.fk(ground, hips_off, local)[0]
        ideal = {name: [round(c, 5) for c in project(view, joints_w[bone])] for name, bone in IDEAL_JOINTS.items()}
        head = joints_w['head']
        ideal['nose'] = [round(c, 5) for c in project(view, (head[0], head[1] + 0.04, head[2] + 0.10))]
        frames.append({'q': q, 'hips': [round(x, 6) for x in hips_off], 'ground': [round(x, 6) for x in ground],
                       'ideal': ideal})
        mid = vscale(vadd(targets['L'], targets['R']), 0.5)
        hand_u.append(((H0[0] - mid[0]) / U, (mid[1] - H0[1]) / U, (mid[2] - H0[2]) / U))
    doc = {
        'format': 'VANDE-CAMFIX-POSE1', 'id': clip_id, 'skeleton': 'VC17', 'fps': FPS, 'frameCount': n,
        'seconds': total, 'view': view, 'mirrored': mirror, 'stroke': stroke,
        'markers': path.markers() if path else {},
        'metrics': metrics(hand_u, path),
        'reachClampedFrames': clamps,
        'provenance': {'author': 'SYNTH-VIDEO (Claude agent, for the VANDE owner)',
                       'method': 'original hand paths on the VC17 control rig (two-bone IK, FK torso), no capture, no third-party motion',
                       'script': 'scripts/blender/camera/swing_clips.py', 'licence': 'owner-made original'},
        'frames': frames,
    }
    return doc


def metrics(hand_u, path):
    """What the authored hands do, in CAMERA's units (u, u/s, s), right-hander's frame: +x = the player's right."""
    if path is None:
        rises = [h[1] for h in hand_u]
        return {'peakRiseU': round(max(rises), 4), 'strikeDropU': 0.0, 'meanDescentUPerS': 0.0, 'lateralU': 0.0}
    rises = [h[1] for h in hand_u]
    peak_i = max(range(len(rises)), key=lambda i: rises[i])
    out = {'peakRiseU': round(rises[peak_i], 4), 'peakAtS': round(peak_i / FPS, 4)}
    s = path.s
    if s['strike'] is None:
        # Slowest honest summary for a leave: the mean descent speed since the peak until the hands are back.
        back = next((i for i in range(peak_i, len(rises)) if rises[i] < 0.35 * rises[peak_i]), len(rises) - 1)
        out.update({'strikeDropU': 0.0, 'meanDescentUPerS': round((rises[peak_i] - rises[back]) / max((back - peak_i) / FPS, 1e-9), 4),
                    'lateralU': 0.0})
        return out
    i3 = int(round(path.t3 * FPS))
    i4 = int(round(path.t4 * FPS))
    drop = hand_u[i3][1] - hand_u[i4][1]
    out.update({
        'strikeDropU': round(drop, 4),
        'strikeSeconds': round((i4 - i3) / FPS, 4),
        'meanDescentUPerS': round(drop / ((i4 - i3) / FPS), 4),
        'lateralU': round(hand_u[i4][0] - hand_u[i3][0], 4),
        'forwardU': round(hand_u[i4][2] - hand_u[i3][2], 4),
    })
    return out


TRACE_ORDER = ['nose', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR']
TRACE_INDICES = [0, 11, 12, 13, 14, 15, 16]  # the pose model's landmark numbers of TRACE_ORDER


def ideal_trace(doc):
    """The clip's own joints as the pose model's normalised landmarks (no model, no noise, visibility 0.99): the same
    VANDE-LMTRACE1 shape measure-detection.mjs writes for the model's output, so a test can feed either to the mapper."""
    view = CAMERA_VIEWS[doc['view']]
    return {
        'format': 'VANDE-LMTRACE1', 'clip': doc['id'], 'source': 'ideal: authored joints projected through the render camera',
        'width': view['width'], 'height': view['height'], 'fps': FPS, 'indices': TRACE_INDICES,
        'note': "x and y are fractions of the picture (0..1, y down); z is 0; v is 0.99. Flat [x, y, z, v] per index. Synthetic: no pose model was run.",
        'frames': [{'t': round(i * 1000.0 / FPS, 2),
                    'lm': [c for name in TRACE_ORDER for c in (f['ideal'][name][0], f['ideal'][name][1], 0.0, 0.99)]}
                   for i, f in enumerate(doc['frames'])],
    }


def dump(doc):
    return json.dumps(doc, separators=(',', ':'), sort_keys=True)


def main(argv):
    if '--list' in argv:
        for k, (m, st, sec, view) in CLIPS.items():
            print(f'{k}: {"left" if m else "right"}-handed, {st or "no stroke"}, {sec} s, view {view}')
        return 0
    traces = None
    if '--traces' in argv:
        i = argv.index('--traces')
        traces = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    out = None
    if '--out' in argv:
        i = argv.index('--out')
        out = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    ids = [a for a in argv if not a.startswith('-')] or list(CLIPS)
    for cid in ids:
        doc = author(cid)
        if out:
            os.makedirs(out, exist_ok=True)
            with open(os.path.join(out, cid + '.pose.json'), 'w') as f:
                f.write(dump(doc))
        if traces:
            os.makedirs(traces, exist_ok=True)
            with open(os.path.join(traces, cid + '.ideal.trace.json'), 'w') as f:
                f.write(json.dumps(ideal_trace(doc), separators=(',', ':'), sort_keys=True) + '\n')
        m = doc['metrics']
        print(f'{cid}: {doc["frameCount"]} frames, clamped wrist frames {doc["reachClampedFrames"]}, metrics {m}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
