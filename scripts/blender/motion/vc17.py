"""
VC17 motion authoring library (MOTION-SPEC). Original work for VANDE; no third-party motion.

Pure Python (standard library only), so the same code runs inside Blender (scripts/blender/motion/build.py, which
also builds the editable .blend and renders previews) and in plain python3 for quick checks. Everything is in the
canonical actor frame: metres, Y up, +Z forward, +X the character's left. Quaternions are tuples (x, y, z, w).

A clip is authored as keyframes on a small control rig:
  - the ground origin (x, z, heading),
  - the hips (offset from rest, rotation),
  - FK rotations for the spine chain and, where wanted, the limbs,
  - foot plants (a ball-of-foot point held fixed in the world, with a heel-strike / heel-off roll) and swing arcs
    between them, solved by analytic two-bone IK with a knee pole,
  - optional hand IK targets with an elbow pole.
Channels between keys use cubic Hermite interpolation with clamped (Fritsch-Carlson) tangents, the same family as
Blender's auto-clamped Bezier F-curves. The solver turns a control state into the 17 local bone quaternions.
"""
import math

import vms_json  # the one canonical VMS1 text form (scripts/blender/motion/vms_json.py)

# ----------------------------------------------------------------------------------------------------------------
# Skeleton (canonical = src/render3d/core/skeleton.ts)
# ----------------------------------------------------------------------------------------------------------------

BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR',
         'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
BI = {n: i for i, n in enumerate(BONES)}
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'upperArmL': 'chest',
          'forearmL': 'upperArmL', 'handL': 'forearmL', 'upperArmR': 'chest', 'forearmR': 'upperArmR',
          'handR': 'forearmR', 'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips',
          'shinR': 'thighR', 'footR': 'shinR'}
HIP_HEIGHT = 0.98
OFFSET = {'hips': (0.0, HIP_HEIGHT, 0.0), 'spine': (0.0, 0.11, 0.0), 'chest': (0.0, 0.2, 0.0),
          'neck': (0.0, 0.235, 0.0), 'head': (0.0, 0.085, 0.012), 'upperArmL': (0.205, 0.182, -0.012),
          'forearmL': (0.0, -0.285, 0.0), 'handL': (0.0, -0.255, 0.0), 'upperArmR': (-0.205, 0.182, -0.012),
          'forearmR': (0.0, -0.285, 0.0), 'handR': (0.0, -0.255, 0.0), 'thighL': (0.095, -0.065, 0.0),
          'shinL': (0.0, -0.43, 0.0), 'footL': (0.0, -0.42, 0.0), 'thighR': (-0.095, -0.065, 0.0),
          'shinR': (0.0, -0.43, 0.0), 'footR': (0.0, -0.42, 0.0)}
THIGH = 0.43
SHIN = 0.42
UPPER = 0.285
FORE = 0.255
ANKLE_H = HIP_HEIGHT - 0.065 - THIGH - SHIN  # 0.065 m: planted ankle height
LEG = 0.065 + THIGH + SHIN  # 0.915 m
# Foot points in the foot bone's frame (rest: sole on the ground).
BALL = (0.0, -ANKLE_H, 0.135)
HEEL = (0.0, -ANKLE_H, -0.05)
TOE = (0.0, -ANKLE_H, 0.2)  # the sole's tip: a rigid shoe rocks on it once the heel is up
CONTACT = {'footL': 1, 'footR': 2, 'handL': 4, 'handR': 8, 'kneeL': 16, 'kneeR': 32, 'body': 64}

# ----------------------------------------------------------------------------------------------------------------
# Small vector and quaternion maths
# ----------------------------------------------------------------------------------------------------------------

DEG = math.pi / 180.0


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a):
    return math.sqrt(dot(a, a))


def norm(a):
    l = length(a)
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else (0.0, 0.0, 0.0)


def lerp(a, b, u):
    return a + (b - a) * u


def lerp3(a, b, u):
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)


def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def smooth(u):
    u = clamp(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


def smoother(u):
    u = clamp(u, 0.0, 1.0)
    return u * u * u * (u * (u * 6.0 - 15.0) + 10.0)


QI = (0.0, 0.0, 0.0, 1.0)


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qconj(a):
    return (-a[0], -a[1], -a[2], a[3])


def qnorm(a):
    l = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3])
    return (a[0] / l, a[1] / l, a[2] / l, a[3] / l)


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    tx = 2.0 * (y * vz - z * vy)
    ty = 2.0 * (z * vx - x * vz)
    tz = 2.0 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))


def qaxis(axis, deg):
    a = norm(axis)
    h = deg * DEG * 0.5
    s = math.sin(h)
    return (a[0] * s, a[1] * s, a[2] * s, math.cos(h))


def qeuler(ex, ey, ez):
    """Euler degrees, order XYZ (three.js), the convention of src/render3d/core/quat.ts."""
    x = ex * DEG * 0.5
    y = ey * DEG * 0.5
    z = ez * DEG * 0.5
    c1, c2, c3 = math.cos(x), math.cos(y), math.cos(z)
    s1, s2, s3 = math.sin(x), math.sin(y), math.sin(z)
    return (s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3)


def qyaw(deg):
    return qaxis((0.0, 1.0, 0.0), deg)


def qbasis(xa, ya, za):
    """Quaternion of the rotation whose columns are the given orthonormal axes."""
    m00, m01, m02 = xa[0], ya[0], za[0]
    m10, m11, m12 = xa[1], ya[1], za[1]
    m20, m21, m22 = xa[2], ya[2], za[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = 0.5 / math.sqrt(tr + 1.0)
        q = ((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
    elif m00 > m11 and m00 > m22:
        s = 2.0 * math.sqrt(1.0 + m00 - m11 - m22)
        q = (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    elif m11 > m22:
        s = 2.0 * math.sqrt(1.0 + m11 - m00 - m22)
        q = ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    else:
        s = 2.0 * math.sqrt(1.0 + m22 - m00 - m11)
        q = ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
    return qnorm(q)


def qslerp(a, b, t):
    cosv = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
    if cosv < 0:
        b = (-b[0], -b[1], -b[2], -b[3])
        cosv = -cosv
    if cosv > 0.9995:
        return qnorm(tuple(a[i] + (b[i] - a[i]) * t for i in range(4)))
    th = math.acos(cosv)
    s = math.sin(th)
    k0 = math.sin((1 - t) * th) / s
    k1 = math.sin(t * th) / s
    return qnorm(tuple(a[i] * k0 + b[i] * k1 for i in range(4)))


def qangle(a, b):
    d = abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
    return 2.0 * math.acos(min(1.0, d)) / DEG


def qcanon(q):
    """Sign-canonical (w >= 0) for stable output."""
    return q if q[3] >= 0 else (-q[0], -q[1], -q[2], -q[3])


def qswing_to(frm, to):
    """Shortest-arc rotation taking unit vector `frm` to `to`."""
    f = norm(frm)
    t = norm(to)
    d = dot(f, t)
    if d < -0.999999:
        ax = cross((1.0, 0.0, 0.0), f)
        if length(ax) < 1e-6:
            ax = cross((0.0, 1.0, 0.0), f)
        return qaxis(ax, 180.0)
    c = cross(f, t)
    return qnorm((c[0], c[1], c[2], 1.0 + d))


# ----------------------------------------------------------------------------------------------------------------
# Keyed channels: cubic Hermite with clamped tangents (an auto-clamped Bezier F-curve)
# ----------------------------------------------------------------------------------------------------------------

class Curve:
    """A keyed scalar channel. Keys (t, value); `period` makes it cyclic (the last key's value must equal the
    first's + 0). Tangents: Catmull-Rom secant average, zero at local extrema, limited (Fritsch-Carlson) so a
    segment never overshoots its keys; a key may pin its own slope."""

    def __init__(self, keys, period=None, ease_ends=True):
        ks = sorted(keys, key=lambda k: k[0])
        self.t = [float(k[0]) for k in ks]
        self.v = [float(k[1]) for k in ks]
        self.pinned = [k[2] if len(k) > 2 else None for k in ks]
        self.period = period
        self.ease_ends = ease_ends
        self.m = self._tangents()

    def _tangents(self):
        t, v, n = self.t, self.v, len(self.t)
        if n == 1:
            return [0.0]
        sec = [(v[i + 1] - v[i]) / (t[i + 1] - t[i]) for i in range(n - 1)]
        m = [0.0] * n
        for i in range(n):
            if self.pinned[i] is not None:
                m[i] = self.pinned[i]
                continue
            if 0 < i < n - 1:
                a, b = sec[i - 1], sec[i]
                ha, hb = t[i] - t[i - 1], t[i + 1] - t[i]
            elif self.period is not None:
                # Cyclic: the key at t[0] (and its copy at t[-1]) sees the last and first segments.
                a, b = sec[-1], sec[0]
                ha, hb = t[-1] - t[-2], t[1] - t[0]
            else:
                m[i] = 0.0 if self.ease_ends else sec[0 if i == 0 else -1]
                continue
            if a * b <= 0:
                m[i] = 0.0  # a local extremum: flat (auto-clamped)
            else:
                # Non-uniform Catmull-Rom slope, limited (Fritsch-Carlson) so no segment overshoots its keys.
                mm = (a * hb + b * ha) / (ha + hb)
                lim = 3.0 * min(abs(a), abs(b))
                m[i] = clamp(mm, -lim, lim)
        if self.period is not None and n > 1:
            m[-1] = m[0]
        return m

    def __call__(self, x):
        t, v, m = self.t, self.v, self.m
        n = len(t)
        if n == 1:
            return v[0]
        if self.period is not None:
            span = self.period
            x = t[0] + ((x - t[0]) % span)
        if x <= t[0]:
            return v[0]
        if x >= t[-1]:
            return v[-1]
        lo, hi = 0, n - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if t[mid] <= x:
                lo = mid
            else:
                hi = mid
        h = t[hi] - t[lo]
        s = (x - t[lo]) / h
        s2 = s * s
        s3 = s2 * s
        return ((2 * s3 - 3 * s2 + 1) * v[lo] + (s3 - 2 * s2 + s) * h * m[lo] + (-2 * s3 + 3 * s2) * v[hi]
                + (s3 - s2) * h * m[hi])


class Channels:
    """Named keyed channels. A channel holds scalars or 3-vectors (each component its own Curve). Bones a key leaves
    out keep their own neighbouring keys (each channel is independent, like F-curves)."""

    def __init__(self, period=None):
        self.keys = {}
        self.period = period
        self._curves = None

    def key(self, t, **values):
        for name, val in values.items():
            self.keys.setdefault(name, []).append((t, val))
        self._curves = None
        return self

    def _build(self):
        self._curves = {}
        for name, ks in self.keys.items():
            if isinstance(ks[0][1], (int, float)):
                self._curves[name] = ('s', Curve([(t, v) for t, v in ks], self.period))
            else:
                dim = len(ks[0][1])
                self._curves[name] = ('v', [Curve([(t, v[i]) for t, v in ks], self.period) for i in range(dim)])

    def has(self, name):
        return name in self.keys

    def get(self, name, t, default=None):
        if self._curves is None:
            self._build()
        c = self._curves.get(name)
        if c is None:
            return default
        if c[0] == 's':
            return c[1](t)
        return tuple(cc(t) for cc in c[1])


# ----------------------------------------------------------------------------------------------------------------
# Forward kinematics and IK
# ----------------------------------------------------------------------------------------------------------------

def fk(ground, hips_off, local):
    """World positions and rotations of every bone. `ground` = (x, z, yawDeg); `hips_off` in the ground frame;
    `local` = dict bone -> quaternion (hips relative to the ground frame)."""
    gq = qyaw(ground[2])
    gp = (ground[0], 0.0, ground[1])
    W = {}
    P = {}
    for b in BONES:
        p = PARENT[b]
        q = local.get(b, QI)
        if p is None:
            P[b] = add(gp, qrot(gq, add(OFFSET['hips'], hips_off)))
            W[b] = qmul(gq, q)
        else:
            P[b] = add(P[p], qrot(W[p], OFFSET[b]))
            W[b] = qmul(W[p], q)
    return P, W


def leg_ik(hip_joint, hips_world_q, ankle, foot_world_q, pole_dir):
    """Two-bone leg IK. Returns (thigh_local, shin_local, foot_local, reach_error_m). The knee bends about the
    thigh's local X (shin X > 0 bends the knee); `pole_dir` is where the kneecap points."""
    a, b = THIGH, SHIN
    to = sub(ankle, hip_joint)
    dist = length(to)
    err = max(0.0, dist - (a + b - 1e-4))
    d = clamp(dist, abs(a - b) + 1e-4, a + b - 1e-4)
    n = norm(to) if dist > 1e-9 else (0.0, -1.0, 0.0)
    m = sub(pole_dir, mul(n, dot(pole_dir, n)))
    if length(m) < 1e-6:
        m = qrot(hips_world_q, (0.0, 0.0, 1.0))
        m = sub(m, mul(n, dot(m, n)))
    m = norm(m)
    ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1.0, 1.0)
    al = math.acos(ca)
    t = add(mul(n, math.cos(al)), mul(m, math.sin(al)))
    knee = add(hip_joint, mul(t, a))
    zt = add(mul(n, -math.sin(al)), mul(m, math.cos(al)))
    yt = mul(t, -1.0)
    xt = cross(yt, zt)
    w_thigh = qbasis(xt, yt, zt)
    reached = add(hip_joint, mul(n, d))
    s = norm(sub(reached, knee))
    theta = math.atan2(-dot(s, zt), dot(s, t)) / DEG
    shin_local = qaxis((1.0, 0.0, 0.0), theta)
    w_shin = qmul(w_thigh, shin_local)
    thigh_local = qmul(qconj(hips_world_q), w_thigh)
    foot_local = qmul(qconj(w_shin), foot_world_q)
    return thigh_local, shin_local, foot_local, err, w_shin


def arm_ik(shoulder, chest_world_q, wrist, pole_dir):
    """Two-bone arm IK. The elbow tip points along `pole_dir`; the forearm flexes forward (forearm X < 0).
    Returns (upper_local, fore_local, w_fore, reach_error_m)."""
    a, b = UPPER, FORE
    to = sub(wrist, shoulder)
    dist = length(to)
    err = max(0.0, dist - (a + b - 1e-4))
    d = clamp(dist, abs(a - b) + 1e-4, a + b - 1e-4)
    n = norm(to) if dist > 1e-9 else (0.0, -1.0, 0.0)
    m = sub(pole_dir, mul(n, dot(pole_dir, n)))
    if length(m) < 1e-6:
        m = qrot(chest_world_q, (0.0, 0.0, -1.0))
        m = sub(m, mul(n, dot(m, n)))
    m = norm(m)
    ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1.0, 1.0)
    al = math.acos(ca)
    u = add(mul(n, math.cos(al)), mul(m, math.sin(al)))
    elbow = add(shoulder, mul(u, a))
    zu = add(mul(n, math.sin(al)), mul(m, -math.cos(al)))
    yu = mul(u, -1.0)
    xu = cross(yu, zu)
    w_upper = qbasis(xu, yu, zu)
    reached = add(shoulder, mul(n, d))
    f = norm(sub(reached, elbow))
    theta = math.atan2(dot(f, zu), dot(f, u)) / DEG
    fore_local = qaxis((1.0, 0.0, 0.0), -theta)
    w_fore = qmul(w_upper, fore_local)
    upper_local = qmul(qconj(chest_world_q), w_upper)
    return upper_local, fore_local, w_fore, err


def foot_world(yaw_deg, pitch_deg, roll_deg=0.0):
    """Foot world rotation: heading yaw, then pitch about the foot's lateral axis (+ = toes down, heel up), then a
    small roll (+ = sole turned in for the left foot)."""
    return qmul(qyaw(yaw_deg), qmul(qaxis((1.0, 0.0, 0.0), pitch_deg), qaxis((0.0, 0.0, 1.0), roll_deg)))


# ----------------------------------------------------------------------------------------------------------------
# Foot plants and swings
# ----------------------------------------------------------------------------------------------------------------

class Plant:
    """A foot on the ground from t0 to t1 (either may be infinite: standing). `ball` is the ball-of-foot ground
    point (x, z) in clip space, `yaw` the foot's heading. Roll: a landing phase of `land_s` seconds (negative `land`
    pitch = heel strike, pivot on the heel; positive = forefoot first, pivot on the ball) easing to `low` (0 = flat;
    > 0 = the heel never touches, a sprinter's forefoot stance), then the heel peels for the last `peel_s` seconds,
    pivoting on the ball, up to `off` at t1. Swing fields shape the swing that ENDS at this plant."""

    def __init__(self, side, t0, t1, ball, yaw, land=0.0, off=0.0, land_s=0.06, peel_s=0.2, low=0.0, lift=0.1,
                 lift_peak=0.4, lag=0.0, swing_mid_pitch=None, bulge=0.01, swing_keys=None):
        self.side = side
        self.t0 = t0
        self.t1 = t1
        self.ball = ball
        self.yaw = yaw
        self.land = land
        self.off = off
        span = t1 - t0
        self.land_s = 0.0 if math.isinf(t0) else min(land_s, 0.45 * span)
        self.peel_s = 0.0 if math.isinf(t1) else min(peel_s, (0.9 * span) - self.land_s if not math.isinf(span) else peel_s)
        self.low = low
        self.lift = lift
        self.lift_peak = lift_peak
        self.lag = lag
        self.swing_mid_pitch = swing_mid_pitch
        self.bulge = bulge
        # Swing waypoints for the swing that ends here: (s, mode, forward_m, height_m) with mode 'kick' (offset from
        # the toe-off point, height above the ground) or 'reach' (offset from the strike point, height above it).
        self.swing_keys = swing_keys if swing_keys is not None else [(0.5, 'arc', 0.0, lift)]
        # Optional pivot while planted: (t_start, t_end, dyaw_deg). The shoe turns about its sole tip, which stays
        # put (a fielder turning on the front of his foot); only for heel-up (pitch >= 0) phases.
        self.pivot = None

    def pitch_at(self, t):
        if self.land_s > 0 and t < self.t0 + self.land_s:
            return lerp(self.land, self.low, smooth((t - self.t0) / self.land_s))
        if self.peel_s > 0 and t > self.t1 - self.peel_s:
            u = clamp((t - (self.t1 - self.peel_s)) / self.peel_s, 0.0, 1.0)
            return lerp(self.low, self.off, u ** 1.7)
        return self.low

    def ankle_at(self, t):
        """Ankle position and foot world rotation while planted (pivot on the heel for negative pitch, else ball)."""
        pitch = self.pitch_at(t)
        if self.pivot is not None:
            ps, pe, dyaw = self.pivot
            u = clamp((t - ps) / (pe - ps), 0.0, 1.0)
            yaw = self.yaw + dyaw * smooth(u)
            # Turning on the front of the foot lifts the heel a little, then sets it down at the new heading.
            pitch = max(pitch, 14.0 * math.sin(math.pi * u) ** 2)
            toe_w = add((self.ball[0], 0.0, self.ball[1]), qrot(foot_world(self.yaw, 0.0), sub(TOE, BALL)))
            q = foot_world(yaw, max(0.0, pitch))
            return sub(toe_w, qrot(q, TOE)), q
        q = foot_world(self.yaw, pitch)
        q0 = foot_world(self.yaw, 0.0)
        ball_w = (self.ball[0], 0.0, self.ball[1])
        # A rigid shoe: it rocks on the heel (toes up) or on the sole's tip (heel up); flat, every point is down.
        pivot = HEEL if pitch < 0 else TOE
        pivot_w = add(ball_w, qrot(q0, sub(pivot, BALL)))
        ankle = sub(pivot_w, qrot(q, pivot))
        return ankle, q


def bump(s, peak):
    """0 at both ends with zero slope, 1 at `peak`."""
    s = clamp(s, 0.0, 1.0)
    g = math.log(0.5) / math.log(clamp(peak, 0.05, 0.95))
    return math.sin(math.pi * s ** g) ** 2


def hermite(p0, v0, p1, v1, s, h):
    s2 = s * s
    s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * v0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * v1


class FootTrack:
    """The plants of one foot in time order; swings between consecutive plants."""

    def __init__(self, side, plants):
        self.side = side
        self.plants = sorted(plants, key=lambda p: p.t0)

    def _waypoints(self, r0, v0, r1, v1, h, s, nxt):
        return _waypoints_impl(r0, v0, r1, v1, h, s, self._prev_yaw, nxt)

    def state(self, t, ground_xz=None, dt=1e-3):
        """(mode, ankle, foot_world_q or swing spec, planted, extra); mode is 'plant' or 'swing'. The swing is
        interpolated in the frame moving with the ground origin (`ground_xz(t)`), matched in position and velocity
        at toe-off and at the strike: a running foot keeps travelling back and up after toe-off (the heel kick)
        before it is driven forward, and it lands moving with the ground, so a planted foot never skids."""
        ps = self.plants
        for i, p in enumerate(ps):
            if p.t0 <= t <= p.t1:
                a, q = p.ankle_at(t)
                return 'plant', a, q, True, None
        prev = None
        nxt = None
        for p in ps:
            if p.t1 < t:
                prev = p
            elif p.t0 > t and nxt is None:
                nxt = p
        if prev is None and nxt is not None:
            a, q = nxt.ankle_at(nxt.t0)
            return 'plant', a, q, True, None
        if nxt is None and prev is not None:
            # After the last plant has lifted (and no plant follows) the foot is no longer in contact; the clip's
            # FK legs take over (legFK channel).
            a, q = prev.ankle_at(prev.t1)
            return 'plant', a, q, False, None
        t0, t1 = prev.t1, nxt.t0
        h = t1 - t0
        s = (t - t0) / h
        self._prev_yaw = prev.yaw
        G = ground_xz or (lambda tt: (0.0, 0.0))

        def g3(tt):
            g = G(tt)
            return (g[0], 0.0, g[1])

        def gv(tt):
            a, b = g3(tt - dt), g3(tt + dt)
            return mul(sub(b, a), 0.5 / dt)

        a0, q0 = prev.ankle_at(t0)
        a0b, _ = prev.ankle_at(t0 - dt)
        v0 = sub(mul(sub(a0, a0b), 1.0 / dt), gv(t0))
        a1, q1 = nxt.ankle_at(t1)
        a1b, _ = nxt.ankle_at(t1 + dt)
        v1 = sub(mul(sub(a1b, a1), 1.0 / dt), gv(t1))
        r0 = sub(a0, g3(t0))
        r1 = sub(a1, g3(t1))
        gt = g3(t)
        if nxt.swing_keys:
            pos = list(add(gt, self._waypoints(r0, v0, r1, v1, h, s, nxt)))
            side_x = 1.0 if self.side == 'L' else -1.0
            out = qrot(qyaw(lerp(prev.yaw, nxt.yaw, smooth(s))), (side_x, 0.0, 0.0))
            bl = nxt.bulge * math.sin(math.pi * s) ** 2
            pos[0] += out[0] * bl
            pos[2] += out[2] * bl
            return 'swing', tuple(pos), (q0, q1, s, nxt.swing_mid_pitch), False, (prev, nxt)
        pos = [gt[k] + hermite(r0[k], v0[k], r1[k], v1[k], s, h) for k in range(3)]
        pos[1] += nxt.lift * bump(s, nxt.lift_peak)
        side_x = 1.0 if self.side == 'L' else -1.0
        out = qrot(qyaw(lerp(prev.yaw, nxt.yaw, smooth(s))), (side_x, 0.0, 0.0))
        bl = nxt.bulge * math.sin(math.pi * s) ** 2
        pos[0] += out[0] * bl
        pos[2] += out[2] * bl
        return 'swing', tuple(pos), (q0, q1, s, nxt.swing_mid_pitch), False, (prev, nxt)


# ----------------------------------------------------------------------------------------------------------------
# The clip: control channels -> VC17 frames
# ----------------------------------------------------------------------------------------------------------------

def _fwd_of(yaw_deg):
    return qrot(qyaw(yaw_deg), (0.0, 0.0, 1.0))


def _waypoints_impl(r0, v0, r1, v1, h, s, prev_yaw, nxt):
    """Piecewise cubic Hermite through toe-off, the authored swing waypoints and the strike, in the frame moving
    with the ground origin. End velocities are matched; inner velocities are Catmull-Rom."""
    f = _fwd_of(lerp(prev_yaw, nxt.yaw, 0.5))
    pts = [(0.0, r0)]
    for (sk, mode, fwd, hgt) in nxt.swing_keys:
        if mode == 'kick':
            base = r0
            p = (base[0] + f[0] * fwd, hgt, base[2] + f[2] * fwd)
        elif mode == 'arc':
            # A step: on the straight line from toe-off to the strike, raised.
            p = (lerp(r0[0], r1[0], sk) + f[0] * fwd, lerp(r0[1], r1[1], sk) + hgt, lerp(r0[2], r1[2], sk) + f[2] * fwd)
        elif mode == 'mid':
            # Passing under the hips: relative to the ground origin itself, at an absolute height.
            lat = lerp(r0[0], r1[0], sk) if abs(f[0]) < 0.3 else lerp(r0[2], r1[2], sk)
            p = (lat + f[0] * fwd, hgt, f[2] * fwd) if abs(f[0]) < 0.3 else (f[0] * fwd, hgt, lat + f[2] * fwd)
        else:
            base = r1
            p = (base[0] + f[0] * fwd, base[1] + hgt, base[2] + f[2] * fwd)
        pts.append((sk, p))
    pts.append((1.0, r1))
    # Lateral: straight from toe-off to the strike (eased); waypoints only shape forward and height.
    n = len(pts)
    vel = [None] * n
    vel[0] = mul(v0, h)
    vel[-1] = mul(v1, h)
    for i in range(1, n - 1):
        (sa, pa), (sb, pb) = pts[i - 1], pts[i + 1]
        vel[i] = mul(sub(pb, pa), 1.0 / (sb - sa))
    for i in range(n - 1):
        if pts[i][0] <= s <= pts[i + 1][0]:
            sa, pa = pts[i]
            sb, pb = pts[i + 1]
            hh = sb - sa
            u = (s - sa) / hh
            out = [hermite(pa[k], vel[i][k], pb[k], vel[i + 1][k], u, hh) for k in range(3)]
            # Lateral component: plain Hermite over the whole swing (no waypoint wobble).
            out[0] = hermite(r0[0], v0[0], r1[0], v1[0], s, h) if abs(f[0]) < 0.3 else out[0]
            return tuple(out)
    return r1


class Clip:
    def __init__(self, cid, pack, role, duration, rate=30, loop=False, codec=1, mirrorable=True, speed=0.0,
                 cycle_steps=0, markers=None, aliases=None, phase0=False, overlay_bones=None):
        self.id = cid
        self.pack = pack
        self.role = role
        self.duration = duration
        self.rate = rate
        self.loop = loop
        self.codec = codec
        self.mirrorable = mirrorable
        self.speed = speed
        self.cycle_steps = cycle_steps
        self.markers = dict(markers or {})
        self.aliases = dict(aliases or {})
        self.phase0 = phase0
        self.overlay_bones = overlay_bones
        self.ch = Channels(period=duration if loop else None)
        self.feet = {}
        self.contacts = []  # (bitname, t0, t1)
        self.fn = None  # optional procedural control function t -> dict (overrides channels it sets)
        self.arm_pole_space = 'ground'  # or 'chest': elbowPoleL/R keyed in the chest's frame
        self.provenance_note = ''

    # Authoring helpers --------------------------------------------------------------------------------------
    def key(self, t, **values):
        self.ch.key(t, **values)
        return self

    def plants(self, side, plants):
        self.feet[side] = FootTrack(side, plants)

    def contact(self, name, t0, t1):
        self.contacts.append((name, t0, t1))

    # Evaluation ---------------------------------------------------------------------------------------------
    def control(self, t):
        c = {}
        names = ['ground', 'hipsOff', 'hipsRot', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'forearmL',
                 'handL', 'upperArmR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
                 'handIKL', 'handIKR', 'elbowPoleL', 'elbowPoleR', 'armIKL', 'armIKR', 'legFKL', 'legFKR', 'reach',
                 'guardK',
                 'kneePoleL', 'kneePoleR', 'handWorldL', 'handWorldR']
        for n in names:
            if self.ch.has(n):
                c[n] = self.ch.get(n, t)
        if self.fn is not None:
            c.update(self.fn(t))
        return c

    def solve(self, t):
        """Returns (ground, hips_off, local quats dict, contact bits, diagnostics) at time t."""
        c = self.control(t)
        ground = c.get('ground', (0.0, 0.0, 0.0))
        hips_off = c.get('hipsOff', (0.0, 0.0, 0.0))
        local = {}
        local['hips'] = qeuler(*c.get('hipsRot', (0.0, 0.0, 0.0)))
        for b in ('spine', 'chest', 'neck', 'head'):
            local[b] = qeuler(*c.get(b, (0.0, 0.0, 0.0)))
        for b in ('upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL',
                  'thighR', 'shinR', 'footR'):
            if b in c:
                local[b] = qeuler(*c[b])
        diag = {'legErr': 0.0, 'armErr': 0.0}
        contacts = 0
        hips_off = self.guard(t, c, ground, hips_off, local['hips'])
        P, W = fk(ground, hips_off, local)
        # Legs.
        for side in ('L', 'R'):
            track = self.feet.get(side)
            fkw = c.get('legFK' + side, 0.0 if track else 1.0)
            if track is None:
                continue
            mode, ankle, fq, planted, extra = track.state(t, self._ground_xz)
            hip_joint = add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side]))
            pole = c.get('kneePole' + side)
            if pole is None:
                # Kneecap along the foot's heading, a little outward, tilted with the hips.
                fyaw = knee_yaw(_yaw_of_q(fq if mode == 'plant' else fq[1]), W['hips'])
                out = 1.0 if side == 'L' else -1.0
                pole = add(qrot(qyaw(fyaw), (0.08 * out, 0.0, 1.0)), (0.0, 0.0, 0.0))
            else:
                pole = qrot(qyaw(ground[2]), pole)
            if mode == 'plant':
                foot_q = fq
                th, sh, fo, err, w_shin = leg_ik(hip_joint, W['hips'], ankle, foot_q, pole)
            else:
                q0, q1, s, midp = fq
                prev, nxt = extra
                # Swing in joint space: thigh, knee and ankle angles are cubic Hermite curves through the toe-off
                # pose, the authored swing waypoints (solved by IK where the hips will be) and the strike pose,
                # matched in angle and rate at both plants. A swinging knee can never snap straight.
                th, sh, fo = self._swing_joint(side, prev, nxt, s)
                err = 0.0
                # Ground clearance: where the joint-space swing would brush the floor, lift the ankle (IK in the
                # same knee plane), keeping a centimetre of clearance mid-swing and none at the plants.
                for _it in range(3):
                  w_thigh = qmul(W['hips'], th)
                  knee = add(hip_joint, qrot(w_thigh, (0.0, -THIGH, 0.0)))
                  w_shin = qmul(w_thigh, sh)
                  ank_fk = add(knee, qrot(w_shin, (0.0, -SHIN, 0.0)))
                  fw = qmul(w_shin, fo)
                  low = min(add(ank_fk, qrot(fw, pt))[1] for pt in (HEEL, BALL, TOE))
                  ramp = smooth(min(s, 1.0 - s) / 0.06)
                  need = (0.01 * ramp) - low
                  if not (need > 1e-4 and ramp > 0):
                      break
                  if True:
                    k = 0.006
                    lift = (need + k * math.log1p(math.exp(-need / k))) * ramp if need < 20 * k else need * ramp
                    target = (ank_fk[0], ank_fk[1] + lift, ank_fk[2])
                    mid = mul(add(hip_joint, target), 0.5)
                    kpole = norm(sub(knee, mid))
                    th2, sh2, _, _, w_shin2 = leg_ik(hip_joint, W['hips'], target, fw, kpole)
                    th, sh = th2, sh2
                    fo = qmul(qconj(w_shin2), fw)  # keep the shoe's world attitude
            if planted and fkw < 1.0:
                contacts |= CONTACT['foot' + side]
            if fkw > 0.0:
                th = qslerp(th, local.get('thigh' + side, QI), fkw)
                sh = qslerp(sh, local.get('shin' + side, QI), fkw)
                fo = qslerp(fo, local.get('foot' + side, QI), fkw)
            else:
                diag['legErr'] = max(diag['legErr'], err)
            local['thigh' + side] = th
            local['shin' + side] = sh
            local['foot' + side] = fo
        # Arms by IK where keyed.
        P, W = fk(ground, hips_off, local)
        for side in ('L', 'R'):
            w = c.get('armIK' + side, 0.0)
            if w <= 0.0 or ('handIK' + side) not in c:
                continue
            gq = qyaw(ground[2])
            gp = (ground[0], 0.0, ground[1])
            target = add(gp, qrot(gq, c['handIK' + side]))
            pole_local = c.get('elbowPole' + side, (0.3 if side == 'L' else -0.3, -0.3, -1.0))
            # Poles are in the ground frame by default; a clip may key them in the chest's frame instead, so the
            # elbow keeps pointing "down and out" as the body turns (no flips on side-on throws and pickups).
            pole = qrot(W['chest'] if self.arm_pole_space == 'chest' else gq, pole_local)
            shoulder = add(P['chest'], qrot(W['chest'], OFFSET['upperArm' + side]))
            # Never snap the elbow straight: a target beyond ~20 degrees of elbow bend is drawn softly inside.
            to = sub(target, shoulder)
            dist = length(to)
            d0 = 0.46
            if dist > d0:
                m = 0.06
                target = add(shoulder, mul(to, (d0 + m * math.tanh((dist - d0) / m)) / dist))
            up, fo, w_fore, err = arm_ik(shoulder, W['chest'], target, pole)
            diag['armErr'] = max(diag['armErr'], err * min(1.0, w))
            local['upperArm' + side] = qslerp(local.get('upperArm' + side, QI), up, min(1.0, w))
            local['forearm' + side] = qslerp(local.get('forearm' + side, QI), fo, min(1.0, w))
            if ('handWorld' + side) in c:
                hq = qmul(gq, qeuler(*c['handWorld' + side]))
                W2 = qmul(W['chest'], qmul(local['upperArm' + side], local['forearm' + side]))
                local['hand' + side] = qslerp(local.get('hand' + side, QI), qmul(qconj(W2), hq), min(1.0, w))
        for name, t0, t1 in self.contacts:
            if t0 <= t <= t1:
                contacts |= CONTACT[name]
        for b in BONES:
            local.setdefault(b, QI)
        return ground, hips_off, local, contacts, diag

    def _ground_xz(self, t):
        g = self.control(t).get('ground', (0.0, 0.0, 0.0))
        return (g[0], g[1])

    REACH = 0.846  # hip joint to ankle, at most: the knee keeps about 6 degrees of bend
    GUARD_K = 0.018  # soft-min sharpness (m)

    def guard(self, t, c, ground, hips_off, hips_q_local):
        """Lowers the hips (smoothly) so every IK-driven foot stays reachable: a weighted soft minimum of the
        authored height and each leg's limit. A planted foot counts fully. A swinging foot counts by its current
        position just after toe-off (fading out) and by its coming strike point just before the strike (fading in),
        so the hips never dip in flight and never kink when a foot lands."""
        if not self.feet:
            return hips_off
        gq = qyaw(ground[2])
        gp = (ground[0], 0.0, ground[1])
        hips_w = qmul(gq, hips_q_local)
        base = add(gp, qrot(gq, add(OFFSET['hips'], (hips_off[0], 0.0, hips_off[2]))))
        reach = c.get('reach', self.REACH)
        terms = [(hips_off[1], 1.0)]

        def limit(side, ankle, base=base, hips_w=hips_w):
            hj0 = add(base, qrot(hips_w, OFFSET['thigh' + side]))
            dxz2 = (hj0[0] - ankle[0]) ** 2 + (hj0[2] - ankle[2]) ** 2
            if dxz2 >= reach ** 2:
                return ankle[1] - hj0[1]
            return ankle[1] + math.sqrt(reach ** 2 - dxz2) - hj0[1]

        for side, track in self.feet.items():
            if c.get('legFK' + side, 0.0) >= 1.0:
                continue
            mode, ankle, _, _, extra = track.state(t, self._ground_xz)
            if mode == 'plant':
                terms.append((limit(side, ankle), 1.0))
                continue
            prev, nxt = extra
            sw = clamp((t - prev.t1) / max(nxt.t0 - prev.t1, 1e-6), 0.0, 1.0)
            w_out = 1.0 - smooth(sw / 0.3)
            w_in = smooth((sw - 0.55) / 0.45)
            if w_out > 0:
                terms.append((limit(side, ankle), w_out))
            if w_in > 0:
                # The limit the hips will meet at the strike (evaluated with the hips where they will be then).
                land, _ = nxt.ankle_at(nxt.t0)
                cl = self.control(nxt.t0)
                gl = cl.get('ground', (0.0, 0.0, 0.0))
                hl = cl.get('hipsOff', (0.0, 0.0, 0.0))
                gql = qyaw(gl[2])
                base_l = add((gl[0], 0.0, gl[1]), qrot(gql, add(OFFSET['hips'], (hl[0], 0.0, hl[2]))))
                hw_l = qmul(gql, qeuler(*cl.get('hipsRot', (0.0, 0.0, 0.0))))
                terms.append((limit(side, land, base_l, hw_l), w_in))
        k = c.get('guardK', self.GUARD_K)
        lo = min(v for v, _ in terms)
        y = lo - k * math.log(sum(w * math.exp(-(v - lo) / k) for v, w in terms))
        return (hips_off[0], y, hips_off[2])

    def _leg_at(self, t, side, ankle, foot_q):
        """IK locals (thigh, shin, foot) of one leg at time t for an ankle target, with the guarded hips then."""
        c = self.control(t)
        ground = c.get('ground', (0.0, 0.0, 0.0))
        hips_off = c.get('hipsOff', (0.0, 0.0, 0.0))
        hq = qeuler(*c.get('hipsRot', (0.0, 0.0, 0.0)))
        hips_off = self.guard(t, c, ground, hips_off, hq)
        P, W = fk(ground, hips_off, {'hips': hq})
        hip_joint = add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side]))
        out = 1.0 if side == 'L' else -1.0
        pole = c.get('kneePole' + side)
        pole = qrot(qyaw(knee_yaw(_yaw_of_q(foot_q), W['hips'])), (0.08 * out, 0.0, 1.0)) if pole is None else qrot(qyaw(ground[2]), pole)
        th, sh, fo, err, w_shin = leg_ik(hip_joint, W['hips'], ankle, foot_q, pole)
        return th, sh, fo, w_shin

    def _swing_keys(self, side, prev, nxt):
        key = (side, id(prev), id(nxt), 'joint')
        cache = self.__dict__.setdefault('_lc', {})
        if key in cache:
            return cache[key]
        dt = 1e-3
        t0, t1 = prev.t1, nxt.t0
        h = t1 - t0

        def chans(th, sh, fo):
            e = _euler_xyz(th)
            k = 2.0 * math.atan2(sh[0], sh[3]) / DEG
            f = _euler_xyz(fo)
            return [e[0], e[1], e[2], k, f[0], f[1], f[2]]

        def plant_chans(plant, tt):
            a, q = plant.ankle_at(tt)
            th, sh, fo, _ = self._leg_at(tt, side, a, q)
            return chans(th, sh, fo)

        k0 = plant_chans(prev, t0)
        k0b = plant_chans(prev, t0 - dt)
        k1 = plant_chans(nxt, t1)
        k1a = plant_chans(nxt, t1 + dt)
        r0 = [(k0[i] - k0b[i]) / dt * h for i in range(7)]
        r1 = [(k1a[i] - k1[i]) / dt * h for i in range(7)]
        keys = [(0.0, k0)]
        track = self.feet[side]
        q1 = nxt.ankle_at(t1)[1]
        midp = nxt.swing_mid_pitch if nxt.swing_mid_pitch is not None else 8.0
        for (sk, _, _, _) in (nxt.swing_keys or []):
            tk = t0 + sk * h
            _, ank, _, _, _ = track.state(tk, self._ground_xz)
            th, sh, fo, w_shin = self._leg_at(tk, side, ank, q1)
            ch = chans(th, sh, qeuler(midp, lerp(k0[5], k1[5], sk), lerp(k0[6], k1[6], sk)))
            keys.append((sk, ch))
        keys.append((1.0, k1))
        n = len(keys)
        rates = [None] * n
        rates[0] = r0
        rates[-1] = r1
        for i in range(1, n - 1):
            (sa, a), (sb, b) = keys[i - 1], keys[i + 1]
            rates[i] = [(b[j] - a[j]) / (sb - sa) for j in range(7)]
        cache[key] = (keys, rates)
        return cache[key]

    def _swing_joint(self, side, prev, nxt, s):
        keys, rates = self._swing_keys(side, prev, nxt)
        for i in range(len(keys) - 1):
            if keys[i][0] <= s <= keys[i + 1][0]:
                sa, a = keys[i]
                sb, b = keys[i + 1]
                hh = sb - sa
                u = (s - sa) / hh
                v = [hermite(a[j], rates[i][j], b[j], rates[i + 1][j], u, hh) for j in range(7)]
                break
        else:
            v = keys[-1][1]
        return qeuler(v[0], v[1], v[2]), qaxis((1.0, 0.0, 0.0), v[3]), qeuler(v[4], v[5], v[6])

    def _swing_foot_local(self, side, t, s, prev, nxt, w_shin, midp):
        """The ankle in swing, as Euler XYZ channels (X = plantar/dorsiflexion): a cubic Hermite from toe-off
        through the authored mid-swing angle to the strike, matched in angle AND angular rate at both ends, so the
        foot never snaps when it leaves or meets the ground."""
        dt = 1e-3

        def euler_at(tt, plant):
            g, h, loc, _, _ = self._solve_legs_only(tt, side, plant)
            return _euler_xyz(loc)

        e0 = self._cache_local(side, prev, 'end', lambda: euler_at(prev.t1, prev))
        e0b = self._cache_local(side, prev, 'endb', lambda: euler_at(prev.t1 - dt, prev))
        e1 = self._cache_local(side, nxt, 'start', lambda: euler_at(nxt.t0, nxt))
        e1b = self._cache_local(side, nxt, 'starta', lambda: euler_at(nxt.t0 + dt, nxt))
        h = nxt.t0 - prev.t1
        r0 = [(e0[k] - e0b[k]) / dt for k in range(3)]
        r1 = [(e1b[k] - e1[k]) / dt for k in range(3)]
        mx = midp if midp is not None else 8.0
        mid = (mx, 0.5 * (e0[1] + e1[1]), 0.5 * (e0[2] + e1[2]))
        # Inner rate (Catmull-Rom), per unit of s.
        rm = [(e1[k] - e0[k]) for k in range(3)]
        out = []
        for k in range(3):
            if s < 0.5:
                out.append(hermite(e0[k], r0[k] * h, mid[k], rm[k], s / 0.5, 0.5))
            else:
                out.append(hermite(mid[k], rm[k], e1[k], r1[k] * h, (s - 0.5) / 0.5, 0.5))
        return qeuler(*out)

    def _cache_local(self, side, plant, which, fn):
        key = (side, id(plant), which)
        cache = self.__dict__.setdefault('_lc', {})
        if key not in cache:
            cache[key] = fn()
        return cache[key]

    def _solve_legs_only(self, t, side, plant):
        c = self.control(t)
        ground = c.get('ground', (0.0, 0.0, 0.0))
        hips_off = c.get('hipsOff', (0.0, 0.0, 0.0))
        local = {'hips': qeuler(*c.get('hipsRot', (0.0, 0.0, 0.0)))}
        hips_off = self.guard(t, c, ground, hips_off, local['hips'])
        P, W = fk(ground, hips_off, local)
        hip_joint = add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side]))
        ankle, fq = plant.ankle_at(t)
        out = 1.0 if side == 'L' else -1.0
        pole = c.get('kneePole' + side)
        pole = qrot(qyaw(knee_yaw(_yaw_of_q(fq), W['hips'])), (0.08 * out, 0.0, 1.0)) if pole is None else qrot(qyaw(ground[2]), pole)
        th, sh, fo, err, w_shin = leg_ik(hip_joint, W['hips'], ankle, fq, pole)
        return ground, hips_off, fo, 0, 0

    # Baking -------------------------------------------------------------------------------------------------
    def frames(self):
        n = int(round(self.duration * self.rate))
        count = n + 1  # loops carry the closing frame; one-shots end exactly at the duration
        out = []
        for f in range(count):
            t = f / self.rate
            out.append(self.solve(t))
        return out

    def to_vms(self, provenance):
        frames = self.frames()
        legerr = max(fr[4]['legErr'] for fr in frames)
        armerr = max(fr[4]['armErr'] for fr in frames)
        r6 = lambda x: round(x + 0.0, 6) + 0.0
        doc = {
            'format': 'VMS1',
            'id': self.id,
            'pack': self.pack,
            'role': self.role,
            'skeleton': 'VC17',
            'sampleRate': self.rate,
            'loop': self.loop,
            'mirrorable': self.mirrorable,
            'overlay': bool(self.overlay_bones),
            'phase0LeftStrike': self.phase0,
            'codec': self.codec,
            'boneMask': self.overlay_bones or 'all',
            'speedMps': r6(self.speed),
            'cycleSteps': self.cycle_steps,
            'markers': {k: r6(v) for k, v in sorted(self.markers.items())},
            'mirrorAliases': dict(sorted(self.aliases.items())),
            'frames': {
                'ground': [[r6(g[0]), r6(g[1]), r6(g[2])] for g, _, _, _, _ in frames],
                'hips': [[r6(h[0]), r6(h[1]), r6(h[2])] for _, h, _, _, _ in frames],
                'contacts': [c for _, _, _, c, _ in frames],
                'q': [[r6(v) for b in BONES for v in qcanon(loc[b])] for _, _, loc, _, _ in frames],
            },
            'tracks': {},
            'provenance': dict(provenance, ikMaxReachErrorM={'legs': r6(legerr), 'arms': r6(armerr)},
                               note=self.provenance_note),
        }
        return doc


def _euler_xyz(q):
    """Euler XYZ degrees (three.js order) of a quaternion; the inverse of qeuler away from gimbal lock."""
    x, y, z, w = q
    m11 = 1 - 2 * (y * y + z * z)
    m12 = 2 * (x * y - w * z)
    m13 = 2 * (x * z + w * y)
    m23 = 2 * (y * z - w * x)
    m33 = 1 - 2 * (x * x + y * y)
    ey = math.asin(clamp(m13, -1.0, 1.0))
    return (math.atan2(-m23, m33) / DEG, ey / DEG, math.atan2(-m12, m11) / DEG)


def knee_yaw(foot_yaw, hips_world_q):
    """The kneecap follows the foot, but never more than 35 degrees away from the pelvis's heading."""
    hy = _yaw_of_q(hips_world_q)
    d = (foot_yaw - hy + 180.0) % 360.0 - 180.0
    return hy + clamp(d, -35.0, 35.0)


def _yaw_of_q(q):
    f = qrot(q, (0.0, 0.0, 1.0))
    return math.atan2(f[0], f[2]) / DEG


def dump(doc):
    return vms_json.dumps(doc)
