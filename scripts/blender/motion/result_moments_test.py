"""Checks of the Chase result-moment clips (scripts/blender/motion/result_moments.py): deterministic, the bat tracks are
sound, the clips start and end where the runtime hands over, and the committed sources are what the generator makes.

    python3 -B -m unittest discover -s scripts/blender/motion -p 'result_moments_test.py'
"""
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import result_moments as rm  # noqa: E402
import vms_json  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(REPO, 'assets-src', 'motion', 'result_moments')
PROV = {'author': 'test', 'method': 'test', 'tool': 'test', 'script': 'test', 'licence': 'owner-made original', 'sources': []}
IDS = ['bat_celebrate_win', 'bat_walk_off', 'bowl_celebrate_defend', 'bowl_disappointed']


def docs():
    return {c.id: c.to_vms(PROV) for c in rm.clips()}


class ResultMomentsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a = docs()
        cls.b = docs()

    def test_the_four_clips(self):
        self.assertEqual(sorted(self.a), sorted(IDS))
        for d in self.a.values():
            self.assertEqual(d['pack'], 'result_moments')
            self.assertEqual(d['skeleton'], 'VC17')
            self.assertEqual(d['sampleRate'], 30)
            self.assertEqual(d['codec'], 2)
            self.assertFalse(d['loop'])
            self.assertFalse(d['overlay'])

    def test_deterministic(self):
        for cid in IDS:
            self.assertEqual(vms_json.dumps(self.a[cid]), vms_json.dumps(self.b[cid]), cid)

    def test_one_shot_closes_on_a_whole_frame(self):
        for cid, d in self.a.items():
            n = len(d['frames']['q'])
            self.assertEqual(len(d['frames']['ground']), n)
            self.assertEqual(len(d['frames']['hips']), n)
            self.assertEqual(len(d['frames']['contacts']), n)
            self.assertTrue(all(len(q) == 68 for q in d['frames']['q']))
            for m, t in d['markers'].items():
                self.assertTrue(0.0 <= t <= (n - 1) / 30.0 + 1e-9, f'{cid}:{m}')

    def test_bat_tracks_only_on_the_batter(self):
        for cid in IDS:
            tracks = self.a[cid]['tracks']
            if cid.startswith('bat_'):
                self.assertEqual(sorted(tracks), ['bat.dir', 'bat.face', 'bat.grip'])
                n = len(self.a[cid]['frames']['q'])
                for name, t in tracks.items():
                    self.assertEqual(len(t['frames']), n, name)
                for d, f in zip(tracks['bat.dir']['frames'], tracks['bat.face']['frames']):
                    self.assertAlmostEqual(math.sqrt(sum(v * v for v in d)), 1.0, places=4)
                    self.assertAlmostEqual(math.sqrt(sum(v * v for v in f)), 1.0, places=4)
                    self.assertLess(abs(sum(a * b for a, b in zip(d, f))), 1e-3, 'the face is square to the blade')
            else:
                self.assertEqual(tracks, {})

    def test_bat_hand_reach_and_wrist(self):
        for cid in ('bat_celebrate_win', 'bat_walk_off'):
            prov = self.a[cid]['provenance']
            self.assertLessEqual(prov['batGripMaxReachM']['palm'], rm.PALM_REACH_MAX, cid)
            self.assertLessEqual(prov['wristSwingMaxDeg'], rm.WRIST_MAX + 1e-6, cid)

    def test_in_place_clips_stay_put_and_start_planted(self):
        for cid in ('bat_celebrate_win', 'bowl_celebrate_defend', 'bowl_disappointed'):
            d = self.a[cid]
            self.assertTrue(all(g == [0.0, 0.0, 0.0] for g in d['frames']['ground']), cid)
            self.assertEqual(d['frames']['contacts'][0], 3, 'both feet down at the start')
            self.assertEqual(d['frames']['contacts'][-1], 3, 'both feet down at the end')
            self.assertTrue(all(abs(h[0]) <= 0.04 and abs(h[2]) <= 0.04 for h in d['frames']['hips']), cid)

    def test_the_walk_off_goes_straight_ahead_and_stops(self):
        d = self.a['bat_walk_off']
        g = d['frames']['ground']
        self.assertTrue(all(abs(v[2]) < 1e-6 for v in g), 'no turn is baked')
        self.assertTrue(all(abs(v[0]) < 0.02 for v in g), 'straight ahead')
        self.assertTrue(2.0 <= g[-1][1] <= 3.6, f'travel {g[-1][1]:.2f} m')
        end_speed = (g[-1][1] - g[-4][1]) / (3 / 30.0)
        self.assertLess(end_speed, 0.05, 'the clip ends in a stop')
        start = d['markers']['step']
        self.assertTrue(all(abs(v[1]) < 1e-6 for v in g[: int(start * 30) - 2]), 'he stands until the first step')

    def test_committed_sources_match_the_generator(self):
        if not os.path.isdir(SRC):
            self.skipTest('sources not baked yet')
        for cid in IDS:
            path = os.path.join(SRC, cid + '.vms.json')
            self.assertTrue(os.path.exists(path), path)
            old = vms_json.read(path)
            new = self.a[cid]
            for key in ('id', 'pack', 'role', 'sampleRate', 'markers', 'frames', 'tracks', 'codec', 'loop'):
                self.assertTrue(vms_json.identical(old[key], new[key]), f'{cid}.{key} differs: run build.py result_moments')


if __name__ == '__main__':
    unittest.main()
