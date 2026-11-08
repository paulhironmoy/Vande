/**
 * The drawn bat is bit for bit what it was before the 2026-11-07 performance changes (FEEL-1): the touch-down drawing
 * is only worked out while it is shown, the clearance guard shares what it can between its probes, and a result's bat
 * trace is frozen so the frames share one prepared track. None of it may move the bat by a single bit.
 * The corpus is `batExactCorpus.ts`; `tests/fixtures/bat-exact/golden.json` was written by that corpus on the code
 * before the changes (build 4a376ae+e5dba9cdf3db) and pins the presented and first-person bat (the uncommitted stroke
 * and the committed tap); the external views follow the striker's body (other owners' code), so only the memo is held
 * to account there. The presented bat before the touch and at contact is `batAt`'s.
 */
import { describe, expect, it } from 'vitest';
import golden from '../../fixtures/bat-exact/golden.json';
import { runBatCorpus } from './batExactCorpus';

describe('the drawn bat, bit for bit', () => {
  it('matches the hashes recorded before the performance changes, for physics traces as built and as the worker sends them', () => {
    const built = runBatCorpus();
    expect(built.evaluations).toBe(golden.evaluations);
    expect(built.groups).toEqual(golden.groups);
    // The external views follow the striker's body, which other owners change; here the memo must not move them.
    for (const [group, { memo, fresh }] of Object.entries(built.external)) expect(memo, group).toBe(fresh);
    // A result from the physics worker is a structured-clone copy (thawed): the same values, the slow path.
    const thawed = runBatCorpus({ thaw: true });
    expect(thawed.groups).toEqual(golden.groups);
    for (const [group, { memo, fresh }] of Object.entries(thawed.external)) expect(memo, group).toBe(fresh);
  }, 240_000);
});
