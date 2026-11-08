/**
 * Practice copy, Hinglish (tum register, Latin script): camera batting and the input names. Mirrors ../en/camera.ts
 * key for key. AI-authored, native-speaker review recommended (listed in the COPY review sheet). The browser steps
 * name each browser's own menu words in English and have NOT been checked on real browsers.
 */
export const cameraHiLatn: Record<string, string> = {
  // ---- the input types by name
  'practice.input.touch': 'Touch',
  'practice.input.mouse': 'Mouse',
  'practice.input.pen': 'Pen',
  'practice.input.keyboard': 'Keyboard',
  'practice.input.camera': 'Camera',

  // ---- the setting
  'practice.camera.setting.title': 'Camera se batting',
  'practice.camera.setting.hint':
    'Camera ke saamne haath ghumaake batting karo. Mouse, touch aur keyboard bhi chalte hain.',
  'practice.camera.setting.use': 'Camera use karo',
  'practice.camera.setting.unavailable': 'Is device pe camera se batting available nahi hai.',

  // ---- the one tap back
  'practice.camera.switch.mouse': 'Mouse se batting karo',
  'practice.camera.switch.touch': 'Touch se batting karo',

  // ---- consent
  'practice.camera.consent.title': 'Camera se batting karo',
  'practice.camera.consent.what':
    'Practice tumhare front camera se tumhari baahein aur haath dekhta hai, taaki tum haath chalaake khel sako.',
  'practice.camera.consent.privacy':
    'Video isi device pe rehta hai. Use kabhi save, record ya kahin send nahi kiya jaata.',
  'practice.camera.consent.stop': 'Tum kabhi bhi camera band kar sakte ho.',
  'practice.camera.consent.download': 'Sirf ek baar lagbhag {mb} MB ka download. Ho sake to Wi-Fi use karo.',
  'practice.camera.consent.others': 'Dhyan rakho ki picture mein koi aur na ho.',
  'practice.camera.consent.allow': 'Camera use karo',

  // ---- the one-time download
  'practice.camera.download.title': 'Camera ready ho raha hai',
  'practice.camera.download.progress': '{done} / {total} MB',
  'practice.camera.download.percent': '{pct}%',
  'practice.camera.download.label': 'Camera ki files download ho rahi hain, {pct}%',
  'practice.camera.download.stalled': 'Download ruk gaya hai. Connection ka wait hai…',
  'practice.camera.download.retrying': 'Phir try ho raha hai, {n} / {max}…',
  'practice.camera.download.failed': 'Camera ki files download nahi hui. Connection check karke phir try karo.',
  'practice.camera.download.offline':
    'Camera se batting ke liye ek baar download zaroori hai. Internet se judke phir try karo.',
  'practice.camera.download.space': 'Is device pe jagah kam hai. Thodi jagah khaali karke phir try karo.',
  'practice.camera.download.ready': 'Camera ready hai. Ab yeh offline chalega.',

  // ---- permission
  'practice.camera.permission.asking': 'Device poochhe to camera ki permission de do.',

  // ---- the setup guide and the live preview
  'practice.camera.guide.title': 'Sahi jagah pe aao',
  'practice.camera.guide.laptop':
    'Camera se lagbhag {near} se {far} metre peeche baitho ya khade ho, taaki tumhara upper body aur haath dikhein.',
  'practice.camera.guide.phone':
    'Phone ko tikaake rakho taaki front camera tumhari taraf rahe. Lagbhag {near} se {far} metre peeche khade ho.',
  'practice.camera.guide.light': 'Roshni ki taraf muh rakho. Roshan jagah madad karti hai.',
  'practice.camera.guide.frame': 'Sar, kandhe aur haath frame mein rakho.',
  'practice.camera.guide.hands': 'Haath apne saamne, kamar ki unchai pe rakho aur still raho.',
  'practice.camera.guide.done': 'Batting shuru karo',
  'practice.camera.guide.start_off': 'Frame mein aate hi “Batting shuru karo” on ho jayega.',
  'practice.camera.guide.too_close': 'Thoda peeche hato.',
  'practice.camera.guide.too_far': 'Thoda paas aao.',
  'practice.camera.guide.arms_out':
    'Tumhari baahein frame se bahar hain. Tab tak peeche hato jab tak dono picture mein na aa jayein.',
  'practice.camera.guide.dark': 'Bahut andhera hai, tum dikh nahi rahe. Light jalao.',
  'practice.camera.preview.label': 'Camera preview, aaine ki tarah. Yeh save nahi hota.',
  'practice.camera.frame.yes': 'Tum frame mein ho',
  'practice.camera.frame.no': 'Frame mein aao',
  'practice.camera.frame.finding': 'Dhoondh rahe hain…',

  // ---- the readiness check
  'practice.camera.ready.line': 'Apna upper body aur bat pakadne wala haath dikhao',
  'practice.camera.ready.idle': 'Camera off hai. Batting ke liye ready ho, tab chalu karo.',
  'practice.camera.ready.ok': 'Dikh gaye',
  'practice.camera.ready.announce':
    'Apna upper body aur bat pakadne wala haath dikhao. Camera ko tum dikhoge, tab agli ball shuru hogi.',

  // ---- the first-swing silhouette
  'practice.camera.lesson.back': 'Haath upar aur peeche',
  'practice.camera.lesson.swing': 'Haath aage aur neeche',
  'practice.camera.lesson.still_back':
    'Pehli picture: dono haath upar uthke peeche jaate hain, arrow peeche ki taraf hai.',
  'practice.camera.lesson.still_swing':
    'Doosri picture: dono haath aage aur neeche aate hain, arrow aage ki taraf hai.',
  'practice.camera.pose.side': 'Side mein: ball udhar jaati hai',
  'practice.camera.pose.fast': 'Tez: zyada power',
  'practice.camera.pose.high': 'Unchi follow-through: unchi shot',

  // ---- troubleshooting
  'practice.camera.trouble.blocked.title': 'Camera blocked hai',
  'practice.camera.trouble.blocked.body':
    'Tumhara browser Practice ko camera use nahi karne de raha. Kuch steps mein ise phir allow kar sakte ho.',
  'practice.camera.trouble.blocked.chrome':
    'Chrome: address bar ke left wale icon pe click karo, Camera ko Allow pe set karo, phir page reload karo.',
  'practice.camera.trouble.blocked.edge':
    'Edge: address bar ke left wale lock pe click karo, Camera ko Allow pe set karo, phir page reload karo.',
  'practice.camera.trouble.blocked.firefox':
    'Firefox: address bar mein camera icon pe click karo, block hatao, reload karo aur Allow chuno.',
  'practice.camera.trouble.blocked.safari':
    'Safari: Safari menu kholo, “Settings for This Website” chuno, Camera ko Allow pe set karo, phir reload karo.',
  'practice.camera.trouble.blocked.android':
    'Android app: Settings, Apps, VANDE Cricket, Permissions, Camera kholo aur Allow chuno.',
  'practice.camera.trouble.blocked.android_browser':
    'Android browser: address ke paas lock pe tap karo, phir Permissions, Camera, Allow, aur reload karo.',
  'practice.camera.trouble.blocked.other':
    'Is site ke liye browser settings kholo, Camera ko Allow pe set karo, phir page reload karo.',
  'practice.camera.trouble.blocked.open_settings': 'Settings kholo',
  'practice.camera.trouble.retry_hint': 'Phir try karo.',
  'practice.camera.trouble.busy.title': 'Camera busy hai',
  'practice.camera.trouble.busy.body': 'Koi aur app ya tab camera use kar raha hai. Use band karke phir try karo.',
  'practice.camera.trouble.black.title': 'Picture kaali hai',
  'practice.camera.trouble.black.body': 'Camera on hai, par use sirf andhera dikh raha hai.',
  'practice.camera.trouble.black.shutter': 'Privacy shutter khisakaake kholo, ya lens se cover hatao.',
  'practice.camera.trouble.black.toggle': 'Keyboard ya device settings mein camera on/off ki key ya switch check karo.',
  'practice.camera.trouble.none.title': 'Koi camera nahi mila',
  'practice.camera.trouble.none.body': 'Is device pe aisa koi camera nahi hai jo Practice use kar sake.',
  'practice.camera.trouble.inapp.title': 'Yeh page apne browser mein kholo',
  'practice.camera.trouble.inapp.body':
    'Kisi dusre app ke andar bane browser mein camera se batting nahi chalti. Yeh page Chrome mein kholo.',
  'practice.camera.trouble.inapp.open': 'Chrome mein kholo',
  'practice.camera.trouble.inapp.copy': 'Link copy karo',
  'practice.camera.trouble.inapp.copied': 'Link copy ho gaya. Use Chrome mein paste karo.',
  'practice.camera.trouble.light.title': 'Roshni kam hai',
  'practice.camera.trouble.light.body':
    'Practice ko tum theek se nahi dikh rahe. Khidki ya lamp ki taraf muh karo, roshni tumhare saamne ho, peeche nahi.',
  'practice.camera.trouble.slow.title': 'Camera saath nahi de pa raha',
  'practice.camera.trouble.slow.body': 'Is device pe camera se tumhare shot ka time theek se nahi naapa ja sakega.',
  'practice.camera.trouble.unsupported.title': 'Yahan camera available nahi hai',
  'practice.camera.trouble.unsupported.body': 'Yeh browser camera se batting nahi chala sakta.',

  // ---- tracking lost
  'practice.camera.lost.title': 'Tum nazar se ojhal ho gaye',
  'practice.camera.lost.body': 'Frame mein wapas aao, ya batting ka tareeka badlo.',
  'practice.camera.lost.retry': 'Koshish jaari rakho',
  'practice.camera.lost.help': 'Setup help',
  'practice.camera.lost.counted': 'Us ball ke dauran camera ko tum nahi dikhe, isliye use leave maana gaya.',
  'practice.camera.lost.announce': 'Camera ko tum nahi dikh rahe. Frame mein wapas aao, ya {control} se batting karo.',
  'practice.camera.a11y.tracking': 'Camera ko tum dikh rahe ho.',
  'practice.camera.a11y.lost': 'Camera ko tum nahi dikh rahe.',

  // ---- in play
  'practice.camera.chip.on': 'Camera on',
  'practice.camera.chip.tracking': 'Dikh rahe ho',
  'practice.camera.chip.lost': 'Tum nahi dikh rahe',
  'practice.camera.chip.off': 'Camera off',
  'practice.camera.stop': 'Camera band karo',
  'practice.camera.live.hint': 'Haath peeche · Dekho · Haath aage · Leave ke liye still raho',
  'practice.camera.live.gesture_label':
    'Camera se batting. Dono haath uthaake peeche lao, ball padhte hue roko, phir unhe gap ki taraf aage laao. Leave ke liye still raho.',

  // ---- privacy
  'practice.camera.privacy.line': 'Video isi device pe rehta hai aur kabhi save ya send nahi hota.',
  'practice.camera.privacy.replays': 'Replay mein sirf tumhara shot rehta hai, koi picture nahi.',
  'practice.camera.privacy.light': 'Camera on hone pe tumhare device ki camera light jalti hai.',

  // ---- the timing check, camera entry
  'practice.cal.input.camera': 'camera',
  'practice.cal.camera.instruction': 'Jab chalti ball line paar kare, tab haath aage laao.',
};
