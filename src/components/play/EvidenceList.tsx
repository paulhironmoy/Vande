import type { EvidenceState, ScenarioEvidence } from '@/engine/types';
import { EvidenceCard } from './EvidenceCard';
import { PlayIcon } from './icons';
import styles from './EvidenceList.module.css';

export interface EvidenceEntry {
  item: ScenarioEvidence;
  state: EvidenceState;
}

export function sortEvidence(entries: EvidenceEntry[]): EvidenceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.state.markedUnresolved !== b.state.markedUnresolved) return a.state.markedUnresolved ? -1 : 1;
    return b.state.arrivedAt - a.state.arrivedAt;
  });
}

export function EvidenceList({ entries, newIds, onOpen }: { entries: EvidenceEntry[]; newIds?: Set<string>; onOpen: (id: string) => void }) {
  const sorted = sortEvidence(entries);
  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <PlayIcon name="evidence" size={28} />
        <p>No evidence yet. Reports, records and recordings arrive here as the situation develops.</p>
      </div>
    );
  }
  const open = sorted.filter((e) => !e.state.destroyed && (e.state.state === 'unverified' || e.state.state === 'unknown') && !e.state.inspected && !e.state.compared).length;
  return (
    <div className={styles.root}>
      <p className={styles.summary}>
        {sorted.length} item{sorted.length === 1 ? '' : 's'}
        {open > 0 ? ` · ${open} not yet examined` : ' · all examined'}
      </p>
      <ul className={styles.list}>
        {sorted.map((e) => (
          <EvidenceCard key={e.item.id} item={e.item} state={e.state} onOpen={onOpen} isNew={newIds?.has(e.item.id)} />
        ))}
      </ul>
    </div>
  );
}
