import { useMemo, useState } from 'react';
import type { Profile, PushSettings } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import { readAnalyticsConfig } from '@/analytics';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, Dialog, Field, Icon, Sheet, Switch } from '@/ui';
import { clearPracticeData } from '@/practice/store';
import { SettingsPanel } from './SettingsPanel';
import { LicencesSheet } from './LicencesSheet';
import { LegalLink } from '../common/LegalLink';
import { AGE_KEY } from '../onboarding/age';
import { useLoad, useNet } from '../app/hooks';
import { failureKind } from '../app/errors';
import s from './SettingsRoute.module.css';

const GUIDE: Array<{ title: string; body: string[] }> = [
  { title: 'guide.sealing.title', body: ['guide.sealing.body'] },
  { title: 'guide.match.title', body: ['guide.match.body'] },
  { title: 'guide.energy.title', body: ['guide.energy.body'] },
  { title: 'guide.intent.title', body: ['guide.intent.body'] },
  { title: 'guide.timing.title', body: ['guide.timing.body'] },
  { title: 'guide.pitches.title', body: ['guide.pitch.green', 'guide.pitch.hard', 'guide.pitch.slow', 'guide.weather.body'] },
  { title: 'guide.super_ball.title', body: ['guide.super_ball.body', 'guide.super_ball.ladder'] },
];

/** Local keys this device keeps (cleared by "Delete local data" and after deleting the account, with Practice's own). */
const LOCAL_KEYS = ['vc:player', 'vc:trained', 'vc:first-delivery', 'vc:watched', 'vc:invites', 'vc:share-ledger', 'vc:push-asked', 'vc:daily-attempt', AGE_KEY];

/** Settings: language, play and accessibility, privacy, notifications, sign-in and devices, your data, about, licences. */
export default function SettingsRoute(_props: { route: RouteOf<'settings'> }) {
  const tr = useT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const toast = useApp((st) => st.toast);
  const player = useApp((st) => st.player);
  const setPlayer = useApp((st) => st.setPlayer);
  const { net, services } = useNet();
  const signedIn = Boolean(player?.id);
  const analyticsOn = useMemo(() => {
    const c = readAnalyticsConfig();
    return c.provider !== 'none' && !c.killed;
  }, []);
  const [consent, setConsent] = useState(() => services?.analytics.consent() ?? 'unset');
  const push = useLoad<PushSettings>(net && signedIn ? () => net.api.call('GET /v1/push/settings') : null, [net, signedIn]);
  const [pushBusy, setPushBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [guide, setGuide] = useState(false);
  // Sign-in and devices: signing this device out is offered plainly only to accounts that can be recovered.
  const profile = useLoad<Profile>(net && signedIn ? () => net.api.call('GET /v1/me') : null, [net, signedIn]);
  const linked = profile.data?.linked ?? null;
  const method = linked?.google && linked.passkey ? 'both' : linked?.google ? 'google' : 'passkey';
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState<number | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [licences, setLicences] = useState(false);
  const pushAvailable = services?.platform.push.available() ?? false;

  const savePush = async (next: PushSettings) => {
    if (!net) return;
    setPushBusy(true);
    try {
      if (next.enabled && !push.data?.enabled && pushAvailable) {
        const reg = await services!.platform.push.register();
        if (reg) await net.api.call('POST /v1/push/register', { body: reg });
      }
      await net.api.call('POST /v1/push/settings', { body: next });
      if (!next.enabled && push.data?.enabled) services?.analytics.track('notification_opt_out');
      push.reload();
    } catch (e) {
      toast({ kind: 'warning', text: failureKind(e) === 'offline' ? t('settings.offline_save') : t('state.error.body') });
    } finally {
      setPushBusy(false);
    }
  };

  const exportData = async () => {
    if (!net) return;
    setExporting(true);
    try {
      const r = await net.api.call('POST /v1/me/export');
      setExported({ url: r.downloadUrl, expiresAt: r.expiresAt });
    } catch (e) {
      toast({ kind: 'warning', text: failureKind(e) === 'offline' ? t('settings.offline_save') : t('state.error.body') });
    } finally {
      setExporting(false);
    }
  };

  const revokeOthers = async () => {
    if (!net) return;
    setRevoking(true);
    setRevoked(null);
    try {
      setRevoked(await net.revokeOthers());
    } catch (e) {
      toast({ kind: 'warning', text: failureKind(e) === 'offline' ? t('settings.offline_save') : t('state.error.body') });
    } finally {
      setRevoking(false);
    }
  };

  const logout = async () => {
    if (!net || loggingOut) return;
    setLoggingOut(true);
    try {
      // The server ends this session first; offline nothing is forgotten and the player stays signed in.
      await net.signOut();
    } catch (e) {
      toast({ kind: 'warning', text: failureKind(e) === 'offline' ? t('settings.offline_save') : t('state.error.body') });
      setLoggingOut(false);
      return;
    }
    clearLocal();
    setConfirmLogout(false);
    setLoggingOut(false);
    toast({ kind: 'success', text: t('settings.signed_out') });
    navigate({ name: 'onboarding' }, { replace: true });
  };

  const clearLocal = () => {
    for (const k of LOCAL_KEYS)
      try {
        localStorage.removeItem(k);
      } catch {
        /* storage unavailable */
      }
    clearPracticeData();
    setPlayer(null);
  };

  const deleteAccount = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      if (net && signedIn) {
        await net.api.call('DELETE /v1/me');
        await net.session.clear('signed_out');
      }
      clearLocal();
      setConfirmDelete(false);
      toast({ kind: 'success', text: signedIn ? t('settings.deleted') : t('settings.local_deleted') });
      navigate({ name: 'onboarding' }, { replace: true });
    } catch (e) {
      toast({ kind: 'warning', text: failureKind(e) === 'offline' ? t('settings.offline_save') : t('state.error.body') });
    } finally {
      setDeleting(false);
    }
  };

  const quiet = push.data?.quietHours ?? null;
  return (
    <main className={s.screen} data-testid="settings-screen">
      <header className={s.top}>
        <Button variant="ghost" icon="back" onClick={back} aria-label={t('common.back')}>
          {t('common.back')}
        </Button>
      </header>
      <h1 className={s.h1}>{t('settings.title')}</h1>

      <section className={s.section} aria-labelledby="set-game">
        <h2 id="set-game" className={s.h2}>
          <Icon name="settings" size={18} /> {t('settings.section_game')}
        </h2>
        <Card padding={4}>
          <SettingsPanel />
        </Card>
      </section>

      <section className={s.section} aria-labelledby="set-privacy">
        <h2 id="set-privacy" className={s.h2}>
          <Icon name="shield" size={18} /> {t('settings.section_privacy')}
        </h2>
        <Card padding={4} className={s.card}>
          {analyticsOn && services ? (
            <Field label={t('settings.analytics')} description={t('settings.analytics_body')} inline>
              <Switch
                checked={consent === 'granted'}
                label={t('settings.analytics')}
                data-testid="settings-analytics"
                onChange={(on) => {
                  services.analytics.setConsent(on ? 'granted' : 'denied');
                  setConsent(on ? 'granted' : 'denied');
                }}
              />
            </Field>
          ) : (
            <p className={s.note}>{t('settings.analytics_off')}</p>
          )}
          <p className={s.note}>{t('settings.privacy_body')}</p>
          <p className={s.note}>{t('settings.privacy_policy_body')}</p>
          <LegalLink page="privacy" className={s.download} testId="settings-privacy-policy">
            <Icon name="external" size={18} /> {t('legal.privacy_policy')}
          </LegalLink>
        </Card>
      </section>

      <section className={s.section} aria-labelledby="set-push">
        <h2 id="set-push" className={s.h2}>
          <Icon name="bell" size={18} /> {t('settings.section_push')}
        </h2>
        <Card padding={4} className={s.card}>
          {!net || !signedIn ? (
            <p className={s.note}>{t('settings.push_needs_account')}</p>
          ) : !push.data ? (
            <p className={s.note}>{push.error ? (failureKind(push.error) === 'offline' ? t('settings.offline_load') : t('state.error.body')) : t('common.loading')}</p>
          ) : (
            <>
              {!pushAvailable && <p className={s.note}>{t('settings.push_android_only')}</p>}
              <Field label={t('settings.push')} description={t('settings.push_body')} inline>
                <Switch checked={push.data.enabled} disabled={pushBusy} label={t('settings.push')} data-testid="settings-push" onChange={(enabled) => void savePush({ ...push.data!, enabled })} />
              </Field>
              <Field label={t('settings.quiet')} description={t('settings.quiet_body')} inline>
                <Switch checked={Boolean(quiet)} disabled={pushBusy} label={t('settings.quiet')} data-testid="settings-quiet" onChange={(on) => void savePush({ ...push.data!, quietHours: on ? { start: '22:00', end: '08:00' } : null })} />
              </Field>
              {quiet && (
                <div className={s.times}>
                  <label className={s.time}>
                    <span>{t('settings.quiet_start')}</span>
                    <input type="time" value={quiet.start} disabled={pushBusy} data-testid="settings-quiet-start" onChange={(e) => e.target.value && void savePush({ ...push.data!, quietHours: { ...quiet, start: e.target.value } })} />
                  </label>
                  <label className={s.time}>
                    <span>{t('settings.quiet_end')}</span>
                    <input type="time" value={quiet.end} disabled={pushBusy} data-testid="settings-quiet-end" onChange={(e) => e.target.value && void savePush({ ...push.data!, quietHours: { ...quiet, end: e.target.value } })} />
                  </label>
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      {net && signedIn && (
        <section className={s.section} aria-labelledby="set-account">
          <h2 id="set-account" className={s.h2}>
            <Icon name="lock" size={18} /> {t('settings.section_account')}
          </h2>
          <Card padding={4} className={s.card}>
            <p className={s.note}>{t('settings.revoke_others_body')}</p>
            <Button variant="secondary" icon="shield" loading={revoking} onClick={() => void revokeOthers()} data-testid="settings-revoke-others">
              {t('settings.revoke_others')}
            </Button>
            {revoked !== null && (
              <p className={s.done} role="status" data-testid="settings-revoked">
                <Icon name="check" size={16} /> {t('settings.revoked', { count: revoked })}
              </p>
            )}
            <hr className={s.rule} />
            {!linked ? (
              <p className={s.note}>{profile.error ? (failureKind(profile.error) === 'offline' ? t('settings.offline_load') : t('state.error.body')) : t('common.loading')}</p>
            ) : linked.google || linked.passkey ? (
              <>
                <p className={s.note}>{t('settings.logout_body', { method })}</p>
                <Button variant="secondary" icon="logout" onClick={() => setConfirmLogout(true)} data-testid="settings-logout">
                  {t('settings.logout')}
                </Button>
              </>
            ) : (
              <div className={s.card} data-testid="settings-logout-guest">
                <p className={s.body}>{t('settings.logout_guest')}</p>
                <p className={s.note}>{t('settings.logout_guest_next')}</p>
                <Button variant="secondary" icon="user" onClick={() => navigate({ name: 'profile' })} data-testid="settings-link-profile">
                  {t('settings.link_on_profile')}
                </Button>
              </div>
            )}
          </Card>
        </section>
      )}

      <section className={s.section} aria-labelledby="set-data">
        <h2 id="set-data" className={s.h2}>
          <Icon name="user" size={18} /> {t('settings.section_data')}
        </h2>
        <Card padding={4} className={s.card}>
          {net && signedIn && (
            <>
              <p className={s.note}>{t('settings.export_body')}</p>
              {exported ? (
                <a className={s.download} href={exported.url} target="_blank" rel="noopener noreferrer" data-testid="settings-export-link">
                  <Icon name="download" size={18} /> {t('settings.export_ready', { when: tr.relative(Date.parse(exported.expiresAt) - Date.now()) })}
                </a>
              ) : (
                <Button variant="secondary" icon="download" loading={exporting} onClick={() => void exportData()} data-testid="settings-export">
                  {t('settings.export')}
                </Button>
              )}
            </>
          )}
          <p className={s.note}>{signedIn ? t('settings.delete_body') : t('settings.delete_local_body')}</p>
          <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)} data-testid="settings-delete" disabled={!player}>
            {signedIn ? t('settings.delete') : t('settings.delete_local')}
          </Button>
          <p className={s.note}>{t('settings.delete_web_body')}</p>
          <LegalLink page="delete-account" className={s.download} testId="settings-delete-web">
            <Icon name="external" size={18} /> {t('legal.delete_web')}
          </LegalLink>
        </Card>
      </section>

      <section className={s.section} aria-labelledby="set-about">
        <h2 id="set-about" className={s.h2}>
          <Icon name="info" size={18} /> {t('settings.section_about')}
        </h2>
        <Card padding={4} className={s.card}>
          <p className={s.body}>{t('settings.independent')}</p>
          <p className={s.note}>{t('settings.fair_play')}</p>
          <dl className={s.facts}>
            <div>
              <dt>{t('settings.version')}</dt>
              <dd>
                {__APP_VERSION__} · {__BUILD_ID__}
              </dd>
            </div>
            <div>
              <dt>{t('settings.engine')}</dt>
              <dd>v1</dd>
            </div>
          </dl>
          <div className={s.row}>
            <Button variant="secondary" icon="book" onClick={() => setGuide(true)} data-testid="settings-guide">
              {t('settings.guide')}
            </Button>
            <Button variant="secondary" icon="external" onClick={() => setLicences(true)} data-testid="settings-licences">
              {t('settings.licences')}
            </Button>
          </div>
        </Card>
      </section>

      <Dialog
        open={confirmDelete}
        title={signedIn ? t('settings.delete_confirm_title') : t('settings.delete_local_confirm_title')}
        description={signedIn ? t('settings.delete_confirm_body') : t('settings.delete_local_body')}
        confirmLabel={deleting ? t('common.loading') : signedIn ? t('settings.delete') : t('settings.delete_local')}
        confirmVariant="danger"
        onConfirm={() => void deleteAccount()}
        onCancel={() => setConfirmDelete(false)}
        testId="settings-delete-dialog"
      />

      <Dialog
        open={confirmLogout}
        title={t('settings.logout_confirm_title')}
        description={t('settings.logout_confirm_body', { method })}
        confirmLabel={loggingOut ? t('common.loading') : t('settings.logout')}
        onConfirm={() => void logout()}
        onCancel={() => setConfirmLogout(false)}
        testId="settings-logout-dialog"
      />

      <Sheet open={guide} onClose={() => setGuide(false)} title={t('guide.title' as MessageKey)} testId="settings-guide-sheet">
        <div className={s.guide}>
          <p className={s.body}>{t('guide.intro' as MessageKey)}</p>
          {GUIDE.map((g) => (
            <section key={g.title}>
              <h3 className={s.h3}>{t(g.title as MessageKey)}</h3>
              {g.body.map((b) => (
                <p key={b} className={s.note}>
                  {t(b as MessageKey)}
                </p>
              ))}
            </section>
          ))}
        </div>
      </Sheet>

      <LicencesSheet open={licences} onClose={() => setLicences(false)} />
    </main>
  );
}
