/**
 * Ads and billing adapters (src/contracts/adapters.ts): disabled by default, with mocks so the UI can build every
 * state. Rules enforced here, not left to the UI: rewarded ads only, never while an innings is being played, rewards
 * are cosmetic; billing sells cosmetics only (kits, celebrations, stadium and replay themes, seasons), never an
 * outcome, a ranking or a statistical advantage. Real providers need credentials and policy review first
 * (docs/PRIVACY_AND_CONSENT.md); declining tracking consent never changes what a player gets.
 */
import type { AdsAdapter, BillingAdapter } from '@/contracts';

type Product = Awaited<ReturnType<BillingAdapter['products']>>[number];
const COSMETIC_KINDS: ReadonlySet<Product['kind']> = new Set(['kit', 'celebration', 'stadium_theme', 'replay_theme', 'season']);

export function createDisabledAds(): AdsAdapter {
  return { enabled: () => false, showRewarded: async () => 'unavailable' };
}

/** Wraps an ads adapter so it can never show during an innings. */
export function guardAds(ads: AdsAdapter, inningsActive: () => boolean): AdsAdapter {
  return {
    enabled: () => ads.enabled() && !inningsActive(),
    showRewarded: async (placement) => (inningsActive() ? 'unavailable' : ads.showRewarded(placement)),
  };
}

export function createMockAds(result: 'rewarded' | 'skipped' | 'unavailable' = 'rewarded'): AdsAdapter & { shown: string[] } {
  const self = {
    shown: [] as string[],
    enabled: () => true,
    async showRewarded(placement: 'cosmetic_unlock' | 'replay_theme') {
      self.shown.push(placement);
      return result;
    },
  };
  return self;
}

export function createDisabledBilling(): BillingAdapter {
  return { enabled: () => false, products: async () => [], purchase: async () => 'unavailable' };
}

export function createMockBilling(products: Product[], result: 'purchased' | 'cancelled' | 'failed' = 'purchased'): BillingAdapter & { purchases: string[] } {
  const cosmetic = products.filter((p) => COSMETIC_KINDS.has(p.kind));
  const self = {
    purchases: [] as string[],
    enabled: () => true,
    products: async () => cosmetic,
    async purchase(productId: string) {
      if (!cosmetic.some((p) => p.id === productId)) return 'unavailable' as const;
      self.purchases.push(productId);
      return result;
    },
  };
  return self;
}
