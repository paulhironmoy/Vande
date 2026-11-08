/**
 * The list of ways to bat, as one radio group: arrow keys move through the ones that are available, a check mark and a
 * fill show the chosen one, and the camera is the last entry with its one honest line (what it needs) or, when it is
 * switched off, the plain reason. A switched-off option stays readable and focusable (aria-disabled), never hidden.
 */
import { useId, useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/ui';
import { usePracticeT } from '@/i18n/practice';
import { cameraBuilt, cameraInfo } from './cameraPort';
import { controlOptions, type ControlEnv, type ControlId } from './model';
import s from './controls.module.css';

export interface ControlOptionsProps {
  value: ControlId;
  onPick: (id: ControlId) => void;
  env: ControlEnv;
  /** Accessible name of the group. */
  label: string;
  testId: string;
}

export function ControlOptions({ value, onPick, env, label, testId }: ControlOptionsProps) {
  const t = usePracticeT();
  const uid = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const options = controlOptions(env, cameraBuilt());
  const packMb = cameraInfo()?.packMb ?? null;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = options.length;
    let j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : from;
    for (let k = 0; k < n; k++) {
      if (step) j = (j + step + n) % n;
      if (options[j].available) break;
      if (!step) j = e.key === 'Home' ? (j + 1) % n : (j - 1 + n) % n;
    }
    if (!options[j].available) return;
    onPick(options[j].id);
    refs.current[j]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={s.list} data-testid={testId}>
      {options.map((o, i) => {
        const checked = o.id === value;
        const hintId = `${uid}-${o.id}-hint`;
        const noteId = `${uid}-${o.id}-note`;
        const note = o.blocked
          ? t.tk(`practice.controls.unavailable.${o.blocked}`)
          : o.id === 'camera' && packMb !== null
            ? t.t('practice.controls.camera.needs', { mb: t.number(packMb, { maximumFractionDigits: 1 }) })
            : o.id === 'camera'
              ? t.tk('practice.controls.camera.needs_nosize')
              : null;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={o.available ? undefined : true}
            aria-describedby={note ? `${hintId} ${noteId}` : hintId}
            tabIndex={checked || (!options.some((x) => x.id === value) && i === 0) ? 0 : -1}
            className={s.opt}
            onClick={() => {
              if (o.available) onPick(o.id);
            }}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={`${testId}-${o.id}`}
            data-default={o.isDefault ? 'true' : undefined}
          >
            <span className={s.mark} aria-hidden="true">
              {checked && <Icon name="check" size={14} />}
            </span>
            <span className={s.text}>
              <span className={s.name}>{t.tk(`practice.input.${o.id}`)}</span>
              <span id={hintId} className={s.hint}>
                {t.tk(`practice.controls.${o.id}.hint`)}
              </span>
              {note && (
                <span id={noteId} className={s.note} data-testid={`${testId}-${o.id}-note`}>
                  {note}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
