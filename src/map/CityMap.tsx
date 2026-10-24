/**
 * CityMap — the primary gameplay surface.
 *
 * Layers (bottom → top): ambient ground (CSS, tinted by city health) → Pixi canvas (or SVG fallback)
 * → grain → accessible HTML overlay (one button per district, labels, badges) → live region + caption strip.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { MapDistrictView, MapState } from '@/engine/types';
import { computeLayout, districtAriaLabel, getPalette, groundColours, labelSides, shortName, type LabelSide } from './layout';
import { describeMapChange } from './describe';
import { StaticMap } from './StaticMap';
import type { CityScene } from './pixi/CityScene';
import styles from './CityMap.module.css';

export interface CityMapProps {
  map: MapState;
  reducedMotion: boolean;
  highContrast: boolean;
  colourBlind: boolean;
  captions: boolean;
  focus?: string;
  onSelectDistrict(id: string | undefined): void;
  className?: string;
}

type Mode = 'static' | 'pixi';

const CAPTION_MS = 3800;

function canTryPixi(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    // Pixi can run on WebGL or (as a last resort) Canvas2D. Without either, use the SVG.
    return Boolean(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('2d'));
  } catch {
    return false;
  }
}

export function CityMap({ map, reducedMotion, highContrast, colourBlind, captions, focus, onSelectDistrict, className }: CityMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const failedRef = useRef(false);
  const latest = useRef({ map, focus });
  latest.current = { map, focus };

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>('static');
  const [caption, setCaption] = useState<{ text: string; key: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const effectiveFocus = focus ?? map.focus;
  const layout = useMemo(() => computeLayout(size.width || 800, size.height || 500), [size.width, size.height]);
  const palette = useMemo(() => getPalette(highContrast, colourBlind), [highContrast, colourBlind]);
  const ground = useMemo(() => groundColours(map.health), [map.health]);

  // --- measure -------------------------------------------------------------
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // --- Pixi lifecycle ------------------------------------------------------
  const ready = size.width > 1 && size.height > 1;
  useEffect(() => {
    if (!ready || sceneRef.current || failedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas || !canTryPixi()) {
      failedRef.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('./pixi/CityScene');
        if (cancelled) return;
        const scene = await mod.createCityScene({
          canvas,
          width: size.width,
          height: size.height,
          reducedMotion,
          highContrast,
          colourBlind,
          onContextLost: () => {
            failedRef.current = true;
            const s = sceneRef.current;
            sceneRef.current = null;
            setMode('static');
            try {
              s?.destroy();
            } catch {
              /* ignore */
            }
          },
        });
        if (cancelled) {
          scene.destroy();
          return;
        }
        sceneRef.current = scene;
        scene.update(latest.current.map, latest.current.focus ?? latest.current.map.focus);
        setMode('pixi');
      } catch {
        failedRef.current = true;
        setMode('static');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(
    () => () => {
      sceneRef.current?.destroy();
      sceneRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (ready) sceneRef.current?.resize(size.width, size.height);
  }, [ready, size.width, size.height]);

  useEffect(() => {
    sceneRef.current?.update(map, effectiveFocus);
  }, [map, effectiveFocus, mode]);

  useEffect(() => {
    sceneRef.current?.setMotion(reducedMotion);
  }, [reducedMotion, mode]);

  useEffect(() => {
    sceneRef.current?.setPalette(highContrast, colourBlind);
  }, [highContrast, colourBlind, mode]);

  // --- captions & live region ---------------------------------------------
  const prevMapRef = useRef<MapState | undefined>(undefined);
  const captionKey = useRef(0);
  useEffect(() => {
    const msgs = describeMapChange(prevMapRef.current, map);
    prevMapRef.current = map;
    if (msgs.length === 0) return;
    captionKey.current += 1;
    setCaption({ text: msgs[0], key: captionKey.current });
    setAnnouncement(`${msgs.slice(0, 2).join('. ')}.`);
  }, [map]);

  useEffect(() => {
    if (!caption) return;
    const id = window.setTimeout(() => setCaption((c) => (c && c.key === caption.key ? null : c)), CAPTION_MS);
    return () => window.clearTimeout(id);
  }, [caption]);

  // --- interaction ---------------------------------------------------------
  const handleSelect = useCallback(
    (id: string) => {
      onSelectDistrict(effectiveFocus === id ? undefined : id);
    },
    [effectiveFocus, onSelectDistrict],
  );
  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && effectiveFocus) {
        e.stopPropagation();
        onSelectDistrict(undefined);
      }
    },
    [effectiveFocus, onSelectDistrict],
  );

  const ordered = useMemo(() => [...map.districts].sort((a, b) => a.y - b.y || a.x - b.x), [map.districts]);
  const sides = useMemo(() => labelSides(map.districts, layout), [map.districts, layout]);

  const rootStyle = {
    '--map-ground-top': ground.top,
    '--map-ground-bottom': ground.bottom,
    '--map-vignette': String(ground.vignette),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={[styles.root, layout.compact ? styles.compact : '', className ?? ''].join(' ').trim()}
      data-testid="map"
      data-mode={mode}
      style={rootStyle}
      onKeyDown={handleKey}
    >
      <div className={styles.vignette} aria-hidden="true" />
      <canvas ref={canvasRef} className={`${styles.canvas} ${mode === 'pixi' ? '' : styles.canvasHidden}`} aria-hidden="true" />
      {mode !== 'pixi' && <StaticMap map={map} layout={layout} palette={palette} focus={effectiveFocus} reducedMotion={reducedMotion} />}

      <div className={styles.overlay} role="group" aria-label="City districts">
        {ordered.map((d) => (
          <DistrictButton
            key={d.id}
            district={d}
            pos={layout.project(d.x, d.y)}
            selected={effectiveFocus === d.id}
            label={layout.compact ? shortName(d.name) : d.name}
            side={sides[d.id] ?? 'below'}
            onSelect={handleSelect}
          />
        ))}
      </div>

      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {captions && caption && (
        <div key={caption.key} className={styles.caption} aria-hidden="true">
          {caption.text}
        </div>
      )}
    </div>
  );
}

interface DistrictButtonProps {
  district: MapDistrictView;
  pos: { x: number; y: number };
  selected: boolean;
  label: string;
  side: LabelSide;
  onSelect(id: string): void;
}

function DistrictButton({ district: d, pos, selected, label, side, onSelect }: DistrictButtonProps) {
  return (
    <button
      type="button"
      className={styles.district}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      data-testid={`map-district-${d.id}`}
      aria-label={label === d.name ? districtAriaLabel(d) : `${label} — ${districtAriaLabel(d)}`}
      aria-pressed={selected}
      onClick={() => onSelect(d.id)}
    >
      <span className={styles.marker} aria-hidden="true" />
      {(d.pendingDecisions > 0 || d.openEvidence > 0) && (
        <span className={`${styles.badges} ${side === 'above' ? styles.badgesSide : ''}`} aria-hidden="true">
          {d.pendingDecisions > 0 && (
            <span className={`${styles.badge} ${styles.badgeDecision}`}>
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M5 1.5v4.2" />
                <circle cx="5" cy="8.3" r="0.6" fill="currentColor" />
              </svg>
              <span className={styles.count} data-count={d.pendingDecisions} />
            </span>
          )}
          {d.openEvidence > 0 && (
            <span className={`${styles.badge} ${styles.badgeEvidence}`}>
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 1.2h3.6l1.9 1.9v5.7h-5.5z" />
                <path d="M3.6 5h2.8M3.6 6.8h2.8" />
              </svg>
              <span className={styles.count} data-count={d.openEvidence} />
            </span>
          )}
        </span>
      )}
      <span className={`${styles.label} ${side === 'above' ? styles.labelAbove : ''}`} aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
