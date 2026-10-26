/**
 * Lazy route screens: each route is its own chunk and opens only once its translations (app, engine and social
 * copy for the active locale) have loaded, so a screen never flashes untranslated keys. The first paint (the root
 * shell) therefore carries no engine and no three.js code.
 */
import { lazy, type ComponentType } from 'react';
import { preloadI18n } from '@/i18n';

/** `engine: false` for screens without cricket vocabulary: they wait only for the app catalog (bundled for English). */
export function lazyRoute<P>(load: () => Promise<{ default: ComponentType<P> }>, opts: { engine?: boolean } = {}) {
  return lazy(() => Promise.all([load(), preloadI18n(undefined, opts)]).then(([m]) => m));
}
