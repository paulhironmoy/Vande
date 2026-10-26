import { describe, expect, it } from 'vitest';
import messages from '../../../backend/src/ops/messages.ts?raw';

/**
 * FCM sends only localisation keys (backend/src/ops/push.ts), so every notification kind needs its title and body in
 * every Android locale, or the device shows nothing useful.
 */
const files = import.meta.glob<string>('/android/app/src/main/res/values*/strings.xml', { query: '?raw', import: 'default', eager: true });
const union = /export type NotifyKind =([^;]+);/.exec(messages)?.[1] ?? '';
const kinds = [...union.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
const locales = Object.keys(files)
  .map((path) => /\/(values(?:-[a-z]{2})?)\/strings\.xml$/.exec(path)?.[1] ?? null)
  .filter((dir): dir is string => dir !== null);

describe('Android push strings', () => {
  it('finds the notification kinds and the locale folders', () => {
    expect(kinds.length).toBeGreaterThanOrEqual(11);
    expect(locales).toEqual(expect.arrayContaining(['values', 'values-hi', 'values-bn', 'values-te', 'values-mr', 'values-ta', 'values-gu', 'values-kn', 'values-ml', 'values-pa']));
  });

  for (const [path, xml] of Object.entries(files)) {
    it(`${path} has a non-empty title and body for every kind`, () => {
      for (const kind of kinds) {
        for (const part of ['title', 'body']) {
          const m = new RegExp(`<string name="notif_${kind}_${part}">([^<]+)</string>`).exec(xml);
          expect(m?.[1]?.trim(), `notif_${kind}_${part}`).toBeTruthy();
          // Unescaped apostrophes break aapt.
          expect(/(^|[^\\])'/.test(m?.[1] ?? ''), `notif_${kind}_${part} has an unescaped apostrophe`).toBe(false);
        }
      }
    });
  }
});
