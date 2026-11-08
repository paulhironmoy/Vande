"""
Fielder pack, MOTION-FIELD2's clips (MOTION-SPEC §11): overarm throw, underarm flick, dives both ways and the get-up,
high and low catch, a short celebration. Original keyframes on VC17 (MOTION-FIELD2, from MOTION's first drafts); only
clips that pass every gate may be returned by clips().

Bake: python3 scripts/blender/motion/build.py fielder_actions   (writes assets-src/motion/fielder_actions/<id>.vms.json)
Pack: node scripts/motion/export.mjs --pack fielder_actions    (public/practice/motion/fielder_actions.vmp)
"""
import math

from vc17 import (OFFSET, QI, SHIN, THIGH, Clip, Curve, Plant, add, clamp, dot, fk, leg_ik, length, mul, norm, qaxis,
                  qconj, qeuler, qmul, qrot, qslerp, qswing_to, qyaw, sub, _euler_xyz)
from fielder_common import INF, READY, key_pose, ready_plants, ready_pose, stand_pose
import fielder_common

# Lead ruling 2026-11-04: MOTION-FIELD2's clips ship in their own pack (register VANDE-MOTION-FIELDER-ACTIONS-001,
# 48 KB budget); role stays 'fielder'.
PACK = 'fielder_actions'


# ---------------------------------------------------------------------------------------------------------------
# Explicit FK arms. IK with an elbow pole flips the shoulder twist when the hand passes over the shoulder (the pole's
# projection turns over); a throwing arm is therefore keyed directly: the upper arm's direction in the chest frame,
# its axial twist (the same swing-twist measure as scripts/motion/metrics.mjs: q = swing * twist about the bone's
# own Y), the elbow flex and the hand. Each parameter is an auto-clamped cubic curve; the clip's own arm channels
# (IK or FK) are used where the FK weight is 0.
# ---------------------------------------------------------------------------------------------------------------

def arm_quat(d, twist):
    """Upper-arm local rotation (chest frame) pointing the bone (its -Y) along `d`, twisted `twist` degrees."""
    return qmul(qswing_to((0.0, -1.0, 0.0), d), qaxis((0.0, 1.0, 0.0), twist))


def arm_params(qu, qf, qh):
    """(d, twist, elbowX, hand Euler) of solved arm locals (the inverse of ArmFK's mapping)."""
    d = qrot(qu, (0.0, -1.0, 0.0))
    s = qswing_to((0.0, -1.0, 0.0), d)
    t = qmul(qconj(s), qu)
    twist = 2.0 * math.atan2(t[1], t[3]) * 180.0 / math.pi
    twist = (twist + 540.0) % 360.0 - 180.0
    return d, twist, _euler_xyz(qf)[0], _euler_xyz(qh)


class ArmFK:
    """Keys: (t, d, twist, elbowX, hand=(x, y, z), w=1). d is a 3-vector in the chest frame (normalised after
    interpolation; never straight up)."""

    def __init__(self, keys):
        ks = sorted(keys, key=lambda k: k[0])
        self.c = {}
        for i in range(3):
            self.c['d%d' % i] = Curve([(k[0], k[1][i]) for k in ks])
            self.c['h%d' % i] = Curve([(k[0], k[4][i]) for k in ks])
        self.c['tw'] = Curve([(k[0], k[2]) for k in ks])
        self.c['el'] = Curve([(k[0], k[3]) for k in ks])
        self.c['w'] = Curve([(k[0], k[5] if len(k) > 5 else 1.0) for k in ks])

    def at(self, t):
        d = norm(tuple(self.c['d%d' % i](t) for i in range(3)))
        qu = arm_quat(d, self.c['tw'](t))
        qf = qeuler(self.c['el'](t), 0.0, 0.0)
        qh = qeuler(*(self.c['h%d' % i](t) for i in range(3)))
        return qu, qf, qh, clamp(self.c['w'](t), 0.0, 1.0)


class LegAim:
    """An airborne leg aimed from its hip joint: keys (t, dir, len, pole, foot) with `dir` the hip-joint-to-ankle
    direction and `pole` the kneecap direction, both in the hips' frame (`frame='hips'`, so a rolling pelvis carries
    the leg) or the actor (ground) frame, `len` metres (kept below the
    leg's reach) and `foot` the ankle's local Euler. The foot's height is then set directly, whatever the hips do.
    Solved by the same analytic two-bone IK as the plants."""

    def __init__(self, keys, frame='hips', slope0=None, t_end=INF):
        ks = sorted(keys, key=lambda k: k[0])
        self.t0 = ks[0][0]
        self.t_end = t_end  # the aim lets go (a plant takes the foot) at t_end
        self.frame = frame
        self.c = {}
        # slope0: the rates (dir, len, pole, foot) at the first key, so the aimed leg leaves the ground with the
        # velocity the IK leg had there (no step in angular velocity at the hand-over).
        s0 = slope0 or ((None,) * 3, None, (None,) * 3, (None,) * 3)

        def curve(get, pin):
            return Curve([(k[0], get(k)) + ((pin,) if j == 0 and pin is not None else ()) for j, k in enumerate(ks)])

        for i in range(3):
            self.c['d%d' % i] = curve(lambda k, i=i: k[1][i], s0[0][i])
            self.c['p%d' % i] = curve(lambda k, i=i: k[3][i], s0[2][i])
            self.c['f%d' % i] = curve(lambda k, i=i: k[4][i], s0[3][i])
        self.c['len'] = curve(lambda k: k[2], s0[1])

    def at(self, t):
        g = lambda n: tuple(self.c[n + str(i)](t) for i in range(3))
        return norm(g('d')), min(self.c['len'](t), THIGH + SHIN - 0.02), norm(g('p')), qeuler(*g('f'))


class ActionClip(Clip):
    """A Clip whose arms may be driven by ArmFK tracks and whose airborne legs by LegAim tracks, applied after the
    base solve (the trunk never reads the limbs; the base solve's guard ignores a leg once its legFK weight is 1,
    which leg_aim() keys)."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.arm_fk = {}
        self.leg_aim = {}

    def arm(self, side, keys):
        self.arm_fk[side] = ArmFK(keys)

    def aim_leg(self, side, keys, frame='hips', slope0=None, t_end=INF):
        self.leg_aim[side] = LegAim(keys, frame, slope0, t_end)

    def solve(self, t):
        ground, hips_off, local, contacts, diag = super().solve(t)
        for side, tr in self.arm_fk.items():
            qu, qf, qh, w = tr.at(t)
            if w <= 0.0:
                continue
            for b, q in (('upperArm', qu), ('forearm', qf), ('hand', qh)):
                local[b + side] = q if w >= 1.0 else qslerp(local[b + side], q, w)
        if self.leg_aim:
            P, W = fk(ground, hips_off, local)
            gq = qyaw(ground[2])
            for side, tr in self.leg_aim.items():
                if t < tr.t0 or t >= tr.t_end:
                    continue
                d, ln, pole, fq = tr.at(t)
                fr = W['hips'] if tr.frame == 'hips' else gq
                hip = add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side]))
                th, sh, _, _, w_shin = leg_ik(hip, W['hips'], add(hip, mul(qrot(fr, d), ln)), QI, qrot(fr, pole))
                local['thigh' + side], local['shin' + side], local['foot' + side] = th, sh, fq
        return ground, hips_off, local, contacts, diag

    def aim_from_plant(self, side, plant, frame='hips', t=None):
        """The LegAim key that reproduces the IK leg at the moment `plant` lifts (t1): (dir, len, pole, foot)."""
        t = plant.t1 if t is None else t
        ground, hips_off, local, _, _ = Clip.solve(self, t)
        P, W = fk(ground, hips_off, local)
        hip = add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side]))
        ankle = P['foot' + side]
        knee = P['shin' + side]
        gq = qconj(W['hips'] if frame == 'hips' else qyaw(ground[2]))
        v = sub(ankle, hip)
        n = norm(v)
        m = sub(knee, add(hip, mul(n, dot(sub(knee, hip), n))))
        return (qrot(gq, n), length(v), qrot(gq, norm(m)), _euler_xyz(local['foot' + side]))


def solved_arm(pose, side, plants=None, pole_space='ground', t=0.0):
    """(d, twist, elbowX, hand) of one arm in a keyed pose (solved on a throwaway clip): lets an FK arm start exactly
    where an IK pose leaves it."""
    c = Clip('_probe', PACK, 'fielder', 1.0)
    c.arm_pole_space = pole_space
    if plants:
        for s, p in plants.items():
            c.plants(s, p)
    key_pose(c, 0.0, pose)
    key_pose(c, 1.0, pose)
    _, _, loc, _, _ = c.solve(t)
    return arm_params(loc['upperArm' + side], loc['forearm' + side], loc['hand' + side])


def euler_arm(upper, fore, hand):
    """(d, twist, elbowX, hand) of an FK arm given as Euler channels (stand_pose and friends)."""
    return arm_params(qeuler(*upper), qeuler(*fore), qeuler(*hand))


# Where fld_pickup_2h leaves the feet (its last frame): the throw starts there so the two chain without a slide.
GATHER_YAW = -72.0
GATHER_L = ((0.159, 0.4497), -32.0)
GATHER_R = ((-0.12, 0.04), -52.0)


def throw_over():
    """The overarm throw at the target (+Z), from the side-on gather that ends fld_pickup_2h (ball at the chest).
    The ball hand takes the ball down past the right hip and back up (a long arm), the front arm points at the
    target and the weight goes back; the front foot strides at the target, the hips then the shoulders turn
    through, the arm comes over high (`release`, the hand in front of the head), follows through across to the
    left hip, and the back foot steps through. In place: the physics places the fielder; the hips stay within 0.30 m
    of the root up to the release."""
    T_REL = 0.66
    c = ActionClip('fld_throw_over', PACK, 'fielder', 1.4, rate=60, codec=1, mirrorable=True,
                   markers={'release': T_REL})
    c.arm_pole_space = 'chest'
    (lb, ly), (rb, ry) = GATHER_L, GATHER_R
    Lp = Plant('L', -INF, 0.16, lb, ly, off=14.0, peel_s=0.08)
    L2 = Plant('L', 0.46, INF, (0.14, 0.66), -18.0, land=-6.0, land_s=0.10, swing_keys=[(0.5, 'arc', 0.0, 0.07)])
    Rp = Plant('R', -INF, 0.74, rb, ry, off=44.0, peel_s=0.40)
    Rp.pivot = (0.46, 0.66, 44.0)
    R2 = Plant('R', 1.00, INF, (-0.16, 0.86), -6.0, land=-4.0, land_s=0.08, swing_keys=[(0.5, 'arc', 0.0, 0.10)])
    c.plants('L', [Lp, L2])
    c.plants('R', [Rp, R2])
    g = fielder_common.gather(GATHER_YAW)
    feet = {'L': [Lp], 'R': [Rp]}
    a0R = solved_arm(g, 'R', feet, 'chest')
    a0L = solved_arm(g, 'L', feet, 'chest')
    endR = euler_arm((2.0, 0.0, -8.0), (-15.0, 0.0, 0.0), (-8.0, 0.0, 0.0))
    endL = euler_arm((2.0, 0.0, 8.0), (-15.0, 0.0, 0.0), (-8.0, 0.0, 0.0))
    # Trunk: weight back and coiled, then hips lead, shoulders follow (side bend to the glove side lifts the arm), a
    # forward bow over the front leg; the eyes stay on the target until the follow-through.
    key_pose(c, 0.0, g)
    key_pose(c, 0.24, g, hipsOff=(0.0, -0.11, -0.02), hipsRot=(5.0, -82.0, 0.0), spine=(3.0, -4.0, 2.0),
             chest=(0.0, -6.0, 2.0), neck=(-6.0, 50.0, 0.0), head=(-4.0, 38.0, 0.0))
    key_pose(c, 0.46, g, hipsOff=(0.0, -0.15, 0.10), hipsRot=(6.0, -70.0, -2.0), spine=(0.0, -8.0, -4.0),
             chest=(-3.0, -8.0, -4.0), neck=(-6.0, 50.0, 2.0), head=(-4.0, 34.0, 2.0))
    key_pose(c, T_REL, g, hipsOff=(0.0, -0.16, 0.24), hipsRot=(10.0, -14.0, -2.0), spine=(8.0, 10.0, -10.0),
             chest=(4.0, 8.0, -8.0), neck=(-10.0, 0.0, 8.0), head=(-6.0, 0.0, 6.0))
    key_pose(c, 0.86, g, hipsOff=(0.0, -0.22, 0.34), hipsRot=(24.0, 6.0, 0.0), spine=(22.0, 12.0, -4.0),
             chest=(12.0, 8.0, 0.0), neck=(-22.0, -12.0, 0.0), head=(-12.0, -8.0, 0.0))
    key_pose(c, 1.12, g, hipsOff=(0.0, -0.10, 0.42), hipsRot=(8.0, 2.0, 0.0), spine=(7.0, 3.0, 0.0),
             chest=(3.0, 2.0, 0.0), neck=(-7.0, -3.0, 0.0), head=(-3.0, -2.0, 0.0))
    key_pose(c, 1.4, stand_pose(hipsOff=(0.0, -0.05, 0.44), hipsRot=(3.0, 0.0, 0.0)))
    # Arms: explicit FK throughout (chest frame). Through the release the upper arm keeps its abduction; the elbow
    # extends and the shoulder turns in, and the arm then sweeps forward at the target and down across the body.
    c.arm('R', [
        (0.0, a0R[0], a0R[1], a0R[2], a0R[3]),
        (0.14, (-0.22, -0.96, 0.14), 14.0, -48.0, (-8.0, 0.0, 0.0)),
        (0.26, (-0.34, -0.84, -0.42), -14.0, -22.0, (-12.0, 0.0, 0.0)),
        (0.38, (-0.70, -0.24, -0.66), -50.0, -40.0, (-20.0, 0.0, 0.0)),
        (0.50, (-0.97, 0.18, -0.14), -92.0, -92.0, (-26.0, 0.0, 0.0)),
        (T_REL, (-0.68, 0.56, 0.47), -30.0, -24.0, (6.0, 0.0, 0.0)),
        (0.76, (-0.36, -0.18, 0.92), 6.0, -22.0, (0.0, 0.0, 0.0)),
        (0.92, (0.24, -0.74, 0.62), 24.0, -34.0, (-6.0, 0.0, 0.0)),
        (1.14, (0.02, -0.98, 0.18), 6.0, -24.0, (-8.0, 0.0, 0.0)),
        (1.4, endR[0], endR[1], endR[2], endR[3]),
    ])
    c.arm('L', [
        (0.0, a0L[0], a0L[1], a0L[2], a0L[3]),
        (0.14, (0.50, -0.62, 0.60), -10.0, -70.0, (-8.0, 0.0, 0.0)),
        (0.32, (0.94, 0.22, 0.26), 50.0, -28.0, (-10.0, 0.0, 0.0)),
        (0.50, (0.92, 0.16, 0.36), 54.0, -34.0, (-10.0, 0.0, 0.0)),
        (T_REL, (0.56, -0.74, -0.06), 30.0, -104.0, (-10.0, 0.0, 0.0)),
        (0.90, (0.30, -0.95, -0.06), 16.0, -78.0, (-8.0, 0.0, 0.0)),
        (1.4, endL[0], endL[1], endL[2], endL[3]),
    ])
    c.provenance_note = (f'keyframed overarm throw from the gather; FK arms; release at {T_REL:.2f} s; hips offset '
                         'at release (0, -0.16, 0.24) m, at the end (0, -0.05, 0.44) m')
    return c


def flick_under():
    """The underarm flick at the stumps (+Z) from a low position beside the ball, ball in the right hand by the
    right foot: a short back-swing as the front (left) foot steps at the target, the arm swings through low and
    lets go in front at knee-to-hip height (`release`), follows through at the target, and the back foot comes
    through. In place: hips offset within 0.30 m of the root up to the release."""
    T_REL = 0.36
    c = ActionClip('fld_flick_under', PACK, 'fielder', 1.0, rate=60, codec=1, mirrorable=True,
                   markers={'release': T_REL})
    L, R = ready_plants(-INF, 0.08, low=18.0)
    L.peel_s = 0.06
    L.off = 22.0
    L2 = Plant('L', 0.30, INF, (0.15, 0.50), 2.0, land=-4.0, land_s=0.08, swing_keys=[(0.5, 'arc', 0.0, 0.06)])
    R.t1 = 0.60
    R.low = 26.0
    R.land = 26.0
    R.peel_s = 0.30
    R.off = 40.0
    R.pivot = (0.14, 0.46, 16.0)
    R2 = Plant('R', 0.86, INF, (-0.16, 0.44), -6.0, land=-4.0, land_s=0.08, swing_keys=[(0.5, 'arc', 0.0, 0.07)])
    c.plants('L', [L, L2])
    c.plants('R', [R, R2])
    low = dict(READY, hipsOff=(0.0, -0.24, 0.0), hipsRot=(24.0, -8.0, 0.0), spine=(20.0, 0.0, 0.0),
               chest=(8.0, 0.0, 0.0), neck=(-26.0, 6.0, 0.0), head=(-16.0, 2.0, 0.0),
               handIKL=(0.20, 0.62, 0.42))
    key_pose(c, 0.0, low)
    key_pose(c, 0.14, low, hipsOff=(0.0, -0.25, 0.03), hipsRot=(24.0, -12.0, 0.0))
    key_pose(c, T_REL, low, hipsOff=(0.0, -0.24, 0.16), hipsRot=(20.0, 4.0, 0.0), spine=(18.0, 6.0, 0.0),
             neck=(-24.0, -4.0, 0.0), head=(-14.0, -2.0, 0.0), handIKL=(0.30, 0.66, 0.24))
    key_pose(c, 0.56, low, hipsOff=(0.0, -0.20, 0.24), hipsRot=(18.0, 8.0, 0.0), spine=(14.0, 6.0, 0.0),
             chest=(6.0, 2.0, 0.0), neck=(-18.0, -6.0, 0.0), head=(-10.0, -4.0, 0.0), handIKL=(0.30, 0.72, 0.16))
    key_pose(c, 1.0, ready_pose(hipsOff=(0.0, -0.13, 0.30), hipsRot=(14.0, 2.0, 0.0)))
    a0 = solved_arm(low, 'R', {'L': [L], 'R': [R]})
    a1 = solved_arm(ready_pose(), 'R', {'L': [L], 'R': [R]})
    # The ball hand starts by the right foot, swings back a little, then through low and up at the target.
    c.arm('R', [
        (0.0, (-0.12, -0.84, 0.52), 10.0, -24.0, (-10.0, 0.0, 0.0), 1.0),
        (0.16, (-0.16, -0.97, -0.18), 4.0, -14.0, (10.0, 0.0, 0.0), 1.0),
        (T_REL, (-0.06, -0.60, 0.80), 0.0, -14.0, (-24.0, 0.0, 0.0), 1.0),
        (0.52, (-0.02, -0.02, 1.0), 6.0, -12.0, (-10.0, 0.0, 0.0), 1.0),
        (0.76, (-0.08, -0.62, 0.78), 4.0, -30.0, (-10.0, 0.0, 0.0), 1.0),
        (1.0,) + a1 + (1.0,),
    ])
    c.provenance_note = (f'keyframed underarm flick; FK ball arm; release at {T_REL:.2f} s; hips offset at release '
                         '(0, -0.24, 0.16) m, at the end (0, -0.13, 0.30) m')
    return c


def lift_off(c, side, plant, keys):
    """From the moment `plant` lifts, the leg is aimed (LegAim, hips frame) through `keys` = [(t, dir, len, pole,
    foot)]: the first aim key reproduces the IK leg at the lift, and legFK steps to 1 there so the base solve's guard
    lets go of it."""
    h = 1.0 / 240.0
    a1 = c.aim_from_plant(side, plant)
    a0 = c.aim_from_plant(side, plant, t=plant.t1 - h)
    slope0 = (tuple((a1[0][i] - a0[0][i]) / h for i in range(3)), (a1[1] - a0[1]) / h,
              tuple((a1[2][i] - a0[2][i]) / h for i in range(3)), (None, None, None))
    # (The foot's own rate is not carried on: the peel is pointing the toes, and carrying that on would dip the toe
    # tip into the ground; keep the peel's end rate low instead.)
    # The aim drives the leg from t1 on; the base solve only needs legFK = 1 (its guard lets go of the lifted foot).
    # The step sits just after t1 so no frame before the lift sees a partly-FK leg.
    c.key(plant.t1, **{'legFK' + side: 0.0})
    c.key(plant.t1 + 0.004, **{'legFK' + side: 1.0})
    c.aim_leg(side, [(plant.t1,) + a1] + list(keys), slope0=slope0)


# The dive's last frame, which the get-up starts from exactly: trunk channels, leg aims (hips frame) and FK arms.
DIVE_END = dict(READY, hipsOff=(-0.04, -0.73, 0.0), hipsRot=(8.0, 0.0, 84.0), spine=(18.0, 0.0, -6.0),
                chest=(8.0, 0.0, -4.0), neck=(-18.0, 0.0, -2.0), head=(-8.0, 0.0, -4.0))
DIVE_END_AIM = {'L': ((0.20, -0.65, 0.73), 0.52, (0.0, 0.2, 1.0), (12.0, 0.0, 0.0)),
                'R': ((0.10, -0.75, 0.65), 0.58, (0.0, 0.0, 1.0), (10.0, 0.0, 0.0))}
DIVE_ARM_END = {'R': ((-0.10, -0.30, 0.95), 0.0, -112.0, (-10.0, 0.0, 0.0)),
                'L': ((0.30, -0.10, 0.95), 10.0, -118.0, (-10.0, 0.0, 0.0))}


def dive_r():
    """A full-length dive to his right from the ready stance. A load, then the push from the near (right) foot while
    the far knee drives, the body lays out on its side with both arms at full stretch, hands in front
    of the face (`reach`), lands on the right forearm, hip and side (`land`) and draws the ball in to the chest. In
    place: the physics path carries the travel, so the hips stay within 0.08 m of the root in x and z."""
    T_REACH, T_LAND = 0.46, 0.58
    c = ActionClip('fld_dive_r', PACK, 'fielder', 1.1, rate=60, codec=1, mirrorable=True,
                   markers={'reach': T_REACH, 'land': T_LAND}, aliases={'fld_dive_l': 'mirror'})
    L, R = ready_plants(-INF, 0.18)
    L.peel_s = 0.10
    L.off = 28.0
    # The near (right) foot stays down and pushes, rolling onto its toes.
    R.t1 = 0.32
    R.peel_s = 0.18
    R.off = 24.0
    c.plants('L', [L])
    c.plants('R', [R])
    key_pose(c, 0.0, READY)
    key_pose(c, 0.17, READY, hipsOff=(-0.04, -0.20, 0.0), hipsRot=(14.0, 0.0, 8.0), spine=(10.0, 0.0, 4.0),
             chest=(4.0, 0.0, 2.0), neck=(-16.0, 0.0, -6.0), head=(-12.0, 0.0, -4.0))
    key_pose(c, 0.37, READY, hipsOff=(-0.07, -0.12, 0.0), hipsRot=(7.0, 0.0, 36.0), spine=(4.0, 0.0, 6.0),
             chest=(2.0, 0.0, 4.0), neck=(-12.0, 0.0, -14.0), head=(-8.0, 0.0, -10.0))
    key_pose(c, T_REACH, READY, hipsOff=(-0.06, -0.38, 0.0), hipsRot=(4.0, 0.0, 66.0), spine=(2.0, 0.0, 6.0),
             chest=(0.0, 0.0, 4.0), neck=(-12.0, 0.0, -12.0), head=(-8.0, 0.0, -8.0))
    key_pose(c, T_LAND, READY, hipsOff=(-0.05, -0.72, 0.0), hipsRot=(2.0, 0.0, 84.0), spine=(4.0, 0.0, -6.0),
             chest=(0.0, 0.0, -4.0), neck=(-14.0, 0.0, -2.0), head=(-6.0, 0.0, -4.0))
    key_pose(c, 0.78, READY, hipsOff=(-0.04, -0.73, 0.0), hipsRot=(6.0, 0.0, 84.0), spine=(12.0, 0.0, -6.0),
             chest=(6.0, 0.0, -4.0), neck=(-16.0, 0.0, -2.0), head=(-8.0, 0.0, -4.0))
    key_pose(c, 1.1, DIVE_END)
    # Legs: aimed from the moment each foot leaves the ground (hips frame, so the roll carries them; the knee folds
    # where a leg sweeps under the pelvis); the far knee drives, the push leg's heel kicks up, both trail.
    lift_off(c, 'L', L, [
        (0.27, (0.15, -0.70, 0.55), 0.55, (0.2, 0.3, 1.0), (16.0, 0.0, 0.0)),
        (0.37, (0.25, -0.85, 0.30), 0.66, (0.1, 0.3, 1.0), (24.0, 0.0, 0.0)),
        (T_REACH, (0.30, -0.95, 0.0), 0.78, (0.0, 0.3, 1.0), (30.0, 0.0, 0.0)),
        (T_LAND, (0.20, -0.98, 0.05), 0.78, (0.0, 0.2, 1.0), (30.0, 0.0, 0.0)),
        (0.78, (0.20, -0.85, 0.48), 0.62, (0.0, 0.2, 1.0), (20.0, 0.0, 0.0)),
        (1.1,) + DIVE_END_AIM['L'],
    ])
    lift_off(c, 'R', R, [
        (0.355, (-0.44, -0.87, 0.12), 0.52, (-0.07, 0.33, 0.94), (4.0, 0.0, 0.0)),
        (0.40, (-0.20, -0.92, -0.20), 0.50, (-0.03, 0.2, 1.0), (24.0, 0.0, 0.0)),
        (0.48, (0.10, -0.98, -0.12), 0.70, (0.0, 0.0, 1.0), (30.0, 0.0, 0.0)),
        (T_LAND, (0.14, -0.99, 0.0), 0.78, (0.0, 0.0, 1.0), (26.0, 0.0, 0.0)),
        (0.78, (0.10, -0.85, 0.50), 0.66, (0.0, 0.0, 1.0), (18.0, 0.0, 0.0)),
        (1.1,) + DIVE_END_AIM['R'],
    ])
    # Arms: FK from the ready stance to full stretch, then the ball is drawn in.
    a0 = {s: solved_arm(READY, s, {'L': [L], 'R': [R]}) for s in 'LR'}
    c.arm('R', [
        (0.0,) + a0['R'],
        (0.18, (-0.56, -0.30, 0.77), 10.0, -40.0, (-10.0, 0.0, 0.0)),
        (0.34, (-0.36, 0.40, 0.84), 0.0, -18.0, (0.0, 0.0, 0.0)),
        (T_REACH, (-0.16, 0.80, 0.58), 0.0, -8.0, (10.0, 0.0, 0.0)),
        (T_LAND, (-0.24, 0.66, 0.71), 0.0, -24.0, (6.0, 0.0, 0.0)),
        (0.78, (-0.12, 0.10, 0.99), 0.0, -96.0, (-6.0, 0.0, 0.0)),
        (1.1,) + DIVE_ARM_END['R'],
    ])
    c.arm('L', [
        (0.0,) + a0['L'],
        (0.18, (0.10, -0.40, 0.91), 0.0, -50.0, (-10.0, 0.0, 0.0)),
        (0.34, (0.04, 0.40, 0.92), 0.0, -18.0, (0.0, 0.0, 0.0)),
        (T_REACH, (0.14, 0.78, 0.61), 0.0, -8.0, (10.0, 0.0, 0.0)),
        (T_LAND, (0.20, 0.64, 0.74), 0.0, -24.0, (6.0, 0.0, 0.0)),
        (0.78, (0.24, 0.10, 0.96), 6.0, -100.0, (-6.0, 0.0, 0.0)),
        (1.1,) + DIVE_ARM_END['L'],
    ])
    c.contact('body', T_LAND, 1.1)
    c.contact('handR', T_LAND, 0.74)
    c.provenance_note = ('keyframed full-length dive to the right; in place (the physics path carries the travel); '
                         'hips offset |x| <= 0.07 m, z = 0')
    return c


def aim_key_from(src, side, t, frame='actor'):
    """(dir, len, pole, foot) of one leg as clip `src` fully solves it at t, in the given frame of the target clip."""
    ground, hips_off, local, _, _ = src.solve(t)
    P, W = fk(ground, hips_off, local)
    hip = add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side]))
    knee = P['shin' + side]
    v = sub(P['foot' + side], hip)
    n = norm(v)
    m = norm(sub(knee, add(hip, mul(n, dot(sub(knee, hip), n)))))
    inv = qconj(W['hips'] if frame == 'hips' else qyaw(ground[2]))
    return qrot(inv, n), length(v), qrot(inv, m), _euler_xyz(local['foot' + side])


def aim_to(c, side, t, ankle, pole, foot, frame='hips'):
    """A LegAim key putting the ankle at `ankle` (actor frame) at t, with the hips where they are then; `dir` is
    returned in `frame` and `pole` is taken as given in that frame."""
    ground, hips_off, local, _, _ = Clip.solve(c, t)
    P, W = fk(ground, hips_off, local)
    hip = add(P['hips'], qrot(W['hips'], OFFSET['thigh' + side]))
    gq = qyaw(ground[2])
    v = sub(add((ground[0], 0.0, ground[1]), qrot(gq, ankle)), hip)
    inv = qconj(W['hips'] if frame == 'hips' else gq)
    return (t, qrot(inv, norm(v)), length(v), pole, foot)


def land_leg(c, side, plant, first, keys, frame='hips'):
    """An aimed leg from `first` through `keys` [(t, ankle (actor frame), pole (in `frame`), foot)] that lands
    exactly in the IK pose of `plant` at plant.t0, where the plant takes the foot. legFK is 1 before (no contact, the
    guard ignores it)."""
    c.key(0.0, **{'legFK' + side: 1.0})
    c.key(plant.t0 - 0.004, **{'legFK' + side: 1.0})
    c.key(plant.t0, **{'legFK' + side: 0.0})
    last = (plant.t0,) + c.aim_from_plant(side, plant, frame=frame, t=plant.t0)
    # A key without a pole (None) takes the landing pose's knee direction, so the leg does not twist as it lands.
    keys = [(t, a, last[3] if pole is None else pole, f) for (t, a, pole, f) in keys]
    c.aim_leg(side, [first] + [aim_to(c, side, *k, frame=frame) for k in keys] + [last], frame=frame,
              t_end=plant.t0)


def getup_r():
    """Up from the dive to the right (it starts on the dive's last frame): the right hand pushes on the ground as the
    trunk rolls up, the top (left) leg comes through and its foot plants ahead, a moment on the right knee, then the
    right foot comes under and he stands, ball in the left hand, in a slightly staggered ready stance. In place."""
    c = ActionClip('fld_getup_r', PACK, 'fielder', 1.4, rate=60, codec=1, mirrorable=True,
                   markers={'up': 1.2}, aliases={'fld_getup_l': 'mirror'})
    c.arm_pole_space = 'chest'
    dive = dive_r()
    L = Plant('L', 0.56, INF, (0.21, 0.32), 8.0, land=8.0, low=10.0, land_s=0.08)
    R = Plant('R', 1.06, INF, (-0.21, 0.14), -12.0, land=10.0, low=18.0, land_s=0.08)
    c.plants('L', [L])
    c.plants('R', [R])
    push = dict(handIKR=(-0.42, 0.06, 0.22), elbowPoleR=(0.2, -0.8, -0.5), armIKR=1.0)
    key_pose(c, 0.0, DIVE_END, **push)
    key_pose(c, 0.30, DIVE_END, hipsOff=(-0.04, -0.62, 0.0), hipsRot=(22.0, 0.0, 54.0), spine=(20.0, 0.0, -8.0),
             chest=(10.0, 0.0, -6.0), neck=(-20.0, 0.0, 6.0), head=(-10.0, 0.0, 4.0), **push)
    key_pose(c, 0.48, DIVE_END, hipsOff=(-0.04, -0.50, 0.02), hipsRot=(22.0, 0.0, 28.0), spine=(18.0, 0.0, -4.0),
             chest=(9.0, 0.0, -4.0), neck=(-19.0, 0.0, 4.0), head=(-10.0, 0.0, 3.0), **push)
    key_pose(c, 0.64, DIVE_END, hipsOff=(-0.03, -0.43, 0.04), hipsRot=(20.0, 0.0, 10.0), spine=(14.0, 0.0, -2.0),
             chest=(7.0, 0.0, -2.0), neck=(-18.0, 0.0, 2.0), head=(-10.0, 0.0, 2.0), handIKR=(-0.35, 0.40, 0.25))
    key_pose(c, 0.84, READY, hipsOff=(-0.02, -0.40, 0.06), hipsRot=(18.0, 0.0, 4.0), spine=(12.0, 0.0, 0.0))
    key_pose(c, 1.04, READY, hipsOff=(-0.01, -0.19, 0.13), hipsRot=(17.0, 0.0, 1.0))
    key_pose(c, 1.4, READY, hipsOff=(0.0, -0.13, 0.15))
    land_leg(c, 'L', L, (0.0,) + aim_key_from(dive, 'L', dive.duration, frame='hips'), [
        (0.20, (0.32, 0.30, 0.34), (0.0, 0.6, 0.8), (6.0, 0.0, 0.0)),
        (0.40, (0.26, 0.22, 0.38), None, (0.0, 0.0, 0.0)),
        (0.49, (0.22, 0.15, 0.36), None, (-14.0, 0.0, 0.0)),
    ])
    # The bottom leg: knee forward along the ground while he is on his side, then under the hips (kneeling, shin
    # back along the ground, toes tucked), then the foot comes through and plants.
    land_leg(c, 'R', R, (0.0,) + aim_key_from(dive, 'R', dive.duration, frame='hips'), [
        (0.26, (0.16, 0.14, 0.06), (0.0, 0.3, 1.0), (-10.0, 0.0, 0.0)),
        (0.44, (0.06, 0.15, -0.14), (0.0, 0.1, 1.0), (4.0, 0.0, 0.0)),
        (0.66, (-0.13, 0.16, -0.30), (0.0, -0.2, 1.0), (14.0, 0.0, 0.0)),
        (0.86, (-0.19, 0.24, -0.10), (0.0, 0.0, 1.0), (-12.0, 0.0, 0.0)),
        (0.98, (-0.21, 0.19, 0.08), None, (-30.0, 0.0, 0.0)),
    ])
    a_end = {s: solved_arm(READY, s, {'L': [L], 'R': [R]}) for s in 'LR'}
    # The right hand goes to the ground and pushes (arm IK on a fixed ground point), then both arms to the ready.
    c.arm('R', [
        (0.0,) + DIVE_ARM_END['R'] + (1.0,),
        (0.20, (-0.40, -0.60, 0.69), 0.0, -40.0, (-30.0, 0.0, 0.0), 0.0),
        (0.50, (-0.40, -0.60, 0.69), 0.0, -40.0, (-30.0, 0.0, 0.0), 0.0),
        (0.76, (-0.30, -0.80, 0.52), 0.0, -50.0, (-10.0, 0.0, 0.0), 1.0),
        (1.4,) + a_end['R'] + (1.0,),
    ])
    c.arm('L', [
        (0.0,) + DIVE_ARM_END['L'],
        (0.44, (0.30, -0.55, 0.78), 10.0, -110.0, (-10.0, 0.0, 0.0)),
        (0.90, (0.25, -0.75, 0.61), 10.0, -80.0, (-12.0, 0.0, 0.0)),
        (1.4,) + a_end['L'],
    ])
    c.contact('body', 0.0, 0.22)
    c.contact('handR', 0.14, 0.50)
    c.contact('kneeR', 0.56, 0.84)
    c.provenance_note = ('keyframed get-up from the right-side dive into a slightly staggered ready stance; in place; '
                         'hips offset at the end (0, -0.13, 0.15) m')
    return c


# ---------------------------------------------------------------------------------------------------------------
# The fast pair (lead ruling 2026-11-04): a dive and a scramble that puts him on his feet DIVE.recoverS (0.8 s, physics
# src/physics/fielding.ts) after the hands reach the ball. Authored as one continuous clip and split just after the
# landing, so the hand-over is exact in pose and in velocity; the scramble ends exactly in the ready stance.
# ---------------------------------------------------------------------------------------------------------------

RECOVER_S = 0.8  # physics DIVE.recoverS: hands at the ball -> on his feet
FAST_SPLIT = 0.65  # the dive half ends (and the scramble begins) here; a whole 60 Hz frame


class Segment(Clip):
    """[t0, t1] of another clip as a clip of its own (markers given in its own time)."""

    def __init__(self, src, cid, t0, t1, markers=None, aliases=None, note=''):
        super().__init__(cid, src.pack, src.role, round(t1 - t0, 6), rate=src.rate, codec=src.codec,
                         mirrorable=src.mirrorable, markers=markers, aliases=aliases)
        self.src = src
        self.t0 = t0
        self.provenance_note = note

    def solve(self, t):
        return self.src.solve(self.t0 + t)


def lift_and_land(c, side, off, on, keys, approach=()):
    """An airborne leg from the lift of plant `off` (t1) to the strike of plant `on` (t0): aimed (hips frame) through
    `keys` [(t, dir, len, pole, foot)] and `approach` [(t, ankle (actor frame), pole or None, foot)], leaving with the
    IK leg's velocity and landing exactly in the IK pose of `on`."""
    h = 1.0 / 240.0
    a1 = c.aim_from_plant(side, off)
    a0 = c.aim_from_plant(side, off, t=off.t1 - h)
    slope0 = (tuple((a1[0][i] - a0[0][i]) / h for i in range(3)), (a1[1] - a0[1]) / h,
              tuple((a1[2][i] - a0[2][i]) / h for i in range(3)), (None, None, None))
    c.key(off.t1, **{'legFK' + side: 0.0})
    c.key(off.t1 + 0.004, **{'legFK' + side: 1.0})
    c.key(on.t0 - 0.004, **{'legFK' + side: 1.0})
    c.key(on.t0, **{'legFK' + side: 0.0})
    last = (on.t0,) + c.aim_from_plant(side, on, frame='hips', t=on.t0)
    app = [aim_to(c, side, t, a, last[3] if p is None else p, f) for (t, a, p, f) in approach]
    c.aim_leg(side, [(off.t1,) + a1] + list(keys) + app + [last], slope0=slope0, t_end=on.t0)


def dive_scramble_full():
    """The fast dive to the right and the scramble up, as one clip: the dive is fld_dive_r's (same load, push,
    reach and landing); after the landing the ball is drawn in as he rolls up off the right forearm, both feet come
    under him (left, then right) and he rises into the ready stance, on his feet RECOVER_S after `reach`."""
    T_REACH, T_LAND = 0.46, 0.58
    T_UP = T_REACH + RECOVER_S
    c = ActionClip('fld_dive_scramble_full_r', PACK, 'fielder', 1.5, rate=60, codec=1, mirrorable=True,
                   markers={'reach': T_REACH, 'land': T_LAND, 'up': T_UP})
    L, R = ready_plants(-INF, 0.18)
    L.peel_s = 0.10
    L.off = 28.0
    R.t1 = 0.32
    R.peel_s = 0.18
    R.off = 24.0
    # Both feet come back under him at their ready-stance spots (on the balls of the feet, heels settling as he rises).
    L2, R2 = ready_plants(0.92, INF)
    L2.land, L2.land_s = 30.0, 0.30
    R2.t0 = 1.04
    R2.land, R2.land_s = 30.0, 0.30
    c.plants('L', [L, L2])
    c.plants('R', [R, R2])
    key_pose(c, 0.0, READY)
    key_pose(c, 0.17, READY, hipsOff=(-0.04, -0.20, 0.0), hipsRot=(14.0, 0.0, 8.0), spine=(10.0, 0.0, 4.0),
             chest=(4.0, 0.0, 2.0), neck=(-16.0, 0.0, -6.0), head=(-12.0, 0.0, -4.0))
    key_pose(c, 0.37, READY, hipsOff=(-0.07, -0.12, 0.0), hipsRot=(7.0, 0.0, 36.0), spine=(4.0, 0.0, 6.0),
             chest=(2.0, 0.0, 4.0), neck=(-12.0, 0.0, -14.0), head=(-8.0, 0.0, -10.0))
    key_pose(c, T_REACH, READY, hipsOff=(-0.06, -0.38, 0.0), hipsRot=(4.0, 0.0, 66.0), spine=(2.0, 0.0, 6.0),
             chest=(0.0, 0.0, 4.0), neck=(-12.0, 0.0, -12.0), head=(-8.0, 0.0, -8.0))
    key_pose(c, T_LAND, READY, hipsOff=(-0.05, -0.72, 0.0), hipsRot=(2.0, 0.0, 84.0), spine=(4.0, 0.0, -6.0),
             chest=(0.0, 0.0, -4.0), neck=(-14.0, 0.0, -2.0), head=(-6.0, 0.0, -4.0))
    # The scramble: roll up off the right forearm, feet under, rise.
    key_pose(c, 0.74, READY, hipsOff=(-0.05, -0.62, 0.0), hipsRot=(16.0, 0.0, 60.0), spine=(16.0, 0.0, -8.0),
             chest=(8.0, 0.0, -6.0), neck=(-18.0, 0.0, 4.0), head=(-10.0, 0.0, 4.0))
    key_pose(c, 0.88, READY, hipsOff=(-0.04, -0.48, -0.02), hipsRot=(28.0, 0.0, 30.0), spine=(22.0, 0.0, -4.0),
             chest=(10.0, 0.0, -2.0), neck=(-24.0, 0.0, 2.0), head=(-14.0, 0.0, 2.0))
    key_pose(c, 1.02, READY, hipsOff=(-0.02, -0.38, -0.03), hipsRot=(28.0, 0.0, 8.0), spine=(20.0, 0.0, 0.0),
             chest=(9.0, 0.0, 0.0), neck=(-24.0, 0.0, 0.0), head=(-16.0, 0.0, 0.0))
    key_pose(c, T_UP, READY, hipsOff=(0.0, -0.20, -0.03), hipsRot=(18.0, 0.0, 0.0), spine=(13.0, 0.0, 0.0))
    key_pose(c, 1.5, READY)
    lift_and_land(c, 'L', L, L2, [
        (0.27, (0.15, -0.70, 0.55), 0.55, (0.2, 0.3, 1.0), (16.0, 0.0, 0.0)),
        (0.37, (0.25, -0.85, 0.30), 0.66, (0.1, 0.3, 1.0), (24.0, 0.0, 0.0)),
        (T_REACH, (0.30, -0.95, 0.0), 0.78, (0.0, 0.3, 1.0), (30.0, 0.0, 0.0)),
        (T_LAND, (0.20, -0.98, 0.05), 0.78, (0.0, 0.2, 1.0), (30.0, 0.0, 0.0)),
        (0.72, (0.20, -0.75, 0.62), 0.56, (0.0, 0.3, 1.0), (16.0, 0.0, 0.0)),
    ], approach=[(0.84, (0.24, 0.17, 0.18), None, (-10.0, 0.0, 0.0))])
    lift_and_land(c, 'R', R, R2, [
        (0.355, (-0.44, -0.87, 0.12), 0.52, (-0.07, 0.33, 0.94), (4.0, 0.0, 0.0)),
        (0.40, (-0.20, -0.92, -0.20), 0.50, (-0.03, 0.2, 1.0), (24.0, 0.0, 0.0)),
        (0.48, (0.10, -0.98, -0.12), 0.70, (0.0, 0.0, 1.0), (30.0, 0.0, 0.0)),
        (T_LAND, (0.14, -0.99, 0.0), 0.78, (0.0, 0.0, 1.0), (26.0, 0.0, 0.0)),
    ], approach=[(0.70, (0.56, 0.14, 0.20), (0.0, 0.3, 1.0), (16.0, 0.0, 0.0)),
                 (0.80, (0.20, 0.15, 0.16), (0.0, 0.3, 1.0), (-8.0, 0.0, 0.0)),
                 (0.90, (-0.08, 0.22, -0.02), None, (-22.0, 0.0, 0.0)),
                 (0.98, (-0.20, 0.15, 0.02), None, (-24.0, 0.0, 0.0))])
    a0 = {s: solved_arm(READY, s, {'L': [L], 'R': [R]}) for s in 'LR'}
    # Arms: the dive's reach, then the right forearm takes the landing and pushes off the ground while the left hand
    # brings the ball in; both hands come together in front, ball up at hand height by the time he is up.
    c.arm('R', [
        (0.0,) + a0['R'],
        (0.18, (-0.56, -0.30, 0.77), 10.0, -40.0, (-10.0, 0.0, 0.0)),
        (0.34, (-0.36, 0.40, 0.84), 0.0, -18.0, (0.0, 0.0, 0.0)),
        (T_REACH, (-0.16, 0.80, 0.58), 0.0, -8.0, (10.0, 0.0, 0.0)),
        (T_LAND, (-0.24, 0.66, 0.71), 0.0, -24.0, (6.0, 0.0, 0.0)),
        (0.76, (-0.30, 0.0, 0.95), 0.0, -70.0, (-30.0, 0.0, 0.0)),
        (0.92, (-0.36, -0.55, 0.75), 0.0, -40.0, (-30.0, 0.0, 0.0)),
        (1.10, (-0.20, -0.75, 0.63), 10.0, -60.0, (-14.0, 0.0, 0.0)),
        (1.5,) + a0['R'],
    ])
    c.arm('L', [
        (0.0,) + a0['L'],
        (0.18, (0.10, -0.40, 0.91), 0.0, -50.0, (-10.0, 0.0, 0.0)),
        (0.34, (0.04, 0.40, 0.92), 0.0, -18.0, (0.0, 0.0, 0.0)),
        (T_REACH, (0.14, 0.78, 0.61), 0.0, -8.0, (10.0, 0.0, 0.0)),
        (T_LAND, (0.20, 0.64, 0.74), 0.0, -24.0, (6.0, 0.0, 0.0)),
        (0.78, (0.24, 0.06, 0.97), 6.0, -104.0, (-6.0, 0.0, 0.0)),
        (1.00, (0.24, -0.50, 0.83), 8.0, -100.0, (-10.0, 0.0, 0.0)),
        (1.5,) + a0['L'],
    ])
    c.contact('body', T_LAND, 0.80)
    c.contact('handR', T_LAND, 0.92)
    c.provenance_note = 'keyframed fast dive and scramble to the ready stance, as one clip (split for shipping)'
    return c


def dive_fast_pair():
    full = dive_scramble_full()
    T_REACH, T_LAND, T_UP = full.markers['reach'], full.markers['land'], full.markers['up']
    dive = Segment(full, 'fld_dive_fast_r', 0.0, FAST_SPLIT, markers={'reach': T_REACH, 'land': T_LAND},
                   aliases={'fld_dive_fast_l': 'mirror'},
                   note='fast dive to the right (the first half of the dive-and-scramble); hand over to '
                        'fld_dive_scramble_r at its last frame; in place, hips |x| <= 0.08 m, z = 0')
    scr = Segment(full, 'fld_dive_scramble_r', FAST_SPLIT, full.duration, markers={'up': round(T_UP - FAST_SPLIT, 6)},
                  aliases={'fld_dive_scramble_l': 'mirror'},
                  note=f'scramble up from the fast dive (its frame 0 is fld_dive_fast_r\'s last); on his feet at `up`, '
                       f'{RECOVER_S} s after the dive\'s `reach` (physics DIVE.recoverS); ends in the ready stance')
    return [dive, scr]


def catch_high():
    """A catch above the eyes: up from the ready stance onto the toes, head back, both hands up in front of the
    face with the fingers up and the thumbs together (`catch`), then the hands give with the ball down to the chest
    as the knees soften. FK arms (no elbow-pole flips)."""
    T_CATCH = 0.40
    c = ActionClip('fld_catch_high', PACK, 'fielder', 1.0, rate=30, codec=1, mirrorable=True,
                   markers={'catch': T_CATCH})
    L, R = ready_plants()
    c.plants('L', [L])
    c.plants('R', [R])
    key_pose(c, 0.0, READY)
    key_pose(c, 0.20, READY, hipsOff=(0.0, -0.07, -0.01), hipsRot=(8.0, 0.0, 0.0), spine=(4.0, 0.0, 0.0),
             chest=(-2.0, 0.0, 0.0), neck=(-24.0, 0.0, 0.0), head=(-12.0, 0.0, 0.0))
    key_pose(c, T_CATCH, READY, hipsOff=(0.0, -0.05, -0.01), hipsRot=(5.0, 0.0, 0.0), spine=(0.0, 0.0, 0.0),
             chest=(-5.0, 0.0, 0.0), neck=(-30.0, 0.0, 0.0), head=(-16.0, 0.0, 0.0))
    key_pose(c, 0.62, READY, hipsOff=(0.0, -0.13, -0.02), hipsRot=(10.0, 0.0, 0.0), spine=(6.0, 0.0, 0.0),
             chest=(2.0, 0.0, 0.0), neck=(-16.0, 0.0, 0.0), head=(-8.0, 0.0, 0.0))
    key_pose(c, 1.0, READY, hipsOff=(0.0, -0.09, -0.02), hipsRot=(8.0, 0.0, 0.0), spine=(6.0, 0.0, 0.0),
             chest=(2.0, 0.0, 0.0), neck=(-8.0, 0.0, 0.0), head=(-4.0, 0.0, 0.0))
    a0 = {s: solved_arm(READY, s, {'L': [L], 'R': [R]}) for s in 'LR'}

    def arm(side, d, tw, el, hand):
        k = 1.0 if side == 'L' else -1.0
        return ((k * d[0], d[1], d[2]), k * tw, el, (hand[0], k * hand[1], k * hand[2]))

    # Written for the left arm; the right is its mirror.
    keys = [
        (0.20, (0.22, 0.50, 0.84), -36.0, -80.0, (-12.0, 0.0, 0.0)),
        (T_CATCH, (0.17, 0.56, 0.81), -58.0, -46.0, (-28.0, 0.0, 0.0)),
        (0.62, (0.22, 0.30, 0.93), -40.0, -96.0, (-16.0, 0.0, 0.0)),
        (1.0, (0.22, -0.30, 0.93), -14.0, -116.0, (-8.0, 0.0, 0.0)),
    ]
    for side in 'LR':
        c.arm(side, [(0.0,) + a0[side]] + [(t,) + arm(side, *k) for (t, *k) in keys])
    c.provenance_note = 'keyframed high catch; FK arms'
    return c


def catch_low():
    """A low catch in front: knees bend, the hands meet low with the fingers down (`catch`), then the ball comes up
    to the chest as he rises."""
    c = Clip('fld_catch_low', PACK, 'fielder', 1.0, rate=30, codec=1, mirrorable=True, markers={'catch': 0.36})
    L, R = ready_plants()
    c.plants('L', [L])
    c.plants('R', [R])
    key_pose(c, 0.0, ready_pose())
    key_pose(c, 0.2, ready_pose(hipsOff=(0.0, -0.24, 0.0), hipsRot=(24.0, 0.0, 0.0), spine=(18.0, 0.0, 0.0),
                                chest=(8.0, 0.0, 0.0), neck=(-26.0, 0.0, 0.0), head=(-14.0, 0.0, 0.0),
                                handIKL=(0.06, 0.45, 0.50), handIKR=(-0.06, 0.45, 0.50)))
    key_pose(c, 0.36, ready_pose(hipsOff=(0.0, -0.32, 0.0), hipsRot=(28.0, 0.0, 0.0), spine=(22.0, 0.0, 0.0),
                                 chest=(10.0, 0.0, 0.0), neck=(-30.0, 0.0, 0.0), head=(-14.0, 0.0, 0.0),
                                 handIKL=(0.04, 0.30, 0.52), handIKR=(-0.04, 0.30, 0.52), handL=(-35.0, 0.0, 0.0),
                                 handR=(-35.0, 0.0, 0.0)))
    key_pose(c, 0.6, ready_pose(hipsOff=(0.0, -0.22, 0.0), hipsRot=(20.0, 0.0, 0.0), spine=(14.0, 0.0, 0.0),
                                handIKL=(0.04, 0.72, 0.36), handIKR=(-0.04, 0.72, 0.36)))
    key_pose(c, 1.0, stand_pose(hipsOff=(0.0, -0.08, 0.0), hipsRot=(6.0, 0.0, 0.0), spine=(6.0, 0.0, 0.0),
                                handIKL=(0.04, 1.20, 0.20), handIKR=(-0.04, 1.20, 0.20), armIKL=1.0, armIKR=1.0))
    c.provenance_note = 'keyframed low catch'
    return c


CATCH_END = stand_pose(hipsOff=(0.0, -0.08, 0.0), hipsRot=(6.0, 0.0, 0.0), spine=(6.0, 0.0, 0.0),
                       handIKL=(0.04, 1.20, 0.20), handIKR=(-0.04, 1.20, 0.20), armIKL=1.0, armIKR=1.0)


def celebrate():
    """A short, contained celebration after a catch (it starts on fld_catch_low's last pose, ball at the chest): the
    ball hand drops to the hip, one fist pump to head height (`peak`) with a small rise, then the arms settle by the
    sides. Nothing aimed at the batter; played only after the physics catch."""
    c = ActionClip('fld_celebrate', PACK, 'fielder', 1.2, rate=30, codec=1, mirrorable=True, markers={'peak': 0.46})
    L, R = ready_plants()  # the feet where fld_catch_low leaves them
    c.plants('L', [L])
    c.plants('R', [R])
    key_pose(c, 0.0, CATCH_END)
    key_pose(c, 0.24, CATCH_END, hipsOff=(0.0, -0.09, 0.0), spine=(8.0, 4.0, 0.0), neck=(-6.0, -2.0, 0.0))
    key_pose(c, 0.46, CATCH_END, hipsOff=(0.0, -0.04, 0.0), hipsRot=(3.0, 0.0, 0.0), spine=(0.0, -6.0, 0.0),
             chest=(-2.0, -4.0, 0.0), neck=(-6.0, 4.0, 0.0), head=(-2.0, 2.0, 0.0))
    key_pose(c, 0.80, CATCH_END, hipsOff=(0.0, -0.04, 0.0), hipsRot=(3.0, 0.0, 0.0), spine=(3.0, 0.0, 0.0),
             chest=(1.0, 0.0, 0.0), neck=(-3.0, 0.0, 0.0))
    key_pose(c, 1.2, stand_pose(hipsOff=(0.0, -0.03, 0.0)))
    a0 = {s: solved_arm(CATCH_END, s, {'L': [L], 'R': [R]}) for s in 'LR'}
    end = {'R': euler_arm((2.0, 0.0, -8.0), (-15.0, 0.0, 0.0), (-8.0, 0.0, 0.0)),
           'L': euler_arm((2.0, 0.0, 8.0), (-15.0, 0.0, 0.0), (-8.0, 0.0, 0.0))}
    c.arm('R', [
        (0.0,) + a0['R'],
        (0.24, (-0.30, -0.90, 0.30), 10.0, -104.0, (-6.0, 0.0, 0.0)),
        (0.46, (-0.62, 0.10, 0.78), -40.0, -120.0, (-10.0, 0.0, 0.0)),
        (0.80, (-0.30, -0.86, 0.40), 0.0, -60.0, (-8.0, 0.0, 0.0)),
        (1.2,) + end['R'],
    ])
    c.arm('L', [
        (0.0,) + a0['L'],
        (0.30, (0.20, -0.92, 0.34), -10.0, -60.0, (-8.0, 0.0, 0.0)),
        (0.80, (0.16, -0.97, 0.20), -4.0, -30.0, (-8.0, 0.0, 0.0)),
        (1.2,) + end['L'],
    ])
    c.provenance_note = 'keyframed short contained celebration (one fist pump); FK arms'
    return c


def clips():
    # Every clip here passes the MOTION-SPEC §9 gates on its decoded bytes (scripts/motion/motion.test.mjs).
    return [throw_over(), flick_under(), dive_r(), getup_r(), *dive_fast_pair(), catch_high(), catch_low(), celebrate()]
