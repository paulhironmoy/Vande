/**
 * A D1Like over real SQLite (node:sqlite) that counts rows written the way D1 bills them.
 *
 * D1's rule (developers.cloudflare.com/d1/platform/pricing): every INSERT, UPDATE and DELETE counts the rows it
 * writes, and "indexes will add an additional written row when writes include the indexed column". So each affected
 * row costs 1 for the table's own b-tree plus 1 for every other index b-tree the write touches:
 *   - INSERT and DELETE touch every index of the table;
 *   - UPDATE touches only indexes containing an updated column;
 *   - a rowid table with a TEXT primary key or a UNIQUE constraint has automatic indexes (separate b-trees);
 *   - a WITHOUT ROWID table is stored in its primary-key b-tree, so its primary key is not an extra index.
 * The schema comes from the real migrations (PRAGMA index_list / index_info); affected rows come from SQLite itself
 * (changes(), and row counts before and after an upsert to tell an insert from an update).
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Like, D1StatementLike } from '../src/d1';

export const MIGRATIONS = ['0001_init.sql', '0002_daily_stats.sql', '0003_lite_dares.sql', '0004_cheaper_writes.sql'];

interface IndexInfo {
  name: string;
  columns: string[];
}

export interface WriteRecord {
  sql: string;
  table: string;
  kind: 'insert' | 'update' | 'delete';
  rows: number;
  written: number;
}

/** Splits on commas that are not inside parentheses. */
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

export class SqliteD1 implements D1Like {
  db = new DatabaseSync(':memory:');
  log: WriteRecord[] = [];
  private indexes = new Map<string, IndexInfo[]>();

  constructor(migrations: string[] = MIGRATIONS, dir = 'backend/migrations') {
    for (const f of migrations) this.db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
  }

  /** Index b-trees that are separate from the table's own b-tree. */
  separateIndexes(table: string): IndexInfo[] {
    const cached = this.indexes.get(table);
    if (cached) return cached;
    const withoutRowid = Boolean(
      (this.db.prepare("SELECT sql LIKE '%WITHOUT ROWID%' AS w FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { w: number } | undefined)?.w,
    );
    const list = this.db.prepare(`PRAGMA index_list(${table})`).all() as { name: string; origin: string }[];
    const out = list
      .filter((ix) => !(withoutRowid && ix.origin === 'pk'))
      .map((ix) => ({ name: ix.name, columns: (this.db.prepare(`PRAGMA index_info(${ix.name})`).all() as { name: string }[]).map((c) => c.name.toLowerCase()) }));
    this.indexes.set(table, out);
    return out;
  }

  /** Rows one affected row costs: 1 for the table, plus each separate index the write touches. */
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

  private record(sql: string, run: () => { changes: number; result: unknown }): unknown {
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
    const self = this;
    let params: unknown[] = [];
    const values = () => params.map((v) => (typeof v === 'boolean' ? Number(v) : v)) as (string | number | null)[];
    const lastChanges = () => Number((self.db.prepare('SELECT changes() AS c').get() as { c: number }).c);
    const stmt: D1StatementLike = {
      bind(...v: unknown[]) {
        params = v;
        return stmt;
      },
      async first<T>() {
        const out = self.record(sql, () => {
          const row = self.db.prepare(sql).get(...values());
          return { changes: /RETURNING/i.test(sql) || /^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? lastChanges() : 0, result: row ?? null };
        });
        return (out ?? null) as T | null;
      },
      async all<T>() {
        // A DELETE … RETURNING read with all() still writes rows: count them like run() does.
        const out = self.record(sql, () => {
          const rows = self.db.prepare(sql).all(...values());
          return { changes: /^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? lastChanges() : 0, result: rows };
        });
        return { results: out as T[] };
      },
      async run() {
        const out = self.record(sql, () => {
          const r = self.db.prepare(sql).run(...values());
          return { changes: Number(r.changes), result: { meta: { changes: Number(r.changes) } } };
        });
        return out as { meta?: { changes?: number } };
      },
    };
    return stmt;
  }
}
