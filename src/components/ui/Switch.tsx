import type { ButtonHTMLAttributes } from 'react';
import s from './Switch.module.css';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when no external label. */
  label?: string;
}

export function Switch({ checked, onChange, label, className, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={[s.switch, className ?? ''].join(' ')}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className={s.track}>
        <span className={s.thumb} />
      </span>
    </button>
  );
}
