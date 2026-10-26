import { useEffect, useMemo, useState } from 'react';
import type { DailyView, MatchView } from '@/contracts';
import { useApp } from '@/app/store';
import { parseRoute, useRouter, type Route, type RouteOf } from '@/app/router';
import { useT, type MessageKey } from '@/i18n';
import { Avatar, Button, CardButton, Chip, Icon, IconButton, Logo, StateView, type IconName } from '@/ui';
import { useAccountSync, useLoad, useNet, useNow, usePlayerGate } from '../app/hooks';
import { failureKind } from '../app/errors';
import { clockText, untilText } from '../app/deadline';
import { dailyCard, matchCard, sortCards, watchedSet, type MatchCardModel } from './homeModel';
import { AliasFix } from '../common/AliasFix';
import { REVEAL_GRACE_MS } from '../match/revealSlot';
import s from './HomeRoute.module.css';

const HUB_SEEN = 'vc:hub-seen';

const STATUS_ICON: Record<MatchCardModel['status'], IconName> = {
  invite: 'users',
  lock: 'lock',
  sealed_waiting: 'seal',
  bat: 'bat',
  batted_waiting: 'clock',
  reveal_at: 'clock',
  reveal_ready: 'sparkle',
  rematch_offer: 'rematch',
  replay: 'replay',
  expired: 'alert',
};

/** Where a match card leads: the opponent's rematch offer opens its invitation, a watched reveal its replay. */
function cardRoute(c: MatchCardModel): Route {
  if (c.status === 'rematch_offer' && c.rematchUrl) {
    const r = parseRoute(c.rematchUrl);
    if (r.name === 'invite') return r;
  }
  return c.status === 'replay' ? { name: 'replay', matchId: c.matchId } : { name: 'match', matchId: c.matchId };
}

/** The hub: matches to continue, the Daily Six, new matches and the competitions. Only real data, never padded. */
export default function HomeRoute({ route }: { route: RouteOf<'home'> }) {
  const player = usePlayerGate(route);
  const tr = useT();
  const { t } = tr;
  const navigate = useRouter((st) => st.navigate);
  const online = useApp((st) => st.online);
  const { net, booting } = useNet();
  const sync = useAccountSync();
  const now = useNow(30_000);
  const signedIn = Boolean(player?.id);
  const [firstVisit] = useState(() => {
    try {
      return localStorage.getItem(HUB_SEEN) !== '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HUB_SEEN, '1');
    } catch {
      /* storage unavailable */
    }
  }, []);

  const matches = useLoad<MatchView[]>(net && signedIn ? () => net.api.call('GET /v1/matches') : null, [net, signedIn], { pollMs: 60_000 });
  const daily = useLoad<DailyView>(net && signedIn ? () => net.api.call('GET /v1/daily') : null, [net, signedIn], { pollMs: 120_000 });
  // The next reveal with a time (a duel's shared slot, a cup round): look again at that moment, so "Watch it" appears.
  const nextReveal = useMemo(() => {
    const at = (matches.data ?? []).filter((m) => m.phase === 'awaiting_reveal' && m.deadlines.revealAt).map((m) => Date.parse(m.deadlines.revealAt as string));
    const future = at.filter((ms) => Number.isFinite(ms) && ms > Date.now());
    return future.length ? new Date(Math.min(...future)).toISOString() : null;
  }, [matches.data]);
  const reloadMatches = matches.reload;
  useEffect(() => {
    if (!nextReveal) return;
    const id = setTimeout(reloadMatches, Math.max(0, Date.parse(nextReveal) - Date.now()) + REVEAL_GRACE_MS);
    return () => clearTimeout(id);
  }, [nextReveal, reloadMatches]);

  const cards = useMemo(() => {
    const watched = watchedSet();
    return sortCards((matches.data ?? []).map((m) => matchCard(m, watched.has(m.matchId))));
  }, [matches.data]);

  if (!player) return null;

  // Today's match: the most urgent card with something to do or watch leads the hub; the rest follow the Daily Six.
  const featured = cards.find((c) => c.tone === 'action' || c.tone === 'ready') ?? null;
  const rest = featured ? cards.filter((c) => c !== featured) : cards;

  const statusText = (c: MatchCardModel) => {
    const name = c.opponent?.alias ?? '';
    if (c.status === 'reveal_at') return t('home.status.reveal_at', { when: clockText(tr, c.deadline?.at, now) ?? '' });
    return t(`home.status.${c.status}` as MessageKey, { name });
  };
  const deadlineText = (c: MatchCardModel) => {
    if (!c.deadline || c.deadline.kind === 'reveal') return null;
    const when = untilText(tr, c.deadline.at, now);
    return when ? t(c.deadline.kind === 'lock' ? 'home.deadline.lock' : 'home.deadline.bat', { when }) : null;
  };

  const matchCard_ = (c: MatchCardModel, big: boolean) => {
    const deadline = deadlineText(c);
    return (
      <CardButton className={s.matchCard} data-tone={c.tone} data-featured={big || undefined} data-testid="home-match-card" data-match-id={c.matchId} data-status={c.status} padding={big ? 4 : 3} onClick={() => navigate(cardRoute(c))}>
        <span className={s.faces} aria-hidden="true">
          <Avatar avatar={c.me.avatar} kit={c.me.kit} size={big ? 52 : 38} decorative />
          {c.opponent ? <Avatar avatar={c.opponent.avatar} kit={c.opponent.kit} size={big ? 52 : 38} decorative /> : <span className={s.emptyFace}><Icon name="plus" size={18} /></span>}
        </span>
        <span className={s.matchText}>
          <span className={s.matchTitle}>
            {c.opponent ? t('home.vs', { name: c.opponent.alias }) : t('home.waiting_friend')}
            <span className={s.kind}>{c.stage === 'final' ? t('home.kind.final') : t(`home.kind.${c.kind}` as MessageKey)}</span>
          </span>
          <span className={s.matchStatus}>
            <Icon name={STATUS_ICON[c.status]} size={16} />
            {statusText(c)}
          </span>
          {deadline && <span className={s.deadline}>{deadline}</span>}
          {big && <span className={s.cta}>{t(`home.cta.${c.status}` as MessageKey)}</span>}
        </span>
        <Icon name="forward" size={18} className={s.chev} />
      </CardButton>
    );
  };

  const matchesBody = (() => {
    if (!net) return <p className={s.note}>{booting ? t('common.loading') : t('home.offline_build')}</p>;
    if (!signedIn) return sync === 'alias_rejected' ? <AliasFix /> : <p className={s.note}>{sync === 'offline' || !online ? t('home.matches_offline') : t('home.matches_signing_in')}</p>;
    if (matches.loading && !matches.data) return <StateView kind="loading" compact />;
    if (matches.error && !matches.data) {
      const kind = failureKind(matches.error);
      return kind === 'offline' ? <p className={s.note}>{t('home.matches_offline')}</p> : <StateView kind="error" compact title={t('home.matches_error')} onAction={matches.reload} />;
    }
    if (cards.length === 0)
      return (
        <div className={s.empty}>
          <Icon name="stumps" size={28} />
          <div>
            <p className={s.emptyTitle}>{t('home.matches_empty_title')}</p>
            <p className={s.note}>{t('home.matches_empty_body')}</p>
          </div>
        </div>
      );
    // Only today's match: it already leads the hub, so there is no list to show.
    if (rest.length === 0) return null;
    return (
      <ul className={s.matchList}>
        {rest.map((c) => (
          <li key={c.matchId}>{matchCard_(c, false)}</li>
        ))}
      </ul>
    );
  })();

  const dailyBody = (() => {
    const d = daily.data ? dailyCard(daily.data) : null;
    const offline = !net || !signedIn || (!d && daily.error && failureKind(daily.error) === 'offline');
    return (
      <CardButton className={s.daily} padding={4} data-testid="home-daily-card" onClick={() => navigate({ name: 'daily' })} aria-describedby="home-daily-meta">
        <span className={s.dailyGlow} aria-hidden="true" />
        <span className={s.dailyTop}>
          <span className={s.dailyEyebrow}>
            <Icon name="calendar" size={16} /> {t('home.daily.title')}
          </span>
          {daily.data && <span className={s.dailyDay}>{tr.date(`${daily.data.day}T12:00:00+05:30`, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</span>}
        </span>
        <span className={s.dailyHead}>{d ? (d.canPlay ? t('home.daily.headline') : t('home.daily.done')) : t('home.daily.headline')}</span>
        <span className={s.dailyBody}>{t('home.daily.body')}</span>
        <span className={s.dailyMeta} id="home-daily-meta">
          {d ? (
            <>
              <span className={s.pips}>
                {Array.from({ length: d.attemptsMax }, (_, i) => (
                  <span key={i} className={s.pip} data-used={i >= d.attemptsLeft || undefined} aria-hidden="true" />
                ))}
                <span>{t('home.daily.attempts', { count: d.attemptsLeft })}</span>
              </span>
              {d.best !== null && <Chip tone="amber" icon="trophy">{t('home.daily.best', { score: tr.number(d.best) })}</Chip>}
              {d.streak > 0 && <Chip tone="violet" icon="flame">{t('home.daily.streak', { count: d.streak })}</Chip>}
              <span className={s.resets}>{t('home.daily.resets', { when: untilText(tr, d.resetsAt, now) ?? '' })}</span>
            </>
          ) : (
            <span className={s.resets}>{offline ? t('home.daily.offline') : daily.loading ? t('common.loading') : t('home.daily.offline')}</span>
          )}
        </span>
      </CardButton>
    );
  })();

  const tile = (testId: string, icon: IconName, title: string, body: string, onClick: () => void, opts: { hero?: boolean; needsNet?: boolean } = {}) => (
    <CardButton className={s.tile} data-hero={opts.hero || undefined} data-testid={testId} padding={4} onClick={onClick}>
      <span className={s.tileIcon} aria-hidden="true">
        <Icon name={icon} size={opts.hero ? 28 : 22} />
      </span>
      <span className={s.tileTitle}>{title}</span>
      <span className={s.tileBody}>{body}</span>
      {opts.needsNet && !net && <span className={s.tileNote}>{t('home.needs_online')}</span>}
    </CardButton>
  );

  return (
    <main className={s.screen} data-testid="home-screen">
      <header className={s.top}>
        <Logo size={34} wordmark title={t('brand.name')} />
        <div className={s.topActions}>
          <IconButton icon="settings" label={t('home.settings')} onClick={() => navigate({ name: 'settings' })} data-testid="home-settings" />
          <button type="button" className={s.me} onClick={() => navigate({ name: 'profile' })} aria-label={t('home.profile')} data-testid="home-profile">
            <Avatar avatar={player.avatar} kit={player.kit} size={40} decorative />
          </button>
        </div>
      </header>

      <section className={s.hero}>
        <p className={s.eyebrow}>{t('home.eyebrow')}</p>
        <h1 className={s.h1}>{t('home.title')}</h1>
        <p className={s.lede}>{firstVisit ? t('home.greeting_first', { name: player.alias }) : t('home.greeting', { name: player.alias })}</p>
      </section>

      {featured && (
        <section className={s.section} aria-labelledby="home-next">
          <h2 id="home-next" className={s.h2}>
            {t('home.your_move')}
          </h2>
          {matchCard_(featured, true)}
        </section>
      )}

      {dailyBody}

      {matchesBody && (
        <section className={s.section} aria-labelledby="home-matches">
          <div className={s.sectionHead}>
            <h2 id="home-matches" className={s.h2}>
              {featured ? t('home.matches_other') : t('home.matches')}
            </h2>
            {rest.length > 0 && <span className={s.count}>{t('home.matches_count', { count: rest.length })}</span>}
          </div>
          {matchesBody}
        </section>
      )}

      <section className={s.section} aria-labelledby="home-new">
        <h2 id="home-new" className={s.h2}>
          {t('home.new')}
        </h2>
        <div className={s.tiles}>
          {tile('home-duel', 'users', t('home.duel.title'), t('home.duel.body'), () => navigate({ name: 'duel_new' }), { hero: true, needsNet: true })}
          <div className={s.modeList}>
            {tile('home-cup', 'cup', t('home.cup.title'), t('home.cup.body'), () => navigate({ name: 'cup_new' }), { needsNet: true })}
            {tile('home-ghosts', 'ghost', t('home.ghosts.title'), t('home.ghosts.body'), () => navigate({ name: 'ghosts' }))}
            {tile('home-training', 'target', t('home.training.title'), t('home.training.body'), () => navigate({ name: 'training' }))}
          </div>
        </div>
      </section>

      <section className={s.section} aria-labelledby="home-compete">
        <h2 id="home-compete" className={s.h2}>
          {t('home.compete')}
        </h2>
        <div className={s.links}>
          <Button variant="secondary" icon="crown" onClick={() => navigate({ name: 'top100' })} data-testid="home-top100">
            {t('home.top100')}
          </Button>
          <Button variant="secondary" icon="chart" onClick={() => navigate({ name: 'leaderboards', scope: 'national' })} data-testid="home-leaderboards">
            {t('home.leaderboards')}
          </Button>
          <Button variant="secondary" icon="user" onClick={() => navigate({ name: 'profile' })} data-testid="home-profile-link">
            {t('home.profile_link')}
          </Button>
        </div>
      </section>
      <p className={s.footer}>{t('brand.tagline')}</p>
    </main>
  );
}
