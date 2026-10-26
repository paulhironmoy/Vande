/**
 * App services — ROOT-OWNED. Boots the platform adapters, the network layer and analytics exactly once, routes deep
 * links (invites, matches, install-referrer handoffs) into the router, and exposes everything to screens through
 * `useServices()`. Offline-only builds get `net: null` and every local mode keeps working.
 */
import { useEffect, useState } from 'react';
import type { AnalyticsProps } from '@/contracts';
import { createPlatform, isNativePlatform, parseAppLink, type AppLink, type Platform } from '@/platform';
import { createNet, type Net } from '@/net';
import { connectAnalytics, createAnalytics, type Analytics } from '@/analytics';
import { isAdultConfirmed } from '@/screens/onboarding/age';
import { useApp } from './store';
import { useRouter, type Route } from './router';

export interface Services {
  platform: Platform;
  net: Net | null;
  analytics: Analytics;
}

let booting: Promise<Services> | null = null;
let ready: Services | null = null;

function platformProp(): NonNullable<AnalyticsProps['platform']> {
  if (isNativePlatform()) return 'android';
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches ? 'pwa' : 'web';
  } catch {
    return 'web';
  }
}

/** Maps a platform deep link to a route (invites, matches, cups, highlights); unknown links are ignored. */
export function routeForLink(link: AppLink | null): Route | null {
  if (!link) return null;
  switch (link.kind) {
    case 'invite':
      return link.attribution ? { name: 'invite', token: link.token, attribution: link.attribution } : { name: 'invite', token: link.token };
    case 'match':
      return { name: 'match', matchId: link.matchId };
    case 'cup':
      return { name: 'cup', cupId: link.cupId };
    case 'highlight':
      return { name: 'highlight', code: link.code };
    case 'shared':
      return { name: 'shared', code: link.code };
    default:
      return null;
  }
}

async function boot(): Promise<Services> {
  const platform = await createPlatform();
  const net = createNet({
    secureStore: platform.secureStore,
    setOnline: (online) => useApp.getState().setOnline(online),
    locale: () => useApp.getState().settings.locale,
    // 18+ policy: the first-run age screen stores only the answer (src/screens/onboarding/age.ts); no answer, no account.
    adultConfirmed: isAdultConfirmed,
  });
  const analytics = createAnalytics({
    base: () => ({ platform: platformProp(), appVersion: __APP_VERSION__, locale: useApp.getState().settings.locale }),
  });
  // Reminder opens (tapped deadline pushes) and the attributed install; both consent-gated inside analytics.
  connectAnalytics(analytics, platform);
  const open = (url: string | null) => {
    const route = routeForLink(url ? parseAppLink(url, platform.webOrigins) : null);
    if (route) useRouter.getState().navigate(route);
  };
  try {
    open(await platform.deepLinks.initial());
  } catch {
    /* a broken pending link never blocks the app */
  }
  platform.deepLinks.onLink(open);
  ready = { platform, net, analytics };
  return ready;
}

/** Starts the services once; safe to call from anywhere. */
export function getServices(): Promise<Services> {
  if (!booting) {
    booting = boot().catch((error: unknown) => {
      // A failed boot (e.g. a native adapter rejecting) must not leave every screen waiting forever: forget the
      // attempt and try again every 2 s until it succeeds (callers keep waiting on the same chain).
      if (import.meta.env.DEV) console.error('services boot failed', error);
      booting = null;
      return new Promise<Services>((resolve, reject) => setTimeout(() => getServices().then(resolve, reject), 2_000));
    });
  }
  return booting;
}

/** The services once booted (null while booting). */
export function useServices(): Services | null {
  const [s, setS] = useState<Services | null>(ready);
  useEffect(() => {
    let alive = true;
    // Always subscribe: boot may finish between the first render and this effect (the same promise, so cheap).
    void getServices().then((v) => alive && setS(v));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}
