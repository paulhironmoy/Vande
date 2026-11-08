// @vitest-environment node
/// <reference types="node" />
/**
 * The Unity port of the Director (contract director/3, UNITY-E1) keeps three of the web's files in the Unity project because
 * Unity cannot read outside Assets/, and a C# class generated from the fourth. This is the guard CI runs (CI does not run Unity;
 * the EditMode tests DirectorVendoredTests assert the same on the Unity side):
 *
 *   - params.json, golden.json and bowler-clip-head.json must be byte-identical to their Unity copies: change the web file,
 *     then copy it (`node scripts/director-unity-params.mjs` copies params.json), never fork the copy;
 *   - DirectorParams.Generated.cs must be exactly what scripts/director-unity-params.mjs makes from params.json, so no
 *     tunable number is hand-typed in C# and a parameter can never change on one side only;
 *   - the generated class must carry every number of the file, in order (a generator that dropped a key would otherwise pass).
 *
 * A change to params.json is a deliberate new freeze of the contract (golden.test.ts): after it, run the script, re-record the
 * golden fixture with UPDATE_GOLDEN=1, and copy golden.json into the Unity project.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import P from '@/render3d/core/motion/director/params.json';
import { UNITY_GENERATED, UNITY_PARAMS_COPY, WEB_PARAMS, expectedFiles, fnv1a32Bytes, generateDirectorParams, staleFiles } from '../../../../scripts/director-unity-params.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const UNITY_FIXTURES = 'unity/VandePractice/Assets/VandePractice/Tests/EditMode/Director/Fixtures';
const WEB_FIXTURES = 'tests/unit/render3d/director/fixtures';

function bytesOf(repoPath: string): Buffer {
  const file = resolve(ROOT, repoPath);
  if (!existsSync(file)) throw new Error(`${repoPath} is missing`);
  return readFileSync(file);
}

/** [web file, Unity copy] */
const COPIES: Array<[string, string]> = [
  [WEB_PARAMS, UNITY_PARAMS_COPY],
  [`${WEB_FIXTURES}/golden.json`, `${UNITY_FIXTURES}/golden.json`],
  [`${WEB_FIXTURES}/bowler-clip-head.json`, `${UNITY_FIXTURES}/bowler-clip-head.json`],
];

describe('Unity copies of the Director fixtures', () => {
  it.each(COPIES)('%s is byte-identical to its Unity copy %s', (web, copy) => {
    expect(bytesOf(copy).equals(bytesOf(web)), `${copy} must be an exact copy of ${web}: change the web file, then copy it`).toBe(true);
  });
});

describe('Unity constants generated from params.json', () => {
  it('DirectorParams.Generated.cs and the params.json copy are current (run: node scripts/director-unity-params.mjs)', () => {
    expect(staleFiles(ROOT)).toEqual([]);
  });

  it('the generator is deterministic', () => {
    const text = readFileSync(resolve(ROOT, WEB_PARAMS), 'utf8');
    expect(generateDirectorParams(text)).toBe(generateDirectorParams(text));
    expect(generateDirectorParams(text)).toBe(expectedFiles(ROOT).generated);
  });

  it('carries the file\'s hash, its length and the minified length that golden.json records', () => {
    const bytes = bytesOf(WEB_PARAMS);
    const cs = readFileSync(resolve(ROOT, UNITY_GENERATED), 'utf8');
    expect(cs).toContain(`SourceFnv1a32 = 0x${fnv1a32Bytes(bytes).toString(16).padStart(8, '0')}u;`);
    expect(cs).toContain(`SourceBytes = ${bytes.length};`);
    expect(cs).toContain(`MinifiedChars = ${JSON.stringify(P).length};`);
    const golden = JSON.parse(readFileSync(resolve(ROOT, `${WEB_FIXTURES}/golden.json`), 'utf8')) as { paramsBytes: number };
    expect(golden.paramsBytes).toBe(JSON.stringify(P).length);
  });

  it('holds every number of params.json, in the file\'s order, and nothing else', () => {
    const want: number[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'number') want.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(P);
    const cs = readFileSync(resolve(ROOT, UNITY_GENERATED), 'utf8');
    const got: number[] = [];
    for (const line of cs.split('\n')) {
      const scalar = /^\s*public const double \w+ = (-?[\d.e+-]+);$/.exec(line);
      if (scalar) got.push(Number(scalar[1]));
      const array = /^\s*public static readonly double\[\] \w+ = \{ (.+) \};$/.exec(line);
      if (array) for (const n of array[1].split(', ')) got.push(Number(n));
    }
    expect(got.length).toBeGreaterThan(200);
    expect(got).toEqual(want);
  });
});
