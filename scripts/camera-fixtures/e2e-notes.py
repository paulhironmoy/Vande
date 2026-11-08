"""Turns a Playwright `--reporter=list` log of the camera specs into rows for make-index.mjs (one row per test).

  python3 scripts/camera-fixtures/e2e-notes.py <log> <label> <out.json>

The log must contain the job's own "[job] HH:MM:SSZ start build=<id> | <uptime>" line (written by the run scripts); the UTC date is today's.
"""
import json
import re
import sys


def main(argv):
    log, label, out = argv
    text = open(log).read()
    start = re.search(r'\[job\] (\d\d:\d\d:\d\dZ) start build=(\S+) \| (.*)', text)
    build = start.group(2) if start else 'unknown'
    utc = ('2026-11-08T' + start.group(1)) if start else ''
    load = (start.group(3).split('load averages:')[1].strip() if start and 'load averages:' in start.group(3) else '')
    rows = []
    for m in re.finditer(r'^\s+(✓|✘)\s+(\d+) \[practice\] › (\S+?):(\d+):(\d+) › (.*?) \(([\d.]+)(ms|s|m)\)\s*$', text, re.M):
        ok, n, file, line, col, title, t, unit = m.groups()
        title = re.sub(r'^.*? › ', '', title) if ' › ' in title else title
        rows.append({
            'id': f'E2E-{label}-{n}',
            'dod': 'SYN-05',
            'build': build,
            'utc': utc,
            'where': f'Chromium 156 headless (Playwright practice project, hooks build, one worker), this Mac, load averages {load} at the start (indicative)',
            'settings': f'{file}; fake camera or none as the file says; R-23 isolation (port 4315, dist-practice-synth)',
            'method': f'npx playwright test --project=practice --workers=1 (job {label}); test: {title}',
            'expected': 'the test passes',
            'observed': f'{"passed" if ok == "✓" else "FAILED"} in {t} {unit}',
            'result': 'PASS' if ok == '✓' else 'FAIL',
            'label': 'MEASURED (automated fixture, not a player result)',
            'path': f'test-results-synth/ (traces of failures); log: {log}',
        })
    json.dump(rows, open(out, 'w'), indent=1)
    print(f'{len(rows)} rows ({sum(r["result"] == "PASS" for r in rows)} pass) -> {out}')


if __name__ == '__main__':
    main(sys.argv[1:])
