// @vitest-environment node
/**
 * Files that live in two places on purpose, kept equal by a test that CI runs.
 *
 * Unity cannot import from outside Assets/, so the MOTION reference sources under scripts/motion/unity are copied into
 * the Unity project, and the recorded audio takes under public/audio/cricket are copied into Unity's Resources. Each
 * copy must stay byte-identical to its reference: change the reference, then copy it, never fork the copy.
 *
 * The Unity EditMode tests VandeMotionPackVendoredTests and ProductionRecordedTakesTests assert the same pairs, but CI
 * does not run Unity; this file keeps the guard in the suite it does run. The other mirrors are guarded elsewhere:
 * - src/render3d/core/motion/vmp.ts against scripts/motion/vmp.ts: tests/unit/render3d/motionVendored.test.ts;
 * - public/practice/motion/*.vmp against Unity's Resources/Motion/*.bytes: scripts/motion/motion.test.mjs
 *   (`npm run motion:test`), which also rebuilds both from assets-src/motion.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const UNITY = 'unity/VandePractice/Assets/VandePractice';

function bytesOf(repoPath: string): Buffer {
  const file = resolve(ROOT, repoPath);
  if (!existsSync(file)) throw new Error(`${repoPath} is missing`);
  return readFileSync(file);
}

/** [reference, vendored copy] */
const CSHARP_PAIRS: Array<[string, string]> = [
  ['scripts/motion/unity/VandeMotionPack.cs', `${UNITY}/Runtime/Presentation/Production/Motion/VandeMotionPack.cs`],
  [
    'scripts/motion/unity/test/VandeMotionPackEditModeTests.cs',
    `${UNITY}/Tests/EditMode/VandeMotionPackEditModeTests.cs`,
  ],
];

describe('Unity copies of the MOTION reference sources', () => {
  it.each(CSHARP_PAIRS)('%s is byte-identical to its Unity copy %s', (reference, copy) => {
    expect(
      bytesOf(copy).equals(bytesOf(reference)),
      `${copy} must be an exact copy of ${reference}: change the reference, then copy it`,
    ).toBe(true);
  });
});

const WEB_TAKES = 'public/audio/cricket';
const UNITY_TAKES = `${UNITY}/Runtime/Audio/Resources/Audio/Cricket`;

const takesIn = (dir: string): string[] =>
  readdirSync(resolve(ROOT, dir))
    .filter((name) => name.endsWith('.mp3'))
    .sort();

describe('Unity copies of the recorded audio takes', () => {
  const web = takesIn(WEB_TAKES);

  it('the web folder holds the takes', () => {
    expect(web.length).toBeGreaterThan(0);
  });

  it('Unity holds the same take files and no others', () => {
    expect(takesIn(UNITY_TAKES), `${UNITY_TAKES} must hold exactly the files of ${WEB_TAKES}`).toEqual(web);
  });

  it('every take is byte-identical to the web copy', () => {
    const differing = web.filter((name) => !bytesOf(`${UNITY_TAKES}/${name}`).equals(bytesOf(`${WEB_TAKES}/${name}`)));
    expect(differing, `copy these from ${WEB_TAKES} over ${UNITY_TAKES}`).toEqual([]);
  });
});
