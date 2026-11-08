/**
 * English: "How do you want to bat?" (the second owner brief, section 4): the choice before the first Practice or Chase
 * over on a fresh device (an inline row on Home or Setup until chosen, ruling R-20), the Settings row, the quiet chip
 * between balls and what each control needs. Keys start with `practice.controls.`. Owner: COPY. Consumer: CONTROLS,
 * whose code uses the names of sheet v3; the last five keys are the extras of its request (CONTROLS-1-to-COPY.md) that
 * v3 did not have and are not used yet.
 * `control` is the name of an input already translated: `t.t('practice.input.mouse' | 'touch' | 'keyboard' | 'camera')`;
 * `mb` is the camera files' download size in megabytes.
 * Copy rules: plain words, no fake urgency, no exclamation marks; the camera is never the default and never required.
 */
export const controlsEn = {
  // ---- the choice (web: Mouse or Camera; Android and touch devices: Touch or Camera; keyboard always works)
  'practice.controls.title': 'How do you want to bat?',
  'practice.controls.sub': 'You can change this any time, even between balls.',
  'practice.controls.mouse.hint': 'Hold the button, pull back, push forward. A trackpad works too.',
  'practice.controls.touch.hint': 'Press with your finger, pull back, flick forward.',
  'practice.controls.camera.hint': 'Move your hands in front of the front camera.',
  'practice.controls.camera.needs': 'Needs your camera and a one-time download of about {mb} MB.',
  'practice.controls.keyboard': 'The keyboard works too.',
  'practice.controls.selected': 'Selected for you: {control}',
  'practice.controls.remembered': 'Your choice is remembered on this device.',
  'practice.controls.safe': 'Changing how you bat never changes the ball.',
  'practice.controls.start': 'Start batting',

  // ---- why the camera is not offered (said plainly, with the other controls still there)
  'practice.controls.unavailable.secure': 'Camera batting needs a secure page (https).',
  'practice.controls.unavailable.api': 'This browser has no camera support.',
  'practice.controls.unavailable.device': 'No camera was found on this device.',

  // ---- Settings, the quiet chip between balls (never during a ball) and switching
  'practice.controls.setting.title': 'How you bat',
  'practice.controls.setting.hint': 'Choose mouse, touch or camera. The keyboard always works.',
  'practice.controls.chip': 'Batting: {control}',
  'practice.controls.chip_label': 'Batting with {control}. Change how you bat.',
  'practice.controls.change': 'Change how you bat',
  'practice.controls.between_balls': 'You can switch between balls, never during one.',
  'practice.controls.switched': 'Now batting with {control}.',

  // ---- extras asked for in CONTROLS-1 (not used yet)
  'practice.controls.group': 'Batting control',
  'practice.controls.default_tag': 'Default',
  'practice.controls.start_camera': 'Set up camera',
  'practice.controls.sheet_title': 'Bat with',
  'practice.controls.no_vibrate': 'Mouse and camera batting use sound and picture instead of vibration.',
} as const;
