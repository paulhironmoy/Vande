import { useApp } from '@/app/store';
import { useSimple } from '@/app/simple';
import { Logo } from '@/components/brand/Logo';
import { Button, ScreenShell } from '@/components/ui';
import { RulesCard } from '@/components/daily/RulesCard';
import s from './IntroScreen.module.css';

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
  const startDailyQuickPlay = useApp((st) => st.startDailyQuickPlay);
  const playStyle = useApp((st) => st.settings.playStyle);
  const setPlayStyle = useApp((st) => st.setPlayStyle);
  const simple = useSimple();
  const begin = () => {
    completeIntro();
    startDailyQuickPlay();
  };
  return (
    <ScreenShell
      testId="intro-screen"
      footer={
        <div className={s.cta}>
          <Button variant="primary" size="lg" block onClick={begin} data-testid="intro-begin" icon="play">
            {simple ? "Play today's crisis" : "Play Today's Crisis"}
          </Button>
          <p className={s.ctaHint}>{simple ? 'Everything stays on this device.' : 'Everything stays on this device.'}</p>
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
      <p className={s.lead}>{simple ? 'One crisis a day. Three minutes. Every choice changes your city.' : 'One crisis a day, three minutes, six things to protect at once.'}</p>
      <RulesCard heading={simple ? 'How to play' : 'Rules at a glance'} />

      <section className={s.chooser} aria-labelledby="intro-style-heading">
        <h2 id="intro-style-heading" className={s.chooserTitle}>
          How do you want to play?
        </h2>
        <div
          className={s.styleGrid}
          role="radiogroup"
          aria-labelledby="intro-style-heading"
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            const next = playStyle === 'simple' ? 'full' : 'simple';
            setPlayStyle(next);
            (e.currentTarget.querySelector(`[data-testid="style-${next}"]`) as HTMLElement | null)?.focus();
          }}
        >
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

      <p className={s.note}>{simple ? 'Made-up story. Educational content — not legal advice.' : 'Fictional scenarios. Educational content — not legal advice.'}</p>
    </ScreenShell>
  );
}
