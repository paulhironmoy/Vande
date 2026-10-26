import { describe, expect, it } from 'vitest';
import { createDeepLinkSource, parseAppLink } from '@/platform/deepLinks';
import { createInstallReferrerSource, parseInstallReferrer, playStoreUrl } from '@/platform/installReferrer';
import { createMemorySecureStore } from '@/platform/secureStore';

const TOKEN = `${'A'.repeat(51)}.${'b'.repeat(22)}`;
const ORIGINS = ['https://vande.example'];

describe('deep links', () => {
  it('parses https invite and match links from the app’s own origins only', () => {
    expect(parseAppLink(`https://vande.example/i/${TOKEN}?a=wa7x`, ORIGINS)).toEqual({ kind: 'invite', token: TOKEN, attribution: 'wa7x' });
    expect(parseAppLink(`https://vande.example/i/${TOKEN}/`, ORIGINS)).toEqual({ kind: 'invite', token: TOKEN, attribution: null });
    expect(parseAppLink(`https://vande.example/m/m${'a'.repeat(26)}`, ORIGINS)).toEqual({ kind: 'match', matchId: `m${'a'.repeat(26)}` });
    expect(parseAppLink(`https://evil.example/i/${TOKEN}`, ORIGINS)).toBeNull();
    expect(parseAppLink(`https://vande.example/i/not-a-token`, ORIGINS)).toBeNull();
    expect(parseAppLink(`https://vande.example/i/${TOKEN}?a=<script>`, ORIGINS)).toEqual({ kind: 'invite', token: TOKEN, attribution: null });
    expect(parseAppLink('javascript:alert(1)', ORIGINS)).toBeNull();
    expect(parseAppLink('not a url', ORIGINS)).toBeNull();
  });

  it('takes the short invite code of new links, and the long signed token of older ones', () => {
    const CODE = 'k7q2m5xa4b';
    expect(parseAppLink(`https://vande.example/i/${CODE}?a=wa7x`, ORIGINS)).toEqual({ kind: 'invite', token: CODE, attribution: 'wa7x' });
    expect(parseAppLink(`vandecricket://i/${CODE}`, ORIGINS)).toEqual({ kind: 'invite', token: CODE, attribution: null });
    expect(parseAppLink(`https://vande.example/i/${TOKEN}`, ORIGINS)).toEqual({ kind: 'invite', token: TOKEN, attribution: null });
    // Not a code: wrong length, upper case, or letters outside base32.
    for (const bad of ['k7q2m5xa4', 'k7q2m5xa4bc', 'K7Q2M5XA4B', 'k7q2m5xa1b', 'k7q2m5xa8b']) expect(parseAppLink(`https://vande.example/i/${bad}`, ORIGINS), bad).toBeNull();
    expect(parseInstallReferrer(`vc_invite=${CODE}&vc_a=wa7x`)).toEqual({ token: CODE, attribution: 'wa7x' });
    expect(parseInstallReferrer('vc_invite=K7Q2M5XA4B')).toBeNull();
  });

  it('parses the custom schemes', () => {
    expect(parseAppLink(`vandecricket://i/${TOKEN}`, ORIGINS)).toEqual({ kind: 'invite', token: TOKEN, attribution: null });
    expect(parseAppLink(`in.vande.cricket://i/${TOKEN}?a=abcd`, ORIGINS)).toEqual({ kind: 'invite', token: TOKEN, attribution: 'abcd' });
    expect(parseAppLink(`othergame://i/${TOKEN}`, ORIGINS)).toBeNull();
  });

  it('native: launch URL first, else the install referrer; web: the page URL', async () => {
    const native = createDeepLinkSource({ native: () => true, launchUrl: async () => null, referrer: async () => `vandecricket://i/${TOKEN}` });
    expect(await native.initial()).toBe(`vandecricket://i/${TOKEN}`);
    const launched = createDeepLinkSource({ native: () => true, launchUrl: async () => 'https://vande.example/m/x', referrer: async () => 'never' });
    expect(await launched.initial()).toBe('https://vande.example/m/x');
    const web = createDeepLinkSource({ native: () => false, location: { href: `https://vande.example/i/${TOKEN}` } });
    expect(await web.initial()).toBe(`https://vande.example/i/${TOKEN}`);
    const urls: string[] = [];
    let emit: (u: string) => void = () => undefined;
    const live = createDeepLinkSource({ native: () => true, listen: async (cb) => ((emit = cb), () => (emit = () => undefined)) });
    const stop = live.onLink((u) => urls.push(u));
    await Promise.resolve();
    emit('vandecricket://i/x');
    stop();
    emit('vandecricket://i/y');
    expect(urls).toEqual(['vandecricket://i/x']);
  });
});

describe('install referrer handoff', () => {
  it('carries an invite through the Play Store install, once', async () => {
    const url = playStoreUrl({ token: TOKEN, attribution: 'wa7x' });
    expect(url).toBe(`https://play.google.com/store/apps/details?id=in.vande.cricket&referrer=${encodeURIComponent(`vc_invite=${TOKEN}&vc_a=wa7x`)}`);
    const referrer = new URL(url).searchParams.get('referrer');
    expect(parseInstallReferrer(referrer)).toEqual({ token: TOKEN, attribution: 'wa7x' });
    expect(parseInstallReferrer(encodeURIComponent(referrer!))).toEqual({ token: TOKEN, attribution: 'wa7x' });
    expect(parseInstallReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
    expect(parseInstallReferrer(null)).toBeNull();
    const store = createMemorySecureStore();
    const source = createInstallReferrerSource({ plugin: { getReferrer: async () => ({ referrer }) }, store });
    expect(await source.pendingInviteUrl()).toBe(`vandecricket://i/${TOKEN}?a=wa7x`);
    expect(await source.pendingInviteUrl()).toBeNull();
    expect(await createInstallReferrerSource({ plugin: null, store: createMemorySecureStore() }).pendingInviteUrl()).toBeNull();
  });
});

describe('cup and highlight links (wave C)', () => {
  const CUP = `c${'q'.repeat(26)}`;
  const BASE = ['https://paulhironmoy.github.io/Vande'];

  it('parses cup links in the https forms (with a base path) and the custom schemes, validating the ids', () => {
    expect(parseAppLink(`https://vande.example/c/${CUP}`, ORIGINS)).toEqual({ kind: 'cup', cupId: CUP });
    expect(parseAppLink(`https://paulhironmoy.github.io/Vande/c/${CUP}/`, BASE)).toEqual({ kind: 'cup', cupId: CUP });
    expect(parseAppLink(`vandecricket://c/${CUP}`, ORIGINS)).toEqual({ kind: 'cup', cupId: CUP });
    expect(parseAppLink(`in.vande.cricket://c/${CUP}`, ORIGINS)).toEqual({ kind: 'cup', cupId: CUP });
    expect(parseAppLink(`https://vande.example/c/m${'q'.repeat(26)}`, ORIGINS)).toBeNull();
    expect(parseAppLink(`https://vande.example/c/${CUP}/extra`, ORIGINS)).toBeNull();
    expect(parseAppLink(`https://evil.example/c/${CUP}`, ORIGINS)).toBeNull();
  });

  it('parses highlight landings and keeps the ?a= attribution', () => {
    expect(parseAppLink('https://vande.example/h/k7q2m9xa', ORIGINS)).toEqual({ kind: 'highlight', code: 'k7q2m9xa', attribution: null });
    expect(parseAppLink('https://paulhironmoy.github.io/Vande/h/k7q2m9xa?a=wa7x', BASE)).toEqual({ kind: 'highlight', code: 'k7q2m9xa', attribution: 'wa7x' });
    expect(parseAppLink('vandecricket://h/k7q2m9xa?a=wa7x', ORIGINS)).toEqual({ kind: 'highlight', code: 'k7q2m9xa', attribution: 'wa7x' });
    expect(parseAppLink('https://vande.example/h/k7q2m9xa?a=<b>', ORIGINS)).toEqual({ kind: 'highlight', code: 'k7q2m9xa', attribution: null });
    expect(parseAppLink('https://vande.example/h/K7Q2', ORIGINS)).toBeNull();
    expect(parseAppLink('https://vande.example/h/ab', ORIGINS)).toBeNull();
    expect(parseAppLink('https://vande.example/h/../i/x', ORIGINS)).toBeNull();
  });

  it('parses shared match links on the web origin and the custom schemes', () => {
    expect(parseAppLink('https://vande.example/s/k7q2m9xa2b', ORIGINS)).toEqual({ kind: 'shared', code: 'k7q2m9xa2b' });
    expect(parseAppLink('https://paulhironmoy.github.io/Vande/s/k7q2m9xa2b/', BASE)).toEqual({ kind: 'shared', code: 'k7q2m9xa2b' });
    expect(parseAppLink('vandecricket://s/k7q2m9xa2b', ORIGINS)).toEqual({ kind: 'shared', code: 'k7q2m9xa2b' });
    expect(parseAppLink('in.vande.cricket://s/k7q2m9xa2b', ORIGINS)).toEqual({ kind: 'shared', code: 'k7q2m9xa2b' });
    expect(parseAppLink('https://vande.example/s/K7Q2M9XA', ORIGINS)).toBeNull();
    expect(parseAppLink('https://vande.example/s/ab', ORIGINS)).toBeNull();
    expect(parseAppLink('https://vande.example/s/k7q2m9xa2b/extra', ORIGINS)).toBeNull();
    expect(parseAppLink('https://evil.example/s/k7q2m9xa2b', ORIGINS)).toBeNull();
  });

  it('carries a highlight install through the Play Store and reports it against the code, once', async () => {
    const url = playStoreUrl({ highlight: 'k7q2m9xa' });
    expect(url).toBe(`https://play.google.com/store/apps/details?id=in.vande.cricket&referrer=${encodeURIComponent('vc_h=k7q2m9xa')}`);
    expect(playStoreUrl({ highlight: 'BAD CODE' })).toBe('https://play.google.com/store/apps/details?id=in.vande.cricket');
    const referrer = new URL(url).searchParams.get('referrer');
    const installs: string[] = [];
    const source = createInstallReferrerSource({ plugin: { getReferrer: async () => ({ referrer }) }, store: createMemorySecureStore(), onInstall: (c) => installs.push(c) });
    expect(await source.pendingInviteUrl()).toBe('vandecricket://h/k7q2m9xa');
    expect(await source.pendingInviteUrl()).toBeNull();
    expect(installs).toEqual(['k7q2m9xa']);
    // An attributed invite install reports its code too; a thrown reporter never breaks the launch.
    const inviteRef = new URL(playStoreUrl({ token: TOKEN, attribution: 'wa7x' })).searchParams.get('referrer');
    const failing = createInstallReferrerSource({ plugin: { getReferrer: async () => ({ referrer: inviteRef }) }, store: createMemorySecureStore(), onInstall: () => { throw new Error('offline'); } });
    expect(await failing.pendingInviteUrl()).toBe(`vandecricket://i/${TOKEN}?a=wa7x`);
  });
});
