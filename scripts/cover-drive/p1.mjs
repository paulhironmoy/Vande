#!/usr/bin/env node
/**
 * Cover-drive P1: one command that reproduces the baseline and proves it bit-identical across repeats.
 *
 *   node scripts/cover-drive/p1.mjs --out <dir> [--repeat 2] [--capture none|stills|video|all]
 *                                   [--unity-wrapper <script>] [--cases a,b] [--quality High]
 *                                   [--frozen-ts <run-n/ts of an earlier checkpoint>]
 *
 * Each run writes <out>/run-<n>/ts (scripts/cover-drive/scenario.mjs) and <out>/run-<n>/unity
 * (Vande.Practice.Editor.CoverDrive.CoverDriveCaptureRig.Run in Unity batchmode), then
 * scripts/cover-drive/analyse.mjs writes <out>/run-<n>/baseline-metrics.json. The proof compares, across runs:
 *   - the SHA-256 of every TypeScript content file (scenario packets, physics telemetry, summary, source hashes);
 *   - the SHA-256 of the Unity telemetry bodies (each line without its leading buildId field);
 *   - the SHA-256 of baseline-metrics.json;
 *   - the combined SHA-256 of the source files that decide the outcome, and of the Unity runtime sources and assets
 *     the presentation depends on (a proof is void if either moved). A --frozen-ts replay reproduces a checkpoint's
 *     Unity telemetry only when the recorded Unity sources hash also matches.
 * Captures (images) are rendered on run 1 only and are not part of the proof; their hashes are listed.
 *
 * Machine rules (AGENTS.md): pass --unity-wrapper so Unity runs inside the shared Unity lock and heavy slot. Inside the
 * lock, unity-guarded.mjs refuses to start if another Unity editor has the project open or Temp/UnityLockfile exists.
 * Bulk output belongs in a scratch directory; copy only summaries and chosen captures into release/.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const projectPath = path.join(repoRoot, 'unity/VandePractice');
const UNITY_VERSION = readFileSync(path.join(projectPath, 'ProjectSettings/ProjectVersion.txt'), 'utf8')
  .match(/m_EditorVersion:\s*(\S+)/)[1];

function parseArgs(argv) {
  const out = { out: null, repeat: 2, capture: 'none', wrapper: null, cases: null, quality: 'High', frozenTs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = path.resolve(argv[++i]);
    else if (a === '--repeat') out.repeat = Number(argv[++i]);
    else if (a === '--capture') out.capture = argv[++i];
    else if (a === '--unity-wrapper') out.wrapper = path.resolve(argv[++i]);
    else if (a === '--cases') out.cases = argv[++i];
    else if (a === '--quality') out.quality = argv[++i];
    else if (a === '--frozen-ts') out.frozenTs = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.out || !(out.repeat >= 1)) throw new Error('usage: p1.mjs --out <dir> [--repeat 2] [--capture none|stills|video|all]');
  return out;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const fileSha = (file) => sha(readFileSync(file));
const now = () => new Date().toISOString();
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const buildId = () => execFileSync('bash', [path.join(repoRoot, 'scripts/build-id.sh')], { encoding: 'utf8' }).trim();

function runNode(script, args) {
  const r = spawnSync(process.execPath, [path.join(scriptDir, script), ...args], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function runUnity(label, outDir, opts, id) {
  const env = {
    ...process.env,
    VANDE_COVER_DRIVE_SCENARIO: path.join(outDir, 'ts', 'scenario.json'),
    VANDE_EVIDENCE_OUT: path.join(outDir, 'unity'),
    VANDE_COVER_DRIVE_CAPTURE: opts.capture,
    VANDE_COVER_DRIVE_QUALITY: opts.quality,
    VANDE_BUILD_ID: id,
    ...(opts.cases ? { VANDE_COVER_DRIVE_CASES: opts.cases } : {}),
  };
  const unityArgs = ['-batchmode', '-projectPath', projectPath, '-executeMethod',
    'Vande.Practice.Editor.CoverDrive.CoverDriveCaptureRig.Run', '-logFile', path.join(outDir, 'unity.log'), '-quit'];
  // unity-guarded.mjs runs inside the lock wrapper and refuses (exit 75) if another editor has the project open.
  const guarded = [process.execPath, path.join(scriptDir, 'unity-guarded.mjs'), ...unityArgs];
  const [cmd, args] = opts.wrapper ? [opts.wrapper, [label, ...guarded]] : [guarded[0], guarded.slice(1)];
  const started = { utc: now(), uptime: uptime() };
  const r = spawnSync(cmd, args, { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const finished = { utc: now(), uptime: uptime() };
  if (r.status !== 0) throw new Error(`Unity run ${label} exited ${r.status}; see ${path.join(outDir, 'unity.log')}\n${r.stderr}`);
  return { started, finished, wrapperStderr: (r.stderr ?? '').trim().split('\n').slice(-4) };
}

function encodeVideos(unityDir, videoDir) {
  const framesRoot = path.join(unityDir, 'frames');
  if (!existsSync(framesRoot)) return [];
  mkdirSync(videoDir, { recursive: true });
  const made = [];
  for (const set of readdirSync(framesRoot).sort()) {
    for (const view of readdirSync(path.join(framesRoot, set)).sort()) {
      const dir = path.join(framesRoot, set, view);
      if (!statSync(dir).isDirectory() || readdirSync(dir).length === 0) continue;
      const file = path.join(videoDir, `${set}-${view}.mp4`);
      const r = spawnSync('nice', ['-n', '15', 'ffmpeg', '-y', '-loglevel', 'error', '-framerate', '60', '-i',
        path.join(dir, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', file],
      { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`ffmpeg failed for ${dir}: ${r.stderr}`);
      made.push({ file: path.basename(file), frames: readdirSync(dir).length, bytes: statSync(file).size, sha256: fileSha(file) });
    }
  }
  return made;
}

/**
 * The Unity side of the determinism scope: every runtime C# file and Resources asset under
 * Assets/VandePractice/Runtime, plus this rig. The Unity telemetry depends on them, so a proof (or a frozen replay)
 * only reproduces a checkpoint when this hash is unchanged too.
 */
function unitySourcesHash() {
  const base = path.join(projectPath, 'Assets/VandePractice');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (!name.endsWith('.meta')) files.push(abs);
    }
  };
  walk(path.join(base, 'Runtime'));
  walk(path.join(base, 'Editor/CoverDrive'));
  const h = createHash('sha256');
  for (const f of files) h.update(`${path.relative(projectPath, f)}\0${fileSha(f)}\n`);
  return { sha256: h.digest('hex'), files: files.length };
}

function listHashes(dir) {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).sort().filter((f) => statSync(path.join(dir, f)).isFile())
    .map((f) => [f, fileSha(path.join(dir, f))]));
}

const opts = parseArgs(process.argv.slice(2));
mkdirSync(opts.out, { recursive: true });
const runs = [];
for (let n = 1; n <= opts.repeat; n++) {
  const runDir = path.join(opts.out, `run-${n}`);
  mkdirSync(runDir, { recursive: true });
  const before = { utc: now(), uptime: uptime(), buildId: buildId(), unitySources: unitySourcesHash() };
  if (opts.frozenTs) {
    // Replay a saved checkpoint: the exact TypeScript packets and physics telemetry of an earlier tree, so the Unity
    // presentation of that checkpoint stays reproducible after the physics moves on.
    mkdirSync(path.join(runDir, 'ts'), { recursive: true });
    for (const f of ['scenario.json', 'summary.json', 'physics-telemetry.jsonl', 'sources.json', 'ts-digests.json', 'run-meta.json']) {
      copyFileSync(path.join(opts.frozenTs, f), path.join(runDir, 'ts', f));
    }
  } else {
    runNode('scenario.mjs', ['--out', path.join(runDir, 'ts')]);
  }
  const ts = JSON.parse(readFileSync(path.join(runDir, 'ts', 'ts-digests.json'), 'utf8'));
  const sources = JSON.parse(readFileSync(path.join(runDir, 'ts', 'sources.json'), 'utf8')).combined;
  const capture = n === 1 ? opts.capture : 'none';
  const unity = runUnity(`trackb-p1-run${n}`, runDir, { ...opts, capture }, before.buildId);
  runNode('analyse.mjs', ['--run', runDir]);
  const unityDigests = JSON.parse(readFileSync(path.join(runDir, 'unity', 'unity-digests.json'), 'utf8'));
  const after = { utc: now(), uptime: uptime(), buildId: buildId(), unitySources: unitySourcesHash() };
  const videos = n === 1 ? encodeVideos(path.join(runDir, 'unity'), path.join(runDir, 'videos')) : [];
  runs.push({
    run: n, before, after, unity,
    sourcesCombinedSha256: sources,
    unitySourcesSha256: before.unitySources.sha256,
    unitySourcesStableDuringRun: before.unitySources.sha256 === after.unitySources.sha256,
    tsDigests: ts,
    unityTelemetryBodySha256: unityDigests.telemetryBodySha256,
    unityTelemetryLines: unityDigests.lines,
    unityCaseDigests: unityDigests.cases,
    baselineMetricsSha256: fileSha(path.join(runDir, 'baseline-metrics.json')),
    captureHashes: n === 1 ? listHashes(path.join(runDir, 'unity', 'captures')) : undefined,
    videos,
  });
}

const key = (r) => JSON.stringify([r.sourcesCombinedSha256, r.tsDigests, r.unityTelemetryBodySha256, r.baselineMetricsSha256]);
const sourcesStable = runs.every((r) => r.sourcesCombinedSha256 === runs[0].sourcesCombinedSha256 &&
  r.unitySourcesStableDuringRun && r.unitySourcesSha256 === runs[0].unitySourcesSha256);
const identical = runs.every((r) => key(r) === key(runs[0]));
const report = {
  schema: 'vande.cover-drive.p1.reproducibility.v1',
  classification: 'BUILDER_OBSERVATION_NON_HUMAN',
  command: `node scripts/cover-drive/p1.mjs ${process.argv.slice(2).join(' ')}`,
  frozenTs: opts.frozenTs,
  unityVersion: UNITY_VERSION,
  repeat: opts.repeat,
  quality: opts.quality,
  sourcesStable,
  bitIdentical: identical,
  verdict: !sourcesStable ? 'VOID (TypeScript or Unity sources changed between runs; rerun)' : identical ? 'PASS' : 'FAIL',
  runs,
};
writeFileSync(path.join(opts.out, 'p1-reproducibility.json'), `${JSON.stringify(report, null, 1)}\n`);
process.stdout.write(`${JSON.stringify({ verdict: report.verdict, sourcesStable, bitIdentical: identical,
  telemetry: runs.map((r) => r.unityTelemetryBodySha256), metrics: runs.map((r) => r.baselineMetricsSha256) })}\n`);
process.exitCode = report.verdict === 'PASS' ? 0 : 1;
