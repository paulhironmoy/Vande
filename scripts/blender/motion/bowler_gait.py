"""MOTION-BOWL gait and body synthesiser (original authoring code for the owner).

A clip is authored as keyframe curves (bowler_kin.Curve) plus a list of foot stances. synth() turns that description
into VC17 frames:
- the hips travel along an authored speed/heading profile; the ground track is the smoothed hips path;
- every stance plants the ball of the foot at a fixed world point (heel-first strikes pivot on the heel), so a planted
  foot cannot slide; swings follow a smooth path in the hips' moving frame, matched in velocity at toe-off and strike;
- legs are solved with analytic two-bone IK; the hips are lowered smoothly wherever a target is out of reach;
- spine, neck, head and arms are keyframed (arms by swing angle, abduction, twist, elbow flex and wrist).
Pure Python; deterministic.
"""

import math

from bowler_kin import (
    LEG, SHIN, THIGH, TIP, qfrom_axes, vcross, vdot,
    BALL, BALL_IN_HAND, HEEL, HIP_H, IDQ, IDX, OFFSET, REST_ANKLE, Curve, arm_rot, fk, leg_ik, qconj, qeuler, qmul,
    qnorm, qrot, qslerp, qx, qy, qz, smoothstep, vadd, vlen, vnorm, vscale, vsub,
)

G = 9.81

# ----------------------------------------------------------------------------------------------------------------
# Gait laws (speed -> cadence, contact time, plant reach, hips heights). Hand-chosen to sit inside MOTION-SPEC §9.
# ----------------------------------------------------------------------------------------------------------------


# Tunable gait laws (chosen by the search recorded in the evidence; see bowler_approach.py)
LAW = {"tc0": 0.205, "tc1": 0.0155, "ahead0": 0.18, "ahead1": 0.012, "dip": 0.006, "kneeLate": 14.0, "pOff": 42.0,
       "flatEnd": 0.32, "reach": 0.826}


def runness(v):
    """0 = walking, 1 = running gait (blend over 1.8-2.6 m/s)."""
    return smoothstep(1.8, 2.6, v)


def cadence(v):
    """Steps per second."""
    fw = 1.25 + 0.45 * v
    fr = 2.35 + 0.13 * v
    g = runness(v)
    return fw * (1 - g) + fr * g


def contact_time(v):
    f = cadence(v)
    walk = 1.24 / f  # stance = 62 % of the stride
    run = LAW["tc0"] - LAW["tc1"] * v
    g = runness(v)
    return walk * (1 - g) + run * g


def plant_ahead(v):
    """Ankle ahead of the hips (m, along travel) at the strike."""
    walk = 0.20 + 0.11 * v
    run = LAW["ahead0"] + LAW["ahead1"] * v
    g = runness(v)
    return walk * (1 - g) + run * g


def hips_heights(v, t_flight):
    """(strike, mid-stance, apex) hips heights (m)."""
    g = runness(v)
    run_m = 0.916 - 0.004 * v
    run_s = run_m + LAW["dip"]
    run_a = run_s + G * t_flight * t_flight / 8.0
    walk_s, walk_m = 0.925, 0.968
    return (walk_s * (1 - g) + run_s * g, walk_m * (1 - g) + run_m * g, walk_s * (1 - g) + run_a * g)


# ----------------------------------------------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------------------------------------------


class Path:
    """Integrates speed (m/s) and heading (deg) on a 1 ms grid from t0 to t1 (start at the origin, or `start`)."""

    def __init__(self, speed, heading, t0, t1, start=(0.0, 0.0), lateral=None):
        self.dt = 0.001
        self.t0 = t0
        n = int(math.ceil((t1 - t0) / self.dt)) + 2
        self.x = [0.0] * n
        self.z = [0.0] * n
        self.h = [0.0] * n
        x, z = 0.0, 0.0
        for i in range(n):
            t = t0 + i * self.dt
            h = heading(t)
            self.h[i] = h
            self.x[i] = x
            self.z[i] = z
            v = speed(t + 0.5 * self.dt)
            hr = math.radians(heading(t + 0.5 * self.dt))
            x += v * math.sin(hr) * self.dt
            z += v * math.cos(hr) * self.dt
        self.speed = speed
        self.heading = heading
        self.lateral = lateral
        self.ox, self.oz = 0.0, 0.0
        self.shift(start[0] - self._raw(0.0)[0], start[1] - self._raw(0.0)[1])

    def shift(self, dx, dz):
        self.ox += dx
        self.oz += dz

    def _raw(self, t):
        f = (t - self.t0) / self.dt
        i = max(0, min(len(self.x) - 2, int(math.floor(f))))
        u = f - i
        return (self.x[i] + (self.x[i + 1] - self.x[i]) * u, self.z[i] + (self.z[i + 1] - self.z[i]) * u)

    def at(self, t):
        x, z = self._raw(t)
        return (x + self.ox, z + self.oz)

    def head(self, t):
        return self.heading(t)


def rot_y(h_deg, v):
    return qrot(qy(h_deg), v)


# ----------------------------------------------------------------------------------------------------------------
# Stances and foot curves
# ----------------------------------------------------------------------------------------------------------------


LATE_FROM_STANCE = False
FOOT_PREPARE = True
PREP_KEY = (0.73, 0.5)
KNEE_SETTLE = True
ROLL_MIN = 0.075
RISE_MIN = 0.09


def make_stance(foot, t_on, t_off, ball_xz, yaw, p_on, p_off, flat=(0.18, 0.5)):
    """A stance: the ball of the foot planted at ball_xz with heading yaw. Pitch keys: strike p_on (< 0 = heel first),
    flat over the `flat` fraction window, rising to p_off at toe-off (> 0 = heel up, pivot on the ball)."""
    d = t_off - t_on
    # the landing roll (strike -> flat) and the heel rise (flat -> toe-off) each take at least ROLL_MIN / RISE_MIN
    # seconds (scaled to the pitch change), so a shoe eases onto and off the ground instead of slapping
    f0 = t_on + max(d * flat[0], min(0.45 * d, ROLL_MIN * min(1.0, abs(p_on) / 10.0)))
    f1 = t_on + d * flat[1]
    f1 = min(f1, t_off - min(0.5 * d, RISE_MIN * min(1.0, abs(p_off) / 30.0)))
    f1 = max(f1, f0 + 0.01 * d)
    return {
        "foot": foot, "t_on": t_on, "t_off": t_off, "ball": ball_xz, "yaw": yaw,
        "pkeys": [(t_on, p_on), (f0, 0.0), (f1, 0.0), (t_off, p_off)],
    }


def stance_ankle(st, pitch, t=None):
    """Ankle and foot rotation of a planted foot. A stance may pivot on the ball (`yawFn`, yaw against time)."""
    bx, bz = st["ball"]
    yaw = st["yawFn"](t) if (t is not None and "yawFn" in st) else st["yaw"]
    rf = qmul(qy(yaw), qx(pitch))
    if pitch >= 0:
        # heel up: the rigid shoe rocks on its sole tip (the tip stays where the flat foot put it). With
        # `pivot: "tip"` a yawing stance turns about that fixed tip (the ball is lifted clear while it turns).
        y_tip = st["yaw"] if st.get("pivot") == "tip" else yaw
        tip = vadd((bx, 0.0, bz), rot_y(y_tip, (0.0, 0.0, TIP[2] - BALL[2])))
        return vsub(tip, qrot(rf, TIP)), rf
    heel = vadd((bx, 0.0, bz), rot_y(yaw, (0.0, 0.0, HEEL[2] - BALL[2])))
    return vsub(heel, qrot(rf, HEEL)), rf


class FootTrack:
    """One foot over the whole clip: stances (planted) and swings (smooth in the hips' moving frame)."""

    def __init__(self, foot, stances, path, swing_keys, p_mid=-8.0, standing=None):
        self.foot = foot
        self.st = sorted(stances, key=lambda s: s["t_on"])
        self.path = path
        self.swing_keys = swing_keys
        pk = []
        yk = []
        for i, s in enumerate(self.st):
            pk += s["pkeys"]
            # `yawEnd`: a pivoting stance hands its turned yaw (not its landing yaw) to the swing that follows
            y_off = s["yawFn"](s["t_off"]) if (s.get("yawEnd") and "yawFn" in s) else s["yaw"]
            yk += [(s["t_on"], s["yaw"]), (s["t_off"], y_off)]
            if i + 1 < len(self.st):
                nxt = self.st[i + 1]
                sw = nxt["t_on"] - s["t_off"]
                pk.append((s["t_off"] + 0.12 * sw, s["pkeys"][-1][1] + s.get("p_after", 10.0)))
                pk.append((s["t_off"] + 0.5 * sw, s.get("p_mid", p_mid)))
        self.pitch = Curve(pk)
        self.yaw = Curve(yk)
        self._swing = {}
        self.swing_ankle = 14.0
        self.last_u = None

    def stance_at(self, t):
        for i, s in enumerate(self.st):
            if s["t_on"] <= t <= s["t_off"]:
                return i
        return None

    def rel(self, t, A):
        M = self.path.at(t)
        h = self.path.head(t)
        d = (A[0] - M[0], A[1], A[2] - M[1])
        return rot_y(-h, d)

    def _stance_rel(self, s, t):
        A, _ = stance_ankle(s, self.pitch(t), t)
        return self.rel(t, A)

    def _build_swing(self, i):
        a = self.st[i]
        b = self.st[i + 1]
        t0, t1 = a["t_off"], b["t_on"]
        T = t1 - t0
        e = 1e-3
        r0 = self._stance_rel(a, t0)
        r0m = self._stance_rel(a, t0 - e)
        r1 = self._stance_rel(b, t1)
        r1p = self._stance_rel(b, t1 + e)
        m0 = vscale(vsub(r0, r0m), T / e)
        m1 = vscale(vsub(r1p, r1), T / e)
        keys = self.swing_keys(self.foot, a, b, r0, r1)
        pts = [(0.0, r0)] + [(u, k) for u, k in keys] + [(1.0, r1)]
        # tangents: ends from the stances, interior Catmull-Rom (non-uniform)
        tans = [m0]
        for j in range(1, len(pts) - 1):
            (ua, pa), (ub, pb) = pts[j - 1], pts[j + 1]
            tans.append(vscale(vsub(pb, pa), 1.0 / (ub - ua)))
        tans.append(m1)
        self._swing[i] = (t0, T, pts, tans)

    def _swing_rel(self, i, t):
        if i not in self._swing:
            self._build_swing(i)
        t0, T, pts, tans = self._swing[i]
        u = (t - t0) / T
        j = 0
        while j < len(pts) - 2 and u > pts[j + 1][0]:
            j += 1
        ua, pa = pts[j]
        ub, pb = pts[j + 1]
        h = ub - ua
        s = (u - ua) / h
        s2 = s * s
        s3 = s2 * s
        h00 = 2 * s3 - 3 * s2 + 1
        h10 = s3 - 2 * s2 + s
        h01 = -2 * s3 + 3 * s2
        h11 = s3 - s2
        ma, mb = tans[j], tans[j + 1]
        return tuple(h00 * pa[k] + h10 * h * ma[k] + h01 * pb[k] + h11 * h * mb[k] for k in range(3))

    def swing_of(self, t):
        for i in range(len(self.st) - 1):
            if self.st[i]["t_off"] < t < self.st[i + 1]["t_on"]:
                return i
        return None

    def at(self, t, force_stance=False):
        """(ankle world, foot world rotation, in_stance)."""
        self.last_u = None
        i = self.stance_at(t)
        if i is None and force_stance:
            # nearest stance (used for boundary derivatives just outside a stance)
            i = min(range(len(self.st)), key=lambda k: min(abs(t - self.st[k]["t_on"]), abs(t - self.st[k]["t_off"])))
            A, rf = stance_ankle(self.st[i], self.pitch(t), t)
            return A, rf, True
        pitch = self.pitch(t)
        if i is not None:
            A, rf = stance_ankle(self.st[i], pitch, t)
            return A, rf, True
        rf = qmul(qy(self.yaw(t)), qx(pitch))
        self.last_u = None
        if t < self.st[0]["t_on"]:
            A, _ = stance_ankle(self.st[0], self.pitch(self.st[0]["t_on"]))
            return A, qmul(qy(self.st[0]["yaw"]), qx(self.pitch(self.st[0]["t_on"]))), True
        if t > self.st[-1]["t_off"]:
            s = self.st[-1]
            A, rf2 = stance_ankle(s, self.pitch(s["t_off"]), s["t_off"])
            return A, rf2, True
        for i in range(len(self.st) - 1):
            if self.st[i]["t_off"] < t < self.st[i + 1]["t_on"]:
                r = self._swing_rel(i, t)
                self.last_u = (t - self.st[i]["t_off"]) / (self.st[i + 1]["t_on"] - self.st[i]["t_off"])
                M = self.path.at(t)
                d = rot_y(self.path.head(t), r)
                return (M[0] + d[0], d[1], M[1] + d[2]), rf, False
        raise RuntimeError("foot timeline gap")


def default_swing_keys(v_of_t):
    """Swing shape keyed to speed: a low arc when walking, a heel kick then a forward reach when running."""

    def keys(foot, a, b, r0, r1):
        t_mid = 0.5 * (a["t_off"] + b["t_on"])
        v = v_of_t(t_mid)
        g = runness(v)
        s = max(0.0, min(1.0, (v - 2.0) / 4.5))
        lat = lambda u: r0[0] + (r1[0] - r0[0]) * smoothstep(0, 1, u)
        walk = [
            (0.30, (lat(0.3), 0.115, r0[2] * 0.45)),
            (0.62, (lat(0.62), 0.105, 0.12 + 0.35 * (r1[2] - 0.12))),
            (0.86, (lat(0.86), 0.090, r1[2] + 0.025)),
        ]
        run = [
            (0.30, (lat(0.30), 0.19 + 0.22 * s, r0[2] * 0.72 - 0.02)),
            (0.56, (lat(0.56), 0.17 + 0.15 * s, -0.02 + 0.17 * s)),
            (0.82, (lat(0.82), 0.11 + 0.04 * s, r1[2] + 0.03 + 0.03 * s)),
        ]
        out = []
        for (uw, pw), (ur, pr) in zip(walk, run):
            out.append((uw * (1 - g) + ur * g, tuple(pw[k] * (1 - g) + pr[k] * g for k in range(3))))
        return out

    return keys


# ----------------------------------------------------------------------------------------------------------------
# Step scheduling for locomotion at a speed profile
# ----------------------------------------------------------------------------------------------------------------


def schedule_steps(path, first_foot, t_first, t_end, lat_half=0.105, p_run=(2.0, None), p_walk=(-13.0, 50.0)):
    """Strikes from t_first while t < t_end, alternating feet from first_foot, at the cadence of the speed.
    Returns stances (each with t_on, t_off and a plant from the hips path)."""
    stances = []
    t = t_first
    foot = first_foot
    while t < t_end - 1e-9:
        v = path.speed(t)
        stances.append(plant(path, foot, t, v, lat_half, p_run, p_walk))
        dt = 1.0 / cadence(v)
        for _ in range(4):
            dt = 1.0 / cadence(path.speed(t + 0.5 * dt))
        t += dt
        foot = "R" if foot == "L" else "L"
    settle_offs(path, stances)
    return stances


def settle_offs(path, stances):
    """While the speed changes, a walking stance ends a short double support after the other foot lands; a running
    stance lasts its contact time at the stance's own mid speed."""
    for k, s in enumerate(stances[:-1]):
        v = path.speed(0.5 * (s["t_on"] + stances[k + 1]["t_on"]))
        g = runness(v)
        t_walk = stances[k + 1]["t_on"] + 0.12 - 0.08 * smoothstep(1.2, 2.2, v)
        t_run = s["t_on"] + contact_time(v)
        t_off = t_walk * (1 - g) + t_run * g
        if abs(t_off - s["t_off"]) > 1e-9:
            frac = (t_off - s["t_on"]) / (s["t_off"] - s["t_on"])
            s["pkeys"] = [(s["t_on"] + (tk - s["t_on"]) * frac, pv) for tk, pv in s["pkeys"]]
            s["t_off"] = t_off


def plant(path, foot, t, v, lat_half=0.105, p_run=(2.0, None), p_walk=(-13.0, 50.0), tc=None, ahead=None, yaw_off=None):
    g = runness(v)
    tc = contact_time(v) if tc is None else tc
    M = path.at(t)
    h = path.head(t)
    side = 1.0 if foot == "L" else -1.0
    ahead = plant_ahead(v) if ahead is None else ahead
    toe_out = (6.0 * (1 - g) + 3.0 * g) * side if yaw_off is None else yaw_off
    yaw = h + toe_out
    # ball point = ankle-ahead plus the foot's length forward
    loc = (side * lat_half * (1.0 - 0.35 * g), 0.0, ahead)
    A = rot_y(h, loc)
    ballw = vadd((M[0] + A[0], 0.0, M[1] + A[2]), rot_y(yaw, (0.0, 0.0, BALL[2])))
    p_on = p_walk[0] * (1 - g) + p_run[0] * g
    p_off = p_walk[1] * (1 - g) + (LAW["pOff"] if p_run[1] is None else p_run[1]) * g
    flat = (0.2, 0.32 * (1 - g) + LAW["flatEnd"] * g)
    return make_stance(foot, t, t + tc, (ballw[0], ballw[2]), yaw, p_on, p_off, flat)


def gait_phase_fn(stances):
    """Gait phase p(t): left strikes at integers, right strikes at half-integers."""
    knots = []
    k = 0.0
    for s in sorted(stances, key=lambda s: s["t_on"]):
        knots.append((s["t_on"], s["foot"]))
    pts = []
    phase = 0.0 if knots and knots[0][1] == "L" else 0.5
    for i, (t, f) in enumerate(knots):
        if i > 0:
            phase += 0.5
        pts.append((t, phase))

    def p(t):
        if not pts:
            return 0.0
        if t <= pts[0][0]:
            if len(pts) > 1:
                rate = 0.5 / (pts[1][0] - pts[0][0])
                return pts[0][1] + (t - pts[0][0]) * rate
            return pts[0][1]
        for i in range(len(pts) - 1):
            if pts[i][0] <= t <= pts[i + 1][0]:
                u = (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0])
                return pts[i][1] + 0.5 * u
        rate = 0.5 / (pts[-1][0] - pts[-2][0]) if len(pts) > 1 else 1.0
        return pts[-1][1] + (t - pts[-1][0]) * rate

    return p


def hips_y_keys(stances, v_of_t):
    """Vertical hips keys from the step timeline: strike, mid-stance, mid-flight."""
    st = sorted(stances, key=lambda s: s["t_on"])
    keys = []
    for i, s in enumerate(st):
        v = v_of_t(s["t_on"])
        nxt = st[i + 1]["t_on"] if i + 1 < len(st) else s["t_on"] + 1.0 / cadence(v)
        tf = max(0.0, nxt - s["t_off"])
        hs, hm, ha = hips_heights(v, tf)
        keys.append((s["t_on"], hs))
        keys.append((0.5 * (s["t_on"] + s["t_off"]), hm))
        if tf > 0.02:
            keys.append((0.5 * (s["t_off"] + nxt), ha))
    return keys


# ----------------------------------------------------------------------------------------------------------------
# The synthesiser
# ----------------------------------------------------------------------------------------------------------------


def _gauss_smooth(vals, sigma_n, periodic=False):
    if sigma_n <= 0:
        return list(vals)
    r = int(math.ceil(3 * sigma_n))
    w = [math.exp(-0.5 * (k / sigma_n) ** 2) for k in range(-r, r + 1)]
    n = len(vals)
    out = []
    for i in range(n):
        acc = 0.0
        ws = 0.0
        for k in range(-r, r + 1):
            j = i + k
            if periodic:
                j %= n
            elif j < 0 or j >= n:
                continue
            acc += vals[j] * w[k + r]
            ws += w[k + r]
        out.append(acc / ws)
    return out


def synth(desc):
    """desc keys: T, rate, path (Path), feet {'L': FootTrack, 'R': FootTrack}, hipsY (callable), pelvis (callable ->
    (yawOff, pitch, roll)), lateral (callable, m), spine/chest (callable -> euler), neck/head (callable -> euler),
    arms (callable -> {'L': (phi, lat, twist, flex, ftwist, (hx, hy, hz)), 'R': ...}), ballHand, facing (callable),
    groundSigma (s), t0 (time of frame 0), surge (callable, m forward of the path), pole (callable side, t -> dir).
    Returns frames with world-consistent ground."""
    T = desc["T"]
    rate = desc["rate"]
    t0 = desc.get("t0", 0.0)
    n = int(round(T * rate)) + 1
    times = [t0 + i / rate for i in range(n)]
    path = desc["path"]
    feet = desc["feet"]
    facing = desc.get("facing", path.head)
    lateral = desc.get("lateral", lambda t: 0.0)
    surge = desc.get("surge", lambda t: 0.0)
    hipsY = desc["hipsY"]
    loop = desc.get("loop", False)

    # 1) hips height correction for reach (lower smoothly where a target is out of reach)
    fine_rate = 240
    fn = int(round(T * fine_rate)) + 1
    ftimes = [t0 + i / fine_rate for i in range(fn)]
    drop = [0.0] * fn
    for it in range(3):
        need = [0.0] * fn
        for i, t in enumerate(ftimes):
            P, R = _hips(desc, t, drop_at=lambda tt: _interp(ftimes, drop, tt))
            for side in "LR":
                A, rf, planted = feet[side].at(t)
                if not planted:
                    continue
                Ht = vadd(P, qrot(R, OFFSET[IDX["thigh" + side]]))
                d = vlen(vsub(A, Ht))
                lim = desc.get("reachLimit", LAW["reach"])
                if callable(lim):
                    lim = lim(t)
                if d > lim:
                    need[i] = max(need[i], (d - lim) / 0.85 + 0.002)
        if max(need) <= 1e-6:
            break
        # dilate then smooth, add to the drop
        dil = 18
        nd = [max(need[max(0, i - dil):min(fn, i + dil + 1)]) for i in range(fn)]
        nd = _gauss_smooth(nd, 10, periodic=loop)
        drop = [drop[i] + nd[i] for i in range(fn)]
    desc["_drop"] = (ftimes, drop)

    frames = []
    for t in times:
        frames.append(_pose(desc, t, lambda tt: _interp(ftimes, drop, tt)))

    # 1b) swing clearance: where a swinging shoe point (heel, ball, sole tip) would dip below the ground, fold the knee
    # and lift the toe a little more, smoothly over that swing (the stance frames are untouched)
    _clearance(desc, frames, rate)

    # 1c) a light temporal low-pass on the upper limbs and head (they carry no plant), and on swing legs away from
    # the stance boundaries, so no joint changes speed in a step
    _lowpass(desc, frames, desc.get("lowpass", 1.6), loop)

    # 2) ground track: smoothed hips projection (or the path) plus facing yaw; hips offset relative to it
    sig = desc.get("groundSigma", 0.0)
    wx = [f["_P"][0] for f in frames]
    wz = [f["_P"][2] for f in frames]
    if sig > 0:
        gx = _gauss_smooth(wx, sig * rate)
        gz = _gauss_smooth(wz, sig * rate)
        gb = desc.get("groundBlend")
        if gb:
            for i, t in enumerate(times):
                w = smoothstep(gb[0], gb[1], t)
                if len(gb) > 2:
                    w *= 1.0 - smoothstep(gb[2], gb[3], t)
                px, pz = path.at(t)
                gx[i] = px + (gx[i] - px) * w
                gz[i] = pz + (gz[i] - pz) * w
    else:
        gx = [path.at(t)[0] for t in times]
        gz = [path.at(t)[1] for t in times]
    for i, (f, t) in enumerate(zip(frames, times)):
        yaw = facing(t)
        f["ground"] = (gx[i], gz[i], yaw)
        P = f["_P"]
        rel = rot_y(-yaw, (P[0] - gx[i], P[1], P[2] - gz[i]))
        f["hips"] = (rel[0] - OFFSET[0][0], rel[1] - HIP_H, rel[2] - OFFSET[0][2])
        f["q"][0] = qmul(qconj(qy(yaw)), f["_R"])
        trk = {}
        if desc.get("ballHand"):
            pos, rot = fk(f)
            b = vadd(pos[IDX[desc["ballHand"]]], qrot(rot[IDX[desc["ballHand"]]], BALL_IN_HAND))
            trk["ball.hand"] = rot_y(-yaw, (b[0] - gx[i], b[1], b[2] - gz[i]))
        f["tracks"] = trk
    return frames


def _interp(xs, ys, x):
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    f = (x - xs[0]) / (xs[1] - xs[0])
    i = int(f)
    u = f - i
    return ys[i] + (ys[i + 1] - ys[i]) * u


def _hips(desc, t, drop_at):
    path = desc["path"]
    M = path.at(t)
    h = path.head(t)
    yawOff, pitch, roll = desc["pelvis"](t)
    off = rot_y(h, (desc.get("lateral", lambda tt: 0.0)(t), 0.0, desc.get("surge", lambda tt: 0.0)(t)))
    P = (M[0] + off[0], desc["hipsY"](t) - drop_at(t), M[1] + off[2])
    R = qmul(qmul(qy(h + yawOff), qx(pitch)), qz(roll))
    return P, R


def _pose(desc, t, drop_at):
    P, R = _hips(desc, t, drop_at)
    q = [IDQ] * 17
    q[0] = R
    sp = desc["spine"](t)
    ch = desc["chest"](t)
    q[IDX["spine"]] = qeuler(*sp)
    q[IDX["chest"]] = qeuler(*ch)
    chest_w = qmul(qmul(R, q[1]), q[2])
    look = desc.get("look")
    if look:
        lyaw, lpitch = look(t)
        target = qmul(qy(lyaw), qx(lpitch))
        need = qmul(qconj(chest_w), target)
        neck = qslerp(IDQ, need, 0.45)
        head = qmul(qconj(neck), need)
        q[IDX["neck"]] = neck
        q[IDX["head"]] = head
    else:
        q[IDX["neck"]] = qeuler(*desc["neck"](t))
        q[IDX["head"]] = qeuler(*desc["head"](t))
    arms = desc["arms"](t)
    chest_pos = None
    for side, sgn in (("L", 1.0), ("R", -1.0)):
        if arms[side][0] == "ik":
            # ("ik", wrist target (world), elbow pole (world dir), hand euler): two-bone arm IK in the chest frame
            _, W, pole, hand = arms[side]
            if chest_pos is None:
                sp_w = qmul(R, q[1])
                spine_pos = vadd(P, qrot(R, OFFSET[1]))
                chest_pos = vadd(spine_pos, qrot(sp_w, OFFSET[2]))
            ua, fl = arm_ik(chest_pos, chest_w, side, W, pole)
            q[IDX["upperArm" + side]] = ua
            q[IDX["forearm" + side]] = fl
            q[IDX["hand" + side]] = qeuler(*hand)
            continue
        if arms[side][0] == "q":
            _, uq, flex, ftw, hand = arms[side]
            q[IDX["upperArm" + side]] = uq
        else:
            phi, lat, tw, flex, ftw, hand = arms[side]
            q[IDX["upperArm" + side]] = arm_rot(sgn, phi, lat, tw)
        q[IDX["forearm" + side]] = qmul(qx(-flex), qy(ftw))
        q[IDX["hand" + side]] = qeuler(*hand)
    contacts = 0
    feet = desc["feet"]
    deficit = 0.0
    for side, bit in (("L", 1), ("R", 2)):
        th, sh, ft, planted, A, dfc = _leg(desc, side, t, drop_at, P, R)
        deficit = max(deficit, dfc)
        q[IDX["thigh" + side]] = th
        q[IDX["shin" + side]] = sh
        q[IDX["foot" + side]] = ft
        if planted and A[1] - REST_ANKLE <= 0.024:
            contacts |= bit
        elif planted:
            # `bitHeelUp`: a stance that rises onto the ball of the foot stays in contact (its sole tip is down)
            si_ = feet[side].stance_at(t)
            if si_ is not None and feet[side].st[si_].get("bitHeelUp"):
                contacts |= bit
    extra = desc.get("contactsExtra")
    if extra:
        contacts |= extra(t)
    return {"q": q, "_P": P, "_R": R, "contacts": contacts, "deficit": deficit, "t": t}


def _pole(desc, side, t, rf, R):
    fwd = qrot(rf, (0, 0, 1))
    pel = qrot(R, (0, 0, 1))
    sgn = 1.0 if side == "L" else -1.0
    outw = qrot(R, (sgn, 0, 0))
    pole_fn = desc.get("pole")
    if pole_fn:
        return pole_fn(side, t, fwd, pel, outw)
    return vnorm(vadd(vadd(vscale((fwd[0], 0.0, fwd[2]), 0.55), vscale(pel, 0.45)), vscale(outw, 0.12)))


def _stance_ik(desc, side, t, drop_at):
    P, R = _hips(desc, t, drop_at)
    A, rf, planted = desc["feet"][side].at(t, force_stance=True)
    th, sh, ft, dfc = leg_ik(P, R, side, A, _pole(desc, side, t, rf, R), rf)
    return th, sh, ft, A, dfc


def _angles(th, sh, ft):
    from bowler_kin import euler_xyz
    ex = euler_xyz(th)
    kx = euler_xyz(sh)[0]
    fx = euler_xyz(ft)
    return [ex[0], ex[1], ex[2], kx, fx[0], fx[1], fx[2]]


def _swing_plan(desc, side, i, drop_at):
    cache = desc.setdefault("_swingcache", {})
    key = (side, i)
    if key in cache:
        return cache[key]
    ft = desc["feet"][side]
    a = ft.st[i]
    b = ft.st[i + 1]
    t0, t1 = a["t_off"], b["t_on"]
    T = t1 - t0
    e = 1.0 / 480
    s0 = _angles(*_stance_ik(desc, side, t0, drop_at)[:3])
    s0m = _angles(*_stance_ik(desc, side, t0 - e, drop_at)[:3])
    s1 = _angles(*_stance_ik(desc, side, t1, drop_at)[:3])
    s1p = _angles(*_stance_ik(desc, side, t1 + e, drop_at)[:3])
    d0 = [(s0[k] - s0m[k]) / e * T for k in range(7)]
    d1 = [(s1p[k] - s1[k]) / e * T for k in range(7)]
    v = desc["path"].speed(0.5 * (t0 + t1))
    g = runness(v)
    sp = max(0.0, min(1.0, (v - 2.0) / 4.5))
    over = a.get("swing") or {}
    kmax = over.get("kneeMax", 60.0 * (1 - g) + (62.0 + 36.0 * sp) * g)
    ukm = over.get("kneeAt", 0.36 * (1 - g) + 0.38 * g)
    hip_over = over.get("hipOver", 4.0 + 6.0 * sp * g)
    fmid = over.get("footMid", -12.0)
    # interior keys per channel: (u, value)
    lin = lambda k, u: s0[k] + (s1[k] - s0[k]) * u
    keys = []
    for k in range(7):
        if k == 0:
            ks = [(0.5, 0.5 * (s0[0] + s1[0]) - 6.0), (0.84, s1[0] - hip_over)]
        elif k == 3:
            # the knee stays folded while the foot passes under the body (ground clearance), then extends to strike
            k_pass = over.get("kneePassAbs", max(0.72 * kmax, s1[3] + over.get("kneePass", 30.0)))
            late = s1[3] - over.get("kneeLate", LAW["kneeLate"])
            if KNEE_SETTLE:
                # the knee reaches its extension a little before the strike (a flat key) and is already flexing into
                # the landing at the stance's own rate: the rise from the flat key matches d1 (about 0.1 d1 over 0.2 u)
                rise = max(2.0, min(22.0, 0.1 * d1[3]))
                ks = [(ukm, kmax), (0.6, min(kmax - 1.0, max(k_pass, s1[3] - rise + 6.0))), (0.8, max(2.0, s1[3] - rise), "flat")]
            else:
                ks = [(ukm, kmax), (0.62, min(kmax - 1.0, k_pass)), (0.86, late)]
        elif k == 4:
            if FOOT_PREPARE and s1[4] > fmid + 6.0:
                # the foot prepares for the landing early and arrives near its strike angle with time to spare
                ks = [(0.40, fmid), (PREP_KEY[0], s1[4] + PREP_KEY[1])]
            else:
                ks = [(0.45, fmid), (0.72, fmid - 4.0)]
            if LATE_FROM_STANCE:
                ks.append((0.88, s1[4] - d1[4] * 0.12))
        else:
            ks = [(0.5, lin(k, 0.5))]
        keys.append([(0.0, s0[k])] + ks + [(1.0, s1[k])])
    # a pin: the swing must pass through a given leg state (angles and rates) at a given time, e.g. the approach
    # loop's pose at the delivery entry, so the clips join without a pop
    pins_ = desc.get("swingPins", {}).get(side) or []
    if isinstance(pins_, dict):
        pins_ = [pins_]
    pin = next((pp for pp in pins_ if t0 < pp["t"] < t1), None)
    if pin:
        u0 = (pin["t"] - t0) / T
        for k in range(7):
            ks = [kk for kk in keys[k][1:-1] if abs(kk[0] - u0) > 0.14 and kk[0] > u0]
            keys[k] = [keys[k][0], (u0, pin["angles"][k], "tan", pin["rates"][k] * T)] + ks + [keys[k][-1]]
    plan = (t0, T, keys, d0, d1)
    cache[key] = plan
    return plan


def _herm_keys(keys, m0, m1, u):
    j = 0
    while j < len(keys) - 2 and u > keys[j + 1][0]:
        j += 1
    ua, pa = keys[j][0], keys[j][1]
    ub, pb = keys[j + 1][0], keys[j + 1][1]

    def tan(k):
        if k == 0:
            return m0
        if k == len(keys) - 1:
            return m1
        if len(keys[k]) > 2 and keys[k][2] == "flat":
            return 0.0
        if len(keys[k]) > 3 and keys[k][2] == "tan":
            return keys[k][3]
        return (keys[k + 1][1] - keys[k - 1][1]) / (keys[k + 1][0] - keys[k - 1][0])

    h = ub - ua
    s = (u - ua) / h
    s2 = s * s
    s3 = s2 * s
    return ((2 * s3 - 3 * s2 + 1) * pa + (s3 - 2 * s2 + s) * h * tan(j) + (-2 * s3 + 3 * s2) * pb + (s3 - s2) * h * tan(j + 1))


def _leg(desc, side, t, drop_at, P, R):
    ft = desc["feet"][side]
    sw = ft.swing_of(t)
    if sw is None:
        A, rf, planted = ft.at(t)
        th, sh, fq, dfc = leg_ik(P, R, side, A, _pole(desc, side, t, rf, R), rf)
        return th, sh, fq, planted, A, dfc
    i = sw
    t0, T, keys, d0, d1 = _swing_plan(desc, side, i, drop_at)
    u = (t - t0) / T
    vals = [_herm_keys(keys[k], d0[k], d1[k], u) for k in range(7)]
    th = qeuler(vals[0], vals[1], vals[2])
    sh = qx(max(2.0, vals[3]))
    fq = qeuler(vals[4], vals[5], vals[6])
    # ankle (for the contact bit only)
    Ht = vadd(P, qrot(R, OFFSET[IDX["thigh" + side]]))
    thw = qmul(R, th)
    K = vadd(Ht, qrot(thw, OFFSET[IDX["shin" + side]]))
    A = vadd(K, qrot(qmul(thw, sh), OFFSET[IDX["foot" + side]]))
    return th, sh, fq, False, A, 0.0


# ----------------------------------------------------------------------------------------------------------------
# Spring-mass hips height for running stances: the hip-to-ankle distance follows a smooth compression, so the stance
# knee flexes and extends without a pop; flight phases join the stances with C1 Hermite arcs.
# ----------------------------------------------------------------------------------------------------------------


def knee_dist(flex_deg):
    k = math.radians(180.0 - flex_deg)
    return math.sqrt(THIGH_SQ + SHIN_SQ - 2 * 0.43 * 0.42 * math.cos(k))


THIGH_SQ = 0.43 * 0.43
SHIN_SQ = 0.42 * 0.42


def spring_hips(path, feet, pelvis, t0, t1, knee_strike=26.0, knee_mid=44.0, knee_off=20.0, rate=480, period=None,
                stance_filter=None):
    """Hips height (callable) from the stance geometry of `feet` (FootTrack dict) between t0 and t1."""
    n = int(round((t1 - t0) * rate)) + 1
    ts = [t0 + i / rate for i in range(n)]
    ys = [None] * n
    for side in "LR":
        ft = feet[side]
        off = OFFSET[IDX["thigh" + side]]
        for s in ft.st:
            if stance_filter and not stance_filter(s):
                continue
            ta, tb = s["t_on"], s["t_off"]
            dur = tb - ta
            ks = s.get("kneeStrike", knee_strike)
            km = s.get("kneeMid", knee_mid)
            ko = s.get("kneeOff", knee_off)
            ds, dm, do = knee_dist(ks), knee_dist(km), knee_dist(ko)
            i0 = max(0, int(math.ceil((ta - t0) * rate)))
            i1 = min(n - 1, int(math.floor((tb - t0) * rate)))
            for i in range(i0, i1 + 1):
                t = ts[i]
                u = (t - ta) / dur
                base = ds + (do - ds) * u
                mid_base = ds + (do - ds) * 0.5
                d = base - (mid_base - dm) * math.sin(math.pi * u)
                A, _, _ = ft.at(t, force_stance=True)
                M = path.at(t)
                h = path.head(t)
                yo, pt, rl = pelvis(t)
                R = qmul(qmul(qy(h + yo), qx(pt)), qz(rl))
                o = qrot(R, off)
                hx = M[0] + o[0] - A[0]
                hz = M[1] + o[2] - A[2]
                horiz2 = hx * hx + hz * hz
                y = A[1] - o[1] + math.sqrt(max(0.0, d * d - horiz2))
                ys[i] = y if ys[i] is None else min(ys[i], y)
    # fill the gaps (flights) with C1 Hermite arcs
    known = [i for i in range(n) if ys[i] is not None]
    if not known:
        raise RuntimeError("no stances for spring hips")
    out = list(ys)
    def slope(i, direction):
        j = i + direction
        if 0 <= j < n and ys[j] is not None:
            return (ys[j] - ys[i]) * rate * direction
        return 0.0
    k = 0
    segs = []
    i = 0
    while i < n:
        if ys[i] is None:
            j = i
            while j < n and ys[j] is None:
                j += 1
            segs.append((i - 1, j))
            i = j
        else:
            i += 1
    for a, b in segs:
        if a < 0 or b >= n:
            # extend flat at the ends
            if a < 0:
                for m in range(0, b):
                    out[m] = ys[b]
            else:
                for m in range(a + 1, n):
                    out[m] = ys[a]
            continue
        ya, yb = ys[a], ys[b]
        ma, mb = slope(a, -1) * -1 if False else (ys[a] - ys[a - 1]) * rate, (ys[b + 1] - ys[b]) * rate if b + 1 < n and ys[b + 1] is not None else 0.0
        H = (b - a) / rate
        # a ballistic-looking arc: Hermite with the stance end slopes
        for m in range(a + 1, b):
            u = (m - a) / (b - a)
            out[m] = _hermite1(ya, ma, yb, mb, u, H)
    return _Sampled(t0, rate, out, period)


def _hermite1(p0, m0, p1, m1, u, h):
    u2 = u * u
    u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1


class _Sampled:
    def __init__(self, t0, rate, vals, period=None):
        self.t0 = t0
        self.rate = rate
        self.vals = vals
        self.period = period

    def __call__(self, t):
        if self.period:
            t = self.t0 + ((t - self.t0) % self.period) if (t < self.t0 or t > self.t0 + (len(self.vals) - 1) / self.rate) else t
        f = (t - self.t0) * self.rate
        i = max(0, min(len(self.vals) - 2, int(math.floor(f))))
        u = min(1.0, max(0.0, f - i))
        return self.vals[i] + (self.vals[i + 1] - self.vals[i]) * u


def arm_ik(chest_pos, chest_w, side, W, pole):
    """Upper-arm and forearm local rotations placing the wrist (hand joint) at W, elbow towards `pole`."""
    a, b = 0.285, 0.255
    S = vadd(chest_pos, qrot(chest_w, OFFSET[IDX["upperArm" + side]]))
    dvec = vsub(W, S)
    d = min(max(vlen(dvec), abs(a - b) + 1e-4), a + b - 1e-4)
    u = vnorm(dvec)
    cos_a = (a * a + d * d - b * b) / (2 * a * d)
    sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
    pp = vsub(pole, vscale(u, vdot(pole, u)))
    v = vnorm(pp) if vlen(pp) > 1e-6 else vnorm(vsub(qrot(chest_w, (0, 0, -1)), vscale(u, vdot(qrot(chest_w, (0, 0, -1)), u))))
    E = vadd(S, vadd(vscale(u, a * cos_a), vscale(v, a * sin_a)))
    yu = vnorm(vsub(S, E))
    Wp = vadd(S, vscale(u, d))
    fw = vsub(Wp, E)
    zu = vsub(fw, vscale(yu, vdot(fw, yu)))
    zu = vnorm(zu) if vlen(zu) > 1e-6 else vnorm(vsub(qrot(chest_w, (0, 0, 1)), vscale(yu, vdot(qrot(chest_w, (0, 0, 1)), yu))))
    xu = vnorm(vcross(yu, zu))
    zu = vcross(xu, yu)
    up_w = qfrom_axes(xu, yu, zu)
    cos_e = (a * a + b * b - d * d) / (2 * a * b)
    flex = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, cos_e))))
    return qmul(qconj(chest_w), up_w), qx(-flex)


SHOE_POINTS = ((0.0, -0.065, -0.05), (0.0, -0.065, 0.135), (0.0, -0.065, 0.20))


def _shoe_min(P, R, q, side):
    """Lowest shoe point of one foot for a frame given hips world P, R and local quaternions q."""
    th = qmul(R, q[IDX["thigh" + side]])
    H = vadd(P, qrot(R, OFFSET[IDX["thigh" + side]]))
    K = vadd(H, qrot(th, OFFSET[IDX["shin" + side]]))
    sw = qmul(th, q[IDX["shin" + side]])
    A = vadd(K, qrot(sw, OFFSET[IDX["foot" + side]]))
    fw = qmul(sw, q[IDX["foot" + side]])
    return min(vadd(A, qrot(fw, p))[1] for p in SHOE_POINTS)


def _clearance(desc, frames, rate):
    from bowler_kin import euler_xyz
    feet = desc["feet"]
    for side in "LR":
        ft = feet[side]
        for it in range(6):
            need = [0.0] * len(frames)
            for i, f in enumerate(frames):
                sw = ft.swing_of(f["t"])
                if sw is None:
                    continue
                a, b = ft.st[sw]["t_off"], ft.st[sw + 1]["t_on"]
                u = (f["t"] - a) / (b - a)
                req = 0.018 * math.sin(math.pi * min(1.0, max(0.0, u))) ** 0.5 - 0.004
                h = _shoe_min(f["_P"], f["_R"], f["q"], side)
                if h < req:
                    need[i] = (req - h) * 260.0  # degrees of extra knee fold per metre of dip (about 2.6 deg/cm)
            if max(need) <= 0.05:
                break
            dil = 9
            nd = [max(need[max(0, i - dil):i + dil + 1]) for i in range(len(need))]
            nd = _gauss_smooth(nd, 7.0)
            for i, f in enumerate(frames):
                swi = ft.swing_of(f["t"])
                if nd[i] <= 1e-4 or swi is None:
                    continue
                a, b = ft.st[swi]["t_off"], ft.st[swi + 1]["t_on"]
                u = (f["t"] - a) / (b - a)
                # fade the correction in and out with zero slope at toe-off and strike (no speed step there)
                nd[i] *= smoothstep(0.0, 0.3, u) * (1.0 - smoothstep(0.7, 1.0, u))
                # `clearPins`: no correction at a pinned time in that swing (the pin is the pose to hand over)
                for cu in desc.get("clearPins", {}).get(side, ()):
                    if a < cu < b:
                        nd[i] *= smoothstep(0.02, 0.14, abs(f["t"] - cu))
                si, fi = IDX["shin" + side], IDX["foot" + side]
                kx = euler_xyz(f["q"][si])[0]
                f["q"][si] = qx(min(150.0, kx + nd[i]))
                fx = euler_xyz(f["q"][fi])[0]
                lift = min(0.6 * nd[i], max(0.0, fx + 34.0))  # never dorsiflex the ankle past -34 deg here
                f["q"][fi] = qmul(qx(-lift), f["q"][fi])


def _lowpass(desc, frames, sigma, loop):
    if sigma <= 0:
        return
    from bowler_kin import qnorm as _qn
    n = len(frames)
    r = int(math.ceil(3 * sigma))
    w = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-r, r + 1)]
    upper = [IDX[b] for b in ("neck", "head", "upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR")]
    legs = {"L": [IDX["thighL"], IDX["shinL"], IDX["footL"]], "R": [IDX["thighR"], IDX["shinR"], IDX["footR"]]}
    # swing weight per frame and side: 0 in stance, rising to 1 a few frames into the swing
    sw = {}
    for side in "LR":
        ft = desc["feet"][side]
        ws = []
        for f in frames:
            i = ft.swing_of(f["t"])
            if i is None:
                ws.append(0.0)
                continue
            a, b = ft.st[i]["t_off"], ft.st[i + 1]["t_on"]
            edge = min(f["t"] - a, b - f["t"])
            ws.append(smoothstep(0.02, 0.07, edge))
        sw[side] = ws
    body = frames[:-1] if loop else frames
    m = len(body)
    orig = [list(f["q"]) for f in body]

    def smoothed(bi, i):
        ref = orig[i][bi]
        acc = [0.0, 0.0, 0.0, 0.0]
        tot = 0.0
        for k in range(-r, r + 1):
            j = i + k
            if loop:
                j %= m
            elif j < 0 or j >= m:
                continue
            q = orig[j][bi]
            if q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0:
                q = (-q[0], -q[1], -q[2], -q[3])
            for c in range(4):
                acc[c] += q[c] * w[k + r]
            tot += w[k + r]
        return _qn(tuple(a / tot for a in acc))

    for i in range(m):
        f = body[i]
        for bi in upper:
            f["q"][bi] = smoothed(bi, i)
        for side in "LR":
            ws = sw[side][i]
            if ws <= 0:
                continue
            for bi in legs[side]:
                f["q"][bi] = qslerp(orig[i][bi], smoothed(bi, i), ws)
    if loop:
        frames[-1]["q"] = list(frames[0]["q"])
