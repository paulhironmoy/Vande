"""The one canonical text form of VMS1 motion sources (assets-src/motion/<pack>/<id>.vms.json).

Every bake script writes its clips through this module, so a re-bake changes a source only where the motion changed,
and the committed files read the same whichever script made them. Pure standard library (no bpy, no mathutils), so the
unit test, the command line and every Blender or plain-Python bake can import it.

The form is valid JSON, read by any JSON parser (scripts/motion/export.mjs reads it with JSON.parse):

    {
     "format": "VMS1",
     "id": "bat_drive",
     "markers": {"plant":0.32,"contact":0.37},
     "frames": {
      "ground": [[0.0,0.0,0.0],[0.0,0.0,0.0]],
      "q": [[0.0,0.0,0.0,1.0,...]]
     },
     "tracks": {
      "bat.grip": {"kind":"position","frames":[[0.1,0.2,0.3]]}
     },
     "provenance": {...}
    }

- Each top-level key, each key of "frames" and each named track of "tracks" has its own line, so a diff names the
  field or track that changed.
- Every other value is compact JSON on its line: numbers inline, no spaces.
- Keys keep the order of the document (they are never sorted). Floats keep Python's shortest round-trip text, so -0.0,
  0.1 and 1e-07 survive a parse and a write unchanged. NaN and Infinity are refused (they are not JSON).
- LF line endings and one final newline.

Command line (default path: assets-src/motion at the repository root):

    python3 scripts/blender/motion/vms_json.py --check [path ...]   exit 1 if a source is not in the canonical form
    python3 scripts/blender/motion/vms_json.py --write [path ...]   rewrite sources in place (values proved identical)

Unit test: python3 -m unittest discover -s scripts/blender/motion -p '*_test.py'
"""
import argparse
import json
import os
import struct
import sys

# Dict-valued keys written one entry per line; every other key's value stays on its own line.
EXPANDED_KEYS = ('frames', 'tracks')

_COMPACT = (',', ':')


def _leaf(value):
    """Compact JSON for one value (no whitespace). allow_nan=False keeps the output valid JSON."""
    return json.dumps(value, separators=_COMPACT, allow_nan=False)


def dumps(doc):
    """The canonical text of one VMS1 source (a dict). Key order is the dict's order."""
    if not isinstance(doc, dict):
        raise TypeError('a VMS1 source is a JSON object')
    lines = ['{']
    last = len(doc) - 1
    for i, (key, value) in enumerate(doc.items()):
        comma = ',' if i < last else ''
        if key in EXPANDED_KEYS and isinstance(value, dict) and value:
            lines.append(' %s: {' % _leaf(key))
            inner_last = len(value) - 1
            for j, (name, item) in enumerate(value.items()):
                lines.append('  %s: %s%s' % (_leaf(name), _leaf(item), ',' if j < inner_last else ''))
            lines.append(' }' + comma)
        else:
            lines.append(' %s: %s%s' % (_leaf(key), _leaf(value), comma))
    lines.append('}')
    return '\n'.join(lines) + '\n'


def _unique_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError('duplicate key %r' % key)
        out[key] = value
    return out


def _not_finite(name):
    raise ValueError('%s is not valid JSON' % name)


def loads(text):
    """Parses a source strictly: a duplicate key, NaN or Infinity is an error, and key order is kept."""
    return json.loads(text, object_pairs_hook=_unique_keys, parse_constant=_not_finite)


def read(path):
    with open(path, 'r', encoding='utf-8', newline='') as handle:
        return loads(handle.read())


def write(path, doc):
    """Writes the canonical text of doc to path (UTF-8, LF). Returns the text."""
    text = dumps(doc)
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    return text


def identical(a, b):
    """Deep equality that == alone does not give: -0.0 differs from 0.0, 1 from 1.0 and True from 1, floats are
    compared bit for bit, and dicts must have the same keys in the same order."""
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return list(a) == list(b) and all(identical(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)):
        return len(a) == len(b) and all(identical(x, y) for x, y in zip(a, b))
    if isinstance(a, float):
        return struct.pack('<d', a) == struct.pack('<d', b)
    return a == b


def is_canonical(text):
    """True when text is exactly the canonical form of the document it holds."""
    return dumps(loads(text)) == text


def source_files(paths):
    """Every *.vms.json under the given files and folders, sorted."""
    found = []
    for path in paths:
        if os.path.isdir(path):
            for root, _dirs, names in os.walk(path):
                found.extend(os.path.join(root, n) for n in names if n.endswith('.vms.json'))
        else:
            found.append(path)
    return sorted(found)


def _repo_default():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, '..', '..', '..', 'assets-src', 'motion'))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Check or write VMS1 sources in the canonical text form.')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='exit 1 if any source is not canonical')
    mode.add_argument('--write', action='store_true', help='rewrite non-canonical sources in place')
    parser.add_argument('paths', nargs='*', help='files or folders (default: assets-src/motion)')
    args = parser.parse_args(argv)
    files = source_files(args.paths or [_repo_default()])
    if not files:
        print('no .vms.json files found', file=sys.stderr)
        return 2
    stale = []
    before = after = 0
    for path in files:
        with open(path, 'r', encoding='utf-8', newline='') as handle:
            old = handle.read()
        doc = loads(old)
        new = dumps(doc)
        before += len(old.encode('utf-8'))
        after += len(new.encode('utf-8'))
        if new == old:
            continue
        stale.append(path)
        if args.write:
            if not identical(doc, loads(new)):
                print('refusing %s: the canonical text does not parse back to the same values' % path, file=sys.stderr)
                return 3
            with open(path, 'w', encoding='utf-8', newline='\n') as handle:
                handle.write(new)
    verb = 'rewrote' if args.write else 'not canonical:'
    for path in stale:
        print(verb, path)
    print('%d sources, %d %s; %d -> %d bytes' % (len(files), len(stale), 'rewritten' if args.write else 'not canonical', before, after))
    return 1 if (stale and args.check) else 0


if __name__ == '__main__':
    sys.exit(main())
