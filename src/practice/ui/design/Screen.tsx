/**
 * The frame of every ordinary Practice screen: a level-one title, quiet back navigation, one scrolling column and an
 * optional footer for the screen's one primary action (always in the same place, never scrolled away).
 */
import type { ReactNode } from 'react';
import { usePracticeT } from '@/i18n/practice';
import { PIconButton } from './Button';
import sys from './system.module.css';
import s from './Screen.module.css';

export interface ScreenProps {
  title: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** One quiet control at the end of the header (settings), or nothing. */
  end?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  testId?: string;
  children: ReactNode;
  className?: string;
}

export function Screen({ title, onBack, backLabel, end, footer, wide, testId, children, className }: ScreenProps) {
  const t = usePracticeT();
  return (
    <div className={[sys.root, s.screen, wide ? s.wide : '', className ?? ''].join(' ')} data-testid={testId}>
      <header className={s.header}>
        {onBack ? (
          <PIconButton
            icon="back"
            label={backLabel ?? t.t('practice.common.back')}
            onClick={onBack}
            data-testid="practice-back"
          />
        ) : (
          <span className={s.headerSpacer} />
        )}
        <h1 className={`${sys.title} ${s.headerTitle}`}>{title}</h1>
        {end ?? <span className={s.headerSpacer} />}
      </header>
      <main className={s.content}>{children}</main>
      {footer ? (
        <footer className={s.footer}>
          <div className={s.footerInner}>{footer}</div>
        </footer>
      ) : (
        <span />
      )}
    </div>
  );
}
