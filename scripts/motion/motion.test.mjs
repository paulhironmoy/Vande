/**
 * Shipped motion packs (MOTION-SPEC §4, §9, §10): the committed bytes are exactly what the sources build (both the
 * web and the Unity copy), the build is deterministic, every pack is within its byte budget, and every clip in the
 * MOTION-owned packs passes the stated naturalness gates and joint limits on its decoded bytes.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BUDGETS, PENDING_FIX as PENDING, UNITY_DIR, WEB_DIR, buildPack, listPacks, unityMeta } from './export.mjs';
import { EXPLOSIVE, GROUND_STEP_REPORT_ONLY, measurePack } from './metrics.mjs';
import { parsePack } from './vmp.ts';

/**
 * Every pack is gated by default (lead ruling, 2026-11-04): a pack that fails the naturalness or joint-limit gates
 * never ships. PENDING_FIX lists the only packs temporarily exempt while their owner fixes them; each is reported as
 * a TODO, never silently passed. Remove a pack from it as soon as its owner reports a passing build.
 */
const PENDING_FIX = new Set(PENDING);
const packs = listPacks();

test('the explosive class is an explicit, reasoned list (lead-approved, 650 deg/s per frame)', () => {
  for (const [id, e] of Object.entries(EXPLOSIVE)) {
    assert.ok(e.reason && /^(legs|legs\+arms)$/.test(e.limbs), `${id} needs limbs and a reason`);
    console.log(`explosive: ${id} [${e.limbs}] ${e.reason}`);
  }
});

test('the ground-step report-only list is explicit and reasoned (lead-approved)', () => {
  for (const [id, reason] of Object.entries(GROUND_STEP_REPORT_ONLY)) {
    assert.ok(typeof reason === 'string' && reason.length > 10, `${id} needs a reason`);
    console.log(`ground step report-only: ${id}: ${reason}`);
  }
});

test('there are packs to check', () => {
  assert.ok(packs.includes('locomotion'), 'locomotion sources present');
});

for (const pack of packs) {
  test(`${pack}: committed web and Unity bytes equal a fresh, deterministic build`, () => {
    const a = buildPack(pack);
    const b = buildPack(pack);
    assert.deepEqual(Buffer.from(a), Buffer.from(b), 'two builds are byte-identical');
    const web = join(WEB_DIR, `${pack}.vmp`);
    const uni = join(UNITY_DIR, `${pack}.bytes`);
    assert.ok(existsSync(web), `${web} exists`);
    assert.ok(Buffer.from(readFileSync(web)).equals(Buffer.from(a)), `${pack}.vmp is stale: run node scripts/motion/export.mjs --pack ${pack}`);
    assert.ok(Buffer.from(readFileSync(uni)).equals(Buffer.from(a)), `${pack}.bytes is stale`);
    assert.equal(readFileSync(`${uni}.meta`, 'utf8'), unityMeta(pack, a));
  });

  test(`${pack}: within its byte budget and decodes strictly`, () => {
    const bytes = readFileSync(join(WEB_DIR, `${pack}.vmp`));
    const budget = BUDGETS[pack];
    assert.ok(budget, `${pack} has a budget in BUDGETS`);
    assert.ok(bytes.length <= budget, `${pack}: ${bytes.length} B > ${budget} B`);
    const p = parsePack(bytes);
    assert.ok(p.clips.size > 0);
  });

  if (PENDING_FIX.has(pack)) test.todo(`${pack}: naturalness gates PENDING its owner's fix pass (not certified)`);
  else
    test(`${pack}: every clip passes the naturalness gates and joint limits (decoded, 60 Hz)`, () => {
      const rows = measurePack(readFileSync(join(WEB_DIR, `${pack}.vmp`)));
      const failing = rows.filter((r) => !r.passAll).map((r) => `${r.clip}: ${Object.entries(r.pass).filter(([, v]) => !v).map(([k]) => k).join(',')}`);
      assert.deepEqual(failing, []);
      for (const r of rows) {
        assert.equal(r.jointViolations, 0, `${r.clip} joint limits`);
        assert.ok(r.footSlideM < 0.02, `${r.clip} foot slide ${r.footSlideM}`);
      }
    });
}
