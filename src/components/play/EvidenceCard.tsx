import type { EvidenceState, ScenarioEvidence } from '@/engine/types';
import { ConfidenceChip } from './ConfidenceChip';
import { EvidenceVisual } from './EvidenceVisual';
import { PlayIcon, SOURCE_ICON, SOURCE_LABEL } from './icons';
import { SIMPLE_TEXT } from './simpleCopy';
import styles from './EvidenceCard.module.css';

export interface EvidenceCardProps {
  item: ScenarioEvidence;
  state: EvidenceState;
  onOpen: (id: string) => void;
  /** Arrived since the player last looked at the tray. */
  isNew?: boolean;
  /** Simple play style: plain titles, claims and state words. */
  simple?: boolean;
}

export function EvidenceCard({ item, state, onOpen, isNew, simple }: EvidenceCardProps) {
  const markers: { icon: 'bookmark' | 'flag' | 'strike' | 'used'; text: string }[] = [];
  if (state.destroyed) markers.push({ icon: 'strike', text: simple ? SIMPLE_TEXT.markerDestroyed : 'Destroyed' });
  if (state.preserved) markers.push({ icon: 'bookmark', text: simple ? SIMPLE_TEXT.markerPreserved : 'Preserved' });
  if (state.markedUnresolved) markers.push({ icon: 'flag', text: simple ? SIMPLE_TEXT.markerUnresolved : 'Unresolved' });
  if (state.usedInDecision) markers.push({ icon: 'used', text: simple ? SIMPLE_TEXT.markerUsed : 'Used in a decision' });
  const title = (simple && item.simple?.title) || item.title;
  const claim = (simple && item.simple?.claim) || item.claim;

  return (
    <li className={styles.item} data-new={isNew ? 'true' : undefined} data-destroyed={state.destroyed ? 'true' : undefined}>
      <button
        type="button"
        className={styles.card}
        data-testid={`evidence-card-${item.id}`}
        onClick={() => onOpen(item.id)}
      >
        <span className="sr-only">{`${title}. ${SOURCE_LABEL[item.sourceType]}. `}</span>
        <EvidenceVisual type={item.visual.type} caption={item.visual.caption} size="thumb" className={styles.thumb} />
        <div className={styles.body}>
          <div className={styles.top}>
            <span className={styles.source}>
              <PlayIcon name={SOURCE_ICON[item.sourceType]} size={14} />
              <span className={styles.sourceName}>{item.source}</span>
            </span>
            <time className={styles.time}>{item.time}</time>
          </div>
          <p className={styles.claim}>{claim}</p>
          <div className={styles.bottom}>
            <ConfidenceChip state={state.state} size="sm" simple={simple} />
            {markers.map((m) => (
              <span key={m.icon} className={styles.marker} data-kind={m.icon}>
                <PlayIcon name={m.icon} size={12} />
                <span>{m.text}</span>
              </span>
            ))}
            {isNew ? <span className={styles.new}>{simple ? 'New!' : 'New'}</span> : null}
          </div>
        </div>
        <PlayIcon name="chevronRight" size={18} className={styles.chevron} />
      </button>
    </li>
  );
}
