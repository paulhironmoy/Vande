"""
VC17 kinematics for TRACKB's batter clips (MOTION-SPEC v1/v1.1): forward kinematics on the canonical 17-bone
skeleton, two-bone IK with explicit hinge frames, head stabilisation, the VMS1 source writer and the §9 naturalness
measurements. Pure mathutils (runs inside Blender, no scene state).

Canonical (actor) frame: Y up, +Z the character's forward, +X the character's left. Every bone's rest rotation is
identity; limb bones point along local -Y, spine/neck/head along +Y. Hinges follow the skeleton.ts conventions:
forearm X < 0 bends the elbow, shin X > 0 bends the knee.
"""
import math

from mathutils import Matrix, Quaternion, Vector

import vms_json  # the one canonical VMS1 text form (scripts/blender/motion/vms_json.py)

BONES = ["hips", "spine", "chest", "neck", "head", "upperArmL", "forearmL", "handL", "upperArmR", "forearmR",
         "handR", "thighL", "shinL", "footL", "thighR", "shinR", "footR"]
PARENT = {"hips": None, "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck", "upperArmL": "chest",
          "forearmL": "upperArmL", "handL": "forearmL", "upperArmR": "chest", "forearmR": "upperArmR",
          "handR": "forearmR", "thighL": "hips", "shinL": "thighL", "footL": "shinL", "thighR": "hips",
          "shinR": "thighR", "footR": "shinR"}
OFFSET = {"hips": (0, 0.98, 0), "spine": (0, 0.11, 0), "chest": (0, 0.20, 0), "neck": (0, 0.235, 0),
          "head": (0, 0.085, 0.012), "upperArmL": (0.205, 0.182, -0.012), "forearmL": (0, -0.285, 0),
          "handL": (0, -0.255, 0), "upperArmR": (-0.205, 0.182, -0.012), "forearmR": (0, -0.285, 0),
          "handR": (0, -0.255, 0), "thighL": (0.095, -0.065, 0), "shinL": (0, -0.43, 0), "footL": (0, -0.42, 0),
          "thighR": (-0.095, -0.065, 0), "shinR": (0, -0.43, 0), "footR": (0, -0.42, 0)}
HIPS_REST = Vector((0.0, 0.98, 0.0))
ANKLE_REST_Y = 0.065
UPPER_ARM, FOREARM, THIGH, SHIN = 0.285, 0.255, 0.43, 0.42
# A gripping hand holds the handle in its palm: the palm centre is this far along the hand (local -Y) from the wrist.
PALM = 0.065
# Physics bat (src/physics/constants.ts): handle 0.30 m, blade 0.56 m, hands' centres from the cap.
HANDLE_L, BLADE_L, TOP_HAND_FROM_CAP, LOWER_HAND_FROM_CAP = 0.30, 0.56, 0.025, 0.125
BAT_FULL = HANDLE_L + BLADE_L
SKELETON_STRING = ("VC17:hips,spine,chest,neck,head,upperArmL,forearmL,handL,upperArmR,forearmR,handR,thighL,"
                   "shinL,footL,thighR,shinR,footR")


def rx(deg):
    return Quaternion((1, 0, 0), math.radians(deg))


def ry(deg):
    return Quaternion((0, 1, 0), math.radians(deg))


def rz(deg):
    return Quaternion((0, 0, 1), math.radians(deg))


def euler_xyz(x, y, z):
    """three.js Euler order XYZ (R = Rx Ry Rz), degrees, as clips.ts writes it."""
    return rx(x) @ ry(y) @ rz(z)


def fk(q, hips_off):
    """World rotations and joint positions (actor frame) from local quaternions and the hips offset."""
    W, P = {}, {}
    for b in BONES:
        p = PARENT[b]
        if p is None:
            W[b] = q[b].copy()
            P[b] = HIPS_REST + hips_off
        else:
            P[b] = P[p] + W[p] @ Vector(OFFSET[b])
            W[b] = W[p] @ q[b]
    return W, P


def frame_quat(x_axis, y_axis, z_axis):
    m = Matrix((x_axis, y_axis, z_axis)).transposed()
    return m.to_quaternion()


def limb_frame(dir_down, z_hint):
    """World rotation whose local -Y points along dir_down and whose local +Z leans towards z_hint."""
    y = -dir_down.normalized()
    z = z_hint - y * z_hint.dot(y)
    if z.length < 1e-6:
        z = Vector((0, 0, 1)) - y * y.z
        if z.length < 1e-6:
            z = Vector((1, 0, 0)) - y * y.x
    z.normalize()
    x = y.cross(z).normalized()
    return frame_quat(x, y, z)


def two_bone(s, t, a, b, pole):
    v = t - s
    d = max(abs(a - b) + 1e-4, min(a + b - 1e-4, v.length))
    n = v.normalized()
    cos_a = (a * a + d * d - b * b) / (2 * a * d)
    sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
    m = pole - s
    m = m - n * m.dot(n)
    if m.length < 1e-8:
        m = Vector((0, -1, 0)) - n * (-n.y)
    m.normalize()
    elbow = s + n * (a * cos_a) + m * (a * sin_a)
    return elbow, s + n * d, (v.length - d)


def twist_about_y(q):
    """Signed twist angle (degrees) of q about local Y (swing-twist decomposition, twist applied first)."""
    p = Vector((q.x, q.y, q.z))
    proj = Vector((0, p.y, 0))
    tw = Quaternion((q.w, proj.x, proj.y, proj.z))
    if tw.magnitude < 1e-9:
        return 0.0
    tw.normalize()
    ang = 2 * math.degrees(math.atan2(tw.y, tw.w))
    return ((ang + 180) % 360) - 180


def solve_arm(Wchest, Pchest, side, wrist, pole, hand_world, palm=0.0):
    """Upper arm, forearm (hinge + pronation twist) and hand (twist-free) local rotations. With palm = 0 the wrist
    reaches `wrist`; with palm > 0 the palm centre (the wrist plus `palm` along a neutral wrist) reaches it."""
    up = "upperArm" + side
    s = Pchest + Wchest @ Vector(OFFSET[up])
    elbow, p_eff, miss = two_bone(s, wrist, UPPER_ARM, FOREARM + palm, pole)
    w_eff = elbow + (p_eff - elbow).normalized() * FOREARM
    du = (elbow - s).normalized()
    df = (w_eff - elbow).normalized()
    bend = df - du * df.dot(du)
    hint = bend if bend.length > 1e-5 else (pole - s)
    Wu = limb_frame(du, hint)  # elbow bends towards upper-arm local +Z
    lu = Wchest.inverted() @ Wu
    alpha = math.degrees(du.angle(df)) if bend.length > 1e-6 else 0.0
    hinge = rx(-alpha)
    M = hinge.inverted() @ Wu.inverted() @ hand_world
    tw = twist_about_y(M)
    # Forearm pronation/supination stays inside +/-89.5° (anatomical, and where the Euler XYZ limit check would flip);
    # any remainder stays in the hand. Clips whose twist never reaches it are unchanged.
    tw = max(-89.5, min(89.5, tw))
    lf = hinge @ ry(tw)
    Wf = Wu @ lf
    lh = Wf.inverted() @ hand_world
    return {up: lu, "forearm" + side: lf, "hand" + side: lh}, miss, s, elbow


def solve_leg(Whips, Phips, side, ankle, pole, foot_yaw_deg):
    th = "thigh" + side
    h = Phips + Whips @ Vector(OFFSET[th])
    knee, a_eff, miss = two_bone(h, ankle, THIGH, SHIN, pole)
    dt = (knee - h).normalized()
    ds = (a_eff - knee).normalized()
    bend = ds - dt * ds.dot(dt)
    hint = -bend if bend.length > 1e-5 else (pole - h)
    Wt = limb_frame(dt, hint)  # the shin bends towards thigh local -Z
    lt = Whips.inverted() @ Wt
    alpha = math.degrees(dt.angle(ds)) if bend.length > 1e-6 else 0.0
    ls = rx(alpha)
    Ws = Wt @ ls
    Wfoot = ry(foot_yaw_deg)
    lfoot = Ws.inverted() @ Wfoot
    return {th: lt, "shin" + side: ls, "foot" + side: lfoot}, miss


def hand_frame(forearm_dir, palm_ref, side):
    """Hand world rotation continuing the forearm (neutral wrist): -Y along the forearm, +X towards palm_ref
    (the back of a left hand / the palm of a right hand both face palm_ref, so the two Vs line up)."""
    y = -forearm_dir.normalized()
    x = palm_ref - y * palm_ref.dot(y)
    if x.length < 1e-6:
        x = Vector((1, 0, 0))
    x.normalize()
    z = x.cross(y)
    return frame_quat(x, y, z)


def bat_points(cap, dirv):
    d = dirv.normalized()
    return {"cap": cap, "top": cap + d * TOP_HAND_FROM_CAP, "bottom": cap + d * LOWER_HAND_FROM_CAP,
            "toe": cap + d * BAT_FULL, "dir": d}


def r6(x):
    return float(round(x, 6)) + 0.0


def quat_list(q):
    q = q.normalized()
    if q.w < 0:
        q = -q
    return [r6(q.x), r6(q.y), r6(q.z), r6(q.w)]


def write_vms1(path, clip):
    vms_json.write(path, clip)


def fnv1a32(s):
    h = 0x811C9DC5
    for ch in s.encode("ascii"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def euler_xyz_of(q):
    """three.js XYZ Euler (degrees) of a quaternion, for the joint-limit checks."""
    m = q.to_matrix()
    # R = Rx Ry Rz: m[0][2] = sin(y)
    sy = max(-1.0, min(1.0, m[0][2]))
    y = math.asin(sy)
    if abs(sy) < 0.9999999:
        x = math.atan2(-m[1][2], m[2][2])
        z = math.atan2(-m[0][1], m[0][0])
    else:
        x = math.atan2(m[2][1], m[1][1])
        z = 0.0
    return math.degrees(x), math.degrees(y), math.degrees(z)


POP_CAP = {"hips": 600, "spine": 600, "chest": 600, "neck": 720, "head": 720}


def measure(frames, rate, loop, bat_frames=None, planted=None):
    """MOTION-SPEC §9 measurements on a list of per-frame poses (dict bone -> local quaternion, hips offset)."""
    n = len(frames)
    res = {"frames": n, "rate": rate}
    worst_speed = {b: 0.0 for b in BONES}
    worst_acc = 0.0
    prev_speed = {b: None for b in BONES}
    pairs = list(range(n - 1)) + ([n - 1] if loop else [])
    for i in pairs:
        j = (i + 1) % n
        for b in BONES:
            qa, qb = frames[i]["q"][b], frames[j]["q"][b]
            ang = math.degrees(qa.rotation_difference(qb).angle)
            ang = min(ang, 360 - ang)
            sp = ang * rate
            worst_speed[b] = max(worst_speed[b], sp)
            if prev_speed[b] is not None:
                worst_acc = max(worst_acc, abs(sp - prev_speed[b]))
            prev_speed[b] = sp
    caps_fail = []
    for b, sp in worst_speed.items():
        cap = POP_CAP.get(b, 1200)
        if sp > cap:
            caps_fail.append((b, round(sp, 1), cap))
    res["poseSpeedMaxDegPerS"] = {b: round(v, 1) for b, v in worst_speed.items()}
    res["poseSpeedFails"] = caps_fail
    res["poseAccelMaxDegPerSPerFrame"] = round(worst_acc, 1)
    # hips (ground is zero for these in-place clips) horizontal speed step
    hip = [f["hips"] for f in frames]
    speeds = []
    for i in pairs:
        j = (i + 1) % n
        dv = hip[j] - hip[i]
        speeds.append(math.hypot(dv.x, dv.z) * rate)
    steps = [abs(speeds[k + 1] - speeds[k]) for k in range(len(speeds) - 1)]
    res["hipsSpeedMaxMps"] = round(max(speeds), 4) if speeds else 0
    res["hipsSpeedStepMaxMpsPerFrame"] = round(max(steps), 4) if steps else 0
    # feet: slide over planted intervals, ground height
    slide = {"L": 0.0, "R": 0.0}
    height = {"L": [1e9, -1e9], "R": [1e9, -1e9]}
    for side, bit in (("L", 1), ("R", 2)):
        runs, cur = [], []
        for i, f in enumerate(frames):
            if f["contacts"] & bit:
                # MOTION-SPEC v1.1 §9: the plant point is the ball of the foot
                cur.append(f["P"]["foot" + side] + f["W"]["foot" + side] @ Vector((0, -0.065, 0.135)))
                h = f["ankle" + side].y - ANKLE_REST_Y
                height[side][0] = min(height[side][0], h)
                height[side][1] = max(height[side][1], h)
            elif cur:
                runs.append(cur)
                cur = []
        if cur:
            runs.append(cur)
        for run in runs:
            mx = sum(p.x for p in run) / len(run)
            mz = sum(p.z for p in run) / len(run)
            slide[side] = max(slide[side], max(math.hypot(p.x - mx, p.z - mz) for p in run))
    res["footSlideMaxM"] = {k: round(v, 4) for k, v in slide.items()}
    res["footGroundHeightRangeM"] = {k: [round(v[0], 4), round(v[1], 4)] for k, v in height.items()}
    # joint limits (Euler XYZ, canonical signs) and wrist swing
    lim = {"kneeX": [1e9, -1e9], "kneeZabs": 0, "elbowX": [1e9, -1e9], "elbowZabs": 0, "ankleX": [1e9, -1e9],
           "wristSwingMax": 0, "spineTotalMax": 0, "chestTotalMax": 0, "neckTotalMax": 0, "headTotalMax": 0}
    for f in frames:
        for side in "LR":
            x, y, z = euler_xyz_of(f["q"]["shin" + side])
            lim["kneeX"] = [min(lim["kneeX"][0], x), max(lim["kneeX"][1], x)]
            lim["kneeZabs"] = max(lim["kneeZabs"], abs(z))
            x, y, z = euler_xyz_of(f["q"]["forearm" + side])
            lim["elbowX"] = [min(lim["elbowX"][0], x), max(lim["elbowX"][1], x)]
            lim["elbowZabs"] = max(lim["elbowZabs"], abs(z))
            x, y, z = euler_xyz_of(f["q"]["foot" + side])
            lim["ankleX"] = [min(lim["ankleX"][0], x), max(lim["ankleX"][1], x)]
            hq = f["q"]["hand" + side]
            sw = math.degrees((hq @ Vector((0, -1, 0))).angle(Vector((0, -1, 0))))
            lim["wristSwingMax"] = max(lim["wristSwingMax"], sw)
        for b, k in (("spine", "spineTotalMax"), ("chest", "chestTotalMax"), ("neck", "neckTotalMax"),
                     ("head", "headTotalMax")):
            lim[k] = max(lim[k], math.degrees(f["q"][b].angle))
    res["jointLimits"] = {k: ([round(v[0], 1), round(v[1], 1)] if isinstance(v, list) else round(v, 1))
                          for k, v in lim.items()}
    lim_fail = []
    if lim["kneeX"][0] < -5 or lim["kneeX"][1] > 155 or lim["kneeZabs"] > 10:
        lim_fail.append("knee")
    if lim["elbowX"][0] < -150 or lim["elbowX"][1] > 5 or lim["elbowZabs"] > 12:
        lim_fail.append("elbow")
    if lim["ankleX"][0] < -40 or lim["ankleX"][1] > 60:
        lim_fail.append("ankle")
    if lim["wristSwingMax"] > 85:
        lim_fail.append("wrist")
    for k in ("spineTotalMax", "chestTotalMax"):
        if lim[k] > 75:
            lim_fail.append(k)
    for k in ("neckTotalMax", "headTotalMax"):
        if lim[k] > 80:
            lim_fail.append(k)
    res["jointLimitFails"] = lim_fail
    # self-penetration: wrist to the hips-neck segment
    worst = 1e9
    for f in frames:
        a, b = f["P"]["hips"], f["P"]["neck"]
        ab = b - a
        for side in "LR":
            w = f["P"]["hand" + side]
            t = max(0.0, min(1.0, (w - a).dot(ab) / ab.length_squared))
            worst = min(worst, (w - (a + ab * t)).length)
    res["wristToTorsoMinM"] = round(worst, 4)
    # hands on the bat: wrist joints to the bat's hand points (the runtime IK targets)
    if bat_frames:
        worst_hand = 0.0
        for f, bf in zip(frames, bat_frames):
            for side, key in (("R", "bottom"), ("L", "top")):
                palm = f["P"]["hand" + side] + f["W"]["hand" + side] @ Vector((0, -PALM, 0))
                worst_hand = max(worst_hand, (palm - bf[key]).length)
        res["palmToHandPointMaxM"] = round(worst_hand, 5)
    return res
