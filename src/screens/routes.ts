/**
 * Experience route table: route name → screen, merged by the root shell (src/App.tsx). Owned by the experience
 * workstream. Every screen is its own lazy chunk and waits for its translations, so the first paint carries no 3D
 * and no engine code (see docs/VISUAL_SYSTEM.md, "Routes"). Screens without cricket vocabulary skip waiting for the
 * engine's copy.
 */
import type { RouteTable } from '@/app/router';
import { lazyRoute } from './app/lazyRoute';
import HomeEntry from './home/HomeEntry';

export const experienceRoutes: RouteTable = {
  home: HomeEntry,
  onboarding: lazyRoute(() => import('./onboarding/StartRoute'), { engine: false }),
  training: lazyRoute(() => import('./training/TrainingRoute')),
  duel_new: lazyRoute(() => import('./duel/DuelNewRoute')),
  invite: lazyRoute(() => import('./invite/InviteRoute')),
  match: lazyRoute(() => import('./match/MatchRoute')),
  replay: lazyRoute(() => import('./replay/ReplayRoute')),
  daily: lazyRoute(() => import('./daily/DailyRoute')),
  ghosts: lazyRoute(() => import('./ghosts/GhostsRoute')),
  shared: lazyRoute(() => import('./shared/SharedRoute')),
  settings: lazyRoute(() => import('./settings/SettingsRoute'), { engine: false }),
  not_found: lazyRoute(() => import('./notfound/NotFoundRoute'), { engine: false }),
};
