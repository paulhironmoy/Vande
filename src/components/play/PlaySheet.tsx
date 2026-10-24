import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PlayIconButton } from './PlayButton';
import styles from './PlaySheet.module.css';

export interface PlaySheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
  /** Visually hide the title (it stays available to assistive technology). */
  hideTitle?: boolean;
  /** Extra header content (e.g. a back button) placed before the title. */
  leading?: ReactNode;
  /** Tall sheets take up to 92% of the viewport height on phones. */
  tall?: boolean;
  closeLabel?: string;
  /** When false the sheet cannot be dismissed by scrim/Escape (e.g. pause). */
  dismissible?: boolean;
  className?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function PlaySheet({ open, onClose, title, children, testId, hideTitle, leading, tall, closeLabel = 'Close', dismissible = true, className }: PlaySheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel;
    window.setTimeout(() => first?.focus({ preventScroll: true }), 0);
    return () => {
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab' && panelRef.current) {
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === panelRef.current)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  };

  return createPortal(
    <div className={styles.root} onKeyDown={onKeyDown}>
      <div className={styles.scrim} onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      <div
        ref={panelRef}
        className={[styles.panel, tall ? styles.tall : '', className ?? ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
      >
        <div className={styles.handle} aria-hidden="true" />
        <header className={styles.header}>
          {leading}
          <h2 id={titleId} className={hideTitle ? styles.srOnly : styles.title}>
            {title}
          </h2>
          {dismissible ? <PlayIconButton icon="close" label={closeLabel} onClick={onClose} className={styles.close} /> : null}
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
