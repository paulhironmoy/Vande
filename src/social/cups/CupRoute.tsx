import { useState } from 'react';
import type { CupView, Fixture, PlayerRef, StandingRow } from '@/contracts';
import { useRouter, type RouteOf } from '@/app/router';
import { localPlayerRef } from '@/app/storeTypes';
import { InvitePanel } from '@/screens/share/InvitePanel';
import { Avatar, Button, Card, Chip, Icon, IconButton, ScreenShell, StateView, VisuallyHidden } from '@/ui';
import { socialFailure, useAccount, usePlayerGate, useNow, useResource, useSocialServices } from '../hooks';
import { useSocialT, type SocialT } from '../i18n';
import { FailureState, NeedsOnline } from '../components/States';
import { PlayerLine } from '../components/PlayerLine';
import { deadlineText } from '../components/time';
import { shareUrl } from '../components/links';
import { cupState, currentRound, finalFixture, membersById, movementOf, MIN_CUP_PLAYERS, mySeat, nextTask, nrrText, playedByAuto, roundsOf, startsAt, type RoundModel } from './cupModel';
import { reportablePlayer, useReportPlayer } from '../components/ReportPlayer';
import { useCupMilestones } from './cupAnalytics';
import s from '../components/social.module.css';

const POLL_MS = 60_000;

/**
 * A Group Cup: my next fixture, the round in play with its honest lock count and real deadlines, the table with
 * movement, every fixture by round, Auto Over / Auto XI and late practice explained, an enhanced final, and the
 * gathering, cancelled and complete states. Nobody, the creator included, has to do anything for the cup to move on.
 */
export default function CupRoute({ route }: { route: RouteOf<'cup'> }) {
  const player = usePlayerGate(route);
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const { net, services, booting } = useSocialServices();
  const account = useAccount(net, player);
  const now = useNow(30_000);
  const ready = Boolean(net && account.state === 'ok');
  const cup = useResource<CupView>(ready && net ? () => net.api.call('GET /v1/cups/:id', { params: { id: route.cupId } }) : null, [ready, route.cupId], { pollMs: POLL_MS });
  useCupMilestones(cup.data, player?.id ?? null, services?.analytics ?? null);
  if (!player) return null;

  const view = cup.data;
  const shell = (children: React.ReactNode) => (
    <ScreenShell
      title={view?.name ?? t('social.cup.title')}
      eyebrow={view ? t(`social.cup.status_${cupState(view)}` as 'social.cup.status_group_stage') : t('social.cup.eyebrow')}
      onBack={back}
      narrow
      testId="cup-screen"
      actions={view ? <IconButton icon="message" label={t('social.cup.room')} onClick={() => navigate({ name: 'room', roomId: view.roomId })} data-testid="cup-room-link" /> : undefined}
    >
      {children}
    </ScreenShell>
  );

  if (booting || (net && (account.state === 'idle' || account.state === 'syncing') && !view)) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);
  if (account.state === 'offline' || account.state === 'error' || account.state === 'age_required') return shell(<FailureState failure={account.state} onRetry={account.retry} />);
  if (!view) {
    if (cup.error) return shell(<FailureState failure={socialFailure(cup.error)} onRetry={cup.reload} notFoundTitle={t('social.cup.not_found_title')} notFoundBody={t('social.cup.not_found_body')} />);
    return shell(<StateView kind="loading" />);
  }

  const state = cupState(view);
  const myId = player.id;
  const byId = membersById(view);
  const rounds = roundsOf(view, now);
  const current = currentRound(rounds);

  if (state === 'cancelled')
    return shell(
      <div className={s.stack}>
        <StateView kind="deadline_expired" title={t('social.cup.cancelled_title')} body={t('social.cup.cancelled_body', { min: MIN_CUP_PLAYERS })} actionLabel={t('social.cup.new_cup')} onAction={() => navigate({ name: 'cup_new' })} />
        <Members members={view.members} tr={tr} />
      </div>,
    );

  if (state === 'gathering' || state === 'gathering_short') {
    const start = startsAt(view);
    const url = view.inviteToken ? shareUrl(services, { name: 'invite', token: view.inviteToken }) : null;
    return shell(
      <div className={s.stack}>
        {state === 'gathering_short' ? (
          <StateView kind="empty_cup" title={t('social.cup.gathering_short_title', { joined: view.members.length, min: MIN_CUP_PLAYERS })} body={t('social.cup.gathering_body', { when: deadlineText(tr, start, now), min: MIN_CUP_PLAYERS })} />
        ) : (
          <Card padding={5} className={s.stackSm} data-testid="cup-gathering">
            <p className={s.eyebrow}>{t('social.cup.gathering_eyebrow')}</p>
            <h2 className={s.h2}>{t('social.cup.gathering_title', { joined: view.members.length, size: view.size })}</h2>
            <p className={s.body}>{t('social.cup.gathering_body', { when: deadlineText(tr, start, now), min: MIN_CUP_PLAYERS })}</p>
          </Card>
        )}
        <p className={s.small}>{t('social.cup.non_joiners')}</p>
        {url && <InvitePanel kind="cup" matchId={view.cupId} inviteUrl={url} inviter={localPlayerRef(player)} conditions={null} cupName={view.name} />}
        <Members members={view.members} tr={tr} />
        <Rules tr={tr} />
      </div>,
    );
  }

  const task = nextTask(view.myTasks);
  const final = finalFixture(view);
  return shell(
    <div className={s.stack}>
      {state === 'complete' && (
        <Card padding={5} className={[s.stackSm, s.final].join(' ')} data-testid="cup-complete">
          <p className={[s.eyebrow, s.finalEyebrow].join(' ')}>{t('social.cup.complete_eyebrow')}</p>
          <h2 className={s.h2}>{t('social.cup.complete_title', { name: view.name })}</h2>
          <p className={s.body}>{t('social.cup.complete_body')}</p>
          {view.winner && <Champion winner={view.winner} tr={tr} />}
          <div className={s.actions}>
            {final && (
              <Button variant="accent" icon="play" onClick={() => navigate({ name: 'replay', matchId: final.matchId })}>
                {t('social.cup.watch_final')}
              </Button>
            )}
            <Button variant="secondary" icon="message" onClick={() => navigate({ name: 'room', roomId: view.roomId })}>
              {t('social.cup.room')}
            </Button>
          </div>
        </Card>
      )}
      {task && state !== 'complete' && <NextTask task={task} fixtures={view.fixtures} byId={byId} myId={myId} tr={tr} now={now} onOpen={(matchId) => navigate({ name: 'match', matchId })} />}
      {current && state !== 'complete' && <CurrentRound round={current} lockedCount={view.lockedCount} tr={tr} now={now} />}
      {view.standings.length > 0 && <Standings rows={view.standings} byId={byId} myId={myId} tr={tr} complete={state === 'complete'} />}
      <Fixtures rounds={rounds} byId={byId} myId={myId} tr={tr} now={now} onOpen={(matchId) => navigate({ name: 'match', matchId })} />
      <Rules tr={tr} />
    </div>,
  );
}

/** The champion, covered until the player asks (the final may not have been watched yet), like a room scorecard. */
function Champion({ winner, tr }: { winner: PlayerRef; tr: SocialT }) {
  const { t } = tr;
  const [shown, setShown] = useState(false);
  if (!shown)
    return (
      <button type="button" className={s.spoiler} onClick={() => setShown(true)} data-testid="cup-champion-show">
        {t('social.cup.champion_show')}
      </button>
    );
  return (
    <div className={s.spread} data-testid="cup-champion">
      <PlayerLine player={winner} meta={t('social.cup.champion')} size={48} />
      <Chip tone="amber" icon="crown" solid>
        {t('social.badge.cup_winner')}
      </Chip>
    </div>
  );
}

function Members({ members, tr }: { members: PlayerRef[]; tr: SocialT }) {
  return (
    <section className={s.section} aria-labelledby="cup-members">
      <h2 className={s.h2} id="cup-members">
        {tr.t('social.cup.members', { count: members.length })}
      </h2>
      <ul className={s.list}>
        {members.map((m, i) => (
          <li key={m.id}>
            <PlayerLine player={m} meta={i === 0 ? tr.t('social.cup.creator') : undefined} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NextTask({ task, fixtures, byId, myId, tr, now, onOpen }: { task: CupView['myTasks'][number]; fixtures: Fixture[]; byId: Map<string, PlayerRef>; myId: string | null; tr: SocialT; now: number; onOpen: (matchId: string) => void }) {
  const { t } = tr;
  const f = fixtures.find((x) => x.matchId === task.matchId);
  const seat = f ? mySeat(f, myId) : null;
  const opponent = f && seat !== null ? byId.get(seat === 0 ? f.away : f.home) ?? null : null;
  const isFinal = f?.round === 'final';
  return (
    <Card padding={5} className={[s.stackSm, isFinal ? s.final : ''].join(' ')} data-testid="cup-next">
      <p className={[s.eyebrow, isFinal ? s.finalEyebrow : ''].join(' ')}>{isFinal ? t('social.cup.next_final') : t('social.cup.next_eyebrow')}</p>
      <PlayerLine player={opponent} meta={t(`social.cup.task_${task.kind}` as 'social.cup.task_lock')} size={48} />
      {task.by && (
        <p className={s.body}>
          <Icon name="clock" size={16} /> {t(task.kind === 'bat' ? 'social.cup.bat_by' : 'social.cup.lock_by', { when: deadlineText(tr, task.by, now) })}
        </p>
      )}
      <Button variant={task.kind === 'watch' ? 'accent' : 'primary'} size="lg" block icon={task.kind === 'lock' ? 'seal' : task.kind === 'bat' ? 'bat' : 'play'} onClick={() => onOpen(task.matchId)} data-testid="cup-next-open">
        {t(`social.cup.task_cta_${task.kind}` as 'social.cup.task_cta_lock')}
      </Button>
    </Card>
  );
}

function CurrentRound({ round, lockedCount, tr, now }: { round: RoundModel; lockedCount: CupView['lockedCount']; tr: SocialT; now: number }) {
  const { t } = tr;
  const isFinal = round.round === 'final';
  const label = isFinal ? t('social.cup.final') : t('social.cup.round', { n: round.round as number });
  return (
    <Card padding={4} className={[s.stackSm, isFinal ? s.final : ''].join(' ')} data-testid="cup-current">
      <div className={s.spread}>
        <h2 className={s.h3}>{t('social.cup.current', { round: label })}</h2>
        <Chip tone={round.phase === 'locking' ? 'cyan' : round.phase === 'batting' ? 'amber' : 'violet'} icon={round.phase === 'locking' ? 'seal' : round.phase === 'batting' ? 'bat' : 'clock'}>
          {t(`social.cup.phase_${round.phase}` as 'social.cup.phase_locking')}
        </Chip>
      </div>
      {lockedCount && (
        <p className={s.body} data-testid="cup-lock-count">
          {t('social.cup.locked_count', { locked: lockedCount.locked, total: lockedCount.total })}
        </p>
      )}
      <dl className={s.kv}>
        <dt>{t('social.cup.lock_deadline')}</dt>
        <dd>{deadlineText(tr, round.lockBy, now)}</dd>
        <dt>{t('social.cup.bat_deadline')}</dt>
        <dd>{deadlineText(tr, round.batBy, now)}</dd>
        <dt>{t('social.cup.reveal_time')}</dt>
        <dd>{deadlineText(tr, round.revealAt, now)}</dd>
      </dl>
      <p className={s.small}>{t('social.cup.counts_only')}</p>
    </Card>
  );
}

function Standings({ rows, byId, myId, tr, complete }: { rows: StandingRow[]; byId: Map<string, PlayerRef>; myId: string | null; tr: SocialT; complete: boolean }) {
  const { t } = tr;
  const reporting = useReportPlayer();
  return (
    <section className={s.section} aria-labelledby="cup-table">
      <h2 className={s.h2} id="cup-table">
        {complete ? t('social.cup.table_final') : t('social.cup.table')}
      </h2>
      <div className={s.tableWrap}>
        <table className={s.table} data-testid="cup-standings">
          <thead>
            <tr>
              <th scope="col">
                <abbr title={t('social.cup.col_position')}>#</abbr>
              </th>
              <th scope="col">{t('social.cup.col_player')}</th>
              <th scope="col" className={s.num}>
                <abbr title={t('social.cup.col_played')}>{t('social.cup.col_played_short')}</abbr>
              </th>
              <th scope="col" className={s.num}>
                <abbr title={t('social.cup.col_points')}>{t('social.cup.col_points_short')}</abbr>
              </th>
              <th scope="col" className={s.num}>
                <abbr title={t('social.cup.col_nrr')}>{t('social.cup.col_nrr_short')}</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const m = byId.get(r.playerId) ?? null;
              const move = movementOf(r);
              const mine = r.playerId === myId;
              return (
                <tr key={r.playerId} aria-current={mine ? 'true' : undefined}>
                  <td className={s.num}>
                    {tr.number(i + 1)}
                    <span className={[s.movement, move === 'up' ? s.up : move === 'down' ? s.down : ''].join(' ')}>
                      <span aria-hidden="true">{move === 'up' ? '▲' : move === 'down' ? '▼' : '='}</span>
                      <VisuallyHidden>{t(`social.cup.move_${move}` as 'social.cup.move_up', { n: Math.abs(r.movement) })}</VisuallyHidden>
                      {move !== 'same' && <span aria-hidden="true">{tr.number(Math.abs(r.movement))}</span>}
                    </span>
                  </td>
                  <td>
                    <div className={s.player}>
                      {m && <Avatar avatar={m.avatar} kit={m.kit} size={28} decorative />}
                      <span className={s.playerText}>
                        <span className={s.alias}>
                          {r.alias}
                          {mine && ` ${t('social.common.you_suffix')}`}
                        </span>
                        <span className={s.meta}>
                          {t('social.cup.record', { won: r.won, lost: r.lost, tied: r.tied })}
                          {r.form.length > 0 && ` · ${t('social.cup.form', { form: r.form.join(' ') })}`}
                        </span>
                      </span>
                      {!mine && reportablePlayer(r.playerId, myId) && reporting.button({ playerId: r.playerId, alias: r.alias }, `cup-report-${i + 1}`)}
                    </div>
                  </td>
                  <td className={s.num}>{tr.number(r.played)}</td>
                  <td className={s.num}>{tr.number(r.points)}</td>
                  <td className={s.num}>{nrrText(r.netRunRate, (n) => tr.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={s.small}>{t('social.cup.table_rules')}</p>
      {reporting.dialog}
    </section>
  );
}

function Fixtures({ rounds, byId, myId, tr, now, onOpen }: { rounds: RoundModel[]; byId: Map<string, PlayerRef>; myId: string | null; tr: SocialT; now: number; onOpen: (matchId: string) => void }) {
  const { t } = tr;
  return (
    <section className={s.section} aria-labelledby="cup-fixtures">
      <h2 className={s.h2} id="cup-fixtures">
        {t('social.cup.fixtures')}
      </h2>
      {rounds.map((r) => {
        const isFinal = r.round === 'final';
        const label = isFinal ? t('social.cup.final') : t('social.cup.round', { n: r.round as number });
        return (
          <Card key={String(r.round)} padding={4} className={[s.stackSm, isFinal ? s.final : ''].join(' ')} as="section" aria-label={label}>
            <div className={s.spread}>
              <h3 className={s.h3}>{label}</h3>
              <span className={s.meta}>{t('social.cup.reveal_short', { when: deadlineText(tr, r.revealAt, now) })}</span>
            </div>
            {r.fixtures.length === 0 ? (
              <p className={s.small}>{isFinal ? t('social.cup.final_pending') : t('social.cup.round_pending')}</p>
            ) : (
              <ul className={s.list}>
                {r.fixtures.map((f) => (
                  <FixtureRow key={f.fixtureId} f={f} byId={byId} myId={myId} tr={tr} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </section>
  );
}

function FixtureRow({ f, byId, myId, tr, onOpen }: { f: Fixture; byId: Map<string, PlayerRef>; myId: string | null; tr: SocialT; onOpen: (matchId: string) => void }) {
  const { t } = tr;
  const home = byId.get(f.home) ?? null;
  const away = byId.get(f.away) ?? null;
  const mine = mySeat(f, myId) !== null;
  const auto = playedByAuto(f, myId);
  const canOpen = mine || f.status === 'revealed';
  return (
    <li className={s.stackSm} data-testid={mine ? 'cup-my-fixture' : undefined}>
      <div className={s.spread}>
        <span className={s.alias}>{t('social.cup.vs', { home: home?.alias ?? '—', away: away?.alias ?? '—' })}</span>
        <Chip tone={f.status === 'revealed' ? 'success' : f.status === 'void' ? 'neutral' : 'cyan'}>{t(`social.cup.fixture_${f.status}` as 'social.cup.fixture_planning')}</Chip>
      </div>
      <div className={s.row}>
        {f.auto[0] && <Chip icon="info">{t('social.cup.auto_side', { name: home?.alias ?? '—' })}</Chip>}
        {f.auto[1] && <Chip icon="info">{t('social.cup.auto_side', { name: away?.alias ?? '—' })}</Chip>}
      </div>
      {auto && <p className={s.small}>{t('social.cup.practice_note')}</p>}
      {canOpen && (
        <Button variant={mine ? 'secondary' : 'ghost'} size="sm" iconEnd="forward" onClick={() => onOpen(f.matchId)}>
          {auto ? t('social.cup.practice_cta') : f.status === 'revealed' ? t('social.cup.watch') : t('social.cup.open_match')}
        </Button>
      )}
    </li>
  );
}

function Rules({ tr }: { tr: SocialT }) {
  const { t } = tr;
  return (
    <Card variant="sunken" padding={4} className={s.stackSm}>
      <h2 className={s.h3}>{t('social.cup.rules_title')}</h2>
      <ul className={s.list}>
        <li className={s.body}>{t('social.cup.rules_auto')}</li>
        <li className={s.body}>{t('social.cup.rules_nobody_waits')}</li>
        <li className={s.body}>{t('social.cup.rules_practice')}</li>
        <li className={s.body}>{t('social.cup.rules_final')}</li>
      </ul>
    </Card>
  );
}
