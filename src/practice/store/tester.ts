/**
 * The hidden tester mode's records (Practice settings → diagnostics → tester mode), for the user's own playtests
 * (release/player-experience/shared/playtest/). On this device only, exported as JSON, never sent. No names and no
 * free text: closed codes only. Nothing is stored before the facilitator records consent, nothing is ever estimated or
 * filled in, and a skipped question records nothing. Objective facts (the delivery's real line, length and movement,
 * the read of every gesture, retry results) are stored beside the answers so the study can score them.
 */
import { PRACTICE_KEYS, isObj, localStore, readJson, writeJson, type KeyStore } from './storage';
import { TESTER_ANSWERS, type TesterQuestion } from './testerQuestions';

export * from './testerQuestions';

export type TesterCohort = 'rookie' | 'rookie_fan' | 'rookie_gamer' | 'expert' | 'informed_expert';
export const TESTER_COHORTS: readonly TesterCohort[] = ['rookie', 'rookie_fan', 'rookie_gamer', 'expert', 'informed_expert'];

export type GestureClass = 'tap' | 'flick_ground' | 'flick_lofted' | 'key' | 'leave';
export type MarkerCode = 'help' | 'confusion' | 'prompted' | 'asked_to_continue' | 'exploit' | 'explained_outcome' | 'task_check' | 'end_session';

/** Events in order; `t` is ms since the session began. */
export type TesterEvent =
  | { t: number; type: 'tap'; screen: string; id: string }
  | {
      t: number;
      type: 'gesture';
      pointer: string;
      cls: GestureClass;
      dwellMs: number | null;
      durMs: number | null;
      lenFrac: number | null;
      travelling: boolean | null;
      swing: { kind: string; directionDeg: number; power: number; elevation: number; footwork: string } | null;
      movedAfterTapDecision: boolean | null;
    }
  | {
      t: number;
      type: 'ball';
      over: number;
      ball: number;
      kind: 'innings' | 'retry';
      variation: string;
      runs: number;
      dismissal: string | null;
      timing: string;
      contact: string;
      timingErrorMs: number | null;
      exitBearingDeg: number | null;
      intendedBearingDeg: number | null;
      exitElevationDeg: number | null;
      assist: string;
      toleranceMs: number;
      tier: string;
      source: string;
      whyOpened: boolean;
      replayOpened: boolean;
      demoWatched: boolean;
    }
  | { t: number; type: 'retry'; attempt: number; success: boolean; verdict: string | null }
  | { t: number; type: 'next_over'; action: 'same' | 'harder' | 'different' | 'exit'; choiceMs: number; voluntary: boolean }
  | { t: number; type: 'marker'; code: MarkerCode; reason?: string; value?: string }
  | { t: number; type: 'abandon'; over: number; ball: number };

export interface TesterAnswer {
  q: TesterQuestion;
  a: string;
  /** Line, length, movement, pace or spin: what the delivery really did (from the physics). */
  truth?: string;
  ctx?: Record<string, string | number>;
}

export interface TesterSession {
  id: string;
  consent: true;
  cohort: TesterCohort;
  /** The hand the player says they bat with (separate from the setting). */
  handReported: 'left' | 'right' | null;
  /** Local date and time the session began (ISO 8601). */
  startedAt: string;
  appVersion: string;
  build: string;
  simVersion: number;
  locale: string;
  device: { graphics: string; screen: string; input: string };
  hand: string;
  assist: string;
  calibration: { touch: number | null; mouse: number | null; keyboard: number | null };
  /** Practice opening → the first ball the player could control (its release with the batting area armed). */
  ttfcdMs: number | null;
  events: TesterEvent[];
  answers: TesterAnswer[];
}

interface Saved {
  v: 2;
  enabled: boolean;
  sessions: TesterSession[];
}

const MAX_SESSIONS = 50;
const MAX_EVENTS = 4000;
const MAX_ANSWERS = 600;
const str = (v: unknown): v is string => typeof v === 'string' && v.length < 200;

function isTesterAnswer(v: unknown): v is TesterAnswer {
  if (!isObj(v) || !str(v.q) || !(v.q in TESTER_ANSWERS) || !str(v.a)) return false;
  return (TESTER_ANSWERS[v.q as TesterQuestion] as readonly string[]).includes(v.a) && (v.truth === undefined || str(v.truth));
}

function isSession(v: unknown): v is TesterSession {
  return isObj(v) && str(v.id) && v.consent === true && TESTER_COHORTS.includes(v.cohort as TesterCohort) && str(v.startedAt) && Array.isArray(v.events) && Array.isArray(v.answers);
}

function load(store: KeyStore | null): Saved {
  const raw = readJson(store, PRACTICE_KEYS.tester);
  if (!isObj(raw) || raw.v !== 2) return { v: 2, enabled: isObj(raw) && raw.enabled === true, sessions: [] };
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.filter(isSession).map((s) => ({ ...s, answers: s.answers.filter(isTesterAnswer).slice(-MAX_ANSWERS), events: s.events.filter(isObj).slice(-MAX_EVENTS) as TesterEvent[] })) : [];
  return { v: 2, enabled: raw.enabled === true, sessions };
}

function save(next: Saved, store: KeyStore | null): boolean {
  return writeJson(store, PRACTICE_KEYS.tester, { ...next, sessions: next.sessions.slice(-MAX_SESSIONS) });
}

export function testerEnabled(store: KeyStore | null = localStore()): boolean {
  return load(store).enabled;
}

export function setTesterEnabled(on: boolean, store: KeyStore | null = localStore()): void {
  save({ ...load(store), enabled: on }, store);
}

export function testerSessions(store: KeyStore | null = localStore()): TesterSession[] {
  return load(store).sessions;
}

/** Begins a session once the facilitator has recorded consent (never before). */
export function startTesterSession(session: Omit<TesterSession, 'events' | 'answers'>, store: KeyStore | null = localStore()): boolean {
  if (session.consent !== true) return false;
  const saved = load(store);
  if (saved.sessions.some((s) => s.id === session.id)) return true;
  return save({ ...saved, sessions: [...saved.sessions, { ...session, events: [], answers: [] }] }, store);
}

function update(id: string, store: KeyStore | null, change: (s: TesterSession) => TesterSession): boolean {
  const saved = load(store);
  const i = saved.sessions.findIndex((s) => s.id === id);
  if (i < 0) return false;
  const sessions = [...saved.sessions];
  sessions[i] = change(sessions[i]);
  return save({ ...saved, sessions }, store);
}

/** Records one answer; an answer outside the question's closed set is refused (false). */
export function recordTesterAnswer(id: string, answer: TesterAnswer, store: KeyStore | null = localStore()): boolean {
  if (!isTesterAnswer(answer)) return false;
  return update(id, store, (s) => ({ ...s, answers: [...s.answers, answer].slice(-MAX_ANSWERS) }));
}

export function recordTesterEvent(id: string, event: TesterEvent, store: KeyStore | null = localStore()): boolean {
  return update(id, store, (s) => ({ ...s, events: [...s.events, event].slice(-MAX_EVENTS) }));
}

export function setTesterSessionField(id: string, patch: Partial<Pick<TesterSession, 'ttfcdMs' | 'calibration' | 'device'>>, store: KeyStore | null = localStore()): boolean {
  return update(id, store, (s) => ({ ...s, ...patch }));
}

export function clearTesterData(store: KeyStore | null = localStore()): void {
  save({ v: 2, enabled: load(store).enabled, sessions: [] }, store);
}

/** The export file's content: every session as recorded, nothing derived or estimated. */
export function testerExport(store: KeyStore | null = localStore(), exportedAt = new Date()): string {
  const sessions = load(store).sessions;
  return JSON.stringify({ format: 'vande-practice-tester', version: 2, exportedAt: exportedAt.toISOString(), sessions }, null, 2);
}

/** How many answers and events are stored (0 means there is nothing to export). */
export function testerAnswerCount(store: KeyStore | null = localStore()): number {
  return load(store).sessions.reduce((n, s) => n + s.answers.length + s.events.length, 0);
}
