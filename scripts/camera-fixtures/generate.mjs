/**
 * Generates the synthetic camera videos (SYNTH-VIDEO): VC17 poses (Python), the actor and the frames (Blender), the MJPEG files the
 * fake camera plays (ffmpeg), and the manifest. Nothing here is third-party footage; every picture is rendered from the
 * owner-made character. The videos go to an ignored folder, never into git.
 *
 *   node scripts/camera-fixtures/generate.mjs <step> [--out DIR] [--work DIR] [--clips a,b] [--samples 24] [--force]
 *        [--actor-args "--clothes x,y"] [--render-args "--exposure -2"] [--allow-different-bytes] [--cleanup] [--manifest FILE]
 *     steps: poses | actor | render | encode | manifest | check | all
 *
 * Blender, and ffmpeg for long jobs, are heavy: run the `actor` and `render` steps through `sh S/heavy.sh <label> node ...`.
 * `check` compares the files in --out with tests/fixtures/camera/manifest.json (frame count, size, loop length, sha256).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeMjpeg } from './mjpeg.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLENDER_SCRIPTS = join(REPO, 'scripts', 'blender', 'camera');
const MANIFEST = join(REPO, 'tests', 'fixtures', 'camera', 'manifest.json');
const FPS = 30;

/** Per clip: how it is made and what the camera path is expected to make of it (CAMERA's words for the classes). */
export const CLIPS = {
  rh_drive: { set: 'core', handed: 'right', stroke: 'drive', expect: { swing: 'attack', direction: 'off', power: 'mid' } },
  rh_pull: { set: 'core', handed: 'right', stroke: 'pull', expect: { swing: 'attack', direction: 'leg', power: 'high' } },
  rh_loft: { set: 'core', handed: 'right', stroke: 'loft', expect: { swing: 'attack', direction: 'straight', power: 'highest', loft: true } },
  rh_leave: { set: 'core', handed: 'right', stroke: 'leave', expect: { swing: 'leave' } },
  rh_defence: { set: 'core', handed: 'right', stroke: 'defence', expect: { swing: 'defend' } },
  lh_drive: { set: 'core', handed: 'left', stroke: 'drive', expect: { swing: 'attack', direction: 'off', power: 'mid' } },
  lh_pull: { set: 'core', handed: 'left', stroke: 'pull', expect: { swing: 'attack', direction: 'leg', power: 'high' } },
  lh_loft: { set: 'core', handed: 'left', stroke: 'loft', expect: { swing: 'attack', direction: 'straight', power: 'highest', loft: true } },
  lh_leave: { set: 'core', handed: 'left', stroke: 'leave', expect: { swing: 'leave' } },
  lh_defence: { set: 'core', handed: 'left', stroke: 'defence', expect: { swing: 'defend' } },
  rh_defence_035: { set: 'extra', handed: 'right', stroke: 'defence', expect: { swing: 'defend', note: 'the first defence render: 0.35 u backlift, 0.40 s push' } },
  lh_defence_035: { set: 'extra', handed: 'left', stroke: 'defence', expect: { swing: 'defend', note: 'the first defence render: 0.35 u backlift, 0.40 s push' } },
  rh_drive_near: { set: 'core', handed: 'right', stroke: 'drive', expect: { sameSwingAs: 'rh_drive' } },
  rh_drive_far: { set: 'core', handed: 'right', stroke: 'drive', expect: { sameSwingAs: 'rh_drive' } },
  still: { set: 'core', handed: 'right', stroke: null, expect: { swing: 'none', inFrame: true, ready: true } },
  empty_room: { set: 'core', handed: null, stroke: null, expect: { inFrame: false } },
  black: { set: 'core', handed: null, stroke: null, expect: { inFrame: false, problem: 'black' } },
  rh_drive_portrait: { set: 'extra', handed: 'right', stroke: 'drive', expect: { sameSwingAs: 'rh_drive' } },
  rh_exit_mid: { set: 'extra', handed: 'right', stroke: 'drive', markers: { cutS: 2.0 }, expect: { inFrame: false, problem: 'lost_tracking', note: 'the person is in the picture for 2.0 s (the backlift), then gone: a hard cut to the empty room' } },
  rh_drive_noisy: { set: 'extra', handed: 'right', stroke: 'drive', expect: { sameSwingAs: 'rh_drive', note: 'sensor noise and a little blur: a stress case, not the base set' } },
  rh_drive_dim: { set: 'extra', handed: 'right', stroke: 'drive', expect: { problem: 'poor_light' } },
};

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--force' || v === '--allow-different-bytes' || v === '--cleanup') a[v.slice(2)] = true;
    else if (v.startsWith('--')) a[v.slice(2)] = argv[++i];
    else a._.push(v);
  }
  return a;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { stdio: opts.log ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 1 << 28, cwd: REPO });
  if (opts.log) writeFileSync(opts.log, (r.stdout ?? '') + (r.stderr ?? ''));
  if (r.status !== 0) {
    const tail = opts.log ? ((r.stdout ?? '') + (r.stderr ?? '')).split('\n').slice(-25).join('\n') : '';
    throw new Error(`${cmd} ${args.slice(0, 4).join(' ')} ... exited ${r.status}\n${tail}`);
  }
  console.log(`[generate] ${cmd.split('/').pop()} ${args.slice(0, 3).join(' ')} ... ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return r.stdout;
}

const blender = () => process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';

function stepPoses(ctx) {
  run('python3', ['-B', join(BLENDER_SCRIPTS, 'swing_clips.py'), '--out', join(ctx.work, 'poses')]);
}

function stepActor(ctx) {
  const dir = join(ctx.work, 'actor');
  if (existsSync(join(dir, 'actor.blend')) && !ctx.force) return console.log('[generate] actor.blend exists, kept (use --force to rebuild)');
  mkdirSync(dir, { recursive: true });
  run(blender(), ['-b', '--factory-startup', '--python-exit-code', '3', '--python', join(BLENDER_SCRIPTS, 'build_actor.py'), '--', dir, ...ctx.actorArgs], { log: join(dir, 'build.log') });
}

function stepRender(ctx) {
  const dir = join(ctx.work, 'render');
  mkdirSync(dir, { recursive: true });
  const a = ['-b', '--factory-startup', '--python-exit-code', '3', '--python', join(BLENDER_SCRIPTS, 'render_clips.py'), '--', join(ctx.work, 'actor', 'actor.blend'), dir, '--skip-done', '--samples', String(ctx.samples), ...ctx.renderArgs];
  if (ctx.clips) a.push('--clips', ctx.clips.join(','));
  run(blender(), a, { log: join(dir, `render-${new Date().toISOString().replace(/[:.]/g, '')}.log`) });
}

const MJPEG = ['-c:v', 'mjpeg', '-q:v', '3', '-pix_fmt', 'yuvj420p', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-f', 'mjpeg'];
const FF = ['-hide_banner', '-loglevel', 'error', '-y'];

function stepEncode(ctx) {
  const frames = join(ctx.work, 'render', 'frames');
  const videos = join(ctx.out, 'videos');
  mkdirSync(videos, { recursive: true });
  for (const id of ctx.ids) {
    const file = join(videos, id + '.mjpeg');
    if (!existsSync(join(frames, id)) && existsSync(file) && !['black', 'empty_room', 'rh_exit_mid', 'rh_drive_dim', 'rh_drive_noisy'].includes(id)) {
      console.log(`[generate] ${id}: no frames here, the existing video is kept`);
      continue;
    }
    if (id === 'black') {
      run('ffmpeg', [...FF, '-f', 'lavfi', '-i', 'color=c=black:s=640x480:r=30', '-frames:v', '90', '-vf', 'noise=alls=1:allf=t:all_seed=3', ...MJPEG, file]);
    } else if (id === 'empty_room') {
      run('ffmpeg', [...FF, '-loop', '1', '-framerate', '30', '-i', join(frames, 'empty_room', '0000.png'), '-frames:v', '90', '-vf', 'noise=alls=2:allf=t:all_seed=7', ...MJPEG, file]);
    } else if (id === 'rh_exit_mid') {
      // The first 2.0 s of rh_drive (stance and backlift), then the empty room for 4 s. MJPEG files can simply be joined.
      const tmp = join(ctx.work, 'tmp');
      mkdirSync(tmp, { recursive: true });
      const a = join(tmp, 'exit-a.mjpeg');
      const b = join(tmp, 'exit-b.mjpeg');
      run('ffmpeg', [...FF, '-framerate', '30', '-i', join(frames, 'rh_drive', '%04d.png'), '-frames:v', '60', ...MJPEG, a]);
      run('ffmpeg', [...FF, '-loop', '1', '-framerate', '30', '-i', join(frames, 'empty_room', '0000.png'), '-frames:v', '120', '-vf', 'noise=alls=2:allf=t:all_seed=9', ...MJPEG, b]);
      writeFileSync(file, Buffer.concat([readFileSync(a), readFileSync(b)]));
    } else if (id === 'rh_drive_noisy') {
      run('ffmpeg', [...FF, '-framerate', '30', '-i', join(frames, 'rh_drive', '%04d.png'), '-vf', 'noise=alls=10:allf=t:all_seed=11,gblur=sigma=0.7', ...MJPEG, file]);
    } else if (id === 'rh_drive_dim') {
      run('ffmpeg', [...FF, '-framerate', '30', '-i', join(frames, 'rh_drive', '%04d.png'), '-vf', 'eq=brightness=-0.46:contrast=0.55,noise=alls=5:allf=t:all_seed=5', ...MJPEG, file]);
    } else {
      run('ffmpeg', [...FF, '-framerate', '30', '-i', join(frames, id, '%04d.png'), ...MJPEG, file]);
    }
  }
}

/** Mean luma (0..255) of a whole file, by ffmpeg's signalstats. */
function meanLuma(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const vals = [...(r.stdout + r.stderr).matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].map((m) => Number(m[1]));
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}

function tool(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return ((r.stdout || r.stderr || '').split('\n')[0] ?? '').trim();
}

function stepManifest(ctx) {
  const videos = join(ctx.out, 'videos');
  const clips = [];
  for (const [id, meta] of Object.entries(CLIPS)) {
    const file = join(videos, id + '.mjpeg');
    if (!existsSync(file)) {
      console.log(`[generate] ${id}: no video yet, left out of the manifest`);
      continue;
    }
    const d = describeMjpeg(readFileSync(file));
    let pose = {};
    const poseFile = join(ctx.work, 'poses', (id === 'rh_drive_dim' ? 'rh_drive_dim' : id) + '.pose.json');
    if (existsSync(poseFile)) {
      const p = JSON.parse(readFileSync(poseFile, 'utf8'));
      pose = { view: p.view, markers: p.markers, metrics: p.metrics, authoredFrames: p.frameCount };
    }
    if (meta.markers && !pose.markers) pose = { ...pose, markers: meta.markers };
    clips.push({
      id,
      file: `videos/${id}.mjpeg`,
      set: meta.set,
      handed: meta.handed,
      stroke: meta.stroke,
      width: d.width,
      height: d.height,
      fps: FPS,
      frames: d.frames,
      seconds: Math.round((d.frames / FPS) * 1000) / 1000,
      bytes: d.bytes,
      sha256: sha256(file),
      meanLuma: meanLuma(file),
      ...pose,
      expect: meta.expect,
    });
  }
  const scripts = {};
  for (const f of ['swing_clips.py', 'build_actor.py', 'render_clips.py', 'fixture_scene.py']) scripts['scripts/blender/camera/' + f] = sha256(join(BLENDER_SCRIPTS, f));
  scripts['scripts/blender/motion/vc17.py'] = sha256(join(REPO, 'scripts', 'blender', 'motion', 'vc17.py'));
  const meta = existsSync(join(ctx.work, 'render', 'render-meta.json')) ? JSON.parse(readFileSync(join(ctx.work, 'render', 'render-meta.json'), 'utf8')) : {};
  const manifest = {
    format: 'VANDE-CAMFIX-MANIFEST1',
    readme:
      'Synthetic camera videos rendered by VANDE from its own owner-made character (MPFB body on the VC17-driven rig), for the camera end-to-end tests. They exercise the camera pipeline; they are not player results and do not prove accuracy for real people. The video files are generated into an ignored folder and are not in git: node scripts/camera-fixtures/generate.mjs all.',
    generated: {
      utc: new Date().toISOString(),
      buildId: tool('bash', [join(REPO, 'scripts', 'build-id.sh')]),
      blender: meta.blender ?? null,
      engine: meta.engine ?? null,
      samples: meta.samples ?? null,
      ffmpeg: tool('ffmpeg', ['-version']),
      python: tool('python3', ['--version']),
      mpfb: '2.0.18',
      randomNumbers: 'none: poses and renders are deterministic for these tool versions',
    },
    scripts,
    camera: { width: 640, height: 480, fps: FPS, hfovDeg: 62, heightM: 1.1, container: 'MJPEG (concatenated JPEG pictures), 4:2:0, ffmpeg -q:v 3', loops: 'the file repeats; every stroke clip is built to loop without a jump' },
    clips,
  };
  mkdirSync(dirname(ctx.manifest), { recursive: true });
  writeFileSync(ctx.manifest, JSON.stringify(manifest, null, 1) + '\n');
  console.log(`[generate] manifest: ${clips.length} clips -> ${ctx.manifest}`);
}

function stepCheck(ctx) {
  const manifest = JSON.parse(readFileSync(ctx.manifest, 'utf8'));
  let bad = 0;
  for (const c of manifest.clips) {
    const file = join(ctx.out, c.file);
    const problems = [];
    if (!existsSync(file)) problems.push('missing');
    else {
      const d = describeMjpeg(readFileSync(file));
      if (d.frames !== c.frames) problems.push(`frames ${d.frames} != ${c.frames}`);
      if (d.width !== c.width || d.height !== c.height) problems.push(`size ${d.width}x${d.height}`);
      if (d.progressive || d.chroma !== '4:2:0') problems.push(`encoding ${d.chroma}${d.progressive ? ' progressive' : ''}`);
      if (c.bytes > 2_000_000 * 8) problems.push('unexpectedly large');
      const s = sha256(file);
      if (s !== c.sha256 && !ctx.allowDifferent) problems.push(`sha256 differs (${s.slice(0, 12)} != ${c.sha256.slice(0, 12)})`);
    }
    const text = problems.filter(Boolean);
    if (text.length) bad++;
    console.log(`${text.length ? 'FAIL' : 'ok  '} ${c.id}${text.length ? ': ' + text.join('; ') : ''}`);
  }
  // No tracked file over 2 MB under the fixture folder.
  const tracked = join(REPO, 'tests', 'fixtures', 'camera');
  const big = existsSync(tracked) ? readdirSync(tracked, { recursive: true }).filter((f) => statSync(join(tracked, f)).isFile() && statSync(join(tracked, f)).size > 2_000_000) : [];
  if (big.length) {
    bad++;
    console.log('FAIL files over 2 MB under tests/fixtures/camera: ' + big.join(', '));
  }
  if (bad) process.exitCode = 1;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const step = a._[0];
  const out = resolve(a.out ?? join(REPO, 'test-results-camera-fixtures'));
  const ctx = {
    out,
    work: resolve(a.work ?? join(out, 'work')),
    force: a.force,
    samples: Number(a.samples ?? 24),
    clips: a.clips ? a.clips.split(',') : null,
    manifest: resolve(a.manifest ?? MANIFEST),
    allowDifferent: Boolean(a['allow-different-bytes']),
    actorArgs: a['actor-args'] ? a['actor-args'].split(' ') : [],
    renderArgs: a['render-args'] ? a['render-args'].split(' ') : [],
  };
  ctx.ids = ctx.clips ?? Object.keys(CLIPS);
  const steps = { poses: stepPoses, actor: stepActor, render: stepRender, encode: stepEncode, manifest: stepManifest, check: stepCheck };
  if (step === 'all') {
    for (const s of ['poses', 'actor', 'render', 'encode', 'manifest', 'check']) steps[s](ctx);
  } else if (steps[step]) steps[step](ctx);
  else {
    console.error('usage: node scripts/camera-fixtures/generate.mjs <poses|actor|render|encode|manifest|check|all> [--out DIR] [--work DIR] [--clips a,b] [--samples n] [--force]');
    process.exit(2);
  }
  if (a.cleanup && existsSync(join(ctx.work, 'render', 'frames'))) rmSync(join(ctx.work, 'render', 'frames'), { recursive: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
