/**
 * The revealed match (engine v1): result and tie-break ladder, Player of the Match, turning point, match-context cue
 * upgrades and the ordered event timeline with commentary keys. Everything is a pure function of the finished innings
 * so verification can rebuild the identical log.
 */
import type {
  BallOutcome,
  BattingInput,
  CommitRecord,
  Conditions,
  InningsState,
  InningsSummary,
  MatchEvent,
  MatchEventLog,
  MatchKind,
  MatchResult,
  OverPlan,
  PlayerRef,
} from '@/contracts';
import { BALLS_PER_OVER, EVENT_SCHEMA_VERSION, SUPER_BALL_INDEX, WICKETS_PER_INNINGS } from '@/contracts/cricket';
import { normalizePlan } from '../canonical';
import { hashString } from '../prng';
import { summarise } from './innings';
import { FIELD_LAYOUTS, RULES_VERSION } from './tables';

export const COMMENTARY_KEYS: readonly string[] = [
  'commentary.innings_start',
  'commentary.chase_target',
  'commentary.chase_needs',
  'commentary.chase_won',
  'commentary.chase_short',
  'commentary.scores_level',
  'commentary.dot_block',
  'commentary.dot_beaten',
  'commentary.dot_fielded',
  'commentary.leave',
  'commentary.unanswered',
  'commentary.runs',
  'commentary.four',
  'commentary.four_edge',
  'commentary.six',
  'commentary.loose_punished',
  'commentary.wicket_bowled',
  'commentary.wicket_lbw',
  'commentary.wicket_stumped',
  'commentary.wicket_run_out',
  'commentary.wicket_caught',
  'commentary.wicket_caught_behind',
  'commentary.wicket_caught_deep',
  'commentary.wicket_setup',
  'commentary.super_ball_intro',
  'commentary.super_ball_result',
  'commentary.result_runs',
  'commentary.result_super_ball',
  'commentary.result_wickets_lost',
  'commentary.result_boundaries',
  'commentary.result_tie',
  'commentary.turning_point',
  'commentary.player_of_match',
  'commentary.daily_score',
];

/** Expected further runs per remaining ball with two / one wickets in hand (from the balance simulation). */
export const EXPECTED_RUNS_PER_BALL: Record<1 | 2, number> = { 2: 1.9, 1: 1.6 };
/** Expected Super Ball runs (presentation of the projected margin only). */
const EXPECTED_SUPER_BALL = 1.8;

function boundaries(balls: readonly BallOutcome[]): number {
  let n = 0;
  for (const b of balls) if (b.runs === 4 || b.runs === 6) n++;
  return n;
}

function expectedRest(ballsLeft: number, wicketsLost: number): number {
  if (wicketsLost >= WICKETS_PER_INNINGS || ballsLeft <= 0) return 0;
  return ballsLeft * EXPECTED_RUNS_PER_BALL[wicketsLost === 0 ? 2 : 1];
}

/** Result ladder: runs → Super Ball runs → fewer wickets lost → more boundaries → tie. */
export function decideResult(inn: [InningsSummary, InningsSummary], superBalls: [BallOutcome, BallOutcome]): Omit<MatchResult, 'playerOfMatch' | 'turningPointEvent'> {
  const [a, b] = inn;
  if (a.runs !== b.runs) return { winner: a.runs > b.runs ? 0 : 1, tie: false, decidedBy: 'runs', marginRuns: Math.abs(a.runs - b.runs) };
  const s0 = superBalls[0].runs;
  const s1 = superBalls[1].runs;
  if (s0 !== s1) return { winner: s0 > s1 ? 0 : 1, tie: false, decidedBy: 'super_ball', marginRuns: Math.abs(s0 - s1) };
  if (a.wickets !== b.wickets) return { winner: a.wickets < b.wickets ? 0 : 1, tie: false, decidedBy: 'wickets_lost', marginRuns: 0 };
  const ba = boundaries(a.balls);
  const bb = boundaries(b.balls);
  if (ba !== bb) return { winner: ba > bb ? 0 : 1, tie: false, decidedBy: 'boundaries', marginRuns: 0 };
  return { winner: null, tie: true, decidedBy: 'tie', marginRuns: 0 };
}

/**
 * Player of the Match points: runs scored + 8 per wicket taken + 1 per dot ball bowled − ½ per run conceded, +4 for the
 * winner; when the Super Ball counted, its runs, −½ per run conceded and +4 for a Super Ball wicket. Level → more
 * runs scored → more wickets taken → a coin from the match seed.
 */
export function potmPoints(inn: [InningsSummary, InningsSummary], superBalls: [BallOutcome, BallOutcome], used: boolean, winner: 0 | 1 | null): [number, number] {
  const pts: [number, number] = [0, 0];
  for (const p of [0, 1] as const) {
    const batting = inn[p];
    const bowling = inn[p === 0 ? 1 : 0];
    let dots = 0;
    for (const b of bowling.balls) if (b.runs === 0 && !b.wicket) dots++;
    pts[p] = batting.runs + 8 * bowling.wickets + dots - 0.5 * bowling.runs + (winner === p ? 4 : 0);
    if (used) {
      const mine = superBalls[p];
      const theirs = superBalls[p === 0 ? 1 : 0];
      pts[p] += mine.runs - 0.5 * theirs.runs + (theirs.wicket ? 4 : 0);
    }
  }
  return pts;
}

function playerOfMatch(seed: string, inn: [InningsSummary, InningsSummary], superBalls: [BallOutcome, BallOutcome], used: boolean, winner: 0 | 1 | null): 0 | 1 {
  const [p0, p1] = potmPoints(inn, superBalls, used, winner);
  if (p0 !== p1) return p0 > p1 ? 0 : 1;
  if (inn[0].runs !== inn[1].runs) return inn[0].runs > inn[1].runs ? 0 : 1;
  if (inn[1].wickets !== inn[0].wickets) return inn[1].wickets > inn[0].wickets ? 0 : 1;
  return (hashString(`vande/v1/potm|${seed}`) & 1) as 0 | 1;
}

interface BallRef {
  innings: 0 | 1 | 'super';
  index: number;
  outcome: BallOutcome;
}

/** Projected margin (player 0's view) after each ball of the presentation, and the ball that swung it most. */
export function turningPoint(inn: [InningsSummary, InningsSummary], superBalls: [BallOutcome, BallOutcome], used: boolean, winner: 0 | 1 | null): { innings: 0 | 1 | 'super'; index: number } {
  const refs: Array<{ innings: 0 | 1 | 'super'; index: number; margin: number }> = [];
  const base = expectedRest(BALLS_PER_OVER, 0);
  let runs = 0;
  let wkts = 0;
  inn[0].balls.forEach((b, i) => {
    runs += b.runs;
    if (b.wicket) wkts++;
    refs.push({ innings: 0, index: i, margin: runs + expectedRest(BALLS_PER_OVER - i - 1, wkts) - base });
  });
  const target = inn[0].runs;
  runs = 0;
  wkts = 0;
  inn[1].balls.forEach((b, i) => {
    runs += b.runs;
    if (b.wicket) wkts++;
    refs.push({ innings: 1, index: i, margin: target - (runs + expectedRest(BALLS_PER_OVER - i - 1, wkts)) });
  });
  if (used) {
    refs.push({ innings: 'super', index: 0, margin: superBalls[0].runs - EXPECTED_SUPER_BALL });
    refs.push({ innings: 'super', index: 1, margin: superBalls[0].runs - superBalls[1].runs });
  }
  let prev = 0;
  let best = refs[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const r of refs) {
    const delta = r.margin - prev;
    prev = r.margin;
    const score = winner === 0 ? delta : winner === 1 ? -delta : Math.abs(delta);
    if (score >= bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return { innings: best.innings, index: best.index };
}

export function ballCommentary(o: BallOutcome, field: OverPlan['field']): { key: string; params: Record<string, string | number> } {
  const params: Record<string, string | number> = { runs: o.runs, shot: o.shot, variant: o.delivery.variant, speed: o.cues.path.speedKph };
  if (o.zone) params.zone = o.zone;
  if (o.timing === 'interrupted') return { key: 'commentary.unanswered', params };
  if (o.wicket) {
    params.wicket = o.wicket;
    if (o.fielder) params.fielder = o.fielder;
    if (o.factors.setup <= -0.5) return { key: 'commentary.wicket_setup', params };
    if (o.wicket === 'caught') {
      if (!o.fielder) return { key: 'commentary.wicket_caught_behind', params };
      const cov = FIELD_LAYOUTS[field].zones[o.fielder];
      return { key: cov === 'deep' || cov === 'both' ? 'commentary.wicket_caught_deep' : 'commentary.wicket_caught', params };
    }
    return { key: `commentary.wicket_${o.wicket}`, params };
  }
  if (o.runs === 6 || o.runs === 4) {
    if (o.cues.fate.kind === 'six') params.distance = o.cues.fate.distanceM;
    if (o.executionGrade === 'loose') return { key: 'commentary.loose_punished', params };
    if (o.runs === 6) return { key: 'commentary.six', params };
    return { key: o.contact === 'thick_edge' || o.contact === 'thin_edge' ? 'commentary.four_edge' : 'commentary.four', params };
  }
  if (o.runs > 0) return { key: 'commentary.runs', params };
  if (o.shot === 'leave') return { key: 'commentary.leave', params };
  return { key: `commentary.${o.cues.fate.kind}`, params };
}

function upgrade(o: BallOutcome, opts: { milestone?: boolean; dramatic?: boolean }): BallOutcome {
  const cues = { ...o.cues, cameras: o.cues.cameras.slice() };
  if (opts.dramatic) {
    cues.key = true;
    cues.slowMotion = true;
    cues.crowd = Math.min(1, Math.round((cues.crowd + 0.1) * 100) / 100);
  }
  if (opts.milestone) {
    cues.key = true;
    cues.slowMotion = true;
    cues.crowd = 1;
    if (cues.celebration === 'none') {
      cues.celebration = 'milestone';
      const last = cues.cameras[cues.cameras.length - 1];
      cues.cameras.push({ shot: 'celebration', atMs: last.atMs + last.durationMs, durationMs: 2400 });
    }
  }
  return { ...o, cues };
}

export interface BuildArgs {
  matchId: string;
  kind: MatchKind;
  seed: string;
  conditions: Conditions;
  players: [PlayerRef, PlayerRef];
  commits: [CommitRecord, CommitRecord];
  plans: [OverPlan, OverPlan];
  inputs: [Array<BattingInput | null>, Array<BattingInput | null>];
  innings: [InningsState, InningsState];
  meta: MatchEventLog['meta'];
}

function keptInputs(list: Array<BattingInput | null>, played: ReadonlySet<number>): BattingInput[] {
  const byBall = new Map<number, BattingInput>();
  for (const i of list) if (i && played.has(i.ball) && !byBall.has(i.ball)) byBall.set(i.ball, i);
  return [...byBall.values()].sort((x, y) => x.ball - y.ball);
}

export function buildMatchLog(a: BuildArgs): MatchEventLog {
  for (const s of a.innings) if (!s.done || !s.superBall) throw new Error('engine: both innings (including the Super Ball) must be complete');
  const raw: [InningsSummary, InningsSummary] = [summarise(a.innings[0], 0), summarise(a.innings[1], 1)];
  const rawSuper: [BallOutcome, BallOutcome] = [a.innings[0].superBall as BallOutcome, a.innings[1].superBall as BallOutcome];
  const base = decideResult(raw, rawSuper);
  const used = base.decidedBy !== 'runs';
  const tp = turningPoint(raw, rawSuper, used, base.winner);

  // Match-context upgrades: the turning point, the winning hit, the last ball of a close finish, the Super Ball.
  const balls: [BallOutcome[], BallOutcome[]] = [raw[0].balls.slice(), raw[1].balls.slice()];
  if (tp.innings !== 'super') balls[tp.innings][tp.index] = upgrade(balls[tp.innings][tp.index], { dramatic: true });
  if (base.decidedBy === 'runs' && base.winner === 1) {
    let r = 0;
    for (let i = 0; i < balls[1].length; i++) {
      r += balls[1][i].runs;
      if (r > raw[0].runs) {
        balls[1][i] = upgrade(balls[1][i], { milestone: true });
        break;
      }
    }
  } else if (balls[1].length) {
    const last = balls[1].length - 1;
    if (base.decidedBy !== 'runs' || base.marginRuns <= 2) balls[1][last] = upgrade(balls[1][last], { dramatic: true });
  }
  const superOut: [BallOutcome, BallOutcome] = used ? [upgrade(rawSuper[0], { dramatic: true }), upgrade(rawSuper[1], { dramatic: true })] : rawSuper;
  if (used && tp.innings === 'super') superOut[tp.index] = upgrade(superOut[tp.index], { dramatic: true });
  // The second Super Ball completes the contest: a winning hit by player 1 is celebrated as a milestone.
  if (used && base.winner === 1) superOut[1] = upgrade(superOut[1], { milestone: true });
  const innings: [InningsSummary, InningsSummary] = [
    { ...raw[0], balls: balls[0] },
    { ...raw[1], balls: balls[1] },
  ];

  // Events.
  const events: MatchEvent[] = [];
  const refs: Array<{ ref: BallRef; eventIndex: number }> = [];
  for (const i of [0, 1] as const) {
    const bowlerPlan = a.plans[i === 0 ? 1 : 0];
    events.push({ t: 'innings_start', innings: i, batter: i, field: bowlerPlan.field });
    if (i === 0) events.push({ t: 'commentary', key: 'commentary.innings_start', params: { batter: 0, field: bowlerPlan.field, pitch: a.conditions.pitch, weather: a.conditions.weather } });
    else events.push({ t: 'commentary', key: 'commentary.chase_target', params: { batter: 1, field: bowlerPlan.field, target: innings[0].runs + 1, balls: BALLS_PER_OVER } });
    let runs = 0;
    let wkts = 0;
    let chaseWon = false;
    innings[i].balls.forEach((o, k) => {
      runs += o.runs;
      if (o.wicket) wkts++;
      const ballsLeft = wkts >= WICKETS_PER_INNINGS ? 0 : BALLS_PER_OVER - k - 1;
      refs.push({ ref: { innings: i, index: k, outcome: o }, eventIndex: events.length });
      events.push({ t: 'ball', innings: i, ball: k, outcome: o, score: { runs, wickets: wkts, ballsLeft } });
      const c = ballCommentary(o, bowlerPlan.field);
      events.push({ t: 'commentary', key: c.key, params: { ...c.params, batter: i, bowler: i === 0 ? 1 : 0 } });
      if (i === 1 && !chaseWon) {
        const need = innings[0].runs + 1 - runs;
        if (need <= 0) {
          chaseWon = true;
          events.push({ t: 'commentary', key: 'commentary.chase_won', params: { batter: 1, ballsLeft } });
        } else if (ballsLeft > 0) events.push({ t: 'commentary', key: 'commentary.chase_needs', params: { runs: need, balls: ballsLeft } });
      }
    });
    events.push({ t: 'innings_end', innings: i, runs: innings[i].runs, wickets: innings[i].wickets });
    if (i === 1 && !chaseWon) {
      if (innings[1].runs === innings[0].runs) events.push({ t: 'commentary', key: 'commentary.scores_level', params: { runs: innings[1].runs } });
      else events.push({ t: 'commentary', key: 'commentary.chase_short', params: { by: innings[0].runs - innings[1].runs } });
    }
  }
  if (used) {
    events.push({ t: 'super_ball_start' });
    events.push({ t: 'commentary', key: 'commentary.super_ball_intro', params: { runs: innings[0].runs } });
    ([0, 1] as const).forEach((p) => {
      const o = superOut[p];
      refs.push({ ref: { innings: 'super', index: p, outcome: o }, eventIndex: events.length });
      events.push({ t: 'ball', innings: 'super', ball: SUPER_BALL_INDEX, outcome: o, score: { runs: o.runs, wickets: o.wicket ? 1 : 0, ballsLeft: 0 } });
      const c = ballCommentary(o, a.plans[p === 0 ? 1 : 0].field);
      events.push({ t: 'commentary', key: c.key, params: { ...c.params, batter: p, bowler: p === 0 ? 1 : 0 } });
    });
    events.push({ t: 'commentary', key: 'commentary.super_ball_result', params: { p0: superOut[0].runs, p1: superOut[1].runs } });
  }
  const tpRef = refs.find((r) => r.ref.innings === tp.innings && r.ref.index === tp.index) ?? refs[refs.length - 1];
  const result: MatchResult = {
    ...base,
    playerOfMatch: playerOfMatch(a.seed, raw, rawSuper, used, base.winner),
    turningPointEvent: tpRef ? tpRef.eventIndex : 0,
  };
  events.push({ t: 'result', result });
  const resultParams: Record<string, string | number> = { margin: result.marginRuns };
  if (result.winner !== null) resultParams.winner = result.winner;
  events.push({ t: 'commentary', key: `commentary.result_${result.decidedBy}`, params: resultParams });
  events.push({ t: 'commentary', key: 'commentary.turning_point', params: { event: result.turningPointEvent } });
  events.push({ t: 'commentary', key: 'commentary.player_of_match', params: { player: result.playerOfMatch } });

  // Inputs for every resolved ball (live and dead main balls, then the Super Ball), each keyed by its own ball index.
  const played0 = new Set<number>([...a.innings[0].outcomes.map((b) => b.ball), SUPER_BALL_INDEX]);
  const played1 = new Set<number>([...a.innings[1].outcomes.map((b) => b.ball), SUPER_BALL_INDEX]);
  return {
    schema: EVENT_SCHEMA_VERSION,
    engine: RULES_VERSION,
    matchId: a.matchId,
    kind: a.kind,
    seed: a.seed,
    conditions: { pitch: a.conditions.pitch, weather: a.conditions.weather },
    players: a.players,
    commits: a.commits,
    plans: [normalizePlan(a.plans[0]), normalizePlan(a.plans[1])],
    inputs: [keptInputs(a.inputs[0], played0), keptInputs(a.inputs[1], played1)],
    innings,
    superBall: { used, outcomes: superOut },
    result,
    events,
    meta: a.meta,
  };
}
