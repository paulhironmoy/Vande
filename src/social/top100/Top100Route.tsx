import type { Top100Entry } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import { isApiClientError } from '@/net/errors';
import { Button, Card, Chip, Icon, IconButton, ScreenShell, StateView } from '@/ui';
import { socialFailure, useNow, useResource, useSocialServices } from '../hooks';
import { useSocialT, type SocialT } from '../i18n';
import { FailureState, NeedsOnline } from '../components/States';
import { decidedAt, istDay, previousDay, untilText } from '../components/time';
import { reportablePlayer, useReportPlayer } from '../components/ReportPlayer';
import s from '../components/social.module.css';

type DayResult = { kind: 'frozen'; entries: Top100Entry[] } | { kind: 'sealed'; decidedAt: string };

/**
 * The Daily Top 100: frozen days only. Today is always "decided at 00:00 IST" (never a provisional list); a past day
 * the cutoff has not frozen yet says so honestly. Explains the permanent badge and links to the player's own
 * highlights.
 */
export default function Top100Route({ route }: { route: RouteOf<'top100'> }) {
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const player = useApp((st) => st.player);
  const reporting = useReportPlayer();
  const { net, booting } = useSocialServices();
  const now = useNow(60_000);
  const today = istDay(now);
  const day = route.day ?? previousDay(today);
  const result = useResource<DayResult>(
    net
      ? () =>
          net.api.call('GET /v1/top100/:day', { params: { day } }).then(
            (entries): DayResult => ({ kind: 'frozen', entries }),
            (e: unknown): DayResult => {
              if (isApiClientError(e) && e.code === 'sealed') return { kind: 'sealed', decidedAt: e.decidedAt ?? decidedAt(day) };
              throw e;
            },
          )
      : null,
    [net, day],
  );

  const go = (d: string) => navigate({ name: 'top100', day: d }, { replace: true });
  const canNext = day < previousDay(today);
  const shell = (children: React.ReactNode) => (
    <ScreenShell title={t('social.top100.title')} eyebrow={t('social.top100.eyebrow')} onBack={back} narrow testId="top100-screen">
      <div className={s.stack}>
        <Card padding={4} className={s.stackSm} data-testid="top100-today">
          <p className={s.eyebrow}>{t('social.top100.today_eyebrow')}</p>
          <p className={s.body}>{t('social.top100.today_body', { until: untilText(tr, decidedAt(today), now) ?? '' })}</p>
        </Card>
        <div className={s.spread} role="group" aria-label={t('social.top100.day_nav')}>
          <IconButton icon="back" label={t('social.top100.prev_day')} onClick={() => go(previousDay(day))} />
          <h2 className={s.h2} aria-live="polite">
            {tr.date(`${day}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <IconButton icon="forward" label={t('social.top100.next_day')} disabled={!canNext} onClick={() => go(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))} />
        </div>
        {children}
        <Badge tr={tr} />
      </div>
    </ScreenShell>
  );

  if (booting) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);
  const r = result.data;
  if (!r) return shell(result.error ? <FailureState failure={socialFailure(result.error)} onRetry={result.reload} notFoundTitle={t('social.top100.no_day_title')} notFoundBody={t('social.top100.no_day_body')} /> : <StateView kind="loading" />);
  if (r.kind === 'sealed')
    return shell(<SealedDay tr={tr} isToday={day === today} decidedAt={r.decidedAt} now={now} />);
  if (r.entries.length === 0) return shell(<StateView kind="empty_cup" title={t('social.top100.empty_title')} body={t('social.top100.empty_body')} />);

  return shell(
    <section className={s.section} aria-label={t('social.top100.list')}>
      <ol className={s.list} data-testid="top100-entries">
        {r.entries.map((e) => {
          const me = Boolean(player?.id && e.playerId === player.id);
          // Set by the API only while the highlight is live with everyone's consent.
          const code = e.highlightCode ?? null;
          return (
            <Card as="li" key={e.rank} padding={3} className={[s.stackSm, me ? s.me : ''].join(' ')}>
              <div className={s.player}>
                <span className={s.rank}>{tr.number(e.rank)}</span>
                <span className={s.playerText}>
                  <span className={s.alias}>
                    {e.alias}
                    {me && ` ${t('social.common.you_suffix')}`}
                  </span>
                  <span className={s.meta}>{t('social.top100.matches_counted', { count: e.matchIds.length, wins: e.components.wins })}</span>
                </span>
                <span className={s.score}>{tr.number(e.score, { maximumFractionDigits: 1 })}</span>
                {/* Reporting needs this player's own account (the Top 100 itself is public). */}
                {!me && player?.id && reportablePlayer(e.playerId, player.id) && reporting.button({ playerId: e.playerId, alias: e.alias }, `top100-report-${e.rank}`)}
              </div>
              {code && (
                <Button variant={me ? 'accent' : 'secondary'} size="sm" icon="play" onClick={() => navigate({ name: 'highlight', code })}>
                  {me ? t('social.top100.your_highlight') : t('social.top100.watch_highlight')}
                </Button>
              )}
              {me && !code && (
                <Button variant="ghost" size="sm" iconEnd="forward" onClick={() => navigate({ name: 'highlights' })}>
                  {t('social.top100.review')}
                </Button>
              )}
            </Card>
          );
        })}
      </ol>
      <p className={s.small}>{t('social.top100.score_note')}</p>
      {reporting.dialog}
    </section>,
  );
}

function Badge({ tr }: { tr: SocialT }) {
  const { t } = tr;
  return (
    <Card variant="sunken" padding={4} className={s.stackSm}>
      <div className={s.row}>
        <Chip tone="amber" icon="crown" solid>
          {t('social.badge.youtube_top100')}
        </Chip>
      </div>
      <h2 className={s.h3}>
        <Icon name="info" size={16} /> {t('social.top100.badge_title')}
      </h2>
      <p className={s.body}>{t('social.top100.badge_body')}</p>
      <h2 className={s.h3}>{t('social.top100.how_title')}</h2>
      <ul className={s.list}>
        <li className={s.body}>{t('social.top100.how_best')}</li>
        <li className={s.body}>{t('social.top100.how_components')}</li>
        <li className={s.body}>{t('social.top100.how_fair')}</li>
      </ul>
    </Card>
  );
}

/** How long the sweeper keeps retrying a late cutoff before a day counts as never ranked. */
const LATE_MS = 48 * 3_600_000;

/**
 * A day without a frozen Top 100: decided at midnight IST (today, or a day whose midnight is still ahead), running late
 * (its midnight has passed and the cutoff is still being retried), or never ranked (long past): never "being decided"
 * for a day that is over.
 */
function SealedDay({ tr, isToday, decidedAt: at, now }: { tr: SocialT; isToday: boolean; decidedAt: string; now: number }) {
  const { t } = tr;
  const due = Date.parse(at);
  if (!Number.isFinite(due) || due > now) {
    return <StateView kind="locked" title={isToday ? t('social.top100.sealed_today') : t('social.top100.sealed_title')} body={t('social.top100.sealed_body', { until: untilText(tr, at, now) ?? '' })} />;
  }
  if (now - due < LATE_MS) return <StateView kind="reconnecting" title={t('social.top100.late_title')} body={t('social.top100.late_body', { ago: untilText(tr, at, now) ?? '' })} />;
  return <StateView kind="empty_cup" title={t('social.top100.none_title')} body={t('social.top100.none_body')} />;
}
