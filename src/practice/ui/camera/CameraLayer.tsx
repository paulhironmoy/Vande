/**
 * The camera on the play screen (mounted only while the camera is the control; its own lazy chunk). It draws, never
 * during a live ball: the card before a ball while the flow waits for the player to be in view, a quiet status chip, and
 * the tracking-lost banner between balls. It also keeps the camera's life tied to the play screen: the setup's "keep it
 * on for a while" ends when this mounts, and leaving play switches the camera off.
 */
import { useEffect, useRef, useState } from 'react';
import { isQuiet, type FlowState, type PracticeFlow } from '../flow/controller';
import { CameraBatLink } from './Bat';
import { Setup } from './Setup';
import { CameraChip, LostBanner, LostNote, ReadinessCard } from './Card';
import { getCameraController } from './controller';
import { registerLessonPort } from './lessonPort';
import { useCameraUi, useFallbackControl } from './parts';
import { switchAway } from './switch';

export default function CameraLayer({ flow, state }: { flow: PracticeFlow; state: FlowState }) {
  const controller = getCameraController();
  const ui = useCameraUi();
  const fallback = useFallbackControl();
  const [help, setHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    controller.playMounted();
    const unregister = registerLessonPort();
    return () => {
      unregister();
      controller.playUnmounted();
    };
  }, [controller]);
  // "Keep trying" hides the banner until the camera loses the player again.
  useEffect(() => {
    if (!ui.lost) setDismissed(false);
  }, [ui.lost]);

  const { phase, screen } = state;
  // Was the player lost at any moment of this ball? Reset when a new ball starts; read at its dead ball.
  const lostDuringBall = useRef(false);
  useEffect(() => {
    if (phase === 'camera' || phase === 'ready' || phase === 'idle') lostDuringBall.current = false;
    else if (ui.lost && (phase === 'runup' || phase === 'live' || phase === 'playing')) lostDuringBall.current = true;
  }, [phase, ui.lost]);
  const liveBall = phase === 'live' || phase === 'playing';
  const showCard = (screen === 'live' || screen === 'coach') && phase === 'camera';
  const on = ui.started && ui.stage !== 'idle' && ui.stage !== 'failed';
  const showChip = (screen === 'live' || screen === 'coach') && on && !liveBall && !showCard;
  const showBanner =
    screen === 'live' && (phase === 'dead' || phase === 'idle') && ui.stage === 'running' && ui.lost && !dismissed;

  // The ball that was just played counted as a leave because the camera lost the player during it.
  const counted = screen === 'live' && phase === 'dead' && lostDuringBall.current && state.last?.result.swing === null;

  return (
    <>
      <CameraBatLink flow={flow} state={state} />
      {showChip && <CameraChip lost={ui.lost} quiet={isQuiet(phase)} />}
      {showBanner && (
        <LostBanner counted={counted} onKeepTrying={() => setDismissed(true)} onHelp={() => setHelp(true)} />
      )}
      {counted && !showBanner && <LostNote />}
      {showCard && <ReadinessCard openHelp={() => setHelp(true)} />}
      {help && (
        <Setup
          fallback={fallback}
          onDone={(result) => {
            setHelp(false);
            // Here nobody else is waiting for the answer: the way back is applied by this layer.
            if (result.kind === 'fallback') switchAway(result.to);
          }}
        />
      )}
    </>
  );
}
