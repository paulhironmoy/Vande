/**
 * DEVELOPMENT HARNESS ONLY (served by the Vite dev server at /src/render3d/dev/practice.html; never in the build).
 * Drives the Practice stage for screenshots, measurements and art review:
 *   ?stage=3d|2d&profile=lite|standard|high&hand=right|left&clock=manual|real&family=pace|spin
 * With clock=manual the stage runs on a test clock (window.__p.step(ms) renders the frame at that moment), so
 * screenshots are exact. Deliveries use the real physics flight(); results come from the test fixtures until the
 * physics' resolveDelivery is complete. Nothing here is fake physics in production: this page is not shipped.
 */
import '@fontsource-variable/manrope';
import type { BallFlight, BowlerProfile, DeliveryResult, Handedness, PracticeDeliveryPlan, QualityProfileId } from '@/contracts/practice';
import { flight as physicsFlight } from '@/physics/delivery';
import { autoField } from '@/physics/field';
import { eventTime } from '@/input/pointer';
import { ThreePracticeStage } from '../three/ThreePracticeStage';
import { Fallback2DPracticeStage } from '../fallback2d/Fallback2DPracticeStage';
import { defaultStageClock, type StageClock } from '../practice/session';
import type { PracticeStage } from '../practice/types';
import { fixtureResult, type ResultKind } from '../../../tests/unit/render3d/practiceFixtures';

declare global {
  interface Window {
    __p?: {
      ready: boolean;
      stage: PracticeStage;
      errors: string[];
      now(): number;
      /** Manual clock: advance to `ms` (performance time), firing timers, and render one frame there. */
      step(ms: number): Promise<void>;
      bowl(plan?: Partial<PracticeDeliveryPlan>): Promise<{ releasePerfMs: number; flight: BallFlight }>;
      result(kind: ResultKind, timingMs?: number, bearing?: number): DeliveryResult;
      play(result: DeliveryResult): Promise<void>;
      replay(result: DeliveryResult, camera?: 'batter' | 'side' | 'behind' | 'top', speed?: number): Promise<void>;
      flight: BallFlight | null;
      release: number;
    };
  }
}

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

/** A clock the page controls: time moves only in step(); each step renders one frame at its end. */
function manualClock(start: number) {
  let now = start;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  const frames: Array<(t: number) => void> = [];
  let next = 1;
  const clock: StageClock = {
    now: () => now,
    raf: (cb) => (frames.push(cb), frames.length),
    caf: () => undefined,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const step = async (to: number) => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > to) break;
      timers.shift();
      now = t.at;
      t.fn();
      await Promise.resolve();
    }
    now = to;
    const cbs = frames.splice(0);
    for (const cb of cbs) cb(now);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  };
  return { clock, step, now: () => now };
}

async function main() {
  const manual = q.get('clock') === 'manual';
  const mc = manual ? manualClock(10_000) : null;
  const clock = mc ? mc.clock : defaultStageClock;
  const kind = q.get('stage') === '2d' ? '2d' : '3d';
  const stage: PracticeStage = kind === '2d' ? new Fallback2DPracticeStage(clock) : new ThreePracticeStage(clock);
  stage.on('fallback', (p) => errors.push(`fallback ${JSON.stringify(p)}`));
  const handedness = (q.get('hand') ?? 'right') as Handedness;
  const profile = (q.get('profile') ?? 'standard') as QualityProfileId;
  const family = q.get('family') === 'spin' ? 'spin' : 'pace';
  const bowler: BowlerProfile = family === 'spin' ? { family, spinType: (q.get('spin') ?? 'finger') as 'finger' | 'wrist', arm: (q.get('arm') ?? 'right') as 'right' | 'left', lookSeed: 'harness-spin' } : { family, paceBand: (q.get('pace') ?? 'fast') as 'fast', arm: (q.get('arm') ?? 'right') as 'right' | 'left', lookSeed: 'harness-pace' };
  await stage.mount(canvas, { profile, handedness, reducedMotion: q.get('rm') === '1', learnCue: q.get('learn') === '1' });
  const field = autoField(bowler, 'balanced', handedness);
  stage.setScene({ field, bowler, conditions: (q.get('pitch') ?? 'balanced') as 'balanced', handedness });
  let current: BallFlight | null = null;
  let release = 0;
  const api: NonNullable<Window['__p']> = {
    ready: true,
    stage,
    errors,
    now: () => (mc ? mc.now() : performance.now()),
    step: async (ms) => {
      if (mc) await mc.step(ms);
    },
    async bowl(plan = {}) {
      const p: PracticeDeliveryPlan = { variation: 'stock', lengthM: family === 'spin' ? 4.5 : 6, lineM: 0.12, speedKph: family === 'spin' ? 86 : 136, ...plan };
      current = physicsFlight({ plan: p, bowler, conditions: 'balanced', seed: `harness:${JSON.stringify(p)}`, handedness });
      api.flight = current;
      const done = stage.bowl(current);
      release = stage.releasePerfMs()!;
      api.release = release;
      void done;
      return { releasePerfMs: release, flight: current };
    },
    result(kind, timingMs = 0, bearing = 25) {
      if (!current) throw new Error('bowl first');
      return fixtureResult(current, { kind, timingMs, bearing });
    },
    play: (result) => stage.play(result),
    replay: (result, camera = 'side', speed = 0.3) => stage.replay(result, { camera, speed, diagnostics: true, assist: 'play' }),
    flight: null,
    release: 0,
  };
  window.__p = api;
  // A real press on the canvas starts the swing at the event's own timestamp (input-to-bat latency measurement).
  canvas.addEventListener('pointerdown', (e) => stage.beginSwing(eventTime(e), 0));
  if (!manual) {
    setInterval(() => {
      const s = stage.stats();
      hud.textContent = `${kind} ${s.profile} ${s.fps} fps p95 ${s.p95FrameMs} ms spikes ${s.spikes} calls ${s.drawCalls}\n${s.renderer}`;
    }, 500);
  }
}

main().catch((e) => {
  errors.push(String(e?.stack ?? e));
  hud.textContent = String(e);
});
