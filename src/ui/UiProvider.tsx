import { useEffect, type ReactNode } from 'react';
import { useApp } from '@/app/store';
import { I18nProvider } from '@/i18n';
import { ToastHost } from './ToastHost';
import { syncAudioSettings } from '@/audio';

/**
 * Applies the root store's presentation settings to the document (reduced motion, high contrast, text size),
 * provides translations, keeps audio/haptics in sync with the settings and renders the toast host.
 * The root app wraps its routes in this once.
 */
export function UiProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useApp((s) => s.reducedMotion);
  const highContrast = useApp((s) => s.settings.highContrast);
  const textScale = useApp((s) => s.settings.textScale);
  const sound = useApp((s) => s.settings.sound);
  const haptics = useApp((s) => s.settings.haptics);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = reducedMotion ? 'reduced' : 'full';
    root.dataset.contrast = highContrast ? 'high' : 'normal';
    root.style.setProperty('--text-scale', String(textScale));
  }, [reducedMotion, highContrast, textScale]);

  useEffect(() => {
    syncAudioSettings({ sound, haptics });
  }, [sound, haptics]);

  return (
    <I18nProvider>
      {children}
      <ToastHost />
    </I18nProvider>
  );
}
