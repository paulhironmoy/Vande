import type { AnalyticsAdapter } from './types';

export const noopAdapter: AnalyticsAdapter = {
  track() {
    /* nothing */
  },
  async flush() {
    /* nothing */
  },
};
