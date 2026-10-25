/**
 * Validator for the Lite twist pool (src/content/lite/twists.json). It checks everything a machine can: ids,
 * word limits, option ids, a single valid best, tags for move twists (and none for fair-play twists), that the kind
 * matches the best option's card kind, and a denylist of political, religious, caste and place names. The JSON
 * schema (src/content/lite/twists.schema.json) mirrors the structural part.
 */
import { actionKindOf } from '@/components/game/cards/actionKind';
import type { ActionTag } from '@/engine/types';
import type { TwistKind, TwistPool } from './contracts';

export const TWIST_LIMITS = { titleWords: 6, situationWords: 30, optionWords: 7, whyWords: 20, minOptions: 3, maxOptions: 4 } as const;

export const TWIST_KINDS: readonly TwistKind[] = ['talk', 'check', 'protect', 'enforce', 'restrict', 'wait', 'rule'];

const ACTION_TAGS: readonly ActionTag[] = [
  'proportionate',
  'disproportionate',
  'suppressive',
  'force',
  'detention',
  'accusation',
  'transparent',
  'investigative',
  'dialogue',
  'service',
  'communication',
  'legal-process',
  'protect-press',
  'protect-assembly',
  'wait',
  'censorship',
  'relief',
];

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;
const ID_RE = /^t([1-9][0-9]{0,2}|1[01][0-9]{2}|12[0-8][0-9]|129[0-5])$/;
const TWIST_KEYS = new Set(['id', 'kind', 'title', 'situation', 'options', 'best', 'why', 'retired']);
const OPTION_KEYS = new Set(['id', 'title', 'tags']);

/**
 * Words that must never appear: real parties and politicians, religions and places of worship, caste words, real
 * cities and regions, and the Chapter 1 situation itself (twists are new places with new people).
 */
export const TWIST_DENYLIST: readonly string[] = [
  'bjp',
  'congress',
  'aap',
  'shiv sena',
  'trinamool',
  'tmc',
  'cpi',
  'cpm',
  'bsp',
  'dmk',
  'aiadmk',
  'modi',
  'gandhi',
  'nehru',
  'kejriwal',
  'rahul',
  'mamata',
  'yogi',
  'hindu',
  'muslim',
  'islam',
  'christian',
  'sikh',
  'jain',
  'buddhist',
  'dalit',
  'brahmin',
  'caste',
  'temple',
  'mosque',
  'church',
  'gurdwara',
  'delhi',
  'mumbai',
  'kolkata',
  'chennai',
  'bengaluru',
  'bangalore',
  'hyderabad',
  'kashmir',
  'ayodhya',
  'pakistan',
  'china',
  'exam',
  'question paper',
];

const DENY_RE = new RegExp(`\\b(${TWIST_DENYLIST.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})\\b`, 'i');

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Word count: whitespace-separated tokens. */
export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function validateTwistPool(json: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  if (!isObj(json)) return { ok: false, errors: ['pool: must be an object'] };
  for (const k of Object.keys(json)) if (k !== 'version' && k !== 'twists') err(`pool.${k}`, 'unknown key');
  if (!Number.isInteger(json.version) || (json.version as number) < 1) err('pool.version', 'must be an integer ≥ 1');
  if (!Array.isArray(json.twists) || json.twists.length === 0) {
    err('pool.twists', 'must be a non-empty array');
    return { ok: false, errors };
  }
  const ids = new Set<string>();
  const titles = new Set<string>();
  json.twists.forEach((t: unknown, i: number) => {
    const p = `twists[${i}]`;
    if (!isObj(t)) return err(p, 'must be an object');
    for (const k of Object.keys(t)) if (!TWIST_KEYS.has(k)) err(`${p}.${k}`, 'unknown key');
    const id = t.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) err(`${p}.id`, "must be 't<n>' with n from 1 to 1295");
    else if (ids.has(id)) err(`${p}.id`, `duplicate id '${id}'`);
    else ids.add(id);
    const at = typeof id === 'string' ? `${p} (${id})` : p;

    const kind = t.kind as TwistKind;
    if (!TWIST_KINDS.includes(kind)) err(`${at}.kind`, `must be one of ${TWIST_KINDS.join(', ')}`);

    const text = (key: string, max: number) => {
      const v = t[key];
      if (typeof v !== 'string' || !v.trim()) return err(`${at}.${key}`, 'must be a non-empty string');
      if (wordCount(v) > max) err(`${at}.${key}`, `${wordCount(v)} words (at most ${max})`);
      if (DENY_RE.test(v)) err(`${at}.${key}`, `uses a denied word ('${DENY_RE.exec(v)?.[0]}')`);
    };
    text('title', TWIST_LIMITS.titleWords);
    text('situation', TWIST_LIMITS.situationWords);
    text('why', TWIST_LIMITS.whyWords);
    if (typeof t.title === 'string') {
      const key = t.title.trim().toLowerCase();
      if (titles.has(key)) err(`${at}.title`, 'duplicate title');
      titles.add(key);
    }
    if (t.retired !== undefined && typeof t.retired !== 'boolean') err(`${at}.retired`, 'must be a boolean');

    const options = t.options;
    if (!Array.isArray(options) || options.length < TWIST_LIMITS.minOptions || options.length > TWIST_LIMITS.maxOptions) {
      err(`${at}.options`, `must have ${TWIST_LIMITS.minOptions}–${TWIST_LIMITS.maxOptions} options`);
      return;
    }
    const optTitles = new Set<string>();
    options.forEach((o: unknown, j: number) => {
      const op = `${at}.options[${j}]`;
      if (!isObj(o)) return err(op, 'must be an object');
      for (const k of Object.keys(o)) if (!OPTION_KEYS.has(k)) err(`${op}.${k}`, 'unknown key');
      if (o.id !== OPTION_IDS[j]) err(`${op}.id`, `must be '${OPTION_IDS[j]}' (ids run a, b, c, d in order)`);
      if (typeof o.title !== 'string' || !o.title.trim()) err(`${op}.title`, 'must be a non-empty string');
      else {
        if (wordCount(o.title) > TWIST_LIMITS.optionWords) err(`${op}.title`, `${wordCount(o.title)} words (at most ${TWIST_LIMITS.optionWords})`);
        if (DENY_RE.test(o.title)) err(`${op}.title`, `uses a denied word ('${DENY_RE.exec(o.title)?.[0]}')`);
        const key = o.title.trim().toLowerCase();
        if (optTitles.has(key)) err(`${op}.title`, 'duplicate option title');
        optTitles.add(key);
      }
      if (kind === 'rule') {
        if (o.tags !== undefined) err(`${op}.tags`, 'fair-play (rule) twists have no tags');
      } else if (!Array.isArray(o.tags) || o.tags.length === 0) err(`${op}.tags`, 'move twists need at least one tag');
      else {
        const seen = new Set<string>();
        for (const tag of o.tags) {
          if (!ACTION_TAGS.includes(tag as ActionTag)) err(`${op}.tags`, `unknown tag '${String(tag)}'`);
          if (seen.has(tag as string)) err(`${op}.tags`, `duplicate tag '${String(tag)}'`);
          seen.add(tag as string);
        }
      }
    });

    const best = options.find((o: unknown) => isObj(o) && o.id === t.best) as Obj | undefined;
    if (!best) err(`${at}.best`, 'must be the id of one of its options');
    else if (kind !== 'rule' && TWIST_KINDS.includes(kind) && Array.isArray(best.tags) && best.tags.every((x) => ACTION_TAGS.includes(x as ActionTag))) {
      const k = actionKindOf(best.tags as ActionTag[]);
      if (k !== kind) err(`${at}.kind`, `is '${kind}' but the best option's tags make it '${k}'`);
    }
  });
  return { ok: errors.length === 0, errors };
}

/** Live (not retired) twists per kind. */
export function coverage(pool: TwistPool): Record<TwistKind, number> {
  const out = Object.fromEntries(TWIST_KINDS.map((k) => [k, 0])) as Record<TwistKind, number>;
  for (const t of pool.twists) if (!t.retired) out[t.kind] += 1;
  return out;
}
