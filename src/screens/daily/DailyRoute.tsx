import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DailyResultResponse, DailyView, FieldSetting, LeaderboardView, MatchEventLog, PlayerRef } from '@/contracts';
import { WICKETS_PER_INNINGS } from '@/contracts';
import { useApp } from '@/app/store';
import { localPlayerRef } from '@/app/storeTypes';
import { routeUrl, useRouter, type RouteOf } from '@/app/router';
import { useT, type MessageKey } from '@/i18n';
import { Avatar, Button, Card, Chip, Icon, KITS, ScreenShell, StateView } from '@/ui';
import { engine } from '@/engine';
import { BattingScreen } from '../batting/BattingScreen';
import { RevealScreen } from '../reveal/RevealScreen';
import { useAccountSync, useInPlay, useLoad, useNet, useNow, usePlayerGate } from '../app/hooks';
import { failureKind } from '../app/errors';
import { clockText, untilText } from '../app/deadline';
import { AliasFix } from '../common/AliasFix';
import { netInnings } from '../match/netInnings';
import { cardBlob, dailyCardModel, playerOf } from '../share/cards';
import { shareLedger, shareToast } from '../share/share';
import { dailyTransport, saveAttempt, savedAttempt, type SavedAttempt } from './dailyTransport';
import s from './DailyRoute.module.css';

type Stage = { kind: 'overview' } | { kind: 'bat'; attempt: SavedAttempt } | { kind: 'result'; attempt: SavedAttempt } | { kind: 'watch'; result: DailyResultResponse & { verified?: boolean | null } };

/** Daily Six: the same three sealed overs for everyone today, best of three, with a streak and the leaderboards. */
export default function DailyRoute({ route }: { route: RouteOf<'daily'> }) {
  const player = usePlayerGate(route);
  const tr = useT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const online = useApp((st) => st.online);
  const { net, services, booting } = useNet();
  const sync = useAccountSync();
  const now = useNow(30_000);
  const signedIn = Boolean(player?.id);
  const daily = useLoad<DailyView>(net && signedIn ? () => net.api.call('GET /v1/daily') : null, [net, signedIn]);
  const [stage, setStage] = useState<Stage>({ kind: 'overview' });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showProof, setShowProof] = useState(false);
  useInPlay(stage.kind === 'bat');

  if (!player) return null;
  const shell = (body: ReactNode, testId = 'daily-screen') => (
    <ScreenShell title={t('daily.title')} eyebrow={t('brand.mode')} onBack={back} narrow testId={testId}>
      {body}
    </ScreenShell>
  );

  if (booting) return shell(<StateView kind="loading" />);
  if (!net) return shell(<StateView kind="offline" title={t('daily.needs_online_title')} body={t('daily.needs_online_body')} actionLabel={t('home.ghosts.title')} onAction={() => navigate({ name: 'ghosts' })} />);
  if (!signedIn) {
    if (sync === 'alias_rejected') return shell(<AliasFix />);
    return shell(sync === 'offline' || !online ? <StateView kind="offline" body={t('daily.signup_offline')} /> : <StateView kind="loading" title={t('duel.signing_up')} />);
  }

  if (stage.kind === 'bat' && daily.data)
    return (
      <DailyBat
        attempt={stage.attempt}
        view={daily.data}
        me={localPlayerRef(player)}
        onDone={() => {
          services?.analytics.track('innings_completed', { mode: 'daily' });
          setStage({ kind: 'result', attempt: stage.attempt });
        }}
        onExit={() => setStage({ kind: 'overview' })}
      />
    );

  if (stage.kind === 'result')
    return shell(
      <DailyResult
        attempt={stage.attempt}
        me={localPlayerRef(player)}
        view={daily.data}
        onWatch={(result) => setStage({ kind: 'watch', result })}
        onAgain={() => {
          daily.reload();
          setStage({ kind: 'overview' });
        }}
      />,
      'daily-result-screen',
    );

  if (stage.kind === 'watch')
    return <RevealScreen log={stage.result.log} me={0} verified={stage.result.verified ?? null} onClose={() => setStage({ kind: 'overview' })} onFallback={(reason) => services?.analytics.track('renderer_fallback', { reason, quality: '2d' })} />;

  // ---- overview -------------------------------------------------------------------------------------------------
  if (!daily.data) {
    if (daily.error) {
      const k = failureKind(daily.error);
      return shell(k === 'offline' ? <StateView kind="offline" body={t('daily.offline_body')} onAction={daily.reload} /> : <StateView kind="error" onAction={daily.reload} />);
    }
    return shell(<StateView kind="loading" title={t('daily.loading')} />);
  }
  const d = daily.data;
  const left = Math.max(0, d.attemptsMax - d.attemptsUsed);
  const resume = savedAttempt(d.day);
  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const r = await net.api.call('POST /v1/daily/attempts');
      const attempt: SavedAttempt = { day: d.day, attemptId: r.attemptId, attempt: r.attempt };
      saveAttempt(attempt);
      setStage({ kind: 'bat', attempt });
    } catch (e) {
      const k = failureKind(e);
      setStartError(k === 'conflict' ? t('daily.no_attempts') : k === 'offline' ? t('daily.offline_body') : t('state.error.body'));
      daily.reload();
    } finally {
      setStarting(false);
    }
  };

  return shell(
    <div className={s.stack}>
      <Card className={s.hero} padding={5}>
        <span className={s.glow} aria-hidden="true" />
        <p className={s.eyebrow}>{tr.date(`${d.day}T12:00:00+05:30`, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}</p>
        <h1 className={s.h1}>{t('daily.headline')}</h1>
        <p className={s.body}>{t('daily.body')}</p>
        <div className={s.chips}>
          <Chip tone="clay" icon="field">
            {t(`pitch.${d.conditions.pitch}` as MessageKey)}
          </Chip>
          <Chip tone="cyan" icon="sparkle">
            {t(`weather.${d.conditions.weather}` as MessageKey)}
          </Chip>
        </div>
        <div className={s.stats}>
          <div className={s.stat}>
            <span className={s.statLabel}>{t('daily.attempts_label')}</span>
            <span className={s.pips} data-testid="daily-attempts" aria-hidden="true">
              {Array.from({ length: d.attemptsMax }, (_, i) => (
                <span key={i} className={s.pip} data-used={i >= left || undefined} aria-hidden="true" />
              ))}
            </span>
            <span className={s.statValue}>{t('home.daily.attempts', { count: left })}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>{t('daily.best_label')}</span>
            <span className={s.big}>{d.bestScore === null ? '—' : tr.number(d.bestScore)}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>{t('daily.streak_label')}</span>
            <span className={s.big}>
              <Icon name="flame" size={20} /> {tr.number(d.streak)}
            </span>
          </div>
        </div>
        <p className={s.resets}>
          <Icon name="clock" size={16} /> {t('daily.resets', { when: untilText(tr, d.resetsAt, now) ?? '', at: clockText(tr, d.resetsAt, now) ?? '' })}
        </p>
      </Card>

      {startError && (
        <p className={s.error} role="alert">
          <Icon name="alert" size={16} /> {startError}
        </p>
      )}
      {resume ? (
        <Button variant="accent" size="xl" block icon="bat" onClick={() => setStage({ kind: 'bat', attempt: resume })} data-testid="daily-resume">
          {t('daily.resume', { n: resume.attempt })}
        </Button>
      ) : left > 0 ? (
        <Button variant="accent" size="xl" block icon="bat" loading={starting} onClick={() => void start()} data-testid="daily-start">
          {t('daily.start', { n: d.attemptsUsed + 1, total: d.attemptsMax })}
        </Button>
      ) : (
        <StateView kind="locked" title={t('daily.done_title')} body={t('daily.done_body', { when: untilText(tr, d.resetsAt, now) ?? '' })} compact />
      )}

      <div className={s.row}>
        <Button variant="secondary" icon="chart" onClick={() => navigate({ name: 'leaderboards', scope: 'national' })} data-testid="daily-leaderboards">
          {t('daily.leaderboards')}
        </Button>
        <Button variant="ghost" icon="seal" aria-expanded={showProof} onClick={() => setShowProof((v) => !v)} data-testid="daily-proof">
          {t('daily.fair_title')}
        </Button>
      </div>
      {showProof && (
        <Card variant="sunken" padding={4} className={s.proof}>
          <p className={s.small}>{t('daily.fair_body')}</p>
          <ol className={s.commits}>
            {d.overCommits.map((c, i) => (
              <li key={i}>
                <span>{t('daily.over_n', { n: i + 1 })}</span> <code>{c ? `${c.slice(0, 16)}…` : '—'}</code>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <p className={s.small}>{t('daily.rules')}</p>
    </div>,
  );
}

function setterRef(day: string, alias: string): PlayerRef {
  return { id: `daily-${day}`, alias, avatar: { seed: `daily-setter-${day}` }, kit: KITS[5], kind: 'daily' };
}

function DailyBat({ attempt, view, me, onDone, onExit }: { attempt: SavedAttempt; view: DailyView; me: PlayerRef; onDone: () => void; onExit: () => void }) {
  const { t } = useT();
  const online = useApp((st) => st.online);
  const { net } = useNet();
  const [queued, setQueued] = useState(false);
  const innings = useMemo(() => (net ? netInnings(dailyTransport(net), attempt.attemptId, { onQueued: setQueued }) : null), [net, attempt.attemptId]);
  const [field, setField] = useState<FieldSetting | null>(null);
  const [error, setError] = useState<'offline' | 'error' | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!innings) return;
    let alive = true;
    setError(null);
    innings.start().then(
      (first) => {
        if (!alive) return;
        if (!first) onDone();
        else setField(first.field);
      },
      (e) => alive && setError(failureKind(e) === 'offline' ? 'offline' : 'error'),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [innings, tries]);
  if (!innings || !field)
    return (
      <ScreenShell title={t('daily.title')} onBack={onExit} narrow testId="daily-bat-loading">
        {error ? <StateView kind={error === 'offline' ? 'offline' : 'error'} onAction={() => setTries((n) => n + 1)} /> : <StateView kind="loading" title={t('match.bat_loading')} />}
      </ScreenShell>
    );
  return (
    <BattingScreen
      setup={{ conditions: view.conditions, field, batter: me, bowler: setterRef(view.day, t('daily.setter')) }}
      nextBall={innings.nextBall}
      submitShot={innings.submitShot}
      onComplete={onDone}
      onExit={onExit}
      quickStart
      // A Daily Six attempt is six balls; the server ends it (no Super Ball).
      includeSuperBall={false}
      totalBalls={6}
      connectivity={online ? (queued ? 'reconnecting' : 'online') : 'offline'}
      title={t('daily.attempt_n', { n: attempt.attempt })}
    />
  );
}

export function DailyResult({ attempt, me, view, onWatch, onAgain }: { attempt: SavedAttempt; me: PlayerRef; view: DailyView | null; onWatch: (r: DailyResultResponse & { verified: boolean | null }) => void; onAgain: () => void }) {
  const tr = useT();
  const { t } = tr;
  const navigate = useRouter((st) => st.navigate);
  const toast = useApp((st) => st.toast);
  const { net, services } = useNet();
  const result = useLoad<DailyResultResponse>(net ? () => net.api.call('GET /v1/daily/attempts/:id/result', { params: { id: attempt.attemptId } }) : null, [net, attempt.attemptId]);
  // Today's rank, from the national board's own "you" row (boards can lag a little behind the result).
  const rank = useLoad<LeaderboardView>(net && result.data?.counted ? () => net.api.call('GET /v1/leaderboards/:scope', { params: { scope: 'national' } }) : null, [net, Boolean(result.data?.counted)]);
  const [shared, setShared] = useState(() => shareLedger().used(attempt.attemptId, 'final'));
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    if (!result.data) return;
    saveAttempt(null);
    let alive = true;
    void engine
      .verifyMatchLog(result.data.log)
      .then((v) => alive && setVerified(v.ok))
      .catch(() => alive && setVerified(false));
    return () => {
      alive = false;
    };
  }, [result.data]);
  if (!result.data) {
    const k = result.error ? failureKind(result.error) : null;
    if (k === 'offline') return <StateView kind="offline" body={t('daily.result_offline')} onAction={result.reload} />;
    if (k === 'sealed') return <StateView kind="upload_queued" title={t('daily.result_pending')} body={t('daily.result_pending_body')} onAction={result.reload} actionLabel={t('common.retry')} />;
    if (k) return <StateView kind="error" onAction={result.reload} />;
    return <StateView kind="loading" title={t('daily.result_loading')} />;
  }
  const r = result.data;
  const left = view ? Math.max(0, view.attemptsMax - Math.max(view.attemptsUsed, attempt.attempt)) : 0;
  // The over this attempt faced must be the one sealed when the day opened (its commit was public before you batted).
  const published = view?.overCommits[attempt.attempt - 1] ?? null;
  const sealedBefore = published ? r.log.commits[1]?.hash === published : null;
  const share = async () => {
    if (!services) return;
    const url = routeUrl({ name: 'daily' });
    services.analytics.track('share_initiated', { mode: 'daily', channel: 'share_sheet' });
    const image = await cardBlob(dailyCardModel(tr, { player: playerOf(me), day: attempt.day, score: r.score, best: r.bestScore, streak: view?.streak ?? 0, conditions: r.log.conditions, url }), tr.locale);
    const out = await services.platform.share.share({ title: t('brand.name'), text: t('daily.share_text', { score: r.score }), url, image: image ?? undefined });
    if (out === 'shared' || out === 'copied') {
      shareLedger().mark(attempt.attemptId, 'final');
      setShared(true);
      services.analytics.track('share_completed', { mode: 'daily', channel: 'share_sheet' });
    }
    shareToast(tr, toast, out);
  };
  return (
    <div className={s.stack} data-testid="daily-result">
      <Card className={s.hero} padding={5}>
        <span className={s.glow} aria-hidden="true" />
        <p className={s.eyebrow}>{t('daily.attempt_n', { n: attempt.attempt })}</p>
        <div className={s.resultRow}>
          <Avatar avatar={me.avatar} kit={me.kit} size={64} decorative />
          <div>
            <span className={s.statLabel}>{t('daily.score_label')}</span>
            <span className={s.huge}>{tr.number(r.score)}</span>
          </div>
        </div>
        <DailyBreakdown log={r.log} score={r.score} />
        {r.counted && rank.data?.me && (
          <p className={s.rank} data-testid="daily-rank">
            <Icon name="chart" size={16} /> {t('daily.rank_today', { rank: tr.number(rank.data.me.rank), total: tr.number(rank.data.total) })}
          </p>
        )}
        <div className={s.chips}>
          <Chip tone="amber" icon="trophy">
            {r.bestScore === null ? t('daily.no_best_yet') : t('daily.best_today', { score: tr.number(r.bestScore) })}
          </Chip>
          {view && view.streak > 0 && (
            <Chip tone="violet" icon="flame">
              {t('home.daily.streak', { count: view.streak })}
            </Chip>
          )}
        </div>
        <p className={s.body} data-testid="daily-counted" data-counted={r.counted ? 'true' : 'false'}>
          {!r.counted ? t('daily.not_counted') : r.bestScore !== null && r.score >= r.bestScore ? t('daily.result_best') : t('daily.result_not_best')}
        </p>
        {sealedBefore !== null && (
          <p className={s.proofLine} data-ok={sealedBefore && verified !== false ? true : undefined} data-testid="daily-proof-line">
            <Icon name={sealedBefore && verified !== false ? 'seal' : 'alert'} size={16} />
            {sealedBefore && verified !== false ? t('daily.sealed_before', { hash: `${published!.slice(0, 10)}…` }) : t('daily.sealed_mismatch')}
          </p>
        )}
      </Card>
      <Button variant="primary" size="lg" block icon="replay" onClick={() => onWatch({ ...r, verified })} data-testid="daily-watch">
        {t('daily.watch')}
      </Button>
      <div className={s.row}>
        <Button variant="secondary" icon="share" disabled={shared} onClick={() => void share()} data-testid="daily-share">
          {shared ? t('daily.shared') : t('common.share')}
        </Button>
        <Button variant="secondary" icon="chart" onClick={() => navigate({ name: 'leaderboards', scope: 'national' })} data-testid="daily-leaderboards">
          {t('daily.leaderboards')}
        </Button>
      </div>
      {left > 0 ? (
        <Button variant="ghost" icon="bat" onClick={onAgain} data-testid="daily-again">
          {t('daily.again', { count: left })}
        </Button>
      ) : (
        <p className={s.small}>{t('daily.all_used')}</p>
      )}
    </div>
  );
}

/** The Daily Six score made visible: runs and wickets, then how the points add up (GAME_RULES: Daily Six score). */
export function dailyBreakdown(log: MatchEventLog): { runs: number; wickets: number; fours: number; sixes: number; inHand: number; total: number } {
  const inn = log.innings[0];
  const live = inn.balls.filter((b) => !b.dead);
  const fours = live.filter((b) => b.runs === 4).length;
  const sixes = live.filter((b) => b.runs === 6).length;
  const inHand = Math.max(0, WICKETS_PER_INNINGS - inn.wickets);
  return { runs: inn.runs, wickets: inn.wickets, fours, sixes, inHand, total: inn.runs * 10 + fours * 4 + sixes * 8 + inHand * 12 };
}

function DailyBreakdown({ log, score }: { log: MatchEventLog; score: number }) {
  const tr = useT();
  const { t } = tr;
  const b = dailyBreakdown(log);
  return (
    <div className={s.breakdown} data-testid="daily-breakdown">
      <p className={s.innings}>{t('daily.innings_line', { runs: b.runs, wickets: b.wickets })}</p>
      {/* Only an exact explanation is shown: if the rules ever change, the line goes rather than mislead. */}
      {b.total === score && (
        <ul className={s.points} aria-label={t('daily.points_label')}>
          <li>{t('daily.points_runs', { count: b.runs, points: tr.number(b.runs * 10) })}</li>
          {b.fours > 0 && <li>{t('daily.points_fours', { count: b.fours, points: tr.number(b.fours * 4) })}</li>}
          {b.sixes > 0 && <li>{t('daily.points_sixes', { count: b.sixes, points: tr.number(b.sixes * 8) })}</li>}
          {b.inHand > 0 && <li>{t('daily.points_wickets', { count: b.inHand, points: tr.number(b.inHand * 12) })}</li>}
        </ul>
      )}
    </div>
  );
}
