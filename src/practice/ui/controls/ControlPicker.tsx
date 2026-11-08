/**
 * The way to change how you bat once you have a way: used by the Settings row and by the quiet chip between balls.
 * Mouse and Touch apply at once. Camera first shows its own button ("Use camera"), because choosing it opens the camera
 * screens (consent, permission, one-time download); only when those say "ready" does the camera become the control.
 * Never during a delivery: the switch is refused then, and the line below says so in plain words.
 */
import { useState } from 'react';
import { usePracticeT } from '@/i18n/practice';
import { PButton, sys } from '../design';
import { ControlOptions } from './ControlOptions';
import { useCameraSetup, useControl, useControlEnv } from './hooks';
import type { ControlId } from './model';
import { canSwitchControl, setControl } from './state';
import s from './controls.module.css';

export interface ControlPickerProps {
  testId: string;
  /** After a switch took effect (the flow re-reads its settings). */
  onChanged?: () => void;
}

export function ControlPicker({ testId, onChanged }: ControlPickerProps) {
  const t = usePracticeT();
  const env = useControlEnv();
  const control = useControl();
  const [wantsCamera, setWantsCamera] = useState(false);
  const [status, setStatus] = useState('');
  const name = (id: ControlId) => t.tk(`practice.input.${id}`);

  const apply = (id: ControlId) => {
    if (!setControl(id)) {
      setStatus(t.t('practice.controls.between_balls'));
      return;
    }
    setWantsCamera(false);
    setStatus(t.t('practice.controls.switched', { control: name(id) }));
    onChanged?.();
  };
  const camera = useCameraSetup(env, (r) => {
    if (r.kind === 'ready') apply('camera');
    else if (r.kind === 'fallback') apply(r.to);
  });

  const pick = (id: ControlId) => {
    if (!canSwitchControl()) {
      setStatus(t.t('practice.controls.between_balls'));
      return;
    }
    if (id === 'camera') {
      if (control !== 'camera') setWantsCamera(true);
    } else if (id !== control || wantsCamera) {
      apply(id);
    }
  };

  return (
    <div className={s.pickerWrap}>
      <ControlOptions
        value={wantsCamera ? 'camera' : control}
        onPick={pick}
        env={env}
        label={t.t('practice.controls.title')}
        testId={testId}
      />
      {wantsCamera && control !== 'camera' && (
        <PButton
          variant="primary"
          block
          disabled={camera.active}
          onClick={camera.open}
          data-testid={`${testId}-use-camera`}
        >
          {t.t('practice.camera.setting.use')}
        </PButton>
      )}
      {control === 'camera' && (
        <p className={sys.caption} data-testid={`${testId}-privacy`}>
          {t.t('practice.camera.privacy.line')}
        </p>
      )}
      <p className={`${sys.caption} ${s.status}`} role="status" data-testid={`${testId}-status`}>
        {status}
      </p>
      {camera.element}
    </div>
  );
}
