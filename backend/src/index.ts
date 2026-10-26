/**
 * Production entry of the VANDE Cricket API (wrangler.toml `main`). The only place the real engine is wired in:
 * everything else receives it by injection (src/engines.ts). Nothing is deployed by this file; see
 * docs/INFRASTRUCTURE.md for the activation steps.
 */
import { autoXiSeed, dailyCommits, engine, timingAudit } from '@/engine';
import { unlocksEarned } from '@/engine/advice';
import { matchEligibility, rankTop100, updateRatings } from '@/engine/ranking';
import { createWorker } from './app';

const app = createWorker({ engines: [engine], helpers: { timingAudit, dailyCommits, updateRatings, rankTop100, matchEligibility, autoXiSeed, unlocksEarned } });

export default app.worker;

/** Durable Object classes bound as MATCH, CUP and ROOM in wrangler.toml. */
export const MatchDO = app.MatchDO;
export const CupDO = app.CupDO;
export const RoomDO = app.RoomDO;
