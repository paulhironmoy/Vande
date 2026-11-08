/**
 * The Director's stage binding (P2): one `DirectorRuntime` per Practice stage. It turns a script's anchors
 * (`PracticeInfo.director`, plain data) into the two actors' plans, keeps them off the frame path, and gives the stage's
 * pose hooks (`hooksFor`) the life pass (breath, sway) that puts a plan on the bowler and the striker before the field and
 * the planted feet. The head pass (the head in space, the eyes, the lids) runs at the end of StageScene.poseActor on the
 * finished bones (players.applyDirectedHead, pose.ts `turnHead`), from the channels this pass sampled (face.ts FRAME.head).
 *
 * When a plan is baked:
 *   a delivery (`live`)    NOTHING in `bowl()`: both plans are baked in the first spare slices of the run-up (about a
 *                          millisecond each; the head fades in over the script's first 400 ms, so a late plan is no pop);
 *   its result (`result`)  NOTHING in the frame that builds it. The live plans keep drawing; the result's plans are baked in
 *                          the spare time of the frames after it (`work`) from the same anchors, copying the live trace up
 *                          to the first moment the result matters (`reuse`), and swapped in before that moment (a hook
 *                          that reaches it first finishes the bake there);
 *   the between-balls scene (`idle`), a replay, a demonstration, the ball close-up, the benchmark scene:
 *                          idle in slices, the rest at once (nothing is racing them).
 * A Reduced Motion change rebakes what is on screen the same way.
 *
 * Honest by construction: the plan sees the ball only through `visibleBall` (the ball as the script draws it at the time
 * asked, which the Director asks for no later than a latency ago), the opponent only as a point to look at, and the
 * result only through the anchors the live script does not have. Pure in (script, time): the draw of a frame depends on
 * nothing but the plan and the pose it is handed, so a replay of the same result draws what the live frame drew.
 */
import { evaluateActor, lookScale, type ActorTrack } from '../../../actors';
import { sampleBall, type BallScript } from '../../../choreo';
import type { PoseHook } from '../../../fieldClips';
import type { DirectorActorSpec, DirectorSpec } from '../../../../practice/script';
import P from '../params.json';
import { CH, CHANNELS } from '../channels';
import { detailForPx, prepare, sample, sampleWrapped, startPrepare, type PlanJob } from '../director';
import { BRAKE, DRAWN, FRAME, SEAM, smooth, type Seam } from './face';
import { applyLife } from './pose';
import { deliveryTakeKey } from '../seeds';
import type { Detail, DirectorAnchors, DirectorPlan, Role } from '../types';

/** Why a script was built (session.ts ScriptKind): what the runtime does at once and what it leaves to spare time. */
export type DirectorScriptKind = 'idle' | 'live' | 'result' | 'replay' | 'demo' | 'closeup' | 'bench';

/** The script's loop (a between-balls scene): the last `FADE` ms are cross-faded into the `FADE` ms before its start. */
const SEAM_MS = 600;
/** A plan that appears while a scene is already showing (a rebake) takes over over this long. */
const FADE_MS = 500;
/** A delivery's script cuts in from the scene before it: the Director's head takes over from the clip over its first 400 ms. */
const START_FADE_MS = 400;
/** The upright eye and the bowling hand, in rig heights (the head bone's origin 1.595 m up, the eye 8 cm higher at scale 1). */
const EYE_Y = 1.675;
/** Hand heights (rig heights) running and at the top of the action, and where the hand is relative to the body. */
const HAND_Y = [1.05, 2.2] as const;
const HAND_SIDE = 0.22;
const HAND_FWD = 0.12;
/** The ball's velocity (for the pursuit's extrapolation) is measured over this long, ending at the time asked (ms). */
const BALL_V_MS = 10;
/** The unhit ball stops differing from the hit one this long after the first moment they can (the shortest pursuit lag). */
const BALL_LAG_MS = 125;
/** A delivery's plans must be in by this scene time; before that they are baked in the spare time of the frames. */
const LIVE_DEADLINE_MS = 700;
/**
 * A plan with a deadline (a delivery's, a result's) is served from its deadline on while it is still being baked (P3): a frame
 * asks only for the trace up to this far ahead of the playhead, so a deadline that the spare time has not met forces a slice or
 * two, never the rest of the plan. The spare time itself bakes every such plan this far past its deadline before it finishes any.
 */
const LOOKAHEAD_MS = 100;
const AHEAD_MS = 300;
/** A live plan is copied at most to this long before its end (its last blink may be cut by the end). */
const END_MARGIN_MS = 1500;

const DEG = 180 / Math.PI;

interface Pending {
  role: Role;
  /** Makes the job on its first spare slice (the events of a plan are built there, not in the frame that asked for it). */
  make: () => PlanJob;
  job: PlanJob | null;
  /** The first scene time the old plan no longer holds for: the bake must be swapped in by then. */
  deadline: number;
  /** The plan replaces one the scene was already showing in another setting: it takes over over FADE_MS. */
  fadeIn: boolean;
  /** The plan is in the entry and serving while it is still being baked (a deadline passed). */
  serving: boolean;
  /** The job bakes the next lap of a scene between balls (Entry.next), not the plan the entry draws with. */
  next?: boolean;
}

interface Entry {
  script: BallScript;
  spec: DirectorSpec;
  kind: DirectorScriptKind;
  /** The delivery's key (its ball's seed), or the scene's own (between balls: the look and a count). */
  key: string;
  /** The Reduced Motion setting the plans were baked with. */
  rm: boolean;
  plans: Record<Role, DirectorPlan | null>;
  pending: Pending[];
  /** Fade a plan in from the first frame that uses it (a scene already showing); `fade0` is that frame's scene time. */
  fade: boolean;
  fade0: number;
  loop: boolean;
  /** The head each actor's first frames continue from (P3, a delivery that follows another scene), undefined until the first frame. */
  seam: Partial<Record<Role, Seam | null>>;
  /**
   * Rolling laps of a scene between balls (P3): the lap each actor is in (0: the first, whose key is the scene's), the plan of the
   * next lap once it is baked (the end of this lap fades into its pre-roll and it takes over at the wrap), whether it is queued, and
   * the last scene time read (a drop of more than half the loop is the wrap).
   */
  lap: Record<Role, number>;
  next: Record<Role, DirectorPlan | null>;
  nextQueued: Record<Role, boolean>;
  lastT: Record<Role, number>;
}

interface Cache {
  plan: DirectorPlan | null;
  t: number;
  detail: Detail;
  out: Float32Array;
}

export class DirectorRuntime {
  /** The one switch: off, every hook is a no-op and every rig keeps its own blink (today's behaviour). */
  enabled = true;
  reducedMotion = false;
  private readonly entries = new WeakMap<BallScript, Entry>();
  private readonly hooks = new WeakMap<BallScript, { life: PoseHook }>();
  /** Entries with unfinished bakes, oldest first, and the ones on screen (for a Reduced Motion change). */
  private queue: Entry[] = [];
  private active: Entry[] = [];
  private idleCount = 0;
  private readonly cache: Record<Role, Cache> = {
    bowler: { plan: null, t: Number.NaN, detail: 2, out: new Float32Array(CHANNELS) },
    striker: { plan: null, t: Number.NaN, detail: 2, out: new Float32Array(CHANNELS) },
  };
  /** How much of each actor's face is worth drawing at its size on screen (P3, set by the stage from the camera each frame; the plan's own until then). */
  private readonly detailOf: Partial<Record<Role, Detail>> = {};
  private readonly scratch = new Float32Array(CHANNELS);
  /** The entry each actor was last drawn with: a delivery whose first frame follows another entry continues from its head (the seam). */
  private readonly lastEntry: Record<Role, Entry | null> = { bowler: null, striker: null };
  /** Whether a delivery continues from the head of the scene before it (the seam, P3). Off: today's hard cut. */
  seamOn = true;
  /** Counters for the tests and the probes. */
  readonly stats = { syncBakes: 0, jobs: 0, swaps: 0, forced: 0, forcedSlices: 0, forcedMax: 0 };

  /**
   * The actor's head as tall as `px` CSS pixels on screen now: sets how much of his face the Director draws (eyes and lids from 12 px,
   * the expressions from a 38 px head, 15% hysteresis against the level he had). Below the level the channels are zero.
   */
  setHeadPx(role: Role, px: number): void {
    this.detailOf[role] = detailForPx(px, this.detailOf[role]);
  }

  // ---- building ---------------------------------------------------------------------------------------------------

  /** A script was built: make its plans, or queue them (see the top of the file). Never throws. */
  register(script: BallScript, kind: DirectorScriptKind, prev: BallScript | null | undefined): void {
    const spec = script.practice?.director;
    if (!this.enabled || !spec || this.entries.has(script)) return;
    const look = script.actors.find((x) => x.id === 'bowler')?.look.seed ?? '';
    const key = spec.seed !== null ? deliveryTakeKey({ seed: spec.seed }) : `${look}|${kind}.${kind === 'idle' ? ++this.idleCount : 0}`;
    const e: Entry = { script, spec, kind, key, rm: this.reducedMotion, plans: { bowler: null, striker: null }, pending: [], fade: false, fade0: Number.NaN, loop: kind === 'idle', seam: {}, lap: { bowler: 0, striker: 0 }, next: { bowler: null, striker: null }, nextQueued: { bowler: false, striker: false }, lastT: { bowler: Number.NaN, striker: Number.NaN } };
    try {
      this.entries.set(script, e);
      if (kind === 'idle') {
        // A scene between balls: the plans arrive while it is showing, so they fade in; nothing is racing them.
        e.fade = true;
        this.queueBoth(e, e.rm, false, Number.POSITIVE_INFINITY);
      } else if (kind === 'live') {
        // A delivery: bowl() builds nothing. The plans are baked in the first spare slices of the run-up (the head takes over
        // from the clip over the script's first START_FADE_MS, so they may arrive late without a pop); a hook that reaches
        // LIVE_DEADLINE_MS first finishes them.
        this.queueBoth(e, e.rm, false, LIVE_DEADLINE_MS);
        this.queue.unshift(e);
      } else if (kind === 'result' && prev && this.takeOver(e, this.entries.get(prev))) {
        // the live plans carry on; the result's are baked in the spare time that follows
      } else this.bakeNow(e);
      // The scene on screen between balls and the delivery, replay or benchmark scene on screen: what a Reduced Motion change rebakes.
      this.active = this.active.filter((x) => (x.kind === 'idle') !== (kind === 'idle'));
      this.active.push(e);
    } catch {
      // The Director never breaks a delivery: this script is drawn as it always was.
      this.entries.delete(script);
    }
  }

  /** Reduced Motion changed: what is on screen is baked again with the new setting. */
  setReducedMotion(on: boolean): void {
    if (this.reducedMotion === on) return;
    this.reducedMotion = on;
    for (const e of this.active) {
      if (e.rm === on) continue;
      try {
        // A plan serving while it is baked must be whole before the job that fills it is dropped.
        for (const p of e.pending.slice()) if (p.serving && !p.next) this.complete(e, p);
        e.pending = [];
        // the next lap of a scene between balls was baked in the other setting: dropped, and baked again when the scene is read
        e.next.bowler = e.next.striker = null;
        e.nextQueued.bowler = e.nextQueued.striker = false;
        this.queue = this.queue.filter((x) => x !== e);
        // The plans in the other setting go on serving only if they are the quiet ones (see planOf); the new ones take over.
        this.queueBoth(e, on, true, Number.POSITIVE_INFINITY);
      } catch {
        e.plans = { bowler: null, striker: null };
      }
    }
  }

  private anchors(e: Entry, role: Role, rm: boolean, key: string = e.key): DirectorAnchors {
    const spec = e.spec;
    const a: DirectorActorSpec = role === 'bowler' ? spec.bowler : spec.striker;
    const bowlerTrack = e.script.actors.find((x) => x.id === 'bowler')!;
    const strikerTrack = e.script.actors.find((x) => x.id === 'striker')!;
    const track = role === 'bowler' ? bowlerTrack : strikerTrack;
    const scale = lookScale(bowlerTrack.look);
    const seam = e.loop ? SEAM_MS : null;
    const eye = spec.strikerEye;
    /** The bowler's head (eye) as drawn at t. */
    const bowlerEye = (t: number): { x: number; y: number; z: number } => {
      const st = evaluateActor(bowlerTrack, t);
      return { x: st.pos.x + (st.body?.x ?? 0), y: EYE_Y * scale, z: st.pos.z + (st.body?.z ?? 0) };
    };
    /** The bowling hand: a generic action (the hand rises over the last 650 ms), the same for every ball, never the release point. */
    const hand = (t: number): { x: number; y: number; z: number } => {
      const st = evaluateActor(bowlerTrack, t);
      const h = st.heading;
      const R = spec.bowler.release ?? 0;
      const k = smooth((t - (R - 650)) / 650);
      const side = (bowlerTrack.mirror ? 1 : -1) * HAND_SIDE * scale;
      const fwd = HAND_FWD * scale;
      return {
        x: st.pos.x + (st.body?.x ?? 0) + Math.cos(h) * side + Math.sin(h) * fwd,
        y: (HAND_Y[0] + (HAND_Y[1] - HAND_Y[0]) * k) * scale,
        z: st.pos.z + (st.body?.z ?? 0) - Math.sin(h) * side + Math.cos(h) * fwd,
      };
    };
    const dir = (from: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, out: Float64Array): void => {
      const fwd = role === 'bowler' ? p.z - from.z : from.z - p.z;
      const left = role === 'bowler' ? p.x - from.x : from.x - p.x;
      out[0] = Math.atan2(left, fwd) * DEG;
      out[1] = Math.atan2(from.y - p.y, Math.hypot(fwd, left)) * DEG;
    };
    const myEye = (t: number) => (role === 'bowler' ? bowlerEye(t) : eye);
    return {
      role,
      person: track.look.seed,
      key,
      start: seam === null ? a.start : -SEAM_MS,
      end: a.end,
      gather: a.gather,
      release: a.release,
      swing: a.swing,
      contact: a.contact,
      taskEnd: a.taskEnd,
      outcomeAt: a.outcomeAt,
      outcome: a.outcome,
      dead: a.dead,
      strokeEnd: a.strokeEnd,
      runs: a.runs,
      runStart: a.runStart,
      followEnd: a.followEnd,
      seamMs: seam,
      headMode: 'space',
      reducedMotion: rm,
      headPx: 40,
      visibleBall: (t, out, ahead = 0) => {
        const at = (s: number) =>
          sampleBall(e.script, s, (id) => {
            if (id !== 'bowler') return null;
            const h = hand(s);
            return { x: h.x, y: h.y, z: h.z };
          });
        const b = at(t);
        if (!b.visible) return false;
        let x = b.pos.x;
        let y = b.pos.y;
        let z = b.pos.z;
        if (ahead > 0) {
          // Constant velocity from the ball as drawn at t and BALL_V_MS before it (nothing later than t). Across a change of
          // holder or of kind (the hand to the air) the two samples are not one motion: no extrapolation for that sample.
          const b2 = at(t - BALL_V_MS);
          if (b2.visible && b2.heldBy === b.heldBy && b2.inFlight === b.inFlight) {
            const k = ahead / BALL_V_MS;
            x += (x - b2.pos.x) * k;
            y += (y - b2.pos.y) * k;
            z += (z - b2.pos.z) * k;
          }
        }
        dir(myEye(t + ahead), { x, y, z }, out);
        return true;
      },
      aim: (target, t, out) => {
        const from = myEye(t);
        if (role === 'bowler') dir(from, eye, out);
        else dir(from, target === 'hand' ? hand(t) : bowlerEye(t), out);
        return true;
      },
      clipHead: () => undefined,
    };
  }

  /** Bakes both plans now (nothing is racing them). */
  private bakeNow(e: Entry): void {
    for (const role of ['bowler', 'striker'] as const) e.plans[role] = prepare(this.anchors(e, role, e.rm), { hz: 60 });
    this.stats.syncBakes += 2;
  }

  /** Queues both plans to be baked in the spare time of frames (no reuse); each must be in by scene time `deadline`. */
  private queueBoth(e: Entry, rm: boolean, fadeIn: boolean, deadline: number): void {
    e.rm = rm;
    for (const role of ['bowler', 'striker'] as const) {
      e.pending.push({ role, make: () => startPrepare(this.anchors(e, role, rm), { hz: 60 }), job: null, deadline, fadeIn, serving: false });
      this.stats.jobs++;
    }
    if (!this.queue.includes(e)) this.queue.push(e);
  }

  /**
   * The result's script takes over a delivery: its plans are the live ones until they are rebaked from the result's
   * anchors in the spare time that follows (copying the live trace up to the first moment the result matters).
   * False when the live script has no plans to carry on with.
   */
  private takeOver(e: Entry, live: Entry | undefined): boolean {
    if (!live || !live.plans.bowler || !live.plans.striker || live.rm !== e.rm) return false;
    e.plans = { bowler: live.plans.bowler, striker: live.plans.striker };
    // The first scene time the live plans can differ from the result's: the contact, the outcome, the dead ball, the
    // stroke's end, the end of the ball the live script draws (it holds still there), each a pursuit lag later, and the
    // live task window's end (no blink falls in it).
    const s = e.spec.striker;
    const liveS = live.spec.striker;
    const nz = (x: number | null, add: number) => (x === null ? Number.POSITIVE_INFINITY : x + add);
    const ball = Math.min(nz(s.contact, BALL_LAG_MS), nz(s.outcomeAt, 180), nz(s.dead, BALL_LAG_MS), nz(live.spec.flightEnd, BALL_LAG_MS), nz(liveS.taskEnd, 150 - 12));
    for (const role of ['bowler', 'striker'] as const) {
      const livePlan = live.plans[role]!;
      const own = role === 'striker' ? Math.min(ball, nz(s.strokeEnd, 0)) : ball;
      const untilMs = Math.min(own, livePlan.t0 + ((livePlan.n - 1) * 1000) / livePlan.hz - END_MARGIN_MS);
      e.pending.push({
        role,
        make: () => startPrepare(this.anchors(e, role, e.rm), { hz: 60, reuse: { plan: livePlan, untilMs } }),
        job: null,
        deadline: untilMs,
        fadeIn: false,
        serving: false,
      });
      this.stats.jobs++;
    }
    // A result's plans have a deadline: ahead of anything between balls.
    this.queue.unshift(e);
    return true;
  }

  // ---- spare time -------------------------------------------------------------------------------------------------

  /** True while some bake is waiting. */
  get busy(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Bakes for at most `budgetMs` of the clock `now` gives (at least one slice), result plans first. `shown`: the script
   * the stage is drawing; the scene between balls is baked only while it is the one shown (a delivery does not spend its
   * run-up frames on a scene nobody sees; it is picked up again when the stage returns to it). A plan with a deadline is
   * baked past it (`AHEAD_MS`) before any plan is finished, so a frame that reaches it finds the trace there. Returns true
   * if work remains. `workUrgent` does only that first part (what has a deadline coming), `workRest` only the rest (the tails of
   * the plans being served, the scene between balls): the stage gives the first its spare time ahead of the gaze and the
   * reach plan and the second what they leave. `work` is both, in that order.
   */
  work(budgetMs: number, now: () => number, shown?: BallScript): boolean {
    return this.run(budgetMs, now, shown, 'all');
  }

  workUrgent(budgetMs: number, now: () => number, shown?: BallScript): boolean {
    return this.run(budgetMs, now, shown, 'urgent');
  }

  workRest(budgetMs: number, now: () => number, shown?: BallScript): boolean {
    return this.run(budgetMs, now, shown, 'rest');
  }

  /** True while some plan is not yet baked as far past its deadline as the spare time should take it. */
  get urgent(): boolean {
    for (const e of this.queue) for (const p of e.pending) if (this.isUrgent(p)) return true;
    return false;
  }

  private isUrgent(p: Pending): boolean {
    return Number.isFinite(p.deadline) && (!p.job || p.job.horizonMs <= p.deadline + AHEAD_MS);
  }

  private run(budgetMs: number, now: () => number, shown: BallScript | undefined, mode: 'all' | 'urgent' | 'rest'): boolean {
    if (this.queue.length === 0) return false;
    const until = now() + budgetMs;
    for (;;) {
      const e = this.queue.find((x) => (x.kind !== 'idle' || x.script === shown) && (mode !== 'urgent' || x.pending.some((p) => this.isUrgent(p))));
      const p = e ? this.next(e, mode) : undefined;
      if (!e || !p) {
        // an entry with nothing pending leaves the queue; one that is waiting for its scene to be shown stays
        const done = this.queue.find((x) => x.pending.length === 0);
        if (!done || mode === 'urgent') break;
        this.queue = this.queue.filter((x) => x !== done);
        continue;
      }
      const job = (p.job ??= p.make());
      // Past its deadline plus the cushion the plan is finished slice by slice; before that it only runs up to it.
      const goal = Number.isFinite(p.deadline) ? p.deadline + AHEAD_MS : Number.NEGATIVE_INFINITY;
      const toGoal = mode === 'urgent' || job.horizonMs <= goal;
      let finished: boolean;
      do {
        finished = job.advance(1);
      } while (!finished && now() < until && (!toGoal || job.horizonMs <= goal));
      if (finished) this.complete(e, p);
      else if (toGoal && job.horizonMs <= goal) break; // the budget ran out on the way to the goal
      if (now() >= until) break;
    }
    return this.queue.length > 0;
  }

  /** The pending plan to work on next in an entry: one not yet baked up to its deadline's cushion, else the first. */
  private next(e: Entry, mode: 'all' | 'urgent' | 'rest' = 'all'): Pending | undefined {
    for (const p of e.pending) if (this.isUrgent(p)) return p;
    return mode === 'urgent' ? undefined : e.pending[0];
  }

  /** Puts the plan a job is filling into its entry (once): from now on the entry draws with it. */
  private swapIn(e: Entry, p: Pending): void {
    if (p.serving) return;
    p.serving = true;
    if (p.next) {
      // the next lap of a scene between balls waits for the wrap
      e.next[p.role] = p.job!.partial;
      e.nextQueued[p.role] = false;
      return;
    }
    e.plans[p.role] = p.job!.partial;
    if (p.fadeIn) {
      e.fade = true;
      e.fade0 = Number.NaN;
    }
    this.stats.swaps++;
  }

  /** A job is done: its plan is the entry's, and the job is no longer pending. */
  private complete(e: Entry, p: Pending): void {
    const job = p.job ?? (p.job = p.make());
    while (!job.advance(1 << 20)) {
      /* to the end */
    }
    this.settle(e, p);
  }

  private settle(e: Entry, p: Pending): void {
    this.swapIn(e, p);
    e.pending.splice(e.pending.indexOf(p), 1);
    if (e.pending.length === 0) this.queue = this.queue.filter((x) => x !== e);
  }

  /**
   * A hook that has reached a pending plan's deadline before the spare time met it serves the plan from now on, baked as far
   * as this frame needs (the playhead plus `LOOKAHEAD_MS`): usually nothing is left to do, and never more than the
   * slices the trace is behind by.
   */
  private force(e: Entry, role: Role, t: number): void {
    for (let i = e.pending.length - 1; i >= 0; i--) {
      const p = e.pending[i];
      if (p.role !== role || t < p.deadline) continue;
      const job = (p.job ??= p.make());
      const ran = job.advanceTo(t + LOOKAHEAD_MS);
      if (ran > 0) {
        this.stats.forced++;
        this.stats.forcedSlices += ran;
        if (ran > this.stats.forcedMax) this.stats.forcedMax = ran;
      }
      if (job.done) this.settle(e, p);
      else this.swapIn(e, p);
    }
  }

  // ---- the plans on a pose ----------------------------------------------------------------------------------------

  /** The plan to draw `role` with at scene time t in this entry, or null (none yet, or the wrong Reduced Motion setting). */
  private planOf(e: Entry, role: Role, t: number): DirectorPlan | null {
    if (e.pending.length) this.force(e, role, t);
    const plan = e.plans[role];
    // A plan baked loud cannot serve once Reduced Motion is on; a quiet one serves after it is off.
    if (!plan || (this.reducedMotion && !plan.reducedMotion)) return null;
    return plan;
  }

  private read(e: Entry, role: Role, plan: DirectorPlan, t: number): Float32Array {
    const c = this.cache[role];
    if (e.loop) {
      const end = e.spec.bowler.end;
      // The wrap: a scene between balls goes round every minute. Its next lap is a plan of its own (another key), baked ahead in the spare
      // time and faded into at the seam, so the minute never repeats (rolling idle plans, P3); without it the lap repeats itself.
      if (t < e.lastT[role] - end / 2) {
        e.lap[role]++;
        if (e.next[role]) {
          e.plans[role] = e.next[role];
          e.next[role] = null;
          plan = e.plans[role]!;
        }
      }
      e.lastT[role] = t;
      if (!e.next[role] && !e.nextQueued[role] && !e.pending.some((p) => p.role === role)) this.queueNext(e, role);
    }
    const detail = this.detailOf[role] ?? plan.detail;
    if (c.plan === plan && c.t === t && c.detail === detail && !e.loop) return c.out;
    if (e.loop) sampleWrapped(plan, t, e.spec.bowler.end, SEAM_MS, c.out, this.scratch, detail, e.next[role] ?? plan);
    else sample(plan, t, c.out, detail);
    // The batter's effort belongs to his own input, not to the plan: it comes up from the swing he made (a closed form of the anchors).
    if (role === 'striker' && detail >= 2) c.out[CH.xEffort] = this.effort(e, t, plan.reducedMotion);
    c.plan = plan;
    c.t = t;
    c.detail = detail;
    return c.out;
  }

  /** Queues the bake of an actor's next lap of a scene between balls (its key is the scene's with the lap number). */
  private queueNext(e: Entry, role: Role): void {
    e.nextQueued[role] = true;
    const key = `${e.key}.${e.lap[role] + 1}`;
    e.pending.push({ role, make: () => startPrepare(this.anchors(e, role, e.rm, key), { hz: 60 }), job: null, deadline: Number.POSITIVE_INFINITY, fadeIn: false, serving: false, next: true });
    if (!this.queue.includes(e)) this.queue.push(e);
  }

  /**
   * The batter's effort face (P3): from the moment of his own swing input (`swing`), up over 120 ms, held through the stroke and
   * down over 500 ms after it (1.5 times slower in Reduced Motion). Nothing before his input, nothing from the result.
   */
  private effort(e: Entry, t: number, rm: boolean): number {
    const s = e.spec.striker;
    if (s.swing === null) return 0;
    const [strength, riseMs, decayMs] = P.expr.effort;
    const slow = rm ? P.expr.slowRm : 1;
    const end = s.strokeEnd ?? (s.contact ?? s.swing + 900);
    return strength * smooth((t - s.swing) / (riseMs * slow)) * (1 - smooth((t - end) / (decayMs * slow)));
  }

  private weight(e: Entry, t: number): number {
    // A delivery's script starts as a hard cut from the scene before it (the bowler's head may have been on the ground a
    // moment ago): the head takes over from the clip over the first START_FADE_MS of the script, whatever the clock.
    if (!e.fade) return e.loop ? 1 : smooth(t / START_FADE_MS);
    if (Number.isNaN(e.fade0)) e.fade0 = t;
    let dt = t - e.fade0;
    if (dt < 0) dt += e.spec.bowler.end;
    const w = smooth(dt / FADE_MS);
    if (w >= 1) e.fade = false;
    return w;
  }

  private frame(track: ActorTrack, t: number): void {
    if (FRAME.id === track.id && FRAME.t === t) return;
    // A hook called outside the stage's pose (a probe): the same numbers, computed.
    const st = evaluateActor(track, t);
    FRAME.id = track.id;
    FRAME.t = t;
    FRAME.heading = st.heading;
    FRAME.mirror = Boolean(track.mirror);
    FRAME.scale = lookScale(track.look);
  }

  /**
   * The seam of an actor's delivery (P3): created at the entry's first frame for the actor when another entry was drawn for him
   * just before (the scene between balls, usually) and remembers the head he was last drawn with; its share `k` falls from 1
   * to 0 over the script's first `SEAM.ms`. Live deliveries only: a result takes over from a live script by plan identity, and a
   * replay or a demonstration is built from the result alone (and must draw the same whatever came before it). Null: none.
   */
  private seamOf(e: Entry, role: Role, t: number): Seam | null {
    let s = e.seam[role];
    if (s === undefined) {
      const d = DRAWN[role];
      const prev = this.lastEntry[role];
      s = null;
      // A first frame later than the end of the seam has nothing left to give back.
      if (this.seamOn && e.kind === 'live' && prev && prev !== e && d.ok && t < SEAM.ms - 50) {
        s = { pending: true, h0y: d.yaw, h0p: d.pitch, h0r: d.roll, oy: 0, op: 0, or: 0, k: 1, t0: t };
      }
      e.seam[role] = s;
    }
    if (s) {
      const x = (t - s.t0) / Math.max(50, SEAM.ms - s.t0);
      s.k = 1 - smooth(x);
    }
    return s;
  }

  /**
   * The life pass for a script's bowler and striker (cached per script): a pose hook, which samples the plan, puts the
   * breath and the sway on the sampled pose before the field and the planted feet, and leaves the channels for the head
   * pass (`FRAME.head`), which the stage runs on the finished bones (players.applyDirectedHead).
   */
  hooksFor(script: BallScript): { life: PoseHook } {
    let h = this.hooks.get(script);
    if (h) return h;
    let entry: Entry | undefined;
    const life: PoseHook = (track, pose, t) => {
      if (!this.enabled) return;
      const id = track.id;
      if (id !== 'bowler' && id !== 'striker') return;
      entry ??= this.entries.get(script);
      if (!entry) return;
      const plan = this.planOf(entry, id, t);
      const seam = this.seamOf(entry, id, t);
      this.lastEntry[id] = entry;
      const head = FRAME.head;
      if (!plan) {
        // No plan yet (a delivery's first frames): nothing to breathe or look with, but the head still continues from the scene before.
        if (seam) {
          this.frame(track, t);
          head.on = true;
          head.ch = null;
          head.rm = this.reducedMotion;
          head.w = 0;
          head.bowler = id === 'bowler';
          head.brake = id === 'striker' || t > (entry.spec.bowler.release ?? Number.POSITIVE_INFINITY) + BRAKE.bowlerAfterMs;
          head.seam = seam;
        }
        return;
      }
      this.frame(track, t);
      const ch = this.read(entry, id, plan, t);
      const w = this.weight(entry, t);
      applyLife(pose, ch, w, FRAME.scale);
      head.on = true;
      head.ch = ch;
      head.rm = plan.reducedMotion;
      head.w = w;
      head.bowler = id === 'bowler';
      // The striker's neck and head brake on arrival; the bowler's only after the release (until then they hold him on the batter)
      head.brake = id === 'striker' || t > (entry.spec.bowler.release ?? Number.POSITIVE_INFINITY) + BRAKE.bowlerAfterMs;
      head.seam = seam;
    };
    h = { life };
    this.hooks.set(script, h);
    return h;
  }

  /** The plans of a script (for the tests and the probes). */
  plansOf(script: BallScript): Record<Role, DirectorPlan | null> | null {
    return this.entries.get(script)?.plans ?? null;
  }

  /** Runs every pending bake of a script to the end (for the tests and the probes). */
  finish(script: BallScript): void {
    const e = this.entries.get(script);
    if (!e) return;
    for (const p of e.pending.slice()) this.complete(e, p);
  }
}

