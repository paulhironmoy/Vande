import { useMemo, useState } from 'react';
import type { ScenarioId } from '@/engine/types';
import { DIFFICULTY_META, decodeChallenge, getScenario, listScenarios } from '@/engine';
import { Button, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { ScoreDisplay } from '@/components/results/ScoreDisplay';
import { StatusIcon } from '@/components/results/icons';
import { challengeCodeFromUrl } from '@/share/resultCard';
import { OpponentChip } from '@/components/opponents/OpponentChip';
import styles from './ChallengeScreen.module.css';

function scenarioTitle(id: ScenarioId): string {
  try {
    const s = getScenario(id);
    return `${s.title} · Chapter ${s.chapter}`;
  } catch {
    return id;
  }
}

export function ChallengeScreen() {
  const screen = useApp((s) => s.screen);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const beginChallenge = useApp((s) => s.beginChallenge);
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const toast = useApp((s) => s.toast);

  const code = (screen.name === 'challenge' ? screen.code : '').trim();
  const spec = useMemo(() => (code ? decodeChallenge(code) : null), [code]);
  const [manual, setManual] = useState('');

  const openManual = () => {
    const raw = manual.trim();
    const parsed = challengeCodeFromUrl(raw) ?? raw;
    if (!parsed) return;
    navigate({ name: 'challenge', code: parsed }, { replace: true });
  };

  const accept = () => {
    const ok = beginChallenge(code);
    if (!ok) toast({ text: 'This challenge code could not be opened.', kind: 'warning', duration: 3000 });
  };

  const scenarios = spec ? (spec.scenario === 'campaign' ? listScenarios().map((s) => s.id) : [spec.scenario]) : [];

  return (
    <ScreenShell title="Friend challenge" onBack={() => (back() ? undefined : navigate({ name: 'home' }, { replace: true }))} testId="challenge-screen">
      <div className={`${layout.page} ${layout.narrow}`}>
        {spec ? (
          <>
            <header className={layout.stack}>
              <p className={layout.kicker}>You have been challenged</p>
              <h1 className={layout.h1}>{spec.scenario === 'campaign' ? 'The complete campaign' : scenarioTitle(spec.scenario).split(' · ')[0]}</h1>
              <p className={layout.lead}>Same seed, same opponents, same events. The only difference is what you decide.</p>
            </header>

            <section className={layout.card} aria-labelledby="ch-beat">
              <h2 className={layout.sectionTitle} id="ch-beat">
                {spec.score !== undefined ? 'Score to beat' : 'Fresh challenge'}
              </h2>
              {spec.score !== undefined ? (
                <div className={styles.beat}>
                  <ScoreDisplay score={spec.score} label="Challenger" size="7.5rem" animated={!reducedMotion} />
                  <div className={styles.beatText}>
                    <strong>Score to beat: {Math.round(spec.score)}</strong>
                    <p className={layout.body}>Finish with a higher Republic score to answer the challenge.</p>
                  </div>
                </div>
              ) : (
                <p className={layout.body}>No score attached — set the mark for your friends.</p>
              )}
            </section>

            <section className={layout.card} aria-labelledby="ch-details">
              <h2 className={layout.sectionTitle} id="ch-details">
                What you will face
              </h2>
              <div className={styles.summary}>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>{scenarios.length > 1 ? 'Chapters' : 'Scenario'}</span>
                  <span>
                    {scenarios.map((id) => (
                      <span key={id} style={{ display: 'block' }}>
                        {scenarioTitle(id)}
                      </span>
                    ))}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Difficulty</span>
                  <span>
                    {DIFFICULTY_META[spec.difficulty]?.label ?? spec.difficulty}
                    {DIFFICULTY_META[spec.difficulty]?.description ? ` — ${DIFFICULTY_META[spec.difficulty].description}` : ''}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Opponents</span>
                  <span className={layout.chips}>
                    {spec.opponents.map((id) => (
                      <OpponentChip key={id} id={id} animated={!reducedMotion} />
                    ))}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Code</span>
                  <span className={styles.codeValue}>{code}</span>
                </div>
              </div>
              <p className={styles.note} style={{ marginTop: 'var(--s-4)' }}>
                <StatusIcon kind="info" size={16} />
                Same seed, same opponents, same events
              </p>
            </section>

            <div className={layout.actionBar}>
              <Button variant="ghost" size="lg" onClick={() => navigate({ name: 'home' }, { replace: true })}>
                Not now
              </Button>
              <Button variant="primary" size="lg" onClick={accept} data-testid="challenge-accept">
                Accept challenge
              </Button>
            </div>
          </>
        ) : (
          <>
            <header className={layout.stack}>
              <h1 className={layout.h1}>Open a friend challenge</h1>
              <p className={layout.lead}>Paste a challenge link or code. It recreates the exact same crisis on this device — no account needed.</p>
            </header>
            {code && (
              <section className={`${layout.card} ${styles.error}`} role="alert">
                <h2 className={styles.errorTitle}>
                  <StatusIcon kind="harmed" size={20} />
                  This challenge code is not valid
                </h2>
                <p className={layout.body}>
                  The code <strong>{code}</strong> could not be read. Check for missing characters, or ask your friend to share the link again.
                </p>
                <div>
                  <Button variant="secondary" onClick={() => navigate({ name: 'home' }, { replace: true })}>
                    Go home
                  </Button>
                </div>
              </section>
            )}
          </>
        )}

        <section className={layout.card} aria-labelledby="ch-manual">
          <h2 className={layout.sectionTitle} id="ch-manual">
            Enter a code
          </h2>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              openManual();
            }}
          >
            <label className={styles.field}>
              <span className={styles.label}>Challenge code or link</span>
              <input
                className={styles.input}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Paste a code or link"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                data-testid="challenge-input"
              />
            </label>
            <Button variant="secondary" size="lg" type="submit" disabled={!manual.trim()} data-testid="challenge-open">
              Open
            </Button>
          </form>
        </section>
      </div>
    </ScreenShell>
  );
}
