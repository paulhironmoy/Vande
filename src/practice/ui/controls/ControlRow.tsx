/**
 * "How do you want to bat?" as a compact row on the setup screen, shown until the device has answered (R-20: never a
 * screen of its own, so a fresh mouse or touch device stays at four steps: Home, Setup, Play, the lesson card).
 * The device's own default is already selected, so Play alone is an answer; tapping a chip answers at once. The camera
 * is the last chip and never the default: tapping it opens the camera's own consent, download and guide screens, and it
 * becomes the control only when they say it is ready. A returning player (or any script that seeds `demoSeen`) has
 * answered already and never sees it. Once shown it stays for the visit, so a mis-tap can be put right.
 */
import { useState } from 'react';
import { Icon } from '@/ui';
import { usePracticeT } from '@/i18n/practice';
import { sys } from '../design';
import { cameraBuilt, cameraInfo } from './cameraPort';
import { useCameraSetup, useControl, useControlEnv } from './hooks';
import { controlOptions, type ControlId } from './model';
import { controlIsChosen, setControl } from './state';
import s from './controls.module.css';

export function ControlRow() {
  // Decided on arrival and kept for the visit; a returning player's setup does no work for the row at all.
  const [shown] = useState(() => !controlIsChosen());
  return shown ? <ControlRowBody /> : null;
}

function ControlRowBody() {
  const t = usePracticeT();
  const env = useControlEnv();
  const control = useControl();
  const [status, setStatus] = useState('');
  const name = (id: ControlId) => t.tk(`practice.input.${id}`);

  const apply = (id: ControlId) => {
    if (setControl(id)) setStatus(t.t('practice.controls.switched', { control: name(id) }));
  };
  const camera = useCameraSetup(env, (r) => {
    if (r.kind === 'ready') apply('camera');
    else if (r.kind === 'fallback') apply(r.to);
  });

  const options = controlOptions(env, cameraBuilt());
  const cameraOption = options.find((o) => o.id === 'camera');
  const packMb = cameraInfo()?.packMb ?? null;
  const cameraNote = !cameraOption
    ? null
    : cameraOption.blocked
      ? t.tk(`practice.controls.unavailable.${cameraOption.blocked}`)
      : packMb !== null
        ? t.t('practice.controls.camera.needs', { mb: t.number(packMb, { maximumFractionDigits: 1 }) })
        : t.tk('practice.controls.camera.needs_nosize');

  return (
    <div role="group" aria-labelledby="practice-control-row-title" className={s.row} data-testid="practice-control-row">
      <p id="practice-control-row-title" className={s.rowTitle}>
        {t.t('practice.controls.title')}
      </p>
      <div className={s.chips}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={s.chip}
            aria-pressed={control === o.id}
            aria-disabled={o.available ? undefined : true}
            aria-describedby={o.id === 'camera' && cameraNote ? 'practice-control-row-note' : undefined}
            disabled={camera.active}
            onClick={() => {
              if (!o.available) return;
              if (o.id === 'camera') camera.open();
              else apply(o.id);
            }}
            data-testid={`practice-control-row-${o.id}`}
          >
            {control === o.id && <Icon name="check" size={16} />}
            {name(o.id)}
          </button>
        ))}
      </div>
      {cameraNote && (
        <p
          id="practice-control-row-note"
          className={s.rowNote}
          data-blocked={cameraOption?.blocked ? 'true' : undefined}
          data-testid="practice-control-row-note"
        >
          {cameraNote}
        </p>
      )}
      <p className={sys.caption}>
        {t.t('practice.controls.keyboard')} {t.t('practice.controls.remembered')}
      </p>
      <p className={`${sys.caption} ${s.status}`} role="status" data-testid="practice-control-row-status">
        {status}
      </p>
      {camera.element}
    </div>
  );
}
