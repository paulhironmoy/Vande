"""Tests for vms_json, the one canonical text form of the VMS1 motion sources.

Standard library only; no Blender needed:

    python3 -m unittest discover -s scripts/blender/motion -p '*_test.py'
"""
import ast
import contextlib
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True  # a test run must not leave __pycache__ folders in the source tree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vms_json  # noqa: E402

SOURCES = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'assets-src', 'motion'))


def read_text(path):
    with open(path, 'r', encoding='utf-8', newline='') as handle:
        return handle.read()


def first_difference(expected, actual):
    """A short description of where two texts first differ (a failed assertEqual would print a whole file)."""
    a, b = expected.split('\n'), actual.split('\n')
    for i, (x, y) in enumerate(zip(a, b), 1):
        if x != y:
            at = next((k for k, (p, q) in enumerate(zip(x, y)) if p != q), min(len(x), len(y)))
            return 'line %d, column %d: expected ...%s... got ...%s...' % (i, at + 1, x[max(0, at - 20):at + 20], y[max(0, at - 20):at + 20])
    return 'line counts differ: %d vs %d' % (len(a), len(b))


def small_doc():
    return {
        'format': 'VMS1',
        'id': 'demo',
        'loop': False,
        'markers': {'plant': 0.32, 'contact': 0.37},
        'frames': {'ground': [[0.0, 0.0, 0.0], [0.0, 0.1, 0.0]], 'contacts': [0, 3]},
        'tracks': {'bat.grip': {'kind': 'position', 'frames': [[0.1, 0.2, 0.3], [0.1, 0.2, 0.35]]},
                   'bat.dir': {'kind': 'direction', 'frames': [[0.0, 1.0, 0.0], [0.0, 1.0, 0.0]]}},
        'provenance': {'sources': [], 'note': 'a ° sign and "quotes"'},
    }


EXPECTED_SMALL = (
    '{\n'
    ' "format": "VMS1",\n'
    ' "id": "demo",\n'
    ' "loop": false,\n'
    ' "markers": {"plant":0.32,"contact":0.37},\n'
    ' "frames": {\n'
    '  "ground": [[0.0,0.0,0.0],[0.0,0.1,0.0]],\n'
    '  "contacts": [0,3]\n'
    ' },\n'
    ' "tracks": {\n'
    '  "bat.grip": {"kind":"position","frames":[[0.1,0.2,0.3],[0.1,0.2,0.35]]},\n'
    '  "bat.dir": {"kind":"direction","frames":[[0.0,1.0,0.0],[0.0,1.0,0.0]]}\n'
    ' },\n'
    ' "provenance": {"sources":[],"note":"a \\u00b0 sign and \\"quotes\\""}\n'
    '}\n'
)


class CommittedSources(unittest.TestCase):
    def test_serialising_a_parsed_committed_source_reproduces_it_byte_for_byte(self):
        files = vms_json.source_files([SOURCES])
        self.assertGreaterEqual(len(files), 60, 'the committed motion sources were not found under ' + SOURCES)
        for path in files:
            text = read_text(path)
            again = vms_json.dumps(vms_json.loads(text))
            self.assertTrue(again == text, '%s is not canonical (%s); run: python3 scripts/blender/motion/vms_json.py --write %s'
                            % (os.path.relpath(path, SOURCES), first_difference(text, again), path))

    def test_committed_sources_are_plain_json_with_the_vms1_shape(self):
        for path in vms_json.source_files([SOURCES]):
            doc = json.loads(read_text(path))  # any other parser reads it too
            self.assertEqual(doc['format'], 'VMS1', path)
            self.assertEqual(os.path.basename(path), doc['id'] + '.vms.json')
            self.assertEqual(os.path.basename(os.path.dirname(path)), doc['pack'])
            self.assertEqual(sorted(doc['frames']), ['contacts', 'ground', 'hips', 'q'], path)


class Layout(unittest.TestCase):
    def test_exact_text_of_a_small_document(self):
        self.assertEqual(vms_json.dumps(small_doc()), EXPECTED_SMALL)

    def test_key_order_is_the_documents_never_sorted(self):
        text = vms_json.dumps({'zeta': 1, 'alpha': 2, 'frames': {'q': [1], 'ground': [2]}})
        self.assertEqual(list(json.loads(text)), ['zeta', 'alpha', 'frames'])
        self.assertEqual(list(json.loads(text)['frames']), ['q', 'ground'])

    def test_empty_tracks_stay_on_their_own_line(self):
        self.assertIn(' "tracks": {},\n', vms_json.dumps({'tracks': {}, 'z': 1}))

    def test_one_final_newline_lf_only_no_tabs(self):
        text = vms_json.dumps(small_doc())
        self.assertTrue(text.endswith('}\n') and not text.endswith('\n\n'))
        self.assertNotIn('\r', text)
        self.assertNotIn('\t', text)

    def test_output_is_valid_json_for_any_parser(self):
        self.assertEqual(json.loads(vms_json.dumps(small_doc())), small_doc())


class Numbers(unittest.TestCase):
    TRICKY = [-0.0, 0.0, 0.1, 0.30000000000000004, 1e-07, 5e-324, 1.7976931348623157e+308, -1.5e-10, 1.0, 1, 0, True, False, None]

    def test_floats_ints_and_signed_zero_survive_a_write_and_a_read(self):
        doc = {'v': self.TRICKY, 'frames': {'ground': [self.TRICKY]}}
        back = vms_json.loads(vms_json.dumps(doc))
        self.assertEqual(len(back['v']), len(self.TRICKY))
        for want, got in zip(self.TRICKY, back['v']):
            self.assertIs(type(got), type(want))
            if isinstance(want, float):
                self.assertEqual(struct.pack('<d', got), struct.pack('<d', want))
        self.assertTrue(vms_json.identical(back, doc))
        self.assertIn('-0.0', vms_json.dumps(doc))

    def test_identical_tells_apart_what_equality_does_not(self):
        self.assertFalse(vms_json.identical(0.0, -0.0))
        self.assertFalse(vms_json.identical(1, 1.0))
        self.assertFalse(vms_json.identical(True, 1))
        self.assertFalse(vms_json.identical({'a': 1, 'b': 2}, {'b': 2, 'a': 1}))
        self.assertTrue(vms_json.identical({'a': [1, 2.5, None]}, {'a': [1, 2.5, None]}))

    def test_nan_infinity_and_duplicate_keys_are_refused(self):
        for bad in (float('nan'), float('inf'), float('-inf')):
            with self.assertRaises(ValueError):
                vms_json.dumps({'v': [bad]})
        for text in ('{"a":NaN}', '{"a":Infinity}', '{"a":1,"a":2}'):
            with self.assertRaises(ValueError):
                vms_json.loads(text)

    def test_a_source_must_be_an_object(self):
        with self.assertRaises(TypeError):
            vms_json.dumps([1, 2, 3])


class CommandLine(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='vms_json_test_')
        self.addCleanup(shutil.rmtree, self.dir, True)

    def run_cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = vms_json.main(list(args))
        return code, out.getvalue()

    def test_check_finds_a_pretty_printed_file_and_write_fixes_it_without_changing_a_value(self):
        path = os.path.join(self.dir, 'demo.vms.json')
        with open(path, 'w', encoding='utf-8', newline='\n') as handle:
            json.dump(small_doc(), handle, indent=1)
            handle.write('\n')
        code, _ = self.run_cli('--check', self.dir)
        self.assertEqual(code, 1)
        code, _ = self.run_cli('--write', self.dir)
        self.assertEqual(code, 0)
        self.assertEqual(read_text(path), EXPECTED_SMALL)
        self.assertEqual(self.run_cli('--check', self.dir)[0], 0)
        self.assertTrue(vms_json.identical(vms_json.read(path), small_doc()))

    def test_write_leaves_a_canonical_file_untouched(self):
        path = os.path.join(self.dir, 'demo.vms.json')
        vms_json.write(path, small_doc())
        before = os.stat(path).st_mtime_ns
        self.assertEqual(self.run_cli('--write', self.dir)[0], 0)
        self.assertEqual(os.stat(path).st_mtime_ns, before)

    def test_write_returns_the_text_and_uses_utf8_lf(self):
        path = os.path.join(self.dir, 'demo.vms.json')
        text = vms_json.write(path, small_doc())
        with open(path, 'rb') as handle:
            self.assertEqual(handle.read(), text.encode('utf-8'))


def parse(name):
    with open(os.path.join(HERE, name), 'r', encoding='utf-8') as handle:
        return ast.parse(handle.read(), filename=name)


class EveryBakeScriptWritesThroughTheHelper(unittest.TestCase):
    """The three writers that the bake scripts use (one per authoring library) delegate to vms_json."""
    WRITERS = {'vc17.py': 'dump', 'bowler_kin.py': 'write_vms', 'batter_vc17lib.py': 'write_vms1'}

    def test_the_writer_functions_call_vms_json_and_not_json_dump(self):
        for module, function in self.WRITERS.items():
            tree = parse(module)
            imports = {a.name for node in ast.walk(tree) if isinstance(node, ast.Import) for a in node.names}
            self.assertIn('vms_json', imports, module + ' must import vms_json')
            found = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == function]
            self.assertEqual(len(found), 1, '%s defines %s once' % (module, function))
            calls = [(c.func.value.id, c.func.attr) for c in ast.walk(found[0])
                     if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and isinstance(c.func.value, ast.Name)]
            self.assertTrue(any(owner == 'vms_json' and attr in ('dumps', 'write') for owner, attr in calls),
                            '%s.%s must call vms_json.dumps or vms_json.write' % (module, function))
            self.assertFalse(any(owner == 'json' and attr in ('dump', 'dumps') for owner, attr in calls),
                             '%s.%s must not format JSON itself' % (module, function))

    def test_vc17_dump_gives_the_committed_text(self):
        import vc17  # pure standard library
        for rel in ('locomotion/loco_walk.vms.json', 'keeper/kp_rise.vms.json'):
            text = read_text(os.path.join(SOURCES, rel))
            self.assertTrue(vc17.dump(json.loads(text)) == text, rel)

    def test_bowler_kin_write_vms_writes_the_canonical_form(self):
        import bowler_kin  # pure standard library
        identity = (0.0, 0.0, 0.0, 1.0)
        frame = {'ground': (0.0, 0.0, 0.0), 'hips': (0.0, -0.07, 0.0), 'contacts': 0, 'q': [identity] * 17, 'tracks': {'bat.grip': (0.1, 0.2, 0.3)}}
        clip = {'id': 'demo', 'pack': 'bowler', 'role': 'bowler', 'rate': 30, 'frames': [frame, dict(frame, contacts=1)],
                'tracks': {'bat.grip': 'position'}, 'markers': {'b': 0.5, 'a': 0.25}, 'provenance': {'sources': []}}
        path = os.path.join(tempfile.mkdtemp(prefix='vms_json_test_'), 'demo.vms.json')
        self.addCleanup(shutil.rmtree, os.path.dirname(path), True)
        bowler_kin.write_vms(path, clip)
        text = read_text(path)
        self.assertTrue(vms_json.is_canonical(text), first_difference(vms_json.dumps(vms_json.loads(text)), text))
        doc = vms_json.loads(text)
        self.assertEqual(doc['format'], 'VMS1')
        self.assertEqual(list(doc['markers']), ['a', 'b'])
        self.assertEqual(doc['frames']['contacts'], [0, 1])


if __name__ == '__main__':
    unittest.main()
