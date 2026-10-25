import type { CSSProperties } from 'react';
import { Icon } from '@/components/ui';
import { Pictogram } from '@/components/game/pictograms/Pictogram';
import { ACTION_LOGIC, ACTION_META, type ActionKind } from './actionKind';
import type { VisualPlanEntry } from '@/lite/contracts';
import s from './ActionCard.module.css';

export interface ActionCardProps {
  kind: ActionKind;
  title: string;
  /** Optional small chip, e.g. "×2 clue checked" (bonus) or "Clue not checked" (caution). */
  badge?: { text: string; tone: 'bonus' | 'caution' };
  onSelect: () => void;
  /** This card was picked: it lifts and glows while the others fade back. */
  picked?: boolean;
  /** Another card was picked. */
  faded?: boolean;
  /** Visual feedback after resolution. */
  verdict?: 'right' | 'wrong';
  layout?: 'tile' | 'wide';
  /** Entrance stagger position. */
  index?: number;
  hideLabel?: boolean;
  /** Show what the move does and what it costs (default true for game moves). */
  showLogic?: boolean;
  /** Explanation shown under the title after the answer is revealed. */
  note?: string;
  disabled?: boolean;
  testId: string;
  /**
   * Picture mode: a composed pictogram plus a 2–4 word label shown in place of `title`. Pass it only when the whole
   * question passed the gate (`visualPlanFor`); never for a single answer.
   */
  visual?: VisualPlanEntry;
}

/**
 * A playable action: app-icon badge, type, title. Feels like a card in a hand, not a quiz option.
 *
 * Picture mode (`visual`): the picture on top, then the 2–4 word label in place of the title, then the kind badge
 * and the Gain/Cost lines. The picture is decorative (aria-hidden), so the accessible name stays the visible text.
 */
export function ActionCard({ kind, title, badge, onSelect, picked, faded, verdict, layout = 'tile', index = 0, hideLabel, showLogic = true, note, disabled, testId, visual }: ActionCardProps) {
  const meta = ACTION_META[kind];
  const logic = kind !== 'rule' && showLogic ? ACTION_LOGIC[kind] : undefined;
  const style = { '--kind': meta.color, '--kind-deep': meta.deep, '--i': index } as CSSProperties;
  const icon = verdict === 'right' ? 'check' : verdict === 'wrong' ? 'close' : meta.icon;
  const details = (
    <>
      {logic ? (
        <span className={s.logic}>
          <span className={s.gainLine}>
            <b>Gain</b> {logic.gain}
          </span>
          <span className={s.costLine}>
            <b>Cost</b> {logic.cost}
          </span>
        </span>
      ) : null}
      {note ? <span className={s.note}>{note}</span> : null}
      {badge ? (
        <span className={s.chip} data-tone={badge.tone}>
          {badge.text}
        </span>
      ) : null}
    </>
  );
  return (
    <button
      type="button"
      className={[s.card, layout === 'wide' ? s.wide : '', visual ? s.pictured : '', picked ? s.picked : '', faded ? s.faded : ''].filter(Boolean).join(' ')}
      style={style}
      onClick={onSelect}
      disabled={disabled}
      data-verdict={verdict}
      data-visual={visual ? 'true' : undefined}
      data-testid={testId}
    >
      <span className={s.sheen} aria-hidden="true" />
      {visual ? (
        <>
          <span className={s.picture}>
            <Pictogram visual={visual.visual} />
          </span>
          <span className={s.body}>
            <span className={s.label}>{visual.label}</span>
            <span className={s.kindRow}>
              <span className={s.kindBadge} aria-hidden="true">
                <Icon name={icon} size={15} strokeWidth={2.4} />
              </span>
              {hideLabel ? null : <span className={s.kind}>{meta.label}</span>}
            </span>
            {details}
          </span>
        </>
      ) : (
        <>
          <span className={s.badge} aria-hidden="true">
            <Icon name={icon} size={22} strokeWidth={2.2} />
          </span>
          <span className={s.body}>
            {hideLabel ? null : <span className={s.kind}>{meta.label}</span>}
            <span className={s.title}>{title}</span>
            {details}
          </span>
        </>
      )}
    </button>
  );
}
