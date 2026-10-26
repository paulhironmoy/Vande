import type { MatchView } from '@/contracts';
import type { RouteOf } from '@/app/router';
import { useRouter } from '@/app/router';
import { useT } from '@/i18n';
import { ScreenShell, StateView } from '@/ui';
import { RevealedView } from '../match/RevealedView';
import { useLoad, useNet, usePlayerGate } from '../app/hooks';

/** /m/:id/replay, /m/:id/key and /m/:id/result: the full replay, Key Moments, or straight to the result. */
export default function ReplayRoute({ route }: { route: RouteOf<'replay'> }) {
  const player = usePlayerGate(route);
  const { t } = useT();
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const { net, services, booting } = useNet();
  // The match itself (best effort): which side is mine and whether a rematch is on offer.
  const view = useLoad<MatchView>(net && player?.id ? () => net.api.call('GET /v1/matches/:id', { params: { id: route.matchId } }) : null, [net, player?.id, route.matchId]);
  if (!player) return null;
  if (booting || !net)
    return (
      <ScreenShell title={t('reveal.title')} onBack={back} narrow testId="replay-screen">
        {booting ? <StateView kind="loading" /> : <StateView kind="offline" title={t('match.needs_online_title')} body={t('match.needs_online_body')} actionLabel={t('home.ghosts.title')} onAction={() => navigate({ name: 'ghosts' })} />}
      </ScreenShell>
    );
  const v = view.data;
  return (
    <RevealedView
      matchId={route.matchId}
      me={v?.me}
      net={net}
      services={services}
      initialMode={route.moment === 'key' ? 'key_moments' : route.moment === 'result' ? 'result_only' : undefined}
      rematch={v?.rematch ?? null}
      opponentName={v ? (v.players[v.me === 0 ? 1 : 0]?.alias ?? null) : null}
    />
  );
}
