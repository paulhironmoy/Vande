"""Puts the classification of the second pass (the CURRENT camera mapper) beside the earlier numbers, per clip and per source, and the
two defence sizes as the pose model sees them. Evidence tool; no model, no browser.

  python3 scripts/camera-fixtures/merge-classes.py <earlier classes.json> <pass1 classes under the current mapper> <pass2 classes (current mapper)>
         <defence-variants.json> <out classes.json>
"""
import json
import sys


def brief(a):
    if not a:
        return {'class': 'none'}
    return {'class': a['class'], 'kind': a['kind'], 'directionDeg': a['directionDeg'], 'power': a['power'], 'elevation': a['elevation']}


def main(argv):
    earlier, pass1_now, pass2, defence, out = argv
    e, p1, p2 = (json.load(open(x))['results'] for x in (earlier, pass1_now, pass2))
    compared = {}
    changes = []
    for clip, srcs in p2.items():
        compared[clip] = {}
        for src, r in srcs.items():
            now = brief(r['armedAtStance'])
            # The first defence render is kept as <clip>_035: its earlier numbers are the ones filed under the plain clip name.
            before = clip[:-4] if clip.endswith('_035') else clip
            was = brief(e.get(before, {}).get(src, {}).get('armedAtStance')) if before in e and src in e[before] else None
            same_video = clip not in ('rh_defence', 'lh_defence')
            changed = was is not None and was['class'] != now['class']
            compared[clip][src] = {'earlier': was, 'now': now, 'sameVideoAsEarlier': same_video, 'classChanged': changed, 'wantClass': r['wantClass'],
                                   'nowIsWanted': now['class'] == r['wantClass']}
            if changed:
                changes.append(f'{clip} {src}: {was["class"]} -> {now["class"]}')
    res = {
        'note': 'Synthetic: authored joints (ideal) and the pose engine on the rendered pictures (model), through CameraBatter, PoseMapper, GestureTracker and normalizeGesture on a simulated clock. The current mapper has DEFENCE.maxPeakRiseU 0.6 u (CAMERA decision C-13); the earlier numbers had 0.45 u. Not player results.',
        'results': p2,
        'comparedWithEarlierNumbers': compared,
        'classChangesVersusEarlierNumbers': changes,
        'firstPassUnderTheCurrentMapper': {c: {s: brief(v['armedAtStance']) for s, v in srcs.items()} for c, srcs in p1.items()},
        'defenceVariants': json.load(open(defence))['variants'],
    }
    json.dump(res, open(out, 'w'), indent=1)
    print('class changes versus the earlier numbers:', changes or 'none')


if __name__ == '__main__':
    main(sys.argv[1:])
