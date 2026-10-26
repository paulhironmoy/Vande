import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Conditions, FieldSetting, MatchEventLog, PlayerRef, RenderQuality, ReplayMode } from '@/contracts';
import { useApp } from '@/app/store';
import { useT } from '@/i18n';
import { createMatchRenderer, type FallbackReason, type StageRenderer } from '@/render3d';
import { MatchAudio } from '@/audio';
import { loadCachedAssessment, probeGpu } from '@/perf';
import { StateView } from '@/ui';
import s from './MatchStage.module.css';

export interface LiveSetupProps {
  conditions: Conditions;
  field: FieldSetting;
  batter: PlayerRef;
  bowler: PlayerRef;
}

export interface MatchStageProps {
  /** Replay a revealed match… */
  replay?: { log: MatchEventLog; mode: ReplayMode; autoplay?: boolean };
  /** …or bat live. */
  live?: LiveSetupProps;
  onReady?: (r: StageRenderer) => void;
  /** Throttled (~12 Hz) timeline time, for scrubbers and overlays. */
  onTime?: (ms: number) => void;
  onBall?: (payload: unknown) => void;
  onEnd?: () => void;
  /** The stage switched to the lightweight 2D view (log `renderer_fallback` here). */
  onFallback?: (reason: FallbackReason) => void;
  /** Force the 2D presentation (tests, user preference). */
  forceFallback?: boolean;
  overlay?: ReactNode;
  className?: string;
}

/**
 * The match stage: lazy-loads the 3D renderer (or the 2D view when WebGL is missing, fails, or is drawn in software
 * with quality on 'auto'), keeps it in sync
 * with the player's settings, plays synthesised audio, and recovers from a lost WebGL context by switching to
 * the 2D view at the same replay time.
 */
/**
 * Whether this device draws WebGL in software (no usable graphics chip: a blocklisted phone GPU, an emulator, a CI
 * runner). The 3D stage then runs at a few frames a second, which makes live batting unfair, so 'auto' quality uses
 * the 2D view there, as Practice plays Classic. The device check's cached answer (src/perf) wins when there is one.
 */
function softwareGraphics(): boolean {
  const assessed = loadCachedAssessment(__APP_VERSION__);
  return assessed ? !assessed.hardware : !probeGpu().hardware;
}

export function MatchStage({ replay, live, onReady, onTime, onBall, onEnd, onFallback, forceFallback, overlay, className }: MatchStageProps) {
  const { t } = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StageRenderer | null>(null);
  const resumeAt = useRef(0);
  const quality = useApp((st) => st.settings.quality);
  // A quality the player chose always gets the 3D stage; 'auto' on software graphics gets the 2D view.
  const [fallback, setFallback] = useState(() => Boolean(forceFallback) || (quality === 'auto' && softwareGraphics()));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const reducedMotion = useApp((st) => st.reducedMotion);
  const cb = useRef({ onReady, onTime, onBall, onEnd, onFallback });
  cb.current = { onReady, onTime, onBall, onEnd, onFallback };
  const replayKey = replay ? `${replay.log.matchId}:${replay.mode}` : '';
  const liveKey = live ? `${live.batter.id}:${live.bowler.id}:${live.field}:${live.conditions.pitch}` : '';

  useEffect(() => {
    let disposed = false;
    let renderer: StageRenderer | null = null;
    // Live batting plays the bat's own sound and haptic at the tap (see BattingScreen), not at the animated contact.
    const audio = new MatchAudio({ liveContact: Boolean(live) });
    const offs: Array<() => void> = [];
    setStatus('loading');
    (async () => {
      try {
        renderer = await createMatchRenderer({ fallback });
        if (disposed || !canvasRef.current) {
          renderer.dispose();
          return;
        }
        const q: RenderQuality | 'auto' = quality;
        await renderer.mount(canvasRef.current, { quality: q, reducedMotion, fps: q === 'low' ? 30 : 60 });
        renderer.setSink(audio);
        offs.push(
          renderer.on('fallback', (p) => {
            if (fallback) return;
            const reason = ((p as { reason?: FallbackReason })?.reason ?? 'error') as FallbackReason;
            resumeAt.current = renderer?.currentTime() ?? 0;
            cb.current.onFallback?.(reason);
            setFallback(true);
          }),
        );
        offs.push(renderer.on('ball', (p) => cb.current.onBall?.(p)));
        offs.push(renderer.on('end', () => cb.current.onEnd?.()));
        let last = 0;
        offs.push(
          renderer.onFrame((ms) => {
            const now = performance.now();
            if (now - last > 80) {
              last = now;
              cb.current.onTime?.(ms);
            }
          }),
        );
        if (replay) {
          await renderer.loadReplay(replay.log, replay.mode);
          if (resumeAt.current > 0) renderer.seek(resumeAt.current);
          if (replay.autoplay) renderer.play(1);
        } else if (live) {
          await renderer.prepareInnings(live);
        }
        if (disposed) return;
        rendererRef.current = renderer;
        setStatus('ready');
        cb.current.onReady?.(renderer);
      } catch {
        if (disposed) return;
        if (!fallback) {
          cb.current.onFallback?.('no_webgl');
          setFallback(true);
        } else setStatus('error');
      }
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
      audio.dispose();
      rendererRef.current = null;
      renderer?.dispose();
    };
    // Recreate only when the content or the presentation kind changes; settings are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey, liveKey, fallback]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r && quality !== 'auto') r.setQuality(quality);
  }, [quality]);
  useEffect(() => {
    rendererRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  return (
    <div className={[s.stage, className ?? ''].join(' ')} data-kind={fallback ? '2d' : '3d'}>
      <canvas key={fallback ? '2d' : '3d'} ref={canvasRef} className={s.canvas} role="img" aria-label={t('stage.label')} />
      {status === 'loading' && (
        <div className={s.loading}>
          <StateView kind="loading" title={t('stage.loading')} body={t('state.loading.body')} compact />
        </div>
      )}
      {status === 'error' && (
        <div className={s.loading}>
          <StateView kind="error" compact />
        </div>
      )}
      {fallback && status === 'ready' && <span className={s.badge}>{t('stage.fallback')}</span>}
      {overlay && <div className={s.overlay}>{overlay}</div>}
    </div>
  );
}
