import { useId, useState } from 'react';
import type { BanterId, ReactionId, ReportRequest, RoomPost, RoomView } from '@/contracts';
import { useApp } from '@/app/store';
import { useBackHandler } from '@/app/back';
import { useRouter, type RouteOf } from '@/app/router';
import { checkMessage } from '@/net/shared/alias';
import { Button, Card, Dialog, Field, Icon, IconButton, ScreenShell, SegmentedControl, Sheet, StateView, Switch, type IconName } from '@/ui';
import { socialFailure, useAccount, useAction, usePlayerGate, useResource, useSocialServices } from '../hooks';
import { useSocialT, type SocialT } from '../i18n';
import { FailureState, NeedsOnline } from '../components/States';
import { PlayerLine } from '../components/PlayerLine';
import { deadlineText, postHourText } from '../components/time';
import { BANTER, REACTIONS, REACTION_EMOJI, cardOf, rematchTarget, reportable, withReaction, type CardModel } from './roomModel';
import s from '../components/social.module.css';

const POLL_MS = 30_000;
const REPORT_REASONS: ReportRequest['reason'][] = ['abusive', 'spam', 'cheating', 'other'];

const ICON: Record<CardModel['kind'], IconName> = {
  invite: 'users',
  fixture: 'calendar',
  lock_status: 'seal',
  deadline: 'clock',
  reveal_ready: 'sparkle',
  scorecard: 'chart',
  standings: 'trophy',
  achievement: 'crown',
  highlight: 'play',
  rematch: 'rematch',
  banter: 'message',
  text: 'message',
  unknown: 'info',
};

/**
 * A Cricket Room: spoiler-safe system cards for every event kind, reactions, predefined banter (free text only when the
 * server enables it), mute and notification frequency, report and block. Members only.
 */
export default function RoomRoute({ route }: { route: RouteOf<'room'> }) {
  const player = usePlayerGate(route);
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const toast = useApp((st) => st.toast);
  const { net, services, booting } = useSocialServices();
  const account = useAccount(net, player);
  const ready = Boolean(net && account.state === 'ok');
  const room = useResource<RoomView>(ready && net ? () => net.api.call('GET /v1/rooms/:id', { params: { id: route.roomId } }) : null, [ready, route.roomId], { pollMs: POLL_MS });
  const [older, setOlder] = useState<{ posts: RoomPost[]; cursor: string | null } | null>(null);
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const [settings, setSettings] = useState(false);
  const [banter, setBanter] = useState(false);
  const [report, setReport] = useState<RoomPost | null>(null);
  const [block, setBlock] = useState<RoomPost | null>(null);
  const [reason, setReason] = useState<ReportRequest['reason']>('abusive');
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const action = useAction();
  const textId = useId();
  useBackHandler(settings, () => setSettings(false));
  useBackHandler(banter, () => setBanter(false));
  if (!player) return null;

  const view = room.data;
  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenShell
      title={view?.title ?? t('social.room.title')}
      eyebrow={view ? t(`social.room.kind_${view.kind}` as 'social.room.kind_cup') : t('social.room.eyebrow')}
      onBack={back}
      narrow
      testId="room-screen"
      actions={view ? <IconButton icon={view.muted || view.notify === 'none' ? 'bell-off' : 'bell'} label={t('social.room.settings')} onClick={() => setSettings(true)} data-testid="room-settings-open" /> : undefined}
      footer={footer}
    >
      {children}
    </ScreenShell>
  );

  if (booting || (net && (account.state === 'idle' || account.state === 'syncing') && !view)) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);
  if (account.state === 'offline' || account.state === 'error' || account.state === 'age_required') return shell(<FailureState failure={account.state} onRetry={account.retry} />);
  if (!view) {
    if (room.error) return shell(<FailureState failure={socialFailure(room.error)} onRetry={room.reload} notFoundTitle={t('social.room.not_found_title')} notFoundBody={t('social.room.not_found_body')} />);
    return shell(<StateView kind="loading" />);
  }

  const posts = [...view.posts, ...(older?.posts ?? [])];
  const cursor = older ? older.cursor : view.cursor;
  const replacePost = (next: RoomPost) => {
    room.set((prev) => (prev ? { ...prev, posts: prev.posts.map((p) => (p.postId === next.postId ? next : p)) } : (prev as unknown as RoomView)));
    setOlder((o) => (o ? { ...o, posts: o.posts.map((p) => (p.postId === next.postId ? next : p)) } : o));
  };

  const react = async (post: RoomPost, reaction: ReactionId) => {
    const next = post.myReaction === reaction ? null : reaction;
    replacePost(withReaction(post, next));
    const r = await action.run(() => net.api.call('POST /v1/rooms/:id/react', { params: { id: view.roomId }, body: { postId: post.postId, reaction: next } }));
    if (!r.ok) {
      replacePost(post);
      toast({ kind: 'warning', text: r.failure === 'offline' ? t('social.state.offline_body') : t('social.room.react_failed') });
    }
  };

  const sendBanter = async (phraseId: BanterId) => {
    const r = await action.run(() => net.api.call('POST /v1/rooms/:id/banter', { params: { id: view.roomId }, body: { phraseId } }));
    setBanter(false);
    if (r.ok) room.reload();
    else toast({ kind: 'warning', text: r.failure === 'rate_limited' ? t('social.room.banter_slow') : r.failure === 'offline' ? t('social.state.offline_body') : t('social.room.send_failed') });
  };

  const sendText = async () => {
    const check = checkMessage(text);
    if (!check.ok) {
      setTextError(t(`social.room.text_${check.reason}` as 'social.room.text_offensive'));
      return;
    }
    const r = await action.run(() => net.api.call('POST /v1/rooms/:id/text', { params: { id: view.roomId }, body: { text: check.value } }));
    if (r.ok) {
      setText('');
      setTextError(null);
      room.reload();
    } else setTextError(r.failure === 'invalid' ? t('social.room.text_offensive') : r.failure === 'rate_limited' ? t('social.room.banter_slow') : t('social.room.send_failed'));
  };

  const saveSettings = async (patch: { muted?: boolean; notify?: RoomView['notify'] }) => {
    const before = view;
    room.set({ ...view, ...patch });
    const r = await action.run(() => net.api.call('POST /v1/rooms/:id/settings', { params: { id: view.roomId }, body: patch }));
    if (!r.ok) {
      room.set(before);
      toast({ kind: 'warning', text: t('social.room.settings_failed') });
      return;
    }
    if (patch.muted === true) services?.analytics.track('group_mute');
    if (patch.notify === 'none') services?.analytics.track('notification_opt_out');
  };

  const submitReport = async () => {
    if (!report) return;
    const r = await action.run(() => net.api.call('POST /v1/report', { body: { postId: report.postId, ...(report.authorId ? { playerId: report.authorId } : {}), reason } }));
    setReport(null);
    toast(r.ok ? { kind: 'success', text: t('social.room.reported') } : { kind: 'warning', text: t('social.room.send_failed') });
  };

  const submitBlock = async () => {
    if (!block?.authorId) return;
    const id = block.authorId;
    const r = await action.run(() => net.api.call('POST /v1/blocks/:playerId', { params: { playerId: id } }));
    setBlock(null);
    if (r.ok) {
      toast({ kind: 'success', text: t('social.room.blocked') });
      setOlder(null);
      room.reload();
    } else toast({ kind: 'warning', text: t('social.room.send_failed') });
  };

  const loadOlder = async () => {
    if (!cursor) return;
    const r = await action.run(() => net.api.call('GET /v1/rooms/:id', { params: { id: view.roomId }, query: { cursor } }));
    if (r.ok) setOlder((o) => ({ posts: [...(o?.posts ?? []), ...r.value.posts], cursor: r.value.cursor }));
    else toast({ kind: 'warning', text: t('social.state.offline_body') });
  };

  const open = {
    match: (matchId: string) => navigate({ name: 'match', matchId }),
    rematch: (c: Extract<CardModel, { kind: 'rematch' }>) => {
      const target = rematchTarget(c, player?.id ?? null);
      if (target) navigate({ name: 'match', matchId: target });
    },
    cup: () => navigate({ name: 'cup', cupId: `c${view.roomId.slice(1)}` }),
    highlight: (code: string) => navigate({ name: 'highlight', code }),
  };

  const footer = (
    <div className={s.stackSm}>
      {view.freeText && (
        <form
          className={s.row}
          onSubmit={(e) => {
            e.preventDefault();
            void sendText();
          }}
        >
          <Field label={t('social.room.text_label')} htmlFor={textId} className={s.grow}>
            <input id={textId} type="text" value={text} maxLength={140} onChange={(e) => (setText(e.target.value), setTextError(null))} aria-invalid={Boolean(textError)} data-testid="room-text" />
          </Field>
          <Button type="submit" variant="secondary" icon="forward" loading={action.busy} disabled={!text.trim()}>
            {t('social.room.send')}
          </Button>
          {textError && (
            <p className={s.error} role="alert">
              {textError}
            </p>
          )}
        </form>
      )}
      <Button variant="primary" size="lg" block icon="message" onClick={() => setBanter(true)} data-testid="room-banter-open">
        {t('social.room.banter')}
      </Button>
    </div>
  );

  return shell(
    <div className={s.stack}>
      {(view.muted || view.notify === 'none') && (
        <StateView
          kind="muted_group"
          compact
          title={t('social.room.muted_title')}
          body={view.muted ? t('social.room.muted_body') : t('social.room.notify_none_body')}
          actionLabel={t('social.room.unmute')}
          onAction={() => void saveSettings(view.muted ? { muted: false } : { notify: 'important' })}
        />
      )}
      {posts.length === 0 ? (
        <StateView kind="empty_cup" title={t('social.room.empty_title')} body={t('social.room.empty_body')} />
      ) : (
        <ol className={s.list} aria-label={t('social.room.feed')} data-testid="room-feed">
          {posts.map((post) => (
            <li key={post.postId}>
              <PostCard
                post={post}
                view={view}
                tr={tr}
                shown={shown.has(post.postId)}
                onShow={() => setShown((x) => new Set(x).add(post.postId))}
                onReact={(r) => void react(post, r)}
                onReport={reportable(post, player.id) ? () => setReport(post) : undefined}
                onBlock={reportable(post, player.id) ? () => setBlock(post) : undefined}
                open={open}
              />
            </li>
          ))}
        </ol>
      )}
      {cursor && (
        <Button variant="ghost" icon="chevron-down" loading={action.busy} onClick={() => void loadOlder()}>
          {t('social.room.older')}
        </Button>
      )}
      <Sheet open={settings} onClose={() => setSettings(false)} title={t('social.room.settings')} testId="room-settings">
        <div className={s.stack}>
          <Field label={t('social.room.mute')} description={t('social.room.mute_hint')} inline>
            <Switch checked={view.muted} onChange={(v) => void saveSettings({ muted: v })} label={t('social.room.mute')} data-testid="room-mute" />
          </Field>
          <SegmentedControl
            label={t('social.room.notify_label')}
            options={(['all', 'important', 'none'] as const).map((v) => ({ value: v, label: t(`social.room.notify_${v}` as 'social.room.notify_all'), description: t(`social.room.notify_${v}_hint` as 'social.room.notify_all_hint') }))}
            value={view.notify}
            onChange={(v) => void saveSettings({ notify: v })}
            block
            testId="room-notify"
          />
          <p className={s.small}>{t('social.room.settings_private')}</p>
        </div>
      </Sheet>
      <Sheet open={banter} onClose={() => setBanter(false)} title={t('social.room.banter_title')} testId="room-banter">
        <div className={s.phrases}>
          {BANTER.map((id) => (
            <Button key={id} variant="secondary" onClick={() => void sendBanter(id)} disabled={action.busy} data-testid={`banter-${id}`}>
              {tr.tk(id)}
            </Button>
          ))}
        </div>
        <p className={s.small}>{t('social.room.banter_hint')}</p>
      </Sheet>
      <Dialog open={report !== null} title={t('social.room.report_title')} description={t('social.room.report_body')} confirmLabel={t('social.room.report_send')} cancelLabel={t('social.common.cancel')} onConfirm={() => void submitReport()} onCancel={() => setReport(null)} testId="room-report">
        <fieldset className={s.stackSm}>
          <legend className={s.h3}>{t('social.room.report_reason')}</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className={s.check}>
              <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>{t(`social.room.reason_${r}` as 'social.room.reason_abusive')}</span>
            </label>
          ))}
        </fieldset>
      </Dialog>
      <Dialog
        open={block !== null}
        title={t('social.room.block_title', { name: block ? view.members.find((m) => m.id === block.authorId)?.alias ?? '' : '' })}
        description={t('social.room.block_body')}
        confirmLabel={t('social.room.block_confirm')}
        confirmVariant="danger"
        cancelLabel={t('social.common.cancel')}
        onConfirm={() => void submitBlock()}
        onCancel={() => setBlock(null)}
        testId="room-block"
        focusCancel
      />
    </div>,
    footer,
  );
}


function PostCard({
  post,
  view,
  tr,
  shown,
  onShow,
  onReact,
  onReport,
  onBlock,
  open,
}: {
  post: RoomPost;
  view: RoomView;
  tr: SocialT;
  shown: boolean;
  onShow: () => void;
  onReact: (r: ReactionId) => void;
  onReport?: () => void;
  onBlock?: () => void;
  open: { match: (id: string) => void; rematch: (c: Extract<CardModel, { kind: 'rematch' }>) => void; cup: () => void; highlight: (code: string) => void };
}) {
  const { t } = tr;
  const c = cardOf(post, view.members);
  const now = Date.now();
  const final = (c.kind === 'fixture' || c.kind === 'reveal_ready' || c.kind === 'scorecard') && c.final;
  const label = t(`social.room.post_${c.kind}` as 'social.room.post_invite');
  return (
    <Card as="article" padding={4} className={[s.stackSm, final ? s.final : ''].join(' ')} aria-label={label} data-kind={post.kind}>
      <div className={s.spread}>
        <span className={s.row}>
          <Icon name={ICON[c.kind]} size={18} />
          <span className={s.meta}>{final ? t('social.room.final_label', { label }) : label}</span>
        </span>
        <span className={s.meta}>{postHourText(tr, post.createdHour, Date.now())}</span>
      </div>
      <CardBody c={c} tr={tr} now={now} shown={shown} onShow={onShow} open={open} cupRoom={view.kind === 'cup'} />
      <div className={s.spread}>
        <div className={s.reactions} role="group" aria-label={t('social.room.reactions')}>
          {REACTIONS.map((r) => {
            const n = post.reactions[r] ?? 0;
            return (
              <button key={r} type="button" className={s.reaction} aria-pressed={post.myReaction === r} aria-label={t('social.room.reaction_label', { reaction: t(`social.room.reaction_${r}` as 'social.room.reaction_clap'), count: n })} onClick={() => onReact(r)}>
                <span aria-hidden="true">{REACTION_EMOJI[r]}</span>
                {n > 0 && <span aria-hidden="true"> {tr.number(n)}</span>}
              </button>
            );
          })}
        </div>
        {(onReport || onBlock) && (
          <span className={s.row}>
            {onReport && <IconButton icon="alert" label={t('social.room.report')} onClick={onReport} />}
            {onBlock && <IconButton icon="eye-off" label={t('social.room.block')} onClick={onBlock} />}
          </span>
        )}
      </div>
    </Card>
  );
}

function CardBody({ c, tr, now, shown, onShow, open, cupRoom }: { c: CardModel; tr: SocialT; now: number; shown: boolean; onShow: () => void; open: { match: (id: string) => void; rematch: (c: Extract<CardModel, { kind: 'rematch' }>) => void; cup: () => void; highlight: (code: string) => void }; cupRoom: boolean }) {
  const { t } = tr;
  switch (c.kind) {
    case 'invite':
      return <p className={s.body}>{c.cup ? t('social.room.invite_cup', { name: c.inviterAlias, cup: c.cupName ?? '' }) : t('social.room.invite_duel', { name: c.inviterAlias })}</p>;
    case 'fixture':
      return (
        <>
          <p className={s.body}>{c.home && c.away ? t('social.room.fixture_pair', { home: c.home, away: c.away }) : t('social.room.fixture_round', { round: c.round ?? '', count: c.fixtures ?? 0 })}</p>
          {c.lockBy && <p className={s.small}>{t('social.room.lock_by', { when: deadlineText(tr, c.lockBy, now) })}</p>}
        </>
      );
    case 'lock_status':
      return <p className={s.body}>{t('social.room.lock_status', { locked: c.locked, total: c.total })}</p>;
    case 'deadline':
      // Auto Over / Auto XI said plainly: who it played for, never a player's own lock or innings.
      if (c.phase === 'auto_over' || c.phase === 'auto_xi') return <p className={s.body}>{t(c.phase === 'auto_over' ? 'social.room.auto_over' : 'social.room.auto_xi', { name: c.alias ?? '' })}</p>;
      return <p className={s.body}>{t(c.phase === 'bat' ? 'social.room.deadline_bat' : 'social.room.deadline_lock', { when: deadlineText(tr, c.by, now) })}</p>;
    case 'reveal_ready':
      return (
        <>
          <p className={s.body}>{c.final ? t('social.room.reveal_final') : t('social.room.reveal_ready')}</p>
          <Button variant="accent" icon="play" onClick={() => (c.matchId ? open.match(c.matchId) : cupRoom ? open.cup() : undefined)}>
            {t('social.room.watch_reveal')}
          </Button>
        </>
      );
    case 'scorecard':
      return shown ? (
        <>
          <p className={s.body}>{t('social.room.score_line', { home: c.home, homeRuns: c.homeRuns, homeWickets: c.homeWickets, away: c.away, awayRuns: c.awayRuns, awayWickets: c.awayWickets })}</p>
          <p className={s.h3}>{c.tie || !c.winner ? t('social.room.score_tie') : t('social.room.score_winner', { name: c.winner })}</p>
          {c.matchId && (
            <Button variant="ghost" size="sm" iconEnd="forward" onClick={() => open.match(c.matchId as string)}>
              {t('social.room.open_match')}
            </Button>
          )}
        </>
      ) : (
        <button type="button" className={s.spoiler} onClick={onShow} data-testid="room-spoiler">
          {t('social.room.spoiler', { home: c.home, away: c.away })}
        </button>
      );
    case 'standings':
      if (c.status === 'cancelled') return <p className={s.body}>{t('social.room.standings_cancelled')}</p>;
      return <p className={s.body}>{c.leader ? t('social.room.standings_leader', { name: c.leader, points: c.points ?? 0, moves: c.moves ?? 0 }) : t('social.room.standings_updated')}</p>;
    case 'achievement':
      // A delivery earned in an official match (the server posts `unlock_<variant>`), or a badge.
      if (c.badge.startsWith('unlock_')) return <p className={s.body}>{t('social.room.unlocked', { name: c.alias, delivery: tr.tk(`social.delivery.${c.badge.slice(7)}`) })}</p>;
      return <p className={s.body}>{t('social.room.achievement', { name: c.alias, badge: tr.tk(`social.badge.${c.badge}`, undefined, c.badge) })}</p>;
    case 'highlight':
      return (
        <>
          <p className={s.body}>{c.title ? t('social.room.highlight_titled', { title: c.title }) : t('social.room.highlight')}</p>
          {c.code && (
            <Button variant="accent" icon="play" onClick={() => open.highlight(c.code as string)}>
              {t('social.room.open_highlight')}
            </Button>
          )}
        </>
      );
    case 'rematch':
      return (
        <>
          <p className={s.body}>{t('social.room.rematch', { name: c.fromAlias })}</p>
          {(c.matchId || c.rematchOf) && (
            <Button variant="secondary" icon="rematch" onClick={() => open.rematch(c)}>
              {t('social.room.open_rematch')}
            </Button>
          )}
        </>
      );
    case 'banter':
      return <PlayerLine player={c.author} meta={tr.tk(c.phraseId)} size={32} />;
    case 'text':
      return <PlayerLine player={c.author} meta={c.text} size={32} />;
    default:
      return <p className={s.small}>{t('social.room.unknown')}</p>;
  }
}
