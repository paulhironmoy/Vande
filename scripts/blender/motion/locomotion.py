"""
Locomotion pack (MOTION-SPEC §11): original keyframed and gait-generated clips on VC17. Owner-made.

Loops start at the left foot strike (phase0LeftStrike) so every gait stays phase-synced for speed blending.
"""
import math

from gait import Path, Stepper, gait_controls, linear_path, profile_path
from vc17 import Clip, Plant, clamp, lerp, smooth

PACK = 'locomotion'


def gait_loop(cid, v, frames, rate, codec=1, note=''):
    """A one-stride loop at speed v: `frames` samples per stride at `rate` (stride time = frames / rate)."""
    period = frames / rate
    c = Clip(cid, PACK, 'any', period, rate=rate, loop=True, codec=codec, mirrorable=False, speed=v, cycle_steps=2,
             phase0=True)
    path = linear_path(v)

    def style(p, t):
        q = dict(p)
        q['spm'] = 120.0 / period  # exactly two steps per loop
        return q

    st = Stepper(path, -2.0, period + 2.0, cyclic=True, style=style)
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    c.fn = gait_controls(st)
    c.provenance_note = note or f'gait generator at {v} m/s, {120.0 / period:.1f} steps/min'
    return c


def idle():
    """Standing at ease: a slow weight shift, breathing, small looks; feet planted side by side."""
    d = 4.0
    c = Clip('loco_idle', PACK, 'any', d, rate=15, loop=True, codec=1, mirrorable=True)
    w = 0.11
    c.plants('L', [Plant('L', -math.inf, math.inf, (w + 0.016, 0.134), 7.0)])
    c.plants('R', [Plant('R', -math.inf, math.inf, (-w - 0.016, 0.134), -7.0)])
    for t, sx, br, look in ((0.0, 0.010, 0.0, 0.0), (1.0, 0.0, 1.0, 4.0), (2.0, -0.012, 0.0, 2.0),
                            (3.0, 0.0, 1.0, -3.0), (4.0, 0.010, 0.0, 0.0)):
        c.key(t, hipsOff=(sx, -0.008 - 0.003 * abs(sx) / 0.012, 0.0),
              hipsRot=(1.0, -look * 0.15, -sx * 120.0),
              spine=(2.0, look * 0.15, sx * 70.0), chest=(1.0 + 1.2 * br, look * 0.2, sx * 40.0),
              neck=(-2.0 - 0.6 * br, look * 0.35, -sx * 20.0), head=(-1.0, look * 0.4, 0.0),
              upperArmL=(2.0 + 1.0 * br, -3.0, 7.0 + 0.8 * br), forearmL=(-13.0 - br, 0.0, 0.0), handL=(-6.0, 0.0, 0.0),
              upperArmR=(2.0 + 1.0 * br, 3.0, -7.0 - 0.8 * br), forearmR=(-13.0 - br, 0.0, 0.0), handR=(-6.0, 0.0, 0.0))
    c.provenance_note = 'keyframed idle, 4 s loop'
    return c


def start():
    """From standing to a run: a driving first step, quick short strides, deep lean rising as speed builds.
    Ends exactly at a left foot strike at about 4.6 m/s, so `loco_run` (phase 0) can take over by speed."""
    t_go = 0.12
    vmax, tau = 6.2, 0.95

    def v(t):
        return 0.0 if t <= t_go else vmax * (1.0 - math.exp(-(t - t_go) / tau))

    path = profile_path(v, 3.0)
    st = Stepper(path, 0.0, 3.0, first='R', t_go=t_go)
    # The clip ends at the first left strike after 1.25 s.
    end = next(ts for ts, sd in st.strikes if sd == 'L' and ts > 1.25)
    end = round(end * 60) / 60.0
    c = Clip('loco_start', PACK, 'any', end, rate=60, loop=False, codec=1, mirrorable=True,
             markers={'go': t_go, 'exitLeftStrike': end})
    st2 = Stepper(path, 0.0, 3.0, first='R', t_go=t_go)
    c.plants('L', st2.plants['L'])
    c.plants('R', st2.plants['R'])

    def extra(t, out, p, mw):
        # A gathered start: hips sink and the trunk loads forward just before the first push.
        load = smooth(t / t_go) * (1.0 - smooth((t - t_go) / 0.35))
        hx, hy, hz = out['hipsOff']
        out['hipsOff'] = (hx, hy - 0.035 * load, hz)
        sx, sy, sz = out['spine']
        out['spine'] = (sx + 8.0 * load, sy, sz)
        return out

    c.fn = gait_controls(st2, extra)
    c.speed = path.pos(end)[1] / end
    c.provenance_note = f'gait generator, v(t) = {vmax}(1 - exp(-(t - {t_go})/{tau})) m/s; exit speed {v(end):.2f} m/s'
    return c


def stop():
    """From the run loop (entered at its left strike, 5.6 m/s) to standing: braking strides with the feet landing
    ahead and the hips sitting down, the trunk upright against the stop, then a closing step and a settle."""
    v0 = 5.6
    t_b = 0.05
    d_b = 1.25

    def v(t):
        if t <= t_b:
            return v0
        return v0 * (1.0 - smooth((t - t_b) / d_b))

    path = profile_path(v, 3.0)
    st = Stepper(path, 0.0, 3.0, first='R', t_go=0.0, enter_moving=True)
    # The run enters on the left foot: replace the standing start by run plants (left down at t = 0).
    c = Clip('loco_stop', PACK, 'any', 1.7, rate=60, loop=False, codec=1, mirrorable=True)
    run = Stepper(linear_path(v0), -2.0, 0.0, cyclic=True,
                  style=lambda p, t: dict(p, spm=120.0 / (41 / 60.0)))
    left_run = [p for p in run.plants['L'] if p.t0 <= 0.0 + 1e-9 and p.t0 > -1.0]
    right_run = [p for p in run.plants['R'] if p.t0 < 0.0 and p.t0 > -1.0]
    st_l = [p for p in st.plants['L'] if p.t0 > 0.0]
    st_r = [p for p in st.plants['R'] if not math.isinf(p.t0)]
    # Left strike at t = 0 belongs to the run; the generator's virtual left strike at t = 0 maps onto it.
    c.plants('L', left_run + st_l)
    c.plants('R', right_run + st_r)
    plant_t = max(ts for ts, sd in st.strikes if ts < (st.end_t or 1.0))
    c.markers = {'plant': plant_t, 'still': min(1.7, (st.end_t or 1.2) + 0.35)}

    def extra(t, out, p, mw):
        return out

    c.fn = gait_controls(st, extra)
    c.speed = path.pos(1.7)[1] / 1.7
    c.provenance_note = f'gait generator, v(t) = {v0}(1 - smoothstep((t - {t_b})/{d_b})) m/s, braking strides'
    return c


def turn_in_place(cid, angle, dur, alias):
    """A turn on the spot to the left by `angle` degrees: the left foot opens first, the right follows round, and a
    closing step squares the feet; the hips lead the feet slightly, the head leads the hips."""
    t_go = 0.2

    def heading(t):
        return angle * smooth((t - t_go) / (dur - 0.45))

    path = Path(lambda t: (0.0, 0.0), heading, dur)
    st = Stepper(path, 0.0, dur, first='L', t_go=t_go, min_spm=150.0,
                 moving=lambda t: abs(path.yaw_rate(t)) > 20.0 or (t_go < t < dur - 0.5))

    def style(p, t):
        q = dict(p)
        q['off'] = 20.0
        q['land'] = 0.0
        q['kickBack'] = 0.0
        q['driveFwd'] = 0.0
        q['midFwd'] = 0.0
        q['kickY'] = 0.12
        q['midY'] = 0.12
        q['driveY'] = 0.03
        return q

    st = Stepper(path, 0.0, dur, first='L', t_go=t_go, min_spm=150.0, style=style,
                 moving=lambda t: abs(path.yaw_rate(t)) > 20.0)
    c = Clip(cid, PACK, 'any', dur, rate=30, loop=False, codec=1, mirrorable=True,
             markers={'go': t_go}, aliases={alias: 'mirror'})
    for side in ('L', 'R'):
        for p in st.plants[side]:
            p.swing_keys = [(0.5, 'arc', 0.0, 0.03)]
    # The standing right foot turns on its front with the body until it steps round to close.
    r0 = st.plants['R'][0]
    r_land = st.plants['R'][1].t0
    r0.t1 = r_land - 0.32
    r0.peel_s = 0.18
    r0.off = 14.0
    r0.pivot = (t_go + 0.1, r0.t1 - 0.02, 0.5 * angle)
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    base = gait_controls(st)

    def fn(t):
        out = base(t)
        lead = angle * (smooth((t - t_go + 0.06) / (dur - 0.5)) - smooth((t - t_go) / (dur - 0.45)))
        hx, hy, hz = out['hipsRot']
        out['hipsRot'] = (hx, hy + 0.5 * lead, hz)
        nx, ny, nz = out['neck']
        out['neck'] = (nx, ny + 0.6 * lead, nz)
        hx2, hy2, hz2 = out['head']
        out['head'] = (hx2, hy2 + 0.5 * lead, hz2)
        return out

    c.fn = fn
    c.provenance_note = f'gait generator turning {angle} degrees on the spot'
    return c


def strafe():
    """A sideways step-close to the left (loop, about 1.0 m/s): the lead foot steps out, the trail foot closes, the
    feet never cross; low, facing forward."""
    frames, rate, v = 39, 60, 0.85
    period = frames / rate
    c = Clip('loco_strafe_l', PACK, 'any', period, rate=rate, loop=True, codec=1, mirrorable=True, speed=v,
             cycle_steps=2, phase0=True, aliases={'loco_strafe_r': 'mirror'})

    def style(p, t):
        q = dict(p)
        q['spm'] = 120.0 / period
        q['w'] = 0.2
        q['toe'] = 8.0
        q['off'] = 8.0
        q['land'] = 0.0
        q['contact'] = 0.55 * period
        q['zeta'] = 0.3
        q['kickBack'] = 0.0
        q['driveFwd'] = 0.0
        q['midFwd'] = 0.0
        q['kickY'] = 0.09
        q['midY'] = 0.10
        q['driveY'] = 0.025
        q['drop'] = -0.10
        q['bob'] = 0.006
        q['tilt'] = 8.0
        q['lean'] = 6.0
        q['armA'] = 4.0
        q['yawA'] = 1.0
        q['thorax'] = 0.0
        q['listA'] = 2.0
        q['sway'] = 0.0
        return q

    path = Path(lambda t: (v * t, 0.0), lambda t: 0.0, 1e9)
    st = Stepper(path, -2.0, period + 2.0, cyclic=True, style=style)
    # A side step is a low, even arc (no running-style heel kick or knee drive).
    for side in ('L', 'R'):
        for p in st.plants[side]:
            p.swing_keys = [(0.5, 'arc', 0.0, 0.02)]
    c.plants('L', st.plants['L'])
    c.plants('R', st.plants['R'])
    c.fn = gait_controls(st)
    c.provenance_note = f'gait generator, sideways step-close at {v} m/s'
    return c


def clips():
    return [
        idle(),
        gait_loop('loco_walk', 1.5, 32, 30),
        gait_loop('loco_jog', 3.3, 44, 60),
        gait_loop('loco_run', 5.6, 41, 60),
        gait_loop('loco_sprint', 7.8, 32, 60),
        start(),
        stop(),
        turn_in_place('loco_turn_l90', 90.0, 1.1, 'loco_turn_r90'),
        strafe(),
    ]


def drafts():
    return [strafe(), turn_in_place('loco_turn_l90', 90.0, 1.1, 'loco_turn_r90')]
