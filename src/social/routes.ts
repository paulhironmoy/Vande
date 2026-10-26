/**
 * Social route table (cups, rooms, leaderboards, Top 100, highlights, profile), merged by the root shell
 * (src/App.tsx). Owned by the social workstream. Every screen is its own lazy chunk and opens once its translations
 * (the shell's and the social copy of the active language) have loaded, so it never flashes raw keys.
 */
import { lazy, type ComponentType } from 'react';
import type { RouteTable } from '@/app/router';
import { preloadI18n } from '@/i18n';
import { preloadSocial } from './i18n';

function screen<P>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() => Promise.all([load(), preloadI18n(), preloadSocial()]).then(([m]) => m));
}

export const socialRoutes: RouteTable = {
  cup_new: screen(() => import('./cups/CupNewRoute')),
  cup: screen(() => import('./cups/CupRoute')),
  room: screen(() => import('./rooms/RoomRoute')),
  leaderboards: screen(() => import('./leaderboards/LeaderboardsRoute')),
  top100: screen(() => import('./top100/Top100Route')),
  highlights: screen(() => import('./highlights/HighlightsRoute')),
  highlight: screen(() => import('./highlights/HighlightLandingRoute')),
  profile: screen(() => import('./profile/ProfileRoute')),
};
