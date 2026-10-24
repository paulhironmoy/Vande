/**
 * Resolved reduced-motion preference for effects.
 * The app writes the resolved value to `<html data-motion="reduced|full">` (settings may override the OS);
 * without that attribute the OS preference decides. Without a document (tests/SSR) effects are off.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  const attr = document.documentElement.getAttribute('data-motion');
  if (attr === 'reduced') return true;
  if (attr === 'full') return false;
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
