/**
 * Practice's confirmation dialog, for anything final (leaving mid-over, a new innings, clearing data). Focus is
 * trapped and starts on Cancel, Escape and Android Back cancel, and it renders in the Practice palette even though it
 * is portaled to the body.
 */
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap, useStableId } from '@/ui';
import { useBackHandler } from '@/app/back';
import { PButton } from './Button';
import sys from './system.module.css';
import s from './Confirm.module.css';

export interface PConfirmProps {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

export function PConfirm({ open, title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel, testId }: PConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useStableId('pconfirm-title');
  const bodyId = useStableId('pconfirm-body');
  useBackHandler(open, onCancel);
  useFocusTrap(ref, open, onCancel, cancel);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`${sys.root} ${s.backdrop}`} onClick={onCancel}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={body ? bodyId : undefined} tabIndex={-1} className={s.dialog} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <h2 id={titleId} className={sys.section}>
          {title}
        </h2>
        {body && (
          <p id={bodyId} className={`${sys.body} ${sys.muted}`}>
            {body}
          </p>
        )}
        <div className={s.actions}>
          <PButton ref={cancel} variant="secondary" onClick={onCancel} data-testid={testId ? `${testId}-cancel` : undefined}>
            {cancelLabel}
          </PButton>
          <PButton variant={danger ? 'danger' : 'primary'} onClick={onConfirm} data-testid={testId ? `${testId}-confirm` : undefined}>
            {confirmLabel}
          </PButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
