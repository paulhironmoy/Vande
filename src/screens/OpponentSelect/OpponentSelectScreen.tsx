import { useEffect, useId } from 'react';
import type { OpponentId } from '@/engine/types';
import { OPPONENT_IDS } from '@/engine/types';
import { DEFAULT_OPPONENTS, DIFFICULTY_META, OPPONENTS } from '@/engine';
import { SIMPLE_DIFFICULTY, SIMPLE_OPPONENTS, useSimple } from '@/app/simple';
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
  const simple = useSimple();

  useEffect(() => {
    if (!intent) useApp.getState().beginCampaignSetup();
  }, [intent]);

  const selected: OpponentId[] = intent?.opponents?.length ? intent.opponents : DEFAULT_OPPONENTS;
  const difficulty = intent?.difficulty ?? 'standard';
  const diffMeta = simple ? SIMPLE_DIFFICULTY[difficulty] : DIFFICULTY_META[difficulty];
  const SIMPLE_LEVEL: Record<'Low' | 'Medium' | 'High', string> = { Low: 'Easy', Medium: 'Medium', High: 'Hard' };

  const toggle = (id: OpponentId) => {
    pulseHaptic();
    if (selected.includes(id)) {
      if (selected.length === 1) {
        toast({ text: simple ? 'Keep at least one trouble maker.' : 'Keep at least one opponent in play.', kind: 'info', duration: 2400 });
        return;
      }
      setIntentOpponents(selected.filter((o) => o !== id));
    } else {
      setIntentOpponents(OPPONENT_IDS.filter((o) => o === id || selected.includes(o)));
    }
  };

  const ctaLabel = simple
    ? intent?.kind === 'daily'
      ? "Play today's challenge"
      : intent?.kind === 'challenge'
        ? 'Start the challenge'
        : 'Start chapter 1'
    : intent?.kind === 'daily'
      ? "Begin today's crisis"
      : intent?.kind === 'challenge'
        ? 'Begin challenge'
        : 'Begin chapter 1';
  const noun = simple ? (selected.length === 1 ? 'trouble maker' : 'trouble makers') : selected.length === 1 ? 'opponent' : 'opponents';
  const summary = `${selected.length} ${noun} · ${diffMeta?.label ?? (simple ? 'Normal' : 'Standard')}`;

  return (
    <ScreenShell title={simple ? 'Trouble makers' : 'Choose your opponents'} onBack={() => back()} testId="opponents-screen">
      <div className={layout.page}>
        <header className={styles.intro}>
          <h1 className={layout.h1}>{simple ? 'Who is making trouble?' : 'Who is working against the Republic?'}</h1>
          <p className={layout.lead}>
            {simple
              ? 'These are habits, not real people. They watch how you play. Pick 1 to 5.'
              : 'Each opponent is a behaviour, not a group of people. They watch how you play and adapt. Pick between one and five.'}
          </p>
          <p className={styles.hint}>
            <span className={styles.hintDot} aria-hidden="true" />
            {simple ? 'Good first game: two trouble makers on Normal.' : 'Recommended for a first game: two opponents at standard difficulty.'}
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
                difficultyLabel={
                  simple
                    ? SIMPLE_LEVEL[(DIFFICULTY_SHIFT[difficulty]?.[meta.baseDifficulty] ?? meta.baseDifficulty) as 'Low' | 'Medium' | 'High']
                    : (DIFFICULTY_SHIFT[difficulty]?.[meta.baseDifficulty] ?? meta.baseDifficulty)
                }
                simple={simple}
              />
            );
          })}
        </section>

        <section className={layout.card} aria-labelledby={difficultyLabelId}>
          <div className={styles.difficultyHead}>
            <h2 className={layout.h2} id={difficultyLabelId}>
              {simple ? 'How hard?' : 'Difficulty'}
            </h2>
            <span className={layout.muted}>{simple ? 'How often they cause trouble.' : 'Changes how often and how hard opponents push.'}</span>
          </div>
          <DifficultyControl
            value={difficulty}
            onChange={(d) => {
              pulseHaptic();
              setIntentDifficulty(d);
            }}
            meta={simple ? SIMPLE_DIFFICULTY : DIFFICULTY_META}
            labelledBy={difficultyLabelId}
          />
        </section>

        <div className={layout.actionBar}>
          <div className={styles.summary} aria-live="polite">
            <span className={styles.summaryTitle}>{summary}</span>
            <span className={styles.summarySub}>{selected.map((id) => (simple ? SIMPLE_OPPONENTS[id]?.nickname : OPPONENTS[id]?.name)).filter(Boolean).join(', ')}</span>
          </div>
          <Button variant="primary" size="lg" onClick={() => confirmSetup()} disabled={selected.length === 0} data-testid="opponents-confirm">
            {ctaLabel}
          </Button>
        </div>
      </div>
    </ScreenShell>
  );
}
