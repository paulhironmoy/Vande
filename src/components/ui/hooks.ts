import { useEffect, useState } from 'react';
import { useApp } from '@/app/store';

/** Effective reduced-motion flag (settings resolved against the system preference). */
export function useReducedMotion(): boolean {
  return useApp((s) => s.reducedMotion);
}

/** True when the viewport matches `(min-width: <px>px)`. */
export function useMediaQuery(query: string): boolean {
  const q = query.startsWith('(') ? query : `(min-width: ${query})`;
  const get = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(q);
    } catch {
      return;
    }
    const onChange = () => setMatches(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else (mq as unknown as { addListener: (cb: () => void) => void }).addListener?.(onChange);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else (mq as unknown as { removeListener: (cb: () => void) => void }).removeListener?.(onChange);
    };
  }, [q]);
  return matches;
}

export const DESKTOP_QUERY = '(min-width: 1024px)';
export const TABLET_QUERY = '(min-width: 768px)';

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/** Returns a stable, unique id with a prefix (SSR-safe enough for this client-only app). */
let idCounter = 0;
export function useStableId(prefix: string): string {
  const [id] = useState(() => `${prefix}-${++idCounter}`);
  return id;
}
