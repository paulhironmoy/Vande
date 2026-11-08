#!/usr/bin/env node
/**
 * The Rookie Examiner's evidence register (ceiling rubric §8): stable ids E-RK-###, kept in
 * release/player-experience/rookie/evidence.json and rendered to release/player-experience/rookie/EVIDENCE.md.
 *
 *   node scripts/eval/evidence.mjs add <file.json>   add items (an array); an item with an existing `key` is updated
 *   node scripts/eval/evidence.mjs render            re-render EVIDENCE.md
 *
 * Item fields: key (stable, e.g. "before/READ2/915x412"), build, time, device, settings, method, expected, observed,
 * result ("pass" | "fail" | "n/a"), path, criteria (e.g. ["READ2", "R4"]).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(REPO, 'release', 'player-experience', 'rookie');
const DB = join(DIR, 'evidence.json');
const MD = join(DIR, 'EVIDENCE.md');

export function load() {
  return existsSync(DB) ? JSON.parse(readFileSync(DB, 'utf8')) : { next: 1, items: [] };
}

export function addItems(items) {
  mkdirSync(DIR, { recursive: true });
  const db = load();
  const ids = [];
  for (const it of items) {
    const old = it.key ? db.items.find((x) => x.key === it.key) : null;
    if (old) {
      Object.assign(old, it, { id: old.id });
      ids.push(old.id);
    } else {
      const id = `E-RK-${String(db.next++).padStart(3, '0')}`;
      db.items.push({ id, ...it });
      ids.push(id);
    }
  }
  writeFileSync(DB, JSON.stringify(db, null, 2));
  render(db);
  return ids;
}

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function render(db = load()) {
  const head = [
    '# Rookie Experience Examiner: evidence register',
    '',
    'Format: release/player-experience/ceiling-rubric.md §8. Ids are stable (E-RK-###); the source of truth is',
    '`evidence.json` beside this file, rendered by `node scripts/eval/evidence.mjs render`. Every run folder under',
    '`runs/<label>/` holds `run.json` (build id, arguments, uptime at start), `log.txt` (every line carries the load',
    'average) and `metrics/*.json`. AI and scripted runs are evaluator evidence, never real-player evidence.',
    '',
    '| ID | Build id | Time (UTC) | Device and browser | Settings | Method | Expected | Observed | Result | Evidence path | Criteria |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const rows = db.items.map((i) => `| ${[i.id, i.build, i.time, i.device, i.settings, i.method, i.expected, i.observed, i.result, i.path, (i.criteria || []).join(', ')].map(cell).join(' | ')} |`);
  writeFileSync(MD, [...head, ...rows, ''].join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'add') console.log(addItems(JSON.parse(readFileSync(file, 'utf8'))).join(' '));
  else render();
}
