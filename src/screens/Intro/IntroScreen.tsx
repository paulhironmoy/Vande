import { useApp } from '@/app/store';
import { Logo } from '@/components/brand/Logo';
import { Button, ScreenShell } from '@/components/ui';
import { HearIllustration, ProtectIllustration, VerifyIllustration } from './Illustrations';
import s from './IntroScreen.module.css';

const PANELS = [
  {
    step: '01',
    title: 'Hear the grievance',
    text: 'Students, citizens and workers bring real problems. Listening early keeps anger from turning into disorder.',
    Art: HearIllustration,
  },
  {
    step: '02',
    title: 'Verify the evidence',
    text: 'Claims arrive fast — some true, some fabricated. Inspect, compare and preserve before you act on anything.',
    Art: VerifyIllustration,
  },
  {
    step: '03',
    title: 'Protect both rights and society',
    text: 'Keep peaceful assembly open and keep people safe. Suppression and chaos both break the Republic.',
    Art: ProtectIllustration,
  },
];

/** First-run introduction: three short panels, one action. No account, no permissions. */
export function IntroScreen() {
  const completeIntro = useApp((st) => st.completeIntro);
  const beginCampaignSetup = useApp((st) => st.beginCampaignSetup);
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
            Begin your first crisis
          </Button>
          <p className={s.ctaHint}>About 10 minutes for the full campaign. Everything stays on this device.</p>
        </div>
      }
    >
      <div className={s.brand}>
        <Logo size={36} />
        <span className={s.brandText}>
          VANDE<span>//</span>REPUBLIC
        </span>
      </div>
      <h1>You hold a Republic under pressure.</h1>
      <p className={s.lead}>Three crises. Six things to protect at once. Your move decides whether freedom and order survive together.</p>
      <ol className={s.panels} aria-label="How to play">
        {PANELS.map(({ step, title, text, Art }) => (
          <li key={step} className={s.panel}>
            <div className={s.art}>
              <Art />
            </div>
            <div>
              <div className={s.step}>Step {step}</div>
              <h2 className={s.ptitle}>{title}</h2>
              <p className={s.ptext}>{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className={s.note}>Fictional scenarios. Opponents are behaviours, never communities. Educational content — not legal advice.</p>
    </ScreenShell>
  );
}
