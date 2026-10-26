/**
 * DEVELOPMENT HARNESS ONLY (served by the Vite dev server at /src/screens/dev/harness.html; not in the build).
 * Drives the renderer for screenshots, performance measurement and art iteration.
 *   ?mode=replay&rmode=full|key_moments|result_only&q=auto|low|standard|high&rm=1&fallback=1&t=12000&hud=1
 *   ?mode=live
 */
import '@fontsource-variable/manrope';
import type { MatchEventLog, ReplayMode, RenderQuality } from '@/contracts';
import { createMatchRenderer, type StageRenderer } from '@/render3d';
import { fixtureDelivery, fixtureMatchLog, FIXTURE_PLAYERS } from './fixtures';

declare global {
  interface Window {
    __h?: {
      ready: boolean;
      renderer: StageRenderer;
      duration: number;
      log: MatchEventLog | null;
      segments: Array<{ kind: string; t0: number; dur: number; ball: number | null; innings: unknown; fate: string | null; release: number; contact: number; decisive: number; sceneStart: number }>;
      renderAt(ms: number): void;
      bowl(): Promise<number>;
      shot(shot: string, contact: string, timing: string, zone: string | null): Promise<void>;
      errors: string[];
    };
  }
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

async function main() {
  const renderer = await createMatchRenderer({ fallback: params.get('fallback') === '1' });
  const quality = (params.get('q') ?? 'auto') as RenderQuality | 'auto';
  await renderer.mount(canvas, { quality, reducedMotion: params.get('rm') === '1', fps: quality === 'low' ? 30 : 60, offline: params.get('offline') ? { width: 1080, height: 1920 } : undefined });
  renderer.on('fallback', (p) => errors.push(`fallback ${JSON.stringify(p)}`));
  const mode = params.get('mode') ?? 'replay';
  let duration = 0;
  let log: MatchEventLog | null = null;
  let handle: ReturnType<StageRenderer['bowl']> | null = null;
  if (mode === 'replay') {
    log = fixtureMatchLog();
    const r = await renderer.loadReplay(log, (params.get('rmode') ?? 'full') as ReplayMode);
    duration = r.durationMs;
    const t = Number(params.get('t') ?? 0);
    renderer.renderAt(t);
    if (params.get('play') === '1') renderer.play(Number(params.get('speed') ?? 1));
  } else if (mode === 'live') {
    await renderer.prepareInnings({ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] });
  }
  const tl = renderer.timeline();
  window.__h = {
    ready: true,
    renderer,
    duration,
    log,
    segments: (tl?.segments ?? []).map((s) => ({ kind: s.kind, t0: s.t0, dur: s.dur, ball: s.ball, innings: s.innings, fate: s.outcome ? (s.outcome.cues.fate.kind === 'wicket' ? `wicket:${(s.outcome.cues.fate as { wicket: string }).wicket}` : s.outcome.cues.fate.kind) : null, release: s.script.times.release, contact: s.script.times.contact, decisive: s.script.times.decisive, sceneStart: s.sceneStart })),
    renderAt: (ms) => renderer.renderAt(ms),
    bowl: () => {
      handle = renderer.bowl(fixtureDelivery(0, (params.get('variant') ?? 'good_length') as 'good_length'));
      return handle.released;
    },
    shot: (shot, contact, timing, zone) => (handle ? handle.showShot({ shot, contact, timing, zone } as never) : Promise.resolve()),
    errors,
  };
  if (params.get('hud') === '1') {
    setInterval(() => {
      const s = renderer.stats();
      hud.textContent = `${renderer.kind} ${s.quality}  ${s.fps.toFixed(1)} fps  ${s.frameMs.toFixed(1)} ms  ${s.drawCalls} draws  t=${Math.round(renderer.currentTime())}`;
    }, 250);
  }
}

main().catch((e) => {
  errors.push(String(e?.stack ?? e));
  hud.textContent = String(e?.stack ?? e);
});

// ---- rig lab: ?mode=lab&clip=bat_drive&gear=batter -----------------------------------------------------------
import type { ClipId } from '@/render3d/core/clips';
import { buildAmbientScript } from '@/render3d/core/choreo';
import { liveCast } from '@/render3d/core/session';
import type { BallScript } from '@/render3d/core/choreo';

declare global {
  interface Window {
    __lab?: { show(clip: string, time: number, view: string, lower?: string): void };
  }
}

if (params.get('mode') === 'lab') {
  const wait = setInterval(() => {
    const h = window.__h;
    if (!h) return;
    clearInterval(wait);
    const r = h.renderer as StageRenderer & { setDebugCamera(p: unknown): void; drawDebug(s: BallScript, t: number): void };
    const base = buildAmbientScript('balanced', liveCast(FIXTURE_PLAYERS[0], FIXTURE_PLAYERS[1]), 'pace', 10_000, 1, 'intro');
    window.__lab = {
      show(clip, time, view, lower) {
        const gear = params.get('gear') ?? 'batter';
        const id = gear === 'batter' ? 'striker' : gear;
        const actor = base.actors.find((a) => a.id === id)!;
        const heading = id === 'striker' ? Math.PI / 2 : 0;
        const one = { ...base, actors: [{ ...actor, start: { x: 0, y: 0, z: 0 }, heading, moves: [{ t0: 0, t1: 100_000, clip: clip as ClipId, lower: lower as ClipId | undefined, clipStart: time, lowerStart: time, rate: 0 }] }] };
        const views: Record<string, [number, number, number]> = { front: [0, 1.1, 4.2], side: [4.2, 1.1, 0], back: [0, 1.1, -4.2], top: [0.01, 6, 0.01], bowler: [-4, 1.3, 0.5], q: [3, 1.6, 3] };
        const v = views[view] ?? views.front;
        // Views are relative to the actor's facing: rotate by heading.
        const c = Math.cos(heading);
        const sn = Math.sin(heading);
        r.setDebugCamera({ pos: { x: v[0] * c + v[2] * sn, y: v[1], z: -v[0] * sn + v[2] * c }, target: { x: 0, y: 0.95, z: 0 }, fov: 38 });
        r.drawDebug(one as BallScript, 0);
      },
    };
  }, 50);
}
