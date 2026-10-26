import { useMemo, useRef, useState } from 'react';
import { localPlayerRef } from '@/app/storeTypes';
import { useRouter, type RouteOf } from '@/app/router';
import { readAnalyticsConfig } from '@/analytics';
import { TrainingScreen } from './TrainingScreen';
import { ConsentPrompt } from '../common/ConsentPrompt';
import { peekAfterTraining, setAfterTraining, useInPlay, useNet, usePlayerGate } from '../app/hooks';
import { useT } from '@/i18n';
import { markFirstDelivery, markTrained } from './progress';

/** Training as a route: offline, under a minute, then on to a Friend Duel or the Daily Six. */
export default function TrainingRoute({ route }: { route: RouteOf<'training'> }) {
  const player = usePlayerGate(route);
  const navigate = useRouter((s) => s.navigate);
  const { services } = useNet();
  const analytics = services?.analytics ?? null;
  const [step, setStep] = useState<'bat' | 'bowl' | 'reveal' | 'done'>('bat');
  const tracked = useRef({ started: false, completed: false });
  const configured = useMemo(() => {
    const c = readAnalyticsConfig();
    return c.provider !== 'none' && !c.killed;
  }, []);
  useInPlay(step === 'bat' || step === 'bowl');
  const me = useMemo(() => (player ? localPlayerRef(player) : null), [player]);
  const { t } = useT();
  // Training as a detour (an invited friend practising first): it leads back to where they came from.
  const after = useMemo(() => peekAfterTraining(), []);
  const goAfter = () => {
    setAfterTraining(null);
    if (after) navigate(after, { replace: true });
  };
  if (!player || !me) return null;
  return (
    <TrainingScreen
      player={me}
      onStep={setStep}
      onStarted={() => {
        if (tracked.current.started) return;
        tracked.current.started = true;
        analytics?.track('tutorial_started', { mode: 'training' });
      }}
      onCompleted={() => {
        if (tracked.current.completed) return;
        tracked.current.completed = true;
        markTrained();
        analytics?.track('tutorial_completed', { mode: 'training' });
      }}
      onFirstDelivery={() => {
        if (markFirstDelivery()) analytics?.track('first_delivery', { mode: 'training' });
      }}
      onSkip={() => (after ? goAfter() : navigate({ name: 'home' }, { replace: true }))}
      continueTo={after ? { label: t('training.done.back_to_match'), onContinue: goAfter } : undefined}
      onDone={(next) => navigate(next === 'duel' ? { name: 'duel_new' } : next === 'daily' ? { name: 'daily' } : { name: 'home' }, { replace: true })}
      doneExtra={analytics ? <ConsentPrompt analytics={analytics} configured={configured} /> : null}
    />
  );
}
