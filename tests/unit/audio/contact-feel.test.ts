/**
 * The contact feels the stage fires (src/render3d/practice/feedback.ts, owned by audio): a defended middle is a block,
 * never the attacking sweet spot (F-022), and every contact feel carries the contact and timing it came from, so the
 * Practice sink can pick the exact signature (a top edge, a mistimed middle). Fixtures: tests/unit/render3d.
 */
import { describe, expect, it } from 'vitest';
import { contactFeel, feedbackCues } from '@/render3d/practice/feedback';
import type { ContactReport } from '@/contracts/practice';
import { fixtureFlight, fixtureResult, type ResultKind } from '../render3d/practiceFixtures';

const feelOf = (kind: ResultKind, timingMs = 5) => {
  const result = fixtureResult(fixtureFlight(), { kind, timingMs });
  return feedbackCues(result, 2000, false).find((c) => c.feel)?.feel ?? null;
};

describe('contact feels (F-022)', () => {
  it('a perfectly timed defensive block is a block, not the sweet spot; an attack keeps the sweet spot', () => {
    expect(feelOf('defend', 5)).toMatchObject({ kind: 'block', contact: 'middle' });
    expect(feelOf('defend', 50)).toMatchObject({ kind: 'block', contact: 'middle' });
    expect(feelOf('drive', 5)).toMatchObject({ kind: 'sweet', contact: 'middle', timing: 'perfect' });
    expect(feelOf('drive', 50)).toMatchObject({ kind: 'middle', contact: 'middle' });
  });

  it('every bat feel carries its contact; edges, misses and leaves are unchanged', () => {
    expect(feelOf('edge')).toMatchObject({ kind: 'edge', contact: 'outside_edge' });
    expect(feelOf('miss')?.kind).toBe('miss');
    expect(feelOf('leave')).toBeNull();
    const middle = { kind: 'middle', timing: 'perfect' } as ContactReport;
    expect(contactFeel(middle, 'defend')?.kind).toBe('block');
    expect(contactFeel(middle, 'attack')?.kind).toBe('sweet');
    expect(contactFeel(middle)?.kind).toBe('sweet');
  });
});
