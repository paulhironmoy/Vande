"""
TRACKB: the batter's anticipation clips on VC17 (MOTION-SPEC v1.1), authored as original keyed controls in Blender
and baked per frame with IK into VMS1 sources.

  blender -b --factory-startup --python scripts/blender/motion/batter_anticipation.py -- \
      search <out-dir>                    # stance search: bat placement and crouch for natural arms on VC17
      bake <out-dir> [--assets <dir>]     # bake every clip, write VMS1 (and copy to assets-src/motion/batter/)
      render <out-dir>                    # mannequin stills: before (the current web stance) and after

Clips (right-handed; left-handers through the canonical mirror at runtime). All are in place: the ground track is
zero, the physics places the striker.
  bat_stance_live   loop 4.0 s: grounded bat near the back toe, face to the bowler, breathing, a weight shift and a
                    double bat tap; the head is held still and level, eyes on the bowler.
  bat_trigger       one-shot 0.55 s: a 3 cm back-and-across trigger as the bowler gathers; marker `release` at the
                    end (the clip ends as the ball is released), `set` when the feet are down.
  bat_backlift      one-shot 0.60 s from the release: a levered backlift; marker `release` 0, `top` 0.25 (the
                    earliest hand-off to the physics stroke), and it keeps rising slowly so there is no dead stop.
  bat_ready_hold    loop 1.2 s: the top of the backlift with breathing, for a leave or a late swing.

Honesty: none of these reads the delivery or the player's input; the bat tracks stop mattering once the physics bat
(batAt) exists, and the hands then reach for it.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import batter_vc17lib as V  # noqa: E402

REPO = "/Users/hironmoy/Vande/Vande"
RATE = 60

# --------------------------------------------------------------------------------------------------------------------
# The set-up (actor frame, right-hander: facing +Z, the off side; the bowler is at +X, the character's left)
# --------------------------------------------------------------------------------------------------------------------

STANCE = {
    "ankleL": Vector((0.25, V.ANKLE_REST_Y, 0.0)), "yawL": 14.0,    # front foot opened towards the bowler
    "ankleR": Vector((-0.25, V.ANKLE_REST_Y, 0.0)), "yawR": 0.0,
    "hipsXZ": (0.03, 0.0),           # weight a little towards the front foot (centre of mass ~59% of the base)
    "kneeTarget": 38.0,              # COVER-DRIVE-SPEC §1: 30-50°; wedge §6.3: 20-45°
    "hipsYaw": 24.0,                 # pelvis and shoulders open ~20° towards the bowler
    "hipsPitch": 8.0, "spinePitch": 16.0, "chestPitch": 26.0,   # thorax ~38° forward (§1: 31-49°)
    "chestRoll": 12.0,               # the back (right) shoulder lower, as the bottom hand reaches down the handle
    "headNod": 6.0,                  # eyes level on the bowler, 6° down
}
POLE_BOTTOM = Vector((-0.45, 0.9, -0.1))   # stageScene.ts reachIK poles (root frame, scale 1)
POLE_TOP = Vector((0.55, 0.9, 0.05))
BOWLER = Vector((1.0, 0.0, 0.0))
PALM_REF = Vector((math.cos(math.radians(30)), 0.0, math.sin(math.radians(30))))  # bowler side, 30° to the off


def smooth(u):
    u = max(0.0, min(1.0, u))
    return u * u * u * (u * (u * 6 - 15) + 10)


def lerpv(a, b, u):
    return a + (b - a) * u


def knee_flex(Whips, Phips, side, ankle):
    h = Phips + Whips @ Vector(V.OFFSET["thigh" + side])
    knee, a_eff, _ = V.two_bone(h, ankle, V.THIGH, V.SHIN, h + Vector((0, 0, 1)))
    return math.degrees((knee - h).angle(a_eff - knee))


def hips_rot(c):
    return V.ry(c["hipsYaw"]) @ V.rx(c["hipsPitch"])


def solve_hips_height(c):
    Wh = hips_rot(c)
    lo, hi = 0.0, 0.3
    for _ in range(40):
        drop = (lo + hi) / 2
        P = Vector((c["hipsXZ"][0], V.HIPS_REST.y - drop, c["hipsXZ"][1]))
        k = (knee_flex(Wh, P, "L", c["ankleL"]) + knee_flex(Wh, P, "R", c["ankleR"])) / 2
        if k < c["kneeTarget"]:
            lo = drop
        else:
            hi = drop
    return V.HIPS_REST.y - (lo + hi) / 2


def pose(ctrl):
    """Solve one frame from its controls. Returns local quaternions, the hips offset and joint positions."""
    q = {b: Quaternion() for b in V.BONES}
    Wh = hips_rot(ctrl)
    Ph = ctrl["hips"]
    q["hips"] = Wh
    q["spine"] = V.rx(ctrl["spinePitch"])
    q["chest"] = V.rx(ctrl["chestPitch"]) @ V.rz(ctrl["chestRoll"])
    W, P = V.fk(q, Ph - V.HIPS_REST)
    # head: a fixed world orientation (still, level, on the bowler), shared 40/60 by the neck and the head
    RH = V.ry(90.0) @ V.rx(ctrl["headNod"])
    rel = W["chest"].inverted() @ RH
    neck = Quaternion().slerp(rel, 0.4)
    q["neck"] = neck
    q["head"] = neck.inverted() @ rel
    # legs
    for side in "LR":
        ank = ctrl["ankle" + side]
        toe = V.ry(ctrl["yaw" + side]) @ Vector((0, 0, 1))
        pole = ank + toe * 0.6 + Vector((0, 0.5, 0))
        sol, miss = V.solve_leg(Wh, Ph, side, ank, pole, ctrl["yaw" + side])
        q.update(sol)
    W, P = V.fk(q, Ph - V.HIPS_REST)
    # arms to the bat's hand points (bottom hand at bat.grip, top hand TOP_HAND_FROM_CAP below the cap)
    bp = V.bat_points(ctrl["cap"], ctrl["dir"])
    bp["face"] = ctrl["face"].normalized() if ctrl.get("face") is not None else face_of(bp["dir"], ctrl.get("faceOpen", 0.0))
    sol, misses = arms(W, P, ctrl, bp)
    q.update(sol)
    W, P = V.fk(q, Ph - V.HIPS_REST)
    return {"q": q, "hips": Ph - V.HIPS_REST, "W": W, "P": P, "ankleL": P["footL"], "ankleR": P["footR"],
            "contacts": ctrl.get("contacts", 3), "misses": misses, "bat": bp}


def arms(W, P, ctrl, bp):
    """Both arms to the bat's hand points (bottom hand at bat.grip, top hand TOP_HAND_FROM_CAP below the cap).
    Neutral-wrist mode (default): the hand continues the forearm and its palm faces `palmRef`.
    Rigid-grip mode (`handWorld`, per side): the hands are fixed on the handle and turn with the blade; the wrist sits
    PALM behind the palm centre along the hand, and the wrist flexes as needed (§9 swing cone). Optional elbow poles
    `poleR` / `poleL`."""
    out, misses = {}, {}
    for side, target, pole0 in (("R", bp["bottom"], POLE_BOTTOM), ("L", bp["top"], POLE_TOP)):
        pole = ctrl.get("pole" + side, pole0)
        hwd = ctrl.get("handWorld")
        if hwd:
            hw = hwd[side]
            wrist = target - hw @ Vector((0.0, -V.PALM, 0.0))
            sol, miss, s, elbow = V.solve_arm(W["chest"], P["chest"], side, wrist, pole, hw, palm=0.0)
        else:
            # first pass for the forearm direction, then the hand frame from it
            tmp, _, s, elbow = V.solve_arm(W["chest"], P["chest"], side, target, pole, Quaternion(), palm=V.PALM)
            fdir = (target - elbow).normalized()
            hw = V.hand_frame(fdir, ctrl.get("palmRef", PALM_REF), side)
            sol, miss, s, elbow = V.solve_arm(W["chest"], P["chest"], side, target, pole, hw, palm=V.PALM)
        out.update(sol)
        misses[side] = miss
    return out, misses


def face_of(d, open_deg):
    """The blade face's outward normal: towards the bowler (+X) as far as the bat allows (the renderer's rule), then
    turned `open_deg` about the bat towards the off side (+Z): the face opens in the backlift (COVER-DRIVE-SPEC §2)."""
    f0 = BOWLER - d * BOWLER.dot(d)
    f0 = f0.normalized() if f0.length > 1e-6 else Vector((0, 0, 1))
    if not open_deg:
        return f0
    off = Vector((0, 0, 1))
    sign = 1.0 if d.cross(f0).dot(off) >= 0 else -1.0
    return (Quaternion(d, math.radians(sign * open_deg)) @ f0).normalized()


def elbow_flex(P, side):
    s, e, w = P["upperArm" + side], P["forearm" + side], P["hand" + side]
    return math.degrees((e - s).angle(w - e))


def base_controls():
    c = dict(STANCE)
    c["hips"] = Vector((c["hipsXZ"][0], solve_hips_height(c), c["hipsXZ"][1]))
    c["ankleL"] = STANCE["ankleL"].copy()
    c["ankleR"] = STANCE["ankleR"].copy()
    return c


def grounded_bat(toe_xz, lean_bowler_deg, lean_body_deg):
    """A grounded bat: toe on the ground at toe_xz, the handle leaning towards the bowler (+X) and the body (-Z)."""
    up = Vector((0, 1, 0))
    up = Quaternion((0, 0, 1), math.radians(lean_bowler_deg)) @ up      # +Z rotation tips +Y towards -X ...
    up = Vector((-up.x, up.y, up.z))                                    # ... so flip: towards +X (the bowler)
    up = Quaternion((1, 0, 0), math.radians(-lean_body_deg)) @ up       # towards -Z (back to the batter)
    up.normalize()
    toe = Vector((toe_xz[0], 0.005, toe_xz[1]))
    cap = toe + up * V.BAT_FULL
    return cap, -up


# --------------------------------------------------------------------------------------------------------------------
# Stance search: the grounded bat and crouch that let VC17's arms (0.54 m) reach the handle naturally
# --------------------------------------------------------------------------------------------------------------------

def search(out):
    """Coarse grid over crouch, trunk, pelvis and bat placement. Reports the arm misses so the reach budget of VC17's
    0.54 m arms is visible, then the natural candidates (both arms reach, elbows a little bent)."""
    import itertools
    rows = []
    grid = itertools.product((38.0, 44.0, 50.0),        # knee
                             (14.0, 20.0, 26.0),        # chest pitch
                             (0.0, 0.06, 0.12),         # hips z (forward over the bat)
                             (6.0, 12.0),               # chest roll (back shoulder down)
                             (18.0, 28.0),              # hips yaw (open)
                             (-0.15, -0.08),            # toe x
                             (0.20, 0.28),              # toe z
                             (6.0, 14.0),               # lean towards the bowler
                             (0.0, 10.0))               # lean back towards the body
    for knee, chest, hz, roll, yaw, tx, tz, lb, lz in grid:
        c = dict(STANCE)
        c.update({"kneeTarget": knee, "chestPitch": chest, "hipsXZ": (STANCE["hipsXZ"][0], hz), "chestRoll": roll,
                  "hipsYaw": yaw})
        c["hips"] = Vector((c["hipsXZ"][0], solve_hips_height(c), c["hipsXZ"][1]))
        c["cap"], c["dir"] = grounded_bat((tx, tz), lb, lz)
        f = pose(c)
        el = {sd: elbow_flex(f["P"], sd) for sd in "LR"}
        thorax = math.degrees((f["P"]["neck"] - f["P"]["spine"]).angle(Vector((0, 1, 0))))
        # the handle must stay in front of the torso (no bat through the body)
        clear = min((f["P"][k] - (f["bat"]["cap"] + f["bat"]["dir"] * t)).length
                    for k in ("spine", "chest", "hips") for t in (0.0, 0.15, 0.3))
        rows.append({"knee": knee, "chest": chest, "hipsZ": hz, "roll": roll, "yaw": yaw, "toe": [tx, tz],
                     "leanBowler": lb, "leanBody": lz, "missL": round(f["misses"]["L"], 4),
                     "missR": round(f["misses"]["R"], 4), "elbowL": round(el["L"], 1), "elbowR": round(el["R"], 1),
                     "thorax": round(thorax, 1), "capY": round(c["cap"].y, 3), "hipsY": round(c["hips"].y, 3),
                     "torsoClearM": round(clear, 3)})
    rows.sort(key=lambda r: max(r["missL"], r["missR"]))
    ok = [r for r in rows if max(r["missL"], r["missR"]) <= 0.0005 and r["torsoClearM"] > 0.12]

    def score(r):
        pen = max(0, 8 - r["elbowL"]) + max(0, r["elbowL"] - 35) + max(0, 12 - r["elbowR"]) + max(0, r["elbowR"] - 50)
        return (round(pen), r["knee"], r["thorax"], abs(r["leanBody"]))
    ok.sort(key=score)
    with open(os.path.join(out, "stance-search.json"), "w") as fh:
        json.dump({"candidates": len(rows), "reachable": len(ok), "best": ok[:20], "leastMiss": rows[:10]}, fh, indent=1)
    print("SEARCH", len(rows), "reachable", len(ok), "least miss", rows[0]["missL"], rows[0]["missR"])
    for r in ok[:20]:
        print("SEARCH ok", r)
    for r in rows[:5]:
        print("SEARCH least", r)


# --------------------------------------------------------------------------------------------------------------------
# Clips
# --------------------------------------------------------------------------------------------------------------------

def stance_setup():
    c = base_controls()
    c["cap"], c["dir"] = grounded_bat(STANCE_BAT["toe"], STANCE_BAT["leanBowler"], STANCE_BAT["leanBody"])
    return c


STANCE_BAT = {"toe": (-0.10, 0.21), "leanBowler": 10.0, "leanBody": 0.0}


def with_bat_lift(c, lift, tilt_deg=0.0):
    """Lift the bat straight up by `lift` (toe off the ground) and tip the toe back by tilt_deg about the top hand."""
    cap, d = c["cap"], c["dir"]
    pivot = cap + d * V.TOP_HAND_FROM_CAP
    if tilt_deg:
        axis = d.cross(Vector((1, 0, 0)))
        if axis.length < 1e-6:
            axis = Vector((0, 0, 1))
        rot = Quaternion(axis.normalized(), math.radians(tilt_deg))
        d = (rot @ d).normalized()
        cap = pivot - d * V.TOP_HAND_FROM_CAP
    return cap + Vector((0, lift, 0)), d


def sway_bat(cap, d, hips_delta, follow=0.85):
    """The grounded bat pivots on its toe as the body sways: the cap follows the hips' horizontal shift."""
    toe = cap + d * V.BAT_FULL
    cap2 = cap + Vector((hips_delta.x, 0.0, hips_delta.z)) * follow
    d2 = (toe - cap2).normalized()
    return toe - d2 * V.BAT_FULL, d2


def probe(out, spec):
    """Elbow flexion at the stance and at the sway extremes for candidate set-ups (JSON list of overrides)."""
    rows = []
    for cand in json.loads(spec):
        STANCE.update({k: (tuple(v) if isinstance(v, list) else v) for k, v in cand.items() if k in STANCE})
        STANCE_BAT.update({k: (tuple(v) if isinstance(v, list) else v) for k, v in cand.items() if k in STANCE_BAT})
        base = stance_setup()
        res = {"cand": cand}
        for label, dx, dz in (("neutral", 0, 0), ("fwd", 0.010, 0.004), ("back", -0.010, -0.004)):
            c = dict(base)
            c["hips"] = base["hips"] + Vector((dx, 0, dz))
            c["cap"], c["dir"] = sway_bat(base["cap"], base["dir"], c["hips"] - base["hips"])
            f = pose(c)
            res[label] = {"elbowL": round(elbow_flex(f["P"], "L"), 1), "elbowR": round(elbow_flex(f["P"], "R"), 1),
                          "miss": round(max(f["misses"].values()), 4)}
        # trigger set and backlift top
        sc = trigger_controls(base, 0.55)
        f = pose(sc)
        res["set"] = {"elbowL": round(elbow_flex(f["P"], "L"), 1), "elbowR": round(elbow_flex(f["P"], "R"), 1),
                      "miss": round(max(f["misses"].values()), 4)}
        f = pose(backlift_controls(sc, 0.25, TOP_DIR, TOP_SHIFT))
        res["top"] = {"elbowL": round(elbow_flex(f["P"], "L"), 1), "elbowR": round(elbow_flex(f["P"], "R"), 1),
                      "miss": round(max(f["misses"].values()), 4)}
        rows.append(res)
        print("PROBE", json.dumps(res))
    with open(os.path.join(out, "probe.json"), "w") as fh:
        json.dump(rows, fh, indent=1)


def clip_stance_live(base):
    """4.0 s loop. Breathing (chest ±0.8°, spine ±0.3°, hips ±2 mm) at the loop period, a weight shift of ±10 mm
    towards the bowler at half the rate, and a double bat tap at 1.5-2.3 s. Frame 0 is the neutral stance."""
    dur, rate = 4.0, 30
    n = int(dur * rate)
    frames = []
    for i in range(n + 1):  # MOTION-SPEC v1.1 §7: a loop source carries its closing frame
        t = i / rate
        c = dict(base)
        ph = 2 * math.pi * t / dur
        breath = math.sin(ph)
        c["chestPitch"] = base["chestPitch"] + 0.8 * breath
        c["spinePitch"] = base["spinePitch"] + 0.3 * breath
        c["hips"] = base["hips"] + Vector((0.010 * math.sin(ph), 0.002 * math.sin(2 * ph), 0.004 * math.sin(ph)))
        # double tap: the toe lifts 4 cm twice (1.5-1.9 s and 1.9-2.3 s), smooth ends
        lift = 0.0
        for t0 in (1.5, 1.9):
            u = (t - t0) / 0.4
            if 0 <= u <= 1:
                lift = max(lift, 0.04 * math.sin(math.pi * u) ** 2)
        cap, d = with_bat_lift(base, lift * 0.75, tilt_deg=-lift * 40)
        c["cap"], c["dir"] = sway_bat(cap, d, c["hips"] - base["hips"])
        c["contacts"] = 3
        frames.append(pose(c))
    return {"id": "bat_stance_live", "loop": True, "dur": dur, "rate": rate, "frames": frames,
            "markers": {"tap": 1.5, "tap2": 1.9}}


TRIGGER = {"backDelta": Vector((-0.03, 0.0, 0.03)), "frontDelta": Vector((-0.015, 0.0, 0.015)),
           "hipsDelta": Vector((-0.02, 0.0, 0.022)), "batLift": 0.035}


def trigger_controls(base, t):
    c = dict(base)
    ub = smooth((t - 0.05) / 0.22)
    uf = smooth((t - 0.17) / 0.20)
    c["ankleR"] = base["ankleR"] + TRIGGER["backDelta"] * ub + Vector((0, 0.015 * math.sin(math.pi * ub), 0))
    c["ankleL"] = base["ankleL"] + TRIGGER["frontDelta"] * uf + Vector((0, 0.010 * math.sin(math.pi * uf), 0))
    c["hips"] = base["hips"] + TRIGGER["hipsDelta"] * smooth(t / 0.42)
    lift = TRIGGER["batLift"] * smooth((t - 0.12) / 0.33)
    cap, d = with_bat_lift(base, lift)
    # the hands and the (now hovering) bat travel with the body
    c["cap"], c["dir"] = cap + (c["hips"] - base["hips"]) * 0.9, d
    contacts = 3
    if 0.0 < ub < 1.0:
        contacts &= ~2
    if 0.0 < uf < 1.0:
        contacts &= ~1
    c["contacts"] = contacts
    return c


def clip_trigger(base):
    dur = 0.55
    n = int(round(dur * RATE)) + 1
    frames = [pose(trigger_controls(base, i / RATE)) for i in range(n)]
    return {"id": "bat_trigger", "loop": False, "dur": dur, "rate": RATE, "frames": frames,
            "markers": {"set": 0.42, "release": 0.55}}


def backlift_controls(base_set, t, top_dir, top_shift):
    """Levered backlift: the top hand pivots back towards the back hip and barely rises; the bat turns up behind
    through wrist cock and elbow flex. 0-0.25 s to the top, then a slow continuation (no dead stop) to 0.60 s."""
    c = dict(base_set)
    cap0, d0 = base_set["cap"], base_set["dir"]
    top0 = cap0 + d0 * V.TOP_HAND_FROM_CAP
    u = smooth(t / 0.25) if t <= 0.25 else 1.0
    cont = 0.0 if t <= 0.25 else (t - 0.25) / 0.35
    cont = math.sin(cont * math.pi / 2)  # decelerating, still moving at 0.60
    top = top0 + top_shift * u + Vector((-0.012, 0.004, -0.004)) * cont
    # direction: slerp-like rotation from the stance direction to the top direction, then 8° further
    axis = d0.cross(top_dir)
    ang = d0.angle(top_dir)
    rot = Quaternion(axis.normalized(), ang * u)
    d = rot @ d0
    if cont > 0:
        extra = Quaternion(axis.normalized(), math.radians(8.0) * cont)
        d = extra @ d
    d.normalize()
    c["cap"] = top - d * V.TOP_HAND_FROM_CAP
    c["dir"] = d
    c["chestPitch"] = base_set["chestPitch"] + 3.0 * u + 1.0 * cont
    c["faceOpen"] = 30.0 * u + 6.0 * cont   # the face opens as the bat goes up (§2), still opening after the top
    c["hips"] = base_set["hips"] + Vector((-0.006, 0.0, 0.0)) * u
    c["hipsYaw"] = base_set["hipsYaw"] - 3.0 * u    # the pelvis starts to open (literature 69 -> 57°) is in the
    # stroke; here a small counter-turn of the hips as the hands go back
    c["contacts"] = 3
    return c


# WEB-HUMANS' compact top (src/render3d/practice/bat.ts BACKLIFT_TOP, physics frame: hands' midpoint (-0.08, 1.02, 9.00),
# blade normalize(0.12, 0, 0.99), face (0.30, -0.95, 0) made normal to the blade), in the actor frame (the striker
# stands at the nominal physics stance (-0.15, 8.96); actor X = -(z - 8.96), Y = y, Z = x + 0.15).
COMPACT_MID = Vector((-(9.00 - 8.96), 1.02, -0.08 + 0.15))
COMPACT_DIR = Vector((-0.99, 0.0, 0.12)).normalized()
_cf = Vector((0.0, -0.95, 0.30))
COMPACT_FACE = (_cf - COMPACT_DIR * _cf.dot(COMPACT_DIR)).normalized()


def bat_frame(d, face):
    """A proper rotation whose columns are (side, face, d): side = face x d keeps it right-handed."""
    face = (face - d * face.dot(d)).normalized()
    side = face.cross(d).normalized()
    return Matrix((side, face, d)).transposed().to_quaternion()


_SET_HANDS = {}


def set_hands(base_set):
    """The hands' world frames at the set pose (neutral-wrist solve), where the compact backlift starts."""
    key = (tuple(base_set["cap"]), tuple(base_set["dir"]))
    if key not in _SET_HANDS:
        f = pose(base_set)
        _SET_HANDS[key] = {s_: f["W"]["hand" + s_].copy() for s_ in "LR"}
    return _SET_HANDS[key]


def backlift_compact_controls(base_set, t, mid_offset=Vector(), body=(0.0, 0.0)):
    """Compact backlift (WEB-HUMANS, lead request): the blade turns rigidly (slerp of its frame) from the trigger's
    set pose to a level top pointing back at the keeper with the face down and slightly open, the hands' midpoint
    eased to the top by 0.25 s. The grip is rigid: both hands turn with the blade from their set-pose frames, and the
    wrists flex. body = (hips shift towards leg in m, trunk pitch change in degrees[, bottom-elbow pole at the top,
    top-elbow pole at the top]); the poles ease from the stance poles with the same profile."""
    c = dict(base_set)
    u = smooth(t / 0.25)
    cap0, d0 = base_set["cap"], base_set["dir"]
    f0 = face_of(d0, 0.0)
    q0, q1 = bat_frame(d0, f0), bat_frame(COMPACT_DIR, COMPACT_FACE)
    q = q0.slerp(q1, u)
    m = q.to_matrix()
    d = Vector((m[0][2], m[1][2], m[2][2])).normalized()
    face = Vector((m[0][1], m[1][1], m[2][1])).normalized()
    mid0 = cap0 + d0 * 0.075
    mid = mid0 + ((COMPACT_MID + mid_offset) - mid0) * u
    c["cap"], c["dir"], c["face"] = mid - d * 0.075, d, face
    R = q @ q0.inverted()
    if len(body) > 4 and body[4] < 1.0:
        # the hands follow `body[4]` of the blade's turn (the rest is the grip rolling on the handle)
        R = Quaternion().slerp(R, body[4])
    H0 = set_hands(base_set)
    c["handWorld"] = {s_: R @ H0[s_] for s_ in "LR"}
    c.pop("palmRef", None)
    if len(body) > 2:
        c["poleR"] = POLE_BOTTOM.lerp(Vector(body[2]), u)
        c["poleL"] = POLE_TOP.lerp(Vector(body[3]), u)
    # body: (hips shift towards leg, -Z, in m; trunk pitch change in degrees) so the hands clear the torso
    c["chestPitch"] = base_set["chestPitch"] + (3.0 + body[1]) * u
    c["hips"] = base_set["hips"] + Vector((-0.006, 0.0, body[0])) * u
    c["hipsYaw"] = base_set["hipsYaw"] - 3.0 * u
    c["contacts"] = 3
    return c


COMPACT_BODY = [0.0, 0.0, None, None]
COMPACT_MID_OFFSET = Vector((0.0, 0.0, 0.0))   # set by choose_compact_offset() if the hands would enter the torso
# Candidate elbow poles at the compact top (actor frame points; the stance poles first)
POLES_R_TOP = [(-0.45, 0.9, -0.1), (-0.35, 0.55, -0.25), (-0.25, 0.5, 0.15), (-0.55, 1.2, -0.3), (-0.1, 0.4, -0.3),
               (-0.3, 0.3, 0.3)]
POLES_L_TOP = [(0.55, 0.9, 0.05), (0.35, 0.6, 0.35), (0.5, 1.2, 0.35), (0.2, 0.5, -0.1), (0.1, 0.3, 0.4)]


def top_checks(f):
    """The §9 checks that a static pose can fail: wrist to the hips-neck segment, elbow Euler limits, wrist swing,
    hand twist left over after the forearm's ±89.5°, reach."""
    a, b = f["P"]["hips"], f["P"]["neck"]
    ab = b - a
    worst = 1e9
    elbow_ok = True
    swing = 0.0
    rem = 0.0
    f["swingBySide"] = {}
    for side in "LR":
        w = f["P"]["hand" + side]
        t = max(0.0, min(1.0, (w - a).dot(ab) / ab.length_squared))
        worst = min(worst, (w - (a + ab * t)).length)
        x, y, z = V.euler_xyz_of(f["q"]["forearm" + side])
        elbow_ok = elbow_ok and (-150 <= x <= 5) and abs(z) <= 12
        hq = f["q"]["hand" + side]
        sw_ = math.degrees((hq @ Vector((0, -1, 0))).angle(Vector((0, -1, 0))))
        f["swingBySide"][side] = round(sw_, 1)
        swing = max(swing, sw_)
        rem = max(rem, abs(V.twist_about_y(hq)))
    return worst, elbow_ok, max(f["misses"].values()), swing, rem


def choose_compact_offset(set_ctrl):
    """The least change that makes the compact backlift pass §9 with a rigid grip: the top moved towards the off side
    (+Z) by dz, the hips rocked towards leg (-Z) by hz, the trunk eased by cp degrees, and the elbow poles at the top;
    cost dz + |hz| + 0.004·|cp| + 0.01 per changed pole. Checked over the whole 0.25 s path at 60 Hz: wrists at least
    0.095 m from the hips-neck axis, elbows inside their Euler limits, wrist swing <= 80°, hand twist beyond the
    forearm <= 10°, arm bones under 1100°/s, both arms reaching. Also searched: the top raised by dy, and the share of
    the blade's turn the hands follow (1 = rigid grip; cost 0.2 per unit of grip roll). Returns (offset, body,
    tried)."""
    cands = []
    for dz in (0.0, 0.03, 0.06, 0.09, 0.12, 0.15):
        for dy in (0.0, 0.04, 0.08, 0.12):
            for hz in (0.0, -0.03, -0.06):
                for cp in (0.0, -5.0):
                    for ir in range(len(POLES_R_TOP)):
                        for il in range(len(POLES_L_TOP)):
                            for kf in (1.0, 0.85, 0.7):
                                cost = (dz + dy + abs(hz) + 0.004 * abs(cp) + 0.01 * ((ir > 0) + (il > 0))
                                        + 0.2 * (1.0 - kf))
                                cands.append((round(cost, 6), dz, dy, hz, cp, ir, il, kf))
    cands.sort()
    tried = []
    arm_bones = ["upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR"]
    for cost, dz, dy, hz, cp, ir, il, kf in cands:
        off = Vector((0.0, dy, dz))
        body = (hz, cp, POLES_R_TOP[ir], POLES_L_TOP[il], kf)
        worst_w, elbows, worst_miss, worst_swing, worst_rem, worst_speed = 1e9, True, 0.0, 0.0, 0.0, 0.0
        prev = None
        ok = True
        swing_side = {"L": 0.0, "R": 0.0}
        for i in range(0, 16):
            f = pose(backlift_compact_controls(set_ctrl, i / RATE, off, body))
            w, e, miss, sw, rem = top_checks(f)
            for k_ in "LR":
                swing_side[k_] = max(swing_side[k_], f["swingBySide"][k_])
            worst_w, elbows = min(worst_w, w), elbows and e
            worst_miss, worst_swing, worst_rem = max(worst_miss, miss), max(worst_swing, sw), max(worst_rem, rem)
            if prev is not None:
                for b in arm_bones:
                    a_ = math.degrees(prev["q"][b].rotation_difference(f["q"][b]).angle)
                    worst_speed = max(worst_speed, min(a_, 360 - a_) * RATE)
            prev = f
            why = [k for k, bad in (("wristTorso", w < 0.095), ("elbow", not e), ("reach", miss > 0.0005),
                                    ("wristSwing", sw > 80), ("handTwist", rem > 10), ("armSpeed", worst_speed > 1100))
                   if bad]
            if why:
                ok = False
                break
        rec = {"dz": round(dz, 3), "dy": dy, "gripFollow": kf, "swingBySide": swing_side, "hipsZ": hz, "chestPitch": cp, "poleR": POLES_R_TOP[ir], "poleL": POLES_L_TOP[il],
               "wristTorsoMinM": round(worst_w, 4), "elbowsOk": elbows, "missM": round(worst_miss, 4),
               "wristSwingMaxDeg": round(worst_swing, 1), "handTwistRemainderMaxDeg": round(worst_rem, 1),
               "armSpeedMaxDegS": round(worst_speed, 0), "ok": ok, "stoppedAtFrame": i, "why": why}
        tried.append(rec)
        if ok:
            return off, body, tried
    return None, None, tried


def clip_backlift_compact(base_set):
    dur = 0.25
    n = int(round(dur * RATE)) + 1
    frames = [pose(backlift_compact_controls(base_set, i / RATE, COMPACT_MID_OFFSET, tuple(COMPACT_BODY))) for i in range(n)]
    return {"id": "bat_backlift_compact", "loop": False, "dur": dur, "rate": RATE, "frames": frames,
            "markers": {"release": 0.0, "top": 0.25, "handoff": 0.25}}


TOP_DIR = Vector((-0.78, 0.55, -0.30)).normalized()
TOP_SHIFT = Vector((-0.10, 0.012, -0.05))


def clip_backlift(base_set):
    dur = 0.60
    n = int(round(dur * RATE)) + 1
    frames = [pose(backlift_controls(base_set, i / RATE, TOP_DIR, TOP_SHIFT)) for i in range(n)]
    return {"id": "bat_backlift", "loop": False, "dur": dur, "rate": RATE, "frames": frames,
            "markers": {"release": 0.0, "top": 0.25, "handoff": 0.25}}


def clip_ready_hold(base_top):
    dur, rate = 1.2, 30
    n = int(dur * rate)
    frames = []
    for i in range(n + 1):  # closing frame
        t = i / rate
        c = dict(base_top)
        ph = 2 * math.pi * t / dur
        c["chestPitch"] = base_top["chestPitch"] + 0.5 * math.sin(ph)
        c["hips"] = base_top["hips"] + Vector((0.0, 0.0015 * math.sin(ph), 0.0))
        c["cap"] = base_top["cap"] + Vector((0.0, 0.004 * math.sin(ph), 0.0))
        c["contacts"] = 3
        frames.append(pose(c))
    return {"id": "bat_ready_hold", "loop": True, "dur": dur, "rate": rate, "frames": frames, "markers": {}}


# --------------------------------------------------------------------------------------------------------------------
# VMS1
# --------------------------------------------------------------------------------------------------------------------

def to_vms1(clip, script_rel):
    fr = clip["frames"]
    data = {"ground": [], "hips": [], "contacts": [], "q": []}
    tracks = {"bat.grip": [], "bat.dir": [], "bat.face": []}
    for f in fr:
        data["ground"].append([0.0, 0.0, 0.0])
        h = f["hips"]
        data["hips"].append([V.r6(h.x), V.r6(h.y), V.r6(h.z)])
        data["contacts"].append(int(f["contacts"]))
        flat = []
        for b in V.BONES:
            flat += V.quat_list(f["q"][b])
        data["q"].append(flat)
        g, d = f["bat"]["bottom"], f["bat"]["dir"]
        tracks["bat.grip"].append([V.r6(g.x), V.r6(g.y), V.r6(g.z)])
        tracks["bat.dir"].append([V.r6(d.x), V.r6(d.y), V.r6(d.z)])
        fc = f["bat"]["face"]
        tracks["bat.face"].append([V.r6(fc.x), V.r6(fc.y), V.r6(fc.z)])
    return {
        "format": "VMS1", "id": clip["id"], "pack": "batter", "role": "batter", "skeleton": "VC17",
        "sampleRate": clip["rate"], "loop": clip["loop"], "mirrorable": True, "overlay": False, "codec": 2,
        "boneMask": "all", "speedMps": 0, "cycleSteps": 0, "markers": clip["markers"], "mirrorAliases": {},
        "frames": data,
        "tracks": {"bat.grip": {"kind": "position", "frames": tracks["bat.grip"]},
                   "bat.dir": {"kind": "direction", "frames": tracks["bat.dir"]},
                   "bat.face": {"kind": "direction", "frames": tracks["bat.face"]}},
        "provenance": {"author": "TRACKB (Claude agent for the owner)",
                       "method": "original keyed controls in Blender 5.2.3, baked per frame with two-bone IK "
                                 "(VC17, MOTION-SPEC v1.1)",
                       "script": script_rel, "licence": "owner-made original", "sources": []},
    }


def bake(out, assets):
    base = stance_setup()
    live = clip_stance_live(base)
    trig = clip_trigger(base)
    set_ctrl = trigger_controls(base, 0.55)
    back = clip_backlift(set_ctrl)
    top_ctrl = backlift_controls(set_ctrl, 0.60, TOP_DIR, TOP_SHIFT)
    hold = clip_ready_hold(top_ctrl)
    off, body, tried = choose_compact_offset(set_ctrl)
    print("COMPACT_OFFSET", None if off is None else list(off), body, json.dumps(tried[-3:]))
    if off is None:
        from collections import Counter
        print("COMPACT_FAILS", json.dumps(Counter("%s@f%d" % ("+".join(r["why"]), r["stoppedAtFrame"]) for r in tried).most_common(12)))
        print("COMPACT_FURTHEST", json.dumps(sorted(tried, key=lambda r: -r["stoppedAtFrame"])[:6]))
        raise SystemExit("no compact top passes §9: not writing failing clips")
    COMPACT_MID_OFFSET.x, COMPACT_MID_OFFSET.y, COMPACT_MID_OFFSET.z = off.x, off.y, off.z
    COMPACT_BODY[:] = list(body)
    backc = clip_backlift_compact(set_ctrl)
    topc = backlift_compact_controls(set_ctrl, 0.25, COMPACT_MID_OFFSET, tuple(COMPACT_BODY))
    holdc = clip_ready_hold(topc)
    holdc["id"] = "bat_ready_hold_compact"
    clips = [live, trig, back, hold, backc, holdc]
    report = {"clips": {}}
    for clip in clips:
        rec = to_vms1(clip, "scripts/blender/motion/batter_anticipation.py")
        mf = clip["frames"][:-1] if clip["loop"] else clip["frames"]
        bats = [f["bat"] for f in mf]
        m = V.measure(mf, clip["rate"], clip["loop"], bats)
        m["armReachMissMaxM"] = round(max(max(f["misses"].values()) for f in clip["frames"]), 5)
        m["elbowFlexDeg"] = {s: [round(min(elbow_flex(f["P"], s) for f in clip["frames"]), 1),
                                 round(max(elbow_flex(f["P"], s) for f in clip["frames"]), 1)] for s in "LR"}
        # bat face (the runtime turns the face towards the bowler, +X, about the handle): its angle off the bowler
        face_err = []
        toe_h = []
        for f in clip["frames"]:
            face_err.append(math.degrees(f["bat"]["face"].angle(BOWLER)))
            toe_h.append(f["bat"]["toe"].y)
        m["batFaceOffBowlerDeg"] = [round(min(face_err), 1), round(max(face_err), 1)]
        m["batToeHeightM"] = [round(min(toe_h), 4), round(max(toe_h), 4)]
        m["batDirFirstLast"] = [[round(x, 3) for x in clip["frames"][0]["bat"]["dir"]],
                                [round(x, 3) for x in clip["frames"][-1]["bat"]["dir"]]]
        m["batGripFirstLast"] = [[round(x, 3) for x in clip["frames"][0]["bat"]["bottom"]],
                                 [round(x, 3) for x in clip["frames"][-1]["bat"]["bottom"]]]
        m["handWristHeightsFirstLast"] = {s: [round(clip["frames"][0]["P"]["hand" + s].y, 3),
                                              round(clip["frames"][-1]["P"]["hand" + s].y, 3)] for s in "LR"}
        thor = [math.degrees((f["P"]["neck"] - f["P"]["spine"]).angle(Vector((0, 1, 0)))) for f in clip["frames"]]
        m["thoraxPitchDeg"] = [round(min(thor), 1), round(max(thor), 1)]
        knees = [knee_flex(f["W"]["hips"], f["P"]["hips"], s, f["P"]["foot" + s]) for f in clip["frames"] for s in "LR"]
        m["kneeFlexDeg"] = [round(min(knees), 1), round(max(knees), 1)]
        # head: world forward and roll
        heads = [f["W"]["head"] for f in clip["frames"]]
        yaw = [math.degrees(math.atan2((h @ Vector((0, 0, 1))).x, (h @ Vector((0, 0, 1))).z)) for h in heads]
        roll = [math.degrees(math.asin(max(-1, min(1, (h @ Vector((1, 0, 0))).y)))) for h in heads]
        m["headYawToPlusXDeg"] = [round(min(yaw), 2), round(max(yaw), 2)]
        m["headRollDeg"] = [round(min(roll), 2), round(max(roll), 2)]
        hp = [f["P"]["head"] for f in clip["frames"]]
        m["headTravelM"] = round(max((p - hp[0]).length for p in hp), 4)
        report["clips"][clip["id"]] = m
        path = os.path.join(out, clip["id"] + ".vms.json")
        V.write_vms1(path, rec)
        if assets:
            os.makedirs(assets, exist_ok=True)
            V.write_vms1(os.path.join(assets, clip["id"] + ".vms.json"), rec)
        print("CLIP", clip["id"], len(clip["frames"]), "frames", json.dumps(m)[:900])
    # continuity across clip seams (the next clip's frame 0 against the previous clip's end)
    seams = {}
    for a, b, a_frame in ((trig, back, -1), (back, hold, -1), (live, trig, 0), (trig, backc, -1), (backc, holdc, -1)):
        fa, fb = a["frames"][a_frame], b["frames"][0]
        worst = max(math.degrees(fa["q"][k].rotation_difference(fb["q"][k]).angle) for k in V.BONES)
        worst = min(worst, 360 - worst)
        seams["%s->%s" % (a["id"], b["id"])] = {"maxBoneDeg": round(worst, 3),
                                                "hipsM": round((fa["hips"] - fb["hips"]).length, 5),
                                                "gripM": round((fa["bat"]["bottom"] - fb["bat"]["bottom"]).length, 5)}
    report["seams"] = seams
    report["compactOffset"] = {"applied": list(COMPACT_MID_OFFSET), "body": {"hipsZ": COMPACT_BODY[0],
                                                                            "chestPitchDelta": COMPACT_BODY[1],
                                                                            "bottomElbowPoleAtTop": COMPACT_BODY[2],
                                                                            "topElbowPoleAtTop": COMPACT_BODY[3],
                                                                            "gripFollow": COMPACT_BODY[4]},
                               "grip": "the hands turn with the blade from their set-pose frames by gripFollow of its "
                                       "turn (1 = rigid); the wrists flex",
                               "tried": tried[-5:], "topHandsMid": list(COMPACT_MID + COMPACT_MID_OFFSET)}
    report["setup"] = {"stance": {k: (list(v) if isinstance(v, (Vector, tuple)) else v) for k, v in STANCE.items()},
                       "stanceBat": STANCE_BAT, "trigger": {k: (list(v) if isinstance(v, Vector) else v)
                                                            for k, v in TRIGGER.items()},
                       "topDir": list(TOP_DIR), "topShift": list(TOP_SHIFT), "palmRef": list(PALM_REF),
                       "poles": {"bottom": list(POLE_BOTTOM), "top": list(POLE_TOP)}}
    with open(os.path.join(out, "bake-report.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=lambda o: list(o) if isinstance(o, Vector) else str(o))
    print("SEAMS", json.dumps(seams))
    return clips


# --------------------------------------------------------------------------------------------------------------------
# Mannequin renders (Blender frame B(x, y, z) = (x, -z, y))
# --------------------------------------------------------------------------------------------------------------------

def B(v):
    return Vector((v.x, -v.z, v.y))


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def material(name, rgb, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def capsule(name, a, b, r, mat):
    d = b - a
    L = d.length
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=max(L, 1e-4), vertices=16)
    cyl = bpy.context.active_object
    cyl.name = name
    cyl.location = (a + b) / 2
    cyl.rotation_mode = "QUATERNION"
    cyl.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized()) if L > 1e-6 else Quaternion()
    cyl.data.materials.append(mat)
    for p in (a, b):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=p, segments=16, ring_count=8)
        s = bpy.context.active_object
        s.data.materials.append(mat)


def draw_pose(f, mats, bat_pose=None):
    P = {k: B(v) for k, v in f["P"].items()}
    W = f["W"]
    sk, kit, trou, shoe = mats["skin"], mats["kit"], mats["trousers"], mats["shoe"]
    # torso and limbs
    capsule("pelvis", P["thighL"] if False else P["hips"] + Vector((0, 0, -0.02)), P["spine"], 0.13, trou)
    capsule("abdomen", P["spine"], P["chest"], 0.14, kit)
    capsule("chestc", P["chest"], P["neck"] + (P["chest"] - P["neck"]) * 0.2, 0.15, kit)
    capsule("neckc", P["neck"], P["head"], 0.05, sk)
    hd = W["head"]
    head_c = P["head"] + B(hd @ Vector((0, 0.09, 0.02)))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.105, location=head_c, segments=24, ring_count=12)
    bpy.context.active_object.data.materials.append(sk)
    nose = P["head"] + B(hd @ Vector((0, 0.07, 0.12)))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.025, location=nose)
    bpy.context.active_object.data.materials.append(mats["face"])
    for s in "LR":
        capsule("ua" + s, P["upperArm" + s], P["forearm" + s], 0.045, kit)
        capsule("fa" + s, P["forearm" + s], P["hand" + s], 0.038, kit)
        hand_tip = P["hand" + s] + B(W["hand" + s] @ Vector((0, -0.09, 0)))
        capsule("hd" + s, P["hand" + s], hand_tip, 0.04, mats["glove"])
        capsule("th" + s, P["thigh" + s], P["shin" + s], 0.07, trou)
        capsule("sh" + s, P["shin" + s], P["foot" + s], 0.055, trou)
        toe = P["foot" + s] + B(W["foot" + s] @ Vector((0, -0.04, 0.17)))
        capsule("ft" + s, P["foot" + s] + B(W["foot" + s] @ Vector((0, -0.04, -0.04))), toe, 0.045, shoe)
    # bat
    bp = bat_pose if bat_pose is not None else f["bat"]
    cap, d = B(bp["cap"]), B(bp["dir"])
    capsule("handle", cap, cap + d * V.HANDLE_L, 0.0165, mats["grip"])
    bpy.ops.mesh.primitive_cube_add(size=1)
    blade = bpy.context.active_object
    blade.scale = (0.108, 0.05, V.BLADE_L)
    mid = cap + d * (V.HANDLE_L + V.BLADE_L / 2)
    blade.location = mid
    face = B(BOWLER) - d * B(BOWLER).dot(d)
    face.normalize()
    side = d.cross(face).normalized()
    m = Matrix((side, -face, -d)).transposed()
    blade.rotation_mode = "QUATERNION"
    blade.rotation_quaternion = m.to_quaternion()
    blade.data.materials.append(mats["willow"])
    # mark the face with a thin dark stripe on the back (spine) side so the face direction reads
    bpy.ops.mesh.primitive_cube_add(size=1)
    spine = bpy.context.active_object
    spine.scale = (0.02, 0.012, V.BLADE_L * 0.9)
    spine.location = mid - face * 0.03
    spine.rotation_mode = "QUATERNION"
    spine.rotation_quaternion = m.to_quaternion()
    spine.data.materials.append(mats["grip"])


def setup_render(scene):
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "CYCLES"
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    bg.inputs["Strength"].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(material("ground", (0.33, 0.45, 0.26), 0.95))
    # stumps behind the batter (towards -X, the keeper), at the crease line
    for k in (-0.11, 0.0, 0.11):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.018, depth=0.71, location=(-0.9, -(0.0) + k * 0 - 0.0 + 0.0, 0.355))
        st = bpy.context.active_object
        st.location = (-0.9, k, 0.355)
        st.data.materials.append(material("stump", (0.9, 0.88, 0.8)))


def camera(scene, eye, target, fov=28.0):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = eye
    cam.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = math.radians(fov)
    scene.camera = cam
    return cam


VIEWS = {
    # Blender frame: the batter faces -Y (off side), the bowler is at +X
    "front": (Vector((0.6, -4.2, 1.05)), Vector((0.0, -0.1, 0.85))),       # from the off side, face-on to the batter
    "behind": (Vector((-4.0, 0.9, 1.4)), Vector((0.2, -0.1, 0.85))),       # from behind (keeper side), rear-shoulder
    "bowler": (Vector((5.5, -0.3, 1.5)), Vector((0.0, -0.1, 0.9))),        # from the bowler's end
}


def render_pose(out, label, f, bat_pose=None):
    clear_scene()
    scene = bpy.context.scene
    setup_render(scene)
    mats = {"skin": material("skin", (0.42, 0.26, 0.17)), "kit": material("kit", (0.06, 0.2, 0.36)),
            "trousers": material("trou", (0.04, 0.12, 0.21)), "shoe": material("shoe", (0.85, 0.86, 0.88)),
            "glove": material("glove", (0.86, 0.85, 0.8)), "grip": material("grip", (0.05, 0.05, 0.06)),
            "willow": material("willow", (0.82, 0.68, 0.45)), "face": material("face", (0.3, 0.18, 0.12))}
    draw_pose(f, mats, bat_pose)
    for view, (eye, tgt) in VIEWS.items():
        camera(scene, eye, tgt)
        scene.render.resolution_x, scene.render.resolution_y = 960, 720
        scene.render.filepath = os.path.join(out, "%s-%s.png" % (label, view))
        bpy.ops.render.render(write_still=True)


def before_pose():
    """The current web batter before the swing: clips.ts `stance` key 0 (STANCE_LOWER + STANCE_UPPER, root -0.07)
    with the presentation bat bat.ts STANCE (physics frame: cap (-0.1, 1.08, 9.02), toe (0.02, 1.62, 9.62)) placed
    in the actor frame (striker at physics (-0.15, 8.96), heading facing +x), hands by the web's reachIK."""
    E = {"hips": (0, 0, 0), "thighL": (-16, 0, 15), "shinL": (24, 0, 0), "footL": (-8, -16, 0),
         "thighR": (-14, 0, -13), "shinR": (24, 0, 0), "footR": (-10, 8, 0), "spine": (22, 2, 0), "chest": (8, 6, 0),
         "neck": (-14, 38, 0), "head": (-6, 32, 0), "handL": (0, 0, 0), "handR": (0, 0, 0)}
    q = {b: Quaternion() for b in V.BONES}
    for b, e in E.items():
        q[b] = V.euler_xyz(*e)
    hips_off = Vector((0, -0.07, 0))
    W, P = V.fk(q, hips_off)

    def actor(p):
        return Vector((-(p[2] - 8.96), p[1], p[0] + 0.15))
    cap = actor((-0.1, 1.08, 9.02))
    toe = actor((0.02, 1.62, 9.62))
    d = (toe - cap).normalized()
    bp = V.bat_points(cap, d)
    for side, target, pole in (("R", bp["bottom"], POLE_BOTTOM), ("L", bp["top"], POLE_TOP)):
        s = P["chest"] + W["chest"] @ Vector(V.OFFSET["upperArm" + side])
        elbow, w, miss = V.two_bone(s, target, V.UPPER_ARM, V.FOREARM, pole)
        du = (elbow - s).normalized()
        Wu = Vector((0, -1, 0)).rotation_difference(du)  # the web's aimBone: swing only
        q["upperArm" + side] = W["chest"].inverted() @ Wu
        df = (w - elbow).normalized()
        Wf = Vector((0, -1, 0)).rotation_difference(df)
        q["forearm" + side] = Wu.inverted() @ Wf
        W, P = V.fk(q, hips_off)
    return {"q": q, "W": W, "P": P, "bat": bp, "hips": hips_off}


def render_all(out):
    base = stance_setup()
    set_ctrl = trigger_controls(base, 0.55)
    poses = {"before-web-stance": before_pose(), "after-stance": pose(base), "after-trigger-set": pose(set_ctrl),
             "after-backlift-top": pose(backlift_controls(set_ctrl, 0.25, TOP_DIR, TOP_SHIFT)),
             "after-backlift-end": pose(backlift_controls(set_ctrl, 0.60, TOP_DIR, TOP_SHIFT))}
    for label, f in poses.items():
        render_pose(out, label, f)
    print("RENDERED", list(poses))


def render_compact(out):
    """Stills of the compact backlift (rigid grip): the set pose, mid-way (0.125 s) and the top (0.25 s)."""
    base = stance_setup()
    set_ctrl = trigger_controls(base, 0.55)
    off, body, _ = choose_compact_offset(set_ctrl)
    if off is None:
        raise SystemExit("no compact top passes §9")
    poses = {"compact-set": pose(set_ctrl), "compact-mid": pose(backlift_compact_controls(set_ctrl, 0.125, off, body)),
             "compact-top": pose(backlift_compact_controls(set_ctrl, 0.25, off, body))}
    for label, f in poses.items():
        render_pose(out, label, f)
    print("RENDERED", list(poses))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    mode, out = argv[0], argv[1]
    os.makedirs(out, exist_ok=True)
    if mode == "search":
        search(out)
    elif mode == "probe":
        probe(out, argv[2])
    elif mode == "bake":
        assets = argv[argv.index("--assets") + 1] if "--assets" in argv else None
        bake(out, assets)
    elif mode == "render":
        render_all(out)
    elif mode == "render_compact":
        render_compact(out)
    else:
        raise SystemExit("mode: search | bake | render")


main()
