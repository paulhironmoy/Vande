import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShareMessage, canShare, claimMoment, istWhen, localShareLedger, memoryShareLedger, reminderFor, setMomentClaimer, shareMoment, type ShareContext } from '@/platform/shareMoments';
import { createShareAdapter } from '@/platform/share';
import { parseAppLink } from '@/platform/deepLinks';
import { createInstallReferrerSource } from '@/platform/installReferrer';
import { createMemorySecureStore } from '@/platform/secureStore';
import { MATCH_CHANNEL, nativePushPlugin } from '@/platform/push';
import { practiceAgainst } from '@/net/practice';
import { roomIdFor } from '@/net/shared/ids';

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    createChannel: vi.fn(async () => undefined),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    register: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: async () => undefined })),
  },
}));

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

const TOKEN = `${'A'.repeat(51)}.${'b'.repeat(22)}`;
const ctx: ShareContext = { kind: 'duel', id: 'm1', url: `https://vande.example/i/${TOKEN}`, inviterAlias: 'Swift Tiger', pitch: 'green', deadline: '2026-10-26T18:30:00.000Z', players: ['Swift Tiger', 'Calm Cobra'], revealed: false };

describe('share moments (WhatsApp at most three times per match)', () => {
  it('builds spoiler-safe texts in English, Hindi and Hinglish', () => {
    expect(buildShareMessage('invite', ctx).text).toBe('Swift Tiger challenged you to a Sealed Six duel on a green pitch. Lock your over. Reveal the rivalry.');
    expect(buildShareMessage('invite', { ...ctx, locale: 'hi' }).text).toContain('हरी पिच');
    // Without knowing the friend's task the reminder is general, with a real weekday, date and time in IST.
    expect(buildShareMessage('reminder', { ...ctx, locale: 'hi-Latn' }).text).toBe('Hamara VANDE Cricket match wait kar raha hai. Agar tumne abhi tak apni baari nahi kheli, to Tue, 27 Oct, 12:00 am IST tak khel lo.');
    expect(buildShareMessage('final', { ...ctx, revealed: true }).text).toBe('The reveal is ready: Swift Tiger vs Calm Cobra. Watch who won.');
    expect(buildShareMessage('invite', { ...ctx, kind: 'cup', cupName: 'Office Cup' }).text).toContain('Office Cup');
    // Without a name the cup message still reads naturally.
    expect(buildShareMessage('invite', { ...ctx, kind: 'cup' }).text).toBe('Swift Tiger invited you to a Group Cup on VANDE Cricket. Join before it starts.');
    expect(buildShareMessage('invite', { ...ctx, kind: 'cup', locale: 'hi' }).text).toContain('एक ग्रुप कप');
    expect(buildShareMessage('invite', ctx, (k) => (k === 'share.invite_duel' ? 'custom' : null)).text).toBe('custom');
  });

  it('allows each moment once; the reminder only before its deadline; the final only after the reveal', async () => {
    const ledger = memoryShareLedger();
    const adapter = createShareAdapter({ native: () => false, nav: { share: async () => undefined } });
    const now = Date.parse('2026-10-26T12:00:00Z');
    expect(await shareMoment(adapter, ledger, 'invite', ctx, { now })).toBe('shared');
    expect(await shareMoment(adapter, ledger, 'invite', ctx, { now })).toBe('not_allowed');
    expect(canShare(ledger, 'reminder', ctx, Date.parse('2026-10-26T19:00:00Z'))).toBe(false);
    const open = vi.fn();
    expect(await shareMoment(adapter, ledger, 'reminder', ctx, { now, via: 'whatsapp', open })).toBe('opened');
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/\?text=/), '_blank', 'noopener,noreferrer');
    expect(await shareMoment(adapter, ledger, 'final', ctx, { now })).toBe('not_allowed');
    expect(await shareMoment(adapter, ledger, 'final', { ...ctx, revealed: true }, { now })).toBe('shared');
    expect(['invite', 'reminder', 'final'].every((m) => !canShare(ledger, m as 'invite', { ...ctx, revealed: true }, now))).toBe(true);
  });

  it('passes a share card image to the sheet, never to a wa.me link', async () => {
    const share = vi.fn(async (_input: { title: string; text: string; url: string; image?: Blob }) => 'shared' as const);
    const adapter = { share, whatsappUrl: (t: string, u: string) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}` };
    const image = new Blob(['png'], { type: 'image/png' });
    expect(await shareMoment(adapter, memoryShareLedger(), 'invite', ctx, { image })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'VANDE Cricket', text: expect.stringContaining('Swift Tiger'), url: ctx.url, image });
    expect(await shareMoment(adapter, memoryShareLedger(), 'invite', ctx)).toBe('shared');
    expect(share.mock.calls[1][0]).not.toHaveProperty('image');
    const open = vi.fn();
    expect(await shareMoment(adapter, memoryShareLedger(), 'invite', ctx, { image, via: 'whatsapp', open })).toBe('opened');
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('a cancelled sheet does not use up the moment; the ledger survives a restart', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const cancel = createShareAdapter({ native: () => false, nav: { share: async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) } });
    expect(await shareMoment(cancel, localShareLedger(storage), 'invite', ctx)).toBe('cancelled');
    expect(canShare(localShareLedger(storage), 'invite', ctx)).toBe(true);
    await shareMoment(createShareAdapter({ native: () => false, nav: { share: async () => undefined } }), localShareLedger(storage), 'invite', ctx);
    expect(canShare(localShareLedger(storage), 'invite', ctx)).toBe(false);
  });
});

describe('the share cap lives on the server; the ledger is its cache', () => {
  const sheet = () => createShareAdapter({ native: () => false, nav: { share: async () => undefined } });
  afterEach(() => setMomentClaimer(null));

  it('asks the server just before the sheet opens; a no is cached, so clearing storage no longer resets the cap', async () => {
    const asked: string[] = [];
    const server = new Set<string>();
    // The server's view: the first ask of a moment is allowed, later ones are not.
    const unregister = setMomentClaimer(async (id, moment) => {
      asked.push(`${id}:${moment}`);
      if (server.has(`${id}:${moment}`)) return false;
      server.add(`${id}:${moment}`);
      return true;
    });
    const share = vi.fn(async () => 'shared' as const);
    const adapter = { share, whatsappUrl: () => '' };
    expect(await shareMoment(adapter, memoryShareLedger(), 'invite', ctx)).toBe('shared');
    // This device's data was cleared: a fresh ledger shows the button, the server says no, nothing opens.
    const fresh = memoryShareLedger();
    expect(canShare(fresh, 'invite', ctx)).toBe(true);
    expect(await shareMoment(adapter, fresh, 'invite', ctx)).toBe('not_allowed');
    expect(share).toHaveBeenCalledTimes(1);
    // The answer is cached: the button hides and the server is not asked again.
    expect(canShare(fresh, 'invite', ctx)).toBe(false);
    expect(await shareMoment(adapter, fresh, 'invite', ctx)).toBe('not_allowed');
    expect(asked).toEqual(['m1:invite', 'm1:invite']);
    // WhatsApp asks the same way.
    const open = vi.fn();
    expect(await shareMoment(adapter, memoryShareLedger(), 'invite', ctx, { via: 'whatsapp', open })).toBe('not_allowed');
    expect(open).not.toHaveBeenCalled();
    unregister();
    expect(await shareMoment(adapter, memoryShareLedger(), 'invite', ctx)).toBe('shared');
  });

  it('offline, signed out, failing or slow: this device decides, and the tap still opens the sheet', async () => {
    for (const claim of [async () => null, async () => Promise.reject(new Error('offline')), () => new Promise<boolean | null>(() => undefined)]) {
      const ledger = memoryShareLedger();
      expect(await shareMoment(sheet(), ledger, 'invite', ctx, { claim, claimTimeoutMs: 20 })).toBe('shared');
      expect(await shareMoment(sheet(), ledger, 'invite', ctx, { claim, claimTimeoutMs: 20 })).toBe('not_allowed');
    }
    // A used moment on this device is never even asked about.
    const claim = vi.fn(async () => true);
    const ledger = memoryShareLedger();
    ledger.mark('m1', 'invite');
    expect(await claimMoment(ledger, 'invite', ctx, { claim })).toBe(false);
    expect(claim).not.toHaveBeenCalled();
    // null opts out of the server for one call.
    setMomentClaimer(async () => false);
    expect(await shareMoment(sheet(), memoryShareLedger(), 'invite', ctx, { claim: null })).toBe('shared');
    expect(await shareMoment(sheet(), memoryShareLedger(), 'invite', ctx)).toBe('not_allowed');
  });
});

describe('the reminder is true whatever the friend has done, and says when', () => {
  const deadlines = { lockBy: '2026-10-26T18:30:00.000Z', batBy: '2026-10-27T15:29:00.000Z', revealAt: null as string | null };
  const view = (over: Partial<Parameters<typeof reminderFor>[0]> = {}): Parameters<typeof reminderFor>[0] => ({ kind: 'duel', phase: 'awaiting_reveal', me: 0, locked: [true, true], battingDone: [true, false], deadlines, ...over });

  it("the first batter, before the friend's innings is visible: a conditional bat reminder with a real date", () => {
    const step = reminderFor(view());
    expect(step).toEqual({ task: 'bat', deadline: deadlines.batBy });
    const text = buildShareMessage('reminder', { ...ctx, ...step }).text;
    expect(text).toBe("Our VANDE Cricket match is waiting for its reveal. If you haven’t batted yet, bat by Tue, 27 Oct, 8:59 pm IST.");
    expect(buildShareMessage('reminder', { ...ctx, ...step, locale: 'hi' }).text).toContain('अगर आपने अभी तक बल्लेबाज़ी नहीं की है');
    expect(buildShareMessage('reminder', { ...ctx, ...step, locale: 'hi-Latn' }).text).toBe('Hamara VANDE Cricket match reveal ka wait kar raha hai. Agar tumne abhi tak batting nahi ki, to Tue, 27 Oct, 8:59 pm IST tak kar lo.');
  });

  it('once the reveal time is known (both innings are over), never offered', () => {
    expect(reminderFor(view({ deadlines: { ...deadlines, revealAt: '2026-10-27T15:35:00.000Z' } }))).toBeNull();
    expect(reminderFor(view({ battingDone: [true, true] }))).toBeNull();
    expect(reminderFor(view({ phase: 'revealed' }))).toBeNull();
    expect(reminderFor(view({ kind: 'daily' }))).toBeNull();
  });

  it('before the friend is seen to lock: a conditional lock reminder; a cup keeps reminding despite its fixed reveal time', () => {
    const lock = reminderFor(view({ phase: 'planning', locked: [true, false], battingDone: [false, false] }));
    expect(lock).toEqual({ task: 'lock', deadline: deadlines.lockBy });
    expect(buildShareMessage('reminder', { ...ctx, ...lock }).text).toBe('Our VANDE Cricket match is on. If you haven’t locked your over yet, lock it by Tue, 27 Oct, 12:00 am IST.');
    expect(reminderFor(view({ kind: 'cup', deadlines: { ...deadlines, revealAt: '2026-10-27T15:29:00.000Z' } }))).toEqual({ task: 'bat', deadline: deadlines.batBy });
    expect(istWhen('not a date')).toBe('');
  });
});

describe('deep links with a base path, install referrer timeout, push plugin, helpers', () => {
  it('parses invite links under a base path such as https://host/Vande', () => {
    const origins = ['https://paulhironmoy.github.io/Vande'];
    expect(parseAppLink(`https://paulhironmoy.github.io/Vande/i/${TOKEN}`, origins)).toEqual({ kind: 'invite', token: TOKEN, attribution: null });
    expect(parseAppLink(`https://paulhironmoy.github.io/i/${TOKEN}`, origins)).toBeNull();
    expect(parseAppLink(`https://paulhironmoy.github.io/Other/i/${TOKEN}`, origins)).toBeNull();
  });

  it('gives up on a referrer service that never answers', async () => {
    const src = createInstallReferrerSource({ plugin: { getReferrer: () => new Promise(() => undefined) }, store: createMemorySecureStore(), timeoutMs: 20 });
    expect(await src.pendingInviteUrl()).toBeNull();
  });

  it('uses @capacitor/push-notifications natively and creates the "matches" channel', async () => {
    expect(await nativePushPlugin()).toBeNull();
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n: string) => n === 'PushNotifications', getPlatform: () => 'android' };
    const plugin = await nativePushPlugin();
    expect(plugin).not.toBeNull();
    const { PushNotifications } = await import('@capacitor/push-notifications');
    expect(PushNotifications.createChannel).toHaveBeenCalledWith(MATCH_CHANNEL);
  });

  it('derives room ids and offers the opponent’s revealed over for practice', () => {
    expect(roomIdFor('mabcdefghijklmnopqrstuvwxyz')).toBe('rabcdefghijklmnopqrstuvwxyz');
    const log = { conditions: { pitch: 'slow', weather: 'dew' }, plans: [{ v: 1, n: 0 }, { v: 1, n: 1 }], players: [{ alias: 'A' }, { alias: 'B' }] } as never;
    expect(practiceAgainst(log, 0)).toEqual({ conditions: { pitch: 'slow', weather: 'dew' }, plan: { v: 1, n: 1 }, opponent: { alias: 'B' } });
  });
});
