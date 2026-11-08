"""MOTION-BOWL run-up plan: fit a run-up to a duration D (run-up start -> release), then compose it from the bowler
pack's clips exactly as a runtime would, and measure it.

The parametrisation (for WEB-HUMANS and UNITY to port):
  run-up = bowl_start  (standing -> walk-in -> jog; exits at a left strike, marker `exit`)
         + N approach strides on the phase-synced gait loops (bowl_jog 3.0 m/s, bowl_run 4.6, bowl_stride 6.2 m/s;
           every loop has frame 0 = left strike; rate 1, blended by speed with the stride-consistent weight)
         + the last-stride set: the delivery clip, entered at its `entry` marker (a left strike), through the bound,
           back-foot contact, front-foot landing and release
         + the follow-through clip, then bowl_walk_back.
  The start hands over at `exitL` (loop phase 0, then an even N) or `exitR` (phase 0.5, odd N).
  Pace: the approach speed ramps 3.0 -> 6.2 m/s with a smoothstep of duration R in [0.9, 1.6] s starting at t_a; the
  placement lam in [0, 1] (early-short to late-long ramp) is the continuous fit parameter.
  Spin: the approach stays at the jog; the cadence scale k in [0.96, 1.04] (stride unchanged; it eases in and out
  as 1 + 2(k-1)sin^2, so it is 1 at both hand-overs and peaks inside MOTION-SPEC's 150-175 spm jog band) is the
  continuous fit parameter.
  The fit chooses the exit, N and the continuous parameter so the release lands exactly at D; any remainder (at most
  0.7 s) is `hold`, the bowler standing at the top of his mark before setting off. Below the shortest standing
  run-up the plan is a rolling start: the clip sequence begins `preRoll` s before the visible run-up start.
  Nothing here changes a physics time or position: release time and hand position are inputs.

    python3 -I scripts/blender/motion/bowler_runup.py <vms_dir> [out.json]
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from bowler_kin import (  # noqa: E402
    BALL_IN_HAND, IDX, fk, metrics, qnlerp, qmul, qy, qrot, quant_frame, read_vms, sample, smoothstep, vadd, vlerp,
)

LOOPS = ("bowl_jog", "bowl_run", "bowl_stride")
R_MIN, R_MAX = 0.9, 1.6
K_MIN, K_MAX = 0.96, 1.04


class Pack:
    def __init__(self, vms_dir):
        self.c = {}
        for f in sorted(os.listdir(vms_dir)):
            if not f.endswith(".vms.json"):
                continue
            d, frames = read_vms(os.path.join(vms_dir, f))
            q = [quant_frame(fr, d.get("codec", 2)) for fr in frames]
            ent = {"d": d, "rate": d["sampleRate"], "loop": d["loop"], "markers": d["markers"], "speed": d["speedMps"]}
            if d["loop"]:
                ent["frames"] = q[:-1]
                ent["travel"] = (q[-1]["ground"][0] - q[0]["ground"][0], q[-1]["ground"][1] - q[0]["ground"][1], 0.0)
                ent["dur"] = len(ent["frames"]) / ent["rate"]
            else:
                ent["frames"] = q
                ent["dur"] = (len(q) - 1) / ent["rate"]
            self.c[d["id"]] = ent

    def at(self, cid, t):
        e = self.c[cid]
        return sample(e["frames"], e["rate"], t, loop=e["loop"], travel=e.get("travel"))


def loop_table(pack):
    """(speed, cycle duration, stride) of each approach loop."""
    out = []
    for cid in LOOPS:
        e = pack.c[cid]
        out.append((e["speed"], e["dur"], e["speed"] * e["dur"], cid))
    return sorted(out)


def blend_of(table, v):
    """Bracketing loops and the stride-consistent weight w with S(w)/T(w) = v."""
    if v <= table[0][0]:
        return table[0], table[0], 0.0
    if v >= table[-1][0]:
        return table[-1], table[-1], 0.0
    for a, b in zip(table, table[1:]):
        if a[0] <= v <= b[0]:
            va, Ta, Sa, _ = a
            vb, Tb, Sb, _ = b
            w = (v * Ta - Sa) / ((Sb - Sa) - v * (Tb - Ta))
            return a, b, max(0.0, min(1.0, w))
    raise ValueError(v)


def cycle_T(table, v):
    a, b, w = blend_of(table, v)
    return a[1] * (1 - w) + b[1] * w


def ramp_v(action_entry, t, t_a, R, v0):
    return v0 + (action_entry - v0) * smoothstep(t_a, t_a + R, t)


def cycles_over(table, A, t_a, R, v0, v1, k=1.0, n=400):
    if A <= 0:
        return 0.0
    h = A / n
    s = 0.0
    for i in range(n):
        t = (i + 0.5) * h
        s += k * h / cycle_T(table, ramp_v(v1, t, t_a, R, v0))
    return s


HOLD_MAX = 0.7
K_SPIN = (0.96, 1.04)


def _pace_ramp(A, lam):
    R = min(R_MIN + (R_MAX - R_MIN) * lam, A)
    return lam * max(0.0, A - R), R


def _pace_A(table, n, lam, v0, v1):
    """Loop-section time that covers exactly n steps for ramp placement lam (0 = early and short, 1 = late and long)."""
    lo, hi = 0.05, 6.0
    for _ in range(32):
        A = 0.5 * (lo + hi)
        t_a, R = _pace_ramp(A, lam)
        if cycles_over(table, A, t_a, R, v0, v1, n=160) * 2 < n:
            lo = A
        else:
            hi = A
    return 0.5 * (lo + hi)


def plan(pack, action, D, allow_roll=True):
    """action: 'pace' | 'off' | 'leg'. Run-up duration D (s): run-up start (the bowler at the top of his mark) to
    the release. Returns the plan; `hold` is the time he stands at the top before setting off."""
    did = {"pace": "bowl_pace", "off": "bowl_off", "leg": "bowl_leg"}[action]
    tau = pack.c[did]["markers"]["release"]
    smk = pack.c["bowl_start"]["markers"]
    table = loop_table(pack)
    v0 = pack.c["bowl_jog"]["speed"]
    v1 = pack.c["bowl_stride"]["speed"] if action == "pace" else v0
    step_jog = table[0][1] / 2
    best = None
    for exit_m, parity, phase0 in (("exitL", 0, 0.0), ("exitR", 1, 0.5)):
        t_x = smk[exit_m]
        A_star = D - t_x - tau
        for n in range(parity, 40, 2):
            if action == "pace":
                if n < 2:
                    continue
                a0 = _pace_A(table, n, 0.0, v0, v1)
                a1 = _pace_A(table, n, 1.0, v0, v1)
                if a1 < R_MIN:
                    continue
                a0 = max(a0, R_MIN)
                if a0 > A_star + HOLD_MAX + 1e-9:
                    break
                if a0 - 1e-9 <= A_star <= a1 + 1e-9:
                    lo, hi = 0.0, 1.0
                    for _ in range(26):
                        m = 0.5 * (lo + hi)
                        if _pace_A(table, n, m, v0, v1) < A_star:
                            lo = m
                        else:
                            hi = m
                    lam = 0.5 * (lo + hi)
                    A = _pace_A(table, n, lam, v0, v1)
                    hold = max(0.0, D - t_x - tau - A)
                elif A_star > a1 and A_star - a1 <= HOLD_MAX:
                    lam, A = 1.0, a1
                    hold = A_star - a1
                else:
                    continue
                t_a, R = _pace_ramp(A, lam)
                cand = {"k": 1.0, "lam": lam, "t_a": t_a, "R": R}
            else:
                amin, amax = n * step_jog / K_SPIN[1], n * step_jog / K_SPIN[0]
                if amin > A_star + HOLD_MAX + 1e-9:
                    break
                if amin - 1e-9 <= A_star <= amax + 1e-9:
                    A = A_star
                    hold = 0.0
                elif A_star > amax and A_star - amax <= HOLD_MAX:
                    A = amax
                    hold = A_star - amax
                else:
                    continue
                k = (n * step_jog / A) if A > 0 else 1.0
                cand = {"k": k, "lam": 0.0, "t_a": 0.0, "R": 0.0}
            cand.update({"action": action, "D": D, "exit": exit_m, "phase0": phase0, "steps": n, "A": A, "hold": hold,
                         "preRoll": 0.0, "standing": True})
            score = (round(hold, 4), abs(cand["k"] - 1.0))
            if best is None or score < best[0]:
                best = (score, cand)
    if best is not None:
        return best[1]
    if not allow_roll:
        return None
    # rolling start: the shortest standing plan, begun before the visible run-up start
    for trial in [x / 100.0 for x in range(100, 700)]:
        if trial <= D:
            continue
        p = plan(pack, action, trial, allow_roll=False)
        if p:
            p = dict(p)
            p["preRoll"] = trial - D - p["hold"]
            p["hold"] = 0.0
            p["standing"] = False
            p["D"] = D
            return p
    raise RuntimeError("no plan")


def compose(pack, p, rate=60, tail=None):
    """Frames (world, heading 0 at the start) from the plan's clip start to the end of the follow-through."""
    action = p["action"]
    did = {"pace": "bowl_pace", "off": "bowl_off", "leg": "bowl_leg"}[action]
    fid = {"pace": "bowl_pace_follow", "off": "bowl_spin_off_follow", "leg": "bowl_spin_leg_follow"}[action]
    st = pack.c["bowl_start"]
    dl = pack.c[did]
    fl = pack.c[fid]
    hold = p["hold"]
    t_x0 = st["markers"][p["exit"]]
    t_x = hold + t_x0
    e = dl["markers"]["entry"]
    table = loop_table(pack)
    v0 = pack.c["bowl_jog"]["speed"]
    v1 = v0 if action != "pace" else pack.c["bowl_stride"]["speed"]
    A, t_a, R, k = p["A"], p["t_a"], p["R"], p["k"]
    t_e = t_x + A
    t_rel = t_e + (dl["markers"]["release"] - e)
    t_d_end = t_e + (dl["dur"] - e)
    t_end = t_d_end + fl["dur"]
    n = int(round(t_end * rate)) + 1
    # integrate the loop phase and ground on a fine grid
    fine = 2000
    hh = A / fine if A > 0 else 0.0
    ph = [0.0]
    gz = [0.0]
    for i in range(fine):
        t = (i + 0.5) * hh
        v = ramp_v(v1, t, t_a, R, v0) if action == "pace" else v0
        # the cadence scale eases in and out (k = 1 at the hand-over and at the delivery entry), mean = k
        kt = 1.0 + 2.0 * (k - 1.0) * math.sin(math.pi * t / A) ** 2 if A > 0 else 1.0
        ph.append(ph[-1] + kt * hh / cycle_T(table, v))
        gz.append(gz[-1] + kt * v * hh)
    ph = [x + p["phase0"] for x in ph]

    def loop_state(tl):
        f = max(0.0, min(fine, tl / hh)) if hh > 0 else 0.0
        i = min(fine - 1, int(f))
        u = f - i
        return ph[i] + (ph[i + 1] - ph[i]) * u, gz[i] + (gz[i + 1] - gz[i]) * u

    g_x = pack.at("bowl_start", t_x0)["ground"]
    out = []
    for i in range(n):
        t = i / rate
        if t <= t_x:
            s = pack.at("bowl_start", max(0.0, t - hold))
            g = s["ground"]
            fr = {"ground": g, "hips": s["hips"], "q": s["q"], "contacts": s["contacts"]}
        elif t <= t_e:
            tl = t - t_x
            phase, z = loop_state(tl)
            v = ramp_v(v1, tl, t_a, R, v0) if action == "pace" else v0
            a, b, w = blend_of(table, v)
            sa = pack.at(a[3], phase * a[1])
            sb = pack.at(b[3], phase * b[1])
            q = [qnlerp(sa["q"][j], sb["q"][j], w) for j in range(17)]
            hips = vlerp(sa["hips"], sb["hips"], w)
            contacts = sa["contacts"] if w < 0.5 else sb["contacts"]
            fr = {"ground": (g_x[0], g_x[1] + z, 0.0), "hips": hips, "q": q, "contacts": contacts}
        elif t <= t_d_end:
            ct = e + (t - t_e)
            s = pack.at(did, ct)
            s0 = pack.at(did, e)["ground"]
            gzx = g_x[1] + loop_state(A)[1]
            fr = {"ground": (g_x[0] + s["ground"][0] - s0[0], gzx + s["ground"][1] - s0[1], s["ground"][2] - s0[2]),
                  "hips": s["hips"], "q": s["q"], "contacts": s["contacts"]}
        else:
            ct = t - t_d_end
            s = pack.at(fid, ct)
            last = out_d_end
            yaw = math.radians(last[2])
            gx = last[0] + s["ground"][0] * math.cos(yaw) + s["ground"][1] * math.sin(yaw)
            gzz = last[1] - s["ground"][0] * math.sin(yaw) + s["ground"][1] * math.cos(yaw)
            fr = {"ground": (gx, gzz, last[2] + s["ground"][2]), "hips": s["hips"], "q": s["q"], "contacts": s["contacts"]}
        if t <= t_d_end:
            sd = pack.at(did, dl["dur"])["ground"]
            s0 = pack.at(did, e)["ground"]
            gzx = g_x[1] + loop_state(A)[1]
            out_d_end = (g_x[0] + sd[0] - s0[0], gzx + sd[1] - s0[1], sd[2] - s0[2])
        out.append(fr)
    return out, {"t_x": t_x, "t_e": t_e, "t_release": t_rel, "t_d_end": t_d_end, "t_end": t_end}


def fit_report(pack, action, D, target=None):
    """Plans, composes, places the run-up so the ball in hand is at `target` (x, y, z) at the release, and measures."""
    p = plan(pack, action, D)
    frames, tm = compose(pack, p)
    rate = 60
    # the release frame time on the composed timeline (visible run-up starts at preRoll)
    t_rel_visible = tm["t_release"] - p["preRoll"]
    # ball in hand at release (interpolate between the two frames around it)
    f = tm["t_release"] * rate
    i0 = int(math.floor(f))
    u = f - i0
    pa = fk(frames[i0])
    pb = fk(frames[min(i0 + 1, len(frames) - 1)])
    ba = vadd(pa[0][IDX["handR"]], qrot(pa[1][IDX["handR"]], BALL_IN_HAND))
    bb = vadd(pb[0][IDX["handR"]], qrot(pb[1][IDX["handR"]], BALL_IN_HAND))
    ball = vlerp(ba, bb, u)
    rep = {"action": action, "D": D, "plan": p, "tRelease": round(t_rel_visible, 6), "timeErrorMs": round(abs(t_rel_visible - D) * 1000, 3),
           "ballAtRelease": [round(c, 4) for c in ball]}
    if target is not None:
        dx, dz = target[0] - ball[0], target[2] - ball[2]
        rep["placementShift"] = [round(dx, 4), round(dz, 4)]
        rep["positionErrorMm"] = 0.0  # a rigid shift places the ball exactly (x, z); height is the rig scale's job
        rep["heightRatioToTarget"] = round(target[1] / ball[1], 4)
    # front foot at the front-foot contact relative to the ball's z at release
    m = metrics(frames[int(round(p["preRoll"] * rate)):], rate, bowling_arms={"upperArmR", "forearmR", "handR"})
    rep["metrics"] = {k: m[k] for k in ("slideBallCm", "ankleHeightCm", "angSpeedOver", "angAccelMax", "angAccelOver",
                                        "groundDvMax", "hipsDvMax", "jointLimitViolations", "wristToTorsoMinM", "pass")}
    # strides: strike events (contact rising edges) -> step length and cadence against speed
    strikes = []
    for k in range(1, len(frames)):
        for bit, foot in ((1, "L"), (2, "R")):
            if frames[k]["contacts"] & bit and not frames[k - 1]["contacts"] & bit:
                P, _ = fk(frames[k])
                b = P[IDX["foot" + foot]]
                strikes.append((k / rate, foot, b[0], b[2]))
    steps = []
    for a, b in zip(strikes, strikes[1:]):
        if b[0] > tm["t_e"] + 0.05:
            break
        if a[1] == b[1]:
            continue
        dt = b[0] - a[0]
        L = math.hypot(b[2] - a[2], b[3] - a[3])
        steps.append({"t": round(a[0] - p["preRoll"], 3), "stepM": round(L, 3), "spm": round(60 / dt, 1), "mps": round(L / dt, 2)})
    rep["approachSteps"] = steps
    # ground and hips speed every 0.1 s
    gs = []
    for k in range(0, len(frames) - 1, 6):
        g0, g1 = frames[k]["ground"], frames[k + 1]["ground"]
        gs.append(round(math.hypot(g1[0] - g0[0], g1[1] - g0[1]) * rate, 2))
    rep["groundSpeedEvery100ms"] = gs
    return rep, frames, tm


def main():
    vms = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    pack = Pack(vms)
    targets = {"pace": (0.42, 2.15, -10.06 + 1.4), "off": (0.30, 1.9, -10.06 + 1.28), "leg": (0.30, 1.9, -10.06 + 1.28)}
    rows = []
    for action in ("pace", "off", "leg"):
        for i in range(0, 31):
            D = round(1.5 + 0.05 * i, 2)
            rep, _, _ = fit_report(pack, action, D, targets[action])
            rows.append(rep)
            p = rep["plan"]
            print(action, D, p["exit"], "N", p["steps"], "k", round(p["k"], 3), "lam", round(p["lam"], 3), "hold", round(p["hold"], 3), "pre", round(p["preRoll"], 3),
                  "tErr", rep["timeErrorMs"], "slide", rep["metrics"]["slideBallCm"], "gDv", rep["metrics"]["groundDvMax"],
                  "hDv", rep["metrics"]["hipsDvMax"], "acc", max(rep["metrics"]["angAccelMax"].values()), flush=True)
    if out:
        with open(out, "w") as fh:
            json.dump(rows, fh, indent=1)


if __name__ == "__main__":
    main()
