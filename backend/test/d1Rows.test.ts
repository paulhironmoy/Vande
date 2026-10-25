// @vitest-environment node
/**
 * D1 rows written per operation, measured by running the real Worker against the real migrations in SQLite
 * (backend/test/d1-sqlite.ts applies D1's billing rule). Prints the tables used in docs/COST.md:
 *
 *   npx vitest run backend/test/d1Rows.test.ts --silent=false
 *
 * Scenario per configuration: 50 players on 50 different networks each do the operation within one minute, then the
 * daily cleanup runs after the retention. Totals are divided by 50, so shared global buckets are amortised.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLEANUP_MAX_QUERIES } from '../src/contract';
import { handle, scheduled, type Env } from '../src/index';
import { DAY_MS, bucketKey, checkRateLimit, pruneBudget, pruneByCursor, pruneRateBuckets, type RateLimitBinding } from '../src/ratelimit';
import { SQL } from '../src/sql';
import { __resetSigningKeyForTests } from '../src/signing';
import { FIXTURE_DEADLINE } from './liteFixtures';
import type { SqliteD1 as SqliteD1Type, WriteRecord } from './d1-sqlite';

/**
 * node:sqlite ships unflagged from Node 22.13 / 23.4 (CI uses Node 22). On older Node these measurements are skipped
 * rather than failing the suite; they only document the numbers behind docs/COST.md.
 */
const sqlite: typeof import('./d1-sqlite') | null = await import('./d1-sqlite').catch(() => null);
const describeIfSqlite = sqlite ? describe : describe.skip;
const SqliteD1 = (sqlite?.SqliteD1 ?? class {}) as typeof import('./d1-sqlite').SqliteD1;
const MIGRATIONS = (sqlite?.MIGRATIONS ?? []) as typeof import('./d1-sqlite').MIGRATIONS;
type SqliteD1 = SqliteD1Type;
import { liteContentVersion } from '@/community/liteDareProtocol';

const NOW = new Date('2026-10-26T09:30:00Z');
const ORIGIN = 'https://paulhironmoy.github.io';
const PLAYERS = 50;
const allow: RateLimitBinding = { limit: async () => ({ success: true }) };

async function freshEnv(over: Partial<Env>): Promise<{ env: Env; db: SqliteD1 }> {
  __resetSigningKeyForTests();
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey));
  const db = new SqliteD1();
  return { db, env: { DB: db, ALLOWED_ORIGINS: ORIGIN, MIN_COHORT: '25', RATE_SALT: 'salt', DARE_SIGNING_KEY: jwk, RATE_LIMIT_DARES_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_READS_PER_MINUTE: '1000', ...over } };
}

const post = (path: string, body: unknown, ip: string) =>
  new Request(`https://api.example${path}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
const ipOf = (i: number) => `2001:db8:${(i + 1).toString(16)}::1`;
const deviceOf = (i: number) => (i + 16).toString(16).padStart(2, '0').repeat(32);
const dare = { seed: 42, path: '', step: 'd0', deadline: FIXTURE_DEADLINE };

interface Phases {
  [phase: string]: number;
}

function sum(log: WriteRecord[], from: number, to = log.length): number {
  return log.slice(from, to).reduce((n, r) => n + r.written, 0);
}

function byTable(log: WriteRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of log) out[`${r.table}.${r.kind}`] = (out[`${r.table}.${r.kind}`] ?? 0) + r.written;
  return out;
}

/** One answered dare per player: start, grade, then the cleanup after 8 days. Rows per answered dare by phase. */
async function answeredDares(over: Partial<Env>): Promise<{ phases: Phases; tables: Record<string, number> }> {
  const { env, db } = await freshEnv(over);
  const ids: string[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const r = await handle(post('/v1/lite/attempts', { v: 1, contentVersion: liteContentVersion(), dare, deviceKey: deviceOf(i), nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' } }, ipOf(i)), env, { now: () => NOW });
    expect(r.status).toBe(201);
    ids.push(((await r.json()) as { attemptId: string }).attemptId);
  }
  const afterStart = db.log.length;
  for (let i = 0; i < PLAYERS; i++) {
    const r = await handle(post(`/v1/lite/attempts/${ids[i]}/grade`, { v: 1, dare, deviceKey: deviceOf(i), twistAnswer: null }, ipOf(i)), env, { now: () => NOW });
    expect(r.status).toBe(200);
  }
  const afterGrade = db.log.length;
  await scheduled(env, new Date(NOW.getTime() + 8 * 86400000));
  // The goal row itself is removed after 180 days.
  await scheduled(env, new Date(NOW.getTime() + 181 * 86400000));
  const per = (n: number) => Math.round((n / PLAYERS) * 100) / 100;
  return {
    phases: { start: per(sum(db.log, 0, afterStart)), grade: per(sum(db.log, afterStart, afterGrade)), cleanup: per(sum(db.log, afterGrade)), total: per(db.totalWritten) },
    tables: Object.fromEntries(Object.entries(byTable(db.log)).map(([k, v]) => [k, per(v)])),
  };
}

/** One official daily result per player, then the cleanup after the 180-day retention. Rows per result. */
async function dailyResults(over: Partial<Env>): Promise<{ phases: Phases; tables: Record<string, number> }> {
  const { env, db } = await freshEnv(over);
  for (let i = 0; i < PLAYERS; i++) {
    const body = { v: 1, dailyId: '2026-10-26', contentVersion: 'daily-1', submissionId: (i + 256).toString(16).padStart(32, 'a'), score: 60, outcome: 'resilient', fingerprint: 'DESDE', mode: 'simple', appVersion: '1.0.0', platform: 'web' };
    const r = await handle(post('/v1/daily/2026-10-26/results', body, ipOf(i)), env, { now: () => NOW });
    expect(r.status).toBe(201);
  }
  const afterSubmit = db.log.length;
  await scheduled(env, new Date(NOW.getTime() + 181 * 86400000));
  const per = (n: number) => Math.round((n / PLAYERS) * 100) / 100;
  return { phases: { submit: per(sum(db.log, 0, afterSubmit)), cleanup: per(sum(db.log, afterSubmit)), total: per(db.totalWritten) }, tables: Object.fromEntries(Object.entries(byTable(db.log)).map(([k, v]) => [k, per(v)])) };
}

/** Uncached reads (stats or goal), one per player. Rows written per read, including the bucket cleanup. */
async function reads(path: string, over: Partial<Env>): Promise<number> {
  const { env, db } = await freshEnv(over);
  for (let i = 0; i < PLAYERS; i++) {
    const r = await handle(new Request(`https://api.example${path}`, { headers: { origin: ORIGIN, 'cf-connecting-ip': ipOf(i) } }), env, { now: () => NOW });
    expect(r.status).toBe(200);
  }
  await scheduled(env, new Date(NOW.getTime() + 2 * 86400000));
  return Math.round((db.totalWritten / PLAYERS) * 100) / 100;
}

describeIfSqlite('D1 rows written, measured on the real migrations', () => {
  it('costs per affected row for every table (old 0001–0003 schema vs current)', () => {
    const old = new SqliteD1(MIGRATIONS.slice(0, 3));
    const cur = new SqliteD1();
    const rows: string[] = [];
    const cost = (db: SqliteD1, table: string, kind: 'insert' | 'update' | 'delete', sql = '') => db.costPerRow(table, kind, sql);
    for (const [table, upd] of [
      ['lite_attempts', 'UPDATE lite_attempts SET twist_answer = ?4, outcome = ?5, sig = ?6, graded_hour = ?7 WHERE x'],
      ['rate_buckets', 'INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1 RETURNING count'],
      ['lite_goal', 'INSERT INTO lite_goal (day) VALUES (?1) ON CONFLICT(day) DO UPDATE SET answers = answers + 1, best = best + ?2, updated_at = ?3'],
      ['daily_results', ''],
      ['daily_stats', 'INSERT INTO daily_stats (daily_id) VALUES (?1) ON CONFLICT(daily_id, content_version) DO UPDATE SET count = count + 1, score_sum = score_sum + ?3, bands_json = json_set(bands_json, ?9, 1), updated_at = ?8'],
    ] as const) {
      rows.push(`${table.padEnd(14)} insert ${cost(old, table, 'insert')} -> ${cost(cur, table, 'insert')}   update ${upd ? cost(old, table, 'update', upd) : '-'} -> ${upd ? cost(cur, table, 'update', upd) : '-'}   delete ${cost(old, table, 'delete')} -> ${cost(cur, table, 'delete')}`);
    }
    console.info(`[d1 rows per affected row: old -> current]\n${rows.join('\n')}`);
    expect(cost(cur, 'lite_attempts', 'insert')).toBe(1);
    expect(cost(cur, 'lite_attempts', 'delete')).toBe(1);
    expect(cost(cur, 'rate_buckets', 'insert')).toBe(1);
    expect(cost(cur, 'rate_buckets', 'delete')).toBe(1);
    expect(cost(cur, 'lite_goal', 'insert')).toBe(1);
    expect(cost(old, 'lite_attempts', 'insert')).toBe(4); // table + attempt_id autoindex + UNIQUE pair + created_at index
    expect(cost(old, 'rate_buckets', 'insert')).toBe(3); // table + bucket_key autoindex + window index
    expect(cost(cur, 'daily_results', 'insert')).toBe(4); // unchanged on purpose (out of scope)
    expect(cost(cur, 'daily_stats', 'insert')).toBe(2);
  });

  it('per answered dare, per daily result and per uncached read, in every configuration', async () => {
    const tModeBindings = await answeredDares({ RL_DARE: allow, RL_GLOBAL: allow, RL_READ: allow });
    const tModeFallback = await answeredDares({});
    const vModeBindings = await answeredDares({ LITE_VERIFY_REPLAY: '1', RL_DARE: allow, RL_GLOBAL: allow });
    const vModeFallback = await answeredDares({ LITE_VERIFY_REPLAY: '1' });
    const resultBindings = await dailyResults({ RL_WRITE: allow, RL_GLOBAL: allow });
    const resultFallback = await dailyResults({});
    const statsBindings = await reads('/v1/daily/2026-10-26/stats?cv=daily-1', { RL_READ: allow, RL_GLOBAL: allow });
    const statsFallback = await reads('/v1/daily/2026-10-26/stats?cv=daily-1', {});
    const goalOff = await reads('/v1/lite/goal/2026-10-26', {});
    const goalOnFallback = await reads('/v1/lite/goal/2026-10-26', { LITE_VERIFY_REPLAY: '1' });
    const show = (name: string, r: { phases: Phases; tables: Record<string, number> }) => `${name.padEnd(36)} ${JSON.stringify(r.phases)}\n${' '.repeat(37)}${JSON.stringify(r.tables)}`;
    console.info(
      [
        '[d1 rows written per operation, including the deletes the cleanup does later]',
        show('answered dare, default (t), bindings', tModeBindings),
        show('answered dare, default (t), D1 limits', tModeFallback),
        show('answered dare, replay (v), bindings', vModeBindings),
        show('answered dare, replay (v), D1 limits', vModeFallback),
        show('daily result, bindings', resultBindings),
        show('daily result, D1 limits', resultFallback),
        `uncached stats read: bindings ${statsBindings}, D1 limits ${statsFallback}`,
        `goal read: off (default) ${goalOff}, on with D1 limits ${goalOnFallback}`,
      ].join('\n'),
    );
    // Locks the numbers docs/COST.md uses; a schema or statement change that writes more fails here.
    expect(tModeBindings.phases).toEqual({ start: 1, grade: 1, cleanup: 1, total: 3 });
    expect(tModeFallback.phases).toEqual({ start: 3, grade: 3, cleanup: 2.02, total: 8.02 });
    expect(vModeBindings.phases).toEqual({ start: 1, grade: 3, cleanup: 2.02, total: 6.02 });
    expect(vModeFallback.phases).toEqual({ start: 3, grade: 5, cleanup: 3.04, total: 11.04 });
    expect(resultBindings.phases).toEqual({ submit: 5.02, cleanup: 4.04, total: 9.06 });
    expect(resultFallback.phases).toEqual({ submit: 7.02, cleanup: 5.06, total: 12.08 });
    expect(statsBindings).toBe(0);
    expect(goalOff).toBe(0);
    expect(statsFallback).toBeCloseTo(3.02, 2);
    expect(goalOnFallback).toBeCloseTo(3.02, 2);
  }, 120_000);
});

describeIfSqlite('cleanup on the real migrations', () => {
  const plan = (db: SqliteD1, sql: string) => (db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');

  it('seeks by key or index on the growing tables instead of scanning them for every batch', () => {
    const db = new SqliteD1();
    const plans = { buckets: plan(db, SQL.pruneBuckets), results: plan(db, SQL.pruneResults), attempts: plan(db, SQL.pruneLiteAttempts), goal: plan(db, SQL.pruneLiteGoal) };
    console.info(`[cleanup query plans]\n${Object.entries(plans).map(([k, v]) => `${k.padEnd(9)} ${v}`).join('\n')}`);
    expect(plans.buckets).toContain('SEARCH rate_buckets USING PRIMARY KEY (bucket_key<?)');
    expect(plans.results).toContain('USING COVERING INDEX idx_daily_results_received (received_hour<?)');
    expect(plans.attempts).toContain('SEARCH lite_attempts USING PRIMARY KEY (dare_key>?)');
    expect(plans.goal).toContain('SEARCH lite_goal USING PRIMARY KEY (day<?)');
    for (const p of Object.values(plans)) expect(p).not.toMatch(/\bSCAN (rate_buckets|daily_results|lite_attempts|lite_goal)\b/);
  });

  it('walks lite_attempts with a cursor across batch boundaries and stops at the budget', async () => {
    const db = new SqliteD1();
    const insert = db.db.prepare(
      "INSERT INTO lite_attempts (dare_key, device_key, attempt_id, seed, path, step, deadline, nonce, answer_path, points, best, kind, twist_id, marker, created_hour) VALUES (?, ?, 'a', 1, '', 'd0', 0, 'n', '', 0, 0, 'protect', 't0', 't', ?)",
    );
    // 40 dares answered on 3 devices each; the middle device answered recently and must stay.
    for (let d = 0; d < 40; d++) for (let v = 0; v < 3; v++) insert.run(`dare${String(d).padStart(2, '0')}`, `dev${v}`, v === 1 ? '2026-10-25T09:00:00.000Z' : '2026-10-01T09:00:00.000Z');
    const cutoff = '2026-10-19T09:00:00.000Z';
    const tight = { left: 3, exhausted: false };
    expect(await pruneByCursor(db, SQL.pruneLiteAttempts, cutoff, tight, 7)).toBe(21);
    expect(tight).toEqual({ left: 0, exhausted: true });
    // The next run finishes: 59 rows in batches of 7 is 8 full batches and a short one.
    const budget = pruneBudget();
    expect(await pruneByCursor(db, SQL.pruneLiteAttempts, cutoff, budget, 7)).toBe(59);
    expect(budget).toEqual({ left: DEFAULT_CLEANUP_MAX_QUERIES - 9, exhausted: false });
    expect(db.db.prepare('SELECT device_key, count(*) AS n FROM lite_attempts GROUP BY device_key').all()).toEqual([{ device_key: 'dev1', n: 40 }]);
    expect(db.log.filter((r) => r.kind === 'delete').reduce((n, r) => n + r.written, 0)).toBe(80);
  });

  it('orders bucket keys by window and removes only windows older than 24 hours', async () => {
    const db = new SqliteD1();
    const day = Date.UTC(2026, 9, 26);
    const key = 'v4:198.51.100.7';
    const times = [day - 2 * DAY_MS, day - 23 * 3600_000, day];
    const keys = await Promise.all(times.map((t) => bucketKey(key, 'salt', Math.floor(t / 60_000) * 60_000)));
    expect([...keys].sort()).toEqual(keys);
    expect(keys.join()).not.toContain('198.51');
    for (const t of times) await checkRateLimit(db, key, 'salt', 30, t);
    // The goal cap's bucket for the previous UTC day stays until that day is more than 24 hours old.
    await checkRateLimit(db, key, 'salt', 3, day - 3600_000, 'goal', DAY_MS);
    const windows = () => (db.db.prepare('SELECT window_start FROM rate_buckets ORDER BY bucket_key').all() as { window_start: number }[]).map((r) => r.window_start);
    expect(await pruneRateBuckets(db, day)).toBe(1);
    expect(windows()).toEqual([day - DAY_MS, times[1], day]);
    expect(await pruneRateBuckets(db, day + 60_000)).toBe(1);
    expect(windows()).toEqual([times[1], day]);
  });
});
