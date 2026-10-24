import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width. */
  block?: boolean;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon. */
  iconEnd?: IconName;
  children?: ReactNode;
}

function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, icon, iconEnd, className, type = 'button', children, ...rest },
  ref,
) {
  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 18 : 20;
  return (
    <button ref={ref} type={type} className={cx(s.btn, s[variant], size !== 'md' && s[size], block && s.block, className)} {...rest}>
      {icon && (
        <span className={s.icon}>
          <Icon name={icon} size={iconSize} />
        </span>
      )}
      {children !== undefined && <span className={s.label}>{children}</span>}
      {iconEnd && (
        <span className={s.icon}>
          <Icon name={iconEnd} size={iconSize} />
        </span>
      )}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', iconSize, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(s.btn, s.iconBtn, s[variant], size === 'lg' && s.lg, className)}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? (size === 'lg' ? 24 : 22)} />
    </button>
  );
});
