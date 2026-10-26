/**
 * RoomDO: the private Cricket Room of a duel or a cup. Members only. The match or cup object posts the meaningful
 * events (spoiler-safe payloads, see protocol.ts); members react, post predefined banter (free text only when the
 * deployment enables it), mute the room or choose how much it may notify them (mirrored to D1 for the notification
 * consumer). Posts from blocked players are hidden from the blocker. Times are hour resolution.
 */
import type { PlayerRef, ReactionId, RoomPost, RoomPostKind, RoomView } from '@/contracts';
import { checkMessage } from '@/net/shared/alias';
import type { DOStateLike, Env } from '../env';
import { errorResponse, fail, failureResponse, isApiFailure } from '../http/errors';
import { hourIso, json } from '../http/http';
import { scrub, type Logger } from '../http/log';
import { analyticsEngineMetrics, type Metrics } from '../ops/metrics';
import { randomHex } from '../security/crypto';
import { SQL } from '../storage/sql';
import { DELETED_PLAYER } from '../profile/model';
import { REACTIONS, SYSTEM_KINDS, cleanPayload, isBanterId, type Payload, type PostRefs, type RoomOp, type RoomSeat } from './protocol';

export interface RoomDeps {
  now(): number;
  logger: Logger;
  metrics: Metrics;
}

export interface RoomObject {
  fetch(request: Request): Promise<Response>;
}
export type RoomObjectClass = new (state: DOStateLike, env: Env) => RoomObject;

interface RoomMeta {
  v: 1;
  roomId: string;
  kind: 'cup' | 'duel' | 'group';
  title: string;
  /** Public id of the player whose alias opens the title (duel rooms); replaced when that player is forgotten. */
  titleOwner?: string;
  createdMs: number;
  seq: number;
}

interface RoomMember extends RoomSeat {
  muted: boolean;
  notify: 'all' | 'important' | 'none';
  /** Recent banter/text times (rate limit). */
  said: number[];
}

interface PostRecord {
  seq: number;
  kind: RoomPostKind;
  payload: Payload;
  /** Internal author id (members' posts), null for system posts. */
  author: string | null;
  authorId: string | null;
  createdHour: string;
  reactions: Record<string, ReactionId>;
  /** Payload fields that name a player (protocol.ts PostRefs); internal, never shown. */
  refs?: PostRefs;
}

const MAX_POSTS = 200;
const PAGE = 30;
const SAY_PER_HOUR = 12;

export function createRoomObjectClass(deps: RoomDeps): RoomObjectClass {
  return class RoomDO implements RoomObject {
    private readonly state: DOStateLike;
    private readonly env: Env;
    private readonly metrics: Metrics;
    private meta: RoomMeta | null = null;
    private members: RoomMember[] = [];
    private posts: PostRecord[] = [];
    private upserts: Record<string, number> = {};
    private loaded = false;
    private chain: Promise<unknown> = Promise.resolve();
    private now = 0;

    constructor(state: DOStateLike, env: Env) {
      this.state = state;
      this.env = env;
      this.metrics = analyticsEngineMetrics(env.METRICS, deps.metrics);
    }

    fetch(request: Request): Promise<Response> {
      const run = this.chain.then(() => this.handle(request));
      this.chain = run.catch(() => undefined);
      return run;
    }

    private async load(): Promise<void> {
      if (this.loaded) return;
      const got = await this.state.storage.get<unknown>(['meta', 'members', 'posts', 'upserts']);
      this.meta = (got.get('meta') as RoomMeta | undefined) ?? null;
      this.members = (got.get('members') as RoomMember[] | undefined) ?? [];
      this.posts = (got.get('posts') as PostRecord[] | undefined) ?? [];
      this.upserts = (got.get('upserts') as Record<string, number> | undefined) ?? {};
      this.loaded = true;
    }

    private async save(keys: Array<'meta' | 'members' | 'posts' | 'upserts'>): Promise<void> {
      const entries: Record<string, unknown> = {};
      for (const k of keys) entries[k] = k === 'meta' ? this.meta : k === 'members' ? this.members : k === 'posts' ? this.posts : this.upserts;
      await this.state.storage.put(entries);
    }

    private member(uid: string): RoomMember {
      const m = this.members.find((x) => x.uid === uid);
      if (!m || !this.meta) fail('not_found', 'room not found');
      return m;
    }

    private async handle(request: Request): Promise<Response> {
      this.now = deps.now();
      let op: RoomOp;
      try {
        op = (await request.json()) as RoomOp;
      } catch {
        return errorResponse('invalid', 'bad internal request');
      }
      try {
        await this.load();
        const result = await this.dispatch(op);
        return json(result, 200);
      } catch (e) {
        if (isApiFailure(e)) return failureResponse(e);
        this.loaded = false;
        deps.logger.log('error', { evt: 'room_error', op: op.op, message: scrub(String((e as Error)?.message ?? e)) });
        return errorResponse('unavailable', 'room temporarily unavailable', 500);
      }
    }

    private async dispatch(op: RoomOp): Promise<unknown> {
      switch (op.op) {
        case 'create': {
          if (this.meta) return { ok: true };
          this.meta = { v: 1, roomId: op.roomId, kind: op.kind, title: op.title.slice(0, 80), ...(op.titleOwner ? { titleOwner: op.titleOwner } : {}), createdMs: this.now, seq: 0 };
          this.members = op.members.map((m) => ({ uid: m.uid, ref: m.ref, muted: false, notify: 'all', said: [] }));
          await this.save(['meta', 'members', 'posts', 'upserts']);
          return { ok: true };
        }
        case 'add_member': {
          if (!this.meta) fail('not_found', 'room not found');
          if (!this.members.some((m) => m.uid === op.member.uid)) {
            this.members.push({ uid: op.member.uid, ref: op.member.ref, muted: false, notify: 'all', said: [] });
            await this.save(['members']);
          }
          return { ok: true };
        }
        case 'post':
          return this.post(op.kind, op.payload, null, op.upsertKey, op.refs);
        case 'unpost':
          return this.unpost(op.upsertKey);
        case 'view':
          return this.view(op.uid, op.cursor, op.hidden);
        case 'react':
          return this.react(op.uid, op.postId, op.reaction);
        case 'banter': {
          const m = this.member(op.uid);
          if (!isBanterId(op.phraseId)) fail('invalid', 'unknown banter phrase');
          this.throttle(m);
          return this.post('banter', { phraseId: op.phraseId }, m);
        }
        case 'text': {
          const m = this.member(op.uid);
          if (this.env.ROOM_FREE_TEXT !== '1') fail('forbidden', 'free text is turned off; use the banter phrases');
          const check = checkMessage(op.text);
          if (!check.ok) fail('invalid', `message not allowed (${check.reason})`);
          this.throttle(m);
          return this.post('text', { text: check.value }, m);
        }
        case 'settings':
          return this.settings(op.uid, op.muted, op.notify);
        case 'forget':
          return this.forget(op.uid);
        case 'rename':
          return this.rename(op.uid, op.ref);
        case 'post_of':
          return this.postOf(op.seq);
        case 'remove_post':
          return this.removePost(op.seq);
        default:
          return fail('invalid', 'unknown operation');
      }
    }

    /**
     * A moderator's rename: the member card, and every post naming the player (whole names in system cards; a highlight
     * title's mention), so the old name is gone from this room. The title of a duel room follows too.
     */
    private async rename(uid: string, ref: PlayerRef): Promise<{ ok: true }> {
      const m = this.members.find((x) => x.uid === uid);
      if (!m || !this.meta) return { ok: true };
      const oldAlias = m.ref.alias;
      m.ref = { ...m.ref, alias: ref.alias };
      if (oldAlias && oldAlias !== ref.alias) {
        for (const p of this.posts) {
          for (const [key, id] of p.refs ?? []) {
            const v = p.payload[key];
            if (id !== m.ref.id || typeof v !== 'string') continue;
            p.payload[key] = v === oldAlias ? ref.alias : key === 'title' ? v.split(oldAlias).join(ref.alias) : v;
          }
        }
        if (this.meta.titleOwner === m.ref.id && this.meta.title.startsWith(oldAlias)) this.meta.title = `${ref.alias}${this.meta.title.slice(oldAlias.length)}`.slice(0, 80);
      }
      await this.save(['meta', 'members', 'posts']);
      return { ok: true };
    }

    private postOf(seq: number): { post: { postId: string; kind: RoomPostKind; payload: Payload; authorId: string | null; createdHour: string } | null } {
      const p = Number.isInteger(seq) ? this.posts.find((x) => x.seq === seq) : undefined;
      if (!p || !this.meta) return { post: null };
      return { post: { postId: `${this.meta.roomId}.${p.seq}`, kind: p.kind, payload: { ...p.payload }, authorId: p.authorId, createdHour: p.createdHour } };
    }

    private async removePost(seq: number): Promise<{ removed: boolean }> {
      const before = this.posts.length;
      this.posts = this.posts.filter((p) => p.seq !== seq);
      if (this.posts.length === before) return { removed: false };
      for (const [k, s] of Object.entries(this.upserts)) if (s === seq) delete this.upserts[k];
      await this.save(['posts', 'upserts']);
      return { removed: true };
    }

    private throttle(m: RoomMember): void {
      m.said = m.said.filter((t) => this.now - t < 3_600_000);
      if (m.said.length >= SAY_PER_HOUR) fail('rate_limited', 'that is enough banter for this hour', { headers: { 'retry-after': '600' } });
      m.said.push(this.now);
    }

    private async post(kind: RoomPostKind, payload: Record<string, unknown>, author: RoomMember | null, upsertKey?: string, refs?: PostRefs): Promise<{ postId: string }> {
      const meta = this.meta;
      if (!meta) fail('not_found', 'room not found');
      if (!author && !SYSTEM_KINDS.has(kind)) fail('invalid', 'not a system post kind');
      const clean = cleanPayload(kind, payload);
      const existing = upsertKey !== undefined ? this.upserts[upsertKey] : undefined;
      const record = existing !== undefined ? this.posts.find((p) => p.seq === existing) : undefined;
      const cleanRefs = refs?.filter((r) => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string').slice(0, 8);
      if (record) {
        // Updated in place (lock counts): no new post, and the original hour stays, so nothing says when it changed.
        record.payload = clean;
        if (cleanRefs?.length) record.refs = cleanRefs;
        await this.save(['posts']);
        return { postId: `${meta.roomId}.${record.seq}` };
      }
      meta.seq += 1;
      const rec: PostRecord = { seq: meta.seq, kind, payload: clean, author: author?.uid ?? null, authorId: author?.ref.id ?? null, createdHour: hourIso(this.now), reactions: {}, ...(cleanRefs?.length ? { refs: cleanRefs } : {}) };
      this.posts.push(rec);
      if (this.posts.length > MAX_POSTS) this.posts.splice(0, this.posts.length - MAX_POSTS);
      if (upsertKey !== undefined) this.upserts[upsertKey] = rec.seq;
      await this.save(['meta', 'posts', 'upserts', ...(author ? (['members'] as const) : [])]);
      this.metrics.count('room_post', [kind]);
      return { postId: `${meta.roomId}.${rec.seq}` };
    }

    private async unpost(upsertKey: string): Promise<{ ok: true }> {
      const seq = this.upserts[upsertKey];
      if (seq === undefined) return { ok: true };
      this.posts = this.posts.filter((p) => p.seq !== seq);
      delete this.upserts[upsertKey];
      await this.save(['posts', 'upserts']);
      return { ok: true };
    }

    private publicPost(p: PostRecord, uid: string): RoomPost {
      const reactions: Partial<Record<ReactionId, number>> = {};
      for (const r of Object.values(p.reactions)) reactions[r] = (reactions[r] ?? 0) + 1;
      return {
        postId: `${this.meta?.roomId}.${p.seq}`,
        kind: p.kind,
        payload: { ...p.payload },
        authorId: p.authorId,
        createdHour: p.createdHour,
        reactions,
        myReaction: p.reactions[uid] ?? null,
      };
    }

    private view(uid: string, cursor: string | null, hidden: string[]): RoomView {
      const me = this.member(uid);
      const meta = this.meta as RoomMeta;
      const before = cursor && /^\d+$/.test(cursor) ? Number(cursor) : Infinity;
      const hide = new Set(hidden);
      const visible = this.posts.filter((p) => p.seq < before && !(p.authorId && hide.has(p.authorId))).reverse();
      const page = visible.slice(0, PAGE);
      return {
        roomId: meta.roomId,
        kind: meta.kind,
        title: meta.title,
        members: this.members.map((m) => m.ref as PlayerRef),
        posts: page.map((p) => this.publicPost(p, uid)),
        cursor: visible.length > PAGE ? String(page[page.length - 1].seq) : null,
        muted: me.muted,
        notify: me.notify,
        freeText: this.env.ROOM_FREE_TEXT === '1',
      };
    }

    private async react(uid: string, postId: string, reaction: ReactionId | null): Promise<{ ok: true }> {
      this.member(uid);
      const meta = this.meta as RoomMeta;
      const m = typeof postId === 'string' ? /^(r[a-z2-7]{26})\.(\d{1,9})$/.exec(postId) : null;
      if (!m || m[1] !== meta.roomId) fail('not_found', 'post not found');
      const post = this.posts.find((p) => p.seq === Number(m[2]));
      if (!post) fail('not_found', 'post not found');
      if (reaction !== null && !REACTIONS.includes(reaction)) fail('invalid', 'unknown reaction');
      if (reaction === null) delete post.reactions[uid];
      else post.reactions[uid] = reaction;
      await this.save(['posts']);
      return { ok: true };
    }

    private async settings(uid: string, muted: boolean | undefined, notify: RoomMember['notify'] | undefined): Promise<{ ok: true }> {
      const m = this.member(uid);
      if (muted !== undefined && typeof muted !== 'boolean') fail('invalid', 'muted must be true or false');
      if (notify !== undefined && !['all', 'important', 'none'].includes(notify)) fail('invalid', 'notify must be all, important or none');
      if (muted !== undefined) m.muted = muted;
      if (notify !== undefined) m.notify = notify;
      const meta = this.meta as RoomMeta;
      if (!m.muted && m.notify === 'all') await this.env.DB.prepare(SQL.deleteRoomSetting).bind(uid, meta.roomId).run();
      else await this.env.DB.prepare(SQL.upsertRoomSetting).bind(uid, meta.roomId, m.muted ? 1 : 0, m.notify).run();
      await this.save(['members']);
      if (muted) this.metrics.count('room_muted');
      return { ok: true };
    }

    /**
     * Account deletion: the member becomes "Deleted player"; so does every payload field that named them (found by
     * their public id, never by alias text, which other players may share), and the room title if it opens with their
     * alias. A highlight card that names them is taken down (its video is withdrawn with the account).
     */
    private async forget(uid: string): Promise<{ ok: true }> {
      const m = this.members.find((x) => x.uid === uid);
      if (!m || !this.meta) return { ok: true };
      const playerId = m.ref.id;
      const oldAlias = m.ref.alias;
      const tomb = `x:${randomHex(8)}`;
      m.uid = tomb;
      m.ref = DELETED_PLAYER;
      const drop = new Set<number>();
      for (const p of this.posts) {
        if (p.author === uid) {
          p.author = tomb;
          p.authorId = DELETED_PLAYER.id;
        }
        if (p.reactions[uid]) {
          p.reactions[tomb] = p.reactions[uid];
          delete p.reactions[uid];
        }
        const named = (p.refs ?? []).filter(([, id]) => id === playerId);
        if (named.length === 0) continue;
        if (p.kind === 'highlight') {
          drop.add(p.seq);
          continue;
        }
        for (const [key] of named) if (typeof p.payload[key] === 'string') p.payload[key] = DELETED_PLAYER.alias;
        p.refs = (p.refs ?? []).filter(([, id]) => id !== playerId);
      }
      if (drop.size > 0) {
        this.posts = this.posts.filter((p) => !drop.has(p.seq));
        for (const [k, seq] of Object.entries(this.upserts)) if (drop.has(seq)) delete this.upserts[k];
      }
      if (this.meta.titleOwner === playerId) {
        this.meta.title = this.meta.title.startsWith(oldAlias) ? `${DELETED_PLAYER.alias}${this.meta.title.slice(oldAlias.length)}`.slice(0, 80) : DELETED_PLAYER.alias;
        delete this.meta.titleOwner;
      }
      await this.save(['meta', 'members', 'posts', 'upserts']);
      return { ok: true };
    }
  };
}

