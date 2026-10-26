import { useRef, useState } from 'react';
import type { MatchEventLog, MatchView, ReplayMode } from '@/contracts';
import type { Services } from '@/app/services';
import type { Net } from '@/net';
import { useApp } from '@/app/store';
import { parseRoute, useRouter } from '@/app/router';
import { useT, type Translator } from '@/i18n';
import { ScreenShell, StateView } from '@/ui';
import { RevealScreen } from '../reveal/RevealScreen';
import { failureKind } from '../app/errors';
import { markWatched } from '../home/homeModel';
import { cardBlob, matchCardModel, playerOf } from '../share/cards';
import { saveInvite, shareLocale, shareMatchMoment, shareToast } from '../share/share';
import { useRevealLog } from './reveal';
import { rememberResult } from './rivalry';

/** The final share's text says what the card shows: the result, then "Watch the reveal". */
export function finalShareText(t: Translator, log: MatchEventLog): string {
  const r = log.result;
  const names = [log.players[0].alias, log.players[1].alias] as const;
  if (r.tie || r.winner === null) return t.t('card.share.tie', { a: names[0], b: names[1] });
  const winner = names[r.winner];
  const loser = names[r.winner === 0 ? 1 : 0];
  switch (r.decidedBy) {
    case 'super_ball':
      return t.t('card.share.super_ball', { winner, loser });
    case 'wickets_lost':
      return t.t('card.share.wickets_lost', { winner, loser });
    case 'boundaries':
      return t.t('card.share.boundaries', { winner, loser });
    default:
      return t.t('card.share.runs', { winner, loser, count: r.marginRuns });
  }
}

/**
 * The private-match state: someone else's match (a forwarded link) is not an error. The server answers 404 for a
 * match that is not yours (it never confirms that a match exists), so both 403 and 404 land here.
 */
export function PrivateMatch() {
  const { t } = useT();
  const navigate = useRouter((st) => st.navigate);
  return <StateView kind="locked" title={t('match.private_title')} body={t('match.private_body')} actionLabel={t('match.private_cta')} onAction={() => navigate({ name: 'home' })} />;
}

/**
 * The reveal: the cinematic replay, verified locally, with a spoiler-safe public share of the final card and the
 * rematch in all three states (ask for one; "Rematch sent", which can be sent again; the opponent's offer to accept).
 */
export function RevealedView({ matchId, me, net, services, initialMode, rematch = null, opponentName = null }: { matchId: string; me?: 0 | 1; net: Net; services: Services | null; initialMode?: ReplayMode; rematch?: MatchView['rematch']; opponentName?: string | null }) {
  const tr = useT();
  const { t } = tr;
  const toast = useApp((st) => st.toast);
  const navigate = useRouter((st) => st.navigate);
  const back = useRouter((st) => st.back);
  const reveal = useRevealLog(net, matchId);
  const [rematching, setRematching] = useState(false);
  const [sharing, setSharing] = useState(false);
  const tracked = useRef(false);

  if (!reveal.data) {
    const k = reveal.error ? failureKind(reveal.error) : null;
    return (
      <ScreenShell title={t('reveal.title')} onBack={back} narrow testId="match-reveal-loading">
        {k === 'sealed' ? (
          <StateView kind="pending_opponent" title={t('match.still_sealed')} body={t('match.still_sealed_body')} actionLabel={t('match.title')} onAction={() => navigate({ name: 'match', matchId })} />
        ) : k === 'forbidden' || k === 'not_found' ? (
          <PrivateMatch />
        ) : k === 'offline' ? (
          <StateView kind="offline" body={t('match.reveal_offline')} onAction={reveal.reload} />
        ) : k ? (
          <StateView kind="error" onAction={reveal.reload} />
        ) : (
          <StateView kind="reveal_ready" title={t('match.reveal_loading')} />
        )}
      </ScreenShell>
    );
  }
  const log = reveal.data;
  if (!tracked.current) {
    tracked.current = true;
    markWatched(matchId);
    // The rivalry record counts revealed results; remembering this one saves fetching its replay again.
    if (me !== undefined && log.kind !== 'daily') rememberResult(matchId, log, me);
    services?.analytics.track('reveal_watched', { mode: log.kind === 'cup' ? 'cup' : log.kind === 'daily' ? 'daily' : 'duel' });
  }
  const mode = log.kind === 'cup' ? ('cup' as const) : ('duel' as const);
  const offered = rematch && !rematch.fromMe ? rematch : null;
  const sent = rematch && rematch.fromMe ? rematch : null;
  const name = opponentName ?? (me !== undefined ? log.players[me === 0 ? 1 : 0].alias : '');

  const share = async () => {
    if (!services || sharing) return;
    setSharing(true);
    try {
      // One public, spoiler-safe link per match: it works for anyone, not only the two players.
      let url: string;
      try {
        url = (await net.api.call('POST /v1/matches/:id/share', { params: { id: matchId } })).url;
      } catch (e) {
        shareToast(tr, toast, failureKind(e) === 'offline' ? 'offline' : 'failed');
        return;
      }
      const ctx = { kind: mode, id: matchId, url, players: [log.players[0].alias, log.players[1].alias] as [string, string], revealed: true, locale: shareLocale(tr.locale) };
      services.analytics.track('share_initiated', { mode, channel: 'share_sheet' });
      const image = await cardBlob(matchCardModel(tr, { log, players: [playerOf(log.players[0]), playerOf(log.players[1])], revealed: true, url }), tr.locale);
      const r = await shareMatchMoment(services.platform.share, 'final', ctx, { via: 'sheet', t: tr, image, text: finalShareText(tr, log) });
      if (r === 'shared' || r === 'copied') services.analytics.track('share_completed', { mode, channel: 'share_sheet' });
      shareToast(tr, toast, r);
    } finally {
      setSharing(false);
    }
  };

  const acceptRematch = () => {
    if (!offered) return;
    // The opponent's rematch is an invitation: accept it through the invite flow, like any other.
    const r = parseRoute(offered.inviteUrl);
    if (r.name === 'invite') navigate(r);
    else window.location.assign(offered.inviteUrl);
  };

  const rematchNew = async () => {
    if (rematching) return;
    setRematching(true);
    try {
      const r = await net.api.call('POST /v1/matches/:id/rematch', { params: { id: matchId } });
      saveInvite({ matchId: r.matchId, inviteToken: r.inviteToken, inviteUrl: r.inviteUrl });
      services?.analytics.track('rematch', { mode });
      navigate({ name: 'match', matchId: r.matchId });
    } catch (e) {
      toast({ kind: 'warning', text: failureKind(e) === 'offline' ? t('match.rematch_offline') : t('match.rematch_failed') });
    } finally {
      setRematching(false);
    }
  };

  const onRematch = log.kind !== 'duel' ? undefined : offered ? acceptRematch : sent ? () => navigate({ name: 'match', matchId: sent.matchId }) : () => void rematchNew();

  return (
    <RevealScreen
      log={log}
      me={me}
      initialMode={initialMode}
      verified={reveal.verified}
      onShare={() => void share()}
      onRematch={onRematch}
      rematchState={offered ? 'offered' : sent ? 'sent' : 'idle'}
      rematchLabel={offered ? t('match.rematch_offer_cta', { name }) : sent ? t('match.rematch_sent_cta') : undefined}
      onClose={back}
      onEnded={() => services?.analytics.track('replay_completed', { mode })}
      onFallback={(reason) => services?.analytics.track('renderer_fallback', { reason, quality: '2d' })}
    />
  );
}
