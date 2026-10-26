import { useEffect } from 'react';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import { lazyRoute } from '../app/lazyRoute';

const HomeRoute = lazyRoute(() => import('./HomeRoute'), { engine: false });

/**
 * The hub's entry: a first-time visitor (no player on this device) goes straight to onboarding without downloading
 * the hub first, which keeps the first visit's critical path short.
 */
export default function HomeEntry({ route }: { route: RouteOf<'home'> }) {
  const player = useApp((s) => s.player);
  const navigate = useRouter((s) => s.navigate);
  useEffect(() => {
    if (!player) navigate({ name: 'onboarding' }, { replace: true });
  }, [player, navigate]);
  return player ? <HomeRoute route={route} /> : null;
}
