/**
 * Moderation after consent. Automatic checks first, before any render cost:
 *   alias       — the display names the video will draw (HighlightRenderInput.aliases, the same strings as the title)
 *                 and the fixture label pass the alias / group-name filter again (the filter may have improved since
 *                 the cutoff);
 *   anti-cheat  — the archived replay passes engine.verifyMatchLog, no timing-audit flag and late answers plus missed
 *                 balls within the Top 100 limit on either side (ranking's matchEligibility), no Auto Over / Auto XI
 *                 side;
 *   duplicate   — no other live or in-progress highlight of the same match, or of the same two players within 7 days
 *                 (the earlier one wins), and the match is not already published.
 * A failure rejects the job (reviewer "auto"); a pass queues the render. The rendered cut then waits for an admin
 * (approve / reject with notes) unless HIGHLIGHT_AUTO_APPROVE=1. Every decision is a highlight_moderation row.
 */
import type { MatchEventLog, ModerationResult } from '@/contracts';
import type { Top100MatchInput } from '@/engine/ranking';
import { checkAlias, checkGroupName } from '@/net/shared/alias';
import type { Config } from '../config';
import { DAY_MS, MAX_IRREGULAR_BALLS } from '../config';
import type { Env } from '../env';
import type { WorkerDeps } from '../http/context';
import { dayIso } from '../http/http';
import { displayAliases, loadLog } from './jobs';
import type { JobRow } from './model';
import { scheduleUpload, transition } from './pipeline';
import { HSQL } from './sql';

const DUPLICATE_WINDOW_DAYS = 7;

interface ResultRow {
  kind: 'duel' | 'cup';
  late0: number;
  late1: number;
  missed0: number;
  missed1: number;
  auto0: number;
  auto1: number;
  suspect0: number;
  suspect1: number;
}

function cupNameOf(label: string): string | null {
  const i = label.lastIndexOf(' · ');
  return i > 0 ? label.slice(0, i) : null;
}

async function antiCheat(env: Env, deps: WorkerDeps, cfg: Config, row: JobRow): Promise<{ ok: boolean; notes: string[]; log: MatchEventLog | null }> {
  const notes: string[] = [];
  const log = await loadLog(env, cfg, row);
  if (!log) return { ok: false, notes: ['replay missing'], log };
  const engine = deps.engines.get(log.engine);
  if (!engine) notes.push(`engine v${log.engine} not available`);
  else {
    const verified = await engine.verifyMatchLog(log).catch(() => ({ ok: false as const, errors: ['verify threw'] }));
    if (!verified.ok) notes.push(`replay failed verification (${verified.errors.slice(0, 3).join(', ')})`);
  }
  const r = await env.DB.prepare('SELECT kind, late0, late1, missed0, missed1, auto0, auto1, suspect0, suspect1 FROM match_results WHERE match_id = ?1').bind(row.match_id).first<ResultRow>();
  if (!r) notes.push('result row missing');
  else {
    const eligibility = deps.helpers.matchEligibility;
    const irregular: [number, number] = [r.late0 + r.missed0, r.late1 + r.missed1];
    const probe: Top100MatchInput = {
      matchId: row.match_id,
      day: row.day,
      order: 0,
      kind: r.kind,
      opponentId: row.pid1,
      result: 'won',
      opponentRating: 1200,
      rating: 1200,
      performance: { tacticalEfficiency: 1, clutch: 1, execution: 1 },
      opponentPerformance: { tacticalEfficiency: 1, clutch: 1, execution: 1 },
      auto: r.auto0 === 1 || r.auto1 === 1,
      practice: false,
      lateAnswers: irregular,
      timingSuspicious: [r.suspect0 === 1, r.suspect1 === 1],
    };
    const reasons = eligibility ? eligibility(probe) : [...(probe.auto ? ['auto'] : []), ...(r.suspect0 || r.suspect1 ? ['timing_audit'] : []), ...(irregular.some((n) => n > MAX_IRREGULAR_BALLS) ? ['late_answers'] : [])];
    if (reasons.length) notes.push(`not eligible: ${reasons.join(', ')}`);
  }
  return { ok: notes.length === 0, notes, log };
}

async function duplicate(env: Env, row: JobRow): Promise<{ ok: boolean; notes: string[] }> {
  const from = dayIso(Date.parse(`${row.day}T00:00:00Z`) - DUPLICATE_WINDOW_DAYS * DAY_MS);
  const { results } = await env.DB.prepare(HSQL.duplicates).bind(row.job_id, row.match_id, row.pair, from, row.day).all<{ job_id: string; status: string; day: string }>();
  // The earlier highlight of the pair wins: a later day, or the same day with a larger id, is the duplicate.
  const earlier = results.filter((d) => d.day < row.day || (d.day === row.day && d.job_id < row.job_id));
  return earlier.length ? { ok: false, notes: [`duplicate of ${earlier.map((d) => d.job_id).join(', ')}`] } : { ok: true, notes: [] };
}

export async function autoModerate(env: Env, deps: WorkerDeps, cfg: Config, row: JobRow): Promise<ModerationResult> {
  const aliasNotes: string[] = [];
  // Exactly the names the renderer draws (renderInputFor uses displayAliases too), never the replay's match-time aliases.
  if (!displayAliases(row).every((a) => checkAlias(a).ok)) aliasNotes.push('an alias no longer passes the filter');
  const cupName = row.kind === 'cup' ? cupNameOf(row.fixture_label) : null;
  if (cupName && cupName !== 'Group Cup' && !checkGroupName(cupName).ok) aliasNotes.push('the cup name no longer passes the filter');
  const cheat = await antiCheat(env, deps, cfg, row);
  const dup = await duplicate(env, row);
  const result: ModerationResult = {
    jobId: row.job_id,
    aliasCheck: aliasNotes.length ? 'fail' : 'pass',
    antiCheat: cheat.ok ? 'pass' : 'fail',
    duplicate: dup.ok ? 'pass' : 'fail',
    reviewer: 'auto',
    notes: [...aliasNotes, ...cheat.notes, ...dup.notes].join('; ') || 'automatic checks passed',
  };
  const pass = result.aliasCheck === 'pass' && result.antiCheat === 'pass' && result.duplicate === 'pass';
  await env.DB.prepare(HSQL.insertModeration).bind(row.job_id, result.aliasCheck, result.antiCheat, result.duplicate, 'auto', null, pass ? 'pass' : 'fail', result.notes, deps.now()).run();
  return result;
}

/** All participants granted: run the automatic checks, then queue the render or reject. */
export async function moderateConsented(env: Env, deps: WorkerDeps, cfg: Config, row: JobRow): Promise<void> {
  const result = await autoModerate(env, deps, cfg, row);
  const pass = result.aliasCheck === 'pass' && result.antiCheat === 'pass' && result.duplicate === 'pass';
  await transition(env, deps, row, pass ? 'queued_render' : 'rejected', pass ? null : 'automatic_checks');
}

/** The human step on the rendered cut (admin console). */
export async function adminDecision(env: Env, deps: WorkerDeps, row: JobRow, admin: string, approve: boolean, notes: string): Promise<boolean> {
  if (row.status !== 'pending_moderation') return false;
  const ok = await transition(env, deps, row, approve ? 'approved' : 'rejected', approve ? null : 'admin_rejected');
  if (!ok) return false;
  await env.DB.prepare(HSQL.insertModeration).bind(row.job_id, 'pass', 'pass', 'pass', 'admin', admin, approve ? 'approve' : 'reject', notes.slice(0, 500) || (approve ? 'approved' : 'rejected'), deps.now()).run();
  if (approve) await scheduleUpload(env, deps, row);
  return true;
}
