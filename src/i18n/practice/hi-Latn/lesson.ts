/**
 * Practice copy, Hinglish (tum register, Latin script): the first-ball lesson. Mirrors ../en/lesson.ts key for key.
 * AI-authored, native-speaker review recommended (listed in the COPY review sheet). Cricket words stay English.
 */
export const lessonHiLatn: Record<string, string> = {
  'practice.lesson.title': 'Tumhari pehli ball',

  // ---- the ghost gesture, step 1 (load) and step 2 (strike)
  'practice.lesson.touch.load': 'Dabao aur peeche kheecho',
  'practice.lesson.touch.strike': 'Aage flick karo',
  'practice.lesson.mouse.load': 'Button dabaake peeche kheecho',
  'practice.lesson.mouse.strike': 'Aage push karo',
  'practice.lesson.pen.load': 'Pen dabaake peeche kheecho',
  'practice.lesson.pen.strike': 'Aage flick karo',
  'practice.lesson.keyboard.load': 'Ball ko aate dekho',
  'practice.lesson.keyboard.strike': 'Hit ke liye koi arrow key dabao',
  'practice.lesson.keyboard.defend': 'Defend ke liye Space',
  'practice.lesson.keyboard.loft': 'Hawa mein uthaane ke liye Shift dabaaye rakho',
  'practice.lesson.camera.load': 'Dono haath uthaake peeche lao',
  'practice.lesson.camera.strike': 'Unhe aage aur neeche laao',

  // ---- what the start of the swing decides
  'practice.lesson.sets.direction': 'Direction',
  'practice.lesson.sets.power': 'Power',
  'practice.lesson.sets.loft': 'Loft',
  'practice.lesson.sets.direction_hint': 'Jidhar flick karoge, ball udhar jaayegi.',
  'practice.lesson.sets.power_hint': 'Tez flick se shot zyada zor se lagta hai.',
  'practice.lesson.sets.loft_hint': 'Jitna peeche kheecho, ball utni unchi jaati hai.',

  // ---- the card before ball 1
  'practice.lesson.try': 'Tumhari baari. Yahin try karo. Abhi ball nahi aa rahi.',
  'practice.lesson.after': 'Phir try karo, ya pehli ball bowl karo.',
  'practice.lesson.bowl': 'Pehli ball bowl karo',
  'practice.lesson.idle': 'Aaram se. Ball tumhara wait karti hai.',
  'practice.lesson.leave': 'Pakka nahi? Kuch mat karo, ball chhoot jaayegi.',

  // ---- plain notes when the try-out is not a hit yet
  'practice.lesson.note.tap': 'Tap se defence hota hai. Hit ke liye peeche kheecho, phir flick karo.',
  'practice.lesson.note.pull': 'Peeche kheecha. Ab aage flick karo. Kuch na karo to ball chhoot jaati hai.',
  'practice.lesson.note.key_defend': 'Space: defence. Hit ke liye arrow key dabao.',
  'practice.lesson.note.camera': 'Tumhari baahein abhi frame mein nahi hain. Thoda peeche hato.',
  'practice.lesson.note.watch': 'Yeh sirf dekhne ke liye hai. Tumhari baari agli hai.',

  // ---- acting at the wrong moment
  'practice.lesson.too_soon': 'Thodi jaldi ho gayi. Ball ka wait karo, phir khelo.',
  'practice.lesson.try_again': 'Koi baat nahi. Phir se try karo.',

  // ---- timing, in proportion to the error
  'practice.lesson.timing.on_time': 'Bilkul sahi time pe',
  'practice.lesson.timing.early.small': 'Zara jaldi',
  'practice.lesson.timing.early.medium': 'Jaldi',
  'practice.lesson.timing.early.large': 'Bahut jaldi',
  'practice.lesson.timing.late.small': 'Zara der se',
  'practice.lesson.timing.late.medium': 'Der se',
  'practice.lesson.timing.late.large': 'Bahut der se',
  'practice.lesson.timing.try_later': 'Agli baar thoda der se shuru karo.',
  'practice.lesson.timing.try_sooner': 'Agli baar thoda jaldi shuru karo.',

  // ---- screen readers
  'practice.lesson.announce.touch':
    'Pehli ball. Batting area ko dabaake peeche kheecho, phir aage flick karo. Flick ki shuruaat se direction, power aur loft tay hote hain. Bowler tumhara wait kar raha hai.',
  'practice.lesson.announce.mouse':
    'Pehli ball. Batting area pe mouse ka button dabaake peeche kheecho, phir aage push karo. Push ki shuruaat se direction, power aur loft tay hote hain. Bowler tumhara wait kar raha hai.',
  'practice.lesson.announce.pen':
    'Pehli ball. Batting area pe pen dabaake peeche kheecho, phir aage flick karo. Flick ki shuruaat se direction, power aur loft tay hote hain. Bowler tumhara wait kar raha hai.',
  'practice.lesson.announce.keyboard':
    'Pehli ball. Hit ke liye koi arrow key dabao, defend ke liye Space. Hawa mein uthaane ke liye Shift dabaaye rakho. Bowler tumhara wait kar raha hai.',
  'practice.lesson.announce.camera':
    'Pehli ball. Dono haath uthaake peeche lao, phir unhe aage aur neeche laao. Is move ki shuruaat se direction, power aur loft tay hote hain. Bowler tumhara wait kar raha hai.',

  // ---- the still picture (reduced motion), described for screen readers
  'practice.lesson.ghost.touch': 'Ek ungli dabti hai, peeche kheenchti hai, phir aage flick karti hai.',
  'practice.lesson.ghost.mouse': 'Mouse ka pointer dabaa rehta hai, peeche kheenchta hai, phir aage push karta hai.',
  'practice.lesson.ghost.pen': 'Ek pen dabta hai, peeche kheenchta hai, phir aage flick karta hai.',
  'practice.lesson.ghost.keyboard': 'Hit ke liye arrow key dabti hai, ya defend ke liye Space.',
  'practice.lesson.ghost.camera': 'Do haath uthke peeche aate hain, phir aage aur neeche aate hain.',
};
