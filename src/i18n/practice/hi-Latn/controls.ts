/**
 * Practice copy, Hinglish (tum register, Latin script): "How do you want to bat?". Mirrors ../en/controls.ts key for
 * key. AI-authored, native-speaker review recommended (listed in the COPY review sheet).
 */
export const controlsHiLatn: Record<string, string> = {
  // ---- the choice
  'practice.controls.title': 'Tum kaise batting karna chahoge?',
  'practice.controls.sub': 'Ise kabhi bhi badal sakte ho, balls ke beech bhi.',
  'practice.controls.mouse.hint': 'Button dabaye rakho, peeche kheecho, aage push karo. Trackpad bhi chalta hai.',
  'practice.controls.touch.hint': 'Ungli se dabao, peeche kheecho, aage flick karo.',
  'practice.controls.camera.hint': 'Front camera ke saamne haath ghumao.',
  'practice.controls.camera.needs': 'Tumhara camera aur sirf ek baar lagbhag {mb} MB ka download chahiye.',
  'practice.controls.keyboard': 'Keyboard bhi chalta hai.',
  'practice.controls.selected': 'Tumhare liye chuna gaya: {control}',
  'practice.controls.remembered': 'Tumhari choice isi device pe yaad rakhi jaati hai.',
  'practice.controls.safe': 'Batting ka tareeka badalne se ball nahi badalti.',
  'practice.controls.start': 'Batting shuru karo',

  // ---- why the camera is not offered
  'practice.controls.unavailable.secure': 'Camera se batting ke liye secure page (https) chahiye.',
  'practice.controls.unavailable.api': 'Is browser mein camera ki suvidha nahi hai.',
  'practice.controls.unavailable.device': 'Is device pe koi camera nahi mila.',

  // ---- Settings, the quiet chip between balls and switching
  'practice.controls.setting.title': 'Batting ka tareeka',
  'practice.controls.setting.hint': 'Mouse, touch ya camera chuno. Keyboard hamesha chalta hai.',
  'practice.controls.chip': 'Tareeka: {control}',
  'practice.controls.chip_label': '{control} se batting. Tareeka badlo.',
  'practice.controls.change': 'Tareeka badlo',
  'practice.controls.between_balls': 'Balls ke beech badal sakte ho, ball ke dauran nahi.',
  'practice.controls.switched': 'Ab {control} se batting.',

  // ---- extras asked for in CONTROLS-1 (not used yet)
  'practice.controls.group': 'Batting ka tareeka',
  'practice.controls.default_tag': 'Default',
  'practice.controls.start_camera': 'Camera set karo',
  'practice.controls.sheet_title': 'Tareeka',
  'practice.controls.no_vibrate': 'Mouse aur camera se batting mein vibration ki jagah sound aur picture milte hain.',
};
