/**
 * Alias and group-name moderation, shared by the Worker (authoritative) and the app (instant feedback). Pure.
 *
 * What it refuses:
 *   - wrong length or characters (letters, digits, space, _ . ' - only; at least one letter). Letters come only from
 *     the scripts the app ships: Latin (basic letters, Latin-1 and Latin Extended-A, and the precomposed accented
 *     letters of Latin Extended Additional used to transliterate Indian names) and Devanagari, Bengali, Gurmukhi,
 *     Gujarati, Tamil, Telugu, Kannada and Malayalam, one script per word (ASCII digits mix with any). Every other
 *     script and every look-alike letter block (Cyrillic, Greek, Armenian, Cherokee, IPA and phonetic small capitals,
 *     stray combining marks) is refused, which closes the homoglyph disguises a word list cannot list;
 *   - contact details (7+ digits, links, handles of messaging apps): aliases are public;
 *   - impersonation of the game, staff, cricket bodies or platforms;
 *   - offensive words in English, Hindi (Devanagari) and Hinglish (romanised Hindi), after folding case, accents,
 *     look-alike Cyrillic/Greek letters, digits used as letters, separators and repeated letters.
 *
 * Two lists keep false positives down (the "Scunthorpe problem"): SUBSTRING roots are long and never part of an
 * innocent word, so they are found anywhere; TOKEN roots are short or overlap real names (gand/Gandhi, nazi/Nazim,
 * lund/London, rapist/therapist, shit/Ashit) and are refused only as a whole word. "Chakka"/"chhakka" (a six) is
 * allowed on purpose. Bengali, Tamil, Telugu and the other scripts rely on reports and review in v1
 * (docs/SECURITY.md). The lists are data, reviewed like code; never echo which word matched.
 */

export const ALIAS_MIN = 3;
export const ALIAS_MAX = 20;
export const GROUP_NAME_MIN = 3;
export const GROUP_NAME_MAX = 40;

export type NameRejection = 'length' | 'characters' | 'contact' | 'reserved' | 'offensive';
export type NameCheck = { ok: true; value: string } | { ok: false; reason: NameRejection };

const SUBSTRING_ROOTS = [
  // English
  'fuck', 'fucc', 'phuck', 'fvck', 'bitch', 'bastard', 'asshole', 'arsehole', 'nigger', 'nigga', 'whore', 'wanker', 'pussy',
  'porno', 'pornstar', 'penis', 'vagina', 'boobs', 'hitler', 'faggot', 'dickhead', 'cocksuck', 'bollock', 'jackass', 'dumbass',
  // Hinglish
  'madarchod', 'maderchod', 'madharchod', 'madrchod', 'behenchod', 'bhenchod', 'behanchod', 'bahenchod', 'banchod',
  'bhanchod', 'bhosd', 'bhosad', 'bhosri', 'chutiya', 'chutia', 'chotiya', 'chutiye', 'gandu', 'gandmar', 'harami', 'haramzad',
  'haramkhor', 'randibaz', 'randikhan', 'lodu', 'jhatu', 'betichod', 'bhadwa', 'bhadva', 'chinal', 'lavdu', 'lawdu', 'chodu',
  'tharki',
];

const TOKEN_ROOTS = [
  // English
  'fuk', 'fck', 'fk', 'phuk', 'shit', 'cunt', 'dick', 'cock', 'fag', 'slut', 'twat', 'prick', 'rape', 'rapist', 'retard', 'kike',
  'chink', 'paki', 'nazi', 'porn', 'sex', 'sexy', 'xxx', 'nude', 'nudes', 'tits', 'piss', 'jihadi',
  // Hinglish, abbreviations and slurs
  'mc', 'bc', 'bsdk', 'bkl', 'mkc', 'tmkc', 'mkb', 'bkc', 'gand', 'lund', 'lauda', 'lavda', 'lawda', 'lavde', 'lawde', 'loda',
  'laude', 'randi', 'randwa', 'raand', 'kutta', 'kutte', 'kutiya', 'kuttiya', 'suar', 'suwar', 'tatti', 'jhat', 'jhant',
  'chod', 'chud', 'chudai', 'chut', 'chuchi', 'phudi', 'fudi', 'phuddi', 'hijda', 'hijde', 'chamar', 'bhangi', 'chuhra',
  'neech', 'katua', 'librandu', 'sickular', 'andhbhakt', 'kamina', 'kamine', 'kaminey',
];

/** Devanagari roots (after NFKC, nukta folding and removal of joiners). */
const DEVANAGARI_SUBSTRING = ['मादरचोद', 'मादरचोत', 'भेनचोद', 'बहनचोद', 'बहनचोत', 'भोसडी', 'भोसडा', 'भोसडे', 'चूतिया', 'चुतिया', 'चूतिये', 'गांडू', 'गाँडू', 'रंडी', 'हरामी', 'हरामजादा', 'हरामखोर', 'लौडा', 'लौडे', 'बेटीचोद', 'भडवा'];
const DEVANAGARI_TOKENS = ['गांड', 'गाँड', 'लंड', 'लण्ड', 'चोद', 'चूत', 'कुत्ता', 'कमीना', 'कमीने', 'सुअर', 'टट्टी', 'झाट', 'हिजडा', 'चमार', 'भंगी'];

/** Impersonation: the game, staff and roles, cricket bodies, platforms and competitors. */
const RESERVED_SUBSTRING = ['vande', 'administrator', 'moderator', 'official', 'helpdesk', 'customercare', 'youtube', 'google', 'whatsapp', 'cricketleague', 'miniclip', 'anthropic'];
const RESERVED_TOKENS = ['admin', 'support', 'staff', 'system', 'mod', 'bcci', 'icc', 'ipl'];

/** Contact details (aliases are public): links and messaging or payment handles. */
const CONTACT_RE = /(https?|www|\.com|\.in\b|\.net|\.org|wa\.me|t\.me|telegram|instagram|snapchat|paytm|gpay|phonepe)/i;

const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't', н: 'h', в: 'b', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd',
  α: 'a', ο: 'o', ρ: 'p', ε: 'e', ι: 'i', κ: 'k', ν: 'v', τ: 't', υ: 'u', χ: 'x', β: 'b', η: 'n', μ: 'm',
  // Allowed Latin letters that do not decompose to a base letter.
  ø: 'o', ð: 'd', đ: 'd', ħ: 'h', ı: 'i', ł: 'l', ŀ: 'l', ŧ: 't', þ: 'p', ß: 'b', æ: 'ae', œ: 'oe', ŋ: 'n', ĸ: 'k', ŉ: 'n', ĳ: 'ij',
};

/**
 * Letters aliases may use, by script: [script, first, last] code points. Anything else (another script, a look-alike
 * block, a combining mark that did not compose under NFKC) is refused as 'characters'.
 */
const SCRIPT_RANGES: ReadonlyArray<readonly [string, number, number]> = [
  ['latin', 0x41, 0x5a],
  ['latin', 0x61, 0x7a],
  ['latin', 0xc0, 0xd6],
  ['latin', 0xd8, 0xf6],
  ['latin', 0xf8, 0x17f],
  ['latin', 0x1e00, 0x1e9b],
  ['latin', 0x1ea0, 0x1ef9],
  ['devanagari', 0x900, 0x97f],
  ['bengali', 0x980, 0x9ff],
  ['gurmukhi', 0xa00, 0xa7f],
  ['gujarati', 0xa80, 0xaff],
  ['tamil', 0xb80, 0xbff],
  ['telugu', 0xc00, 0xc7f],
  ['kannada', 0xc80, 0xcff],
  ['malayalam', 0xd00, 0xd7f],
];
/** Letters, marks and digits carry a script; ASCII digits are neutral, and punctuation was checked before. */
const SCRIPTED_RE = /[\p{L}\p{M}\p{N}]/u;

function scriptOf(ch: string): string | null {
  const cp = ch.codePointAt(0) as number;
  for (const [script, lo, hi] of SCRIPT_RANGES) if (cp >= lo && cp <= hi) return script;
  return null;
}

/** Every letter comes from a shipped script, and each word uses one script (ASCII digits and punctuation are neutral). */
function supportedScripts(value: string): boolean {
  for (const word of value.split(/[^\p{L}\p{M}\p{N}]+/u)) {
    let script: string | null = null;
    for (const ch of word) {
      if (!SCRIPTED_RE.test(ch) || (ch >= '0' && ch <= '9')) continue;
      const s = scriptOf(ch);
      if (s === null) return false;
      if (script !== null && s !== script) return false;
      script = s;
    }
  }
  return true;
}
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };

const ALLOWED_RE = /^[\p{L}\p{M}\p{Nd} _.'-]+$/u;
const GROUP_ALLOWED_RE = /^[\p{L}\p{M}\p{Nd} _.'&(),-]+$/u;
const HAS_LETTER_RE = /\p{L}/u;
const SEPARATORS_RE = /[\s_.'&(),-]+/u;

/** NFKC, joiners removed, trimmed, inner whitespace collapsed to one space. */
export function tidyName(input: string): string {
  return input.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/\s+/g, ' ');
}

/** Runs of a letter collapsed to one ("fuuuck" → "fuck") or to two ("niiiggga" → "niigga"). */
const c1 = (s: string): string => s.replace(/(.)\1+/gu, '$1');
const c2 = (s: string): string => s.replace(/(.)\1{2,}/gu, '$1$1');
const hasDouble = (s: string): boolean => /(.)\1/u.test(s);

/** Latin folding: lowercase, accents and look-alikes removed, digits read as letters; letters only. Variants for "1". */
function latinFold(s: string): string[] {
  const base = [...s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')].map((c) => CONFUSABLES[c] ?? c).join('');
  const letters = (x: string) => x.replace(/[^\p{L}]/gu, '');
  const withI = letters([...base].map((c) => LEET[c] ?? c).join(''));
  const withL = letters([...base].map((c) => (c === '1' ? 'l' : (LEET[c] ?? c))).join(''));
  return withI === withL ? [withI] : [withI, withL];
}

function devanagariFold(s: string): string {
  // Nukta letters fold to their base (ड़ → ड); joiners are dropped.
  return s.normalize('NFD').replace(/\u093C/g, '').replace(/[\u200C\u200D]/g, '').normalize('NFC');
}

/** Words: split on separators and on lower→upper boundaries ("KuttaKing" → Kutta, King). */
function wordsOf(s: string): string[] {
  return s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').split(SEPARATORS_RE).filter(Boolean);
}

/**
 * Roots without a doubled letter match after collapsing every run to one letter. Roots with a doubled letter would
 * collide with innocent words when collapsed (nigga/Nigam, tatti/Tati, kutta/Kuttappan), so they match with runs
 * collapsed to two, or as a whole word collapsed to one (only when that form is at least five letters long).
 */
function hitsSubstring(compact: string, words: string[], root: string): boolean {
  if (!hasDouble(root)) return c1(compact).includes(root);
  return c2(compact).includes(c2(root)) || words.some((w) => c1(w) === c1(root));
}

function hitsWord(words: string[], root: string): boolean {
  if (!hasDouble(root)) return words.some((w) => c1(w) === root);
  const r1 = c1(root);
  return words.some((w) => c2(w) === c2(root) || (r1.length >= 5 && c1(w) === r1));
}

function containsBlocked(value: string): 'offensive' | 'reserved' | null {
  const rawWords = wordsOf(value);
  for (const compact of latinFold(value)) {
    const words = rawWords.flatMap((w) => latinFold(w)).filter(Boolean);
    // The whole alias spelled out letter by letter ("B C", "M.C.", "A D M I N") reads as the one word it spells.
    if (TOKEN_ROOTS.some((r) => hitsWord([compact], r))) return 'offensive';
    if (RESERVED_TOKENS.some((r) => hitsWord([compact], r))) return 'reserved';
    if (SUBSTRING_ROOTS.some((r) => hitsSubstring(compact, words, r))) return 'offensive';
    if (TOKEN_ROOTS.some((r) => hitsWord(words, r))) return 'offensive';
    if (RESERVED_SUBSTRING.some((r) => hitsSubstring(compact, words, r))) return 'reserved';
    if (RESERVED_TOKENS.some((r) => hitsWord(words, r))) return 'reserved';
  }
  const deva = devanagariFold(value);
  const devaCompact = deva.replace(/[\s_.'&(),-]/g, '');
  if (DEVANAGARI_SUBSTRING.some((r) => devaCompact.includes(r))) return 'offensive';
  if (deva.split(SEPARATORS_RE).some((t) => DEVANAGARI_TOKENS.includes(t))) return 'offensive';
  return null;
}

function checkName(input: unknown, min: number, max: number, allowed: RegExp): NameCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'characters' };
  const value = tidyName(input);
  const length = [...value].length;
  if (length < min || length > max) return { ok: false, reason: 'length' };
  if (!allowed.test(value) || !HAS_LETTER_RE.test(value)) return { ok: false, reason: 'characters' };
  const digits = value.match(/\p{Nd}/gu)?.length ?? 0;
  if (digits >= 7 || CONTACT_RE.test(value.replace(/\s+/g, ''))) return { ok: false, reason: 'contact' };
  const blocked = containsBlocked(value);
  if (blocked) return { ok: false, reason: blocked };
  if (!supportedScripts(value)) return { ok: false, reason: 'characters' };
  return { ok: true, value };
}

export function checkAlias(input: unknown): NameCheck {
  return checkName(input, ALIAS_MIN, ALIAS_MAX, ALLOWED_RE);
}

export function checkGroupName(input: unknown): NameCheck {
  return checkName(input, GROUP_NAME_MIN, GROUP_NAME_MAX, GROUP_ALLOWED_RE);
}

export const MESSAGE_MAX = 140;
const MESSAGE_ALLOWED_RE = /^[\p{L}\p{M}\p{Nd}\p{Zs} _.,!?'"&():;+-]+$/u;

/** Free-text room messages (only when a deployment enables them): same filters, a little more punctuation. */
export function checkMessage(input: unknown): NameCheck {
  return checkName(input, 1, MESSAGE_MAX, MESSAGE_ALLOWED_RE);
}

// ---------------------------------------------------------------------------------------------------------------
// Generated aliases: original, cricket-flavoured, never a real person.
// ---------------------------------------------------------------------------------------------------------------

const ADJECTIVES = ['Swift', 'Bold', 'Calm', 'Clever', 'Golden', 'Lucky', 'Mighty', 'Midnight', 'Rapid', 'Silent', 'Sunny', 'Brave', 'Electric', 'Steady', 'Fearless', 'Nimble'];
const NOUNS = ['Tiger', 'Falcon', 'Cobra', 'Comet', 'Cyclone', 'Panther', 'Storm', 'Thunder', 'Spinner', 'Yorker', 'Seamer', 'Slogger', 'Keeper', 'Opener', 'Finisher', 'Striker'];

/** A generated alias such as "Swift Yorker 27", chosen from 16 × 16 × 90 combinations by the given random bytes. */
export function generatedAlias(random: Uint8Array): string {
  const a = ADJECTIVES[random[0] % ADJECTIVES.length];
  const n = NOUNS[random[1] % NOUNS.length];
  const d = 10 + (random[2] % 90);
  return `${a} ${n} ${d}`;
}
