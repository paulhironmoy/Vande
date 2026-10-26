/**
 * Spoiler-safe disclosure for the reveal. Everything shown outside the stage (the delivery timeline, the scrubber
 * marks, the scorecard, the result and Player of the Match, the live region) is limited to what playback has reached:
 * a log event is disclosed once the replay has played it. Pure functions of the log, the replay timeline and the
 * timeline time, so every mode, reduced motion and the tests follow the same rule.
 */
import type { MatchEventLog, ReplayMode } from '@/contracts';
import { BALLS_PER_OVER, SUPER_BALL_INDEX } from '@/contracts/cricket';
import { autoXiBalls } from '@/engine/auto';
import { trainingAutoBalls } from '@/engine/training';
import { locate, type Located, type Segment, type Timeline } from '@/render3d/core/timeline';

/**
 * Where a reveal starts when the caller does not say: Key Moments for real matches (duel, cup), Practice Ghosts and
 * Training, with Full replay one tap away; every ball for a Daily Six attempt (one innings, the score is the point).
 */
export function defaultRevealMode(log: Pick<MatchEventLog, 'kind'>): ReplayMode {
  return log.kind === 'daily' ? 'full' : 'key_moments';
}

/** Where every ball, card and the result sit in log.events. */
export interface LogIndex {
  /** Event index of each innings' k-th ball (the k-th entry of log.innings[i].balls). */
  balls: [number[], number[]];
  /** Event index of each Super Ball, in play order (innings 0's batter first). */
  supers: number[];
  inningsStart: [number, number];
  inningsEnd: [number, number];
  superStart: number;
  result: number;
  last: number;
}

export function indexLog(log: MatchEventLog): LogIndex {
  const ix: LogIndex = { balls: [[], []], supers: [], inningsStart: [-1, -1], inningsEnd: [-1, -1], superStart: -1, result: -1, last: log.events.length - 1 };
  log.events.forEach((e, i) => {
    if (e.t === 'ball') {
      if (e.innings === 'super') ix.supers.push(i);
      else ix.balls[e.innings]?.push(i);
    } else if (e.t === 'innings_start') ix.inningsStart[e.innings] = i;
    else if (e.t === 'innings_end') ix.inningsEnd[e.innings] = i;
    else if (e.t === 'super_ball_start') ix.superStart = i;
    else if (e.t === 'result') ix.result = i;
  });
  return ix;
}

/**
 * The event a card segment stands for. Cards carry the index of a nearby ball (in Key Moments a later one, possibly of
 * another innings), so walk back to the card's own event of the same innings.
 */
function cardEvent(log: MatchEventLog, seg: Segment): number {
  const want = seg.kind === 'innings_start' ? 'innings_start' : seg.kind === 'innings_end' ? 'innings_end' : seg.kind === 'super_start' ? 'super_ball_start' : 'result';
  for (let i = Math.min(Math.max(seg.eventIndex, 0), log.events.length - 1); i >= 0; i--) {
    const e = log.events[i];
    if (e.t !== want) continue;
    if ((e.t === 'innings_start' || e.t === 'innings_end') && (seg.innings === 0 || seg.innings === 1) && e.innings !== seg.innings) continue;
    return i;
  }
  return -1;
}

/**
 * The log event playback is at: -1 during the intro; a ball's own event from its decisive moment (the event before it
 * until then); a card's own event; the result event on the result card.
 */
export function anchorIn(log: MatchEventLog, at: Located): number {
  const seg = at.seg;
  if (seg.kind === 'intro') return -1;
  // The held breath before the result: everything up to the result itself.
  if (seg.kind === 'result' && at.scene < (seg.beat ?? 0)) return seg.eventIndex - 1;
  if (seg.kind === 'ball') return at.scene >= seg.script.times.decisive ? seg.eventIndex : seg.eventIndex - 1;
  const own = cardEvent(log, seg);
  if (own >= 0) return own;
  return seg.kind === 'result' ? log.events.length - 1 : seg.eventIndex - 1;
}

/**
 * Highest disclosed event index at timeline time `ms` (-1: nothing yet). The result card (after its held breath) and
 * result_only disclose all.
 */
export function disclosedAt(log: MatchEventLog, tl: Timeline, ms: number): number {
  if (tl.mode === 'result_only') return log.events.length - 1;
  const at = locate(tl, ms);
  return resultShown(at) ? log.events.length - 1 : anchorIn(log, at);
}

/** The result card is up: the result segment, past its held breath. */
export function resultShown(at: Located): boolean {
  return at.seg.kind === 'result' && at.scene >= (at.seg.beat ?? 0);
}

export interface InningsView {
  /** The innings card (or a later event) has played. */
  started: boolean;
  /** The whole innings has played: the ball that ended it (no balls left), its end card, or anything later. */
  ended: boolean;
  /** How many of log.innings[i].balls are disclosed (a prefix). */
  shown: number;
  /** Score after the disclosed balls. */
  runs: number;
  wickets: number;
}

export interface Disclosure {
  upTo: number;
  complete: boolean;
  innings: [InningsView, InningsView];
  /** The Super Ball card has played (only ever true when the log has one). */
  superStarted: boolean;
  /** How many Super Balls are disclosed (0–2, in play order). */
  superShown: number;
  /** Whether ball `index` of an innings (log.innings[i].balls order), or the index-th Super Ball, is disclosed. */
  isShown(innings: 0 | 1 | 'super', index: number): boolean;
}

export function disclose(log: MatchEventLog, ix: LogIndex, upTo: number): Disclosure {
  const complete = upTo >= ix.last;
  const view = (i: 0 | 1): InningsView => {
    const events = ix.balls[i];
    const shown = complete ? events.length : events.filter((e) => e <= upTo).length;
    const lastBall = shown > 0 ? log.events[events[shown - 1]] : null;
    const score = lastBall && lastBall.t === 'ball' ? lastBall.score : { runs: 0, wickets: 0 };
    const started = complete || (ix.inningsStart[i] >= 0 ? ix.inningsStart[i] <= upTo : shown > 0);
    // Over once its end card has played, or as soon as the ball that finished it has (no balls left after it).
    const ended = complete || (ix.inningsEnd[i] >= 0 && ix.inningsEnd[i] <= upTo) || Boolean(lastBall && lastBall.t === 'ball' && lastBall.score.ballsLeft === 0);
    return { started, ended, shown, runs: score.runs, wickets: score.wickets };
  };
  const innings: [InningsView, InningsView] = [view(0), view(1)];
  const superShown = complete ? ix.supers.length : ix.supers.filter((e) => e <= upTo).length;
  const superStarted = ix.supers.length > 0 && (complete || (ix.superStart >= 0 ? ix.superStart <= upTo : superShown > 0));
  return {
    upTo,
    complete,
    innings,
    superStarted,
    superShown,
    isShown: (inn, index) => (inn === 'super' ? index < superShown : index < innings[inn].shown),
  };
}

/** Everything disclosed (Skip, the result, the end of playback, result_only, and components used outside a replay). */
export function fullDisclosure(log: MatchEventLog, ix: LogIndex = indexLog(log)): Disclosure {
  return disclose(log, ix, ix.last);
}

// --- Auto -----------------------------------------------------------------------------------------------------------

/** Who stood in for a player on a ball: Auto XI batted it, the delivery was chosen automatically, or both. */
export type AutoKind = 'batted' | 'bowled' | 'both';

export interface AutoMap {
  /** By innings and ball number (0–5); null where a player played the ball themselves. */
  main: [Array<AutoKind | null>, Array<AutoKind | null>];
  /** Super Balls by innings (the batter's). */
  super: [AutoKind | null, AutoKind | null];
  any: boolean;
}

const merge = (a: AutoKind | null, b: AutoKind): AutoKind => (a === null || a === b ? b : 'both');

/**
 * What the log can tell about stand-ins, without extra fields:
 * - an Auto Over (`commits[p].auto`): every delivery of player p's over was chosen automatically;
 * - Auto XI at a batting deadline (duels and cups): inputs identical to Auto XI's deterministic proposal (`autoXiBalls`);
 * - Training: the balls Auto XI batted for the player and the lesson balls bowled for them (`trainingAutoBalls`).
 */
export function autoBalls(log: MatchEventLog): AutoMap {
  const map: AutoMap = { main: [Array(BALLS_PER_OVER).fill(null), Array(BALLS_PER_OVER).fill(null)], super: [null, null], any: false };
  const mark = (innings: 0 | 1, ball: number, kind: AutoKind) => {
    if (ball === SUPER_BALL_INDEX) map.super[innings] = merge(map.super[innings], kind);
    else if (ball >= 0 && ball < BALLS_PER_OVER) map.main[innings][ball] = merge(map.main[innings][ball], kind);
    else return;
    map.any = true;
  };
  ([0, 1] as const).forEach((i) => {
    const bowler = log.innings[i] ? log.innings[i].bowler : i === 0 ? 1 : 0;
    if (log.commits?.[bowler]?.auto) for (let b = 0; b <= SUPER_BALL_INDEX; b++) mark(i, b, 'bowled');
  });
  if (log.kind !== 'training' && log.kind !== 'daily') {
    try {
      autoXiBalls(log).forEach((balls, i) => balls.forEach((b) => mark(i as 0 | 1, b, 'batted')));
    } catch {
      /* a malformed log simply gets no labels */
    }
  }
  if (log.kind === 'training') {
    try {
      const t = trainingAutoBalls(log);
      // The player (player 0) bats innings 0 and bowls the over the coach faces in innings 1.
      for (const b of t.batted) mark(0, b, 'batted');
      for (const b of t.bowled) mark(1, b, 'bowled');
    } catch {
      /* a malformed log simply gets no labels */
    }
  }
  return map;
}
