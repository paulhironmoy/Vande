/**
 * Why? beside an on-time swing the bat never reached (the lead's item, with COACH's `practice.why.no_reach`): the panel
 * showed "On time" next to "Missed" (416 such results), which reads as a contradiction. Both are true; the timing label
 * stays, and one line says what happened. Both handednesses; the 200% layout is the e2e's (practice-layout.spec.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { CoachAnalysis, ContactKind, Handedness, SwingTiming } from '@/contracts';
import { createPracticeT, loadPracticeCatalog } from '@/i18n/practice';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import { WhyDetails } from '@/practice/ui/components/WhyDetails';
import type { LastBall } from '@/practice/ui/flow/state';
import type { GestureSurfaceProps } from '@/practice/ui/flow/types';
import { attack, quickPlay, setup, until, useFakeTimers } from './flowSetup';

const GestureProbe: ComponentType<GestureSurfaceProps> = () => <div />;
const en = createPracticeT('en', null);

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function why(hand: Handedness, timing: SwingTiming, contact: ContactKind) {
  const value = setup();
  value.flow.init();
  value.swings.push(attack(0.6, 0));
  await quickPlay(value.flow);
  await until(() => value.flow.getState().phase === 'dead');
  const last = value.flow.getState().last as LastBall;
  const record = { ...last.record, handedness: hand };
  const base = value.coach!.analyzeBall(record, last.result);
  const analysis: CoachAnalysis = {
    ...base,
    attempted: {
      ...base.attempted,
      decision: 'attack',
      timing,
      timingErrorMs: timing === 'perfect' ? 0 : timing === 'solid' ? 12 : 60,
      contact,
    },
  };
  const kit = {
    engine: value.engine,
    coach: value.coach,
    createStage: value.createStage,
    input: { GestureSurface: GestureProbe },
    build: { lengthBand: () => 'good', lineBand: () => 'outside_off' },
  } as unknown as PracticeKit;
  render(
    <PracticeKitContext.Provider value={kit}>
      <WhyDetails analysis={analysis} result={last.result} record={record} />
    </PracticeKitContext.Provider>,
  );
  return screen.getByTestId('practice-why');
}

describe('Why?: on time, but the bat never reached the ball', () => {
  for (const hand of ['right', 'left'] as const) {
    for (const contact of ['miss', 'pad', 'body'] as const) {
      it(`${hand}-handed, perfect timing, ${contact}: the line is there, and the timing label stays`, async () => {
        const panel = await why(hand, 'perfect', contact);
        expect(screen.getByTestId('practice-why-no-reach').textContent).toBe(en.t('practice.why.no_reach'));
        expect(panel.textContent).toContain(en.t('practice.timing.on_time'));
        expect(panel.textContent).toContain(en.tk(`practice.contact.${contact}`));
      });
    }
    it(`${hand}-handed, solid timing and a miss: the line is there`, async () => {
      await why(hand, 'solid', 'miss');
      expect(screen.getByTestId('practice-why-no-reach')).toBeTruthy();
    });
    it(`${hand}-handed: not for a mistimed swing, and not when the bat met the ball`, async () => {
      await why(hand, 'mistimed', 'miss');
      expect(screen.queryByTestId('practice-why-no-reach')).toBeNull();
      cleanup();
      await why(hand, 'perfect', 'middle');
      expect(screen.queryByTestId('practice-why-no-reach')).toBeNull();
    });
  }

  it('says it in every Practice language, each in its own words', async () => {
    const texts = new Set<string>();
    for (const locale of ['en', 'hi', 'hi-Latn'] as const) {
      const catalog = locale === 'en' ? null : await loadPracticeCatalog(locale);
      if (locale !== 'en') expect(catalog?.['practice.why.no_reach'], locale).toBeTruthy();
      texts.add(createPracticeT(locale, catalog).t('practice.why.no_reach'));
    }
    expect(texts.size).toBe(3);
  });
});
