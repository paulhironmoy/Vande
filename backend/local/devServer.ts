/**
 * Local development server: the in-process backend (backend/local/harness.ts) behind a plain Node HTTP server, on the
 * real clock, with alarms and queues driven by timers. Started by `node backend/local/serve.mjs` (see
 * docs/INFRASTRUCTURE.md). Data lives in memory and is gone when the process stops. Development only.
 *
 * Extra local-only endpoint: POST /__dev/advance?ms=… moves the clock forward (try deadlines without waiting).
 */
import type { SealedSixEngineApi } from '@/contracts';
import type { EngineHelpers } from '../src/engines';
import { consoleLogger } from '../src/http/log';
import { createLocalBackend, type LocalBackend } from './harness';
import { realClock } from './memory';

interface NodeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
  on(event: 'data', cb: (chunk: Uint8Array) => void): void;
  on(event: 'end', cb: () => void): void;
  on(event: 'error', cb: (e: unknown) => void): void;
}
interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: Uint8Array | string): void;
}
interface NodeServer {
  listen(port: number, host: string, cb: () => void): void;
  close(cb: () => void): void;
}

export interface DevServer {
  url: string;
  backend: LocalBackend;
  close(): Promise<void>;
}

function readBody(req: NodeRequest): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.byteLength;
      }
      resolve(out);
    });
    req.on('error', reject);
  });
}

export async function startDevServer(opts: { engine: SealedSixEngineApi; helpers?: Partial<EngineHelpers>; port?: number; host?: string; engineLabel?: string; webOrigin?: string }): Promise<DevServer> {
  const port = opts.port ?? 8787;
  const host = opts.host ?? '127.0.0.1';
  const web = opts.webOrigin;
  const backend = await createLocalBackend({ engine: opts.engine, helpers: opts.helpers, clock: realClock(), logger: consoleLogger, webOrigin: web, vars: { VERIFY_REVEALS: '1', PUBLIC_API_ORIGIN: `http://${host}:${port}` } });
  const http = (await import(/* @vite-ignore */ `node:${'http'}`)) as { createServer(handler: (req: NodeRequest, res: NodeResponse) => void): NodeServer };
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${host}:${port}`);
        if (url.pathname === '/__dev/advance' && req.method === 'POST') {
          await backend.advance(Number(url.searchParams.get('ms') ?? '0'));
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ now: new Date(backend.clock.now()).toISOString() }));
          return;
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        headers.set('cf-connecting-ip', (req.socket.remoteAddress ?? '127.0.0.1').replace(/^::ffff:/, ''));
        const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : await readBody(req);
        const response = await backend.fetch(new Request(url, { method: req.method, headers, body: body && body.byteLength > 0 ? (body as Uint8Array<ArrayBuffer>) : undefined }));
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(new Uint8Array(await response.arrayBuffer()));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { code: 'unavailable', message: String((e as Error)?.message ?? e) } }));
      }
    })();
  });
  const alarms = setInterval(() => void backend.runAlarms().catch(() => undefined), 1_000);
  const queues = setInterval(() => void backend.drainQueues().catch(() => undefined), 2_000);
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const url = `http://${host}:${port}`;
  consoleLogger.log('info', { evt: 'dev_server', url, engine: opts.engineLabel ?? 'injected' });
  return {
    url,
    backend,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(alarms);
        clearInterval(queues);
        server.close(() => {
          backend.close();
          resolve();
        });
      }),
  };
}
