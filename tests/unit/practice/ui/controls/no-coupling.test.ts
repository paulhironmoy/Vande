/**
 * "Switching never changes the delivery or the physics" (CTR-02), as a structural guarantee: the control choice is read
 * only by the lesson, the haptics, the camera and the screens. Nothing that makes a delivery, plays the physics, scores a
 * swing or analyses a ball may import it or read the setting, so no control can change a delivery, a seed or an outcome.
 * (The behavioural proof, the same seed and swings giving the same balls under each control and across a switch, is
 * tests/e2e/controls-determinism.spec.ts.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
/** Everything that decides a ball: the physics, the over builders, the coach, the work thread, the flow's rules. */
const FENCED = ['src/physics', 'src/practice/game', 'src/practice/coach', 'src/practice/worker', 'src/practice/chase'];

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

describe('the control choice is out of reach of every delivery and outcome', () => {
  for (const dir of FENCED) {
    it(`${dir} neither imports the control module nor reads the setting`, () => {
      const list = files(dir);
      expect(list.length).toBeGreaterThan(0);
      for (const file of list) {
        const src = readFileSync(join(ROOT, file), 'utf8');
        expect(src, file).not.toMatch(/ui\/controls|from ['"]\.\.?\/.*controls['"]/);
        expect(src, file).not.toMatch(/settings\.control\b|\.controlChosen\b|\bBatControl\b|currentControl|setControl/);
      }
    });
  }

  it('the flow that bowls a ball (flow/*.ts) never reads the control either', () => {
    for (const file of files('src/practice/ui/flow')) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, file).not.toMatch(
        /ui\/controls|\.\.\/controls|settings\.control\b|\.controlChosen\b|currentControl|setControl/,
      );
    }
  });

  it('the input authority has no second path: nothing under src/input imports the control module', () => {
    for (const file of files('src/input')) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toMatch(/ui\/controls/);
    }
  });
});
