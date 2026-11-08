"""MOTION-BOWL kinematics core: the VC17 skeleton, quaternions, forward kinematics, two-bone leg IK, arm aiming,
smooth curves, the VMS1 writer, the VMP1 codec emulation and the MOTION-SPEC §9 naturalness metrics.

Pure Python (math only), so it runs unchanged inside Blender 5.2's bundled Python and in plain python3 -I.
Conventions are MOTION-SPEC v1.1 §1: actor frame Y up, +Z forward, +X the character's left; quaternions (x, y, z, w)
local to the parent and relative to an identity rest; Euler sugar is three.js XYZ (q = qx * qy * qz).
Everything here is original code written for the owner; no third-party motion data is read.
"""

import json
import math

import vms_json  # the one canonical VMS1 text form (scripts/blender/motion/vms_json.py)

# ----------------------------------------------------------------------------------------------------------------
# VC17
# ----------------------------------------------------------------------------------------------------------------

BONES = [
    "hips", "spine", "chest", "neck", "head",
    "upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR",
    "thighL", "shinL", "footL", "thighR", "shinR", "footR",
]
IDX = {n: i for i, n in enumerate(BONES)}
PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15]
OFFSET = [
    (0.0, 0.98, 0.0), (0.0, 0.11, 0.0), (0.0, 0.20, 0.0), (0.0, 0.235, 0.0), (0.0, 0.085, 0.012),
    (0.205, 0.182, -0.012), (0.0, -0.285, 0.0), (0.0, -0.255, 0.0),
    (-0.205, 0.182, -0.012), (0.0, -0.285, 0.0), (0.0, -0.255, 0.0),
    (0.095, -0.065, 0.0), (0.0, -0.43, 0.0), (0.0, -0.42, 0.0),
    (-0.095, -0.065, 0.0), (0.0, -0.43, 0.0), (0.0, -0.42, 0.0),
]
HIP_H = 0.98
THIGH = 0.43
SHIN = 0.42
LEG = THIGH + SHIN
REST_ANKLE = 0.065
# MOTION-SPEC v1.1 §9: the plant point is the ball of the foot.
BALL = (0.0, -0.065, 0.135)
HEEL = (0.0, -0.065, -0.05)
TIP = (0.0, -0.065, 0.20)  # MOTION-SPEC v1.2: the rigid shoe rocks on its heel, ball and sole tip
# Where a cricket ball sits in the bowling hand (hand-local): in the fingers, on the palm side.
BALL_IN_HAND = (0.0, -0.085, 0.03)
SKELETON_ID_STRING = "VC17:" + ",".join(BONES)

# ----------------------------------------------------------------------------------------------------------------
# Vectors and quaternions
# ----------------------------------------------------------------------------------------------------------------


def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vscale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vcross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def vlen(a):
    return math.sqrt(vdot(a, a))


def vnorm(a):
    n = vlen(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def vlerp(a, b, u):
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def qconj(q):
    return (-q[0], -q[1], -q[2], q[3])


def qnorm(q):
    n = math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def qrot(q, v):
    # v' = q v q*
    x, y, z, w = q
    vx, vy, vz = v
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))


def qaxis(axis, deg):
    a = math.radians(deg) * 0.5
    s = math.sin(a)
    ax = vnorm(axis)
    return (ax[0] * s, ax[1] * s, ax[2] * s, math.cos(a))


def qx(deg):
    return qaxis((1, 0, 0), deg)


def qy(deg):
    return qaxis((0, 1, 0), deg)


def qz(deg):
    return qaxis((0, 0, 1), deg)


def qeuler(x, y, z):
    """three.js Euler order XYZ (the clips.ts authoring sugar)."""
    return qmul(qmul(qx(x), qy(y)), qz(z))


IDQ = (0.0, 0.0, 0.0, 1.0)


def qdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]


def qangle(a, b):
    d = abs(qdot(a, b))
    return math.degrees(2 * math.acos(min(1.0, d)))


def qnlerp(a, b, u):
    if qdot(a, b) < 0:
        b = (-b[0], -b[1], -b[2], -b[3])
    return qnorm((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u))


def qslerp(a, b, u):
    c = qdot(a, b)
    if c < 0:
        b = (-b[0], -b[1], -b[2], -b[3])
        c = -c
    if c > 0.9995:
        return qnlerp(a, b, u)
    th = math.acos(c)
    s = math.sin(th)
    k0 = math.sin((1 - u) * th) / s
    k1 = math.sin(u * th) / s
    return qnorm(tuple(a[i] * k0 + b[i] * k1 for i in range(4)))


def qfrom_axes(xa, ya, za):
    """Quaternion of the rotation whose columns are the unit axes xa, ya, za."""
    m00, m10, m20 = xa
    m01, m11, m21 = ya
    m02, m12, m22 = za
    tr = m00 + m11 + m22
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = ((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s)
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        q = (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        q = ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2
        q = ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
    return qnorm(q)


def qhemi(q, ref):
    return q if qdot(q, ref) >= 0 else (-q[0], -q[1], -q[2], -q[3])


def euler_xyz(q):
    """three.js XYZ Euler (degrees) of q."""
    x, y, z, w = q
    m11 = 1 - 2 * (y * y + z * z)
    m12 = 2 * (x * y - z * w)
    m13 = 2 * (x * z + y * w)
    m22 = 1 - 2 * (x * x + z * z)
    m23 = 2 * (y * z - x * w)
    m32 = 2 * (y * z + x * w)
    m33 = 1 - 2 * (x * x + y * y)
    ey = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        ex = math.atan2(-m23, m33)
        ez = math.atan2(-m12, m11)
    else:
        ex = math.atan2(m32, m22)
        ez = 0.0
    return (math.degrees(ex), math.degrees(ey), math.degrees(ez))


def swing_twist_y(q):
    """Swing angle of the bone's rest axis (Y) and twist about it, degrees."""
    x, y, z, w = q
    tw = math.sqrt(y * y + w * w)
    twist = 0.0 if tw < 1e-9 else math.degrees(2 * math.atan2(abs(y), abs(w)))
    axis = qrot(q, (0, 1, 0))
    swing = math.degrees(math.acos(max(-1.0, min(1.0, axis[1]))))
    return swing, twist


# ----------------------------------------------------------------------------------------------------------------
# Curves: monotone cubic (PCHIP) through knots, C1, no overshoot; optional periodic wrap.
# ----------------------------------------------------------------------------------------------------------------


class Curve:
    def __init__(self, knots, period=None):
        ks = sorted(knots, key=lambda k: k[0])
        self.period = period
        if period:
            # wrap two knots on each side so the tangents at the seam are periodic
            pre = [(t - period, v) for t, v in ks[-2:]]
            post = [(t + period, v) for t, v in ks[:2]]
            ks = pre + ks + post
        self.t = [k[0] for k in ks]
        self.v = [float(k[1]) for k in ks]
        n = len(ks)
        self.m = [0.0] * n
        if n == 1:
            return
        d = [(self.v[i + 1] - self.v[i]) / (self.t[i + 1] - self.t[i]) for i in range(n - 1)]
        self.m[0] = d[0]
        self.m[-1] = d[-1]
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                self.m[i] = 0.0
            else:
                h0 = self.t[i] - self.t[i - 1]
                h1 = self.t[i + 1] - self.t[i]
                w1 = 2 * h1 + h0
                w2 = h1 + 2 * h0
                self.m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        if not period:
            # ends: hold flat (zero slope) so clips start and end without a jerk unless knots say otherwise
            self.m[0] = 0.0 if n > 2 else d[0]
            self.m[-1] = 0.0 if n > 2 else d[-1]

    def __call__(self, t):
        if len(self.t) == 1:
            return self.v[0]
        if self.period:
            t0 = self.t[2]
            t = t0 + ((t - t0) % self.period)
        if t <= self.t[0]:
            return self.v[0]
        if t >= self.t[-1]:
            return self.v[-1]
        lo, hi = 0, len(self.t) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if self.t[mid] <= t:
                lo = mid
            else:
                hi = mid
        h = self.t[hi] - self.t[lo]
        u = (t - self.t[lo]) / h
        u2 = u * u
        u3 = u2 * u
        return ((2 * u3 - 3 * u2 + 1) * self.v[lo] + (u3 - 2 * u2 + u) * h * self.m[lo]
                + (-2 * u3 + 3 * u2) * self.v[hi] + (u3 - u2) * h * self.m[hi])


def smoothstep(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    u = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return u * u * (3 - 2 * u)


def smootherstep(e0, e1, x):
    u = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return u * u * u * (u * (u * 6 - 15) + 10)


def hermite(p0, m0, p1, m1, u, h):
    u2 = u * u
    u3 = u2 * u
    return ((2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1)


# ----------------------------------------------------------------------------------------------------------------
# Forward kinematics on a canonical frame
# ----------------------------------------------------------------------------------------------------------------


def fk(frame, scale=1.0):
    """World positions and rotations of every joint. frame = dict(ground=(x, z, yaw), hips=(x, y, z), q=[17 quats])."""
    gx, gz, gyaw = frame["ground"]
    gq = qy(gyaw)
    pos = [None] * 17
    rot = [None] * 17
    hipsLocal = vadd(OFFSET[0], frame["hips"])
    pos[0] = vadd((gx, 0.0, gz), vscale(qrot(gq, hipsLocal), scale))
    rot[0] = qmul(gq, frame["q"][0])
    for i in range(1, 17):
        p = PARENT[i]
        rot[i] = qmul(rot[p], frame["q"][i])
        pos[i] = vadd(pos[p], vscale(qrot(rot[p], OFFSET[i]), scale))
    return pos, rot


def ball_point(pos, rot, foot):
    i = IDX[foot]
    return vadd(pos[i], qrot(rot[i], BALL))


def ball_in_hand(pos, rot, hand="handR"):
    i = IDX[hand]
    return vadd(pos[i], qrot(rot[i], BALL_IN_HAND))


# ----------------------------------------------------------------------------------------------------------------
# Two-bone leg IK and arm aiming (world-space targets -> local quaternions)
# ----------------------------------------------------------------------------------------------------------------


def leg_ik(hips_pos, hips_rot, side, ankle, pole, foot_rot):
    """Returns (thigh_local, shin_local, foot_local, reach_deficit_m)."""
    off = OFFSET[IDX["thigh" + side]]
    H = vadd(hips_pos, qrot(hips_rot, off))
    d_vec = vsub(ankle, H)
    d = vlen(d_vec)
    deficit = max(0.0, d - (LEG - 1e-4))
    d = min(max(d, abs(THIGH - SHIN) + 1e-4), LEG - 1e-4)
    u = vnorm(d_vec)
    cos_a = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)
    sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
    pp = vsub(pole, vscale(u, vdot(pole, u)))
    if vlen(pp) < 1e-6:
        pp = qrot(hips_rot, (0, 0, 1))
        pp = vsub(pp, vscale(u, vdot(pp, u)))
    v = vnorm(pp)
    K = vadd(H, vadd(vscale(u, THIGH * cos_a), vscale(v, THIGH * sin_a)))
    yt = vnorm(vsub(H, K))
    zt = vsub(pole, vscale(yt, vdot(pole, yt)))
    zt = vnorm(zt) if vlen(zt) > 1e-6 else v
    xt = vnorm(vcross(yt, zt))
    zt = vcross(xt, yt)
    thigh_w = qfrom_axes(xt, yt, zt)
    # knee flexion from the law of cosines
    cos_k = (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN)
    flex = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, cos_k))))
    shin_l = qx(flex)
    shin_w = qmul(thigh_w, shin_l)
    thigh_l = qmul(qconj(hips_rot), thigh_w)
    foot_l = qmul(qconj(shin_w), foot_rot)
    return thigh_l, shin_l, foot_l, deficit


def arm_rot(side_sign, phi, lat, twist):
    """Upper arm orientation in its parent (chest) frame: abduct by lat (outwards), swing by phi in the sagittal plane
    (0 down, 90 back, 180 up, 270 forward), then twist about the bone. side_sign = +1 left arm, -1 right arm."""
    return qmul(qmul(qx(phi), qz(side_sign * lat)), qy(twist))


# ----------------------------------------------------------------------------------------------------------------
# VMS1 source writer
# ----------------------------------------------------------------------------------------------------------------


def r6(x):
    v = round(float(x), 6)
    return 0.0 if v == 0 else v


def write_vms(path, clip):
    frames = clip["frames"]
    out = {
        "format": "VMS1",
        "id": clip["id"],
        "pack": clip["pack"],
        "role": clip["role"],
        "skeleton": "VC17",
        "sampleRate": clip["rate"],
        "loop": bool(clip.get("loop", False)),
        "mirrorable": bool(clip.get("mirrorable", False)),
        "overlay": False,
        "codec": clip.get("codec", 2),
        "boneMask": "all",
        "speedMps": r6(clip.get("speedMps", 0.0)),
        "cycleSteps": clip.get("cycleSteps", 0),
        "markers": {k: r6(v) for k, v in sorted(clip.get("markers", {}).items())},
    }
    if clip.get("loop") and clip.get("cycleSteps"):
        out["phase0LeftStrike"] = True
    if clip.get("mirrorAliases"):
        out["mirrorAliases"] = clip["mirrorAliases"]
    out["frames"] = {
        "ground": [[r6(f["ground"][0]), r6(f["ground"][1]), r6(f["ground"][2])] for f in frames],
        "hips": [[r6(c) for c in f["hips"]] for f in frames],
        "contacts": [int(f["contacts"]) for f in frames],
        "q": [[r6(c) for qq in f["q"] for c in canon(qq)] for f in frames],
    }
    tracks = {}
    for name, kind in clip.get("tracks", {}).items():
        tracks[name] = {"kind": kind, "frames": [[r6(c) for c in f["tracks"][name]] for f in frames]}
    out["tracks"] = tracks
    out["provenance"] = clip["provenance"]
    vms_json.write(path, out)
    return out


def canon(q):
    """A stable sign for byte-stable sources: w >= 0."""
    q = qnorm(q)
    return q if q[3] >= 0 else (-q[0], -q[1], -q[2], -q[3])


def read_vms(path):
    with open(path) as fh:
        d = json.load(fh)
    fr = d["frames"]
    frames = []
    for i in range(len(fr["ground"])):
        flat = fr["q"][i]
        q = [tuple(flat[4 * b:4 * b + 4]) for b in range(17)]
        tr = {k: tuple(v["frames"][i]) for k, v in d.get("tracks", {}).items()}
        frames.append({"ground": tuple(fr["ground"][i]), "hips": tuple(fr["hips"][i]), "contacts": fr["contacts"][i], "q": q, "tracks": tr})
    return d, frames


# ----------------------------------------------------------------------------------------------------------------
# VMP1 codec emulation (MOTION-SPEC §5.3-5.4), so metrics run on what the bytes will decode to
# ----------------------------------------------------------------------------------------------------------------

SQ2 = math.sqrt(2.0)


def quant_q(q, codec):
    n = 10 if codec == 1 else 15
    top = (1 << n) - 1
    q = qnorm(q)
    i = max(range(4), key=lambda k: (abs(q[k]), -k))
    if q[i] < 0:
        q = tuple(-c for c in q)
    others = [k for k in range(4) if k != i]
    vals = []
    for k in others:
        v = round((q[k] * SQ2 + 1) / 2 * top)
        vals.append(min(top, max(0, v)))
    dec = [0.0] * 4
    s = 0.0
    for k, v in zip(others, vals):
        c = (v / top * 2 - 1) / SQ2
        dec[k] = c
        s += c * c
    dec[i] = math.sqrt(max(0.0, 1 - s))
    return qnorm(tuple(dec))


def quant_frame(f, codec):
    g = f["ground"]
    out = {
        "ground": (round(g[0] * 1000) / 1000, round(g[1] * 1000) / 1000, round(g[2] * 100) / 100),
        "hips": tuple(round(c * 1000) / 1000 for c in f["hips"]),
        "contacts": f["contacts"],
        "q": [quant_q(q, codec) for q in f["q"]],
        "tracks": {k: tuple(round(c * 1000) / 1000 for c in v) for k, v in f.get("tracks", {}).items()},
    }
    return out


def frame_bytes(codec, tracks=0, bones=17):
    return 14 + bones * (4 if codec == 1 else 6) + 6 * tracks


def clip_bytes(clip):
    """Bytes of the VMC1 record (header + markers + track descriptors + frames), excluding pack overheads."""
    F = len(clip["frames"]) - (1 if clip.get("loop") else 0)
    T = len(clip.get("tracks", {}))
    M = len(clip.get("markers", {}))
    return 48 + 8 * M + 4 * T + F * frame_bytes(clip.get("codec", 2), T)


# ----------------------------------------------------------------------------------------------------------------
# Sampling (MOTION-SPEC §6): nlerp quaternions, linear ground/hips, contacts from the nearer frame
# ----------------------------------------------------------------------------------------------------------------


def sample(frames, rate, t, loop=False, travel=None):
    F = len(frames)
    if loop:
        dur = F / rate
        cycles = math.floor(t / dur)
        tt = t - cycles * dur
        f = tt * rate
        i0 = int(math.floor(f)) % F
        i1 = (i0 + 1) % F
        u = f - math.floor(f)
        a = frames[i0]
        b = frames[i1]
        ga = a["ground"]
        gb = b["ground"]
        if i1 == 0:
            gb = (gb[0] + travel[0], gb[1] + travel[1], gb[2] + travel[2])
        base = (cycles * travel[0], cycles * travel[1], cycles * travel[2])
        # travel accumulates in the clip's start frame; gait loops here have travel yaw 0
        ground = (base[0] + ga[0] + (gb[0] - ga[0]) * u, base[1] + ga[1] + (gb[1] - ga[1]) * u, base[2] + ga[2] + (gb[2] - ga[2]) * u)
    else:
        dur = (F - 1) / rate
        tt = min(max(t, 0.0), dur)
        f = tt * rate
        i0 = min(int(math.floor(f)), F - 2)
        i1 = i0 + 1
        u = f - i0
        a = frames[i0]
        b = frames[i1]
        ga = a["ground"]
        gb = b["ground"]
        ground = (ga[0] + (gb[0] - ga[0]) * u, ga[1] + (gb[1] - ga[1]) * u, ga[2] + (gb[2] - ga[2]) * u)
    hips = vlerp(a["hips"], b["hips"], u)
    q = [qnlerp(a["q"][k], b["q"][k], u) for k in range(17)]
    contacts = a["contacts"] if u < 0.5 else b["contacts"]
    tracks = {k: vlerp(a["tracks"][k], b["tracks"][k], u) for k in a.get("tracks", {})}
    return {"ground": ground, "hips": hips, "q": q, "contacts": contacts, "tracks": tracks}


# ----------------------------------------------------------------------------------------------------------------
# Naturalness metrics (MOTION-SPEC v1.1 §9), measured on a 60 Hz sequence of frames
# ----------------------------------------------------------------------------------------------------------------

ARM_BONES = {"upperArmR", "forearmR", "handR", "upperArmL", "forearmL", "handL"}
TRUNK = {"hips", "spine", "chest"}
HEADB = {"neck", "head"}


def speed_cap(bone, bowling_arms):
    if bone in bowling_arms:
        return 1800.0
    if bone in TRUNK:
        return 600.0
    if bone in HEADB:
        return 720.0
    return 1200.0


def metrics(seq, rate=60, bowling_arms=(), loop=False, label=""):
    """seq: list of frames sampled at `rate` (world-consistent ground). Returns a dict of maxima and pass flags."""
    n = len(seq)
    dt = 1.0 / rate
    fks = [fk(f) for f in seq]
    res = {"label": label, "frames": n}
    # foot slide at the ball of the foot, per contact interval
    worst_slide = 0.0
    worst_ankle = 0.0
    hmin, hmax = 1e9, -1e9
    intervals = 0
    for fi, (foot, bit) in enumerate((("footL", 1), ("footR", 2))):
        i = 0
        while i < n:
            if seq[i]["contacts"] & bit:
                j = i
                while j + 1 < n and seq[j + 1]["contacts"] & bit:
                    j += 1
                pts = [ball_point(fks[k][0], fks[k][1], foot) for k in range(i, j + 1)]
                ank = [fks[k][0][IDX[foot]] for k in range(i, j + 1)]
                mx = sum(p[0] for p in pts) / len(pts)
                mz = sum(p[2] for p in pts) / len(pts)
                s = max(math.hypot(p[0] - mx, p[2] - mz) for p in pts)
                ax = sum(p[0] for p in ank) / len(ank)
                az = sum(p[2] for p in ank) / len(ank)
                sa = max(math.hypot(p[0] - ax, p[2] - az) for p in ank)
                worst_slide = max(worst_slide, s)
                worst_ankle = max(worst_ankle, sa)
                for p in ank:
                    hmin = min(hmin, p[1] - REST_ANKLE)
                    hmax = max(hmax, p[1] - REST_ANKLE)
                intervals += 1
                i = j + 1
            else:
                i += 1
    res["slideBallCm"] = round(worst_slide * 100, 2)
    res["slideAnkleCm"] = round(worst_ankle * 100, 2)
    res["contactIntervals"] = intervals
    res["ankleHeightCm"] = [round(hmin * 100, 2), round(hmax * 100, 2)] if intervals else None
    # angular speed and acceleration per bone (local rotations; hips in the world so heading turns count)
    rng = range(n) if loop else range(n - 1)
    worst_w = {}
    worst_a = {}
    prev_w = None
    first_w = None
    for k in rng:
        k1 = (k + 1) % n
        w = []
        for b in range(17):
            if b == 0:
                qa = fks[k][1][0]
                qb = fks[k1][1][0]
            else:
                qa = seq[k]["q"][b]
                qb = seq[k1]["q"][b]
            w.append(qangle(qa, qb) * rate)
        if first_w is None:
            first_w = w
        for b in range(17):
            worst_w[BONES[b]] = max(worst_w.get(BONES[b], 0.0), w[b])
            if prev_w is not None:
                worst_a[BONES[b]] = max(worst_a.get(BONES[b], 0.0), abs(w[b] - prev_w[b]))
        prev_w = w
    if loop and prev_w is not None and first_w is not None:
        for b in range(17):
            worst_a[BONES[b]] = max(worst_a.get(BONES[b], 0.0), abs(first_w[b] - prev_w[b]))
    over_w = {b: round(v) for b, v in worst_w.items() if v > speed_cap(b, bowling_arms)}
    over_a = {b: round(v) for b, v in worst_a.items() if v > 300.0}
    res["angSpeedMax"] = {b: round(v) for b, v in sorted(worst_w.items(), key=lambda kv: -kv[1])[:5]}
    res["angSpeedOver"] = over_w
    res["angAccelMax"] = {b: round(v) for b, v in sorted(worst_a.items(), key=lambda kv: -kv[1])[:5]}
    res["angAccelOver"] = over_a
    # root speed smoothness
    def hspeeds(pts):
        sp = []
        m = len(pts)
        rngp = range(m) if loop else range(m - 1)
        for k in rngp:
            a = pts[k]
            b = pts[(k + 1) % m]
            if loop and k == m - 1:
                continue
            sp.append(math.hypot(b[0] - a[0], b[1] - a[1]) * rate)
        return sp

    gpts = [(f["ground"][0], f["ground"][1]) for f in seq]
    hpts = [(fks[k][0][0][0], fks[k][0][0][2]) for k in range(n)]
    gs = hspeeds(gpts)
    hs = hspeeds(hpts)
    res["groundSpeedMax"] = round(max(gs), 3) if gs else 0
    res["groundDvMax"] = round(max((abs(gs[k + 1] - gs[k]) for k in range(len(gs) - 1)), default=0), 4)
    res["hipsDvMax"] = round(max((abs(hs[k + 1] - hs[k]) for k in range(len(hs) - 1)), default=0), 4)
    # joint limits
    lim = []
    for k in range(n):
        q = seq[k]["q"]
        for side in "LR":
            ex = euler_xyz(q[IDX["shin" + side]])
            if not (-5 <= ex[0] <= 155) or abs(ex[2]) > 10:
                lim.append(("knee" + side, k, [round(e, 1) for e in ex]))
            ex = euler_xyz(q[IDX["forearm" + side]])
            if not (-150 <= ex[0] <= 5) or abs(ex[2]) > 12:
                lim.append(("elbow" + side, k, [round(e, 1) for e in ex]))
            ex = euler_xyz(q[IDX["foot" + side]])
            if not (-40 <= ex[0] <= 60):
                lim.append(("ankle" + side, k, [round(e, 1) for e in ex]))
            sw, tw = swing_twist_y(q[IDX["thigh" + side]])
            if sw > 135 or tw > 50:
                lim.append(("hip" + side, k, [round(sw, 1), round(tw, 1)]))
            sw, tw = swing_twist_y(q[IDX["upperArm" + side]])
            if sw > 185 or tw > 110:
                lim.append(("shoulder" + side, k, [round(sw, 1), round(tw, 1)]))
            sw, tw = swing_twist_y(q[IDX["hand" + side]])
            if sw > 85:
                lim.append(("wrist" + side, k, [round(sw, 1), round(tw, 1)]))
        for b, cap in (("spine", 75), ("chest", 75), ("neck", 80), ("head", 80)):
            ang = qangle(IDQ, q[IDX[b]])
            if ang > cap:
                lim.append((b, k, round(ang, 1)))
    res["jointLimitViolations"] = len(lim)
    res["jointLimitFirst"] = lim[:6]
    # self-penetration: wrist (hand joint) to the hips-neck segment
    worst_pen = 9.9
    for k in range(n):
        pos = fks[k][0]
        a = pos[IDX["hips"]]
        b = pos[IDX["neck"]]
        for hnd in ("handL", "handR"):
            p = pos[IDX[hnd]]
            ab = vsub(b, a)
            u = max(0.0, min(1.0, vdot(vsub(p, a), ab) / max(1e-9, vdot(ab, ab))))
            c = vadd(a, vscale(ab, u))
            worst_pen = min(worst_pen, vlen(vsub(p, c)))
    res["wristToTorsoMinM"] = round(worst_pen, 3)
    res["pass"] = {
        "slide": res["slideBallCm"] < 2.0,
        "ankleHeight": res["ankleHeightCm"] is None or (res["ankleHeightCm"][0] >= -1.0 and res["ankleHeightCm"][1] <= 2.5),
        "angSpeed": not over_w,
        "angAccel": not over_a,
        "groundDv": res["groundDvMax"] <= 0.15,
        "hipsDv": res["hipsDvMax"] <= 0.30,
        "jointLimits": not lim,
        "selfPenetration": worst_pen >= 0.09,
    }
    res["allPass"] = all(res["pass"].values())
    return res
