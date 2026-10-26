import type { ReactNode } from 'react';
import { legalUrl, type LegalPage } from './legal';

/** A link to the privacy policy or the account-deletion page (new tab on the web, the system browser on Android). */
export function LegalLink({ page, className, children, testId }: { page: LegalPage; className?: string; children: ReactNode; testId?: string }) {
  return (
    <a className={className} href={legalUrl(page)} target="_blank" rel="noopener noreferrer" data-testid={testId}>
      {children}
    </a>
  );
}
