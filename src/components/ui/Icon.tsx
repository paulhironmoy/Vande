import type { SVGProps } from 'react';

export type IconName =
  | 'back'
  | 'forward'
  | 'chevron-down'
  | 'chevron-up'
  | 'close'
  | 'settings'
  | 'play'
  | 'pause'
  | 'shield'
  | 'scale'
  | 'eye'
  | 'eye-off'
  | 'link'
  | 'alert'
  | 'bug'
  | 'check'
  | 'question'
  | 'info'
  | 'share'
  | 'copy'
  | 'download'
  | 'trash'
  | 'history'
  | 'map'
  | 'sound'
  | 'vibrate'
  | 'clock'
  | 'users'
  | 'home'
  | 'external'
  | 'refresh'
  | 'document'
  | 'camera'
  | 'mic'
  | 'message'
  | 'chart'
  | 'sparkle'
  | 'arrow-up'
  | 'arrow-down'
  | 'minus'
  | 'plus'
  | 'offline'
  | 'lock'
  | 'pulse'
  | 'book'
  | 'flag-off'
  | 'compare'
  | 'archive'
  | 'target'
  | 'megaphone'
  | 'building';

const PATHS: Record<IconName, string> = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 7a2 2 0 100-4 2 2 0 000 4zM9 19a2 2 0 100-4 2 2 0 000 4z',
  play: 'M8 5.5v13l10-6.5-10-6.5z',
  pause: 'M8 5v14M16 5v14',
  shield: 'M12 3l7 3v5.5c0 4.6-3 8.3-7 9.5-4-1.2-7-4.9-7-9.5V6l7-3z',
  scale: 'M12 3v18M5 21h14M12 6l6 2M12 6L6 8M6 8l-3 6.5a3 3 0 006 0L6 8zM18 8l-3 6.5a3 3 0 006 0L18 8z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0122 12a17 17 0 01-3.2 3.9M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.8 9.8 0 004-.8',
  link: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1',
  alert: 'M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5',
  bug: 'M4.5 8.5l5-4 3 3 5-3 3 6-3 3 2 5-6 1-4 3-3-4-3-3 1-7zM11 11.5h.01M14.5 13.5h.01M9 15h.01',
  check: 'M5 12l4.5 4.5L19 7',
  question: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6',
  copy: 'M9 9h11v11H9zM5 15V5a2 2 0 012-2h10',
  download: 'M12 3v12M8 11l4 4 4-4M5 21h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8M3 3v5h5M12 7v5l3 2',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
  sound: 'M4 10v4h3l4 4V6L7 10H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11',
  vibrate: 'M8 5a2 2 0 012-2h4a2 2 0 012 2v14a2 2 0 01-2 2h-4a2 2 0 01-2-2V5zM4 8v8M20 8v8',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20a7 7 0 0114 0M16 4.5a3.5 3.5 0 010 6.5M22 20a7 7 0 00-5-6.7',
  home: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5',
  refresh: 'M20 12a8 8 0 11-2.34-5.66M20 4v5h-5',
  document: 'M7 3h7l5 5v13H7V3zM14 3v5h5M10 13h6M10 17h6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8zM12 16a3 3 0 100-6 3 3 0 000 6z',
  mic: 'M9 6a3 3 0 016 0v5a3 3 0 01-6 0V6zM6 11a6 6 0 0012 0M12 17v4',
  message: 'M4 5h16v11H9l-5 4V5z',
  chart: 'M4 20h16M7 16v-5M12 16V8M17 16v-3',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 015.7-1M5 12.5a10 10 0 014.4-2.6M2 9a14 14 0 015.7-3.4M12 20h.01M16.6 13.4a5 5 0 011.1 1M19.8 9.9a14 14 0 002.2-.9',
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 016 0v4',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  book: 'M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h12',
  'flag-off': 'M3 3l18 18M5 21V5M5 5h9l1 2h5l-3 5 3 5h-5',
  compare: 'M9 4v16M15 4v16M3 8l6-4M3 16l6 4M21 8l-6-4M21 16l-6 4',
  archive: 'M3 5h18v4H3zM5 9v11h14V9M10 13h4',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01',
  megaphone: 'M4 10v4l12 4V6L4 10zM4 14l2 5M18 9a3 3 0 010 6',
  building: 'M4 21V7l8-4 8 4v14M4 21h16M9 21v-5h6v5M9 10h.01M15 10h.01M9 14h.01M15 14h.01',
};

const FILLED: Partial<Record<IconName, boolean>> = { play: true };

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
  /** Accessible label; when omitted the icon is decorative. */
  label?: string;
}

export function Icon({ name, size = 20, label, strokeWidth = 1.75, ...rest }: IconProps) {
  const filled = FILLED[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
