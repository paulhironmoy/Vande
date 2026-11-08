"""MOTION-BOWL deliveries: the pace action (gather, bound, back-foot contact, front-foot landing at the popping crease,
arm circle, release, follow-through, deceleration to a stop) and the finger- and wrist-spin actions.

Original keyframes authored for the owner. Every action is right-arm, over the wicket; a left-arm bowler plays the
same clip through the canonical mirror (MOTION-SPEC §3). Times are seconds from the entry strike (the left foot
landing of the last approach stride, which is frame 0 of the delivery clip and phase 0 of the approach loop).
"""

import math

import bowler_approach as BA
from bowler_gait import (
    FootTrack, Path, cadence, contact_time, default_swing_keys, hips_y_keys, make_stance, plant, runness, synth,
)
from bowler_kin import (
    BALL, Curve, IDX, OFFSET, fk, qconj, qeuler, qmul, qrot, qx, qy, qz, smoothstep, vadd, vnorm,
)

from bowler_gait import LAW as _LAW  # noqa: E402

LAW_REACH = _LAW["reach"]

# ----------------------------------------------------------------------------------------------------------------
# Action definitions (hand-authored keys)
# ----------------------------------------------------------------------------------------------------------------

PACE = {
    "name": "pace",
    "entrySpeed": BA.LOOP_SPEEDS["bowl_stride"],
    "times": {"takeoff": 0.115, "apex": 0.28, "backFoot": 0.43, "frontFoot": 0.60, "release": 0.69, "backToe": 0.555,
              "frontOff": 0.86, "follow1": 0.93},
    # hips forward speed (m/s): approach, gather, bound, braking through the delivery stride, follow-through, stop
    "speed": [(-2.0, None), (0.0, None), (0.115, 6.05), (0.43, 5.9), (0.60, 4.45), (0.69, 3.65), (0.85, 3.2),
              (1.0, 3.1), (1.4, 2.45), (1.8, 1.5), (2.15, 0.7), (2.45, 0.12), (2.6, 0.0), (3.2, 0.0)],
    "heading": [(0.0, 0.0), (0.9, 0.0), (1.5, 8.0), (2.1, 16.0), (2.6, 18.0)],
    "hips": [(0.06, 0.888), (0.115, 0.902), (0.28, 0.942), (0.43, 0.89), (0.52, 0.872), (0.60, 0.868), (0.69, 0.882),
             (0.80, 0.895), (0.93, 0.89)],
    # pelvis (yaw offset from the heading, anterior tilt, roll)
    "pelvis": [(0.0, None), (0.13, (-10, 8, 0)), (0.28, (-34, 4, 2)), (0.43, (-48, 6, 3)), (0.52, (-40, 7, 0)),
               (0.60, (-24, 8, -3)), (0.69, (0, 8, -4)), (0.80, (20, 22, -5)), (0.95, (28, 21, -3)),
               (1.1, (14, 15, 0)), (1.4, (0, 10, 0))],
    "spine": [(0.0, None), (0.13, (6, -2, 0)), (0.28, (-5, -7, 3)), (0.43, (-8, -10, 4)), (0.55, (-4, -10, 2)),
              (0.69, (4, 6, -4)), (0.82, (22, 14, -9)), (0.97, (25, 11, -4)), (1.12, (18, 5, 0)), (1.4, (9, 0, 0))],
    "chest": [(0.0, None), (0.13, (2, -4, 0)), (0.28, (-4, -9, 3)), (0.43, (-6, -13, 4)), (0.55, (-3, -14, 3)),
              (0.69, (4, 10, -4)), (0.82, (13, 15, -7)), (0.97, (12, 9, -2)), (1.4, (3, 0, 0))],
    # bowling arm (right): swing phi, abduction, twist, elbow flex, forearm twist, wrist (x, y, z)
    "armR": [(0.0, None), (0.13, (-28, 16, 20, 96, 60, (-10, 0, 0))), (0.28, (-48, 22, 28, 98, 55, (-15, 0, 0))),
             (0.43, (36, 20, 12, 24, 30, (10, 0, 0))), (0.52, (52, 16, 40, 16, 20, (14, 0, 0))),
             (0.60, (78, 10, 70, 12, 10, (12, 0, 0))), (0.645, (112, 3, 118, 10, 5, (16, 0, 0))),
             (0.69, (172, 0, 168, 10, 0, (4, 0, 0))), (0.735, (232, 0, 180, 12, 0, (-9, 0, 0))),
             (0.80, (288, -6, 180, 16, -10, (-15, 0, 0))), (0.88, (326, -9, 174, 22, -15, (-14, 0, 0))),
             (0.97, (346, -8, 166, 28, -20, (-10, 0, 0))),
             (1.1, (362, 4, 140, 36, 0, (-8, 0, 0))), (1.4, (366, 12, 60, 55, 40, (-6, 0, 0)))],
    # front arm (left): world-frame direction of the upper arm (heading frame: x left, y up, z to the batter), flex
    "armLdir": [(0.0, None), (0.22, ((0.2, 0.25, 0.95), 64)), (0.30, ((0.15, 0.78, 0.6), 34)),
                (0.43, ((0.14, 0.64, 0.76), 16)), (0.56, ((0.16, 0.36, 0.92), 20)), (0.65, ((0.38, -0.2, 0.9), 60)),
                (0.74, ((0.55, -0.62, 0.55), 95)), (0.86, ((0.55, -0.8, 0.2), 95)), (1.0, ((0.4, -0.85, 0.3), 80)),
                (1.12, ((0.3, -0.85, 0.35), 70))],
    "backFoot": {"lat": -0.10, "ahead": 0.14, "yaw": -60.0, "pOn": 2.0, "pOff": 48.0, "flat": (0.1, 0.45)},
    # the front foot lands heel first and is up on its ball at the release (pitch keys: s after the landing, deg)
    "frontFoot": {"lat": 0.01, "stride": 1.07, "yaw": -12.0, "pOn": -12.0, "pOff": 44.0, "flat": (0.16, 0.40),
                  "pkeys": ((0.0, -10.0), (0.035, 0.0), (0.045, 0.0), (0.09, 20.0), (0.15, 26.0), (0.26, 44.0))},
    # the front knee braces through the release (deg of flex); the hips height is solved from it on the front foot
    "frontKnee": ((0.60, 47.0), (0.63, 37.0), (0.66, 26.0), (0.69, 20.0), (0.73, 23.0), (0.78, 36.0), (0.84, 48.0)),
    "reachLimit": (0.845, 0.58, 0.88),
    "swingL": {"kneeMax": 92.0, "kneeAt": 0.36, "hipOver": 10.0, "kneeLate": 4.0},
    "swingR": {"kneeMax": 96.0, "kneeAt": 0.36, "hipOver": 0.0, "kneeLate": 8.0},
    "swingLfollow": {"kneeMax": 72.0, "kneeAt": 0.42, "hipOver": 4.0, "kneeLate": 8.0},
    "swingRfollow": {"kneeMax": 96.0, "kneeAt": 0.42, "hipOver": 4.0, "kneeLate": 8.0},
    "followLat": 0.10,
    "settle": (1.1, 1.7), "fade": (2.0, 2.55), "lookAway": (1.0, 1.8), "takeoffPitch": 50.0, "tEnd": 3.0,
    "palmRoll": True,
    "groundSigma": 0.18,
}


def _with_key(keys, t, value):
    return tuple(sorted([kv for kv in keys if abs(kv[0] - t) > 1e-9] + [(t, value)], key=lambda kv: kv[0]))


# The bouncer: the same run-in, markers and release time as PACE, released about 4-5 cm higher (lead ruling
# 2026-11-04): a shorter last stride so the body is further over the front foot, the front leg straighter and the
# heel higher on the ball of the foot, the pelvis tilted back (a fuller arch), less side bend so the arm is nearer
# vertical, and the wrist already cocked back at the release.
PACE_BOUNCER = dict(PACE, name="pace_bouncer", **{
    "frontFoot": dict(PACE["frontFoot"], stride=0.995,
                      pkeys=((0.0, -10.0), (0.035, 0.0), (0.036, 0.0), (0.09, 34.0), (0.15, 44.0), (0.26, 44.0))),
    "frontKnee": ((0.60, 47.0), (0.63, 37.0), (0.66, 16.0), (0.69, 9.0), (0.73, 17.0), (0.78, 39.0), (0.84, 45.0)),
    "reachLimit": (0.855, 0.58, 0.88),
    "pelvis": _with_key(PACE["pelvis"], 0.69, (0, -1, -4)),
    "spine": _with_key(PACE["spine"], 0.69, (4.5, 6, -1)),
    "chest": _with_key(PACE["chest"], 0.69, (4.5, 10, -1)),
    "armR": _with_key(PACE["armR"], 0.69, (186, 0, 168, 10, 0, (-10, 0, 0))),
})


def _blend_key_curves(keys, n, base_fn, t_blend=(0.0, 0.12)):
    """A channel that follows base_fn (the approach loop) before the delivery keys take over."""
    curves = []
    knots = [(t, v) for t, v in keys if v is not None]
    for k in range(n):
        curves.append(Curve([(t, (v[k] if isinstance(v, (tuple, list)) else v)) for t, v in knots]))

    def f(t):
        w = smoothstep(t_blend[0], t_blend[1], t)
        b = base_fn(t)
        if w <= 0:
            return b
        d = tuple(c(t) for c in curves)
        if w >= 1:
            return d
        return tuple(b[k] * (1 - w) + d[k] * w for k in range(n))

    return f


def _dir_to_phi_lat(d_chest, side_sign):
    dx, dy, dz = vnorm(d_chest)
    lat = math.degrees(math.asin(max(-1.0, min(1.0, side_sign * dx))))
    phi = math.degrees(math.atan2(-dz, -dy))
    return phi, lat


def build_pace(action=PACE, t_before=0.95, t_end=None, rate=60):
    return build_action(action, t_before, t_end, rate)


def _predict_stop(A, speed):
    t = A["times"]["follow1"]
    while speed(t) >= 0.45:
        dt = 1.0 / cadence(max(speed(t), 0.9))
        for _ in range(4):
            dt = 1.0 / cadence(max(speed(t + 0.5 * dt), 0.9))
        t += dt
    return t


TURN = {"angle": 160.0, "wait": 0.22, "turnDur": 0.75, "walkV": 1.35, "rampDur": 1.0, "exitAfter": 0.1}


def build_action(action, t_before=0.95, t_end=None, rate=60, turn=False):
    A = action
    t_end = A["tEnd"] if t_end is None else t_end
    T = A["times"]
    ve = A["entrySpeed"]
    loop_id = [k for k, v in BA.LOOP_SPEEDS.items() if abs(v - ve) < 1e-9][0]
    step = BA.loop_step(ve, BA.LOOP_RATES[loop_id])
    # speed and heading curves (the approach before the entry is the stride loop's constant speed)
    sp_keys = [(t, (ve if v is None else v)) for t, v in A["speed"]]
    speed_c = Curve(sp_keys)
    speed = lambda t: max(0.0, speed_c(t))
    heading = Curve(A["heading"])
    turn_info = None
    if turn:
        # after the stop: a wait, a turn to the left on the spot in two low steps, and the walk back to the mark
        # the turn starts `wait` after the stop; the speed curve is cut to zero there and the stop re-predicted on the
        # edited curve until both agree
        base_keys = list(sp_keys)
        ts = _predict_stop(A, speed)
        tw = ts + TURN["wait"]
        for _ in range(6):
            keys_ = [kv for kv in base_keys if kv[0] < ts - 1e-6] + [
                (tw, 0.0), (tw + 0.45, 0.25), (tw + TURN["rampDur"], 0.95), (tw + TURN["rampDur"] + 0.5, TURN["walkV"]),
                (tw + 8.0, TURN["walkV"])]
            c_ = Curve(keys_)
            ts2 = _predict_stop(A, lambda t, c_=c_: max(0.0, c_(t)))
            if ts2 <= tw - 0.12:
                break
            tw = ts2 + TURN["wait"]
        ts = ts2
        sp_keys = keys_
        h_end = heading(tw)
        speed_c = Curve(sp_keys)
        speed = lambda t: max(0.0, speed_c(t))
        hk_ = [kv for kv in A["heading"] if kv[0] < tw - 1e-6] + [(tw, h_end), (tw + TURN["turnDur"], h_end + TURN["angle"]),
                                                                   (tw + 8.0, h_end + TURN["angle"])]
        heading = Curve(hk_)
        t_end = tw + TURN["rampDur"] + 2.2
        turn_info = {"t_stop": ts, "tw": tw, "h_end": h_end}
    t0 = -t_before
    path = Path(speed, heading, t0 - 1.0, t_end + 1.0)
    # approach stances before the entry: the stride loop's
    st = []
    t = 0.0
    foot = "L"
    k = 0
    while t > t0 - 1.0:
        st.append(plant(path, foot, t, ve))
        t -= step
        foot = "R" if foot == "L" else "L"
    st = sorted(st, key=lambda s: s["t_on"])
    entry = st[-1]  # the left strike at t = 0
    # the gather: a longer left stance that springs into the bound
    entry["t_off"] = T["takeoff"]
    entry["pkeys"] = [(0.0, entry["pkeys"][0][1]), (0.03, 0.0), (T["takeoff"], A["takeoffPitch"])]
    entry["p_after"] = 14.0
    entry["swing"] = A["swingL"]
    # the previous right stance swings into the back-foot contact
    st[-2]["swing"] = A["swingR"]
    # back-foot contact (right)
    bf = A["backFoot"]
    M = path.at(T["backFoot"])
    h = heading(T["backFoot"])
    from bowler_gait import rot_y
    ank = rot_y(h, (bf["lat"], 0.0, bf["ahead"]))
    ank = (M[0] + ank[0], 0.0, M[1] + ank[2])
    ballw = rot_y(bf["yaw"], (0, 0, BALL[2]))
    bfc = make_stance("R", T["backFoot"], T["backToe"], (ank[0] + ballw[0], ank[2] + ballw[2]), bf["yaw"], bf["pOn"],
                      bf["pOff"], bf["flat"])
    bfc["swing"] = A["swingRfollow"]
    bfc["p_after"] = 6.0
    # front-foot landing (left) at the crease: `stride` ahead of the back ankle
    ff = A["frontFoot"]
    fank = (ank[0] + ff["lat"] - bf["lat"], 0.0, ank[2] + ff["stride"])
    fball = rot_y(ff["yaw"], (0, 0, BALL[2]))
    ffc = make_stance("L", T["frontFoot"], T["frontOff"], (fank[0] + fball[0], fank[2] + fball[2]), ff["yaw"],
                      ff["pOn"], ff["pOff"], ff["flat"])
    if ff.get("pkeys"):
        # an explicit pitch profile (seconds after the landing, degrees): e.g. the heel coming up at the release
        ffc["pkeys"] = [(T["frontFoot"] + dt_, p_) for dt_, p_ in ff["pkeys"]]
        ffc["bitHeelUp"] = True
    ffc["swing"] = A["swingLfollow"]
    # follow-through strides: a decelerating run that veers to the bowler's left, then the stop
    fol = []
    t = T["follow1"]
    foot = "R"
    while True:
        v = speed(t)
        if v < 0.45:
            break
        s = plant(path, foot, t, max(v, 0.6), lat_half=A["followLat"], ahead=A.get("followAhead", 0.12) + 0.035 * v)
        fol.append(s)
        dt = 1.0 / cadence(max(v, 0.9))
        for _ in range(4):
            dt = 1.0 / cadence(max(speed(t + 0.5 * dt), 0.9))
        t += dt
        foot = "R" if foot == "L" else "L"
    from bowler_gait import settle_offs
    settle_offs(path, fol)
    # the stop: the last foot lands beside the other, both planted to the end
    last = fol[-1]
    t_stop = t
    Mstop = path.at(t_stop)
    hs = heading(t_stop)
    other = rot_y(hs, ((0.12 if foot == "L" else -0.12), 0.0, 0.0))
    stop_ank = (Mstop[0] + other[0], 0.0, Mstop[1] + other[2])
    sb = rot_y(hs, (0, 0, BALL[2]))
    stop = make_stance(foot, t_stop, t_end + 2.0, (stop_ank[0] + sb[0], stop_ank[2] + sb[2]), hs + (5 if foot == "L" else -5),
                       -6.0, 0.0, (0.3, 0.99))
    last["t_off"] = t_end + 2.0
    # the trailing foot stays where it landed; as the body comes to rest ahead of it the heel lifts (about 20 deg) so
    # the ankle never dorsiflexes past its limit
    t_lift = max(last["t_on"] + 0.16, t_stop - 0.42)
    last["pkeys"] = [(last["t_on"], last["pkeys"][0][1]), (last["t_on"] + 0.08, 0.0), (t_lift, 0.0),
                     (t_stop + 0.12, 22.0), (t_end + 2.0, 22.0)]
    stop["pkeys"] = [(t_stop, -6.0), (t_stop + 0.09, 0.0), (t_end + 2.0, 0.0)]
    turn_st = []
    if turn:
        tw = turn_info["tw"]
        lowarc = {"kneeMax": 36.0, "kneeAt": 0.45, "kneePassAbs": 22.0, "hipOver": 0.0, "kneeLate": 3.0, "footMid": -6.0}
        fa, fb = last["foot"], stop["foot"]
        # A (the trailing foot, heel up) lifts first and steps round beside the pivoting B
        a_off = tw + 0.05
        last["t_off"] = a_off
        last["pkeys"] = [kv for kv in last["pkeys"] if kv[0] < a_off - 0.05] + [(a_off, 30.0)]
        last["swing"] = lowarc
        tA = a_off + 0.40
        hA = heading(tA)
        sideA = 1.0 if fa == "L" else -1.0
        MA = path.at(tA)
        ankA = rot_y(hA, (sideA * 0.13, 0.0, 0.02))
        ankA = (MA[0] + ankA[0], MA[1] + ankA[2])
        yA = hA + 4.0 * sideA
        bA = rot_y(yA, (0, 0, BALL[2]))
        stA = make_stance(fa, tA, tA + 0.6, (ankA[0] + bA[0], ankA[1] + bA[2]), yA, -4.0, 18.0, (0.2, 0.5))
        stA["swing"] = lowarc
        # B pivots on the ball with the body, then lifts and steps off into the walk
        tB = tA + 0.45
        y0 = stop["yaw"]
        # the heel lifts first (the shoe then touches only at its ball and tip), then the foot pivots on the ball
        tp = tw + 0.12
        stop["yawFn"] = lambda tt, y0=y0, tp=tp: y0 + 0.7 * (heading(max(tp, min(tt, tA + 0.12))) - heading(tp))
        stop["t_off"] = tA + 0.12
        stop["pkeys"] = [kv for kv in stop["pkeys"] if kv[0] < tw - 0.02] + [(tw - 0.02, 0.0), (tp, 14.0), (tA + 0.12, 22.0)]
        stop["swing"] = lowarc
        walk = []
        tt_ = tB
        f_ = fb
        exit_t = None
        exit_foot = None
        while tt_ < t_end - 0.3:
            vv = max(speed(tt_), 0.8)
            stw = plant(path, f_, tt_, vv)
            walk.append(stw)
            if tt_ >= tw + TURN["rampDur"] + TURN["exitAfter"] and exit_t is None:
                exit_t = tt_
                exit_foot = f_
            dt = 1.0 / cadence(vv)
            for _ in range(4):
                dt = 1.0 / cadence(max(speed(tt_ + 0.5 * dt), 0.8))
            tt_ += dt
            f_ = "R" if f_ == "L" else "L"
        # the last two plants before the exit sit exactly where the walk-back loop has its feet at that phase, so the
        # hand-over into the loop is seamless (both stance legs match, not only the swinging one)
        wl0 = BA.gait_loop("bowl_walk_back", TURN["walkV"], rate=60, carry=0.0, bowl_arm_scale=1.0)
        nW = len(wl0["frames"]) - 1
        jx = 0 if exit_foot == "L" else nW // 2
        pos_l, rot_l = fk(wl0["frames"][jx])
        gl = wl0["frames"][jx]["ground"]
        Mx = path.at(exit_t)
        hx = heading(exit_t)
        ix = next(i for i, sw_ in enumerate(walk) if abs(sw_["t_on"] - exit_t) < 1e-9)
        for sw_ in walk[max(0, ix - 1):ix + 1]:
            side_ = sw_["foot"]
            if sw_ is not walk[ix] and not (wl0["frames"][jx]["contacts"] & (1 if side_ == "L" else 2)):
                continue
            bpt = vadd(pos_l[IDX["foot" + side_]], qrot(rot_l[IDX["foot" + side_]], BALL))
            rel = (bpt[0] - gl[0], 0.0, bpt[2] - gl[1])
            w_ = rot_y(hx, rel)
            sw_["ball"] = (Mx[0] + w_[0], Mx[1] + w_[2])
            sw_["yaw"] = hx + (sw_["yaw"] - heading(sw_["t_on"]))
        settle_offs(path, [stA] + walk)
        walk[0]["swing"] = lowarc
        turn_st = [stA] + walk
        turn_info.update({"tA": tA, "tB": tB, "exit": exit_t, "exitFoot": exit_foot, "lowarc": lowarc})
    stances = st + [bfc, ffc] + fol + [stop] + turn_st
    feet = {}
    vfun = speed
    for side in "LR":
        feet[side] = FootTrack(side, [s for s in stances if s["foot"] == side], path, default_swing_keys(vfun))
    # the gait phase before the entry (for the approach upper body)
    P = 2 * step
    phase = lambda tt: tt / P
    pelvis0, spine0, chest0, look0, arms0 = BA.upper_body(phase, lambda tt: ve, lambda tt: 0.0)
    # hips height: approach keys before the entry, authored keys through the delivery, running keys after
    hk = [kv for kv in hips_y_keys(st[:-1] + [dict(entry, t_off=step * 0.33)], lambda tt: ve) if kv[0] < 0.0]
    # the entry strike sits at the approach loop's own hips height (seamless join)
    _lp = BA.gait_loop([k for k, v in BA.LOOP_SPEEDS.items() if abs(v - ve) < 1e-9][0], ve, rate=60)
    hk.append((0.0, fk(_lp["frames"][0])[0][0][1]))
    hk += A["hips"]
    fk_keys = hips_y_keys(fol, speed)
    hk += [kv for kv in fk_keys if kv[0] > A["hips"][-1][0] + 0.05]
    if turn:
        wl = BA.gait_loop("bowl_walk_back", TURN["walkV"], rate=60, carry=0.0, bowl_arm_scale=1.0)
        turn_info["walkLoop"] = wl
        wk = [kv for kv in hips_y_keys(turn_st[1:], speed) if kv[0] > turn_info["tB"] + 0.05]
        hk += [(t_stop + 0.25, 0.955), (turn_info["tA"], 0.952)] + wk
        hk = [kv for kv in hk if abs(kv[0] - turn_info["exit"]) > 0.02]
        nW = len(wl["frames"]) - 1
        turn_info["exitFrame"] = 0 if turn_info["exitFoot"] == "L" else nW // 2
        hk.append((turn_info["exit"], fk(wl["frames"][turn_info["exitFrame"]])[0][0][1]))
    else:
        hk += [(t_stop + 0.25, 0.955), (t_end + 1.0, 0.965)]
    hipsY = Curve(sorted(hk))
    # trunk and arms: delivery keys blended in from the approach body
    pelvis = _blend_key_curves(A["pelvis"], 3, pelvis0, (0.0, 0.1))
    spine = _blend_key_curves(A["spine"], 3, spine0, (0.0, 0.1))
    chest = _blend_key_curves(A["chest"], 3, chest0, (0.0, 0.1))
    if A.get("frontKnee"):
        # the front knee follows an authored profile through the delivery stride (braced at the release): the hips
        # height there is solved from it on the planted front foot, every 10 ms, and joins the authored keys
        kc = Curve(A["frontKnee"])
        ta_, tb_ = A["frontKnee"][0][0], A["frontKnee"][-1][0]
        th_off = OFFSET[IDX["thighL"]]
        solved = []
        tt = ta_
        while tt <= tb_ + 1e-9:
            An = feet["L"].at(tt)[0]
            M = path.at(tt)
            yo, pi_, ro = pelvis(tt)
            o = qrot(qmul(qmul(qy(path.head(tt) + yo), qx(pi_)), qz(ro)), th_off)
            dx, dz = M[0] + o[0] - An[0], M[1] + o[2] - An[2]
            L = math.sqrt(0.43 ** 2 + 0.42 ** 2 + 2 * 0.43 * 0.42 * math.cos(math.radians(kc(tt))))
            solved.append((tt, An[1] + math.sqrt(max(0.0, L * L - dx * dx - dz * dz)) - o[1]))
            tt += 0.01
        hipsY = Curve(sorted([kv for kv in hk if not (ta_ - 1e-9 <= kv[0] <= tb_ + 1e-9)] + solved))
    # the upper arm takes the least shoulder twist for its swing; the forearm pronates to turn the palm to the batter
    armR_keys = []
    for t, v in A["armR"]:
        if v is None:
            continue
        tw = 0.0 if v[0] > 20 else v[2]
        roll = 0.5 * v[2] if (v[0] > 20 and A.get("palmRoll", False)) else 0.0
        armR_keys.append((t, (v[0], v[1], tw, v[3], v[4] + roll, v[5][0], v[5][1], v[5][2])))
    for i in range(1, len(armR_keys)):
        p0 = armR_keys[i - 1][1][2]
        p = armR_keys[i][1][2]
        while p - p0 > 180:
            p -= 360
        while p - p0 < -180:
            p += 360
        armR_keys[i] = (armR_keys[i][0], armR_keys[i][1][:2] + (p,) + armR_keys[i][1][3:])

    def flatten(a):
        return (a[0], a[1], a[2], a[3], a[4], a[5][0], a[5][1], a[5][2])

    armR = _blend_key_curves([(0.0, None)] + armR_keys, 8, lambda tt: flatten(arms0(tt)["R"]), (0.0, 0.16))
    # the front arm: directions converted to the chest frame at each key time
    chest_world = lambda tt: _chest_world(path, heading, pelvis, spine, chest, tt)
    l_keys = []
    l_dirs = []
    for tt, val in A["armLdir"]:
        if val is None:
            continue
        d, flex = val[0], val[1]
        if len(val) > 2 and val[2] == "local":
            dl = vnorm(d)
        else:
            cw = chest_world(tt)
            hq = qy(heading(tt))
            dl = qrot(qconj(cw), qrot(hq, d))
        phi, lat = _dir_to_phi_lat(dl, 1.0)
        l_keys.append((tt, (phi, lat, 0.0, flex, -50.0, 6.0, 0.0, 0.0)))
        l_dirs.append(dl)
    # unwrap phi so it interpolates the short way
    for i in range(1, len(l_keys)):
        p0 = l_keys[i - 1][1][0]
        p = l_keys[i][1][0]
        while p - p0 > 180:
            p -= 360
        while p - p0 < -180:
            p += 360
        l_keys[i] = (l_keys[i][0], (p,) + l_keys[i][1][1:])
    # quaternion keys for the upper arm (least twist, continuous), interpolated in the log map (C1, shortest path)
    from bowler_kin import arm_rot, qslerp
    qkeys = []
    prev = None
    for (tt, v), d_loc in zip(l_keys, l_dirs):
        q = _swing_only(d_loc)
        if prev is not None and (q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3]) < 0:
            q = (-q[0], -q[1], -q[2], -q[3])
        qkeys.append((tt, _qlog(q)))
        prev = q
    lcurves = [Curve([(tt, lv[k]) for tt, lv in qkeys]) for k in range(3)]
    lrest = [Curve([(tt, v[k]) for tt, v in l_keys]) for k in range(3, 8)]
    l_blend = (0.0, 0.26)

    def armL_q(tt):
        base = arms0(tt)["L"]
        qb = arm_rot(1.0, base[0], base[1], base[2])
        rb = (base[3], base[4], base[5][0], base[5][1], base[5][2])
        qd = _qexp(tuple(c(tt) for c in lcurves))
        rd = tuple(c(tt) for c in lrest)
        w = smoothstep(l_blend[0], l_blend[1], tt)
        return qslerp(qb, qd, w), tuple(rb[k] * (1 - w) + rd[k] * w for k in range(5))

    # after the follow-through strides begin, the arms settle into a decelerating run, then hang
    fol_phase_t0 = T["follow1"]

    def arms(tt):
        from bowler_kin import arm_rot, qslerp
        r = armR(tt)
        ql, lr = armL_q(tt)
        if tt > A["settle"][0]:
            w = smoothstep(A["settle"][0], A["settle"][1], tt)
            vv = speed(tt)
            g = runness(vv)
            ph = (tt - fol_phase_t0) * cadence(max(vv, 0.9)) * 0.5
            c = math.cos(2 * math.pi * ph)
            amp = (8.0 + 20.0 * g) * (1 - smoothstep(A["fade"][0], A["fade"][1], tt))
            hl = (6.0 - amp * c, 9.0, 0.0, 18.0 + 50.0 * g, -40.0, 0.0, 0.0, 0.0)
            hr = (364.0 + amp * c, 13.0, 0.0, 18.0 + 50.0 * g, 50.0, 0.0, 0.0, 0.0)
            ql = qslerp(ql, arm_rot(1.0, hl[0], hl[1], hl[2]), w)
            lr = tuple(lr[k] * (1 - w) + hl[k + 3] * w for k in range(5))
            r = tuple(r[k] * (1 - w) + hr[k] * w for k in range(8))
        ftw = max(-85.0, min(85.0, r[4]))
        out = {"L": ("q", ql, lr[0], max(-85.0, min(85.0, lr[1])), (lr[2], lr[3], lr[4])),
               "R": (r[0], r[1], r[2], r[3], ftw, (r[5], r[6], r[7]))}
        if turn and tt > turn_info["tA"] - 0.2:
            wv = smoothstep(turn_info["tA"] - 0.2, turn_info["exit"] - 0.15, tt)
            wa = walk_body[4](tt)
            for sd, sg in (("L", 1.0), ("R", -1.0)):
                m = wa[sd]
                o = out[sd]
                qo = o[1] if o[0] == "q" else arm_rot(sg, o[0], o[1], o[2])
                rest_o = (o[2], o[3], o[4]) if o[0] == "q" else (o[3], o[4], o[5])
                qm = arm_rot(sg, m[0], m[1], m[2])
                qq = qslerp(qo, qm, wv)
                fl = rest_o[0] * (1 - wv) + m[3] * wv
                ftw2 = rest_o[1] * (1 - wv) + m[4] * wv
                hd = tuple(rest_o[2][k] * (1 - wv) + m[5][k] * wv for k in range(3))
                out[sd] = ("q", qq, fl, ftw2, hd)
        return out

    def look(tt):
        # eyes on the batter until the follow-through, then along the run (and round with the turn)
        w = smoothstep(A["lookAway"][0], A["lookAway"][1], tt)
        return (heading(tt) * w, 2.0 + 6.0 * smoothstep(0.6, 0.9, tt) * (1 - w))

    walk_body = None
    if turn:
        from bowler_gait import gait_phase_fn
        wphase0 = gait_phase_fn(turn_st[1:])
        # the walk loop's phase: left strikes at integers; align to the exit strike (loop frame 0)
        ph_ex = 0.0 if turn_info["exitFoot"] == "L" else 0.5
        wphase = lambda tt: wphase0(tt) - wphase0(turn_info["exit"]) + ph_ex
        vw = lambda tt: speed(tt)
        walk_body = BA.upper_body(wphase, vw, lambda tt: 0.0, carry=0.0, bowl_arm_scale=1.0)
        p_del, s_del, c_del = pelvis, spine, chest
        wb = lambda tt: smoothstep(turn_info["tA"] - 0.2, turn_info["exit"] - 0.15, tt)
        pelvis = lambda tt: tuple(a_ * (1 - wb(tt)) + b_ * wb(tt) for a_, b_ in zip(p_del(tt), walk_body[0](tt)))
        spine = lambda tt: tuple(a_ * (1 - wb(tt)) + b_ * wb(tt) for a_, b_ in zip(s_del(tt), walk_body[1](tt)))
        chest = lambda tt: tuple(a_ * (1 - wb(tt)) + b_ * wb(tt) for a_, b_ in zip(c_del(tt), walk_body[2](tt)))
        look_del = look
        look = lambda tt: (look_del(tt)[0] * (1 - wb(tt)) + heading(tt) * wb(tt), look_del(tt)[1] * (1 - wb(tt)) + 2.0 * wb(tt))

    # the approach loop's stance surge and sway carry on until the gather, then fade
    from bowler_approach import SURGE
    tmid = 0.5 * contact_time(ve)
    eps = SURGE * runness(ve)
    fade = lambda tt: 1.0 - smoothstep(0.0, 0.1, tt)
    surge = lambda tt: fade(tt) * -(eps * ve * step / (2 * math.pi)) * math.sin(2 * math.pi * (2 * (tt / P) - tmid / step))
    sway = lambda tt: fade(tt) * (0.012 * runness(ve) + 0.02 * (1 - runness(ve))) * math.cos(2 * math.pi * ((tt / P) - tmid / (2 * step)))
    # pin the swinging (right) leg at the entry to the approach loop's pose, so the loop -> delivery join is seamless
    pins = {}
    loop = BA.gait_loop(loop_id, ve, rate=60)
    from bowler_gait import _angles
    from bowler_kin import qconj as _qc
    f0, f1, fm = loop["frames"][0], loop["frames"][1], loop["frames"][-2]
    def leg_angles(fr_, side):
        return _angles(fr_["q"][IDX["thigh" + side]], fr_["q"][IDX["shin" + side]], fr_["q"][IDX["foot" + side]])
    a0 = leg_angles(f0, "R")
    rates = [(leg_angles(f1, "R")[k] - leg_angles(fm, "R")[k]) * 30.0 for k in range(7)]
    pins["R"] = {"t": 0.0, "angles": a0, "rates": rates}
    if turn:
        wl = turn_info["walkLoop"]
        nW = len(wl["frames"]) - 1
        j = turn_info["exitFrame"]
        g0, g1, gm = wl["frames"][j], wl["frames"][(j + 1) % nW], wl["frames"][(j - 1) % nW]
        sw_side = "R" if turn_info["exitFoot"] == "L" else "L"
        pin_x = {"t": turn_info["exit"], "angles": leg_angles(g0, sw_side),
                 "rates": [(leg_angles(g1, sw_side)[k] - leg_angles(gm, sw_side)[k]) * 30.0 for k in range(7)]}
        if sw_side == "R":
            pins["R"] = [pins["R"], pin_x]
        else:
            pins["L"] = [pin_x]
        Pw = len(wl["frames"][:-1]) / 60.0
        stw = Pw / 2.0
        tmw = 0.5 * contact_time(TURN["walkV"])
        sway_d = sway
        wsw = lambda tt: smoothstep(turn_info["tB"], turn_info["exit"] - 0.1, tt)
        sway = lambda tt: sway_d(tt) + wsw(tt) * 0.02 * math.cos(2 * math.pi * (((tt - turn_info["exit"]) / Pw) + ph_ex - tmw / (2 * stw)))
    desc = {
        "swingPins": pins,
        "surge": surge, "lateral": sway,
        "T": t_end - t0, "rate": rate, "t0": t0, "path": path, "feet": feet, "hipsY": hipsY, "pelvis": pelvis,
        "spine": spine, "chest": chest, "look": look, "arms": arms, "ballHand": "handR", "groundSigma": A["groundSigma"],
        # a braced front leg may reach further, only through the delivery stride (`reachLimit`: limit, from, to)
        **({"reachLimit": (lambda tt, r=A["reachLimit"]: LAW_REACH + (r[0] - LAW_REACH) * smoothstep(r[1] - 0.04, r[1], tt)
                           * (1.0 - smoothstep(r[2], r[2] + 0.04, tt)))} if "reachLimit" in A else {}),
        "groundBlend": (0.0, T["backFoot"] - 0.05) if not turn else (0.0, T["backFoot"] - 0.05, turn_info["tw"] - 0.2, turn_info["tw"] + 0.2),
    }
    frames = synth(desc)
    return frames, {"path": path, "speed": speed, "stances": stances, "t0": t0, "t_stop": t_stop, "step": step,
                    "turn": turn_info}


def _swing_only(d):
    """The shortest rotation taking the rest direction of an arm (0, -1, 0) to d: zero twist about the bone."""
    from bowler_kin import vcross, vdot, vnorm as vn
    a = (0.0, -1.0, 0.0)
    b = vn(d)
    c = vdot(a, b)
    if c < -0.9999:
        return (1.0, 0.0, 0.0, 0.0)
    ax = vcross(a, b)
    w = 1.0 + c
    n = math.sqrt(ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2 + w * w)
    return (ax[0] / n, ax[1] / n, ax[2] / n, w / n)


def _qlog(q):
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z)
    if n < 1e-9:
        return (0.0, 0.0, 0.0)
    a = 2 * math.atan2(n, w)
    return (x / n * a, y / n * a, z / n * a)


def _qexp(v):
    a = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if a < 1e-9:
        return (0.0, 0.0, 0.0, 1.0)
    s = math.sin(a / 2) / a
    return (v[0] * s, v[1] * s, v[2] * s, math.cos(a / 2))


def _min_twist(phi, lat, side_sign, prev=None):
    """Upper-arm twist with the least shoulder twist, staying near the previous key's (continuity)."""
    from bowler_kin import arm_rot, swing_twist_y
    best = None
    for tw in range(-180, 181, 2):
        _, t = swing_twist_y(arm_rot(side_sign, phi, lat, tw))
        cost = t + (0.0 if prev is None else 0.6 * abs(tw - prev))
        if best is None or cost < best[0] - 1e-9:
            best = (cost, tw)
    return float(best[1])


def _chest_world(path, heading, pelvis, spine, chest, t):
    yo, pt, rl = pelvis(t)
    R = qmul(qmul(qy(heading(t) + yo), qx(pt)), qz(rl))
    return qmul(qmul(R, qeuler(*spine(t))), qeuler(*chest(t)))


# ----------------------------------------------------------------------------------------------------------------
# Spin: a short, bouncy approach at jog speed, a small hop, side-on at back-foot contact, a high arm and a pivot over
# the front foot. Finger spin turns the forearm through release (the "door handle"); wrist spin flicks the wrist.
# ----------------------------------------------------------------------------------------------------------------

_SPIN_COMMON = {
    "entrySpeed": BA.LOOP_SPEEDS["bowl_jog"],
    "times": {"takeoff": 0.15, "apex": 0.23, "backFoot": 0.31, "frontFoot": 0.47, "release": 0.56, "backToe": 0.47,
              "frontOff": 0.82, "follow1": 0.80},
    "speed": [(-2.0, None), (0.0, None), (0.15, 2.95), (0.31, 2.8), (0.47, 2.25), (0.56, 1.9), (0.7, 1.7),
              (0.85, 1.55), (1.2, 1.05), (1.55, 0.45), (1.8, 0.0), (2.6, 0.0)],
    "heading": [(0.0, 0.0), (0.6, 0.0), (1.1, 14.0), (1.8, 26.0)],
    "hips": [(0.075, 0.9), (0.15, 0.912), (0.23, 0.945), (0.31, 0.905), (0.40, 0.89), (0.47, 0.888), (0.56, 0.9),
             (0.68, 0.905)],
    "spine": [(0.0, None), (0.15, (4, -4, 0)), (0.23, (-2, -8, 2)), (0.31, (-4, -12, 3)), (0.43, (-2, -12, 2)),
              (0.56, (10, 8, -8)), (0.70, (20, 16, -6)), (0.85, (20, 14, -2)), (1.1, (10, 4, 0)), (1.4, (6, 0, 0))],
    "chest": [(0.0, None), (0.15, (2, -4, 0)), (0.23, (-2, -10, 2)), (0.31, (-3, -14, 3)), (0.43, (-1, -14, 2)),
              (0.56, (8, 12, -8)), (0.70, (12, 16, -5)), (0.85, (10, 10, -1)), (1.2, (3, 0, 0))],
    "armLdir": [(0.0, None), (0.20, ((0.2, 0.3, 0.93), 60)), (0.31, ((0.15, 0.75, 0.64), 30)),
                (0.43, ((0.16, 0.5, 0.85), 22)), (0.53, ((0.62, -0.05, 0.78), 50, "local")),
                (0.64, ((0.55, -0.55, 0.62), 85, "local")), (0.78, ((0.45, -0.8, 0.38), 92, "local")),
                (0.95, ((0.35, -0.88, 0.3), 76, "local")), (1.08, ((0.3, -0.88, 0.35), 66, "local"))],
    "backFoot": {"lat": -0.08, "ahead": 0.10, "yaw": -78.0, "pOn": 2.0, "pOff": 30.0, "flat": (0.12, 0.4)},
    "swingL": {"kneeMax": 82.0, "kneeAt": 0.38, "hipOver": 6.0, "kneeLate": 6.0},
    "swingR": {"kneeMax": 84.0, "kneeAt": 0.38, "hipOver": 2.0, "kneeLate": 8.0},
    "swingRfollow": {"kneeMax": 84.0, "kneeAt": 0.42, "hipOver": 2.0, "kneeLate": 8.0},
    "swingLfollow": {"kneeMax": 66.0, "kneeAt": 0.42, "hipOver": 2.0, "kneeLate": 8.0},
    "followLat": 0.11,
    "settle": (0.85, 1.4), "fade": (1.3, 1.8), "lookAway": (0.8, 1.4), "takeoffPitch": 40.0, "tEnd": 2.6,
    "groundSigma": 0.14,
}

SPIN_OFF = dict(_SPIN_COMMON, name="off", **{
    "pelvis": [(0.0, None), (0.15, (-14, 6, 0)), (0.23, (-42, 4, 1)), (0.31, (-62, 5, 2)), (0.40, (-56, 6, 0)),
               (0.47, (-40, 8, -3)), (0.56, (-6, 14, -6)), (0.70, (24, 20, -4)), (0.85, (40, 18, -2)),
               (1.05, (30, 12, 0)), (1.4, (8, 8, 0))],
    # finger spin: the forearm turns through release ("door handle"), the wrist stays firm
    "armR": [(0.0, None), (0.15, (-30, 16, 20, 90, 60, (-10, 0, 0))), (0.23, (-40, 20, 14, 72, 45, (-10, 0, 0))),
             (0.31, (16, 22, 0, 40, 20, (6, 0, 0))), (0.40, (62, 14, 0, 20, 6, (12, 0, 0))),
             (0.45, (88, 10, 0, 15, -20, (16, 0, 0))), (0.50, (124, 6, 0, 13, -24, (16, 0, 0))),
             (0.55, (170, 1, 0, 12, 0, (8, -4, 0))), (0.60, (216, -2, 0, 14, 30, (-4, -8, 0))),
             (0.67, (262, -6, 0, 18, 48, (-12, -6, 0))), (0.78, (310, -8, 0, 24, 40, (-12, 0, 0))),
             (0.92, (344, -6, 0, 30, 20, (-8, 0, 0))), (1.05, (360, 4, 0, 38, 10, (-6, 0, 0))),
             (1.3, (364, 12, 0, 50, 40, (-6, 0, 0)))],
    "frontFoot": {"lat": -0.06, "stride": 0.80, "yaw": -26.0, "pOn": -4.0, "pOff": 40.0, "flat": (0.16, 0.42)},
})

SPIN_LEG = dict(_SPIN_COMMON, name="leg", **{
    "pelvis": [(0.0, None), (0.15, (-12, 6, 0)), (0.23, (-36, 4, 1)), (0.31, (-54, 5, 2)), (0.40, (-48, 6, 0)),
               (0.47, (-32, 9, -3)), (0.56, (0, 15, -7)), (0.70, (28, 20, -5)), (0.85, (42, 18, -2)),
               (1.05, (30, 12, 0)), (1.4, (8, 8, 0))],
    # wrist spin: the wrist cocks back and flicks through release, the forearm supinated
    "armR": [(0.0, None), (0.15, (-30, 16, 20, 90, 60, (-10, 0, 0))), (0.23, (-40, 20, 14, 72, 45, (-10, 0, 0))),
             (0.31, (18, 22, 0, 40, 30, (6, 0, 0))), (0.40, (64, 16, 0, 20, 40, (16, 0, -10))),
             (0.45, (90, 12, 0, 15, 55, (26, 0, -22))), (0.50, (126, 7, 0, 13, 60, (30, 0, -26))),
             (0.55, (170, 2, 0, 12, 52, (12, 0, -4))), (0.60, (214, -2, 0, 14, 38, (-8, 0, 18))),
             (0.67, (260, -6, 0, 18, 22, (-16, 0, 22))), (0.78, (310, -8, 0, 24, 10, (-14, 0, 8))),
             (0.92, (344, -6, 0, 30, 10, (-8, 0, 0))), (1.05, (360, 4, 0, 38, 10, (-6, 0, 0))),
             (1.3, (364, 12, 0, 50, 40, (-6, 0, 0)))],
    "frontFoot": {"lat": -0.05, "stride": 0.78, "yaw": -16.0, "pOn": -2.0, "pOff": 40.0, "flat": (0.16, 0.42)},
    "hips": [(0.075, 0.9), (0.15, 0.912), (0.23, 0.945), (0.31, 0.905), (0.40, 0.89), (0.47, 0.884), (0.56, 0.9),
             (0.68, 0.905)],
})
