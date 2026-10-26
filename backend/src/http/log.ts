/**
 * Structured JSON logs. One line per request plus warnings. Logs carry the request id, the route PATTERN (never the
 * concrete path, which can hold invite tokens or ids), status, error code and duration; never addresses, tokens,
 * aliases, player ids, plans or inputs. See docs/SECURITY.md, "Logging".
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  evt: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface Logger {
  log(level: LogLevel, record: LogRecord): void;
}

/** Long runs of token-like characters are cut out of free text before it is logged. */
export function scrub(text: string, max = 160): string {
  return text.replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '[redacted]').slice(0, max);
}

export const consoleLogger: Logger = {
  log(level, record) {
    const line = JSON.stringify({ level, ...record });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
};

/** Collects records in memory (tests and the local harness). */
export class MemoryLogger implements Logger {
  records: Array<{ level: LogLevel } & LogRecord> = [];
  log(level: LogLevel, record: LogRecord): void {
    this.records.push({ level, ...record });
  }
}

const warnedOnce = new Set<string>();

/** Logs a configuration warning once per isolate. */
export function warnOnce(logger: Logger, key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  logger.log('warn', { evt: 'config', key, message });
}

export function __resetWarnOnceForTests(): void {
  warnedOnce.clear();
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** The client's x-request-id when well formed, otherwise a fresh random one (16 hex characters). */
export function requestIdFrom(request: Request): string {
  const given = request.headers.get('x-request-id');
  if (given && REQUEST_ID_RE.test(given)) return given;
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
