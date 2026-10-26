import { useState, type ReactNode } from 'react';
import { useApp } from '@/app/store';
import { LOCALES, useT } from '@/i18n';
import { Button, Icon, Logo } from '@/ui';
import { LanguagePicker } from '../common/LanguagePicker';
import { LegalLink } from '../common/LegalLink';
import { AgeConfirm, AgeFields, useAgeQuestion } from './AgeQuestion';
import { recordAge, type AgeAnswer } from './age';
import o from './OnboardingScreen.module.css';
import s from './AgeGate.module.css';

/** First run, before anything else: the year of birth, asked neutrally. Recovering an existing account skips it. */
export function AgeGate({ onAnswer, footerExtra }: { onAnswer: (answer: AgeAnswer) => void; footerExtra?: ReactNode }) {
  const { t } = useT();
  const locale = useApp((st) => st.settings.locale);
  const q = useAgeQuestion();
  // The answer waits for one neutral "Is that right?" (a mistyped year must not lock anyone out).
  const [pending, setPending] = useState<AgeAnswer | null>(null);
  const submit = () => {
    const answer = q.check();
    if (answer) setPending(answer);
  };
  const confirm = () => {
    if (!pending) return;
    recordAge(pending);
    onAnswer(pending);
  };
  // Any edit takes the question back.
  const edit = (set: (v: string) => void) => (v: string) => {
    setPending(null);
    set(v);
  };
  const editing = { ...q, setYear: edit(q.setYear), setMonth: edit(q.setMonth), setDay: edit(q.setDay) };
  return (
    <main className={o.screen} data-testid="age-screen">
      <header className={o.hero}>
        <div className={o.topRow}>
          <span className={o.brand}>
            <Logo size={32} wordmark title={t('brand.name')} />
          </span>
          <LanguagePicker compact testId="age-language" />
        </div>
        {LOCALES.find((l) => l.id === locale)?.status === 'machine_draft' && <p className={o.draftNote}>{t('settings.draft_note')}</p>}
        <span className={o.eyebrow}>{t('age.eyebrow')}</span>
        <h1 className={o.title}>{t('age.title')}</h1>
        <p className={o.body}>{t('age.body')}</p>
      </header>
      <section className={o.form}>
        <AgeFields q={editing} onEnter={submit} />
      </section>
      <footer className={o.footer}>
        {pending ? (
          <AgeConfirm q={q} onYes={confirm} onChange={() => setPending(null)} />
        ) : (
          <Button variant="accent" size="xl" block iconEnd="forward" onClick={submit} data-testid="age-continue">
            {t('common.continue')}
          </Button>
        )}
        <LegalLink page="privacy" className={s.legal} testId="age-privacy">
          {t('legal.privacy')}
        </LegalLink>
        {footerExtra}
      </footer>
    </main>
  );
}

/** Under 18: a kind stop. Nothing to retry here; deleting this device's data (the system's "Clear data") resets it. */
export function AgeStop() {
  const { t } = useT();
  return (
    <main className={o.screen} data-testid="age-stop">
      <header className={o.hero}>
        <div className={o.topRow}>
          <span className={o.brand}>
            <Logo size={32} wordmark title={t('brand.name')} />
          </span>
          <LanguagePicker compact testId="age-stop-language" />
        </div>
      </header>
      <section className={s.stop} aria-labelledby="age-stop-title">
        <span className={s.badge} aria-hidden="true">
          <Icon name="shield" size={30} />
        </span>
        <h1 id="age-stop-title" className={o.title}>
          {t('age.stop_title')}
        </h1>
        <p className={o.body}>{t('age.stop_body')}</p>
        <LegalLink page="privacy" className={s.legal} testId="age-stop-privacy">
          {t('legal.privacy_policy')}
        </LegalLink>
      </section>
    </main>
  );
}
