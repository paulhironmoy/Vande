/**
 * Practice copy, Hindi (आप register): camera batting and the input names. Mirrors ../en/camera.ts key for key.
 * AI-authored, native-speaker review recommended (listed in the COPY review sheet). The browser steps name each
 * browser's own menu words in their usual Hindi forms and have NOT been checked on real browsers.
 */
export const cameraHi: Record<string, string> = {
  // ---- the input types by name
  'practice.input.touch': 'टच',
  'practice.input.mouse': 'माउस',
  'practice.input.pen': 'पेन',
  'practice.input.keyboard': 'कीबोर्ड',
  'practice.input.camera': 'कैमरा',

  // ---- the setting
  'practice.camera.setting.title': 'कैमरे से बल्लेबाज़ी',
  'practice.camera.setting.hint': 'कैमरे के सामने हाथ घुमाकर बल्लेबाज़ी करें। माउस, टच और कीबोर्ड भी चलते हैं।',
  'practice.camera.setting.use': 'कैमरा इस्तेमाल करें',
  'practice.camera.setting.unavailable': 'इस डिवाइस पर कैमरे से बल्लेबाज़ी उपलब्ध नहीं है।',

  // ---- the one tap back
  'practice.camera.switch.mouse': 'माउस से खेलें',
  'practice.camera.switch.touch': 'टच से खेलें',

  // ---- consent
  'practice.camera.consent.title': 'कैमरे से बल्लेबाज़ी करें',
  'practice.camera.consent.what':
    'प्रैक्टिस आपके आगे वाले कैमरे से आपकी बाँहें और हाथ देखता है, ताकि आप हाथ चलाकर खेल सकें।',
  'practice.camera.consent.privacy': 'वीडियो इसी डिवाइस पर रहता है। उसे कभी सेव, रिकॉर्ड या कहीं भेजा नहीं जाता।',
  'practice.camera.consent.stop': 'आप कभी भी कैमरा बंद कर सकते हैं।',
  'practice.camera.consent.download': 'सिर्फ़ एक बार लगभग {mb} MB का डाउनलोड। हो सके तो Wi-Fi इस्तेमाल करें।',
  'practice.camera.consent.others': 'ध्यान रखें कि तस्वीर में कोई और न हो।',
  'practice.camera.consent.allow': 'कैमरा इस्तेमाल करें',

  // ---- the one-time download
  'practice.camera.download.title': 'कैमरा तैयार हो रहा है',
  'practice.camera.download.progress': '{done} / {total} MB',
  'practice.camera.download.percent': '{pct}%',
  'practice.camera.download.label': 'कैमरे की फ़ाइलें डाउनलोड हो रही हैं, {pct}%',
  'practice.camera.download.stalled': 'डाउनलोड रुक गया है। कनेक्शन का इंतज़ार है…',
  'practice.camera.download.retrying': 'फिर कोशिश हो रही है, {n} / {max}…',
  'practice.camera.download.failed': 'कैमरे की फ़ाइलें डाउनलोड नहीं हुईं। कनेक्शन जाँचकर फिर कोशिश करें।',
  'practice.camera.download.offline':
    'कैमरे से बल्लेबाज़ी के लिए एक बार डाउनलोड ज़रूरी है। इंटरनेट से जुड़कर फिर कोशिश करें।',
  'practice.camera.download.space': 'इस डिवाइस पर जगह कम है। कुछ जगह खाली करके फिर कोशिश करें।',
  'practice.camera.download.ready': 'कैमरा तैयार है। अब यह ऑफ़लाइन चलेगा।',

  // ---- permission
  'practice.camera.permission.asking': 'डिवाइस पूछे तो कैमरे की अनुमति दें।',

  // ---- the setup guide and the live preview
  'practice.camera.guide.title': 'सही जगह पर आएँ',
  'practice.camera.guide.laptop':
    'कैमरे से लगभग {near} से {far} मीटर पीछे बैठें या खड़े हों, ताकि आपका ऊपरी शरीर और हाथ दिखें।',
  'practice.camera.guide.phone':
    'फ़ोन को टिकाकर रखें ताकि आगे वाला कैमरा आपकी ओर रहे। लगभग {near} से {far} मीटर पीछे खड़े हों।',
  'practice.camera.guide.light': 'रोशनी की ओर मुँह रखें। रोशन जगह मदद करती है।',
  'practice.camera.guide.frame': 'सिर, कंधे और हाथ फ़्रेम में रखें।',
  'practice.camera.guide.hands': 'हाथ अपने सामने, कमर की ऊँचाई पर रखें और स्थिर रहें।',
  'practice.camera.guide.done': 'बल्लेबाज़ी शुरू करें',
  'practice.camera.guide.start_off': 'फ़्रेम में आते ही “बल्लेबाज़ी शुरू करें” चालू हो जाएगा।',
  'practice.camera.guide.too_close': 'थोड़ा पीछे हटें।',
  'practice.camera.guide.too_far': 'थोड़ा पास आएँ।',
  'practice.camera.guide.arms_out': 'आपकी बाँहें फ़्रेम से बाहर हैं। तब तक पीछे हटें जब तक दोनों तस्वीर में न आ जाएँ।',
  'practice.camera.guide.dark': 'बहुत अँधेरा है, आप नहीं दिख रहे। रोशनी जलाएँ।',
  'practice.camera.preview.label': 'कैमरे का प्रीव्यू, आईने की तरह। यह सेव नहीं होता।',
  'practice.camera.frame.yes': 'आप फ़्रेम में हैं',
  'practice.camera.frame.no': 'फ़्रेम में आएँ',
  'practice.camera.frame.finding': 'आपको ढूँढ रहे हैं…',

  // ---- the readiness check
  'practice.camera.ready.line': 'अपना ऊपरी शरीर और बल्ला पकड़ने वाला हाथ दिखाएँ',
  'practice.camera.ready.idle': 'कैमरा बंद है। बल्लेबाज़ी के लिए तैयार हों, तब चालू करें।',
  'practice.camera.ready.ok': 'दिख गए',
  'practice.camera.ready.announce':
    'अपना ऊपरी शरीर और बल्ला पकड़ने वाला हाथ दिखाएँ। कैमरे को आप दिखेंगे, तब अगली गेंद शुरू होगी।',

  // ---- the first-swing silhouette
  'practice.camera.lesson.back': 'हाथ ऊपर और पीछे',
  'practice.camera.lesson.swing': 'हाथ आगे और नीचे',
  'practice.camera.lesson.still_back': 'पहली तस्वीर: दोनों हाथ ऊपर उठकर पीछे जाते हैं, तीर पीछे की ओर है।',
  'practice.camera.lesson.still_swing': 'दूसरी तस्वीर: दोनों हाथ आगे और नीचे आते हैं, तीर आगे की ओर है।',
  'practice.camera.pose.side': 'बग़ल की ओर: गेंद उधर जाती है',
  'practice.camera.pose.fast': 'तेज़: ज़्यादा ताक़त',
  'practice.camera.pose.high': 'ऊँचा फ़ॉलो-थ्रू: ऊँचा शॉट',

  // ---- troubleshooting
  'practice.camera.trouble.blocked.title': 'कैमरा बंद है',
  'practice.camera.trouble.blocked.body':
    'आपका ब्राउज़र प्रैक्टिस को कैमरा इस्तेमाल नहीं करने दे रहा। कुछ कदमों में इसे फिर से चालू कर सकते हैं।',
  'practice.camera.trouble.blocked.chrome':
    'Chrome: एड्रेस बार के बाईं ओर के आइकन पर क्लिक करें, कैमरा को अनुमति दें पर सेट करें, फिर पेज रीलोड करें।',
  'practice.camera.trouble.blocked.edge':
    'Edge: एड्रेस बार के बाईं ओर के ताले पर क्लिक करें, कैमरा को अनुमति दें पर सेट करें, फिर पेज रीलोड करें।',
  'practice.camera.trouble.blocked.firefox':
    'Firefox: एड्रेस बार में कैमरे के आइकन पर क्लिक करें, रोक हटाएँ, रीलोड करें और अनुमति दें चुनें।',
  'practice.camera.trouble.blocked.safari':
    'Safari: Safari मेन्यू खोलें, “इस वेबसाइट की सेटिंग्स” चुनें, कैमरा को अनुमति दें पर सेट करें, फिर रीलोड करें।',
  'practice.camera.trouble.blocked.android':
    'Android ऐप: सेटिंग्स, ऐप्स, VANDE Cricket, अनुमतियाँ, कैमरा खोलें और अनुमति दें चुनें।',
  'practice.camera.trouble.blocked.android_browser':
    'Android ब्राउज़र: एड्रेस के पास ताले पर टैप करें, फिर अनुमतियाँ, कैमरा, अनुमति दें, और रीलोड करें।',
  'practice.camera.trouble.blocked.other':
    'इस साइट के लिए ब्राउज़र की सेटिंग्स खोलें, कैमरा को अनुमति दें पर सेट करें, फिर पेज रीलोड करें।',
  'practice.camera.trouble.blocked.open_settings': 'सेटिंग्स खोलें',
  'practice.camera.trouble.retry_hint': 'फिर कोशिश करें।',
  'practice.camera.trouble.busy.title': 'कैमरा व्यस्त है',
  'practice.camera.trouble.busy.body': 'कोई और ऐप या टैब कैमरा इस्तेमाल कर रहा है। उसे बंद करके फिर कोशिश करें।',
  'practice.camera.trouble.black.title': 'तस्वीर काली है',
  'practice.camera.trouble.black.body': 'कैमरा चालू है, पर उसे सिर्फ़ अँधेरा दिख रहा है।',
  'practice.camera.trouble.black.shutter': 'प्राइवेसी शटर खिसकाकर खोलें, या लेंस से ढक्कन हटाएँ।',
  'practice.camera.trouble.black.toggle':
    'कीबोर्ड या डिवाइस की सेटिंग्स में कैमरा चालू/बंद करने की कुंजी या स्विच जाँचें।',
  'practice.camera.trouble.none.title': 'कोई कैमरा नहीं मिला',
  'practice.camera.trouble.none.body': 'इस डिवाइस पर ऐसा कोई कैमरा नहीं है जिसे प्रैक्टिस इस्तेमाल कर सके।',
  'practice.camera.trouble.inapp.title': 'यह पेज अपने ब्राउज़र में खोलें',
  'practice.camera.trouble.inapp.body':
    'किसी दूसरे ऐप के भीतर बने ब्राउज़र में कैमरे से बल्लेबाज़ी नहीं चलती। यह पेज Chrome में खोलें।',
  'practice.camera.trouble.inapp.open': 'Chrome में खोलें',
  'practice.camera.trouble.inapp.copy': 'लिंक कॉपी करें',
  'practice.camera.trouble.inapp.copied': 'लिंक कॉपी हो गया। उसे Chrome में पेस्ट करें।',
  'practice.camera.trouble.light.title': 'रोशनी कम है',
  'practice.camera.trouble.light.body':
    'प्रैक्टिस को आप ठीक से नहीं दिख रहे। खिड़की या लैंप की ओर मुँह करें, रोशनी आपके सामने हो, पीछे नहीं।',
  'practice.camera.trouble.slow.title': 'कैमरा साथ नहीं दे पा रहा',
  'practice.camera.trouble.slow.body': 'इस डिवाइस पर कैमरे से आपके शॉट का समय ठीक से नहीं नापा जा सकेगा।',
  'practice.camera.trouble.unsupported.title': 'यहाँ कैमरा उपलब्ध नहीं है',
  'practice.camera.trouble.unsupported.body': 'यह ब्राउज़र कैमरे से बल्लेबाज़ी नहीं चला सकता।',

  // ---- tracking lost
  'practice.camera.lost.title': 'आप नज़र से ओझल हो गए',
  'practice.camera.lost.body': 'फ़्रेम में वापस आएँ, या खेलने का तरीक़ा बदलें।',
  'practice.camera.lost.retry': 'कोशिश जारी रखें',
  'practice.camera.lost.help': 'सेटअप की मदद',
  'practice.camera.lost.counted': 'उस गेंद के दौरान कैमरे को आप नहीं दिखे, इसलिए उसे छोड़ी हुई गेंद गिना गया।',
  'practice.camera.lost.announce': 'कैमरे को आप नहीं दिख रहे। फ़्रेम में वापस आएँ, या {control} से बल्लेबाज़ी करें।',
  'practice.camera.a11y.tracking': 'कैमरे को आप दिख रहे हैं।',
  'practice.camera.a11y.lost': 'कैमरे को आप नहीं दिख रहे।',

  // ---- in play
  'practice.camera.chip.on': 'कैमरा चालू',
  'practice.camera.chip.tracking': 'दिख रहे हैं',
  'practice.camera.chip.lost': 'आप नहीं दिख रहे',
  'practice.camera.chip.off': 'कैमरा बंद',
  'practice.camera.stop': 'कैमरा बंद करें',
  'practice.camera.live.hint': 'हाथ पीछे · देखें · हाथ आगे · छोड़ने के लिए स्थिर रहें',
  'practice.camera.live.gesture_label':
    'कैमरे से बल्लेबाज़ी। दोनों हाथ उठाकर पीछे लाएँ, गेंद पढ़ते हुए रोकें, फिर उन्हें गैप की ओर आगे लाएँ। छोड़ने के लिए स्थिर रहें।',

  // ---- privacy
  'practice.camera.privacy.line': 'वीडियो इसी डिवाइस पर रहता है और कभी सेव या भेजा नहीं जाता।',
  'practice.camera.privacy.replays': 'रीप्ले में सिर्फ़ आपका शॉट रहता है, कोई तस्वीर नहीं।',
  'practice.camera.privacy.light': 'कैमरा चालू होने पर आपके डिवाइस की कैमरा-लाइट जलती है।',

  // ---- the timing check, camera entry
  'practice.cal.input.camera': 'कैमरा',
  'practice.cal.camera.instruction': 'जब चलती गेंद लाइन पार करे, तब हाथ आगे लाएँ।',
};
