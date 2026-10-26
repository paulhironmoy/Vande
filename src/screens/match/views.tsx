import { useMemo, useState } from 'react';
import type { MatchView, PlayerRef } from '@/contracts';
import type { Services } from '@/app/services';
import type { Net } from '@/net';
import { useApp } from '@/app/store';
import { routeUrl, useRouter } from '@/app/router';
import { useT, type MessageKey } from '@/i18n';
import { Avatar, Button, Card, Chip, Icon, StateView } from '@/ui';
import { clockText, isPast, untilText } from '../app/deadline';
import { setAfterTraining, useNow } from '../app/hooks';
import { hasTrained } from '../training/progress';
import { revealSlot } from './revealSlot';
import { useRivalry, type Rivalry } from './rivalry';
import { InvitePanel } from '../share/InvitePanel';
import { PushPrompt } from '../common/PushPrompt';
import { copyText, momentAvailable, savedInvite, shareLocale, shareMatchMoment } from '../share/share';
import { reminderFor } from '@/platform';
import s from './MatchRoute.module.css';

function Players({ view, me, opponent }: { view: MatchView; me: PlayerRef; opponent: PlayerRef | null }) {
  const { t } = useT();
  return (
    <div className={s.players}>
      <div className={s.side}>
        <Avatar avatar={me.avatar} kit={me.kit} size={64} decorative />
        <span className={s.name}>{me.alias}</span>
        <span className={s.flag} data-on={view.locked[view.me] || undefined}>
          <Icon name={view.locked[view.me] ? 'seal' : 'clock'} size={14} />
          {view.locked[view.me] ? t('match.sealed') : t('match.not_locked')}
        </span>
      </div>
      <span className={s.vs} aria-hidden="true">
        {t('common.vs')}
      </span>
      <div className={s.side}>
        {opponent ? <Avatar avatar={opponent.avatar} kit={opponent.kit} size={64} decorative /> : <span className={s.empty} aria-hidden="true"><Icon name="plus" size={22} /></span>}
        <span className={s.name}>{opponent ? opponent.alias : t('match.friend_tbc')}</span>
        {opponent && (
          <span className={s.flag} data-on={view.locked[(1 - view.me) as 0 | 1] || undefined}>
            <Icon name={view.locked[(1 - view.me) as 0 | 1] ? 'seal' : 'clock'} size={14} />
            {view.locked[(1 - view.me) as 0 | 1] ? t('match.sealed') : t('match.not_locked')}
          </span>
        )}
      </div>
    </div>
  );
}

function Conditions({ view }: { view: MatchView }) {
  const { t } = useT();
  return (
    <div className={s.chips}>
      <Chip tone="clay" icon="field">
        {t(`pitch.${view.conditions.pitch}` as MessageKey)}
      </Chip>
      <Chip tone="cyan" icon="sparkle">
        {t(`weather.${view.conditions.weather}` as MessageKey)}
      </Chip>
      {view.cup && (
        <Chip tone="violet" icon="cup">
          {view.cup.stage === 'final' ? t('home.kind.final') : t('home.kind.cup')}
        </Chip>
      )}
    </div>
  );
}

/** The record against this opponent ("2 won · 1 lost"), or that this is your first match against them. */
function RivalryLine({ rivalry, name }: { rivalry: Rivalry | null; name: string }) {
  const { t } = useT();
  if (!rivalry) return null;
  return (
    <p className={s.rivalry} data-testid="match-rivalry">
      <Icon name="trophy" size={16} />
      {rivalry.played === 0 ? t('match.rivalry_first', { name }) : t('match.rivalry', { name, won: rivalry.won, lost: rivalry.lost, tied: rivalry.tied })}
    </p>
  );
}

/** A commit hash as proof that an over is sealed (shortened, copyable, explained). */
export function SealProof({ hash, label }: { hash: string; label: string }) {
  const { t } = useT();
  const toast = useApp((st) => st.toast);
  return (
    <div className={s.proof} data-testid="match-commit">
      <span className={s.proofLabel}>
        <Icon name="seal" size={16} /> {label}
      </span>
      <button
        type="button"
        className={s.hash}
        onClick={async () => toast({ kind: (await copyText(hash)) ? 'success' : 'warning', text: t('match.hash_copied') })}
        title={hash}
      >
        {/* The accessible name starts with what is visible (the code), then says what the button does. */}
        <code>
          {hash.slice(0, 12)}…{hash.slice(-6)}
        </code>
        <span className="sr-only">{t('match.copy_hash')}</span>
        <Icon name="copy" size={14} />
      </button>
    </div>
  );
}

/** Before batting: plan and lock, or the sealed proof while the other side locks (or joins). */
export function SealedView({ view, me, opponent, now, justLocked, onPlan, net, services }: { view: MatchView; me: PlayerRef; opponent: PlayerRef | null; now: number; justLocked: boolean; onPlan?: () => void; net: Net; services: Services | null }) {
  const tr = useT();
  const { t } = tr;
  const navigate = useRouter((st) => st.navigate);
  // The creator's invite link comes from the server (any device); the link saved at creation is the fallback.
  const inviteUrl = useMemo(() => view.inviteUrl ?? savedInvite({ matchId: view.matchId })?.inviteUrl ?? null, [view.inviteUrl, view.matchId]);
  const mine = view.locked[view.me];
  const oppLocked = view.locked[(1 - view.me) as 0 | 1];
  const lockIn = untilText(tr, view.deadlines.lockBy, now);
  const lockAt = clockText(tr, view.deadlines.lockBy, now);
  return (
    <div className={s.stack} data-testid="match-phase" data-phase={view.phase}>
      <Players view={view} me={me} opponent={opponent} />
      <Conditions view={view} />
      {!mine ? (
        <Card className={s.hero} padding={5} data-testid="match-plan-card">
          <h1 className={s.h1}>{t('match.plan_title')}</h1>
          <p className={s.body}>{t('match.plan_body')}</p>
          {lockIn && (
            <p className={s.deadline}>
              <Icon name="clock" size={16} /> {t('match.lock_deadline', { when: lockIn, at: lockAt ?? '' })}
            </p>
          )}
          <Button variant="accent" size="xl" block icon="lock" onClick={onPlan} data-testid="match-plan">
            {t('match.plan_cta')}
          </Button>
          {/* New on this device (an invited friend who skipped onboarding's Training): a one-minute practice first. */}
          {!hasTrained() && (
            <Button
              variant="ghost"
              block
              icon="target"
              onClick={() => {
                setAfterTraining({ name: 'match', matchId: view.matchId });
                navigate({ name: 'training' });
              }}
              data-testid="match-training"
            >
              {t('match.try_training')}
            </Button>
          )}
        </Card>
      ) : (
        <Card className={s.hero} padding={5} data-testid="match-sealed">
          <span className={s.sealIcon} aria-hidden="true">
            <Icon name="seal" size={34} />
          </span>
          <h1 className={s.h1}>{justLocked ? t('match.sealed_now') : t('match.sealed_title')}</h1>
          <p className={s.body}>{t('match.sealed_body')}</p>
          {view.myCommit && <SealProof hash={view.myCommit} label={t('match.your_commit')} />}
          <p className={s.status}>
            <Icon name={oppLocked ? 'check' : 'clock'} size={16} />
            {!opponent ? t('match.waiting_join') : oppLocked ? t('match.opp_locked', { name: opponent.alias }) : t('match.opp_not_locked', { name: opponent.alias })}
          </p>
          {!oppLocked && lockIn && <p className={s.small}>{t('match.lock_deadline', { when: lockIn, at: lockAt ?? '' })}</p>}
        </Card>
      )}
      {mine && justLocked && view.kind === 'duel' && services && <PushPrompt push={services.platform.push} net={net} opponent={opponent?.alias ?? null} />}
      {view.phase === 'awaiting_opponent' &&
        (inviteUrl ? (
          <InvitePanel matchId={view.matchId} inviteUrl={inviteUrl} inviter={me} conditions={view.conditions} />
        ) : (
          <p className={s.small}>{t('match.invite_elsewhere')}</p>
        ))}
      {view.roomId && (
        <Button variant="ghost" icon="message" onClick={() => navigate({ name: 'room', roomId: view.roomId! })}>
          {t('match.room')}
        </Button>
      )}
      <p className={s.small}>{t('match.seed_commit', { hash: view.seedCommit.slice(0, 10) })}</p>
    </div>
  );
}

/** Both overs sealed: the innings is ready (the field is shown with the first ball). */
export function BatReadyView({ view, opponent, now, onBat }: { view: MatchView; opponent: PlayerRef | null; now: number; onBat: () => void }) {
  const tr = useT();
  const { t } = tr;
  const by = untilText(tr, view.deadlines.batBy, now);
  return (
    <div className={s.stack} data-testid="match-phase" data-phase={view.phase}>
      <Card className={s.hero} padding={5} data-testid="match-bat-card">
        <span className={s.batIcon} aria-hidden="true">
          <Icon name="bat" size={34} />
        </span>
        <h1 className={s.h1}>{view.myBallsFaced > 0 ? t('match.bat_resume_title') : t('match.bat_title')}</h1>
        <p className={s.body}>{t('match.bat_body', { name: opponent?.alias ?? '' })}</p>
        <ul className={s.facts}>
          <li>
            <Icon name="ball" size={16} /> {t('match.bat_fact_balls')}
          </li>
          <li>
            <Icon name="eye-off" size={16} /> {t('match.bat_fact_sealed')}
          </li>
          <li>
            <Icon name="offline" size={16} /> {t('match.bat_fact_offline')}
          </li>
        </ul>
        {by && (
          <p className={s.deadline}>
            <Icon name="clock" size={16} /> {t('match.bat_deadline', { when: by })}
          </p>
        )}
        <Button variant="accent" size="xl" block icon="bat" onClick={onBat} data-testid="match-bat-start">
          {view.myBallsFaced > 0 ? t('match.bat_resume', { n: view.myBallsFaced + 1 }) : t('match.bat_start')}
        </Button>
      </Card>
      <Conditions view={view} />
    </div>
  );
}

/**
 * Honest anticipation: flags and public times only. Never the other innings' score, never when they batted, never
 * a partial result. One optional reminder per match, before the batting deadline. Once both innings of a duel are in,
 * the shared reveal moment (a public time, the same for both players) is counted down; the route fetches the match
 * again at that moment and rolls into the reveal.
 */
export function AwaitingRevealView({ view, me, opponent, now, services }: { view: MatchView; me: PlayerRef; opponent: PlayerRef | null; now: number; services: Services | null }) {
  const tr = useT();
  const { t } = tr;
  const oppDone = view.battingDone[(1 - view.me) as 0 | 1];
  const revealAt = view.deadlines.revealAt;
  const batBy = view.deadlines.batBy;
  const slot = revealSlot(view);
  const slotMs = slot ? Date.parse(slot) : Number.NaN;
  // By the second in the last two minutes, every 15 s before that.
  const clock = useNow(slot && slotMs - Date.now() < 120_000 ? 1000 : 15_000);
  const tick = Math.max(now, clock);
  const rivalry = useRivalry(services?.net ?? null, opponent?.id ?? null, view.matchId);
  // The reminder says what the friend has left to do (lock or bat) and by when, as a real India-time date. It is
  // offered only while there is such a task (reminderFor), before its deadline and once per match; worked out on
  // every render, so a poll that brings their innings in takes the offer away.
  const task = reminderFor(view);
  const ctx = { kind: view.kind === 'cup' ? ('cup' as const) : ('duel' as const), id: view.matchId, url: routeUrl({ name: 'match', matchId: view.matchId }), locale: shareLocale(tr.locale), ...(task ?? {}) };
  const [, setShared] = useState(0);
  const canNudge = Boolean(task) && !oppDone && !isPast(task?.deadline ?? batBy, now) && momentAvailable('reminder', ctx);
  const nudge = async () => {
    if (!services) return;
    services.analytics.track('share_initiated', { mode: ctx.kind, channel: 'whatsapp' });
    const r = await shareMatchMoment(services.platform.share, 'reminder', ctx, { via: 'whatsapp', t: tr });
    if (r === 'opened') services.analytics.track('reminder_sent', { mode: ctx.kind });
    setShared((n) => n + 1);
  };
  if (slot)
    return (
      <div className={s.stack} data-testid="match-phase" data-phase={view.phase}>
        <Players view={view} me={me} opponent={opponent} />
        <Conditions view={view} />
        <Card className={s.hero} padding={5} data-testid="match-awaiting-reveal">
          <span className={s.sealIcon} aria-hidden="true">
            <Icon name="sparkle" size={34} />
          </span>
          <h1 className={s.h1}>{t('match.both_in_title')}</h1>
          <p className={s.body}>{t('match.both_in_body')}</p>
          <p className={s.deadline} role="timer" data-testid="match-reveal-countdown" data-reveal-at={slot}>
            <Icon name="clock" size={16} />
            {tick >= slotMs ? t('match.reveal_opening') : t('match.reveal_slot', { at: clockText(tr, slot, tick) ?? '', when: untilText(tr, slot, tick) ?? '' })}
          </p>
        </Card>
        {opponent && <RivalryLine rivalry={rivalry} name={opponent.alias} />}
      </div>
    );
  return (
    <div className={s.stack} data-testid="match-phase" data-phase={view.phase}>
      <Players view={view} me={me} opponent={opponent} />
      <Conditions view={view} />
      <Card className={s.hero} padding={5} data-testid="match-awaiting-reveal">
        <span className={s.sealIcon} aria-hidden="true">
          <Icon name="sparkle" size={34} />
        </span>
        <h1 className={s.h1}>{t('match.wait_title')}</h1>
        <p className={s.body}>{t('match.wait_body')}</p>
        <p className={s.status}>
          <Icon name={oppDone ? 'check' : 'clock'} size={16} />
          {oppDone ? t('match.opp_batted', { name: opponent?.alias ?? '' }) : t('match.opp_not_batted', { name: opponent?.alias ?? '' })}
        </p>
        <p className={s.deadline}>
          <Icon name="clock" size={16} />
          {revealAt
            ? t('match.reveal_at', { when: untilText(tr, revealAt, now) ?? '', at: clockText(tr, revealAt, now) ?? '' })
            : t('match.reveal_when_done', { name: opponent?.alias ?? '', at: clockText(tr, batBy, now) ?? '' })}
        </p>
      </Card>
      {canNudge && opponent && (
        <Button variant="secondary" icon="message" onClick={() => void nudge()} data-testid="match-nudge">
          {t('match.nudge', { name: opponent.alias })}
        </Button>
      )}
      {opponent && <RivalryLine rivalry={rivalry} name={opponent.alias} />}
      <p className={s.small}>{t('match.wait_note')}</p>
    </div>
  );
}

export function ExpiredView({ view }: { view: MatchView }) {
  const { t } = useT();
  const navigate = useRouter((st) => st.navigate);
  return (
    <div className={s.stack} data-testid="match-phase" data-phase={view.phase}>
      {/* A duel expires when nobody joined, or when both joined but neither locked by the lock deadline. */}
      <StateView kind="deadline_expired" title={t('match.expired_title')} body={view.players[1] ? t('match.expired_unlocked_body') : t('match.expired_body')} actionLabel={t('match.new_duel')} onAction={() => navigate({ name: 'duel_new' })} />
      <Button variant="ghost" icon="ghost" onClick={() => navigate({ name: 'ghosts' })}>
        {t('home.ghosts.title')}
      </Button>
    </div>
  );
}
