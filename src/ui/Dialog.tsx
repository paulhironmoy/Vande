import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './Button';
import { useFocusTrap } from './focusTrap';
import { useStableId } from './hooks';
import { useT } from '@/i18n';
import { useBackHandler } from '@/app/back';
import s from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  testId?: string;
  /** Focus the cancel button first (safer for destructive dialogs). Default true. */
  focusCancel?: boolean;
}

/** Centered confirmation dialog. */
export function Dialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
  children,
  testId,
  focusCancel = true,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useT();
  // Android Back cancels the dialog before anything else.
  useBackHandler(open, onCancel);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useStableId('dialog-title');
  const descId = useStableId('dialog-desc');
  useFocusTrap(ref, open, onCancel, focusCancel ? cancelRef : undefined);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className={s.backdrop} onClick={onCancel}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={s.dialog}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className={s.title}>
          {title}
        </h2>
        {description && (
          <p id={descId} className={s.desc}>
            {description}
          </p>
        )}
        {children}
        <div className={s.actions}>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} data-testid={testId ? `${testId}-cancel` : undefined}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} data-testid={testId ? `${testId}-confirm` : undefined}>
            {confirmLabel ?? t('common.continue')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
