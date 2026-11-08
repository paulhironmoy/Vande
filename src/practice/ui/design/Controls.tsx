/**
 * Practice form controls. `PSegmented`: radio-group semantics with arrow keys; the chosen option has a check mark as
 * well as a fill. `PSwitch`: role="switch". `PSetting`: a label and hint beside one control. `PDisclosure`: a quiet
 * button that shows its region only when asked (contextual disclosure, constitution §6).
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '@/ui';
import s from './Controls.module.css';

export interface PSegmentOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface PSegmentedProps<T extends string | number> {
  options: readonly PSegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  testId?: string;
  className?: string;
}

export function PSegmented<T extends string | number>({ options, value, onChange, label, testId, className }: PSegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = options.length;
    let j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : i;
    for (let k = 0; k < n; k++) {
      if (step) j = (j + step + n) % n;
      if (!options[j].disabled) break;
      if (!step) j = (j + 1) % n;
    }
    if (options[j].disabled) return;
    onChange(options[j].value);
    refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={[s.group, className ?? ''].join(' ')} data-testid={testId}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            className={s.opt}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
          >
            <span className={s.optLabel}>
              <span className={s.optMark} aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
              {o.label}
            </span>
            {o.description && <span className={s.optDesc}>{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface PSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  labelledBy?: string;
  label?: string;
  testId?: string;
  disabled?: boolean;
}

export function PSwitch({ checked, onChange, labelledBy, label, testId, disabled }: PSwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className={s.switch} onClick={() => onChange(!checked)} disabled={disabled} data-testid={testId}>
      <span className={s.switchTrack} aria-hidden="true" />
    </button>
  );
}

export function PSetting({ label, hint, children, id }: { label: ReactNode; hint?: ReactNode; children: ReactNode; id?: string }) {
  const auto = useId();
  const labelId = id ?? `${auto}-label`;
  return (
    <div className={s.setting}>
      <span className={s.settingText}>
        <span className={s.settingLabel} id={labelId}>
          {label}
        </span>
        {hint && <span className={s.settingHint}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export interface PDisclosureProps {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  testId?: string;
  className?: string;
}

export function PDisclosure({ label, children, defaultOpen = false, open: controlled, onToggle, testId, className }: PDisclosureProps) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const id = useId();
  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setOwn(next);
    onToggle?.(next);
  };
  return (
    <div className={className}>
      <button type="button" className={s.disclosure} aria-expanded={open} aria-controls={id} onClick={toggle} data-testid={testId ? `${testId}-toggle` : undefined}>
        {label}
        <span className={s.disclosureIcon} aria-hidden="true">
          <Icon name="chevron-down" size={18} />
        </span>
      </button>
      {open && (
        <div id={id} className={s.disclosureBody} data-testid={testId}>
          {children}
        </div>
      )}
    </div>
  );
}
