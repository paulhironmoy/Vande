import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { PlayIcon, type PlayIconName } from './icons';
import styles from './PlayButton.module.css';

export type PlayButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface PlayButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PlayButtonVariant;
  size?: 'md' | 'lg';
  icon?: PlayIconName;
  iconRight?: PlayIconName;
  block?: boolean;
  children?: ReactNode;
}

export function PlayButton({ variant = 'secondary', size = 'md', icon, iconRight, block, className, children, type = 'button', ...rest }: PlayButtonProps) {
  const cls = [styles.btn, styles[variant], size === 'lg' ? styles.lg : '', block ? styles.block : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon ? <PlayIcon name={icon} size={18} className={styles.icon} /> : null}
      <span className={styles.label}>{children}</span>
      {iconRight ? <PlayIcon name={iconRight} size={18} className={styles.icon} /> : null}
    </button>
  );
}

export interface PlayIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: PlayIconName;
  /** Required accessible name. */
  label: string;
  variant?: 'ghost' | 'solid';
  badge?: number;
}

export function PlayIconButton({ icon, label, variant = 'ghost', badge, className, type = 'button', ...rest }: PlayIconButtonProps) {
  const cls = [styles.iconBtn, variant === 'solid' ? styles.iconSolid : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} aria-label={label} title={label} {...rest}>
      <PlayIcon name={icon} size={22} />
      {badge != null && badge > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}
