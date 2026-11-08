"""
Keeper pack (MOTION-SPEC §11): the wicketkeeper's original keyframes on VC17. Owner-made; no motion capture and no
third-party motion. Author: MOTION-KEEPER (Claude agent, for the VANDE owner), on MOTION's vc17 library.

A right-handed keeper in his own actor frame: +Z towards the bowler, +X his left. `_r` clips go to his right (-X);
the `_l` versions are canonical-mirror aliases (MOTION-SPEC §3). Physics owns where he is: every clip but the
shuffle is in place (no ground track), and the dive keeps its hips offset within |x|, |z| <= 0.08 m, because the
physics path carries the dive (MOTION-SPEC §6). The shuffle's ground track is its cycle travel, for speed matching.

Honesty (MOTION-SPEC §6): the crouches are generic holds, identical for every delivery, leaning nowhere. The rise
starts at its `bounce` marker (the physics bounce). The takes and the dive are reactions, aligned on the physics
take (`take`, `reach`). `kp_stump` (§11) is not built: the physics never produces a stumping and the integrator
never wires it, so it would only cost bytes on the web and in the APK.

Wrists: glove rotations are keyed in the actor frame but interpolated relative to the forearm (swing and twist), so
the wrist turns smoothly whatever path the IK forearm takes; where a palm-to-the-ball key would wind a forearm past
about 85 degrees, the palm turns only part of the way (`neutral_palm`).

What a real keeper does, as authored here:
  crouch   a low, balanced squat on the balls of the feet (heels up), feet about shoulder width and turned out,
           knees over the toes, gloves together low between the knees with the fingers down, head still and level
  rise     he stays down until the ball pitches, then rises with it into a half-crouch, gloves together in front
  shuffle  short sideways steps, lead foot out and trail foot closing, never crossing, hips low, head level
  takes    fingers down below the waist, up above the chest; soft hands that give back with the ball
  dive     a push off the near leg, both gloves reaching, landing on his side with the gloves up, then back up
  up       standing up to spin: closer, lower, more compact, gloves nearer the ground
Gloves are placed by their centre (GLOVE_D beyond the wrist along the fingers) and oriented by finger direction and
palm normal, so the gloves stay together (GLOVE_GAP apart) and face the ball.
"""
import math

from vc17 import (OFFSET, QI, SHIN, THIGH, Channels, Clip, Curve, Plant, _euler_xyz, add, clamp, cross, dot, fk,
                  leg_ik, lerp, lerp3, mul, norm, qbasis, qconj, qeuler, qmul, qrot, qslerp, qswing_to, qyaw, smooth,
                  smoother, sub)

PACK = 'keeper'
ROLE = 'keeper'
INF = math.inf

GLOVE_D = 0.09  # glove centre beyond the wrist (m), along the fingers
GLOVE_GAP = 0.11  # glove centre to glove centre when the gloves are together (m)


# ---------------------------------------------------------------------------------------------------------------
# Authoring helpers
# ---------------------------------------------------------------------------------------------------------------

def hand_world(side, f, n):
    """World (actor-frame) hand rotation from the finger direction f and the palm normal n. At rest the fingers
    point down (-Y local) and the palm faces the body (-X local for the left hand, +X for the right)."""
    f = norm(f)
    n = norm(sub(n, mul(f, dot(n, f))))
    y = mul(f, -1.0)
    x = mul(n, -1.0) if side == 'L' else n
    z = cross(x, y)
    return qbasis(x, y, z)


def mirror_v(v):
    return (-v[0], v[1], v[2])


class KPlant(Plant):
    """A plant whose heel pitch is keyed in time (+ = heel up, rocking on the sole's tip) instead of the stock
    land / low / peel profile, so a planted foot can come down off its toes as the keeper stands up."""

    def __init__(self, side, t0, t1, ball, yaw, pitch_keys, **kw):
        super().__init__(side, t0, t1, ball, yaw, **kw)
        self.pitch_curve = Curve(pitch_keys)
        self.land_s = 0.0
        self.peel_s = 0.0

    def pitch_at(self, t):
        return self.pitch_curve(t)


def qlog(q):
    """Rotation vector (half-angle axis) of a unit quaternion on the w >= 0 hemisphere."""
    x, y, z, w = q if q[3] >= 0 else (-q[0], -q[1], -q[2], -q[3])
    sv = math.sqrt(x * x + y * y + z * z)
    if sv < 1e-12:
        return (0.0, 0.0, 0.0)
    a = math.atan2(sv, w) / sv
    return (x * a, y * a, z * a)


def qexp(r):
    a = math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2])
    if a < 1e-12:
        return QI
    k = math.sin(a) / a
    return (r[0] * k, r[1] * k, r[2] * k, math.cos(a))


def slerp_direct(a, b, t):
    """Slerp without the shortest-path sign flip (squad's inner blends must not change hemisphere mid-segment)."""
    cosv = clamp(sum(x * y for x, y in zip(a, b)), -1.0, 1.0)
    if abs(cosv) > 0.9995:
        q = tuple(x + (y - x) * t for x, y in zip(a, b))
    else:
        th = math.acos(cosv)
        sn = math.sin(th)
        k0 = math.sin((1.0 - t) * th) / sn
        k1 = math.sin(t * th) / sn
        q = tuple(x * k0 + y * k1 for x, y in zip(a, b))
    l = math.sqrt(sum(x * x for x in q))
    return tuple(x / l for x in q)


class HandTrack:
    """Hand world rotations keyed in time, interpolated by squad (Shoemake's spherical cubic) along a monotone
    Hermite key parameter, so orientations turn smoothly through every key (no vector-blend flips) and ease in
    and out at the first and last keys. Loops repeat their first key at the end."""

    def __init__(self, keys, period=None):
        ks = sorted(keys, key=lambda k: k[0])
        qs = [ks[0][1]]
        for _, q in ks[1:]:
            p = qs[-1]
            d = sum(a * b for a, b in zip(p, q))
            qs.append(q if d >= 0 else tuple(-x for x in q))
        self.t = [k[0] for k in ks]
        self.q = qs
        self.period = period
        self.s = Curve([(t, float(i)) for i, t in enumerate(self.t)])
        n = len(qs)
        self.a = []
        for i in range(n):
            if i == 0 or i == n - 1:
                self.a.append(qs[i])
                continue
            qi = qs[i]
            inv = qconj(qi)
            l1 = qlog(qmul(inv, qs[i + 1]))
            l0 = qlog(qmul(inv, qs[i - 1]))
            self.a.append(qmul(qi, qexp(tuple(-(u + v) / 4.0 for u, v in zip(l1, l0)))))

    def __call__(self, t):
        if len(self.q) == 1:
            return self.q[0]
        if self.period is not None:
            t = self.t[0] + ((t - self.t[0]) % self.period)
        s = clamp(self.s(t), 0.0, len(self.q) - 1.0)
        i = min(int(math.floor(s)), len(self.q) - 2)
        h = s - i
        p = slerp_direct(self.q[i], self.q[i + 1], h)
        r = slerp_direct(self.a[i], self.a[i + 1], h)
        return slerp_direct(p, r, 2.0 * h * (1.0 - h))


def swing_twist(q):
    """q = swing * twist, twist about the bone's Y axis. Returns (swing rotation vector (x, z), twist degrees)."""
    x, y, z, w = q if q[3] >= 0 else (-q[0], -q[1], -q[2], -q[3])
    l = math.hypot(y, w) or 1.0
    tw = (0.0, y / l, 0.0, w / l)
    sw = qmul((x, y, z, w), qconj(tw))
    r = qlog(sw)
    return (r[0], r[2]), 2.0 * math.atan2(tw[1], tw[3]) * 180.0 / math.pi


class WristTrack:
    """Wrist (hand-local) rotations keyed in time, interpolated as a swing (bend) vector and a twist angle, each a
    clamped cubic Hermite, so the bend stays within its keyed range while the forearm turns."""

    def __init__(self, keys, period=None):
        ks = sorted(keys, key=lambda k: k[0])
        sx, sz, tw = [], [], []
        prev = None
        for t, q in ks:
            (a, c), d = swing_twist(q)
            if prev is not None:
                while d - prev > 180.0:
                    d -= 360.0
                while d - prev < -180.0:
                    d += 360.0
            prev = d
            sx.append((t, a))
            sz.append((t, c))
            tw.append((t, d))
        self.period = period
        self.c = [Curve(sx, period), Curve(sz, period), Curve(tw, period)]

    def __call__(self, t):
        a, c, d = (cv(t) for cv in self.c)
        sw = qexp((a, 0.0, c))
        h = d * math.pi / 360.0
        return qmul(sw, (0.0, math.sin(h), 0.0, math.cos(h)))


class KClip(Clip):
    """A keeper clip: the stock VC17 control rig plus glove keys. A key may set, per side,
      gloveL/gloveR   glove centre (actor frame, m)
      fingL/fingR     finger direction (actor frame)
      palmL/palmR     palm normal (actor frame)
    The glove centre is a keyed channel; the finger and palm directions make a hand rotation per key, interpolated
    by squad (HandTrack). The wrist IK target is the glove centre less GLOVE_D along the fingers; after the stock
    solve, each hand is turned to its world rotation (weighted by armIK)."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.kc = Channels(period=self.duration if self.loop else None)
        self.hkeys = {'L': [], 'R': []}
        self._htrack = {}
        self.extra = None  # optional (t, glove outputs) -> dict of control overrides
        self.fn = self._fn
        self._cache = (None, None)

    def gkey(self, t, **values):
        for side in ('L', 'R'):
            if ('glove' + side) in values:
                self.kc.key(t, **{'glove' + side: values['glove' + side]})
            if ('fing' + side) in values:
                # A key without a finger direction only places the glove; the hand turns through it.
                f = values['fing' + side]
                n = values.get('palm' + side, (0.0, 0.0, 1.0))
                self.hkeys[side].append((t, hand_world(side, f, n)))
                self._htrack.pop(side, None)
        self._cache = (None, None)
        return self

    def set_hand(self, side, t, f, n):
        """Replace (or add) the hand rotation key of one side at time t."""
        ks = [k for k in self.hkeys[side] if abs(k[0] - t) > 1e-9]
        ks.append((t, hand_world(side, f, n)))
        self.hkeys[side] = sorted(ks, key=lambda k: k[0])
        self._htrack.pop(side, None)
        self.__dict__.get('_wtrack', {}).pop(side, None)
        self._cache = (None, None)

    def neutral_palm(self, side, t):
        """The palm direction the solved forearm gives at t with no wrist turn (palm to the body at rest)."""
        ground, hips_off, local, _, _ = Clip.solve(self, t)
        P, W = fk(ground, hips_off, local)
        return qrot(W['forearm' + side], (-1.0, 0.0, 0.0) if side == 'L' else (1.0, 0.0, 0.0))

    def hand_q(self, side, t):
        if side not in self._htrack:
            self._htrack[side] = HandTrack(self.hkeys[side], self.duration if self.loop else None)
        return self._htrack[side](t)

    def _fn(self, t):
        if self._cache[0] == t:
            return self._cache[1]
        out = {}
        for side in ('L', 'R'):
            g = self.kc.get('glove' + side, t)
            if g is None:
                continue
            hq = self.hand_q(side, t)
            f = qrot(hq, (0.0, -1.0, 0.0))
            out['handIK' + side] = sub(g, mul(f, GLOVE_D))
            out['_hq' + side] = hq
        if self.extra is not None:
            out.update(self.extra(t, out))
        self._cache = (t, out)
        return out

    def _wrist_track(self, side):
        """The keyed hand rotations re-expressed relative to the forearm (solved at each key time), squad-
        interpolated: the wrist turns smoothly between keys whatever path the IK forearm takes, and the glove has
        exactly its keyed world rotation at every key."""
        tr = self.__dict__.setdefault('_wtrack', {})
        if side not in tr:
            keys = []
            for tk, hq in self.hkeys[side]:
                ground, hips_off, local, _, _ = Clip.solve(self, tk)
                P, W = fk(ground, hips_off, local)
                keys.append((tk, qmul(qconj(W['forearm' + side]), qmul(qyaw(ground[2]), hq))))
            tr[side] = WristTrack(keys, self.duration if self.loop else None) if keys else None
        return tr[side]

    def solve(self, t):
        ground, hips_off, local, contacts, diag = super().solve(t)
        c = self.control(t)
        for side in ('L', 'R'):
            w = min(1.0, c.get('armIK' + side, 0.0))
            if ('_hq' + side) not in c or w <= 0.0:
                continue
            track = self._wrist_track(side)
            if track is None:
                continue
            local['hand' + side] = qslerp(local.get('hand' + side, QI), track(t), w)
        return ground, hips_off, local, contacts, diag


def key_pose(clip, t, pose, **over):
    d = dict(pose)
    d.update(over)
    body = {k: v for k, v in d.items() if k not in GLOVE_KEYS}
    gl = {k: v for k, v in d.items() if k in GLOVE_KEYS}
    if body:
        clip.key(t, **body)
    if gl:
        clip.gkey(t, **gl)


GLOVE_KEYS = ('gloveL', 'gloveR', 'fingL', 'fingR', 'palmL', 'palmR')


def gloves(centre, f, n, gap=GLOVE_GAP, spread=(1.0, 0.0, 0.0)):
    """Both gloves together around `centre`, the left glove towards +X along `spread`; f and n are the left
    glove's finger direction and palm normal; the right glove mirrors them about the gloves' midplane."""
    s = norm(spread)
    h = gap * 0.5
    gl = add(centre, mul(s, h))
    gr = sub(centre, mul(s, h))
    return {'gloveL': gl, 'gloveR': gr, 'fingL': f, 'palmL': n, 'fingR': mirror_v(f), 'palmR': mirror_v(n)}


def blend(a, b, w):
    out = dict(a)
    for k, vb in b.items():
        va = a.get(k)
        if va is None:
            out[k] = vb
        elif isinstance(vb, tuple):
            out[k] = tuple(lerp(x, y, w) for x, y in zip(va, vb))
        else:
            out[k] = lerp(va, vb, w)
    return out


# ---------------------------------------------------------------------------------------------------------------
# Stances
# ---------------------------------------------------------------------------------------------------------------

ARMS = {'armIKL': 1.0, 'armIKR': 1.0}
# Elbows tucked in and down (upper arms turned out), so palms face forward with an anatomical forearm turn.
LOW_POLES = {'elbowPoleL': (-0.8, -0.5, -0.3), 'elbowPoleR': (0.8, -0.5, -0.3)}

# Standing back to pace: a deep squat on the balls of the feet.
BACK_FEET = {'w': 0.20, 'z': 0.10, 'yaw': 16.0, 'pitch': 24.0}
CROUCH_BACK = dict(
    ARMS,
    hipsOff=(0.0, -0.52, -0.06), hipsRot=(28.0, 0.0, 0.0), spine=(12.0, 0.0, 0.0), chest=(6.0, 0.0, 0.0),
    neck=(-26.0, 0.0, 0.0), head=(-20.0, 0.0, 0.0),
    **LOW_POLES,
    **gloves((0.0, 0.26, 0.35), (0.0, -1.0, 0.15), (0.0, 0.15, 1.0)),
)

# Standing up to spin: closer to the stumps, lower and more compact, gloves nearer the ground.
UP_FEET = {'w': 0.18, 'z': 0.08, 'yaw': 18.0, 'pitch': 26.0}
CROUCH_UP = dict(
    ARMS,
    hipsOff=(0.0, -0.56, -0.07), hipsRot=(30.0, 0.0, 0.0), spine=(14.0, 0.0, 0.0), chest=(6.0, 0.0, 0.0),
    neck=(-28.0, 0.0, 0.0), head=(-22.0, 0.0, 0.0),
    **LOW_POLES,
    **gloves((0.0, 0.21, 0.36), (0.0, -1.0, 0.12), (0.0, 0.12, 1.0)),
)

# The half-crouch the rise ends in, and every take and the dive start from.
SET_PITCH = 12.0
SET = dict(
    ARMS,
    hipsOff=(0.0, -0.30, -0.04), hipsRot=(22.0, 0.0, 0.0), spine=(8.0, 0.0, 0.0), chest=(4.0, 0.0, 0.0),
    neck=(-20.0, 0.0, 0.0), head=(-14.0, 0.0, 0.0),
    **LOW_POLES,
    **gloves((0.0, 0.58, 0.42), (0.0, -1.0, 0.3), (0.0, 0.3, 1.0)),
)

# Standing with the ball after a take (blends into the idle).
WITH_BALL = dict(
    ARMS,
    hipsOff=(0.0, -0.05, 0.0), hipsRot=(5.0, 0.0, 0.0), spine=(4.0, 0.0, 0.0), chest=(2.0, 0.0, 0.0),
    neck=(-4.0, 0.0, 0.0), head=(-2.0, 0.0, 0.0),
    elbowPoleL=(0.0, -1.0, -1.0), elbowPoleR=(0.0, -1.0, -1.0),
    **gloves((0.0, 1.06, 0.25), (-0.34, 0.0, 0.94), (-0.93, 0.17, -0.34)),
)


def stance_plants(feet, t0=-INF, t1=INF, pitch_keys=None, cx=0.0):
    w, z, yaw, p = feet['w'], feet['z'], feet['yaw'], feet['pitch']
    keys = pitch_keys or [(0.0, p)]
    return (KPlant('L', t0, t1, (cx + w, z), yaw, keys), KPlant('R', t0, t1, (cx - w, z), -yaw, keys))


# ---------------------------------------------------------------------------------------------------------------
# Crouches (loops)
# ---------------------------------------------------------------------------------------------------------------

def crouch(cid, pose, feet, d=2.4, note=''):
    """A held crouch: breathing, a small settle on the toes and a slow weight shift; head and gloves quiet."""
    c = KClip(cid, PACK, ROLE, d, rate=15, loop=True, codec=1, mirrorable=True)
    L, R = stance_plants(feet)
    c.plants('L', [L])
    c.plants('R', [R])
    hx, hy, hz = pose['hipsOff']
    sx, sy, sz = pose['spine']
    cx, cy, cz = pose['chest']
    nx, ny, nz = pose['neck']
    g = pose['gloveL']
    # (t, weight shift x, settle y, breath)
    for t, wx, dy, br in ((0.0, 0.0, 0.0, 0.0), (0.6, 0.006, -0.006, 1.0), (1.2, 0.0, 0.0, 0.0),
                          (1.8, -0.006, -0.006, 1.0), (2.4, 0.0, 0.0, 0.0)):
        gl = gloves(add(mul(add(g, pose['gloveR']), 0.5), (wx * 0.5, dy * 0.6, 0.0)), pose['fingL'], pose['palmL'])
        key_pose(c, t * d / 2.4, pose, hipsOff=(hx + wx, hy + dy, hz), hipsRot=(pose['hipsRot'][0], 0.0, -wx * 120.0),
                 spine=(sx, sy, sz + wx * 60.0), chest=(cx + 1.2 * br, cy, cz + wx * 40.0),
                 neck=(nx - 1.0 * br, ny, nz + wx * 20.0), **gl)
    c.provenance_note = note
    return c


# ---------------------------------------------------------------------------------------------------------------
# Rise (one-shot): crouch -> set, starting at the physics bounce
# ---------------------------------------------------------------------------------------------------------------

RISE_BOUNCE = 0.05
RISE_SET = 0.45
RISE_END = 0.60


def rise():
    c = KClip('kp_rise', PACK, ROLE, RISE_END, rate=30, loop=False, codec=1, mirrorable=True,
              markers={'bounce': RISE_BOUNCE, 'set': RISE_SET})
    keys = [(0.0, BACK_FEET['pitch']), (RISE_BOUNCE, BACK_FEET['pitch']), (RISE_SET, SET_PITCH), (RISE_END, SET_PITCH)]
    L, R = stance_plants(BACK_FEET, pitch_keys=keys)
    c.plants('L', [L])
    c.plants('R', [R])
    key_pose(c, 0.0, CROUCH_BACK)
    key_pose(c, RISE_BOUNCE, CROUCH_BACK)
    # The hips lead the rise; the trunk and the gloves follow a touch later.
    mid = blend(CROUCH_BACK, SET, 0.55)
    key_pose(c, RISE_BOUNCE + 0.18, mid, hipsOff=blend(CROUCH_BACK, SET, 0.62)['hipsOff'])
    key_pose(c, RISE_SET, SET)
    key_pose(c, RISE_END, SET)
    c.provenance_note = 'keyframed rise from the pace crouch into the set half-crouch, starting at the bounce'
    return c


# ---------------------------------------------------------------------------------------------------------------
# Takes (one-shots): set -> gloves to the ball at `take` -> give -> stand with the ball
# ---------------------------------------------------------------------------------------------------------------

TAKE_T = 0.26
CHEST_TAKE_T = 0.30
TAKE_END = 1.0


def pair(gl, fl, nl, gr, fr, nr):
    """Explicit glove keys for both hands (left and right need not mirror each other)."""
    return {'gloveL': gl, 'fingL': fl, 'palmL': nl, 'gloveR': gr, 'fingR': fr, 'palmR': nr}


def take(cid, alias, keys, note, take_t=TAKE_T):
    """keys: (t, body pose, glove keys or None). Starts in SET, ends in WITH_BALL; the feet stay planted and come
    down off the toes as he stands."""
    c = KClip(cid, PACK, ROLE, TAKE_END, rate=60, loop=False, codec=1, mirrorable=True,
              markers={'take': take_t}, aliases={alias: 'mirror'})
    pk = [(0.0, SET_PITCH), (take_t, SET_PITCH), (take_t + 0.2, SET_PITCH - 2.0), (0.85, 0.0)]
    L, R = stance_plants(BACK_FEET, pitch_keys=pk)
    c.plants('L', [L])
    c.plants('R', [R])
    key_pose(c, 0.0, SET)
    for t, body, gl in keys:
        # Body poses carry no glove keys here: each key's gloves are exactly the ones given (or none).
        key_pose(c, t, {k: v for k, v in body.items() if k not in GLOVE_KEYS}, **(gl or {}))
    key_pose(c, TAKE_END, WITH_BALL)
    c.provenance_note = note
    return c


def take_waist():
    """Below the waist: fingers down, palms to the ball, the head moving into its line; the gloves give back
    towards the right hip, then he stands with the ball."""
    body = dict(SET, hipsOff=(-0.04, -0.25, -0.02), hipsRot=(20.0, -6.0, 2.0), spine=(10.0, -5.0, 5.0),
                chest=(4.0, -4.0, 3.0), neck=(-18.0, -6.0, -5.0), head=(-12.0, -4.0, -3.0),
                elbowPoleL=(-0.9, -0.5, -0.2), elbowPoleR=(0.6, -0.5, -0.3))
    give_body = dict(body, hipsOff=(-0.04, -0.22, -0.03), spine=(8.0, -4.0, 4.0), neck=(-16.0, -5.0, -4.0))
    at = gloves((-0.20, 0.72, 0.46), (0.0, -1.0, 0.35), (0.0, 0.35, 1.0))
    give = gloves((-0.22, 0.68, 0.28), (0.0, -1.0, 0.25), (0.0, 0.25, 1.0))
    return take('kp_take_waist_r', 'kp_take_waist_l', [(TAKE_T, body, at), (TAKE_T + 0.17, give_body, give)],
                'keyframed waist take: set half-crouch, fingers down to the ball, soft give, stand with the ball')


def take_chest():
    """Above the chest: the gloves come up with the fingers turning up, palms to the ball, thumbs together; the
    give draws them back and down, then he stands with the ball."""
    body = dict(SET, hipsOff=(-0.03, -0.14, -0.02), hipsRot=(12.0, -6.0, 0.0), spine=(4.0, -8.0, 0.0),
                chest=(0.0, -8.0, 0.0), neck=(-8.0, 10.0, 0.0), head=(-4.0, 6.0, 0.0),
                elbowPoleL=(1.0, -1.0, -0.5), elbowPoleR=(0.0, -1.0, -1.0))
    mid_body = dict(blend(SET, body, 0.5), elbowPoleL=(0.1, -0.8, -0.4), elbowPoleR=(0.4, -0.8, -0.7))
    give_body = dict(body, hipsOff=(-0.03, -0.12, -0.03))
    tt = CHEST_TAKE_T
    # The gloves rise through here; the hands turn straight from fingers-down to fingers-up (through pointing to
    # his right), the shortest turn, so the mid key places the gloves only.
    mid = {'gloveL': (-0.02, 0.88, 0.42), 'gloveR': (-0.13, 0.88, 0.42)}
    at = pair((-0.035, 1.22, 0.40), (-0.43, 0.87, 0.25), (-0.61, -0.49, 0.62),
              (-0.145, 1.22, 0.40), (-0.24, 0.71, 0.66), (0.66, -0.38, 0.65))
    give = pair((-0.05, 1.14, 0.29), (-0.35, 0.82, 0.45), (-0.65, -0.5, 0.57),
                (-0.16, 1.14, 0.29), (-0.24, 0.62, 0.75), (0.66, -0.45, 0.6))
    c = take('kp_take_chest_r', 'kp_take_chest_l',
             [(tt * 0.5, mid_body, mid), (tt, body, at), (tt + 0.17, give_body, give)],
             'keyframed chest take: set half-crouch, fingers up to the ball, soft give, stand with the ball',
             take_t=tt)
    # The left hand crosses to take a ball on his right: its palm turns most of the way to the ball, not all the
    # way, so the forearm stays inside its turn (about 80 degrees of pronation).
    for t, (_, f, n) in ((tt, (None, at['fingL'], at['palmL'])), (tt + 0.17, (None, give['fingL'], give['palmL']))):
        f = norm(f)
        n0 = c.neutral_palm('L', t)
        n0 = norm(sub(n0, mul(f, dot(n0, f))))
        w = norm(sub(n, mul(f, dot(n, f))))
        c.set_hand('L', t, f, norm(lerp3(n0, w, 0.8)))
    return c


# ---------------------------------------------------------------------------------------------------------------
# Shuffle (loop): sideways to his left, lead foot out, trail foot closing
# ---------------------------------------------------------------------------------------------------------------

SHUF_V = 1.5
SHUF_T = 0.40


def shuffle():
    T, v = SHUF_T, SHUF_V
    S = v * T
    c = KClip('kp_shuffle_l', PACK, ROLE, T, rate=60, loop=True, codec=1, mirrorable=True, speed=v, cycle_steps=2,
              phase0=True, aliases={'kp_shuffle_r': 'mirror'})
    wide, narrow = 0.86, 0.26
    a = 0.40  # the lead (left) foot lands this far beyond the hips
    z, yaw = 0.08, 10.0
    tl_off, tr_off, tr_on = 0.21, 0.01, 0.20
    pl, pr = [], []
    for k in range(-2, 4):
        o = k * T
        # Left: lands at o, lifts at o + tl_off.
        pl.append(Plant('L', o, o + tl_off, (a + k * S, z), yaw, land=20.0, low=20.0, off=28.0, land_s=0.04,
                        peel_s=0.06, swing_mid_pitch=-24.0, swing_keys=[(0.5, 'arc', 0.0, 0.08)]))
        # Right: lands at o + tr_on (narrow stance), lifts at o + T + tr_off.
        pr.append(Plant('R', o + tr_on, o + T + tr_off, (a - narrow + k * S, z), -yaw, land=20.0, low=20.0,
                        off=28.0, land_s=0.04, peel_s=0.06, swing_mid_pitch=-24.0,
                        swing_keys=[(0.5, 'arc', 0.0, 0.07)]))
    c.plants('L', pl)
    c.plants('R', pr)
    pose = dict(blend(SET, CROUCH_BACK, 0.35))
    hx, hy, hz = pose['hipsOff']
    for t in (0.0, 0.1, 0.2, 0.3, 0.4):
        key_pose(c, t, pose)
    half = T / 2.0
    surge = 0.5  # m/s: the hips surge between the foot strikes and ease as each foot lands
    amp = surge * half / (2.0 * math.pi)

    def extra(t, out):
        # The ground origin moves at constant speed; the gloves travel with it (they are in the ground frame).
        ph = 2.0 * math.pi * t / half
        dx = -amp * math.sin(ph)
        dy = -0.005 * math.cos(ph)
        return {'ground': (v * t, 0.0, 0.0), 'hipsOff': (hx + dx, hy + dy, hz),
                'neck': (pose['neck'][0] - dy * 100.0, 0.0, 0.0)}

    c.extra = extra
    c.provenance_note = f'keyframed crouched side shuffle, {v} m/s, step-close, {2 / T * 60:.0f} steps/min'
    return c


# ---------------------------------------------------------------------------------------------------------------
# Dive (one-shot): set -> push off -> gloves at the ball (`reach`) -> on his right side (`land`) -> up (`up`)
# ---------------------------------------------------------------------------------------------------------------

DIVE_REACH = 0.26
DIVE_LAND = 0.42
GETUP_K = 0.70 / 0.82  # the scramble up is authored on a slower clock and played on this one


def T(t):
    """Clip time of an authored get-up time: after the landing the authored timeline runs GETUP_K faster, so he
    is on his feet (`up`) 0.86 s after `reach`, inside the physics' recovery (DIVE.recoverS 0.8 s; the dive clips
    land and rise in 0.78-0.95 s)."""
    return t if t <= DIVE_LAND else DIVE_LAND + (t - DIVE_LAND) * GETUP_K


DIVE_UP = round(T(1.24), 4)
DIVE_END = 1.25
KNEE_H = 0.055  # knee joint height when kneeling on the kneecap (m)


def trunk_at(c, t):
    """World positions/rotations of the keyed trunk (hips, spine, chest; no guard) at t."""
    loc = {b: qeuler(*c.ch.get(b if b != 'hips' else 'hipsRot', t, (0.0, 0.0, 0.0))) for b in ('hips', 'spine', 'chest')}
    return fk((0.0, 0.0, 0.0), c.ch.get('hipsOff', t, (0.0, 0.0, 0.0)), loc)


def hip_joint_at(c, t, side):
    """Hip joint (actor frame) from the keyed hips channels (no guard: used where both legs are FK)."""
    P, W = trunk_at(c, t)
    return add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side])), W['hips']


def shoulder_at(c, t, side):
    P, W = trunk_at(c, t)
    return add(P['chest'], qrot(W['chest'], OFFSET['upperArm' + side]))


def along(c, t, side, glove, up):
    """Finger direction along the arm (shoulder to glove, a straight wrist) and a palm normal towards `up`."""
    f = norm(sub(glove, shoulder_at(c, t, side)))
    return f, up


def kneel_ankle(c, t, side, dx=0.0, shin_back=(0.0, 0.30, -1.0)):
    """Ankle target that puts the knee on the ground (KNEE_H) in front of the hip joint, the shin lying back."""
    h, _ = hip_joint_at(c, t, side)
    dy = h[1] - KNEE_H
    fz = math.sqrt(max(0.0, THIGH * THIGH - dy * dy - dx * dx))
    knee = (h[0] + dx, KNEE_H, h[2] + fz)
    return add(knee, mul(norm(shin_back), SHIN)), knee


def dive():
    """The keeper's dive to his right. Frame 0 is the set half-crouch at the take-off (the physics path's dive
    sample). He loads and drives off the right (near) foot, the left foot leaving first; flies flat with both
    gloves at full stretch, palms to the ball (`reach`, the physics take); lands on his right side holding the ball
    up (`land`); draws it in, comes up onto his knees, puts the left foot through and stands (`up`). In place: the
    hips stay within 0.08 m of the origin across the ground, the physics path carries the dive."""
    c = KClip('kp_dive_r', PACK, ROLE, DIVE_END, rate=60, loop=False, codec=1, mirrorable=True,
              markers={'reach': DIVE_REACH, 'land': DIVE_LAND, 'up': DIVE_UP}, aliases={'kp_dive_l': 'mirror'})
    w, z, yaw = BACK_FEET['w'], BACK_FEET['z'], BACK_FEET['yaw']
    l_off, r_off = 0.06, 0.13
    l_on, r_on = T(1.03), T(1.18)
    pl0 = KPlant('L', -INF, l_off, (w, z), yaw, [(0.0, SET_PITCH), (l_off, 30.0)])
    pr0 = KPlant('R', -INF, r_off, (-w, z), -yaw, [(0.0, SET_PITCH), (0.05, 16.0), (r_off, 42.0)])
    pl1 = KPlant('L', l_on, INF, (0.15, 0.30), 6.0, [(l_on, 0.0)])
    pr1 = KPlant('R', r_on, INF, (-0.15, 0.06), -12.0, [(r_on, 10.0), (DIVE_UP, 0.0)])
    c.plants('L', [pl0, pl1])
    c.plants('R', [pr0, pr1])
    for t, kw in ((0.0, dict(legFKL=0.0, legFKR=0.0)), (l_off, dict(legFKL=0.0)), (l_off + 0.09, dict(legFKL=1.0)),
                  (r_off, dict(legFKR=0.0)), (r_off + 0.11, dict(legFKR=1.0)), (l_on - 0.06, dict(legFKL=1.0)),
                  (l_on, dict(legFKL=0.0)), (r_on - 0.06, dict(legFKR=1.0)), (r_on, dict(legFKR=0.0)),
                  (DIVE_END, dict(legFKL=0.0, legFKR=0.0))):
        c.key(t, **kw)

    mid_poles = {'elbowPoleL': (-0.4, -0.4, -0.8), 'elbowPoleR': (0.2, -0.6, -0.8)}
    over = {'elbowPoleL': (0.0, 0.5, -1.0), 'elbowPoleR': (0.0, -0.5, -1.0)}
    lying = {'elbowPoleL': (0.0, 0.6, -0.8), 'elbowPoleR': (0.0, -1.0, -0.2)}
    down = {'elbowPoleL': (0.3, -1.0, -0.4), 'elbowPoleR': (-0.3, -1.0, -0.4)}

    def body(pl, **kw):
        return dict(pl, **ARMS, **kw)

    trunk = [
        (0.0, {k: v for k, v in SET.items() if k not in GLOVE_KEYS}),
        (0.07, body({}, hipsOff=(-0.04, -0.34, -0.02), hipsRot=(22.0, -3.0, 14.0), spine=(8.0, 0.0, 6.0),
                    chest=(3.0, 0.0, 4.0), neck=(-20.0, 0.0, -12.0), head=(-14.0, 0.0, -8.0))),
        (0.13, body({}, hipsOff=(-0.06, -0.37, 0.0), hipsRot=(16.0, -2.0, 36.0), spine=(6.0, 0.0, 10.0),
                    chest=(2.0, 0.0, 8.0), neck=(-24.0, 0.0, -18.0), head=(-16.0, 0.0, -10.0))),
        (DIVE_REACH, body(over, hipsOff=(-0.07, -0.43, 0.02), hipsRot=(10.0, 0.0, 66.0), spine=(4.0, 0.0, 12.0),
                          chest=(0.0, 0.0, 8.0), neck=(-28.0, 0.0, -14.0), head=(-18.0, 0.0, -8.0))),
        (DIVE_LAND, body(lying, hipsOff=(-0.06, -0.74, 0.04), hipsRot=(10.0, 0.0, 76.0), spine=(3.0, 0.0, 6.0),
                         chest=(0.0, 0.0, 4.0), neck=(-24.0, 0.0, -22.0), head=(-14.0, 0.0, -12.0))),
        (T(0.58), body(lying, hipsOff=(-0.04, -0.73, 0.06), hipsRot=(16.0, 0.0, 72.0), spine=(8.0, 0.0, 4.0),
                    chest=(2.0, 0.0, 2.0), neck=(-18.0, 0.0, -26.0), head=(-8.0, 0.0, -12.0))),
        (T(0.76), body(down, hipsOff=(-0.02, -0.46, -0.04), hipsRot=(24.0, 0.0, 16.0), spine=(12.0, 0.0, 6.0),
                    chest=(5.0, 0.0, 4.0), neck=(-22.0, 0.0, -10.0), head=(-12.0, 0.0, -6.0))),
        (T(0.90), body(down, hipsOff=(0.0, -0.42, -0.06), hipsRot=(20.0, 0.0, 4.0), spine=(10.0, 0.0, 2.0),
                    chest=(4.0, 0.0, 2.0), neck=(-18.0, 0.0, -2.0), head=(-10.0, 0.0, 0.0))),
        (T(1.08), body(down, hipsOff=(0.0, -0.28, -0.03), hipsRot=(18.0, 0.0, 0.0), spine=(8.0, 0.0, 0.0),
                    chest=(3.0, 0.0, 0.0), neck=(-14.0, 0.0, 0.0), head=(-8.0, 0.0, 0.0))),
        (DIVE_UP, {k: v for k, v in WITH_BALL.items() if k not in GLOVE_KEYS}),
        (DIVE_END, {k: v for k, v in WITH_BALL.items() if k not in GLOVE_KEYS}),
    ]
    for t, b in trunk:
        c.key(t, **b)
    for i in range(1, 7):
        t = DIVE_REACH * i / 7.0
        u = smoother(t / DIVE_REACH)
        c.key(t, **{k: lerp3(LOW_POLES[k], over[k], u) for k in ('elbowPoleL', 'elbowPoleR')})
    # Gloves: positions at every key; hand rotations only where they matter (the hands turn smoothly between).
    c.gkey(0.0, **{k: v for k, v in SET.items() if k in GLOVE_KEYS})
    # Full stretch: both gloves together beyond his head, a little in front of the line of his body, palms to the
    # ball; fingers along the arms.
    gl_r, gr_r = (-1.00, 0.585, 0.44), (-1.00, 0.475, 0.44)
    fl, _ = along(c, DIVE_REACH, 'L', gl_r, None)
    fr, _ = along(c, DIVE_REACH, 'R', gr_r, None)
    c.gkey(DIVE_REACH, **pair(gl_r, fl, (0.35, 0.0, 0.9), gr_r, fr, (0.35, 0.0, 0.9)))
    # The gloves' path from the set to the ball: one smooth ease (no kinks), a little up and forward on the way.
    for i in range(1, 7):
        t = DIVE_REACH * i / 7.0
        u = smoother(t / DIVE_REACH)
        lift = math.sin(math.pi * t / DIVE_REACH) ** 2
        c.gkey(t, gloveL=add(lerp3(SET['gloveL'], gl_r, u), (0.0, 0.05 * lift, 0.02 * lift)),
               gloveR=add(lerp3(SET['gloveR'], gr_r, u), (0.0, 0.05 * lift, 0.02 * lift)))
    gl_land, gr_land = (-0.80, 0.415, 0.48), (-0.80, 0.305, 0.48)
    fl, _ = along(c, DIVE_LAND, 'L', gl_land, None)
    fr, _ = along(c, DIVE_LAND, 'R', gr_land, None)
    c.gkey(DIVE_LAND, **pair(gl_land, fl, (0.2, -0.5, 0.8), gr_land, fr, (0.2, 0.5, 0.8)))
    gl_set, gr_set = (-0.42, 0.445, 0.48), (-0.42, 0.335, 0.48)
    fl, _ = along(c, T(0.58), 'L', gl_set, None)
    fr, _ = along(c, T(0.58), 'R', gr_set, None)
    c.gkey(T(0.58), **pair(gl_set, fl, (0.0, -1.0, 0.2), gr_set, fr, (0.0, 1.0, 0.2)))
    c.gkey(T(0.76), **gloves((-0.10, 0.80, 0.46), (-0.34, 0.0, 0.94), (-0.93, 0.17, -0.34)))
    c.gkey(DIVE_UP, **{k: v for k, v in WITH_BALL.items() if k in GLOVE_KEYS})
    c.gkey(DIVE_END, **{k: v for k, v in WITH_BALL.items() if k in GLOVE_KEYS})

    # Leg targets while the legs are FK: ankle points (actor frame), knee poles and ankle angles. Each starts and
    # ends on its plant's ankle (and ankle angle), so the blends into and out of the plants are seamless.
    leg = Channels()
    a_l0, a_r0 = pl0.ankle_at(l_off)[0], pr0.ankle_at(r_off)[0]
    a_l1, a_r1 = pl1.ankle_at(l_on)[0], pr1.ankle_at(r_on)[0]
    kn_l_a, _ = kneel_ankle(c, T(0.76), 'L', dx=0.02)
    kn_r_a, _ = kneel_ankle(c, T(0.76), 'R', dx=-0.02, shin_back=(0.0, 0.36, -1.0))
    kn_r2_a, _ = kneel_ankle(c, T(0.97), 'R', dx=-0.02, shin_back=(0.0, 0.36, -1.0))
    # After each lift the leg follows one smooth ease out to its flight position: the far (left) leg up and out,
    # the driving (right) leg trailing straight behind the dive (towards +X: the body flies to -X).
    a_lr, a_rr = (0.70, 0.46, 0.06), (0.44, 0.17, -0.04)
    t_lr, t_rr = DIVE_REACH + 0.02, DIVE_REACH + 0.04
    def pelvis_local(side, t, a):
        h, hq = hip_joint_at(c, t, side)
        return qrot(qconj(hq), sub(a, h))

    # Interpolated in the pelvis's frame, so each leg turns smoothly with the rolling hips (no thigh whip).
    for side, t0, t1, a0, a1, bump, k in (('L', l_off, t_lr, a_l0, a_lr, 0.04, 1.0),
                                         ('R', r_off, t_rr, a_r0, a_rr, 0.06, 0.6)):
        # k < 1: the driving leg stays a little bent under him rather than whipping straight out behind.
        v0 = pelvis_local(side, t0, a0)
        v1 = lerp3(v0, pelvis_local(side, t1, a1), k)
        for i in range(0, 8):
            u = i / 7.0
            t = t0 + (t1 - t0) * u
            h, hq = hip_joint_at(c, t, side)
            a = add(h, qrot(hq, lerp3(v0, v1, smoother(u))))
            leg.key(t, **{'ank' + side: add(a, (0.0, bump * math.sin(math.pi * u), 0.0))})
    leg.key(l_off, kpL=(0.3, 0.0, 1.0))
    leg.key(t_lr, kpL=(0.3, 0.6, 0.8))
    leg.key(r_off, kpR=(-0.3, 0.0, 1.0))
    leg.key(t_rr, kpR=(0.1, 0.2, 1.0))
    leg.key(DIVE_LAND, ankL=(0.66, 0.24, 0.16), kpL=(0.2, 0.5, 0.9), ankR=(0.58, 0.10, -0.02), kpR=(0.1, 0.2, 1.0))
    leg.key(T(0.58), ankL=(0.48, 0.18, 0.22), kpL=(0.0, 0.3, 1.0), ankR=(0.44, 0.10, 0.02), kpR=(0.0, 0.2, 1.0))
    leg.key(T(0.76), ankL=kn_l_a, kpL=(0.0, -0.3, 1.0), ankR=kn_r_a, kpR=(0.0, -0.3, 1.0))
    leg.key(T(0.97), ankR=kn_r2_a, kpR=(0.0, -0.3, 1.0))
    # Each foot comes through to its plant on one smooth eased step, lifted clear of the ground.
    l_go, r_go = T(0.74), T(0.97)
    for i in range(1, 9):
        u = i / 8.0
        leg.key(l_go + (l_on - l_go) * u, ankL=add(lerp3(kn_l_a, a_l1, smoother(u)), (0.0, 0.13 * math.sin(math.pi * u) ** 2, 0.0)))
        leg.key(r_go + (r_on - r_go) * u, ankR=add(lerp3(kn_r2_a, a_r1, smoother(u)), (0.0, 0.12 * math.sin(math.pi * u) ** 2, 0.0)))
    leg.key(T(0.90), kpL=(0.1, 0.3, 1.0))
    leg.key(l_on, kpL=(0.1, 0.0, 1.0))
    leg.key(T(1.08), kpR=(-0.1, 0.2, 1.0))
    leg.key(r_on, kpR=(-0.1, 0.0, 1.0))

    def extra(t, out):
        res = {}
        # In the air and on the ground the elbows follow the arms with no upper-arm twist (the rest elbow carried by
        # the shortest swing of the arm from hanging): no shoulder winds up while the arms stretch out and come in.
        w_mt = smoother(t / 0.22) * (1.0 - smoother((t - T(0.54)) / (T(0.82) - T(0.54))))
        if w_mt > 0.0:
            P, W = trunk_at(c, t)
            for side in ('L', 'R'):
                sh = add(P['chest'], qrot(W['chest'], OFFSET['upperArm' + side]))
                d = qrot(qconj(W['chest']), norm(sub(out['handIK' + side], sh)))
                pole_mt = qrot(W['chest'], qrot(qswing_to((0.0, -1.0, 0.0), d), (0.0, 0.0, -1.0)))
                keyed = norm(c.ch.get('elbowPole' + side, t))
                res['elbowPole' + side] = norm(lerp3(keyed, pole_mt, w_mt))
        for side in ('L', 'R'):
            a = leg.get('ank' + side, t)
            if a is None:
                continue
            h, hq = hip_joint_at(c, t, side)
            th, sh, _, _, _ = leg_ik(h, hq, a, QI, norm(leg.get('kp' + side, t)))
            res['thigh' + side] = _euler_xyz(th)
            res['shin' + side] = _euler_xyz(sh)
            af = leg.get('af' + side, t)
            if af is not None:
                res['foot' + side] = af
        return res

    c.extra = extra

    # Palms: part-way from the forearm's own (untwisted) palm towards the ball, so no wrist is wound past its range.
    def palm_between(side, t, f, want, k):
        f = norm(f)
        n0 = c.neutral_palm(side, t)
        n0 = norm(sub(n0, mul(f, dot(n0, f))))
        w = norm(sub(want, mul(f, dot(want, f))))
        if dot(n0, w) < -0.95:
            w = norm(add(w, mul(cross(f, n0), 0.2)))
        return norm(lerp3(n0, w, k))

    for t, k in ((DIVE_REACH, 0.5), (DIVE_LAND, 0.35), (T(0.58), 0.2)):
        for side in ('L', 'R'):
            hq = c.hand_q(side, t)
            f = qrot(hq, (0.0, -1.0, 0.0))
            c.set_hand(side, t, f, palm_between(side, t, f, (0.2, 0.2, 1.0) if t < T(0.58) else (0.0, 0.3, 1.0), k))

    def plant_ankle_angle(side, t):
        _, _, loc, _, _ = Clip.solve(c, t)
        return _euler_xyz(loc['foot' + side])

    # Ankle angles: matched to the plants at the lifts and the plant-downs, pointed in flight, toes tucked on the
    # knees, toes up as each foot comes through.
    leg.key(l_off, afL=plant_ankle_angle('L', l_off))
    leg.key(r_off, afR=plant_ankle_angle('R', r_off))
    leg.key(l_on, afL=plant_ankle_angle('L', l_on))
    leg.key(r_on, afR=plant_ankle_angle('R', r_on))
    leg.key(DIVE_REACH, afL=(30.0, 0.0, 0.0), afR=(8.0, 0.0, 0.0))
    leg.key(DIVE_LAND, afL=(20.0, 0.0, 0.0), afR=(20.0, 0.0, 0.0))
    leg.key(T(0.76), afL=(0.0, 0.0, 0.0), afR=(0.0, 0.0, 0.0))
    leg.key(T(0.97), afR=(0.0, 0.0, 0.0))
    leg.key(T(0.89), afL=(-15.0, 0.0, 0.0))
    leg.key(T(1.08), afR=(-15.0, 0.0, 0.0))
    c._cache = (None, None)
    c.contact('body', 0.38, T(0.62))
    c.contact('kneeR', T(0.70), T(1.00))
    c.contact('kneeL', T(0.70), T(0.79))
    c.provenance_note = 'keyframed keeper dive to his right: push off the near foot, full stretch, land on the side, get up'
    return c


def clips():
    return [
        crouch('kp_crouch_back', CROUCH_BACK, BACK_FEET, note='keyframed pace crouch, standing back, 2.4 s loop'),
        crouch('kp_crouch_up', CROUCH_UP, UP_FEET, note='keyframed spin crouch, standing up, 2.4 s loop'),
        rise(),
        shuffle(),
        take_waist(),
        take_chest(),
        dive(),
    ]
