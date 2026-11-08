"""MOTION-BOWL non-striker clips (original keyframe authoring for the owner).

The non-striker is a right-handed batter holding the bat in his right hand; a left-hander plays the clips through
the canonical mirror (all clips are mirrorable). He stands at the bowler's end on the side away from the bowler's
arm (the runtime places him; for a right-arm-over bowler that is the leg side of the stumps).

Clip frame: he faces +Z, down the pitch. In ns_stance and ns_backup the popping crease is the line z = CREASE_Z in
the clip's start frame: the bat's toe stays grounded behind it (z <= CREASE_Z - 0.04) until the `release` marker,
so he never leaves his ground before the ball is bowled. Bat tracks follow MOTION-SPEC §5.5: bat.grip is the hand
holding the bat, bat.dir runs from the grip to the toe.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from bowler_gait import (  # noqa: E402
    FootTrack, Path, cadence, contact_time, default_swing_keys, gait_phase_fn, hips_y_keys, make_stance, plant,
    rot_y, runness, settle_offs, synth,
)
from bowler_kin import (  # noqa: E402
    BALL, Curve, IDX, fk, qrot, smoothstep, vadd, vlen, vnorm, vscale, vsub,
)
from bowler_gait import _angles  # noqa: E402

CREASE_Z = 1.0
INCLUDE_TURN = True  # ns_turn: explosive class, legs only (lead ruling 2026-11-04)
TURN_V2 = True  # ns_turn v2: in place, on the runtime's sprint profile (lead ruling 2026-11-04: ground step report-only)
GRIP_TO_TOE = 0.84  # hand at the top of the handle; toe of an 0.86 m bat
BAT_HAND_OFFSET = (0.0, -0.075, 0.015)  # grip point in the hand frame

PROV = {
    "author": "MOTION-BOWL (Claude agent for the owner)",
    "method": "original procedural keyframes (curves, foot plants, two-bone leg and arm IK), keyed in Blender 5.2.3 by bowler_blend.py",
    "script": "scripts/blender/motion/nonstriker_clips.py",
    "licence": "owner-made original",
    "sources": [],
}


def _standing(foot, t_on, t_off, x, z, yaw=0.0, p_off=0.0):
    return make_stance(foot, t_on, t_off, (x + rot_y(yaw, (0, 0, BALL[2]))[0], z + rot_y(yaw, (0, 0, BALL[2]))[2]), yaw,
                       0.0, p_off, (0.02, 0.95))


def _bat_frames(frames, toe_fn, grip_fn=None):
    """Adds bat.grip / bat.dir tracks: grip from the right hand, toe from toe_fn(t) (world) or a carried direction."""
    for f in frames:
        pos, rot = fk(f)
        G = vadd(pos[IDX["handR"]], qrot(rot[IDX["handR"]], BAT_HAND_OFFSET))
        T = toe_fn(f["t"], G, rot)
        d = vnorm(vsub(T, G))
        g = f["ground"]
        yaw = g[2]
        gl = rot_y(-yaw, (G[0] - g[0], G[1], G[2] - g[1]))
        dl = rot_y(-yaw, d)
        f.setdefault("tracks", {})
        f["tracks"]["bat.grip"] = gl
        f["tracks"]["bat.dir"] = dl
        f["_toe"] = T
    return frames


def _hold_target(toe, theta_deg, lateral=0.03):
    """Wrist target for a bat grounded at `toe`, leaning theta from vertical towards the batter (handle behind)."""
    th = math.radians(theta_deg)
    up = vnorm((lateral, math.cos(th), -math.sin(th)))
    grip = vadd(toe, vscale(up, GRIP_TO_TOE))
    return vadd(grip, vscale(up, 0.075)), grip


def stance_body(still_hips=0.955):
    pelvis = lambda t: (-8.0, 4.0, 0.0)
    spine = lambda t: (6.0 + 1.0 * math.sin(2 * math.pi * t / 2.0), -6.0, 0.0)
    chest = lambda t: (3.0, -4.0, 0.0)
    look = lambda t: (-12.0 + 4.0 * math.sin(2 * math.pi * t / 2.0), 3.0)
    return pelvis, spine, chest, look


def ns_stance():
    """Loop (2 s): at the crease, bat grounded behind it in the right hand, weight easy, watching the bowler."""
    T = 2.0
    path = Path(lambda t: 0.0, lambda t: 0.0, -1.0, 4.0)
    feet = {"L": FootTrack("L", [_standing("L", -2.0, 5.0, 0.12, -0.02, 8.0)], path, default_swing_keys(lambda t: 0)),
            "R": FootTrack("R", [_standing("R", -2.0, 5.0, -0.13, -0.06, -6.0)], path, default_swing_keys(lambda t: 0))}
    toe = (-0.36, 0.0, CREASE_Z - 0.32)
    W, _ = _hold_target(toe, 14.0)
    pelvis, spine, chest, look = stance_body()

    def arms(t):
        return {"L": (4.0, 10.0, 0.0, 22.0 + 3.0 * math.sin(2 * math.pi * t / 2.0), -60.0, (0.0, 0.0, 0.0)),
                "R": ("ik", W, (-0.3, 0.0, -1.0), (8.0, 0.0, 0.0))}

    desc = {"T": T, "rate": 60, "t0": 0.0, "path": path, "feet": feet,
            "hipsY": lambda t: 0.952 + 0.004 * math.sin(2 * math.pi * t / 2.0), "pelvis": pelvis, "spine": spine,
            "chest": chest, "look": look, "arms": arms, "ballHand": None, "lateral": lambda t: -0.01}
    fr = synth(desc)
    _bat_frames(fr, lambda t, G, rot: toe)
    return fr


def ns_backup(t_release=1.6):
    """One-shot: from the stance he backs up with the bowler, the bat sliding along the ground but its toe behind the
    crease until `release`; then three steps out of his ground into the ready posture (`ready`). Every step is a
    calm 0.4 s swing with a heel-to-flat landing."""
    T_end = t_release + 1.4
    sp = Curve([(0.0, 0.0), (0.45, 0.0), (0.85, 0.6), (1.35, 0.6), (1.6, 0.45), (1.9, 0.9), (2.3, 1.2), (2.7, 0.7),
                (2.95, 0.0), (T_end + 1, 0.0)])
    speed = lambda t: max(0.0, sp(t))
    path = Path(speed, lambda t: 0.0, -1.0, T_end + 1.0)
    st = [_standing("L", -2.0, 0.42, 0.12, -0.02, 8.0, 16.0), _standing("R", -2.0, 0.95, -0.13, -0.06, -6.0, 16.0)]
    # manual steps (foot, strike, toe-off, ankle z, x): before the release the feet stay behind the crease
    steps = [("L", 0.86, t_release + 0.04, 0.42, 0.11), ("R", 1.38, t_release + 0.48, 0.66, -0.12),
             ("L", t_release + 0.42, t_release + 0.92, 1.16, 0.11), ("R", t_release + 0.9, T_end + 2.0, 1.62, -0.13),
             ("L", t_release + 1.26, T_end + 2.0, 1.78, 0.13)]
    for foot, ton, toff, z, x in steps:
        st.append(make_stance(foot, ton, toff, (x, z + BALL[2]), 6.0 if foot == "L" else -6.0, -8.0, 22.0, (0.3, 0.45)))
    for s_ in st:
        s_["swing"] = {"kneeMax": 40.0, "kneePass": 14.0, "kneeAt": 0.42, "hipOver": 0.0, "kneeLate": 5.0, "footMid": -8.0}
    feet = {f: FootTrack(f, [s for s in st if s["foot"] == f], path, default_swing_keys(speed)) for f in "LR"}
    # bat toe: slides from the stance spot to just behind the crease, held there through the release, then lifts
    toe_z = Curve([(0.0, CREASE_Z - 0.32), (0.55, CREASE_Z - 0.32), (1.4, CREASE_Z - 0.06), (t_release + 0.02, CREASE_Z - 0.06)])
    lift = lambda t: smoothstep(t_release + 0.02, t_release + 0.35, t)

    def toe_at(t, G=None, rot=None):
        if t <= t_release + 0.02:
            return (-0.36, 0.0, toe_z(t))
        # after the release the bat comes up with the hand: carried, toe forward and off the ground
        w = lift(t)
        base = (-0.36, 0.0, CREASE_Z - 0.06)
        if G is None:
            return base
        carried = vadd(G, vscale(vnorm((0.05, -0.82, 0.57)), GRIP_TO_TOE))
        return tuple(base[k] * (1 - w) + carried[k] * w for k in range(3))

    def arms(t):
        w = lift(t)
        if t <= t_release + 0.02 or w < 1e-6:
            Wt, _ = _hold_target(toe_at(t), 14.0 + 10.0 * smoothstep(0.6, 1.4, t))
        else:
            W0, _ = _hold_target(toe_at(t_release), 24.0)
            M = path.at(t)
            ready = (M[0] - 0.30, 0.86, M[1] + 0.20)
            Wt = tuple(W0[k] * (1 - w) + ready[k] * w for k in range(3))
        return {"L": (6.0 - 10.0 * smoothstep(t_release, T_end, t), 12.0, 0.0, 24.0 + 26.0 * smoothstep(t_release, T_end, t), -60.0, (0.0, 0.0, 0.0)),
                "R": ("ik", Wt, (-0.3, 0.0, -1.0), (8.0, 0.0, 0.0))}

    ready_w = lambda t: smoothstep(t_release, T_end - 0.1, t)
    pelvis = lambda t: (-8.0 * (1 - ready_w(t)), 4.0 + 8.0 * ready_w(t), 0.0)
    spine = lambda t: (6.0 + 10.0 * ready_w(t), -6.0 * (1 - ready_w(t)), 0.0)
    chest = lambda t: (3.0 + 4.0 * ready_w(t), -4.0 * (1 - ready_w(t)), 0.0)
    look = lambda t: (-12.0 * (1 - smoothstep(0.0, t_release, t)), 3.0)
    hk = [(0.0, 0.952), (0.5, 0.95), (1.1, 0.948), (t_release, 0.945), (t_release + 0.7, 0.93), (T_end, 0.905)]
    desc = {"T": T_end, "rate": 60, "t0": 0.0, "path": path, "feet": feet, "hipsY": Curve(sorted(hk)), "pelvis": pelvis,
            "spine": spine, "chest": chest, "look": look, "arms": arms, "ballHand": None}
    fr = synth(desc)
    _bat_frames(fr, toe_at)
    return fr, {"release": t_release, "ready": T_end - 0.05}


def ns_ready():
    """Loop (1.6 s): out of his ground after the release, weight forward on the balls of the feet, bat in hand."""
    T = 1.6
    path = Path(lambda t: 0.0, lambda t: 0.0, -1.0, 3.0)
    feet = {"L": FootTrack("L", [_standing("L", -2.0, 4.0, 0.13, 0.16, 6.0)], path, default_swing_keys(lambda t: 0)),
            "R": FootTrack("R", [_standing("R", -2.0, 4.0, -0.13, 0.0, -6.0)], path, default_swing_keys(lambda t: 0))}

    def arms(t):
        b = 0.01 * math.sin(2 * math.pi * t / T)
        return {"L": (-4.0, 12.0, 0.0, 50.0, -60.0, (0.0, 0.0, 0.0)),
                "R": ("ik", (-0.30, 0.86 + b, 0.20), (-0.3, 0.0, -1.0), (8.0, 0.0, 0.0))}

    desc = {"T": T, "rate": 60, "t0": 0.0, "path": path, "feet": feet,
            "hipsY": lambda t: 0.905 + 0.006 * math.sin(2 * math.pi * t / T), "pelvis": lambda t: (0.0, 12.0, 0.0),
            "spine": lambda t: (16.0, 0.0, 0.0), "chest": lambda t: (7.0, 0.0, 0.0), "look": lambda t: (0.0, 2.0),
            "arms": arms, "ballHand": None}
    fr = synth(desc)
    _bat_frames(fr, lambda t, G, rot: vadd(G, vscale(vnorm((0.05, -0.82, 0.57)), GRIP_TO_TOE)))
    return fr


def ns_run(v=5.2, rate=60):
    """Loop: running between the wickets with the bat in the right hand, angled forward and down."""
    import bowler_approach as BA
    F = int(round(2.0 * rate / cadence(v)))
    P = F / float(rate)
    step = P / 2.0
    path = Path(lambda t: v, lambda t: 0.0, -3 * P, 4 * P)
    stances = []
    t = -3 * P
    foot = "L"
    while t < 4 * P:
        stances.append(plant(path, foot, t, v))
        t += step
        foot = "R" if foot == "L" else "L"
    feet = {s: FootTrack(s, [x for x in stances if x["foot"] == s], path, default_swing_keys(lambda tt: v)) for s in "LR"}
    phase = lambda tt: tt / P
    pelvis, spine, chest, look, arms0 = BA.upper_body(phase, lambda tt: v, lambda tt: 0.0, carry=1.0, bowl_arm_scale=0.45)

    def arms(tt):
        a = arms0(tt)
        r = a["R"]
        return {"L": a["L"], "R": (r[0] - 6.0, r[1] + 4.0, r[2], max(60.0, r[3] - 30.0), r[4], (10.0, 0.0, 0.0))}

    tmid = 0.5 * contact_time(v)
    eps = BA.SURGE * runness(v)
    surge = lambda tt: -(eps * v * step / (2 * math.pi)) * math.sin(2 * math.pi * (2 * (tt / P) - tmid / step))
    sway = lambda tt: 0.012 * math.cos(2 * math.pi * ((tt / P) - tmid / (2 * step)))
    desc = {"T": P, "rate": 60, "t0": 0.0, "path": path, "feet": feet, "hipsY": Curve(hips_y_keys(stances, lambda tt: v)),
            "pelvis": pelvis, "spine": spine, "chest": chest, "look": look, "arms": arms, "ballHand": None,
            "loop": True, "surge": surge, "lateral": sway}
    fr = synth(desc)
    g0 = fr[0]["ground"]
    for f in fr:
        g = f["ground"]
        f["ground"] = (g[0] - g0[0], g[1] - g0[1], g[2])
    _bat_frames(fr, lambda tt, G, rot: vadd(G, vscale(vnorm((0.06, -0.62, 0.78)), GRIP_TO_TOE)))
    return fr, {"speed": v, "P": P}


def ns_ground(v=5.2, turn=False):
    """One-shot: from the run (frame 0 = a left strike at v), slows over three strides and slides the bat over the far
    crease (`ground` = the toe crosses the line on the ground), then stops facing on (`stop`). The crease is
    `crossZ` metres ahead of the clip origin (returned)."""
    import bowler_approach as BA
    step = int(round(2.0 * 60 / cadence(v))) / 60.0 / 2.0
    sp_keys = [(-2.0, v), (0.0, v), (0.3, v * 0.92), (0.6, v * 0.72), (0.9, v * 0.42), (1.15, v * 0.15), (1.38, 0.0)]
    TW = 1.70  # the turn starts after ns_ground's last frame (1.6 s) and its smoothing window, so ns_ground is unchanged
    if turn:
        # pivot on the planted lead foot, step round in a low arc, and run back (heading 180)
        sp_keys += [(TW, 0.0), (TW + 0.4, 0.5), (TW + 0.9, 2.0), (TW + 1.4, 3.6), (TW + 1.95, v), (TW + 6.0, v)]
        head = Curve([(0.0, 0.0), (TW, 0.0), (TW + 0.55, 180.0), (TW + 6.0, 180.0)])
    else:
        sp_keys += [(3.0, 0.0)]
        head = Curve([(0.0, 0.0), (5.0, 0.0)])
    sp = Curve(sp_keys)
    speed = lambda t: max(0.0, sp(t))
    path = Path(speed, head, -2.0, 9.0)
    st = []
    t = 0.0
    foot = "L"
    while t > -1.3:
        st.append(plant(path, foot, t, v))
        t -= step
        foot = "R" if foot == "L" else "L"
    st = sorted(st, key=lambda s: s["t_on"])
    t = step
    foot = "R"
    while t < 0.8:
        st.append(plant(path, foot, t, speed(t)))
        dt = 1.0 / cadence(speed(t + 0.15))
        t += dt
        foot = "R" if foot == "L" else "L"
    # the last, long braking stride: front foot planted, the other trailing, both down to the end
    M = path.at(t)
    lead = foot
    side = 1.0 if lead == "L" else -1.0
    ank = (M[0] + side * 0.12, M[1] + 0.36)
    prev_lead = [x for x in st if x["foot"] == lead][-1]
    prev_lead["swing"] = {"kneeMax": 74.0, "kneeAt": 0.4, "kneePassAbs": 40.0, "hipOver": 2.0}
    lead_st = make_stance(lead, t, 4.0, (ank[0], ank[1] + BALL[2]), 4.0 * side, -12.0, 0.0, (0.15, 0.99))
    # braking lunge: heel strike, a short roll to flat, then the heel lifts (16 deg) as the body comes over the foot,
    # so the ankle never dorsiflexes past its limit
    lead_st["pkeys"] = [(t, -10.0), (t + 0.09, 0.0), (t + 0.22, 0.0), (t + 0.5, 16.0), (4.0, 16.0)]
    st.append(lead_st)
    other = "R" if lead == "L" else "L"
    t2 = t + 0.42
    M2 = path.at(t2)
    ank2 = (M2[0] - side * 0.14, M2[1] - 0.05)
    o_st = make_stance(other, t2, 4.0, (ank2[0], ank2[1] + BALL[2]), -8.0 * side, -6.0, 0.0, (0.15, 0.99))
    o_st["pkeys"] = [(t2, -6.0), (t2 + 0.09, 0.0), (t2 + 0.16, 0.0), (t2 + 0.45, 18.0), (4.0, 18.0)]
    st.append(o_st)
    turn_st = []
    exit_t, exit_foot, tB = None, None, None
    if turn:
        lowarc = {"kneeMax": 40.0, "kneeAt": 0.45, "kneePassAbs": 24.0, "hipOver": 0.0, "kneeLate": 3.0, "footMid": -6.0}
        # the trailing foot lifts first and steps round in a low arc while the lead foot pivots on its ball
        o_st["t_off"] = TW + 0.06
        o_st["pkeys"] = [kv for kv in o_st["pkeys"] if kv[0] < TW - 0.05] + [(TW + 0.06, 26.0)]
        o_st["swing"] = lowarc
        tA = TW + 0.40
        hA = head(tA)
        sideO = 1.0 if other == "L" else -1.0
        MA = path.at(tA)
        aA = rot_y(hA, (sideO * 0.13, 0.0, 0.04))
        yA = hA + 4.0 * sideO
        bA = rot_y(yA, (0.0, 0.0, BALL[2]))
        stA = make_stance(other, tA, tA + 0.5, (MA[0] + aA[0] + bA[0], MA[1] + aA[2] + bA[2]), yA, -4.0, 26.0, (0.2, 0.45))
        stA["swing"] = lowarc
        y0 = lead_st["yaw"]
        lead_st["yawFn"] = lambda tt, y0=y0: y0 + 0.75 * (head(min(tt, tA + 0.1)) - 0.0)
        lead_st["t_off"] = tA + 0.08
        lead_st["pkeys"] = [kv for kv in lead_st["pkeys"] if kv[0] < TW - 0.02] + [(TW - 0.02, 16.0), (tA + 0.08, 30.0)]
        lead_st["swing"] = lowarc
        tB = tA + 0.40
        run = []
        tt_ = tB
        f_ = lead
        while tt_ < TW + 4.0:
            vv = max(speed(tt_), 0.8)
            run.append(plant(path, f_, tt_, vv))
            if tt_ >= TW + 1.95 and exit_t is None:
                exit_t, exit_foot = tt_, f_
            dt = 1.0 / cadence(vv)
            for _ in range(4):
                dt = 1.0 / cadence(max(speed(tt_ + 0.5 * dt), 0.8))
            tt_ += dt
            f_ = "R" if f_ == "L" else "L"
        # the last two plants sit where the ns_run loop has its feet at the exit phase (a seamless hand-over)
        lr, _ = ns_run()
        nR = len(lr) - 1
        jx = 0 if exit_foot == "L" else nR // 2
        pos_l, rot_l = fk(lr[jx])
        gl = lr[jx]["ground"]
        Mx = path.at(exit_t)
        hx = head(exit_t)
        ix = next(i_ for i_, sw_ in enumerate(run) if abs(sw_["t_on"] - exit_t) < 1e-9)
        for sw_ in run[max(0, ix - 1):ix + 1]:
            bit = 1 if sw_["foot"] == "L" else 2
            if sw_ is not run[ix] and not (lr[jx]["contacts"] & bit):
                continue  # that foot is in the air in the loop at this phase (running): its swing is pinned instead
            bpt = vadd(pos_l[IDX["foot" + sw_["foot"]]], qrot(rot_l[IDX["foot" + sw_["foot"]]], BALL))
            w_ = rot_y(hx, (bpt[0] - gl[0], 0.0, bpt[2] - gl[1]))
            sw_["ball"] = (Mx[0] + w_[0], Mx[1] + w_[2])
            sw_["yaw"] = hx + (sw_["yaw"] - head(sw_["t_on"]))
        settle_offs(path, [stA] + run)
        run[0]["swing"] = lowarc
        turn_st = [stA] + run
        st += turn_st
    # the trailing stance before the brake ends a little after the lead lands
    feet = {f: FootTrack(f, [s for s in st if s["foot"] == f], path, default_swing_keys(speed)) for f in "LR"}
    t_ground = t + 0.12
    P = 2 * step
    phase_a = gait_phase_fn([x for x in st if x not in turn_st])
    if turn:
        phase_r0 = gait_phase_fn(turn_st[1:])
        ph_x = 0.0 if exit_foot == "L" else 0.5
        phase = lambda tt: phase_a(tt) if tt < TW else (phase_r0(tt) - phase_r0(exit_t) + ph_x)
    else:
        phase = phase_a
    pelvis0, spine0, chest0, look, arms0 = BA.upper_body(phase, speed, lambda tt: 0.0, carry=1.0, bowl_arm_scale=0.45)
    brake = lambda tt: smoothstep(t - 0.45, t, tt) * (1.0 - (smoothstep(TW, TW + 0.7, tt) if turn else 0.0))
    if turn:
        look = lambda tt: (head(tt), 2.0)
    pelvis = lambda tt: tuple(a * (1 - brake(tt)) + b * brake(tt) for a, b in zip(pelvis0(tt), (-10.0, 26.0, 0.0)))
    spine = lambda tt: tuple(a * (1 - brake(tt)) + b * brake(tt) for a, b in zip(spine0(tt), (28.0, -10.0, 0.0)))
    chest = lambda tt: tuple(a * (1 - brake(tt)) + b * brake(tt) for a, b in zip(chest0(tt), (10.0, -6.0, 0.0)))
    cross_z = path.at(t_ground)[1] + 1.10

    def reach_target(tt):
        M = path.at(tt)
        return (M[0] - 0.42, 0.42, M[1] + 0.62)

    def arms(tt):
        a = arms0(tt)
        r = a["R"]
        w = brake(tt)
        run_r = (r[0] - 6.0, r[1] + 4.0, r[2], max(60.0, r[3] - 30.0), r[4], (10.0, 0.0, 0.0))
        if w <= 1e-6:
            return {"L": a["L"], "R": run_r}
        # reach the bat out low and forward to slide it over the line (FK, blended from the running carry)
        reach = (-62.0 + 360.0 * 0, 10.0, 0.0, 8.0, 60.0, (10.0, 0.0, 0.0))
        rr = tuple(run_r[k] * (1 - w) + reach[k] * w for k in range(5)) + (run_r[5],)
        return {"L": tuple(a["L"][k] * (1 - w) + (20.0, 14.0, 0.0, 70.0, -60.0)[k] * w for k in range(5)) + ((0.0, 0.0, 0.0),),
                "R": rr}

    base_st = [x for x in st if x not in turn_st]
    hk = [kv for kv in hips_y_keys(base_st[:-2], speed) if kv[0] < t - 0.1] + [(t + 0.1, 0.86), (t + 0.5, 0.875), (TW, 0.875)]
    if not turn:
        hk += [(3.0, 0.89)]
    else:
        hk += [(TW + 0.40, 0.89)] + [kv for kv in hips_y_keys(turn_st[1:], speed) if kv[0] > tB + 0.05]
        hk = [kv for kv in hk if abs(kv[0] - exit_t) > 0.02]
        hk.append((exit_t, fk(lr[jx])[0][0][1]))
    T_clip = 1.6
    pins = {}
    if turn:
        T_clip = math.ceil(exit_t * 60 - 1e-9) / 60.0
        sw_side = "R" if exit_foot == "L" else "L"
        la = lambda fr_, sd: _angles(fr_["q"][IDX["thigh" + sd]], fr_["q"][IDX["shin" + sd]], fr_["q"][IDX["foot" + sd]])
        g0, g1, gm = lr[jx], lr[(jx + 1) % nR], lr[(jx - 1) % nR]
        pins[sw_side] = [{"t": exit_t, "angles": la(g0, sw_side), "rates": [(la(g1, sw_side)[k] - la(gm, sw_side)[k]) * 30.0 for k in range(7)]}]
    desc = {"T": T_clip, "rate": 60, "t0": 0.0, "path": path, "feet": feet, "hipsY": Curve(sorted(hk)), "pelvis": pelvis,
            "spine": spine, "chest": chest, "look": look, "arms": arms, "ballHand": None, "swingPins": pins}
    fr = synth(desc)

    def toe(tt, G, rot):
        w = brake(tt)
        carried = vadd(G, vscale(vnorm((0.06, -0.62, 0.78)), GRIP_TO_TOE))
        h = max(0.0, min(G[1], GRIP_TO_TOE * 0.98))
        if w <= 1e-6:
            return carried
        slide = vadd(G, (0.0, -h, math.sqrt(GRIP_TO_TOE ** 2 - h * h)))
        return tuple(carried[k] * (1 - w) + slide[k] * w for k in range(3))

    _bat_frames(fr, toe)
    # `ground`: the first frame the toe is down on the far side; the crease is 5 cm behind that point
    touch = next(f for f in fr if f["t"] > t - 0.2 and f["_toe"][1] < 0.012)
    mk = {"ground": touch["t"], "crossZ": touch["_toe"][2] - 0.05}
    mk["stop"] = min(1.55, t + 0.5)
    if turn:
        mk.update({"go": tB, "exit": exit_t, "exitFoot": exit_foot, "runFrame": jx})
    return fr, mk


# ns_turn v2: the in-place quick turn, authored on WEB-HUMANS' sprintProfile (nonStriker.ts): braking at `brake`
# m/s^2 from `vin` to rest at the body's turning point (`ground`, the physics completion), a `dwell` s pivot at rest,
# then a push-off at `push` m/s^2 into ns_run's phase at its speed. Times in clip seconds, t = 0 = a right strike.
TURN2 = {"vin": 8.7, "brake": 10.0, "dwell": 0.15, "push": 7.0,
         "strikes": (0.245, 0.47, 0.665), "tcs": (0.09, 0.13, 0.17), "ahead": (0.30, 0.36, 0.38), "plantLat": 0.12,
         "rotPre": 0.10, "rotPost": 0.18, "share": 0.8, "heelUp": 15.0, "yawRamp": (0.83, 0.93),
         "tr": 0.06, "lOff": 0.16, "lStrike": 1.40, "roundLat": 0.13, "roundAhead": 0.10, "roundYaw": 176.0,
         "hips": (0.885, 0.87, 0.855, 0.83, 0.83, 0.84, 0.87),
         "pelvisB": (-10.0, 24.0, 0.0), "spineB": (36.0, -10.0, 0.0), "chestB": (14.0, -6.0, 0.0),
         "reach": (-90.0, 6.0, 0.0, 0.0, 60.0)}


def _sprint_cadence(v):
    """The gait law above 6.6 m/s (sprinting): quicker steps and longer contacts than the run law extrapolates."""
    e = max(0.0, v - 6.6)
    return cadence(v) + 0.14 * e * e


def _sprint_contact(v):
    e = max(0.0, v - 6.6)
    return contact_time(v) + 0.0068 * e * e


def ns_turn_v2(cfg=None):
    """One-shot, in place (MOTION-SPEC §6: the runtime drives the root from its sprint profile and takes the heading
    from this clip's yaw). From a sprint at `vin` (frame 0 = a right strike) he brakes over three strides onto the
    planted left foot, reaches the bat over the line as he comes to rest (`ground` = `dwell_start`), pivots on the
    left forefoot while the right foot steps round in a low arc (`push`: it lands facing back), and pushes off into
    ns_run's phase at ns_run's speed (`exitR`: the pose is ns_run at phase 0.5)."""
    import bowler_approach as BA
    import bowler_build as BB
    q = dict(TURN2, **(cfg or {}))
    vin, brake, dwell, push = q["vin"], q["brake"], q["dwell"], q["push"]
    lr, lmk = ns_run()
    vout = lmk["speed"]
    nR = len(lr) - 1
    P_run = nR / 60.0
    tg = vin / brake
    te = tg + dwell
    tx = te + vout / push

    def speed(t):
        if t < 0.0:
            return vin
        if t < tg:
            return vin - brake * t
        if t < te:
            return 0.0
        if t < tx:
            return push * (t - te)
        return vout

    h0, h1 = tg - q["rotPre"], te + q["rotPost"]
    head = lambda t: 180.0 * smoothstep(h0, h1, t)
    T0, T1 = -2.0, tx + 2.0
    path = Path(speed, head, T0, T1)
    # running in at vin: strikes every sprint step back from the entry right strike
    step_in = 1.0 / _sprint_cadence(vin)
    st = []
    t = 0.0
    foot = "R"
    while t > -1.3:
        st.append(plant(path, foot, t, vin, tc=(q["tcs"][0] if t == 0.0 else _sprint_contact(vin))))
        t -= step_in
        foot = "R" if foot == "L" else "L"
    st = sorted(st, key=lambda s_: s_["t_on"])
    if q.get("r0pOff") is not None:
        s0_ = st[-1]
        s0_["pkeys"] = s0_["pkeys"][:-1] + [(s0_["t_off"], q["r0pOff"])]
    if q.get("r0Swing"):
        st[-1]["swing"] = q["r0Swing"]
    if q.get("_steady"):
        # the reference: the same sprint carried on at vin with no braking (the entry check compares frame 0 with it)
        sp_ = Path(lambda t_: vin, lambda t_: 0.0, T0, T1)
        t = step_in
        foot = "L"
        while t < 1.2:
            st.append(plant(sp_, foot, t, vin, tc=_sprint_contact(vin)))
            t += step_in
            foot = "R" if foot == "L" else "L"
        fe = {f: FootTrack(f, [x for x in st if x["foot"] == f], sp_, default_swing_keys(lambda t_: vin)) for f in "LR"}
        ph_ = gait_phase_fn(st)
        pe_, spn_, ch_, lk_, ar0_ = BA.upper_body(ph_, lambda t_: vin, lambda t_: 0.0, carry=1.0, bowl_arm_scale=0.45)

        def ar_(tt):
            a0 = ar0_(tt)
            r = a0["R"]
            return {"L": a0["L"], "R": (r[0] - 6.0, r[1] + 4.0, r[2], max(60.0, r[3] - 30.0), r[4], (10.0, 0.0, 0.0))}

        d_ = {"T": 1.2, "rate": 60, "t0": -0.6, "path": sp_, "feet": fe, "hipsY": Curve(hips_y_keys(st, lambda t_: vin)),
              "pelvis": pe_, "spine": spn_, "chest": ch_, "look": lk_, "arms": ar_, "ballHand": None}
        return synth(d_), d_
    # braking strides: left, right, then the left plant foot, each landing further ahead of the hips
    t1, t2, t3 = q["strikes"]
    L1 = plant(path, "L", t1, speed(t1), tc=q["tcs"][1], ahead=q["ahead"][0])
    R2 = plant(path, "R", t2, speed(t2), tc=q["tcs"][2], ahead=q["ahead"][1])
    M3 = path.at(t3)
    a3 = rot_y(head(t3), (q["plantLat"], 0.0, q["ahead"][2]))
    y3 = head(t3) + 3.0
    b3 = rot_y(y3, (0.0, 0.0, BALL[2]))
    L3 = make_stance("L", t3, te + q["lOff"], (M3[0] + a3[0] + b3[0], M3[1] + a3[2] + b3[2]), y3, -8.0, 36.0, (0.1, 0.9))
    # heel strike, a short roll to flat, the heel up clear of the ball before the foot turns on its tip, toe-off
    hu = q["heelUp"]
    L3["pkeys"] = [(t3, -8.0), (t3 + 0.08, 0.0), (q["yawRamp"][0], hu), (te, hu + 3.0), (L3["t_off"] - 0.05, hu + 10.0),
                   (L3["t_off"], 36.0)]
    yr0, yr1 = q["yawRamp"]
    L3["yawFn"] = lambda tt, y3=y3: y3 + q["share"] * head(tt) * smoothstep(yr0, yr1, tt)
    L3["pivot"] = "tip"
    L3["yawEnd"] = True
    # the right foot steps round in a low arc and lands facing back (`push`)
    tr = te + q["tr"]
    Mr = path.at(tr)
    hr = head(tr)
    ar = rot_y(hr, (-q["roundLat"], 0.0, q["roundAhead"]))
    yr = q["roundYaw"]
    br = rot_y(yr, (0.0, 0.0, BALL[2]))
    # push-off strides: left at lStrike, then the right exit strike at tx (ns_run's right strike, phase 0.5)
    ts_l = q["lStrike"]
    l_off = tx - (P_run / 2 - contact_time(vout))  # ns_run's left toe-off before its right strike
    Rr = make_stance("R", tr, ts_l - 0.10, (Mr[0] + ar[0] + br[0], Mr[1] + ar[2] + br[2]), yr, -4.0, 40.0, (0.2, 0.5))
    La = plant(path, "L", ts_l, speed(ts_l))
    La["t_off"] = l_off
    La["pkeys"] = [(ts_l, 2.0), (ts_l + 0.04, 0.0), (ts_l + 0.07, 0.0), (l_off, LAW_P_OFF)]
    # the exit right strike and the strides after it: ns_run's foot positions relative to its root
    run_after = []
    tt_ = tx
    f_ = "R"
    while tt_ < T1 - 0.5:
        s_ = plant(path, f_, tt_, vout)
        jx = nR // 2 if f_ == "R" else 0
        pos_l, rot_l = fk(lr[jx])
        gl = lr[jx]["ground"]
        bpt = vadd(pos_l[IDX["foot" + f_]], qrot(rot_l[IDX["foot" + f_]], BALL))
        Mx = path.at(tt_)
        w_ = rot_y(head(tt_), (bpt[0] - gl[0], 0.0, bpt[2] - gl[1]))
        s_["ball"] = (Mx[0] + w_[0], Mx[1] + w_[2])
        run_after.append(s_)
        tt_ += P_run / 2.0
        f_ = "R" if f_ == "L" else "L"
    low = {"kneeMax": 50.0, "kneeAt": 0.42, "kneePassAbs": 30.0, "hipOver": 0.0, "kneeLate": 3.0, "footMid": -6.0}
    R2["swing"] = low
    L3["swing"] = {"kneeMax": 72.0, "kneeAt": 0.4, "kneePassAbs": 44.0, "hipOver": 2.0}
    stances = st + [L1, R2, L3, Rr, La] + run_after
    feet = {f: FootTrack(f, [x for x in stances if x["foot"] == f], path, default_swing_keys(speed)) for f in "LR"}
    # upper body: the running body in and out (phase aligned to ns_run at the exit), the brake-and-reach pose between
    pa = gait_phase_fn(st + [L1, R2, L3])
    pr = gait_phase_fn([Rr, La] + run_after)
    phase = lambda tt: pa(tt) if tt < tg else (pr(tt) - pr(tx) + 0.5)
    pelvis0, spine0, chest0, look0, arms0 = BA.upper_body(phase, speed, lambda tt: 0.0, carry=1.0, bowl_arm_scale=0.45)
    wb = lambda tt: smoothstep(0.25, t3, tt) * (1.0 - smoothstep(te - 0.02, te + 0.40, tt))
    mix = lambda a_, b_, w: tuple(a_[k] * (1 - w) + b_[k] * w for k in range(len(a_)))
    pelvis = lambda tt: mix(pelvis0(tt), q["pelvisB"], wb(tt))
    spine = lambda tt: mix(spine0(tt), q["spineB"], wb(tt))
    chest = lambda tt: mix(chest0(tt), q["chestB"], wb(tt))
    look = lambda tt: (head(tt), look0(tt)[1] * (1 - wb(tt)) + 2.0 * wb(tt))

    def arms(tt):
        a0 = arms0(tt)
        r = a0["R"]
        w = wb(tt)
        run_r = (r[0] - 6.0, r[1] + 4.0, r[2], max(60.0, r[3] - 30.0), r[4], (10.0, 0.0, 0.0))
        if w <= 1e-6:
            return {"L": a0["L"], "R": run_r}
        reach = q["reach"]
        return {"L": mix(a0["L"][:5], (20.0, 14.0, 0.0, 70.0, -60.0), w) + ((0.0, 0.0, 0.0),),
                "R": mix(run_r[:5], reach, w) + (run_r[5],)}

    hy = q["hips"]
    if q.get("lawHips", True):
        # the running law's hips through the braking strides (strike, mid-stance, flight), lowered by `hipsDrop`
        hk = [(t_, h_ - q.get("hipsDrop", 0.0) * smoothstep(0.0, t3, t_)) for t_, h_ in hips_y_keys(st + [L1, R2], speed)
              if t_ < t3 - 0.03]
        hk += [(t3, hy[2]), (tg, hy[3]), (te, hy[4]), (tr + 0.04, hy[5]), (ts_l, hy[6])]
    else:
        hk = [kv for kv in hips_y_keys(st, speed) if kv[0] < -0.02]
        hk += [(t1, hy[0]), (t2, hy[1]), (t3, hy[2]), (tg, hy[3]), (te, hy[4]), (tr + 0.04, hy[5]), (ts_l, hy[6])]
    hk += [kv for kv in hips_y_keys(run_after, speed) if kv[0] > tx + 0.05]
    hk.append((tx, fk(lr[nR // 2])[0][0][1]))
    la = lambda fr_, sd: _angles(fr_["q"][IDX["thigh" + sd]], fr_["q"][IDX["shin" + sd]], fr_["q"][IDX["foot" + sd]])
    jx = nR // 2
    g0, g1, gm = lr[jx], lr[jx + 1], lr[jx - 1]
    pins = {"L": [{"t": tx, "angles": la(g0, "L"), "rates": [(la(g1, "L")[k] - la(gm, "L")[k]) * 30.0 for k in range(7)]}]}

    ts0 = -0.6
    T_syn = math.ceil((tx + 0.4 - ts0) * 60) / 60.0
    desc = {"T": T_syn, "rate": 60, "t0": ts0, "path": path, "feet": feet, "hipsY": Curve(sorted(hk)), "pelvis": pelvis,
            "spine": spine, "chest": chest, "look": look, "arms": arms, "ballHand": None, "swingPins": pins,
            "clearPins": {"L": [p_["t"] for p_ in pins["L"]]}}
    fr = synth(desc)
    touchW = lambda tt: smoothstep(t3 - 0.10, tg - 0.06, tt) * (1.0 - smoothstep(te + 0.02, te + 0.16, tt))

    def toe(tt, G, rot):
        w = touchW(tt)
        carried = vadd(G, vscale(vnorm((0.06, -0.62, 0.78)), GRIP_TO_TOE))
        if w <= 1e-6:
            return carried
        h = max(0.0, min(G[1], GRIP_TO_TOE * 0.98))
        hd = rot_y(head(tt), (0.0, 0.0, 1.0))
        r_ = math.sqrt(GRIP_TO_TOE ** 2 - h * h)
        slide = vadd(G, (hd[0] * r_, -h, hd[2] * r_))
        d_ = vnorm(vsub(mix(carried, slide, w), G))
        if G[1] + GRIP_TO_TOE * d_[1] < 0.0:
            # the rigid bat never dips into the ground while it lifts: its toe rides the ground instead
            dy = -min(G[1], GRIP_TO_TOE) / GRIP_TO_TOE
            hz = math.hypot(d_[0], d_[2]) or 1.0
            k_ = math.sqrt(max(0.0, 1.0 - dy * dy)) / hz
            d_ = (d_[0] * k_, dy, d_[2] * k_)
        return vadd(G, vscale(d_, GRIP_TO_TOE))

    _bat_frames(fr, toe)
    T_clip = math.ceil(tx * 60 - 1e-9) / 60.0
    out = BB.cut(fr, ts0, 60, 0.0, T_clip)
    for f in out:
        f["t"] = round(f["t"], 9)
    info = {"tg": tg, "te": te, "tx": tx, "tr": tr, "lStrike": ts_l, "frames": fr, "ts0": ts0, "path": path, "desc": desc,
            "stances": stances}
    mk = {"ground": tg, "dwell_start": tg, "dwell_end": te, "push": tr, "exitR": tx}
    return out, mk, info


LAW_P_OFF = 42.0


def ns_walk_back(dist=1.4):
    """One-shot: once the ball is dead, from the ready posture he steps back to his crease (four calm backward steps,
    still facing the striker's end, toe touching first) and grounds the bat behind the line (`grounded`)."""
    T = 2.97
    sp = Curve([(-1.0, 0.0), (0.25, 0.0), (0.75, -0.55), (2.1, -0.55), (2.6, 0.0), (4.0, 0.0)])
    speed = lambda t: sp(t)
    path = Path(speed, lambda t: 0.0, -1.0, 4.5)
    z_end = path.at(4.0)[1]
    st = [_standing("L", -2.0, 0.86, 0.13, 0.16, 6.0, 3.0), _standing("R", -2.0, 0.42, -0.13, 0.0, -6.0, 3.0)]
    # each stance ends a short double support after the other foot lands; every swing lasts about 0.36 s
    plan_steps = [("R", 0.78, 1.30, -0.13, -0.24), ("L", 1.22, 1.74, 0.12, -0.55), ("R", 1.66, 2.20, -0.13, -0.88),
                  ("L", 2.12, 4.5, 0.12, z_end + 0.06), ("R", 2.56, 4.5, -0.13, z_end - 0.04)]
    for foot, ton, toff, x, z in plan_steps:
        stn = make_stance(foot, ton, toff, (x, z + BALL[2]), 6.0 if foot == "L" else -6.0, 4.0, 10.0, (0.3, 0.7))
        if toff > 4.0:
            stn["pkeys"] = [(ton, 4.0), (ton + 0.1, 0.0), (toff, 0.0)]
        st.append(stn)
    for s_ in st:
        s_["swing"] = {"kneeMax": 34.0, "kneePass": 4.0, "kneeAt": 0.4, "hipOver": -6.0, "kneeLate": 2.0, "footMid": -12.0}
    feet = {f: FootTrack(f, [s for s in st if s["foot"] == f], path, default_swing_keys(lambda t: 0.6)) for f in "LR"}
    settle = lambda t: smoothstep(2.2, 2.95, t)
    toe_ground = (-0.36, 0.0, z_end + 0.68)

    def toe_at(t, G=None, rot=None):
        carried = vadd(G, vscale(vnorm((0.05, -0.82, 0.57)), GRIP_TO_TOE)) if G is not None else (0, 0, 0)
        w = settle(t)
        return tuple(carried[k] * (1 - w) + toe_ground[k] * w for k in range(3))

    def arms(t):
        M = path.at(t)
        carry = (M[0] - 0.30, 0.86, M[1] + 0.20)
        Wg, _ = _hold_target(toe_ground, 14.0)
        w = settle(t)
        W = tuple(carry[k] * (1 - w) + Wg[k] * w for k in range(3))
        return {"L": (-4.0 + 8.0 * w, 12.0, 0.0, 50.0 - 28.0 * w, -60.0, (0.0, 0.0, 0.0)),
                "R": ("ik", W, (-0.3, 0.0, -1.0), (8.0, 0.0, 0.0))}

    w0 = lambda t: smoothstep(0.0, 0.7, t)
    desc = {"T": T, "rate": 60, "t0": 0.0, "path": path, "feet": feet,
            "hipsY": Curve([(0.0, 0.905), (0.7, 0.93), (2.3, 0.94), (3.0, 0.952)]),
            "pelvis": lambda t: (-8.0 * settle(t), 12.0 * (1 - w0(t)) + 4.0 * w0(t), 0.0),
            "spine": lambda t: (16.0 * (1 - w0(t)) + 6.0 * w0(t), -6.0 * settle(t), 0.0),
            "chest": lambda t: (7.0 * (1 - w0(t)) + 3.0 * w0(t), -4.0 * settle(t), 0.0),
            "look": lambda t: (-12.0 * settle(t), 3.0), "arms": arms, "ballHand": None}
    fr = synth(desc)
    _bat_frames(fr, toe_at)
    return fr, {"grounded": 2.95, "creaseZ": toe_ground[2] + 0.32}


def _decimate(frames, k, loop=False):
    if k == 1:
        return frames
    body = frames[:-1] if loop else frames
    n = len(body)
    out = []
    for i in range(0, n, k):
        f = dict(body[i])
        bits = f["contacts"]
        for j in range(i - k + 1, i + k):
            jj = j % n if loop else min(max(j, 0), n - 1)
            bits &= body[jj]["contacts"] | ~3
        f["contacts"] = bits
        out.append(f)
    if loop:
        c = dict(frames[-1])
        c["contacts"] = out[0]["contacts"]
        out.append(c)
    return out


def build_all():
    from bowler_kin import write_vms  # noqa: F401
    clips = []
    tracks = {"bat.grip": "position", "bat.dir": "direction"}

    def add(cid, frames, rate, markers, loop=False, speed=None, steps=0, aliases=None):
        if speed is None:
            from bowler_build import mean_speed
            speed = 0.0 if loop else round(mean_speed(frames, rate), 3)
        clips.append({"id": cid, "pack": "nonstriker", "role": "nonstriker", "rate": rate, "loop": loop,
                      "mirrorable": True, "codec": 1, "speedMps": speed, "cycleSteps": steps, "markers": markers,
                      "frames": frames, "tracks": tracks, "provenance": PROV})
        if aliases:
            clips[-1]["mirrorAliases"] = aliases

    add("ns_stance", _decimate(ns_stance(), 4, loop=True), 15, {}, loop=True)
    fr, mk = ns_backup()
    add("ns_backup", _decimate(fr, 2), 30, mk)
    add("ns_ready", _decimate(ns_ready(), 4, loop=True), 15, {}, loop=True)
    fr, mk = ns_run()
    add("ns_run", fr, 60, {}, loop=True, speed=mk["speed"], steps=2)
    fr, mk = ns_ground()
    add("ns_ground", fr, 60, {k: v for k, v in mk.items() if k != "crossZ"})
    if INCLUDE_TURN and TURN_V2:
        # ns_turn v2: the in-place quick turn on the runtime's sprint profile; ns_turn_r is its canonical mirror (a
        # right turn), so the runtime turns towards the pitch on either lane
        fr, mk, _ = ns_turn_v2()
        add("ns_turn", fr, 60, mk, aliases={"ns_turn_r": "mirror"})
    elif INCLUDE_TURN:
        # the 180 deg turn at the far crease, from ns_ground's last frame back into ns_run (exitL: phase 0, exitR: 0.5)
        import bowler_build as BB
        frt, mkt = ns_ground(turn=True)
        ex = math.ceil(mkt["exit"] * 60 - 1e-9) / 60.0
        tfr = BB.cut(frt, 0.0, 60, 1.6, ex)
        add("ns_turn", tfr, 60, {"go": mkt["go"] - 1.6, ("exitL" if mkt["exitFoot"] == "L" else "exitR"): mkt["exit"] - 1.6})
    fr, mk = ns_walk_back()
    add("ns_walk_back", _decimate(fr, 2), 30, {k: v for k, v in mk.items() if k != "creaseZ"})
    return clips


def main():
    from bowler_kin import write_vms
    repo = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(repo, "assets-src", "motion", "nonstriker")
    os.makedirs(out, exist_ok=True)
    clips = build_all()
    for c in clips:
        write_vms(os.path.join(out, c["id"] + ".vms.json"), c)
    print({c["id"]: len(c["frames"]) for c in clips})


if __name__ == "__main__":
    main()
