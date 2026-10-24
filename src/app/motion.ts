import type { Settings } from '@/engine/types';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export function systemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveReducedMotion(settings: Settings, systemReduced = systemPrefersReducedMotion()): boolean {
  if (settings.reducedMotion === 'on') return true;
  if (settings.reducedMotion === 'off') return false;
  return systemReduced;
}

export { REDUCED_QUERY };
