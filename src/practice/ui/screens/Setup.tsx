/**
 * PREPARE (constitution §1: understand and confirm the session). The over's conditions, bowler, field and objective
 * in one screen, with the field map to inspect; a Random Over's difficulty, pitch and bowling type; how to bat. One
 * primary action: Play. A static, registered stadium shell holds the match context before Unity mounts; a device
 * that is better in the Classic view is told so here, in product words, with Play still the one action.
 */
import type { AssistLevel, BowlerFamily, Difficulty, PitchCondition } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import type { BowlingChoice } from '@/practice/store';
import { PButton, PDisclosure, PSegmented, Screen, sys } from '../design';
import { FieldMap } from '../components/FieldMap';
import { SessionBrief } from '../components/SessionBrief';
import type { FlowNotice, PendingOver, RandomChoice } from '../flow/state';
import { PremiumShellBackdrop } from './PremiumShellBackdrop';
import s from './Setup.module.css';

export interface SetupProps {
  pending: PendingOver;
  notice: FlowNotice;
  onRandom: (c: RandomChoice) => void;
  onAssist: (a: AssistLevel) => void;
  onPlay: () => void;
  onBack: () => void;
  /** The first session with teaching on: the cricket-words glossary opens by itself. */
  firstSession: boolean;
  /** Footwork follows where the press lands (players who skipped the teaching): say how. */
  pressFootwork?: boolean;
}

/** A keyboard is likely (a fine pointer that can hover): the keys are worth a line. */
function keyboardLikely(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

const PITCHES: readonly PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'club', 'expert'];
const BOWLING: readonly BowlingChoice[] = ['any', 'pace', 'spin'];

export function Setup({
  pending: p,
  notice,
  onRandom,
  onAssist,
  onPlay,
  onBack,
  firstSession,
  pressFootwork,
}: SetupProps) {
  const t = usePracticeT();
  const kindTitle = t.tk(`practice.setup.kind.${p.kind}`);
  const editable = !p.continuing && p.bowled === 0;
  const random =
    p.kind === 'random' && editable
      ? (p.random ?? { difficulty: 'club', conditions: 'balanced', bowling: 'any' })
      : null;
  const fallback =
    notice === 'classic'
      ? t.t('practice.notice.classic')
      : notice === 'resumed_leave'
        ? t.t('practice.notice.resumed_leave')
        : null;
  return (
    <div className={s.overlay} data-testid="practice-setup" data-kind={p.kind}>
      <PremiumShellBackdrop variant="setup" />
      <Screen
        className={s.screen}
        title={t.t('practice.setup.title', { n: p.overNumber, kind: kindTitle })}
        onBack={onBack}
        wide
        footer={
          <>
            {p.bowled > 0 && <p className={sys.caption}>{t.t('practice.setup.resume_ball', { n: p.bowled + 1 })}</p>}
            <PButton variant="primary" size="lg" block icon="play" onClick={onPlay} data-testid="practice-play-start">
              {t.t('practice.setup.play')}
            </PButton>
          </>
        }
      >
        {fallback && (
          <p className={s.notice} role="status" data-testid="practice-panel-notice">
            {fallback}
          </p>
        )}
        <div className={s.preparationDeck}>
          <div className={s.grid}>
            {/* The positions' names come with the complete setup: a first session sees the field as a picture. */}
            <section className={s.fieldPanel} aria-labelledby="practice-setup-field-title">
              <h2 id="practice-setup-field-title" className={sys.section}>
                {t.t('practice.setup.field')}
              </h2>
              <FieldMap field={p.field} intent={p.intent} handedness={p.handedness} labels={!firstSession} />
            </section>
            <div className={s.side}>
              <div className={s.briefPanel}>
                <SessionBrief
                  kind={p.kind}
                  plan={p.plan}
                  field={p.field}
                  intent={p.intent}
                  conditions={p.conditions}
                  assist={p.assist}
                  handedness={p.handedness}
                  difficulty={p.random?.difficulty ?? null}
                  onAssist={editable ? onAssist : undefined}
                  glossary={firstSession}
                  simple={firstSession}
                />
              </div>
              {random && (
                <PDisclosure
                  className={s.adjustments}
                  label={t.t('practice.setup.change', {
                    difficulty: t.tk(`practice.difficulty.${random.difficulty}`),
                    pitch: t.tk(`practice.pitch.${random.conditions}`),
                    bowling: t.tk(`practice.bowling.${random.bowling}`),
                  })}
                  testId="practice-random-choices"
                >
                  <section className={s.choices} aria-label={t.t('practice.setup.random_choices')}>
                    <PSegmented
                      label={t.t('practice.setup.difficulty')}
                      value={random.difficulty}
                      onChange={(v: Difficulty) => onRandom({ ...random, difficulty: v })}
                      options={DIFFICULTIES.map((v) => ({
                        value: v,
                        label: t.tk(`practice.difficulty.${v}`),
                        description: t.tk(`practice.difficulty.${v}_hint`),
                      }))}
                      testId="practice-random-difficulty"
                    />
                    <PSegmented
                      label={t.t('practice.setup.pitch')}
                      value={random.conditions}
                      onChange={(v: PitchCondition) => onRandom({ ...random, conditions: v })}
                      options={PITCHES.map((v) => ({ value: v, label: t.tk(`practice.pitch.${v}`) }))}
                      testId="practice-random-pitch"
                    />
                    <PSegmented
                      label={t.t('practice.setup.bowling')}
                      value={random.bowling}
                      onChange={(v: BowlerFamily | 'any') => onRandom({ ...random, bowling: v })}
                      options={BOWLING.map((v) => ({ value: v, label: t.tk(`practice.bowling.${v}`) }))}
                      testId="practice-random-bowling"
                    />
                  </section>
                </PDisclosure>
              )}
              <div className={s.controlBrief}>
                <p className={s.how} data-testid="practice-how">
                  {t.t('practice.setup.how')}
                </p>
                {pressFootwork && (
                  <p className={sys.caption} data-testid="practice-how-more">
                    {t.t('practice.setup.how_more')}
                  </p>
                )}
                {keyboardLikely() && (
                  <p className={sys.caption} data-testid="practice-how-keys">
                    {t.t('practice.setup.how_keys')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </Screen>
    </div>
  );
}
