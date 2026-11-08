/**
 * The frame of every ordinary Practice screen: a level-one title, quiet back navigation, one scrolling column and an
 * optional footer for the screen's one primary action (always in the same place, never scrolled away).
 */
import type { ReactNode } from 'react';
import { usePracticeT } from '@/i18n/practice';
import { PIconButton } from './Button';
import sys from './system.module.css';
import s from './Screen.module.css';
import { useLargeShort } from './useLargeShort';

export interface ScreenProps {
  title: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** One quiet control at the end of the header (settings), or nothing. */
  end?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** No back control and no empty slot where it would be: the title starts where the words under it start (result screens). */
  flush?: boolean;
  testId?: string;
  children: ReactNode;
  className?: string;
}

export function Screen({
  title,
  onBack,
  backLabel,
  end,
  footer,
  wide,
  flush,
  testId,
  children,
  className,
}: ScreenProps) {
  const t = usePracticeT();
  // Large text on a short screen (design/useLargeShort.ts): the title bar scrolls with the page, the bottom bar slims.
  const largeShort = useLargeShort();
  return (
    <div
      className={[sys.root, s.screen, wide ? s.wide : '', className ?? ''].join(' ')}
      data-testid={testId}
      data-large-short={largeShort ? 'true' : 'false'}
    >
      <header className={s.header}>
        {onBack ? (
          <PIconButton
            icon="back"
            label={backLabel ?? t.t('practice.common.back')}
            onClick={onBack}
            data-testid="practice-back"
          />
        ) : (
          !flush && <span className={s.headerSpacer} />
        )}
        <h1 className={`${sys.title} ${s.headerTitle}`}>{title}</h1>
        {end ?? (!flush && <span className={s.headerSpacer} />)}
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
