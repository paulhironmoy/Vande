/**
 * Where the player is running Practice, as far as the camera screens need to know: which browser (so the steps to
 * allow a blocked camera are the ones they will see), and whether the page sits inside another app's own browser
 * (Instagram, Facebook and the like), where the camera usually cannot work and the only honest help is to open the page
 * in a real browser.
 *
 * Everything here is a pure function of the user agent string, so it is tested with plain strings. The user agents
 * below are written from general knowledge of how these apps identify themselves and are UNPROVEN on real devices: when
 * one is missed, the player simply gets the ordinary blocked or no-camera steps, which still end in one tap to mouse or
 * touch. Nothing here is sent anywhere, and nothing is stored.
 */

/** The browser the steps are written for (copy: `practice.camera.trouble.blocked.<family>`). */
export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'android' | 'android_browser' | 'other';

export type Platform = 'android' | 'ios' | 'desktop';

export interface CameraEnvironment {
  family: BrowserFamily;
  platform: Platform;
  /** The name of the app whose built-in browser this is, or null in a real browser (and in this app's own shell). */
  inApp: string | null;
}

/** [name, pattern]: the first that matches names the app. Order matters (Messenger before Facebook). */
const IN_APP: ReadonlyArray<readonly [string, RegExp]> = [
  ['Instagram', /\bInstagram\b/],
  ['Messenger', /\bMessenger(?:Lite)?\b|FB_IAB\/MESSENGER/],
  ['Facebook', /\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bFBIOS\b|\bFBSS\b/],
  ['Snapchat', /\bSnapchat\b/],
  ['TikTok', /\bmusical_ly\b|\bTikTok\b|BytedanceWebview|\btrill\b/],
  ['Twitter', /\bTwitter\b/],
  ['LinkedIn', /\bLinkedInApp\b/],
  ['WeChat', /\bMicroMessenger\b/],
  ['Line', /\bLine\/\d/],
  ['Pinterest', /\bPinterest\b/],
  ['Kakao', /\bKAKAOTALK\b/i],
  ['Google', /\bGSA\/\d/],
];

/** The in-app browser the user agent names, or null. `native` is this app's own shell, which is never "in another app". */
export function inAppBrowser(ua: string, native: boolean): string | null {
  if (native) return null;
  for (const [name, re] of IN_APP) if (re.test(ua)) return name;
  // A bare Android WebView (the "; wv)" marker) or an iPhone web view without the Safari token is some app's own window.
  if (/Android/.test(ua) && /;\s*wv\)/.test(ua)) return 'WebView';
  if (/\b(iPhone|iPad|iPod)\b/.test(ua) && !/Safari\//.test(ua)) return 'WebView';
  return null;
}

export function platformOf(ua: string, native: boolean): Platform {
  if (native || /Android/.test(ua)) return 'android';
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return 'ios';
  return 'desktop';
}

export function browserFamily(ua: string, native: boolean): BrowserFamily {
  if (native) return 'android';
  const platform = platformOf(ua, false);
  if (platform === 'android') return 'android_browser';
  // Every browser on an iPhone is Safari underneath, but only Safari itself has Safari's settings.
  if (platform === 'ios') {
    return /\bSafari\//.test(ua) && !/\b(CriOS|FxiOS|EdgiOS|OPiOS|GSA)\b/.test(ua) ? 'safari' : 'other';
  }
  if (/\bEdg(?:e)?\//.test(ua)) return 'edge';
  if (/\bFirefox\//.test(ua)) return 'firefox';
  if (/\bOPR\/|\bOpera\b|\bSamsungBrowser\b/.test(ua)) return 'other';
  if (/\bChrome\/|\bChromium\//.test(ua)) return 'chrome';
  if (/\bSafari\//.test(ua)) return 'safari';
  return 'other';
}

export function readEnvironment(ua: string, native: boolean): CameraEnvironment {
  return { family: browserFamily(ua, native), platform: platformOf(ua, native), inApp: inAppBrowser(ua, native) };
}

/** The user agent of this page ('' where there is none: tests, server). */
export function currentUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

/**
 * An Android link that opens this page in Chrome (and in the default browser when Chrome is not installed). The app
 * that shows the page may refuse to follow it; that is why "Copy link" is always offered beside it. Only for http(s).
 */
export function openInChromeUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const scheme = url.protocol.slice(0, -1);
  const rest = `${url.host}${url.pathname}${url.search}`;
  return `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
    url.toString(),
  )};end`;
}

/** The link to copy: this page without a fragment (an in-app browser's own state is not worth carrying). */
export function linkToCopy(href: string): string {
  try {
    const url = new URL(href);
    url.hash = '';
    return url.toString();
  } catch {
    return href;
  }
}
