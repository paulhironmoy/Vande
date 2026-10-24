import type { EvidenceState, EvidenceVerb, ScenarioEvidence } from '@/engine/types';
import { ConfidenceChip, CONFIDENCE_DESCRIPTION } from './ConfidenceChip';
import { EvidenceVisual } from './EvidenceVisual';
import { PlayButton, PlayIconButton } from './PlayButton';
import { PlayIcon, SOURCE_ICON, SOURCE_LABEL, type PlayIconName } from './icons';
import { SIMPLE_STATES, SIMPLE_VERBS } from '@/app/simple';
import { SIMPLE_TEXT } from './simpleCopy';
import styles from './EvidenceDetail.module.css';

export interface EvidenceActionInfo {
  verb: EvidenceVerb;
  label: string;
  enabled: boolean;
  hint?: string;
  compareWith?: string;
}

export interface EvidenceDetailProps {
  item: ScenarioEvidence;
  state: EvidenceState;
  actions: EvidenceActionInfo[];
  onAction: (verb: EvidenceVerb, compareWith?: string) => void;
  onBack: () => void;
  /** Disables actions (e.g. while paused or after the chapter ended). */
  disabled?: boolean;
  /** Where this evidence sits on the map, for context. */
  districtName?: string;
  /** Simple play style: plain words and bigger buttons. */
  simple?: boolean;
  /** Simple titles for compare targets, keyed by evidence id. */
  simpleTitles?: Record<string, string>;
}

const VERB_ICON: Record<EvidenceVerb, PlayIconName> = {
  inspect: 'inspect',
  compare: 'compare',
  preserve: 'bookmark',
  unresolved: 'flag',
  'clear-unresolved': 'flag',
};

function simpleActionLabel(a: EvidenceActionInfo, titles?: Record<string, string>): string {
  if (a.verb === 'compare' && a.compareWith) {
    const t = titles?.[a.compareWith];
    return t ? `Compare with: ${t}` : SIMPLE_VERBS.compare;
  }
  return SIMPLE_VERBS[a.verb];
}

export function EvidenceDetail({ item, state, actions, onAction, onBack, disabled, districtName, simple, simpleTitles }: EvidenceDetailProps) {
  const resolved = state.state === item.resolvedState && (state.inspected || state.compared || item.initialState === item.resolvedState);
  const anomalies = state.inspected ? item.metadata.filter((m) => m.anomaly).length : 0;
  const si = simple ? item.simple : undefined;

  return (
    <article className={[styles.root, simple ? styles.simple : ''].filter(Boolean).join(' ')} data-testid="evidence-detail" data-simple={simple ? 'true' : undefined} aria-labelledby={`ev-title-${item.id}`}>
      <header className={styles.header}>
        <PlayIconButton icon="back" label={simple ? SIMPLE_TEXT.backToList : 'Back to evidence list'} onClick={onBack} data-testid="evidence-back" data-autofocus />
        <div className={styles.headText}>
          <h3 id={`ev-title-${item.id}`} className={styles.title}>
            {si?.title ?? item.title}
          </h3>
          <p className={styles.sourceLine}>
            <PlayIcon name={SOURCE_ICON[item.sourceType]} size={14} />
            <span className={styles.sourceName}>{item.source}</span>
            <span aria-hidden="true">·</span>
            <span>{SOURCE_LABEL[item.sourceType]}</span>
            <span aria-hidden="true">·</span>
            <time>{item.time}</time>
            {districtName ? (
              <>
                <span aria-hidden="true">·</span>
                <span className={styles.district}>
                  <PlayIcon name="pin" size={13} />
                  {districtName}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </header>

      {simple ? (
        <p className={styles.simpleHint} data-testid="evidence-simple-hint">
          <PlayIcon name="inspect" size={15} />
          {SIMPLE_TEXT.detailHint}
        </p>
      ) : null}

      <div className={styles.status}>
        <ConfidenceChip state={state.state} simple={simple} />
        <p className={styles.statusText}>{simple ? SIMPLE_STATES[state.state].help : CONFIDENCE_DESCRIPTION[state.state]}</p>
      </div>

      {state.destroyed ? (
        <p className={styles.destroyed} role="status">
          <PlayIcon name="strike" size={16} />
          {simple ? SIMPLE_TEXT.destroyed : 'This material was destroyed before it could be preserved. What you saw of it still counts, but it cannot be used as a record.'}
        </p>
      ) : null}

      <EvidenceVisual type={item.visual.type} caption={si?.caption ?? item.visual.caption} size="large" />

      <section className={styles.section} aria-labelledby={`ev-claim-${item.id}`}>
        <h4 id={`ev-claim-${item.id}`} className={styles.h4}>
          {simple ? SIMPLE_TEXT.claimHeading : 'Claim'}
        </h4>
        <p className={styles.claim}>{si?.claim ?? item.claim}</p>
      </section>

      <div className={styles.markers}>
        {state.preserved ? (
          <span className={styles.marker} data-kind="preserved">
            <PlayIcon name="bookmark" size={13} /> {simple ? SIMPLE_TEXT.markerPreserved : 'Preserved as a record'}
          </span>
        ) : null}
        {state.markedUnresolved ? (
          <span className={styles.marker} data-kind="unresolved">
            <PlayIcon name="flag" size={13} /> {simple ? SIMPLE_TEXT.markerUnresolved : 'Marked unresolved'}
          </span>
        ) : null}
        {state.usedInDecision ? (
          <span className={styles.marker} data-kind="used">
            <PlayIcon name="used" size={13} /> {simple ? SIMPLE_TEXT.markerUsed : 'Used in a decision'}
          </span>
        ) : null}
      </div>

      <section className={styles.section} aria-labelledby={`ev-meta-${item.id}`}>
        <h4 id={`ev-meta-${item.id}`} className={styles.h4}>
          {simple ? SIMPLE_TEXT.metaHeading : 'Metadata'}
          {state.inspected && anomalies > 0 ? (
            <span className={styles.anomalyCount}>
              <PlayIcon name="warning" size={13} /> {simple ? `${anomalies} odd` : `${anomalies} inconsistent`}
            </span>
          ) : null}
        </h4>
        {state.inspected ? (
          <dl className={styles.meta}>
            {item.metadata.map((m, i) => (
              <div className={styles.metaRow} key={`${m.label}-${i}`} data-anomaly={m.anomaly ? 'true' : undefined}>
                <dt>{m.label}</dt>
                <dd>
                  <span>{m.value}</span>
                  {m.anomaly ? (
                    <span className={styles.inconsistent}>
                      <PlayIcon name="warning" size={13} /> {simple ? SIMPLE_TEXT.anomaly : 'Inconsistent'}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.hint}>{simple ? SIMPLE_TEXT.metaHint : 'Inspect the metadata to see device, location and timing details.'}</p>
        )}
      </section>

      {resolved ? (
        <section className={styles.note} data-state={state.state} aria-label={simple ? SIMPLE_TEXT.whatWeFound : 'What verification showed'}>
          <PlayIcon name={state.state === 'manipulated' ? 'bug' : state.state === 'unknown' ? 'dashCircle' : 'shieldCheck'} size={18} />
          <p>{si?.resolutionNote ?? item.resolutionNote}</p>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby={`ev-actions-${item.id}`}>
        <h4 id={`ev-actions-${item.id}`} className={styles.h4}>
          {simple ? SIMPLE_TEXT.actionsHeading : 'Verification'}
        </h4>
        {actions.length === 0 ? (
          <p className={styles.hint}>{simple ? SIMPLE_TEXT.nothingMore : 'Nothing more can be done with this item right now.'}</p>
        ) : (
          <ul className={styles.actions}>
            {actions.map((a, i) => {
              const hintId = a.hint ? `ev-hint-${item.id}-${i}` : undefined;
              return (
                <li key={`${a.verb}-${a.compareWith ?? ''}-${i}`}>
                  <PlayButton
                    block
                    variant={a.verb === 'inspect' || a.verb === 'compare' ? 'primary' : 'secondary'}
                    icon={VERB_ICON[a.verb]}
                    disabled={disabled || !a.enabled}
                    aria-describedby={hintId}
                    data-testid={`evidence-action-${a.verb}`}
                    data-compare-with={a.compareWith}
                    onClick={() => onAction(a.verb, a.compareWith)}
                    className={styles.actionBtn}
                  >
                    {simple ? simpleActionLabel(a, simpleTitles) : a.label}
                  </PlayButton>
                  {a.hint ? (
                    <p id={hintId} className={styles.hint}>
                      {a.hint}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </article>
  );
}
