import { useEffect, useId } from 'react';
import type { OpponentId } from '@/engine/types';
import { OPPONENT_IDS } from '@/engine/types';
import { DEFAULT_OPPONENTS, DIFFICULTY_META, OPPONENTS } from '@/engine';
import { Button, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { pulseHaptic } from '@/components/results/feedback';
import { OpponentCard } from '@/components/opponents/OpponentCard';
import { DifficultyControl } from '@/components/opponents/DifficultyControl';
import styles from './OpponentSelectScreen.module.css';

const DIFFICULTY_SHIFT: Record<string, Record<'Low' | 'Medium' | 'High', string>> = {
  measured: { Low: 'Low', Medium: 'Low', High: 'Medium' },
  standard: { Low: 'Low', Medium: 'Medium', High: 'High' },
  severe: { Low: 'Medium', Medium: 'High', High: 'High' },
};

export function OpponentSelectScreen() {
  const intent = useApp((s) => s.intent);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const setIntentOpponents = useApp((s) => s.setIntentOpponents);
  const setIntentDifficulty = useApp((s) => s.setIntentDifficulty);
  const confirmSetup = useApp((s) => s.confirmSetup);
  const back = useApp((s) => s.back);
  const toast = useApp((s) => s.toast);
  const difficultyLabelId = useId();

  useEffect(() => {
    if (!intent) useApp.getState().beginCampaignSetup();
  }, [intent]);

  const selected: OpponentId[] = intent?.opponents?.length ? intent.opponents : DEFAULT_OPPONENTS;
  const difficulty = intent?.difficulty ?? 'standard';
  const diffMeta = DIFFICULTY_META[difficulty];

  const toggle = (id: OpponentId) => {
    pulseHaptic();
    if (selected.includes(id)) {
      if (selected.length === 1) {
        toast({ text: 'Keep at least one opponent in play.', kind: 'info', duration: 2400 });
        return;
      }
      setIntentOpponents(selected.filter((o) => o !== id));
    } else {
      setIntentOpponents(OPPONENT_IDS.filter((o) => o === id || selected.includes(o)));
    }
  };

  const ctaLabel = intent?.kind === 'daily' ? "Begin today's crisis" : intent?.kind === 'challenge' ? 'Begin challenge' : 'Begin chapter 1';
  const summary = `${selected.length} ${selected.length === 1 ? 'opponent' : 'opponents'} · ${diffMeta?.label ?? 'Standard'}`;

  return (
    <ScreenShell title="Choose your opponents" onBack={() => back()} testId="opponents-screen">
      <div className={layout.page}>
        <header className={styles.intro}>
          <h1 className={layout.h1}>Who is working against the Republic?</h1>
          <p className={layout.lead}>
            Each opponent is a behaviour, not a group of people. They watch how you play and adapt. Pick between one and five.
          </p>
          <p className={styles.hint}>
            <span className={styles.hintDot} aria-hidden="true" />
            Recommended for a first game: two opponents at standard difficulty.
          </p>
        </header>

        <section aria-label="Opponents" className={styles.grid}>
          {OPPONENT_IDS.map((id) => {
            const meta = OPPONENTS[id];
            if (!meta) return null;
            return (
              <OpponentCard
                key={id}
                opponent={meta}
                selected={selected.includes(id)}
                onToggle={() => toggle(id)}
                animated={!reducedMotion}
                difficultyLabel={DIFFICULTY_SHIFT[difficulty]?.[meta.baseDifficulty] ?? meta.baseDifficulty}
              />
            );
          })}
        </section>

        <section className={layout.card} aria-labelledby={difficultyLabelId}>
          <div className={styles.difficultyHead}>
            <h2 className={layout.h2} id={difficultyLabelId}>
              Difficulty
            </h2>
            <span className={layout.muted}>Changes how often and how hard opponents push.</span>
          </div>
          <DifficultyControl
            value={difficulty}
            onChange={(d) => {
              pulseHaptic();
              setIntentDifficulty(d);
            }}
            meta={DIFFICULTY_META}
            labelledBy={difficultyLabelId}
          />
        </section>

        <div className={layout.actionBar}>
          <div className={styles.summary} aria-live="polite">
            <span className={styles.summaryTitle}>{summary}</span>
            <span className={styles.summarySub}>{selected.map((id) => OPPONENTS[id]?.name).filter(Boolean).join(', ')}</span>
          </div>
          <Button variant="primary" size="lg" onClick={() => confirmSetup()} disabled={selected.length === 0} data-testid="opponents-confirm">
            {ctaLabel}
          </Button>
        </div>
      </div>
    </ScreenShell>
  );
}
