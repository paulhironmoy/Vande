/**
 * The cut of a highlight Short (1080x1920, 30 fps, 30–60 s), chosen deterministically from the revealed log: a hook
 * (the biggest moment teased in the first two seconds, "Coming up"), identity and fixture, the best deliveries,
 * boundaries and wickets, the turning point, the result, Player of the Match, standings movement and the "Can you beat
 * them?" call to action. Pure: the same input gives the same cut.
 */
import type { BallOutcome, MatchEventLog } from '@/contracts';
import type { Segment, Timeline } from '@/render3d/core/timeline';

export const FPS = 30 as const;
export const MIN_MS = 30_000;
export const MAX_MS = 60_000;

export type SceneKind = 'hook' | 'intro' | 'ball' | 'result' | 'potm' | 'standings' | 'cta';
export type BallTag = 'turning' | 'wicket' | 'six' | 'four' | 'best' | 'super';

export interface Scene {
  kind: SceneKind;
  /** Highlight time window (ms). */
  t0: number;
  t1: number;
  /** Replay timeline window the 3D picture plays through (held at r1 when the scene is longer). */
  r0: number;
  r1: number;
  /** Ball scenes: index into timeline.segments, and why the ball was picked. */
  seg?: number;
  tags?: BallTag[];
}

export interface HighlightPlan {
  durationMs: number;
  fps: typeof FPS;
  scenes: Scene[];
}

const CARD = { intro: 4200, result: 4200, potm: 3400, standings: 3800, cta: 5200 };
/** The hook: the top moment's decisive instant, from just before it, before anything else. */
export const HOOK_MS = 1800;
const HOOK_LEAD_MS = 1000;
/** A ball clip runs from just before the release to after the decisive moment (with its own slow motion). */
const LEAD_MS = 900;
const TAIL_MS = 2300;
const MAX_BALL_MS = 7500;

function score(o: BallOutcome, turning: boolean, superBall: boolean): { value: number; tags: BallTag[] } {
  const tags: BallTag[] = [];
  let value = 0;
  if (turning) {
    tags.push('turning');
    value += 12;
  }
  if (o.wicket) {
    tags.push('wicket');
    value += 10;
  } else if (o.runs === 6) {
    tags.push('six');
    value += 9;
  } else if (o.runs === 4) {
    tags.push('four');
    value += 7;
  }
  if (o.executionGrade === 'perfect' && !o.wicket && o.runs === 0) {
    tags.push('best');
    value += 4;
  } else if (o.executionGrade === 'perfect') value += 1;
  if (superBall) {
    tags.push('super');
    value += 6;
  }
  value += Math.min(3, o.runs) * 0.5;
  return { value, tags };
}

/** The replay window of a ball clip: lead-in before the release, through the decisive moment and its aftermath. */
export function ballWindow(seg: Segment, timelineTimeOf: (seg: Segment, scene: number) => number): { r0: number; r1: number } {
  const times = seg.script.times;
  const r0 = Math.max(seg.t0, timelineTimeOf(seg, Math.max(seg.sceneStart, times.release - LEAD_MS)));
  const end = Math.min(seg.t0 + seg.dur, timelineTimeOf(seg, Math.min(seg.sceneEnd, times.decisive + TAIL_MS)));
  return { r0, r1: Math.min(end, r0 + MAX_BALL_MS) };
}

export function planHighlight(log: MatchEventLog, tl: Timeline, opts: { standings: boolean; timelineTimeOf: (seg: Segment, scene: number) => number }): HighlightPlan {
  const turningEvent = log.result.turningPointEvent;
  const candidates = tl.segments
    .map((seg, index) => ({ seg, index }))
    .filter(({ seg }) => seg.kind === 'ball' && seg.outcome && !seg.outcome.dead)
    .map(({ seg, index }) => {
      const s = score(seg.outcome as BallOutcome, seg.eventIndex === turningEvent, seg.innings === 'super');
      const w = ballWindow(seg, opts.timelineTimeOf);
      return { index, seg, value: s.value, tags: s.tags, ...w };
    });

  // The hook teases the most telling ball (the same ranking as the cut).
  const top = [...candidates].sort((a, b) => b.value - a.value || a.index - b.index)[0] ?? null;
  const hook = top ? hookWindow(top.seg, opts.timelineTimeOf) : null;
  const cards = (hook ? HOOK_MS : 0) + CARD.intro + CARD.result + (log.kind === 'daily' ? 0 : CARD.potm) + (opts.standings ? CARD.standings : 0) + CARD.cta;
  const budget = MAX_MS - cards;
  // Highest value first (ties: earlier ball), then shown in match order.
  const ranked = [...candidates].sort((a, b) => b.value - a.value || a.index - b.index);
  const chosen: typeof candidates = [];
  let used = 0;
  for (const c of ranked) {
    const len = c.r1 - c.r0;
    if (used + len > budget) continue;
    if (c.value <= 1 && used + cards >= MIN_MS) continue;
    chosen.push(c);
    used += len;
  }
  // Too short (few eventful balls): add the remaining balls in order until the cut reaches 30 s.
  for (const c of candidates) {
    if (used + cards >= MIN_MS) break;
    if (chosen.includes(c) || used + (c.r1 - c.r0) > budget) continue;
    chosen.push(c);
    used += c.r1 - c.r0;
  }
  chosen.sort((a, b) => a.index - b.index);

  const scenes: Scene[] = [];
  let t = 0;
  const intro = tl.segments.find((s) => s.kind === 'intro');
  const result = tl.segments.find((s) => s.kind === 'result');
  // After the reveal's held breath (the highlight has its own pacing): the card goes up over the celebration.
  const resultStart = result ? result.t0 + (result.beat ?? 0) : Math.max(0, tl.duration - 6000);
  const resultEnd = result ? result.t0 + result.dur : tl.duration;
  const add = (kind: SceneKind, len: number, r0: number, r1: number, extra: Partial<Scene> = {}) => {
    scenes.push({ kind, t0: t, t1: t + len, r0, r1, ...extra });
    t += len;
  };
  // Cards stretch to fill the minimum length when the match was quiet.
  const stretch = Math.max(1, (MIN_MS - used) / cards);
  if (hook && top) add('hook', HOOK_MS, hook.r0, hook.r1, { seg: top.index, tags: top.tags });
  add('intro', Math.round(CARD.intro * stretch), intro ? intro.t0 : 0, intro ? intro.t0 + intro.dur : 3000);
  for (const c of chosen) add('ball', Math.round(c.r1 - c.r0), c.r0, c.r1, { seg: c.index, tags: c.tags });
  add('result', Math.round(CARD.result * stretch), resultStart, Math.min(resultEnd, resultStart + CARD.result));
  if (log.kind !== 'daily') add('potm', Math.round(CARD.potm * stretch), Math.min(resultEnd, resultStart + CARD.result), resultEnd);
  if (opts.standings) add('standings', Math.round(CARD.standings * stretch), resultEnd - 1, resultEnd - 1);
  add('cta', Math.round(CARD.cta * stretch), intro ? intro.t0 : 0, intro ? intro.t0 + intro.dur : 3000);
  // A whole number of milliseconds that is also a whole number of frames (multiples of 100 ms at 30 fps).
  const durationMs = Math.min(MAX_MS, Math.max(MIN_MS, Math.round(t / 100) * 100));
  // Snap the last scene to the exact duration.
  scenes[scenes.length - 1].t1 = durationMs;
  return { durationMs, fps: FPS, scenes };
}

/** The hook's replay window: the ball's decisive instant, a second in, then most of a second of what follows. */
export function hookWindow(seg: Segment, timelineTimeOf: (seg: Segment, scene: number) => number): { r0: number; r1: number } {
  const decisive = timelineTimeOf(seg, seg.script.times.decisive);
  const r0 = Math.max(seg.t0, decisive - HOOK_LEAD_MS);
  return { r0, r1: Math.min(seg.t0 + seg.dur, r0 + HOOK_MS) };
}

/** The scene at highlight time t (clamped), and the replay time the 3D picture shows. */
export function sceneAt(plan: HighlightPlan, t: number): { scene: Scene; index: number; local: number; replay: number } {
  const ms = Math.max(0, Math.min(plan.durationMs - 0.001, t));
  let index = plan.scenes.findIndex((s) => ms >= s.t0 && ms < s.t1);
  if (index < 0) index = plan.scenes.length - 1;
  const scene = plan.scenes[index];
  const local = ms - scene.t0;
  const replay = Math.min(scene.r1, scene.r0 + local);
  return { scene, index, local, replay };
}
