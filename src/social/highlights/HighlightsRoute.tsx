import { useEffect, useId, useState } from 'react';
import type { ConsentRecord, HighlightJob, HighlightPreview, Visibility } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import { Avatar, Button, Card, Chip, Dialog, ScreenShell, SegmentedControl, StateView } from '@/ui';
import { socialFailure, useAccount, useAction, usePlayerGate, useNow, useResource, useSocialServices } from '../hooks';
import { useSocialT, type SocialT } from '../i18n';
import { FailureState, NeedsOnline } from '../components/States';
import { deadlineText, isPast } from '../components/time';
import { ExactCut } from './CutPlayer';
import { consentDeadline, statusGroup, withdrawEffect, youtubeUrl, type StatusGroup } from './highlightModel';
import s from '../components/social.module.css';

const TONE: Record<StatusGroup, 'cyan' | 'amber' | 'danger' | 'success' | 'neutral' | 'violet'> = {
  decide: 'amber',
  queued: 'cyan',
  failed: 'danger',
  live: 'success',
  declined: 'neutral',
  rejected: 'neutral',
  removing: 'amber',
  removed: 'neutral',
};

/**
 * My highlights and the consent flow: watch the exact cut, see who appears and the title, description and visibility,
 * then grant (18+ confirmation and a visibility) or decline; withdraw at any time with the consequences stated
 * plainly. The Top 100 badge stays whatever the decision.
 */
export default function HighlightsRoute({ route }: { route: RouteOf<'highlights'> }) {
  const player = usePlayerGate(route);
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const { net, booting } = useSocialServices();
  const account = useAccount(net, player);
  const ready = Boolean(net && account.state === 'ok');
  const jobs = useResource<HighlightJob[]>(ready && net ? () => net.api.call('GET /v1/highlights/mine') : null, [ready]);
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow(60_000);
  if (!player) return null;

  const shell = (children: React.ReactNode) => (
    <ScreenShell title={t('social.hl.title')} eyebrow={t('social.hl.eyebrow')} onBack={selected ? () => setSelected(null) : back} narrow testId="highlights-screen">
      {children}
    </ScreenShell>
  );

  if (booting || (net && (account.state === 'idle' || account.state === 'syncing') && !jobs.data)) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);
  if (account.state === 'offline' || account.state === 'error' || account.state === 'age_required') return shell(<FailureState failure={account.state} onRetry={account.retry} />);
  if (!jobs.data) return shell(jobs.error ? <FailureState failure={socialFailure(jobs.error)} onRetry={jobs.reload} /> : <StateView kind="loading" />);

  if (selected) return shell(<Review jobId={selected} tr={tr} now={now} onChanged={jobs.reload} />);

  if (jobs.data.length === 0)
    return shell(
      <div className={s.stack}>
        <StateView kind="empty_cup" title={t('social.hl.empty_title')} body={t('social.hl.empty_body')} actionLabel={t('social.hl.see_top100')} onAction={() => navigate({ name: 'top100' })} />
      </div>,
    );

  return shell(
    <div className={s.stack}>
      <p className={s.body}>{t('social.hl.intro')}</p>
      <ul className={s.list} data-testid="highlight-jobs">
        {jobs.data.map((j) => {
          const g = statusGroup(j.status);
          return (
            <Card as="li" key={j.jobId} padding={4} className={s.stackSm}>
              <div className={s.spread}>
                <span className={s.meta}>{tr.date(`${j.day}T12:00:00Z`, { day: 'numeric', month: 'long' })}</span>
                <Chip tone={TONE[g]}>{t(`social.hl.group_${g}` as 'social.hl.group_decide')}</Chip>
              </div>
              <h2 className={s.h3}>{j.title}</h2>
              {g === 'decide' && <p className={s.small}>{t('social.hl.decide_by', { when: deadlineText(tr, consentDeadline(j), now) })}</p>}
              <Button variant={g === 'decide' ? 'accent' : 'secondary'} iconEnd="forward" onClick={() => setSelected(j.jobId)} data-testid={`highlight-open-${j.jobId}`}>
                {g === 'decide' ? t('social.hl.review') : t('social.hl.details')}
              </Button>
            </Card>
          );
        })}
      </ul>
    </div>,
  );
}

function Review({ jobId, tr, now, onChanged }: { jobId: string; tr: SocialT; now: number; onChanged: () => void }) {
  const { t } = tr;
  const { net, services } = useSocialServices();
  const navigate = useRouter((st) => st.navigate);
  const toast = useApp((st) => st.toast);
  const preview = useResource<HighlightPreview>(net ? () => net.api.call('GET /v1/highlights/:jobId/preview', { params: { jobId } }) : null, [net, jobId]);
  const [watching, setWatching] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [adult, setAdult] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [decided, setDecided] = useState<ConsentRecord | null>(null);
  const action = useAction();
  const adultId = useId();
  useEffect(() => {
    setDecided(null);
    setWatching(false);
  }, [jobId]);

  const p = preview.data;
  if (!p) return preview.error ? <FailureState failure={socialFailure(preview.error)} onRetry={preview.reload} /> : <StateView kind="loading" />;

  const job = p.job;
  const g = statusGroup(job.status);
  const myDecision = decided?.decision ?? p.myDecision;
  const deadline = consentDeadline(job);
  const open = g === 'decide' && !isPast(deadline, now) && myDecision === null;

  const decide = async (decision: 'granted' | 'declined') => {
    if (!net) return;
    const r = await action.run(() => net.api.call('POST /v1/highlights/:jobId/consent', { params: { jobId }, body: { decision, adultConfirmed: decision === 'granted' ? adult : false, visibility } }));
    if (r.ok) {
      setDecided(r.value);
      services?.analytics.track('highlight_consent', { decision });
      toast({ kind: 'success', text: decision === 'granted' ? t('social.hl.granted_toast') : t('social.hl.declined_toast') });
      preview.reload();
      onChanged();
    } else toast({ kind: 'warning', text: r.failure === 'conflict' ? t('social.hl.closed') : r.failure === 'offline' ? t('social.state.offline_body') : t('social.hl.failed') });
  };

  const withdraw = async () => {
    if (!net) return;
    setWithdrawing(false);
    const r = await action.run(() => net.api.call('POST /v1/highlights/:jobId/withdraw', { params: { jobId }, body: {} }));
    if (r.ok) {
      setDecided(r.value);
      services?.analytics.track('highlight_consent', { decision: 'withdrawn' });
      toast({ kind: 'success', text: t('social.hl.withdrawn_toast') });
      preview.reload();
      onChanged();
    } else toast({ kind: 'warning', text: r.failure === 'offline' ? t('social.state.offline_body') : t('social.hl.failed') });
  };

  // The moderated display names the video draws (never the match-time aliases in the log).
  const players = p.input.log.players;
  const names = p.input.aliases;
  const effect = withdrawEffect(job.status);
  return (
    <div className={s.stack} data-testid="highlight-review">
      <Card padding={5} className={s.stackSm}>
        <p className={s.eyebrow}>{t('social.hl.review_eyebrow', { day: tr.date(`${job.day}T12:00:00Z`, { day: 'numeric', month: 'long' }) })}</p>
        <h2 className={s.h2}>{job.title}</h2>
        {watching ? (
          <ExactCut input={p.input} />
        ) : (
          <Button variant="accent" size="lg" block icon="play" onClick={() => setWatching(true)} data-testid="highlight-watch">
            {t('social.hl.watch_cut')}
          </Button>
        )}
        <p className={s.small}>{t('social.hl.cut_note')}</p>
      </Card>
      <StatusPanel job={job} tr={tr} myDecision={myDecision} onLanding={() => navigate({ name: 'highlight', code: job.attributionCode })} />
      <section className={s.section} aria-labelledby="hl-who">
        <h2 className={s.h3} id="hl-who">
          {t('social.hl.who')}
        </h2>
        <ul className={s.list}>
          {players.map((pl, i) => (
            <li key={`${pl.id}-${i}`} className={s.player}>
              <Avatar avatar={pl.avatar} kit={pl.kit} size={40} decorative />
              <span className={s.playerText}>
                <span className={s.alias}>{names[i] ?? pl.alias}</span>
                <span className={s.meta}>{p.input.ranks[i] !== null ? t('social.hl.rank', { rank: p.input.ranks[i] as number }) : t('social.hl.opponent')}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={s.small}>{t('social.hl.aliases_only')}</p>
      </section>
      <section className={s.section} aria-labelledby="hl-text">
        <h2 className={s.h3} id="hl-text">
          {t('social.hl.description')}
        </h2>
        <p className={s.body} style={{ whiteSpace: 'pre-line' }}>
          {job.description}
        </p>
      </section>
      {open ? (
        <section className={s.section} aria-labelledby="hl-decide">
          <h2 className={s.h3} id="hl-decide">
            {t('social.hl.decide_title')}
          </h2>
          <p className={s.body}>{t('social.hl.decide_body', { when: deadlineText(tr, deadline, now) })}</p>
          <SegmentedControl
            label={t('social.hl.visibility')}
            options={[
              { value: 'public', label: t('social.hl.public'), description: t('social.hl.public_hint') },
              { value: 'unlisted', label: t('social.hl.unlisted'), description: t('social.hl.unlisted_hint') },
            ]}
            value={visibility}
            onChange={setVisibility}
            block
            testId="highlight-visibility"
          />
          <p className={s.small}>{t('social.hl.strictest')}</p>
          <label className={s.check} htmlFor={adultId}>
            <input id={adultId} type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} data-testid="highlight-adult" />
            <span>{t('social.hl.adult')}</span>
          </label>
          <div className={s.actions}>
            <Button variant="accent" size="lg" icon="check" disabled={!adult} loading={action.busy} onClick={() => void decide('granted')} data-testid="highlight-grant">
              {t('social.hl.grant')}
            </Button>
            <Button variant="secondary" size="lg" loading={action.busy} onClick={() => void decide('declined')} data-testid="highlight-decline">
              {t('social.hl.decline')}
            </Button>
          </div>
          <p className={s.small}>{t('social.hl.badge_kept')}</p>
        </section>
      ) : null}
      {effect !== 'nothing' && myDecision !== 'withdrawn' && myDecision !== 'declined' && (
        <section className={s.section}>
          <Button variant="danger" onClick={() => setWithdrawing(true)} data-testid="highlight-withdraw">
            {t('social.hl.withdraw')}
          </Button>
          <p className={s.small}>{effect === 'remove' ? t('social.hl.withdraw_remove') : t('social.hl.withdraw_cancel')}</p>
        </section>
      )}
      <Dialog
        open={withdrawing}
        title={t('social.hl.withdraw_title')}
        description={effect === 'remove' ? t('social.hl.withdraw_remove') : t('social.hl.withdraw_cancel')}
        confirmLabel={t('social.hl.withdraw_confirm')}
        confirmVariant="danger"
        cancelLabel={t('social.common.cancel')}
        onConfirm={() => void withdraw()}
        onCancel={() => setWithdrawing(false)}
        testId="highlight-withdraw-dialog"
        focusCancel
      />
    </div>
  );
}

function StatusPanel({ job, tr, myDecision, onLanding }: { job: HighlightJob; tr: SocialT; myDecision: ConsentRecord['decision'] | null; onLanding: () => void }) {
  const { t } = tr;
  const g = statusGroup(job.status);
  if (g === 'decide')
    return myDecision ? (
      <StateView kind="pending_opponent" compact title={t('social.hl.waiting_title')} body={myDecision === 'granted' ? t('social.hl.waiting_granted') : t('social.hl.waiting_declined')} />
    ) : null;
  if (g === 'queued') {
    const step = job.status === 'queued_render' || job.status === 'rendering' ? 'social.hl.queued_rendering' : job.status === 'pending_moderation' ? 'social.hl.queued_review' : job.status === 'awaiting_channel' ? 'social.hl.queued_channel' : 'social.hl.queued_upload';
    return <StateView kind="upload_queued" compact title={t('social.hl.queued_title')} body={t(step)} />;
  }
  if (g === 'failed') return <StateView kind="upload_failed" compact title={t('social.hl.failed_title')} body={t('social.hl.failed_body')} />;
  if (g === 'declined') return <StateView kind="consent_declined" compact title={t('social.hl.declined_title')} body={t('social.hl.declined_body')} />;
  if (g === 'rejected') return <StateView kind="consent_declined" compact title={t('social.hl.rejected_title')} body={t('social.hl.rejected_body')} />;
  if (g === 'removing') return <StateView kind="upload_queued" compact title={t('social.hl.removing_title')} body={t('social.hl.removing_body')} />;
  if (g === 'removed') return <StateView kind="consent_declined" compact title={t('social.hl.removed_title')} body={t('social.hl.removed_body')} />;
  return (
    <Card padding={4} className={s.stackSm} data-testid="highlight-live">
      <h2 className={s.h3}>{job.status === 'unlisted' || job.visibility === 'unlisted' ? t('social.hl.live_unlisted') : t('social.hl.live_public')}</h2>
      <div className={s.actions}>
        <Button variant="primary" icon="share" onClick={onLanding}>
          {t('social.hl.open_landing')}
        </Button>
        {job.youtubeVideoId && !job.youtubeVideoId.startsWith('mock-') && (
          <a className={s.linkButton} href={youtubeUrl(job.youtubeVideoId)} target="_blank" rel="noopener noreferrer">
            {t('social.landing.youtube')}
          </a>
        )}
      </div>
    </Card>
  );
}
