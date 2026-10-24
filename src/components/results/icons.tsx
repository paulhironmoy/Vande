import type { Dimension } from '@/engine/types';

interface IconProps {
  size?: number;
  className?: string;
  title?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function DimensionIcon({ dim, size = 20, className, title }: IconProps & { dim: Dimension }) {
  const p = base(size);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  switch (dim) {
    case 'freedom':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M5 14a7 7 0 0 1 14 0" />
          <path d="M3 19h18" />
          <path d="M12 7V4" />
        </svg>
      );
    case 'grievance':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
          <path d="M9.5 14.5l2 2 3.5-4" />
        </svg>
      );
    case 'safety':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z" />
        </svg>
      );
    case 'evidence':
      return (
        <svg {...p} {...a11y} className={className}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l5 5" />
          <path d="M8 10.5h5" />
        </svg>
      );
    case 'trust':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M9 8a4 4 0 0 1 4-4h3a4 4 0 0 1 0 8h-1" />
          <path d="M15 16a4 4 0 0 1-4 4H8a4 4 0 0 1 0-8h1" />
          <path d="M9 12h6" />
        </svg>
      );
    case 'economy':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M4 20h16" />
          <path d="M6 16v-4" />
          <path d="M11 16V8" />
          <path d="M16 16V5" />
        </svg>
      );
  }
}

export type StatusKind = 'resolved' | 'unresolved' | 'protected' | 'harmed' | 'exposed' | 'succeeded' | 'missed' | 'info' | 'up' | 'down' | 'flat';

export function StatusIcon({ kind, size = 18, className, title }: IconProps & { kind: StatusKind }) {
  const p = base(size);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  switch (kind) {
    case 'resolved':
    case 'protected':
      return (
        <svg {...p} {...a11y} className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.5 2.5L16 9.5" />
        </svg>
      );
    case 'unresolved':
      return (
        <svg {...p} {...a11y} className={className}>
          <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
          <path d="M12 8v5" />
          <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'harmed':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M12 3l9 16H3z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="16.8" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'exposed':
      // shield with a check: the manipulation failed
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'succeeded':
      // abstract bug glyph: manipulation got through (never a person)
      return (
        <svg {...p} {...a11y} className={className}>
          <ellipse cx="12" cy="13" rx="4.5" ry="6" />
          <path d="M12 7V4" />
          <path d="M9.5 5l-2-2M14.5 5l2-2" />
          <path d="M7.5 11H4M7.5 15H4.5M16.5 11H20M16.5 15h3" />
          <path d="M12 9v8" />
        </svg>
      );
    case 'missed':
      return (
        <svg {...p} {...a11y} className={className}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l5 5" />
          <path d="M8.5 8.5l4 4M12.5 8.5l-4 4" />
        </svg>
      );
    case 'up':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
        </svg>
      );
    case 'down':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M12 5v14" />
          <path d="M6 13l6 6 6-6" />
        </svg>
      );
    case 'flat':
      return (
        <svg {...p} {...a11y} className={className}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'info':
    default:
      return (
        <svg {...p} {...a11y} className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <circle cx="12" cy="8" r="0.6" fill="currentColor" />
        </svg>
      );
  }
}

export function ShareIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
    </svg>
  );
}

export function LinkIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <path d="M10 14a4 4 0 0 1 0-5.6l2.4-2.4a4 4 0 0 1 5.6 5.6L17 12.6" />
      <path d="M14 10a4 4 0 0 1 0 5.6l-2.4 2.4a4 4 0 0 1-5.6-5.6L7 11.4" />
    </svg>
  );
}

export function DownloadIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function ReplayIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v5h5" />
    </svg>
  );
}

export function HomeIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
    </svg>
  );
}

export function ClockIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function CalendarIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </svg>
  );
}

export function ChevronIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: IconProps) {
  const p = base(size);
  return (
    <svg {...p} aria-hidden="true" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
