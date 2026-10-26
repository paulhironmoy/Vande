import type { FieldSetting, FieldZone } from '@/contracts';
import { useT } from '@/i18n';
import { BOUNDARY_R, CONTACT_Z, RING_R, ZONES, ZONE_BEARING, fieldSpots } from '@/render3d/core/ground';
import s from './FieldMap.module.css';

export interface FieldMapProps {
  field: FieldSetting;
  /** Highlighted target zone (batting aim). */
  zone?: FieldZone | null;
  /** 'batting': bowler at the top, off side right (what the batter sees). 'broadcast': bowler at the bottom. */
  orientation?: 'batting' | 'broadcast';
  showLabels?: boolean;
  size?: number;
  className?: string;
}

const R = BOUNDARY_R + 4;

/** Top-down field with the fielders of a setting. Same geometry as the 3D renderer. */
export function FieldMap({ field, zone = null, orientation = 'batting', showLabels = false, size = 160, className }: FieldMapProps) {
  const { t } = useT();
  const spots = fieldSpots(field);
  // World (x, z) to SVG. Batting view: striker at the bottom looking up the pitch; off side (+x) to the right.
  const flip = orientation === 'batting' ? 1 : -1;
  const sx = (x: number) => 50 + flip * (x / R) * 48;
  const sy = (z: number) => 50 + flip * (z / R) * 48;
  const wedge = (z: FieldZone) => {
    const a0 = ((ZONE_BEARING[z] - 22.5) * Math.PI) / 180;
    const a1 = ((ZONE_BEARING[z] + 22.5) * Math.PI) / 180;
    const cx = sx(0);
    const cy = sy(CONTACT_Z);
    const r = 60;
    const p = (a: number) => `${sx(Math.sin(a) * r)},${sy(CONTACT_Z - Math.cos(a) * r)}`;
    return `M${cx},${cy} L${p(a0)} L${p(a1)} Z`;
  };
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={[s.map, className ?? ''].join(' ')} role="img" aria-label={t('a11y.field_map', { field: t(`field.${field}`) })}>
      <defs>
        <radialGradient id="fm-grass" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2b8b4d" />
          <stop offset="100%" stopColor="#0f4a2c" />
        </radialGradient>
        <clipPath id="fm-clip">
          <circle cx="50" cy="50" r="48" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="49.5" className={s.rope} />
      <circle cx="50" cy="50" r="48" fill="url(#fm-grass)" />
      {zone && <path d={wedge(zone)} clipPath="url(#fm-clip)" className={s.wedge} />}
      <circle cx={sx(0)} cy={sy(0)} r={(RING_R / R) * 48} className={s.ring} />
      <rect x={50 - 1.6} y={Math.min(sy(-11), sy(11))} width={3.2} height={Math.abs(sy(11) - sy(-11))} rx={0.6} className={s.pitch} />
      {spots.map((sp) => (
        <circle key={sp.role} cx={sx(sp.pos.x)} cy={sy(sp.pos.z)} r={2.6} className={s.fielder} data-deep={sp.deep || undefined} />
      ))}
      <circle cx={sx(0.15)} cy={sy(CONTACT_Z + 3.5)} r={2.4} className={s.fielder} />
      <circle cx={sx(-0.3)} cy={sy(CONTACT_Z)} r={2.8} className={s.batter} />
      {showLabels &&
        ZONES.map((z) => {
          const a = (ZONE_BEARING[z] * Math.PI) / 180;
          const x = sx(Math.sin(a) * 46);
          const y = sy(CONTACT_Z - Math.cos(a) * 46);
          return (
            <text key={z} x={x} y={y} className={s.label} data-active={zone === z || undefined} textAnchor="middle" dominantBaseline="middle">
              {t(`zone.${z}`)}
            </text>
          );
        })}
    </svg>
  );
}
