/**
 * Splits the main thread's time inside each long frame of a practice-profile.mjs run by source module, using the
 * `// src/…` markers an unminified Vite build leaves in its chunks: which workstream's code a hitch is made of.
 *
 *   node scripts/perf/profile-modules.mjs <profile out dir> <unminified build>/assets
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, assets] = process.argv.slice(2);
const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
const maps = new Map();
function moduleOf(url, line) {
  const file = url.split('/').pop();
  if (!file || !file.endsWith('.js')) return null;
  let map = maps.get(file);
  if (!map) {
    map = [];
    try {
      readFileSync(join(assets, file), 'utf8')
        .split('\n')
        .forEach((l, i) => {
          const m = l.match(/^\/\/ ((?:src|node_modules)\/\S+)/);
          if (m) map.push([i, m[1]]);
        });
    } catch {
      /* not one of ours */
    }
    maps.set(file, map);
  }
  let mod = file;
  for (const [i, m] of map) {
    if (i > line) break;
    mod = m;
  }
  return mod;
}
const group = (m, fn) => {
  if (!m) return fn === '(garbage collector)' ? 'gc' : fn === '(idle)' ? 'idle' : 'native (GPU commands, layout, paint)';
  if (m.startsWith('src/physics')) return 'physics';
  if (m.startsWith('src/render3d')) return 'render3d';
  if (m.startsWith('src/input')) return 'input';
  if (m.startsWith('src/practice')) return 'practice ui/store';
  if (m.startsWith('src/audio')) return 'audio';
  if (m.includes('three')) return 'three.js';
  if (m.includes('react')) return 'react';
  if (m.startsWith('src/')) return m.split('/').slice(0, 2).join('/');
  return m.replace(/^node_modules\/(?:\.pnpm\/)?([^/]+).*/, '$1');
};

for (const run of summary.runs) {
  const p = JSON.parse(readFileSync(join(dir, run.file), 'utf8'));
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  let t = p.startTime;
  const at = p.timeDeltas.map((d) => run.p0 + ((t += d) - p.startTime) / 1000);
  for (const [start, dur] of run.loaf) {
    const groups = new Map();
    const mods = new Map();
    p.samples.forEach((id, k) => {
      if (at[k] < start || at[k] > start + dur) return;
      const f = nodes.get(id).callFrame;
      const m = f.url ? moduleOf(f.url, f.lineNumber) : null;
      const g = group(m, f.functionName);
      const dt = (p.timeDeltas[k + 1] ?? 250) / 1000;
      groups.set(g, (groups.get(g) ?? 0) + dt);
      if (m) mods.set(m, (mods.get(m) ?? 0) + dt);
    });
    const fmt = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ');
    console.log(`delivery ${run.delivery} (${run.kind}): ${Math.round(dur)} ms frame ${Math.round(start - (run.release ?? run.p0))} ms after release\n    ${fmt(groups, 8)}\n    modules: ${fmt(mods, 6)}`);
  }
}
