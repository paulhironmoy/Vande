/**
 * TEST BUILDS ONLY (VITE_PRACTICE_TEST_HOOKS=1, the `practice` Playwright project). The route imports this module
 * only behind that flag, so production builds contain none of it. A test configures it before the page loads
 * (window.__VANDE_PRACTICE_TEST__) and drives it through window.__vandePractice:
 *
 *   tier / benchmarkMs   a fixed device assessment, or a short real benchmark
 *   timeScale            simulation and flow time run k times faster (the stage, input normalisation, the waits)
 *   seed                 deterministic over seeds
 *   queueSwing(...)      the swing for coming deliveries, on the simulation clock: { startT } exactly, or
 *                        { contactErrorMs } relative to the ideal contact (the physics' own bat travel), or 'leave'
 *
 * Swings go through the same pipeline as a real gesture (normalised swing → physics → record), so a hooked delivery
 * and a touched one differ only in where the swing came from.
 */
import type { BallFlight, DeviceAssessment, NormalizedSwing, PerfTier } from '@/contracts';
import type { BallKind, FlowHooks, LivePhase, PracticeFlow } from './flow/controller';

const PHASES: readonly LivePhase[] = ['idle', 'radar', 'runup', 'live', 'playing', 'coaching', 'warmup_explain', 'replay', 'paused'];

export interface TestConfig {
  tier?: PerfTier;
  timeScale?: number;
  seed?: string;
  benchmarkMs?: number;
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

export interface PracticeTestApi {
  queueSwing(...swings: QueuedSwing[]): number;
  clearSwings(): void;
  pending(): number;
  /** The last bowled flight's timing (simulation seconds). */
  lastFlight(): { idealContactT: number; stumpsT: number; speedKph: number } | null;
  state(): unknown;
  /** Deliveries resolved since the page loaded, by kind. */
  delivered(): Record<BallKind, number>;
  /**
   * Resolves when the controller reaches one of the phases or screens (true), or after `timeoutMs` (false). Driven by
   * the controller's own state, so a busy main thread (a software-rendered stage) cannot make a test miss it.
   */
  waitFor(states: string[], timeoutMs?: number): Promise<boolean>;
}

function assessmentFor(tier: PerfTier): DeviceAssessment {
  const base = { webgl2: true, hardware: tier !== 'below', renderer: 'test hook', shaderCompileMs: 0, spikes: 0, contextLosses: 0, inputToFrameMs: 20, memoryGb: 8, reasons: ['ok'] };
  if (tier === 'full') return { ...base, avgFps: 60, p95FrameMs: 16.7, tier, profile: 'standard', toleranceMs: 0 };
  if (tier === 'assisted') return { ...base, avgFps: 50, p95FrameMs: 22, tier, profile: 'lite', reasons: ['fps_assisted'], toleranceMs: 12 };
  return { ...base, avgFps: 30, p95FrameMs: 40, tier, profile: 'lite', reasons: ['software_renderer'], toleranceMs: 20 };
}

export function createTestHooks(batTravelMs: (kind: 'defend' | 'attack', power: number) => number, getFlow: () => PracticeFlow | null): FlowHooks {
  const config: TestConfig = (typeof window !== 'undefined' && window.__VANDE_PRACTICE_TEST__) || {};
  const queue: QueuedSwing[] = [];
  let last: BallFlight | null = null;
  let seedN = 0;
  const delivered: Record<BallKind, number> = { innings: 0, warmup: 0, repeat: 0 };
  const hooks: FlowHooks = {
    assessment: config.tier ? assessmentFor(config.tier) : null,
    timeScale: config.timeScale && config.timeScale > 0 ? config.timeScale : 1,
    benchmarkMs: config.benchmarkMs,
    seed: () => (config.seed ? `${config.seed}-${seedN++}` : null),
    takeSwing(flight, kind) {
      last = flight;
      delivered[kind]++;
      const q = queue.shift();
      if (!q) return null;
      if (q === 'leave') return 'leave';
      const kindOf = q.kind ?? 'attack';
      const power = q.power ?? (kindOf === 'defend' ? 0.2 : 0.7);
      const startT = 'startT' in q ? q.startT : flight.idealContactT - batTravelMs(kindOf, power) / 1000 + q.contactErrorMs / 1000;
      return { kind: kindOf, startT, directionDeg: q.directionDeg ?? 0, power, elevation: q.elevation ?? 0, footwork: q.footwork ?? 'auto' };
    },
  };
  if (typeof window !== 'undefined') {
    window.__vandePractice = {
      queueSwing: (...s) => queue.push(...s),
      clearSwings: () => void queue.splice(0),
      pending: () => queue.length,
      lastFlight: () => (last ? { idealContactT: last.idealContactT, stumpsT: last.stumpsT, speedKph: last.release.speedKph } : null),
      state: () => {
        const f = getFlow();
        if (!f) return null;
        const st = f.getState();
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
          last: st.last ? { kind: st.last.kind, runs: st.last.result.outcome.runs, dismissal: st.last.result.outcome.dismissal, contact: st.last.result.contact.kind, swing: st.last.result.swing?.kind ?? null } : null,
          notice: st.notice,
          ttfdMs: f.firstDeliveryMs(),
          over: (() => {
            const plan = st.innings?.current?.plan ?? st.innings?.overs[st.innings.overs.length - 1]?.plan ?? null;
            return plan ? { source: plan.source, family: plan.bowler.family, shuffled: Boolean(plan.shuffled), variations: plan.balls.map((b) => b.variation), lengths: plan.balls.map((b) => b.lengthM) } : null;
          })(),
        };
      },
      delivered: () => ({ ...delivered }),
      waitFor: (states, timeoutMs = 60_000) =>
        new Promise<boolean>((resolve) => {
          const hit = () => {
            const st = getFlow()?.getState();
            if (!st) return false;
            // A bare name is a phase when it is one ('live' is also a screen name: the phase is meant); otherwise a
            // screen; plus the two holds before a delivery.
            return states.some((x) =>
              x === 'tap_gate' ? st.needTap : x === 'turn' ? st.needLandscape : (PHASES as readonly string[]).includes(x) ? st.phase === x : st.screen === x,
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
          if (!attach()) sub = window.setInterval(() => attach() && sub !== null && (window.clearInterval(sub), (sub = null)), 20);
        }),
    };
  }
  return hooks;
}
