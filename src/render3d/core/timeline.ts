/**
 * Replay timeline: a MatchEventLog plus a ReplayMode becomes an ordered list of segments (intro, innings cards,
 * one segment per ball, innings break, Super Ball, result). Ball segments carry a choreography script and a
 * slow-motion time warp, so `locate(timeline, ms)` maps any replay time to a scene time deterministically.
 *
 * Ball scripts are physics (src/physics) and cost real time to build, so the timeline the reveal and the renderer
 * share (replayTimeline) is progressive: the intro, the cards and the first ball at once, every other ball in idle
 * time, in order. A ball still to build holds a provisional length; building it shifts only what comes after it.
 * Anything that needs a moment exactly builds up to it first (locate, a pending ball's script, resultTime,
 * completeTimeline), so every answer is the one the complete timeline gives.
 */
import type { BallOutcome, Conditions, DeliveryFamily, FieldSetting, MatchEventLog, ReplayMode } from '@/contracts';
import type { Look } from './actors';
import { type BallScript, type Cast, buildAmbientScript, buildBallScript } from './choreo';
import { clamp, hash32 } from './math';
import { engineBallTimeline } from './engineBridge';
import { familyOf } from './trajectory';

export type SegmentKind = 'intro' | 'innings_start' | 'ball' | 'innings_end' | 'super_start' | 'result';

export interface Score {
  runs: number;
  wickets: number;
  ballsLeft: number;
}

export interface Segment {
  kind: SegmentKind;
  t0: number;
  dur: number;
  eventIndex: number;
  innings: 0 | 1 | 'super' | null;
  /** Batting and bowling player indices for this segment. */
  batting: 0 | 1;
  bowling: 0 | 1;
  /** Ball number within the innings (0–5, 6 = Super Ball). */
  ball: number | null;
  /** Ordinal among ball segments in this timeline. */
  ballOrdinal: number | null;
  outcome: BallOutcome | null;
  scoreBefore: Score | null;
  score: Score | null;
  field: FieldSetting;
  script: BallScript;
  /** Scene window played by this segment and the slow-motion warp (scene ms). */
  sceneStart: number;
  sceneEnd: number;
  slow: { t0: number; t1: number; rate: number } | null;
  key: boolean;
  /** Result segments: the held breath before the result shows (ms from t0). Nothing about it is disclosed earlier. */
  beat?: number;
}

export interface Timeline {
  mode: ReplayMode;
  duration: number;
  segments: Segment[];
  /** Indices of ball segments. */
  balls: number[];
  /** Ball segments still to build (their length, and so every later t0 and the duration, is provisional). */
  pending: number;
  /** Bumped each time a pending ball is built and the layout after it shifts. */
  version: number;
}

/** The held breath before the result card: the crowd hushes, the camera pushes in and the sound builds. */
export const RESULT_BEAT_MS = 1400;

const DUR = {
  full: { intro: 3600, innings: 2600, inningsEnd: 2600, super: 2600, result: 6500, tail: 350 },
  key_moments: { intro: 2200, innings: 1500, inningsEnd: 1500, super: 1800, result: 5500, tail: 250 },
  result_only: { intro: 1400, innings: 0, inningsEnd: 0, super: 0, result: 6500, tail: 0 },
} as const;

function teamLook(log: MatchEventLog, team: 0 | 1, slot: string, gear: Look['gear'], hero = false): Look {
  const p = log.players[team];
  return { seed: hero ? p.avatar.seed : `${p.id}:${slot}`, team, gear, hero };
}

export function castFor(log: MatchEventLog, batting: 0 | 1, bowling: 0 | 1, striker: number, nonStriker: number): Cast {
  const batterLook = (n: number): Look => (n === 0 ? teamLook(log, batting, 'b0', 'batter', true) : teamLook(log, batting, `b${n}`, 'batter'));
  return {
    bowler: teamLook(log, bowling, 'bowler', 'bowler', true),
    striker: batterLook(striker),
    nonStriker: batterLook(nonStriker),
    keeper: teamLook(log, bowling, 'keeper', 'keeper'),
    fielders: Array.from({ length: 9 }, (_, i) => teamLook(log, bowling, `f${i}`, 'fielder')),
    umpires: [
      { seed: `umpire:${log.matchId}:0`, team: 0, gear: 'umpire' },
      { seed: `umpire:${log.matchId}:1`, team: 0, gear: 'umpire' },
    ],
  };
}

interface BallInfo {
  eventIndex: number;
  innings: 0 | 1 | 'super';
  ball: number;
  outcome: BallOutcome;
  score: Score;
  scoreBefore: Score;
  batting: 0 | 1;
  bowling: 0 | 1;
  striker: number;
  nonStriker: number;
  field: FieldSetting;
}

/** Walks the event log once: who bats, who is on strike, the field and the score before/after every ball. */
function collectBalls(log: MatchEventLog): BallInfo[] {
  const out: BallInfo[] = [];
  const fields: [FieldSetting, FieldSetting] = [log.plans[0]?.field ?? 'balanced', log.plans[1]?.field ?? 'balanced'];
  let striker = 0;
  let nonStriker = 1;
  let nextBatter = 2;
  let current: 0 | 1 | 'super' | null = null;
  let superCount = 0;
  let before: Score = { runs: 0, wickets: 0, ballsLeft: 6 };
  log.events.forEach((e, i) => {
    if (e.t === 'innings_start') {
      striker = 0;
      nonStriker = 1;
      nextBatter = 2;
      before = { runs: 0, wickets: 0, ballsLeft: 6 };
      current = e.innings;
      return;
    }
    if (e.t !== 'ball') return;
    if (e.innings !== current) {
      current = e.innings;
      striker = 0;
      nonStriker = 1;
      nextBatter = 2;
      before = { runs: 0, wickets: 0, ballsLeft: e.innings === 'super' ? 1 : 6 };
    }
    let batting: 0 | 1;
    if (e.innings === 'super') {
      batting = log.innings[superCount % 2]?.batter ?? ((superCount % 2) as 0 | 1);
      superCount++;
      before = { runs: 0, wickets: 0, ballsLeft: 1 };
    } else batting = log.innings[e.innings]?.batter ?? e.innings;
    const bowling: 0 | 1 = batting === 0 ? 1 : 0;
    out.push({
      eventIndex: i,
      innings: e.innings,
      ball: e.ball,
      outcome: e.outcome,
      score: e.score,
      scoreBefore: before,
      batting,
      bowling,
      striker,
      nonStriker,
      // The batter faces the bowling side's field (the bowler's plan).
      field: e.innings === 'super' ? fields[bowling] : fields[bowling],
    });
    before = e.score;
    if (e.outcome.wicket) striker = nextBatter++;
    else if (e.outcome.runs === 1 || e.outcome.runs === 3) [striker, nonStriker] = [nonStriker, striker];
  });
  return out;
}

function isKey(o: BallOutcome): boolean {
  return o.cues.key || o.wicket !== null || o.runs >= 4;
}

/** A ball as the replay filter sees it. */
export interface ReplayBall {
  eventIndex: number;
  innings: 0 | 1 | 'super';
  ball: number;
  outcome: BallOutcome;
}

export interface TimelineOptions {
  /** Ball scripts do not depend on it; kept for callers that pass it. */
  reducedMotion?: boolean;
  /** Build only the first ball now and the rest in idle time (see replayTimeline). Default: everything now. */
  progressive?: boolean;
  /**
   * Keeps only the balls this returns true for, in place of the mode's own pick (e.g. Training: the player's own
   * balls plus the key moments). The intro, innings cards and the result stay. 'result_only' ignores it.
   */
  include?: (ball: ReplayBall) => boolean;
}

const cuts = new WeakMap<MatchEventLog, (ball: ReplayBall) => boolean>();

/**
 * Replaces the Key Moments pick of this log object with the balls `include` keeps (null removes the cut); Full replay
 * still plays every ball. The reveal screen, the renderer and anything else that builds this log's Key Moments then
 * play the same cut, so their times always agree.
 */
export function cutReplay(log: MatchEventLog, include: ((ball: ReplayBall) => boolean) | null): void {
  if (include) cuts.set(log, include);
  else cuts.delete(log);
  shared.get(log)?.delete('key_moments');
}

// ---------------------------------------------------------------------------------------------------------------
// Progressive building
// ---------------------------------------------------------------------------------------------------------------

interface Progress {
  /** Pending balls in timeline order: the segment and how to build its script (filling the segment in). */
  queue: Array<{ index: number; build: () => void }>;
  listeners: Set<() => void>;
  scheduled: boolean;
}

const progress = new WeakMap<Timeline, Progress>();
const shared = new WeakMap<MatchEventLog, Map<ReplayMode, Timeline>>();

/** Builds the next pending ball and lays out everything after it again. */
function buildNext(tl: Timeline, pr: Progress): void {
  const next = pr.queue.shift();
  if (!next) return;
  next.build();
  const segs = tl.segments;
  for (let k = Math.max(1, next.index + 1); k < segs.length; k++) segs[k].t0 = segs[k - 1].t0 + segs[k - 1].dur;
  const last = segs[segs.length - 1];
  tl.duration = last ? last.t0 + last.dur : 0;
  tl.pending = pr.queue.length;
  tl.version += 1;
  if (pr.listeners.size) queueMicrotask(() => pr.listeners.forEach((l) => l()));
}

/** Builds pending balls, in order, until everything that starts at or before `ms` is exact. */
function ensureUntil(tl: Timeline, ms: number): void {
  const pr = progress.get(tl);
  if (!pr) return;
  while (pr.queue.length && (tl.segments[pr.queue[0].index].t0 <= ms || ms >= tl.duration - 0.001)) buildNext(tl, pr);
}

/** Builds pending balls, in order, until segment `index` is built. */
function ensureIndex(tl: Timeline, index: number): void {
  const pr = progress.get(tl);
  if (!pr) return;
  while (pr.queue.length && pr.queue[0].index <= index) buildNext(tl, pr);
}

/** Pending balls are built one per idle slice (more while the browser stays idle), so playback never waits on them. */
function scheduleIdle(tl: Timeline, pr: Progress): void {
  if (pr.scheduled || pr.queue.length === 0) return;
  pr.scheduled = true;
  const run = (deadline?: { timeRemaining(): number }) => {
    pr.scheduled = false;
    if (!pr.queue.length) return;
    do buildNext(tl, pr);
    while (pr.queue.length && deadline && deadline.timeRemaining() > IDLE_SLACK_MS);
    scheduleIdle(tl, pr);
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(run, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(() => run(), 16);
}

/** Keep building in one idle slice while this much idle time is left (ms); a slice waits at most IDLE_TIMEOUT_MS. */
const IDLE_SLACK_MS = 12;
const IDLE_TIMEOUT_MS = 250;

/**
 * The replay timeline for a log and mode that the reveal screen and the renderer share (the same object, so their
 * times agree). Progressive: the first frame waits for the intro, the cards and the first ball only.
 */
export function replayTimeline(log: MatchEventLog, mode: ReplayMode): Timeline {
  let byMode = shared.get(log);
  const known = byMode?.get(mode);
  if (known) return known;
  const tl = buildTimeline(log, mode, { progressive: true });
  if (!byMode) shared.set(log, (byMode = new Map()));
  byMode.set(mode, tl);
  return tl;
}

/** Builds every pending ball now (seeking anywhere, Skip, a highlight render). Returns whether anything changed. */
export function completeTimeline(tl: Timeline): boolean {
  const pr = progress.get(tl);
  if (!pr || pr.queue.length === 0) return false;
  while (pr.queue.length) buildNext(tl, pr);
  return true;
}

/** Called (asynchronously) whenever a pending ball is built and the layout shifts. Returns an unsubscribe. */
export function onTimelineChange(tl: Timeline, cb: () => void): () => void {
  const pr = progress.get(tl);
  if (!pr) return () => undefined;
  pr.listeners.add(cb);
  return () => pr.listeners.delete(cb);
}

/** How long a ball runs after contact, by fate (ms): a pending ball's provisional length, until it is built. */
const AFTER_CONTACT_EST_MS: Record<string, number> = {
  dot_block: 1900,
  dot_beaten: 2000,
  dot_fielded: 4300,
  runs: 8000,
  four: 7200,
  six: 6400,
  bowled: 4400,
  caught: 7400,
  lbw: 5600,
  stumped: 4600,
  run_out: 7800,
};
/** The slow-motion window (780 ms at 0.3×) adds this much. */
const SLOW_EXTRA_EST_MS = 780 * (1 / 0.3 - 1);

function estimateBall(o: BallOutcome, conditions: Conditions, trimRunUp: boolean, tail: number): Pick<Segment, 'sceneStart' | 'sceneEnd' | 'dur'> {
  const et = engineBallTimeline(o, conditions);
  const release = et?.releaseAtMs ?? 3000;
  const contact = et?.contactAtMs ?? release + 600;
  const fate = o.cues.fate;
  const after = AFTER_CONTACT_EST_MS[fate.kind === 'wicket' ? fate.wicket : fate.kind] ?? 5000;
  const sceneStart = trimRunUp ? Math.max(0, release - 1500) : 0;
  const sceneEnd = contact + after + tail;
  return { sceneStart, sceneEnd, dur: Math.round(sceneEnd - sceneStart + (o.cues.slowMotion ? SLOW_EXTRA_EST_MS : 0)) };
}

export function buildTimeline(log: MatchEventLog, mode: ReplayMode, opts: TimelineOptions = {}): Timeline {
  const d = DUR[mode];
  const seed = hash32(`${log.matchId}:${log.seed}`);
  const balls = collectBalls(log);
  const segments: Segment[] = [];
  let t = 0;
  const firstBatting: 0 | 1 = log.innings[0]?.batter ?? 0;
  const famOf = (o: BallOutcome | undefined): DeliveryFamily => (o ? familyOf(o.cues.path, o.delivery.variant) : 'pace');
  const tl: Timeline = { mode, duration: 0, segments, balls: [], pending: 0, version: 0 };
  const pr: Progress = { queue: [], listeners: new Set(), scheduled: false };

  const ambient = (kind: SegmentKind, baseDur: number, batting: 0 | 1, field: FieldSetting, eventIndex: number, innings: Segment['innings'], fam: DeliveryFamily, extra: Partial<Segment> = {}) => {
    if (baseDur <= 0) return;
    const bowling: 0 | 1 = batting === 0 ? 1 : 0;
    const mood = kind === 'result' ? 'result' : kind === 'intro' ? 'intro' : 'innings';
    const winner = log.result.winner;
    const winners = kind === 'result' && winner !== null ? (winner === batting ? 'batting' : 'bowling') : null;
    // The result opens with the held breath; the celebrations keep their full length after it.
    const beat = kind === 'result' ? RESULT_BEAT_MS : 0;
    const dur = baseDur + beat;
    const script = buildAmbientScript(field, castFor(log, batting, bowling, 0, 1), fam, dur, hash32(`${seed}:${kind}:${eventIndex}`), mood, winners, beat);
    segments.push({
      kind,
      t0: t,
      dur,
      eventIndex,
      innings,
      batting,
      bowling,
      ball: null,
      ballOrdinal: null,
      outcome: null,
      scoreBefore: null,
      score: null,
      field,
      script,
      sceneStart: 0,
      sceneEnd: dur,
      slow: null,
      key: false,
      ...(script.beat ? { beat: script.beat } : {}),
      ...extra,
    });
    t += dur;
  };

  const ballSeg = (info: BallInfo, ordinal: number, trimRunUp: boolean) => {
    const index = segments.length;
    const seg = {
      kind: 'ball',
      t0: t,
      dur: 0,
      eventIndex: info.eventIndex,
      innings: info.innings,
      batting: info.batting,
      bowling: info.bowling,
      ball: info.ball,
      ballOrdinal: ordinal,
      outcome: info.outcome,
      scoreBefore: info.scoreBefore,
      score: info.score,
      field: info.field,
      sceneStart: 0,
      sceneEnd: 0,
      slow: null,
      key: isKey(info.outcome),
    } as Omit<Segment, 'script'> as Segment;
    const build = () => {
      const script = buildBallScript({
        outcome: info.outcome,
        field: info.field,
        cast: castFor(log, info.batting, info.bowling, info.striker, info.nonStriker),
        seed: hash32(`${seed}:${info.eventIndex}`),
        engineTimeline: engineBallTimeline(info.outcome, log.conditions),
        pitch: log.conditions.pitch,
      });
      seg.sceneStart = trimRunUp ? Math.max(0, script.times.release - 1500) : 0;
      seg.sceneEnd = script.duration + d.tail;
      seg.slow = script.slowMo ? { ...script.slowMo, t0: Math.max(script.slowMo.t0, seg.sceneStart) } : null;
      const extra = seg.slow ? (seg.slow.t1 - seg.slow.t0) * (1 / seg.slow.rate - 1) : 0;
      seg.dur = Math.round(seg.sceneEnd - seg.sceneStart + extra);
      Object.defineProperty(seg, 'script', { value: script, writable: true, enumerable: true, configurable: true });
    };
    // The first ball is built at once; with `progressive`, the rest hold a provisional length until built.
    if (!opts.progressive || ordinal === 0) build();
    else {
      Object.assign(seg, estimateBall(info.outcome, log.conditions, trimRunUp, d.tail));
      Object.defineProperty(seg, 'script', {
        enumerable: true,
        configurable: true,
        get: () => {
          ensureIndex(tl, index);
          const own = Object.getOwnPropertyDescriptor(seg, 'script');
          if (!own || own.get) throw new Error(`ball ${info.eventIndex}: script not built`);
          return own.value as BallScript;
        },
      });
      pr.queue.push({ index, build });
    }
    segments.push(seg);
    t += seg.dur;
  };

  const lastEventIndex = log.events.findIndex((e) => e.t === 'result');
  const firstField = balls[0]?.field ?? 'balanced';
  ambient('intro', d.intro, firstBatting, firstField, -1, null, famOf(balls[0]?.outcome));

  if (mode === 'result_only') {
    const last = balls[balls.length - 1];
    ambient('result', d.result, last?.batting ?? firstBatting, last?.field ?? firstField, lastEventIndex, null, famOf(last?.outcome));
  } else {
    const include = opts.include ?? (mode === 'key_moments' ? cuts.get(log) : undefined);
    let chosen = include ? balls.filter((b) => include(b)) : balls;
    if (!include && mode === 'key_moments') {
      chosen = balls.filter((b) => isKey(b.outcome));
      if (chosen.length === 0) {
        const tp = log.result.turningPointEvent;
        const pick = balls.find((b) => b.eventIndex === tp) ?? balls[balls.length - 1];
        chosen = pick ? [pick] : [];
      }
    }
    let ordinal = 0;
    let lastInnings: BallInfo['innings'] | null = null;
    for (const info of chosen) {
      if (info.innings !== lastInnings) {
        if (lastInnings !== null && lastInnings !== 'super') ambient('innings_end', d.inningsEnd, balls.find((b) => b.innings === lastInnings)!.batting, info.field, info.eventIndex, lastInnings, famOf(info.outcome));
        if (info.innings === 'super') ambient('super_start', d.super, info.batting, info.field, info.eventIndex, 'super', famOf(info.outcome));
        else ambient('innings_start', d.innings, info.batting, info.field, info.eventIndex, info.innings, famOf(info.outcome));
        lastInnings = info.innings;
      }
      ballSeg(info, ordinal++, mode === 'key_moments');
    }
    const last = balls[balls.length - 1];
    ambient('result', d.result, last?.batting ?? firstBatting, last?.field ?? firstField, lastEventIndex, null, famOf(last?.outcome));
  }

  tl.duration = t;
  tl.balls = segments.map((s, i) => (s.kind === 'ball' ? i : -1)).filter((i) => i >= 0);
  tl.pending = pr.queue.length;
  if (pr.queue.length) {
    progress.set(tl, pr);
    scheduleIdle(tl, pr);
  }
  return tl;
}

/** Maps a segment-local timeline time to scene time (applying the slow-motion warp). */
export function sceneTimeOf(seg: Segment, local: number): number {
  const l = clamp(local, 0, seg.dur);
  const s = seg.slow;
  if (!s || s.t1 <= seg.sceneStart) return seg.sceneStart + l;
  const la = s.t0 - seg.sceneStart;
  const lb = (s.t1 - s.t0) / s.rate;
  if (l < la) return seg.sceneStart + l;
  if (l < la + lb) return s.t0 + (l - la) * s.rate;
  return s.t1 + (l - la - lb);
}

/** Inverse of sceneTimeOf: the timeline time (absolute) at which a segment reaches a scene time. */
export function timelineTimeOf(seg: Segment, scene: number): number {
  const s = seg.slow;
  const x = clamp(scene, seg.sceneStart, seg.sceneEnd);
  if (!s || s.t1 <= seg.sceneStart || x <= s.t0) return seg.t0 + (x - seg.sceneStart);
  const la = s.t0 - seg.sceneStart;
  if (x <= s.t1) return seg.t0 + la + (x - s.t0) / s.rate;
  return seg.t0 + la + (s.t1 - s.t0) / s.rate + (x - s.t1);
}

export interface Located {
  index: number;
  seg: Segment;
  local: number;
  scene: number;
  /** True while the slow-motion warp is active. */
  slow: boolean;
}

export function locate(tl: Timeline, ms: number): Located {
  ensureUntil(tl, ms);
  const segs = tl.segments;
  const t = clamp(ms, 0, Math.max(0, tl.duration - 0.001));
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  const local = t - seg.t0;
  const scene = sceneTimeOf(seg, local);
  const slow = Boolean(seg.slow && scene >= seg.slow.t0 && scene < seg.slow.t1);
  return { index: lo, seg, local, scene, slow };
}

/** Start time of the result segment (Skip to Result). */
export function resultTime(tl: Timeline): number {
  completeTimeline(tl);
  const r = tl.segments.find((s) => s.kind === 'result');
  return r ? r.t0 : tl.duration;
}

/** Score to display at a timeline time (switches to the new score at the ball's decisive moment). */
export function scoreAt(tl: Timeline, ms: number): { innings: Segment['innings']; batting: 0 | 1; score: Score | null } {
  const at = locate(tl, ms);
  const seg = at.seg;
  if (seg.kind !== 'ball') {
    const prevBall = [...tl.segments.slice(0, at.index)].reverse().find((s) => s.kind === 'ball');
    if (seg.kind === 'innings_start' || seg.kind === 'super_start') return { innings: seg.innings, batting: seg.batting, score: { runs: 0, wickets: 0, ballsLeft: seg.innings === 'super' ? 1 : 6 } };
    return { innings: prevBall?.innings ?? null, batting: prevBall?.batting ?? seg.batting, score: prevBall?.score ?? null };
  }
  const decided = at.scene >= seg.script.times.decisive;
  return { innings: seg.innings, batting: seg.batting, score: decided ? seg.score : seg.scoreBefore };
}
