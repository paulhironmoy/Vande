/**
 * Shared Lite contracts for fair friend incentives, twist questions, Insight tiers and clear visuals.
 * Lead-owned: change deliberately, and update every implementer when you do. Implementations live in:
 *   - src/lite/twists.ts        twist selection and the per-dare attempt store (friend device)
 *   - src/lite/ledger.ts        Helper and Challenger award ledger with caps and dedupe
 *   - src/lite/twistValidate.ts twist pool validator
 *   - src/lite/toughness.ts     toughness signals, tiers and `tierFor`
 *   - src/lite/replay.ts        pure replay of a dare path (toughness generator, tests, verified-dares server)
 *   - src/lite/visuals.ts       the per-question picture gate `visualPlanFor`
 *   - src/share/dare.ts         I1 dares, R1 and R2 reply codes
 */
import type { ActionTag, OptionVisual } from '@/engine/types';
import type { InsightTier } from './points';

export type { InsightTier } from './points';
export type { OptionVisual } from '@/engine/types';

// ---------------------------------------------------------------------------------------------------------------
// Twist questions
// ---------------------------------------------------------------------------------------------------------------

/** Same names as the card kinds in src/components/game/cards/actionKind.ts. `rule` = a fair-play twist. */
export type TwistKind = 'talk' | 'check' | 'protect' | 'enforce' | 'restrict' | 'wait' | 'rule';

export interface TwistOption {
  /** 'a' | 'b' | 'c' | 'd', unique within the twist and permanent. */
  id: string;
  /** At most 7 words, simple language. */
  title: string;
  /** Move twists: tags so the kind badge and Gain/Cost lines work via actionKindOf. Omitted for `rule` twists. */
  tags?: ActionTag[];
}

export interface Twist {
  /** Permanent id `t<n>`, n = 1..1295 (fits two base36 characters in reply codes). Never renumbered or reused. */
  id: string;
  /** The action kind of the best option, or 'rule' for fair-play twists. */
  kind: TwistKind;
  /** At most 6 words: the heading, e.g. "Stones at the market". */
  title: string;
  /** At most 30 words, simple language, a new place and new people. */
  situation: string;
  /** 3–4 options; prefer 4. */
  options: TwistOption[];
  /** Id of the single best option. */
  best: string;
  /** One line, at most 20 words: why the best option is best. */
  why: string;
  /** Retired twists stay in the file so old links resolve; they are never drawn. */
  retired?: boolean;
}

export interface TwistPool {
  version: number;
  twists: Twist[];
}

/** How the friend did on their twist. 'skipped' = no twist taken (only the dare counts). */
export type TwistOutcome = 'right' | 'wrong' | 'skipped';

/**
 * One attempt per device per dare, persisted on the friend's device. Created when the friend first answers the dare
 * (so a reply always has a nonce, even when the twist is skipped); `twistId` and `order` are set once the twist is
 * drawn and never change afterwards.
 */
export interface TwistAttempt {
  v: 1;
  /** `dareKeyOf(dare)`. */
  dareKey: string;
  twistId?: string;
  /** Option ids in the shuffled display order. */
  order?: string[];
  /** Chosen option id once answered. */
  answer?: string;
  outcome?: 'right' | 'wrong';
  /** Random per-attempt nonce (6 base36 chars) that makes this friend's reply unique. */
  nonce: string;
  /**
   * The friend's FIRST answer to the dared question on this device. Retaking the dare after seeing the reveal never
   * changes it, so the best move cannot be copied from the reveal into the reply.
   */
  dare?: { points: number; best: boolean };
  /** Unix ms. */
  createdAt: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Reply codes (R2)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Fields R2 adds to a DareReply. R1 replies decode with `version: 1` and none of these fields.
 *   - twistId: the twist the friend got (also the rematch question)
 *   - twist: the friend's twist outcome
 *   - nonce: per-attempt random value from TwistAttempt.nonce
 *   - rematchDeadline: unix seconds, the friend's next local midnight when they replied
 *   - sig: optional signature appended by verified dares (wave 2) as `_x<sig>` after the checksum. Codes are
 *     lowercased on decode, so the signature must use a lowercase alphabet: lowercase hex (16–256 chars).
 */
export interface DareReplyV2Fields {
  version: 2;
  twistId?: string;
  twist: TwistOutcome;
  nonce: string;
  rematchDeadline: number;
  sig?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Award ledger (localStorage `vande:lite-awards`, migrated from the v1 `vande:lite-helper` value)
// ---------------------------------------------------------------------------------------------------------------

export interface FriendLedger {
  v: 2;
  helper: {
    /** All Helper points earned (local and verified). */
    points: number;
    /** Rewarded replies counted. */
    answers: number;
    /** Rewarded replies where the friend found the best move and cracked the twist. */
    understood: number;
    /** The part of `points` that came from signed (verified) replies. */
    verifiedPoints: number;
  };
  challenger: {
    points: number;
    answers: number;
    understood: number;
  };
  /**
   * Replies already counted, by reply identity: R1 = the code; R2 = `${dareKey}#${nonce}`. The value is the points
   * already awarded for it, so a later reply from the same attempt can only add the difference (an upgrade).
   */
  replies: Record<string, number>;
  /** Helper side: rewarded replies per dare (dareKey). */
  perDare: Record<string, number>;
  /** Challenger side: points already awarded per dare answered (dareKey). */
  challenged: Record<string, number>;
  /** Local-day counters; reset when `date` (local YYYY-MM-DD) changes. */
  day: { date: string; helper: number; challenger: number };
}

/** Result of one award attempt. */
export interface AwardResult {
  ledger: FriendLedger;
  /** Points added now (0 when capped or already counted). */
  earned: number;
  /** True when this reply or dare had not been counted before. */
  fresh: boolean;
  /** True when an already-counted attempt earned more (it now includes a right twist). */
  upgraded: boolean;
  /** Why nothing was earned, if a cap stopped it. */
  capped: null | 'dare' | 'day';
}

// ---------------------------------------------------------------------------------------------------------------
// Toughness (src/content/lite/toughness.json, generated by scripts/lite-toughness.mjs)
// ---------------------------------------------------------------------------------------------------------------

export interface ToughnessSignals {
  closeCall: boolean;
  trap: boolean;
  clueNeeded: boolean;
}

export interface ToughnessEntry {
  tier: InsightTier;
  signals: ToughnessSignals;
}

export interface ToughnessManifest {
  scenarioId: string;
  /** Hash of the content inputs the tiers were computed from; the staleness test recomputes and compares. */
  contentHash: string;
  thresholds: {
    /** Best and second-best within this many points is a close call (also the Insight close-second margin). */
    closeCallMargin: number;
    [key: string]: number;
  };
  /** Campaign seeds evaluated (the most common tier wins). */
  seeds: number[];
  /** By decision id. */
  decisions: Record<string, ToughnessEntry>;
  /** By rights-moment id (default tricky). */
  rights: Record<string, ToughnessEntry>;
}

// ---------------------------------------------------------------------------------------------------------------
// Visual answers
// ---------------------------------------------------------------------------------------------------------------

export interface VisualPlanEntry {
  visual: OptionVisual;
  /** 2–4 words, shown under the picture in place of the longer title. */
  label: string;
}

/** Keyed by option id. Present only when every option of the question passes the gate. */
export type VisualPlan = Record<string, VisualPlanEntry>;
