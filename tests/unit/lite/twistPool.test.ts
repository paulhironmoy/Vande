import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import pool from '@/content/lite/twists.json';
import schema from '@/content/lite/twists.schema.json';
import type { TwistPool } from '@/lite/contracts';
import { TOUGHNESS_CONFIG, bestMoveKindSurvey } from '@/lite/toughness';
import { coverage, validateTwistPool } from '@/lite/twistValidate';

const POOL = pool as TwistPool;
const ajv = new Ajv({ allErrors: true, strict: false });
const schemaValid = ajv.compile(schema);

/** A valid one-twist pool to break, one rule at a time. */
function base(): { version: number; twists: Record<string, unknown>[] } {
  return {
    version: 1,
    twists: [
      {
        id: 't1',
        kind: 'check',
        title: 'The Broken Shop Window',
        situation: 'A shop window is broken. People blame the visiting fans.',
        options: [
          { id: 'a', title: 'Ban the visiting fans', tags: ['disproportionate', 'suppressive'] },
          { id: 'b', title: 'Check the shop camera first', tags: ['investigative'] },
          { id: 'c', title: 'Ask both fan clubs to meet', tags: ['dialogue'] },
        ],
        best: 'b',
        why: 'Find out what happened before blaming a group.',
      },
      {
        id: 't2',
        kind: 'rule',
        title: 'Hear Both Sides',
        situation: 'The leader listens to only one neighbour. Is that fair?',
        options: [
          { id: 'a', title: 'Yes, the first one is right' },
          { id: 'b', title: 'No, both should be heard' },
          { id: 'c', title: 'Only if the leader is busy' },
        ],
        best: 'b',
        why: 'A fair decision hears both sides.',
      },
    ],
  };
}

function rejects(mutate: (p: ReturnType<typeof base>) => void, pattern: RegExp) {
  const p = base();
  mutate(p);
  const r = validateTwistPool(p);
  expect(r.ok).toBe(false);
  expect(r.errors.join('\n')).toMatch(pattern);
}

describe('Lite twist pool', () => {
  it('passes the validator and the JSON schema', () => {
    const r = validateTwistPool(pool);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(schemaValid(pool)).toBe(true);
  });

  it('covers every action kind that can be the best move of a Chapter 1 decision, plus fair play', () => {
    // A lighter sample than the generator's full survey (node scripts/lite-toughness.mjs --survey) keeps this fast.
    const survey = bestMoveKindSurvey({ seeds: TOUGHNESS_CONFIG.seeds.slice(0, 8), randomPaths: 40 });
    const kinds = Object.entries(survey.kinds).filter(([, n]) => (n ?? 0) > 0).map(([k]) => k);
    expect(kinds.length).toBeGreaterThan(0);
    const cov = coverage(POOL);
    for (const k of kinds) expect(cov[k as keyof typeof cov], `twists of kind '${k}'`).toBeGreaterThanOrEqual(4);
    expect(cov.rule).toBeGreaterThanOrEqual(4);
    expect(POOL.twists.filter((t) => !t.retired).length).toBeGreaterThanOrEqual(30);
  }, 60_000);

  it('spreads the best answer across positions so the position never hints', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const four = POOL.twists.filter((t) => t.options.length === 4);
    for (const t of four) counts[t.best] += 1;
    const fair = four.length / 4;
    for (const id of ['a', 'b', 'c', 'd']) expect(counts[id], `best at '${id}'`).toBeGreaterThanOrEqual(Math.floor(fair) - 2);
  });

  it('keeps ids permanent-looking and unique', () => {
    const ids = POOL.twists.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^t\d+$/);
  });
});

describe('twist validator rejects', () => {
  it('a pool that is not an object or has no twists', () => {
    expect(validateTwistPool(null).ok).toBe(false);
    expect(validateTwistPool({ version: 1, twists: [] }).ok).toBe(false);
    rejects((p) => (p.version = 0), /version/);
  });
  it('bad and duplicate ids', () => {
    rejects((p) => (p.twists[0].id = 'x1'), /id: must be 't<n>'/);
    rejects((p) => (p.twists[0].id = 't0'), /id: must be 't<n>'/);
    rejects((p) => (p.twists[0].id = 't1296'), /id: must be 't<n>'/);
    rejects((p) => (p.twists[1].id = 't1'), /duplicate id/);
  });
  it('an unknown kind', () => rejects((p) => (p.twists[0].kind = 'shout'), /kind: must be one of/));
  it('a title over 6 words', () => rejects((p) => (p.twists[0].title = 'One two three four five six seven'), /title: 7 words/));
  it('a situation over 30 words', () => rejects((p) => (p.twists[0].situation = Array.from({ length: 31 }, () => 'word').join(' ')), /situation: 31 words/));
  it('a why line over 20 words', () => rejects((p) => (p.twists[0].why = Array.from({ length: 21 }, () => 'word').join(' ')), /why: 21 words/));
  it('too few or too many options', () => {
    rejects((p) => (p.twists[0].options = (p.twists[0].options as unknown[]).slice(0, 2)), /must have 3–4 options/);
    rejects(
      (p) =>
        (p.twists[0].options = [
          ...(p.twists[0].options as unknown[]),
          { id: 'd', title: 'Wait', tags: ['wait'] },
          { id: 'e', title: 'More', tags: ['wait'] },
        ]),
      /must have 3–4 options/,
    );
  });
  it('option ids out of order', () => rejects((p) => ((p.twists[0].options as { id: string }[])[1].id = 'c'), /must be 'b'/));
  it('an option title over 7 words', () => rejects((p) => ((p.twists[0].options as { title: string }[])[0].title = 'one two three four five six seven eight'), /8 words \(at most 7\)/));
  it('a best that is not an option', () => rejects((p) => (p.twists[0].best = 'd'), /best: must be the id/));
  it('a move twist option without tags', () => rejects((p) => delete (p.twists[0].options as { tags?: unknown }[])[2].tags, /move twists need at least one tag/));
  it('an unknown tag', () => rejects((p) => ((p.twists[0].options as { tags: string[] }[])[2].tags = ['shouting']), /unknown tag 'shouting'/));
  it('a fair-play twist with tags', () => rejects((p) => ((p.twists[1].options as { tags?: string[] }[])[0].tags = ['dialogue']), /fair-play \(rule\) twists have no tags/));
  it("a kind that does not match the best option's tags", () => rejects((p) => (p.twists[0].kind = 'talk'), /best option's tags make it 'check'/));
  it('a retired flag that is not a boolean', () => rejects((p) => (p.twists[0].retired = 'yes'), /retired: must be a boolean/));
  it('denied words (parties, religions, real places, the exam)', () => {
    rejects((p) => (p.twists[0].situation = 'A rally in Delhi gets loud.'), /denied word/);
    rejects((p) => ((p.twists[0].options as { title: string }[])[0].title = 'Close the temple gate'), /denied word/);
    rejects((p) => (p.twists[0].why = 'The exam must be fair.'), /denied word/);
  });
  it('unknown keys and duplicate titles', () => {
    rejects((p) => (p.twists[0].colour = 'red'), /unknown key/);
    rejects((p) => (p.twists[1].title = 'The Broken Shop Window'), /duplicate title/);
  });
  it('the same mistakes in the JSON schema', () => {
    const withTags = base();
    (withTags.twists[1].options as { tags?: string[] }[])[0].tags = ['dialogue'];
    expect(schemaValid(withTags)).toBe(false);
    const noTags = base();
    delete (noTags.twists[0].options as { tags?: unknown }[])[0].tags;
    expect(schemaValid(noTags)).toBe(false);
    const badId = base();
    badId.twists[0].id = 't0';
    expect(schemaValid(badId)).toBe(false);
    expect(schemaValid(base())).toBe(true);
  });
});
