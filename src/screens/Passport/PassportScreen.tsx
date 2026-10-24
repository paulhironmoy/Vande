import { useEffect } from 'react';
import { useApp } from '@/app/store';
import { useSimple } from '@/app/simple';
import { track } from '@/analytics';
import { ScreenShell } from '@/components/ui';
import { PassportCard } from '@/components/progression/PassportCard';
import { ACCOMPLISHMENTS } from '@/progression/accomplishments';
import s from './PassportScreen.module.css';

/** Civic Passport: how you play, not how often. */
export function PassportScreen() {
  const passport = useApp((st) => st.passport);
  const back = useApp((st) => st.back);
  const simple = useSimple();
  const earned = new Map(passport.earned.map((e) => [e.id, e]));

  useEffect(() => {
    track('passport_viewed', { mode: simple ? 'simple' : 'full' });
  }, [simple]);

  return (
    <ScreenShell title={simple ? 'Your stamps' : 'Civic Passport'} onBack={() => back()} narrow testId="passport-screen">
      <p className={s.summary} data-testid="passport-summary">
        {earned.size === 0 ? (simple ? 'No stamps yet. Play to earn them.' : 'Nothing earned yet. Each stamp describes how you played.') : `${earned.size} of ${ACCOMPLISHMENTS.length} ${simple ? 'stamps' : 'earned'}`}
      </p>
      <ul className={s.list}>
        {ACCOMPLISHMENTS.map((def) => (
          <PassportCard key={def.id} def={def} earned={earned.get(def.id)} simple={simple} />
        ))}
      </ul>
    </ScreenShell>
  );
}
