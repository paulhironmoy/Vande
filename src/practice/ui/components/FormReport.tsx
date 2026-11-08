/**
 * Form: a report of demonstrated skill (the coach's formFromAttempts over this device's evidence), never a buff. Only
 * skills with evidence show a score; the rest, and running (not under the player's control), say "not measured yet".
 */
import { useMemo } from 'react';
import type { FormReport as Report, FormSkill } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { loadFormSamples } from '@/practice/store';
import { useKit } from '../context';
import { skillName } from '../coaching';
import { sys } from '../design';
import s from './Summary.module.css';

export function useFormReport(): Report | null {
  const { coach } = useKit();
  return useMemo(() => (coach ? coach.formFromAttempts(loadFormSamples()) : null), [coach]);
}

export function FormReport({ report }: { report: Report }) {
  const t = usePracticeT();
  const keys = Object.keys(report) as FormSkill[];
  const measured = keys.filter((k) => report[k].score !== null && k !== 'running');
  const unmeasured = keys.filter((k) => report[k].score === null || k === 'running');
  return (
    <section className={sys.stackTight} aria-labelledby="practice-form-title" data-testid="practice-form">
      <h2 id="practice-form-title" className={sys.section}>
        {t.t('practice.form.title')}
      </h2>
      {measured.length === 0 ? (
        <p className={sys.caption}>{t.t('practice.form.none')}</p>
      ) : (
        <ul className={s.form}>
          {measured.map((k) => {
            const r = report[k];
            const trend = r.trend === null ? null : Math.round(r.trend);
            return (
              <li key={k} className={s.formRow} data-skill={k}>
                <span>{skillName(t, k)}</span>
                <span className={s.bar} aria-hidden="true">
                  <span style={{ width: `${Math.max(2, Math.min(100, r.score ?? 0))}%` }} />
                </span>
                <span className={`${sys.num} ${s.formScore}`}>{t.t('practice.form.score', { score: Math.round(r.score ?? 0) })}</span>
                <span className={`${sys.caption} ${sys.num}`}>{trend === null || trend === 0 ? '' : t.t(trend > 0 ? 'practice.form.up' : 'practice.form.down', { n: Math.abs(trend) })}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className={sys.caption}>{t.t('practice.form.not_measured', { list: unmeasured.map((k) => skillName(t, k)).join(', ') })}</p>
    </section>
  );
}
