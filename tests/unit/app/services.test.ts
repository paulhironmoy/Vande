import { describe, expect, it } from 'vitest';
import { routeForLink } from '@/app/services';

describe('routeForLink', () => {
  it('maps every deep link kind to its route and keeps invite attribution', () => {
    expect(routeForLink(null)).toBeNull();
    expect(routeForLink({ kind: 'invite', token: 'tok', attribution: null })).toEqual({ name: 'invite', token: 'tok' });
    expect(routeForLink({ kind: 'invite', token: 'tok', attribution: 'k3x9q2' })).toEqual({ name: 'invite', token: 'tok', attribution: 'k3x9q2' });
    expect(routeForLink({ kind: 'match', matchId: 'm1' })).toEqual({ name: 'match', matchId: 'm1' });
    expect(routeForLink({ kind: 'cup', cupId: 'c1' })).toEqual({ name: 'cup', cupId: 'c1' });
    expect(routeForLink({ kind: 'highlight', code: 'k3x9q2', attribution: null })).toEqual({ name: 'highlight', code: 'k3x9q2' });
    expect(routeForLink({ kind: 'shared', code: 'q7k2m9x4' })).toEqual({ name: 'shared', code: 'q7k2m9x4' });
  });
});
