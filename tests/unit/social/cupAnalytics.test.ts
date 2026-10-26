/** Cup milestones for analytics: once per cup on this device, members only, nothing but the mode and the stage. */
import { describe, expect, it } from 'vitest';
import type { CupView } from '@/contracts';
import { cupMilestones } from '@/social/cups/cupAnalytics';
import { ref } from './fakeServices';

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

const view = (over: Partial<CupView> = {}): CupView => ({
  cupId: 'c1',
  name: 'Office Cup',
  status: 'gathering',
  size: 4,
  members: [ref('pme', 'Swift Tiger'), ref('pb', 'Calm Cobra')],
  inviteToken: null,
  schedule: { rounds: [], final: null },
  fixtures: [],
  standings: [],
  roomId: 'r1',
  myTasks: [],
  lockedCount: null,
  winner: null,
  ...over,
});

describe('cup milestones', () => {
  it('joined once, completed once with the stage reached, only for members', () => {
    const s = storage();
    expect(cupMilestones(view(), 'pme', s)).toEqual([{ event: 'tournament_joined', props: { mode: 'cup' } }]);
    expect(cupMilestones(view({ status: 'group_stage' }), 'pme', s)).toEqual([]);
    const final = { fixtureId: 'f9', round: 'final' as const, home: 'pme', away: 'pb', matchId: 'm9', status: 'revealed' as const, auto: [false, false] as [boolean, boolean] };
    expect(cupMilestones(view({ status: 'complete', fixtures: [final] }), 'pme', s)).toEqual([{ event: 'tournament_completed', props: { mode: 'cup', stage: 'final' } }]);
    expect(cupMilestones(view({ status: 'complete', fixtures: [final] }), 'pme', s)).toEqual([]);
    // A member who did not reach the final; and someone who is not a member at all.
    const other = storage();
    expect(cupMilestones(view({ status: 'complete', members: [ref('pme', 'Swift Tiger'), ref('pb', 'Calm Cobra'), ref('pc', 'Bold Falcon')], fixtures: [final] }), 'pc', other).map((m) => m.props)).toEqual([{ mode: 'cup' }, { mode: 'cup', stage: 'group' }]);
    expect(cupMilestones(view(), 'pz', storage())).toEqual([]);
    expect(cupMilestones(null, 'pme', storage())).toEqual([]);
  });
});
