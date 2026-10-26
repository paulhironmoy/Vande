import { useEffect } from 'react';
import { useApp } from '@/app/store';
import type { Toast } from '@/app/storeTypes';
import { Button, IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { useT } from '@/i18n';
import s from './Toast.module.css';

const ICONS: Record<Toast['kind'], IconName> = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' };

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useApp((st) => st.dismissToast);
  const { t } = useT();
  useEffect(() => {
    if (!toast.duration) return;
    const t = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.duration, dismiss]);
  return (
    <div className={s.toast} data-kind={toast.kind} data-testid="toast" role={toast.kind === 'danger' ? 'alert' : 'status'}>
      <span className={s.icon}>
        <Icon name={ICONS[toast.kind]} size={18} />
      </span>
      <span className={s.text}>{toast.text}</span>
      {toast.actionLabel && toast.onAction && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            toast.onAction?.();
            dismiss(toast.id);
          }}
        >
          {toast.actionLabel}
        </Button>
      )}
      <IconButton icon="close" label={t('common.close')} onClick={() => dismiss(toast.id)} />
    </div>
  );
}

/** Renders queued toasts; polite live region. */
export function ToastHost() {
  const toasts = useApp((st) => st.toasts);
  return (
    <div className={s.host} aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
