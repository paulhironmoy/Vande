/**
 * Writes the evidence INDEX.txt of SYNTH-VIDEO from the measurement files, so no number is typed by hand: one row per claim with the
 * fields AGENTS.md asks for (id, DoD row, build id, UTC time, device/browser, settings, method, expected, observed, result, path).
 *
 *   node scripts/camera-fixtures/make-index.mjs --manifest M --detection DIR --classes FILE [--classes FILE] --notes NOTES.json --out INDEX.txt
 *
 * NOTES.json carries the rows that are not derived from a file (test counts, probes): [{ id, dod, utc, build, where, settings, method,
 * expected, observed, result, path }]. Result is PASS, FAIL or UNPROVEN, and the label MEASURED, INDICATIVE or UNPROVEN is added.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function args(argv) {
  const a = { classes: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    if (k === 'classes') a.classes.push(argv[++i]);
    else a[k] = argv[++i];
  }
  return a;
}

const a = args(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(resolve(a.manifest), 'utf8'));
const detection = a.detection ? JSON.parse(readFileSync(join(resolve(a.detection), 'detection-summary.json'), 'utf8')) : null;
const notes = a.notes && existsSync(resolve(a.notes)) ? JSON.parse(readFileSync(resolve(a.notes), 'utf8')) : [];
const cell = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const rows = [];
const add = (r) => rows.push(['id', 'dod', 'build', 'utc', 'where', 'settings', 'method', 'expected', 'observed', 'result', 'label', 'path'].map((k) => cell(r[k])).join(' | '));

const build = manifest.generated.buildId;
for (const c of manifest.clips) {
  add({
    id: `MAN-${c.id}`,
    dod: 'SYN-01 SYN-03',
    build,
    utc: manifest.generated.utc,
    where: `${manifest.generated.blender}, ${manifest.generated.engine}, ffmpeg`,
    settings: `${c.set} clip, ${c.handed ?? 'nobody'}, ${c.stroke ?? 'no stroke'}`,
    method: 'generate.mjs all (Blender render, ffmpeg MJPEG), then sha256 and frame count of the file',
    expected: `640x480 (or the stated size), 30 fps, 3 to 6 s; class ${JSON.stringify(c.expect)}`,
    observed: `${c.width}x${c.height}, ${c.frames} frames, ${c.seconds} s, ${c.bytes} bytes, mean luma ${c.meanLuma}, sha256 ${c.sha256}`,
    result: c.frames >= 90 && c.frames <= 180 ? 'PASS' : 'FAIL',
    label: 'MEASURED',
    path: `test-results-camera-fixtures/${c.file}`,
  });
}
if (detection) {
  for (const [id, m] of Object.entries(detection.clips)) {
    const rms = ['wristL', 'wristR'].map((k) => m.landmarks?.[k]?.rmsU).filter((v) => v != null);
    const jit = ['wristL', 'wristR'].map((k) => m.landmarks?.[k]?.stanceJitterU).filter((v) => v != null);
    add({
      id: `DET-${id}`,
      dod: 'SYN-04',
      build: detection.buildId,
      utc: detection.utc,
      where: detection.browser,
      settings: `${detection.engine} + ${detection.model}, ${JSON.stringify(detection.settings)}`,
      method: 'measure-detection.mjs: the pinned pose engine on every frame of the file, against the renderer ground truth',
      expected: 'valid pose (both shoulders and a wrist, visibility >= 0.5) in >= 95% of frames, no gap over 2 frames, wrist error < 0.15 u (the fixture bar of FIXTURE-PLAN.md section 5)',
      observed:
        `valid ${m.validRate}, detected ${m.detectedRate}, longest gap ${m.longestGapFrames} frames, mean visibility ${m.meanVisibility}` +
        (rms.length ? `, wrist rms ${rms.map((v) => v.toFixed(3)).join('/')} u, stance jitter ${jit.map((v) => v.toFixed(3)).join('/')} u` : ', no ground truth for this clip') +
        (m.lag ? `, lag y ${m.lag.yMs} ms x ${m.lag.xMs} ms` : '') +
        (m.inferenceMs ? `, inference p50 ${m.inferenceMs.p50} p95 ${m.inferenceMs.p95} p99 ${m.inferenceMs.p99} ms (CPU, ${detection.uptimeBefore.split('load averages:')[1]?.trim()})` : ''),
      result: m.validRate >= 0.95 ? 'PASS' : 'FAIL',
      label: 'MEASURED (inference speed INDICATIVE: software, shared Mac)',
      path: 'test-results-camera-fixtures/detection/metrics/' + id + '.metrics.json',
    });
  }
}
for (const file of a.classes) {
  const c = JSON.parse(readFileSync(resolve(file), 'utf8'));
  for (const [id, sources] of Object.entries(c.results)) {
    for (const [src, r] of Object.entries(sources)) {
      const s = r.armedAtStance;
      add({
        id: `CLS-${id}-${src}`,
        dod: 'SYN-04 SYN-05',
        build,
        utc: c.utc,
        where: 'node, vitest, simulated clock (no browser)',
        settings: `landmarks: ${src === 'ideal' ? 'authored joints, no model' : 'pose engine on the rendered frames'}; delivery armed at 0.9 s`,
        method: 'classify-traces.ts: CameraBatter, PoseMapper, GestureTracker, normalizeGesture on the clip',
        expected: `class ${r.wantClass}`,
        observed: `${s ? `${s.kind} dir ${s.directionDeg} power ${s.power} elev ${s.elevation} (${s.class})` : 'no swing'}; share of start phases with the right class by armed window ${JSON.stringify(r.shareOfPhasesWithTheRightClassByWindowS)}`,
        result: (s?.class ?? 'none') === r.wantClass ? 'PASS' : 'FAIL',
        label: 'MEASURED (synthetic)',
        path: file,
      });
    }
  }
}
for (const n of notes) add({ label: n.result === 'UNPROVEN' ? 'UNPROVEN' : 'MEASURED', ...n });
writeFileSync(
  resolve(a.out),
  ['# SYNTH-VIDEO evidence index. One row per claim. Builder observations, not certification. No human result is stated or implied.', '# id | DoD row | build id | UTC | device/browser | settings | method | expected | observed | result | label | path', ...rows].join('\n') + '\n',
);
console.log(`[index] ${rows.length} rows -> ${a.out}`);
