/**
 * Release audit, experience side: the privacy and account-deletion pages one tap away (the system browser on Android,
 * from the hosted site when it is configured), the full open-source notices in Settings, honest deletion copy, and
 * the neutral age answer cleared with this device's data.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useApp } from '@/app/store';
import { useRouter } from '@/app/router';
import { KITS } from '@/ui/avatar/traits';
import { legalUrl } from '@/screens/common/legal';
import { filterNotices, parseNotices } from '@/screens/settings/notices';
import { loadI18n, renderUi } from './helpers';
import NOTICES from '../../../public/third-party-notices.txt?raw';

const services: { current: unknown } = { current: null };
vi.mock('@/app/services', () => ({ useServices: () => services.current, getServices: async () => services.current }));

import SettingsRoute from '@/screens/settings/SettingsRoute';


const offlineServices = () => ({ net: null, analytics: { track: vi.fn(), setConsent: vi.fn(), consent: () => 'unset', active: () => false, flush: async () => undefined }, platform: { push: { available: () => false, register: vi.fn(), onMessage: () => () => undefined } } });

beforeAll(async () => {
  await loadI18n();
});
beforeEach(() => {
  localStorage.clear();
  useApp.setState({ player: { id: null, alias: 'Night Owl', avatar: { seed: 'night-owl-3' }, kit: KITS[1] }, online: true });
  useRouter.setState({ route: { name: 'settings' }, depth: 0 });
  services.current = offlineServices();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('legal pages', () => {
  it('Android opens the hosted page when the web origin is set, otherwise the bundled copy', () => {
    expect(legalUrl('privacy', { VITE_PUBLIC_WEB_ORIGIN: 'https://vande.example/', BASE_URL: '/' }, true)).toBe('https://vande.example/privacy.html');
    expect(legalUrl('delete-account', { VITE_PUBLIC_WEB_ORIGIN: '', BASE_URL: '/' }, true)).toBe('/delete-account.html');
    // On the web the page's own origin serves it (under the deploy base path).
    expect(legalUrl('privacy', { VITE_PUBLIC_WEB_ORIGIN: 'https://vande.example', BASE_URL: '/Vande/' }, false)).toBe('/Vande/privacy.html');
    // A plain-http origin is never used for the hosted copy.
    expect(legalUrl('privacy', { VITE_PUBLIC_WEB_ORIGIN: 'http://vande.example', BASE_URL: '/' }, true)).toBe('/privacy.html');
  });

  it('Settings links the privacy policy and the web deletion page, in a new tab', () => {
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    const policy = screen.getByTestId('settings-privacy-policy');
    expect(policy.getAttribute('href')).toMatch(/\/privacy\.html$/);
    expect(policy.getAttribute('target')).toBe('_blank');
    expect(policy.getAttribute('rel')).toContain('noopener');
    expect(screen.getByTestId('settings-delete-web').getAttribute('href')).toMatch(/\/delete-account\.html$/);
  });
});

describe('deletion', () => {
  it('deleting local data also forgets the age answer', async () => {
    localStorage.setItem('vc:age', 'adult');
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    fireEvent.click(screen.getByTestId('settings-delete'));
    fireEvent.click(await screen.findByTestId('settings-delete-dialog-confirm'));
    await waitFor(() => expect(useApp.getState().player).toBeNull());
    expect(localStorage.getItem('vc:age')).toBeNull();
  });

  it('says plainly that finished matches show "Deleted player" (every complete locale)', async () => {
    const { en } = await import('@/i18n/catalogs/en');
    const hi = (await import('@/i18n/catalogs/hi')).default as Record<string, string>;
    const hl = (await import('@/i18n/catalogs/hi-Latn')).default as Record<string, string>;
    for (const cat of [en as unknown as Record<string, string>, hi, hl]) {
      expect(cat['settings.delete_body']).toContain('"Deleted player"');
      expect(cat['settings.delete_confirm_body']).toContain('"Deleted player"');
      expect(cat['settings.delete_body']).not.toMatch(/keep your alias|alias rahega|उपनाम रहेगा/);
    }
  });
});

describe('open-source notices', () => {
  it('splits the generated file into its sections and components, with the font licences in full', () => {
    const entries = parseNotices(NOTICES);
    const headings = entries.filter((e) => e.heading).map((e) => e.title);
    expect(headings.some((h) => /npm packages/.test(h))).toBe(true);
    expect(headings.some((h) => /Android libraries/.test(h))).toBe(true);
    const manrope = entries.find((e) => e.title.includes('manrope'));
    expect(manrope?.body).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(entries.find((e) => e.title.startsWith('@capacitor/app'))?.body).toContain('Permission is hereby granted');
    // Nothing is lost: every non-rule line of the file is in some entry.
    const text = entries.map((e) => `${e.title}\n${e.body}`).join('\n');
    for (const line of NOTICES.split('\n').filter((l) => l.trim() && !/^[-=]{20,}/.test(l)).slice(0, 400)) expect(text).toContain(line.trim());
  });

  it('search keeps the matching components under their section heading', () => {
    const entries = parseNotices(NOTICES);
    const hits = filterNotices(entries, 'noto devanagari');
    expect(hits.filter((e) => !e.heading).map((e) => e.title)).toEqual([expect.stringContaining('noto-sans-devanagari')]);
    expect(hits[0].heading).toBe(true);
    expect(filterNotices(entries, 'no-such-package-anywhere')).toEqual([]);
  });

  it('the licences sheet shows the full texts, searchable, with the font and asset note', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(NOTICES, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    fireEvent.click(screen.getByTestId('settings-licences'));
    const full = await screen.findByTestId('licences-full');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/third-party-notices\.txt$/);
    expect(full.textContent).toContain('Permission is hereby granted');
    expect(screen.getByTestId('settings-licences-sheet').textContent).toContain('SIL Open Font License 1.1');
    fireEvent.change(screen.getByTestId('licences-search'), { target: { value: 'androidx.core:core-splashscreen' } });
    await waitFor(() => expect(screen.getByTestId('licences-full').querySelectorAll('h4')).toHaveLength(1));
    expect(screen.getByText('1 match')).toBeTruthy();
  });
});
