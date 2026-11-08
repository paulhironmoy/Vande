"""Tests of the camera-fixture clip authoring (swing_clips.py). Plain python3, no Blender:

  python3 -B -m unittest discover -s scripts/blender/camera -p '*_test.py'

They check the numbers the fixture plan promises: the clips loop, the arms reach their targets, the strokes have the size and speed
of the class they stand for (in CAMERA's units, with margins so a small tuning of the mapper does not break them), a left-hander is
the exact canonical mirror of the right-hander, and authoring is deterministic.
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import swing_clips as sc  # noqa: E402

vc17 = sc.vc17


def joints(doc, i):
    f = doc['frames'][i]
    local = {b: tuple(f['q'][k * 4:k * 4 + 4]) for k, b in enumerate(vc17.BONES)}
    return vc17.fk(tuple(f['ground']), tuple(f['hips']), local)[0]


class Authoring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docs = {cid: sc.author(cid) for cid in sc.CLIPS}

    def test_every_clip_is_three_to_six_seconds_at_30_fps(self):
        for cid, d in self.docs.items():
            self.assertEqual(d['fps'], 30, cid)
            self.assertEqual(d['frameCount'], len(d['frames']), cid)
            self.assertTrue(3.0 <= d['seconds'] <= 6.0, cid)
            self.assertEqual(len(d['frames'][0]['q']), 68, cid)

    def test_clips_loop_without_a_jump(self):
        # The step across the loop seam is no bigger than the largest ordinary step in the stance.
        for cid, d in self.docs.items():
            n = d['frameCount']
            for name in ('handL', 'handR', 'head', 'upperArmL', 'footL'):
                seam = vc17.length(vc17.sub(joints(d, 0)[name], joints(d, n - 1)[name]))
                self.assertLess(seam, 0.012, f'{cid} {name} jumps {seam:.4f} m at the seam')

    def test_the_arms_reach_the_targets_and_stay_human(self):
        for cid in ('rh_drive', 'rh_pull', 'rh_loft', 'rh_leave', 'rh_defence', 'still'):
            d = self.docs[cid]
            for i in range(d['frameCount']):
                j = joints(d, i)
                for s in 'LR':
                    reach = vc17.length(vc17.sub(j['hand' + s], j['upperArm' + s]))
                    self.assertLessEqual(reach, sc.ARM + 1e-6, f'{cid} frame {i}')
                    self.assertGreaterEqual(reach, 0.15, f'{cid} frame {i}')
                    elbow = vc17.length(vc17.sub(j['forearm' + s], j['hand' + s]))
                    self.assertAlmostEqual(elbow, vc17.FORE, places=5)

    def test_strokes_have_the_size_and_speed_of_their_class(self):
        m = {cid: self.docs[cid]['metrics'] for cid in self.docs}
        # Attack strokes: a real backlift, then a fast descent (CAMERA: an attack is 2 u/s or more).
        for cid in ('rh_drive', 'rh_pull', 'rh_loft'):
            self.assertGreaterEqual(m[cid]['peakRiseU'], 0.8, cid)
            self.assertGreaterEqual(m[cid]['meanDescentUPerS'], 2.5, cid)
        self.assertGreater(m['rh_loft']['peakRiseU'], m['rh_drive']['peakRiseU'] + 0.3)
        self.assertGreater(m['rh_loft']['meanDescentUPerS'], m['rh_drive']['meanDescentUPerS'])
        # Direction: the drive goes to the player's right (off side for a right-hander), the pull across to the left.
        self.assertGreater(m['rh_drive']['lateralU'], 0.2)
        self.assertLess(m['rh_pull']['lateralU'], -0.6)
        self.assertLess(abs(m['rh_loft']['lateralU']), 0.2)
        # Defence: a small backlift and a controlled push, slower than an attack and faster than lowering the hands.
        self.assertLess(m['rh_defence']['peakRiseU'], 0.45)
        self.assertTrue(0.5 <= m['rh_defence']['meanDescentUPerS'] < 2.0)
        self.assertLess(abs(m['rh_defence']['lateralU']), 0.15)
        # Leave: a held backlift that comes back slowly, no reversal.
        self.assertGreaterEqual(m['rh_leave']['peakRiseU'], 0.5)
        self.assertLess(m['rh_leave']['meanDescentUPerS'], 1.0)
        # A still person never rises 0.2 u (CAMERA's onset) above the ready hands.
        self.assertLess(m['still']['peakRiseU'], 0.05)

    def test_hold_at_the_top_is_longer_than_the_deliberate_hold(self):
        for cid, hold in (('rh_drive', 0.30), ('rh_leave', 0.80)):
            mk = self.docs[cid]['markers']
            self.assertGreaterEqual(mk['holdEnd'] - mk['backliftEnd'], 0.25, cid)
            self.assertAlmostEqual(mk['holdEnd'] - mk['backliftEnd'], hold, places=6)

    def test_left_hander_is_the_exact_canonical_mirror(self):
        for stroke in ('drive', 'pull', 'loft', 'leave', 'defence'):
            r, l = self.docs['rh_' + stroke], self.docs['lh_' + stroke]
            self.assertEqual(r['frameCount'], l['frameCount'])
            for i in (0, 40, 66, 70, 75, 100):
                jr, jl = joints(r, i), joints(l, i)
                for a, b in (('handL', 'handR'), ('upperArmL', 'upperArmR'), ('footL', 'footR'), ('forearmL', 'forearmR')):
                    p, q = jr[a], jl[b]
                    self.assertAlmostEqual(p[0], -q[0], places=4, msg=f'{stroke} {a} frame {i}')
                    self.assertAlmostEqual(p[1], q[1], places=4)
                    self.assertAlmostEqual(p[2], q[2], places=4)
            self.assertEqual(r['metrics'], l['metrics'])

    def test_the_picture_geometry_matches_the_distances_the_camera_input_expects(self):
        # Shoulder width as a share of the picture width: 0.17 at 2 m, in 0.08..0.30 (CAMERA's too-far and too-close) at 1.5 m and 3.4 m.
        for view, lo, hi in (('mid', 0.15, 0.19), ('near', 0.2, 0.30), ('far', 0.08, 0.12)):
            sl = sc.project(view, (0.205, 1.472, -0.012))
            sr = sc.project(view, (-0.205, 1.472, -0.012))
            frac = (sl[0] - sr[0]) * (1.0 if view != 'portrait' else 1.0)
            self.assertTrue(lo <= frac <= hi, f'{view}: shoulder width {frac:.3f} of the picture')
        # The actor's left is on the right of the picture, and up is up.
        self.assertGreater(sc.project('mid', (0.2, 1.0, 0.0))[0], 0.5)
        self.assertLess(sc.project('mid', (0.0, 1.8, 0.0))[1], sc.project('mid', (0.0, 1.0, 0.0))[1])
        # The head stays in the picture in every view, with room above it.
        for view in sc.CAMERA_VIEWS:
            self.assertGreater(sc.project(view, (0.0, 1.78, 0.0))[1], 0.0, view)

    def test_every_frame_carries_the_ideal_landmarks_the_mapper_would_see(self):
        d = self.docs['rh_drive']
        for f in d['frames']:
            for name, (x, y) in f['ideal'].items():
                self.assertTrue(0.0 < x < 1.0 and 0.0 < y < 1.0, name)
        # The right-hander's hands move to the picture's left (the player's right) in the strike.
        a, b = d['frames'][int(d['markers']['holdEnd'] * 30)]['ideal'], d['frames'][int(d['markers']['contact'] * 30)]['ideal']
        self.assertLess(b['wristR'][0], a['wristR'][0])

    def test_authoring_is_deterministic(self):
        for cid in ('rh_drive', 'lh_pull', 'still'):
            self.assertEqual(sc.dump(sc.author(cid)), sc.dump(sc.author(cid)))

    def test_markers_are_in_order_and_inside_the_clip(self):
        for cid, d in self.docs.items():
            ts = list(d['markers'].values())
            self.assertEqual(ts, sorted(ts), cid)
            self.assertTrue(all(0.0 <= t <= d['seconds'] for t in ts), cid)

    def test_the_stance_is_still_enough_to_be_a_ready_pose(self):
        # In the first second the hands move less than 3 cm from where they started.
        d = self.docs['rh_drive']
        h0 = joints(d, 0)['handR']
        for i in range(0, 30):
            self.assertLess(vc17.length(vc17.sub(joints(d, i)['handR'], h0)), 0.03)


if __name__ == '__main__':
    unittest.main()
