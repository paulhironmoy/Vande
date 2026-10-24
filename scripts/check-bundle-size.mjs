#!/usr/bin/env node
/**
 * Reports gzip sizes of the production build and fails when the *initial* transfer
 * (index.html + its scripts/styles/preloads + latin fonts) exceeds the 2 MB budget.
 * Lazy chunks (e.g. the PixiJS map renderer) are listed separately.
 *
 *   node scripts/check-bundle-size.mjs [dist-dir] [--budget-kb 2048]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const distArg = args.find((a) => !a.startsWith('--')) ?? 'dist';
const budgetIdx = args.indexOf('--budget-kb');
const budgetKb = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : 2048;
const dist = resolve(distArg);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = walk(dist).filter((f) => !/\.map$/.test(f));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = new Set();
for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
  refs.add(m[1].replace(/^\.?\//, '').replace(/^[^/]*\/(?=assets\/)/, ''));
}

const rows = files.map((f) => {
  const rel = relative(dist, f);
  const raw = readFileSync(f);
  const gz = /\.(png|jpg|webp|woff2|woff|gz)$/.test(f) ? raw.length : gzipSync(raw, { level: 9 }).length;
  const isHtml = rel === 'index.html';
  const isRef = [...refs].some((r) => rel.endsWith(r) || r.endsWith(rel));
  const isLatinFont = /\.woff2$/.test(rel) && /(latin-wght|latin-500|devanagari-devanagari)/.test(rel) && !/latin-ext/.test(rel);
  const initial = isHtml || isRef || isLatinFont;
  return { rel, raw: raw.length, gz, initial };
});

rows.sort((a, b) => b.gz - a.gz);
const kb = (n) => (n / 1024).toFixed(1).padStart(8) + ' kB';
console.log(`Bundle report for ${relative(process.cwd(), dist) || '.'}\n`);
console.log('  initial   gzip        raw         file');
for (const r of rows) {
  if (r.rel.startsWith('icons/') || r.rel.startsWith('og/') || r.rel.startsWith('brand/')) continue;
  console.log(`  ${r.initial ? '●' : ' '}    ${kb(r.gz)}  ${kb(r.raw)}   ${r.rel}`);
}
const initial = rows.filter((r) => r.initial).reduce((s, r) => s + r.gz, 0);
const total = rows.reduce((s, r) => s + r.gz, 0);
console.log(`\nInitial transfer (gzip): ${(initial / 1024).toFixed(1)} kB  (budget ${budgetKb} kB)`);
console.log(`Total precache (gzip/raw-for-binaries): ${(total / 1024).toFixed(1)} kB`);
if (initial > budgetKb * 1024) {
  console.error(`✗ Initial transfer exceeds the ${budgetKb} kB budget.`);
  process.exit(1);
}
console.log('✓ Within budget.');
