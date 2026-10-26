/**
 * The report queue (admin console, src/admin): every report players filed (POST /v1/report), newest first, filtered by
 * status and kind, with what a moderator needs to decide: the reported player as they are now (name, account state,
 * suspension, how many open reports they have) and, for a reported post, the post itself from its Cricket Room. The
 * reporter is never shown: reports carry an opaque reference that nobody can turn back into a player.
 *
 * Actions (each one audited in audit_log with the moderator's Access identity, and counted as `admin_action`):
 *   dismiss      close the report, nothing else changes;
 *   rename       give the reported player a generated, safe name (like a new guest's) everywhere it shows: the
 *                account, frozen Top 100 rows, highlight titles in the app, every match, cup and room of theirs;
 *   suspend      pause the account's social features for 1–365 days (posting in rooms, creating or joining cups and
 *                groups, changing the name); matches and Daily Six keep working;
 *   unsuspend    lift that pause early (an appeal, a mistake);
 *   remove-post  take a reported post down from its room.
 */
import type { AdminReport, AdminReportStatus } from '@/admin/types';
import { generatedAlias } from '@/net/shared/alias';
import type { RequestContext } from '../http/context';
import { fail } from '../http/errors';
import { hourIso } from '../http/http';
import type { Reply } from '../http/router';
import { audit } from '../ops/audit';
import { randomBytes } from '../security/crypto';
import { SQL } from '../storage/sql';
import { callRoom } from '../room/client';
import { activeAccount, playerRefOf } from '../profile/model';
import { retitleHighlights } from '../profile/routes';

const LIST_LIMIT = 50;
/** Renames carried to this many of the player's matches (the newest; older ones keep the match-time name). */
const RENAME_MATCHES = 200;
const DAY_MS = 86_400_000;
const POST_ID_RE = /^(r[a-z2-7]{26})\.(\d{1,9})$/;

interface ReportRow {
  id: number;
  target_kind: 'player' | 'post';
  target_id: string;
  player_id: string | null;
  reason: AdminReport['reason'];
  status: AdminReportStatus;
  created_hour: string;
  resolved_hour: string | null;
  resolution: string | null;
}

interface RoomPostOf {
  post: { postId: string; kind: string; payload: Record<string, unknown>; authorId: string | null; createdHour: string } | null;
}

function notes(ctx: RequestContext): string {
  const n = (ctx.body as { notes?: unknown } | undefined)?.notes;
  return typeof n === 'string' ? n.trim().slice(0, 500) : '';
}

async function reportParam(ctx: RequestContext): Promise<ReportRow> {
  const id = /^\d{1,12}$/.test(ctx.params.reportId) ? Number(ctx.params.reportId) : NaN;
  const row = Number.isSafeInteger(id) ? await ctx.env.DB.prepare(SQL.reportById).bind(id).first<ReportRow>() : null;
  if (!row) fail('not_found', 'report not found');
  return row;
}

async function postOf(ctx: RequestContext, postId: string): Promise<RoomPostOf['post']> {
  const m = POST_ID_RE.exec(postId);
  if (!m) return null;
  try {
    return (await callRoom<RoomPostOf>(ctx.env, ctx.cfg, m[1], { op: 'post_of', seq: Number(m[2]) })).body.post;
  } catch {
    return null;
  }
}

/** The reported player: the report's own player id, else a reported post's author. */
async function playerIdOf(ctx: RequestContext, row: ReportRow, post?: RoomPostOf['post']): Promise<string | null> {
  if (row.player_id) return row.player_id;
  if (row.target_kind === 'player') return row.target_id;
  const p = post === undefined ? await postOf(ctx, row.target_id) : post;
  return p?.authorId ?? null;
}

async function adminReport(ctx: RequestContext, row: ReportRow): Promise<AdminReport> {
  const db = ctx.env.DB;
  const post = row.target_kind === 'post' ? await postOf(ctx, row.target_id) : null;
  const playerId = await playerIdOf(ctx, row, post);
  const account = playerId ? await db.prepare(SQL.accountByPlayerId).bind(playerId).first<{ uid: string; player_id: string; status: string; alias: string; social_suspended_until: number | null }>() : null;
  const open = playerId ? await db.prepare(SQL.openReportsOfPlayer).bind(playerId).first<{ n: number }>() : null;
  const history = await db.prepare(SQL.reportHistory).bind(`report:${row.id}`).all<{ at_ms: number; detail: string | null }>();
  const payload = post?.payload ?? {};
  return {
    id: row.id,
    kind: row.target_kind,
    reason: row.reason,
    status: row.status,
    createdHour: row.created_hour,
    resolvedHour: row.resolved_hour,
    resolution: row.resolution,
    player: playerId
      ? {
          playerId,
          alias: account?.status === 'active' ? account.alias : null,
          status: account ? (account.status === 'active' ? 'active' : 'deleted') : 'unknown',
          suspendedUntil: account?.social_suspended_until && account.social_suspended_until > ctx.now ? new Date(account.social_suspended_until).toISOString() : null,
          openReports: open?.n ?? 0,
        }
      : null,
    post:
      row.target_kind === 'post'
        ? {
            postId: row.target_id,
            present: post !== null,
            kind: post?.kind ?? null,
            text: typeof payload.text === 'string' ? payload.text : null,
            phraseId: typeof payload.phraseId === 'string' ? payload.phraseId : null,
            createdHour: post?.createdHour ?? null,
          }
        : null,
    history: history.results.map((h) => {
      const d = (h.detail ? JSON.parse(h.detail) : {}) as { action?: string; admin?: string; notes?: string };
      return { at: hourIso(h.at_ms), action: d.action ?? 'unknown', admin: d.admin ?? 'unknown', notes: d.notes ?? '' };
    }),
  };
}

export async function listReports(ctx: RequestContext): Promise<Reply> {
  const status = ctx.url.searchParams.get('status') ?? 'open';
  const kind = ctx.url.searchParams.get('kind');
  if (!['open', 'closed'].includes(status)) fail('invalid', "status must be 'open' or 'closed'");
  if (kind !== null && kind !== 'player' && kind !== 'post') fail('invalid', "kind must be 'player' or 'post'");
  const db = ctx.env.DB;
  const rows = status === 'open' ? await db.prepare(SQL.reportsByStatus).bind('open', kind, LIST_LIMIT).all<ReportRow>() : await db.prepare(SQL.reportsClosed).bind(kind, LIST_LIMIT).all<ReportRow>();
  const counts: Record<string, number> = {};
  for (const c of (await db.prepare(SQL.reportCounts).all<{ status: string; n: number }>()).results) counts[c.status] = c.n;
  const reports: AdminReport[] = [];
  for (const r of rows.results) reports.push(await adminReport(ctx, r));
  return { status: 200, body: { reports, counts: { open: counts.open ?? 0, closed: (counts.dismissed ?? 0) + (counts.actioned ?? 0) } } };
}

async function record(ctx: RequestContext, row: ReportRow, action: string, status: AdminReportStatus, playerId: string | null, detail: Record<string, string | number | boolean> = {}): Promise<void> {
  await ctx.env.DB.prepare(SQL.resolveReport).bind(row.id, status, action, hourIso(ctx.now), playerId).run();
  ctx.deps.metrics.count('admin_action', [`report_${action}`]);
  const n = notes(ctx);
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: null, action: 'admin_report', target: `report:${row.id}`, detail: { action, admin: ctx.admin?.id ?? 'unknown', ...(n ? { notes: n } : {}), ...detail } });
}

/** The reported player's active account, or a 409 the console shows (deleted meanwhile, or never known). */
async function reportedAccount(ctx: RequestContext, row: ReportRow) {
  const playerId = await playerIdOf(ctx, row);
  const found = playerId ? await ctx.env.DB.prepare(SQL.accountByPlayerId).bind(playerId).first<{ uid: string }>() : null;
  const account = found ? await activeAccount(ctx.env.DB, found.uid) : null;
  if (!playerId || !account) fail('conflict', 'the reported player has no active account');
  return { playerId, account };
}

export async function dismissReport(ctx: RequestContext): Promise<Reply> {
  const row = await reportParam(ctx);
  await record(ctx, row, 'dismissed', 'dismissed', row.player_id);
  return { status: 200, body: { status: 'dismissed' } };
}

export async function renameReported(ctx: RequestContext): Promise<Reply> {
  const row = await reportParam(ctx);
  const { playerId, account } = await reportedAccount(ctx, row);
  const db = ctx.env.DB;
  let alias = generatedAlias(randomBytes(3));
  for (let i = 0; i < 3 && alias === account.alias; i++) alias = generatedAlias(randomBytes(3));
  const ref = { ...playerRefOf(account), alias };
  await db.batch([
    db.prepare(SQL.renameAccount).bind(account.uid, alias, ctx.now),
    db.prepare(SQL.renameTop100Entries).bind(account.uid, alias),
    db.prepare(SQL.renameJobSeat0).bind(account.uid, alias),
    db.prepare(SQL.renameJobSeat1).bind(account.uid, alias),
    ...(await retitleHighlights(ctx, account.uid, alias)),
  ]);
  // Every match and cup of theirs, and through them every room, through the maintenance queue (retried until done).
  const matches = await db.prepare(SQL.matchIdsOfUid).bind(account.uid).all<{ match_id: string }>();
  for (const m of matches.results.slice(0, RENAME_MATCHES)) await ctx.env.MAINT_QUEUE?.send({ v: 1, kind: 'rename_player', uid: account.uid, ref, matchId: m.match_id });
  const cups = await db.prepare(SQL.cupsOfUid).bind(account.uid).all<{ cup_id: string }>();
  for (const c of cups.results) await ctx.env.MAINT_QUEUE?.send({ v: 1, kind: 'rename_cup_player', uid: account.uid, ref, cupId: c.cup_id });
  await record(ctx, row, 'renamed', 'actioned', playerId, { from: account.alias.slice(0, 40), to: alias, matches: Math.min(matches.results.length, RENAME_MATCHES), cups: cups.results.length });
  return { status: 200, body: { status: 'actioned', alias } };
}

export async function suspendReported(ctx: RequestContext): Promise<Reply> {
  const row = await reportParam(ctx);
  const raw = (ctx.body as { days?: unknown } | undefined)?.days;
  const days = raw === undefined ? 30 : raw;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) fail('invalid', 'days must be a whole number from 1 to 365');
  const { playerId, account } = await reportedAccount(ctx, row);
  const until = ctx.now + days * DAY_MS;
  await ctx.env.DB.prepare(SQL.setSocialSuspension).bind(account.uid, until, ctx.now).run();
  await record(ctx, row, 'suspended', 'actioned', playerId, { days });
  return { status: 200, body: { status: 'actioned', until: new Date(until).toISOString() } };
}

export async function unsuspendReported(ctx: RequestContext): Promise<Reply> {
  const row = await reportParam(ctx);
  const { playerId, account } = await reportedAccount(ctx, row);
  await ctx.env.DB.prepare(SQL.setSocialSuspension).bind(account.uid, null, ctx.now).run();
  await record(ctx, row, 'unsuspended', row.status === 'open' ? 'actioned' : row.status, playerId);
  return { status: 200, body: { status: row.status === 'open' ? 'actioned' : row.status } };
}

export async function removeReportedPost(ctx: RequestContext): Promise<Reply> {
  const row = await reportParam(ctx);
  const m = row.target_kind === 'post' ? POST_ID_RE.exec(row.target_id) : null;
  if (!m) fail('conflict', 'this report is not about a post');
  const playerId = await playerIdOf(ctx, row);
  const r = await callRoom<{ removed: boolean }>(ctx.env, ctx.cfg, m[1], { op: 'remove_post', seq: Number(m[2]) });
  await record(ctx, row, 'post_removed', 'actioned', playerId, { removed: r.body.removed });
  return { status: 200, body: { status: 'actioned', removed: r.body.removed } };
}
