import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import s from './Chip.module.css';

export type ChipTone =
  | 'neutral'
  | 'freedom'
  | 'safety'
  | 'trust'
  | 'economy'
  | 'legitimacy'
  | 'grievance'
  | 'evidence'
  | 'danger'
  | 'verified'
  | 'corroborated'
  | 'unverified'
  | 'manipulated'
  | 'unknown'
  | 'saffron'
  | 'green'
  | 'cyan'
  | 'blue';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: IconName;
  /** Show a small coloured dot instead of an icon. */
  dot?: boolean;
  size?: 'md' | 'lg';
  solid?: boolean;
  children: ReactNode;
}

/** State chip: colour + icon + label together, never colour alone. */
export function Chip({ tone = 'neutral', icon, dot, size = 'md', solid, className, children, ...rest }: ChipProps) {
  return (
    <span className={[s.chip, size === 'lg' ? s.lg : '', solid ? s.solid : '', className ?? ''].join(' ')} data-tone={tone} {...rest}>
      {icon ? <Icon name={icon} size={size === 'lg' ? 18 : 15} /> : dot ? <span className={s.dot} aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}
