import { useId, useMemo, useRef, useState, type RefObject } from 'react';
import { useT } from '@/i18n';
import { Button, Field } from '@/ui';
import { ADULT_AGE, ageStep, asciiDigits, type AgeAnswer, type AgeStep } from './age';
import s from './AgeQuestion.module.css';

export interface AgeQuestionState {
  year: string;
  month: string;
  day: string;
  setYear(v: string): void;
  setMonth(v: string): void;
  setDay(v: string): void;
  step: AgeStep;
  /** A problem is shown once the player tried to continue (or left the year field). */
  shown: boolean;
  setShown(v: boolean): void;
  /** Shows any problem and returns the answer when there is one. */
  check(): AgeAnswer | null;
  today: Date;
  yearRef: RefObject<HTMLInputElement | null>;
}

/** The answers so far and what they lead to. Nothing is pre-selected and nothing is stored until `check` passes. */
export function useAgeQuestion(at?: Date): AgeQuestionState {
  const [today] = useState(() => at ?? new Date());
  const [year, setYearRaw] = useState('');
  const [month, setMonthRaw] = useState('');
  const [day, setDay] = useState('');
  const [shown, setShown] = useState(false);
  const yearRef = useRef<HTMLInputElement>(null);
  const step = useMemo(
    () => ageStep({ year: year === '' ? null : year.length === 4 ? Number(year) : Number.NaN, month: month === '' ? null : Number(month), day: day === '' ? null : Number(day) }, today),
    [year, month, day, today],
  );
  const setYear = (v: string) => {
    setYearRaw(asciiDigits(v).slice(0, 4));
    setMonthRaw('');
    setDay('');
  };
  const setMonth = (v: string) => {
    setMonthRaw(v);
    setDay('');
  };
  const check = () => {
    setShown(true);
    return step.kind === 'answer' ? step.answer : null;
  };
  return { year, month, day, setYear, setMonth, setDay, step, shown, setShown, check, today, yearRef };
}

/**
 * Year of birth (and, only for the year someone turns 18, the month and day). Neutral: no default, no example year
 * and nothing that says which answer lets you in.
 */
export function AgeFields({ q, onEnter, testId = 'age' }: { q: AgeQuestionState; onEnter?: () => void; testId?: string }) {
  const tr = useT();
  const { t } = tr;
  const yearId = useId();
  const monthId = useId();
  const dayId = useId();
  const errId = useId();
  const deciding = q.year.length === 4 && q.today.getFullYear() - Number(q.year) === ADULT_AGE;
  const askDay = deciding && q.month !== '' && Number(q.month) === q.today.getMonth() + 1;
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => tr.date(new Date(2000, i, 1), { month: 'long' })), [tr]);
  const days = askDay ? new Date(Number(q.year), Number(q.month), 0).getDate() : 31;
  const need = q.step.kind === 'need' ? q.step.field : null;
  const error = q.shown && need ? t(need === 'year' ? 'age.year_error' : need === 'month' ? 'age.month_error' : 'age.day_error') : null;

  return (
    <div className={s.fields}>
      <Field label={t('age.year_label')} htmlFor={yearId}>
        <input
          ref={q.yearRef}
          id={yearId}
          className={s.year}
          value={q.year}
          inputMode="numeric"
          autoComplete="bday-year"
          enterKeyHint="done"
          maxLength={4}
          onChange={(e) => q.setYear(e.target.value)}
          onBlur={() => q.year.length > 0 && q.setShown(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter?.();
          }}
          aria-invalid={Boolean(error && need === 'year')}
          aria-describedby={error && need === 'year' ? errId : undefined}
          data-testid={`${testId}-year`}
        />
      </Field>
      {deciding && (
        <div className={s.birthday}>
          <Field label={t('age.month_label')} htmlFor={monthId}>
            <select id={monthId} className={s.select} value={q.month} onChange={(e) => q.setMonth(e.target.value)} aria-invalid={Boolean(error && need === 'month')} aria-describedby={error && need === 'month' ? errId : undefined} data-testid={`${testId}-month`}>
              <option value="">{t('age.choose')}</option>
              {months.map((name, i) => (
                <option key={name} value={String(i + 1)}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          {askDay && (
            <Field label={t('age.day_label')} htmlFor={dayId}>
              <select id={dayId} className={s.select} value={q.day} onChange={(e) => q.setDay(e.target.value)} aria-invalid={Boolean(error && need === 'day')} aria-describedby={error && need === 'day' ? errId : undefined} data-testid={`${testId}-day`}>
                <option value="">{t('age.choose')}</option>
                {Array.from({ length: days }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {tr.number(i + 1)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}
      {error && (
        <p id={errId} className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One neutral check before anything is kept: "You entered 2012. Is that right?" with Yes and Change year. It comes
 * after every answer, whichever way it goes, so it says nothing about which one lets you in; only Yes stores it.
 */
export function AgeConfirm({ q, onYes, onChange, testId = 'age' }: { q: AgeQuestionState; onYes: () => void; onChange: () => void; testId?: string }) {
  const tr = useT();
  const { t } = tr;
  const id = useId();
  const y = Number(q.year);
  const value =
    q.month && q.day
      ? tr.date(new Date(y, Number(q.month) - 1, Number(q.day)), { day: 'numeric', month: 'long', year: 'numeric' })
      : q.month
        ? tr.date(new Date(y, Number(q.month) - 1, 1), { month: 'long', year: 'numeric' })
        : q.year;
  return (
    <div className={s.confirm} role="group" aria-labelledby={id} data-testid={`${testId}-confirm`}>
      <p id={id} className={s.confirmText} role="status">
        {t('age.confirm', { value })}
      </p>
      <div className={s.confirmRow}>
        <Button variant="accent" size="lg" onClick={onYes} data-testid={`${testId}-confirm-yes`}>
          {t('age.confirm_yes')}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            onChange();
            q.yearRef.current?.focus();
          }}
          data-testid={`${testId}-confirm-change`}
        >
          {t('age.confirm_change')}
        </Button>
      </div>
    </div>
  );
}
