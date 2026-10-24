import { useApp } from '@/app/store';
import { useSimple } from '@/app/simple';
import { Logo } from '@/components/brand/Logo';
import { Button, ScreenShell } from '@/components/ui';
import { HearIllustration, ProtectIllustration, VerifyIllustration } from './Illustrations';
import s from './IntroScreen.module.css';

const PANELS = [
  {
    step: '01',
    title: 'Hear the grievance',
    text: 'Students, citizens and workers bring real problems. Listening early keeps anger from turning into disorder.',
    simpleTitle: 'Listen to people',
    simpleText: 'People come to you with real problems. Listen first.',
    Art: HearIllustration,
  },
  {
    step: '02',
    title: 'Verify the evidence',
    text: 'Claims arrive fast — some true, some fabricated. Inspect, compare and preserve before you act on anything.',
    simpleTitle: "Check what's true",
    simpleText: 'Some clues are true. Some are fake. Look closely before you act.',
    Art: VerifyIllustration,
  },
  {
    step: '03',
    title: 'Protect both rights and society',
    text: 'Keep peaceful assembly open and keep people safe. Suppression and chaos both break the Republic.',
    simpleTitle: 'Keep everyone safe AND free',
    simpleText: 'People may speak and gather. Keep them safe without silencing them.',
    Art: ProtectIllustration,
  },
];

const STYLES = [
  {
    value: 'simple' as const,
    name: 'Simple',
    tag: 'Recommended',
    text: 'Easy words. Big buttons. The clock waits for you.',
    testId: 'style-simple',
  },
  {
    value: 'full' as const,
    name: 'Full',
    tag: 'For strategists',
    text: 'More detail and a real-time clock for strategists.',
    testId: 'style-full',
  },
];

/** First-run introduction: three short panels, a play-style choice, one action. No account, no permissions. */
export function IntroScreen() {
  const completeIntro = useApp((st) => st.completeIntro);
  const beginCampaignSetup = useApp((st) => st.beginCampaignSetup);
  const playStyle = useApp((st) => st.settings.playStyle);
  const setPlayStyle = useApp((st) => st.setPlayStyle);
  const simple = useSimple();
  const begin = () => {
    completeIntro();
    beginCampaignSetup();
  };
  return (
    <ScreenShell
      testId="intro-screen"
      footer={
        <div className={s.cta}>
          <Button variant="primary" size="lg" block onClick={begin} data-testid="intro-begin" icon="play">
            {simple ? 'Start playing' : 'Begin your first crisis'}
          </Button>
          <p className={s.ctaHint}>{simple ? 'About 10 minutes for the whole story. Everything stays on this device.' : 'About 10 minutes for the full campaign. Everything stays on this device.'}</p>
        </div>
      }
    >
      <div className={s.brand}>
        <Logo size={36} />
        <span className={s.brandText}>
          VANDE<span>//</span>REPUBLIC
        </span>
      </div>
      <h1>{simple ? 'Your city needs you.' : 'You hold a Republic under pressure.'}</h1>
      <p className={s.lead}>
        {simple ? 'Three problems. Six things to protect. Every choice changes your city.' : 'Three crises. Six things to protect at once. Your move decides whether freedom and order survive together.'}
      </p>
      <ol className={s.panels} aria-label="How to play">
        {PANELS.map(({ step, title, text, simpleTitle, simpleText, Art }) => (
          <li key={step} className={s.panel}>
            <div className={s.art}>
              <Art />
            </div>
            <div>
              <div className={s.step}>Step {step}</div>
              <h2 className={s.ptitle}>{simple ? simpleTitle : title}</h2>
              <p className={s.ptext}>{simple ? simpleText : text}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className={s.chooser} aria-labelledby="intro-style-heading">
        <h2 id="intro-style-heading" className={s.chooserTitle}>
          How do you want to play?
        </h2>
        <p className={s.chooserHint}>You can change this any time in Settings.</p>
        <div className={s.styleGrid} role="radiogroup" aria-labelledby="intro-style-heading">
          {STYLES.map((opt) => {
            const checked = playStyle === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                className={[s.styleCard, checked ? s.styleCardOn : ''].join(' ')}
                onClick={() => setPlayStyle(opt.value)}
                data-testid={opt.testId}
              >
                <span className={s.styleHead}>
                  <span className={s.styleMark} aria-hidden="true" />
                  <span className={s.styleName}>{opt.name}</span>
                  <span className={s.styleTag}>{opt.tag}</span>
                </span>
                <span className={s.styleText}>{opt.text}</span>
              </button>
            );
          })}
        </div>
      </section>

      <p className={s.note}>
        {simple
          ? 'The story is made up. The trouble makers are habits, not real people. Educational content — not legal advice.'
          : 'Fictional scenarios. Opponents are behaviours, never communities. Educational content — not legal advice.'}
      </p>
    </ScreenShell>
  );
}
