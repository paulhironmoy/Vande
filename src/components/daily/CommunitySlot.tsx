import type { ReactNode } from 'react';
import layout from '@/components/results/layout.module.css';
import { useSimple } from '@/app/simple';
import { useApp } from '@/app/store';
import { CommunityComparison, isCommunityActive } from '@/community';
import { Button } from '@/components/ui';

/**
 * Community comparison slot. Shows real aggregate results only when the community API is configured in this build
 * AND the player has opted in to sharing (give-to-get). Never shows fabricated numbers; when the feature is off it
 * says so plainly or stays quiet.
 */
export function CommunitySlot({ dailyId, mine, contentVersion, render }: { dailyId: string; mine?: number; contentVersion?: string; render?: (dailyId: string, mine?: number) => ReactNode }) {
  const simple = useSimple();
  const sharing = useApp((s) => s.settings.communitySharing);
  const setCommunitySharing = useApp((s) => s.setCommunitySharing);
  if (render) return <>{render(dailyId, mine)}</>;
  const active = isCommunityActive();
  const title = simple ? 'Everyone today' : 'Community results';
  if (!active) {
    return (
      <section className={`${layout.card} ${layout.cardTight}`} aria-label={title} data-testid="community-slot" data-state="disabled">
        <h2 className={layout.sectionTitle}>{title}</h2>
        <p className={layout.muted} data-testid="community-empty">
          {simple ? 'Community results are off in this version.' : 'Community results are not enabled in this build.'}
        </p>
      </section>
    );
  }
  if (sharing !== 'on') {
    return (
      <section className={`${layout.card} ${layout.cardTight}`} aria-label={title} data-testid="community-slot" data-state="opt-in">
        <h2 className={layout.sectionTitle}>{title}</h2>
        <p className={layout.muted}>{simple ? 'Share your result to see how everyone did. Nothing personal is sent.' : 'Share your anonymous result to see how everyone did today.'}</p>
        <Button variant="secondary" size="sm" onClick={() => setCommunitySharing('on')} data-testid="community-opt-in">
          {simple ? 'Share and see' : 'Share anonymously and compare'}
        </Button>
      </section>
    );
  }
  return (
    <section className={`${layout.card} ${layout.cardTight}`} aria-label={title} data-testid="community-slot" data-state="active">
      <h2 className={layout.sectionTitle}>{title}</h2>
      <CommunityComparison dailyId={dailyId} mine={mine} contentVersion={contentVersion} />
    </section>
  );
}
