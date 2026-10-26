// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MatchEventLog } from '@/contracts';
import { canonicalJson, engine, engineFor, SUPPORTED_ENGINE_VERSIONS } from '@/engine';
import { clone, logFor, randomMatch } from './helpers';

const fails = async (log: MatchEventLog, expected?: string) => {
  const r = await engine.verifyMatchLog(log);
  expect(r.ok).toBe(false);
  if (!r.ok && expected) expect(r.errors.join(' ')).toContain(expected);
};

describe('verifyMatchLog', () => {
  it('verifies honest logs, including after a JSON round trip', async () => {
    for (let k = 0; k < 25; k++) {
      const log = await logFor(randomMatch(`verify|${k}`, { pUnanswered: 0.08 }));
      expect(await engine.verifyMatchLog(log)).toEqual({ ok: true });
      expect(await engine.verifyMatchLog(clone(log))).toEqual({ ok: true });
    }
  });

  it('dispatches by the engine version recorded in the log', async () => {
    expect(SUPPORTED_ENGINE_VERSIONS).toContain(1);
    expect(engineFor(1)).not.toBeNull();
    const log = await logFor(randomMatch('version'));
    await fails({ ...clone(log), engine: 99 }, 'log.engine_version_unsupported');
    await fails({ ...clone(log), schema: 2 as 1 }, 'log.schema');
  });

  describe('detects tampering', async () => {
    const honest = await logFor(randomMatch('tamper', { pUnanswered: 0.1 }));
    const t = () => clone(honest);

    it('a changed score, wicket or event', async () => {
      const a = t();
      a.innings[0].runs += 1;
      await fails(a, 'log.mismatch.innings');
      const b = t();
      const first = b.innings[1].balls[0];
      first.runs = first.runs === 6 ? 4 : 6;
      await fails(b, 'log.mismatch.innings');
      const c = t();
      const ballEvent = c.events.find((e) => e.t === 'ball');
      if (ballEvent && ballEvent.t === 'ball') ballEvent.outcome.cues.crowd = 0.01;
      await fails(c, 'log.mismatch.events');
      const d = t();
      d.result.winner = d.result.winner === 0 ? 1 : 0;
      await fails(d, 'log.mismatch.result');
    });

    it('a changed plan, salt or commit hash', async () => {
      const a = t();
      a.plans[1].balls[0].intent = a.plans[1].balls[0].intent === 'attack' ? 'contain' : 'attack';
      await fails(a, 'commit1.hash_mismatch');
      const b = t();
      b.commits[0].salt = 'guessed';
      await fails(b, 'commit0.hash_mismatch');
      const c = t();
      delete c.commits[1].salt;
      await fails(c, 'commit1.salt_missing');
      const d = t();
      d.commits[0].hash = '0'.repeat(64);
      await fails(d, 'commit0.hash_mismatch');
    });

    it('a changed seed, condition or input', async () => {
      const a = t();
      a.seed = `${a.seed.slice(0, -2)}ff`;
      await fails(a);
      const b = t();
      b.conditions = { ...b.conditions, pitch: b.conditions.pitch === 'slow' ? 'hard' : 'slow' };
      await fails(b);
      const c = t();
      const input = c.inputs[0].find((i) => i.tapMs !== null);
      if (input) {
        input.tapMs = (input.tapMs as number) + 120;
        input.clientElapsedMs += 200;
        await fails(c);
      }
      const d = t();
      if (d.inputs[1].length) {
        d.inputs[1].push(clone(d.inputs[1][0]));
        await fails(d, 'duplicate_ball');
      }
      const e = t();
      if (e.inputs[0].length) {
        e.inputs[0][0].tapMs = -1;
        await fails(e, 'tap_before_release');
      }
    });

    it('a malformed log', async () => {
      await fails(null as unknown as MatchEventLog, 'log.missing');
      await fails({ ...t(), plans: [] as unknown as MatchEventLog['plans'] }, 'log.shape');
    });
  });
});

describe('determinism', () => {
  it('rebuilds byte-identical logs from identical inputs', async () => {
    for (let k = 0; k < 10; k++) {
      const a = await logFor(randomMatch(`det|${k}`));
      const b = await logFor(randomMatch(`det|${k}`));
      expect(canonicalJson(b)).toBe(canonicalJson(a));
    }
  });

  it('different seeds produce different matches', async () => {
    const m = randomMatch('seedless');
    const a = await logFor(m);
    const flipped = await logFor({ ...m, seed: `${m.seed.slice(0, -1)}${m.seed.endsWith('0') ? '1' : '0'}`, states: replay(m, `${m.seed.slice(0, -1)}${m.seed.endsWith('0') ? '1' : '0'}`) });
    expect(canonicalJson(flipped.innings)).not.toBe(canonicalJson(a.innings));
  });
});

function replay(m: ReturnType<typeof randomMatch>, seed: string): ReturnType<typeof randomMatch>['states'] {
  const out = [engine.startInnings(0), engine.startInnings(1)] as ReturnType<typeof randomMatch>['states'];
  for (const i of [0, 1] as const) {
    let state = out[i];
    for (const input of m.inputs[i]) state = engine.resolveNextBall(state, { seed, conditions: m.conditions, plan: m.plans[i === 0 ? 1 : 0], input }).state;
    out[i] = state;
  }
  return out;
}
