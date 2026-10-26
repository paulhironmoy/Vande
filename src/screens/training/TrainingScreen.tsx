import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../engineRules';
import type { ExecutionGrade, InputTrace, MatchEventLog, PlayerRef } from '@/contracts';
import { engine } from '@/engine';
import { buildTrainingLog, trainingCoachRef, trainingPlan, trainingSetup, type TrainingStarter } from '@/engine/training';
import { useT, type MessageKey } from '@/i18n';
import { useApp } from '@/app/store';
import { Button, CardButton, Chip, ExecutionMeter, Icon, StateView, KITS } from '@/ui';
import { BattingScreen } from '../batting/BattingScreen';
import { RevealScreen } from '../reveal/RevealScreen';
import { outcomeText } from '../reveal/text';
import { localInnings } from '../local/localInnings';
import { cutTrainingReplay } from './cut';
import s from './TrainingScreen.module.css';

export interface TrainingScreenProps {
  player: PlayerRef;
  onDone: (next: 'duel' | 'daily' | null) => void;
  onSkip?: () => void;
  /** Analytics hooks (tutorial_started / tutorial_completed). */
  onStarted?: () => void;
  onCompleted?: () => void;
  /** Called when the step changes (the route marks bat and bowl as "in play"). */
  onStep?: (step: 'bat' | 'bowl' | 'reveal' | 'done') => void;
  /** Called once with the first ball's sealed feedback (analytics: first_delivery). */
  onFirstDelivery?: () => void;
  /** Extra content on the final step (e.g. the one-time analytics question). */
  doneExtra?: ReactNode;
  /** The one way on when Training was a detour (an invited friend's practice before their match). */
  continueTo?: { label: string; onContinue: () => void };
}

const BOWL_CHOICES: TrainingStarter[] = ['yorker', 'good_length', 'bouncer', 'offspin'];

type Step = 'bat' | 'bowl' | 'reveal' | 'done';

/** Hour-resolution stamp (logs never carry exact times). */
const hourNow = () => `${new Date().toISOString().slice(0, 13)}:00Z`;

/**
 * Under a minute: bat a ball, bowl a ball with the release meter, then watch the payoff in a reveal. The tutorial over
 * and the log come from the engine (src/engine/training.ts): legal overs, real commits and a log verifyMatchLog accepts.
 */
export function TrainingScreen({ player, onDone, onSkip, onStarted, onCompleted, onStep, onFirstDelivery, doneExtra, continueTo }: TrainingScreenProps) {
  const tr = useT();
  const { t } = tr;
  const [step, setStep] = useState<Step>('bat');
  const [variant, setVariant] = useState<TrainingStarter>('yorker');
  const [bowl, setBowl] = useState<{ trace: InputTrace; grade: ExecutionGrade | null } | null>(null);
  const [error, setError] = useState(false);
  // Large text: the bowl step keeps the choice, the meter and "Watch the reveal" on one screen (names only on the
  // cards with the chosen delivery's hint below them, a smaller meter, and the button pinned to the bottom).
  const roomy = useApp((st) => st.settings.textScale) < 1.3;
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    onStarted?.();
  }
  const setup = useMemo(() => {
    try {
      return trainingSetup();
    } catch {
      return null;
    }
  }, []);
  const coach: PlayerRef = useMemo(() => trainingCoachRef(t('training.coach'), KITS[2]), [t]);
  const innings = useMemo(() => (setup ? localInnings({ plan: setup.coachOver, conditions: setup.conditions, seed: setup.seed, maxBalls: 1 }) : null), [setup]);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  useEffect(() => {
    stepRef.current?.(step);
  }, [step]);

  const [log, setLog] = useState<MatchEventLog | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    if (!log) return;
    let alive = true;
    // The tutorial's reveal shows the same "sealed and verified" proof as a real match.
    engine
      .verifyMatchLog(log)
      .then((v) => alive && setVerified(v.ok))
      .catch(() => alive && setVerified(false));
    return () => {
      alive = false;
    };
  }, [log]);
  useEffect(() => {
    if ((step !== 'reveal' && step !== 'done') || log || !bowl || !setup || !innings) return;
    let alive = true;
    try {
      const plan = trainingPlan(setup.lesson.choices[variant], bowl.trace, setup.seed);
      buildTrainingLog({ setup, player, coach, plan, inputs: innings.inputs(), finish: 'auto', hour: hourNow() }).then(
        (l) => {
          if (!alive) return;
          cutTrainingReplay(l);
          setLog(l);
        },
        () => alive && setError(true),
      );
    } catch {
      setError(true);
    }
    return () => {
      alive = false;
    };
  }, [step, log, bowl, setup, innings, variant, player, coach]);

  if (!setup || !innings || error) {
    return (
      <div className={s.center}>
        <StateView kind="error" onAction={onSkip ? () => onSkip() : undefined} actionLabel={t('training.skip')} />
      </div>
    );
  }

  const progress = (
    <ol className={s.progress} aria-label={t('training.title')}>
      {(['bat', 'bowl', 'reveal'] as const).map((k, i) => (
        <li key={k} data-state={step === k ? 'current' : (['bat', 'bowl', 'reveal', 'done'].indexOf(step) > i ? 'done' : 'todo')}>
          <span className={s.dot}>{['bat', 'bowl', 'reveal', 'done'].indexOf(step) > i ? <Icon name="check" size={14} /> : i + 1}</span>
          <span className={s.stepLabel}>{t(`training.${k}.title` as MessageKey)}</span>
        </li>
      ))}
    </ol>
  );

  if (step === 'bat') {
    return (
      <div className={s.screen}>
        <BattingScreen
          compact
          banner={
            <div className={s.banner}>
              {progress}
              <p className={s.lede}>{t('training.bat.body')}</p>
            </div>
          }
          setup={{ conditions: setup!.conditions, field: setup!.coachOver.field, batter: player, bowler: coach }}
          nextBall={innings.nextBall}
          submitShot={innings.submitShot}
          totalBalls={1}
          title={t('training.title')}
          onBallFeedback={() => {
            onFirstDelivery?.();
            setTimeout(() => setStep('bowl'), 1500);
          }}
          onComplete={() => setStep('bowl')}
          onExit={onSkip}
        />
      </div>
    );
  }

  if (step === 'bowl') {
    return (
      <main className={s.screen}>
        <div className={s.top}>
          {progress}
          <h1 className={s.h1}>{t('training.bowl.title')}</h1>
          <p className={s.lede}>{t('training.bowl.body')}</p>
        </div>
        <div className={s.bowl}>
          <div className={s.variants} role="radiogroup" aria-label={t('plan.delivery')} data-compact={!roomy || undefined}>
            {BOWL_CHOICES.map((v) => (
              <CardButton key={v} padding={roomy ? 3 : 2} role="radio" aria-checked={variant === v} onClick={() => setVariant(v)} data-testid={`training-variant-${v}`}>
                <span className={s.vName}>{t(`variant.${v}` as MessageKey)}</span>
                {roomy && <span className={s.vHint}>{t(`variant_hint.${v}` as MessageKey)}</span>}
              </CardButton>
            ))}
          </div>
          {!roomy && <p className={s.vHintOne}>{t(`variant_hint.${variant}` as MessageKey)}</p>}
          <ExecutionMeter size={roomy ? 210 : 164} hint={t('training.bowl.gesture_hint')} result={bowl?.grade ? { grade: bowl.grade } : null} onComplete={(trace, preview) => setBowl({ trace, grade: preview?.grade ?? null })} />
          {bowl && (
            <div className={s.result} role="status">
              <Chip tone={bowl.grade === 'perfect' ? 'amber' : bowl.grade === 'good' ? 'cyan' : 'neutral'} icon={bowl.grade === 'perfect' || bowl.grade === 'good' || !bowl.grade ? 'check' : 'alert'} size="lg">
                {bowl.grade ? t(`execution.${bowl.grade}` as MessageKey) : t('plan.gesture_done')}
              </Chip>
              <p className={s.small}>{t('training.bowl.result', { grade: bowl.grade ? t(`execution.${bowl.grade}` as MessageKey) : '' })}</p>
            </div>
          )}
        </div>
        {bowl && (
          // Pinned to the bottom, so it is on screen the moment the release is done, whatever the text size.
          <div className={s.bowlCta}>
            <Button variant="accent" size="lg" block iconEnd="forward" onClick={() => setStep('reveal')} data-testid="training-to-reveal">
              {t('training.reveal.cta')}
            </Button>
          </div>
        )}
      </main>
    );
  }

  if (step === 'reveal' && log) {
    return (
      <div className={s.screen}>
        <RevealScreen
          log={log}
          me={0}
          verified={verified}
          onClose={() => {
            onCompleted?.();
            setStep('done');
          }}
        />
        <div className={s.revealCta}>
          <Button
            variant="accent"
            size="lg"
            block
            data-testid="training-continue"
            onClick={() => {
              onCompleted?.();
              setStep('done');
            }}
          >
            {t('common.continue')}
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'reveal')
    return (
      <main className={s.center}>
        <StateView kind="reveal_ready" title={t('training.reveal.title')} body={t('match.reveal_loading')} />
      </main>
    );

  return (
    <main className={s.center} data-testid="training-done">
      <div className={s.done}>
        <span className={s.badge} aria-hidden="true">
          <Icon name="trophy" size={34} />
        </span>
        <h1 className={s.h1}>{t('training.done.title')}</h1>
        <p className={s.lede}>{t('training.done.body')}</p>
        {log && (
          <ul className={s.recap} data-testid="training-recap">
            {log.innings[0].balls[0] && (
              <li>
                <Icon name="bat" size={18} />
                <span>{t('training.done.you_batted', { result: outcomeText(log.innings[0].balls[0], tr) })}</span>
              </li>
            )}
            {log.innings[1].balls[0] && (
              <li>
                <Icon name="ball" size={18} />
                <span>{t('training.done.you_bowled', { variant: t(`variant.${variant}` as MessageKey), name: coach.alias, result: outcomeText(log.innings[1].balls[0], tr) })}</span>
              </li>
            )}
            {verified && (
              <li>
                <Icon name="seal" size={18} />
                <span>{t('reveal.commit_verified')}</span>
              </li>
            )}
          </ul>
        )}
        {continueTo ? (
          <Button variant="accent" size="xl" block iconEnd="forward" onClick={continueTo.onContinue} data-testid="training-continue-match">
            {continueTo.label}
          </Button>
        ) : (
          <>
            <Button variant="accent" size="xl" block icon="users" onClick={() => onDone('duel')} data-testid="training-duel">
              {t('training.done.duel')}
            </Button>
            <Button variant="primary" size="lg" block icon="calendar" onClick={() => onDone('daily')} data-testid="training-daily">
              {t('training.done.daily')}
            </Button>
          </>
        )}
        <Button variant="ghost" block icon="home" onClick={() => onDone(null)} data-testid="training-home">
          {t('training.done.home')}
        </Button>
        {doneExtra}
      </div>
    </main>
  );
}
