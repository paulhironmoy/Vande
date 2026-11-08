/**
 * TEST BUILDS ONLY (VITE_PRACTICE_TEST_HOOKS=1, the `practice` Playwright project). The route imports this module
 * only behind that flag, so production builds contain none of it. A test configures it before the page loads
 * (window.__VANDE_PRACTICE_TEST__) and drives it through window.__vandePractice:
 *
 *   tier / benchmarkMs   a fixed device assessment, or a short real benchmark
 *   timeScale            simulation and flow time run k times faster (the stage, input normalisation, the waits)
 *   seed                 deterministic over seeds
 *   autoNext             a dead innings ball continues by itself (long journeys; production always waits)
 *   queueSwing(...)      the swing for coming deliveries, on the simulation clock: { startT } exactly, or
 *                        { contactErrorMs } relative to the ideal contact (the physics' own bat travel), or 'leave'
 *   state().lesson       the first-ball lesson while its card is open (status, armed, input, tries, acts, note, loops shown),
 *   state().lessonLog    and what happened on it and when; `lessonTiming: 'every_ball'` (config) says the timing note on every ball
 *
 * Swings go through the same pipeline as a real gesture (normalised swing → physics → record), so a hooked delivery
 * and a touched one differ only in where the swing came from. The rest only observes.
 */
import type {
  AssistLevel,
  BallFlight,
  DeliveryRecord,
  DeliveryResult,
  DeviceAssessment,
  Handedness,
  NormalizedSwing,
  PerfTier,
  PitchCondition,
} from '@/contracts';
import { readRecord } from '@/practice/worker/work';
import { GHOST } from './lesson/ghostMove';
import { setLessonCameraPort } from './lesson/inputType';
import type { BallKind, FlowHooks, LivePhase, PracticeFlow } from './flow/controller';
import type { BallJob, OffThreadStats } from './flow/offThread';
import type { ResolveArgs } from './flow/types';

/** Every phase, checked by the compiler (a phase missing here would make waitFor treat it as a screen name). */
const PHASE_SET: Record<LivePhase, true> = {
  idle: true,
  loading: true,
  intro: true,
  lesson: true,
  camera: true,
  ready: true,
  runup: true,
  live: true,
  playing: true,
  dead: true,
  demo: true,
  closeup: true,
  replay: true,
  paused: true,
};
const PHASES = Object.keys(PHASE_SET) as LivePhase[];

export interface TestConfig {
  tier?: PerfTier;
  timeScale?: number;
  seed?: string;
  benchmarkMs?: number;
  autoNext?: boolean;
  /** The chase seed of the Chase the page opens (a pool seed, "c000" to "c255"), instead of one drawn at random. */
  chaseSeed?: string;
  /** 'off': no work thread (everything on the main thread, as the fallback does), for A/B runs. */
  work?: 'on' | 'off';
  /** 'every_ball': the first-ball lesson's plain-words timing note is shown on every dead ball (many trials), not the first over only. */
  lessonTiming?: 'every_ball';
}

/** One parity case: what differed between the work thread and the main thread (nothing, when they agree). */
export interface ParityReport {
  deliveries: number;
  /** Deliveries the worker itself answered (the rest fell back, so they compare the fallback). */
  viaWorker: number;
  jsonMismatches: number;
  deepMismatches: number;
  /** SHA-256 of every main-thread result's JSON in order, and of every worker result's. */
  mainSha256: string;
  workerSha256: string;
  reads: number;
  readsViaWorker: number;
  readMismatches: number;
  readMainSha256: string;
  readWorkerSha256: string;
  firstMismatch: string | null;
  workerMs: { p50: number; p90: number; max: number };
  mainMs: { p50: number; p90: number; max: number };
}

export type QueuedSwing =
  | 'leave'
  | (Partial<Omit<NormalizedSwing, 'startT'>> & { startT: number })
  | (Partial<Omit<NormalizedSwing, 'startT'>> & { contactErrorMs: number });

declare global {
  interface Window {
    __VANDE_PRACTICE_TEST__?: TestConfig;
    __vandePractice?: PracticeTestApi;
  }
}

/**
 * One line of the Target Chase's event log (DoD CHU-03): written whenever the screen, the phase, the balls the innings
 * holds (a ball is committed when it is bowled) or the balls the shown chase counts (they follow the stage) change.
 * Order is the point: `shown` never leads `committed`, and it changes only at the dead ball.
 */
export interface ChaseLogEntry {
  /** performance.now() when the flow changed. */
  t: number;
  screen: string;
  phase: string;
  seed: string;
  target: number;
  committed: number;
  committedRuns: number;
  shown: number;
  shownRuns: number;
  runsNeeded: number;
  ballsLeft: number;
  requiredRateX100: number | null;
  result: string;
}

export interface PracticeTestApi {
  /** Opens a Target Chase now: the pool seed ("c000" to "c255") or a fresh one; `direct` goes straight to ball 1. */
  startChase(seed?: string, opts?: { direct?: boolean }): void;
  /** The Target Chase's event log since the page loaded (see ChaseLogEntry). */
  chaseLog(): ChaseLogEntry[];
  queueSwing(...swings: QueuedSwing[]): number;
  /**
   * A stand-in camera for the first-ball lesson, with no camera and no pose: `{ active, tracking }` registers it (call it
   * again to change `tracking`, which shows or clears the lesson's "arms not in view" note); null removes it.
   */
  lessonCamera(port: { active: boolean; tracking: boolean } | null): void;
  clearSwings(): void;
  pending(): number;
  /** The last bowled flight's timing (simulation seconds). */
  lastFlight(): { idealContactT: number; stumpsT: number; speedKph: number } | null;
  state(): unknown;
  /** Deliveries resolved since the page loaded, by kind. */
  delivered(): Record<BallKind, number>;
  /** The stage's own stats (fps, latency, renderer…), or null without a stage. */
  stats(): unknown;
  /** This session's per-delivery frame rates (the session monitor). */
  sessionFps(): number[];
  /** The batter's-eye regions the interface must never cover (CSS px relative to the canvas). */
  protectedRegions(): unknown[];
  /**
   * From now on the stage's ball path is this one (its other regions stay its own; null restores it): a ball's path as
   * measured on another build, so the dead ball's card can be tested against it (EVAL-WORLD K3, the band).
   */
  ballPathRegions(
    regions: Array<{ kind: 'ball_path'; x: number; y: number; width: number; height: number }> | null,
  ): void;
  /**
   * Resolves when the controller reaches one of the phases or screens (true), or after `timeoutMs` (false). Driven by
   * the controller's own state, so a busy main thread (a software-rendered stage) cannot make a test miss it.
   */
  waitFor(states: string[], timeoutMs?: number): Promise<boolean>;
  /** The work thread's own record (mode, every ball's path and timings), or null without one. */
  work(): OffThreadStats | null;
  /**
   * Same input, same result, in this browser: `deliveries` balls (the reference over under a grid of swings, then
   * random overs) resolved on the main thread and on the work thread, and `reads` readings, compared byte for byte and
   * value for value (Object.is, so -0 counts). Between balls only: it uses the flow's own engine, coach and worker.
   */
  parity(opts?: { deliveries?: number; reads?: number }): Promise<ParityReport>;
}

/** Object.is all the way down: same keys in the same order, same values (-0 and NaN included). */
function sameValue(a: unknown, b: unknown, path: string): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return path;
  if (Array.isArray(a) !== Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b))
    return `${path}:type`;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return `${path}:keys`;
  for (const k of ka) {
    const d = sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

async function sha256(parts: string[]): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n')));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
}

const quantiles = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  const q = (p: number) => (s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : 0);
  return { p50: q(0.5), p90: q(0.9), max: s.length ? +s[s.length - 1].toFixed(2) : 0 };
};

function assessmentFor(tier: PerfTier): DeviceAssessment {
  const base = {
    webgl2: true,
    hardware: tier !== 'below',
    renderer: 'test hook',
    shaderCompileMs: 0,
    spikes: 0,
    contextLosses: 0,
    inputToFrameMs: 20,
    memoryGb: 8,
    reasons: ['ok'],
  };
  if (tier === 'full') return { ...base, avgFps: 60, p95FrameMs: 16.7, tier, profile: 'standard', toleranceMs: 0 };
  if (tier === 'assisted')
    return { ...base, avgFps: 50, p95FrameMs: 22, tier, profile: 'lite', reasons: ['fps_assisted'], toleranceMs: 12 };
  return {
    ...base,
    avgFps: 30,
    p95FrameMs: 40,
    tier,
    profile: 'lite',
    reasons: ['software_renderer'],
    toleranceMs: 20,
  };
}

export function createTestHooks(
  batTravelMs: (kind: 'defend' | 'attack', power: number) => number,
  getFlow: () => PracticeFlow | null,
): FlowHooks {
  const config: TestConfig = (typeof window !== 'undefined' && window.__VANDE_PRACTICE_TEST__) || {};
  const queue: QueuedSwing[] = [];
  let last: BallFlight | null = null;
  let seedN = 0;
  const delivered: Record<BallKind, number> = { innings: 0, repeat: 0 };
  /** Balls released while the stage was not ready (must stay 0). */
  let unready = 0;
  const hooks: FlowHooks = {
    assessment: config.tier ? assessmentFor(config.tier) : null,
    timeScale: config.timeScale && config.timeScale > 0 ? config.timeScale : 1,
    benchmarkMs: config.benchmarkMs,
    autoNext: config.autoNext === true,
    work: config.work === 'off' ? 'off' : 'on',
    seed: () => (config.seed ? `${config.seed}-${seedN++}` : null),
    chaseSeed: () => config.chaseSeed ?? null,
    takeSwing(flight, kind) {
      last = flight;
      delivered[kind]++;
      if (getFlow()?.getState().stageReady !== true) unready++;
      if (config.lessonTiming === 'every_ball') {
        const f = getFlow();
        if (f) f.settings = { ...f.settings, hintsShown: 0 };
      }
      const q = queue.shift();
      if (!q) return null;
      if (q === 'leave') return 'leave';
      const kindOf = q.kind ?? 'attack';
      const power = q.power ?? (kindOf === 'defend' ? 0.2 : 0.7);
      const startT =
        'startT' in q ? q.startT : flight.idealContactT - batTravelMs(kindOf, power) / 1000 + q.contactErrorMs / 1000;
      return {
        kind: kindOf,
        startT,
        directionDeg: q.directionDeg ?? 0,
        power,
        elevation: q.elevation ?? 0,
        footwork: q.footwork ?? 'auto',
      };
    },
  };
  // The chase's event log: attached to whichever flow is current, written on every change that matters to its order.
  const chaseLog: ChaseLogEntry[] = [];
  let attached: PracticeFlow | null = null;
  let lastKey = '';
  const record = (f: PracticeFlow) => {
    const st = f.getState();
    const c = st.chase;
    if (!c) {
      lastKey = '';
      return;
    }
    const committed = st.innings?.balls ?? 0;
    const key = `${st.screen}|${st.phase}|${committed}|${c.state.ballsFaced}|${c.state.result}`;
    if (key === lastKey) return;
    lastKey = key;
    chaseLog.push({
      t: performance.now(),
      screen: st.screen,
      phase: st.phase,
      seed: c.state.definition.seed,
      target: c.state.definition.target,
      committed,
      committedRuns: st.innings?.runs ?? 0,
      shown: c.state.ballsFaced,
      shownRuns: c.state.runs,
      runsNeeded: c.state.runsNeeded,
      ballsLeft: c.state.ballsLeft,
      requiredRateX100: c.state.requiredRateX100,
      result: c.state.result,
    });
  };
  if (typeof window !== 'undefined') {
    window.setInterval(() => {
      const f = getFlow();
      if (!f || f === attached) return;
      attached = f;
      lastKey = '';
      f.subscribe(() => record(f));
      record(f);
    }, 20);
  }
  if (typeof window !== 'undefined') {
    window.__vandePractice = {
      startChase: (seed, opts) =>
        getFlow()?.chase.start({ ...(seed ? { seed } : {}), ...(opts?.direct ? { direct: true } : {}) }),
      chaseLog: () => chaseLog.map((e) => ({ ...e })),
      queueSwing: (...s) => queue.push(...s),
      lessonCamera: (p) =>
        setLessonCameraPort(
          p ? { active: () => p.active, tracking: () => p.tracking, subscribe: () => () => undefined } : null,
        ),
      clearSwings: () => void queue.splice(0),
      pending: () => queue.length,
      lastFlight: () =>
        last ? { idealContactT: last.idealContactT, stumpsT: last.stumpsT, speedKph: last.release.speedKph } : null,
      stats: () => getFlow()?.stageStats() ?? null,
      sessionFps: () => getFlow()?.sessionFps() ?? [],
      protectedRegions: () => getFlow()?.protectedRegions() ?? [],
      ballPathRegions: (regions) => {
        const f = getFlow();
        if (!f) return;
        const own = (Object.getPrototypeOf(f) as PracticeFlow).protectedRegions;
        if (regions === null) Reflect.deleteProperty(f, 'protectedRegions');
        else
          Object.defineProperty(f, 'protectedRegions', {
            configurable: true,
            value: () => [...own.call(f).filter((r) => r.kind !== 'ball_path'), ...regions],
          });
      },
      state: () => {
        const f = getFlow();
        if (!f) return null;
        const st = f.getState();
        const plan =
          st.innings?.current?.plan ?? st.innings?.overs[st.innings.overs.length - 1]?.plan ?? st.pending?.plan ?? null;
        return {
          screen: st.screen,
          phase: st.phase,
          status: st.innings?.status ?? null,
          runs: st.innings?.runs ?? 0,
          balls: st.innings?.balls ?? 0,
          overs: st.innings?.overs.length ?? 0,
          inFlight: st.innings?.inFlight ?? null,
          stage: st.quality.stage,
          tier: st.quality.tier,
          profile: st.quality.profile,
          stageReady: st.stageReady,
          last: st.last
            ? {
                kind: st.last.kind,
                runs: st.last.result.outcome.runs,
                dismissal: st.last.result.outcome.dismissal,
                contact: st.last.result.contact.kind,
                swing: st.last.result.swing?.kind ?? null,
              }
            : null,
          insight: st.insight?.status ?? null,
          coach: st.coach
            ? {
                stage: st.coach.mastery.stage,
                attempts: st.coach.attempts.length,
                mastered: st.coach.mastery.mastered,
                verdict: st.coach.comparison?.verdict ?? null,
              }
            : null,
          notice: st.notice,
          ttfdMs: f.firstDeliveryMs(),
          overKind: st.overKind,
          // The first-ball lesson while its card is open (null otherwise): where it stands, the input it teaches, and how
          // many loops of the ghost have been shown (a loop is GHOST.show.periodMs; none under Reduced Motion).
          lesson: st.lesson
            ? {
                status: st.lesson.status,
                armed: st.phase === 'lesson',
                input: st.lesson.input,
                tries: st.lesson.tries,
                acts: st.lesson.acts,
                note: st.lesson.note,
                read: st.lesson.read,
                shownAtPerfMs: st.lesson.shownAtPerfMs,
                cueLoopMs: GHOST.show.periodMs,
                cueShows: f.deps.reducedMotion?.()
                  ? 0
                  : Math.floor((performance.now() - st.lesson.shownAtPerfMs) / GHOST.show.periodMs) + 1,
              }
            : null,
          lessonLog: f.lessonEvents.slice(-40),
          // The Target Chase, as shown (null outside one): its seed and target, and where it stands.
          chase: st.chase
            ? {
                seed: st.chase.state.definition.seed,
                difficulty: st.chase.state.definition.difficulty,
                target: st.chase.state.definition.target,
                result: st.chase.state.result,
                runs: st.chase.state.runs,
                ballsFaced: st.chase.state.ballsFaced,
                ballsLeft: st.chase.state.ballsLeft,
                runsNeeded: st.chase.state.runsNeeded,
                requiredRate: st.chase.state.requiredRate,
                deciding: st.chase.state.decidingBall?.key ?? null,
                previous: st.chase.previous ? { result: st.chase.previous.result, runs: st.chase.previous.runs } : null,
              }
            : null,
          over: plan
            ? {
                source: plan.source,
                family: plan.bowler.family,
                shuffled: Boolean(plan.shuffled),
                variations: plan.balls.map((b) => b.variation),
                lengths: plan.balls.map((b) => b.lengthM),
              }
            : null,
          // The timing help each innings ball was played with, by over (the over in progress last).
          tolerances: st.innings
            ? [
                ...st.innings.overs.map((o) => o.deliveries),
                ...(st.innings.current ? [st.innings.current.deliveries] : []),
              ].map((d) => d.map((r) => r.tierToleranceMs))
            : [],
          unreadyBowls: unready,
          error: st.error,
        };
      },
      delivered: () => ({ ...delivered }),
      work: () => getFlow()?.work?.stats() ?? null,
      parity: async (opts = {}) => {
        const f = getFlow();
        if (!f?.work || !f.coach) throw new Error('parity: no work thread or coach');
        const engine = f.engine;
        const coach = f.coach;
        const work = f.work;
        const want = opts.deliveries ?? 520;
        const swingOf = (
          flight: BallFlight,
          kind: 'attack' | 'defend',
          power: number,
          directionDeg: number,
          elevation: number,
          footwork: NormalizedSwing['footwork'],
          errMs: number,
        ): NormalizedSwing => ({
          kind,
          startT: flight.idealContactT - batTravelMs(kind, power) / 1000 + errMs / 1000,
          directionDeg,
          power,
          elevation,
          footwork,
        });
        type Case = { args: ResolveArgs; record: DeliveryRecord };
        const cases: Case[] = [];
        const readIdx: number[] = [];
        const add = (
          plan: ReturnType<PracticeFlow['engine']['referenceOver']>,
          i: number,
          conditions: PitchCondition,
          assist: AssistLevel,
          handedness: Handedness,
          swing: (fl: BallFlight) => NormalizedSwing | null,
        ) => {
          const seed = engine.ballSeed(plan, i);
          const field = engine.autoField(plan.bowler, conditions, handedness, plan.ball);
          const flight = engine.flight({
            plan: plan.balls[i],
            bowler: plan.bowler,
            conditions,
            seed,
            handedness,
            ball: plan.ball,
          });
          const sw = swing(flight);
          const args: ResolveArgs = {
            flight,
            swing: sw,
            field,
            bowler: plan.bowler,
            conditions,
            handedness,
            assist,
            tierToleranceMs: 0,
          };
          const record: DeliveryRecord = {
            version: plan.version,
            overIndex: 0,
            ballIndex: i,
            bowler: plan.bowler,
            plan: plan.balls[i],
            seed,
            conditions,
            ball: plan.ball,
            field,
            handedness,
            assist,
            tierToleranceMs: 0,
            swing: sw,
            runs: 0,
            dismissal: null,
          };
          cases.push({ args, record });
        };
        const ref = engine.referenceOver();
        // The reference over under a grid: leaves, defences (three footworks), and drives over aim, power, loft and timing.
        for (let i = 0; i < ref.balls.length; i++) {
          readIdx.push(cases.length);
          add(ref, i, 'balanced', 'real', 'right', () => null);
          for (const fw of ['auto', 'forward', 'back'] as const)
            for (const e of [-40, 0, 40])
              add(ref, i, 'balanced', 'real', 'right', (fl) => swingOf(fl, 'defend', 0.2, 0, 0, fw, e));
          for (const dir of [-50, 0, 30, 55, 80])
            for (const e of [-60, -20, 0, 20, 60])
              for (const [pw, el] of [
                [0.7, 0],
                [1, 0.8],
              ] as const) {
                // The cover drive on time is read too.
                if (dir === 55 && e === 0 && el === 0) readIdx.push(cases.length);
                add(ref, i, 'balanced', 'real', 'right', (fl) => swingOf(fl, 'attack', pw, dir, el, 'forward', e));
              }
        }
        // Random overs (every pitch and assistance, both hands) until there are enough.
        const pitches: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
        const assists: AssistLevel[] = ['real', 'play', 'learn'];
        for (let o = 0; cases.length < want; o++) {
          const conditions = pitches[o % pitches.length];
          const assist = assists[o % assists.length];
          const handedness: Handedness = o % 2 ? 'left' : 'right';
          const plan = engine.randomOver({
            seed: `parity-${o}`,
            conditions,
            assist,
            difficulty: 'club',
            family: o % 3 === 2 ? 'spin' : 'pace',
          });
          for (let i = 0; i < plan.balls.length && cases.length < want; i++)
            add(plan, i, conditions, assist, handedness, (fl) =>
              i % 5 === 4
                ? null
                : swingOf(
                    fl,
                    i % 2 ? 'defend' : 'attack',
                    i % 2 ? 0.2 : 0.75,
                    ((i * 37 + o * 11) % 120) - 40,
                    0,
                    'auto',
                    ((i * 13 + o * 7) % 9) * 15 - 60,
                  ),
            );
        }
        const mainJson: string[] = [];
        const workerJson: string[] = [];
        const mainMs: number[] = [];
        const workerMs: number[] = [];
        let viaWorker = 0;
        let jsonMismatches = 0;
        let deepMismatches = 0;
        let firstMismatch: string | null = null;
        const results: DeliveryResult[] = [];
        for (const [n, c] of cases.entries()) {
          const t0 = performance.now();
          const local = engine.resolveDelivery(c.args);
          mainMs.push(performance.now() - t0);
          const { swing: _s, ...rest } = c.args;
          const job: BallJob = { kind: 'resolve', args: rest };
          const ticket = work.prepare(job, (sw) => engine.resolveDelivery({ ...c.args, swing: sw }));
          for (let k = 0; k < 400 && !ticket.ready(); k++) await new Promise((r) => setTimeout(r, 5));
          const remote = await ticket.resolve(c.args.swing);
          const stat = work.stats().balls.at(-1);
          if (stat?.path === 'worker') {
            viaWorker++;
            if (stat.computeMs !== null) workerMs.push(stat.computeMs);
          }
          const a = JSON.stringify(local);
          const b = JSON.stringify(remote);
          mainJson.push(a);
          workerJson.push(b);
          if (a !== b) jsonMismatches++;
          const d = sameValue(local, remote, `case${n}`);
          if (d) {
            deepMismatches++;
            firstMismatch ??= d;
          }
          results.push(remote);
        }
        // Readings: the reference over's balls (a leave, a drive), worker against the main thread's own reading.
        const readMain: string[] = [];
        const readWorker: string[] = [];
        let readsViaWorker = 0;
        let readMismatches = 0;
        const readCases = readIdx.slice(0, opts.reads ?? 12).map((i) => ({ c: cases[i], r: results[i] }));
        for (const { c, r } of readCases) {
          const record = { ...c.record, runs: r.outcome.runs, dismissal: r.outcome.dismissal } as DeliveryRecord;
          const wantRead = { tip: true, sample: { source: 'innings' as const }, guide: true };
          const local = await readRecord({ ...coach, repeatDelivery: engine.repeatDelivery }, record, r, wantRead, {
            sliceMs: 1000,
          });
          let remote: unknown;
          try {
            remote = await work.read(record, r, wantRead);
            readsViaWorker++;
          } catch (e) {
            remote = { error: String(e) };
          }
          const a = JSON.stringify(local);
          const b = JSON.stringify(remote);
          readMain.push(a);
          readWorker.push(b);
          if (a !== b || sameValue(local, remote, 'read')) {
            readMismatches++;
            firstMismatch ??= sameValue(local, remote, 'read') ?? 'read:json';
          }
        }
        return {
          deliveries: cases.length,
          viaWorker,
          jsonMismatches,
          deepMismatches,
          mainSha256: await sha256(mainJson),
          workerSha256: await sha256(workerJson),
          reads: readCases.length,
          readsViaWorker,
          readMismatches,
          readMainSha256: await sha256(readMain),
          readWorkerSha256: await sha256(readWorker),
          firstMismatch,
          workerMs: quantiles(workerMs),
          mainMs: quantiles(mainMs),
        };
      },
      waitFor: (states, timeoutMs = 60_000) =>
        new Promise<boolean>((resolve) => {
          const hit = () => {
            const st = getFlow()?.getState();
            if (!st) return false;
            // A bare name is a phase when it is one ('live' is also a screen name: the phase is meant); otherwise a
            // screen; plus the hold before a delivery.
            return states.some((x) =>
              x === 'turn'
                ? st.needLandscape
                : (PHASES as readonly string[]).includes(x)
                  ? st.phase === x
                  : st.screen === x,
            );
          };
          if (hit()) {
            resolve(true);
            return;
          }
          let off: (() => void) | null = null;
          let sub: number | null = null;
          const done = (v: boolean) => {
            off?.();
            if (sub !== null) window.clearInterval(sub);
            window.clearTimeout(timer);
            resolve(v);
          };
          const timer = window.setTimeout(() => done(false), timeoutMs);
          // The controller may not exist yet (the route is still loading): subscribe as soon as it does.
          const attach = () => {
            const f = getFlow();
            if (!f) return false;
            off = f.subscribe(() => hit() && done(true));
            if (hit()) done(true);
            return true;
          };
          if (!attach())
            sub = window.setInterval(() => attach() && sub !== null && (window.clearInterval(sub), (sub = null)), 20);
        }),
    };
  }
  return hooks;
}
