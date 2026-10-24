/**
 * Applies accessibility & display settings to the document root and keeps the store's
 * `reducedMotion` in sync with the system preference.
 */
import { useEffect } from 'react';
import type { Settings } from '@/engine/types';
import { useApp } from './store';
import { setSoundEnabled } from '@/audio/sounds';
import { setHapticsEnabled } from '@/audio/haptics';

import { REDUCED_QUERY, resolveReducedMotion, systemPrefersReducedMotion } from './motion';

export { resolveReducedMotion, systemPrefersReducedMotion };

/** Writes data attributes & root font size. Returns the effective reduced-motion flag. */
export function applySettingsToDocument(settings: Settings, systemReduced = systemPrefersReducedMotion()): boolean {
  if (typeof document === 'undefined') return false;
  const html = document.documentElement;
  const reduced = resolveReducedMotion(settings, systemReduced);
  html.setAttribute('data-motion', reduced ? 'reduced' : 'full');
  html.setAttribute('data-contrast', settings.highContrast ? 'high' : 'normal');
  if (settings.colourBlindSafe) html.setAttribute('data-cb', '1');
  else html.removeAttribute('data-cb');
  html.setAttribute('data-text-scale', String(settings.textScale));
  // Percentages scale the user's own browser default (often 16px) instead of overriding it.
  html.setAttribute('data-style', settings.playStyle);
  // Simple style reads a touch larger by default; explicit text-size choices scale on top of it.
  const styleBoost = settings.playStyle === 'simple' ? 1.0625 : 1;
  const scale = settings.textScale * styleBoost;
  html.style.fontSize = scale === 1 ? '' : `${Math.round(scale * 100)}%`;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = settings.highContrast ? '#050b14' : '#07111F';
  setSoundEnabled(settings.sound);
  setHapticsEnabled(settings.haptics);
  return reduced;
}

/** React hook: apply settings whenever they change and track the OS reduced-motion preference. */
export function useSettingsEffects(): void {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    const reduced = applySettingsToDocument(settings);
    if (useApp.getState().reducedMotion !== reduced) useApp.setState({ reducedMotion: reduced });
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(REDUCED_QUERY);
    } catch {
      return;
    }
    const onChange = () => {
      const current = useApp.getState().settings;
      const reduced = applySettingsToDocument(current, mq.matches);
      if (useApp.getState().reducedMotion !== reduced) useApp.setState({ reducedMotion: reduced });
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof (mq as { addListener?: (cb: () => void) => void }).addListener === 'function')
      (mq as unknown as { addListener: (cb: () => void) => void }).addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else if (typeof (mq as { removeListener?: (cb: () => void) => void }).removeListener === 'function')
        (mq as unknown as { removeListener: (cb: () => void) => void }).removeListener(onChange);
    };
  }, []);
}
