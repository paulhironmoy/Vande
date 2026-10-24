import type { ReactNode, SVGProps } from 'react';
import type { ConfidenceState, Dimension, DistrictKind, FeedKind, SourceType, EvidenceVisualType } from '@/engine/types';

export type PlayIconName =
  | 'freedom'
  | 'grievance'
  | 'safety'
  | 'evidence'
  | 'trust'
  | 'economy'
  | 'up'
  | 'down'
  | 'steady'
  | 'clock'
  | 'pause'
  | 'play'
  | 'close'
  | 'back'
  | 'chevronDown'
  | 'chevronUp'
  | 'chevronRight'
  | 'chevronLeft'
  | 'scale'
  | 'warning'
  | 'shieldCheck'
  | 'link'
  | 'question'
  | 'bug'
  | 'dashCircle'
  | 'bookmark'
  | 'flag'
  | 'strike'
  | 'used'
  | 'official'
  | 'institution'
  | 'press'
  | 'organizer'
  | 'citizen'
  | 'anonymous'
  | 'leak'
  | 'business'
  | 'emergency'
  | 'bell'
  | 'check'
  | 'arrowRight'
  | 'hourglass'
  | 'info'
  | 'crowd'
  | 'mood'
  | 'services'
  | 'campus'
  | 'civic'
  | 'market'
  | 'transit'
  | 'media'
  | 'records'
  | 'hospital'
  | 'residential'
  | 'industrial'
  | 'undo'
  | 'external'
  | 'pin'
  | 'tray'
  | 'sparkle'
  | 'photo'
  | 'document'
  | 'recording'
  | 'message'
  | 'chart'
  | 'map'
  | 'ledger'
  | 'video'
  | 'compare'
  | 'inspect'
  | 'eye'
  | 'calendar';

const P: Record<PlayIconName, ReactNode> = {
  freedom: <path d="M20 4c-6 0-11 5-13 11l-3 5 5-3c6-2 11-7 11-13zM9 15l6-6" />,
  grievance: <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1-5a8 8 0 1 1 17-6zM9 12l2 2 4-4" />,
  safety: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  evidence: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5" />,
  trust: <path d="M9 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM15 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  economy: (
    <path d="M4 10l1.5-5h13L20 10M4 10v10h16V10M4 10a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-6h4v6" />
  ),
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  down: <path d="M12 5v14M5 12l7 7 7-7" />,
  steady: <path d="M5 12h14" />,
  clock: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  scale: <path d="M12 3v18M5 21h14M6 6l6-2 6 2M6 7l-3 7a3 3 0 0 0 6 0L6 7zM18 7l-3 7a3 3 0 0 0 6 0l-3-7z" />,
  warning: <path d="M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5" />,
  shieldCheck: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4" />,
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  question: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17v.5" />,
  bug: <path d="M12 7a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0v-3a4 4 0 0 1 4-4zM9 8L7 6M15 8l2-2M8 12H5M16 12h3M8.5 16L6 18M15.5 16L18 18M12 11v7" />,
  dashCircle: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12h8" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
  flag: <path d="M5 21V4M5 4h12l-2 4 2 4H5" />,
  strike: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 6l12 12" />,
  used: <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8 12l3 3 5-6" />,
  official: <path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10l10-6 10 6z" />,
  institution: <path d="M4 21V5h16v16M9 9h2M13 9h2M9 13h2M13 13h2M10 21v-4h4v4" />,
  press: <path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h6v4H7zM7 16h6" />,
  organizer: <path d="M3 11v2l11 4V7L3 11zM14 9a3 3 0 0 1 0 6M6 13l1 6h3l-1-6" />,
  citizen: <path d="M12 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 21a7 7 0 0 1 14 0" />,
  anonymous: <path d="M12 3a7 7 0 0 0-7 7v4l-1 6h16l-1-6v-4a7 7 0 0 0-7-7zM9 12h.5M14.5 12h.5M9 16c1 1 5 1 6 0" />,
  leak: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  business: (
    <path d="M4 10l1.5-5h13L20 10M4 10v10h16V10M4 10a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-6h4v6" />
  ),
  emergency: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v8M8 12h8" />,
  bell: <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 20a2 2 0 0 0 4 0" />,
  check: <path d="M5 13l4 4L19 7" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  hourglass: <path d="M7 3h10M7 21h10M8 3c0 5 4 6 4 9s-4 4-4 9M16 3c0 5-4 6-4 9s4 4 4 9" />,
  info: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8v.5" />,
  crowd: <path d="M8 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM16 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM2 20a6 6 0 0 1 12 0M14 20a5 5 0 0 1 8 0" />,
  mood: <path d="M3 12h3l2-5 3 10 3-8 2 3h5" />,
  services: <path d="M13 2L5 14h6l-1 8 9-13h-6l1-7z" />,
  campus: <path d="M2 9l10-5 10 5-10 5zM6 11v5c0 2 3 3 6 3s6-1 6-3v-5M22 9v6" />,
  civic: <path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10l10-6 10 6z" />,
  market: (
    <path d="M4 10l1.5-5h13L20 10M4 10v10h16V10M4 10a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-6h4v6" />
  ),
  transit: (
    <path d="M6 3h12a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM4 10h16M8 14h.5M15.5 14h.5M7 18l-2 3M17 18l2 3" />
  ),
  media: <path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h6v4H7zM7 16h6" />,
  records: <path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" />,
  hospital: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
  residential: <path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5" />,
  industrial: <path d="M3 21V10l5 3V10l5 3V10l5 3V5h3v16z" />,
  undo: <path d="M4 10h10a5 5 0 0 1 0 10h-3M4 10l4-4M4 10l4 4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />,
  pin: <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 10h.5" />,
  tray: <path d="M3 13l2-8h14l2 8M3 13v6h18v-6M3 13h5l1 2h6l1-2h5" />,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />,
  photo: <path d="M4 5h16v14H4zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 17l5-5 4 4 3-3 4 4" />,
  document: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  recording: <path d="M3 12h2l2-4 3 9 3-11 3 8 2-3h3" />,
  message: <path d="M4 5h12v8H8l-4 3zM10 15h10v6l-3-2h-7z" />,
  chart: <path d="M4 20h16M7 17v-5M12 17V7M17 17v-8" />,
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  ledger: <path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" />,
  video: <path d="M3 6h13v12H3zM16 10l5-3v10l-5-3zM8 9l4 3-4 3z" />,
  compare: <path d="M9 4v16M15 4v16M3 8h6M15 8h6M3 16h6M15 16h6" />,
  inspect: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5M8 11h6M11 8v6" />,
  eye: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  calendar: <path d="M4 6h16v15H4zM4 10h16M8 3v5M16 3v5" />,
};

export interface PlayIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: PlayIconName;
  size?: number | string;
  /** Accessible name; when omitted the icon is decorative. */
  title?: string;
}

export function PlayIcon({ name, size = 20, title, className, ...rest }: PlayIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      className={className}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {P[name]}
    </svg>
  );
}

export const DIMENSION_ICON: Record<Dimension, PlayIconName> = {
  freedom: 'freedom',
  grievance: 'grievance',
  safety: 'safety',
  evidence: 'evidence',
  trust: 'trust',
  economy: 'economy',
};

export const CONFIDENCE_ICON: Record<ConfidenceState, PlayIconName> = {
  verified: 'shieldCheck',
  corroborated: 'link',
  unverified: 'question',
  manipulated: 'bug',
  unknown: 'dashCircle',
};

export const CONFIDENCE_LABEL: Record<ConfidenceState, string> = {
  verified: 'Verified',
  corroborated: 'Corroborated',
  unverified: 'Unverified',
  manipulated: 'Manipulated',
  unknown: 'Unknown',
};

export const SOURCE_ICON: Record<SourceType, PlayIconName> = {
  official: 'official',
  institution: 'institution',
  press: 'press',
  organizer: 'organizer',
  citizen: 'citizen',
  anonymous: 'anonymous',
  leak: 'leak',
  business: 'business',
  emergency: 'emergency',
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  official: 'Official source',
  institution: 'Institution',
  press: 'Press',
  organizer: 'Organiser',
  citizen: 'Citizen',
  anonymous: 'Anonymous',
  leak: 'Leaked material',
  business: 'Business',
  emergency: 'Emergency services',
};

export const FEED_ICON: Record<FeedKind, PlayIconName> = {
  event: 'bell',
  decision: 'check',
  consequence: 'arrowRight',
  delayed: 'hourglass',
  evidence: 'evidence',
  opponent: 'bug',
  rights: 'scale',
  system: 'info',
};

export const FEED_LABEL: Record<FeedKind, string> = {
  event: 'Event',
  decision: 'Your decision',
  consequence: 'Consequence',
  delayed: 'Delayed consequence',
  evidence: 'Evidence',
  opponent: 'Manipulation signal',
  rights: 'Rights moment',
  system: 'Note',
};

export const DISTRICT_ICON: Record<DistrictKind, PlayIconName> = {
  campus: 'campus',
  civic: 'civic',
  market: 'market',
  transit: 'transit',
  media: 'media',
  records: 'records',
  residential: 'residential',
  industrial: 'industrial',
  hospital: 'hospital',
};

export const VISUAL_ICON: Record<EvidenceVisualType, PlayIconName> = {
  photo: 'photo',
  document: 'document',
  recording: 'recording',
  message: 'message',
  chart: 'chart',
  map: 'map',
  ledger: 'ledger',
  video: 'video',
};
