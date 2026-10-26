/**
 * WhatsApp and share-sheet messages for exactly three moments of a match or cup: the invitation, an optional deadline
 * reminder, and the final reveal (or its highlight). Texts are spoiler-safe: never a score, a result or a hidden
 * choice, so they are worth opening even for someone who is not playing. Nothing is sent by itself: the share sheet or
 * wa.me opens only from the player's tap. Experience can pass its own translator; built-in copy covers English, Hindi
 * and Hinglish.
 *
 * The cap: each player shares each moment at most once per match or cup (the invitation, one reminder before its
 * deadline, and the final reveal or its highlight), so friends are not spammed. The server keeps it
 * (POST /v1/matches/:id/moments, asked just before the sheet opens through the claimer that src/net registers), so
 * clearing the app's data or another device does not reset it. This device's ledger (`vc:share-ledger`) is the cache
 * that hides a used moment's button, and decides alone when the server cannot answer (offline, signed out, slow).
 *
 * The reminder is true whatever the friend has done: this player sees the friend's lock and innings only after the
 * activity jitter, so it names the next step conditionally ("if you haven't batted yet, bat by …") with a real weekday,
 * date and time in IST (`reminderFor` picks the step from this player's own view). It is never offered once the friend
 * is known to be done, nor in a duel once its reveal time is known (both innings are then over).
 */
import type { PitchId, ShareAdapter } from '@/contracts';
import { settleWithin } from './capacitor';
import { openWhatsapp } from './share';

import type { ShareMoment } from '@/contracts';
export type { ShareMoment };
export type ShareLocale = 'en' | 'hi' | 'hi-Latn';

export interface ShareContext {
  kind: 'duel' | 'cup';
  /** Match id (duels) or cup id: one ledger per match or cup. */
  id: string;
  url: string;
  inviterAlias?: string;
  cupName?: string;
  pitch?: PitchId;
  /** ISO deadline for the reminder (the lock deadline when the friend still has to lock, else the batting one). */
  deadline?: string;
  /** What the friend still has to do, as far as this player may know (`reminderFor`); without it the text is general. */
  task?: 'lock' | 'bat';
  /** Aliases for the final reveal message. */
  players?: [string, string];
  /** The reveal has happened (required for the final moment). */
  revealed?: boolean;
  /**
   * A published highlight of this match: the final moment then shares its landing (https://<web>/h/<code>) instead
   * of the reveal (one final message per match either way).
   */
  highlight?: { code: string; url: string };
  locale?: ShareLocale;
}

export type Translate = (key: string, params: Record<string, string>) => string | null;

export interface ShareLedger {
  used(id: string, moment: ShareMoment): boolean;
  mark(id: string, moment: ShareMoment): void;
}

const LEDGER_KEY = 'vc:share-ledger';
const LEDGER_MAX = 300;

/**
 * Asks the server whether this player may still share a moment (POST /v1/matches/:id/moments). True or false is the
 * server's answer; null means no answer (offline, signed out, an error), and the local ledger decides.
 */
export type MomentClaimer = (id: string, moment: ShareMoment) => Promise<boolean | null>;

let registered: MomentClaimer | null = null;

/** Registers the server claimer (src/net does, once it has a session manager); returns the unregister function. */
export function setMomentClaimer(claim: MomentClaimer | null): () => void {
  registered = claim;
  return () => {
    if (registered === claim) registered = null;
  };
}

/** How long a share waits for the server before the local ledger decides (the tap's user activation must survive). */
export const CLAIM_TIMEOUT_MS = 1_500;

/**
 * Just before a share sheet or WhatsApp opens: the server's answer, cached in the ledger when it is no (so the button
 * hides from then on, also after this device's data was cleared), or the ledger's when the server cannot answer.
 */
export async function claimMoment(ledger: ShareLedger, moment: ShareMoment, ctx: Pick<ShareContext, 'id'>, opts: { claim?: MomentClaimer | null; timeoutMs?: number } = {}): Promise<boolean> {
  if (ledger.used(ctx.id, moment)) return false;
  const claim = opts.claim === undefined ? registered : opts.claim;
  if (!claim) return true;
  let asked: Promise<boolean | null>;
  try {
    asked = claim(ctx.id, moment);
  } catch {
    return true;
  }
  const answer = await settleWithin(asked, opts.timeoutMs ?? CLAIM_TIMEOUT_MS, null);
  if (answer === false) {
    ledger.mark(ctx.id, moment);
    return false;
  }
  return true;
}

export function memoryShareLedger(): ShareLedger {
  const used = new Set<string>();
  return { used: (id, m) => used.has(`${id}:${m}`), mark: (id, m) => void used.add(`${id}:${m}`) };
}

export function localShareLedger(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): ShareLedger {
  const read = (): string[] => {
    try {
      return JSON.parse(storage?.getItem(LEDGER_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  };
  return {
    used: (id, m) => read().includes(`${id}:${m}`),
    mark(id, m) {
      try {
        storage?.setItem(LEDGER_KEY, JSON.stringify([...read().filter((x) => x !== `${id}:${m}`), `${id}:${m}`].slice(-LEDGER_MAX)));
      } catch {
        /* storage unavailable: the in-app share buttons still limit themselves for this session */
      }
    },
  };
}

const PITCH: Record<ShareLocale, Record<PitchId, string>> = {
  en: { green: 'green', hard: 'hard', slow: 'slow' },
  hi: { green: 'हरी', hard: 'सख़्त', slow: 'धीमी' },
  'hi-Latn': { green: 'green', hard: 'hard', slow: 'slow' },
};

const COPY: Record<ShareLocale, Record<string, string>> = {
  en: {
    'share.invite_duel': '{inviter} challenged you to a Sealed Six duel on a {pitch} pitch. Lock your over. Reveal the rivalry.',
    'share.invite_cup': '{inviter} invited you to {cup}, a Group Cup on VANDE Cricket. Join before it starts.',
    'share.invite_cup_unnamed': '{inviter} invited you to a Group Cup on VANDE Cricket. Join before it starts.',
    'share.reminder': 'Our VANDE Cricket match is waiting. If you haven’t played your turn yet, play it by {when} IST.',
    'share.reminder_lock': 'Our VANDE Cricket match is on. If you haven’t locked your over yet, lock it by {when} IST.',
    'share.reminder_bat': 'Our VANDE Cricket match is waiting for its reveal. If you haven’t batted yet, bat by {when} IST.',
    'share.final': 'The reveal is ready: {a} vs {b}. Watch who won.',
    'share.highlight': '{a} vs {b} made the VANDE Cricket Daily Top 100. Watch the highlight, then try to beat them.',
  },
  hi: {
    'share.invite_duel': '{inviter} ने आपको {pitch} पिच पर सील्ड सिक्स मुकाबले की चुनौती दी है। अपना ओवर लॉक करें, फिर रिवील देखें।',
    'share.invite_cup': '{inviter} ने आपको VANDE Cricket के ग्रुप कप {cup} में बुलाया है। शुरू होने से पहले जुड़ें।',
    'share.invite_cup_unnamed': '{inviter} ने आपको VANDE Cricket के एक ग्रुप कप में बुलाया है। शुरू होने से पहले जुड़ें।',
    'share.reminder': 'हमारा VANDE Cricket मैच इंतज़ार कर रहा है। अगर आपने अभी तक अपनी बारी नहीं खेली है, तो {when} IST तक खेल लें।',
    'share.reminder_lock': 'हमारा VANDE Cricket मैच चल रहा है। अगर आपने अभी तक अपना ओवर लॉक नहीं किया है, तो {when} IST तक कर लें।',
    'share.reminder_bat': 'हमारा VANDE Cricket मैच रिवील का इंतज़ार कर रहा है। अगर आपने अभी तक बल्लेबाज़ी नहीं की है, तो {when} IST तक कर लें।',
    'share.final': 'रिवील तैयार है: {a} बनाम {b}। देखिए कौन जीता।',
    'share.highlight': '{a} बनाम {b} ने VANDE Cricket डेली टॉप 100 में जगह बनाई। हाइलाइट देखिए, फिर उन्हें हराकर दिखाइए।',
  },
  'hi-Latn': {
    'share.invite_duel': '{inviter} ne tumhe {pitch} pitch pe Sealed Six duel ki challenge di hai. Apna over lock karo, phir reveal dekho.',
    'share.invite_cup': '{inviter} ne tumhe {cup} Group Cup mein bulaya hai. Shuru hone se pehle join karo.',
    'share.invite_cup_unnamed': '{inviter} ne tumhe VANDE Cricket ke ek Group Cup mein bulaya hai. Shuru hone se pehle join karo.',
    'share.reminder': 'Hamara VANDE Cricket match wait kar raha hai. Agar tumne abhi tak apni baari nahi kheli, to {when} IST tak khel lo.',
    'share.reminder_lock': 'Hamara VANDE Cricket match chal raha hai. Agar tumne abhi tak apna over lock nahi kiya, to {when} IST tak kar lo.',
    'share.reminder_bat': 'Hamara VANDE Cricket match reveal ka wait kar raha hai. Agar tumne abhi tak batting nahi ki, to {when} IST tak kar lo.',
    'share.final': 'Reveal ready hai: {a} vs {b}. Dekho kaun jeeta.',
    'share.highlight': '{a} vs {b} VANDE Cricket Daily Top 100 mein aaye. Highlight dekho, phir unhe hara ke dikhao.',
  },
};

/** "Sun, 26 Oct, 7:04 pm" in IST: a weekday and a date, so a reminder sent days ahead still names the right moment. */
export function istWhen(iso: string, locale: ShareLocale = 'en'): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(at);
}

/**
 * The next step the reminder names, and by when, from this player's own match view. The friend's flags reach this
 * player only after the activity jitter, so a step is named conditionally ("if you haven't … yet"): true either way.
 * Null when the friend is known to be done, when the match is over, or in a duel once its reveal time is known (it is
 * shown only after both innings end). A cup's reveal time is a fixed public schedule, so it says nothing about the
 * friend there.
 */
export function reminderFor(v: {
  kind?: 'duel' | 'cup' | 'daily';
  phase?: string;
  me: 0 | 1;
  locked: [boolean, boolean];
  battingDone: [boolean, boolean];
  deadlines: { lockBy: string; batBy: string; revealAt?: string | null };
}): { task: 'lock' | 'bat'; deadline: string } | null {
  if (v.kind === 'daily' || v.phase === 'revealed' || v.phase === 'expired') return null;
  if (v.kind !== 'cup' && v.deadlines.revealAt) return null;
  const other = v.me === 0 ? 1 : 0;
  if (v.battingDone[other]) return null;
  if (!v.locked[other]) return { task: 'lock', deadline: v.deadlines.lockBy };
  return { task: 'bat', deadline: v.deadlines.batBy };
}

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? '');
}

/** Whether this moment may be shared now (once per match or cup; reminder before its deadline; final after reveal). */
export function canShare(ledger: ShareLedger, moment: ShareMoment, ctx: ShareContext, now = Date.now()): boolean {
  if (ledger.used(ctx.id, moment)) return false;
  if (moment === 'reminder') return Boolean(ctx.deadline) && Date.parse(ctx.deadline as string) > now;
  if (moment === 'final') return (ctx.revealed === true || Boolean(ctx.highlight)) && Boolean(ctx.players);
  return true;
}

export function buildShareMessage(moment: ShareMoment, ctx: ShareContext, t?: Translate): { title: string; text: string; url: string } {
  const locale = ctx.locale ?? 'en';
  const cupKey = ctx.cupName ? 'share.invite_cup' : 'share.invite_cup_unnamed';
  const reminderKey = ctx.task === 'lock' ? 'share.reminder_lock' : ctx.task === 'bat' ? 'share.reminder_bat' : 'share.reminder';
  const key = moment === 'invite' ? (ctx.kind === 'cup' ? cupKey : 'share.invite_duel') : moment === 'reminder' ? reminderKey : ctx.highlight ? 'share.highlight' : 'share.final';
  const params: Record<string, string> = {
    inviter: ctx.inviterAlias ?? 'A friend',
    cup: ctx.cupName ?? '',
    pitch: PITCH[locale][ctx.pitch ?? 'hard'],
    when: ctx.deadline ? istWhen(ctx.deadline, locale) : '',
    a: ctx.players?.[0] ?? '',
    b: ctx.players?.[1] ?? '',
  };
  const text = t?.(key, params) ?? fill(COPY[locale][key], params);
  return { title: 'VANDE Cricket', text, url: moment === 'final' && ctx.highlight ? ctx.highlight.url : ctx.url };
}

export type ShareMomentResult = Awaited<ReturnType<ShareAdapter['share']>> | 'opened' | 'not_allowed';

/**
 * Shares one moment through the system sheet or WhatsApp; call it from the player's tap only. The server is asked
 * first (claimMoment: at most CLAIM_TIMEOUT_MS, then this device's ledger decides); a moment is recorded as used once
 * the sheet reports success or WhatsApp was opened. `image` (a share card) goes to the sheet; a wa.me link can only
 * carry text. `claim` replaces the registered server claimer (null: this device's ledger only).
 */
export async function shareMoment(
  adapter: ShareAdapter,
  ledger: ShareLedger,
  moment: ShareMoment,
  ctx: ShareContext,
  opts: { via?: 'sheet' | 'whatsapp'; t?: Translate; now?: number; open?: Parameters<typeof openWhatsapp>[2]; image?: Blob; onShared?: (moment: ShareMoment, ctx: ShareContext) => void; claim?: MomentClaimer | null; claimTimeoutMs?: number } = {},
): Promise<ShareMomentResult> {
  if (!canShare(ledger, moment, ctx, opts.now)) return 'not_allowed';
  if (!(await claimMoment(ledger, moment, ctx, { claim: opts.claim, timeoutMs: opts.claimTimeoutMs }))) return 'not_allowed';
  const msg = buildShareMessage(moment, ctx, opts.t);
  const shared = () => {
    ledger.mark(ctx.id, moment);
    // e.g. net.attribution.report(ctx.highlight.code, 'share') for a highlight.
    try {
      opts.onShared?.(moment, ctx);
    } catch {
      /* attribution is best effort */
    }
  };
  if (opts.via === 'whatsapp') {
    openWhatsapp(msg.text, msg.url, opts.open);
    shared();
    return 'opened';
  }
  const result = await adapter.share(opts.image ? { ...msg, image: opts.image } : msg);
  if (result === 'shared' || result === 'copied') shared();
  return result;
}
