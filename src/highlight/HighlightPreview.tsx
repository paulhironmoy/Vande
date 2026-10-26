import { useCallback, useEffect, useRef, useState } from 'react';
import type { HighlightRenderInput } from '@/contracts';
import { useT } from '@/i18n';
import { IconButton, StateView } from '@/ui';
import { createHighlightHost, type HighlightHost } from './host';
import s from './HighlightPreview.module.css';

export interface HighlightPreviewProps {
  /** The same input the official render uses, so participants approve exactly what will be published. */
  input: HighlightRenderInput;
  /** Start playing once loaded (default true). */
  autoplay?: boolean;
  className?: string;
}

/**
 * Plays the highlight Short at phone size from the same composer as the official render (half resolution, same
 * cut, same overlays). Used by the social workstream's consent screen.
 */
export function HighlightPreview({ input, autoplay = true, className }: HighlightPreviewProps) {
  const { t } = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HighlightHost | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clock = useRef<{ start: number; from: number } | null>(null);
  const raf = useRef(0);
  const drawing = useRef(false);

  const draw = useCallback(async (ms: number) => {
    const h = host.current;
    if (!h || drawing.current) return;
    drawing.current = true;
    try {
      await h.frame(ms);
    } finally {
      drawing.current = false;
    }
  }, []);

  useEffect(() => {
    if (!canvas.current) return;
    let alive = true;
    const h = createHighlightHost({ canvas: canvas.current, scale: 0.5 });
    host.current = h;
    setState('loading');
    h.load(input).then(
      async (r) => {
        if (!alive) return;
        setDuration(r.durationMs);
        await h.frame(0);
        setState('ready');
        if (autoplay) {
          clock.current = { start: performance.now(), from: 0 };
          setPlaying(true);
        }
      },
      () => alive && setState('error'),
    );
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
      h.dispose();
      host.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const c = clock.current;
      if (!c) return;
      const ms = c.from + (performance.now() - c.start);
      if (ms >= duration) {
        setTime(duration);
        setPlaying(false);
        void draw(duration - 1);
        return;
      }
      setTime(ms);
      void draw(ms);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration, draw]);

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const from = time >= duration ? 0 : time;
    clock.current = { start: performance.now(), from };
    setPlaying(true);
  };
  const seek = (ms: number) => {
    setTime(ms);
    clock.current = { start: performance.now(), from: ms };
    void draw(ms);
  };
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  return (
    <figure className={[s.preview, className ?? ''].join(' ')} data-testid="highlight-preview">
      <div className={s.frame}>
        <canvas ref={canvas} className={s.canvas} aria-label={t('highlight.preview_label')} role="img" />
        {state === 'loading' && (
          <div className={s.overlay}>
            <StateView kind="loading" compact title={t('highlight.preview_loading')} />
          </div>
        )}
        {state === 'error' && (
          <div className={s.overlay}>
            <StateView kind="error" compact title={t('highlight.preview_error')} />
          </div>
        )}
      </div>
      {state === 'ready' && (
        <figcaption className={s.controls}>
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? t('common.pause') : t('common.play')} variant="primary" onClick={toggle} data-testid="highlight-play" />
          <input
            className={s.range}
            type="range"
            min={0}
            max={duration}
            step={1000 / 30}
            value={Math.min(time, duration)}
            onChange={(e) => {
              setPlaying(false);
              seek(Number(e.target.value));
            }}
            aria-label={t('a11y.timeline_seek')}
            aria-valuetext={t('a11y.replay_position', { current: mmss(time), total: mmss(duration) })}
          />
          <span className={s.time}>
            {mmss(time)} / {mmss(duration)}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
