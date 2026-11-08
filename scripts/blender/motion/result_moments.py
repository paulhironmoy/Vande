"""
Result-moment clips for Target Chase (pack `result_moments`, MOTION-SPEC v1.3.2). Original keyframes on VC17 by
ASSETS-MOTION for the VANDE owner; no motion capture, no third-party motion. Pure Python (standard library only).

  bat_celebrate_win      the striker, the winning run is scored: bat raised in the bottom hand, a fist pump, a long exhale
  bat_walk_off           the striker, the chase is lost: the slump, a slow walk away with the bat trailing, a stop
  bowl_celebrate_defend  the bowler, the chase is defended: arm raised, a fist pump, a clap, hands to the hips
  bowl_disappointed      the bowler, the batter wins: he watches it go, the slump, hands to the hips, a head shake, a reset

Lead ruling (2026-11-08): inside the existing caps, no explosive entry: no jump, no leap. Arms are authored to at most
1,200 deg/s (the stage holds the bowler's arms to 1,440 after the release). Every clip starts from an at-ease stand so the
runtime's inertial hand-over from `bat_rest`, a run's pull-up or a follow-through has little to bridge, and ends in a
settled stand (or a stop) because the move holds the last frame to the end of the scene.

Right-handed frame (+Z forward, +X the character's left, the bowler at the batter's +X). A left-hander and a left-arm
bowler are mirrored by the stage as a whole actor. The batter clips are in place except `bat_walk_off`, which walks
straight ahead (no turn is baked: the runtime turns actors by script).

Bake:  python3 -I scripts/blender/motion/build.py result_moments     (writes assets-src/motion/result_moments/<id>.vms.json)
Pack:  node scripts/motion/export.mjs --pack result_moments
Bat tracks (MOTION-SPEC 5.5): `bat.grip` is the bottom (right) hand's palm centre, `bat.dir` the bat's axis towards the toe
and `bat.face` the blade's face normal, all derived from the right hand's own forward kinematics, so the bat swings with the
arm (a whip, a lag) and the grip is exactly where the arm puts it.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from gait import Stepper, gait_controls, profile_path  # noqa: E402
from vc17 import (QI, Clip, Curve, Plant, _euler_xyz, add, arm_ik, clamp, dot, fk, length, lerp, mul, norm, qaxis,  # noqa: E402
                  qconj, qeuler, qmul, qrot, qswing_to, smooth, sub)

PACK = 'result_moments'
INF = math.inf
DEG = math.pi / 180.0

PALM = 0.065  # the palm centre is this far along the hand (local -Y) from the wrist
BAT_GRIP_TO_TOE = 0.735  # 0.86 m bat, the lower hand 0.125 m below the cap
GRIP_DEG = 34.0  # the bat's axis stays this far off the hand's long axis where the wrist can cock that far; the wrist bends only as needed
WRIST_MAX = 78.0  # the wrist's swing never goes beyond this (MOTION-SPEC section 9: 85)
PALM_REACH_MAX = 0.605  # palm centre to shoulder: a straight arm (0.54 m) plus the palm; the stage's carried bat key is 0.62 m


# ----------------------------------------------------------------------------------------------------------------
# An FK arm keyed per component (upper arm direction, twist, elbow, wrist), so the elbow and the hand can lag the shoulder
# ----------------------------------------------------------------------------------------------------------------

def _arm_dir(side, elev, azim):
    """Upper-arm direction in the chest frame. elev: 0 hanging, 90 horizontal, 180 up (kept below 170); negative swings
    behind the body. azim: 0 forward, + outwards (away from the body), - across the body."""
    s = 1.0 if side == 'L' else -1.0
    e = elev * DEG
    a = azim * DEG
    return (s * math.sin(e) * math.sin(a), -math.cos(e), math.sin(e) * math.cos(a))


class Arm:
    """keys: lists of (t, value[, slope]) for elev, azim, twist (degrees about the bone), elbow (degrees, <= 0 bends) and
    hand = (ex, ey, ez) lists (Euler XYZ degrees of the hand against the forearm)."""

    def __init__(self, side, elev, azim, twist, elbow, hand):
        self.side = side
        self.c = {'el': Curve(elev), 'az': Curve(azim), 'tw': Curve(twist), 'eb': Curve(elbow)}
        self.h = [Curve(k) for k in hand]

    def at(self, t):
        d = norm(_arm_dir(self.side, self.c['el'](t), self.c['az'](t)))
        qu = qmul(qswing_to((0.0, -1.0, 0.0), d), qaxis((0.0, 1.0, 0.0), self.c['tw'](t)))
        qf = qeuler(self.c['eb'](t), 0.0, 0.0)
        qh = qeuler(*(c(t) for c in self.h))
        return qu, qf, qh


class BatKey:
    """The bat's direction (grip towards the toe) in the chest frame, keyed like an arm: elev 0 hangs, 90 points forward,
    180 up; azim + is outwards (away from the body). The right hand's wrist is then set so the bat sits GRIP_DEG off the
    hand's long axis where that is possible, and bends only as far as the bat needs."""

    def __init__(self, elev, azim):
        self.el = Curve(elev)
        self.az = Curve(azim)

    def chest_dir(self, t):
        return norm(_arm_dir('R', self.el(t), self.az(t)))


def ik_arm(side, wrist, pole, swivel=0.0):
    """The Arm key parameters (elev, azim, twist, elbow) that put the wrist at `wrist` and the elbow towards `pole`, both in the chest
    frame (metres from the chest joint); `swivel` turns the elbow about the shoulder-to-wrist line (degrees). Solved at authoring
    time with the library's two-bone arm IK, so a hand on a hip, a hand behind the neck and a clap land where they should; the clip
    itself keys these four numbers like any other FK arm."""
    sgn = 1.0 if side == 'L' else -1.0
    shoulder = (sgn * 0.205, 0.182, -0.012)
    axis = norm(sub(wrist, shoulder))
    p = qrot(qaxis(axis, swivel), pole) if swivel else pole
    up, fo, _wf, err = arm_ik(shoulder, QI, wrist, p)
    assert err < 1e-3, f'ik_arm {side} {wrist}: out of reach by {err:.3f} m'
    d = qrot(up, (0.0, -1.0, 0.0))
    el = math.acos(clamp(-d[1], -1.0, 1.0)) / DEG
    az = math.atan2(sgn * d[0], d[2]) / DEG
    t = qmul(qconj(qswing_to((0.0, -1.0, 0.0), d)), up)
    tw = (2.0 * math.atan2(t[1], t[3]) / DEG + 540.0) % 360.0 - 180.0
    return el, az, tw, _euler_xyz(fo)[0]


def mirrored_ik(wrist, pole, swivel=0.0):
    """Both arms of a symmetric gesture: (left params, right params) for a left-side target and pole."""
    wr = (-wrist[0], wrist[1], wrist[2])
    pr = (-pole[0], pole[1], pole[2])
    return ik_arm('L', wrist, pole, swivel), ik_arm('R', wr, pr, -swivel)


# Gestures solved once (chest frame): a hand on the hip (elbow out and back), the hands together in a clap and apart again, a
# hand at the back of the neck with the elbow high (swivelled so the shoulder's twist stays inside its 110 degree range).
HIP_L, HIP_R = mirrored_ik((0.23, -0.20, 0.04), (1.0, -0.1, -0.4))
CLAP_L, CLAP_R = mirrored_ik((0.06, 0.02, 0.30), (0.6, -0.7, -0.2))
APART_L, APART_R = mirrored_ik((0.12, 0.03, 0.27), (0.65, -0.7, -0.2))
NECK_A = ik_arm('L', (0.05, 0.34, -0.05), (1.0, 0.6, -0.2), -45.0)
NECK_B = ik_arm('L', (0.08, 0.31, -0.07), (1.0, 0.6, -0.2), -45.0)


def cross3(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def keys(*rows):
    """((t, v), ...) -> sorted list; a row may carry a slope: (t, v, slope)."""
    return sorted(rows, key=lambda r: r[0])


def hand_keys(*rows):
    """rows of (t, (ex, ey, ez)) -> three key lists."""
    return [[(r[0], r[1][i]) for r in rows] for i in range(3)]


def stand_plants(w=0.125, z=0.0, yaw=8.0):
    """Both feet down side by side for the whole clip (the ankle at x = +-w, z)."""
    out = []
    for side, sx in (('L', 1.0), ('R', -1.0)):
        y = sx * yaw
        bx = sx * w + math.sin(y * DEG) * 0.135
        bz = z + math.cos(y * DEG) * 0.135
        out.append((side, [Plant(side, -INF, INF, (bx, bz), y)]))
    return out


def heel_plants(side, ankle_x, ankle_z, yaw, up0, up1, dn0, dn1, pitch):
    """One foot, three plants on the same spot: flat, heel raised, flat. The heel rises over [up0, up1], stays up, and
    comes down over [dn0, dn1] (the sole tip never moves, so nothing slides)."""
    bx = ankle_x + math.sin(yaw * DEG) * 0.135
    bz = ankle_z + math.cos(yaw * DEG) * 0.135
    a = Plant(side, -INF, up1, (bx, bz), yaw, off=pitch, peel_s=up1 - up0)
    b = Plant(side, up1, dn1, (bx, bz), yaw, land=pitch, land_s=0.001, low=pitch, off=0.0, peel_s=dn1 - dn0)
    c = Plant(side, dn1, INF, (bx, bz), yaw, land=0.0, land_s=0.001)
    return [a, b, c]


def drift(t, seed, freqs=(0.31, 0.77, 1.43)):
    """Smooth, never-repeating wander in [-1, 1] (three incommensurate sines): breath, sway and settling that are not a
    loop. Deterministic: a function of time and the seed only."""
    v = 0.0
    for i, f in enumerate(freqs):
        v += math.sin(2.0 * math.pi * f * t + 1.7 * seed + 2.399 * i + 0.61 * i * seed) / (1.0 + 0.55 * i)
    return v / 1.95


class MomentClip(Clip):
    """A Clip with FK arms and, optionally, the bat tracks of the right hand."""

    def __init__(self, *a, bat=False, **k):
        super().__init__(*a, **k)
        self.arms = {}
        self.bat = bat
        self.bat_key = None
        self.micro = []  # (channel, (ax, ay, az), seed): a small wander added to a keyed channel (degrees, or metres for hipsOff)
        self.micro_tail = 0.15  # the share of the wander left in the last 0.6 s
        self._frames = None

    def arm(self, side, arm):
        self.arms[side] = arm

    def wander(self, channel, amp, seed):
        self.micro.append((channel, amp, seed))

    def control(self, t):
        c = super().control(t)
        if self.micro:
            env = smooth(t / 0.45) * (1.0 - (1.0 - self.micro_tail) * smooth((t - (self.duration - 0.6)) / 0.6))
            for ch, amp, seed in self.micro:
                if ch in c:
                    v = c[ch]
                    c[ch] = tuple(v[i] + amp[i] * env * drift(t, seed + 3.1 * i) for i in range(3))
        return c

    def solve(self, t):
        ground, hips_off, local, contacts, diag = super().solve(t)
        for side, arm in self.arms.items():
            qu, qf, qh = arm.at(t)
            local['upperArm' + side] = qu
            local['forearm' + side] = qf
            local['hand' + side] = qh
        if self.bat and self.bat_key is not None:
            local['handR'] = self._wrist(t, ground, hips_off, local)[0]
        return ground, hips_off, local, contacts, diag

    def _wrist(self, t, ground, hips_off, local):
        """The right hand's local rotation for the bat's direction at t (twist-free swing off the forearm), the bat's
        axis in the actor frame and the wrist's swing in degrees."""
        P, W = fk((0.0, 0.0, 0.0), hips_off, local)
        b = qrot(W['chest'], self.bat_key.chest_dir(t))
        fa = qrot(W['forearmR'], (0.0, -1.0, 0.0))
        cosang = clamp(dot(fa, b), -1.0, 1.0)
        ang = math.acos(cosang) / DEG
        if ang <= GRIP_DEG:
            h = fa
        else:
            # the hand's long axis: from the bat axis towards the forearm axis by GRIP_DEG, but never more than WRIST_MAX
            # of wrist swing off the forearm
            swing = min(ang - GRIP_DEG, WRIST_MAX)
            h = norm(qrot(qaxis(norm(cross3(fa, b)), swing), fa))
        h_loc = qrot(qconj(W['forearmR']), h)
        return qswing_to((0.0, -1.0, 0.0), h_loc), b, math.acos(clamp(dot(fa, h), -1.0, 1.0)) / DEG

    def frames(self):
        if self._frames is None:
            self._frames = super().frames()
        return self._frames

    def bat_frames(self):
        """Per frame (grip, dir, face) in the ground-origin frame, and the largest palm-to-shoulder distance."""
        out = []
        far = 0.0
        far_w = 0.0
        self.wrist_max = 0.0
        for i, (_g, hips_off, local, _c, _d) in enumerate(self.frames()):
            P, W = fk((0.0, 0.0, 0.0), hips_off, local)
            hw = W['handR']
            grip = add(P['handR'], qrot(hw, (0.0, -PALM, 0.0)))
            _q, axis, swing = self._wrist(i / self.rate, _g, hips_off, local)
            self.wrist_max = max(self.wrist_max, swing)
            fx = qrot(hw, (1.0, 0.0, 0.0))
            face = norm(sub(fx, mul(axis, dot(fx, axis))))
            shoulder = add(P['chest'], qrot(W['chest'], (-0.205, 0.182, -0.012)))
            far = max(far, length(sub(grip, shoulder)))
            far_w = max(far_w, length(sub(P['handR'], shoulder)))
            out.append((grip, axis, face))
        return out, far, far_w

    def to_vms(self, provenance):
        prov = dict(provenance)
        prov['script'] = 'scripts/blender/motion/result_moments.py'
        doc = super().to_vms(prov)
        if self.bat:
            bf, far, far_w = self.bat_frames()
            r6 = lambda v: round(v + 0.0, 6) + 0.0
            doc['tracks'] = {
                'bat.dir': {'kind': 'direction', 'frames': [[r6(v) for v in d] for _, d, _ in bf]},
                'bat.face': {'kind': 'direction', 'frames': [[r6(v) for v in f] for _, _, f in bf]},
                'bat.grip': {'kind': 'position', 'frames': [[r6(v) for v in g] for g, _, _ in bf]},
            }
            doc['provenance']['batGripMaxReachM'] = {'palm': r6(far), 'wrist': r6(far_w)}
            doc['provenance']['wristSwingMaxDeg'] = r6(self.wrist_max)
            assert far <= PALM_REACH_MAX, (
                f'{self.id}: the bat hand reaches {far:.3f} m (palm) and {far_w:.3f} m (wrist) from its shoulder')
        return doc


# ----------------------------------------------------------------------------------------------------------------
# 1. bat_celebrate_win
# ----------------------------------------------------------------------------------------------------------------

def stand_wander(c, scale=1.0):
    """The same small wander on every clip's trunk, head and hips (different seeds per channel)."""
    c.wander('spine', (0.5 * scale, 0.7 * scale, 0.4 * scale), 1.0)
    c.wander('chest', (0.5 * scale, 0.8 * scale, 0.4 * scale), 2.0)
    c.wander('neck', (0.7 * scale, 1.1 * scale, 0.5 * scale), 3.0)
    c.wander('head', (0.9 * scale, 1.4 * scale, 0.7 * scale), 4.0)
    c.wander('hipsOff', (0.003 * scale, 0.0015 * scale, 0.003 * scale), 5.0)


def bat_celebrate_win():
    D = 3.6
    c = MomentClip('bat_celebrate_win', PACK, 'batter', D, rate=30, codec=2, mirrorable=True, bat=True,
                   markers={'peak': 0.95, 'fist': 1.35, 'rest': 2.30})
    # Feet: shoulder-width, side by side. The heels come up for the burst (a rise onto the toes, no jump) and settle again.
    w, yaw = 0.14, 10.0
    c.plants('L', heel_plants('L', w, 0.0, yaw, 0.50, 0.86, 1.62, 2.02, 13.0))
    c.plants('R', heel_plants('R', -w, 0.0, -yaw, 0.58, 0.92, 1.70, 2.12, 11.0))
    # Trunk, head and hips. Channels are keyed independently so the chest trails the hips and the head trails the chest.
    c.key(0.00, hipsOff=(0.000, -0.020, 0.000), hipsRot=(2.0, 0.0, 0.0))
    c.key(0.30, hipsOff=(0.012, -0.040, 0.000), hipsRot=(3.0, 3.0, 1.5))        # register: weight sinks, to the left foot
    c.key(0.52, hipsOff=(0.018, -0.062, -0.010), hipsRot=(5.0, 6.0, 2.0))       # coil
    c.key(0.80, hipsOff=(-0.004, -0.022, 0.010), hipsRot=(0.0, -4.0, -1.5))     # drive up
    c.key(1.00, hipsOff=(-0.014, -0.004, 0.008), hipsRot=(-3.0, -8.0, -2.5))    # peak, weight on the right foot
    c.key(1.48, hipsOff=(-0.008, -0.010, 0.006), hipsRot=(-1.0, 4.0, -1.0))
    c.key(1.95, hipsOff=(0.006, -0.036, 0.000), hipsRot=(2.0, 2.0, 0.5))        # the exhale: the body sinks
    c.key(2.50, hipsOff=(0.004, -0.026, 0.000), hipsRot=(2.5, 0.0, 0.0))
    c.key(3.05, hipsOff=(-0.003, -0.026, 0.000), hipsRot=(2.0, 0.0, 0.0))
    c.key(3.60, hipsOff=(0.000, -0.024, 0.000), hipsRot=(2.0, 0.0, 0.0))

    c.key(0.00, spine=(3.0, 0.0, 0.0))
    c.key(0.34, spine=(4.0, 3.0, 0.0))
    c.key(0.56, spine=(8.5, 6.0, 2.0))
    c.key(0.88, spine=(-4.0, -4.0, -3.0))
    c.key(1.08, spine=(-5.0, -7.0, -4.0))
    c.key(1.52, spine=(-3.0, 3.0, -2.0))
    c.key(2.00, spine=(5.0, 2.0, 0.0))
    c.key(2.55, spine=(4.0, 0.0, 0.0))
    c.key(3.60, spine=(3.5, 0.0, 0.0))

    c.key(0.00, chest=(1.0, 0.0, 0.0))
    c.key(0.38, chest=(1.0, 2.0, 0.0))
    c.key(0.62, chest=(5.0, 5.0, 1.5))
    c.key(0.95, chest=(-5.0, -5.0, -2.5))
    c.key(1.15, chest=(-4.5, -7.0, -3.0))
    c.key(1.58, chest=(-2.0, 4.0, -1.0))
    c.key(2.05, chest=(4.5, 1.0, 0.0))        # the long exhale: the chest falls
    c.key(2.60, chest=(2.0, 0.0, 0.0))
    c.key(2.80, chest=(0.5, 0.0, 0.0))        # a deep breath in
    c.key(3.25, chest=(2.2, 0.0, 0.0))
    c.key(3.60, chest=(1.5, 0.0, 0.0))

    c.key(0.00, neck=(-3.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    c.key(0.30, neck=(-8.0, -3.0, 0.0), head=(-5.0, -4.0, 0.0))                 # watching the ball go
    c.key(0.60, neck=(-2.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    c.key(1.05, neck=(-12.0, 5.0, 2.0), head=(-12.0, 8.0, 3.0))                 # head back at the peak
    c.key(1.40, neck=(-9.0, -10.0, 0.0), head=(-8.0, -14.0, -2.0))              # a sweep to the crowd
    c.key(1.80, neck=(-5.0, 7.0, 0.0), head=(-4.0, 10.0, 2.0))
    c.key(2.30, neck=(-1.0, 0.0, 0.0), head=(2.0, 2.0, 0.0))
    c.key(2.85, neck=(2.0, -2.0, 0.0), head=(5.0, -3.0, 0.0))                   # relief: the chin drops
    c.key(3.60, neck=(0.0, 0.0, 0.0), head=(1.0, 0.0, 0.0))
    stand_wander(c)

    # The bat itself (chest frame): it trails the arm a little, swings up through the horizontal and is held up and out.
    c.bat_key = BatKey(
        elev=keys((0.00, 14), (0.32, 17), (0.54, 26), (0.78, 96), (1.08, 150), (1.30, 160), (1.60, 150), (2.06, 100),
                  (2.44, 48), (2.84, 19), (3.60, 14)),
        azim=keys((0.00, 0), (0.52, 4), (0.82, 26), (1.10, 44), (1.34, 52), (1.64, 48), (2.06, 40), (2.48, 22), (3.02, 6),
                  (3.60, 0)))
    # The bat arm (right): the shoulder leads, the elbow follows about 50 ms behind and the wrist about 100 ms.
    c.arm('R', Arm('R',
        elev=keys((0.00, 7), (0.30, 11), (0.50, -12), (0.72, 78), (0.98, 148), (1.20, 156), (1.55, 150), (2.00, 92),
                  (2.35, 38), (2.80, 9), (3.60, 6)),
        azim=keys((0.00, 12), (0.50, 0), (0.75, 30), (1.00, 40), (1.55, 44), (2.00, 40), (2.40, 24), (3.60, 10)),
        twist=keys((0.00, 14), (0.60, 20), (1.00, 4), (1.55, -6), (2.10, 8), (3.60, 14)),
        elbow=keys((0.00, -14), (0.32, -22), (0.56, -42), (0.80, -64), (1.05, -46), (1.30, -40), (1.60, -48), (2.08, -70),
                   (2.50, -36), (3.00, -18), (3.60, -15)),
        hand=hand_keys((0.00, (-6, 0, 0)), (3.60, (-6, 0, 0)))))
    # The free arm (left): a fist pump forward and down, a smaller second one, then it opens and falls with overlap.
    c.arm('L', Arm('L',
        elev=keys((0.00, 8), (0.40, 30), (0.56, 50), (0.80, 62), (0.98, 28), (1.16, 56), (1.38, 66), (1.62, 54),
                  (2.08, 28), (2.58, 10), (3.60, 7)),
        azim=keys((0.00, 14), (0.45, -40), (0.60, -34), (0.84, -8), (1.02, -40), (1.20, -34), (1.40, -6), (1.72, 40),
                  (2.22, 24), (3.60, 12)),
        twist=keys((0.00, -14), (0.50, -30), (0.85, -16), (1.00, -34), (1.42, -12), (2.00, -18), (3.60, -14)),
        elbow=keys((0.00, -12), (0.30, -50), (0.48, -118), (0.66, -98), (0.88, -46), (1.06, -100), (1.22, -90),
                   (1.44, -44), (1.82, -52), (2.32, -30), (3.60, -14)),
        hand=hand_keys((0.00, (-6, 0, 0)), (0.50, (-18, 0, 0)), (0.90, (6, 0, 0)), (1.42, (4, 0, 0)), (2.00, (-10, 0, 0)),
                       (3.60, (-6, 0, 0)))))
    c.provenance_note = 'keyframed celebration; FK arms; bat tracks; in place, a heel rise (no jump); a small wander on the trunk'
    return c


# ----------------------------------------------------------------------------------------------------------------
# 2. bat_walk_off
# ----------------------------------------------------------------------------------------------------------------

def bat_walk_off():
    D = 5.4
    T_GO = 1.55
    V = 1.0

    def speed(t):
        up = smooth((t - T_GO) / 1.25)
        down = 1.0 - smooth((t - 4.05) / 1.15)
        return V * up * down

    path = profile_path(speed, D)

    def style(p, t):
        q = dict(p)
        q['spm'] = min(p['spm'], 96.0)                                # the slowed cadence
        q['armA'] = 0.4 * p['armA']
        q['lean'] = p['lean'] + 4.0
        q['tilt'] = p['tilt'] + 3.0
        q['bob'] = 0.6 * p['bob']
        q['sway'] = 0.7 * p['sway']
        q['lift'] = 0.55 * p['lift']                                   # a low, shuffling swing
        q['kickY'] = 0.7 * p['kickY']
        q['midY'] = 0.8 * p['midY']
        q['drop'] = p['drop'] - 0.014
        return q

    st = Stepper(path, 0.0, D, first='R', t_go=T_GO, style=style)
    c = MomentClip('bat_walk_off', PACK, 'batter', D, rate=30, codec=2, mirrorable=True, bat=True,
                   markers={'slump': 0.90, 'step': T_GO, 'stop': 4.90})
    slump = Curve([(0.0, 0.0), (0.55, 0.55), (1.0, 1.0), (D, 1.0)])
    shake = Curve([(0.0, 0.0), (0.50, 0.0), (0.72, 1.0), (0.98, -0.85), (1.22, 0.55), (1.42, -0.25), (1.62, 0.0), (D, 0.0)])
    glance = Curve([(0.0, 0.0), (4.45, 0.0), (4.85, 1.0), (5.15, 0.8), (5.40, 0.0)])
    breath = Curve([(0.0, 0.0), (0.18, 0.0), (0.62, 1.0), (1.05, 0.2), (D, 0.2)])  # the long exhale after the realisation
    shift = Curve([(0.0, 0.0), (1.00, 0.0), (1.42, 1.0), (1.70, 0.7), (2.20, 0.0), (D, 0.0)])  # weight onto the left foot before he goes
    base = gait_controls(st)

    def fn(t):
        out = base(t)
        s = slump(t)
        sh = shake(t)
        gl = glance(t)
        br = breath(t)
        hx, hy, hz = out['hipsOff']
        out['hipsOff'] = (hx + 0.032 * shift(t), hy - 0.030 * s - 0.014 * br, hz)
        a, b, cc = out['hipsRot']
        out['hipsRot'] = (a, b, cc + 2.5 * shift(t))
        a, b, cc = out['spine']
        out['spine'] = (a + 9.0 * s + 3.0 * br, b + 1.5 * sh, cc)
        a, b, cc = out['chest']
        out['chest'] = (a + 7.0 * s + 2.5 * br, b + 2.0 * sh, cc)
        a, b, cc = out['neck']
        out['neck'] = (a + 15.0 * s + 3.0 * br, b + 9.0 * sh - 22.0 * gl, cc)
        a, b, cc = out['head']
        out['head'] = (a + 7.0 * s - 4.0 * gl, b + 11.0 * sh - 28.0 * gl, cc + 4.0 * s)
        # The free arm's swing comes from the gait (small); the slump rounds the shoulder forward.
        a, b, cc = out['upperArmL']
        out['upperArmL'] = (a + 6.0 * s, b, cc)
        a, b, cc = out['forearmL']
        out['forearmL'] = (a - 8.0 * s, b, cc)
        return out

    c.fn = fn
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    c.speed = path.pos(D)[1] / D
    stand_wander(c, 0.8)
    # The bat arm: hanging at the side, a gentle pendulum with the stride once he walks (the right arm swings forward
    # as the left foot lands), the elbow soft; the bat swings a little more than the arm and a touch later.
    ph = lambda t: 2.0 * math.pi * st.phase(t)
    elev, bat_elev = [], []
    n = int(round(D * 30)) + 1
    for k in range(n):
        t = k / 30.0
        wgt = st.motion_weight(t)
        sl = slump(t)
        elev.append((t, 5.0 + 3.0 * sl + 8.0 * wgt * math.cos(ph(t) - 0.35)))
        bat_elev.append((t, 11.0 + 3.0 * sl + 10.0 * wgt * math.cos(ph(t) - 0.75)))
    c.bat_key = BatKey(elev=bat_elev, azim=keys((0.00, 2), (1.50, 4), (3.00, 8), (D, 5)))
    c.arm('R', Arm('R',
        elev=elev,
        azim=keys((0.00, 10), (1.50, 16), (3.00, 22), (D, 14)),
        twist=keys((0.00, 14), (D, 14)),
        elbow=keys((0.00, -14), (0.80, -20), (D, -22)),
        hand=hand_keys((0.00, (-6, 0, 0)), (D, (-6, 0, 0)))))
    c.provenance_note = (f'gait generator on a speed profile ({V} m/s cruise, go at {T_GO} s, stop by {D} s, 96 steps/min) '
                         'with a keyed slump, head shake and glance; bat tracks from the right hand')
    return c


# ----------------------------------------------------------------------------------------------------------------
# 3. bowl_celebrate_defend
# ----------------------------------------------------------------------------------------------------------------

def bowl_celebrate_defend():
    D = 3.4
    c = MomentClip('bowl_celebrate_defend', PACK, 'bowler', D, rate=30, codec=2, mirrorable=False,
                   markers={'peak': 0.85, 'clap': 1.85, 'rest': 2.40})
    w, yaw = 0.12, 9.0
    c.plants('L', heel_plants('L', w, 0.0, yaw, 0.44, 0.80, 1.50, 1.90, 12.0))
    c.plants('R', heel_plants('R', -w, 0.0, -yaw, 0.50, 0.86, 1.56, 2.00, 10.0))
    c.key(0.00, hipsOff=(0.000, -0.020, 0.004), hipsRot=(2.0, 0.0, 0.0))
    c.key(0.30, hipsOff=(0.004, -0.045, 0.010), hipsRot=(4.0, 2.0, 0.0))           # recognise: a small sink and a breath in
    c.key(0.50, hipsOff=(0.000, -0.062, 0.004), hipsRot=(2.0, 0.0, 0.0))
    c.key(0.82, hipsOff=(-0.006, -0.006, 0.000), hipsRot=(-3.0, -4.0, -1.0))      # the burst: up, weight on the toes
    c.key(1.25, hipsOff=(0.006, -0.014, 0.006), hipsRot=(-1.0, 8.0, 1.0))
    c.key(1.80, hipsOff=(0.000, -0.030, 0.004), hipsRot=(2.0, 3.0, 0.0))
    c.key(2.30, hipsOff=(-0.004, -0.040, 0.008), hipsRot=(5.0, 0.0, 0.0))          # hands to the hips, the body sinks
    c.key(2.90, hipsOff=(0.003, -0.034, 0.006), hipsRot=(5.0, 0.0, 0.0))
    c.key(3.40, hipsOff=(0.000, -0.030, 0.008), hipsRot=(4.0, 0.0, 0.0))

    c.key(0.00, spine=(3.0, 0.0, 0.0))
    c.key(0.34, spine=(6.0, 2.0, 0.0))
    c.key(0.50, spine=(8.0, 4.0, 1.0))
    c.key(0.86, spine=(-5.0, -3.0, 2.0))
    c.key(1.28, spine=(-3.0, 9.0, 1.0))
    c.key(1.85, spine=(4.0, 3.0, 0.0))
    c.key(2.35, spine=(8.0, 0.0, 0.0))
    c.key(3.40, spine=(6.0, 0.0, 0.0))

    c.key(0.00, chest=(1.0, 0.0, 0.0))
    c.key(0.40, chest=(2.0, 2.0, 0.0))
    c.key(0.54, chest=(5.0, 4.0, 0.0))
    c.key(0.92, chest=(-6.0, -4.0, 2.0))
    c.key(1.32, chest=(-3.0, 12.0, 1.0))
    c.key(1.92, chest=(3.0, 3.0, 0.0))
    c.key(2.45, chest=(5.0, 0.0, 0.0))          # the exhale
    c.key(2.90, chest=(2.0, 0.0, 0.0))
    c.key(3.40, chest=(3.0, 0.0, 0.0))

    c.key(0.00, neck=(-3.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    c.key(0.30, neck=(-8.0, 9.0, 0.0), head=(-5.0, 12.0, 0.0))                     # looks at where it happened
    c.key(0.60, neck=(-3.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    c.key(0.95, neck=(-14.0, -5.0, 2.0), head=(-12.0, -6.0, 3.0))                  # head back: the roar
    c.key(1.40, neck=(-8.0, 14.0, 0.0), head=(-6.0, 16.0, -2.0))                   # to his team
    c.key(1.95, neck=(-3.0, -4.0, 0.0), head=(0.0, -5.0, 0.0))
    c.key(2.50, neck=(2.0, 0.0, 0.0), head=(4.0, 0.0, 0.0))
    c.key(3.40, neck=(-3.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    stand_wander(c)

    # Right arm (his bowling arm): drives up with an open hand, holds, a second smaller pump, comes down to meet the other
    # hand in a clap (two, the second a beat later), then to the hip. The clap and the hip are solved gestures (ik_arm).
    c.arm('R', Arm('R',
        elev=keys((0.00, 8), (0.30, 14), (0.50, -8), (0.68, 70), (0.92, 150), (1.12, 158), (1.40, 140), (1.62, 84),
                  (1.76, 46), (1.86, CLAP_R[0]), (2.00, APART_R[0]), (2.14, CLAP_R[0]), (2.50, HIP_R[0]), (2.98, 14),
                  (3.40, 9)),
        azim=keys((0.00, 12), (0.52, 0), (0.80, 20), (1.00, 22), (1.45, 26), (1.68, 18), (1.86, CLAP_R[1]),
                  (2.00, APART_R[1]), (2.14, CLAP_R[1]), (2.50, HIP_R[1]), (2.98, 16), (3.40, 14)),
        twist=keys((0.00, 12), (0.60, 20), (1.00, 0), (1.45, -8), (1.68, 20), (1.86, CLAP_R[2]), (2.00, APART_R[2]),
                   (2.14, CLAP_R[2]), (2.50, HIP_R[2]), (2.98, 14), (3.40, 12)),
        elbow=keys((0.00, -14), (0.34, -22), (0.52, -70), (0.76, -52), (1.00, -22), (1.20, -18), (1.46, -34), (1.66, -88),
                   (1.86, CLAP_R[3]), (2.00, APART_R[3]), (2.14, CLAP_R[3]), (2.50, HIP_R[3]), (2.98, -30), (3.40, -16)),
        hand=hand_keys((0.00, (-6, 0, 0)), (0.60, (-14, 0, 0)), (1.02, (16, 0, 0)), (1.22, (28, 0, 0)), (1.66, (0, 0, 0)),
                       (1.86, (-4, 0, 0)), (2.45, (8, 0, 0)), (3.40, (-6, 0, 0)))))
    # Left arm: the fist pumps across the body and down, sweeps out ("come here"), meets the other hand in the clap, then the hip.
    c.arm('L', Arm('L',
        elev=keys((0.00, 8), (0.34, 26), (0.50, 40), (0.68, 62), (0.90, 36), (1.10, 56), (1.30, 70), (1.60, 46),
                  (1.76, 40), (1.86, CLAP_L[0]), (2.00, APART_L[0]), (2.14, CLAP_L[0]), (2.50, HIP_L[0]), (2.98, 14),
                  (3.40, 9)),
        azim=keys((0.00, 12), (0.45, -30), (0.62, -34), (0.86, -10), (1.12, 18), (1.36, 58), (1.62, 20), (1.86, CLAP_L[1]),
                  (2.00, APART_L[1]), (2.14, CLAP_L[1]), (2.50, HIP_L[1]), (2.98, 16), (3.40, 14)),
        twist=keys((0.00, -12), (0.55, -26), (0.90, -12), (1.40, -4), (1.70, -20), (1.86, CLAP_L[2]), (2.00, APART_L[2]),
                   (2.14, CLAP_L[2]), (2.50, HIP_L[2]), (2.98, -14), (3.40, -12)),
        elbow=keys((0.00, -12), (0.32, -50), (0.52, -118), (0.72, -86), (0.94, -40), (1.18, -66), (1.38, -42), (1.64, -96),
                   (1.86, CLAP_L[3]), (2.00, APART_L[3]), (2.14, CLAP_L[3]), (2.50, HIP_L[3]), (2.98, -30), (3.40, -14)),
        hand=hand_keys((0.00, (-6, 0, 0)), (0.58, (-16, 0, 0)), (1.02, (8, 0, 0)), (1.86, (-4, 0, 0)), (2.45, (8, 0, 0)),
                       (3.40, (-6, 0, 0)))))
    c.provenance_note = 'keyframed celebration; FK arms; in place, a heel rise (no jump); a small wander on the trunk'
    return c


# ----------------------------------------------------------------------------------------------------------------
# 4. bowl_disappointed
# ----------------------------------------------------------------------------------------------------------------

def bowl_disappointed():
    D = 3.4
    c = MomentClip('bowl_disappointed', PACK, 'bowler', D, rate=30, codec=2, mirrorable=False,
                   markers={'slump': 0.70, 'rest': 2.60})
    for side, plants in stand_plants(w=0.12, yaw=9.0):
        c.plants(side, plants)
    c.key(0.00, hipsOff=(0.000, -0.020, 0.004), hipsRot=(2.0, 0.0, 0.0))
    c.key(0.40, hipsOff=(0.000, -0.022, 0.008), hipsRot=(3.0, 0.0, 0.0))            # watching: still
    c.key(0.75, hipsOff=(0.012, -0.050, 0.014), hipsRot=(8.0, 2.0, 2.0))            # the slump, weight on the left foot
    c.key(1.40, hipsOff=(0.016, -0.046, 0.016), hipsRot=(8.5, -2.0, 2.5))
    c.key(2.05, hipsOff=(0.006, -0.036, 0.010), hipsRot=(6.0, 0.0, 1.0))
    c.key(2.60, hipsOff=(0.000, -0.030, 0.008), hipsRot=(4.0, 0.0, 0.0))
    c.key(3.40, hipsOff=(-0.003, -0.028, 0.008), hipsRot=(4.0, 0.0, 0.0))

    c.key(0.00, spine=(3.0, 0.0, 0.0))
    c.key(0.45, spine=(4.0, 3.0, 0.0))
    c.key(0.80, spine=(14.0, 0.0, 2.0))
    c.key(1.50, spine=(15.0, -3.0, 3.0))
    c.key(2.10, spine=(10.0, 0.0, 1.0))
    c.key(2.70, spine=(7.0, 0.0, 0.0))
    c.key(3.40, spine=(6.0, 0.0, 0.0))

    c.key(0.00, chest=(1.0, 0.0, 0.0))
    c.key(0.50, chest=(2.0, 3.0, 0.0))
    c.key(0.86, chest=(8.0, 0.0, 1.5))
    c.key(1.55, chest=(9.0, -3.0, 2.0))
    c.key(2.25, chest=(2.0, 0.0, 0.0))          # a deep breath in
    c.key(2.55, chest=(6.0, 0.0, 0.0))          # and out
    c.key(3.40, chest=(3.0, 0.0, 0.0))

    c.key(0.00, neck=(-3.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    c.key(0.28, neck=(-7.0, 12.0, 0.0), head=(-4.0, 16.0, 0.0))                    # follows the ball away
    c.key(0.50, neck=(-9.0, 18.0, 0.0), head=(-6.0, 22.0, 0.0))
    c.key(0.95, neck=(10.0, 4.0, 0.0), head=(12.0, 4.0, 0.0))                      # the head drops
    c.key(1.20, neck=(11.0, 10.0, 1.0), head=(13.0, 14.0, 0.0))                    # a slow shake
    c.key(1.50, neck=(11.0, -9.0, -1.0), head=(14.0, -12.0, 0.0))
    c.key(1.82, neck=(9.0, 6.0, 0.0), head=(11.0, 8.0, 0.0))
    c.key(2.20, neck=(2.0, 0.0, 0.0), head=(4.0, 0.0, 0.0))
    c.key(2.90, neck=(-3.0, 0.0, 0.0), head=(-1.0, 0.0, 0.0))
    c.key(3.40, neck=(-3.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    stand_wander(c)

    # Both hands go to the hips with the slump (elbows out, a solved gesture); the left hand then goes to the back of the
    # neck with the elbow high and rubs it; then the arms fall. (ik_arm puts the wrists where the gestures need them.)
    c.arm('R', Arm('R',
        elev=keys((0.00, 8), (0.45, 12), (0.74, 26), (1.02, HIP_R[0]), (2.05, HIP_R[0] - 2), (2.50, 28), (2.95, 12),
                  (3.40, 8)),
        azim=keys((0.00, 12), (0.45, 14), (0.74, 60), (1.02, HIP_R[1]), (2.05, HIP_R[1] + 3), (2.50, 44), (2.95, 16),
                  (3.40, 12)),
        twist=keys((0.00, 12), (0.45, 12), (0.74, 40), (1.02, HIP_R[2]), (2.05, HIP_R[2]), (2.50, 30), (2.95, 14),
                   (3.40, 12)),
        elbow=keys((0.00, -14), (0.45, -18), (0.80, -58), (1.08, HIP_R[3]), (2.05, HIP_R[3] + 3), (2.55, -56), (3.00, -24),
                   (3.40, -15)),
        hand=hand_keys((0.00, (-6, 0, 0)), (1.05, (8, 0, 0)), (2.05, (8, 0, 0)), (3.40, (-6, 0, 0)))))
    c.arm('L', Arm('L',
        elev=keys((0.00, 8), (0.45, 12), (0.76, 26), (1.04, HIP_L[0]), (1.42, HIP_L[0]), (1.98, NECK_A[0]), (2.18, NECK_B[0]),
                  (2.36, NECK_A[0]), (2.80, 80), (3.12, 24), (3.40, 8)),
        azim=keys((0.00, 12), (0.45, 14), (0.76, 60), (1.04, HIP_L[1]), (1.42, HIP_L[1]), (1.98, NECK_A[1]),
                  (2.18, NECK_B[1]), (2.36, NECK_A[1]), (2.80, 40), (3.12, 18), (3.40, 12)),
        twist=keys((0.00, -12), (0.45, -12), (0.76, -40), (1.04, HIP_L[2]), (1.42, HIP_L[2]), (1.98, NECK_A[2]),
                   (2.18, NECK_B[2]), (2.36, NECK_A[2]), (2.80, -30), (3.12, -14), (3.40, -12)),
        elbow=keys((0.00, -14), (0.45, -18), (0.82, -58), (1.08, HIP_L[3]), (1.42, HIP_L[3]), (2.02, NECK_A[3]),
                   (2.20, NECK_B[3]), (2.39, NECK_A[3]), (2.84, -95), (3.20, -28), (3.40, -15)),
        hand=hand_keys((0.00, (-6, 0, 0)), (1.05, (8, 0, 0)), (1.42, (8, 0, 0)), (2.00, (-10, 0, 0)), (2.40, (-10, 0, 0)),
                       (3.40, (-6, 0, 0)))))
    c.provenance_note = 'keyframed disappointment; FK arms; in place, feet planted; a small wander on the trunk'
    return c


# Decision D2 (the lead, 11:30Z): the bowler clips are kept or cut. Cutting them is this flag (then re-bake, re-export; the hook
# skips a bowler whose clip is not in the pack).
INCLUDE_BOWLER = os.environ.get('RESULT_MOMENTS_NO_BOWLER') != '1'  # RESULT_MOMENTS_NO_BOWLER=1 builds the pack without the two bowler clips (a scratch measurement)


def clips():
    out = [bat_celebrate_win(), bat_walk_off()]
    if INCLUDE_BOWLER:
        out += [bowl_celebrate_defend(), bowl_disappointed()]
    return out
