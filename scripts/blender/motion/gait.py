"""
Original gait authoring for VC17 (MOTION-SPEC): a footstep generator driven by a ground path and a speed profile.

Every gait parameter is an authored key on a speed axis (standing, walk, jog, run, sprint) and is interpolated by
the instantaneous speed, so one model drives the loops, the starts, the stops, the turns and the side-steps. Feet
are planted at the ball of the foot and held fixed in the world while planted; the swing between plants is an arc
with the authored lift, heel-kick lag and ankle articulation; the hips, trunk, head and arms follow the stride
phase. Cadence, contact time and step length come from published human running and walking ranges (MOTION-SPEC
§9): walk 1.5 m/s at ~113 steps/min, jog 3.3 m/s at ~164, run 5.6 m/s at ~176, sprint 7.8 m/s at ~225.
"""
import math

from vc17 import BALL, Plant, clamp, lerp, qrot, qyaw, smooth

# Speed-axis keys. contact = ground contact time (s); zeta = share of the contact at which the ball of the foot is
# under the hip; w = lateral ankle offset (m); bob in m (walk shape below 1.6 m/s, running shape above 2.4 m/s).
ANCHORS = [
    dict(v=0.0, midS=0.52, midFwd=0.0, midY=0.10,  reach=0.846,  kickS=0.30, kickBack=0.02, kickY=0.13, driveS=0.75, driveFwd=0.02, driveY=0.03,  spm=100, contact=0.70, zeta=0.50, w=0.105, toe=7, drop=0.0, bob=0.0, sway=0.0, yawA=0, listA=0,
         tilt=1, lean=1.5, thorax=0, armBase=3, armA=0, elbow0=14, elbowA=0, abd=7, abdA=0, twist=-3, lift=0.07,
         peak=0.45, lag=0.0, midp=-6, land=-10, off=30, land_s=0.10, peel_s=0.25, low=0.0, wrist=-6),
    dict(v=1.5, midS=0.52, midFwd=0.0, midY=0.13,  reach=0.845,  kickS=0.28, kickBack=0.08, kickY=0.20, driveS=0.76, driveFwd=0.035, driveY=0.045,  spm=112.5, contact=0.60, zeta=0.56, w=0.085, toe=7, drop=-0.012, bob=0.022, sway=0.022, yawA=5,
         listA=4, tilt=3, lean=2, thorax=4, armBase=3, armA=17, elbow0=20, elbowA=8, abd=7, abdA=2, twist=-4,
         lift=0.11, peak=0.42, lag=0.0, midp=-8, land=-16, off=52, land_s=0.10, peel_s=0.26, low=0.0, wrist=-8),
    dict(v=3.3, midS=0.56, midFwd=0.05, midY=0.28,  reach=0.838,  kickS=0.30, kickBack=-0.01, kickY=0.36, driveS=0.80, driveFwd=0.0, driveY=0.05,  spm=163.6, contact=0.24, zeta=0.46, w=0.07, toe=5, drop=-0.035, bob=0.030, sway=0.012, yawA=5,
         listA=3, tilt=6, lean=4, thorax=7, armBase=-4, armA=28, elbow0=78, elbowA=14, abd=9, abdA=3, twist=-10,
         lift=0.24, peak=0.40, lag=0.0, midp=0, land=3, off=52, land_s=0.05, peel_s=0.12, low=0.0, wrist=-10),
    dict(v=5.6, midS=0.56, midFwd=0.08, midY=0.38,  reach=0.833,  kickS=0.30, kickBack=-0.04, kickY=0.50, driveS=0.74, driveFwd=0.0, driveY=0.07,  spm=175.6, contact=0.16, zeta=0.45, w=0.055, toe=4, drop=-0.045, bob=0.032, sway=0.008, yawA=6,
         listA=3, tilt=8, lean=6, thorax=9, armBase=-8, armA=40, elbow0=86, elbowA=18, abd=10, abdA=4, twist=-14,
         lift=0.40, peak=0.38, lag=0.0, midp=6, land=6, off=55, land_s=0.04, peel_s=0.09, low=2.0, wrist=-10),
    dict(v=7.8, midS=0.56, midFwd=0.10, midY=0.43,  reach=0.831,  kickS=0.30, kickBack=-0.04, kickY=0.53, driveS=0.72, driveFwd=0.0, driveY=0.08,  spm=225.0, contact=0.105, zeta=0.44, w=0.045, toe=3, drop=-0.05, bob=0.025, sway=0.006, yawA=7,
         listA=3, tilt=10, lean=8, thorax=11, armBase=-12, armA=55, elbow0=90, elbowA=22, abd=10, abdA=5,
         twist=-16, lift=0.50, peak=0.36, lag=0.0, midp=10, land=10, off=55, land_s=0.03, peel_s=0.06, low=8.0,
         wrist=-8),
]


def params(v, a=0.0):
    """Gait parameters at speed v (m/s) and forward acceleration a (m/s^2)."""
    v = clamp(abs(v), 0.0, ANCHORS[-1]['v'])
    for i in range(len(ANCHORS) - 1):
        lo, hi = ANCHORS[i], ANCHORS[i + 1]
        if v <= hi['v']:
            u = (v - lo['v']) / (hi['v'] - lo['v'])
            break
    p = {k: lerp(lo[k], hi[k], u) for k in lo}
    # Walk-to-run: the shape of the vertical bob switches between 1.6 and 2.4 m/s.
    p['runShape'] = smooth((v - 1.6) / 0.8)
    # Driving (accelerating): quicker, longer pushes, a deep forward lean, vigorous arms, feet under the hips.
    drive = max(0.0, a)
    brake = max(0.0, -a)
    p['spm'] += 11.0 * drive
    # A driving start has short, punchy contacts from the first step (not a walk's long stance).
    wd = smooth(drive / 3.0)
    p['contact'] = lerp(p['contact'], clamp(0.23 - 0.014 * v, 0.12, 0.23), wd) + 0.004 * brake
    p['zeta'] = lerp(p['zeta'], 0.30, wd)
    p['w'] = lerp(p['w'], 0.07, wd)
    # Driving steps are on the forefoot: the heel stays up, so the forward-leaning shin needs no extreme ankle bend.
    p['low'] = lerp(p['low'], 16.0, wd)
    p['land'] = lerp(p['land'], 20.0, wd)
    for k, kv in (('kickY', 0.30), ('midY', 0.26), ('lift', 0.2)):
        p[k] = max(p[k], lerp(p[k], kv, wd))
    p['accLean'] = 3.2 * drive - 1.3 * brake
    p['armA'] += 5.0 * drive
    p['lift'] = p['lift'] * (1.0 - 0.04 * drive) + 0.0
    p['bias'] = -0.02 * drive + 0.018 * brake  # where the ball lands relative to the hip: behind driving, ahead braking
    return p


class Path:
    """A ground path sampled finely: position (x, z), heading (deg), travel speed and acceleration along it."""

    def __init__(self, pos, heading, t_end, dt=0.002):
        self.pos = pos
        self.heading = heading
        self.dt = dt
        self.t_end = t_end

    def vel(self, t):
        d = self.dt
        a = self.pos(t - d)
        b = self.pos(t + d)
        return ((b[0] - a[0]) / (2 * d), (b[1] - a[1]) / (2 * d))

    def speed(self, t):
        v = self.vel(t)
        return math.hypot(v[0], v[1])

    def accel(self, t):
        """Acceleration along the heading (m/s^2): + driving forwards, - braking."""
        d = self.dt * 4
        v0 = self.vel(t - d)
        v1 = self.vel(t + d)
        h = self.heading(t) * math.pi / 180
        fx, fz = math.sin(h), math.cos(h)
        return ((v1[0] - v0[0]) * fx + (v1[1] - v0[1]) * fz) / (2 * d)

    def yaw_rate(self, t):
        d = self.dt * 4
        return (self.heading(t + d) - self.heading(t - d)) / (2 * d)


def linear_path(v, heading=0.0, direction=0.0):
    """Constant speed along `direction` (deg from +Z towards +X), facing `heading`."""
    r = direction * math.pi / 180
    return Path(lambda t: (v * t * math.sin(r), v * t * math.cos(r)), lambda t: heading, 1e9)


def profile_path(v_of_t, t_end, heading=0.0, direction=0.0, dt=0.001):
    """Speed profile v(t) along a straight line: positions integrated (trapezoid) on a fine grid."""
    n = int(t_end / dt) + 4
    s = [0.0]
    for i in range(1, n + 1):
        s.append(s[-1] + 0.5 * (v_of_t((i - 1) * dt) + v_of_t(i * dt)) * dt)
    r = direction * math.pi / 180

    def dist(t):
        if t <= 0:
            return v_of_t(0.0) * t
        x = t / dt
        i = int(x)
        if i >= n:
            return s[n] + v_of_t(n * dt) * (t - n * dt)
        return s[i] + (s[i + 1] - s[i]) * (x - i)

    return Path(lambda t: (dist(t) * math.sin(r), dist(t) * math.cos(r)), lambda t: heading, t_end)


class Stepper:
    """Footsteps for a path. `t_go`: first lift-off (feet planted side by side before it, unless `cyclic`);
    stepping continues while the path moves or turns; then one closing step brings the feet together.
    `cyclic` (constant speed): strikes at k*step from -inf, left foot at even k (left strike at t = 0)."""

    def __init__(self, path, t0, t1, first='R', t_go=0.0, cyclic=False, stand_w=0.11, moving=None, style=None,
                 min_spm=None, stand_heading=None, enter_moving=False):
        self.path = path
        self.t0 = t0
        self.t1 = t1
        self.cyclic = cyclic
        self.stand_w = stand_w
        self.style = style or (lambda p, t: p)
        self.min_spm = min_spm
        self.enter_moving = enter_moving
        self.moving = moving or (lambda t: path.speed(t) > 0.25 or abs(path.yaw_rate(t)) > 25.0)
        self.strikes = []  # (t, side)
        self.plants = {'L': [], 'R': []}
        self.end_t = None
        self._build(first, t_go)

    def p_at(self, t):
        p = params(self.path.speed(t), self.path.accel(t))
        if self.min_spm:
            p['spm'] = max(p['spm'], self.min_spm)
        return self.style(p, t)

    def _plant(self, side, ts, p, permanent=False, closing=False):
        """A plant for a strike at ts with params p."""
        contact = p['contact']
        t_ref = ts + p['zeta'] * contact
        g = self.path.pos(t_ref)
        h = self.path.heading(t_ref)
        sx = 1.0 if side == 'L' else -1.0
        w = self.stand_w if closing else p['w']
        bias = 0.0 if closing else p['bias']
        # The foot points where the body is heading as it lands (on a turn the hips and foot open together).
        yaw = self.path.heading(ts + 0.25 * contact) + sx * p['toe']
        if closing:
            g = self.path.pos(self.t1 + 10.0)
            h = self.path.heading(self.t1 + 10.0)
            yaw = h + sx * 7.0
        lat = qrot(qyaw(h), (sx * w, 0.0, bias))
        # The hip passes over the ball of the foot at `zeta` of the contact (the ankle, behind it, a little earlier).
        ball = (g[0] + lat[0], g[1] + lat[2])
        t1 = math.inf if permanent else ts + contact
        land = 0.0 if closing else p['land']
        return Plant(side, ts, t1, ball, yaw, land=land, off=p['off'], land_s=p['land_s'] if not closing else 0.08,
                     peel_s=p['peel_s'], low=0.0 if closing else p['low'],
                     lift=p['lift'] if not closing else min(p['lift'], 0.09), lift_peak=p['peak'], lag=p['lag'],
                     swing_mid_pitch=p['midp'], bulge=0.012,
                     swing_keys=[(p['kickS'], 'kick', p['kickBack'], p['kickY'] if not closing else min(p['kickY'], 0.14)),
                                 (p['midS'], 'mid', p['midFwd'], p['midY'] if not closing else min(p['midY'], 0.12)),
                                 (p['driveS'], 'reach', p['driveFwd'], p['driveY'])])

    def _build(self, first, t_go):
        if self.cyclic:
            p = self.p_at(0.0)
            step = 60.0 / p['spm']
            k0 = int(math.floor(self.t0 / step)) - 6
            k1 = int(math.ceil(self.t1 / step)) + 6
            for k in range(k0, k1 + 1):
                side = 'L' if k % 2 == 0 else 'R'
                ts = k * step
                self.strikes.append((ts, side))
                self.plants[side].append(self._plant(side, ts, p))
            return
        # Standing feet before the go.
        h0 = self.path.heading(self.t0)
        g0 = self.path.pos(self.t0)
        stand = {}
        for side in ('L', 'R'):
            sx = 1.0 if side == 'L' else -1.0
            yaw = h0 + sx * 7.0
            lat = qrot(qyaw(h0), (sx * self.stand_w, 0.0, 0.0))
            bo = qrot(qyaw(yaw), (0.0, 0.0, BALL[2]))
            stand[side] = (g0[0] + lat[0] + bo[0], g0[1] + lat[2] + bo[2], yaw)
        other = 'L' if first == 'R' else 'R'
        # Virtual strike of the other foot at t_go (phase 0 if it is the left).
        self.strikes.append((t_go, other))
        t = t_go
        side = first
        p = self.p_at(t_go + 0.06)
        step = 60.0 / p['spm']
        seq = []
        while True:
            ts = t + step
            moving_next = self.moving(ts) and ts < self.t1
            if not moving_next:
                seq.append((ts, side, self.p_at(ts), True))
                break
            pp = self.p_at(ts)
            seq.append((ts, side, pp, False))
            step = 60.0 / pp['spm']
            t = ts
            side = 'L' if side == 'R' else 'R'
            if len(seq) > 60:
                break
        # The first foot leaves its standing spot at t_go; the other stands until its normal lift-off.
        first_lift = t_go
        ts1, _, p1, _ = seq[0]
        other_lift = ts1 + max(0.03, p1['contact'] - 60.0 / p1['spm'])
        stand_p = self.p_at(t_go)
        for sd, lift in ((first, first_lift), (other, other_lift)):
            bx, bz, yaw = stand[sd]
            self.plants[sd].append(Plant(sd, -math.inf, lift, (bx, bz), yaw, off=min(30.0, stand_p['off']),
                                         peel_s=min(0.12, max(0.04, (lift - self.t0) * 0.5)), low=0.0))
        prev_side = other
        for i, (ts, sd, pp, closing) in enumerate(seq):
            self.strikes.append((ts, sd))
            if closing:
                # The foot that is down stays down; the closing foot lands beside it.
                down = self.plants[prev_side][-1]
                down.t1 = math.inf
                down.peel_s = 0.0
                self.plants[sd].append(self._plant(sd, ts, pp, permanent=True, closing=True))
                self.end_t = ts
            else:
                self.plants[sd].append(self._plant(sd, ts, pp))
            prev_side = sd

    def phase(self, t):
        """Stride phase: integer at a left strike, +0.5 at a right strike."""
        ss = self.strikes
        if self.cyclic:
            step = ss[1][0] - ss[0][0]
            return t / (2 * step)
        if t <= ss[0][0]:
            return 0.0 if ss[0][1] == 'L' else 0.5
        for i in range(len(ss) - 1):
            a, b = ss[i], ss[i + 1]
            if a[0] <= t < b[0]:
                base = self._phase_index(i)
                return base + 0.5 * (t - a[0]) / (b[0] - a[0])
        return self._phase_index(len(ss) - 1)

    def _phase_index(self, i):
        side0 = self.strikes[0][1]
        start = 0.0 if side0 == 'L' else 0.5
        return start + 0.5 * i

    def step_phase(self, t):
        """(phase in [0, 1) within the current step, step duration, contact time of the current stance)."""
        ss = self.strikes
        for i in range(len(ss) - 1):
            a, b = ss[i], ss[i + 1]
            if a[0] <= t < b[0]:
                return (t - a[0]) / (b[0] - a[0]), b[0] - a[0]
        return 0.0, 1.0

    def motion_weight(self, t):
        """1 while moving, easing to 0 when standing (before the go, after the closing step)."""
        if self.cyclic:
            return 1.0
        go = self.strikes[0][0]
        w_in = 1.0 if self.enter_moving else smooth((t - go + 0.05) / 0.25)
        if self.end_t is None:
            return w_in
        return w_in * (1.0 - smooth((t - self.end_t + 0.05) / 0.45))


def gait_controls(st, extra=None):
    """The procedural channel function for a Stepper: ground, hips, trunk, head and arms by stride phase."""
    path = st.path

    def fn(t):
        v = path.speed(t)
        a = path.accel(t)
        p = st.p_at(t)
        mw = st.motion_weight(t)
        ph = st.phase(t)
        c2 = math.cos(2 * math.pi * ph)
        sp, step = st.step_phase(t)
        contact_share = clamp(p['contact'] / max(step, 1e-3), 0.05, 1.0)
        walk_bob = math.cos(2 * math.pi * (sp - 0.55))
        run_bob = -math.cos(2 * math.pi * (sp - 0.5 * contact_share))
        bob = p['bob'] * lerp(walk_bob, run_bob, p['runShape']) * mw
        sway_c = math.cos(2 * math.pi * (ph - lerp(0.3, 0.5 * contact_share * 0.5, p['runShape'])))
        g = path.pos(t)
        h = path.heading(t)
        drop = p['drop'] * mw
        acc_lean = p['accLean'] * mw
        tilt = p['tilt'] * (0.5 + 0.5 * mw) + 0.3 * acc_lean
        lean_s = p['lean'] * 0.6 * (0.5 + 0.5 * mw) + 0.4 * acc_lean
        lean_c = p['lean'] * 0.4 * (0.5 + 0.5 * mw) + 0.3 * acc_lean
        yaw_p = -p['yawA'] * c2 * mw
        list_p = p['listA'] * sway_c * mw
        th = (p['thorax'] + p['yawA']) * c2 * mw
        trunk = tilt + lean_s + lean_c
        lag = 0.03
        ca = math.cos(2 * math.pi * (ph - lag)) * mw
        arm_a = p['armA']
        out = {
            'reach': p['reach'],
            'ground': (g[0], g[1], h),
            'hipsOff': (p['sway'] * sway_c * mw, drop + bob - 0.012 * max(0.0, a) * mw, 0.0),
            'hipsRot': (tilt, yaw_p, list_p),
            'spine': (lean_s, 0.45 * th, -0.6 * list_p),
            'chest': (lean_c, 0.55 * th, -0.3 * list_p),
            'neck': (-0.55 * trunk, -0.55 * p['thorax'] * c2 * mw, 0.0),
            'head': (-0.35 * trunk, -0.35 * p['thorax'] * c2 * mw, 0.0),
            'upperArmL': (p['armBase'] + arm_a * ca, p['twist'], p['abd'] + p['abdA'] * ca),
            'forearmL': (-(p['elbow0'] - p['elbowA'] * ca), 0.0, 0.0),
            'handL': (p['wrist'], 0.0, 0.0),
            'upperArmR': (p['armBase'] - arm_a * ca, -p['twist'], -(p['abd'] - p['abdA'] * ca)),
            'forearmR': (-(p['elbow0'] + p['elbowA'] * ca), 0.0, 0.0),
            'handR': (p['wrist'], 0.0, 0.0),
        }
        if extra is not None:
            out = extra(t, out, p, mw)
        return out

    return fn
