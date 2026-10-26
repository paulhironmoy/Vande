/**
 * MatchDO: one Durable Object per match, the single authority for its state.
 *
 * Sealing. Locking validates the plan with the engine, adds a 128-bit random salt, takes the engine's commit hash
 * (SHA-256 of the canonical plan + salt), signs `matchId|player|hash|engine` with the server's P-256 key, and stores
 * plan + salt AES-GCM encrypted (a per-match key derived from DATA_KEYS; the AAD binds the ciphertext to match, seat
 * and hash). The 128-bit seed is generated at creation, stored encrypted, committed as SHA-256(seed) and revealed in
 * the replay. Views carry commit hashes only.
 *
 * Batting. `next` reveals exactly one delivery with a signed single-use ball token and starts that ball's clock;
 * asking again while it is outstanding returns the same ball (the clock keeps running). `shot` checks the token, the
 * time since the reveal and the input (engine), resolves the ball sealed and returns timing and contact only. A shot
 * made in time but delivered late (queued offline) is accepted until BALL_LATE_MS; a ball never answered within
 * BALL_LIVE_MS resolves as a leave when the batter moves on, and any ball past BALL_LATE_MS resolves as a leave.
 * Duplicate shots replay the stored answer. Runs and wickets never leave the object before the reveal.
 *
 * Deadlines (alarms, and lazily on every request): at the lock deadline an unaccepted invite expires, a joined
 * player who did not lock gets an Auto Over (a match where nobody locked expires); at the batting deadline Auto XI
 * bats whatever is left. The reveal happens when both innings are done (duels) or at the fixed reveal time (cups).
 *
 * Every operation runs strictly one at a time (an internal queue on top of the runtime's input gates).
 */
import { BALLS_PER_OVER, SUPER_BALL_INDEX } from '@/contracts';
import type { BattingInput, CommitRecord, CreateDuelResponse, DeliveryVariant, InvitePreview, LockResponse, MatchEventLog, NextBallResponse, OverPlan, PlayerRef, RevealedDelivery, SealedSixEngineApi, ShotResponse } from '@/contracts';
import { MATCH_ID_RE, inviteUrl, roomIdFor } from '@/net/shared/ids';
import { CLIENT_CLOCK_SLACK_MS, DAY_MS, HOUR_MS, MAX_INVALID_SHOTS, MAX_IRREGULAR_BALLS, publicWebOrigin, readConfig, type Config } from '../config';
import type { EngineHelpers, EngineRegistry } from '../engines';
import type { DOStateLike, Env } from '../env';
import { ApiFailure, errorResponse, fail, failureResponse, isApiFailure } from '../http/errors';
import { hourIso, json, minuteIso } from '../http/http';
import { scrub, warnOnce, type Logger } from '../http/log';
import { audit, type AuditAction } from '../ops/audit';
import type { NotifyKind } from '../ops/messages';
import { analyticsEngineMetrics, type Metrics } from '../ops/metrics';
import { gunzip, gzip, open, randomHex, randomId, seal, sha256Hex, timingSafeEqual } from '../security/crypto';
import { commitSigner, dataKeys, tokenKeys } from '../security/secrets';
import { dailySalt } from '../daily/salt';
import { commitMessage, signText } from '../security/signing';
import { issueBallToken, issueInviteToken, verifyBallToken } from '../security/tokens';
import { SQL } from '../storage/sql';
import { HSQL } from '../highlights/sql';
import { DELETED_PLAYER } from '../profile/model';
import { roomBestEffort } from '../room/client';
import type { RoomOp } from '../room/protocol';
import { callCup } from '../cup/client';
import { istDay, previousDay } from '../time';
import { callMatch } from './client';
import type { CreateDailyOp, CreateFixtureOp, CreateMatchOp, FixtureSummary, MatchOp } from './protocol';
import { DAILY_SETTER } from '../daily/setter';
import { cleanBattingInput, cleanOverPlan, isConditions, publicDelivery, publicFeedback } from './shape';
import { emptyInnings, inningsOver, inviteLinkToken, irregularBalls, opponentKnown, publicFlags, revealSlotAt, seatOf, viewFor, type AnswerHow, type CommitState, type InningsRecord, type LoadedMatch, type MatchMeta, type Seat } from './state';
import { issueInviteCode } from './inviteCodes';

/** Where a revealed log is archived in R2 (gzip JSON). */
export function archiveKey(matchId: string): string {
  return `logs/${matchId}.json.gz`;
}

export interface MatchDeps {
  engines: EngineRegistry;
  /** timingAudit flags innings; dailyCommits fixes the daily overs' commits (Daily Six is off without it). */
  helpers: Partial<EngineHelpers>;
  now(): number;
  logger: Logger;
  metrics: Metrics;
}

export interface MatchObject {
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}

export type MatchObjectClass = new (state: DOStateLike, env: Env) => MatchObject;

type Result = { status: number; body: unknown };

interface IdemRecord {
  h: string;
  s: number;
  b: unknown;
  at: number;
}

const STATE_KEYS = ['meta', 'seat0', 'seat1', 'commit0', 'commit1', 'inn0', 'inn1', 'idemIndex'] as const;
const IDEM_KEEP_MS = DAY_MS;
const IDEM_MAX = 64;
const SYNC_RETRY_MS = 30_000;
/** A Daily Six attempt's object deletes itself this long after its reveal (its score lives on in D1). */
export const DAILY_ATTEMPT_KEEP_MS = 30 * DAY_MS;
const KNOWN_VARIANTS: readonly DeliveryVariant[] = ['yorker', 'good_length', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin'];

export function createMatchObjectClass(deps: MatchDeps): MatchObjectClass {
  return class MatchDO implements MatchObject {
    private readonly state: DOStateLike;
    private readonly env: Env;
    private readonly cfg: Config;
    private readonly metrics: Metrics;
    private m: LoadedMatch | null = null;
    private loaded = false;
    private idemIndex: Array<[string, number]> = [];
    private pending = new Map<string, unknown>();
    private deletes = new Set<string>();
    private plans: [{ plan: OverPlan; salt: string } | null, { plan: OverPlan; salt: string } | null] = [null, null];
    private seed: string | null = null;
    private needsSync = false;
    private notices: Array<{ uid: string; kind: NotifyKind; delaySeconds?: number }> = [];
    private roomOps: Array<{ roomId: string; op: RoomOp }> = [];
    private cupDirty = false;
    private audits: Array<{ uid: string | null; action: AuditAction; detail?: Record<string, string | number | boolean> }> = [];
    private alarmAt: number | null | undefined = undefined;
    private chain: Promise<unknown> = Promise.resolve();
    private now = 0;

    constructor(state: DOStateLike, env: Env) {
      this.state = state;
      this.env = env;
      this.cfg = readConfig(env);
      this.metrics = analyticsEngineMetrics(env.METRICS, deps.metrics);
    }

    fetch(request: Request): Promise<Response> {
      return this.serial(() => this.handle(request));
    }

    alarm(): Promise<void> {
      return this.serial(() => this.onAlarm());
    }

    // ---- plumbing -------------------------------------------------------------------------------------------------

    private serial<T>(fn: () => Promise<T>): Promise<T> {
      const run = this.chain.then(fn, fn);
      this.chain = run.catch(() => undefined);
      return run;
    }

    private async load(): Promise<void> {
      if (this.loaded) return;
      const got = await this.state.storage.get<unknown>([...STATE_KEYS]);
      const meta = got.get('meta') as MatchMeta | undefined;
      this.idemIndex = (got.get('idemIndex') as Array<[string, number]> | undefined) ?? [];
      this.m = meta
        ? {
            meta,
            seats: [got.get('seat0') as Seat, (got.get('seat1') as Seat | undefined) ?? null],
            commits: [(got.get('commit0') as CommitState | undefined) ?? null, (got.get('commit1') as CommitState | undefined) ?? null],
            inn: [(got.get('inn0') as InningsRecord | undefined) ?? emptyInnings(), (got.get('inn1') as InningsRecord | undefined) ?? emptyInnings()],
          }
        : null;
      if (meta?.syncPending) this.needsSync = true;
      this.loaded = true;
    }

    /** Forgets everything not yet written (never persist half an operation). */
    private discard(): void {
      this.pending.clear();
      this.deletes.clear();
      this.loaded = false;
      this.m = null;
      this.plans = [null, null];
      this.seed = null;
      this.notices = [];
      this.audits = [];
      this.roomOps = [];
      this.cupDirty = false;
      this.needsSync = false;
    }

    private stage(key: string, value: unknown): void {
      this.pending.set(key, value);
    }

    private stageInnings(seat: 0 | 1): void {
      this.stage(`inn${seat}`, this.req().inn[seat]);
    }

    /** A change other participants can see: bump the revision and refresh the D1 match list. */
    private touch(): void {
      const m = this.req();
      m.meta.rev += 1;
      this.needsSync = true;
      if (m.meta.kind === 'cup') this.cupDirty = true;
      this.stage('meta', m.meta);
    }

    private isHuman(seat: 0 | 1): boolean {
      const s = this.req().seats[seat];
      return !!s && !s.uid.startsWith('x:') && !s.uid.startsWith('daily:');
    }

    /** Queues a post or membership change for this duel's Cricket Room (fixtures post through their cup). */
    private room(op: RoomOp): void {
      const roomId = this.m?.meta.roomId;
      if (roomId && this.m?.meta.kind === 'duel') this.roomOps.push({ roomId, op });
    }

    private req(): LoadedMatch {
      if (!this.m) fail('not_found', 'match not found');
      return this.m;
    }

    /** One activity-jitter delay (ACTIVITY_JITTER_S): uniform between the configured bounds, from crypto randomness. */
    private jitterMs(): number {
      const { minMs, maxMs } = this.cfg.activityJitter;
      if (maxMs <= 0) return 0;
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      return minMs + Math.floor((r[0] / 2 ** 32) * (maxMs - minMs + 1));
    }

    /**
     * Records when a seat's lock or finished innings becomes visible to the opponent, the cup and the room: `delayMs`
     * after now (the activity jitter), or at once for events whose time is public anyway (deadlines).
     */
    private markVisible(what: 'lock' | 'done', seat: 0 | 1, delayMs: number): number {
      const m = this.req();
      m.meta.visibleAt ??= { lock: [null, null], done: [null, null] };
      // The exact time stays inside the object (MatchMeta.lockedAt / doneAt): it decides what a player's own action
      // completes, never what anyone else learns.
      const exact = what === 'lock' ? (m.meta.lockedAt ??= [null, null]) : (m.meta.doneAt ??= [null, null]);
      // Strictly ordered: the later of the two events is always strictly later, so exactly one player "completes" it.
      const otherAt = exact[(1 - seat) as 0 | 1];
      exact[seat] = otherAt === null ? this.now : Math.max(this.now, otherAt + 1);
      let at = this.now + Math.max(0, delayMs);
      // A finished innings is never visible before the lock it follows (that would tell the lock early).
      if (what === 'done') at = Math.max(at, m.meta.visibleAt.lock[seat] ?? 0);
      m.meta.visibleAt[what][seat] = at;
      this.stage('meta', m.meta);
      return at;
    }

    /**
     * Applies visibility changes that fell due: the opponent's view, the D1 match list, the cup's counts and (duels)
     * the room's "both locked" card change only now, never at the moment of the hidden action. True when anything
     * changed.
     */
    private applyVisibility(): boolean {
      const m = this.req();
      const pub = publicFlags(m, this.now);
      const prev = m.meta.applied ?? { lock: [false, false], done: [false, false] };
      const same = pub.lock[0] === prev.lock[0] && pub.lock[1] === prev.lock[1] && pub.done[0] === prev.done[0] && pub.done[1] === prev.done[1];
      if (same) return false;
      m.meta.applied = pub;
      const bothLocked = (f: { lock: [boolean, boolean] }) => f.lock[0] && f.lock[1];
      const byPlayers = !m.commits[0]?.auto && !m.commits[1]?.auto;
      if (m.meta.kind === 'duel' && m.seats[1] && byPlayers && bothLocked(pub) && !bothLocked(prev) && m.meta.phase !== 'expired') {
        this.room({ op: 'post', kind: 'lock_status', payload: { locked: 2, total: 2 }, upsertKey: 'lock' });
      }
      this.touch();
      return true;
    }

    /**
     * The room says it plainly when Auto Over sealed an over or Auto XI batted for a player (at a public deadline, so
     * nothing about anyone's timing): never a player's own lock or innings in any count. Duel rooms only: a cup posts
     * its own card from the fixture update (`autoOver` / `autoXi`).
     */
    private autoCard(seat: 0 | 1, phase: 'auto_over' | 'auto_xi'): void {
      const m = this.req();
      const who = m.seats[seat];
      if (!who || who.uid.startsWith('x:')) return;
      this.room({ op: 'post', kind: 'deadline', payload: { phase, alias: who.ref.alias }, refs: [['alias', who.ref.id]] });
    }

    private seatFor(uid: string): 0 | 1 {
      const seat = seatOf(this.req(), uid);
      if (seat === null) fail('not_found', 'match not found');
      return seat;
    }

    private engine(): SealedSixEngineApi {
      const m = this.req();
      const e = deps.engines.get(m.meta.engine);
      if (!e) fail('version_mismatch', `this match needs engine version ${m.meta.engine}`);
      return e;
    }

    private guard<T>(what: string, fn: () => T): T {
      try {
        return fn();
      } catch (e) {
        if (isApiFailure(e)) throw e;
        this.metrics.count('engine_error', [what]);
        deps.logger.log('warn', { evt: 'engine_error', what, message: scrub(String((e as Error)?.message ?? e)) });
        return fail('unavailable', 'the game engine is unavailable');
      }
    }

    private async guardAsync<T>(what: string, fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (e) {
        if (isApiFailure(e)) throw e;
        this.metrics.count('engine_error', [what]);
        deps.logger.log('warn', { evt: 'engine_error', what, message: scrub(String((e as Error)?.message ?? e)) });
        return fail('unavailable', 'the game engine is unavailable');
      }
    }

    private async seedValue(): Promise<string> {
      if (this.seed) return this.seed;
      const m = this.req();
      if (m.meta.phase === 'revealed') return (this.seed = (await this.storedLog()).seed);
      const env = (await this.state.storage.get<string>(['secret'])).get('secret');
      const text = env ? await open(dataKeys(this.env, deps.logger).all, 'secret', m.meta.matchId, env, m.meta.matchId) : null;
      if (!text) throw new Error('match secret unreadable');
      this.seed = (JSON.parse(text) as { seed: string }).seed;
      return this.seed;
    }

    private async planOf(seat: 0 | 1): Promise<{ plan: OverPlan; salt: string }> {
      const cached = this.plans[seat];
      if (cached) return cached;
      const m = this.req();
      if (m.meta.phase === 'revealed') {
        // After the reveal the encrypted copies are gone: plans and salts are public inside the replay.
        const log = await this.storedLog();
        const fromLog = { plan: log.plans[seat], salt: log.commits[seat].salt ?? '' };
        this.plans[seat] = fromLog;
        return fromLog;
      }
      const commit = m.commits[seat];
      const env = (await this.state.storage.get<string>([`plan${seat}`])).get(`plan${seat}`);
      if (!commit || !env) throw new Error('plan missing');
      const text = await open(dataKeys(this.env, deps.logger).all, 'plan', m.meta.matchId, env, `${m.meta.matchId}|${seat}|${commit.hash}`);
      if (!text) throw new Error('plan unreadable');
      const value = JSON.parse(text) as { plan: OverPlan; salt: string };
      this.plans[seat] = value;
      return value;
    }

    private notice(seat: 0 | 1, kind: NotifyKind, delaySeconds?: number): void {
      if (!this.isHuman(seat)) return;
      this.notices.push({ uid: (this.req().seats[seat] as Seat).uid, kind, delaySeconds });
    }

    /** Writes staged state, then the D1 match list, notifications, audit rows and the next alarm. */
    private async afterChange(): Promise<void> {
      const m = this.m;
      if (m && this.needsSync) {
        m.meta.syncPending = true;
        this.stage('meta', m.meta);
      }
      if (this.pending.size > 0) {
        await this.state.storage.put(Object.fromEntries(this.pending));
        this.pending.clear();
      }
      if (this.deletes.size > 0) {
        await this.state.storage.delete([...this.deletes]);
        this.deletes.clear();
      }
      if (!m) return;
      if (this.needsSync) {
        try {
          await this.syncIndex();
          this.needsSync = false;
          m.meta.syncPending = false;
        } catch {
          this.metrics.count('index_sync_failed');
          deps.logger.log('warn', { evt: 'index_sync_failed' });
        }
      }
      const notices = this.notices.splice(0);
      for (const n of notices) {
        try {
          await this.env.NOTIFY_QUEUE?.send(
            { v: 1, kind: n.kind, uid: n.uid, matchId: m.meta.matchId, ...(m.meta.cup ? { cupId: m.meta.cup.cupId } : {}), ...(m.meta.roomId ? { roomId: m.meta.roomId } : {}), dedupe: `${m.meta.matchId}:${n.kind}:${n.uid}` },
            n.delaySeconds ? { delaySeconds: n.delaySeconds } : undefined,
          );
        } catch {
          deps.logger.log('warn', { evt: 'notify_enqueue_failed', kind: n.kind });
        }
      }
      for (const r of this.roomOps.splice(0)) await roomBestEffort(this.env, this.cfg, r.roomId, r.op);
      if (this.cupDirty && m.meta.cup) {
        this.cupDirty = false;
        const cup = m.meta.cup;
        // Never awaited: the cup calls this match too (summary), and two objects waiting on each other would deadlock.
        const update = callCup(this.env, this.cfg, cup.cupId, {
          op: 'fixture_update',
          fixtureId: cup.fixtureId,
          matchId: m.meta.matchId,
          // What other members may see (after the activity jitter), and the exact flags for each player's own tasks.
          locked: publicFlags(m, this.now).lock,
          battingDone: publicFlags(m, this.now).done,
          exact: {
            locked: [m.commits[0] !== null, m.commits[1] !== null],
            battingDone: [m.inn[0].state?.done === true, m.inn[1].state?.done === true],
            // What each player knows of their opponent (visible, or completed by their own action).
            oppLocked: [opponentKnown(m, 0, this.now).locked, opponentKnown(m, 1, this.now).locked],
            oppDone: [opponentKnown(m, 0, this.now).done, opponentKnown(m, 1, this.now).done],
          },
          autoOver: [m.commits[0]?.auto === true, m.commits[1]?.auto === true],
          autoXi: [0, 1].map((s) => Object.values(m.inn[s as 0 | 1].answered).some((a) => a.how === 'auto')) as [boolean, boolean],
          revealed: m.meta.phase === 'revealed',
        })
          .then(() => undefined)
          .catch(() => deps.logger.log('warn', { evt: 'cup_update_failed' }));
        this.state.waitUntil?.(update);
      }
      const audits = this.audits.splice(0);
      for (const a of audits) await audit(this.env.DB, deps.logger, { at: this.now, uid: a.uid, action: a.action, target: m.meta.matchId, detail: a.detail });
      await this.scheduleAlarm();
    }

    private async syncIndex(): Promise<void> {
      const m = this.req();
      const statements = [];
      let synced: [string | null, string | null] | null = null;
      if (m.meta.kind !== 'daily') {
        synced = m.meta.synced ? [m.meta.synced[0], m.meta.synced[1]] : [null, null];
        for (const seat of [0, 1] as const) {
          if (!this.isHuman(seat)) continue;
          const s = m.seats[seat] as Seat;
          const json = JSON.stringify(viewFor(m, seat, publicWebOrigin(this.env), this.now));
          const hash = (await sha256Hex(json)).slice(0, 16);
          // A player's row (and its place in their list, ordered by updated_ms) moves only when their own view changed,
          // never at the moment of an opponent's action they cannot see yet.
          if (synced[seat] === hash) continue;
          const phase = (JSON.parse(json) as { phase: string }).phase;
          statements.push(this.env.DB.prepare(SQL.upsertMatchPlayer).bind(s.uid, m.meta.matchId, m.meta.kind, phase, m.meta.rev, this.now, json));
          synced[seat] = hash;
        }
      }
      const record = m.meta.phase === 'revealed' && !m.meta.recorded;
      if (m.meta.phase === 'revealed' && !m.meta.archived) await this.archiveLog();
      if (record) statements.push(...(await this.resultStatements()));
      if (statements.length > 0) await this.env.DB.batch(statements);
      if (synced) {
        m.meta.synced = synced;
        this.stage('meta', m.meta);
      }
      if (record) {
        m.meta.recorded = true;
        this.stage('meta', m.meta);
      }
    }

    /**
     * Copies the revealed log to R2 (logs/<matchId>.json.gz): highlights, audits and replays outlive the match object.
     * Duels and cup matches always; Daily Six attempts only with ARCHIVE_DAILY_LOGS=1 (their objects keep them 30 days).
     * Retried with the index sync until it lands.
     */
    private async archiveLog(): Promise<void> {
      const m = this.req();
      if (!this.env.FILES || (m.meta.kind === 'daily' && this.env.ARCHIVE_DAILY_LOGS !== '1')) {
        m.meta.archived = true;
        return;
      }
      const staged = this.pending.get('log') as Uint8Array | undefined;
      const bytes = staged ?? (await this.state.storage.get<Uint8Array>(['log'])).get('log');
      if (!bytes) throw new Error('log missing');
      await this.env.FILES.put(archiveKey(m.meta.matchId), bytes, { httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' }, customMetadata: { kind: m.meta.kind, engine: String(m.meta.engine) } });
      m.meta.archived = true;
      this.stage('meta', m.meta);
    }

    /** Ratings before the match and the changes `updateRatings` (src/engine/ranking.ts) gives; applied by a D1 trigger. */
    private async ratingChange(auto: boolean, winner: 0 | 1 | null): Promise<{ rated: 0 | 1; r: [number | null, number | null]; d: [number, number] }> {
      const m = this.req();
      const update = deps.helpers.updateRatings;
      const s1 = m.seats[1];
      const none = { rated: 0 as const, r: [null, null] as [number | null, number | null], d: [0, 0] as [number, number] };
      if (!update || !s1 || !this.isHuman(0) || !this.isHuman(1) || m.seats[0].uid.startsWith('x:') || s1.uid.startsWith('x:')) return none;
      const rows = await this.env.DB.prepare(SQL.ratingsOf).bind(m.seats[0].uid, s1.uid).all<{ uid: string; rating: number; rated_matches: number }>();
      const a = rows.results.find((x) => x.uid === m.seats[0].uid);
      const b = rows.results.find((x) => x.uid === s1.uid);
      if (!a || !b) return none;
      const out = this.guard('updateRatings', () => update([{ rating: a.rating, ratedMatches: a.rated_matches }, { rating: b.rating, ratedMatches: b.rated_matches }], { kind: m.meta.kind, auto, practice: false, winner }));
      if (!out.rated) return { ...none, r: [a.rating, b.rating] };
      const round = (v: number) => Math.round(v * 10) / 10;
      return { rated: 1, r: [a.rating, b.rating], d: [round(out.ratings[0] - a.rating), round(out.ratings[1] - b.rating)] };
    }

    /** engine.matchPerformance for both players (Top 100 inputs); null when the engine cannot say. */
    private performance(log: MatchEventLog): Array<number | null> {
      const engine = this.engine();
      const out: Array<number | null> = [];
      for (const p of [0, 1] as const) {
        try {
          const perf = engine.matchPerformance(log, p);
          const ok = [perf.tacticalEfficiency, perf.clutch, perf.execution].every((v) => typeof v === 'number' && Number.isFinite(v));
          out.push(...(ok ? [perf.tacticalEfficiency, perf.clutch, perf.execution] : [null, null, null]));
        } catch {
          this.metrics.count('engine_error', ['matchPerformance']);
          out.push(null, null, null);
        }
      }
      return out;
    }

    /** Idempotent rows written once after the reveal: the result and friends, or the Daily Six score and streak. */
    private async resultStatements() {
      const m = this.req();
      const db = this.env.DB;
      const day = istDay(m.meta.revealedMs ?? this.now);
      if (m.meta.kind === 'daily') {
        const d = m.meta.daily;
        const seat = m.seats[0];
        if (!d || d.score === null || seat.uid.startsWith('x:')) return [];
        const rec = m.inn[0];
        return [
          // Over the integrity limit the attempt is used and keeps the streak, but never reaches the boards.
          ...(d.counted === false ? [] : [db.prepare(SQL.upsertDailyScore).bind(d.day, seat.uid, d.score, d.city, seat.ref.id, seat.ref.alias, seat.ref.avatar.seed, this.now, rec.late ?? 0, rec.suspicious ? 1 : 0, rec.missed ?? 0)]),
          db.prepare(SQL.upsertStreak).bind(seat.uid, d.day, previousDay(d.day)),
          db.prepare(SQL.finishDailyAttempt).bind(d.day, seat.uid, m.meta.matchId),
        ];
      }
      const log = await this.storedLog();
      const s1 = m.seats[1];
      if (!s1) return [];
      const auto = (seat: 0 | 1) => (m.commits[seat]?.auto || Object.values(m.inn[seat].answered).some((a) => a.how === 'auto') ? 1 : 0);
      const rating = await this.ratingChange(auto(0) === 1 || auto(1) === 1, log.result.winner);
      const perf = this.performance(log);
      const out = [
        db.prepare(SQL.insertMatchResult).bind(
          m.meta.matchId,
          m.meta.kind,
          m.meta.cup?.cupId ?? null,
          m.meta.cup?.stage ?? null,
          day,
          m.meta.revealedMs ?? this.now,
          m.seats[0].uid,
          s1.uid,
          log.innings[0].runs,
          log.innings[0].wickets,
          log.innings[1].runs,
          log.innings[1].wickets,
          log.result.winner,
          m.inn[0].late ?? 0,
          m.inn[1].late ?? 0,
          auto(0),
          auto(1),
          m.inn[0].suspicious ? 1 : 0,
          m.inn[1].suspicious ? 1 : 0,
          rating.rated,
          rating.r[0],
          rating.r[1],
          rating.d[0],
          rating.d[1],
          ...perf,
          m.meta.kind === 'duel' ? (m.meta.attribution ?? null) : null,
          m.inn[0].missed ?? 0,
          m.inn[1].missed ?? 0,
        ),
      ];
      if (this.isHuman(0) && this.isHuman(1)) {
        out.push(db.prepare(SQL.insertFriend).bind(m.seats[0].uid, s1.uid, day), db.prepare(SQL.insertFriend).bind(s1.uid, m.seats[0].uid, day));
      }
      out.push(...(await this.unlockStatements(log, auto)));
      return out;
    }

    /**
     * Deliveries earned in this official match (src/engine/advice.ts `unlocksEarned`, injected): merged into each
     * player's unlocks with a set union (merging twice changes nothing, so a retried recording is harmless), and a room
     * card for each delivery that is new to them. Never for an Auto seat (Auto Over or Auto XI), a seat with late
     * answers, a deleted player or a Daily Six attempt; and nothing at all without the helper (fails closed).
     */
    private async unlockStatements(log: MatchEventLog, auto: (seat: 0 | 1) => 0 | 1) {
      const m = this.req();
      const earnedBy = deps.helpers.unlocksEarned;
      const db = this.env.DB;
      if (!earnedBy || (m.meta.kind !== 'duel' && m.meta.kind !== 'cup')) return [];
      const out = [];
      for (const seat of [0, 1] as const) {
        const s = m.seats[seat];
        if (!s || !this.isHuman(seat) || auto(seat) === 1 || (m.inn[seat].late ?? 0) > 0) continue;
        let earned: DeliveryVariant[] = [];
        try {
          earned = earnedBy(log, seat).filter((v) => KNOWN_VARIANTS.includes(v));
        } catch (e) {
          this.metrics.count('engine_error', ['unlocksEarned']);
          deps.logger.log('warn', { evt: 'engine_error', what: 'unlocksEarned', message: scrub(String((e as Error)?.message ?? e)) });
        }
        if (earned.length === 0) continue;
        const row = await db.prepare(SQL.unlocksOfUid).bind(s.uid).first<{ unlocks_json: string }>();
        let had: string[] = [];
        try {
          const parsed = JSON.parse(row?.unlocks_json ?? '[]') as unknown;
          if (Array.isArray(parsed)) had = parsed.filter((x): x is string => typeof x === 'string');
        } catch {
          /* a malformed list is replaced by the merge */
        }
        out.push(db.prepare(SQL.mergeUnlocks).bind(s.uid, JSON.stringify(earned), this.now));
        const roomId = m.meta.roomId;
        for (const v of earned) {
          if (had.includes(v)) continue;
          this.metrics.count('delivery_unlocked', [v]);
          // Cup matches too: their room is the cup's (the match object posts these cards itself; once per match).
          if (roomId) this.roomOps.push({ roomId, op: { op: 'post', kind: 'achievement', payload: { badge: `unlock_${v}`, alias: s.ref.alias }, upsertKey: `unlock:${m.meta.matchId}:${seat}:${v}`, refs: [['alias', s.ref.id]] } });
        }
      }
      return out;
    }

    private async scheduleAlarm(): Promise<void> {
      const meta = this.m?.meta;
      let next: number | null = null;
      const consider = (t: number) => (next = next === null ? t : Math.min(next, t));
      if (meta) {
        if (meta.phase === 'open' || meta.phase === 'planning') consider(meta.lockByMs);
        if (meta.phase === 'batting') {
          consider(meta.batByMs);
          if (meta.revealAtMs !== null) consider(meta.revealAtMs);
        }
        const d = this.deadlineAt();
        if (d && this.reminderPending(d.phase)) consider(d.at);
        // A lock or a finished innings that becomes visible later: the opponent's view, the list, the cup and the room.
        if (meta.phase === 'open' || meta.phase === 'planning' || meta.phase === 'batting') {
          for (const t of [...(meta.visibleAt?.lock ?? []), ...(meta.visibleAt?.done ?? [])]) if (t !== null && t > this.now) consider(t);
        }
        if (meta.kind === 'daily' && meta.phase === 'revealed' && meta.revealedMs !== null) consider(meta.revealedMs + DAILY_ATTEMPT_KEEP_MS);
        if (meta.syncPending) consider(this.now + SYNC_RETRY_MS);
      }
      if (this.alarmAt === undefined) this.alarmAt = await this.state.storage.getAlarm();
      if (next === this.alarmAt) return;
      if (next === null) await this.state.storage.deleteAlarm();
      else await this.state.storage.setAlarm(Math.max(next, this.now + 1));
      this.alarmAt = next;
    }

    // ---- request handling -----------------------------------------------------------------------------------------

    private async handle(request: Request): Promise<Response> {
      this.now = deps.now();
      let op: MatchOp;
      try {
        op = (await request.json()) as MatchOp;
      } catch {
        return errorResponse('invalid', 'bad internal request');
      }
      try {
        await this.load();
        // Forgetting a player in an object that no longer exists (a Daily Six attempt deletes itself) is done already.
        if (op.op === 'forget' && !this.m) return json({ ok: true }, 200);
        if (op.op !== 'create' && op.op !== 'create_fixture' && op.op !== 'create_daily') {
          this.req();
          if (await this.tick()) await this.afterChange();
        }
        const result = await this.dispatch(op);
        if (this.m) this.applyVisibility();
        await this.afterChange();
        return json(result.body, result.status);
      } catch (e) {
        if (isApiFailure(e)) {
          if (this.pending.size > 0) this.discard();
          return failureResponse(e);
        }
        this.discard();
        this.metrics.count('error', ['match', 'internal']);
        deps.logger.log('error', { evt: 'match_error', op: op.op, message: scrub(String((e as Error)?.message ?? e)) });
        return errorResponse('unavailable', 'match temporarily unavailable', 500);
      }
    }

    private async onAlarm(): Promise<void> {
      this.alarmAt = null;
      this.now = deps.now();
      try {
        await this.load();
        if (!this.m) return;
        const meta = this.m.meta;
        if (meta.kind === 'daily' && meta.phase === 'revealed' && meta.recorded && meta.revealedMs !== null && this.now >= meta.revealedMs + DAILY_ATTEMPT_KEEP_MS) {
          await this.state.storage.deleteAll();
          await this.state.storage.deleteAlarm();
          this.discard();
          return;
        }
        const changed = await this.tick();
        if (changed || this.needsSync) await this.afterChange();
        else await this.scheduleAlarm();
      } catch (e) {
        this.discard();
        deps.logger.log('error', { evt: 'match_alarm_error', message: scrub(String((e as Error)?.message ?? e)) });
        throw e;
      }
    }

    private dispatch(op: MatchOp): Promise<Result> {
      switch (op.op) {
        case 'create':
          return this.create(op);
        case 'create_fixture':
          return this.createFixture(op);
        case 'create_daily':
          return this.createDaily(op);
        case 'summary':
          return this.summary();
        case 'daily_result':
          return this.dailyResult(op.uid);
        case 'preview':
          return this.preview(op.nonce);
        case 'accept':
          return this.withIdem(op.idem, `accept|${op.actor.uid}`, () => this.accept(op.nonce, op.actor));
        case 'view':
          return Promise.resolve({ status: 200, body: viewFor(this.req(), this.seatFor(op.uid), publicWebOrigin(this.env), this.now) });
        case 'lock':
          return this.withIdem(op.idem, `lock|${op.uid}|${JSON.stringify(op.plan)}`, () => this.lock(op.uid, op.plan, op.unlocked));
        case 'next':
          return this.withInningsIdem(op.uid, 'next', op.idem, `next|${op.uid}`, () => this.next(op.uid));
        case 'shot':
          return this.withInningsIdem(op.uid, 'shot', op.idem, `shot|${op.uid}|${JSON.stringify([op.input, op.ballToken])}`, () => this.shot(op.uid, op.input, op.ballToken));
        case 'reveal':
          return this.reveal(op.uid);
        case 'rematch':
          return this.withIdem(op.idem, `rematch|${op.uid}`, () => this.rematch(op.uid, op.ref));
        case 'forget':
          return this.forget(op.uid);
        case 'rename':
          return this.rename(op.uid, op.ref);
        default:
          return Promise.resolve(fail('invalid', 'unknown operation'));
      }
    }

    /**
     * Idempotency for the per-ball calls, stored in the innings record (written by the call anyway). A retried `next`
     * replays the latest reveal; a retried shot replays the answer of its ball.
     */
    private async withInningsIdem(uid: string, kind: 'next' | 'shot', key: string | undefined, fingerprint: string, run: () => Promise<Result>): Promise<Result> {
      if (!key) return run();
      const seat = this.seatFor(uid);
      const hash = await sha256Hex(fingerprint);
      const rec = this.req().inn[seat];
      rec.idem ??= { next: null, shots: [] };
      if (kind === 'next' && rec.idem.next?.k === key) {
        if (rec.idem.next.h !== hash) fail('conflict', 'Idempotency-Key was already used for a different request');
        this.metrics.count('idempotent_replay', ['match']);
        return { status: 200, body: rec.idem.next.body };
      }
      if (kind === 'shot') {
        const seen = rec.idem.shots.find((x) => x.k === key);
        if (seen) {
          if (seen.h !== hash) fail('conflict', 'Idempotency-Key was already used for a different request');
          const answered = rec.answered[String(seen.ball)];
          if (answered) {
            this.metrics.count('idempotent_replay', ['match']);
            if (answered.how === 'live' || answered.how === 'late') return { status: 200, body: answered.response };
            fail('deadline_passed', "the ball's answer window passed; it counted as a leave");
          }
        }
      }
      const ballBefore = rec.outstanding?.ball ?? null;
      const result = await run();
      if (result.status < 300) {
        const r = this.req().inn[seat];
        r.idem ??= { next: null, shots: [] };
        if (kind === 'next') r.idem.next = { k: key, h: hash, body: result.body };
        else if (ballBefore !== null) r.idem.shots = [...r.idem.shots.filter((x) => x.k !== key), { k: key, h: hash, ball: ballBefore }].slice(-8);
        this.stageInnings(seat);
      }
      return result;
    }

    private async withIdem(key: string | undefined, fingerprint: string, run: () => Promise<Result>): Promise<Result> {
      if (!key) return run();
      const id = `idem:${key}`;
      const hash = await sha256Hex(fingerprint);
      const got = (await this.state.storage.get<IdemRecord>([id])).get(id);
      if (got) {
        if (got.h !== hash) fail('conflict', 'Idempotency-Key was already used for a different request');
        this.metrics.count('idempotent_replay', ['match']);
        return { status: got.s, body: got.b };
      }
      const result = await run();
      if (result.status < 300) {
        this.stage(id, { h: hash, s: result.status, b: result.body, at: this.now } satisfies IdemRecord);
        this.idemIndex.push([key, this.now]);
        const keep = this.idemIndex.filter(([, at], i) => this.now - at < IDEM_KEEP_MS && i >= this.idemIndex.length - IDEM_MAX);
        const drop = this.idemIndex.filter((e) => !keep.includes(e)).map(([k]) => `idem:${k}`);
        this.idemIndex = keep;
        this.stage('idemIndex', keep);
        if (drop.length > 0) await this.state.storage.delete(drop);
      }
      return result;
    }

    // ---- deadlines ------------------------------------------------------------------------------------------------

    /** The current window's reminder time (lock, then batting), or null (Daily Six never reminds). */
    private deadlineAt(): { phase: 'lock' | 'bat'; at: number } | null {
      const m = this.m;
      if (!m || m.meta.kind === 'daily') return null;
      const lead = (window: number) => Math.min(2 * HOUR_MS, Math.floor(window / 4));
      if (m.meta.phase === 'open' || m.meta.phase === 'planning') return { phase: 'lock', at: m.meta.lockByMs - lead(m.meta.lockByMs - m.meta.createdMs) };
      if (m.meta.phase === 'batting') return { phase: 'bat', at: m.meta.batByMs - lead(m.meta.batByMs - m.meta.lockByMs) };
      return null;
    }

    /** The seat has not yet done this window's step (exact state: only that player is reminded). */
    private owes(phase: 'lock' | 'bat', seat: 0 | 1): boolean {
      const m = this.req();
      return phase === 'lock' ? !m.commits[seat] : !inningsOver(m.meta.kind, m.inn[seat].state);
    }

    /** The room's deadline card is posted while anyone's step is not visibly done (public flags, so it says no more). */
    private roomDeadlinePending(phase: 'lock' | 'bat'): boolean {
      const m = this.req();
      const pub = publicFlags(m, this.now);
      return ([0, 1] as const).some((seat) => this.isHuman(seat) && !(phase === 'lock' ? pub.lock[seat] : pub.done[seat]));
    }

    /** Whether the reminder time still has work: a seat to remind (once per player per match) or the room's card. */
    private reminderPending(phase: 'lock' | 'bat'): boolean {
      const m = this.req();
      const push = ([0, 1] as const).some((seat) => this.isHuman(seat) && !m.meta.reminded?.[seat] && this.owes(phase, seat));
      const post = m.meta.kind === 'duel' && !m.meta.deadlinePosts?.[phase] && this.roomDeadlinePending(phase);
      return push || post;
    }

    private remind(): boolean {
      const m = this.req();
      const d = this.deadlineAt();
      if (!d || this.now < d.at) return false;
      let changed = false;
      for (const seat of [0, 1] as const) {
        if (!this.isHuman(seat) || m.meta.reminded[seat] || !this.owes(d.phase, seat)) continue;
        m.meta.reminded[seat] = true;
        this.notice(seat, 'deadline_reminder');
        changed = true;
      }
      m.meta.deadlinePosts ??= { lock: false, bat: false };
      if (!m.meta.deadlinePosts[d.phase]) {
        m.meta.deadlinePosts[d.phase] = true;
        if (this.roomDeadlinePending(d.phase)) {
          this.room({ op: 'post', kind: 'deadline', payload: { phase: d.phase, by: minuteIso(d.phase === 'bat' ? m.meta.batByMs : m.meta.lockByMs) }, upsertKey: `deadline:${d.phase}` });
        }
        changed = true;
      }
      if (changed) this.stage('meta', m.meta);
      return changed;
    }

    private async tick(): Promise<boolean> {
      const m = this.req();
      m.meta.reminded ??= [false, false];
      let changed = this.remind();
      if ((m.meta.phase === 'open' || m.meta.phase === 'planning') && this.now >= m.meta.lockByMs) {
        await this.lockDeadline();
        changed = true;
      }
      if (m.meta.phase === 'batting') {
        for (const seat of [0, 1] as const) {
          const out = m.inn[seat].outstanding;
          if (out && this.now - out.revealedMs > this.cfg.ballLateMs) {
            await this.settleLeave(seat, 'expired');
            changed = true;
          }
        }
        if (this.now >= m.meta.batByMs && (await this.batDeadline())) changed = true;
        if (await this.maybeReveal()) changed = true;
      }
      if (this.applyVisibility()) changed = true;
      return changed;
    }

    private async lockDeadline(): Promise<void> {
      const m = this.req();
      const nobodyJoined = m.seats[1] === null;
      const nobodyLocked = !m.commits[0] && !m.commits[1];
      // A cup fixture always completes (Auto Over for every seat that did not lock); a duel nobody locked expires.
      if (nobodyJoined || (nobodyLocked && m.meta.kind !== 'cup')) {
        m.meta.phase = 'expired';
        this.touch();
        this.notice(0, 'match_expired');
        if (!nobodyJoined) this.notice(1, 'match_expired');
        this.audits.push({ uid: null, action: 'match_expired', detail: { joined: !nobodyJoined } });
        this.metrics.count('match_expired', [nobodyJoined ? 'not_joined' : 'not_locked']);
        return;
      }
      const engine = this.engine();
      const seed = await this.seedValue();
      for (const seat of [0, 1] as const) {
        if (m.commits[seat]) continue;
        const plan = this.guard('autoOver', () => engine.autoOver(`${seed}:auto-over:${seat}`, m.meta.conditions));
        await this.sealPlan(seat, plan, true);
        this.markVisible('lock', seat, 0); // the lock deadline is public
        this.notice(seat, 'auto_over');
        this.autoCard(seat, 'auto_over');
      }
      m.meta.phase = 'batting';
      this.touch();
    }

    private async batDeadline(): Promise<boolean> {
      const m = this.req();
      const engine = this.engine();
      const seed = await this.seedValue();
      let changed = false;
      // Daily Six never bats for the player: what is left of its six balls at the reset resolves as leaves.
      const daily = m.meta.kind === 'daily';
      // Auto XI's key comes from the engine (`autoXiSeed`), the one the reveal recognises Auto XI by; without that
      // helper the missed balls resolve as leaves instead (fail closed), like Daily Six.
      const autoKey = daily ? null : (deps.helpers.autoXiSeed ?? null);
      if (!daily && !autoKey) warnOnce(deps.logger, 'autoXiSeed', 'the Auto XI helper is not configured; missed balls resolve as leaves');
      const over = (st: typeof m.inn[0]['state']) => inningsOver(m.meta.kind, st);
      for (const seat of [0, 1] as const) {
        const rec = m.inn[seat];
        if (over(rec.state) || (daily && seat === 1)) continue;
        if (!rec.state) rec.state = this.guard('startInnings', () => engine.startInnings(seat));
        if (rec.outstanding) await this.settleLeave(seat, 'deadline');
        const opp = (await this.planOf((1 - seat) as 0 | 1)).plan;
        let auto = 0;
        for (let guardBalls = 0; rec.state && !over(rec.state) && guardBalls <= SUPER_BALL_INDEX + 1; guardBalls++) {
          const ball = rec.state.nextBall;
          const delivery = this.guard('revealDelivery', () => engine.revealDelivery(opp, ball, m.meta.conditions));
          let input = null;
          if (autoKey) {
            const proposed = this.guard('autoBat', () => engine.autoBat(autoKey(seed, seat, ball), delivery, opp.field));
            const checked = this.guard('validateBattingInput', () => engine.validateBattingInput(proposed, delivery));
            input = checked.ok ? checked.input : null;
          }
          const r = await this.resolve(seat, input, true);
          rec.answered[String(ball)] = { tid: null, how: autoKey ? 'auto' : 'deadline', response: { feedback: publicFeedback(r.feedback), inningsComplete: over(r.state) } };
          if (autoKey) auto++;
        }
        if (!over(rec.state)) throw new Error('auto XI did not finish the innings');
        this.stageInnings(seat);
        this.touch();
        changed = true;
        if (auto > 0) {
          this.metrics.count('auto_xi', [], auto);
          this.audits.push({ uid: null, action: 'auto_xi', detail: { seat, balls: auto } });
          this.autoCard(seat, 'auto_xi');
        }
      }
      return changed;
    }

    private async maybeReveal(): Promise<boolean> {
      const m = this.req();
      if (m.meta.kind === 'daily') {
        if (m.meta.phase !== 'batting' || !inningsOver('daily', m.inn[0].state)) return false;
        await this.publishDailyReveal();
        return true;
      }
      if (m.meta.phase !== 'batting' || !m.inn[0].state?.done || !m.inn[1].state?.done) return false;
      let slotSet = false;
      if (m.meta.kind === 'duel' && m.meta.revealAtMs === null) {
        // Both innings just ended: the duel reveals for both players at the next slot (cups keep their fixed times),
        // so neither the reveal nor its push tells when the second innings ended.
        m.meta.revealAtMs = revealSlotAt(this.now, this.cfg.duelRevealSlotMs);
        this.touch();
        slotSet = true;
      }
      if (m.meta.revealAtMs !== null && this.now < m.meta.revealAtMs) return slotSet;
      await this.publishReveal();
      return true;
    }

    // ---- sealing --------------------------------------------------------------------------------------------------

    private async sealPlan(seat: 0 | 1, plan: OverPlan, auto: boolean, auditIt = true, salt = randomHex(16)): Promise<CommitState> {
      const m = this.req();
      const engine = this.engine();
      const hash = await this.guardAsync('commitHash', () => engine.commitHash(plan, salt));
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('engine returned a malformed commit hash');
      const signer = await commitSigner(this.env, deps.logger);
      const sig = await signText(signer, commitMessage(m.meta.matchId, seat, hash, m.meta.engine));
      const envelope = await seal(dataKeys(this.env, deps.logger).active, 'plan', m.meta.matchId, JSON.stringify({ plan, salt }), `${m.meta.matchId}|${seat}|${hash}`);
      const commit: CommitState = { hash, sig, keyId: signer.keyId, lockedHour: hourIso(this.now), auto };
      m.commits[seat] = commit;
      this.plans[seat] = { plan, salt };
      this.stage(`commit${seat}`, commit);
      this.stage(`plan${seat}`, envelope);
      if (auditIt) {
        this.metrics.count(auto ? 'auto_over' : 'over_locked');
        this.audits.push({ uid: auto ? null : m.seats[seat]?.uid ?? null, action: auto ? 'auto_over' : 'over_locked', detail: { seat, hash, keyId: signer.keyId } });
      }
      return commit;
    }

    // ---- operations -----------------------------------------------------------------------------------------------

    private async create(op: CreateMatchOp): Promise<Result> {
      if (this.m) {
        if (this.m.meta.matchId === op.matchId && this.m.seats[0].uid === op.creator.uid) return { status: 200, body: { inviteToken: inviteLinkToken(this.m.meta) } };
        fail('conflict', 'match already exists');
      }
      if (!MATCH_ID_RE.test(op.matchId) || !isConditions(op.conditions) || !(op.lockByMs > this.now) || !(op.batByMs > op.lockByMs)) fail('invalid', 'bad match parameters');
      const engine = deps.engines.current();
      const seed = randomHex(16);
      const nonce = randomHex(16);
      const secret = await seal(dataKeys(this.env, deps.logger).active, 'secret', op.matchId, JSON.stringify({ seed }), op.matchId);
      const inviteToken = await issueInviteToken(tokenKeys(this.env, deps.logger), { kind: 'duel', targetId: op.matchId, nonce, expMs: op.inviteExpMs });
      // The short code the link carries (null when D1 cannot take it: the link then carries the token itself).
      const inviteCode = await issueInviteCode(this.env.DB, inviteToken, op.inviteExpMs, this.now);
      const meta: MatchMeta = {
        v: 1,
        matchId: op.matchId,
        kind: op.kind,
        engine: engine.ENGINE_VERSION,
        createdMs: this.now,
        conditions: { pitch: op.conditions.pitch, weather: op.conditions.weather },
        lockByMs: op.lockByMs,
        batByMs: op.batByMs,
        revealAtMs: op.revealAtMs,
        inviteNonce: nonce,
        inviteExpMs: op.inviteExpMs,
        inviteToken,
        inviteCode,
        reservedFor: op.reservedFor,
        rematchOf: op.rematchOf,
        rematch: null,
        phase: 'open',
        rev: 0,
        seedCommit: await sha256Hex(seed),
        revealedMs: null,
        syncPending: false,
        roomId: roomIdFor(op.matchId),
        reminded: [false, false],
        recorded: false,
        ...(op.attribution && /^[a-z0-9]{4,16}$/.test(op.attribution) ? { attribution: op.attribution } : {}),
      };
      this.m = { meta, seats: [{ uid: op.creator.uid, ref: op.creator.ref }, null], commits: [null, null], inn: [emptyInnings(), emptyInnings()] };
      this.room({ op: 'create', roomId: meta.roomId as string, kind: 'duel', title: `${op.creator.ref.alias} · Friend Duel`, members: [op.creator], titleOwner: op.creator.ref.id });
      this.room({ op: 'post', kind: 'invite', payload: { kind: 'duel', inviterAlias: op.creator.ref.alias }, refs: [['inviterAlias', op.creator.ref.id]] });
      this.seed = seed;
      this.stage('seat0', this.m.seats[0]);
      this.stage('secret', secret);
      this.stage('inn0', this.m.inn[0]);
      this.stage('inn1', this.m.inn[1]);
      this.touch();
      this.metrics.count('duel_created');
      return { status: 201, body: { inviteToken: inviteLinkToken(meta) } };
    }

    private async preview(nonce: string): Promise<Result> {
      const m = this.req();
      if (typeof nonce !== 'string' || !timingSafeEqual(nonce, m.meta.inviteNonce)) fail('not_found', 'invite not found');
      if (m.meta.phase === 'expired' || this.now > m.meta.inviteExpMs) fail('deadline_passed', 'this invite has expired');
      const body: InvitePreview = { kind: 'duel', inviterAlias: m.seats[0].ref.alias, conditions: { ...m.meta.conditions }, expiresAt: minuteIso(m.meta.inviteExpMs) };
      if (m.meta.attribution) {
        // An invite opened from a highlight-started duel counts for that highlight (a counter, no person).
        await this.env.DB.prepare(HSQL.countAttribution).bind(m.meta.attribution, istDay(this.now), 'invite_open', 1).run().catch(() => undefined);
      }
      return { status: 200, body };
    }

    private async accept(nonce: string, actor: Seat): Promise<Result> {
      const m = this.req();
      if (typeof nonce !== 'string' || !timingSafeEqual(nonce, m.meta.inviteNonce)) fail('not_found', 'invite not found');
      if (m.seats[1]) {
        if (m.seats[1].uid === actor.uid) return { status: 200, body: { matchId: m.meta.matchId } };
        fail('conflict', 'this invite has already been accepted');
      }
      if (actor.uid === m.seats[0].uid) fail('forbidden', 'you cannot accept your own invite');
      if (m.meta.phase !== 'open' || this.now > m.meta.inviteExpMs) fail('deadline_passed', 'this invite has expired');
      if (m.meta.reservedFor && m.meta.reservedFor !== actor.uid) fail('forbidden', 'this rematch invite is for another player');
      m.seats[1] = { uid: actor.uid, ref: actor.ref };
      m.meta.phase = 'planning';
      this.stage('seat1', m.seats[1]);
      this.room({ op: 'add_member', member: { uid: actor.uid, ref: actor.ref } });
      this.touch();
      this.notice(0, 'opponent_joined');
      this.audits.push({ uid: actor.uid, action: 'invite_accepted' });
      this.metrics.count('invite_accepted');
      return { status: 200, body: { matchId: m.meta.matchId } };
    }

    private async lock(uid: string, rawPlan: unknown, unlocked: string[]): Promise<Result> {
      const m = this.req();
      const seat = this.seatFor(uid);
      const engine = this.engine();
      const plan = cleanOverPlan(rawPlan);
      const existing = m.commits[seat];
      const allowed = [...new Set([...engine.STARTER_VARIANTS, ...KNOWN_VARIANTS.filter((v) => unlocked.includes(v))])];
      if (existing) {
        if (existing.auto) fail('deadline_passed', 'the lock deadline passed; an Auto Over was sealed for you');
        if (plan) {
          const v = this.guard('validatePlan', () => engine.validatePlan(plan, allowed));
          const stored = await this.planOf(seat);
          if (v.ok && this.guard('canonicalPlan', () => engine.canonicalPlan(v.plan) === engine.canonicalPlan(stored.plan))) {
            return { status: 200, body: { commitHash: existing.hash, sig: existing.sig, keyId: existing.keyId } satisfies LockResponse };
          }
        }
        fail('already_locked', 'your over is already locked and can never change');
      }
      if (m.meta.phase === 'expired' || m.meta.phase === 'revealed') fail('deadline_passed', 'this match is over');
      if (m.meta.phase === 'batting' || this.now >= m.meta.lockByMs) fail('deadline_passed', 'the lock deadline has passed');
      if (!plan) fail('invalid', 'plan is malformed');
      const v = this.guard('validatePlan', () => engine.validatePlan(plan, allowed));
      if (!v.ok) fail('invalid', `plan rejected: ${v.errors.slice(0, 3).join('; ').slice(0, 300)}`);
      const commit = await this.sealPlan(seat, v.plan, false);
      // No timing detail: the lock reaches the opponent (view, phase, push), the cup and the room only after the same
      // random delay (the activity jitter), so nothing says when the over was locked.
      const delay = this.jitterMs();
      this.markVisible('lock', seat, delay);
      if (m.commits[0] && m.commits[1] && m.seats[1]) m.meta.phase = 'batting';
      this.touch();
      if (m.seats[1]) this.notice((1 - seat) as 0 | 1, 'opponent_locked', Math.ceil(delay / 1000));
      this.applyVisibility();
      return { status: 200, body: { commitHash: commit.hash, sig: commit.sig, keyId: commit.keyId } satisfies LockResponse };
    }

    private batting(seat: 0 | 1): InningsRecord {
      const m = this.req();
      // A player bats once they know both overs are sealed: the opponent's lock became visible to them, or their own
      // lock completed the pair. Until then batting looks exactly like waiting for a lock (no timing oracle).
      if (m.meta.phase === 'open' || m.meta.phase === 'planning' || (m.meta.phase === 'batting' && !opponentKnown(m, seat, this.now).locked)) {
        fail('not_your_turn', 'both overs must be locked before batting');
      }
      if (m.meta.phase !== 'batting') fail('conflict', 'this match is over');
      const rec = m.inn[seat];
      if (!rec.state) {
        const engine = this.engine();
        rec.state = this.guard('startInnings', () => engine.startInnings(seat));
        this.stageInnings(seat);
      }
      return rec;
    }

    /**
     * Resolves the innings' next ball (the engine draws from the committed plan, the input and the seed). When it ends
     * the innings, the completion becomes visible to others after the activity jitter, or at once when its time is
     * public anyway (`publicTiming`: Auto XI and leaves at the batting deadline).
     */
    private async resolve(seat: 0 | 1, input: Parameters<SealedSixEngineApi['resolveNextBall']>[1]['input'], publicTiming = false) {
      const m = this.req();
      const rec = m.inn[seat];
      if (!rec.state) throw new Error('innings not started');
      const engine = this.engine();
      const seed = await this.seedValue();
      const plan = (await this.planOf((1 - seat) as 0 | 1)).plan;
      const ball = rec.state.nextBall;
      const state = rec.state;
      const r = this.guard('resolveNextBall', () => engine.resolveNextBall(state, { seed, conditions: m.meta.conditions, plan, input }));
      if (r.outcome.ball !== ball || r.feedback.ball !== ball) throw new Error('engine resolved an unexpected ball');
      rec.state = r.state;
      rec.inputs.push(input);
      this.metrics.count('ball_resolved', [input ? 'answered' : 'leave']);
      if (inningsOver(m.meta.kind, r.state)) {
        this.markVisible('done', seat, publicTiming || m.meta.kind === 'daily' ? 0 : this.jitterMs());
        this.touch();
      }
      return r;
    }

    /**
     * The engine's timing audit over the player's own answers (live and late; Auto XI and leaves are not theirs), run
     * once at the reveal when every answer of the innings is recorded. The deliveries are re-derived from the sealed
     * over, so nothing extra is stored. A flag only: the Top 100 (src/engine/ranking.ts) reads it with the late count.
     */
    private auditInnings(seat: 0 | 1, plan: OverPlan): void {
      const audit = deps.helpers.timingAudit;
      const m = this.req();
      const rec = m.inn[seat];
      if (!audit || rec.suspicious !== undefined) return;
      const engine = this.engine();
      const pairs: Array<{ input: BattingInput; delivery: RevealedDelivery }> = [];
      for (const [ball, a] of Object.entries(rec.answered)) {
        if (a.how !== 'live' && a.how !== 'late') continue;
        const input = rec.inputs.find((x) => x?.ball === Number(ball));
        if (input) pairs.push({ input, delivery: engine.revealDelivery(plan, input.ball, m.meta.conditions) });
      }
      try {
        const r = audit(pairs);
        rec.suspicious = r.suspicious;
        rec.bullseyes = r.bullseyes;
        if (r.suspicious) this.metrics.count('timing_suspicious', [m.meta.kind]);
      } catch {
        deps.logger.log('warn', { evt: 'timing_audit_failed' });
      }
    }

    /**
     * Settles the outstanding ball as a leave (a safe dot). The batter saw it and gave no valid answer in time (it
     * expired, had too many invalid answers, or was still waiting at the batting deadline), so it counts as missed:
     * with the late answers, more than MAX_IRREGULAR_BALLS in an innings costs Top 100 and Daily Six board eligibility.
     */
    private async settleLeave(seat: 0 | 1, how: Extract<AnswerHow, 'expired' | 'invalid' | 'deadline'>): Promise<void> {
      const m = this.req();
      const rec = m.inn[seat];
      const out = rec.outstanding;
      if (!out) return;
      const r = await this.resolve(seat, null, how === 'deadline');
      rec.answered[String(out.ball)] = { tid: out.tid, how, response: { feedback: publicFeedback(r.feedback), inningsComplete: inningsOver(m.meta.kind, r.state) } };
      rec.missed = (rec.missed ?? 0) + 1;
      rec.outstanding = null;
      rec.invalid = 0;
      this.stageInnings(seat);
      this.metrics.count('ball_resolved', [how]);
    }

    /** Persists what happened so far (a ball settled as a leave), then answers with an error. */
    private async failAfterSave(code: Parameters<typeof fail>[0], message: string): Promise<never> {
      await this.maybeReveal();
      await this.afterChange();
      throw new ApiFailure(code, message);
    }

    private async next(uid: string): Promise<Result> {
      const m = this.req();
      const seat = this.seatFor(uid);
      const rec = this.batting(seat);
      const opp = (await this.planOf((1 - seat) as 0 | 1)).plan;
      const out = rec.outstanding;
      if (out) {
        if (this.now - out.revealedMs <= this.cfg.ballLiveMs) {
          return { status: 200, body: { delivery: out.delivery, ballToken: out.token, field: opp.field, ballsLeft: out.ballsLeft } satisfies NextBallResponse };
        }
        await this.settleLeave(seat, 'expired');
      }
      if (!rec.state || inningsOver(m.meta.kind, rec.state)) return this.failAfterSave('conflict', 'your innings is complete');
      const engine = this.engine();
      const ball = rec.state.nextBall;
      const delivery = publicDelivery(this.guard('revealDelivery', () => engine.revealDelivery(opp, ball, m.meta.conditions)));
      if (delivery.ball !== ball) throw new Error('engine revealed an unexpected ball');
      const tid = randomHex(16);
      const token = await issueBallToken(tokenKeys(this.env, deps.logger), { m: m.meta.matchId, p: seat, b: ball, t: tid, r: this.now });
      // Still to come after this ball: up to the Super Ball, or up to the sixth ball of a Daily Six attempt.
      const ballsLeft = Math.max(0, (m.meta.kind === 'daily' ? BALLS_PER_OVER - 1 : SUPER_BALL_INDEX) - ball);
      rec.outstanding = { ball, tid, revealedMs: this.now, delivery, token, ballsLeft };
      rec.invalid = 0;
      this.stageInnings(seat);
      this.metrics.count('ball_revealed');
      return { status: 200, body: { delivery, ballToken: token, field: opp.field, ballsLeft } satisfies NextBallResponse };
    }

    private async shot(uid: string, rawInput: unknown, rawToken: unknown): Promise<Result> {
      const m = this.req();
      const seat = this.seatFor(uid);
      const claims = await verifyBallToken(tokenKeys(this.env, deps.logger), rawToken);
      if (!claims) fail('invalid', 'invalid ball token');
      if (claims.m !== m.meta.matchId || claims.p !== seat) fail('invalid', 'this ball token belongs to another innings');
      const rec = m.inn[seat];
      const settled = rec.answered[String(claims.b)];
      if (settled && settled.tid === claims.t) {
        if (settled.how === 'live' || settled.how === 'late') return { status: 200, body: settled.response };
        fail('deadline_passed', "the ball's answer window passed; it counted as a leave");
      }
      this.batting(seat);
      const out = rec.outstanding;
      if (!out || out.tid !== claims.t || out.ball !== claims.b) fail('conflict', 'this ball is not waiting for an answer');
      const elapsed = this.now - out.revealedMs;
      const input = cleanBattingInput(rawInput);
      const invalid = async (message: string): Promise<never> => {
        rec.invalid += 1;
        if (rec.invalid >= MAX_INVALID_SHOTS) {
          await this.settleLeave(seat, 'invalid');
          return this.failAfterSave('invalid', 'too many invalid answers; the ball counted as a leave');
        }
        this.stageInnings(seat);
        return this.failAfterSave('invalid', message);
      };
      if (!input) return invalid('shot input is malformed');
      if (input.ball !== out.ball) return invalid('the input is for another ball');
      const engine = this.engine();
      const checked = this.guard('validateBattingInput', () => engine.validateBattingInput(input, out.delivery));
      if (!checked.ok) return invalid(`shot rejected: ${checked.errors.slice(0, 2).join('; ').slice(0, 200)}`);
      if (checked.input.clientElapsedMs > elapsed + CLIENT_CLOCK_SLACK_MS) return invalid('the shot timing does not match the delivery');
      let how: AnswerHow;
      if (elapsed <= this.cfg.ballLiveMs) how = 'live';
      else if (checked.input.clientElapsedMs <= this.cfg.ballLiveMs) how = 'late';
      else {
        await this.settleLeave(seat, 'expired');
        return this.failAfterSave('deadline_passed', "the ball's answer window passed; it counted as a leave");
      }
      const r = await this.resolve(seat, checked.input);
      const response: ShotResponse = { feedback: publicFeedback(r.feedback), inningsComplete: inningsOver(m.meta.kind, r.state) };
      rec.answered[String(out.ball)] = { tid: out.tid, how, response };
      if (how === 'late') rec.late = (rec.late ?? 0) + 1;
      rec.outstanding = null;
      rec.invalid = 0;
      this.stageInnings(seat);
      this.metrics.count('ball_resolved', [how]);
      await this.maybeReveal();
      return { status: 200, body: response };
    }

    private async publishReveal(): Promise<void> {
      const m = this.req();
      const engine = this.engine();
      const seed = await this.seedValue();
      const p0 = await this.planOf(0);
      const p1 = await this.planOf(1);
      const c0 = m.commits[0];
      const c1 = m.commits[1];
      const s1 = m.seats[1];
      const st0 = m.inn[0].state;
      const st1 = m.inn[1].state;
      if (!c0 || !c1 || !s1 || !st0 || !st1) throw new Error('reveal before both innings');
      for (const [p, c] of [[p0, c0], [p1, c1]] as const) {
        const h = await this.guardAsync('commitHash', () => engine.commitHash(p.plan, p.salt));
        if (h !== c.hash) throw new Error('commit hash mismatch at reveal');
      }
      const commits: [CommitRecord, CommitRecord] = [
        { player: 0, hash: c0.hash, sig: c0.sig, keyId: c0.keyId, lockedHour: c0.lockedHour, salt: p0.salt, ...(c0.auto ? { auto: true } : {}) },
        { player: 1, hash: c1.hash, sig: c1.sig, keyId: c1.keyId, lockedHour: c1.lockedHour, salt: p1.salt, ...(c1.auto ? { auto: true } : {}) },
      ];
      const log: MatchEventLog = this.guard('buildMatchLog', () =>
        engine.buildMatchLog({
          matchId: m.meta.matchId,
          kind: m.meta.kind,
          seed,
          conditions: m.meta.conditions,
          players: [m.seats[0].ref, s1.ref],
          commits,
          plans: [p0.plan, p1.plan],
          inputs: [m.inn[0].inputs, m.inn[1].inputs],
          innings: [st0, st1],
          meta: { createdHour: hourIso(m.meta.createdMs), revealedHour: hourIso(this.now), ...(m.meta.cup ? { tournamentId: m.meta.cup.cupId, fixtureId: m.meta.cup.fixtureId, stage: m.meta.cup.stage } : {}) },
        }),
      );
      if (this.env.VERIFY_REVEALS === '1') {
        const verified = await this.guardAsync('verifyMatchLog', () => engine.verifyMatchLog(log));
        if (!verified.ok) {
          this.metrics.count('engine_error', ['verify']);
          throw new Error('revealed log failed verification');
        }
      }
      this.auditInnings(0, p1.plan);
      this.auditInnings(1, p0.plan);
      this.stage('log', await gzip(JSON.stringify(log)));
      m.meta.phase = 'revealed';
      m.meta.revealedMs = this.now;
      this.compactAfterReveal();
      this.touch();
      if (m.meta.kind === 'duel') {
        // A cup reveals a whole round together and notifies once; a duel tells its two players and its room.
        this.notice(0, 'reveal_ready');
        this.notice(1, 'reveal_ready');
        this.room({ op: 'post', kind: 'reveal_ready', payload: { matchId: m.meta.matchId } });
        this.room({
          op: 'post',
          kind: 'scorecard',
          payload: {
            matchId: m.meta.matchId,
            homeAlias: m.seats[0].ref.alias,
            awayAlias: s1.ref.alias,
            homeRuns: log.innings[0].runs,
            homeWickets: log.innings[0].wickets,
            awayRuns: log.innings[1].runs,
            awayWickets: log.innings[1].wickets,
            winnerAlias: log.result.winner === null ? null : log.players[log.result.winner].alias,
            tie: log.result.tie,
            decidedBy: log.result.decidedBy,
          },
          refs: [['homeAlias', m.seats[0].ref.id], ['awayAlias', s1.ref.id], ...(log.result.winner === null ? [] : ([['winnerAlias', (log.result.winner === 0 ? m.seats[0] : s1).ref.id]] as Array<[string, string]>))],
        });
      }
      this.audits.push({ uid: null, action: 'match_revealed', detail: { engine: m.meta.engine, seedCommit: m.meta.seedCommit } });
      this.metrics.count('match_revealed');
    }

    /**
     * Everything the replay now holds is dropped from the working state: the encrypted plans and seed (the log carries
     * plans, salts and the seed, and the hashes were re-checked first), the inputs, outcomes and outstanding balls.
     * What stays: seats, commits, the per-ball answers (for duplicate shots) and the compressed log.
     */
    private compactAfterReveal(): void {
      const m = this.req();
      for (const seat of [0, 1] as const) {
        const rec = m.inn[seat];
        rec.inputs = [];
        rec.outstanding = null;
        if (rec.state) rec.state = { ...rec.state, outcomes: [], superBall: null };
        rec.idem = { next: null, shots: rec.idem?.shots ?? [] };
        this.stageInnings(seat);
      }
      for (const k of ['secret', 'plan0', 'plan1']) {
        this.pending.delete(k);
        this.deletes.add(k);
      }
    }

    private async storedLog(): Promise<MatchEventLog> {
      const staged = this.pending.get('log') as Uint8Array | undefined;
      const bytes = staged ?? (await this.state.storage.get<Uint8Array>(['log'])).get('log');
      if (!bytes) throw new Error('log missing');
      return JSON.parse(await gunzip(bytes)) as MatchEventLog;
    }

    private async reveal(uid: string): Promise<Result> {
      const m = this.req();
      this.seatFor(uid);
      if (m.meta.phase !== 'revealed') fail('sealed', 'the result stays sealed until both innings are done or the deadline passes');
      return { status: 200, body: await this.storedLog() };
    }

    /**
     * One rematch offer per duel, whoever asks first. Asking again (either player) returns that same offer while it can
     * still be accepted: the opponent accepts it through its invitation (MatchView.rematch tells the two apart); an
     * expired offer is replaced by a new one from whoever asks now.
     */
    private async rematch(uid: string, ref: Seat['ref']): Promise<Result> {
      const m = this.req();
      const seat = this.seatFor(uid);
      const webOrigin = publicWebOrigin(this.env);
      const offer = m.meta.rematch;
      if (offer && (offer.expMs === undefined || this.now < offer.expMs)) {
        const body: CreateDuelResponse = { matchId: offer.matchId, inviteToken: offer.inviteToken, inviteUrl: inviteUrl(webOrigin, offer.inviteToken) };
        return { status: 200, body };
      }
      if (m.meta.phase !== 'revealed' && m.meta.phase !== 'expired') fail('conflict', 'this match is still in progress');
      const opponent = m.seats[(1 - seat) as 0 | 1];
      if (!opponent || opponent.uid.startsWith('x:')) fail('conflict', 'there is no opponent to challenge again');
      const matchId = randomId('m');
      const lockByMs = this.now + this.cfg.duelLockMs;
      const created = await callMatch<{ inviteToken: string }>(this.env, this.cfg, matchId, {
        op: 'create',
        matchId,
        kind: 'duel',
        conditions: m.meta.conditions,
        creator: { uid, ref },
        lockByMs,
        batByMs: lockByMs + this.cfg.duelBatMs,
        revealAtMs: null,
        inviteExpMs: lockByMs,
        reservedFor: opponent.uid,
        rematchOf: m.meta.matchId,
      });
      m.meta.rematch = { matchId, inviteToken: created.body.inviteToken, by: seat, expMs: lockByMs };
      // touch(): both players' match lists (D1) carry the offer, so the opponent finds it on their home screen.
      this.touch();
      this.notice((1 - seat) as 0 | 1, 'rematch');
      this.room({ op: 'post', kind: 'rematch', payload: { matchId, fromAlias: ref.alias, fromId: ref.id, rematchOf: m.meta.matchId }, refs: [['fromAlias', ref.id], ['fromId', ref.id]] });
      this.metrics.count('duel_created', ['rematch']);
      const body: CreateDuelResponse = { matchId, inviteToken: created.body.inviteToken, inviteUrl: inviteUrl(webOrigin, created.body.inviteToken) };
      return { status: 201, body };
    }

    /** A Group Cup fixture: both seats known, planning starts at once, the cup's room and reveal time apply. */
    private async createFixture(op: CreateFixtureOp): Promise<Result> {
      if (this.m) {
        if (this.m.meta.matchId === op.matchId && this.m.meta.cup?.fixtureId === op.cup.fixtureId) return { status: 200, body: { ok: true } };
        fail('conflict', 'match already exists');
      }
      if (!MATCH_ID_RE.test(op.matchId) || !isConditions(op.conditions) || !(op.batByMs > op.lockByMs) || op.revealAtMs < op.batByMs) fail('invalid', 'bad fixture parameters');
      const engine = deps.engines.current();
      const seed = randomHex(16);
      const meta: MatchMeta = {
        v: 1,
        matchId: op.matchId,
        kind: 'cup',
        engine: engine.ENGINE_VERSION,
        createdMs: this.now,
        conditions: { pitch: op.conditions.pitch, weather: op.conditions.weather },
        lockByMs: op.lockByMs,
        batByMs: op.batByMs,
        revealAtMs: op.revealAtMs,
        inviteNonce: '',
        inviteExpMs: 0,
        inviteToken: '',
        reservedFor: null,
        rematchOf: null,
        rematch: null,
        phase: 'planning',
        rev: 0,
        seedCommit: await sha256Hex(seed),
        revealedMs: null,
        syncPending: false,
        cup: { ...op.cup },
        roomId: op.roomId,
        reminded: [false, false],
        recorded: false,
      };
      this.m = { meta, seats: [{ uid: op.seats[0].uid, ref: op.seats[0].ref }, { uid: op.seats[1].uid, ref: op.seats[1].ref }], commits: [null, null], inn: [emptyInnings(), emptyInnings()] };
      this.seed = seed;
      this.stage('secret', await seal(dataKeys(this.env, deps.logger).active, 'secret', op.matchId, JSON.stringify({ seed }), op.matchId));
      this.stage('seat0', this.m.seats[0]);
      this.stage('seat1', this.m.seats[1]);
      this.stage('inn0', this.m.inn[0]);
      this.stage('inn1', this.m.inn[1]);
      this.touch();
      this.cupDirty = false;
      return { status: 201, body: { ok: true } };
    }

    /** One Daily Six attempt: the day's over for this attempt is sealed by the server; only the player bats. */
    private async createDaily(op: CreateDailyOp): Promise<Result> {
      if (this.m) {
        if (this.m.meta.matchId === op.matchId && this.m.seats[0].uid === op.player.uid) return { status: 200, body: { ok: true } };
        fail('conflict', 'attempt already exists');
      }
      if (!MATCH_ID_RE.test(op.matchId) || ![1, 2, 3].includes(op.attempt) || !(op.batByMs > this.now)) fail('invalid', 'bad attempt parameters');
      const engine = deps.engines.current();
      // The day's overs are the same for everyone behind a server-only salt; every attempt gets a fresh secret seed.
      const serverSalt = await dailySalt(this.env, deps.logger);
      const challenge = this.guard('dailyChallenge', () => engine.dailyChallenge(op.day, serverSalt));
      const over = challenge.overs[op.attempt - 1];
      const commit = await this.dailyCommit(op.day, op.attempt, serverSalt, over);
      const seed = randomHex(16);
      const meta: MatchMeta = {
        v: 1,
        matchId: op.matchId,
        kind: 'daily',
        engine: engine.ENGINE_VERSION,
        createdMs: this.now,
        conditions: { pitch: challenge.conditions.pitch, weather: challenge.conditions.weather },
        lockByMs: this.now,
        batByMs: op.batByMs,
        revealAtMs: null,
        inviteNonce: '',
        inviteExpMs: 0,
        inviteToken: '',
        reservedFor: null,
        rematchOf: null,
        rematch: null,
        phase: 'batting',
        rev: 0,
        seedCommit: await sha256Hex(seed),
        revealedMs: null,
        syncPending: false,
        roomId: null,
        reminded: [true, true],
        recorded: false,
        daily: { day: op.day, attempt: op.attempt, city: op.city, score: null },
      };
      this.m = { meta, seats: [{ uid: op.player.uid, ref: op.player.ref }, { uid: 'daily:setter', ref: DAILY_SETTER }], commits: [null, null], inn: [emptyInnings(), emptyInnings()] };
      this.seed = seed;
      this.stage('secret', await seal(dataKeys(this.env, deps.logger).active, 'secret', op.matchId, JSON.stringify({ seed }), op.matchId));
      await this.sealPlan(1, over, false, false, commit.salt);
      this.stage('seat0', this.m.seats[0]);
      this.stage('seat1', this.m.seats[1]);
      this.stage('inn0', this.m.inn[0]);
      this.stage('inn1', this.m.inn[1]);
      this.stage('meta', meta);
      this.metrics.count('daily_attempt');
      return { status: 201, body: { ok: true } };
    }

    /**
     * The engine's commit for the day's over `attempt`: the same hash for every player that day (published in
     * DailyView.overCommits), its salt one-way from the server salt. Checked against the over itself, so a helper that
     * does not match the engine fails closed.
     */
    private async dailyCommit(day: string, attempt: 1 | 2 | 3, serverSalt: string, over: OverPlan): Promise<{ hash: string; salt: string }> {
      const commits = deps.helpers.dailyCommits;
      if (!commits) fail('unavailable', 'Daily Six is not available');
      const engine = deps.engines.current();
      const c = this.guard('dailyCommits', () => commits(day, serverSalt)).find((x) => x.attempt === attempt);
      if (!c || (await this.guardAsync('commitHash', () => engine.commitHash(over, c.salt))) !== c.hash) {
        this.metrics.count('engine_error', ['daily_commit']);
        deps.logger.log('error', { evt: 'daily_commit_mismatch' });
        fail('unavailable', 'Daily Six is not available');
      }
      return c;
    }

    /** The solo reveal of a Daily Six attempt: the engine scores the innings and builds the replay (engine.buildDailyLog). */
    private async publishDailyReveal(): Promise<void> {
      const m = this.req();
      const engine = this.engine();
      const st0 = m.inn[0].state;
      const d = m.meta.daily;
      const c1 = m.commits[1];
      if (!st0 || !d || !c1) throw new Error('daily reveal without an innings or a sealed over');
      const seed = await this.seedValue();
      const over = await this.planOf(1);
      const serverSalt = await dailySalt(this.env, deps.logger);
      const summary = this.guard('summarise', () => engine.summarise(st0, 0));
      d.score = this.guard('dailyScore', () => engine.dailyScore(summary));
      d.counted = irregularBalls(m.inn[0]) <= MAX_IRREGULAR_BALLS;
      if (!d.counted) this.metrics.count('daily_uncounted');
      const built = this.guard('buildDailyLog', () =>
        engine.buildDailyLog({
          attemptId: m.meta.matchId,
          day: d.day,
          attempt: d.attempt,
          seed,
          serverSalt,
          player: m.seats[0].ref,
          setter: m.seats[1]?.ref ?? DAILY_SETTER,
          inputs: m.inn[0].inputs,
          innings: st0,
          meta: { createdHour: hourIso(m.meta.createdMs), revealedHour: hourIso(this.now) },
        }),
      );
      // The replay must carry the over sealed when the attempt started (the hash shown before batting).
      const rc = built.commits[1];
      if (rc.hash !== c1.hash || rc.salt !== over.salt) throw new Error('daily replay does not match the sealed over');
      const log: MatchEventLog = { ...built, commits: [built.commits[0], { ...rc, sig: c1.sig, keyId: c1.keyId }] };
      if (this.env.VERIFY_REVEALS === '1') {
        const verified = await this.guardAsync('verifyMatchLog', () => engine.verifyMatchLog(log));
        if (!verified.ok) {
          this.metrics.count('engine_error', ['verify']);
          throw new Error('revealed daily log failed verification');
        }
      }
      this.auditInnings(0, over.plan);
      this.stage('log', await gzip(JSON.stringify(log)));
      m.meta.phase = 'revealed';
      m.meta.revealedMs = this.now;
      this.compactAfterReveal();
      this.touch();
      this.metrics.count('daily_finished');
    }

    private async dailyResult(uid: string): Promise<Result> {
      const m = this.req();
      if (m.meta.kind !== 'daily' || this.seatFor(uid) !== 0) fail('not_found', 'attempt not found');
      if (m.meta.phase !== 'revealed' || m.meta.daily?.score === null || m.meta.daily?.score === undefined) fail('sealed', 'finish the attempt to see the score');
      return { status: 200, body: { score: m.meta.daily.score, day: m.meta.daily.day, counted: m.meta.daily.counted !== false, log: await this.storedLog() } };
    }

    /** What a cup needs from its fixture (internal; results only after the reveal). */
    private async summary(): Promise<Result> {
      const m = this.req();
      const base: FixtureSummary = {
        revealed: m.meta.phase === 'revealed',
        locked: [m.commits[0] !== null, m.commits[1] !== null],
        battingDone: [m.inn[0].state?.done === true, m.inn[1].state?.done === true],
      };
      if (!base.revealed) return { status: 200, body: base };
      const log = await this.storedLog();
      const auto = (seat: 0 | 1) => Boolean(m.commits[seat]?.auto || Object.values(m.inn[seat].answered).some((a) => a.how === 'auto'));
      const body: FixtureSummary = {
        ...base,
        runs: [log.innings[0].runs, log.innings[1].runs],
        wickets: [log.innings[0].wickets, log.innings[1].wickets],
        winner: log.result.winner,
        decidedBy: log.result.decidedBy,
        auto: [auto(0), auto(1)],
        late: [m.inn[0].late ?? 0, m.inn[1].late ?? 0],
      };
      return { status: 200, body };
    }

    /**
     * A moderator's rename: the seat carries the new name in every view (both players' match lists too) and the duel's
     * room follows. The stored replay keeps the names at match time; shared links and highlights rewrite them anyway.
     */
    private async rename(uid: string, ref: PlayerRef): Promise<Result> {
      const m = this.req();
      const seat = seatOf(m, uid);
      if (seat !== null) {
        const s: Seat = { uid, ref: { ...(m.seats[seat] as Seat).ref, alias: ref.alias } };
        m.seats[seat] = s;
        this.stage(`seat${seat}`, s);
        if (m.meta.kind === 'duel') this.room({ op: 'rename', uid, ref });
        this.touch();
      }
      return { status: 200, body: { ok: true } };
    }

    /** Account deletion: the seat becomes "Deleted player" everywhere, including a revealed replay. */
    private async forget(uid: string): Promise<Result> {
      const m = this.req();
      const seat = seatOf(m, uid);
      if (seat !== null) {
        const s: Seat = { uid: `x:${randomHex(8)}`, ref: DELETED_PLAYER };
        m.seats[seat] = s;
        this.stage(`seat${seat}`, s);
        if (m.meta.phase === 'open' && seat === 0) m.meta.phase = 'expired';
        if (m.meta.reservedFor === uid) m.meta.reservedFor = 'x:deleted';
        if (m.meta.phase === 'revealed') {
          const log = await this.storedLog();
          log.players[seat] = DELETED_PLAYER;
          this.stage('log', await gzip(JSON.stringify(log)));
          // The R2 copy (logs/<matchId>.json.gz) is rewritten as well: syncIndex re-archives the anonymised log.
          m.meta.archived = false;
        }
        if (m.meta.daily) m.meta.daily.city = null;
        this.room({ op: 'forget', uid });
        this.touch();
      }
      return { status: 200, body: { ok: true } };
    }
  };
}
