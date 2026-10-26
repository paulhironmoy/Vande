/**
 * The engine injection point. The Worker and the MatchDO never import `@/engine` themselves: the production entry
 * (src/index.ts) passes the real engine, the tests and the local harness pass a fake one. Every match records the
 * engine version it was created with and is always played and revealed with that version, so an engine upgrade never
 * changes a match in progress; a match whose version is no longer registered answers `version_mismatch`.
 */
import type { BattingInput, DeliveryVariant, MatchEventLog, RevealedDelivery, SealedSixEngineApi, Top100Entry } from '@/contracts';
import type { IneligibleReason, RatedPlayer, RatingMatch, Top100MatchInput, Top100PlayerDay } from '@/engine/ranking';

export interface EngineRegistry {
  /** The engine new matches are created with. */
  current(): SealedSixEngineApi;
  get(version: number): SealedSixEngineApi | null;
  versions(): number[];
}

export function engineRegistry(engines: readonly SealedSixEngineApi[]): EngineRegistry {
  if (engines.length === 0) throw new Error('at least one engine is required');
  const byVersion = new Map<number, SealedSixEngineApi>();
  for (const e of engines) byVersion.set(e.ENGINE_VERSION, e);
  const latest = Math.max(...byVersion.keys());
  return {
    current: () => byVersion.get(latest) as SealedSixEngineApi,
    get: (v) => byVersion.get(v) ?? null,
    versions: () => [...byVersion.keys()].sort((a, b) => a - b),
  };
}

/** What the engine's `timingAudit` reports for one innings. */
export interface TimingAuditResult {
  taps: number;
  bullseyes: number;
  meanAbsErrorMs: number;
  suspicious: boolean;
}

/**
 * Stable helpers the engine exports beside the frozen contract (src/engine/index.ts), injected with the engines so a
 * fake engine can bring matching ones. They follow the current rules version; the production entry passes the real
 * ones, and a missing helper switches its feature off (fails closed) instead of guessing.
 */
export interface EngineHelpers {
  /** Flags machine-perfect tapping in one innings from the player's own answers (a flag, never a block). */
  timingAudit(pairs: ReadonlyArray<{ input: BattingInput; delivery: RevealedDelivery }>): TimingAuditResult;
  /** The day's three daily-over commits; each commit salt is one-way from the server salt (never published itself). */
  dailyCommits(day: string, serverSalt: string): Array<{ attempt: 1 | 2 | 3; hash: string; salt: string }>;
  /** Rating update after a duel or cup reveal (src/engine/ranking.ts). */
  updateRatings(players: [RatedPlayer, RatedPlayer], m: RatingMatch): { ratings: [number, number]; rated: boolean };
  /** The Daily Top 100 of one IST day (src/engine/ranking.ts). */
  rankTop100(players: readonly Top100PlayerDay[], limit?: number, longTermEffort?: ReadonlyMap<string, number>): Top100Entry[];
  /** Hard eligibility of one match (late answers, timing audit, Auto sides…), reused by highlight moderation. */
  matchEligibility(m: Top100MatchInput): IneligibleReason[];
  /**
   * The autoBat key for Auto XI batting for `seat` on `ball` (src/engine/auto.ts `autoXiSeed`): the reveal recognises
   * Auto XI's balls from this same key (`autoXiBalls`), so the server must never build it any other way.
   */
  autoXiSeed(seed: string, seat: 0 | 1, ball: number): string;
  /**
   * Deliveries `player` earned as the bowler of a revealed official match (src/engine/advice.ts `unlocksEarned`):
   * merged into the player's unlocks at the reveal. Without it nobody unlocks anything (fails closed).
   */
  unlocksEarned(log: MatchEventLog, player: 0 | 1): DeliveryVariant[];
}
