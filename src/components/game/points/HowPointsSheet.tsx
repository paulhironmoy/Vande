import { Button, Icon, Sheet, type IconName } from '@/components/ui';
import { pointsRules } from '@/lite/points';
import s from './HowPointsSheet.module.css';

const ICONS: Record<string, IconName> = {
  move: 'target',
  'clue-bonus': 'eye',
  streak: 'sparkle',
  clues: 'bug',
  'fair-play': 'book',
  end: 'flag-off',
  insight: 'pulse',
  'no-loss': 'shield',
  helper: 'users',
  challenger: 'message',
  dares: 'clock',
  sharing: 'share',
};

export interface HowPointsSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "How points work": one card that explains every number a player can see. The text is generated from
 * src/lite/points.ts, the same module the scoring uses, so the two can never disagree.
 */
export function HowPointsSheet({ open, onClose }: HowPointsSheetProps) {
  const rules = pointsRules();
  return (
    <Sheet open={open} onClose={onClose} title="How points work" testId="how-points-sheet">
      <ul className={s.list}>
        {rules.map((r) => (
          <li key={r.id} className={s.row} data-testid={`how-points-${r.id}`}>
            <span className={s.icon} aria-hidden="true">
              <Icon name={ICONS[r.id] ?? 'info'} size={18} strokeWidth={2.2} />
            </span>
            <span className={s.text}>
              <strong>{r.title}</strong>
              <span>{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <Button variant="primary" size="lg" block onClick={onClose} data-testid="how-points-done">
        Got it
      </Button>
    </Sheet>
  );
}
