import { describe, expect, it } from 'vitest';
import { parseRoute, routePath, type Route } from '@/app/router';

describe('router', () => {
  it('round-trips every route through its path', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'onboarding' },
      { name: 'training' },
      { name: 'practice' },
      { name: 'daily' },
      { name: 'ghosts' },
      { name: 'duel_new' },
      { name: 'duel_new', attribution: 'k3x9q2' },
      { name: 'invite', token: 'abcDEF123_-xyz' },
      { name: 'invite', token: 'abcDEF123_-xyz', attribution: 'k3x9q2' },
      { name: 'match', matchId: 'm_12345' },
      { name: 'replay', matchId: 'm_12345' },
      { name: 'replay', matchId: 'm_12345', moment: 'key' },
      { name: 'replay', matchId: 'm_12345', moment: 'result' },
      { name: 'cup_new' },
      { name: 'cup', cupId: 'c_abcd' },
      { name: 'room', roomId: 'r_abcd' },
      { name: 'leaderboards', scope: 'college' },
      { name: 'top100' },
      { name: 'top100', day: '2026-10-25' },
      { name: 'highlight', code: 'h7k2m9x4' },
      { name: 'highlights' },
      { name: 'shared', code: 'q7k2m9x4' },
      { name: 'profile' },
      { name: 'settings' },
    ];
    for (const r of routes) expect(parseRoute(routePath(r))).toEqual(r);
  });

  it('parses full https invite links and the custom scheme', () => {
    expect(parseRoute('https://example.com/i/abcDEF12345')).toEqual({ name: 'invite', token: 'abcDEF12345' });
    expect(parseRoute('vandecricket://i/abcDEF12345')).toEqual({ name: 'invite', token: 'abcDEF12345' });
  });

  it('rejects malformed paths instead of guessing', () => {
    expect(parseRoute('/i/<script>').name).toBe('not_found');
    expect(parseRoute('/m/x').name).toBe('not_found');
    expect(parseRoute('/leaderboards/galaxy').name).toBe('not_found');
    expect(parseRoute('/top100/yesterday').name).toBe('not_found');
    expect(parseRoute('/train/extra').name).toBe('not_found');
    expect(parseRoute('/h/NOT_A_CODE').name).toBe('not_found');
  });

  it('accepts invite tokens in the server format (payload.mac)', () => {
    const token = `${'A'.repeat(51)}.${'B'.repeat(22)}`;
    expect(parseRoute(`https://vande.example/i/${token}`)).toEqual({ name: 'invite', token });
    expect(parseRoute(`/i/${token}?a=k3x9q2`)).toEqual({ name: 'invite', token, attribution: 'k3x9q2' });
    expect(parseRoute(`/i/${token}.extra`).name).toBe('not_found');
  });

  it('keeps a valid invite attribution code and drops a malformed one', () => {
    expect(parseRoute('https://example.com/i/abcDEF12345?a=k3x9q2')).toEqual({ name: 'invite', token: 'abcDEF12345', attribution: 'k3x9q2' });
    expect(parseRoute('/i/abcDEF12345?a=<x>')).toEqual({ name: 'invite', token: 'abcDEF12345' });
  });
});
