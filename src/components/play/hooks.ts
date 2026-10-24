import { useEffect, useRef, useState } from 'react';
import type { Scores } from '@/engine/types';
import { DIMENSIONS } from '@/engine/types';

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);
  return matches;
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

/** Smoothly interpolates score changes over `duration` ms (skipped when motion is reduced). */
export function useSmoothedScores(target: Scores, enabled: boolean, duration = 320): Scores {
  const [shown, setShown] = useState<Scores>(target);
  const shownRef = useRef<Scores>(target);
  const fromRef = useRef<Scores>(target);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame !== 'function') {
      fromRef.current = target;
      shownRef.current = target;
      setShown(target);
      return;
    }
    const from = fromRef.current;
    const same = DIMENSIONS.every((d) => Math.abs(from[d] - target[d]) < 0.01);
    if (same) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const next = { ...from };
      for (const d of DIMENSIONS) next[d] = from[d] + (target[d] - from[d]) * e;
      shownRef.current = next;
      setShown(next);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      fromRef.current = shownRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.freedom, target.grievance, target.safety, target.evidence, target.trust, target.economy, enabled]);
  return enabled ? shown : target;
}

/** Returns the previous value of a prop (undefined on first render). */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}
