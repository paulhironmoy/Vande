import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { useT } from '@/i18n';
import s from './ScreenShell.module.css';

export interface ScreenShellProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Constrain content to a reading width (44rem). */
  narrow?: boolean;
  testId?: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
  /** Heading level for the title (default h1). */
  headingLevel?: 1 | 2;
}

/** Standard page wrapper: safe-area aware sticky header with back button, scrollable content, sticky footer. */
export function ScreenShell({ title, eyebrow, onBack, backLabel, actions, footer, narrow, testId, className, contentClassName, children, headingLevel = 1 }: ScreenShellProps) {
  const { t } = useT();
  const hasHeader = Boolean(title || onBack || actions);
  const Heading = (headingLevel === 1 ? 'h1' : 'h2') as 'h1';
  return (
    <div className={[s.shell, narrow ? s.narrow : '', hasHeader ? '' : s.noHeader, className ?? ''].join(' ')} data-testid={testId}>
      {hasHeader && (
        <header className={s.header}>
          <div className={s.headerInner}>
            {onBack && <IconButton icon="back" label={backLabel ?? t('common.back')} onClick={onBack} />}
            {title ? (
              <Heading className={s.title}>
                {eyebrow && <span className={s.eyebrow}>{eyebrow}</span>}
                {title}
              </Heading>
            ) : (
              <div className={s.title} />
            )}
            {actions}
          </div>
        </header>
      )}
      <main className={[s.content, contentClassName ?? ''].join(' ')}>{children}</main>
      {footer && (
        <footer className={s.footer}>
          <div className={s.footerInner}>{footer}</div>
        </footer>
      )}
    </div>
  );
}
