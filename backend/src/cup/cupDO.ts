/**
 * CupDO: one Durable Object per Group Cup (3–10 friends). Nothing ever waits for the creator or any player:
 *
 *   gathering → at the start time the cup begins with whoever joined (at least 3; otherwise it is cancelled with a
 *   reason) → round-robin rounds (circle method, a bye for odd counts), each a lock window then a batting window, with
 *   every fixture a MatchDO (Auto Over for a joined player who misses the lock deadline, Auto XI for missed batting)
 *   → all fixtures of a round reveal together at the round's reveal time → standings (win 2, tie 1, net run rate),
 *   form and table movement → the top two play the final (stage 'final' for the enhanced presentation) → complete,
 *   with the `cup_winner` badge. Alarms drive every step; late play after a deadline is practice and never changes
 *   standings (the match objects refuse it, the replay of the opponent's over is public after the reveal).
 */
import type { Conditions, CupStatus, CupView, Fixture, InvitePreview, PitchId, PlayerRef, StandingRow, WeatherId } from '@/contracts';
import { CUP_ID_RE, roomIdFor } from '@/net/shared/ids';
import { readConfig, type Config } from '../config';
import type { DOStateLike, Env } from '../env';
import { errorResponse, fail, failureResponse, isApiFailure } from '../http/errors';
import { hourIso, json, minuteIso } from '../http/http';
import { scrub, type Logger } from '../http/log';
import { callMatch } from '../match/client';
import type { FixtureSummary, SeatInit } from '../match/protocol';
import type { NotifyKind } from '../ops/messages';
import { analyticsEngineMetrics, type Metrics } from '../ops/metrics';
import { DELETED_PLAYER } from '../profile/model';
import { roomBestEffort } from '../room/client';
import type { RoomOp } from '../room/protocol';
import { randomBytes, randomHex, randomId, timingSafeEqual } from '../security/crypto';
import { tokenKeys } from '../security/secrets';
import { issueInviteToken } from '../security/tokens';
import { issueInviteCode } from '../match/inviteCodes';
import { SQL } from '../storage/sql';
import type { CupOp, CupPace } from './protocol';
import { MAX_CUP_PLAYERS, MIN_CUP_PLAYERS, PACES, computeStandings, roundCount, roundRobin, roundUpToMinute } from './schedule';

export interface CupDeps {
  now(): number;
  logger: Logger;
  metrics: Metrics;
}

export interface CupObject {
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}
export type CupObjectClass = new (state: DOStateLike, env: Env) => CupObject;

interface CupMeta {
  v: 1;
  cupId: string;
  name: string;
  pace: CupPace;
  maxPlayers: number;
  status: CupStatus;
  createdMs: number;
  startAtMs: number;
  inviteNonce: string;
  /** The signed invite token (what an older /i/ link carries; the code below stands for it). */
  inviteToken: string;
  /** The short code of the invite link (https://<web>/i/<code>, match/inviteCodes.ts); absent on older records. */
  inviteCode?: string | null;
  roomId: string;
  cancelledReason: string | null;
  winner: number | null;
  badgePending: boolean;
}

interface CupMember {
  uid: string;
  ref: PlayerRef;
  joinedMs: number;
}

interface Slot {
  round: number | 'final';
  opensMs: number;
  lockByMs: number;
  batByMs: number;
  revealAtMs: number;
  conditions: Conditions;
  opened: boolean;
  revealed: boolean;
  /** Room deadline posts made for this round. */
  posted: { lock: boolean; bat: boolean };
}

interface CupFixture {
  fixtureId: string;
  round: number | 'final';
  home: number;
  away: number;
  matchId: string;
  status: Fixture['status'];
  /** Visible progress (after the activity jitter): counts, deadline cards and the opponent's side of a fixture. */
  locked: [boolean, boolean];
  battingDone: [boolean, boolean];
  /** Exact progress of each seat and what it knows of its opponent, shown only to that seat's player. */
  mine?: { locked: [boolean, boolean]; battingDone: [boolean, boolean]; oppLocked?: [boolean, boolean]; oppDone?: [boolean, boolean] };
  result: { runs: [number, number]; wickets: [number, number]; winner: 0 | 1 | null; auto: [boolean, boolean] } | null;
  /** Seats Auto Over sealed: their over counts as sealed (batting goes on) but never as a lock in the counts. */
  autoOver?: [boolean, boolean];
  /** Seats Auto XI batted for (announced once in the room). */
  autoXi?: [boolean, boolean];
}

/** Locks players made in these fixtures (an Auto Over is not one). */
function playerLocks(list: readonly CupFixture[]): number {
  return list.reduce((n, f) => n + f.locked.filter((l, s) => l && !f.autoOver?.[s]).length, 0);
}

type Result = { status: number; body: unknown };

const PITCHES: PitchId[] = ['green', 'hard', 'slow'];
const WEATHER: WeatherId[] = ['clear', 'humid', 'dew'];
const RETRY_MS = 15_000;

function randomConditions(): Conditions {
  const r = randomBytes(2);
  return { pitch: PITCHES[r[0] % 3], weather: WEATHER[r[1] % 3] };
}

/** A player's own fixture: their exact progress, and the opponent's only as far as it is visible. */
function ownProgress(f: CupFixture, seat: 0 | 1): { locked: boolean; done: boolean; opponentLocked: boolean; opponentDone: boolean } {
  const other = (1 - seat) as 0 | 1;
  return {
    locked: f.mine?.locked[seat] ?? f.locked[seat],
    done: f.mine?.battingDone[seat] ?? f.battingDone[seat],
    opponentLocked: f.mine?.oppLocked?.[seat] ?? f.locked[other],
    opponentDone: f.mine?.oppDone?.[seat] ?? f.battingDone[other],
  };
}

function ownStatus(f: CupFixture, seat: 0 | 1): Fixture['status'] {
  if (f.status === 'scheduled' || f.status === 'revealed' || f.status === 'void') return f.status;
  const p = ownProgress(f, seat);
  if (p.done && p.opponentDone) return 'awaiting_reveal';
  if (p.locked && p.opponentLocked) return 'batting';
  return 'planning';
}

/** Fixtures between other members: scheduled, in progress or revealed only (never which pair locked or batted, or when). */
function othersStatus(f: CupFixture): Fixture['status'] {
  return f.status === 'scheduled' || f.status === 'revealed' || f.status === 'void' ? f.status : 'planning';
}

export function createCupObjectClass(deps: CupDeps): CupObjectClass {
  return class CupDO implements CupObject {
    private readonly state: DOStateLike;
    private readonly env: Env;
    private readonly cfg: Config;
    private readonly metrics: Metrics;
    private meta: CupMeta | null = null;
    private members: CupMember[] = [];
    private slots: Slot[] = [];
    private fixtures: CupFixture[] = [];
    private ranks: number[] = [];
    private loaded = false;
    private chain: Promise<unknown> = Promise.resolve();
    private now = 0;
    private roomOps: RoomOp[] = [];
    private notices: Array<{ uid: string; kind: NotifyKind; matchId: string }> = [];
    private d1: Array<{ sql: string; params: unknown[] }> = [];

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

    private serial<T>(fn: () => Promise<T>): Promise<T> {
      const run = this.chain.then(fn, fn);
      this.chain = run.catch(() => undefined);
      return run;
    }

    private async load(): Promise<void> {
      if (this.loaded) return;
      const got = await this.state.storage.get<unknown>(['meta', 'members', 'slots', 'fixtures', 'ranks']);
      this.meta = (got.get('meta') as CupMeta | undefined) ?? null;
      this.members = (got.get('members') as CupMember[] | undefined) ?? [];
      this.slots = (got.get('slots') as Slot[] | undefined) ?? [];
      this.fixtures = (got.get('fixtures') as CupFixture[] | undefined) ?? [];
      this.ranks = (got.get('ranks') as number[] | undefined) ?? [];
      this.loaded = true;
    }

    private async save(): Promise<void> {
      await this.state.storage.put({ meta: this.meta, members: this.members, slots: this.slots, fixtures: this.fixtures, ranks: this.ranks });
    }

    private req(): CupMeta {
      if (!this.meta) fail('not_found', 'cup not found');
      return this.meta;
    }

    private memberIndex(uid: string): number {
      const i = this.members.findIndex((m) => m.uid === uid);
      if (i < 0) fail('not_found', 'cup not found');
      return i;
    }

    private room(op: RoomOp): void {
      this.roomOps.push(op);
    }

    private notice(member: number, kind: NotifyKind, matchId = ''): void {
      const m = this.members[member];
      if (m && !m.uid.startsWith('x:')) this.notices.push({ uid: m.uid, kind, matchId });
    }

    private noticeAll(kind: NotifyKind): void {
      this.members.forEach((_, i) => this.notice(i, kind));
    }

    /** Persists, then performs side effects: room posts, notifications, D1 rows, and the next alarm. */
    private async afterChange(): Promise<void> {
      await this.save();
      const meta = this.meta;
      if (!meta) return;
      for (const op of this.roomOps.splice(0)) await roomBestEffort(this.env, this.cfg, meta.roomId, op);
      for (const n of this.notices.splice(0)) {
        await this.env.NOTIFY_QUEUE?.send({ v: 1, kind: n.kind, uid: n.uid, matchId: n.matchId, cupId: meta.cupId, roomId: meta.roomId, dedupe: `${meta.cupId}:${n.kind}:${n.matchId}:${n.uid}` }).catch(() => undefined);
      }
      const jobs = this.d1.splice(0);
      if (jobs.length > 0) {
        try {
          await this.env.DB.batch(jobs.map((j) => this.env.DB.prepare(j.sql).bind(...j.params)));
        } catch {
          deps.logger.log('warn', { evt: 'cup_d1_failed' });
        }
      }
      if (meta.badgePending && meta.winner !== null) {
        const w = this.members[meta.winner];
        try {
          if (w && !w.uid.startsWith('x:')) await this.env.DB.prepare(SQL.addBadge).bind(w.uid, 'cup_winner').run();
          meta.badgePending = false;
          await this.save();
        } catch {
          deps.logger.log('warn', { evt: 'cup_badge_failed' });
        }
      }
      await this.scheduleAlarm();
    }

    private async scheduleAlarm(): Promise<void> {
      const meta = this.meta;
      let next: number | null = null;
      const consider = (t: number) => (next = next === null ? t : Math.min(next, t));
      if (meta) {
        if (meta.status === 'gathering') consider(meta.startAtMs);
        for (const s of this.slots) {
          if (!s.opened) consider(s.opensMs);
          else if (!s.revealed) {
            consider(s.revealAtMs + 1_000);
            if (!s.posted.lock) consider(this.reminderAt(s, 'lock'));
            if (!s.posted.bat) consider(this.reminderAt(s, 'bat'));
          }
        }
        if (meta.badgePending) consider(this.now + RETRY_MS);
      }
      if (next === null) await this.state.storage.deleteAlarm();
      else await this.state.storage.setAlarm(Math.max(next, this.now + 1));
    }

    private reminderAt(s: Slot, phase: 'lock' | 'bat'): number {
      const lead = (w: number) => Math.min(2 * 3_600_000, Math.floor(w / 4));
      return phase === 'lock' ? s.lockByMs - lead(s.lockByMs - s.opensMs) : s.batByMs - lead(s.batByMs - s.lockByMs);
    }

    private async handle(request: Request): Promise<Response> {
      this.now = deps.now();
      let op: CupOp;
      try {
        op = (await request.json()) as CupOp;
      } catch {
        return errorResponse('invalid', 'bad internal request');
      }
      try {
        await this.load();
        if (op.op !== 'create') {
          this.req();
          if (await this.advance()) await this.afterChange();
        }
        const result = await this.dispatch(op);
        await this.afterChange();
        return json(result.body, result.status);
      } catch (e) {
        this.roomOps = [];
        this.notices = [];
        this.d1 = [];
        if (isApiFailure(e)) {
          this.loaded = false;
          return failureResponse(e);
        }
        this.loaded = false;
        deps.logger.log('error', { evt: 'cup_error', op: op.op, message: scrub(String((e as Error)?.message ?? e)) });
        return errorResponse('unavailable', 'cup temporarily unavailable', 500);
      }
    }

    private async onAlarm(): Promise<void> {
      this.now = deps.now();
      try {
        await this.load();
        if (!this.meta) return;
        await this.advance();
        await this.afterChange();
      } catch (e) {
        this.loaded = false;
        deps.logger.log('error', { evt: 'cup_alarm_error', message: scrub(String((e as Error)?.message ?? e)) });
        throw e;
      }
    }

    private dispatch(op: CupOp): Promise<Result> {
      switch (op.op) {
        case 'create':
          return this.create(op);
        case 'preview':
          return Promise.resolve(this.preview(op.nonce));
        case 'accept':
          return this.accept(op.nonce, op.actor);
        case 'view':
          return Promise.resolve({ status: 200, body: this.view(this.memberIndex(op.uid)) });
        case 'fixture_update':
          return Promise.resolve(this.fixtureUpdate(op));
        case 'forget':
          return Promise.resolve(this.forget(op.uid));
        case 'rename':
          return Promise.resolve(this.rename(op.uid, op.ref));
        default:
          return Promise.resolve(fail('invalid', 'unknown operation'));
      }
    }

    // ---- lifecycle ------------------------------------------------------------------------------------------------

    /** Applies everything that is due. True when anything changed. */
    private async advance(): Promise<boolean> {
      const meta = this.req();
      let changed = false;
      if (meta.status === 'gathering' && this.now >= meta.startAtMs) {
        this.start();
        changed = true;
      }
      for (const s of this.slots) {
        if (!s.opened && this.now >= s.opensMs && (await this.openSlot(s))) changed = true;
        if (s.opened && !s.revealed) {
          for (const phase of ['lock', 'bat'] as const) {
            if (!s.posted[phase] && this.now >= this.reminderAt(s, phase)) {
              s.posted[phase] = true;
              const done = this.fixtures.filter((f) => f.round === s.round).every((f) => (phase === 'lock' ? f.locked.every(Boolean) : f.battingDone.every(Boolean)));
              if (!done) this.room({ op: 'post', kind: 'deadline', payload: { round: String(s.round), phase, by: minuteIso(phase === 'lock' ? s.lockByMs : s.batByMs) } });
              changed = true;
            }
          }
          if (this.now >= s.revealAtMs && (await this.revealSlot(s))) changed = true;
        }
      }
      return changed;
    }

    private start(): void {
      const meta = this.req();
      const n = this.members.length;
      if (n < MIN_CUP_PLAYERS) {
        meta.status = 'cancelled';
        meta.cancelledReason = 'fewer_than_three_players';
        this.room({ op: 'post', kind: 'standings', payload: { status: 'cancelled', reason: 'fewer_than_three_players' } });
        this.noticeAll('cup_cancelled');
        this.metrics.count('cup_cancelled');
        return;
      }
      const pace = PACES[meta.pace];
      const roundMs = pace.lockMs + pace.batMs;
      const pairs = roundRobin(n);
      this.slots = pairs.map((_, i) => {
        const opensMs = meta.startAtMs + i * roundMs;
        return { round: i + 1, opensMs, lockByMs: opensMs + pace.lockMs, batByMs: opensMs + roundMs, revealAtMs: opensMs + roundMs, conditions: randomConditions(), opened: false, revealed: false, posted: { lock: false, bat: false } };
      });
      this.fixtures = pairs.flatMap((round, i) =>
        round.map(([home, away], k) => ({ fixtureId: `f${i + 1}-${k + 1}`, round: i + 1, home, away, matchId: randomId('m'), status: 'scheduled' as const, locked: [false, false] as [boolean, boolean], battingDone: [false, false] as [boolean, boolean], result: null })),
      );
      meta.status = 'group_stage';
      this.metrics.count('cup_started', [String(n)]);
    }

    /** Creates the round's match objects (idempotent, retried until all exist), then posts and notifies. */
    private async openSlot(s: Slot): Promise<boolean> {
      const meta = this.req();
      const list = this.fixtures.filter((f) => f.round === s.round);
      let all = true;
      for (const f of list) {
        if (f.status !== 'scheduled') continue;
        const seats: [SeatInit, SeatInit] = [
          { uid: this.members[f.home].uid, ref: this.members[f.home].ref },
          { uid: this.members[f.away].uid, ref: this.members[f.away].ref },
        ];
        try {
          await callMatch(this.env, this.cfg, f.matchId, {
            op: 'create_fixture',
            matchId: f.matchId,
            cup: { cupId: meta.cupId, fixtureId: f.fixtureId, stage: s.round === 'final' ? 'final' : 'group' },
            seats,
            conditions: s.conditions,
            lockByMs: s.lockByMs,
            batByMs: s.batByMs,
            revealAtMs: s.revealAtMs,
            roomId: meta.roomId,
          });
          f.status = 'planning';
          this.notice(f.home, s.round === 'final' ? 'final' : 'new_fixture', f.matchId);
          this.notice(f.away, s.round === 'final' ? 'final' : 'new_fixture', f.matchId);
        } catch {
          all = false;
        }
      }
      if (!all) return list.some((f) => f.status === 'planning');
      s.opened = true;
      const finalFixture = s.round === 'final' ? list[0] : null;
      this.room({
        op: 'post',
        kind: 'fixture',
        payload: {
          round: String(s.round),
          stage: s.round === 'final' ? 'final' : 'group',
          fixtures: list.length,
          ...(finalFixture ? { homeAlias: this.members[finalFixture.home].ref.alias, awayAlias: this.members[finalFixture.away].ref.alias } : {}),
          lockBy: minuteIso(s.lockByMs),
          batBy: minuteIso(s.batByMs),
          revealAt: minuteIso(s.revealAtMs),
        },
        ...(finalFixture ? { refs: [['homeAlias', this.members[finalFixture.home].ref.id], ['awayAlias', this.members[finalFixture.away].ref.id]] as Array<[string, string]> } : {}),
      });
      return true;
    }

    /** At the reveal time every fixture of the round is read together (each match object reveals itself first). */
    private async revealSlot(s: Slot): Promise<boolean> {
      const list = this.fixtures.filter((f) => f.round === s.round);
      let ready = true;
      for (const f of list) {
        if (f.result) continue;
        try {
          const r = (await callMatch<FixtureSummary>(this.env, this.cfg, f.matchId, { op: 'summary' })).body;
          if (!r.revealed || !r.runs || !r.wickets || r.winner === undefined) {
            ready = false;
            continue;
          }
          f.result = { runs: r.runs, wickets: r.wickets, winner: r.winner, auto: r.auto ?? [false, false] };
          f.locked = r.locked;
          f.battingDone = r.battingDone;
          f.status = 'revealed';
        } catch {
          ready = false;
        }
      }
      if (!ready) return false;
      s.revealed = true;
      this.metrics.count('cup_round_revealed');
      this.room({ op: 'post', kind: 'reveal_ready', payload: { round: String(s.round), stage: s.round === 'final' ? 'final' : 'group' } });
      for (const f of list) {
        const r = f.result as NonNullable<CupFixture['result']>;
        const home = this.members[f.home].ref.alias;
        const away = this.members[f.away].ref.alias;
        const homeId = this.members[f.home].ref.id;
        const awayId = this.members[f.away].ref.id;
        this.room({
          op: 'post',
          kind: 'scorecard',
          payload: { matchId: f.matchId, round: String(s.round), stage: s.round === 'final' ? 'final' : 'group', homeAlias: home, awayAlias: away, homeRuns: r.runs[0], homeWickets: r.wickets[0], awayRuns: r.runs[1], awayWickets: r.wickets[1], winnerAlias: r.winner === null ? null : r.winner === 0 ? home : away, tie: r.winner === null },
          refs: [['homeAlias', homeId], ['awayAlias', awayId], ...(r.winner === null ? [] : ([['winnerAlias', r.winner === 0 ? homeId : awayId]] as Array<[string, string]>))],
        });
      }
      this.noticeAll('reveal_ready');
      const meta = this.req();
      if (s.round === 'final') {
        const f = list[0];
        const r = f.result as NonNullable<CupFixture['result']>;
        // A tied final goes to the better group-stage finisher (the home side, ranked first).
        meta.winner = r.winner === 1 ? f.away : f.home;
        meta.status = 'complete';
        meta.badgePending = true;
        this.room({ op: 'post', kind: 'achievement', payload: { badge: 'cup_winner', alias: this.members[meta.winner].ref.alias }, refs: [['alias', this.members[meta.winner].ref.id]] });
        this.noticeAll('cup_complete');
        this.metrics.count('cup_completed');
        return true;
      }
      const table = this.table();
      const leader = table[0];
      const moves = table.filter((row) => row.movement !== 0).length;
      this.room({ op: 'post', kind: 'standings', payload: { round: String(s.round), leaderAlias: leader.alias, leaderPoints: leader.points, moves }, refs: [['leaderAlias', leader.playerId]] });
      this.ranks = table.map((row) => this.members.findIndex((mm) => mm.ref.id === row.playerId));
      const last = this.slots.filter((x) => x.round !== 'final').every((x) => x.revealed);
      if (last) this.setupFinal(s);
      return true;
    }

    private setupFinal(after: Slot): void {
      const meta = this.req();
      const order = this.ranks;
      if (order.length < 2) return;
      const pace = PACES[meta.pace];
      const opensMs = after.revealAtMs;
      const slot: Slot = { round: 'final', opensMs, lockByMs: opensMs + pace.lockMs, batByMs: opensMs + pace.lockMs + pace.batMs, revealAtMs: opensMs + pace.lockMs + pace.batMs, conditions: randomConditions(), opened: false, revealed: false, posted: { lock: false, bat: false } };
      this.slots.push(slot);
      this.fixtures.push({ fixtureId: 'final', round: 'final', home: order[0], away: order[1], matchId: randomId('m'), status: 'scheduled', locked: [false, false], battingDone: [false, false], result: null });
      meta.status = 'final';
    }

    // ---- standings and views --------------------------------------------------------------------------------------

    private table(): StandingRow[] {
      const results = this.fixtures.filter((f) => f.round !== 'final' && f.result).map((f) => ({ home: f.home, away: f.away, runs: (f.result as NonNullable<CupFixture['result']>).runs, winner: (f.result as NonNullable<CupFixture['result']>).winner }));
      const rows = computeStandings(this.members.length, results);
      return rows.map((r, rank) => {
        const prev = this.ranks.indexOf(r.member);
        return {
          playerId: this.members[r.member].ref.id,
          alias: this.members[r.member].ref.alias,
          played: r.played,
          won: r.won,
          lost: r.lost,
          tied: r.tied,
          points: r.points,
          netRunRate: r.netRunRate,
          form: r.form,
          movement: prev < 0 ? 0 : prev - rank,
        };
      });
    }

    private schedule(): CupView['schedule'] {
      const meta = this.req();
      const fmt = (s: Slot) => ({ lockBy: minuteIso(s.lockByMs), batBy: minuteIso(s.batByMs), revealAt: minuteIso(s.revealAtMs) });
      if (meta.status === 'gathering' || this.slots.length === 0) {
        // Projected from the players who joined so far (at least three): the real schedule is fixed at the start.
        const pace = PACES[meta.pace];
        const n = Math.max(MIN_CUP_PLAYERS, this.members.length);
        const rounds = Array.from({ length: roundCount(n) }, (_, i) => {
          const opens = meta.startAtMs + i * (pace.lockMs + pace.batMs);
          return { round: i + 1, lockBy: minuteIso(opens + pace.lockMs), batBy: minuteIso(opens + pace.lockMs + pace.batMs), revealAt: minuteIso(opens + pace.lockMs + pace.batMs) };
        });
        return { rounds: meta.status === 'cancelled' ? [] : rounds, final: null };
      }
      const finalSlot = this.slots.find((s) => s.round === 'final');
      return { rounds: this.slots.filter((s) => s.round !== 'final').map((s) => ({ round: s.round as number, ...fmt(s) })), final: finalSlot ? fmt(finalSlot) : null };
    }

    private view(me: number): CupView {
      const meta = this.req();
      const current = this.slots.find((s) => s.opened && !s.revealed);
      const lastRevealed = [...this.slots].reverse().find((s) => s.revealed);
      const tasks: CupView['myTasks'] = [];
      for (const f of this.fixtures) {
        const found = f.home === me ? 0 : f.away === me ? 1 : -1;
        if (found < 0) continue;
        const seat = found as 0 | 1;
        const slot = this.slots.find((s) => s.round === f.round);
        if (!slot) continue;
        const own = ownProgress(f, seat);
        if (current && f.round === current.round) {
          if (!own.locked && this.now < slot.lockByMs) tasks.push({ kind: 'lock', matchId: f.matchId, by: minuteIso(slot.lockByMs) });
          else if (own.locked && own.opponentLocked && !own.done && this.now < slot.batByMs) tasks.push({ kind: 'bat', matchId: f.matchId, by: minuteIso(slot.batByMs) });
        } else if (lastRevealed && f.round === lastRevealed.round) {
          tasks.push({ kind: 'watch', matchId: f.matchId, by: null });
        }
      }
      const inRound = current ? this.fixtures.filter((f) => f.round === current.round) : [];
      return {
        cupId: meta.cupId,
        name: meta.name,
        status: meta.status,
        size: meta.maxPlayers,
        members: this.members.map((m) => m.ref),
        inviteToken: meta.status === 'gathering' ? meta.inviteCode || meta.inviteToken : null,
        schedule: this.schedule(),
        fixtures: this.fixtures.map((f) => ({
          fixtureId: f.fixtureId,
          round: f.round,
          home: this.members[f.home].ref.id,
          away: this.members[f.away].ref.id,
          matchId: f.matchId,
          status: f.home === me ? ownStatus(f, 0) : f.away === me ? ownStatus(f, 1) : othersStatus(f),
          auto: f.result?.auto ?? [false, false],
        })),
        standings: meta.status === 'gathering' || meta.status === 'cancelled' ? [] : this.table(),
        roomId: meta.roomId,
        myTasks: tasks,
        lockedCount: current ? { round: current.round === 'final' ? this.slots.length : current.round, locked: playerLocks(inRound), total: inRound.length * 2 } : null,
        // The champion only once the final is revealed (a deleted account shows as "Deleted player", like everywhere).
        winner: meta.status === 'complete' && meta.winner !== null ? (this.members[meta.winner]?.ref ?? null) : null,
      };
    }

    // ---- operations -----------------------------------------------------------------------------------------------

    private async create(op: Extract<CupOp, { op: 'create' }>): Promise<Result> {
      if (this.meta) {
        if (this.meta.cupId === op.cupId && this.members[0]?.uid === op.creator.uid) return { status: 200, body: { inviteToken: this.meta.inviteCode || this.meta.inviteToken } };
        fail('conflict', 'cup already exists');
      }
      if (!CUP_ID_RE.test(op.cupId) || !Number.isInteger(op.maxPlayers) || op.maxPlayers < MIN_CUP_PLAYERS || op.maxPlayers > MAX_CUP_PLAYERS || !Object.hasOwn(PACES, op.pace)) fail('invalid', 'bad cup parameters');
      const startAtMs = roundUpToMinute(this.now + PACES[op.pace].gatherMs);
      const nonce = randomHex(16);
      const inviteToken = await issueInviteToken(tokenKeys(this.env, deps.logger), { kind: 'cup', targetId: op.cupId, nonce, expMs: startAtMs });
      // The short code the link carries (null when D1 cannot take it: the link then carries the token itself).
      const inviteCode = await issueInviteCode(this.env.DB, inviteToken, startAtMs, this.now);
      this.meta = {
        v: 1,
        cupId: op.cupId,
        name: op.name,
        pace: op.pace,
        maxPlayers: op.maxPlayers,
        status: 'gathering',
        createdMs: this.now,
        startAtMs,
        inviteNonce: nonce,
        inviteToken,
        inviteCode,
        roomId: roomIdFor(op.cupId),
        cancelledReason: null,
        winner: null,
        badgePending: false,
      };
      this.members = [{ uid: op.creator.uid, ref: op.creator.ref, joinedMs: this.now }];
      this.room({ op: 'create', roomId: this.meta.roomId, kind: 'cup', title: op.name, members: [op.creator] });
      this.room({ op: 'post', kind: 'invite', payload: { kind: 'cup', inviterAlias: op.creator.ref.alias, cupName: op.name }, refs: [['inviterAlias', op.creator.ref.id]] });
      this.d1.push({ sql: SQL.insertCupPlayer, params: [op.creator.uid, op.cupId, hourIso(this.now)] });
      this.metrics.count('cup_created', [op.pace]);
      return { status: 201, body: { inviteToken: inviteCode || inviteToken } };
    }

    private preview(nonce: string): Result {
      const meta = this.req();
      if (typeof nonce !== 'string' || !timingSafeEqual(nonce, meta.inviteNonce)) fail('not_found', 'invite not found');
      if (meta.status !== 'gathering' || this.now >= meta.startAtMs) fail('deadline_passed', 'this cup has already started');
      const body: InvitePreview = { kind: 'cup', inviterAlias: this.members[0].ref.alias, conditions: null, cupName: meta.name, members: this.members.length, expiresAt: minuteIso(meta.startAtMs) };
      return { status: 200, body };
    }

    private async accept(nonce: string, actor: SeatInit): Promise<Result> {
      const meta = this.req();
      if (typeof nonce !== 'string' || !timingSafeEqual(nonce, meta.inviteNonce)) fail('not_found', 'invite not found');
      if (this.members.some((m) => m.uid === actor.uid)) return { status: 200, body: { cupId: meta.cupId } };
      if (meta.status !== 'gathering' || this.now >= meta.startAtMs) fail('deadline_passed', 'this cup has already started');
      if (this.members.length >= meta.maxPlayers) fail('conflict', 'this cup is full');
      this.members.push({ uid: actor.uid, ref: actor.ref, joinedMs: this.now });
      this.room({ op: 'add_member', member: actor });
      this.d1.push({ sql: SQL.insertCupPlayer, params: [actor.uid, meta.cupId, hourIso(this.now)] });
      this.metrics.count('cup_joined');
      return { status: 200, body: { cupId: meta.cupId } };
    }

    /** A fixture's match object reports lock and batting progress (counts only reach the room). */
    private fixtureUpdate(op: Extract<CupOp, { op: 'fixture_update' }>): Result {
      const f = this.fixtures.find((x) => x.fixtureId === op.fixtureId && x.matchId === op.matchId);
      if (!f) fail('not_found', 'fixture not found');
      const before = playerLocks([f]);
      f.locked = [Boolean(op.locked[0]), Boolean(op.locked[1])];
      f.battingDone = [Boolean(op.battingDone[0]), Boolean(op.battingDone[1])];
      // Auto Over / Auto XI stepped in for a player: said plainly in the room, once per seat and kind.
      for (const [phase, now] of [['auto_over', op.autoOver], ['auto_xi', op.autoXi]] as const) {
        if (!now) continue;
        const was = phase === 'auto_over' ? f.autoOver : f.autoXi;
        for (const seat of [0, 1] as const) {
          const member = this.members[seat === 0 ? f.home : f.away];
          if (now[seat] && !was?.[seat] && member && !member.uid.startsWith('x:')) {
            this.room({ op: 'post', kind: 'deadline', payload: { round: String(f.round), phase, alias: member.ref.alias }, refs: [['alias', member.ref.id]] });
          }
        }
        if (phase === 'auto_over') f.autoOver = [Boolean(now[0]), Boolean(now[1])];
        else f.autoXi = [Boolean(now[0]), Boolean(now[1])];
      }
      const exact = op.exact ?? { locked: op.locked, battingDone: op.battingDone };
      const pair = (x: [boolean, boolean] | undefined): [boolean, boolean] | undefined => (x ? [Boolean(x[0]), Boolean(x[1])] : undefined);
      f.mine = {
        locked: [Boolean(exact.locked[0]), Boolean(exact.locked[1])],
        battingDone: [Boolean(exact.battingDone[0]), Boolean(exact.battingDone[1])],
        ...(exact.oppLocked ? { oppLocked: pair(exact.oppLocked) } : {}),
        ...(exact.oppDone ? { oppDone: pair(exact.oppDone) } : {}),
      };
      if (f.status !== 'revealed') {
        if (op.revealed) f.status = 'awaiting_reveal';
        else if (f.battingDone[0] && f.battingDone[1]) f.status = 'awaiting_reveal';
        else if (f.locked[0] && f.locked[1]) f.status = 'batting';
      }
      const slot = this.slots.find((s) => s.round === f.round);
      if (slot && !slot.revealed && playerLocks([f]) !== before) {
        const inRound = this.fixtures.filter((x) => x.round === f.round);
        // Updated in place, one post per round: "4 of 6 locked", never who and never when.
        this.room({ op: 'post', kind: 'lock_status', payload: { round: String(f.round), locked: playerLocks(inRound), total: inRound.length * 2 }, upsertKey: `lock:${f.round}` });
      }
      return { status: 200, body: { ok: true } };
    }

    /** A moderator's rename: the member's place in the table and the fixtures, and the cup's room. */
    private rename(uid: string, ref: PlayerRef): Result {
      const i = this.members.findIndex((m) => m.uid === uid);
      if (i >= 0) {
        this.members[i] = { ...this.members[i], ref: { ...this.members[i].ref, alias: ref.alias } };
        this.room({ op: 'rename', uid, ref });
      }
      return { status: 200, body: { ok: true } };
    }

    private forget(uid: string): Result {
      const meta = this.req();
      const i = this.members.findIndex((m) => m.uid === uid);
      if (i < 0) return { status: 200, body: { ok: true } };
      if (meta.status === 'gathering') {
        // Before the start a departing player simply frees the place (nobody's fixtures exist yet).
        if (i === 0 && this.members.length === 1) {
          meta.status = 'cancelled';
          meta.cancelledReason = 'creator_left';
        }
        this.members.splice(i, 1);
      } else {
        this.members[i] = { uid: `x:${randomHex(8)}`, ref: DELETED_PLAYER, joinedMs: this.members[i].joinedMs };
      }
      this.room({ op: 'forget', uid });
      return { status: 200, body: { ok: true } };
    }
  };
}
