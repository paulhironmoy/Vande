/**
 * Highlight jobs from a frozen Top 100 day: one job per best match (both participants when both qualified), titles
 * and descriptions from templates over aliases, an attribution code per job, and the HighlightRenderInput that both the
 * consent preview and the trusted renderer use (so participants approve exactly what will be rendered).
 */
import type { CupView, HighlightRenderInput, LocaleId, MatchEventLog, Top100Entry } from '@/contracts';
import { highlightUrl, roomIdFor } from '@/net/shared/ids';
import { isLocaleId } from '@/net/shared/ids';
import type { Config } from '../config';
import { HOUR_MS, publicWebOrigin } from '../config';
import type { D1StatementLike, Env } from '../env';
import type { WorkerDeps } from '../http/context';
import { callCup } from '../cup/client';
import { callMatch } from '../match/client';
import { archiveKey } from '../match/matchDO';
import { gunzip, gzip, hmac, hmacKeyFor, sha256 } from '../security/crypto';
import { toBase32, utf8 } from '../security/encoding';
import { identityPepper } from '../security/secrets';
import { previousDay } from '../time';
import type { JobRow } from './model';
import { HSQL } from './sql';
import { fixtureLabel, highlightDescription, highlightTitle, safeAlias } from './templates';

export const CONSENT_WINDOW_MS = 48 * HOUR_MS;

/** A day's result row joined with both accounts (HSQL.dayResults). */
export interface DayResultRow {
  match_id: string;
  kind: 'duel' | 'cup';
  cup_id: string | null;
  stage: 'group' | 'final' | null;
  revealed_ms: number;
  uid0: string;
  uid1: string;
  winner: 0 | 1 | null;
  runs0: number;
  wickets0: number;
  runs1: number;
  wickets1: number;
  late0: number;
  late1: number;
  /** Balls shown but settled as leaves without a valid answer (backend/migrations/0004). */
  missed0: number;
  missed1: number;
  auto0: number;
  auto1: number;
  suspect0: number;
  suspect1: number;
  r0: number | null;
  r1: number | null;
  te0: number | null;
  cl0: number | null;
  ex0: number | null;
  te1: number | null;
  cl1: number | null;
  ex1: number | null;
  pid0: string | null;
  alias0: string | null;
  avatar0: string | null;
  st0: string | null;
  ef0: number | null;
  rm0: number | null;
  loc0: string | null;
  pid1: string | null;
  alias1: string | null;
  avatar1: string | null;
  st1: string | null;
  ef1: number | null;
  rm1: number | null;
  loc1: string | null;
}

/**
 * The display names of a job, in log.players order: what the title and description say, what the render input hands
 * the renderer (HighlightRenderInput.aliases) and exactly what moderation checks. Filtered at the cutoff (safeAlias)
 * and "Deleted player" once a participant deleted the account; never the match-time alias inside the replay.
 */
export function displayAliases(row: Pick<JobRow, 'alias0' | 'alias1'>): [string, string] {
  return [row.alias0, row.alias1];
}

/** Title and description of a job from its display names (cutoff, and again when a participant deletes the account). */
export function highlightTexts(
  env: Env,
  a: { aliases: [string, string]; ranks: [number | null, number | null]; fixture: string; day: string; code: string; score: Parameters<typeof highlightDescription>[0]['score'] },
): { title: string; description: string } {
  const [alias0, alias1] = a.aliases;
  return {
    title: highlightTitle({ alias0, alias1, ranks: a.ranks }),
    description: highlightDescription({ alias0, alias1, fixture: a.fixture, day: a.day, ranks: a.ranks, score: a.score, url: highlightUrl(publicWebOrigin(env), a.code) }),
  };
}

/** Deterministic, so a cutoff that runs twice writes the same rows (and the second write is a no-op). */
export async function jobIdFor(day: string, matchId: string): Promise<string> {
  return `j${toBase32(await sha256(`vande/job|${day}|${matchId}`)).slice(0, 26)}`;
}

/** Short public code (https://<web>/h/<code>), keyed so it cannot be derived from the match id alone. */
export async function codeFor(env: Env, deps: WorkerDeps, day: string, matchId: string): Promise<string> {
  const key = await hmacKeyFor(utf8(identityPepper(env, deps.logger)), 'pepper', 'highlight');
  return toBase32(await hmac(key, `code|${day}|${matchId}`)).slice(0, 10);
}

async function cupView(env: Env, cfg: Config, cupId: string, uid: string): Promise<CupView | null> {
  try {
    const r = await callCup<CupView>(env, cfg, cupId, { op: 'view', uid });
    return r.status === 200 ? r.body : null;
  } catch {
    return null;
  }
}

/** Insert statements for the day's jobs (pending consent for 48 h from the freeze). */
export async function jobStatements(env: Env, deps: WorkerDeps, cfg: Config, day: string, entries: readonly Top100Entry[], rows: ReadonlyMap<string, DayResultRow>, frozenMs: number): Promise<{ statements: D1StatementLike[]; jobs: number }> {
  const rankByPid = new Map(entries.map((e) => [e.playerId, e.rank]));
  const seen = new Set<string>();
  const statements: D1StatementLike[] = [];
  for (const e of entries) {
    const row = rows.get(e.bestMatchId);
    // Dedupe: one job per match, whoever of its two players qualified first (both are participants either way).
    if (!row || seen.has(row.match_id)) continue;
    seen.add(row.match_id);
    // Both participants must be able to consent: a deleted account means no video (the badge stays).
    if (row.st0 !== 'active' || row.st1 !== 'active' || !row.pid0 || !row.pid1) continue;
    const ranks: [number | null, number | null] = [rankByPid.get(row.pid0) ?? null, rankByPid.get(row.pid1) ?? null];
    const alias0 = safeAlias(row.alias0 ?? '', 0);
    const alias1 = safeAlias(row.alias1 ?? '', 1);
    const cup = row.kind === 'cup' && row.cup_id ? await cupView(env, cfg, row.cup_id, row.uid0) : null;
    const label = fixtureLabel(row.kind, row.stage, cup?.name ?? null);
    const jobId = await jobIdFor(day, row.match_id);
    const code = await codeFor(env, deps, day, row.match_id);
    const { title, description } = highlightTexts(env, {
      aliases: [alias0, alias1],
      ranks,
      fixture: label,
      day,
      code,
      score: { runs0: row.runs0, wickets0: row.wickets0, runs1: row.runs1, wickets1: row.wickets1, winner: row.winner },
    });
    const locale: LocaleId = row.loc0 && row.loc0 === row.loc1 && isLocaleId(row.loc0) ? row.loc0 : 'en';
    const pair = [row.uid0, row.uid1].sort().join('|');
    const roomId = row.kind === 'cup' && row.cup_id ? roomIdFor(row.cup_id) : roomIdFor(row.match_id);
    statements.push(
      env.DB.prepare(HSQL.insertJob).bind(
        jobId,
        day,
        row.match_id,
        row.kind,
        row.cup_id,
        roomId,
        row.uid0,
        row.uid1,
        row.pid0,
        row.pid1,
        alias0,
        alias1,
        row.avatar0 ?? 'player0',
        row.avatar1 ?? 'player1',
        pair,
        ranks[0],
        ranks[1],
        title,
        description,
        label,
        locale,
        code,
        frozenMs + CONSENT_WINDOW_MS,
        frozenMs,
      ),
    );
  }
  return { statements, jobs: statements.length };
}

/** The verified source of everything on screen: the archived replay (re-archived from the match when missing). */
export async function loadLog(env: Env, cfg: Config, row: Pick<JobRow, 'match_id' | 'uid0'>): Promise<MatchEventLog | null> {
  const stored = await env.FILES?.get(archiveKey(row.match_id));
  if (stored) {
    try {
      return JSON.parse(await gunzip(new Uint8Array(await stored.arrayBuffer()))) as MatchEventLog;
    } catch {
      /* fall through to the match object */
    }
  }
  try {
    const r = await callMatch<MatchEventLog>(env, cfg, row.match_id, { op: 'reveal', uid: row.uid0 });
    if (r.status !== 200) return null;
    await env.FILES?.put(archiveKey(row.match_id), await gzip(JSON.stringify(r.body)), { httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' } });
    return r.body;
  } catch {
    return null;
  }
}

/** Standings movement near the end of the cut: the cup table for cup matches, else each qualifier's Top 100 move. */
async function standings(env: Env, cfg: Config, row: JobRow): Promise<HighlightRenderInput['standings']> {
  if (row.kind === 'cup' && row.cup_id) {
    const cup = await cupView(env, cfg, row.cup_id, row.uid0);
    if (cup) {
      const out = cup.standings
        .map((s, i) => ({ s, to: i + 1 }))
        .filter(({ s }) => s.playerId === row.pid0 || s.playerId === row.pid1)
        .map(({ s, to }) => ({ alias: s.playerId === row.pid0 ? row.alias0 : row.alias1, from: s.movement === 0 ? to : to + s.movement, to }));
      if (out.length) return out;
    }
  }
  const out: Array<{ alias: string; from: number | null; to: number }> = [];
  for (const [uid, alias, rank] of [[row.uid0, row.alias0, row.rank0], [row.uid1, row.alias1, row.rank1]] as const) {
    if (rank === null) continue;
    const before = await env.DB.prepare(HSQL.rankOf).bind(uid, previousDay(row.day)).first<{ rank: number }>();
    out.push({ alias, from: before?.rank ?? null, to: rank });
  }
  return out.length ? out : null;
}

export async function renderInputFor(env: Env, cfg: Config, row: JobRow): Promise<HighlightRenderInput | null> {
  const log = await loadLog(env, cfg, row);
  if (!log) return null;
  return {
    jobId: row.job_id,
    log,
    aliases: displayAliases(row),
    locale: (isLocaleId(row.locale) ? row.locale : 'en') as LocaleId,
    fixtureLabel: row.fixture_label,
    day: row.day,
    ranks: [row.rank0, row.rank1],
    standings: await standings(env, cfg, row),
    cta: { url: highlightUrl(publicWebOrigin(env), row.code) },
  };
}
