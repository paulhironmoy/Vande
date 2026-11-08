import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const explicitUnityPreviewFlags = /(?:^|\s)VITE_UNITY_PRACTICE_WEB=1\s+VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=1(?:\s|$)/;

describe('Unity WebGL engineering-preview scripts', () => {
  for (const name of ['dev:unity', 'build:unity', 'preview:unity']) {
    it(`${name} requests both the WebGL renderer and its fail-closed preview admission`, () => {
      const script = packageJson.scripts?.[name];
      assert.equal(typeof script, 'string');
      assert.match(script, explicitUnityPreviewFlags);
    });
  }

  it('keeps ordinary web scripts free of Unity preview admission flags', () => {
    for (const name of ['dev', 'build', 'preview']) {
      const script = packageJson.scripts?.[name];
      assert.equal(typeof script, 'string');
      assert.doesNotMatch(script, /VITE_UNITY_PRACTICE_(?:WEB|ENGINEERING_PREVIEW)=1/);
    }
  });
});
