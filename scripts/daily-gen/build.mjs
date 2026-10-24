#!/usr/bin/env node
/**
 * Daily content generator: turns the authored `daysNN.mjs` batches (built with the presets in helpers.mjs) into
 * `src/content/daily/days/dNNN.json`, appends any new ids to `schedule.order` and regenerates `index.ts`.
 *
 *   node scripts/daily-gen/build.mjs
 *
 * The schedule's `contentVersion`, `epoch`, existing `order` and `pinned` entries are preserved: published days are
 * never reordered or removed here (see docs/CONTENT-DAILY.md). Length limits mirror src/engine/dailyValidate.ts so
 * copy problems surface before the engine run (`node scripts/validate-daily.mjs`).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../src/content/daily');
const batches = readdirSync(here).filter((f) => /^days\d+\.mjs$/.test(f)).sort();
const days = [];
for (const b of batches) {
  const m = await import(new URL(`./${b}`, import.meta.url).href);
  days.push(...m.days);
}
days.sort((a, b) => a.id.localeCompare(b.id));
const seen = new Set();
for (const d of days) {
  if (seen.has(d.id)) throw new Error(`duplicate day id ${d.id}`);
  seen.add(d.id);
}

// Local linter mirroring src/engine/dailyValidate.ts LIMITS.
const L = { dTitle: 48, situation: 160, oTitle: 48, preview: 80, consequence: 110, claim: 140, cold: 60, sTitle: 40, sSit: 200, sOTitle: 40, sPreview: 90, sCons: 100, sClaim: 110, sQ: 140, sWords: 14, coldWords: 7 };
const words = (t) => t.split(/\s+/).filter(Boolean).length;
const longest = (t) => Math.max(0, ...t.split(/(?<=[.!?…])\s+/).map((x) => words(x)));
let bad = 0;
const flag = (m) => {
  bad += 1;
  console.error('  ! ' + m);
};
for (const d of days) {
  d.coldOpen.forEach((l, i) => { if (l.length > L.cold) flag(`${d.id} coldOpen[${i}] ${l.length}>${L.cold}`); });
  (d.simple?.coldOpen ?? []).forEach((l, i) => { if (words(l) > L.coldWords) flag(`${d.id} simple.coldOpen[${i}] ${words(l)} words`); });
  for (const dec of d.decisions) {
    if (dec.title.length > L.dTitle) flag(`${d.id} ${dec.id} title ${dec.title.length}`);
    if (dec.situation.length > L.situation) flag(`${d.id} ${dec.id} situation ${dec.situation.length}`);
    if (dec.simple) {
      if (dec.simple.title.length > L.sTitle) flag(`${d.id} ${dec.id} simple.title ${dec.simple.title.length}`);
      if (dec.simple.situation.length > L.sSit) flag(`${d.id} ${dec.id} simple.situation ${dec.simple.situation.length}`);
      if (longest(dec.simple.situation) > L.sWords) flag(`${d.id} ${dec.id} simple.situation sentence ${longest(dec.simple.situation)} words`);
    }
    for (const o of dec.options) {
      if (o.title.length > L.oTitle) flag(`${d.id} ${o.id} title ${o.title.length}`);
      if (o.preview.length > L.preview) flag(`${d.id} ${o.id} preview ${o.preview.length}`);
      if (o.consequence.length > L.consequence) flag(`${d.id} ${o.id} consequence ${o.consequence.length}`);
      const so = dec.simple?.options?.[o.id];
      if (!so) continue;
      if (so.title.length > L.sOTitle) flag(`${d.id} ${o.id} simple.title ${so.title.length}`);
      if (so.preview.length > L.sPreview) flag(`${d.id} ${o.id} simple.preview ${so.preview.length}`);
      if (so.consequence && so.consequence.length > L.sCons) flag(`${d.id} ${o.id} simple.consequence ${so.consequence.length}`);
    }
  }
  for (const e of d.evidence) {
    if (e.claim.length > L.claim) flag(`${d.id} ${e.id} claim ${e.claim.length}`);
    if (e.simple) {
      if (e.simple.claim.length > L.sClaim) flag(`${d.id} ${e.id} simple.claim ${e.simple.claim.length}`);
      if (longest(e.simple.claim) > L.sWords) flag(`${d.id} ${e.id} simple.claim sentence ${longest(e.simple.claim)} words`);
    }
  }
  for (const r of d.rightsMoments) if (r.simple && r.simple.question.length > L.sQ) flag(`${d.id} ${r.id} simple.question ${r.simple.question.length}`);
}
if (bad) console.error(`${bad} length problem(s) — fix before validating`);

mkdirSync(join(ROOT, 'days'), { recursive: true });
for (const d of days) writeFileSync(join(ROOT, 'days', `${d.id}.json`), JSON.stringify(d, null, 2) + '\n');

const schedulePath = join(ROOT, 'schedule.json');
const existing = existsSync(schedulePath)
  ? JSON.parse(readFileSync(schedulePath, 'utf8'))
  : { contentVersion: '2026.10.1', epoch: '2026-10-26', order: [], pinned: {} };
const known = new Set(existing.order);
const appended = days.map((d) => d.id).filter((id) => !known.has(id));
const schedule = { contentVersion: existing.contentVersion, epoch: existing.epoch, order: [...existing.order, ...appended], pinned: existing.pinned ?? {} };
writeFileSync(schedulePath, JSON.stringify(schedule, null, 2) + '\n');

const imports = days.map((d) => `import ${d.id} from './days/${d.id}.json';`).join('\n');
const entries = days.map((d) => `  ${d.id}: ${d.id} as unknown as DailyCrisis,`).join('\n');
writeFileSync(
  join(ROOT, 'index.ts'),
  `/**
 * Daily crisis pool. Generated by scripts/daily-gen/build.mjs: one JSON file per authored day plus the schedule.
 * To add days 31–90: author a new scripts/daily-gen/daysNN.mjs batch and rebuild — new ids are appended to
 * schedule.order; published entries are never reordered or removed, and published dates are pinned in
 * schedule.pinned (docs/CONTENT-DAILY.md).
 */
import type { DailyCrisis, DailySchedule } from '../../engine/types';
import schedule from './schedule.json';
${imports}

export const SCHEDULE = schedule as DailySchedule;
export const DAILY_CONTENT_VERSION: string = SCHEDULE.contentVersion;

export const DAYS: Record<string, DailyCrisis> = {
${entries}
};
`,
);
console.log(`wrote ${days.length} days (${appended.length} appended to the schedule): ${days.map((d) => d.id).join(', ')}`);
if (bad) process.exitCode = 1;
