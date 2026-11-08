"""The defence stroke in two sizes, as the pose model sees it (the mapper's own unit: the hands' rise in shoulder widths).

  python3 scripts/camera-fixtures/defence-variants.py <pass1-dir> <pass2-raw-dir> <pass1-classes.json> <pass2-classes.json> <out.json>

pass1-dir has raw/{rh,lh}_defence.landmarks.json of the first render (authored backlift 0.35 u, push 0.40 s); pass2-raw-dir has the same files of the
second (0.26 u, 0.30 s). For each right-handed and left-handed clip it reports the model's peak hand rise, the mean descent speed after the peak
(rise below its peak, 0.35 of the peak), and the swing the camera pipeline made of it (from the classes files). Synthetic renders only.
"""
import json
import sys


def rises(path):
    d = json.load(open(path))
    w, h = d['width'], d['height']
    rows = []
    for lm in d['landmarks']:
        if not lm:
            rows.append(None)
            continue
        g = lambda i, k: lm[i * 4 + k]
        rows.append((abs(g(11, 0) - g(12, 0)) * w, (g(15, 1) + g(16, 1)) / 2 * h))
    u = sorted(r[0] for r in rows if r)[len([r for r in rows if r]) // 2]
    rest = sum(r[1] for r in rows[:25]) / 25
    series = [(rest - r[1]) / u if r else None for r in rows]
    peak_i = max(range(len(series)), key=lambda i: series[i] if series[i] is not None else -9)
    peak = series[peak_i]
    back = next((i for i in range(peak_i, len(series)) if series[i] is not None and series[i] < 0.35 * peak), len(series) - 1)
    speed = (peak - series[back]) / max((back - peak_i) / 30.0, 1e-9)
    return {'shoulderWidthPx': round(u, 1), 'modelPeakRiseU': round(peak, 3), 'peakAtS': round(peak_i / 30.0, 2),
            'modelMeanDescentUPerS': round(speed, 3)}


def swing_of(classes, clip):
    r = classes['results'].get(clip, {})
    out = {}
    for src in ('ideal', 'model'):
        if src in r:
            a = r[src]['armedAtStance']
            out[src] = a and {'class': a['class'], 'kind': a['kind'], 'directionDeg': a['directionDeg'], 'power': a['power']}
            out[src + 'ShareOfStartPhasesByWindowS'] = r[src]['shareOfPhasesWithTheRightClassByWindowS']
    return out


def main(argv):
    p1, p2raw, c1, c2, out = argv
    classes1, classes2 = json.load(open(c1)), json.load(open(c2))
    res = {
        'note': 'Synthetic renders through the pose engine (CPU, 384 px) and the camera pipeline pieces (traceCamera); not player results. The mapper calls a push a DEFENCE when the hands rise less than DEFENCE.maxPeakRiseU (0.45 u) and come down at 0.5 u/s or more.',
        'variants': {},
    }
    for label, raw, classes in (('0.35 u authored backlift, 0.40 s push (pass 1)', p1 + '/raw', classes1), ('0.26 u authored backlift, 0.30 s push (pass 2)', p2raw, classes2)):
        res['variants'][label] = {}
        for clip in ('rh_defence', 'lh_defence'):
            res['variants'][label][clip] = {**rises(f'{raw}/{clip}.landmarks.json'), 'swing': swing_of(classes, clip)}
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps(res['variants'], indent=1)[:2500])


if __name__ == '__main__':
    main(sys.argv[1:])
