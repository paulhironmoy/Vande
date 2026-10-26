import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import type { LocalPlayer } from '@/app/storeTypes';
import { useT } from '@/i18n';
import { OnboardingScreen, type OnboardingResult } from './OnboardingScreen';
import { AgeGate, AgeStop } from './AgeGate';
import { ageAnswer, type AgeAnswer } from './age';
import { RecoverAccount } from './RecoverAccount';
import { recoverAccount, recoveryMethods, type RecoveryFailure, type RecoveryMethod } from './recover';
import { syncAccount, takeAfterStart, useNet } from '../app/hooks';

const SIGNUP_WAIT_MS = 5000;

/**
 * First run: the neutral age question (18 and over; recovering an existing account skips it), then alias, generated
 * avatar, kit and language, and straight into Training (or back to the invite or match link that brought the player
 * here). Online, the guest account is created on the spot so the alias can be checked;
 * offline (or slow), the player continues locally and the account is created automatically later. A player who
 * linked Google or a passkey can recover their account here instead (offered only when this build has one).
 */
export default function StartRoute(_props: { route: RouteOf<'onboarding'> }) {
  const { t } = useT();
  const player = useApp((s) => s.player);
  const setPlayer = useApp((s) => s.setPlayer);
  const online = useApp((s) => s.online);
  const navigate = useRouter((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const { net, services } = useNet();
  const methods = useMemo(() => (net ? recoveryMethods(services?.platform) : []), [net, services]);
  const [busy, setBusy] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [age, setAge] = useState<AgeAnswer | null>(() => ageAnswer());
  const finishing = useRef(false);

  useEffect(() => {
    if (player && !finishing.current) navigate(takeAfterStart() ?? { name: 'home' }, { replace: true });
    // Only on arrival: an existing player has nothing to do here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onComplete = async (r: OnboardingResult) => {
    setAliasError(null);
    const local: LocalPlayer = { id: null, alias: r.alias, avatar: r.avatar, kit: r.kit };
    finishing.current = true;
    if (net && online) {
      setBusy(true);
      const res = await Promise.race([syncAccount(net, local, r.locale), new Promise<{ error: 'offline' }>((resolve) => setTimeout(() => resolve({ error: 'offline' }), SIGNUP_WAIT_MS))]);
      setBusy(false);
      if ('error' in res && res.error === 'alias_rejected') {
        finishing.current = false;
        setAliasError(t('onboarding.alias_taken'));
        return;
      }
      setPlayer('id' in res ? { ...local, id: res.id } : local);
    } else {
      setPlayer(local);
    }
    navigate(takeAfterStart() ?? { name: 'training' }, { replace: true });
  };

  const recover = async (method: RecoveryMethod): Promise<RecoveryFailure | null> => {
    if (!net || !services) return 'failed';
    if (!useApp.getState().online) return 'offline';
    const r = await recoverAccount(net, services.platform.identity[method]);
    if (!r.ok) return r.reason;
    finishing.current = true;
    setPlayer(r.player);
    toast({ kind: 'success', text: t('onboarding.recover_done', { alias: r.player.alias }) });
    navigate(takeAfterStart() ?? { name: 'home' }, { replace: true });
    return null;
  };

  const recovery = methods.length > 0 ? <RecoverAccount methods={methods} recover={recover} /> : null;
  if (!player && age === 'under') return <AgeStop />;
  if (!player && age === null) return <AgeGate onAnswer={setAge} footerExtra={recovery} />;
  return (
    <OnboardingScreen
      onComplete={(r) => void onComplete(r)}
      busy={busy}
      aliasError={aliasError}
      initialAlias={player?.alias}
      initialSeed={player?.avatar.seed}
      footerExtra={recovery}
    />
  );
}
