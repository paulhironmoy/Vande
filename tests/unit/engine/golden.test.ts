// @vitest-environment node
/**
 * Replay compatibility: the committed engine-v1 logs must verify with the engine forever. If this fails after a rule
 * change, do not regenerate the fixture: put the change in a new engine version and keep v1 registered.
 */
import { describe, expect, it } from 'vitest';
import type { MatchEventLog } from '@/contracts';
import { canonicalJson, engine, engineFor, SUPPORTED_ENGINE_VERSIONS } from '@/engine';
import { sha256Hex } from '@/engine/sha256';
import golden from './fixtures/golden-v1.json';

const fixture = golden as unknown as { engine: number; note: string; logs: MatchEventLog[] };

describe('golden engine-v1 replays', () => {
  it('is the frozen fixture (canonical digest pinned)', () => {
    expect(fixture.engine).toBe(1);
    expect(sha256Hex(canonicalJson(fixture))).toBe('593a7ca8bb174aa61ad3351c50d7e31280ab4e46f4d9a078ed3a937d8de340f6');
  });

  it('covers a normal duel, a Super Ball tie, an all-out innings with dead balls and unanswered balls', () => {
    const [duel, tie, allOut, unanswered] = fixture.logs;
    expect(duel.result.decidedBy).toBe('runs');
    expect(tie.superBall.used).toBe(true);
    expect(allOut.innings.some((i) => i.wickets === 2 && i.ballsFaced < 6)).toBe(true);
    expect(unanswered.inputs.some((i) => i.length < 7)).toBe(true);
  });

  it('verifies every committed log with the engine version recorded in it', async () => {
    expect(SUPPORTED_ENGINE_VERSIONS).toContain(1);
    for (const log of fixture.logs) {
      expect(log.engine).toBe(1);
      expect(engineFor(log.engine)).not.toBeNull();
      expect(await engine.verifyMatchLog(log), log.matchId).toEqual({ ok: true });
    }
  });

  it('still detects tampering in an old replay', async () => {
    const bad = JSON.parse(JSON.stringify(fixture.logs[0])) as MatchEventLog;
    bad.result.marginRuns += 1;
    expect((await engine.verifyMatchLog(bad)).ok).toBe(false);
  });
});
