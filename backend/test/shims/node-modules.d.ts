/**
 * Minimal types for the two Node built-ins the D1 row-count test uses (backend/test/d1-sqlite.ts). The backend
 * tsconfig loads only the Workers types, not @types/node, so these are declared here for the test alone.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:sqlite' {
  export interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
