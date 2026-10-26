/**
 * Profile routes: read and edit the profile, export everything the service holds about the player, delete the
 * account. Groups, push registration, reports and blocks live here too (small).
 */
import type { CreateGroupRequest, JoinGroupRequest, ProfilePatch, RegisterPushRequest, ReportRequest } from '@/contracts';
import { checkAlias, checkGroupName } from '@/net/shared/alias';
import { isCityId } from '@/net/shared/cities';
import { AVATAR_SEED_RE, isValidKit } from '@/net/shared/kits';
import { MATCH_ID_RE, PLAYER_ID_RE, isLocaleId } from '@/net/shared/ids';
import { EXPORT_TTL_MS, MAX_GROUP_MEMBERSHIPS, MAX_PUSH_TOKENS } from '../config';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import { dayIso, hourIso, JSON_HEADERS } from '../http/http';
import type { Reply } from '../http/router';
import { enforceDailyCap } from '../guards/limits';
import { actorRef, audit } from '../ops/audit';
import { randomBytes, randomId, seal, sha256Hex } from '../security/crypto';
import { CROCKFORD, normaliseCrockford } from '../security/encoding';
import { dataKeys, tokenKeys } from '../security/secrets';
import { issueExportToken, verifyExportToken } from '../security/tokens';
import { SQL } from '../storage/sql';
import { callMatch } from '../match/client';
import { callCup } from '../cup/client';
import { daysEnding, istDay } from '../time';
import { DELETED_PLAYER, requireAccount, requireSocial, profileOf } from './model';
import { withdrawForDeletion } from '../highlights/consent';
import { HSQL } from '../highlights/sql';
import { highlightTexts } from '../highlights/jobs';
import type { JobRow } from '../highlights/model';
import { requireLiveSession } from '../auth/routes';
import { quietOf } from '../ops/notifyPolicy';

function obj(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid', 'body must be a JSON object');
  return body as Record<string, unknown>;
}

export async function getMe(ctx: RequestContext): Promise<Reply> {
  const row = await requireAccount(ctx.env.DB, requireActor(ctx).uid);
  return { status: 200, body: await profileOf(ctx.env.DB, row) };
}

const PATCH_KEYS = new Set(['alias', 'avatar', 'kit', 'locale', 'city', 'adultConfirmed']);

export async function patchMe(ctx: RequestContext): Promise<Reply> {
  // A profile edit (the alias above all) needs a live session: a signed-out or revoked device cannot rename anyone.
  const actor = await requireLiveSession(ctx);
  const b = obj(ctx.body) as ProfilePatch & Record<string, unknown>;
  for (const k of Object.keys(b)) if (!PATCH_KEYS.has(k)) fail('invalid', `unknown field ${k.slice(0, 32)}`);
  const row = await requireAccount(ctx.env.DB, actor.uid);
  let alias = row.alias;
  if (b.alias !== undefined && b.alias !== row.alias) {
    // A name change is a social feature: not while a moderator has paused them.
    requireSocial(row, ctx.now);
    const check = checkAlias(b.alias);
    if (!check.ok) {
      await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'alias_rejected', detail: { reason: check.reason } });
      fail('invalid', `alias not allowed (${check.reason})`);
    }
    alias = check.value;
  }
  let avatarSeed = row.avatar_seed;
  if (b.avatar !== undefined) {
    const seed = (b.avatar as { seed?: unknown } | null)?.seed;
    if (typeof seed !== 'string' || !AVATAR_SEED_RE.test(seed) || Object.keys(b.avatar as object).length !== 1) fail('invalid', 'avatar must be { seed } with 8–32 lowercase letters and digits');
    avatarSeed = seed;
  }
  let kitJson = row.kit_json;
  if (b.kit !== undefined) {
    if (!isValidKit(b.kit)) fail('invalid', 'kit must be a starter kit from the palette');
    kitJson = JSON.stringify({ id: b.kit.id, primary: b.kit.primary, secondary: b.kit.secondary, pattern: b.kit.pattern });
  }
  let locale = row.locale;
  if (b.locale !== undefined) {
    if (!isLocaleId(b.locale)) fail('invalid', 'unsupported locale');
    locale = b.locale;
  }
  let city = row.city;
  if (b.city !== undefined) {
    if (b.city !== null && !isCityId(b.city)) fail('invalid', 'city must be one of the listed cities, or null');
    city = b.city;
  }
  let adult = row.adult_confirmed;
  if (b.adultConfirmed !== undefined) {
    if (typeof b.adultConfirmed !== 'boolean') fail('invalid', 'adultConfirmed must be true or false');
    // 18+ only: the confirmation can be given, never taken back (an adult who meant otherwise deletes the account).
    if (!b.adultConfirmed) fail('invalid', 'VANDE Cricket is for players aged 18 and over, so this confirmation cannot be turned off. To leave, delete your account.');
    adult = 1;
  }
  await ctx.env.DB.prepare(SQL.updateProfile).bind(actor.uid, alias, avatarSeed, kitJson, locale, city, adult, ctx.now).run();
  const next = await requireAccount(ctx.env.DB, actor.uid);
  return { status: 200, body: await profileOf(ctx.env.DB, next) };
}

// ---- export -------------------------------------------------------------------------------------------------------

export async function exportMe(ctx: RequestContext): Promise<Reply> {
  const actor = await requireLiveSession(ctx);
  if (!ctx.env.FILES) fail('unavailable', 'exports are not configured');
  const db = ctx.env.DB;
  const row = await requireAccount(db, actor.uid);
  const days = JSON.stringify(daysEnding(istDay(ctx.now), 400));
  const [profile, sessions, matches, push, top100, highlights, consents, results, dailyScores, dailyAttempts, streak, notify, rooms, cups, friends, blocks, reports, shares] = await Promise.all([
    profileOf(db, row),
    db.prepare('SELECT created_hour, revoked FROM sessions WHERE uid = ?1').bind(actor.uid).all<{ created_hour: string; revoked: number }>(),
    db.prepare(SQL.matchesOfUid).bind(actor.uid, 500).all<{ view_json: string }>(),
    db.prepare(SQL.pushTokensOfUid).bind(actor.uid).all<{ platform: string; updated_day: string }>(),
    db.prepare('SELECT day, rank, score, best_match_id FROM top100_entries WHERE uid = ?1 ORDER BY day DESC LIMIT 400').bind(actor.uid).all<{ day: string; rank: number; score: number; best_match_id: string }>(),
    db.prepare(HSQL.jobsOfUid).bind(actor.uid, '0000-00-00').all<{ job_id: string; day: string; match_id: string; status: string; title: string; visibility: string; youtube_video_id: string | null; code: string }>(),
    db.prepare('SELECT job_id, decision, adult, approved_title, approved_visibility, reason, decided_ms FROM highlight_consents WHERE uid = ?1 ORDER BY job_id, seq').bind(actor.uid).all<{ job_id: string; decision: string; adult: number; approved_title: string; approved_visibility: string; reason: string | null; decided_ms: number }>(),
    db.prepare(SQL.exportResults).bind(actor.uid).all<ResultRow>(),
    db.prepare(SQL.exportDailyScores).bind(actor.uid, days).all<{ day: string; best_score: number; city: string | null; late: number; missed: number; suspect: number }>(),
    db.prepare(SQL.exportDailyAttempts).bind(actor.uid, days).all<{ day: string; started: number; finished: number }>(),
    db.prepare(SQL.streakRow).bind(actor.uid).first<{ streak: number; best_streak: number; last_day: string }>(),
    db.prepare(SQL.notifyPrefs).bind(actor.uid).first<{ enabled: number; quiet_start: number | null; quiet_end: number | null }>(),
    db.prepare(SQL.exportRoomSettings).bind(actor.uid).all<{ room_id: string; muted: number; notify: string }>(),
    db.prepare(SQL.exportCups).bind(actor.uid).all<{ cup_id: string; joined_hour: string }>(),
    db.prepare(SQL.exportFriends).bind(actor.uid).all<{ player_id: string; alias: string; since_day: string }>(),
    db.prepare(SQL.exportBlocks).bind(actor.uid).all<{ blocked_player_id: string; created_hour: string }>(),
    db.prepare(SQL.exportReports).bind(await actorRef(actor.uid)).all<{ target_kind: string; target_id: string; reason: string; status: string; created_hour: string }>(),
    db.prepare(SQL.exportShareMoments).bind(actor.uid).all<{ target_id: string; moment: string; first_ms: number }>(),
  ]);
  const quiet = quietOf(ctx.env, notify ?? null);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const doc = {
    format: 'vande-cricket-export',
    version: 2,
    generatedHour: hourIso(ctx.now),
    profile,
    signedInDevices: sessions.results.map((s) => ({ since: s.created_hour, active: s.revoked === 0 })),
    pushDevices: push.results.map((p) => ({ platform: p.platform, updatedDay: p.updated_day })),
    matches: matches.results.map((m) => JSON.parse(m.view_json) as unknown),
    matchResults: results.results.map((r) => resultForExport(r, actor.uid)),
    dailySix: {
      scores: dailyScores.results.map((d) => ({ day: d.day, bestScore: d.best_score, city: d.city, lateAnswers: d.late, missedBalls: d.missed, timingAuditFlag: d.suspect === 1 })),
      attempts: dailyAttempts.results.map((d) => ({ day: d.day, started: d.started, finished: d.finished })),
      streak: streak ? { current: streak.streak, best: streak.best_streak, lastDay: streak.last_day } : null,
    },
    notifications: { enabled: notify ? notify.enabled === 1 : true, quietHours: quiet ? { start: hhmm(quiet.start), end: hhmm(quiet.end) } : null },
    roomSettings: rooms.results.map((r) => ({ roomId: r.room_id, muted: r.muted === 1, notify: r.notify })),
    cups: cups.results.map((c) => ({ cupId: c.cup_id, joinedHour: c.joined_hour })),
    friends: friends.results.map((f) => ({ playerId: f.player_id, alias: f.alias, sinceDay: f.since_day })),
    blocks: blocks.results.map((b) => ({ playerId: b.blocked_player_id, createdHour: b.created_hour })),
    reports: reports.results.map((r) => ({ kind: r.target_kind, target: r.target_id, reason: r.reason, status: r.status, createdHour: r.created_hour })),
    // The share cap: which moment of which match or cup this player opened a share for, and when (hour).
    shareMoments: shares.results.map((m) => ({ id: m.target_id, moment: m.moment, firstHour: hourIso(m.first_ms) })),
    top100: top100.results.map((t) => ({ day: t.day, rank: t.rank, score: t.score, bestMatchId: t.best_match_id })),
    highlights: highlights.results.map((h) => ({ jobId: h.job_id, day: h.day, matchId: h.match_id, status: h.status, title: h.title, visibility: h.visibility, youtubeVideoId: h.youtube_video_id, code: h.code })),
    highlightConsents: consents.results.map((c) => ({ jobId: c.job_id, decision: c.decision, adultConfirmed: c.adult === 1, approvedTitle: c.approved_title, approvedVisibility: c.approved_visibility, reason: c.reason, decidedHour: hourIso(c.decided_ms) })),
    notes: [
      'Revealed replays of your matches are available in the app from each match.',
      'matchResults lists, for each revealed duel and cup match, your seat, the score, your rating before the match and its change, the integrity counts (late answers, missed balls, Auto Over or Auto XI, the timing-audit flag) and the engine\'s performance figures used by the Daily Top 100.',
      'The service stores no email, phone number, real name, contacts or location beyond the optional city you chose.',
    ],
  };
  const exportId = randomId('x');
  const objectKey = `exports/${actor.uid}/${exportId}.json`;
  await ctx.env.FILES.put(objectKey, JSON.stringify(doc, null, 2), { httpMetadata: { contentType: 'application/json' } });
  const expiresMs = ctx.now + EXPORT_TTL_MS;
  await db.prepare(SQL.insertExport).bind(exportId, actor.uid, objectKey, expiresMs).run();
  const token = await issueExportToken(tokenKeys(ctx.env, ctx.deps.logger), { x: exportId, exp: expiresMs });
  const origin = (ctx.env.PUBLIC_API_ORIGIN || ctx.url.origin).replace(/\/+$/, '');
  await audit(db, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'export_requested' });
  return { status: 201, body: { downloadUrl: `${origin}/v1/exports/${exportId}?t=${encodeURIComponent(token)}`, expiresAt: new Date(expiresMs).toISOString() } };
}

interface ResultRow {
  match_id: string;
  kind: string;
  cup_id: string | null;
  stage: string | null;
  day: string;
  uid0: string;
  uid1: string;
  runs0: number;
  wickets0: number;
  runs1: number;
  wickets1: number;
  winner: 0 | 1 | null;
  late0: number;
  late1: number;
  missed0: number;
  missed1: number;
  auto0: number;
  auto1: number;
  suspect0: number;
  suspect1: number;
  rated: number;
  r0: number | null;
  r1: number | null;
  d0: number;
  d1: number;
  te0: number | null;
  cl0: number | null;
  ex0: number | null;
  te1: number | null;
  cl1: number | null;
  ex1: number | null;
}

/** One revealed match from the player's side (the opponent's internal id is never exported). */
function resultForExport(r: ResultRow, uid: string) {
  const seat: 0 | 1 = r.uid0 === uid ? 0 : 1;
  const o = (1 - seat) as 0 | 1;
  const pick = <T>(a: T, b: T): [T, T] => (seat === 0 ? [a, b] : [b, a]);
  const [runs, oppRuns] = pick(r.runs0, r.runs1);
  const [wickets, oppWickets] = pick(r.wickets0, r.wickets1);
  return {
    matchId: r.match_id,
    kind: r.kind,
    cupId: r.cup_id,
    stage: r.stage,
    day: r.day,
    seat,
    score: { runs, wickets, opponentRuns: oppRuns, opponentWickets: oppWickets },
    result: r.winner === null ? 'tied' : r.winner === seat ? 'won' : 'lost',
    integrity: { lateAnswers: seat === 0 ? r.late0 : r.late1, missedBalls: seat === 0 ? r.missed0 : r.missed1, autoSide: (seat === 0 ? r.auto0 : r.auto1) === 1, opponentAutoSide: (o === 0 ? r.auto0 : r.auto1) === 1, timingAuditFlag: (seat === 0 ? r.suspect0 : r.suspect1) === 1 },
    rating: r.rated === 1 ? { before: seat === 0 ? r.r0 : r.r1, change: seat === 0 ? r.d0 : r.d1 } : null,
    performance: { tacticalEfficiency: seat === 0 ? r.te0 : r.te1, clutch: seat === 0 ? r.cl0 : r.cl1, execution: seat === 0 ? r.ex0 : r.ex1 },
  };
}

/** GET /v1/exports/:id?t=… (capability link; no bearer token, since it opens in a browser or download manager). */
export async function downloadExport(ctx: RequestContext): Promise<Reply> {
  const claims = await verifyExportToken(tokenKeys(ctx.env, ctx.deps.logger), ctx.url.searchParams.get('t'), ctx.now);
  if (!claims || claims.x !== ctx.params.id || !ctx.env.FILES) fail('not_found', 'export not found or expired');
  const row = await ctx.env.DB.prepare(SQL.exportById).bind(claims.x).first<{ object_key: string; expires_ms: number }>();
  if (!row || row.expires_ms <= ctx.now) fail('not_found', 'export not found or expired');
  const object = await ctx.env.FILES.get(row.object_key);
  if (!object) fail('not_found', 'export not found or expired');
  return new Response(await object.text(), {
    status: 200,
    headers: { ...JSON_HEADERS, 'content-disposition': 'attachment; filename="vande-cricket-export.json"' },
  });
}

// ---- deletion -----------------------------------------------------------------------------------------------------

/**
 * Deletes the account: every object that holds the player forgets them (each Daily Six attempt of the last 32 days,
 * including one in progress, and every match: the seat becomes "Deleted player", a match in progress continues with
 * Auto Over / Auto XI for that seat, revealed replays are rewritten and re-archived to R2), every cup and Cricket Room
 * replaces them (room posts that named them say "Deleted player"; a highlight card that named them goes), every
 * highlight consent is withdrawn and every highlight title, description and approved title is rewritten without them;
 * then sessions, linked identities, push tokens, group memberships, blocks, exports, idempotency records and
 * match-list rows are deleted and the account row is scrubbed to a tombstone (purged after
 * DELETED_ACCOUNT_TOMBSTONE_DAYS). Objects that cannot be reached right now are handed to the maintenance queue.
 * Idempotent: deleting a deleted account answers "deleted".
 */
export async function deleteMe(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const db = ctx.env.DB;
  const account = await db.prepare(SQL.accountByUid).bind(actor.uid).first<{ status: string }>();
  if (!account || account.status === 'deleted') return { status: 200, body: { deleted: true } };
  await requireLiveSession(ctx);
  // Daily Six attempts first (one may still be in progress and would otherwise write the boards at the reset).
  const daily = await db.prepare(SQL.dailyAttemptIdsOfUid).bind(actor.uid).all<{ current_id: string | null; ids: string }>();
  const matches = await db.prepare(SQL.matchIdsOfUid).bind(actor.uid).all<{ match_id: string }>();
  const objects = [...new Set([...attemptIds(daily.results), ...matches.results.map((r) => r.match_id)])];
  for (const [i, matchId] of objects.entries()) {
    // The first INLINE_FORGETS objects inline; a long history goes to the queue.
    const inline = i < INLINE_FORGETS || !ctx.env.MAINT_QUEUE;
    try {
      if (!inline) throw new Error('queued');
      await callMatch(ctx.env, ctx.cfg, matchId, { op: 'forget', uid: actor.uid });
    } catch {
      if (!ctx.env.MAINT_QUEUE) fail('unavailable', 'could not reach every match; try again');
      await ctx.env.MAINT_QUEUE.send({ v: 1, kind: 'forget_player', uid: actor.uid, matchId });
    }
  }
  const cups = await db.prepare(SQL.cupsOfUid).bind(actor.uid).all<{ cup_id: string }>();
  for (const { cup_id } of cups.results) {
    try {
      await callCup(ctx.env, ctx.cfg, cup_id, { op: 'forget', uid: actor.uid });
    } catch {
      if (!ctx.env.MAINT_QUEUE) fail('unavailable', 'could not reach every cup; try again');
      await ctx.env.MAINT_QUEUE.send({ v: 1, kind: 'forget_cup_player', uid: actor.uid, cupId: cup_id });
    }
  }
  // Deleting the account withdraws every highlight consent (cancel before upload, remove after).
  const highlights = await withdrawForDeletion(ctx.env, ctx.deps, actor.uid);
  const retitles = await retitleHighlights(ctx, actor.uid);
  const friends = await db.prepare(SQL.friendsOfUid).bind(actor.uid).all<{ friend_uid: string }>();
  const recentDays = JSON.stringify(daysEnding(istDay(ctx.now), 400));
  const exports = await db.prepare(SQL.exportsOfUid).bind(actor.uid).all<{ object_key: string }>();
  if (ctx.env.FILES && exports.results.length > 0) await ctx.env.FILES.delete(exports.results.map((e) => e.object_key)).catch(() => undefined);
  await db.batch([
    db.prepare(SQL.deleteSessionsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteIdentitiesOfUid).bind(actor.uid),
    db.prepare(SQL.deletePushTokensOfUid).bind(actor.uid),
    db.prepare(SQL.decrementGroupsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteMembershipsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteBlocksOfUid).bind(actor.uid),
    db.prepare(SQL.deleteExportsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteMatchesOfUid).bind(actor.uid),
    ...friends.results.map((f) => db.prepare(SQL.deleteFriendPair).bind(f.friend_uid, actor.uid)),
    db.prepare(SQL.deleteFriendsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteCupsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteDailyScoresOfUid).bind(actor.uid, recentDays),
    db.prepare(SQL.deleteDailyAttemptsOfUid).bind(actor.uid, recentDays),
    db.prepare(SQL.deleteStreakOfUid).bind(actor.uid),
    db.prepare(SQL.deleteNotifyPrefsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteRoomSettingsOfUid).bind(actor.uid),
    db.prepare(SQL.deleteShareMomentsOfUid).bind(actor.uid),
    db.prepare(SQL.scrubResultsSeat0).bind(actor.uid, 'x:deleted'),
    db.prepare(SQL.scrubResultsSeat1).bind(actor.uid, 'x:deleted'),
    db.prepare(SQL.scrubSharedSeat0).bind(actor.uid, 'x:deleted'),
    db.prepare(SQL.scrubSharedSeat1).bind(actor.uid, 'x:deleted'),
    ...retitles,
    db.prepare(HSQL.scrubEntries).bind(actor.uid, 'x:deleted'),
    db.prepare(HSQL.scrubConsents).bind(actor.uid, 'x:deleted'),
    db.prepare(HSQL.scrubJobUid0).bind(actor.uid, 'x:deleted'),
    db.prepare(HSQL.scrubJobUid1).bind(actor.uid, 'x:deleted'),
    db.prepare(SQL.scrubAccount).bind(actor.uid, ctx.now),
  ]);
  // The idempotency records of this account go last: this very request's record must not outlive the account either.
  ctx.waitUntil(db.prepare(SQL.deleteIdempotencyOfScope).bind(`u:${actor.uid}`).run().catch(() => undefined));
  ctx.deps.metrics.count('account_deleted');
  await audit(db, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'account_deleted', detail: { matches: objects.length, highlights } });
  return { status: 200, body: { deleted: true } };
}

/** Every Daily Six attempt id recorded for the player (the one in progress and the day's others). */
function attemptIds(rows: ReadonlyArray<{ current_id: string | null; ids: string }>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.current_id) out.push(r.current_id);
    try {
      const ids = JSON.parse(r.ids) as unknown;
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') out.push(id);
    } catch {
      /* a corrupt list: the in-progress id above still counts */
    }
  }
  return out.filter((id) => MATCH_ID_RE.test(id));
}

/**
 * Statements that rewrite every highlight of the player without their alias: title and description from the same
 * templates with "Deleted player" (or, for a moderator's rename, the new name) in their seat, and the approved title
 * of every consent record of the job.
 */
export async function retitleHighlights(ctx: RequestContext, uid: string, alias: string = DELETED_PLAYER.alias) {
  const db = ctx.env.DB;
  const { results } = await db.prepare(HSQL.allJobsOfUid).bind(uid).all<JobRow>();
  const out = [];
  for (const job of results) {
    const aliases: [string, string] = [job.uid0 === uid ? alias : job.alias0, job.uid1 === uid ? alias : job.alias1];
    const score = await db.prepare(HSQL.resultScore).bind(job.match_id).first<{ runs0: number; wickets0: number; runs1: number; wickets1: number; winner: 0 | 1 | null }>();
    const t = highlightTexts(ctx.env, { aliases, ranks: [job.rank0, job.rank1], fixture: job.fixture_label, day: job.day, code: job.code, score: score ?? null });
    out.push(db.prepare(HSQL.retitleJob).bind(job.job_id, t.title, t.description), db.prepare(HSQL.retitleConsents).bind(job.job_id, t.title));
  }
  return out;
}

// ---- groups -------------------------------------------------------------------------------------------------------

const CODE_LENGTH = 10;
/** Matches forgotten inside the DELETE request; the rest of a long history is handed to the maintenance queue. */
const INLINE_FORGETS = 25;

function newGroupCode(): string {
  const r = randomBytes(CODE_LENGTH);
  return [...r].map((b) => CROCKFORD[b % 32]).join('');
}

/** "ABCDE-FGHJK" for display; stored and compared without the hyphen. */
export function formatGroupCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export async function createGroup(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const b = obj(ctx.body) as Partial<CreateGroupRequest>;
  if (b.kind !== 'college' && b.kind !== 'company') fail('invalid', 'kind must be college or company');
  const name = checkGroupName(b.name);
  if (!name.ok) fail('invalid', `group name not allowed (${name.reason})`);
  requireSocial(await requireAccount(ctx.env.DB, actor.uid), ctx.now);
  const count = await ctx.env.DB.prepare(SQL.countMemberships).bind(actor.uid).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_GROUP_MEMBERSHIPS) fail('conflict', `a player can be in at most ${MAX_GROUP_MEMBERSHIPS} groups`);
  const groupId = randomId('g');
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newGroupCode();
    try {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(SQL.insertGroup).bind(groupId, b.kind, name.value, code, actor.uid, hourIso(ctx.now)),
        ctx.env.DB.prepare(SQL.insertMember).bind(actor.uid, groupId, hourIso(ctx.now)),
      ]);
      await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'group_created', target: groupId });
      return { status: 201, body: { groupId, code: formatGroupCode(code) } };
    } catch (e) {
      if (!/UNIQUE/i.test(String((e as Error)?.message))) throw e;
    }
  }
  return fail('unavailable', 'could not create a group code; try again');
}

export async function joinGroup(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const b = obj(ctx.body) as Partial<JoinGroupRequest>;
  const code = typeof b.code === 'string' ? normaliseCrockford(b.code) : null;
  if (!code || code.length !== CODE_LENGTH) fail('invalid', 'a group code has 10 letters and digits');
  await enforceDailyCap(
    { env: ctx.env, cfg: ctx.cfg, metrics: ctx.deps.metrics, salt: ctx.salt, ip: ctx.ip, uid: actor.uid, now: ctx.now },
    'day-join',
    `u:${actor.uid}`,
    ctx.cfg.rate.groupJoinsPerPlayerPerDay,
  );
  const group = await ctx.env.DB.prepare(SQL.groupByCode).bind(code).first<{ group_id: string }>();
  if (!group) fail('not_found', 'no group has this code');
  requireSocial(await requireAccount(ctx.env.DB, actor.uid), ctx.now);
  const count = await ctx.env.DB.prepare(SQL.countMemberships).bind(actor.uid).first<{ n: number }>();
  const res = await ctx.env.DB.prepare(SQL.insertMember).bind(actor.uid, group.group_id, hourIso(ctx.now)).run();
  if ((res.meta?.changes ?? 0) > 0) {
    if ((count?.n ?? 0) >= MAX_GROUP_MEMBERSHIPS) {
      await ctx.env.DB.prepare('DELETE FROM group_members WHERE uid = ?1 AND group_id = ?2').bind(actor.uid, group.group_id).run();
      fail('conflict', `a player can be in at most ${MAX_GROUP_MEMBERSHIPS} groups`);
    }
    await ctx.env.DB.prepare(SQL.bumpMembers).bind(group.group_id, 1).run();
    await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'group_joined', target: group.group_id });
  }
  return { status: 200, body: { groupId: group.group_id } };
}

// ---- push ---------------------------------------------------------------------------------------------------------

const PUSH_TOKEN_RE = /^[A-Za-z0-9:_-]{20,4096}$/;

export async function registerPush(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const b = obj(ctx.body) as Partial<RegisterPushRequest>;
  if (typeof b.token !== 'string' || !PUSH_TOKEN_RE.test(b.token)) fail('invalid', 'token is not a push token');
  if (b.platform !== 'android' && b.platform !== 'web') fail('invalid', 'platform must be android or web');
  await requireAccount(ctx.env.DB, actor.uid);
  const keys = dataKeys(ctx.env, ctx.deps.logger);
  const hash = await sha256Hex(`push:${b.token}`);
  const existing = await ctx.env.DB.prepare(SQL.pushTokensOfUid).bind(actor.uid).all<{ token_hash: string }>();
  const others = existing.results.filter((r) => r.token_hash !== hash);
  for (const old of others.slice(MAX_PUSH_TOKENS - 1)) await ctx.env.DB.prepare(SQL.deletePushToken).bind(actor.uid, old.token_hash).run();
  const enc = await seal(keys.active, 'push', actor.uid, b.token, `${actor.uid}|${hash}`);
  await ctx.env.DB.prepare(SQL.upsertPushToken).bind(actor.uid, hash, enc, b.platform, dayIso(ctx.now)).run();
  return { status: 200, body: { ok: true } };
}

// ---- reports and blocks -------------------------------------------------------------------------------------------

const REPORT_REASONS = new Set(['abusive', 'spam', 'cheating', 'other']);

export async function report(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  await requireAccount(ctx.env.DB, actor.uid);
  const b = obj(ctx.body) as Partial<ReportRequest>;
  if (!REPORT_REASONS.has(String(b.reason))) fail('invalid', 'reason must be abusive, spam, cheating or other');
  const playerId = typeof b.playerId === 'string' && PLAYER_ID_RE.test(b.playerId) ? b.playerId : null;
  const postId = typeof b.postId === 'string' && /^r[a-z2-7]{26}\.\d{1,9}$/.test(b.postId) ? b.postId : null;
  // A reported post keeps its author (when the app knew it), so the moderator sees both (admin/reports.ts).
  const target = postId ? { kind: 'post', id: postId } : playerId ? { kind: 'player', id: playerId } : null;
  if (!target) fail('invalid', 'playerId or postId is required');
  if (playerId === actor.playerId) fail('invalid', 'you cannot report yourself');
  await ctx.env.DB.prepare(SQL.insertReport).bind(await actorRef(actor.uid), target.kind, target.id, b.reason, hourIso(ctx.now), playerId).run();
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'report_filed', detail: { kind: target.kind, reason: String(b.reason) } });
  return { status: 200, body: { ok: true } };
}

export async function block(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  await requireAccount(ctx.env.DB, actor.uid);
  const playerId = ctx.params.playerId;
  if (!PLAYER_ID_RE.test(playerId)) fail('invalid', 'not a player id');
  if (playerId === actor.playerId) fail('invalid', 'you cannot block yourself');
  await ctx.env.DB.prepare(SQL.insertBlock).bind(actor.uid, playerId, hourIso(ctx.now)).run();
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'player_blocked' });
  return { status: 200, body: { ok: true } };
}
