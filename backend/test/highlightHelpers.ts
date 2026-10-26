/** Helpers for the Top 100 and highlight pipeline tests: duels, the cutoff, the signed render client and the admin. */
import { expect } from 'vitest';
import type { ConsentRecord, HighlightJob, Visibility } from '@/contracts';
import type { LocalBackend } from '../local/harness';
import { DAILY_CUTOFF_CRON } from '../src/ops/cron';
import { SWEEP_CRON } from '../src/highlights/sweeper';
import { parseRenderKey, sha256Hex, signRequest } from '../../render-service/src/signing';
import { API, ORIGIN, Player, advanceTo } from './helpers';

/** First IST midnight after T0 (2026-10-26 12:00 IST): the cutoff of 2026-10-26. */
export const CUTOFF_1 = Date.UTC(2026, 9, 26, 18, 30);
export const DAY1 = '2026-10-26';

/** A complete duel; offsets far from 0 so the timing audit never flags it (|error| > 3 ms). */
export async function playDuel(home: Player, away: Player, offsets: [number, number] = [40, 120], attributionCode?: string): Promise<string> {
  const created = await home.call<{ matchId: string; inviteToken: string; inviteUrl: string }>('POST', '/v1/duels', { conditions: { pitch: 'hard', weather: 'clear' }, ...(attributionCode ? { attributionCode } : {}) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const matchId = created.body.matchId;
  expect((await away.call('POST', `/v1/invites/${created.body.inviteToken}/accept`)).status).toBe(200);
  expect((await home.lock(matchId, 1)).status).toBe(200);
  expect((await away.lock(matchId, 2)).status).toBe(200);
  await home.batInnings(matchId, offsets[0]);
  await away.batInnings(matchId, offsets[1]);
  expect((await home.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(200);
  await home.b.idle();
  return matchId;
}

export async function players(b: LocalBackend, n: number, prefix = 'Player'): Promise<Player[]> {
  const out: Player[] = [];
  const names = ['Swift Tiger', 'Calm Cobra', 'Bold Falcon', 'Lucky Panther', 'Golden Eagle', 'Silent Leopard', 'Rapid Rhino', 'Brave Lion'];
  for (let i = 0; i < n; i++) {
    const p = new Player(b);
    await p.signup(names[i] ?? `${prefix} ${i}`);
    out.push(p);
  }
  return out;
}

/** Moves past 00:00 IST and runs the cutoff cron. */
export async function freeze(b: LocalBackend, at = CUTOFF_1 + 60_000): Promise<void> {
  await advanceTo(b, at);
  await b.scheduled(DAILY_CUTOFF_CRON);
}

export async function sweep(b: LocalBackend): Promise<void> {
  await b.scheduled(SWEEP_CRON);
}

export async function mine(p: Player): Promise<HighlightJob[]> {
  const r = await p.call<HighlightJob[]>('GET', '/v1/highlights/mine');
  expect(r.status).toBe(200);
  return r.body;
}

export function consent(p: Player, jobId: string, decision: 'granted' | 'declined', visibility: Visibility = 'public', adultConfirmed = true) {
  return p.call<ConsentRecord>('POST', `/v1/highlights/${jobId}/consent`, { decision, adultConfirmed, visibility });
}

export function row<T = Record<string, unknown>>(b: LocalBackend, sql: string, ...params: unknown[]): Promise<T | null> {
  return b.db.prepare(sql).bind(...params).first<T>();
}

/** The render service as the Worker sees it: signed with the harness RENDER_KEYS entry. */
export class RenderClient {
  constructor(readonly b: LocalBackend) {}

  private key() {
    return parseRenderKey(this.b.secrets.RENDER_KEYS);
  }

  async send(method: string, path: string, body?: Uint8Array | string, extra: Record<string, string> = {}, sign: { sha?: string; now?: number; nonce?: string } = {}): Promise<{ status: number; body: unknown }> {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : (body ?? new Uint8Array());
    const sha = sign.sha ?? (await sha256Hex(bytes));
    const headers = { ...(await signRequest(this.key(), method, path, sha, sign.now ?? this.b.clock.now(), sign.nonce)), ...extra };
    const res = await this.b.fetch(`${API}${path}`, { method, headers, body: method === 'GET' ? undefined : (bytes as Uint8Array<ArrayBuffer>) });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* text */
    }
    return { status: res.status, body: parsed };
  }

  json(path: string, value: unknown) {
    return this.send('POST', path, JSON.stringify(value), { 'content-type': 'application/json' });
  }

  claim() {
    return this.json('/v1/internal/render/claim', {}) as Promise<{ status: number; body: { jobId: string; input: { jobId: string; log: { matchId: string } }; upload: { path: string } } }>;
  }

  async deliver(jobId: string, bytes = fakeMp4(64 * 1024)): Promise<{ status: number; body: unknown }> {
    const put = await this.send('PUT', `/v1/internal/render/jobs/${jobId}/video`, bytes, { 'content-type': 'video/mp4', 'content-length': String(bytes.byteLength) });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    return this.json(`/v1/internal/render/jobs/${jobId}/complete`, { sha256: await sha256Hex(bytes), bytes: bytes.byteLength, durationMs: 42_000, frames: 1260 });
  }
}

/** Bytes that stand in for an MP4 (the pipeline never decodes it). */
export function fakeMp4(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 255;
  return out;
}

export class Admin {
  constructor(readonly b: LocalBackend) {}

  call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    return new Player(this.b).call<T>(method, path, body, { token: null, idem: false, headers: { authorization: `Bearer ${this.b.secrets.ADMIN_TOKEN}`, ...headers } });
  }
}

export { ORIGIN };
