/**
 * Practice copy, Hindi (आप register): the first-ball lesson. Mirrors ../en/lesson.ts key for key. AI-authored,
 * native-speaker review recommended (listed in the COPY review sheet). Cricket words keep the forms the app uses
 * (फ़्लिक, स्विंग, गेंदबाज़).
 */
export const lessonHi: Record<string, string> = {
  'practice.lesson.title': 'आपकी पहली गेंद',

  // ---- the ghost gesture, step 1 (load) and step 2 (strike)
  'practice.lesson.touch.load': 'दबाएँ और पीछे खींचें',
  'practice.lesson.touch.strike': 'आगे फ़्लिक करें',
  'practice.lesson.mouse.load': 'बटन दबाए रखकर पीछे खींचें',
  'practice.lesson.mouse.strike': 'आगे धकेलें',
  'practice.lesson.pen.load': 'पेन दबाकर पीछे खींचें',
  'practice.lesson.pen.strike': 'आगे फ़्लिक करें',
  'practice.lesson.keyboard.load': 'गेंद को आते देखें',
  'practice.lesson.keyboard.strike': 'मारने के लिए कोई तीर कुंजी दबाएँ',
  'practice.lesson.keyboard.defend': 'बचाव के लिए Space',
  'practice.lesson.keyboard.loft': 'हवा में उठाने के लिए Shift दबाए रखें',
  'practice.lesson.camera.load': 'दोनों हाथ उठाकर पीछे लाएँ',
  'practice.lesson.camera.strike': 'उन्हें आगे और नीचे लाएँ',

  // ---- what the start of the swing decides
  'practice.lesson.sets.direction': 'दिशा',
  'practice.lesson.sets.power': 'ताक़त',
  'practice.lesson.sets.loft': 'ऊँचाई',
  'practice.lesson.sets.direction_hint': 'आप जिधर फ़्लिक करेंगे, गेंद उधर जाएगी।',
  'practice.lesson.sets.power_hint': 'तेज़ फ़्लिक से शॉट ज़ोर से लगता है।',
  'practice.lesson.sets.loft_hint': 'जितना पीछे खींचेंगे, गेंद उतनी ऊँची जाएगी।',

  // ---- the card before ball 1
  'practice.lesson.try': 'आपकी बारी। यहीं आज़माएँ। अभी कोई गेंद नहीं फेंकी जा रही।',
  'practice.lesson.after': 'फिर से आज़माएँ, या पहली गेंद फेंकें।',
  'practice.lesson.bowl': 'पहली गेंद फेंकें',
  'practice.lesson.idle': 'आराम से। गेंद आपका इंतज़ार करती है।',
  'practice.lesson.leave': 'पक्का नहीं? कुछ न करें, गेंद छूट जाएगी।',

  // ---- plain notes when the try-out is not a hit yet
  'practice.lesson.note.tap': 'टैप से बचाव होता है। मारने के लिए पीछे खींचें, फिर फ़्लिक करें।',
  'practice.lesson.note.pull': 'आपने पीछे खींचा। अब आगे फ़्लिक करें। कुछ न करें तो गेंद छूट जाती है।',
  'practice.lesson.note.key_defend': 'Space से बचाव। मारने के लिए तीर कुंजी दबाएँ।',
  'practice.lesson.note.camera': 'आपकी बाँहें अभी फ़्रेम में नहीं हैं। थोड़ा पीछे हटें।',
  'practice.lesson.note.watch': 'यह सिर्फ़ देखने के लिए है। आपकी बारी अगली है।',

  // ---- acting at the wrong moment
  'practice.lesson.too_soon': 'थोड़ी जल्दी हो गई। गेंद का इंतज़ार करें, फिर खेलें।',
  'practice.lesson.try_again': 'कोई बात नहीं। फिर से कोशिश करें।',

  // ---- timing, in proportion to the error
  'practice.lesson.timing.on_time': 'ठीक समय पर',
  'practice.lesson.timing.early.small': 'ज़रा जल्दी',
  'practice.lesson.timing.early.medium': 'जल्दी',
  'practice.lesson.timing.early.large': 'बहुत जल्दी',
  'practice.lesson.timing.late.small': 'ज़रा देर से',
  'practice.lesson.timing.late.medium': 'देर से',
  'practice.lesson.timing.late.large': 'बहुत देर से',
  'practice.lesson.timing.try_later': 'अगली बार थोड़ा देर से शुरू करें।',
  'practice.lesson.timing.try_sooner': 'अगली बार थोड़ा जल्दी शुरू करें।',

  // ---- screen readers
  'practice.lesson.announce.touch':
    'पहली गेंद। बल्लेबाज़ी वाले हिस्से को दबाकर पीछे खींचें, फिर आगे फ़्लिक करें। फ़्लिक की शुरुआत से दिशा, ताक़त और ऊँचाई तय होती है। गेंदबाज़ आपका इंतज़ार कर रहा है।',
  'practice.lesson.announce.mouse':
    'पहली गेंद। बल्लेबाज़ी वाले हिस्से पर माउस का बटन दबाए रखकर पीछे खींचें, फिर आगे धकेलें। धकेलने की शुरुआत से दिशा, ताक़त और ऊँचाई तय होती है। गेंदबाज़ आपका इंतज़ार कर रहा है।',
  'practice.lesson.announce.pen':
    'पहली गेंद। बल्लेबाज़ी वाले हिस्से पर पेन दबाकर पीछे खींचें, फिर आगे फ़्लिक करें। फ़्लिक की शुरुआत से दिशा, ताक़त और ऊँचाई तय होती है। गेंदबाज़ आपका इंतज़ार कर रहा है।',
  'practice.lesson.announce.keyboard':
    'पहली गेंद। मारने के लिए कोई तीर कुंजी दबाएँ, बचाव के लिए Space। हवा में उठाने के लिए Shift दबाए रखें। गेंदबाज़ आपका इंतज़ार कर रहा है।',
  'practice.lesson.announce.camera':
    'पहली गेंद। दोनों हाथ उठाकर पीछे लाएँ, फिर उन्हें आगे और नीचे लाएँ। इस हरकत की शुरुआत से दिशा, ताक़त और ऊँचाई तय होती है। गेंदबाज़ आपका इंतज़ार कर रहा है।',

  // ---- the still picture (reduced motion), described for screen readers
  'practice.lesson.ghost.touch': 'एक उँगली दबती है, पीछे खिंचती है, फिर आगे फ़्लिक करती है।',
  'practice.lesson.ghost.mouse': 'माउस का पॉइंटर दबा रहता है, पीछे खिंचता है, फिर आगे धकेलता है।',
  'practice.lesson.ghost.pen': 'एक पेन दबता है, पीछे खिंचता है, फिर आगे फ़्लिक करता है।',
  'practice.lesson.ghost.keyboard': 'मारने के लिए तीर कुंजी दबती है, या बचाव के लिए Space।',
  'practice.lesson.ghost.camera': 'दो हाथ उठकर पीछे आते हैं, फिर आगे और नीचे आते हैं।',
};
