import { useMemo, useState } from 'react';
import type { HistoryEntry, RepublicOutcome } from '@/engine/types';
import { OUTCOME_LABELS } from '@/engine/types';
import { describeCondition } from '@/engine';
import { Button, Dialog, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { Checklist, type ChecklistItem } from '@/components/results/Checklist';
import { downloadText, formatDateShort, localDateKey, pluralize } from '@/components/results/format';
import { LivingCity } from '@/components/republic/LivingCity';
import styles from './RepublicScreen.module.css';

const TRACKED: { key: 'freedom' | 'safety' | 'trust' | 'economy' | 'legitimacy'; label: string }[] = [
  { key: 'freedom', label: 'Freedom' },
  { key: 'safety', label: 'Safety' },
  { key: 'trust', label: 'Trust' },
  { key: 'economy', label: 'Economy' },
  { key: 'legitimacy', label: 'Legitimacy' },
];

function trendItems(history: HistoryEntry[]): ChecklistItem[] {
  const runs = history
    .filter((h) => h.campaign)
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1))
    .slice(-5)
    .map((h) => h.campaign!);
  if (runs.length < 2) return [];
  const first = runs[0].finalScores;
  const last = runs[runs.length - 1].finalScores;
  const value = (s: typeof first, key: (typeof TRACKED)[number]['key']) => (key === 'legitimacy' ? (s.grievance + s.evidence) / 2 : s[key]);
  return TRACKED.map((t) => {
    const delta = Math.round(value(last, t.key) - value(first, t.key));
    const kind = delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat';
    const text =
      kind === 'flat'
        ? `${t.label} has held steady across your last ${pluralize(runs.length, 'campaign', 'campaigns')}.`
        : `${t.label} ${kind === 'up' ? 'rose' : 'fell'} ${Math.abs(delta)} points across your last ${pluralize(runs.length, 'campaign', 'campaigns')}.`;
    return { id: t.key, kind, text } satisfies ChecklistItem;
  });
}

export function RepublicScreen() {
  const republic = useApp((s) => s.republic);
  const history = useApp((s) => s.history);
  const bests = useApp((s) => s.bests);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const resetRepublic = useApp((s) => s.resetRepublic);
  const exportData = useApp((s) => s.exportData);
  const deleteAllData = useApp((s) => s.deleteAllData);
  const toast = useApp((s) => s.toast);
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  const condition = useMemo(() => describeCondition(republic), [republic]);
  const trends = useMemo(() => trendItems(history), [history]);
  const outcomes = useMemo(() => {
    const counts = new Map<RepublicOutcome, number>();
    for (const h of history) if (h.outcome) counts.set(h.outcome, (counts.get(h.outcome) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [history]);

  const onExport = async () => {
    setBusy(true);
    try {
      const json = await exportData();
      downloadText(json, `vande-progress-${localDateKey()}.json`);
      toast({ text: 'Your progress file was downloaded.', kind: 'success', duration: 2800 });
    } catch {
      toast({ text: 'Export failed. Try again.', kind: 'warning', duration: 2800 });
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    const which = confirm;
    setConfirm(null);
    if (!which) return;
    setBusy(true);
    try {
      if (which === 'reset') {
        await resetRepublic();
        toast({ text: 'Your Republic starts again from a clean slate.', kind: 'success', duration: 2800 });
      } else {
        await deleteAllData();
        toast({ text: 'All local progress was deleted.', kind: 'success', duration: 2800 });
        navigate({ name: 'home' }, { replace: true });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title="Your Republic" onBack={() => back()} testId="republic-screen">
      <div className={layout.page}>
        <header className={layout.stack}>
          <p className={layout.kicker}>Persistent Republic</p>
          <h1 className={layout.h1}>The city you are building, crisis by crisis</h1>
          <p className={layout.lead}>Every campaign and daily crisis leaves a lasting mark on five measures. Stored only on this device.</p>
        </header>

        <LivingCity condition={republic} label={condition.label} summary={condition.summary} animated={!reducedMotion} />

        <div className={styles.stats} aria-label="Totals">
          <div className={styles.stat}>
            <span className={styles.statValue}>{republic.campaigns}</span>
            <span className={styles.statLabel}>{republic.campaigns === 1 ? 'Campaign completed' : 'Campaigns completed'}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{republic.crises}</span>
            <span className={styles.statLabel}>{republic.crises === 1 ? 'Crisis handled' : 'Crises handled'}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{bests.campaign ? Math.round(bests.campaign.score) : '—'}</span>
            <span className={styles.statLabel}>{bests.campaign ? `Personal best · ${OUTCOME_LABELS[bests.campaign.outcome]}` : 'No campaign finished yet'}</span>
          </div>
        </div>

        <div className={layout.grid2}>
          <section className={layout.card} aria-labelledby="rep-trends">
            <h2 className={layout.sectionTitle} id="rep-trends">
              Long-term consequences
            </h2>
            <Checklist items={trends} emptyText="Finish two campaigns and the long-term trends of your Republic will appear here." />
          </section>
          <section className={layout.card} aria-labelledby="rep-outcomes">
            <h2 className={layout.sectionTitle} id="rep-outcomes">
              Outcomes reached
            </h2>
            {outcomes.length > 0 ? (
              <div className={layout.chips}>
                {outcomes.map(([o, n]) => (
                  <span key={o} className={`${layout.chip} ${o === 'resilient' ? layout.chipGood : ''}`}>
                    {OUTCOME_LABELS[o]} × {n}
                  </span>
                ))}
              </div>
            ) : (
              <p className={layout.body}>No outcomes yet. Your first result will appear here.</p>
            )}
            {republic.updatedAt && <p className={layout.muted} style={{ marginTop: 'var(--s-3)' }}>Last updated {formatDateShort(republic.updatedAt)}.</p>}
          </section>
        </div>

        <section className={layout.card} aria-labelledby="rep-review">
          <div className={`${layout.row} ${layout.spread}`}>
            <div>
              <h2 className={layout.sectionTitle} id="rep-review" style={{ marginBottom: '0.2rem' }}>
                Earlier crises
              </h2>
              <p className={layout.body}>{history.length > 0 ? `${pluralize(history.length, 'entry', 'entries')} in your local history.` : 'Nothing recorded yet.'}</p>
            </div>
            <Button variant="secondary" onClick={() => navigate({ name: 'history' })} data-testid="republic-history">
              Review earlier crises
            </Button>
          </div>
        </section>

        <section className={layout.card} aria-labelledby="rep-manage">
          <h2 className={layout.sectionTitle} id="rep-manage">
            Your data
          </h2>
          <div className={styles.manage}>
            <div className={styles.manageRow}>
              <div className={styles.manageText}>
                <strong>Export local progress</strong>
                <span>Download everything stored on this device as a JSON file.</span>
              </div>
              <Button variant="secondary" onClick={onExport} disabled={busy} data-testid="republic-export">
                Export
              </Button>
            </div>
            <div className={styles.manageRow}>
              <div className={styles.manageText}>
                <strong>Reset the Republic</strong>
                <span>Start the living city again. Your history and settings stay.</span>
              </div>
              <Button variant="secondary" onClick={() => setConfirm('reset')} disabled={busy} data-testid="republic-reset">
                Reset
              </Button>
            </div>
            <div className={styles.manageRow}>
              <div className={styles.manageText}>
                <strong>Delete all local progress</strong>
                <span>Removes the Republic, history, bests and saved games from this device. Cannot be undone.</span>
              </div>
              <Button variant="danger" onClick={() => setConfirm('delete')} disabled={busy} data-testid="republic-delete">
                Delete
              </Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={confirm === 'reset'}
        title="Reset your Republic?"
        onCancel={() => setConfirm(null)}
        onConfirm={onConfirm}
        confirmLabel="Reset Republic"
      >
        <p className={layout.body}>The living city returns to its starting condition. Your history, bests and settings are kept.</p>
      </Dialog>
      <Dialog
        open={confirm === 'delete'}
        title="Delete all local progress?"
        onCancel={() => setConfirm(null)}
        onConfirm={onConfirm}
        confirmLabel="Delete everything"
        confirmVariant="danger"
      >
        <p className={layout.body}>This removes your Republic, history, personal bests and any saved game from this device. It cannot be undone. Export first if you want a copy.</p>
      </Dialog>
    </ScreenShell>
  );
}
