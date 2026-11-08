/**
 * What the screen tells a player who is not yet seen, read only from the fields the camera core reports.
 */
import { describe, expect, it } from 'vitest';
import { FINDING_MS, badgeOf, hintOf, isTracking } from '@/practice/ui/camera/hints';
import { NO_READINESS, type PoseReadiness } from '@/practice/ui/camera/ports';
import { SEEN } from './fakeSession';

const r = (patch: Partial<PoseReadiness>): PoseReadiness => ({ ...NO_READINESS, ...patch });

describe('hintOf', () => {
  it('says ok only for a steady person who has not been lost', () => {
    expect(hintOf(SEEN)).toBe('ok');
    expect(hintOf(SEEN, true)).toBe('step_in');
  });

  it('says the picture is dark before anything about position', () => {
    expect(hintOf(r({ poorLight: true, shoulders: true, distance: 'too_close' }))).toBe('dark');
  });

  it('says "looking" at first, and "step into view" once the camera has looked a while or sees only a head', () => {
    expect(hintOf(NO_READINESS)).toBe('finding');
    expect(hintOf(NO_READINESS, false, FINDING_MS)).toBe('step_in');
    expect(hintOf(r({ head: true }))).toBe('step_in');
  });

  it('tells a player who is too close or too far, then about the hands, then to hold still', () => {
    expect(hintOf(r({ shoulders: true, distance: 'too_close' }))).toBe('too_close');
    expect(hintOf(r({ shoulders: true, distance: 'too_far' }))).toBe('too_far');
    expect(hintOf(r({ shoulders: true, distance: 'ok', battingHand: false }))).toBe('arms_out');
    expect(hintOf(r({ shoulders: true, distance: 'ok', battingHand: true, handsReadyZone: false }))).toBe('hands');
    expect(hintOf(r({ shoulders: true, distance: 'ok', battingHand: true, handsReadyZone: true, still: false }))).toBe(
      'hands',
    );
  });

  it('has nothing to add when everything is right but the steady time has not passed', () => {
    expect(
      hintOf(
        r({ shoulders: true, distance: 'ok', battingHand: true, handsReadyZone: true, still: true, ready: false }),
      ),
    ).toBe('finding');
  });
});

describe('badgeOf and isTracking', () => {
  it('is yes in frame, no when something is seen but not in frame, finding when nothing is', () => {
    expect(badgeOf(SEEN)).toBe('yes');
    expect(badgeOf(SEEN, true)).toBe('no');
    expect(badgeOf(r({ shoulders: true }))).toBe('no');
    expect(badgeOf(r({ distance: 'too_far' }))).toBe('no');
    expect(badgeOf(NO_READINESS)).toBe('finding');
  });

  it('tracks a person who is in frame and not lost', () => {
    expect(isTracking(SEEN, false)).toBe(true);
    expect(isTracking(SEEN, true)).toBe(false);
    expect(isTracking(NO_READINESS, false)).toBe(false);
  });
});
