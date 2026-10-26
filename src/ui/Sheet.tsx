import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { useFocusTrap } from './focusTrap';
import { useStableId } from './hooks';
import { useT } from '@/i18n';
import { useBackHandler } from '@/app/back';
import s from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name when no visible title. */
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Render as a right side panel on desktop (default true). */
  side?: boolean;
  /** Extra header controls (left of the close button). */
  actions?: ReactNode;
  testId?: string;
  className?: string;
  /** Allow swipe-down to dismiss on touch (default true). */
  draggable?: boolean;
}

const CLOSE_MS = 320;
const DRAG_CLOSE_PX = 110;

/**
 * Bottom sheet (mobile/tablet) or side panel (desktop). Focus-trapped, Esc/backdrop closes,
 * spring drag-to-close from the handle. Rendered in a portal.
 */
export function Sheet({ open, onClose, title, ariaLabel, children, footer, side = true, actions, testId, className, draggable = true }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useStableId('sheet-title');
  const drag = useRef<{ startY: number; dy: number; active: boolean }>({ startY: 0, dy: 0, active: false });
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const { t } = useT();
  // Android Back closes the sheet before anything else.
  useBackHandler(open, onClose);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const reduced = document.documentElement.getAttribute('data-motion') === 'reduced';
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, reduced ? 0 : CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  useFocusTrap(panelRef, mounted && !closing, onClose);

  // Lock body scroll while open.
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggable) return;
      drag.current = { startY: e.clientY, dy: 0, active: true };
      setDragging(true);
      setSettling(false);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [draggable],
  );
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || !panelRef.current) return;
    const dy = Math.max(0, e.clientY - drag.current.startY);
    drag.current.dy = dy;
    panelRef.current.style.transform = `translateY(${dy}px)`;
  }, []);
  const onPointerUp = useCallback(() => {
    if (!drag.current.active || !panelRef.current) return;
    drag.current.active = false;
    setDragging(false);
    const dy = drag.current.dy;
    if (dy > DRAG_CLOSE_PX) {
      panelRef.current.style.transform = '';
      onClose();
    } else {
      setSettling(true);
      panelRef.current.style.transform = 'translateY(0px)';
      window.setTimeout(() => {
        if (panelRef.current) panelRef.current.style.transform = '';
        setSettling(false);
      }, CLOSE_MS);
    }
  }, [onClose]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className={s.backdrop} data-closing={closing || undefined} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
        className={[s.panel, className ?? ''].join(' ')}
        data-side={side || undefined}
        data-closing={closing || undefined}
        data-dragging={dragging || undefined}
        data-settling={settling || undefined}
        data-testid={testId}
      >
        <div className={s.handleArea} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} aria-hidden="true">
          <div className={s.handle} />
        </div>
        <div className={s.header}>
          {title ? (
            <h2 id={titleId} className={s.title}>
              {title}
            </h2>
          ) : (
            <div className={s.title} />
          )}
          {actions}
          <IconButton icon="close" label={t('common.close')} onClick={onClose} />
        </div>
        <div className={s.body}>{children}</div>
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
