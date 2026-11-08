"""
Shared fielder helpers (MOTION owns; read-only for other authors). Fielder pack (MOTION-SPEC §11): original keyframes on VC17, owner-made. A right-handed fielder; left-handers and the
opposite side play through the canonical mirror (aliases). The fielder starts facing +Z (towards the striker).

Physics owns every fielder's position: hips offsets stay small (dives keep |x|, |z| <= 0.08 m; a throw's stride leans
the hips at most 0.25 m forward), and travel is only in the ground track of the locomotion-style clips, which a
physics-driven consumer ignores (MOTION-SPEC §6).
"""
import math

from gait import Path, Stepper, gait_controls, linear_path, profile_path
from vc17 import Clip, Plant, clamp, lerp, smooth

PACK = 'fielder'
INF = math.inf

# ---- The ready stance: wide, on the balls of the feet, knees and hips flexed, hands in front, eyes on the bat.
READY_W = 0.21
READY = {
    'hipsOff': (0.0, -0.12, -0.03), 'hipsRot': (16.0, 0.0, 0.0), 'spine': (12.0, 0.0, 0.0), 'chest': (6.0, 0.0, 0.0),
    'neck': (-19.0, 0.0, 0.0), 'head': (-14.0, 0.0, 0.0),
    'upperArmL': (-30.0, 0.0, 12.0), 'forearmL': (-45.0, 0.0, 0.0), 'handL': (-15.0, 0.0, 0.0),
    'upperArmR': (-30.0, 0.0, -12.0), 'forearmR': (-45.0, 0.0, 0.0), 'handR': (-15.0, 0.0, 0.0),
    'handIKL': (0.17, 0.80, 0.40), 'handIKR': (-0.17, 0.80, 0.40),
    'elbowPoleL': (0.7, -0.3, -0.6), 'elbowPoleR': (-0.7, -0.3, -0.6), 'armIKL': 1.0, 'armIKR': 1.0,
}


def ready_plants(t0=-INF, t1=INF, cx=0.0, cz=0.0, w=READY_W, low=14.0, peel_s=0.08, off=30.0):
    return (Plant('L', t0, t1, (cx + w, cz + 0.12), 12.0, low=low, land=low, off=off, peel_s=peel_s),
            Plant('R', t0, t1, (cx - w, cz + 0.12), -12.0, low=low, land=low, off=off, peel_s=peel_s))


def blend(a, b, w):
    """Blend two channel dicts (tuples or scalars) by w (0 = a, 1 = b); keys missing on one side are kept."""
    out = dict(a)
    for k, vb in b.items():
        va = a.get(k)
        if va is None:
            out[k] = vb * w if k.startswith('armIK') else vb
            continue
        if isinstance(vb, tuple):
            out[k] = tuple(lerp(x, y, w) for x, y in zip(va, vb))
        else:
            out[k] = lerp(va, vb, w)
    return out


def key_pose(clip, t, pose, **over):
    d = dict(pose)
    d.update(over)
    clip.key(t, **d)


class SpeedPath(Path):
    """Acceleration as the rate of change of speed (for paths that do not move along the heading)."""

    def accel(self, t):
        d = self.dt * 4
        return (self.speed(t + d) - self.speed(t - d)) / (2 * d)


# ---------------------------------------------------------------------------------------------------------------
# Ready, walk-in and set
# ---------------------------------------------------------------------------------------------------------------

# ---------------------------------------------------------------------------------------------------------------
# Shared poses for actions. Keyed control rig: hips, trunk, arm IK targets (actor frame) and foot plants.
# ---------------------------------------------------------------------------------------------------------------

POLE_L = (0.7, -0.1, -0.7)
POLE_R = (-0.7, -0.1, -0.7)


def stand_pose(**over):
    d = {'hipsOff': (0.0, -0.02, 0.0), 'hipsRot': (2.0, 0.0, 0.0), 'spine': (3.0, 0.0, 0.0), 'chest': (1.0, 0.0, 0.0),
         'neck': (-3.0, 0.0, 0.0), 'head': (0.0, 0.0, 0.0), 'handL': (-8.0, 0.0, 0.0), 'handR': (-8.0, 0.0, 0.0),
         'upperArmL': (2.0, 0.0, 8.0), 'forearmL': (-15.0, 0.0, 0.0), 'upperArmR': (2.0, 0.0, -8.0),
         'forearmR': (-15.0, 0.0, 0.0), 'elbowPoleL': POLE_L, 'elbowPoleR': POLE_R, 'armIKL': 0.0, 'armIKR': 0.0,
         'handIKL': (0.2, 0.9, 0.1), 'handIKR': (-0.2, 0.9, 0.1)}
    d.update(over)
    return d


def ready_pose(**over):
    d = dict(READY)
    d.update(over)
    return d


def throw_ready(yaw=-80.0, **over):
    """DEPRECATED (kept for old drafts; behaviour unchanged): with its default ground-space poles the right upper
    arm solves to a twist of about -121 degrees, beyond the 110-degree gate. Start throws from gather() instead.
    Side-on, left shoulder to the target (+Z), ball hand back by the right ear, front arm at the target."""
    d = stand_pose(hipsOff=(0.0, -0.08, 0.0), hipsRot=(4.0, yaw, 0.0), spine=(6.0, 6.0, 0.0), chest=(2.0, 6.0, 0.0),
                   neck=(-4.0, -yaw * 0.55, 0.0), head=(-2.0, -yaw * 0.35, 0.0),
                   handIKR=(-0.10, 1.55, -0.32), handIKL=(0.05, 1.32, 0.40), armIKL=1.0, armIKR=1.0,
                   elbowPoleR=(0.0, -0.8, -0.5), elbowPoleL=(0.2, -0.8, -0.2), handR=(-30.0, 0.0, 0.0))
    d.update(over)
    return d




def gather(yaw=-70.0, **over):
    """Side-on with the ball held in both hands in front of the chest: where a pickup ends and a throw begins (the
    throw takes the ball back itself). Elbow poles are meant for Clip.arm_pole_space = 'chest'."""
    d = stand_pose(hipsOff=(0.0, -0.10, 0.02), hipsRot=(8.0, yaw, 0.0), spine=(8.0, 6.0, 0.0), chest=(3.0, 6.0, 0.0),
                   neck=(-8.0, -yaw * 0.55, 0.0), head=(-4.0, -yaw * 0.35, 0.0),
                   handIKL=(-0.20, 1.12, 0.22), handIKR=(-0.26, 1.10, 0.14), armIKL=1.0, armIKR=1.0,
                   elbowPoleL=(0.55, -0.75, -0.35), elbowPoleR=(-0.55, -0.75, -0.35))
    d.update(over)
    return d
