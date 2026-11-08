"""MOTION-BOWL approach clips: the run-up gait loops and the standing starts (original keyframe authoring).

Gait loops (phase0LeftStrike, rate 1 at their own speed) carry the bowler's run-up body: the ball in the right hand,
the bowling arm's swing reduced and its elbow folded, a slight forward lean that eases as the speed builds.
Starts begin at rest in the top-of-mark stance, rock back, walk in and reach the jog loop at a strike.
"""

import math

from bowler_gait import (
    FootTrack, Path, cadence, contact_time, default_swing_keys, gait_phase_fn, hips_y_keys, plant, runness,
    spring_hips, synth,
)
from bowler_kin import Curve, smoothstep

# The loop speeds (m/s). JOG is also the speed the starts hand over at.
LOOP_SPEEDS = {"bowl_jog": 3.0, "bowl_run": 5.0, "bowl_stride": 6.2}

SURGE = 0.08
START_P = (12.0, 14.0, 0.08)  # standing push-offs: first foot pitch, second foot pitch, second lift after the first strike

# The top-of-mark stance: the ball in the right hand at the hip, the weight even.
STAND_HIPS = 0.965


def upper_body(phase, v_of_t, accel_of_t, carry=1.0, bowl_arm_scale=0.55):
    """Trunk, head and arms during the approach, as functions of time."""

    def g_of(t):
        return runness(v_of_t(t))

    def s_of(t):
        return max(0.0, min(1.0, v_of_t(t) / 6.5))

    def pelvis(t):
        p = phase(t)
        g = g_of(t)
        s = s_of(t)
        c = math.cos(2 * math.pi * p)
        sn = math.sin(2 * math.pi * (p - 0.08))
        lean = math.degrees(math.atan2(max(0.0, accel_of_t(t)), 9.81)) * 0.35
        return (-(3.0 + 3.0 * s) * c, 3.0 + 5.0 * g + lean, (2.0 + 2.0 * g) * sn)

    def spine(t):
        p = phase(t)
        s = s_of(t)
        c = math.cos(2 * math.pi * p)
        lean = math.degrees(math.atan2(max(0.0, accel_of_t(t)), 9.81)) * 0.4
        return (3.0 + 3.0 * s + lean, (4.0 + 4.0 * s) * c, 0.0)

    def chest(t):
        p = phase(t)
        s = s_of(t)
        c = math.cos(2 * math.pi * p)
        return (1.5, (3.0 + 3.0 * s) * c, 0.0)

    def look(t):
        return (0.0, 2.0)

    def arms(t):
        p = phase(t)
        g = g_of(t)
        s = s_of(t)
        c = math.cos(2 * math.pi * (p - 0.04))
        amp = 14.0 + 30.0 * s
        flexL = 18.0 + 70.0 * g + 8.0 * s
        # left arm back at the left strike (p = 0), forward at the right strike
        phiL = 6.0 + amp * c
        flexL_t = flexL + 12.0 * g * max(0.0, -c)
        latL = 12.0 - 2.0 * g * max(0.0, -c)
        # bowling (right) arm: ball in hand, a shorter swing, elbow folded
        ampR = amp * bowl_arm_scale
        phiR = 4.0 - ampR * c
        flexR = (24.0 + 78.0 * g) * carry + (1 - carry) * flexL
        latR = 12.0 - 3.0 * g * max(0.0, c)
        wristR = (-12.0 * g, 0.0, 0.0)
        return {
            "L": (phiL, latL, -40.0 * g, flexL_t, -55.0 - 15.0 * g, (8.0 * g, 0.0, 0.0)),
            "R": (phiR, latR, 30.0 * g, flexR, 60.0 + 10.0 * g, wristR),
        }

    return pelvis, spine, chest, look, arms


LOOP_RATES = {"bowl_jog": 30, "bowl_run": 60, "bowl_stride": 60}


def loop_step(v, rate):
    """Step time of a gait loop at speed v stored at `rate` (the cycle is a whole number of frames)."""
    return int(round(2.0 * rate / cadence(v))) / float(rate) / 2.0


def _closing(f0, travel_z):
    f = dict(f0)
    g = f0["ground"]
    f["ground"] = (g[0], g[1] + travel_z, g[2])
    return f


def gait_loop(clip_id, v, rate=60, carry=1.0, bowl_arm_scale=0.55):
    """One gait cycle at constant speed v, frame 0 = left strike, with a closing frame."""
    # the cycle is a whole number of frames (the loop seam), so the cadence is rounded to the frame grid; the body is
    # synthesised at 60 Hz and decimated for lower storage rates (contacts shrink to the planted interval)
    F = int(round(2.0 * rate / cadence(v)))
    P = F / float(rate)
    step = P / 2.0
    store_rate = rate
    rate = 60
    speed = lambda t: v
    heading = lambda t: 0.0
    path = Path(speed, heading, -3 * P, 4 * P)
    stances = []
    t = -3 * P
    foot = "L"
    while t < 4 * P:
        stances.append(plant(path, foot, t, v))
        t += step
        foot = "R" if foot == "L" else "L"
    sw = default_swing_keys(speed)
    feet = {s: FootTrack(s, [x for x in stances if x["foot"] == s], path, sw) for s in "LR"}
    phase = lambda t: t / P
    pelvis, spine, chest, look, arms = upper_body(phase, speed, lambda t: 0.0, carry=carry, bowl_arm_scale=bowl_arm_scale)
    hy = Curve(hips_y_keys(stances, speed))
    # the hips slow a little through each stance and speed up into the flight (a real runner's surge)
    tmid = 0.5 * contact_time(v)
    eps = SURGE * runness(v)
    surge = lambda t: -(eps * v * step / (2 * math.pi)) * math.sin(2 * math.pi * (2 * (t / P) - tmid / step))
    sway = lambda t: (0.012 * runness(v) + 0.02 * (1 - runness(v))) * math.cos(2 * math.pi * ((t / P) - tmid / (2 * step)))
    desc = {
        "surge": surge, "lateral": sway,
        "T": P, "rate": rate, "t0": 0.0, "path": path, "feet": feet, "hipsY": hy, "pelvis": pelvis,
        "spine": spine, "chest": chest, "look": look, "arms": arms, "ballHand": None, "loop": True,
    }
    frames = synth(desc)
    if store_rate != 60:
        k = 60 // store_rate
        body = frames[:-1]
        frames = []
        for i in range(0, len(body), k):
            f = dict(body[i])
            bits = f["contacts"]
            for j in range(i - k + 1, i + k):
                bits &= body[j % len(body)]["contacts"] | ~3
            f["contacts"] = bits
            frames.append(f)
        frames.append(_closing(frames[0], v * P))
        rate = store_rate
    # the clip starts at the origin
    g0 = frames[0]["ground"]
    for fr in frames:
        g = fr["ground"]
        fr["ground"] = (g[0] - g0[0], g[1] - g0[1], g[2])
    return {
        "id": clip_id, "pack": "bowler", "role": "bowler", "rate": rate, "loop": True, "mirrorable": False,
        "codec": 1, "speedMps": v, "cycleSteps": 2, "markers": {"strikeL": 0.0, "strikeR": round(step, 6)},
        "frames": frames, "tracks": {}, "_step": step, "_contact": contact_time(v),
    }


# ----------------------------------------------------------------------------------------------------------------
# Standing starts: still at the top of the mark, a small rock back, a walk-in, then the jog (exit at a strike)
# ----------------------------------------------------------------------------------------------------------------


def standing_start(clip_id, first_foot, rate=60, v_exit=None, t_ramp=(0.0, 1.12), t_lift=0.12, min_exit=1.48):
    """From standing to the jog loop. The clip ends at the first strike after the speed has settled at v_exit; the
    exit foot (and so the loop phase to enter, 0 for left, 0.5 for right) is returned."""
    from bowler_gait import make_stance, schedule_steps, rot_y
    from bowler_kin import BALL, smootherstep
    v_exit = LOOP_SPEEDS["bowl_jog"] if v_exit is None else v_exit
    speed = lambda t: v_exit * smootherstep(t_ramp[0], t_ramp[1], t)
    heading = lambda t: 0.0
    path = Path(speed, heading, -1.0, 6.0)
    other = "R" if first_foot == "L" else "L"
    # the standing feet, side by side
    def standing(foot, t_off, p_off):
        side = 1.0 if foot == "L" else -1.0
        M = path.at(0.0)
        ank = (M[0] + side * 0.11, M[1] - 0.02)
        st = make_stance(foot, -1.0, t_off, (ank[0], ank[1] + BALL[2]), side * 5.0, 0.0, p_off, (0.02, 0.9))
        return st
    # moving steps: the first lands about 0.36 s after the lift
    t1 = t_lift + 0.36
    moving = schedule_steps(path, first_foot, t1, 4.0)
    # the other foot leaves the ground shortly after the first step lands
    st0 = standing(first_foot, t_lift, START_P[0])
    st1 = standing(other, t1 + START_P[2], START_P[1])
    stances = [st0, st1] + moving
    # exit: first strike at or after min_exit with the speed settled
    exit_st = next(s for s in moving if s["t_on"] >= min_exit and speed(s["t_on"]) > v_exit - 1e-3)
    t_exit = exit_st["t_on"]
    sw = default_swing_keys(speed)
    feet = {f: FootTrack(f, [x for x in stances if x["foot"] == f], path, sw) for f in "LR"}
    phase = gait_phase_fn(moving)
    accel = lambda t: (speed(t + 0.01) - speed(t - 0.01)) / 0.02
    pelvis0, spine0, chest0, look, arms0 = upper_body(phase, speed, accel)
    still = lambda t: 1.0 - smoothstep(0.0, t1 + 0.12, t)
    pelvis = lambda t: tuple(v * (1 - still(t)) for v in pelvis0(t))
    spine = lambda t: tuple(v * (1 - still(t)) + w * still(t) for v, w in zip(spine0(t), (3.0, 0.0, 0.0)))
    chest = lambda t: tuple(v * (1 - still(t)) + w * still(t) for v, w in zip(chest0(t), (1.0, 0.0, 0.0)))
    stand_arm = {"L": (4.0, 8.0, 0.0, 14.0, -55.0, (0.0, 0.0, 0.0)), "R": (2.0, 9.0, 0.0, 32.0, 60.0, (-6.0, 0.0, 0.0))}

    def arms(t):
        a = arms0(t)
        w = still(t)
        out = {}
        for s in "LR":
            m = a[s]
            st = stand_arm[s]
            out[s] = tuple(m[k] * (1 - w) + st[k] * w for k in range(5)) + (tuple(m[5][k] * (1 - w) + st[5][k] * w for k in range(3)),)
        return out
    # hips: standing height, then the walking/jogging keys; a small rock back before the first step
    hk = [(0.0, STAND_HIPS), (t_lift + 0.05, STAND_HIPS - 0.006)] + [kv for kv in hips_y_keys(moving, speed) if kv[0] > t1 - 0.05]
    hy = Curve(hk)
    rock = lambda t: -0.015 * (1.0 - math.cos(2 * math.pi * max(0.0, min(1.0, t / 0.5))))
    # steady-state surge and sway in gait-phase terms (match the loops)
    def surge(t):
        v = speed(t)
        p = phase(t)
        stp = 1.0 / cadence(max(v, 0.5))
        eps = SURGE * runness(v)
        return rock(t) * still(t) - (eps * v * stp / (2 * math.pi)) * math.sin(2 * math.pi * (2 * p - 0.5 * contact_time(max(v, 0.5)) / stp))

    def sway(t):
        v = speed(t)
        p = phase(t)
        stp = 1.0 / cadence(max(v, 0.5))
        a = 0.012 * runness(v) + 0.02 * (1 - runness(v))
        return a * (1 - still(t)) * math.cos(2 * math.pi * (p - 0.5 * contact_time(max(v, 0.5)) / (2 * stp)))
    desc = {
        "T": math.ceil(t_exit * rate - 1e-9) / rate, "rate": rate, "t0": 0.0, "path": path, "feet": feet, "hipsY": hy,
        "pelvis": pelvis, "spine": spine, "chest": chest, "look": look, "arms": arms, "ballHand": None, "surge": surge,
        "lateral": sway,
    }
    frames = synth(desc)
    g0 = frames[0]["ground"]
    for fr in frames:
        g = fr["ground"]
        fr["ground"] = (g[0] - g0[0], g[1] - g0[1], g[2])
    return {
        "id": clip_id, "pack": "bowler", "role": "bowler", "rate": rate, "loop": False, "mirrorable": False,
        "codec": 1, "markers": {"lift": t_lift, "firstStrike": t1, "exit": t_exit}, "frames": frames, "tracks": {},
        "_exitFoot": exit_st["foot"], "_stances": stances, "_vexit": v_exit,
    }
