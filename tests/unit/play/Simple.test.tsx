import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DecisionCard } from '@/components/play/DecisionCard';
import { EvidenceCard } from '@/components/play/EvidenceCard';
import { RightsMomentCard } from '@/components/play/RightsMomentCard';
import { FeedbackStrip } from '@/components/play/FeedbackStrip';
import { decision, decisionState, evidenceItem, evidenceState, rightsMoment } from './fixtures';
import type { ActionFeedback, ScenarioDecision } from '@/engine/types';

afterEach(cleanup);

const simpleDecision: ScenarioDecision = {
  ...decision,
  simple: {
    title: 'People think the exam paper leaked',
    situation: 'A picture of the test is going around. Students are gathering at the University.',
    options: {
      'opt-investigate': { title: 'Get a fair team to check the paper', preview: 'A team starts checking today.', consequence: 'A fair team is now checking.' },
      'opt-arrest': { title: 'Lock up the student who shared the picture', preview: 'Police pick up the student tonight.' },
      wait: { title: 'Wait and see', preview: 'Nothing changes yet. The rumour keeps going.' },
    },
  },
};

const warnings = {
  'opt-investigate': { level: 'none' as const, text: '' },
  'opt-arrest': { level: 'warning' as const, text: 'Relies on evidence that has not been verified.' },
  wait: { level: 'none' as const, text: '' },
};

describe('Simple play style — DecisionCard', () => {
  it('uses the plain-language copy, hides legal citations and rewords the warning', () => {
    render(<DecisionCard decision={simpleDecision} state={decisionState} tick={20} warnings={warnings} onChoose={() => {}} simple />);
    expect(screen.getByText('People think the exam paper leaked')).toBeTruthy();
    expect(screen.getByText('Get a fair team to check the paper')).toBeTruthy();
    expect(screen.queryByText('Article 21 — liberty and due process')).toBeNull();
    expect(screen.queryByText(/Duty to investigate fairly/)).toBeNull();
    expect(screen.getByTestId('confidence-warning').textContent).toContain("haven't checked this clue yet");
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByTestId('decision-option-opt-investigate')).toBeTruthy();
  });

  it('falls back to the full copy when no simple layer exists', () => {
    render(<DecisionCard decision={decision} state={decisionState} tick={20} warnings={warnings} onChoose={() => {}} simple />);
    expect(screen.getByText(decision.title)).toBeTruthy();
    expect(screen.getByText(decision.options[0].title)).toBeTruthy();
    expect(screen.queryByText('Article 21 — liberty and due process')).toBeNull();
  });

  it('keeps the full presentation when simple is off', () => {
    render(<DecisionCard decision={simpleDecision} state={decisionState} tick={20} warnings={warnings} onChoose={() => {}} />);
    expect(screen.getByText(decision.title)).toBeTruthy();
    expect(screen.getByText('Article 21 — liberty and due process')).toBeTruthy();
  });
});

describe('Simple play style — EvidenceCard', () => {
  it('shows plain state labels', () => {
    const { rerender } = render(
      <ul>
        <EvidenceCard item={evidenceItem} state={evidenceState} onOpen={() => {}} simple />
      </ul>,
    );
    expect(screen.getByText('Not checked yet')).toBeTruthy();
    rerender(
      <ul>
        <EvidenceCard item={evidenceItem} state={{ ...evidenceState, state: 'manipulated', preserved: true }} onOpen={() => {}} simple />
      </ul>,
    );
    expect(screen.getByText('Fake')).toBeTruthy();
    expect(screen.getByText('Kept safe')).toBeTruthy();
  });
});

describe('Simple play style — RightsMomentCard', () => {
  it('shows the Fair play heading and keeps the exact disclaimer', () => {
    const moment = { ...rightsMoment, simple: { question: 'Some people were peaceful. Can you send them all home?', options: { 'rm-a': 'Yes, everyone must go.', 'rm-b': 'Only if there is real proof of danger.', 'rm-c': 'Yes, if a shop owner asks.' }, principle: 'People may gather peacefully.', why: 'Sending everyone home would punish people who did nothing wrong.' } };
    render(<RightsMomentCard moment={moment} answeredOptionId="rm-b" onChoose={() => {}} onContinue={() => {}} simple />);
    expect(screen.getByText('Fair play moment')).toBeTruthy();
    expect(screen.getByText('Some people were peaceful. Can you send them all home?')).toBeTruthy();
    expect(screen.getByText('Educational content—not legal advice')).toBeTruthy();
    expect(screen.getByText('Read the real rule (for grown-ups)')).toBeTruthy();
    expect(screen.getByText('People may gather peacefully.')).toBeTruthy();
  });
});

describe('Simple play style — FeedbackStrip', () => {
  it('adds an encouraging line derived from direction, never from numbers', () => {
    const feedback: ActionFeedback = { tick: 20, title: 'Open an independent review of the paper', text: 'The review panel is announced.', dims: ['trust', 'grievance'], direction: { trust: 'up', grievance: 'up' } };
    const { container } = render(<FeedbackStrip feedback={feedback} onDismiss={() => {}} simple simpleOverride={{ title: 'Get a fair team to check the paper', text: 'A fair team is now checking.' }} />);
    expect(screen.getByText('Get a fair team to check the paper')).toBeTruthy();
    expect(screen.getByTestId('feedback-cheer').textContent).toBe('Nice. People trust you more.');
    expect(container.textContent).not.toMatch(/[+-]\s?\d+/);
  });
});

describe('Simple play style — clock waiting banner', () => {
  it('renders when the store reports an automatic pause', async () => {
    vi.resetModules();
    vi.doMock('@/app/store', () => {
      const state = {
        dispatch: vi.fn(),
        autoPaused: true,
        settings: { playStyle: 'simple' },
        game: undefined,
      };
      const useApp = Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state });
      return { useApp };
    });
    const { DecisionArea } = await import('@/screens/Play/DecisionArea');
    const { getScenario, createGame, reduce, tick } = await import('@/engine');
    const scenario = getScenario('examination-crisis');
    let game = createGame({ scenarioId: 'examination-crisis', seed: 7, difficulty: 'standard', opponents: ['exploiter'], mode: 'campaign' }, scenario);
    game = reduce(game, { type: 'start', tick: 0 }, scenario);
    game = tick(game, scenario, 10);
    game = reduce(game, { type: 'pause', tick: game.tick }, scenario);
    render(<DecisionArea game={game} scenario={scenario} layout="stack" unexaminedEvidence={0} onOpenEvidence={() => {}} sheetOpen={false} />);
    expect(screen.getByTestId('clock-waiting').textContent).toContain('The clock is waiting for you');
    const options = screen.getAllByRole('button').filter((b) => b.getAttribute('data-testid')?.startsWith('decision-option-'));
    expect(options.length).toBeGreaterThan(0);
    expect((options[0] as HTMLButtonElement).disabled).toBe(false);
    vi.doUnmock('@/app/store');
  });
});
