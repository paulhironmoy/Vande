import type { MapDistrictView } from '@/engine/types';
import { DISTRICT_ICON, PlayIcon } from './icons';
import { PlayButton, PlayIconButton } from './PlayButton';
import { crowdWord, moodWord, servicesWord, trustWord } from './format';
import styles from './DistrictCard.module.css';

export interface DistrictCardProps {
  district: MapDistrictView;
  onClose: () => void;
  onShowDecision?: () => void;
  onShowEvidence?: () => void;
  className?: string;
}

const INCIDENT_TEXT: Record<NonNullable<MapDistrictView['incident']>, string> = {
  vandalism: 'Vandalism reported',
  clash: 'Clash under way',
  fire: 'Fire reported',
  outage: 'Service outage',
  intimidation: 'Intimidation reported',
};

export function DistrictCard({ district, onClose, onShowDecision, onShowEvidence, className }: DistrictCardProps) {
  return (
    <section className={[styles.card, className ?? ''].filter(Boolean).join(' ')} aria-labelledby={`district-${district.id}`} data-testid="district-card">
      <header className={styles.header}>
        <span className={styles.kind} aria-hidden="true">
          <PlayIcon name={DISTRICT_ICON[district.kind]} size={16} />
        </span>
        <div className={styles.titles}>
          <h3 id={`district-${district.id}`} className={styles.name}>
            {district.name}
          </h3>
          {district.institution ? <p className={styles.institution}>{district.institution}</p> : null}
        </div>
        <PlayIconButton icon="close" label="Close district details" onClick={onClose} />
      </header>
      {district.incident ? (
        <p className={styles.incident}>
          <PlayIcon name="warning" size={14} />
          {INCIDENT_TEXT[district.incident]}
        </p>
      ) : null}
      <dl className={styles.facts}>
        <div>
          <dt>
            <PlayIcon name="crowd" size={14} /> Crowd
          </dt>
          <dd>{crowdWord(district.crowd)}</dd>
        </div>
        <div>
          <dt>
            <PlayIcon name="mood" size={14} /> Mood
          </dt>
          <dd data-mood={district.mood}>{moodWord(district.mood)}</dd>
        </div>
        <div>
          <dt>
            <PlayIcon name="services" size={14} /> Services
          </dt>
          <dd>{servicesWord(district.services)}</dd>
        </div>
        <div>
          <dt>
            <PlayIcon name="trust" size={14} /> Trust
          </dt>
          <dd>{trustWord(district.trust)}</dd>
        </div>
      </dl>
      {district.institutionActive ? (
        <p className={styles.note}>
          <PlayIcon name="institution" size={14} /> Institution responding
        </p>
      ) : null}
      {district.pendingDecisions > 0 || district.openEvidence > 0 ? (
        <div className={styles.actions}>
          {district.pendingDecisions > 0 && onShowDecision ? (
            <PlayButton variant="primary" icon="check" onClick={onShowDecision}>
              Show decision{district.pendingDecisions > 1 ? 's' : ''}
            </PlayButton>
          ) : null}
          {district.openEvidence > 0 && onShowEvidence ? (
            <PlayButton variant="secondary" icon="evidence" onClick={onShowEvidence}>
              Show evidence
            </PlayButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
