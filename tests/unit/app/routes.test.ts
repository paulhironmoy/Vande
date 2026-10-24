import { describe, expect, it } from 'vitest';
import { buildUrl, challengeShareUrl, pathToScreen, screenToPath, stripBase } from '@/app/routes';
import type { Screen } from '@/app/storeTypes';

const SCREENS: Screen[] = [
  { name: 'launch' },
  { name: 'intro' },
  { name: 'home' },
  { name: 'opponents' },
  { name: 'briefing' },
  { name: 'play' },
  { name: 'chapter-result' },
  { name: 'final-result' },
  { name: 'final-result', resultId: 'abc-123' },
  { name: 'daily' },
  { name: 'challenge', code: 'V1.EX.k3j9z.S.11.78' },
  { name: 'republic' },
  { name: 'history' },
  { name: 'history', entryId: 'entry-9' },
  { name: 'settings' },
  { name: 'about', page: 'privacy' },
  { name: 'about', page: 'version' },
];

describe('routes', () => {
  it('round-trips every screen through path formatting and parsing', () => {
    for (const screen of SCREENS) {
      const path = screenToPath(screen);
      const parsed = pathToScreen(path, '');
      if (screen.name === 'launch') expect(parsed).toBeNull();
      else expect(parsed).toEqual(screen);
    }
  });

  it('accepts challenge codes from the query string and the /c/ path', () => {
    expect(pathToScreen('/', '?c=ABC.123')).toEqual({ name: 'challenge', code: 'ABC.123' });
    expect(pathToScreen('/anything', 'c=ABC.123')).toEqual({ name: 'challenge', code: 'ABC.123' });
    expect(pathToScreen('/c/XYZ', '')).toEqual({ name: 'challenge', code: 'XYZ' });
  });

  it('opens the daily screen from the PWA shortcut query', () => {
    expect(pathToScreen('/', '?screen=daily')).toEqual({ name: 'daily' });
  });

  it('falls back to home for unknown paths and to disclosure for unknown about pages', () => {
    expect(pathToScreen('/nonsense', '')).toEqual({ name: 'home' });
    expect(pathToScreen('/about/not-a-page', '')).toEqual({ name: 'about', page: 'disclosure' });
    expect(pathToScreen('/about', '')).toEqual({ name: 'about', page: 'disclosure' });
  });

  it('normalises trailing slashes and index.html', () => {
    expect(stripBase('/settings/')).toBe('/settings');
    expect(stripBase('/index.html')).toBe('/');
    expect(pathToScreen('/settings/', '')).toEqual({ name: 'settings' });
  });

  it('builds URLs with the base prefix and share URLs with the query form', () => {
    expect(buildUrl({ name: 'launch' })).toBe('/');
    expect(buildUrl({ name: 'settings' })).toBe('/settings');
    expect(challengeShareUrl('A.B', 'https://example.test')).toBe('https://example.test/?c=A.B');
  });
});
