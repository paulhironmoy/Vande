/**
 * English: camera batting (the second owner brief, sections 5 and 6): the setting, consent, the one-time download,
 * permission, the setup guide and the "you are in frame" indicator, the readiness line, the first-swing silhouette,
 * troubleshooting, tracking lost, the in-play chips, privacy, and the camera entry of the timing check. Keys start with
 * `practice.camera.` (plus `practice.input.*`, the input names, and `practice.cal.*camera*`). Owner: COPY.
 * Consumers: CAMERA-UX (everything on screen), CAMERA (the timing check entry, the privacy lines), CONTROLS (the input
 * names, the setting). The choice screen itself is `practice.controls.*` (./controls.ts).
 * Numbers are passed by the caller: `near` and `far` (metres), `mb` (megabytes), `done` and `total` (megabytes, one
 * decimal), `pct` (0 to 100), `n` and `max` (retry counts); `control` is the already-translated name of the fallback
 * control, `t.t('practice.input.mouse')` or `t.t('practice.input.touch')`.
 * Plain words only: no "model", "pose", "AI" or any device wording; the camera is off unless the player chooses it.
 */
export const cameraEn = {
  // ---- the input types by name (settings, the choice screen, the first-ball lesson)
  'practice.input.touch': 'Touch',
  'practice.input.mouse': 'Mouse',
  'practice.input.pen': 'Pen',
  'practice.input.keyboard': 'Keyboard',
  'practice.input.camera': 'Camera',

  // ---- the setting (camera is never the default; mouse, touch and keyboard always stay available)
  'practice.camera.setting.title': 'Camera batting',
  'practice.camera.setting.hint':
    'Move your hands in front of your camera to bat. Mouse, touch and keyboard still work.',
  'practice.camera.setting.use': 'Use camera',
  'practice.camera.setting.unavailable': 'Camera batting is not available on this device.',

  // ---- the one tap back: the same two words whenever the camera fails, on every screen below
  'practice.camera.switch.mouse': 'Bat with mouse',
  'practice.camera.switch.touch': 'Bat with touch',

  // ---- consent, before the browser or Android prompt ever appears
  'practice.camera.consent.title': 'Bat with your camera',
  'practice.camera.consent.what':
    'Practice uses your front camera to see your arms and hands, so you can bat by moving them.',
  'practice.camera.consent.privacy': 'The video stays on this device. It is never saved, recorded or sent anywhere.',
  'practice.camera.consent.stop': 'You can switch the camera off at any time.',
  'practice.camera.consent.download': 'A one-time download of about {mb} MB. Use Wi-Fi if you can.',
  'practice.camera.consent.others': 'Make sure nobody else is in the picture.',
  'practice.camera.consent.allow': 'Use camera',

  // ---- the one-time download (nothing is downloaded until the player picks Camera)
  'practice.camera.download.title': 'Getting the camera ready',
  'practice.camera.download.progress': '{done} of {total} MB',
  'practice.camera.download.percent': '{pct}%',
  'practice.camera.download.label': 'Downloading the camera files, {pct}%',
  'practice.camera.download.stalled': 'The download has stalled. Waiting for the connection…',
  'practice.camera.download.retrying': 'Trying again, {n} of {max}…',
  'practice.camera.download.failed': 'The camera files did not download. Check your connection and try again.',
  'practice.camera.download.offline':
    'Camera batting needs a one-time download. Connect to the internet and try again.',
  'practice.camera.download.space': 'There is not enough space on this device. Free some up and try again.',
  'practice.camera.download.ready': 'Camera ready. It works offline from now on.',

  // ---- permission
  'practice.camera.permission.asking': 'Allow the camera when your device asks.',

  // ---- the setup guide and the live preview
  'practice.camera.guide.title': 'Get in position',
  'practice.camera.guide.laptop':
    'Sit or stand about {near} to {far} metres back, with your upper body and hands in view.',
  'practice.camera.guide.phone':
    'Prop your phone up so the front camera faces you. Stand about {near} to {far} metres back.',
  'practice.camera.guide.light': 'Face the light. A bright room helps.',
  'practice.camera.guide.frame': 'Keep your head, shoulders and hands in view.',
  'practice.camera.guide.hands': 'Hold your hands in front of you, about waist height, and keep still.',
  'practice.camera.guide.done': 'Start batting',
  'practice.camera.guide.start_off': 'Start batting turns on when you are in frame.',
  'practice.camera.guide.too_close': 'Step back a little.',
  'practice.camera.guide.too_far': 'Come a little closer.',
  'practice.camera.guide.arms_out': 'Your arms are out of view. Step back until both are in the picture.',
  'practice.camera.guide.dark': 'It is too dark to see you. Switch on a light.',
  'practice.camera.preview.label': 'Camera preview, mirrored. It is not saved.',
  'practice.camera.frame.yes': 'You are in frame',
  'practice.camera.frame.no': 'Step into view',
  'practice.camera.frame.finding': 'Looking for you…',

  // ---- the readiness check before a delivery (pre-delivery pacing only)
  'practice.camera.ready.line': 'Show your upper body and your batting hand',
  'practice.camera.ready.idle': 'The camera is off. Start it when you are ready to bat.',
  'practice.camera.ready.ok': 'Got you',
  'practice.camera.ready.announce':
    'Show your upper body and your batting hand. The next ball starts when the camera sees you.',

  // ---- the first-swing silhouette (ball 1 only; reduced motion shows two still pictures with arrows)
  'practice.camera.lesson.back': 'Hands up and back',
  'practice.camera.lesson.swing': 'Hands forward and down',
  'practice.camera.lesson.still_back': 'First picture: both hands rise and move back, with an arrow pointing back.',
  'practice.camera.lesson.still_swing':
    'Second picture: both hands move forward and down, with an arrow pointing forward.',
  'practice.camera.pose.side': 'Sideways: where it goes',
  'practice.camera.pose.fast': 'Faster: harder',
  'practice.camera.pose.high': 'Higher finish: higher shot',

  // ---- troubleshooting: each has its own plain steps; the fallback buttons are practice.camera.switch.*
  'practice.camera.trouble.blocked.title': 'The camera is blocked',
  'practice.camera.trouble.blocked.body':
    'Your browser is not letting Practice use the camera. You can allow it again in a few steps.',
  'practice.camera.trouble.blocked.chrome':
    'Chrome: click the icon at the left of the address bar, set Camera to Allow, then reload the page.',
  'practice.camera.trouble.blocked.edge':
    'Edge: click the lock at the left of the address bar, set Camera to Allow, then reload the page.',
  'practice.camera.trouble.blocked.firefox':
    'Firefox: click the camera icon in the address bar, remove the block, reload, and choose Allow.',
  'practice.camera.trouble.blocked.safari':
    'Safari: open the Safari menu, choose Settings for This Website, set Camera to Allow, then reload.',
  'practice.camera.trouble.blocked.android':
    'Android app: open Settings, Apps, VANDE Cricket, Permissions, Camera, and choose Allow.',
  'practice.camera.trouble.blocked.android_browser':
    'Android browser: tap the lock beside the address, then Permissions, Camera, Allow, and reload.',
  'practice.camera.trouble.blocked.other':
    'Open your browser settings for this site, set Camera to Allow, then reload the page.',
  'practice.camera.trouble.blocked.open_settings': 'Open settings',
  'practice.camera.trouble.retry_hint': 'Then try again.',
  'practice.camera.trouble.busy.title': 'The camera is busy',
  'practice.camera.trouble.busy.body': 'Another app or tab is using the camera. Close it, then try again.',
  'practice.camera.trouble.black.title': 'The picture is black',
  'practice.camera.trouble.black.body': 'The camera is on, but all it sees is black.',
  'practice.camera.trouble.black.shutter': 'Slide open the privacy shutter, or take the cover off the lens.',
  'practice.camera.trouble.black.toggle':
    'Check for a camera on/off key or switch on your keyboard, or in your device settings.',
  'practice.camera.trouble.none.title': 'No camera found',
  'practice.camera.trouble.none.body': 'This device has no camera that Practice can use.',
  'practice.camera.trouble.inapp.title': 'Open this page in your browser',
  'practice.camera.trouble.inapp.body':
    'Camera batting does not work inside the browser built into another app. Open this page in Chrome instead.',
  'practice.camera.trouble.inapp.open': 'Open in Chrome',
  'practice.camera.trouble.inapp.copy': 'Copy link',
  'practice.camera.trouble.inapp.copied': 'Link copied. Paste it into Chrome.',
  'practice.camera.trouble.light.title': 'There is not enough light',
  'practice.camera.trouble.light.body':
    'Practice cannot see you well. Face a window or a lamp, with the light in front of you, not behind you.',
  'practice.camera.trouble.slow.title': 'The camera cannot keep up',
  'practice.camera.trouble.slow.body': 'On this device, your shots would not be timed fairly with the camera.',
  'practice.camera.trouble.unsupported.title': 'Camera is not available here',
  'practice.camera.trouble.unsupported.body': 'This browser cannot run camera batting.',

  // ---- tracking lost: a banner that never stalls the game, with one tap to the fallback
  'practice.camera.lost.title': 'Lost sight of you',
  'practice.camera.lost.body': 'Step back into view, or switch how you bat.',
  'practice.camera.lost.retry': 'Keep trying',
  'practice.camera.lost.help': 'Setup help',
  'practice.camera.lost.counted': 'The camera lost you during that ball, so it counted as a leave.',
  'practice.camera.lost.announce': 'The camera lost sight of you. Step back into view, or bat with {control}.',
  'practice.camera.a11y.tracking': 'The camera can see you.',
  'practice.camera.a11y.lost': 'The camera lost you.',

  // ---- in play
  'practice.camera.chip.on': 'Camera on',
  'practice.camera.chip.tracking': 'Tracking',
  'practice.camera.chip.lost': 'Can’t see you',
  'practice.camera.chip.off': 'Camera off',
  'practice.camera.stop': 'Switch camera off',
  'practice.camera.live.hint': 'Hands back · Watch · Hands forward · Stay still to leave',
  'practice.camera.live.gesture_label':
    'Camera batting. Raise your hands and bring them back, hold to read the ball, then bring them forward towards the gap. Stay still to leave.',

  // ---- privacy, one tap away while the camera is on
  'practice.camera.privacy.line': 'The video stays on this device and is never saved or sent.',
  'practice.camera.privacy.replays': 'Replays keep only your shot, never any pictures.',
  'practice.camera.privacy.light': 'Your device shows its camera light while this is on.',

  // ---- the timing check, camera entry
  'practice.cal.input.camera': 'camera',
  'practice.cal.camera.instruction': 'Move your hands forward as the moving ball crosses the line.',
} as const;
