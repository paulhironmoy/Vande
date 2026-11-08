/**
 * Practice copy, Hindi (आप register): "How do you want to bat?". Mirrors ../en/controls.ts key for key. AI-authored,
 * native-speaker review recommended (listed in the COPY review sheet).
 */
export const controlsHi: Record<string, string> = {
  // ---- the choice
  'practice.controls.title': 'आप कैसे बल्लेबाज़ी करना चाहेंगे?',
  'practice.controls.sub': 'आप इसे कभी भी बदल सकते हैं, गेंदों के बीच भी।',
  'practice.controls.mouse.hint': 'बटन दबाए रखें, पीछे खींचें, आगे धकेलें। ट्रैकपैड भी चलता है।',
  'practice.controls.touch.hint': 'उँगली से दबाएँ, पीछे खींचें, आगे फ़्लिक करें।',
  'practice.controls.camera.hint': 'आगे वाले कैमरे के सामने हाथ घुमाएँ।',
  'practice.controls.camera.needs': 'आपका कैमरा और सिर्फ़ एक बार लगभग {mb} MB का डाउनलोड चाहिए।',
  'practice.controls.keyboard': 'कीबोर्ड भी चलता है।',
  'practice.controls.selected': 'आपके लिए चुना गया: {control}',
  'practice.controls.remembered': 'आपकी पसंद इसी डिवाइस पर याद रखी जाती है।',
  'practice.controls.safe': 'खेलने का तरीक़ा बदलने से गेंद नहीं बदलती।',
  'practice.controls.start': 'बल्लेबाज़ी शुरू करें',

  // ---- why the camera is not offered
  'practice.controls.unavailable.secure': 'कैमरे से बल्लेबाज़ी के लिए सुरक्षित पेज (https) चाहिए।',
  'practice.controls.unavailable.api': 'इस ब्राउज़र में कैमरे की सुविधा नहीं है।',
  'practice.controls.unavailable.device': 'इस डिवाइस पर कोई कैमरा नहीं मिला।',

  // ---- Settings, the quiet chip between balls and switching
  'practice.controls.setting.title': 'बल्लेबाज़ी का तरीक़ा',
  'practice.controls.setting.hint': 'माउस, टच या कैमरा चुनें। कीबोर्ड हमेशा चलता है।',
  'practice.controls.chip': 'तरीक़ा: {control}',
  'practice.controls.chip_label': '{control} से बल्लेबाज़ी। तरीक़ा बदलें।',
  'practice.controls.change': 'तरीक़ा बदलें',
  'practice.controls.between_balls': 'गेंदों के बीच बदल सकते हैं, गेंद के दौरान नहीं।',
  'practice.controls.switched': 'अब {control} से बल्लेबाज़ी।',

  // ---- extras asked for in CONTROLS-1 (not used yet)
  'practice.controls.group': 'बल्लेबाज़ी का तरीक़ा',
  'practice.controls.default_tag': 'डिफ़ॉल्ट',
  'practice.controls.start_camera': 'कैमरा सेट करें',
  'practice.controls.sheet_title': 'तरीक़ा',
  'practice.controls.no_vibrate': 'माउस और कैमरे से बल्लेबाज़ी में कंपन की जगह आवाज़ और तस्वीर मिलती है।',
};
