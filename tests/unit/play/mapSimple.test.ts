import { describe, expect, it } from 'vitest';
import type { MapDistrictView, MapState } from '@/engine/types';
import { describeMapChange, simpleDistrictAriaLabel, simpleInstitutionName } from '@/map';

function district(over: Partial<MapDistrictView>): MapDistrictView {
  return {
    id: 'civic',
    name: 'Civic Square',
    kind: 'civic',
    x: 0.5,
    y: 0.44,
    crowd: 0.1,
    mood: 'calm',
    trust: 0.6,
    services: 0.9,
    institution: 'District Collectorate',
    institutionActive: false,
    incident: null,
    pendingDecisions: 0,
    openEvidence: 0,
    ...over,
  };
}

function state(over: Partial<MapState> & { districts: MapDistrictView[] }): MapState {
  return { tick: 0, roads: [], signals: [], health: 0.7, recentActions: [], ...over };
}

describe('simple map language', () => {
  it('describes changes in short plain sentences', () => {
    const market = district({ id: 'market', name: 'Market Street', institution: undefined });
    const prev = state({
      districts: [district({}), market],
      roads: [{ id: 'r-civic-market', from: 'civic', to: 'market', status: 'open' }],
    });
    const next = state({
      tick: 10,
      districts: [district({ crowd: 0.5, institutionActive: true, incident: 'clash' }), { ...market, incident: 'vandalism' }],
      roads: [{ id: 'r-civic-market', from: 'civic', to: 'market', status: 'closed' }],
      signals: [{ id: 's1', from: 'civic', to: 'market', kind: 'manipulated', progress: 0.2 }],
      recentActions: [{ district: 'civic', kind: 'deploy', at: 10 }],
    });
    const lines = describeMapChange(prev, next, { simple: true });
    expect(lines).toEqual([
      'A fight started at Civic Square',
      'A window was broken at Market Street',
      'Lots of people gathering at Civic Square',
      'Road to Market Street is blocked',
      'Fake story moving from Civic Square to Market Street',
      'The city office is helping at Civic Square',
      'Helpers arriving at Civic Square',
    ]);
    for (const line of lines) expect(line.split(' ').length).toBeLessThanOrEqual(9);
    // The full-language version is unchanged.
    expect(describeMapChange(prev, next)[0]).toBe('Clashes at Civic Square');
  });

  it('labels districts with word scales and kid-friendly institution names', () => {
    const label = simpleDistrictAriaLabel(district({ crowd: 0.5, mood: 'tense', trust: 0.7, pendingDecisions: 1, openEvidence: 2, institutionActive: true }));
    expect(label).toBe('Civic Square: lots of people, worried, trust good, the city office is helping, 1 choice waiting, 2 clues');
    expect(simpleInstitutionName('Election Records Office')).toBe('Vote office');
    expect(simpleInstitutionName('Press Club')).toBe("Reporters' building");
    expect(simpleInstitutionName('Something New')).toBe('Something New');
  });
});
