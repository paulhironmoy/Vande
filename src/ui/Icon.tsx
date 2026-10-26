import type { SVGProps } from 'react';

/** Original 24px stroke icons (1.75px), drawn for VANDE Cricket. */
export type IconName =
  | 'back'
  | 'forward'
  | 'chevron-down'
  | 'chevron-up'
  | 'close'
  | 'check'
  | 'info'
  | 'alert'
  | 'question'
  | 'plus'
  | 'minus'
  | 'play'
  | 'pause'
  | 'replay'
  | 'skip'
  | 'slowmo'
  | 'sparkle'
  | 'share'
  | 'copy'
  | 'link'
  | 'refresh'
  | 'offline'
  | 'lock'
  | 'seal'
  | 'clock'
  | 'users'
  | 'home'
  | 'settings'
  | 'sound'
  | 'sound-off'
  | 'vibrate'
  | 'globe'
  | 'eye'
  | 'eye-off'
  | 'trophy'
  | 'crown'
  | 'flame'
  | 'target'
  | 'bat'
  | 'ball'
  | 'stumps'
  | 'field'
  | 'energy'
  | 'swipe'
  | 'tap'
  | 'gesture'
  | 'message'
  | 'calendar'
  | 'shuffle'
  | 'rematch'
  | 'external'
  | 'arrow-up'
  | 'arrow-down'
  | 'qr'
  | 'download'
  | 'trash'
  | 'bell'
  | 'bell-off'
  | 'shield'
  | 'ghost'
  | 'chart'
  | 'user'
  | 'book'
  | 'cup'
  | 'logout';

const PATHS: Record<IconName, string> = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  alert: 'M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.5v.01',
  question: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.6 9.4a2.5 2.5 0 014.9.6c0 1.8-2.5 2.1-2.5 4M12 17h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  play: 'M8 5.5v13l10.5-6.5L8 5.5z',
  pause: 'M8.5 5v14M15.5 5v14',
  replay: 'M4 12a8 8 0 108-8 8 8 0 00-5.66 2.34L4 8.7M4 4v4.7h4.7M10.5 9.2v5.6l4.5-2.8-4.5-2.8z',
  skip: 'M5 6l8 6-8 6V6zM14 6l8 6-8 6M22 6v12',
  slowmo: 'M12 20a8 8 0 100-16 8 8 0 000 16zM12 8v4l2.5 2.5M3 4l2 2M21 4l-2 2',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6',
  copy: 'M9 9h11v11H9zM5 15V5a1 1 0 011-1h9',
  link: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1',
  refresh: 'M20 12a8 8 0 11-2.34-5.66M20 4v5h-5',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 015.7-1M5 12.5a10 10 0 014.4-2.6M2 9a14 14 0 015.7-3.4M12 20h.01M16.6 13.4a5 5 0 011.1 1M19.8 9.9a14 14 0 002.2-.9',
  lock: 'M6 11h12v10H6zM9 11V7.5a3 3 0 016 0V11',
  seal: 'M12 2.8l7.5 4.3v9.8L12 21.2l-7.5-4.3V7.1L12 2.8zM9.5 12.2l1.8 1.8 3.4-3.6',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.6a3.5 3.5 0 010 6.3M21.5 20a6.5 6.5 0 00-4-6',
  home: 'M3 11l9-7.5 9 7.5v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 7a2 2 0 100-4 2 2 0 000 4zM9 19a2 2 0 100-4 2 2 0 000 4z',
  sound: 'M4 10v4h3.5l4.5 4V6l-4.5 4H4zM16 9a4 4 0 010 6M18.6 6.4a8 8 0 010 11.2',
  'sound-off': 'M4 10v4h3.5l4.5 4V6l-4.5 4H4zM16 9.5l5 5M21 9.5l-5 5',
  vibrate: 'M8 5a2 2 0 012-2h4a2 2 0 012 2v14a2 2 0 01-2 2h-4a2 2 0 01-2-2V5zM4 8v8M20 8v8',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3.5 9h17M3.5 15h17M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.5 5.6 12 3z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0122 12a17 17 0 01-3.2 3.9M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.8 9.8 0 004-.8',
  trophy: 'M8 4h8v5a4 4 0 01-8 0V4zM8 6H4.5a3 3 0 003.6 4M16 6h3.5a3 3 0 01-3.6 4M12 13v4M8.5 21h7M9.5 17h5v4',
  crown: 'M3.5 8l4.5 4 4-6.5 4 6.5 4.5-4-2 10.5h-13L3.5 8zM6 21h12',
  flame: 'M12 21a6 6 0 006-6c0-4-3-5.5-3-9.5-2 1-3.5 3.6-3.6 6.2C10 10 9.5 8.5 9.5 7 7.4 8.7 6 11.6 6 15a6 6 0 006 6z',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM12 12h.01',
  bat: 'M14.2 3.6l6.2 6.2-8.7 8.7a2.2 2.2 0 01-3.1 0l-3.1-3.1a2.2 2.2 0 010-3.1l8.7-8.7zM7.3 15.6l-3.8 3.8M3 20.5l1.5-1.5',
  ball: 'M12 21a9 9 0 100-18 9 9 0 000 18zM6.8 5.4c2.4 3.6 2.4 9.6 0 13.2M17.2 5.4c-2.4 3.6-2.4 9.6 0 13.2',
  stumps: 'M7 21V7.5M12 21V7.5M17 21V7.5M5.5 6.2h5M13.5 6.2h5M4 21h16',
  field: 'M12 21c5 0 9-4 9-9s-4-9-9-9-9 4-9 9 4 9 9 9zM10.6 8.2h2.8v7.6h-2.8zM12 3v1.5M12 19.5V21',
  energy: 'M13.5 2.5L5 13.5h6.2L10.5 21.5 19 10.5h-6.2l.7-8z',
  swipe: 'M4 12h13M13 8l4 4-4 4M20 5v14',
  tap: 'M12 14V6.5a1.5 1.5 0 013 0V13l3.2.7a2 2 0 011.5 2.3l-.8 3.9a2 2 0 01-2 1.6H12a2 2 0 01-1.6-.8L7 16.3a1.5 1.5 0 012.2-2L12 16.5M7.5 6a5 5 0 019.3-1.5',
  gesture: 'M4 17c2.5-6 5.5-9 8-9s3 3 1.5 5.5S8.5 18 10 19s6-1 10-9M18.5 7.5L20 10l-2.6.9',
  message: 'M4 5h16v11H9.5L4 20V5z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  shuffle: 'M3 7h3.5c2 0 3 1 4.5 3.5L13 14c1.5 2.5 2.5 3.5 4.5 3.5H21M18 14.5l3 3-3 3M3 17.5h3.5c1.1 0 1.9-.3 2.6-1M18 3.5l3 3.5-3 3M21 7h-3.5c-1.1 0-1.9.3-2.6 1',
  rematch: 'M4 9a8 8 0 0114.3-3.3L20 7.5M20 3.5v4h-4M20 15a8 8 0 01-14.3 3.3L4 16.5M4 20.5v-4h4',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM6.5 6.5h1M16.5 6.5h1M6.5 16.5h1M14 14h2.5v2.5H14zM18 14h2M14 18.5v1.5M17 17.5h3v2.5h-3z',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 10.5v6M14 10.5v6',
  bell: 'M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15l1.5-2zM10 20.5a2 2 0 004 0',
  'bell-off': 'M3 3l18 18M8.4 5.6A6 6 0 0118 11v4M6 11v5.5l-1.5 2h13M10 20.5a2 2 0 004 0',
  shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6L12 3zM9 12l2.2 2.2L15.5 10',
  ghost: 'M6 20.5V10a6 6 0 0112 0v10.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5zM9.5 10.5h.01M14.5 10.5h.01',
  chart: 'M4 20h16M7 16.5V11M12 16.5V6.5M17 16.5v-8',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20.5a7.5 7.5 0 0115 0',
  book: 'M5 4.5h11a3 3 0 013 3V20H8a3 3 0 01-3-3V4.5zM5 17a3 3 0 013-3h11',
  cup: 'M7 4h10v4.5a5 5 0 01-10 0V4zM12 13.5V17M8.5 20.5h7M10 17h4v3.5h-4zM7 6H4.5v1A3 3 0 007 10M17 6h2.5v1A3 3 0 0117 10',
  logout: 'M10 20H5.5a1 1 0 01-1-1V5a1 1 0 011-1H10M15 16l4-4-4-4M19 12H9.5',
};

const FILLED: Partial<Record<IconName, boolean>> = { play: true, energy: true };

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
