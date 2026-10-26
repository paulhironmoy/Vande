import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import s from './Chip.module.css';

export type ChipTone = 'neutral' | 'cyan' | 'amber' | 'success' | 'danger' | 'violet' | 'green' | 'clay';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: IconName;
  /** Show a small dot instead of an icon. */
  dot?: boolean;
  size?: 'md' | 'lg';
  solid?: boolean;
  children: ReactNode;
}

/** State chip: colour + icon (or dot) + label together, never colour alone. */
export function Chip({ tone = 'neutral', icon, dot, size = 'md', solid, className, children, ...rest }: ChipProps) {
  return (
    <span className={[s.chip, size === 'lg' ? s.lg : '', solid ? s.solid : '', className ?? ''].join(' ')} data-tone={tone} {...rest}>
      {icon ? <Icon name={icon} size={size === 'lg' ? 18 : 15} /> : dot ? <span className={s.dot} aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}
