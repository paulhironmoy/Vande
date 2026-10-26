/**
 * The launch choice's rules, kept tiny so the shell can import them without any Practice code: when to offer the
 * choice (a normal start, never a deep link), and when Practice was selected (for time to first delivery).
 */
import type { Route } from '@/app/router';

/**
 * Offer Practice or Skip on a normal app start: the app opened at its root. Deep links (invites, matches, cups,
 * highlights, shared matches) and every other direct path go straight to their screen.
 */
export function shouldOfferLaunchChoice(route: Route): boolean {
  return route.name === 'home';
}

let selectedAt: number | null = null;

/** Called when Practice is chosen (the launch choice or any other entry). */
export function markPracticeSelected(at: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
  selectedAt = at;
}

/** The selection time, once (the Practice route reads it as it opens); null when Practice was opened directly. */
export function takePracticeSelectedAt(): number | null {
  const v = selectedAt;
  selectedAt = null;
  return v;
}
