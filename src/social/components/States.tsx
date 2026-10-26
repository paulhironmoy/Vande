import { StateView } from '@/ui';
import type { SocialFailure } from '../hooks';
import { useSocialT } from '../i18n';

/** One honest state per failure: offline (retry when back), not found, no access, signed out, no age confirmation, overloaded, error. */
export function FailureState({ failure, onRetry, notFoundTitle, notFoundBody }: { failure: SocialFailure; onRetry?: () => void; notFoundTitle?: string; notFoundBody?: string }) {
  const { t } = useSocialT();
  switch (failure) {
    case 'offline':
      return <StateView kind="offline" body={t('social.state.offline_body')} onAction={onRetry} />;
    case 'not_found':
      return <StateView kind="deadline_expired" title={notFoundTitle ?? t('social.state.not_found_title')} body={notFoundBody ?? t('social.state.not_found_body')} />;
    case 'forbidden':
      return <StateView kind="locked" title={t('social.state.forbidden_title')} body={t('social.state.forbidden_body')} />;
    case 'signed_out':
      return <StateView kind="error" title={t('social.state.signed_out_title')} body={t('social.state.signed_out_body')} onAction={onRetry} />;
    case 'age_required':
      return <StateView kind="locked" title={t('social.state.age_title')} body={t('social.state.age_body')} />;
    case 'rate_limited':
    case 'unavailable':
      return <StateView kind="reconnecting" title={t('social.state.busy_title')} body={t('social.state.busy_body')} onAction={onRetry} actionLabel={t('social.common.retry')} />;
    default:
      return <StateView kind="error" onAction={onRetry} />;
  }
}

/** Social features need the online service: offline-only builds and missing connections say so plainly. */
export function NeedsOnline({ onAction, actionLabel }: { onAction?: () => void; actionLabel?: string }) {
  const { t } = useSocialT();
  return <StateView kind="offline" title={t('social.state.needs_online_title')} body={t('social.state.needs_online_body')} onAction={onAction} actionLabel={actionLabel} />;
}
