/**
 * Daily Six solo replays (engine v1): one innings against the day's sealed over, as a revealed log of kind 'daily'.
 *
 * Shape: players[1] is the Daily Six setter; the setter's over is the only plan (plans[0] repeats it to fill the
 * tuple); innings[1] is empty; no Super Ball; result.decidedBy is 'forfeit_none', result.dailyScore is the Daily Six
 * score and result.marginRuns is 0. The over's commit uses a salt derived one-way from (day, attempt, server salt), so the platform can
 * publish the three commit hashes when the day opens (`dailyCommits`) and the log never reveals the server salt.
 */
import type { BattingInput, CommitRecord, Conditions, InningsState, InningsSummary, MatchEvent, MatchEventLog, MatchResult, OverPlan, PlayerRef } from '@/contracts';
import { BALLS_PER_OVER, EVENT_SCHEMA_VERSION, WICKETS_PER_INNINGS } from '@/contracts/cricket';
import { canonicalPlan, normalizePlan } from '../canonical';
import { sha256Hex } from '../sha256';
import { summarise } from './innings';
import { ballCommentary } from './match';
import { dailyScore } from './performance';
import { dailyChallenge } from './policies';
import { RULES_VERSION } from './tables';

/** Commit salt of a daily over: one-way from the server salt, so publishing it reveals nothing about the other overs. */
export function dailyCommitSalt(day: string, attempt: 1 | 2 | 3, serverSalt: string): string {
  return sha256Hex(`vande/v1/daily-commit|${day}|${attempt}|${serverSalt}`).slice(0, 32);
}

/** The three daily overs' commit hashes (publish them, signed, when the day opens). */
export function dailyCommits(day: string, serverSalt: string): Array<{ attempt: 1 | 2 | 3; hash: string; salt: string }> {
  const { overs } = dailyChallenge(day, serverSalt);
  return ([1, 2, 3] as const).map((attempt) => {
    const salt = dailyCommitSalt(day, attempt, serverSalt);
    return { attempt, hash: sha256Hex(canonicalPlan(normalizePlan(overs[attempt - 1])) + salt), salt };
  });
}

const EMPTY_INNINGS: InningsSummary = { batter: 1, bowler: 0, balls: [], runs: 0, wickets: 0, ballsFaced: 0 };

export interface AssembleDailyArgs {
  matchId: string;
  seed: string;
  conditions: Conditions;
  player: PlayerRef;
  setter: PlayerRef;
  plan: OverPlan;
  commit: CommitRecord;
  inputs: Array<BattingInput | null>;
  innings: InningsState;
  meta: MatchEventLog['meta'];
}

/** Builds the log from a finished daily innings and the over it was played against (shared by build and verify). */
export function assembleDailyLog(a: AssembleDailyArgs): MatchEventLog {
  if (!a.innings.mainDone) throw new Error('engine: the daily innings is not finished');
  const plan = normalizePlan(a.plan);
  const summary = summarise(a.innings, 0);
  const events: MatchEvent[] = [
    { t: 'innings_start', innings: 0, batter: 0, field: plan.field },
    { t: 'commentary', key: 'commentary.innings_start', params: { batter: 0, field: plan.field, pitch: a.conditions.pitch, weather: a.conditions.weather } },
  ];
  let runs = 0;
  let wkts = 0;
  let best = Number.NEGATIVE_INFINITY;
  let bestEvent = 0;
  summary.balls.forEach((o, k) => {
    runs += o.runs;
    if (o.wicket) wkts++;
    const ballsLeft = wkts >= WICKETS_PER_INNINGS ? 0 : BALLS_PER_OVER - k - 1;
    if (o.runs > best) {
      best = o.runs;
      bestEvent = events.length;
    }
    events.push({ t: 'ball', innings: 0, ball: o.ball, outcome: o, score: { runs, wickets: wkts, ballsLeft } });
    const c = ballCommentary(o, plan.field);
    events.push({ t: 'commentary', key: c.key, params: { ...c.params, batter: 0, bowler: 1 } });
  });
  events.push({ t: 'innings_end', innings: 0, runs: summary.runs, wickets: summary.wickets });
  const score = dailyScore(summary);
  const result: MatchResult = { winner: null, tie: false, decidedBy: 'forfeit_none', marginRuns: 0, dailyScore: score, playerOfMatch: 0, turningPointEvent: bestEvent };
  events.push({ t: 'result', result });
  events.push({ t: 'commentary', key: 'commentary.daily_score', params: { score, runs: summary.runs, wickets: summary.wickets } });
  const played = new Set<number>(a.innings.outcomes.map((o) => o.ball));
  if (a.innings.superBall) played.add(a.innings.superBall.ball);
  const byBall = new Map<number, BattingInput>();
  for (const i of a.inputs) if (i && played.has(i.ball) && !byBall.has(i.ball)) byBall.set(i.ball, i);
  const placeholder: CommitRecord = { player: 0, hash: '', sig: '', keyId: '', lockedHour: a.commit.lockedHour };
  return {
    schema: EVENT_SCHEMA_VERSION,
    engine: RULES_VERSION,
    matchId: a.matchId,
    kind: 'daily',
    seed: a.seed,
    conditions: { pitch: a.conditions.pitch, weather: a.conditions.weather },
    players: [a.player, a.setter],
    commits: [placeholder, { ...a.commit, player: 1 }],
    plans: [plan, plan],
    inputs: [[...byBall.values()].sort((x, y) => x.ball - y.ball), []],
    innings: [summary, EMPTY_INNINGS],
    superBall: { used: false, outcomes: null },
    result,
    events,
    meta: a.meta,
  };
}

export function buildDailyLog(a: {
  attemptId: string;
  day: string;
  attempt: 1 | 2 | 3;
  seed: string;
  serverSalt: string;
  player: PlayerRef;
  setter: PlayerRef;
  inputs: Array<BattingInput | null>;
  innings: InningsState;
  meta: MatchEventLog['meta'];
}): MatchEventLog {
  const ch = dailyChallenge(a.day, a.serverSalt);
  const plan = normalizePlan(ch.overs[a.attempt - 1]);
  const salt = dailyCommitSalt(a.day, a.attempt, a.serverSalt);
  const commit: CommitRecord = { player: 1, hash: sha256Hex(canonicalPlan(plan) + salt), sig: '', keyId: '', lockedHour: a.meta.createdHour, salt };
  return assembleDailyLog({ matchId: a.attemptId, seed: a.seed, conditions: ch.conditions, player: a.player, setter: a.setter, plan, commit, inputs: a.inputs, innings: a.innings, meta: a.meta });
}
