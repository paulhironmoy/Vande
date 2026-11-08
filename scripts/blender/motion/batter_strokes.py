"""
TRACKB: the striker's stroke overlays on VC17 (MOTION-SPEC v1.3.1; lead ruling 2026-11-04 04:59Z for physics 5f).

  blender -b --factory-startup --python scripts/blender/motion/batter_strokes.py -- bake <out-dir> [--assets <dir>]
  blender -b --factory-startup --python scripts/blender/motion/batter_strokes.py -- render <out-dir>

Overlay one-shots: the mask is hips, spine, chest, neck, head and both legs. The arms and hands are left to the base
pose, and WEB-HUMANS reaches them to the physics bat (`batAt`). The clips are right-handed and mirrorable. Frame 0 of
every clip equals `bat_ready_hold_compact` frame 0.

Every clip starts at the player's input (5f: the physics body is the stance until the swing starts). Its footwork
plants by `contact`, which aligns to the physics contact, and the follow-through after `contact` follows the shot
family, never the outcome. The input -> contact part is authored at the shortest duration that keeps every §9 cap at
1x (the bake searches it). The weight transfer is a smooth profile that runs on past contact, so little of it falls
before contact; the stride is low and quick. WEB-HUMANS warps the striding foot onto the physics pad.
  bat_drive, bat_fwd_defence                         forward: the front foot strides low towards the bowler
  bat_backfoot_punch, bat_pull, bat_back_defence     back: the back foot steps back and across, the front foot stays
  bat_leave                                          no stride: the body stays in the stance; the bat goes to shoulder
                                                     arms (bat tracks, since a leave has no physics bat); `contact`
                                                     is the ball passing
"""
import json
import math
import os
import sys

import bpy  # noqa: F401  (Blender)
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import batter_vc17lib as V  # noqa: E402

# The anticipation module's set-up and solver (its file ends with `main()`, which is cut).
_src = open(os.path.join(HERE, "batter_anticipation.py")).read()
_cut = _src.rstrip().rfind("\nmain()")
A = {"__name__": "batter_anticipation_lib", "__file__": os.path.join(HERE, "batter_anticipation.py")}
exec(compile(_src[:_cut], A["__file__"], "exec"), A)

RATE = 60
MASK = ["hips", "spine", "chest", "neck", "head", "thighL", "shinL", "footL", "thighR", "shinR", "footR"]
SOLE = -0.065
HEEL = Vector((0, SOLE, -0.05))
BALL = Vector((0, SOLE, 0.135))
TIP = Vector((0, SOLE, 0.20))


def smooth(u):
    return A["smooth"](u)


def cosine(u):
    u = max(0.0, min(1.0, u))
    return 0.5 - 0.5 * math.cos(math.pi * u)


def foot_rot(yaw, pitch):
    """Foot world rotation: yaw about Y (toe towards +X for +yaw), then pitch about the foot's X (toe down > 0)."""
    return V.ry(yaw) @ V.rx(pitch)


def leg(Wh, Ph, side, ankle, pole, Wfoot):
    th = "thigh" + side
    h = Ph + Wh @ Vector(V.OFFSET[th])
    knee, a_eff, miss = V.two_bone(h, ankle, V.THIGH, V.SHIN, pole)
    dt = (knee - h).normalized()
    ds = (a_eff - knee).normalized()
    bend = ds - dt * ds.dot(dt)
    hint = -bend if bend.length > 1e-5 else (pole - h)
    Wt = V.limb_frame(dt, hint)
    alpha = math.degrees(dt.angle(ds)) if bend.length > 1e-6 else 0.0
    ls = V.rx(alpha)
    Ws = Wt @ ls
    return {th: Wh.inverted() @ Wt, "shin" + side: ls, "foot" + side: Ws.inverted() @ Wfoot}, miss


def ankle_from(anchor_kind, anchor, Wfoot):
    """The ankle from a fixed contact point of the rigid shoe (heel, ball or sole tip) and the foot's rotation."""
    local = {"heel": HEEL, "ball": BALL, "tip": TIP}[anchor_kind]
    return anchor - Wfoot @ local


def pose2(c):
    """Like the anticipation solver, with trunk yaw/side-bend, head yaw/nod and rigid-shoe feet (heel strike, heel
    lift) as extra controls. With none of them set it equals the anticipation pose exactly."""
    q = {b: Quaternion() for b in V.BONES}
    Wh = V.ry(c["hipsYaw"]) @ V.rx(c["hipsPitch"]) @ V.rz(c.get("hipsRoll", 0.0))
    Ph = c["hips"]
    q["hips"] = Wh
    q["spine"] = V.rx(c["spinePitch"]) @ V.ry(c.get("spineYaw", 0.0))
    q["chest"] = V.rx(c["chestPitch"]) @ V.rz(c["chestRoll"]) @ V.ry(c.get("chestYaw", 0.0))
    W, P = V.fk(q, Ph - V.HIPS_REST)
    RH = V.ry(c.get("headYaw", 90.0)) @ V.rx(c["headNod"])
    rel = W["chest"].inverted() @ RH
    neck = Quaternion().slerp(rel, 0.4)
    q["neck"] = neck
    q["head"] = neck.inverted() @ rel
    feet = {}
    for s in "LR":
        Wf = foot_rot(c["yaw" + s], c.get("pitch" + s, 0.0))
        if c.get("anchor" + s):
            kind, pt = c["anchor" + s]
            ank = ankle_from(kind, pt, Wf)
        else:
            ank = c["ankle" + s]
        toe = V.ry(c["yaw" + s]) @ Vector((0, 0, 1))
        pole = ank + toe * 0.6 + Vector((0, 0.5, 0))
        wk = c.get("kneeFollow" + s, 0.0)
        if wk > 0 and c.get("bendLocal"):
            # the knee keeps its frame-0 bend direction relative to the hips (it turns with the pelvis)
            hj = Ph + Wh @ Vector(V.OFFSET["thigh" + s])
            pole = pole.lerp((hj + ank) / 2 + (Wh @ c["bendLocal"][s]) * 0.5, wk)
        sol, miss = leg(Wh, Ph, s, ank, pole, Wf)
        q.update(sol)
        feet[s] = miss
    W, P = V.fk(q, Ph - V.HIPS_REST)
    bp = V.bat_points(c["cap"], c["dir"])
    bp["face"] = A["face_of"](bp["dir"], c.get("faceOpen", 0.0))
    bp["face"] = c["face"].normalized() if c.get("face") is not None else bp["face"]
    misses = {"legL": feet["L"], "legR": feet["R"]}
    sol, am = A["arms"](W, P, c, bp)
    q.update(sol)
    misses.update(am)
    W, P = V.fk(q, Ph - V.HIPS_REST)
    return {"q": q, "hips": Ph - V.HIPS_REST, "W": W, "P": P, "ankleL": P["footL"], "ankleR": P["footR"],
            "contacts": c.get("contacts", 3), "misses": misses, "bat": bp}


# --------------------------------------------------------------------------------------------------------------------
# Frame 0: the end of bat_backlift (= bat_ready_hold frame 0)
# --------------------------------------------------------------------------------------------------------------------

def start_controls():
    base = A["stance_setup"]()
    set_ctrl = A["trigger_controls"](base, 0.55)
    # frame 0 = bat_ready_hold_compact frame 0 (the compact top WEB-HUMANS switched to)
    off, body, _ = A["choose_compact_offset"](set_ctrl)
    if off is None:
        raise SystemExit("no compact top passes §9")
    top = A["backlift_compact_controls"](set_ctrl, 0.25, off, body)
    top = dict(top)
    top.setdefault("headNod", A["STANCE"]["headNod"])
    return top


def bat_with_body(c0, c, f0):
    """Keeps the held bat (and the rigidly gripping hands) in the same place relative to the chest as at frame 0.
    Returns the controls to solve with."""
    f = pose2({**c, "cap": c0["cap"], "dir": c0["dir"]})
    W0, P0 = f0["W"]["chest"], f0["P"]["chest"]
    W1, P1 = f["W"]["chest"], f["P"]["chest"]
    R = W1 @ W0.inverted()
    out = {**c, "cap": P1 + R @ (c0["cap"] - P0), "dir": (R @ c0["dir"]).normalized()}
    if c0.get("face") is not None:
        out["face"] = (R @ c0["face"]).normalized()
    if c0.get("handWorld"):
        out["handWorld"] = {k: R @ v for k, v in c0["handWorld"].items()}
    return out


def lerp(a, b, u):
    return a + (b - a) * u


def blend_ctrl(c0, c1, u, keys):
    c = dict(c0)
    for k in keys:
        a, b = c0[k], c1[k]
        c[k] = lerp(a, b, u)
    return c


# --------------------------------------------------------------------------------------------------------------------
# Stroke design. `k` scales the input -> contact part (T = k seconds); the follow-through after contact is fixed.
# --------------------------------------------------------------------------------------------------------------------

# The front-foot stride is low (3 cm lift) and short enough for the front leg to reach its plant at contact, when the
# hips have travelled only the first part of their weight transfer (`body` seconds, cosine from rest). Physics 5f
# `batterBody('forward')` moves the front pad 0.24 m towards the bowler from its stance pad; WEB-HUMANS warps the foot
# onto it. The back-foot step goes back 8 cm and across 6 cm (cricket's back-and-across).
FWD = {"stride": Vector((0.26, 0.0, -0.02)), "lift": 0.05, "frontYaw": 18.0, "hips": Vector((0.24, -0.10, 0.0)),
       "hipsYaw": 44.0, "chestPitch": 32.0, "chestYaw": 6.0, "headNod": 22.0, "backHeelLift": 14.0, "backPivot": 25.0,
       "body": 0.45,
       "heelPitch": -12.0, "heelRock": 0.08}
BACK = {"step": Vector((-0.08, 0.0, 0.06)), "lift": 0.03, "hips": Vector((-0.10, 0.0, 0.02)), "hipsYaw": 30.0,
        "chestPitch": 10.0, "spinePitch": 8.0, "hipsPitch": 4.0, "headNod": 16.0, "body": 0.35}
# Natural pace (lead ruling 2026-11-04 ~05:55Z): the stride is played at natural pace from the input and compressed
# only for a physics pad/body event. Input -> plant (foot flat) in seconds; the authored contact follows the plant.
NATURAL_T = {"forward": 0.32, "back": 0.28}
CONTACT_AFTER_PLANT = 0.05
FAMILY_FOOT = {"drive": "forward", "fwd_defence": "forward", "punch": "back", "pull": "back", "back_defence": "back"}
AFTER = {"drive": 0.55, "fwd_defence": 0.45, "punch": 0.50, "pull": 0.55, "back_defence": 0.45}


def body_u(t, dur):
    """A smooth weight-transfer profile over `dur` seconds from the input (cosine, zero speed at both ends)."""
    return cosine(t / dur)


PULL_PIVOT = [40.0]


def heel_pivot(c, ank_flat, yaw0, t, t0, pitch_max, lift_dur, t_yaw, yaw_dur, yaw_add):
    """The back (right) foot from flat at `ank_flat`: the heel lifts to `pitch_max` over `lift_dur` from t0, rocking on
    the sole tip, and from t_yaw the foot pivots on the tip by `yaw_add` over `yaw_dur`. The tip stays put; the ball is
    1.2 cm clear (pitch > 10.6°) before the pivot starts."""
    tip = ank_flat + foot_rot(yaw0, 0.0) @ TIP
    c["pitchR"] = pitch_max * cosine((t - t0) / lift_dur)
    c["yawR"] = yaw0 + yaw_add * smooth((t - t_yaw) / yaw_dur)
    c["anchorR"] = ("tip", tip)


def forward_controls(c0, t, T):
    c = dict(c0)
    u = body_u(t, FWD["body"])
    c["hips"] = c0["hips"] + FWD["hips"] * u
    c["hipsYaw"] = lerp(c0["hipsYaw"], FWD["hipsYaw"], u)
    c["chestPitch"] = lerp(c0["chestPitch"], FWD["chestPitch"], u)
    c["chestYaw"] = FWD["chestYaw"] * u
    c["headNod"] = lerp(c0["headNod"], FWD["headNod"], smooth(t / max(T, 1e-3)))
    # the front foot strides from the input; the heel touches `heelRock` s before T, and the foot rocks flat about
    # the heel by T (the plant)
    a0 = c0["ankleL"]
    land = a0 + FWD["stride"]
    Th = T - FWD["heelRock"]
    WfL_flat = foot_rot(FWD["frontYaw"], 0.0)
    heel_pt = land + WfL_flat @ HEEL
    WfL_heel = foot_rot(FWD["frontYaw"], FWD["heelPitch"])
    ank_heel = ankle_from("heel", heel_pt, WfL_heel)
    contacts = 3
    if t < Th:
        ul = t / Th
        s_ = cosine(ul)
        c["ankleL"] = a0 + (ank_heel - a0) * s_ + Vector((0, FWD["lift"] * math.sin(math.pi * ul) ** 2, 0))
        c["yawL"] = lerp(c0["yawL"], FWD["frontYaw"], s_)
        c["pitchL"] = FWD["heelPitch"] * smooth(ul / 0.7) if ul < 0.7 else FWD["heelPitch"]
        contacts &= ~1
    else:
        ur = cosine((t - Th) / FWD["heelRock"])
        c["yawL"] = FWD["frontYaw"]
        c["pitchL"] = FWD["heelPitch"] * (1.0 - ur)
        c["anchorL"] = ("heel", heel_pt)
    # as the weight goes forward the back heel lifts (the rigid shoe rocks on its sole tip, so nothing goes under
    # the ground) and, once the ball is clear, the foot pivots on the tip so the back hip's twist stays inside 50°
    heel_pivot(c, c0["ankleR"], c0["yawR"], t, 0.0, FWD["backHeelLift"], 0.20, 0.16, 0.45, FWD["backPivot"])
    c["kneeFollowR"] = u
    c["contacts"] = contacts
    return c


def back_controls(c0, t, T):
    c = dict(c0)
    u = body_u(t, BACK["body"])
    c["hips"] = c0["hips"] + BACK["hips"] * u
    c["hipsYaw"] = lerp(c0["hipsYaw"], BACK["hipsYaw"], u)
    c["hipsPitch"] = lerp(c0["hipsPitch"], BACK["hipsPitch"], u)
    c["chestPitch"] = lerp(c0["chestPitch"], BACK["chestPitch"], u)
    c["spinePitch"] = lerp(c0["spinePitch"], BACK["spinePitch"], u)
    c["headNod"] = lerp(c0["headNod"], BACK["headNod"], smooth(t / max(T, 1e-3)))
    ub = t / T
    contacts = 3
    if ub < 1:
        s_ = cosine(ub)
        c["ankleR"] = c0["ankleR"] + BACK["step"] * s_ + Vector((0, BACK["lift"] * math.sin(math.pi * ub) ** 2, 0))
        contacts &= ~2
    else:
        c["ankleR"] = c0["ankleR"] + BACK["step"]
    c["contacts"] = contacts
    return c


def family_extra(c, t, T, fam):
    """Family-specific motion on top of the footwork: small before contact, the family's follow-through after."""
    Tc = T + CONTACT_AFTER_PLANT
    pre = smooth(t / Tc) if t <= Tc else 1.0
    post = 0.0 if t <= Tc else smooth((t - Tc) / 0.45)
    if fam == "drive":
        c["headNod"] += 6.0 * pre + 4.0 * post
        c["hipsYaw"] += 12.0 * post
        c["chestYaw"] = c.get("chestYaw", 0.0) + 14.0 * post
        c["chestPitch"] -= 6.0 * post
    elif fam == "fwd_defence":
        c["headNod"] += 8.0 * pre
        c["chestPitch"] += 2.0 * pre
    elif fam == "punch":
        c["chestYaw"] = c.get("chestYaw", 0.0) - 6.0 * pre - 10.0 * post
        c["headNod"] += 4.0 * pre
    elif fam == "pull":
        c["hipsYaw"] += 10.0 * pre + 45.0 * post
        c["chestYaw"] = c.get("chestYaw", 0.0) + 4.0 * pre + 20.0 * post
    elif fam == "back_defence":
        c["headNod"] += 8.0 * pre
        c["hips"] = c["hips"] + Vector((0.0, 0.01, 0.0)) * pre
    return c


def pull_front_foot(c0, t, T):
    """After contact the pull's front foot comes round towards leg (lifted, contact cleared) and lands opened."""
    t0 = T + 0.10
    if t <= t0:
        return None
    u = (t - t0) / 0.30
    tgt = c0["ankleL"] + Vector((-0.12, 0.0, -0.10))
    if u >= 1:
        return {"ankleL": tgt, "yawL": c0["yawL"] + 35.0, "contacts": 3}
    s_ = cosine(u)
    return {"ankleL": c0["ankleL"] + (tgt - c0["ankleL"]) * s_ + Vector((0, 0.04 * math.sin(math.pi * u) ** 2, 0)),
            "yawL": c0["yawL"] + 35.0 * s_, "contacts": 2}


def stroke_controls(c0, t, T, fam):
    foot = FAMILY_FOOT[fam]
    c = forward_controls(c0, t, T) if foot == "forward" else back_controls(c0, t, T)
    c = family_extra(c, t, T, fam)
    if fam == "pull" and t > T:
        # the pull turns on the planted back foot: heel up on the sole tip, then a pivot towards leg
        heel_pivot(c, c0["ankleR"] + BACK["step"], c0["yawR"], t, T, 14.0, 0.12, T + 0.08, 0.40, PULL_PIVOT[0])
    if fam == "pull":
        # from the input the back knee turns with the pelvis (the pull opens the hips early)
        c["kneeFollowR"] = smooth(t / (T + 0.45))
    if fam == "pull":
        extra = pull_front_foot(c0, t, T)
        if extra:
            c.update(extra)
            c.pop("anchorL", None)
    return c


LEAVE = {"lift": 0.30, "nominalContact": 0.13}
# Candidates for the leave (searched by choose_leave, the most shoulder-arms first): the blade tilted toe-up behind
# the back shoulder by `tilt` degrees, the hands raised by `up` and moved out towards off by `out` (m), the share of
# the extra turn the hands follow, and the elbow poles at the end (the compact top's poles first). Tilt 0 and no
# lift is holding the compact top, which is already out of the ball's line, behind the body.
# Lead ruling 2026-11-04 ~06:40Z: the leave holds the compact top (no grip roll, no wrist over its cap); only the
# head turns to watch the ball past. The search below is kept at that single candidate. (A shoulder-arms leave from
# the compact top needs about 42° of grip roll: tilt 60, follow 0.3 in bake 11.)
LEAVE_TILT = [0.0]
LEAVE_UP = [0.0]
LEAVE_OUT = [0.0]
LEAVE_FOLLOW = [1.0]
LEAVE_POLE_R = [None]
LEAVE_POLE_L = [None]


def leave_controls(c0, t, prm):
    """The body stays in the stance. From the input, over 0.30 s, the blade tilts toe-up by `tilt` behind the back
    shoulder and the hands rise by `up` and move out by `out` (shoulder arms; with tilt 0 and no lift the compact top
    is held, already out of the ball's line); the hands follow `follow` of the blade's extra turn (1 = rigid grip, the
    rest is the grip rolling on the handle) and the elbow poles ease to the chosen ones. The head follows the ball
    through after it passes (from the nominal ball passing, 0.13 s after the input). Played at 1x from the input:
    there is no physics contact to align."""
    c = dict(c0)
    u = smooth(t / LEAVE["lift"])
    d0 = c0["dir"]
    face0 = c0["face"]
    up = Vector((0.0, 1.0, 0.0))
    axis = d0.cross(up)
    axis = axis.normalized() if axis.length > 1e-6 else Vector((0.0, 0.0, 1.0))
    ang = math.radians(prm["tilt"])
    R = Quaternion(axis, ang * u)
    Rh = Quaternion(axis, ang * u * prm["follow"])
    d = (R @ d0).normalized()
    mid0 = c0["cap"] + d0 * 0.075
    mid = mid0 + Vector((0.0, prm["up"], prm["out"])) * u
    c["cap"], c["dir"], c["face"] = mid - d * 0.075, d, (R @ face0).normalized()
    c["handWorld"] = {k: Rh @ v for k, v in c0["handWorld"].items()}
    for side, key in (("R", "poleR"), ("L", "poleL")):
        p0 = c0.get("pole" + side, A["POLE_BOTTOM"] if side == "R" else A["POLE_TOP"])
        if prm[key] is not None:
            c["pole" + side] = p0.lerp(Vector(prm[key]), u)
    w = smooth((t - LEAVE["nominalContact"]) / 0.40)
    c["headYaw"] = 90.0 - 35.0 * w
    c["headNod"] = c0["headNod"] + 6.0 * w
    c["contacts"] = 3
    return c


def head_bat_clear(f):
    """Distance from the head centre to the bat segment (cap to toe), and from the head centre to each hand."""
    hc = f["P"]["head"] + f["W"]["head"] @ Vector((0.0, 0.09, 0.02))
    cap, toe = f["bat"]["cap"], f["bat"]["toe"]
    ab = toe - cap
    tt = max(0.0, min(1.0, (hc - cap).dot(ab) / ab.length_squared))
    dbat = (hc - (cap + ab * tt)).length
    dh = min((hc - f["P"]["hand" + s_]).length for s_ in "LR")
    return dbat, dh


def choose_leave(c0):
    """The least change from the first candidate that keeps the leave's arms inside §9 over the whole clip: wrists at
    least 0.095 m from the hips-neck axis, elbows inside their Euler limits, wrist swing <= 80°, hand twist beyond
    the forearm <= 10°, arm bones under 1100°/s at 60 Hz, reach, and the bat and the hands clear of the head (0.16 m
    and 0.13 m from its centre). Returns (params, tried)."""
    cands = []
    for it, tl in enumerate(LEAVE_TILT):
        for iu, up_ in enumerate(LEAVE_UP):
            for io, out in enumerate(LEAVE_OUT):
                for ik, kf in enumerate(LEAVE_FOLLOW):
                    for ir, pr in enumerate(LEAVE_POLE_R):
                        for il, pl in enumerate(LEAVE_POLE_L):
                            cost = 0.04 * it + 0.02 * iu + 0.01 * io + 0.03 * ik + 0.01 * ((ir > 0) + (il > 0))
                            cands.append((round(cost, 6), it, iu, io, ik, ir, il))
    cands.sort()
    arm_bones = ["upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR"]
    tried = []
    n = int(round(0.85 * RATE)) + 1
    for cost, it, iu, io, ik, ir, il in cands:
        prm = {"tilt": LEAVE_TILT[it], "up": LEAVE_UP[iu], "out": LEAVE_OUT[io], "follow": LEAVE_FOLLOW[ik],
               "poleR": LEAVE_POLE_R[ir], "poleL": LEAVE_POLE_L[il]}
        prev, why, worst = None, [], {"swing": 0.0, "speed": 0.0, "wristTorso": 1e9, "headBat": 1e9, "headHand": 1e9}
        for i in range(n):
            f = pose2(leave_controls(c0, i / RATE, prm))
            w, e, miss, sw, rem = A["top_checks"](f)
            dbat, dh = head_bat_clear(f)
            sp = 0.0
            if prev is not None:
                for b_ in arm_bones:
                    a_ = math.degrees(prev["q"][b_].rotation_difference(f["q"][b_]).angle)
                    sp = max(sp, min(a_, 360 - a_) * RATE)
            prev = f
            worst = {"swing": max(worst["swing"], sw), "speed": max(worst["speed"], sp),
                     "wristTorso": min(worst["wristTorso"], w), "headBat": min(worst["headBat"], dbat),
                     "headHand": min(worst["headHand"], dh)}
            why = [k for k, bad in (("wristTorso", w < 0.095), ("elbow", not e), ("reach", miss > 0.0005),
                                    ("wristSwing", sw > 80), ("handTwist", rem > 10), ("armSpeed", sp > 1100),
                                    ("headBat", dbat < 0.16), ("headHand", dh < 0.13)) if bad]
            if why:
                break
        tried.append({"prm": prm, "why": why, "stoppedAtFrame": i,
                      "worst": {k: round(v, 3) for k, v in worst.items()}})
        if not why:
            return prm, tried
    return None, tried


# --------------------------------------------------------------------------------------------------------------------
# Bake
# --------------------------------------------------------------------------------------------------------------------

def sample(fn, dur):
    n = int(round(dur * RATE)) + 1
    return [fn(i / RATE) for i in range(n)]


LEG_BONES = {"thighL", "shinL", "footL", "thighR", "shinR", "footR"}


def ang_vel(qa, qb):
    """Angular velocity (deg/s) of qa -> qb over one 60 Hz frame, in qa's frame, as scripts/motion/metrics.mjs."""
    d = qa.inverted() @ qb
    if d.w < 0:
        d = -d
    s_ = math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z)
    if s_ < 1e-12:
        return Vector()
    k = (2 * math.atan2(s_, d.w) / s_ * RATE) * 180 / math.pi
    return Vector((d.x * k, d.y * k, d.z * k))


def caps_ok(frames, leg_acc=290.0):
    """§9 on the masked bones as scripts/motion/metrics.mjs gates them, with a small margin: pose speed (torso 600,
    head 720, limbs 1200°/s), angular acceleration (<= 290°/s per frame; `leg_acc` for the leg bones, which stays 290
    unless the lead approves the explosive cap), hips speed step over centred 1/30 s windows <= 0.29 m/s, and legs
    reaching their ankles. Returns (ok, reason, worst)."""
    n = len(frames)
    caps = {"hips": 600, "spine": 600, "chest": 600, "neck": 720, "head": 720}
    prev = {}
    worst = {"accDegPerSPerFrame": 0.0, "accAt": "", "speedRatio": 0.0, "speedAt": ""}
    fail = None
    for i in range(n - 1):
        for b in MASK:
            w = ang_vel(frames[i]["q"][b], frames[i + 1]["q"][b])
            r = w.length / caps.get(b, 1200)
            if r > worst["speedRatio"]:
                worst["speedRatio"], worst["speedAt"] = round(r, 3), "%s f%d" % (b, i + 1)
            if r > 0.99 and fail is None:
                fail = "speed " + b
            if b in prev:
                acc = (w - prev[b]).length
                cap = leg_acc if b in LEG_BONES else 290.0
                if acc > worst["accDegPerSPerFrame"]:
                    worst["accDegPerSPerFrame"], worst["accAt"] = round(acc, 1), "%s f%d" % (b, i + 1)
                if acc > cap and fail is None:
                    fail = "accel %s %.0f f%d" % (b, acc, i + 1)
            prev[b] = w
    hip = [f["hips"] for f in frames]
    sp = []
    for i in range(1, n - 1):
        dv = hip[i + 1] - hip[i - 1]
        sp.append(math.hypot(dv.x, dv.z) * RATE / 2)
    steps = [abs(sp[i + 1] - sp[i]) for i in range(len(sp) - 1)]
    worst["hipsStepMps"] = round(max(steps), 3) if steps else 0.0
    if steps and max(steps) > 0.29 and fail is None:
        fail = "hips step %.3f" % max(steps)
    pen, twist = 1.0, 0.0
    for f in frames:
        for s_ in "LR":
            for pt in (HEEL, BALL, TIP):
                pen = min(pen, (f["P"]["foot" + s_] + f["W"]["foot" + s_] @ pt).y)
            twist = max(twist, abs(V.twist_about_y(f["q"]["thigh" + s_])))
    worst["footMinHeightM"], worst["thighTwistMaxDeg"] = round(pen, 4), round(twist, 1)
    if pen < -0.008 and fail is None:
        fail = "penetration %.3f" % pen
    if twist > 48 and fail is None:
        fail = "thigh twist %.1f" % twist
    reach = max(max(f["misses"]["legL"], f["misses"]["legR"]) for f in frames)
    worst["legReachMissM"] = round(reach, 4)
    if reach > 0.002 and fail is None:
        fail = "leg reach %.3f" % reach
    return fail is None, fail or "ok", worst


def build():
    c0 = start_controls()
    f0 = pose2(c0)
    # each knee's bend direction at frame 0, in the hips frame (for kneeFollow)
    bend = {}
    for s_ in "LR":
        hj, kn, an = f0["P"]["thigh" + s_], f0["P"]["shin" + s_], f0["P"]["foot" + s_]
        ax = (an - hj).normalized()
        b_ = (kn - hj) - ax * (kn - hj).dot(ax)
        bend[s_] = f0["W"]["hips"].inverted() @ b_.normalized()
    c0["bendLocal"] = bend
    f0 = pose2(c0)
    clips = []
    searches = {}

    def with_bat(c):
        return pose2(bat_with_body(c0, c, f0))

    def tau(t, W, T, warp):
        """Clip time for play time t when input -> plant (T) is compressed into W, then 1x."""
        if t >= W:
            return T + (t - W)
        x = t / W
        if warp == "linear":
            return T * x
        r = W / T             # smooth: speed continuous (1x) at the plant
        return T * ((2.0 - r) * x + (r - 1.0) * x * x)

    for fam, cid in (("drive", "bat_drive"), ("fwd_defence", "bat_fwd_defence"), ("punch", "bat_backfoot_punch"),
                     ("pull", "bat_pull"), ("back_defence", "bat_back_defence")):
        T = NATURAL_T[FAMILY_FOOT[fam]]
        dur = T + CONTACT_AFTER_PLANT + AFTER[fam]
        prev_attempt = None
        for attempt in range(4):
            frames = sample(lambda t, T=T, fam=fam: with_bat(stroke_controls(c0, t, T, fam)), dur)
            ok, why, worst = caps_ok(frames)
            print("NATURAL", cid, round(T * 1000), ok, why, json.dumps(worst),
                  "pivot", FWD["backPivot"] if FAMILY_FOOT[fam] == "forward" else PULL_PIVOT[0])
            if prev_attempt is not None and not ok and not why.startswith("thigh twist"):
                # more pivot made it worse in another way: keep the previous attempt and report it
                frames, ok, why, worst = prev_attempt
                if FAMILY_FOOT[fam] == "forward":
                    FWD["backPivot"] -= 10.0
                else:
                    PULL_PIVOT[0] -= 10.0
                break
            if ok or not why.startswith("thigh twist") or fam in ("punch", "back_defence"):
                break
            prev_attempt = (frames, ok, why, worst)
            # more back-foot pivot (10° a step) until the back hip's twist is inside the cap
            if FAMILY_FOOT[fam] == "forward":
                FWD["backPivot"] += 10.0
            else:
                PULL_PIVOT[0] += 10.0
        if not ok:
            print("NATURAL_FAIL", cid, why)   # reported; the sources are written to the scratch out-dir only
        comp = {}
        for warp in ("linear", "smooth"):
            log = []
            for nfr in range(2, int(round(T * RATE)) + 1):
                W = nfr / RATE
                fr = sample(lambda t, W=W, T=T, fam=fam, warp=warp: with_bat(stroke_controls(c0, tau(t, W, T, warp), T, fam)),
                            W + CONTACT_AFTER_PLANT + AFTER[fam])
                ok_, why_, worst_ = caps_ok(fr)
                log.append({"ms": round(W * 1000, 1), "ok": ok_, "why": why_, "worst": worst_})
            # the shortest window from which every longer window also passes
            shortest = None
            for e in reversed(log):
                if not e["ok"]:
                    break
                shortest = e["ms"]
            comp[warp] = {"shortestMsAllLongerPass": shortest,
                          "shortestMsAnyPass": next((e["ms"] for e in log if e["ok"]), None), "log": log}
            print("COMPRESS", cid, warp, shortest, json.dumps([(e["ms"], e["why"]) for e in log]))
        searches[cid] = {"naturalMs": round(T * 1000, 1), "naturalWorst": worst, "compression": comp,
                         "backPivotDeg": FWD["backPivot"] if FAMILY_FOOT[fam] == "forward" else
                         (PULL_PIVOT[0] if fam == "pull" else 0.0)}
        mk = {"plant": round(T, 6), "contact": round(T + CONTACT_AFTER_PLANT, 6)}
        if FAMILY_FOOT[fam] == "forward":
            mk["heel"] = round(T - FWD["heelRock"], 6)
        clips.append({"id": cid, "frames": frames, "dur": dur, "markers": mk, "tracks": False, "family": fam, "T": T})
    prm, tried = choose_leave(c0)
    searches["bat_leave"] = {"chosen": prm, "tried": len(tried), "lastTried": tried[-3:]}
    if prm is None:
        from collections import Counter
        print("LEAVE_FAILS", json.dumps(Counter("%s@f%d" % ("+".join(r["why"]), r["stoppedAtFrame"]) for r in tried).most_common(12)))
        print("LEAVE_FURTHEST", json.dumps(sorted(tried, key=lambda r: -r["stoppedAtFrame"])[:4]))
        prm = tried[0]["prm"]
    print("LEAVE_PARAMS", json.dumps(prm))
    clips.append({"id": "bat_leave", "frames": sample(lambda t: pose2(leave_controls(c0, t, prm)), 0.85), "dur": 0.85,
                  "markers": {"contact": LEAVE["nominalContact"]}, "tracks": True, "family": "leave",
                  "T": LEAVE["nominalContact"]})
    return clips, f0, searches


def to_vms1(clip):
    fr = clip["frames"]
    data = {"ground": [], "hips": [], "contacts": [], "q": []}
    tr = {"bat.grip": [], "bat.dir": [], "bat.face": []}
    for f in fr:
        data["ground"].append([0.0, 0.0, 0.0])
        h = f["hips"]
        data["hips"].append([V.r6(h.x), V.r6(h.y), V.r6(h.z)])
        data["contacts"].append(int(f["contacts"]))
        flat = []
        for b in V.BONES:
            flat += V.quat_list(f["q"][b]) if b in MASK else [0.0, 0.0, 0.0, 1.0]
        data["q"].append(flat)
        for k, key in (("bat.grip", "bottom"), ("bat.dir", "dir"), ("bat.face", "face")):
            v = f["bat"][key]
            tr[k].append([V.r6(v.x), V.r6(v.y), V.r6(v.z)])
    tracks = {}
    if clip["tracks"]:
        tracks = {"bat.grip": {"kind": "position", "frames": tr["bat.grip"]},
                  "bat.dir": {"kind": "direction", "frames": tr["bat.dir"]},
                  "bat.face": {"kind": "direction", "frames": tr["bat.face"]}}
    return {"format": "VMS1", "id": clip["id"], "pack": "batter_strokes", "role": "batter", "skeleton": "VC17",
            "sampleRate": RATE, "loop": False, "mirrorable": True, "overlay": True, "codec": 2, "boneMask": MASK,
            "speedMps": 0, "cycleSteps": 0, "markers": clip["markers"], "mirrorAliases": {}, "frames": data,
            "tracks": tracks,
            "provenance": {"author": "TRACKB (Claude agent for the owner)",
                           "method": "original keyed controls in Blender 5.2.3, baked per frame with two-bone IK "
                                     "(VC17, MOTION-SPEC v1.2)",
                           "script": "scripts/blender/motion/batter_strokes.py", "licence": "owner-made original",
                           "sources": []}}


def neck_report(f, f0):
    """Where the body ends, against WEB-HUMANS' physics batterBodyFrame targets (actor frame, relative to frame 0)."""
    mid0 = (f0["P"]["footL"] + f0["P"]["footR"]) / 2
    mid = (f["P"]["footL"] + f["P"]["footR"]) / 2
    neck = f["P"]["neck"]
    return {"feetMidDeltaXZ": [round(mid.x - mid0.x, 3), round(mid.z - mid0.z, 3)],
            "neckRelMidXZ": [round(neck.x - mid.x, 3), round(neck.z - mid.z, 3)],
            "neckY": round(neck.y, 3), "neckDropFromFrame0": round(f0["P"]["neck"].y - neck.y, 3)}


def bake(out, assets):
    clips, f0, ends = build()
    rep = {"frame0": neck_report(f0, f0), "clips": {}}
    for clip in clips:
        rec = to_vms1(clip)
        m = V.measure(clip["frames"], RATE, False, None)
        m["legReachMissMaxM"] = round(max(max(f["misses"]["legL"], f["misses"]["legR"]) for f in clip["frames"]), 5)
        m["end"] = neck_report(clip["frames"][-1], f0)
        for mkey in ("plant", "contact"):
            if mkey in clip["markers"]:
                k = int(round(clip["markers"][mkey] * RATE))
                m["at" + mkey.capitalize()] = neck_report(clip["frames"][k], f0)
        rep["clips"][clip["id"]] = m
        path = os.path.join(out, clip["id"] + ".vms.json")
        V.write_vms1(path, rec)
        if assets:
            os.makedirs(assets, exist_ok=True)
            V.write_vms1(os.path.join(assets, clip["id"] + ".vms.json"), rec)
        print("CLIP", clip["id"], len(clip["frames"]), json.dumps({k: m[k] for k in ("poseSpeedFails", "jointLimitFails", "poseAccelMaxDegPerSPerFrame", "hipsSpeedStepMaxMpsPerFrame", "footSlideMaxM", "legReachMissMaxM", "end")}))
    # seams: every clip's frame 0 = bat_ready_hold_compact frame 0 (f0)
    def seam(fa, fb):
        worst = max(min(math.degrees(fa["q"][b].rotation_difference(fb["q"][b]).angle),
                        360 - math.degrees(fa["q"][b].rotation_difference(fb["q"][b]).angle)) for b in MASK)
        return {"maxBoneDeg": round(worst, 4), "hipsM": round((fa["hips"] - fb["hips"]).length, 6)}
    seams = {"ready_hold_compact->" + c["id"]: seam(f0, c["frames"][0]) for c in clips}
    rep["seams"] = seams
    rep["searches"] = ends
    rep["inputToPlantMs"] = {c["id"]: round(c["T"] * 1000, 1) for c in clips}
    rep["markers"] = {c["id"]: c["markers"] for c in clips}
    rep["setup"] = {"FWD": {k: (list(v) if isinstance(v, Vector) else v) for k, v in FWD.items()},
                    "BACK": {k: (list(v) if isinstance(v, Vector) else v) for k, v in BACK.items()},
                    "AFTER": AFTER, "mask": MASK, "rate": RATE}
    with open(os.path.join(out, "bake-report.json"), "w") as fh:
        json.dump(rep, fh, indent=1)
    print("SEAMS", json.dumps(seams))
    print("FRAME0", json.dumps(rep["frame0"]))


# Illustrative bats for the family stills only (the runtime draws the physics bat): (cap offset from a joint, dir)
ILLUSTRATIVE_BAT = {
    "drive-contact": ("shinL", Vector((0.06, 0.40, 0.14)), Vector((0.12, -0.96, -0.10))),
    "drive-finish": ("neck", Vector((0.18, 0.12, 0.08)), Vector((-0.55, 0.55, -0.55))),
    "fwd_defence-contact": ("shinL", Vector((0.10, 0.46, 0.14)), Vector((-0.18, -0.96, -0.14))),
    "fwd_defence-finish": ("shinL", Vector((0.08, 0.46, 0.14)), Vector((-0.18, -0.96, -0.14))),
    "backfoot_punch-contact": ("spine", Vector((0.12, 0.05, 0.36)), Vector((0.08, -0.97, 0.10))),
    "backfoot_punch-finish": ("chest", Vector((0.22, 0.02, 0.34)), Vector((0.30, 0.88, 0.30))),
    "pull-contact": ("chest", Vector((-0.08, -0.02, 0.40)), Vector((0.98, 0.05, 0.10))),
    "pull-finish": ("chest", Vector((0.25, 0.10, 0.05)), Vector((-0.35, 0.30, -0.88))),
    "back_defence-contact": ("chest", Vector((0.0, -0.30, 0.40)), Vector((0.0, -0.98, 0.15))),
    "back_defence-finish": ("chest", Vector((0.0, -0.30, 0.40)), Vector((0.0, -0.98, 0.15))),
}


def render(out):
    clips, f0, ends = build()
    by = {c["id"]: c for c in clips}
    stills = {"strokes-ready": f0}
    for cid in ("bat_drive", "bat_fwd_defence", "bat_backfoot_punch", "bat_pull", "bat_back_defence"):
        fr = by[cid]["frames"]
        k = int(round(by[cid]["T"] * RATE))
        stills[cid.replace("bat_", "") + "-mid"] = fr[k // 2]
        stills[cid.replace("bat_", "") + "-contact"] = fr[int(round(by[cid]["markers"]["contact"] * RATE))]
        stills[cid.replace("bat_", "") + "-finish"] = fr[-1]
    fr = by["bat_leave"]["frames"]
    stills["leave-contact"] = fr[int(round(LEAVE["nominalContact"] * RATE))]
    stills["leave-up"] = fr[int(round(LEAVE["lift"] * RATE))]
    stills["leave-end"] = fr[-1]
    for label, f in stills.items():
        if label in ILLUSTRATIVE_BAT:
            # re-solve the arms to an illustrative bat for the still (body unchanged: arms are not in the overlay)
            joint, off, d = ILLUSTRATIVE_BAT[label]
            cap = f["P"][joint] + off
            bp = V.bat_points(cap, d)
            bp["face"] = A["face_of"](bp["dir"], 0.0)
            q = dict(f["q"])
            W, P = f["W"], f["P"]
            for side, target, pole in (("R", bp["bottom"], A["POLE_BOTTOM"]), ("L", bp["top"], A["POLE_TOP"])):
                tmp, _, s_, elbow = V.solve_arm(W["chest"], P["chest"], side, target, pole, Quaternion(), palm=V.PALM)
                hw = V.hand_frame((target - elbow).normalized(), A["PALM_REF"], side)
                sol, miss, s_, elbow = V.solve_arm(W["chest"], P["chest"], side, target, pole, hw, palm=V.PALM)
                q.update(sol)
            W2, P2 = V.fk(q, f["hips"])
            f = {**f, "q": q, "W": W2, "P": P2, "bat": bp}
        A["render_pose"](out, label, f)
    print("RENDERED", list(stills))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    mode, out = argv[0], argv[1]
    os.makedirs(out, exist_ok=True)
    if mode == "bake":
        bake(out, argv[argv.index("--assets") + 1] if "--assets" in argv else None)
    elif mode == "render":
        render(out)
    else:
        raise SystemExit("mode: bake | render")


main()
