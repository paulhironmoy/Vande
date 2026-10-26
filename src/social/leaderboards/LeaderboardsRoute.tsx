import { useId, useState } from 'react';
import type { GroupKind, LeaderboardEntry, LeaderboardScope, LeaderboardView, Profile } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import { checkGroupName } from '@/net/shared/alias';
import { CITY_IDS } from '@/net/shared/cities';
import { Avatar, Button, Card, Field, ScreenShell, SegmentedControl, StateView } from '@/ui';
import { socialFailure, useAccount, useAction, usePlayerGate, useResource, useSocialServices } from '../hooks';
import { useSocialT, type SocialT } from '../i18n';
import { FailureState, NeedsOnline } from '../components/States';
import { istDay, previousDay } from '../components/time';
import { reportablePlayer, useReportPlayer, type ReportTarget } from '../components/ReportPlayer';
import s from '../components/social.module.css';

const SCOPES: readonly LeaderboardScope[] = ['national', 'city', 'college', 'company', 'friends'];

/**
 * Daily Six leaderboards: national, city (from a fixed list, never GPS), college and company (private groups joined
 * by code), friends. Real counts only; my own row is always shown, pinned when I am outside the list.
 */
export default function LeaderboardsRoute({ route }: { route: RouteOf<'leaderboards'> }) {
  const player = usePlayerGate(route);
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const { net, booting } = useSocialServices();
  const account = useAccount(net, player);
  const ready = Boolean(net && account.state === 'ok');
  const [when, setWhen] = useState<'today' | 'yesterday'>('today');
  const today = istDay(Date.now());
  const day = when === 'today' ? today : previousDay(today);
  const me = useResource<Profile>(ready && net ? () => net.api.call('GET /v1/me') : null, [ready]);
  const scope = route.scope;
  const groups = (me.data?.groups ?? []).filter((g) => g.kind === scope);
  const [groupId, setGroupId] = useState<string | null>(null);
  // The code of a group just created: kept here, because the screen switches to that group's board right after and
  // the creator must still see the code to share it.
  const [made, setMade] = useState<{ kind: GroupKind; code: string } | null>(null);
  const activeGroup = scope === 'college' || scope === 'company' ? (groups.find((g) => g.groupId === groupId) ?? groups[0] ?? null) : null;
  const needsGroup = (scope === 'college' || scope === 'company') && !activeGroup;
  const needsCity = scope === 'city' && me.data !== null && !me.data.city;
  const canLoad = ready && net && me.data !== null && !needsGroup && !needsCity;
  const board = useResource<LeaderboardView>(
    canLoad && net ? () => net.api.call('GET /v1/leaderboards/:scope', { params: { scope }, query: { day, ...(activeGroup ? { groupId: activeGroup.groupId } : {}) } }) : null,
    [canLoad, scope, day, activeGroup?.groupId],
  );
  if (!player) return null;

  const tabs = (
    <nav aria-label={t('social.board.scopes')}>
      <div className={s.tabs}>
        {SCOPES.map((sc) => (
          <button key={sc} type="button" className={s.tab} aria-current={sc === scope ? 'page' : undefined} onClick={() => navigate({ name: 'leaderboards', scope: sc }, { replace: true })} data-testid={`board-tab-${sc}`}>
            {t(`social.board.scope_${sc}` as 'social.board.scope_national')}
          </button>
        ))}
      </div>
    </nav>
  );

  const shell = (children: React.ReactNode) => (
    <ScreenShell title={t('social.board.title')} eyebrow={t('social.board.eyebrow')} onBack={back} narrow testId="leaderboards-screen">
      <div className={s.stack}>
        {tabs}
        {children}
      </div>
    </ScreenShell>
  );

  if (booting || (net && (account.state === 'idle' || account.state === 'syncing') && !me.data)) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);
  if (account.state === 'offline' || account.state === 'error' || account.state === 'age_required') return shell(<FailureState failure={account.state} onRetry={account.retry} />);
  if (!me.data) return shell(me.error ? <FailureState failure={socialFailure(me.error)} onRetry={me.reload} /> : <StateView kind="loading" />);

  if (needsCity) return shell(<CityPicker tr={tr} onSaved={me.reload} />);
  const madeHere = made && made.kind === scope ? made.code : null;
  const onMade = (code: string) => setMade({ kind: scope as GroupKind, code });
  if (needsGroup) return shell(<GroupJoin kind={scope as GroupKind} tr={tr} onDone={me.reload} made={madeHere} onMade={onMade} />);

  const view = board.data;
  return shell(
    <>
      <SegmentedControl label={t('social.board.day')} options={[{ value: 'today', label: t('social.board.today') }, { value: 'yesterday', label: t('social.board.yesterday') }]} value={when} onChange={setWhen} block testId="board-day" />
      {scope === 'city' && me.data.city && <p className={s.small}>{t('social.board.city_note', { city: tr.city(me.data.city) })}</p>}
      {activeGroup && groups.length > 1 && (
        <Field label={t('social.board.group')} htmlFor="board-group">
          <select id="board-group" className={s.select} value={activeGroup.groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {activeGroup && <p className={s.small}>{t('social.board.group_private', { name: activeGroup.name })}</p>}
      {!view ? (
        board.error ? <FailureState failure={socialFailure(board.error)} onRetry={board.reload} /> : <StateView kind="loading" />
      ) : view.entries.length === 0 ? (
        <StateView
          kind="empty_cup"
          title={scope === 'friends' ? t('social.board.empty_friends_title') : t('social.board.empty_title')}
          body={scope === 'friends' ? t('social.board.empty_friends_body') : t('social.board.empty_body')}
          actionLabel={t('social.board.play_daily')}
          onAction={() => navigate({ name: 'daily' })}
        />
      ) : (
        <Board view={view} tr={tr} />
      )}
      {(scope === 'college' || scope === 'company') && <GroupJoin kind={scope} tr={tr} onDone={me.reload} compact made={madeHere} onMade={onMade} />}
    </>,
  );
}

function Row({ e, tr, pinned, report }: { e: LeaderboardEntry; tr: SocialT; pinned?: boolean; report?: (target: ReportTarget, testId?: string) => React.ReactNode }) {
  return (
    <Card as="li" padding={3} className={[s.player, e.isMe ? s.me : ''].join(' ')} data-testid={e.isMe ? 'board-me' : undefined} aria-label={pinned ? tr.t('social.board.you_pinned', { rank: e.rank }) : undefined}>
      <span className={s.rank}>{tr.number(e.rank)}</span>
      <Avatar avatar={e.avatar} size={36} decorative />
      <span className={s.playerText}>
        <span className={s.alias}>
          {e.alias}
          {e.isMe && ` ${tr.t('social.common.you_suffix')}`}
        </span>
      </span>
      <span className={s.score}>{tr.number(e.score)}</span>
      {report && !e.isMe && reportablePlayer(e.playerId, null) && report({ playerId: e.playerId, alias: e.alias }, `board-report-${e.rank}`)}
    </Card>
  );
}

function Board({ view, tr }: { view: LeaderboardView; tr: SocialT }) {
  const mineVisible = view.entries.some((e) => e.isMe);
  const reporting = useReportPlayer();
  return (
    <section className={s.section} aria-labelledby="board-list">
      <h2 className={s.h3} id="board-list">
        {tr.t('social.board.ranked', { total: view.total })}
      </h2>
      <ol className={s.list} data-testid="board-entries">
        {view.entries.map((e) => (
          <Row key={`${e.rank}-${e.playerId}`} e={e} tr={tr} report={reporting.button} />
        ))}
      </ol>
      {reporting.dialog}
      {!mineVisible && view.me && (
        <ol className={s.list} aria-label={tr.t('social.board.your_row')}>
          <Row e={view.me} tr={tr} pinned />
        </ol>
      )}
      {!view.me && <p className={s.small}>{tr.t('social.board.not_ranked')}</p>}
      <p className={s.small}>{tr.t('social.board.rules')}</p>
    </section>
  );
}

function CityPicker({ tr, onSaved }: { tr: SocialT; onSaved: () => void }) {
  const { t } = tr;
  const { net } = useSocialServices();
  const toast = useApp((st) => st.toast);
  const [city, setCity] = useState('');
  const action = useAction();
  const id = useId();
  const save = async () => {
    if (!net || !city) return;
    const r = await action.run(() => net.api.call('PATCH /v1/me', { body: { city } }));
    if (r.ok) onSaved();
    else toast({ kind: 'warning', text: t('social.state.offline_body') });
  };
  return (
    <Card padding={5} className={s.stackSm} data-testid="board-city">
      <h2 className={s.h2}>{t('social.board.city_title')}</h2>
      <p className={s.body}>{t('social.board.city_body')}</p>
      <Field label={t('social.board.city_label')} htmlFor={id}>
        <select id={id} className={s.select} value={city} onChange={(e) => setCity(e.target.value)} data-testid="board-city-select">
          <option value="">{t('social.board.city_choose')}</option>
          {CITY_IDS.map((c) => (
            <option key={c} value={c}>
              {tr.city(c)}
            </option>
          ))}
        </select>
      </Field>
      <Button variant="primary" block disabled={!city} loading={action.busy} onClick={() => void save()} data-testid="board-city-save">
        {t('social.board.city_save')}
      </Button>
    </Card>
  );
}

function GroupJoin({ kind, tr, onDone, compact, made, onMade }: { kind: GroupKind; tr: SocialT; onDone: () => void; compact?: boolean; made: string | null; onMade: (code: string) => void }) {
  const { t } = tr;
  const { net } = useSocialServices();
  const toast = useApp((st) => st.toast);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAction();
  const codeId = useId();
  const nameId = useId();
  const join = async () => {
    if (!net) return;
    setError(null);
    const r = await action.run(() => net.api.call('POST /v1/groups/join', { body: { code: code.trim() } }));
    if (r.ok) {
      setCode('');
      toast({ kind: 'success', text: t('social.board.joined') });
      onDone();
    } else setError(r.failure === 'not_found' ? t('social.board.code_unknown') : r.failure === 'invalid' ? t('social.board.code_invalid') : r.failure === 'conflict' ? t('social.board.group_limit') : t('social.state.offline_body'));
  };
  const create = async () => {
    if (!net) return;
    setError(null);
    const check = checkGroupName(name);
    if (!check.ok) {
      setError(t('social.board.group_name_invalid'));
      return;
    }
    const r = await action.run(() => net.api.call('POST /v1/groups', { body: { kind, name: check.value } }));
    if (r.ok) {
      onMade(r.value.code);
      onDone();
    } else setError(r.failure === 'invalid' ? t('social.board.group_name_invalid') : r.failure === 'conflict' ? t('social.board.group_limit') : t('social.state.offline_body'));
  };
  return (
    <Card padding={compact ? 4 : 5} variant={compact ? 'sunken' : 'default'} className={s.stackSm} data-testid={`board-group-${kind}`}>
      <h2 className={compact ? s.h3 : s.h2}>{t(kind === 'college' ? 'social.board.group_college_title' : 'social.board.group_company_title')}</h2>
      {!compact && <p className={s.body}>{t('social.board.group_body')}</p>}
      <Field label={t('social.board.code_label')} htmlFor={codeId}>
        <input id={codeId} type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" maxLength={14} placeholder="ABCD-EFGH-JK" data-testid={`board-code-${kind}`} />
      </Field>
      <Button variant="primary" block disabled={code.trim().length < 10} loading={action.busy} onClick={() => void join()}>
        {t('social.board.join')}
      </Button>
      <Field label={t(kind === 'college' ? 'social.board.create_college' : 'social.board.create_company')} description={t('social.board.create_hint')} htmlFor={nameId}>
        <input id={nameId} type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" />
      </Field>
      <Button variant="secondary" block disabled={name.trim().length < 3} loading={action.busy} onClick={() => void create()}>
        {t('social.board.create')}
      </Button>
      {made && (
        <div className={s.stackSm} role="status">
          <p className={s.body}>{t('social.board.created_code')}</p>
          <p className={s.code} data-testid="board-new-code">
            {made}
          </p>
          <p className={s.small}>{t('social.board.created_hint')}</p>
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
