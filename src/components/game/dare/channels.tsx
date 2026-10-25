import type { ReactNode } from 'react';

/** Share targets offered for a dare. Generic monochrome glyphs; the text label names the app (no brand logos). */
export type DareChannel = 'whatsapp' | 'telegram' | 'x' | 'sms' | 'email';

export const DARE_CHANNELS: readonly DareChannel[] = ['whatsapp', 'telegram', 'x', 'sms', 'email'] as const;

export const CHANNEL_LABEL: Record<DareChannel, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  x: 'X',
  sms: 'Messages',
  email: 'Email',
};

export const CHANNEL_GLYPH: Record<DareChannel, ReactNode> = {
  whatsapp: (
    <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5Zm-3 6.2c.4 1.9 2.4 4 4.5 4.6l1.2-1.2 2 .8-.4 1.9c-4.2.4-8.2-3.6-7.8-7.8l1.9-.4.8 2-1.2 1.2Z" />
  ),
  telegram: <path d="M20.5 4.5 3.8 11.2l5.6 2 2 5.6 2.9-3.6 4 2.9 2.2-13.6ZM9.4 13.2l8.4-6.2-6.4 7.6" />,
  x: <path d="M5 19.5 9.5 15l-4-4L16 4.5l3.5 3.5L13 18.5l-4-4M15 6l3 3" />,
  sms: (
    <>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3v-3H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5Z" />
      <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth="2.6" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
};

export function channelUrl(channel: DareChannel, text: string, url: string): string {
  const e = encodeURIComponent;
  switch (channel) {
    case 'whatsapp':
      return `https://wa.me/?text=${e(`${text}\n${url}`)}`;
    case 'telegram':
      return `https://t.me/share/url?url=${e(url)}&text=${e(text)}`;
    case 'x':
      return `https://x.com/intent/post?text=${e(text)}&url=${e(url)}`;
    case 'sms':
      return `sms:?&body=${e(`${text} ${url}`)}`;
    case 'email':
      return `mailto:?subject=${e('A VANDE dare for you')}&body=${e(`${text}\n\n${url}`)}`;
  }
}

/** Opens a target only in response to a tap. http(s) in a new tab without opener/referrer; sms:/mailto: hand off. */
export function openTarget(href: string): void {
  if (href.startsWith('http')) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.href = href;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
