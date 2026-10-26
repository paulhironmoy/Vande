/**
 * Journey controllers with mocked services: the hub's honest match states, the interruption-safe innings over the
 * network, Daily Six transport, deferred guest sign-up, the per-match share cap, spoiler-safe share cards, a full
 * local Practice Ghosts match that the engine verifies, and the highlight cut.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattingInput, MatchView, NextBallResponse, PlayerRef, ShareAdapter, ShotResponse } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts';
import { engine } from '@/engine';
import { ApiClientError } from '@/net/errors';
import { isValidKit } from '@/net/shared/kits';
import { memoryShareLedger } from '@/platform/shareMoments';
import { createTranslator } from '@/i18n/translator';
import { ensureI18n } from '@/i18n/sources';
import { KITS } from '@/ui/avatar/traits';
import { buildTimeline, timelineTimeOf } from '@/render3d/core/timeline';
import { dailyCard, matchCard, sortCards } from '@/screens/home/homeModel';
import { netInnings, type BattingTransport } from '@/screens/match/netInnings';
import { dailyTransport } from '@/screens/daily/dailyTransport';
import { syncAccount } from '@/screens/app/hooks';
import { __setShareLedger, shareMatchMoment, momentAvailable } from '@/screens/share/share';
import { dailyCardModel, inviteCardModel, matchCardModel, practiceCardModel } from '@/screens/share/cards';
import { finishGhostMatch, hourStamp, setupGhostMatch } from '@/screens/ghosts/ghostMatch';
import { planHighlight, sceneAt, MAX_MS, MIN_MS } from '@/highlight/plan';
import { fixtureMatchLog, FIXTURE_PLAYERS } from '@/screens/dev/fixtures';

const me: PlayerRef = FIXTURE_PLAYERS[0];
const them: PlayerRef = FIXTURE_PLAYERS[1];
const t = async () => {
  const { english } = await ensureI18n('en');
  return createTranslator('en', english, english);
};

function view(p: Partial<MatchView>): MatchView {
  return {
    matchId: 'm1',
    kind: 'duel',
    phase: 'planning',
    conditions: { pitch: 'hard', weather: 'clear' },
    me: 0,
    players: [me, them],
    locked: [false, false],
    battingDone: [false, false],
    seedCommit: 'c'.repeat(64),
    roomId: null,
    inviteUrl: null,
    rematch: null,
    myCommit: null,
    opponentCommit: null,
    deadlines: { lockBy: '2026-10-26T12:00:00Z', batBy: '2026-10-27T12:00:00Z', revealAt: null },
    myBallsFaced: 0,
    ...p,
  };
}

describe('hub match cards', () => {
  it('say what is honestly known in every phase, never results or exact times', () => {
    expect(matchCard(view({ phase: 'awaiting_opponent', players: [me, null] }), false)).toMatchObject({ status: 'invite', opponent: null, deadline: { kind: 'lock' } });
    expect(matchCard(view({ phase: 'planning' }), false)).toMatchObject({ status: 'lock', tone: 'action', deadline: { kind: 'lock', at: '2026-10-26T12:00:00Z' } });
    expect(matchCard(view({ phase: 'planning', locked: [true, false] }), false)).toMatchObject({ status: 'sealed_waiting', deadline: null });
    expect(matchCard(view({ phase: 'batting', locked: [true, true] }), false)).toMatchObject({ status: 'bat', deadline: { kind: 'bat' } });
    expect(matchCard(view({ phase: 'awaiting_reveal', battingDone: [true, false] }), false)).toMatchObject({ status: 'batted_waiting' });
    expect(matchCard(view({ phase: 'awaiting_reveal', battingDone: [true, true], deadlines: { lockBy: 'a', batBy: 'b', revealAt: '2026-10-27T15:30:00Z' } }), false)).toMatchObject({ status: 'reveal_at', deadline: { kind: 'reveal' } });
    expect(matchCard(view({ phase: 'revealed' }), false).status).toBe('reveal_ready');
    expect(matchCard(view({ phase: 'revealed' }), true).status).toBe('replay');
    expect(matchCard(view({ phase: 'expired' }), false).status).toBe('expired');
  });

  it('put actionable matches first and finished ones last', () => {
    const cards = sortCards([
      matchCard(view({ matchId: 'a', phase: 'expired' }), false),
      matchCard(view({ matchId: 'b', phase: 'awaiting_reveal', battingDone: [true, false] }), false),
      matchCard(view({ matchId: 'c', phase: 'revealed' }), false),
      matchCard(view({ matchId: 'd', phase: 'planning' }), false),
      matchCard(view({ matchId: 'e', phase: 'revealed' }), true),
    ]);
    expect(cards.map((c) => c.matchId)).toEqual(['c', 'd', 'b', 'e', 'a']);
  });

  it('Daily Six card counts attempts left from the server view', () => {
    const d = dailyCard({ day: '2026-10-25', conditions: { pitch: 'slow', weather: 'dew' }, attemptsUsed: 2, attemptsMax: 3, overCommits: ['a', 'b', 'c'], bestScore: 18, streak: 4, resetsAt: '2026-10-25T18:30:00Z' });
    expect(d).toMatchObject({ attemptsLeft: 1, canPlay: true, best: 18, streak: 4 });
    expect(dailyCard({ day: 'd', conditions: { pitch: 'slow', weather: 'dew' }, attemptsUsed: 3, attemptsMax: 3, overCommits: ['a', 'b', 'c'], bestScore: null, streak: 0, resetsAt: 'x' }).canPlay).toBe(false);
  });
});

function ball(n: number, ballsLeft: number): NextBallResponse {
  const plan = engine.autoOver('net-innings', { pitch: 'hard', weather: 'clear' });
  return { delivery: engine.revealDelivery(plan, n, { pitch: 'hard', weather: 'clear' }), ballToken: `tok${n}`, field: 'sweeper', ballsLeft };
}
const input = (n: number): BattingInput => ({ v: 1, ball: n, shot: 'defend', zone: null, tapMs: 600, trace: { pointer: 'touch', samples: [[0, 0.5, 0.5], [80, 0.5, 0.5]] }, clientElapsedMs: 900 });
const shotResponse = (n: number, complete: boolean): ShotResponse => ({ feedback: { ball: n, timing: 'good', contact: 'middle' }, inningsComplete: complete });

describe('network innings', () => {
  it('resumes a ball revealed before the app closed, then fetches the rest', async () => {
    const transport: BattingTransport = {
      outstanding: vi.fn().mockResolvedValueOnce(ball(2, 4)).mockResolvedValue(null),
      next: vi.fn().mockResolvedValueOnce(ball(3, 3)),
      shot: vi.fn().mockResolvedValue({ status: 'resolved', response: shotResponse(2, false) }),
    };
    const inn = netInnings(transport, 'm1');
    const first = await inn.start();
    expect(first?.field).toBe('sweeper');
    expect((await inn.nextBall())?.delivery.ball).toBe(2);
    expect(transport.next).not.toHaveBeenCalled();
    await inn.submitShot(input(2));
    expect(transport.shot).toHaveBeenCalledWith('m1', 'tok2', input(2));
    expect((await inn.nextBall())?.delivery.ball).toBe(3);
  });

  it('waits for a shot made offline and tells the screen while it is queued', async () => {
    let deliver!: (r: ShotResponse) => void;
    const delivered = new Promise<ShotResponse>((r) => (deliver = r));
    const transport: BattingTransport = { outstanding: vi.fn().mockResolvedValue(null), next: vi.fn().mockResolvedValue(ball(SUPER_BALL_INDEX, 0)), shot: vi.fn().mockResolvedValue({ status: 'queued', delivered }) };
    const queued = vi.fn();
    const inn = netInnings(transport, 'm1', { onQueued: queued });
    await inn.nextBall();
    const fb = inn.submitShot(input(SUPER_BALL_INDEX));
    await Promise.resolve();
    await Promise.resolve();
    expect(queued).toHaveBeenLastCalledWith(true);
    deliver(shotResponse(SUPER_BALL_INDEX, true));
    expect((await fb).timing).toBe('good');
    expect(queued).toHaveBeenLastCalledWith(false);
    expect(inn.complete()).toBe(true);
    expect(await inn.nextBall()).toBeNull();
  });

  it('ends cleanly when the server says the innings is already complete', async () => {
    const transport: BattingTransport = { outstanding: vi.fn().mockResolvedValue(null), next: vi.fn().mockRejectedValue(new ApiClientError('conflict', 'your innings is complete', 409)), shot: vi.fn() };
    const inn = netInnings(transport, 'm1');
    expect(await inn.start()).toBeNull();
    expect(inn.complete()).toBe(true);
  });

  it('surfaces offline so the screen can retry', async () => {
    const transport: BattingTransport = { outstanding: vi.fn().mockResolvedValue(null), next: vi.fn().mockRejectedValue(new ApiClientError('offline', 'answers are still waiting')), shot: vi.fn() };
    await expect(netInnings(transport, 'm1').start()).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('Daily Six transport', () => {
  beforeEach(() => sessionStorage.clear());
  it('sends queued answers first, remembers the revealed ball and answers through the outbox', async () => {
    const api = { call: vi.fn().mockResolvedValue(ball(0, 6)) };
    const outbox = { drainGroup: vi.fn().mockResolvedValue(true), submit: vi.fn().mockResolvedValue({ status: 'sent', response: shotResponse(0, false) }) };
    const tr = dailyTransport({ api, outbox } as never);
    const r = await tr.next('att1');
    expect(outbox.drainGroup).toHaveBeenCalledWith('daily:att1');
    expect(api.call).toHaveBeenCalledWith('POST /v1/daily/attempts/:id/next', { params: { id: 'att1' } });
    expect((await tr.outstanding('att1'))?.ballToken).toBe(r.ballToken);
    const out = await tr.shot('att1', r.ballToken, input(0));
    expect(out).toEqual({ status: 'resolved', response: shotResponse(0, false) });
    expect(outbox.submit).toHaveBeenCalledWith({ route: 'POST /v1/daily/attempts/:id/shot', params: { id: 'att1' }, body: { ballToken: 'tok0', input: input(0) }, group: 'daily:att1' });
    expect(await tr.outstanding('att1')).toBeNull();
  });
  it('refuses the next ball while an earlier answer is still waiting to be sent', async () => {
    const tr = dailyTransport({ api: { call: vi.fn() }, outbox: { drainGroup: vi.fn().mockResolvedValue(false), submit: vi.fn() } } as never);
    await expect(tr.next('att1')).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('deferred guest sign-up', () => {
  const player = { id: null, alias: 'Swing King', avatar: { seed: 'abcd1234ef' }, kit: KITS[0] };
  it('creates the account with the alias, then completes the profile', async () => {
    const net = { session: { ensure: vi.fn().mockResolvedValue({ playerId: 'p_123' }) }, api: { call: vi.fn().mockResolvedValue({}) } };
    expect(await syncAccount(net as never, player, 'hi')).toEqual({ id: 'p_123' });
    expect(net.session.ensure).toHaveBeenCalledWith('Swing King');
    expect(net.api.call).toHaveBeenCalledWith('PATCH /v1/me', { body: { avatar: player.avatar, kit: player.kit, locale: 'hi' } });
  });
  it('reports a rejected alias and offline separately', async () => {
    const rejected = { session: { ensure: vi.fn().mockRejectedValue(new ApiClientError('invalid', 'alias not allowed', 400)) }, api: { call: vi.fn() } };
    expect(await syncAccount(rejected as never, player, 'en')).toEqual({ error: 'alias_rejected' });
    const offline = { session: { ensure: vi.fn().mockRejectedValue(new ApiClientError('network', 'down')) }, api: { call: vi.fn() } };
    expect(await syncAccount(offline as never, player, 'en')).toEqual({ error: 'offline' });
  });
  it('starter kits are the server palette (PATCH /v1/me accepts them)', () => {
    for (const k of KITS) expect(isValidKit(k), JSON.stringify(k)).toBe(true);
  });
});

describe('sharing within the per-match cap', () => {
  const adapter = (): ShareAdapter & { share: ReturnType<typeof vi.fn> } => ({ share: vi.fn().mockResolvedValue('shared'), whatsappUrl: (text, url) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}` });
  beforeEach(() => __setShareLedger(memoryShareLedger()));
  afterEach(() => __setShareLedger(null));

  it('allows one invitation per match, through WhatsApp or the sheet (with the card image)', async () => {
    const tr = await t();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const a = adapter();
    const ctx = { kind: 'duel' as const, id: 'm1', url: 'https://vande.example/i/tok', inviterAlias: 'Swing King', pitch: 'hard' as const };
    expect(await shareMatchMoment(a, 'invite', ctx, { via: 'whatsapp', t: tr })).toBe('opened');
    expect(open.mock.calls[0][0]).toContain('https://wa.me/?text=');
    expect(open.mock.calls[0][0]).toContain(encodeURIComponent('https://vande.example/i/tok'));
    expect(await shareMatchMoment(a, 'invite', ctx, { via: 'sheet', t: tr, image: new Blob(['x'], { type: 'image/png' }) })).toBe('not_allowed');
    expect(a.share).not.toHaveBeenCalled();
    const ctx2 = { ...ctx, id: 'm2' };
    expect(await shareMatchMoment(a, 'invite', ctx2, { via: 'sheet', t: tr, image: new Blob(['x'], { type: 'image/png' }) })).toBe('shared');
    expect(a.share.mock.calls[0][0].image).toBeInstanceOf(Blob);
    expect(momentAvailable('invite', ctx2)).toBe(false);
  });

  it('a share with the card image asks the server-kept cap too (another device already shared it)', async () => {
    const { setMomentClaimer } = await import('@/platform/shareMoments');
    const tr = await t();
    const a = adapter();
    const claim = vi.fn(async () => false);
    const off = setMomentClaimer(claim);
    try {
      const ctx = { kind: 'duel' as const, id: 'm9', url: 'https://vande.example/i/k7m2p9x4qa', inviterAlias: 'Swing King', pitch: 'hard' as const };
      expect(await shareMatchMoment(a, 'invite', ctx, { via: 'sheet', t: tr, image: new Blob(['x'], { type: 'image/png' }) })).toBe('not_allowed');
      expect(claim).toHaveBeenCalledWith('m9', 'invite');
      expect(a.share).not.toHaveBeenCalled();
      // The server said no: this device remembers it.
      expect(momentAvailable('invite', ctx)).toBe(false);
    } finally {
      off();
    }
  });

  it('allows the reminder only before the deadline and the final card only after the reveal', async () => {
    const tr = await t();
    const a = adapter();
    const past = { kind: 'duel' as const, id: 'm3', url: 'u', deadline: '2020-01-01T00:00:00Z' };
    expect(await shareMatchMoment(a, 'reminder', past, { via: 'sheet', t: tr })).toBe('not_allowed');
    const sealed = { kind: 'duel' as const, id: 'm3', url: 'u', players: ['A', 'B'] as [string, string], revealed: false };
    expect(await shareMatchMoment(a, 'final', sealed, { via: 'sheet', t: tr })).toBe('not_allowed');
    expect(await shareMatchMoment(a, 'final', { ...sealed, revealed: true }, { via: 'sheet', t: tr })).toBe('shared');
  });
});

describe('share cards', () => {
  it('a sealed match card shows no score, result or Player of the Match', async () => {
    const tr = await t();
    const log = fixtureMatchLog();
    const sealed = matchCardModel(tr, { log, players: [me, them], revealed: false, url: 'https://vande.example/m/x' });
    expect(sealed).toMatchObject({ kind: 'match', score: null, result: null, potm: null });
    expect(JSON.stringify(sealed)).not.toMatch(/\d+\/\d+/);
    const open = matchCardModel(tr, { log, players: [me, them], revealed: true, url: 'https://vande.example/m/x' });
    expect(open.kind === 'match' && open.score).toEqual([`${log.innings[0].runs}/${log.innings[0].wickets}`, `${log.innings[1].runs}/${log.innings[1].wickets}`]);
    expect(open.kind === 'match' && open.result).toContain(log.players[log.result.winner ?? 0].alias);
  });
  it('invite, Daily Six and practice cards carry the challenge and a browser link', async () => {
    const tr = await t();
    const invite = inviteCardModel(tr, { inviter: me, conditions: { pitch: 'green', weather: 'humid' }, url: 'https://vande.example/i/tok' });
    expect(invite).toMatchObject({ url: 'vande.example/i/tok', title: expect.stringContaining(me.alias) });
    expect(invite.kind === 'invite' && invite.chips.length).toBe(2);
    const daily = dailyCardModel(tr, { player: me, day: '2026-10-25', score: 23, best: 27, streak: 4, conditions: null, url: 'https://vande.example/daily' });
    expect(daily.kind === 'daily' && daily.big).toBe('23');
    const practice = practiceCardModel(tr, { me, ghost: them, myScore: [14, 1], ghostScore: [11, 2], result: 'won', url: 'https://vande.example/ghosts' });
    expect(practice.kind === 'practice' && practice.score).toEqual(['14/1', '11/2']);
  });
  it('a Group Cup invite card names the cup and says what joining means, never the duel copy', async () => {
    const tr = await t();
    const duel = inviteCardModel(tr, { inviter: me, conditions: null, url: 'https://vande.example/i/tok' });
    const cup = inviteCardModel(tr, { inviter: me, conditions: null, url: 'https://vande.example/i/tok', cup: { name: 'Office Cup' } });
    expect(cup).toMatchObject({ kind: 'invite', eyebrow: 'Group Cup invite', title: `${me.alias} invited you to Office Cup`, url: 'vande.example/i/tok' });
    expect(cup.body).toMatch(/Join the cup/);
    expect(cup.body).toMatch(/everyone plays everyone/);
    expect(cup.body).toMatch(/deadline/);
    expect(cup.kind === 'invite' && cup.chips).toEqual(['Round robin', 'Top two: final']);
    expect(cup.cta).toBe('Join in your browser. No install needed.');
    for (const field of ['eyebrow', 'title', 'body', 'cta'] as const) expect(cup[field]).not.toEqual(duel[field]);
    const unnamed = inviteCardModel(tr, { inviter: me, conditions: null, url: 'https://vande.example/i/tok', cup: { name: null } });
    expect(unnamed.title).toBe(`${me.alias} invited you to a Group Cup`);
  });
});

describe('Practice Ghosts', () => {
  it('plays a full local match that the engine verifies', async () => {
    const conditions = { pitch: 'slow' as const, weather: 'dew' as const };
    const gm = setupGhostMatch(engine, engine.GHOSTS[2], 'The Enforcer', conditions, 'ab'.repeat(16));
    // Bat every ball (six and the Super Ball) with the engine's cautious policy.
    for (let n = 0; n < 7; n++) {
      const next = await gm.innings.nextBall();
      if (!next) break;
      await gm.innings.submitShot(engine.autoBat(`me-${n}`, next.delivery, gm.plan.field));
    }
    expect(gm.innings.state().done).toBe(true);
    const myPlan = engine.ghostPlan(engine.GHOSTS[0].id, 'my-plan', conditions);
    const lockHash = await engine.commitHash(myPlan, 'cafef00d');
    const log = await finishGhostMatch(engine, gm, me, myPlan, hourStamp(new Date('2026-10-25T10:20:00Z')), 'cafef00d');
    // The hash shown when the over was locked is the commit in the replay.
    expect(log.commits[0].hash).toBe(lockHash);
    expect(log.kind).toBe('ghost');
    expect(log.meta.createdHour).toBe('2026-10-25T10:00Z');
    expect(log.players[1].kind).toBe('ghost');
    const verified = await engine.verifyMatchLog(log);
    expect(verified).toEqual({ ok: true });
  });
});

describe('highlight cut', () => {
  it('is 30–60 s, a whole number of frames, contiguous and deterministic', () => {
    const log = fixtureMatchLog();
    const tl = buildTimeline(log, 'full');
    const plan = planHighlight(log, tl, { standings: true, timelineTimeOf });
    expect(plan.durationMs).toBeGreaterThanOrEqual(MIN_MS);
    expect(plan.durationMs).toBeLessThanOrEqual(MAX_MS);
    expect(plan.durationMs % 100).toBe(0);
    // The hook first: two seconds or less of the top-ranked ball, around its decisive moment, then the intro.
    const hook = plan.scenes[0];
    expect(hook.kind).toBe('hook');
    expect(hook.t0).toBe(0);
    expect(hook.t1).toBeLessThanOrEqual(2000);
    const top = tl.segments[hook.seg!];
    const decisive = timelineTimeOf(top, top.script.times.decisive);
    expect(decisive).toBeGreaterThan(hook.r0);
    expect(decisive - hook.r0).toBeLessThan(hook.t1 - hook.t0);
    expect(plan.scenes[1].kind).toBe('intro');
    // The same ball is also in the cut, in full, later.
    expect(plan.scenes.some((s, i) => i > 0 && s.kind === 'ball' && s.seg === hook.seg)).toBe(true);
    expect(plan.scenes.at(-1)?.kind).toBe('cta');
    for (let i = 1; i < plan.scenes.length; i++) expect(plan.scenes[i].t0).toBe(plan.scenes[i - 1].t1);
    expect(plan.scenes.at(-1)?.t1).toBe(plan.durationMs);
    expect(plan.scenes.map((s) => s.kind)).toEqual(expect.arrayContaining(['result', 'potm', 'standings']));
    // The turning point is always in the cut.
    const turning = tl.segments.findIndex((s) => s.kind === 'ball' && s.eventIndex === log.result.turningPointEvent);
    if (turning >= 0) expect(plan.scenes.some((s) => s.seg === turning && s.tags?.includes('turning'))).toBe(true);
    expect(planHighlight(log, buildTimeline(log, 'full'), { standings: true, timelineTimeOf })).toEqual(plan);
    const mid = plan.scenes.find((s) => s.kind === 'ball')!;
    const at = sceneAt(plan, mid.t0 + 500);
    expect(at.scene).toBe(mid);
    expect(at.replay).toBe(mid.r0 + 500);
    expect(sceneAt(plan, plan.durationMs + 999).scene.kind).toBe('cta');
  });
  it('drops standings when none are given', () => {
    const log = fixtureMatchLog();
    const plan = planHighlight(log, buildTimeline(log, 'full'), { standings: false, timelineTimeOf });
    expect(plan.scenes.some((s) => s.kind === 'standings')).toBe(false);
  });
});

describe('Training', () => {
  it('bats one ball and bowls the lesson ball into a training log the engine verifies', async () => {
    const { buildTrainingLog, trainingCoachRef, trainingPlan, trainingSetup, TRAINING_LESSON } = await import('@/engine/training');
    const { localInnings } = await import('@/screens/local/localInnings');
    const setup = trainingSetup();
    const inn = localInnings({ plan: setup.coachOver, conditions: setup.conditions, seed: setup.seed, maxBalls: 1 });
    const first = await inn.nextBall();
    await inn.submitShot(engine.autoBat('training-test', first!.delivery, setup.coachOver.field));
    expect(await inn.nextBall()).toBeNull();
    const gesture = { pointer: 'touch' as const, samples: [[0, 0.5, 0.5], [420, 0.5, 0.5], [781, 0.52, 0.5]] as Array<[number, number, number]> };
    const plan = trainingPlan(TRAINING_LESSON.choices.yorker, gesture, setup.seed);
    const log = await buildTrainingLog({ setup, player: me, coach: trainingCoachRef('Coach Ghost', them.kit), plan, inputs: inn.inputs(), finish: 'auto', hour: '2026-10-25T10:00Z' });
    expect(log.kind).toBe('training');
    expect(log.inputs[0][0]).toEqual(inn.inputs()[0]);
    expect(await engine.verifyMatchLog(log)).toEqual({ ok: true });
  });
});

describe('wave F details', () => {
  it('a card line always fits: smaller type first, then the middle of a long link elided', async () => {
    const { fitLine } = await import('@/screens/share/cards');
    const ctx = { font: '', measureText: (s: string) => ({ width: s.length * (parseInt(ctx.font.split(' ')[1], 10) * 0.55) }) } as unknown as CanvasRenderingContext2D;
    expect(fitLine(ctx, 'vande.example/i/abc', 832, 650, 28, 22)).toBe('vande.example/i/abc');
    const long = `vande.example/i/${'A'.repeat(51)}.${'B'.repeat(22)}`;
    const fitted = fitLine(ctx, long, 832, 650, 28, 22);
    expect(fitted).toContain('…');
    expect(fitted.startsWith('vande.example/i/')).toBe(true);
    expect(fitted.endsWith('B')).toBe(true);
    expect(ctx.measureText(fitted).width).toBeLessThanOrEqual(832);
  });

  it('the Daily Six score is explained exactly: runs, fours, sixes and wickets in hand', async () => {
    const { dailyBreakdown } = await import('@/screens/daily/DailyRoute');
    const ball = (runs: number, dead = false) => ({ runs, dead }) as never;
    const log = { innings: [{ runs: 21, wickets: 1, balls: [ball(4), ball(6), ball(1), ball(0), ball(4), ball(6, true)] }] } as unknown as Parameters<typeof dailyBreakdown>[0];
    expect(dailyBreakdown(log)).toEqual({ runs: 21, wickets: 1, fours: 2, sixes: 1, inHand: 1, total: 21 * 10 + 2 * 4 + 1 * 8 + 1 * 12 });
  });

  it('Hinglish relative times stay in Hinglish', async () => {
    const { hinglishRelative } = await import('@/i18n/translator');
    expect(hinglishRelative(5, 'hour')).toBe('5 ghante mein');
    expect(hinglishRelative(1, 'hour')).toBe('1 ghanta mein');
    expect(hinglishRelative(-2, 'day')).toBe('2 din pehle');
    expect(hinglishRelative(1, 'day')).toBe('kal');
    expect(hinglishRelative(0, 'second')).toBe('abhi');
    const { english } = await ensureI18n('en');
    const hl = createTranslator('hi-Latn', english, english);
    expect(hl.relative(5 * 3600_000)).toBe('5 ghante mein');
  });
});
