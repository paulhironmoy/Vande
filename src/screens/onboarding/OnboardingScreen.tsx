import { useId, useMemo, useState, type ReactNode } from 'react';
import type { AvatarSpec, KitSpec, LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { LOCALES, useT, type MessageKey } from '@/i18n';
import { LanguagePicker } from '../common/LanguagePicker';
import { LegalLink } from '../common/LegalLink';
import { Avatar, Button, Field, KITS, Logo, newAvatarSeed } from '@/ui';
import { validateAlias } from './alias';
import s from './OnboardingScreen.module.css';

export interface OnboardingResult {
  alias: string;
  avatar: AvatarSpec;
  kit: KitSpec;
  locale: LocaleId;
}

export interface OnboardingScreenProps {
  onComplete: (result: OnboardingResult) => void;
  initialAlias?: string;
  initialSeed?: string;
  /** Server-side moderation result for the alias, if any (e.g. "That alias is not available"). */
  aliasError?: string | null;
  busy?: boolean;
  /** Secondary actions under the main button (e.g. "Already played? Recover your account"). */
  footerExtra?: ReactNode;
}

export { validateAlias } from './alias';

/** First run: a cricket name, a generated player and kit, and the language. No phone number, no real name. */
export function OnboardingScreen({ onComplete, initialAlias = '', initialSeed, aliasError, busy, footerExtra }: OnboardingScreenProps) {
  const { t } = useT();
  const locale = useApp((st) => st.settings.locale);
  const [alias, setAlias] = useState(initialAlias);
  const [touched, setTouched] = useState(false);
  const [seed, setSeed] = useState(() => initialSeed ?? newAvatarSeed());
  const [kitIndex, setKitIndex] = useState(0);
  const [looks, setLooks] = useState(1);
  const aliasId = useId();
  const hintId = useId();
  const problem = validateAlias(alias);
  const kit = KITS[kitIndex];
  const avatar = useMemo(() => ({ seed }), [seed]);

  const submit = () => {
    setTouched(true);
    if (problem) return;
    onComplete({ alias: alias.trim(), avatar, kit, locale });
  };
  const error = (touched && problem ? t(`onboarding.alias_error_${problem}` as MessageKey) : null) ?? aliasError ?? null;

  return (
    <main className={s.screen} data-testid="onboarding-screen">
      <header className={s.hero}>
        <div className={s.topRow}>
          <span className={s.brand}>
            <Logo size={32} wordmark title={t('brand.name')} />
          </span>
          {/* The language first: the device's language is the default, and anyone can change it before reading on. */}
          <LanguagePicker compact testId="onboarding-language" />
        </div>
        {LOCALES.find((l) => l.id === locale)?.status === 'machine_draft' && <p className={s.draftNote}>{t('settings.draft_note')}</p>}
        <span className={s.eyebrow}>{t('onboarding.eyebrow')}</span>
        <h1 className={s.title}>{t('onboarding.title')}</h1>
        <p className={s.body}>{t('onboarding.body')}</p>
      </header>

      <section className={s.player} aria-label={t('onboarding.avatar_label')}>
        <div className={s.portrait}>
          <Avatar avatar={avatar} kit={kit} size={148} label={t('onboarding.avatar_alt', { n: looks })} />
          <span className={s.glow} aria-hidden="true" />
        </div>
        <Button
          variant="secondary"
          icon="shuffle"
          data-testid="onboarding-shuffle"
          onClick={() => {
            setSeed(newAvatarSeed());
            setLooks((n) => n + 1);
          }}
        >
          {t('onboarding.avatar_shuffle')}
        </Button>
      </section>

      <section className={s.form}>
        <Field label={t('onboarding.alias_label')} description={t('onboarding.alias_hint')} htmlFor={aliasId}>
          <input
            id={aliasId}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t('onboarding.alias_placeholder')}
            maxLength={24}
            autoComplete="nickname"
            autoCapitalize="words"
            enterKeyHint="done"
            data-testid="onboarding-alias"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? hintId : undefined}
          />
        </Field>
        {error && (
          <p id={hintId} className={s.error} role="alert">
            {error}
          </p>
        )}

        <fieldset className={s.kits}>
          <legend className={s.legend}>{t('onboarding.kit_label')}</legend>
          <div className={s.kitRow}>
            {KITS.map((k, i) => (
              <button key={`${k.primary}-${k.secondary}-${k.pattern}`} type="button" className={s.kit} aria-pressed={kitIndex === i} aria-label={t('onboarding.kit_n', { n: i + 1 })} onClick={() => setKitIndex(i)} style={{ ['--a' as string]: k.primary, ['--b' as string]: k.secondary }}>
                <span className={s.kitSwatch} data-pattern={k.pattern} />
              </button>
            ))}
          </div>
        </fieldset>

      </section>

      <footer className={s.footer}>
        <p className={s.privacy}>
          {t('onboarding.privacy')}{' '}
          <LegalLink page="privacy" className={s.privacyLink} testId="onboarding-privacy">
            {t('legal.privacy')}
          </LegalLink>
        </p>
        <Button variant="accent" size="xl" block iconEnd="forward" onClick={submit} loading={busy} data-testid="onboarding-submit">
          {t('onboarding.cta')}
        </Button>
        {footerExtra}
      </footer>
    </main>
  );
}
