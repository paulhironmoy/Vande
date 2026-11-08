"""
Fielder pack (MOTION-SPEC §11), MOTION's clips: ready, walk-in, set, sprint start, decel stop, pickups, long
barrier, calm return, turn and run. Original keyframes on VC17, owner-made. MOTION-FIELD2's clips (throw, flick,
dives and get-up, catches, celebration) are in fielder_actions.py and bake into the same pack
(`python3 scripts/blender/motion/build.py fielder_actions`).
"""
import math

from gait import Stepper, gait_controls, linear_path, profile_path
from vc17 import Clip, Plant, clamp, smooth
from fielder_common import (INF, PACK, POLE_L, POLE_R, READY, READY_W, SpeedPath, blend, gather, key_pose,
                            ready_plants, ready_pose, stand_pose, throw_ready)


def ready():
    d = 1.6
    c = Clip('fld_ready', PACK, 'fielder', d, rate=20, loop=True, codec=1, mirrorable=True)
    L, R = ready_plants()
    c.plants('L', [L])
    c.plants('R', [R])
    for t, bx, by, look in ((0.0, 0.0, 0.0, 0.0), (0.4, 0.008, -0.010, 2.0), (0.8, 0.0, 0.0, 0.0),
                            (1.2, -0.008, -0.010, -2.0), (1.6, 0.0, 0.0, 0.0)):
        key_pose(c, t, READY, hipsOff=(bx, -0.12 + by, -0.03), hipsRot=(16.0, 0.0, -bx * 150.0),
                 neck=(-19.0, look, 0.0), chest=(6.0 + 2.0 * by / -0.01 * 0.5, 0.0, bx * 60.0))
    c.provenance_note = 'keyframed ready stance on the balls of the feet, 1.6 s loop with a small bounce'
    return c


def walk_in():
    """Walking in with the bowler: an attentive walk, slightly crouched, arms quiet, eyes on the striker."""
    frames, rate, v = 34, 30, 1.3
    period = frames / rate
    c = Clip('fld_walk_in', PACK, 'fielder', period, rate=rate, loop=True, codec=1, mirrorable=True, speed=v,
             cycle_steps=2, phase0=True)

    def style(p, t):
        q = dict(p)
        q['spm'] = 120.0 / period
        q['armA'] = 9.0
        q['elbow0'] = 30.0
        q['lean'] = 6.0
        q['tilt'] = 6.0
        q['drop'] = -0.03
        q['thorax'] = 2.0
        return q

    st = Stepper(linear_path(v), -2.0, period + 2.0, cyclic=True, style=style)
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    c.fn = gait_controls(st)
    c.provenance_note = f'gait generator at {v} m/s, attentive style'
    return c


def set_clip():
    """From the walk-in (entered at its left strike) to the ready stance: two slowing steps, a small split-step hop
    that lands wide on the balls of the feet (marker `set`), then the ready crouch."""
    v0 = 1.3
    period = 34 / 30

    def v(t):
        return v0 * (1.0 - smooth(t / 1.1))

    path = profile_path(v, 3.0)
    st = Stepper(path, 0.0, 3.0, first='R', t_go=0.0, enter_moving=True)
    walk = Stepper(linear_path(v0), -2.0, 0.0, cyclic=True, style=lambda p, t: dict(p, spm=120.0 / period, drop=-0.03))
    left = [p for p in walk.plants['L'] if -1.0 < p.t0 <= 1e-9] + [p for p in st.plants['L'] if p.t0 > 1e-9]
    right = [p for p in walk.plants['R'] if -1.0 < p.t0 < 0.0] + [p for p in st.plants['R'] if not math.isinf(p.t0)]
    end = st.end_t
    gx, gz = path.pos(5.0)
    # The set: the last slowing step lands straight onto the ball of the foot, wide; the other foot then steps out
    # to match, the hips sinking throughout into the ready crouch (no flight).
    closing = 'L' if left[-1].t0 >= end - 1e-6 else 'R'
    other = 'R' if closing == 'L' else 'L'
    lists = {'L': left, 'R': right}
    L, R = ready_plants(end, INF, cx=gx, cz=gz - 0.08)
    ready_p = {'L': L, 'R': R}
    cp = ready_p[closing]
    old = lists[closing].pop()
    cp.t0 = end
    cp.swing_keys = [(0.5, 'arc', 0.0, 0.07)]
    cp.land = 8.0
    cp.land_s = 0.08
    lists[closing].append(cp)
    t_lift = end + 0.1
    t_land = end + 0.36
    last = lists[other][-1]
    last.t1 = t_lift
    last.peel_s = min(0.12, max(0.02, 0.9 * (t_lift - last.t0) - last.land_s))
    last.off = 16.0
    op = ready_p[other]
    op.t0 = t_land
    op.swing_keys = [(0.5, 'arc', 0.0, 0.05)]
    op.land = 8.0
    op.land_s = 0.08
    lists[other].append(op)
    t_hop = end
    dur = round((t_land + 0.45) * 60) / 60
    c = Clip('fld_set', PACK, 'fielder', dur, rate=60, loop=False, codec=1, mirrorable=True,
             markers={'set': t_land})
    c.plants('L', left)
    c.plants('R', right)
    base = gait_controls(st)

    def fn(t):
        out = base(t)
        w = smooth((t - (t_hop - 0.25)) / 0.45)
        r = dict(READY)
        r['hipsOff'] = (0.0, READY['hipsOff'][1] * smooth((t - t_hop + 0.15) / 0.55), READY['hipsOff'][2])
        out = blend(out, r, w)
        out['armIKL'] = w
        out['armIKR'] = w
        return out

    c.fn = fn
    c.provenance_note = 'gait generator into keyed split-step and ready stance'
    return c


# ---------------------------------------------------------------------------------------------------------------
# Sprint start, decel stop, turn and run
# ---------------------------------------------------------------------------------------------------------------

def sprint_start():
    """From the ready stance: an explosive first step (the right foot), deep lean, quick strides; ends on a left
    strike at about 5 m/s for the run loop to take over by speed."""
    t_go = 0.06
    vmax, tau = 7.0, 1.0

    def v(t):
        x = t - t_go
        return 0.0 if x <= 0 else vmax * (1.0 - math.exp(-x / tau)) * smooth(x / 0.12 + 0.5)

    path = profile_path(v, 3.0)
    st = Stepper(path, 0.0, 3.0, first='R', t_go=t_go, stand_w=READY_W)
    for side in ('L', 'R'):
        p0 = st.plants[side][0]
        rp = ready_plants()[0 if side == 'L' else 1]
        p0.ball, p0.yaw, p0.low = rp.ball, rp.yaw, rp.low
    end = next(ts for ts, sd in st.strikes if sd == 'L' and ts > 1.05)
    end = round(end * 60) / 60
    c = Clip('fld_sprint_start', PACK, 'fielder', end, rate=60, loop=False, codec=1, mirrorable=True,
             markers={'go': t_go, 'exitLeftStrike': end})
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    base = gait_controls(st)

    def fn(t):
        out = base(t)
        w = 1.0 - smooth((t - t_go) / 0.45)
        r = dict(READY)
        out = blend(out, r, w)
        out['armIKL'] = w
        out['armIKR'] = w
        return out

    c.fn = fn
    c.speed = path.pos(end)[1] / end
    c.provenance_note = f'gait generator from the ready stance, v(t) = {vmax}(1 - exp(-(t - {t_go})/{tau}))'
    return c


def decel_stop():
    """From the run loop (left strike, 5.6 m/s) to a balanced stop: braking strides with the feet ahead, hips
    sitting down, planted feet; ends in an athletic half-crouch facing forward (marker `plant`: the last braking
    foot strike)."""
    v0 = 5.6
    period = 41 / 60
    d_b = 1.35

    def v(t):
        return v0 * (1.0 - smooth(t / d_b))

    path = profile_path(v, 3.0)
    st = Stepper(path, 0.0, 3.0, first='R', t_go=0.0, enter_moving=True, stand_w=0.17)
    run = Stepper(linear_path(v0), -2.0, 0.0, cyclic=True, style=lambda p, t: dict(p, spm=120.0 / period))
    left = [p for p in run.plants['L'] if -1.0 < p.t0 <= 1e-9] + [p for p in st.plants['L'] if p.t0 > 1e-9]
    right = [p for p in run.plants['R'] if -1.0 < p.t0 < 0.0] + [p for p in st.plants['R'] if not math.isinf(p.t0)]
    dur = round((st.end_t + 0.55) * 60) / 60
    plant_t = max(ts for ts, sd in st.strikes if ts < st.end_t)
    c = Clip('fld_decel_stop', PACK, 'fielder', dur, rate=60, loop=False, codec=1, mirrorable=True,
             markers={'plant': plant_t, 'still': dur})
    c.plants('L', left)
    c.plants('R', right)
    base = gait_controls(st)
    half = blend(READY, {'hipsOff': (0.0, -0.10, 0.0), 'hipsRot': (12.0, 0.0, 0.0), 'spine': (10.0, 0.0, 0.0)}, 1.0)

    def fn(t):
        out = base(t)
        w = smooth((t - (st.end_t - 0.2)) / 0.45)
        out = blend(out, half, w)
        out['armIKL'] = w
        out['armIKR'] = w
        return out

    c.fn = fn
    c.speed = path.pos(dur)[1] / dur
    c.provenance_note = f'gait generator, braking from {v0} m/s over {d_b} s into a half-crouch'
    return c


def turn_run():
    """The ball is over his head: from the ready stance he drop-steps back with the right foot while the left foot
    turns on its front, the hips come round 180 degrees to his right, then he drives away (towards -Z) with a
    left-foot crossover. Ends on a left strike at about 4.5 m/s; marker `go`."""
    t_go = 0.04
    t_run = 0.40
    vmax, tau = 6.8, 0.9

    def v(t):
        x = t - t_run
        return 0.0 if x <= 0 else vmax * (1.0 - math.exp(-x / tau)) * smooth(x / 0.12 + 0.5)

    base_path = profile_path(v, 3.0)

    def pos(t):
        p = base_path.pos(t)
        return (0.0, -p[1])

    def heading(t):
        return -180.0 * smooth((t - t_go) / 0.42)

    path = SpeedPath(pos, heading, 3.0)
    st = Stepper(path, 0.0, 3.0, first='L', t_go=t_run, stand_w=0.16,
                 moving=lambda t: t >= t_run and path.speed(t) > 0.25)
    # The turn: the right foot drops back and round; the left foot pivots on its front.
    rp0, lp0 = st.plants['R'][0], st.plants['L'][0]
    r_land_lift = rp0.t1
    readyL, readyR = ready_plants()
    lp0.ball, lp0.yaw, lp0.low, lp0.land = readyL.ball, readyL.yaw, 10.0, 10.0
    lp0.pivot = (t_go + 0.06, t_run - 0.02, -150.0)
    rp_a = Plant('R', -INF, t_go + 0.03, readyR.ball, readyR.yaw, low=12.0, off=24.0, peel_s=0.03)
    rp_b = Plant('R', t_go + 0.26, r_land_lift, (-0.06, -0.36), -165.0, land=8.0, low=8.0, land_s=0.06,
                 off=rp0.off, peel_s=rp0.peel_s, swing_keys=[(0.5, 'arc', 0.0, 0.10)])
    st.plants['R'] = [rp_a, rp_b] + st.plants['R'][1:]
    end = next(ts for ts, sd in st.strikes if sd == 'L' and ts > 1.1)
    end = round(end * 60) / 60
    c = Clip('fld_turn_run_r', PACK, 'fielder', end, rate=60, loop=False, codec=1, mirrorable=True,
             markers={'go': t_go, 'exitLeftStrike': end}, aliases={'fld_turn_run_l': 'mirror'})
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    base = gait_controls(st)

    def fn(t):
        out = base(t)
        w = 1.0 - smooth((t - t_go) / 0.5)
        out = blend(out, READY, w)
        out['armIKL'] = w
        out['armIKR'] = w
        # Look back over the right shoulder for the ball while turning, then ahead.
        look = 30.0 * math.sin(math.pi * clamp((t - t_go) / 0.8, 0.0, 1.0))
        nx, ny, nz = out['neck']
        out['neck'] = (nx, ny + look * 0.6, nz)
        hx, hy, hz = out['head']
        out['head'] = (hx, hy + look * 0.4, hz)
        return out

    c.fn = fn
    c.speed = math.hypot(*path.pos(end)) / end
    c.provenance_note = 'keyed drop-step turn into the gait generator (accelerating away)'
    return c


def pickup_2h():
    """Two hands to a ball coming straight at him: the left foot to the ball, a deep bend with fingers down
    (`collect`), then up and side-on into the gather, the ball at the chest (where a throw begins)."""
    c = Clip('fld_pickup_2h', PACK, 'fielder', 1.0, rate=60, codec=1, mirrorable=True, markers={'collect': 0.38})
    c.arm_pole_space = 'chest'
    L, R = ready_plants(-INF, 0.06)
    L.peel_s = 0.05
    R.low = 24.0
    L2 = Plant('L', 0.26, INF, (0.12, 0.44), 4.0, land=-6.0, land_s=0.08, swing_keys=[(0.5, 'arc', 0.0, 0.06)])
    L2.pivot = (0.52, 0.82, -36.0)
    R2 = Plant('R', 0.78, INF, (-0.12, 0.04), -52.0, land=3.0, land_s=0.1, swing_keys=[(0.5, 'arc', 0.0, 0.06)])
    R.t1 = 0.5
    R.peel_s = 0.12
    c.plants('L', [L, L2])
    c.plants('R', [R, R2])
    pl = (0.55, -0.75, -0.35)
    pr = (-0.55, -0.75, -0.35)
    poles = dict(elbowPoleL=pl, elbowPoleR=pr)
    key_pose(c, 0.0, ready_pose(**poles))
    key_pose(c, 0.2, ready_pose(hipsOff=(0.0, -0.26, 0.06), hipsRot=(26.0, 0.0, 0.0), spine=(22.0, 0.0, 0.0),
                                chest=(10.0, 0.0, 0.0), handIKL=(0.08, 0.40, 0.55), handIKR=(-0.08, 0.40, 0.55),
                                neck=(-26.0, 0.0, 0.0), head=(-18.0, 0.0, 0.0), **poles))
    key_pose(c, 0.38, ready_pose(hipsOff=(0.0, -0.38, 0.10), hipsRot=(34.0, 0.0, 0.0), spine=(32.0, 0.0, 0.0),
                                 chest=(14.0, 0.0, 0.0), neck=(-34.0, 0.0, 0.0), head=(-22.0, 0.0, 0.0),
                                 handIKL=(0.04, 0.17, 0.56), handIKR=(-0.05, 0.17, 0.56), handL=(-30.0, 0.0, 0.0),
                                 handR=(-30.0, 0.0, 0.0), **poles))
    key_pose(c, 0.52, ready_pose(hipsOff=(0.0, -0.33, 0.08), hipsRot=(30.0, -10.0, 0.0), spine=(26.0, 0.0, 0.0),
                                 chest=(12.0, 0.0, 0.0), neck=(-30.0, 5.0, 0.0), head=(-20.0, 3.0, 0.0),
                                 handIKL=(0.0, 0.30, 0.52), handIKR=(-0.08, 0.30, 0.52), **poles))
    key_pose(c, 0.66, stand_pose(hipsOff=(0.0, -0.24, 0.06), hipsRot=(22.0, -28.0, 0.0), spine=(20.0, 3.0, 0.0),
                                 chest=(9.0, 3.0, 0.0), neck=(-20.0, 16.0, 0.0), head=(-12.0, 10.0, 0.0),
                                 handIKL=(-0.04, 0.70, 0.50), handIKR=(-0.14, 0.68, 0.46), armIKL=1.0, armIKR=1.0,
                                 **poles))
    key_pose(c, 0.79, stand_pose(hipsOff=(0.0, -0.16, 0.04), hipsRot=(14.0, -48.0, 0.0), spine=(14.0, 4.0, 0.0),
                                 chest=(6.0, 4.0, 0.0), neck=(-12.0, 26.0, 0.0), head=(-6.0, 16.0, 0.0),
                                 handIKL=(-0.14, 1.0, 0.36), handIKR=(-0.22, 0.98, 0.30), armIKL=1.0, armIKR=1.0,
                                 **poles))
    key_pose(c, 0.92, gather(-70.0))
    key_pose(c, 1.0, gather(-72.0))
    c.contact('handL', 0.36, 0.44)
    c.contact('handR', 0.36, 0.44)
    c.provenance_note = 'keyframed two-handed pickup into a side-on throwing position'
    return c


def pickup_1h():
    """The one-handed pickup on the run (about 3.5 m/s): two strides in, a dip over the right foot as it plants, the
    right hand takes the ball just outside and ahead of that foot (`collect`), then up and running on. Starts and
    ends on a left foot strike so the jog/run loops can hand over by phase."""
    v = 3.5
    probe = Stepper(linear_path(v), -2.0, 3.0, cyclic=True)
    step = probe.strikes[1][0] - probe.strikes[0][0]
    dur = round(6 * step * 60) / 60
    st = Stepper(linear_path(v), -2.0, dur + 2.0, cyclic=True, style=lambda p, t: dict(p, spm=60.0 * 6 / dur))
    step = dur / 6
    t_strike = 3 * step  # the second right foot strike
    t_c = t_strike + 0.05
    c = Clip('fld_pickup_1h', PACK, 'fielder', dur, rate=60, codec=1, mirrorable=True, speed=v,
             markers={'collect': t_c})
    c.arm_pole_space = 'chest'
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    rp = next(p for p in st.plants['R'] if abs(p.t0 - t_strike) < 1e-6)
    lp = next(p for p in st.plants['L'] if abs(p.t0 - 2 * step) < 1e-6)
    # Dipping over the feet: the heels stay up from the strike on (no heel rise under load), so the ankles never
    # over-bend and the shoe never snaps after landing.
    lp.low = lp.land = 30.0
    lp.land_s = 0.06
    lp.swing_mid_pitch = 26.0
    rp.low = rp.land = 42.0
    rp.land_s = 0.06
    rp.swing_mid_pitch = 34.0
    ball = (rp.ball[0] - 0.10, 0.09, rp.ball[1] + 0.30)
    base = gait_controls(st)

    def bell(t, a, b, d):
        return smooth((t - a) / (t_c - a)) if t < t_c else 1.0 - smooth((t - t_c - d) / (b - d)) if t > t_c + d else 1.0

    def fn(t):
        out = base(t)
        w = bell(t, t_c - 0.62, 0.55, 0.03)
        wa = bell(t, t_c - 0.26, 0.24, 0.02)
        hx, hy, hz = out['hipsOff']
        out['hipsOff'] = (hx - 0.05 * w, hy - 0.29 * w, hz - 0.04 * w)
        for k, add_ in (('hipsRot', (34.0, 0.0, -1.0)), ('spine', (48.0, 0.0, -9.0)), ('chest', (20.0, 0.0, -6.0)),
                        ('neck', (-26.0, 0.0, 0.0)), ('head', (-12.0, 0.0, 0.0))):
            a = out[k]
            out[k] = (a[0] + add_[0] * w, a[1] + add_[1] * w, a[2] + add_[2] * w)
        g = out['ground']
        out['handIKR'] = (ball[0] - g[0], ball[1], ball[2] - g[1])
        out['elbowPoleR'] = (-0.55, -0.75, -0.35)
        out['armIKR'] = wa
        out['reach'] = 0.84
        return out

    c.fn = fn
    c.contact('handR', t_c - 0.02, t_c + 0.04)
    c.provenance_note = f'gait generator at {v} m/s with a keyed one-handed pickup over the right foot'
    return c


def long_barrier():
    """The long barrier for a hard-hit ball straight at him: the right foot turns across the line, the left knee goes
    down beside the right heel so the leg makes a barrier, the hands take the ball in front of the left knee
    (`collect`); then he rises, steps the left foot towards the target and ends side-on in the gather."""
    c = Clip('fld_long_barrier', PACK, 'fielder', 1.5, rate=30, codec=1, mirrorable=True, markers={'collect': 0.62})
    c.arm_pole_space = 'chest'
    L, R = ready_plants(-INF, 0.10)
    L.peel_s = 0.08
    R.t1 = INF
    R.pivot = (0.04, 0.40, -34.0)
    L2 = Plant('L', 0.45, 0.96, (0.10, -0.30), -45.0, land=68.0, low=72.0, land_s=0.12, peel_s=0.12, off=70.0,
               swing_keys=[(0.5, 'arc', 0.0, 0.06)])
    L3 = Plant('L', 1.32, INF, (0.12, 0.42), -30.0, land=-4.0, land_s=0.08, swing_keys=[(0.5, 'arc', 0.0, 0.10)])
    c.plants('L', [L, L2, L3])
    c.plants('R', [R])
    pl = (0.55, -0.75, -0.35)
    pr = (-0.55, -0.75, -0.35)
    poles = dict(elbowPoleL=pl, elbowPoleR=pr, kneePoleR=(-0.25, 0.0, 0.97))
    key_pose(c, 0.0, ready_pose(**poles))
    key_pose(c, 0.25, ready_pose(hipsOff=(0.0, -0.24, 0.0), hipsRot=(20.0, -24.0, 0.0), spine=(18.0, 10.0, 0.0),
                                 chest=(8.0, 6.0, 0.0), neck=(-24.0, 6.0, 0.0), head=(-14.0, 4.0, 0.0),
                                 handIKL=(0.10, 0.55, 0.40), handIKR=(-0.10, 0.55, 0.38), **poles))
    key_pose(c, 0.46, ready_pose(hipsOff=(0.0, -0.46, -0.04), hipsRot=(26.0, -26.0, 0.0), spine=(28.0, 10.0, 0.0),
                                 chest=(10.0, 8.0, 0.0), neck=(-28.0, 8.0, 0.0), head=(-16.0, 6.0, 0.0),
                                 handIKL=(0.06, 0.24, 0.36), handIKR=(-0.06, 0.24, 0.34), **poles))
    key_pose(c, 0.62, ready_pose(hipsOff=(0.0, -0.50, -0.04), hipsRot=(30.0, -28.0, 0.0), spine=(34.0, 12.0, 0.0),
                                 chest=(12.0, 8.0, 0.0), neck=(-30.0, 8.0, 0.0), head=(-18.0, 6.0, 0.0),
                                 handIKL=(0.05, 0.15, 0.34), handIKR=(-0.04, 0.15, 0.32), handL=(-30.0, 0.0, 0.0),
                                 handR=(-30.0, 0.0, 0.0), **poles))
    key_pose(c, 0.76, ready_pose(hipsOff=(0.0, -0.48, -0.04), hipsRot=(26.0, -30.0, 0.0), spine=(28.0, 10.0, 0.0),
                                 chest=(11.0, 7.0, 0.0), neck=(-27.0, 10.0, 0.0), head=(-16.0, 7.0, 0.0),
                                 handIKL=(0.02, 0.32, 0.33), handIKR=(-0.06, 0.32, 0.31), **poles))
    key_pose(c, 0.92, ready_pose(hipsOff=(0.0, -0.44, -0.04), hipsRot=(20.0, -38.0, 0.0), spine=(20.0, 10.0, 0.0),
                                 chest=(8.0, 6.0, 0.0), neck=(-22.0, 13.0, 0.0), head=(-12.0, 8.0, 0.0),
                                 handIKL=(-0.04, 0.62, 0.32), handIKR=(-0.10, 0.60, 0.28), **poles))
    key_pose(c, 1.05, stand_pose(hipsOff=(0.0, -0.26, 0.0), hipsRot=(14.0, -55.0, 0.0), spine=(12.0, 6.0, 0.0),
                                 chest=(5.0, 6.0, 0.0), neck=(-12.0, 26.0, 0.0), head=(-6.0, 16.0, 0.0),
                                 handIKL=(-0.14, 1.0, 0.30), handIKR=(-0.20, 0.98, 0.24), armIKL=1.0, armIKR=1.0,
                                 **dict(poles, kneePoleR=(-0.55, 0.0, 0.84))))
    key_pose(c, 1.3, gather(-68.0, kneePoleR=(-0.6, 0.0, 0.8)))
    key_pose(c, 1.5, gather(-70.0, kneePoleR=(-0.6, 0.0, 0.8)))
    c.contact('kneeL', 0.48, 0.98)
    c.contact('handL', 0.6, 0.66)
    c.contact('handR', 0.6, 0.66)
    c.provenance_note = 'keyframed long barrier into a side-on gather'
    return c


def return_walk():
    """A calm walk back to position: upright, relaxed arms (loop)."""
    frames, rate, v = 34, 30, 1.3
    period = frames / rate
    c = Clip('fld_return', PACK, 'fielder', period, rate=rate, loop=True, codec=1, mirrorable=True, speed=v,
             cycle_steps=2, phase0=True)

    def style(p, t):
        q = dict(p)
        q['spm'] = 120.0 / period
        q['armA'] = 13.0
        q['lean'] = 1.0
        q['tilt'] = 2.0
        q['drop'] = -0.008
        return q

    st = Stepper(linear_path(v), -2.0, period + 2.0, cyclic=True, style=style)
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    c.fn = gait_controls(st)
    c.provenance_note = 'gait generator, relaxed walk back'
    return c



def clips():
    # turn_run() (fld_turn_run_r / _l) is authored but held back: it does not yet pass the joint-limit and pop
    # gates (MOTION-SPEC §9), so it does not ship.
    # pickup_1h() (fld_pickup_1h) is authored but held back until it passes every gate.
    return [ready(), walk_in(), set_clip(), sprint_start(), decel_stop(), return_walk(), pickup_2h(), long_barrier(),
            pickup_1h(), turn_run()]
