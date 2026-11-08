/**
 * The two quiet places the choice can be changed after the first time, both only ever between balls:
 * - `ControlChip`: one line in the over's setup ("Batting: Mouse") that opens the picker when asked (contextual
 *   disclosure, constitution §6). The setup is reachable between balls and before an over, never during a delivery.
 * - `ControlSetting`: the row in Practice settings.
 */
import { usePracticeT } from '@/i18n/practice';
import { PDisclosure, sys } from '../design';
import { ControlPicker } from './ControlPicker';
import { useControl } from './hooks';
import s from './controls.module.css';

export function ControlChip({ onChanged }: { onChanged?: () => void }) {
  const t = usePracticeT();
  const control = useControl();
  const name = t.tk(`practice.input.${control}`);
  return (
    <PDisclosure
      label={
        <>
          {t.t('practice.controls.chip', { control: name })}
          {/* The visible words come first, so the accessible name still starts with them (WCAG label in name). */}
          <span className="sr-only">. {t.t('practice.controls.change')}</span>
        </>
      }
      testId="practice-control-chip"
    >
      <div className={s.pickerWrap}>
        <ControlPicker testId="practice-control-chip-group" onChanged={onChanged} />
        <div className={s.captions}>
          <p className={sys.caption}>{t.t('practice.controls.between_balls')}</p>
          <p className={sys.caption}>{t.t('practice.controls.safe')}</p>
        </div>
      </div>
    </PDisclosure>
  );
}

export function ControlSetting({ onChanged }: { onChanged?: () => void }) {
  const t = usePracticeT();
  const control = useControl();
  return (
    <>
      <h2 className={sys.section}>{t.t('practice.controls.setting.title')}</h2>
      <p className={sys.caption}>{t.t('practice.controls.setting.hint')}</p>
      {/* Why a mouse or camera player feels no vibration, said where the Vibration switch can be found. */}
      {control !== 'touch' && (
        <p className={sys.caption} data-testid="practice-settings-control-no-vibrate">
          {t.t('practice.controls.no_vibrate')}
        </p>
      )}
      <ControlPicker testId="practice-settings-control" onChanged={onChanged} />
    </>
  );
}
