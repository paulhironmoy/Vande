#!/usr/bin/env node
/**
 * Validates every authored daily crisis, the schedule and the balance of each day.
 *   node scripts/validate-daily.mjs            # all days
 *   node scripts/validate-daily.mjs d007 d012  # selected days
 *   node scripts/validate-daily.mjs --pin-through=2026-12-31
 *       # prints the schedule.pinned entries that freeze every date from the epoch to that day onto the day it
 *       # resolves to today — paste them into schedule.json before appending new days (docs/CONTENT-DAILY.md)
 * Loads the TypeScript engine through Vite's SSR module runner, so no build step is needed.
 */
import { createServer } from 'vite';

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const pinThrough = process.argv.find((a) => a.startsWith('--pin-through='))?.slice('--pin-through='.length);
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const content = await server.ssrLoadModule('/src/content/daily/index.ts');
  const engine = await server.ssrLoadModule('/src/engine/dailyValidate.ts');
  const { DAYS, SCHEDULE } = content;
  const { validateDailyCrisis, validateDailySchedule, dailyBalance } = engine;
  let failed = 0;
  const ids = (only.length ? only : SCHEDULE.order).filter((id) => DAYS[id]);
  const rows = [];
  for (const id of ids) {
    const day = DAYS[id];
    const v = validateDailyCrisis(day);
    const bal = v.ok ? dailyBalance(day) : null;
    const problems = [...v.errors, ...(bal ? bal.problems : [])];
    if (problems.length) failed += 1;
    rows.push({ id, key: day.dilemmaKey, dec: day.decisions.length, ev: day.evidence.length, principled: bal?.principled ?? '-', suppressive: bal?.suppressive ?? '-', idle: bal?.idle ?? '-', status: problems.length ? 'FAIL' : 'ok' });
    for (const e of problems) console.error(`  ✗ ${e}`);
    for (const w of v.warnings) console.warn(`  ⚠ ${w}`);
  }
  console.table(rows);
  if (!only.length) {
    const s = validateDailySchedule(SCHEDULE, DAYS);
    for (const e of s.errors) console.error(`  ✗ ${e}`);
    for (const w of s.warnings) console.warn(`  ⚠ ${w}`);
    if (!s.ok) failed += 1;
    console.log(`schedule: ${SCHEDULE.order.length} days, content ${SCHEDULE.contentVersion}, epoch ${SCHEDULE.epoch} — ${s.ok ? 'ok' : 'FAIL'}`);
  }
  if (pinThrough) {
    const daily = await server.ssrLoadModule('/src/engine/daily.ts');
    if (!daily.isDailyId(pinThrough)) throw new Error(`--pin-through needs a YYYY-MM-DD date, got '${pinThrough}'`);
    const pins = {};
    for (let i = daily.dayIndex(SCHEDULE.epoch); i <= daily.dayIndex(pinThrough); i++) {
      const id = daily.dailyIdFor(new Date(i * 86_400_000));
      if (!SCHEDULE.pinned[id]) pins[id] = daily.dayIdFor(id);
    }
    console.log(`pinned entries to add for ${SCHEDULE.epoch}..${pinThrough} (${Object.keys(pins).length} new):`);
    console.log(JSON.stringify(pins, null, 2));
  }
  console.log(failed ? `✗ ${failed} problem group(s)` : `✓ ${ids.length} day(s) valid`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await server.close();
}
