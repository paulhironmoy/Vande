/**
 * Daily compiler: expands a compact, fully authored `DailyCrisis` into a playable `Scenario`.
 * Pure and deterministic (no Date, no Math.random). The shared city, the standard opening events and the
 * opponent plays are generated here so each authored day only carries what makes it distinct.
 */
import type {
  DailyCrisis,
  DailyResolution,
  DailyScenarioId,
  OpponentId,
  PublicMood,
  Scenario,
  ScenarioDecision,
  ScenarioDistrict,
  ScenarioEvent,
  ScenarioRoad,
  Scores,
  OpponentPlay,
} from './types';
import { OPPONENT_IDS } from './types';

export const DAILY_DEFAULT_DURATION = 100;

/** Flag every "listening" option should set; generated pressure events key off it. */
export const ACKNOWLEDGED_FLAG = 'acknowledged';
/** Flag set by the complication event; the bait decision opens on it. */
export const COMPLICATION_FLAG = 'complication-live';

interface CityDistrict {
  id: string;
  name: string;
  kind: ScenarioDistrict['kind'];
  x: number;
  y: number;
  institution?: string;
}

/** The shared city (docs/ARCHITECTURE.md §4). */
export const CITY: readonly CityDistrict[] = [
  { id: 'campus', name: 'University Quarter', kind: 'campus', x: 0.18, y: 0.3, institution: 'University Registrar' },
  { id: 'hospital', name: 'Civil Hospital', kind: 'hospital', x: 0.58, y: 0.12, institution: 'Civil Hospital' },
  { id: 'civic', name: 'Civic Square', kind: 'civic', x: 0.5, y: 0.44, institution: 'District Collectorate' },
  { id: 'market', name: 'Market Street', kind: 'market', x: 0.8, y: 0.34 },
  { id: 'records', name: 'Records Office', kind: 'records', x: 0.22, y: 0.7, institution: 'Election Records Office' },
  { id: 'transit', name: 'Central Transit Hub', kind: 'transit', x: 0.48, y: 0.78, institution: 'Transit Authority' },
  { id: 'media', name: 'Press Enclave', kind: 'media', x: 0.82, y: 0.7, institution: 'Press Club' },
] as const;

export const ROADS: readonly ScenarioRoad[] = [
  { id: 'r-campus-civic', from: 'campus', to: 'civic' },
  { id: 'r-civic-market', from: 'civic', to: 'market' },
  { id: 'r-civic-transit', from: 'civic', to: 'transit' },
  { id: 'r-transit-media', from: 'transit', to: 'media' },
  { id: 'r-market-media', from: 'market', to: 'media' },
  { id: 'r-campus-records', from: 'campus', to: 'records' },
  { id: 'r-records-transit', from: 'records', to: 'transit' },
  { id: 'r-civic-hospital', from: 'civic', to: 'hospital' },
  { id: 'r-market-hospital', from: 'market', to: 'hospital' },
] as const;

const MOOD_BASELINE: Record<PublicMood, { crowd: number; focusCrowd: number; trust: number; services: number }> = {
  calm: { crowd: 0.06, focusCrowd: 0.18, trust: 0.6, services: 0.95 },
  tense: { crowd: 0.1, focusCrowd: 0.3, trust: 0.5, services: 0.9 },
  volatile: { crowd: 0.14, focusCrowd: 0.4, trust: 0.42, services: 0.85 },
  hopeful: { crowd: 0.08, focusCrowd: 0.22, trust: 0.62, services: 0.95 },
};

const MOOD_SCORES: Record<PublicMood, Scores> = {
  calm: { freedom: 62, grievance: 52, safety: 66, evidence: 58, trust: 60, economy: 66 },
  tense: { freedom: 60, grievance: 45, safety: 58, evidence: 55, trust: 53, economy: 62 },
  volatile: { freedom: 57, grievance: 44, safety: 52, evidence: 53, trust: 49, economy: 59 },
  hopeful: { freedom: 64, grievance: 50, safety: 64, evidence: 58, trust: 60, economy: 66 },
};

export function dailyScenarioId(dayId: string): DailyScenarioId {
  return `daily:${dayId}`;
}

function districtName(id: string): string {
  return CITY.find((d) => d.id === id)?.name ?? id;
}

function institutionName(id: string): string {
  return CITY.find((d) => d.id === id)?.institution ?? 'The city office';
}

function buildDistricts(day: DailyCrisis): ScenarioDistrict[] {
  const base = MOOD_BASELINE[day.mood];
  return CITY.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    x: d.x,
    y: d.y,
    institution: d.institution,
    baseline: {
      crowd: d.id === day.focus ? base.focusCrowd : base.crowd,
      trust: base.trust,
      services: base.services,
    },
  }));
}

function openingEvents(day: DailyCrisis, duration: number): ScenarioEvent[] {
  const focus = districtName(day.focus);
  const inst = institutionName(day.institution);
  const crowdMood: ScenarioEvent['mapEffects'] = [
    { kind: 'crowd', district: day.focus, magnitude: 0.2 },
    { kind: 'mood', district: day.focus, mood: day.mood === 'calm' || day.mood === 'hopeful' ? 'tense' : day.mood },
  ];
  return [
    {
      id: 'g-open-gather',
      at: 2,
      kind: 'crowd',
      message: `People gather at ${focus}. Phones are out; the first forwards are already moving.`,
      simple: `People gather at ${focus}.`,
      mapEffects: crowdMood,
    },
    {
      id: 'g-open-institution',
      at: 3,
      kind: 'institution',
      message: `${inst} starts taking calls. Nobody has spoken to the crowd yet.`,
      simple: `${inst} gets the first calls.`,
      mapEffects: [{ kind: 'institution', district: day.institution }],
    },
    {
      id: 'g-pressure-builds',
      at: Math.round(duration * 0.36),
      kind: 'crowd',
      message: `Still no answer from the city. More people arrive at ${focus} and the mood hardens.`,
      simple: `No answer yet. More people come to ${focus}.`,
      condition: { notFlag: ACKNOWLEDGED_FLAG },
      effects: { grievance: -3, trust: -2 },
      mapEffects: [
        { kind: 'crowd', district: day.focus, magnitude: 0.15 },
        { kind: 'mood', district: day.focus, mood: 'volatile' },
      ],
    },
    {
      id: 'g-calm-returns',
      at: Math.round(duration * 0.6),
      kind: 'relief',
      message: `With someone answering for the city, shops around ${focus} reopen and the police lines relax.`,
      simple: `Shops near ${focus} reopen. Things calm down.`,
      condition: { flag: ACKNOWLEDGED_FLAG },
      effects: { safety: 2, economy: 2 },
      mapEffects: [{ kind: 'service', district: day.focus, magnitude: 0.1 }],
    },
    {
      id: 'g-settling',
      at: Math.max(20, duration - 10),
      kind: 'relief',
      message: `The crowd at ${focus} thins. People leave with something to tell the others.`,
      simple: `People start to leave ${focus}, calmer.`,
      condition: { flag: ACKNOWLEDGED_FLAG },
      effects: { trust: 2, grievance: 2 },
      mapEffects: [
        { kind: 'crowd', district: day.focus, magnitude: -0.15 },
        { kind: 'mood', district: day.focus, mood: 'hopeful' },
      ],
    },
  ];
}

interface Generic {
  event: ScenarioEvent;
  play: Omit<OpponentPlay, 'id' | 'target' | 'kind'>;
}

function genericFor(opponent: OpponentId, day: DailyCrisis, duration: number): Generic {
  const focus = districtName(day.focus);
  const late = Math.max(30, duration - 30);
  switch (opponent) {
    case 'exploiter':
      return {
        event: {
          id: 'g-exploiter-surge',
          at: -1,
          kind: 'rumor',
          message: `Someone tells the crowd at ${focus} that nobody is coming. Anger spreads faster than facts.`,
          simple: `Someone tells the crowd that nobody is coming.`,
          effects: { grievance: -3, trust: -2 },
          mapEffects: [{ kind: 'crowd', district: day.focus, magnitude: 0.15 }],
        },
        play: { opponent, earliest: 22, latest: late, weight: 1.2, respondsTo: ['wait'], condition: { notFlag: ACKNOWLEDGED_FLAG } },
      };
    case 'provocateur':
      return {
        event: {
          id: 'g-provocateur-scuffle',
          at: -1,
          kind: 'incident',
          message: `A small group at ${focus} starts pushing and shouting at officers. Most people step back.`,
          simple: `A few people start a shoving match at ${focus}.`,
          effects: { safety: -4 },
          setsFlags: ['scuffle-live'],
          mapEffects: [{ kind: 'incident', district: day.focus, incident: 'clash' }],
        },
        play: { opponent, earliest: 28, latest: late, weight: 1.1, respondsTo: ['force', 'wait'] },
      };
    case 'disinfo':
      return {
        event: {
          id: 'g-disinfo-rumour',
          at: -1,
          kind: 'rumor',
          message: `A new version of the story, with a fake quote attached, jumps from ${focus} into the market groups.`,
          simple: `A made-up quote spreads from ${focus} to the market.`,
          effects: { trust: -2, evidence: -1 },
          mapEffects: [{ kind: 'signal', from: day.focus, to: day.focus === 'market' ? 'civic' : 'market', signal: 'manipulated' }],
        },
        play: { opponent, earliest: 14, latest: late, weight: 1.1, respondsTo: ['communication', 'wait'] },
      };
    case 'sabotage':
      return {
        event: {
          id: 'g-sabotage-outage',
          at: -1,
          kind: 'service',
          message: `The lights and the public screens at ${focus} cut out. It looks deliberate.`,
          simple: `The lights at ${focus} go out. It looks deliberate.`,
          effects: { economy: -3, safety: -2 },
          mapEffects: [
            { kind: 'service', district: day.focus, magnitude: -0.3 },
            { kind: 'incident', district: day.focus, incident: 'outage' },
          ],
        },
        play: { opponent, earliest: 30, latest: late, weight: 1, respondsTo: ['wait', 'service'] },
      };
    case 'overreaction':
    default:
      return {
        event: {
          id: 'g-overreaction-pressure',
          at: -1,
          kind: 'news',
          message: 'Calls for a sweeping response grow louder: clear everyone, ban everything, now.',
          simple: 'Loud voices demand a harsh crackdown.',
          effects: { trust: -1 },
        },
        play: { opponent: 'overreaction', earliest: 34, latest: late, weight: 1, respondsTo: ['force', 'detention', 'suppressive'] },
      };
  }
}

/** Compiles an authored day into a full scenario. The resolution is accepted for symmetry; compilation does not depend on the seed. */
export function compileDaily(day: DailyCrisis, resolution?: DailyResolution): Scenario {
  void resolution;
  const duration = day.duration ?? DAILY_DEFAULT_DURATION;
  const districts = buildDistricts(day);
  const startingScores: Scores = { ...MOOD_SCORES[day.mood], ...(day.startingScores ?? {}) };

  const events: ScenarioEvent[] = [...openingEvents(day, duration), ...(day.events ?? [])];
  const plays: OpponentPlay[] = [];

  // Complication: a play-only event by its opponent; the bait decision opens on the flag it sets.
  const complication = events.find((e) => e.id === day.complication.eventId);
  if (complication) {
    complication.at = -1;
    complication.setsFlags = Array.from(new Set([...(complication.setsFlags ?? []), COMPLICATION_FLAG]));
    plays.push({
      id: 'p-complication',
      opponent: day.complication.opponent,
      kind: 'event',
      target: complication.id,
      earliest: day.complication.earliest,
      latest: day.complication.latest,
      weight: 1.5,
    });
  }

  const decisions: ScenarioDecision[] = day.decisions.map((d) => {
    if (d.id === day.complication.baitDecisionId && d.triggerAt === undefined && d.triggerFlag === undefined) {
      return { ...d, triggerFlag: COMPLICATION_FLAG };
    }
    return { ...d };
  });

  // Evidence-driven plays.
  for (const item of day.evidence) {
    if (item.injectedBy) {
      plays.push({
        id: `p-inject-${item.id}`,
        opponent: item.injectedBy,
        kind: 'inject-evidence',
        target: item.id,
        earliest: 10,
        latest: Math.min(45, duration - 30),
        weight: 1.2,
      });
    }
    if (item.perishable) {
      plays.push({
        id: `p-destroy-${item.id}`,
        opponent: 'sabotage',
        kind: 'destroy-evidence',
        target: item.id,
        earliest: Math.max(16, (item.availableAt ?? 10) + 8),
        latest: Math.min(60, duration - 25),
        respondsTo: ['wait'],
      });
    }
  }

  // Every opponent needs at least one play (the validator requires it); generate a generic one where missing.
  for (const opponent of OPPONENT_IDS) {
    if (plays.some((p) => p.opponent === opponent)) continue;
    const g = genericFor(opponent, day, duration);
    events.push(g.event);
    plays.push({ id: `p-generic-${opponent}`, kind: 'event', target: g.event.id, ...g.play });
  }

  const scenario: Scenario = {
    id: dailyScenarioId(day.id),
    chapter: 1,
    title: day.title,
    subtitle: day.subtitle,
    duration,
    briefing: { ...day.briefing, lines: day.coldOpen },
    startingScores,
    districts,
    roads: ROADS.map((r) => ({ ...r })),
    evidence: day.evidence.map((e) => ({ ...e })),
    decisions,
    rightsMoments: day.rightsMoments.map((r) => ({ ...r })),
    events,
    opponentPlays: plays,
    resolution: day.resolution,
  };
  if (day.simple) {
    const { coldOpen, ...rest } = day.simple;
    scenario.simple = {
      ...rest,
      briefing: rest.briefing ? { ...rest.briefing, lines: coldOpen ?? rest.briefing.lines } : undefined,
    };
    if (!scenario.simple.briefing) delete scenario.simple.briefing;
  }
  return scenario;
}
