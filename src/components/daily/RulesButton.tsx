import { PlayIcon } from '@/components/play/icons';
import s from './RulesButton.module.css';

/** Small "?" that opens the rules cheatsheet during play. Sits at the top-right of the map so it never crowds the status bar. */
export function RulesButton({ onClick, label = 'Rules' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={s.btn} onClick={onClick} aria-label={label} title={label} data-testid="rules-button">
      <PlayIcon name="question" size={20} />
    </button>
  );
}
