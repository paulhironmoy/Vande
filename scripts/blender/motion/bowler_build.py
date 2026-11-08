"""MOTION-BOWL build: authors every bowler clip and writes the VMS1 sources (MOTION-SPEC v1.1 §7).

    python3 -I scripts/blender/motion/bowler_build.py [out_dir]      (default assets-src/motion/bowler)

Deterministic. The same frames are keyed onto the VC17 armature in Blender by bowler_blend.py.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bowler_approach as BA  # noqa: E402
import bowler_delivery as BD  # noqa: E402
from bowler_gait import cadence  # noqa: E402
from bowler_kin import qmul, qconj, qy, write_vms  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PROV = {
    "author": "MOTION-BOWL (Claude agent for the owner)",
    "method": "original procedural keyframes (curves, foot plants, two-bone IK), keyed in Blender 5.2.3 by bowler_blend.py",
    "script": "scripts/blender/motion/bowler_build.py",
    "licence": "owner-made original",
    "sources": [],
}


def rebase(frames, rate):
    """Ground relative to frame 0 and frame-0 heading 0; returns new frames (copies)."""
    g0 = frames[0]["ground"]
    y0 = g0[2]
    c = math.cos(math.radians(-y0))
    s = math.sin(math.radians(-y0))
    out = []
    for f in frames:
        g = f["ground"]
        dx, dz = g[0] - g0[0], g[1] - g0[1]
        # rotate about Y by -y0: x' = x cos + z sin, z' = -x sin + z cos
        nx = dx * c + dz * s
        nz = -dx * s + dz * c
        nf = dict(f)
        nf["ground"] = (nx, nz, g[2] - y0)
        out.append(nf)
    return out


def cut(frames, t0, rate, ta, tb):
    i0 = int(round((ta - t0) * rate))
    i1 = int(round((tb - t0) * rate))
    return rebase(frames[i0:i1 + 1], rate)


def decimate(frames, keep_every):
    """Every n-th frame; a contact bit survives only if the foot is planted across the whole storage interval."""
    if keep_every == 1:
        return frames
    out = []
    n = len(frames)
    for i in range(0, n, keep_every):
        f = dict(frames[i])
        bits = f["contacts"]
        for j in range(max(0, i - keep_every + 1), min(n, i + keep_every)):
            bits &= frames[j]["contacts"] | ~3
        f["contacts"] = bits
        out.append(f)
    return out


def mean_speed(frames, rate):
    """MOTION-SPEC §5.2 speedMps of a one-shot: mean ground speed along the travel (path length / duration)."""
    d = 0.0
    for a, b in zip(frames, frames[1:]):
        d += math.hypot(b["ground"][0] - a["ground"][0], b["ground"][1] - a["ground"][1])
    return d / ((len(frames) - 1) / rate)


def clip(cid, frames, rate, codec, markers, loop=False, speed=None, steps=0, tracks=None, mirrorable=False):
    if speed is None:
        speed = 0.0 if loop else round(mean_speed(frames, rate), 3)
    return {
        "id": cid, "pack": "bowler", "role": "bowler", "rate": rate, "loop": loop, "mirrorable": mirrorable,
        "codec": codec, "speedMps": speed, "cycleSteps": steps, "markers": markers, "frames": frames,
        "tracks": tracks or {}, "provenance": PROV,
    }


# bowl_pace_bouncer_follow ends here (s from the delivery entry): from 1.50 s on the bouncer's frames equal the stock
# pace's exactly, so the hand-over into bowl_pace_follow (at join = 1.50 - split) is seamless
BOUNCER_JOIN = 1.5
# the bouncer clips (lead rulings 2026-11-04: 72 KB bowler budget; bowl_pace_bouncer legs in the explosive class)
INCLUDE_BOUNCER = True


def build_all(codec_delivery=2):
    clips = []
    # gait loops (left strike at frame 0; closing frame kept for the exporter's seam check)
    for cid, v in BA.LOOP_SPEEDS.items():
        rate = BA.LOOP_RATES[cid]
        c = BA.gait_loop(cid, v, rate=rate)
        clips.append(clip(cid, c["frames"], rate, 1, {}, loop=True, speed=v, steps=2))
    # the walk back to the mark (no ball): a relaxed walking loop
    wb = BA.gait_loop("bowl_walk_back", 1.35, rate=30, carry=0.0, bowl_arm_scale=1.0)
    clips.append(clip("bowl_walk_back", wb["frames"], 30, 1, {}, loop=True, speed=1.35, steps=2))
    # the standing start (first step with the right foot; exits at a left strike = jog loop phase 0)
    st = BA.standing_start("bowl_start", "R")
    assert st["_exitFoot"] == "L"
    m = dict(st["markers"])
    # two hand-over points into the jog loop: the last left strike (loop phase 0) and the right strike before it
    # (loop phase 0.5), so the approach can take an odd or an even number of loop strides
    strikes = sorted((s["t_on"], s["foot"]) for s in st["_stances"] if s["t_on"] > 0)
    m["exitL"] = m.pop("exit")
    m["exitR"] = max(t for t, f in strikes if f == "R" and t < m["exitL"] - 1e-6)
    clips.append(clip("bowl_start", st["frames"], 60, 1, m))
    info = {"start": m}
    # deliveries: frame 0 is the right strike one step before the entry, so the runtime can enter on either foot
    for A, did, fid, split in ((BD.PACE, "bowl_pace", "bowl_pace_follow", 29 / 30.0),
                               (BD.SPIN_OFF, "bowl_off", "bowl_spin_off_follow", 25 / 30.0),
                               (BD.SPIN_LEG, "bowl_leg", "bowl_spin_leg_follow", 25 / 30.0)):
        frames, inf = BD.build_action(A, turn=True)
        t0 = inf["t0"]
        pre = 0.0
        T = A["times"]
        dfr = cut(frames, t0, 60, 0.0, split)
        mk = {"entry": 0.0}
        for k in ("takeoff", "backFoot", "frontFoot", "release"):
            mk[k] = T[k]
        clips.append(clip(did, dfr, 60, codec_delivery, mk))
        t_end = split + math.ceil((inf["t_stop"] + 0.02 - split) * 30) / 30.0
        # follow-throughs keep 60 Hz: their foot strikes need it (MOTION-SPEC §9 angular acceleration)
        t_end = split + math.ceil((inf["t_stop"] + 0.02 - split) * 60) / 60.0
        ffr = cut(frames, t0, 60, split, t_end)
        clips.append(clip(fid, ffr, 60, 1, {"stop": inf["t_stop"] - split}))
        # the turn back to the mark: from the follow-through's last frame, a turn to the left on the spot in two low
        # steps, into bowl_walk_back (`exitL` = loop phase 0, `exitR` = phase 0.5); one turn serves both spin actions
        tid = {"bowl_pace": "bowl_turn_pace", "bowl_off": "bowl_turn_spin"}.get(did)
        if tid:
            ti = inf["turn"]
            ex = t_end + math.ceil((ti["exit"] - t_end) * 30 - 1e-9) / 30.0
            tfr = decimate(cut(frames, t0, 60, t_end, ex), 2)
            clips.append(clip(tid, tfr, 30, 1, {("exitL" if ti["exitFoot"] == "L" else "exitR"): ti["exit"] - t_end}))
        info[did] = {"pre": pre, "split": split, "release": T["release"], "entrySpeed": A["entrySpeed"],
                     "stop": inf["t_stop"]}
        if did == "bowl_pace" and INCLUDE_BOUNCER:
            # the bouncer (lead ruling 2026-11-04): the same run-in, markers and release time, released higher. Its
            # follow-through is a short variant that ends where its frames are identical to bowl_pace_follow's
            # (`join`): the runtime carries on in bowl_pace_follow from that same clip time
            fb, infb = BD.build_action(BD.PACE_BOUNCER, turn=True)
            assert abs(infb["t0"] - t0) < 1e-12 and abs(infb["t_stop"] - inf["t_stop"]) < 1e-12
            Tb = BD.PACE_BOUNCER["times"]
            mkb = {"entry": 0.0}
            for k in ("takeoff", "backFoot", "frontFoot", "release"):
                mkb[k] = Tb[k]
            # codec 1 (10/10/10) keeps the pack within its 72 KB budget; it measures within every gate
            clips.append(clip("bowl_pace_bouncer", cut(fb, t0, 60, 0.0, split), 60, 1, mkb))
            t_join = BOUNCER_JOIN
            i_j = int(round((t_join - t0) * 60))
            assert all(max(abs(a - b) for a, b in zip(fb[i_j]["q"][n], frames[i_j]["q"][n])) < 1e-9 for n in range(17))
            assert max(abs(a - b) for a, b in zip(fb[i_j]["hips"], frames[i_j]["hips"])) < 1e-9
            clips.append(clip("bowl_pace_bouncer_follow", cut(fb, t0, 60, split, t_join), 60, 1, {"join": t_join - split}))
            info["bowl_pace_bouncer"] = {"split": split, "join": t_join - split}
    return clips, info


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "assets-src", "motion", "bowler")
    os.makedirs(out, exist_ok=True)
    clips, info = build_all()
    for c in clips:
        write_vms(os.path.join(out, c["id"] + ".vms.json"), c)
    print({c["id"]: len(c["frames"]) for c in clips})
    return clips, info


if __name__ == "__main__":
    main()
