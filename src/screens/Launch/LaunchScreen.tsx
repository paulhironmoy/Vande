import { useEffect } from 'react';
import { useApp } from '@/app/store';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui';
import s from './LaunchScreen.module.css';

const AUTO_CONTINUE_MS = 1100;

/** Animated mark, title and tagline; continues automatically in under 1.2 s (immediately with reduced motion). */
export function LaunchScreen() {
  const hydrated = useApp((st) => st.hydrated);
  const firstRun = useApp((st) => st.firstRun);
  const reduced = useApp((st) => st.reducedMotion);
  const navigate = useApp((st) => st.navigate);

  useEffect(() => {
    if (!hydrated) return;
    const go = () => {
      if (useApp.getState().screen.name !== 'launch') return;
      navigate({ name: useApp.getState().firstRun ? 'intro' : 'home' }, { replace: true });
    };
    if (reduced) {
      go();
      return;
    }
    const t = window.setTimeout(go, AUTO_CONTINUE_MS);
    return () => window.clearTimeout(t);
  }, [hydrated, firstRun, reduced, navigate]);

  return (
    <div className={s.launch} data-testid="launch-screen">
      <div className={s.glow} aria-hidden="true" />
      <div className={s.mark} data-testid="logo">
        <Logo size={128} animated={!reduced} title="VANDE mark" />
      </div>
      <h1 className={s.title}>VANDE</h1>
      <p className={s.sub}>Republic Under Pressure</p>
      <div className={s.line} aria-hidden="true" />
      <p className={s.tag}>Every choice changes India.</p>
      <p className={s.dev} lang="hi" aria-label="Vande, in Devanagari script">
        वन्दे
      </p>
      {hydrated && !reduced && (
        <div className={s.skip}>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: firstRun ? 'intro' : 'home' }, { replace: true })}>
            Skip
          </Button>
        </div>
      )}
      <p className={s.foot}>An independent civic-strategy game. Not affiliated with any government or party.</p>
    </div>
  );
}
