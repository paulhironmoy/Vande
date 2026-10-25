/** In-memory D1 stand-in that understands exactly the statements in backend/src/sql.ts. */
import type { D1Like, D1StatementLike } from '../src/d1';
import { SQL } from '../src/sql';

interface ResultRow {
  submission_id: string;
  daily_id: string;
  content_version: string;
  app_version: string;
  mode: string;
  score: number;
  band: string;
  outcome: string;
  fingerprint: string;
  strategy: string;
  received_hour: string;
}

interface StatsRowMem {
  count: number;
  score_sum: number;
  bands: Record<string, number>;
  outcomes: Record<string, number>;
  strategies: Record<string, number>;
  scores: Record<string, number>;
  updated_at: string;
}

interface AttemptMem {
  attempt_id: string;
  dare_key: string;
  device_key: string;
  seed: number;
  path: string;
  step: string;
  deadline: number;
  nonce: string;
  answer_path: string;
  points: number;
  best: number;
  kind: string;
  twist_id: string;
  marker: string;
  twist_answer: string | null;
  outcome: string | null;
  sig: string | null;
  created_at: number;
  graded_at: number | null;
}

/** `$."key"` → `key` (mirrors what json_set/json_extract would address). */
function keyOfPath(path: string): string {
  const m = /^\$\."(.*)"$/.exec(path);
  if (!m) throw new Error(`unsupported json path ${path}`);
  return m[1];
}

export class MemoryD1 implements D1Like {
  results = new Map<string, ResultRow>();
  buckets = new Map<string, { window_start: number; count: number }>();
  stats = new Map<string, StatsRowMem>();
  /** lite_attempts by attempt_id (UNIQUE dare_key + device_key enforced on insert). */
  attempts = new Map<string, AttemptMem>();
  /** lite_goal by day. */
  goal = new Map<string, { answers: number; best: number; updated_at: string }>();
  /** Statement counters so tests can prove the cheap path was taken. */
  calls: Record<string, number> = {};

  private count(sql: string): void {
    const name = (Object.keys(SQL) as (keyof typeof SQL)[]).find((k) => SQL[k] === sql) ?? 'unknown';
    this.calls[name] = (this.calls[name] ?? 0) + 1;
  }

  prepare(sql: string): D1StatementLike {
    const self = this;
    let params: unknown[] = [];
    const filtered = () => {
      const [dailyId, cv] = params as [string, string];
      return [...this.results.values()].filter((r) => r.daily_id === dailyId && (cv === '' || r.content_version === cv));
    };
    const group = (key: keyof ResultRow) => {
      const map = new Map<string, number>();
      for (const r of filtered()) map.set(String(r[key]), (map.get(String(r[key])) ?? 0) + 1);
      return [...map.entries()].map(([k, n]) => ({ key: k, n }));
    };
    const stmt: D1StatementLike = {
      bind(...values: unknown[]) {
        params = values;
        return stmt;
      },
      async first<T>() {
        self.count(sql);
        switch (sql) {
          case SQL.countForDay:
            return { n: filtered().length } as unknown as T;
          case SQL.statsRow: {
            const [dailyId, cv] = params as [string, string];
            const row = self.stats.get(`${dailyId}|${cv}`);
            if (!row) return null;
            return {
              count: row.count,
              score_sum: row.score_sum,
              bands_json: JSON.stringify(row.bands),
              outcomes_json: JSON.stringify(row.outcomes),
              strategies_json: JSON.stringify(row.strategies),
              scores_json: JSON.stringify(row.scores),
              updated_at: row.updated_at,
            } as unknown as T;
          }
          case SQL.liteAttemptByPair: {
            const [dareKey, deviceKey] = params as [string, string];
            const row = [...self.attempts.values()].find((a) => a.dare_key === dareKey && a.device_key === deviceKey);
            return (row ? { ...row } : null) as unknown as T;
          }
          case SQL.liteAttemptById: {
            const [id] = params as [string];
            const row = self.attempts.get(id);
            return (row ? { ...row } : null) as unknown as T;
          }
          case SQL.liteGoalRow: {
            const [day] = params as [string];
            const row = self.goal.get(day);
            return (row ? { day, ...row } : null) as unknown as T;
          }
          case SQL.bumpBucket: {
            const [key, windowStart] = params as [string, number];
            const existing = self.buckets.get(key);
            const count = (existing?.count ?? 0) + 1;
            self.buckets.set(key, { window_start: windowStart, count });
            return { count } as unknown as T;
          }
          default:
            throw new Error(`unsupported first(): ${sql}`);
        }
      },
      async all<T>() {
        self.count(sql);
        switch (sql) {
          case SQL.bandsForDay:
            return { results: group('band') as unknown as T[] };
          case SQL.outcomesForDay:
            return { results: group('outcome') as unknown as T[] };
          case SQL.strategiesForDay:
            return { results: group('strategy') as unknown as T[] };
          case SQL.scoresForDay:
            return { results: group('score') as unknown as T[] };
          default:
            throw new Error(`unsupported all(): ${sql}`);
        }
      },
      async run() {
        self.count(sql);
        switch (sql) {
          case SQL.insertResult: {
            const [submission_id, daily_id, content_version, app_version, mode, score, band, outcome, fingerprint, strategy, received_hour] = params as [string, string, string, string, string, number, string, string, string, string, string];
            if (self.results.has(submission_id)) return { meta: { changes: 0 } };
            self.results.set(submission_id, { submission_id, daily_id, content_version, app_version, mode, score, band, outcome, fingerprint, strategy, received_hour });
            return { meta: { changes: 1 } };
          }
          case SQL.upsertStats: {
            const [daily_id, content_version, score, bandKey, outcomeKey, strategyKey, scoreKey, updated_at, bandPath, outcomePath, strategyPath, scorePath] = params as [string, string, number, string, string, string, string, string, string, string, string, string];
            // The paths must address the same keys as the json_object() seeds.
            if (keyOfPath(bandPath) !== bandKey || keyOfPath(outcomePath) !== outcomeKey || keyOfPath(strategyPath) !== strategyKey || keyOfPath(scorePath) !== scoreKey) throw new Error('path/key mismatch');
            const k = `${daily_id}|${content_version}`;
            const row = self.stats.get(k) ?? { count: 0, score_sum: 0, bands: {}, outcomes: {}, strategies: {}, scores: {}, updated_at };
            row.count += 1;
            row.score_sum += score;
            row.bands[bandKey] = (row.bands[bandKey] ?? 0) + 1;
            row.outcomes[outcomeKey] = (row.outcomes[outcomeKey] ?? 0) + 1;
            row.strategies[strategyKey] = (row.strategies[strategyKey] ?? 0) + 1;
            row.scores[scoreKey] = (row.scores[scoreKey] ?? 0) + 1;
            row.updated_at = updated_at;
            self.stats.set(k, row);
            return { meta: { changes: 1 } };
          }
          case SQL.liteInsertAttempt: {
            const [attempt_id, dare_key, device_key, seed, path, step, deadline, nonce, answer_path, points, best, kind, twist_id, marker, created_at] = params as [
              string, string, string, number, string, string, number, string, string, number, number, string, string, string, number,
            ];
            if (self.attempts.has(attempt_id)) throw new Error('UNIQUE constraint failed: lite_attempts.attempt_id');
            if ([...self.attempts.values()].some((a) => a.dare_key === dare_key && a.device_key === device_key)) return { meta: { changes: 0 } };
            self.attempts.set(attempt_id, { attempt_id, dare_key, device_key, seed, path, step, deadline, nonce, answer_path, points, best, kind, twist_id, marker, twist_answer: null, outcome: null, sig: null, created_at, graded_at: null });
            return { meta: { changes: 1 } };
          }
          case SQL.liteGradeAttempt: {
            const [id, twist_answer, outcome, sig, graded_at] = params as [string, string, string, string, number];
            const row = self.attempts.get(id);
            if (!row || row.outcome !== null) return { meta: { changes: 0 } };
            Object.assign(row, { twist_answer, outcome, sig, graded_at });
            return { meta: { changes: 1 } };
          }
          case SQL.liteBumpGoal: {
            const [day, best, updated_at] = params as [string, number, string];
            const row = self.goal.get(day) ?? { answers: 0, best: 0, updated_at };
            row.answers += 1;
            row.best += best;
            row.updated_at = updated_at;
            self.goal.set(day, row);
            return { meta: { changes: 1 } };
          }
          case SQL.pruneLiteAttempts: {
            const [cutoff] = params as [number];
            let changes = 0;
            for (const [k, v] of self.attempts) if (v.created_at < cutoff) (self.attempts.delete(k), changes++);
            return { meta: { changes } };
          }
          case SQL.pruneLiteGoal: {
            const [cutoff] = params as [string];
            let changes = 0;
            for (const [k] of self.goal) if (k < cutoff) (self.goal.delete(k), changes++);
            return { meta: { changes } };
          }
          case SQL.pruneBuckets: {
            const [cutoff] = params as [number];
            let changes = 0;
            for (const [k, v] of self.buckets) if (v.window_start < cutoff) (self.buckets.delete(k), changes++);
            return { meta: { changes } };
          }
          case SQL.pruneResults: {
            const [cutoff] = params as [string];
            let changes = 0;
            for (const [k, v] of self.results) if (v.received_hour < cutoff) (self.results.delete(k), changes++);
            return { meta: { changes } };
          }
          case SQL.pruneStats: {
            const [cutoff] = params as [string];
            let changes = 0;
            for (const [k, v] of self.stats) if (v.updated_at < cutoff) (self.stats.delete(k), changes++);
            return { meta: { changes } };
          }
          default:
            throw new Error(`unsupported run(): ${sql}`);
        }
      },
    };
    return stmt;
  }
}

/** Minimal Cache API stub: stores responses by URL, counts hits and puts. */
export class MemoryCache {
  store = new Map<string, { status: number; body: string }>();
  hits = 0;
  puts = 0;
  async match(request: Request): Promise<Response | undefined> {
    const entry = this.store.get(request.url);
    if (!entry) return undefined;
    this.hits += 1;
    return new Response(entry.body, { status: entry.status });
  }
  async put(request: Request, response: Response): Promise<void> {
    this.puts += 1;
    this.store.set(request.url, { status: response.status, body: await response.text() });
  }
}
