/**
 * The contact takes in both manifests, written from one data set so the web and Unity can never disagree:
 *   - src/audio/recordedManifest.ts, between `// <generated:contact-takes>` and `// </generated:contact-takes>`;
 *   - unity/…/ProductionRecordedManifest.cs, between the same markers.
 * A set is { placeholder, honest, takes } for one contact sound (an FxId). Placeholder sets come from
 * scripts/audio/placeholders.mjs; recording sets from scripts/audio/ingest-recordings.mjs, which swaps a sound's
 * placeholders for recordings in one step.
 *
 * Reading uses the TypeScript module itself (Node 22.18+ and 23.6+ strip its types natively, and "engines" in
 * package.json requires one of those), so the tools see exactly what the game ships.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PATHS = {
  manifestTs: 'src/audio/recordedManifest.ts',
  publicDir: 'public/audio/cricket',
  unityManifest: 'unity/VandePractice/Assets/VandePractice/Runtime/Audio/Production/ProductionRecordedManifest.cs',
  unityDir: 'unity/VandePractice/Assets/VandePractice/Runtime/Audio/Resources/Audio/Cricket',
};

export const BEGIN = '// <generated:contact-takes>';
export const END = '// </generated:contact-takes>';

export const PLACEHOLDER_HONEST =
  'Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.';

/** The shipped manifest, imported fresh (cache-busted by the file's mtime and size). */
export async function loadManifest(root) {
  const file = join(root, PATHS.manifestTs);
  const st = statSync(file);
  let mod;
  try {
    mod = await import(`${pathToFileURL(file).href}?v=${st.mtimeMs}-${st.size}-${Date.now()}`);
  } catch (e) {
    if (/Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION/.test(String(e))) throw new Error(`Node ${process.version} cannot read TypeScript: use Node 22.22.2 or later (or 23.6 or later), as "engines" in package.json says`, { cause: e });
    throw e;
  }
  if (!mod.CONTACT_TAKES) throw new Error(`${PATHS.manifestTs} has no CONTACT_TAKES (an older manifest): run scripts/audio/placeholders.mjs --write first`);
  const kinds = mod.RECORDED_KINDS;
  const contactKeys = kinds.filter((k) => k.align === 'onset').map((k) => k.key);
  return { kinds, contactKeys, sets: { ...mod.CONTACT_TAKES } };
}

/** Number as JavaScript prints it, with `.0` on whole numbers (the Unity test's Number() form). */
export function num(v) {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  return /[.e]/.test(s) || !Number.isFinite(v) ? s : `${s}.0`;
}

const tsStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const csStr = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
const csNum = (v) => (v === null ? 'double.NaN' : num(v));

/** The TypeScript block body (the lines between the markers), sets in `order`. */
export function renderTs(sets, order) {
  const out = [];
  for (const key of order) {
    const s = sets[key];
    if (!s) continue;
    out.push(`  ${key}: {`);
    out.push(`    placeholder: ${s.placeholder ? 'true' : 'false'},`);
    out.push(`    honest: ${tsStr(s.honest)},`);
    out.push('    takes: [');
    for (const t of s.takes) out.push(`      { id: ${tsStr(t.id)}, file: ${tsStr(t.file)}, bytes: ${t.bytes}, sha256: ${tsStr(t.sha256)}, register: ${tsStr(t.register)}, lufs: ${num(t.lufs)}, peakDbfs: ${num(t.peakDbfs)}, durationMs: ${t.durationMs} },`);
    out.push('    ],');
    out.push('  },');
  }
  return out;
}

/** The C# block body, sets in `order`. */
export function renderCs(sets, order) {
  const i = (n) => ' '.repeat(n);
  const out = [];
  out.push(`${i(8)}private static readonly Dictionary<string, ProductionContactTakeSet> ContactTakes =`);
  out.push(`${i(12)}new Dictionary<string, ProductionContactTakeSet>(StringComparer.Ordinal)`);
  out.push(`${i(12)}{`);
  for (const key of order) {
    const s = sets[key];
    if (!s) continue;
    out.push(`${i(16)}{`);
    out.push(`${i(20)}${csStr(key)}, new ProductionContactTakeSet(${s.placeholder ? 'true' : 'false'},`);
    out.push(`${i(24)}${csStr(s.honest)},`);
    out.push(`${i(24)}new[]`);
    out.push(`${i(24)}{`);
    for (const t of s.takes) {
      out.push(`${i(28)}new ProductionRecordedTake(${csStr(t.id)}, ${csStr(t.file)}, ${t.bytes},`);
      out.push(`${i(32)}${csStr(t.sha256)}, ${csStr(t.register)}, ${csNum(t.lufs)}, ${num(t.peakDbfs)}, ${t.durationMs}),`);
    }
    out.push(`${i(24)}})`);
    out.push(`${i(16)}},`);
  }
  out.push(`${i(12)}};`);
  return out;
}

/** Replaces the lines between the markers; throws when the markers are missing or repeated. */
export function replaceBlock(text, body) {
  const lines = text.split('\n');
  const b = lines.findIndex((l) => l.trim().startsWith(BEGIN));
  const e = lines.findIndex((l) => l.trim().startsWith(END));
  if (b < 0 || e < b || lines.filter((l) => l.trim().startsWith(BEGIN)).length !== 1) throw new Error(`the ${BEGIN} … ${END} markers are missing or repeated`);
  return [...lines.slice(0, b + 1), ...body, ...lines.slice(e)].join('\n');
}

export function writeManifests(root, sets, order) {
  const ts = join(root, PATHS.manifestTs);
  const cs = join(root, PATHS.unityManifest);
  const before = { ts: readFileSync(ts, 'utf8'), cs: existsSync(cs) ? readFileSync(cs, 'utf8') : null };
  const after = { ts: replaceBlock(before.ts, renderTs(sets, order)), cs: before.cs === null ? null : replaceBlock(before.cs, renderCs(sets, order)) };
  writeFileSync(ts, after.ts);
  if (after.cs !== null) writeFileSync(cs, after.cs);
  return { before, after };
}

/** Proposed manifests without writing: the new texts and unified diffs. */
export function proposeManifests(root, sets, order) {
  const ts = readFileSync(join(root, PATHS.manifestTs), 'utf8');
  const csFile = join(root, PATHS.unityManifest);
  const cs = existsSync(csFile) ? readFileSync(csFile, 'utf8') : null;
  const nts = replaceBlock(ts, renderTs(sets, order));
  const ncs = cs === null ? null : replaceBlock(cs, renderCs(sets, order));
  return { ts: nts, cs: ncs, tsPatch: unifiedDiff(ts, nts, PATHS.manifestTs), csPatch: cs === null ? '' : unifiedDiff(cs, ncs, PATHS.unityManifest) };
}

/** A Unity .meta for one take: a stable GUID from the file name; contact takes keep their rate (crowd: 24 kHz). */
export function unityMeta(file, { crowd = false } = {}) {
  const guid = createHash('md5').update(`vande/audio/cricket/${file}`).digest('hex');
  return `fileFormatVersion: 2
guid: ${guid}
AudioImporter:
  externalObjects: {}
  serializedVersion: 8
  defaultSettings:
    serializedVersion: 2
    loadType: 0
    sampleRateSetting: ${crowd ? 2 : 0}
    sampleRateOverride: ${crowd ? 24000 : 48000}
    compressionFormat: 1
    quality: 0.6
    conversionMode: 0
    preloadAudioData: 1
  platformSettingOverrides: {}
  forceToMono: 0
  normalize: 1
  loadInBackground: 0
  ambisonic: 0
  3D: 1
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

/** A unified diff (git apply-able) of two texts, with 3 lines of context. */
export function unifiedDiff(a, b, path) {
  if (a === b) return '';
  const x = a.split('\n');
  const y = b.split('\n');
  // Trim the common head and tail, then an LCS over the middle (the changes are local).
  let h = 0;
  while (h < x.length && h < y.length && x[h] === y[h]) h++;
  let t = 0;
  while (t < x.length - h && t < y.length - h && x[x.length - 1 - t] === y[y.length - 1 - t]) t++;
  const xm = x.slice(h, x.length - t);
  const ym = y.slice(h, y.length - t);
  const n = xm.length;
  const m = ym.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = xm[i] === ym[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  for (let k = 0; k < h; k++) ops.push([' ', x[k]]);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xm[i] === ym[j]) {
      ops.push([' ', xm[i]]);
      i++;
      j++;
    } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) ops.push(['-', xm[i++]]);
    else ops.push(['+', ym[j++]]);
  }
  for (let k = x.length - t; k < x.length; k++) ops.push([' ', x[k]]);
  const out = [`--- a/${path}`, `+++ b/${path}`];
  let k = 0;
  let ai = 1;
  let bi = 1;
  while (k < ops.length) {
    if (ops[k][0] === ' ') {
      k++;
      ai++;
      bi++;
      continue;
    }
    let s = k;
    let c = 0;
    while (s > 0 && c < 3 && ops[s - 1][0] === ' ') {
      s--;
      c++;
    }
    let e = k;
    for (;;) {
      while (e < ops.length && ops[e][0] !== ' ') e++;
      let run = 0;
      while (e + run < ops.length && ops[e + run][0] === ' ') run++;
      if (e + run < ops.length && run <= 6) {
        e += run;
        continue;
      }
      e = Math.min(ops.length, e + Math.min(3, run));
      break;
    }
    const as = ai - c;
    const bs = bi - c;
    let al = 0;
    let bl = 0;
    const body = [];
    for (let q = s; q < e; q++) {
      body.push(ops[q][0] + ops[q][1]);
      if (ops[q][0] !== '+') al++;
      if (ops[q][0] !== '-') bl++;
    }
    out.push(`@@ -${al ? as : as - 1},${al} +${bl ? bs : bs - 1},${bl} @@`, ...body);
    for (let q = k; q < e; q++) {
      if (ops[q][0] !== '+') ai++;
      if (ops[q][0] !== '-') bi++;
    }
    k = e;
  }
  return `${out.join('\n')}\n`;
}
