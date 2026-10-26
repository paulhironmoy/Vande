import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { FieldZone, ShotType } from '@/contracts';
import { useT } from '@/i18n';
import { SECTOR_ORDER, legalZones, nearestLegal, zoneFromSwipe } from './aim';
import s from './ZonePad.module.css';

export interface ZonePadProps {
  shot: ShotType;
  value: FieldZone | null;
  onChange: (zone: FieldZone) => void;
  disabled?: boolean;
  size?: number;
}

const MIN_PX = 18;

/**
 * Aim ring in the batter's view (bowler up, off side right). Swipe anywhere on it, tap a sector, or use the
 * arrow keys. Sectors the chosen shot cannot reach are dimmed and skipped.
 */
export function ZonePad({ shot, value, onChange, disabled, size = 168 }: ZonePadProps) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  /** The swipe in progress: where it began (CSS px, for the direction). */
  const drag = useRef<{ x0: number; y0: number } | null>(null);
  const [preview, setPreview] = useState<FieldZone | null>(null);
  const legal = legalZones(shot);
  const needsZone = legal.length > 0;

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !needsZone) return;
    drag.current = { x0: e.clientX, y0: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.hypot(dx, dy) >= MIN_PX) setPreview(nearestLegal(shot, zoneFromSwipe(dx, dy)));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.hypot(dx, dy) < MIN_PX) {
      // A tap: choose the sector under the finger.
      const r = ref.current!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const z = nearestLegal(shot, zoneFromSwipe(e.clientX - cx, e.clientY - cy));
      if (z) onChange(z);
      return;
    }
    const raw = zoneFromSwipe(dx, dy);
    const z = nearestLegal(shot, raw);
    if (z) onChange(z);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !needsZone) return;
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const order = SECTOR_ORDER.filter((z) => legal.includes(z));
    const i = value ? order.indexOf(value) : -1;
    onChange(order[(i + dir + order.length) % order.length]);
  };

  const shown = preview ?? value;
  return (
    <div
      ref={ref}
      className={s.pad}
      style={{ width: size, height: size }}
      data-disabled={disabled || !needsZone || undefined}
      role="radiogroup"
      aria-label={t('a11y.zone_pad')}
      tabIndex={disabled || !needsZone ? -1 : 0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
      onKeyDown={onKey}
    >
      <svg viewBox="-50 -50 100 100" aria-hidden="true">
        {SECTOR_ORDER.map((z, i) => {
          const a0 = ((i * 45 - 90) * Math.PI) / 180;
          const a1 = (((i + 1) * 45 - 90) * Math.PI) / 180;
          const r0 = 17;
          const r1 = 47;
          const P = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
          const d = `M${P(a0, r0)} L${P(a0, r1)} A${r1} ${r1} 0 0 1 ${P(a1, r1)} L${P(a1, r0)} A${r0} ${r0} 0 0 0 ${P(a0, r0)} Z`;
          const am = (((i + 0.5) * 45 - 90) * Math.PI) / 180;
          return (
            <g key={z} data-zone={z} data-legal={legal.includes(z) || undefined} data-active={shown === z || undefined} className={s.sector}>
              <path d={d} />
              <text x={Math.cos(am) * 33} y={Math.sin(am) * 33} textAnchor="middle" dominantBaseline="middle">
                {t(`zone.${z}`)}
              </text>
            </g>
          );
        })}
        <circle r="14" className={s.hub} />
        <path d="M0 -9 L0 9 M-4 -5 L0 -9 L4 -5" className={s.hubGlyph} transform={shown ? `rotate(${SECTOR_ORDER.indexOf(shown) * 45 + 22.5})` : undefined} />
      </svg>
      <span className="sr-only" aria-live="polite">
        {shown ? t('bat.aim', { zone: t(`zone.${shown}`) }) : ''}
      </span>
    </div>
  );
}
