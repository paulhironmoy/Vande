/**
 * Practice buttons (the constitution's §2: one visually dominant primary action per screen, at most a secondary,
 * quiet navigation). `PButton` is an action; `PIconButton` an icon-only control with a required name; `PChoice` a
 * large menu row with a title and one line of description.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '@/ui';
import s from './Button.module.css';

export type PVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface PButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PVariant;
  size?: 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  iconEnd?: IconName;
  children?: ReactNode;
}

const cx = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(' ');

export const PButton = forwardRef<HTMLButtonElement, PButtonProps>(function PButton(
  { variant = 'secondary', size = 'md', block, icon, iconEnd, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(s.btn, s[variant], size === 'lg' && s.lg, block && s.block, className)}
      {...rest}
    >
      {icon && (
        <span className={s.icon} aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      )}
      {children !== undefined && <span className={s.label}>{children}</span>}
      {iconEnd && (
        <span className={s.icon} aria-hidden="true">
          <Icon name={iconEnd} size={20} />
        </span>
      )}
    </button>
  );
});

export interface PIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string;
  variant?: PVariant;
}

export const PIconButton = forwardRef<HTMLButtonElement, PIconButtonProps>(function PIconButton(
  { icon, label, variant = 'quiet', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(s.btn, s[variant], s.iconOnly, className)}
      {...rest}
    >
      <Icon name={icon} size={22} />
    </button>
  );
});

export interface PChoiceProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  primary?: boolean;
}

export function PChoice({ title, description, primary, className, type = 'button', ...rest }: PChoiceProps) {
  return (
    <button type={type} className={cx(s.choice, primary && s.choicePrimary, className)} {...rest}>
      <span className={s.choiceTitle}>{title}</span>
      {description && <span className={s.choiceDesc}>{description}</span>}
      <span className={s.chev} aria-hidden="true">
        <Icon name="forward" size={20} />
      </span>
    </button>
  );
}
