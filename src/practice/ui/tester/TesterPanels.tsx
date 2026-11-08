/**
 * The tester mode's three surfaces (hidden; only with tester mode on): the consent and cohort sheet before anything is
 * recorded, the one-tap study question, and the facilitator's markers. Closed codes only; nothing is typed.
 */
import { useState } from 'react';
import { usePracticeT } from '@/i18n/practice';
import {
  TESTER_ANSWERS,
  TESTER_COHORTS,
  TESTER_EXPLAINED,
  TESTER_EXPLOITS,
  TESTER_MARKER_REASONS,
  TESTER_TASKS,
  type TesterCohort,
} from '@/practice/store';
import { PButton, PSegmented, sys } from '../design';
import type { TesterApi } from './useTester';
import s from '../components/Live.module.css';
import p from './Tester.module.css';

export function TesterPrompt({ tester }: { tester: TesterApi }) {
  const t = usePracticeT();
  const c = tester.current;
  if (!c) return null;
  const options = TESTER_ANSWERS[c.q] as readonly string[];
  const rating = options.length === 10;
  return (
    <section
      className={s.result}
      data-expanded="false"
      aria-labelledby="practice-tester-q"
      data-testid="practice-tester"
      data-question={c.q}
    >
      <p className={sys.caption}>{t.t('practice.tester.step', { n: c.step, total: c.of })}</p>
      <h2 id="practice-tester-q" className={sys.section}>
        {t.tk(`practice.tester.q.${c.q}`)}
      </h2>
      <div className={rating ? p.ratings : s.actions} role="group" aria-labelledby="practice-tester-q">
        {options.map((a) => (
          <PButton
            key={a}
            variant="secondary"
            onClick={() => tester.answer(a)}
            data-testid={`practice-tester-answer-${a}`}
          >
            {rating ? a : t.tk(`practice.tester.a.${c.q}.${a}`, {}, t.tk(`practice.tester.a.${a}`))}
          </PButton>
        ))}
      </div>
      <PButton variant="quiet" onClick={tester.skip} data-testid="practice-tester-skip">
        {t.t('practice.tester.skip')}
      </PButton>
    </section>
  );
}

/** Before anything is recorded: the facilitator records consent, the cohort and the hand the player says they use. */
export function TesterConsent({ tester }: { tester: TesterApi }) {
  const t = usePracticeT();
  const [cohort, setCohort] = useState<TesterCohort>('rookie');
  const [hand, setHand] = useState<'left' | 'right' | 'unknown'>('unknown');
  return (
    <div className={p.backdrop}>
      <section
        className={p.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-tester-consent-title"
        data-testid="practice-tester-consent"
      >
        <h2 id="practice-tester-consent-title" className={sys.section}>
          {t.t('practice.tester.consent_title')}
        </h2>
        <p className={sys.caption}>{t.t('practice.tester.consent_body')}</p>
        <PSegmented
          label={t.t('practice.tester.cohort')}
          value={cohort}
          onChange={setCohort}
          options={TESTER_COHORTS.map((v) => ({ value: v, label: t.tk(`practice.tester.cohort.${v}`) }))}
          testId="practice-tester-cohort"
        />
        <PSegmented
          label={t.t('practice.tester.hand')}
          value={hand}
          onChange={setHand}
          options={(['right', 'left', 'unknown'] as const).map((v) => ({
            value: v,
            label: t.tk(`practice.tester.hand.${v}`),
          }))}
          testId="practice-tester-hand"
        />
        <div className={s.actions}>
          <PButton
            variant="primary"
            onClick={() => tester.begin(cohort, hand === 'unknown' ? null : hand)}
            data-testid="practice-tester-consent-yes"
          >
            {t.t('practice.tester.consent_yes')}
          </PButton>
          <PButton variant="quiet" onClick={tester.decline} data-testid="practice-tester-consent-no">
            {t.t('practice.tester.consent_no')}
          </PButton>
        </div>
      </section>
    </div>
  );
}

type Panel = null | 'menu' | 'help' | 'confusion' | 'exploit' | 'explained' | 'task';

/** The facilitator's markers: one small control between balls, never during a delivery. */
export function FacilitatorPanel({ tester, hidden }: { tester: TesterApi; hidden: boolean }) {
  const t = usePracticeT();
  const [panel, setPanel] = useState<Panel>(null);
  const [task, setTask] = useState<(typeof TESTER_TASKS)[number]>('defend');
  if (hidden) return null;
  const mark = (...a: Parameters<TesterApi['marker']>) => {
    tester.marker(...a);
    setPanel(null);
  };
  const codes = (list: readonly string[], prefix: string, onPick: (c: string) => void) =>
    list.map((c) => (
      <PButton
        key={c}
        variant="secondary"
        onClick={() => onPick(c)}
        data-testid={`practice-facilitator-${prefix}-${c}`}
      >
        {t.tk(`practice.tester.${prefix}.${c}`)}
      </PButton>
    ));
  return (
    <div className={p.facilitator}>
      {panel && (
        <section
          className={p.sheetSmall}
          aria-label={t.t('practice.tester.facilitator')}
          data-testid="practice-facilitator"
        >
          {panel === 'menu' && (
            <div className={p.grid}>
              {(['help', 'confusion', 'exploit', 'explained', 'task'] as const).map((k) => (
                <PButton
                  key={k}
                  variant="secondary"
                  onClick={() => setPanel(k)}
                  data-testid={`practice-facilitator-${k}`}
                >
                  {t.tk(`practice.tester.marker.${k}`)}
                </PButton>
              ))}
              <PButton variant="secondary" onClick={() => mark('prompted')} data-testid="practice-facilitator-prompted">
                {t.t('practice.tester.marker.prompted')}
              </PButton>
              <PButton
                variant="secondary"
                onClick={() => mark('asked_to_continue')}
                data-testid="practice-facilitator-asked"
              >
                {t.t('practice.tester.marker.asked_to_continue')}
              </PButton>
              <PButton
                variant="danger"
                onClick={() => (tester.endSession(), setPanel(null))}
                data-testid="practice-facilitator-end"
              >
                {t.t('practice.tester.marker.end_session')}
              </PButton>
            </div>
          )}
          {(panel === 'help' || panel === 'confusion') && (
            <div className={p.grid}>{codes(TESTER_MARKER_REASONS, 'reason', (c) => mark(panel, { reason: c }))}</div>
          )}
          {panel === 'exploit' && (
            <div className={p.grid}>{codes(TESTER_EXPLOITS, 'exploit', (c) => mark('exploit', { reason: c }))}</div>
          )}
          {panel === 'explained' && (
            <div className={p.grid}>
              {codes(TESTER_EXPLAINED, 'explained', (c) => mark('explained_outcome', { value: c }))}
            </div>
          )}
          {panel === 'task' && (
            <div className={p.grid}>
              <PSegmented
                label={t.t('practice.tester.marker.task')}
                value={task}
                onChange={setTask}
                options={TESTER_TASKS.map((v) => ({ value: v, label: t.tk(`practice.tester.task.${v}`) }))}
                testId="practice-facilitator-task-which"
              />
              {codes(['pass', 'fail'], 'result', (c) => mark('task_check', { reason: task, value: c }))}
            </div>
          )}
          <PButton variant="quiet" onClick={() => setPanel(null)}>
            {t.t('practice.common.cancel')}
          </PButton>
        </section>
      )}
      <PButton
        variant="secondary"
        onClick={() => setPanel(panel ? null : 'menu')}
        aria-expanded={panel !== null}
        data-testid="practice-facilitator-open"
      >
        {t.t('practice.tester.facilitator_short')}
      </PButton>
    </div>
  );
}
