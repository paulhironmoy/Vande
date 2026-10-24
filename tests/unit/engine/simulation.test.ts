import { describe, expect, it } from 'vitest';
import { MINI } from '../fixtures/mini-scenario';
import { createGame, reduce, tick, timeLeft } from '../../../src/engine/simulation';
import { evidenceActions, confidenceWarning } from '../../../src/engine/evidence';
import { derivePulse } from '../../../src/engine/pulse';
import { deriveMapState } from '../../../src/engine/mapState';
import type { GameConfig, GameState, OpponentId, PlayerAction } from '../../../src/engine/types';

const base: GameConfig = { scenarioId: 'examination-crisis', seed: 2024, difficulty: 'standard', opponents: ['disinfo', 'exploiter'], mode: 'campaign' };

function start(config: Partial<GameConfig> = {}): GameState {
  const g = createGame({ ...base, ...config }, MINI);
  return reduce(g, { type: 'start', tick: 0 }, MINI);
}

function runTo(state: GameState, target: number): GameState {
  return tick(state, MINI, target - state.tick);
}

function play(state: GameState, actions: PlayerAction[], until: number): GameState {
  let s = state;
  const sorted = [...actions].sort((a, b) => a.tick - b.tick);
  for (const a of sorted) {
    s = runTo(s, a.tick);
    s = reduce(s, a, MINI);
  }
  return runTo(s, until);
}

describe('createGame', () => {
  it('starts in briefing with the scenario scores and canonical opponents', () => {
    const g = createGame(base, MINI);
    expect(g.status).toBe('briefing');
    expect(g.scores).toEqual(MINI.startingScores);
    expect(g.config.opponents).toEqual(['exploiter', 'disinfo']);
    expect(Object.keys(g.opponents)).toEqual(['exploiter', 'disinfo']);
    expect(g.history).toHaveLength(1);
    expect(Object.values(g.evidence).every((e) => !e.visible)).toBe(true);
  });

  it('uses carried scores when provided', () => {
    const g = createGame({ ...base, carryScores: { freedom: 70, grievance: 40, safety: 61, evidence: 52, trust: 58, economy: 66 } }, MINI);
    expect(g.scores.freedom).toBe(70);
  });

  it('ticks do nothing before start and while paused', () => {
    const g = createGame(base, MINI);
    expect(tick(g, MINI, 10)).toBe(g);
    const running = reduce(g, { type: 'start', tick: 0 }, MINI);
    const paused = reduce(tick(running, MINI, 3), { type: 'pause', tick: 3 }, MINI);
    expect(paused.status).toBe('paused');
    expect(tick(paused, MINI, 5).tick).toBe(3);
    const resumed = reduce(paused, { type: 'resume', tick: 3 }, MINI);
    expect(tick(resumed, MINI, 2).tick).toBe(5);
    expect(timeLeft(tick(resumed, MINI, 2))).toBe(55);
  });
});

describe('determinism', () => {
  const script: PlayerAction[] = [
    { type: 'evidence', tick: 5, evidenceId: 'ev-true', verb: 'compare', compareWith: 'ev-official' },
    { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' },
    { type: 'decide', tick: 11, decisionId: 'd-expire', optionId: 'o-act' },
    { type: 'rights', tick: 12, momentId: 'rm-1', optionId: 'r-a' },
    { type: 'evidence', tick: 14, evidenceId: 'ev-fake', verb: 'inspect' },
    { type: 'decide', tick: 16, decisionId: 'd-accuse', optionId: 'o-wait' },
  ];

  it('identical config and actions produce deep-equal states', () => {
    const a = play(start(), script, 60);
    const b = play(start(), script, 60);
    expect(a).toEqual(b);
    expect(a.status).toBe('ended');
    expect(a.log).toHaveLength(script.length + 1);
  });

  it('opponent selection order does not change the game', () => {
    const a = play(start({ opponents: ['disinfo', 'exploiter'] }), script, 60);
    const b = play(start({ opponents: ['exploiter', 'disinfo'] }), script, 60);
    expect(a).toEqual(b);
  });

  it('a different seed changes opponent timing', () => {
    const a = createGame({ ...base, difficulty: 'standard', opponents: ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'], seed: 1 }, MINI);
    const b = createGame({ ...base, difficulty: 'standard', opponents: ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'], seed: 2 }, MINI);
    expect(JSON.stringify(a.opponents)).not.toBe(JSON.stringify(b.opponents));
  });

  it('severe schedules every play; measured schedules no more than severe', () => {
    const all: OpponentId[] = ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'];
    const severe = createGame({ ...base, difficulty: 'severe', opponents: all }, MINI);
    const count = (g: GameState) => Object.values(g.opponents).reduce((n, o) => n + Object.keys(o.schedule).length, 0);
    expect(count(severe)).toBe(MINI.opponentPlays.length);
    expect(severe.opponents.exploiter.intensity).toBe(1.25);
    const measured = createGame({ ...base, difficulty: 'measured', opponents: all }, MINI);
    expect(count(measured)).toBeLessThanOrEqual(count(severe));
    expect(Object.keys(measured.opponents.exploiter.schedule)).not.toContain('p-exploiter-late');
  });
});

describe('evidence state machine', () => {
  it('walks all five confidence states', () => {
    let s = runTo(start(), 5);
    expect(s.evidence['ev-true'].state).toBe('unverified');
    expect(s.evidence['ev-official'].state).toBe('verified');
    expect(s.evidence['ev-fake'].visible).toBe(true);
    s = reduce(s, { type: 'evidence', tick: 5, evidenceId: 'ev-true', verb: 'compare', compareWith: 'ev-official' }, MINI);
    expect(s.evidence['ev-true'].state).toBe('verified');
    s = reduce(s, { type: 'evidence', tick: 5, evidenceId: 'ev-press', verb: 'compare', compareWith: 'ev-true' }, MINI);
    expect(s.evidence['ev-press'].state).toBe('corroborated');
    s = reduce(s, { type: 'evidence', tick: 5, evidenceId: 'ev-fake', verb: 'inspect' }, MINI);
    expect(s.evidence['ev-fake'].state).toBe('manipulated');
    expect(s.flags['fake-exposed']).toBe(true);
    expect(s.stats.manipulationsDetected).toBe(1);
    s = reduce(s, { type: 'evidence', tick: 5, evidenceId: 'ev-unknowable', verb: 'compare', compareWith: 'ev-official' }, MINI);
    expect(s.evidence['ev-unknowable'].state).toBe('unknown');
    expect(s.stats.evidenceResolved).toBe(4);
    expect(s.scores.evidence).toBeGreaterThan(MINI.startingScores.evidence);
  });

  it('compare without an available source is a no-op and the UI gets a hint', () => {
    const s = runTo(start(), 3);
    const actions = evidenceActions(s, MINI, 'ev-true');
    const compare = actions.find((a) => a.verb === 'compare');
    expect(compare?.enabled).toBe(false);
    expect(compare?.hint).toMatch(/No other source/);
    expect(reduce(s, { type: 'evidence', tick: 3, evidenceId: 'ev-true', verb: 'compare' }, MINI)).toBe(s);
    const later = runTo(s, 4);
    const laterCompare = evidenceActions(later, MINI, 'ev-true').find((a) => a.verb === 'compare');
    expect(laterCompare?.enabled).toBe(true);
    expect(laterCompare?.compareWith).toBe('ev-official');
  });

  it('preserve and unresolved markers toggle', () => {
    let s = runTo(start(), 3);
    s = reduce(s, { type: 'evidence', tick: 3, evidenceId: 'ev-true', verb: 'preserve' }, MINI);
    expect(s.evidence['ev-true'].preserved).toBe(true);
    expect(s.stats.evidencePreserved).toBe(1);
    s = reduce(s, { type: 'evidence', tick: 3, evidenceId: 'ev-true', verb: 'unresolved' }, MINI);
    expect(s.evidence['ev-true'].markedUnresolved).toBe(true);
    s = reduce(s, { type: 'evidence', tick: 3, evidenceId: 'ev-true', verb: 'clear-unresolved' }, MINI);
    expect(s.evidence['ev-true'].markedUnresolved).toBe(false);
  });

  it('sabotage destroys perishable evidence unless preserved', () => {
    const lost = runTo(start({ opponents: ['sabotage'] }), 16);
    expect(lost.evidence['ev-true'].destroyed).toBe(true);
    expect(lost.stats.evidenceDestroyed).toBe(1);
    expect(lost.feed.some((f) => f.kind === 'opponent' && /destroyed/.test(f.text))).toBe(true);
    let kept = runTo(start({ opponents: ['sabotage'] }), 3);
    kept = reduce(kept, { type: 'evidence', tick: 3, evidenceId: 'ev-true', verb: 'preserve' }, MINI);
    kept = runTo(kept, 16);
    expect(kept.evidence['ev-true'].destroyed).toBe(false);
    expect(kept.feed.some((f) => /failed/.test(f.text))).toBe(true);
  });
});

describe('decisions', () => {
  it('a false accusation damages freedom and trust and is recorded', () => {
    let s = runTo(start(), 6);
    expect(s.pendingDecisionIds).toContain('d-accuse');
    const option = MINI.decisions[0].options[0];
    expect(confidenceWarning(s, MINI, option).level).toBe('caution');
    const before = s.scores;
    s = reduce(s, { type: 'decide', tick: 6, decisionId: 'd-accuse', optionId: 'o-accuse' }, MINI);
    expect(s.scores.freedom).toBeLessThan(before.freedom);
    expect(s.scores.trust).toBeLessThan(before.trust);
    expect(s.stats.falseAccusations).toBe(1);
    expect(s.decisions['d-accuse'].falseAccusation).toBe(true);
    expect(s.decisions['d-accuse'].unverifiedBasis).toBe(true);
    expect(s.lastFeedback?.warning).toBe('false-accusation');
    expect(s.undo).toBeUndefined();
  });

  it('exposing the manipulation first prevents the false accusation penalty', () => {
    let s = runTo(start(), 6);
    s = reduce(s, { type: 'evidence', tick: 6, evidenceId: 'ev-fake', verb: 'inspect' }, MINI);
    expect(confidenceWarning(s, MINI, MINI.decisions[0].options[0]).level).toBe('warning');
    s = reduce(s, { type: 'decide', tick: 6, decisionId: 'd-accuse', optionId: 'o-accuse' }, MINI);
    expect(s.stats.falseAccusations).toBe(0);
    expect(s.decisions['d-accuse'].falseAccusation).toBeUndefined();
  });

  it('force without an active threat is disproportionate; with one it is not', () => {
    let s = runTo(start(), 9);
    const before = s.scores;
    const early = reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-force' }, MINI);
    expect(early.decisions['d-force'].disproportionate).toBe(true);
    expect(early.stats.disproportionateActions).toBe(1);
    expect(early.scores.freedom).toBeLessThan(before.freedom);
    expect(early.scores.trust).toBeLessThan(before.trust);
    expect(early.lastFeedback?.warning).toBe('disproportionate');
    s = runTo(s, 31);
    expect(s.flags['violence-active']).toBe(true);
    expect(s.districts.civic.incident).toBe('clash');
    const late = reduce(s, { type: 'decide', tick: 31, decisionId: 'd-force', optionId: 'o-force' }, MINI);
    expect(late.decisions['d-force'].disproportionate).toBeUndefined();
    expect(late.stats.disproportionateActions).toBe(0);
    expect(late.scores.safety).toBeGreaterThan(s.scores.safety);
    expect(late.districts.campus.lastAction?.kind).toBe('deploy');
  });

  it('an always-disproportionate bait option is penalised', () => {
    let s = runTo(start({ opponents: ['overreaction'], difficulty: 'severe' }), 20);
    expect(s.pendingDecisionIds).toContain('d-bait');
    expect(s.feed.some((f) => f.kind === 'opponent' && /shutdown/.test(f.text))).toBe(true);
    const before = s.scores.freedom;
    s = reduce(s, { type: 'decide', tick: 20, decisionId: 'd-bait', optionId: 'o-shutdown' }, MINI);
    expect(s.scores.freedom).toBeLessThan(before - 10);
    expect(s.stats.disproportionateActions).toBe(1);
  });

  it('expired decisions resolve with the default option', () => {
    const s = runTo(start(), 15);
    const ds = s.decisions['d-expire'];
    expect(ds.status).toBe('expired');
    expect(ds.chosenOption).toBe('o-idle');
    expect(ds.auto).toBe(true);
    expect(s.stats.decisionsExpired).toBe(1);
    expect(s.pendingDecisionIds).not.toContain('d-expire');
  });

  it('delayed effects fire when due', () => {
    let s = runTo(start(), 9);
    s = reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' }, MINI);
    const g0 = s.scores.grievance;
    expect(s.delayed).toHaveLength(1);
    s = runTo(s, 13);
    expect(s.scores.grievance).toBe(g0);
    s = runTo(s, 14);
    expect(s.scores.grievance).toBe(g0 + 4);
    expect(s.delayed).toHaveLength(0);
    expect(s.feed.some((f) => f.kind === 'delayed')).toBe(true);
    expect(runTo(s, 31).flags['violence-active']).toBeUndefined();
  });

  it('undo reverses a reversible decision within its window', () => {
    let s = runTo(start(), 9);
    const trust0 = s.scores.trust;
    s = reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' }, MINI);
    expect(s.undo?.decisionId).toBe('d-force');
    expect(s.pendingRightsIds).toContain('rm-1');
    s = runTo(s, 11);
    s = reduce(s, { type: 'undo', tick: 11 }, MINI);
    expect(s.scores.trust).toBe(trust0);
    expect(s.flags['talks-open']).toBeUndefined();
    expect(s.delayed).toHaveLength(0);
    expect(s.decisions['d-force'].status).toBe('pending');
    expect(s.pendingDecisionIds).toContain('d-force');
    expect(s.pendingRightsIds).not.toContain('rm-1');
    expect(s.undo).toBeUndefined();
    expect(s.stats.decisionsMade).toBe(0);
  });

  it('undo is refused after the window closes', () => {
    let s = runTo(start(), 9);
    s = reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' }, MINI);
    s = runTo(s, 15);
    expect(s.undo).toBeUndefined();
    expect(reduce(s, { type: 'undo', tick: 15 }, MINI)).toBe(s);
  });

  it('rights moments reward the correct principle', () => {
    let s = runTo(start(), 9);
    s = reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' }, MINI);
    const trust0 = s.scores.trust;
    expect(s.stats.rightsTotal).toBe(1);
    s = reduce(s, { type: 'rights', tick: 9, momentId: 'rm-1', optionId: 'r-a' }, MINI);
    expect(s.rights['rm-1'].correct).toBe(true);
    expect(s.stats.rightsCorrect).toBe(1);
    expect(s.scores.trust).toBe(trust0 + 2);
    expect(s.pendingRightsIds).toHaveLength(0);
  });

  it('invalid actions leave the state untouched', () => {
    const s = runTo(start(), 9);
    expect(reduce(s, { type: 'decide', tick: 9, decisionId: 'nope', optionId: 'o-force' }, MINI)).toBe(s);
    expect(reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'nope' }, MINI)).toBe(s);
    expect(reduce(s, { type: 'evidence', tick: 9, evidenceId: 'ev-press', verb: 'inspect' }, MINI)).not.toBe(s);
    expect(reduce(s, { type: 'evidence', tick: 9, evidenceId: 'missing', verb: 'inspect' }, MINI)).toBe(s);
  });
});

describe('opponents adapt', () => {
  it('a provocateur play is pulled earlier after force', () => {
    let s = runTo(start({ opponents: ['provocateur'], difficulty: 'severe' }), 9);
    const scheduled = s.opponents.provocateur.schedule['p-provocateur-event'];
    expect(scheduled).toBeGreaterThanOrEqual(8);
    expect(scheduled).toBeLessThanOrEqual(30);
    if (scheduled <= 9) s = runTo(start({ opponents: ['provocateur'], difficulty: 'severe', seed: 11 }), 9);
    const before = s.opponents.provocateur.schedule['p-provocateur-event'];
    s = reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-force' }, MINI);
    expect(s.opponents.provocateur.memory).toContain('force');
    const after = s.opponents.provocateur.schedule['p-provocateur-event'];
    expect(after).toBe(Math.max(11, before - 10));
    expect(s.flags['_adapted:p-provocateur-event']).toBe(true);
    s = runTo(s, after);
    expect(s.districts.market.incident).toBe('vandalism');
    expect(s.opponents.provocateur.fired).toContain('p-provocateur-event');
    expect(s.scores.safety).toBeLessThan(MINI.startingScores.safety + 6);
  });

  it('a dormant play becomes guaranteed when the player keeps waiting', () => {
    let s = runTo(start({ opponents: ['exploiter'] }), 9);
    const copy: GameState = JSON.parse(JSON.stringify(s));
    delete copy.opponents.exploiter.schedule['p-exploiter-event'];
    s = reduce(copy, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-hold' }, MINI);
    const at = s.opponents.exploiter.schedule['p-exploiter-event'];
    expect(at).toBeGreaterThanOrEqual(25);
    expect(at).toBeLessThanOrEqual(31);
  });
});

describe('chapter end and derived views', () => {
  it('ends at the duration, auto-resolving pending decisions', () => {
    const s = runTo(start(), 60);
    expect(s.status).toBe('ended');
    expect(s.pendingDecisionIds).toHaveLength(0);
    expect(Object.values(s.decisions).every((d) => d.status !== 'pending')).toBe(true);
    expect(s.history[s.history.length - 1].tick).toBe(60);
    expect(tick(s, MINI, 5)).toBe(s);
    expect(reduce(s, { type: 'decide', tick: 60, decisionId: 'd-force', optionId: 'o-force' }, MINI)).toBe(s);
  });

  it('pulse and map state reflect the city', () => {
    let s = runTo(start(), 9);
    s = reduce(s, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-force' }, MINI);
    const pulse = derivePulse(s);
    expect(pulse.balance).toBeGreaterThan(0);
    expect(pulse.balance).toBeLessThanOrEqual(1);
    expect(['rising', 'steady', 'falling']).toContain(pulse.direction);
    expect(pulse.momentum.freedom).toBeLessThan(0);
    const map = deriveMapState(s, MINI, 'campus');
    expect(map.focus).toBe('campus');
    expect(map.districts).toHaveLength(3);
    expect(map.districts.find((d) => d.id === 'campus')?.lastAction?.kind).toBe('deploy');
    expect(map.recentActions).toHaveLength(1);
    expect(map.districts.find((d) => d.id === 'civic')?.pendingDecisions).toBe(1);
    expect(map.health).toBeGreaterThan(0);
    const crowd0 = runTo(start(), 1).districts.campus.crowd;
    expect(crowd0).toBeCloseTo(0.5, 2);
  });
});
