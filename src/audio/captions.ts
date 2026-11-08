/**
 * Captions for the essential audio cues (brief: "captions for essential audio cues"). Closed keys only: the Practice
 * UI words them (practice.caption.<key> in en, hi and hi-Latn) and shows them in the status-strip area, never over
 * the play. A caption is emitted at the moment its sound plays, so it can never say more than the sound does:
 *
 *   - nothing between the start of the bowler's approach and the contact (the release, the pitch and the flight stay
 *     free of text: the ball outranks the interface, constitution §3–4);
 *   - nothing before the physical confirmation (four and six at the rope, a wicket at the stumps, the catch or the
 *     umpire's decision);
 *   - nothing at all while the Captions setting is off (no work is done either).
 */
import type { ContactKind, Dismissal, SwingTiming } from '@/contracts/practice';

export const CAPTION_KEYS = [
  // The bat (at the contact).
  'sweet_spot',
  'middle',
  'mistimed',
  'block',
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
  'play_and_miss',
  'pad',
  'body',
  // The wicket (at the stumps, the catch or the decision).
  'bowled',
  'caught',
  'caught_behind',
  'lbw',
  'not_out',
  // The boundary (at the rope) and milestones.
  'four',
  'six',
  'milestone_fifty',
  'milestone_hundred',
  // The crowd.
  'crowd_rises',
  'crowd_gasps',
  'crowd_groans',
  'crowd_applauds',
  'crowd_cheers',
  'crowd_erupts',
  'crowd_stunned',
  'crowd_relieved',
  'crowd_ovation',
  // Coach Mode.
  'mastered',
  'stage_up',
] as const;

export type CaptionKey = (typeof CAPTION_KEYS)[number];
export type CaptionKind = 'bat' | 'wicket' | 'boundary' | 'crowd' | 'coach';

export interface Caption {
  /** Increasing, unique for the session. */
  id: number;
  key: CaptionKey;
  kind: CaptionKind;
  /** performance.now() when the sound played. */
  atMs: number;
  /** Suggested display time (ms). */
  holdMs: number;
}

const KIND_OF = (key: CaptionKey): CaptionKind => {
  if (key.startsWith('crowd_')) return 'crowd';
  if (key === 'mastered' || key === 'stage_up') return 'coach';
  if (key === 'four' || key === 'six' || key.startsWith('milestone_')) return 'boundary';
  if (key === 'bowled' || key === 'caught' || key === 'caught_behind' || key === 'lbw' || key === 'not_out') return 'wicket';
  return 'bat';
};

const HOLD_MS: Readonly<Record<CaptionKind, number>> = { bat: 1600, wicket: 2600, boundary: 2400, crowd: 2000, coach: 2400 };

/** The caption of a bat (or body) contact; null for a leave. */
export function contactCaption(kind: ContactKind, timing?: SwingTiming): CaptionKey | null {
  switch (kind) {
    case 'middle':
      return timing === 'perfect' ? 'sweet_spot' : timing === 'mistimed' ? 'mistimed' : 'middle';
    case 'inside_edge':
    case 'outside_edge':
    case 'top_edge':
    case 'leading_edge':
    case 'pad':
    case 'body':
      return kind;
    case 'miss':
      return 'play_and_miss';
    default:
      return null;
  }
}

/** The caption of a confirmed dismissal. */
export function dismissalCaption(d: Dismissal): CaptionKey {
  return d === 'caught_behind' ? 'caught_behind' : d;
}

const listeners = new Set<(c: Caption) => void>();
/**
 * Whether the Captions setting is on, read when a caption is due (settings.ts installs it as it loads: the stored
 * value, read lazily). It never depends on the sound: captions work muted, with Sound off and before the audio unlock.
 */
let gate: () => boolean = () => false;
let nextId = 1;
let clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Captions for essential cues while the Captions setting is on. Returns the unsubscribe function. */
export function onCaption(fn: (c: Caption) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Installed by src/audio/settings.ts. */
export function setCaptionsGate(fn: () => boolean): void {
  gate = fn;
}

export function captionsEnabled(): boolean {
  return gate();
}

/** Emits a caption now (no work while nobody listens or captions are off). True when it was delivered. */
export function emitCaption(key: CaptionKey | null): boolean {
  if (!key || listeners.size === 0 || !gate()) return false;
  const kind = KIND_OF(key);
  const c: Caption = { id: nextId++, key, kind, atMs: clock(), holdMs: HOLD_MS[kind] };
  for (const l of listeners) {
    try {
      l(c);
    } catch {
      /* a listener never breaks the audio */
    }
  }
  return true;
}

/** TEST HOOK: a fixed clock. */
export function setCaptionClock(now: () => number): void {
  clock = now;
}
