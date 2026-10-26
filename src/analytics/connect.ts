/**
 * Events only the app shell can see, wired once at boot (src/app/services.ts, after createAnalytics):
 *   reminder_opened     a deadline reminder push the player tapped (mode duel or cup; nothing about the match);
 *   attributed_install  an install that came through a highlight or invite link, with its attribution code (a code,
 *                       never a person; the Play install referrer is read once, at the first launch).
 * Both go through `track`, so consent, Do Not Track and the closed vocabularies apply as for every other event.
 */
import type { PushAdapter } from '@/contracts';
import type { Analytics } from './index';

export interface AnalyticsSources {
  push: Pick<PushAdapter, 'onMessage'>;
  onAttributedInstall?: (cb: (code: string) => void) => () => void;
}

export function connectAnalytics(analytics: Pick<Analytics, 'track'>, platform: AnalyticsSources): () => void {
  const offPush = platform.push.onMessage((m) => {
    if (m.kind !== 'deadline_reminder' || m.data?.tapped !== '1') return;
    analytics.track('reminder_opened', { mode: m.data.cupId ? 'cup' : 'duel' });
  });
  const offInstall = platform.onAttributedInstall?.((code) => analytics.track('attributed_install', { attribution: code })) ?? (() => undefined);
  return () => {
    offPush();
    offInstall();
  };
}
