import { useRef, type KeyboardEvent } from 'react';
import s from './SegmentedControl.module.css';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Accessible name of the group. */
  label: string;
  block?: boolean;
  className?: string;
  id?: string;
}

/** Radio-group semantics with arrow-key navigation. */
export function SegmentedControl<T extends string | number>({ options, value, onChange, label, block, className, id }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const opt = options[next];
    if (opt.disabled) return;
    onChange(opt.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} id={id} className={[s.group, block ? s.block : '', className ?? ''].join(' ')}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            className={s.opt}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
            {o.description && <span className={s.desc}>{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
