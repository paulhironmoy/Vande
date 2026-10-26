/**
 * Alias disguises found in the security review (docs/SECURITY.md, "Offensive aliases"): look-alike letters from other
 * scripts and phonetic blocks, spelled-out abbreviations and a few spellings. Every one must be refused; names in the
 * scripts the app ships, accents and Indian transliteration must still pass.
 */
import { describe, expect, it } from 'vitest';
import { checkAlias, checkGroupName, checkMessage } from '@/net/shared/alias';

const reason = (s: string) => {
  const r = checkAlias(s);
  return r.ok ? 'ok' : r.reason;
};

describe('alias filter: review bypasses', () => {
  it('refuses look-alike letters from other scripts and phonetic blocks', () => {
    for (const bad of [
      'Fսck', // Armenian ս
      'fսck you',
      'Fʋck', // IPA ʋ
      'ʙɪᴛᴄʜ', // small capitals
      'ᴄʜᴜᴛɪʏᴀ',
      'Ꮇadarchod', // Cherokee Ꮇ
      'Bіtch Queen', // Cyrillic і inside a Latin word
      'ꜰuck', // Latin small capital F (Latin Extended-D)
      'fu̴ck', // a stray combining overlay
    ]) {
      expect(reason(bad), bad).not.toBe('ok');
    }
  });

  it('refuses spelled-out abbreviations and the listed spellings', () => {
    for (const bad of ['B C', 'M.C.', 'm c', 'B.S.D.K', 'fvck', 'phuk', 'Phuk Off']) expect(reason(bad), bad).toBe('offensive');
    for (const bad of ['A D M I N', 'I.C.C']) expect(reason(bad), bad).toBe('reserved');
  });

  it('refuses mixing scripts inside one word, and scripts the app does not ship', () => {
    expect(reason('Viratविराट')).toBe('characters');
    expect(reason('Virat१८')).toBe('characters');
    expect(reason('Мария')).toBe('characters'); // Cyrillic
    expect(reason('Ἀλέξης')).toBe('characters'); // Greek
    expect(reason('محمد')).toBe('characters'); // Arabic (not a shipped script)
  });

  it('still accepts names in every shipped script, accents and Indian transliteration', () => {
    for (const ok of ['विराट कोहली', 'লক্ষ্মী', 'சச்சின்', 'ਸਿੰਘ ਜੀ', 'ધોની', 'ಕುಂಬ್ಳೆ', 'సచిన్', 'മോഹൻ', 'Virat विराट', 'José Ramírez', 'Zoë', "D'Souza", 'Kṛṣṇa Rao', 'Łukasz', 'Kohli18', 'B.C. Roy', 'MC Mary Kom Fan']) {
      // 'MC Mary Kom Fan' stays refused by the whole-word rule for "MC"; everything else passes.
      if (ok === 'MC Mary Kom Fan') expect(reason(ok), ok).toBe('offensive');
      else expect(reason(ok), ok).toBe('ok');
    }
  });

  it('group names and room messages follow the same script rule', () => {
    expect(checkGroupName('ʙɪᴛᴄʜ Club').ok).toBe(false);
    expect(checkGroupName('IIT मुंबई (2027)').ok).toBe(true);
    expect(checkMessage('ᴄʜᴜᴛɪʏᴀ').ok).toBe(false);
    expect(checkMessage('Good luck, see you at the reveal!').ok).toBe(true);
  });
});
