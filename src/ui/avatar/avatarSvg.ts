/**
 * Generated, original player portrait as SVG markup (no uploads, no likenesses). One geometry for the React
 * <Avatar>, share cards and highlight overlays. Night-match lighting: indigo backdrop, kit-coloured shoulders, an
 * amber floodlight key and a cyan rim on the face.
 */
import type { AvatarSpec, KitSpec } from '@/contracts';
import { avatarTraits, kitForSeed } from './traits';

const esc = (v: string) => v.replace(/[^#0-9a-zA-Z.\-%() ,]/g, '');

/** Inner markup of the 120x120 portrait (defs and shapes). `id` keeps gradient and clip ids unique per instance. */
export function avatarInner(avatar: AvatarSpec, kit: KitSpec | undefined, id: string): string {
  const tr = avatarTraits(avatar.seed);
  const k = kit ?? kitForSeed(avatar.seed);
  const primary = esc(k.primary);
  const secondary = esc(k.secondary);
  const face = { oval: [21, 26], round: [23, 24], square: [22, 24.5], long: [20, 27.5] }[tr.face];
  const [rx, ry] = face;
  const cx = 60;
  const cy = 54;
  const eyeY = cy - 2;
  const browY = eyeY - 8;
  const mouthY = cy + 13;
  const hairTop = cy - ry - 3;

  const hair = (() => {
    switch (tr.hairStyle) {
      case 'crop':
        return `M${cx - rx - 1} ${cy - 4} Q${cx - rx - 2} ${hairTop - 2} ${cx} ${hairTop - 3} Q${cx + rx + 2} ${hairTop - 2} ${cx + rx + 1} ${cy - 4} Q${cx + rx - 3} ${cy - ry + 6} ${cx} ${cy - ry + 3} Q${cx - rx + 3} ${cy - ry + 6} ${cx - rx - 1} ${cy - 4}Z`;
      case 'wavy':
        return `M${cx - rx - 3} ${cy + 2} Q${cx - rx - 6} ${hairTop - 4} ${cx - 4} ${hairTop - 4} Q${cx + rx + 8} ${hairTop - 6} ${cx + rx + 3} ${cy + 2} Q${cx + rx - 1} ${cy - ry + 8} ${cx + 6} ${cy - ry + 5} Q${cx} ${cy - ry + 9} ${cx - 6} ${cy - ry + 5} Q${cx - rx + 1} ${cy - ry + 9} ${cx - rx - 3} ${cy + 2}Z`;
      case 'curly':
        return `M${cx - rx - 4} ${cy} ${Array.from({ length: 7 }, (_, i) => {
          const a = Math.PI + (i / 6) * Math.PI;
          const x = cx + Math.cos(a) * (rx + 3);
          const y = cy - 6 + Math.sin(a) * (ry + 2);
          return `Q${x - 2} ${y - 7} ${x + 4} ${y}`;
        }).join(' ')} L${cx + rx + 3} ${cy} Q${cx} ${cy - ry + 10} ${cx - rx - 4} ${cy}Z`;
      case 'side_part':
        return `M${cx - rx - 2} ${cy - 2} Q${cx - rx} ${hairTop - 3} ${cx + 4} ${hairTop - 4} Q${cx + rx + 5} ${hairTop} ${cx + rx + 2} ${cy - 2} Q${cx + rx - 4} ${cy - ry + 5} ${cx - 8} ${cy - ry + 9} Q${cx - rx + 2} ${cy - ry + 10} ${cx - rx - 2} ${cy - 2}Z`;
      case 'tied':
        return `M${cx - rx - 2} ${cy - 2} Q${cx - rx - 2} ${hairTop - 3} ${cx} ${hairTop - 4} Q${cx + rx + 2} ${hairTop - 3} ${cx + rx + 2} ${cy - 2} Q${cx} ${cy - ry + 6} ${cx - rx - 2} ${cy - 2}Z M${cx - 7} ${hairTop - 9} a7 6 0 1 0 14 0 a7 6 0 1 0 -14 0Z`;
      default:
        return `M${cx - rx} ${cy - 6} Q${cx - rx} ${hairTop} ${cx} ${hairTop - 1} Q${cx + rx} ${hairTop} ${cx + rx} ${cy - 6} Q${cx} ${cy - ry + 3} ${cx - rx} ${cy - 6}Z`;
    }
  })();

  const eye = (x: number) => {
    if (tr.eyes === 'round') return `<circle cx="${x}" cy="${eyeY}" r="2.4" fill="#120d1c"/>`;
    if (tr.eyes === 'narrow') return `<path d="M${x - 3.2} ${eyeY} Q${x} ${eyeY - 2} ${x + 3.2} ${eyeY}" stroke="#120d1c" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    return `<path d="M${x - 3.6} ${eyeY} Q${x} ${eyeY - 3.4} ${x + 3.6} ${eyeY} Q${x} ${eyeY + 2.4} ${x - 3.6} ${eyeY}Z" fill="#120d1c"/>`;
  };

  const browW = tr.brow === 'bold' ? 2.6 : tr.brow === 'straight' ? 2 : 1.6;
  const browCurve = tr.brow === 'straight' ? 0 : 1.6;
  const mouth =
    tr.expression === 'grin'
      ? `M${cx - 7} ${mouthY - 1} Q${cx} ${mouthY + 6} ${cx + 7} ${mouthY - 1} Q${cx} ${mouthY + 2} ${cx - 7} ${mouthY - 1}Z`
      : tr.expression === 'smile'
        ? `M${cx - 6} ${mouthY} Q${cx} ${mouthY + 4.2} ${cx + 6} ${mouthY}`
        : `M${cx - 5} ${mouthY + 1} Q${cx} ${mouthY + 1.8} ${cx + 5} ${mouthY + 1}`;

  const pattern = (() => {
    switch (k.pattern) {
      case 'stripes':
        return [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${20 + i * 16}" y="84" width="5" height="40" fill="${secondary}" opacity="0.85"/>`).join('');
      case 'hoops':
        return [0, 1].map((i) => `<rect x="10" y="${98 + i * 12}" width="100" height="5" fill="${secondary}" opacity="0.85"/>`).join('');
      case 'chevron':
        return `<path d="M30 96 L60 112 L90 96 L90 104 L60 120 L30 104Z" fill="${secondary}" opacity="0.9"/>`;
      case 'sash':
        return `<path d="M34 86 L46 86 L92 128 L80 128Z" fill="${secondary}" opacity="0.9"/>`;
      default:
        return '';
    }
  })();

  const headwear = (() => {
    if (tr.headwear === 'cap')
      return `<path d="M${cx - rx - 2} ${cy - 8} Q${cx - rx} ${hairTop - 8} ${cx} ${hairTop - 9} Q${cx + rx} ${hairTop - 8} ${cx + rx + 2} ${cy - 8}Z" fill="${primary}"/><path d="M${cx - rx - 3} ${cy - 8} Q${cx} ${cy - 13} ${cx + rx + 12} ${cy - 6} L${cx + rx + 11} ${cy - 3} Q${cx} ${cy - 9} ${cx - rx - 3} ${cy - 5}Z" fill="${secondary}"/>`;
    if (tr.headwear === 'band') return `<rect x="${cx - rx - 1}" y="${cy - 15}" width="${rx * 2 + 2}" height="4.5" rx="2" fill="${secondary}"/>`;
    if (tr.headwear === 'patka')
      return `<path d="M${cx - rx - 2} ${cy - 6} Q${cx - rx - 3} ${hairTop - 6} ${cx} ${hairTop - 8} Q${cx + rx + 3} ${hairTop - 6} ${cx + rx + 2} ${cy - 6} Q${cx} ${cy - 12} ${cx - rx - 2} ${cy - 6}Z" fill="${secondary}"/><circle cx="${cx}" cy="${hairTop - 8}" r="6" fill="${secondary}"/>`;
    return '';
  })();

  const beard = (() => {
    if (tr.beard === 'none') return '';
    if (tr.beard === 'moustache') return `<path d="M${cx - 7} ${mouthY - 3} Q${cx} ${mouthY - 7} ${cx + 7} ${mouthY - 3} Q${cx} ${mouthY - 4} ${cx - 7} ${mouthY - 3}Z" fill="${tr.hair}"/>`;
    const full = tr.beard === 'full';
    const d = `M${cx - rx + 1} ${cy + 2} Q${cx - rx + 2} ${cy + ry + (full ? 6 : 1)} ${cx} ${cy + ry + (full ? 8 : 3)} Q${cx + rx - 2} ${cy + ry + (full ? 6 : 1)} ${cx + rx - 1} ${cy + 2} Q${cx + rx - 4} ${cy + 12} ${cx + 6} ${mouthY - 3} Q${cx} ${mouthY - 5} ${cx - 6} ${mouthY - 3} Q${cx - rx + 4} ${cy + 12} ${cx - rx + 1} ${cy + 2}Z`;
    // Stubble is a fine stipple of hair-coloured dots on the jaw, not a translucent block.
    if (tr.beard === 'stubble') return `<path d="${d}" fill="url(#stub${id})" clip-path="url(#face${id})"/>`;
    return `<path d="${d}" fill="${tr.hair}" opacity="0.95"/>`;
  })();

  return [
    `<defs><radialGradient id="bg${id}" cx="35%" cy="25%" r="85%"><stop offset="0%" stop-color="${primary}" stop-opacity="0.55"/><stop offset="55%" stop-color="#151143"/><stop offset="100%" stop-color="#06051f"/></radialGradient>`,
    `<linearGradient id="key${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ffd38a" stop-opacity="0.35"/><stop offset="60%" stop-color="#ffd38a" stop-opacity="0"/></linearGradient>`,
    `<clipPath id="clip${id}"><circle cx="60" cy="60" r="58"/></clipPath><clipPath id="shirt${id}"><path d="M8 124 Q12 90 40 84 L80 84 Q108 90 112 124Z"/></clipPath>`,
    `<clipPath id="face${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry + 2}"/></clipPath>`,
    `<linearGradient id="rim${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="72%" stop-color="#52e2ff" stop-opacity="0"/><stop offset="100%" stop-color="#52e2ff" stop-opacity="0.32"/></linearGradient>`,
    `<pattern id="stub${id}" width="2.6" height="2.6" patternUnits="userSpaceOnUse"><circle cx="1.3" cy="1.3" r="0.62" fill="${tr.hair}" fill-opacity="0.7"/></pattern></defs>`,
    `<g clip-path="url(#clip${id})">`,
    `<rect width="120" height="120" fill="url(#bg${id})"/><path d="M-10 -10 L70 -10 L10 70 L-10 70Z" fill="url(#key${id})"/>`,
    `<path d="M8 124 Q12 90 40 84 L80 84 Q108 90 112 124Z" fill="${primary}"/><g clip-path="url(#shirt${id})">${pattern}</g>`,
    `<path d="M48 84 L60 98 L72 84" fill="none" stroke="${secondary}" stroke-width="4" stroke-linejoin="round"/>`,
    `<rect x="${cx - 9}" y="${cy + ry - 8}" width="18" height="18" rx="6" fill="${tr.skinShade}"/>`,
    `<ellipse cx="${cx - rx - 1}" cy="${cy}" rx="4" ry="6" fill="${tr.skinShade}"/><ellipse cx="${cx + rx + 1}" cy="${cy}" rx="4" ry="6" fill="${tr.skinShade}"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${tr.skin}"/>`,
    tr.face === 'square' ? `<rect x="${cx - rx + 2}" y="${cy + 4}" width="${rx * 2 - 4}" height="${ry - 6}" rx="8" fill="${tr.skin}"/>` : '',
    // The floodlight's cyan rim: a soft wash on the face's right edge (inside the face, never a stray line).
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#rim${id})"/>`,
    beard,
    `<path d="${hair}" fill="${tr.hair}"${tr.hairStyle === 'shaved' ? ' opacity="0.45"' : ''}/>`,
    headwear,
    eye(cx - 8.5),
    eye(cx + 8.5),
    `<path d="M${cx - 13} ${browY + browCurve} Q${cx - 8.5} ${browY - browCurve} ${cx - 4} ${browY + browCurve * 0.4}" stroke="${tr.hair}" stroke-width="${browW}" fill="none" stroke-linecap="round"/>`,
    `<path d="M${cx + 4} ${browY + browCurve * 0.4} Q${cx + 8.5} ${browY - browCurve} ${cx + 13} ${browY + browCurve}" stroke="${tr.hair}" stroke-width="${browW}" fill="none" stroke-linecap="round"/>`,
    `<path d="M${cx - 1} ${eyeY + 3} Q${cx - 3.5} ${eyeY + 9} ${cx} ${eyeY + 10} Q${cx + 2} ${eyeY + 10.5} ${cx + 3} ${eyeY + 9.5}" stroke="${tr.skinShade}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    `<path d="${mouth}" stroke="#4a1f22" stroke-width="${tr.expression === 'grin' ? 0 : 1.8}" fill="${tr.expression === 'grin' ? '#f4ede8' : 'none'}" stroke-linecap="round"/>`,
    `</g><circle cx="60" cy="60" r="58" fill="none" stroke="${secondary}" stroke-opacity="0.75" stroke-width="2"/>`,
  ].join('');
}

/** A standalone SVG document of the portrait (for <img>, canvas drawing and share images). */
export function avatarSvg(avatar: AvatarSpec, kit?: KitSpec, size = 120, id = 'a'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}">${avatarInner(avatar, kit, id)}</svg>`;
}

/** Loads the portrait as an image (for canvas drawing). Resolves once decoded. */
export function avatarImage(avatar: AvatarSpec, kit?: KitSpec, size = 240): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('avatar image failed'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(avatar, kit, size))}`;
  });
}
