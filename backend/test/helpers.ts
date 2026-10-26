/** Test helpers: a local backend with the fake engine, and a small HTTP client that plays one player. */
import type { CupView, MatchView, NextBallResponse, RoomView, SessionTokens, ShotResponse } from '@/contracts';
import { createLocalBackend, type LocalBackend, type LocalBackendOptions } from '../local/harness';
import { fakeEngine, fakeHelpers, testPlan, testShot } from './fakeEngine';

export const ORIGIN = 'http://localhost:5173';
export const API = 'http://127.0.0.1:8787';
export const T0 = Date.UTC(2026, 9, 26, 6, 30);

export function backend(opts: LocalBackendOptions = {}): Promise<LocalBackend> {
  return createLocalBackend({ engine: fakeEngine, helpers: fakeHelpers, now: T0, ...opts });
}

export interface CallResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export interface CallOptions {
  /** Idempotency-Key: a fresh UUID by default for mutations, false to omit it, or a fixed value. */
  idem?: string | false;
  token?: string | null;
  ip?: string;
  headers?: Record<string, string>;
  raw?: string;
}

let ipSeq = 10;

export class Player {
  tokens: SessionTokens | null = null;
  readonly ip: string;
  constructor(
    readonly b: LocalBackend,
    ip?: string,
  ) {
    this.ip = ip ?? `198.51.100.${ipSeq++ % 250}`;
  }

  /** Like the app's client: an expired access token is refreshed once and the request retried. */
  async call<T = unknown>(method: string, path: string, body?: unknown, o: CallOptions = {}): Promise<CallResult<T>> {
    const r = await this.send<T>(method, path, body, o);
    if (r.status === 401 && o.token === undefined && this.tokens && !path.startsWith('/v1/auth/') && (await this.refresh())) return this.send<T>(method, path, body, o);
    return r;
  }

  async refresh(): Promise<boolean> {
    if (!this.tokens) return false;
    const r = await this.send<SessionTokens>('POST', '/v1/auth/refresh', { refreshToken: this.tokens.refreshToken }, { token: null });
    if (r.status !== 200) return false;
    this.tokens = r.body;
    return true;
  }

  private async send<T = unknown>(method: string, path: string, body?: unknown, o: CallOptions = {}): Promise<CallResult<T>> {
    const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': o.ip ?? this.ip, ...o.headers };
    const token = o.token === undefined ? this.tokens?.accessToken : o.token;
    if (token) headers.authorization = `Bearer ${token}`;
    if (method !== 'GET' && o.idem !== false) headers['idempotency-key'] = o.idem ?? crypto.randomUUID();
    let payload: string | undefined = o.raw;
    if (payload === undefined && body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined) headers['content-type'] = headers['content-type'] ?? 'application/json';
    const res = await this.b.fetch(`${API}${path}`, { method, headers, body: payload });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  async signup(alias?: string): Promise<SessionTokens> {
    const r = await this.call<SessionTokens>('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en', ...(alias ? { alias } : {}) });
    if (r.status !== 201) throw new Error(`signup failed ${r.status} ${JSON.stringify(r.body)}`);
    this.tokens = r.body;
    return r.body;
  }

  view(matchId: string) {
    return this.call<MatchView>('GET', `/v1/matches/${matchId}`);
  }

  lock(matchId: string, seed = 1, plan = testPlan(seed)) {
    return this.call<{ commitHash: string; sig: string; keyId: string }>('POST', `/v1/matches/${matchId}/lock`, { plan });
  }

  next(matchId: string, idem?: string) {
    return this.call<NextBallResponse>('POST', `/v1/matches/${matchId}/bat/next`, undefined, idem ? { idem } : {});
  }

  shot(matchId: string, ballToken: string, input: unknown, idem?: string) {
    return this.call<ShotResponse>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken, input }, idem ? { idem } : {});
  }

  /** Bats the whole innings with timed drives; returns every response. */
  async batInnings(matchId: string, offsetMs = 0): Promise<ShotResponse[]> {
    const out: ShotResponse[] = [];
    for (let i = 0; i < 10; i++) {
      const n = await this.next(matchId);
      if (n.status !== 200) break;
      const s = await this.shot(matchId, n.body.ballToken, testShot(n.body.delivery, offsetMs));
      if (s.status !== 200) throw new Error(`shot failed ${s.status} ${JSON.stringify(s.body)}`);
      out.push(s.body);
      if (s.body.inningsComplete) break;
    }
    return out;
  }
}

/** Creator and opponent with a created, accepted duel. */
export async function duel(b: LocalBackend): Promise<{ a: Player; c: Player; matchId: string; inviteToken: string }> {
  const a = new Player(b);
  const c = new Player(b);
  await a.signup('Swift Tiger');
  await c.signup('Calm Cobra');
  const created = await a.call<{ matchId: string; inviteToken: string; inviteUrl: string }>('POST', '/v1/duels', { conditions: { pitch: 'hard', weather: 'clear' } });
  if (created.status !== 201) throw new Error(`duel failed ${created.status} ${JSON.stringify(created.body)}`);
  const accepted = await c.call('POST', `/v1/invites/${created.body.inviteToken}/accept`);
  if (accepted.status !== 200) throw new Error(`accept failed ${accepted.status} ${JSON.stringify(accepted.body)}`);
  return { a, c, matchId: created.body.matchId, inviteToken: created.body.inviteToken };
}

/** Text of everything stored at rest for one match (plans must not appear in it). */
export function storedText(b: LocalBackend, matchId: string): string {
  const s = b.matches.storage(matchId);
  return JSON.stringify([...s.data.entries()].map(([k, v]) => [k, v instanceof Uint8Array ? `<${v.byteLength} bytes>` : v]));
}

// ---- Group Cups ----------------------------------------------------------------------------------------------------


export interface CupSetup {
  b: LocalBackend;
  players: Player[];
  cupId: string;
  inviteToken: string;
}

/** A cup created by players[0] and joined by the others (all before the start). */
export async function cup(b: LocalBackend, n: number, opts: { maxPlayers?: number; pace?: 'sprint' | 'daily' | 'weekend'; name?: string } = {}): Promise<CupSetup> {
  const players = Array.from({ length: n }, () => new Player(b));
  await players[0].signup('Cup Captain');
  const created = await players[0].call<{ cupId: string; inviteToken: string; inviteUrl: string }>('POST', '/v1/cups', { name: opts.name ?? 'Office Cup 2026', maxPlayers: opts.maxPlayers ?? Math.max(3, n), pace: opts.pace ?? 'sprint' });
  if (created.status !== 201) throw new Error(`cup failed ${created.status} ${JSON.stringify(created.body)}`);
  for (let i = 1; i < n; i++) {
    await players[i].signup();
    const r = await players[i].call('POST', `/v1/invites/${created.body.inviteToken}/accept`);
    if (r.status !== 200) throw new Error(`join failed ${r.status} ${JSON.stringify(r.body)}`);
  }
  return { b, players, cupId: created.body.cupId, inviteToken: created.body.inviteToken };
}

export async function cupView(p: Player, cupId: string): Promise<CupView> {
  const r = await p.call<CupView>('GET', `/v1/cups/${cupId}`);
  if (r.status !== 200) throw new Error(`cup view failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function roomView(p: Player, roomId: string): Promise<RoomView> {
  const r = await p.call<RoomView>('GET', `/v1/rooms/${roomId}`);
  if (r.status !== 200) throw new Error(`room view failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Moves the clock to `ms` (firing every alarm on the way). */
export async function advanceTo(b: LocalBackend, ms: number): Promise<void> {
  if (ms > b.clock.now()) await b.advance(ms - b.clock.now());
  await b.idle();
}

/**
 * Plays the open round: every player chosen by `locks` locks their fixture, then every player chosen by `bats`
 * bats it (the others are left to Auto Over / Auto XI at the deadlines).
 */
export async function playRound(players: Player[], cupId: string, opts: { locks?: (i: number) => boolean; bats?: (i: number) => boolean } = {}): Promise<void> {
  const locks = opts.locks ?? (() => true);
  const bats = opts.bats ?? locks;
  for (const [i, p] of players.entries()) {
    if (!locks(i)) continue;
    const v = await cupView(p, cupId);
    for (const t of v.myTasks.filter((x) => x.kind === 'lock')) {
      const r = await p.lock(t.matchId, i + 1);
      if (r.status !== 200) throw new Error(`lock failed ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
  await players[0].b.idle();
  for (const [i, p] of players.entries()) {
    if (!bats(i)) continue;
    const v = await cupView(p, cupId);
    for (const t of v.myTasks.filter((x) => x.kind === 'bat')) await p.batInnings(t.matchId);
  }
  await players[0].b.idle();
}
