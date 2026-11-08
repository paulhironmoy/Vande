/**
 * Practice copy, Hindi (आप register): Target Chase. Mirrors ../en/chase.ts key for key. AI-authored, native-speaker
 * review recommended (listed in the COPY review sheet). "चेज़" is the cricket word players use, as "प्रैक्टिस" is.
 */
export const chaseHi: Record<string, string> = {
  // ---- the Practice home
  'practice.chase.home.title': 'चेज़',
  'practice.chase.home.sub': '{balls} गेंदों में लक्ष्य पाएँ। एक ही विकेट।',
  'practice.chase.home.resume_title': 'चेज़ जारी है',
  'practice.chase.home.resume_body': '{balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन चाहिए',
  'practice.chase.home.new_confirm_body': 'इससे आपका चेज़ ख़त्म होगा। उसे नतीजे के रूप में नहीं रखा जाएगा।',

  // ---- the setup card before ball 1
  'practice.chase.setup.title': 'चेज़',
  'practice.chase.setup.rules': '{overs, plural, one {# ओवर} other {# ओवर}}, एक विकेट। जीतने के लिए लक्ष्य पाएँ।',
  'practice.chase.setup.target': 'लक्ष्य {target}',
  'practice.chase.setup.fixed': 'लक्ष्य पहली गेंद से पहले तय होता है और कभी नहीं बदलता।',
  'practice.chase.setup.no_practice':
    'चेज़ में “यह गेंद दोबारा खेलें” बंद है। ख़त्म होने पर निर्णायक गेंद दोबारा खेल सकते हैं।',
  'practice.chase.setup.level': 'कठिनाई: {level}',
  'practice.chase.level.easy': 'आसान',
  'practice.chase.level.standard': 'स्टैंडर्ड',
  'practice.chase.level.hard': 'कठिन',

  // ---- the rail during play
  'practice.chase.need': '{balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन चाहिए',
  'practice.chase.need_short': '{balls, plural, one {# गेंद} other {# गेंदों}} में {runs}',
  'practice.chase.rate': 'हर ओवर {rate} रन',
  'practice.chase.hud_label':
    'चेज़। {balls, plural, one {# गेंद} other {# गेंदों}} में {runs, plural, one {# रन} other {# रन}} चाहिए। ज़रूरी रन रेट: हर ओवर {rate} रन।',
  'practice.chase.status': 'चेज़',
  'practice.chase.ball_of': 'गेंद {n} / {total}',

  // ---- polite screen-reader announcements
  'practice.chase.announce_start': 'चेज़। {balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन चाहिए।',
  'practice.chase.announce': '{balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन चाहिए।',
  'practice.chase.announce_last': 'आख़िरी गेंद। जीतने के लिए {runs, plural, one {# रन} other {# रन}} चाहिए।',
  'practice.chase.announce_won': 'लक्ष्य पूरा हुआ। {balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन।',
  'practice.chase.announce_lost': 'चेज़ हारा। {short, plural, one {1 रन कम} other {# रन कम}}।',

  // ---- the dead-ball card inside a chase
  'practice.chase.card.next_over': 'अगला ओवर',
  'practice.chase.card.see_result': 'नतीजा देखें',
  'practice.chase.card.no_practice': 'चेज़ में “यह गेंद दोबारा खेलें” बंद है।',
  // The coach's lines in a chase are about THIS ball, never a plan for the chase (R-44 item 5): the green tick's action,
  // and the tag of the first alternative shot.
  'practice.chase.card.confirm': 'इस गेंद के लिए कोच का यही चुनाव था',
  'practice.chase.option.recommended': 'इस गेंद के लिए कोच की पसंद',

  // ---- the win and loss screens
  'practice.chase.won.title': 'लक्ष्य पूरा हुआ',
  'practice.chase.won.line':
    'आपने {balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन बनाए। लक्ष्य {target} था।',
  'practice.chase.won.spare': '{left, plural, =0 {आख़िरी गेंद पर जीत।} one {1 गेंद बाक़ी।} other {# गेंदें बाक़ी।}}',
  'practice.chase.lost.title': '{short, plural, one {1 रन कम} other {# रन कम}}',
  'practice.chase.lost.line':
    'आपने {balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन बनाए। लक्ष्य {target} था।',
  'practice.chase.result.last': 'पिछली बार: {balls, plural, one {# गेंद} other {# गेंदों}} में {runs} रन',

  // ---- fair attribution
  'practice.chase.why.wicket': 'आउट: {how}। {reason}।',
  'practice.chase.why.wicket_timing': 'आउट: {how}। {reason}, {timing}।',
  'practice.chase.why.short.timing': 'जिन {dots} गेंदों पर रन नहीं बना, उनमें {n} में शॉट जल्दी या देर से लगा।',
  'practice.chase.why.short.bowler': 'जिन {dots} गेंदों पर रन नहीं बना, उनमें {n} पर गेंदबाज़ ने बल्ले को छका दिया।',
  'practice.chase.why.short.line': 'जिन {dots} गेंदों पर रन नहीं बना, उनमें {n} में बल्ला चूका या गेंद पैड पर लगी।',
  'practice.chase.why.short.field': 'जिन {dots} गेंदों पर रन नहीं बना, उनमें {n} सीधे फ़ील्डर के पास गईं।',
  'practice.chase.why.short.defence': 'जिन {dots} गेंदों पर रन नहीं बना, उनमें {n} पर आपने बचाव किया या गेंद छोड़ी।',
  'practice.chase.why.short.plain': '{balls} में से {dots} गेंदों पर कोई रन नहीं बना।',

  // ---- actions and the deciding ball
  'practice.chase.again': 'यही चेज़ फिर से खेलें',
  'practice.chase.back': 'प्रैक्टिस पर वापस',
  'practice.chase.watch': 'निर्णायक गेंद देखें',
  'practice.chase.practise': 'निर्णायक गेंद दोबारा खेलें',
  'practice.chase.practise_note': 'सिर्फ़ प्रैक्टिस। आपका चेज़ नतीजा वैसा ही रहेगा।',
  'practice.chase.replay_title': 'निर्णायक गेंद',

  // ---- leaving a chase from the pause screen
  'practice.chase.pause.leave_title': 'यह चेज़ छोड़ें?',
  'practice.chase.pause.leave_body': 'आपका चेज़ इसी डिवाइस पर सुरक्षित रहेगा। प्रैक्टिस से कभी भी जारी रखें।',
};
