/**
 * A D1Like over real SQLite (node:sqlite, in memory) running the real migrations, which also counts rows written the
 * way D1 bills them (salvaged from the previous Worker's cost harness).
 *
 * D1's rule (developers.cloudflare.com/d1/platform/pricing): every INSERT, UPDATE and DELETE counts the rows it
 * writes, and "indexes will add an additional written row when writes include the indexed column". So each affected
 * row costs 1 for the table's own b-tree plus 1 for every other index b-tree the write touches: INSERT and DELETE
 * touch every index; UPDATE only indexes containing an updated column; a WITHOUT ROWID table's primary key is the table.
 *
 * node:sqlite ships unflagged from Node 22.13 / 23.4. Node built-ins are loaded with computed specifiers so this file
 * type-checks without Node types (the Worker and the app configs both include it).
 */
import type { D1Like, D1StatementLike } from '../src/env';

interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export const MIGRATIONS = ['0001_cricket_core.sql', '0002_social.sql', '0003_top100_highlights.sql', '0004_missed_balls.sql', '0005_attempt_ids.sql', '0006_shared_matches.sql', '0007_invite_codes_share_moments.sql', '0008_moderation.sql'];

export interface WriteRecord {
  sql: string;
  table: string;
  kind: 'insert' | 'update' | 'delete';
  rows: number;
  written: number;
}

function topLevelSplit(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Columns assigned in an UPDATE … SET … or ON CONFLICT … DO UPDATE SET … clause. */
export function updatedColumns(sql: string): string[] {
  const m = /SET\s+([\s\S]+?)(?:\s+WHERE\s|\s+RETURNING\s|$)/i.exec(sql);
  if (!m) return [];
  return topLevelSplit(m[1]).map((part) => part.split('=')[0].trim().toLowerCase());
}

async function nodeModule<T>(name: string): Promise<T> {
  const specifier = `node:${name}`;
  return (await import(/* @vite-ignore */ specifier)) as T;
}

/** The migrations directory: next to this module when it is loaded from a file, else under the working directory. */
async function migrationsDir(): Promise<string> {
  const fs = await nodeModule<{ existsSync(path: string): boolean }>('fs');
  const candidates: string[] = [];
  if (import.meta.url.startsWith('file:')) candidates.push(decodeURIComponent(new URL('../migrations/', import.meta.url).pathname));
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd();
  if (cwd) candidates.push(`${cwd}/backend/migrations/`, `${cwd}/migrations/`);
  const found = candidates.find((c) => fs.existsSync(`${c}${MIGRATIONS[0]}`));
  if (!found) throw new Error(`backend migrations not found (looked in ${candidates.join(', ')})`);
  return found;
}

export async function migrationSql(files = MIGRATIONS): Promise<string[]> {
  const fs = await nodeModule<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');
  const dir = await migrationsDir();
  return files.map((f) => fs.readFileSync(`${dir}${f}`, 'utf8'));
}

export class SqliteD1 implements D1Like {
  log: WriteRecord[] = [];
  private indexes = new Map<string, Array<{ name: string; columns: string[] }>>();

  private constructor(readonly db: SqliteDatabase) {}

  static async create(files = MIGRATIONS): Promise<SqliteD1> {
    const { DatabaseSync } = await nodeModule<{ DatabaseSync: new (path: string) => SqliteDatabase }>('sqlite');
    const d1 = new SqliteD1(new DatabaseSync(':memory:'));
    for (const sql of await migrationSql(files)) d1.db.exec(sql);
    return d1;
  }

  close(): void {
    this.db.close();
  }

  /** Index b-trees separate from the table's own b-tree. */
  separateIndexes(table: string): Array<{ name: string; columns: string[] }> {
    const cached = this.indexes.get(table);
    if (cached) return cached;
    const withoutRowid = Boolean((this.db.prepare("SELECT sql LIKE '%WITHOUT ROWID%' AS w FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { w: number } | undefined)?.w);
    const list = this.db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; origin: string }>;
    const out = list
      .filter((ix) => !(withoutRowid && ix.origin === 'pk'))
      .map((ix) => ({ name: ix.name, columns: (this.db.prepare(`PRAGMA index_info(${ix.name})`).all() as Array<{ name: string }>).map((c) => c.name.toLowerCase()) }));
    this.indexes.set(table, out);
    return out;
  }

  costPerRow(table: string, kind: WriteRecord['kind'], sql: string): number {
    const ix = this.separateIndexes(table);
    if (kind !== 'update') return 1 + ix.length;
    const cols = new Set(updatedColumns(sql));
    return 1 + ix.filter((i) => i.columns.some((c) => cols.has(c))).length;
  }

  get totalWritten(): number {
    return this.log.reduce((n, r) => n + r.written, 0);
  }

  private count(table: string): number {
    return Number((this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  }

  private totalChanges(): number {
    return Number((this.db.prepare('SELECT total_changes() AS c').get() as { c: number }).c);
  }

  /** Rows written by triggers during `run` (D1 bills them like any other written row). */
  private withTriggers<T>(sql: string, run: () => { changes: number; result: T }): { changes: number; result: T } {
    const before = this.totalChanges();
    const out = run();
    const extra = this.totalChanges() - before - out.changes;
    if (extra > 0) this.log.push({ sql, table: '(triggers)', kind: 'update', rows: extra, written: extra });
    return out;
  }

  private record<T>(sql: string, inner: () => { changes: number; result: T }): T {
    const run = () => this.withTriggers(sql, inner);
    const m = /^\s*(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i.exec(sql);
    if (!m) return run().result;
    const table = m[2];
    const verb = m[1].toUpperCase();
    if (verb.startsWith('INSERT')) {
      const before = this.count(table);
      const { changes, result } = run();
      const inserted = this.count(table) - before;
      const updated = Math.max(0, changes - inserted);
      if (inserted > 0) this.log.push({ sql, table, kind: 'insert', rows: inserted, written: inserted * this.costPerRow(table, 'insert', sql) });
      if (updated > 0) this.log.push({ sql, table, kind: 'update', rows: updated, written: updated * this.costPerRow(table, 'update', sql) });
      return result;
    }
    const kind = verb === 'UPDATE' ? 'update' : 'delete';
    const { changes, result } = run();
    if (changes > 0) this.log.push({ sql, table, kind, rows: changes, written: changes * this.costPerRow(table, kind, sql) });
    return result;
  }

  prepare(sql: string): D1StatementLike {
    let params: unknown[] = [];
    const values = () =>
      params.map((v) => {
        if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined is not a supported bind value');
        return typeof v === 'boolean' ? Number(v) : v;
      });
    const changes = () => Number((this.db.prepare('SELECT changes() AS c').get() as { c: number }).c);
    const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
    const stmt: D1StatementLike & { sql: string; params: () => unknown[] } = {
      sql,
      params: () => params,
      bind: (...v: unknown[]) => {
        params = v;
        return stmt;
      },
      first: async <T>() => this.record(sql, () => {
        const row = this.db.prepare(sql).get(...values());
        return { changes: isWrite ? changes() : 0, result: (row ?? null) as T | null };
      }),
      all: async <T>() => this.record(sql, () => {
        const rows = this.db.prepare(sql).all(...values());
        return { changes: isWrite ? changes() : 0, result: { results: rows as T[] } };
      }),
      run: async () => this.record(sql, () => {
        const r = this.db.prepare(sql).run(...values());
        return { changes: Number(r.changes), result: { meta: { changes: Number(r.changes) } } };
      }),
    };
    return stmt;
  }

  async batch(statements: D1StatementLike[]): Promise<Array<{ results?: unknown[]; meta?: { changes?: number } }>> {
    this.db.exec('BEGIN');
    try {
      const out: Array<{ results?: unknown[]; meta?: { changes?: number } }> = [];
      for (const s of statements) {
        if (/^\s*(INSERT|UPDATE|DELETE)/i.test((s as unknown as { sql: string }).sql) && !/RETURNING/i.test((s as unknown as { sql: string }).sql)) out.push(await s.run());
        else out.push(await s.all());
      }
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
