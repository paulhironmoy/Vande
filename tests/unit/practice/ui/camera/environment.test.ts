/**
 * Where the player is running Practice, from the user agent alone: which browser's steps to show for a blocked camera,
 * and whether the page sits inside another app's own browser. The user agents are written as these apps and browsers
 * identify themselves in general; real devices are UNPROVEN, and a miss only means the ordinary steps are shown.
 */
import { describe, expect, it } from 'vitest';
import {
  browserFamily,
  inAppBrowser,
  linkToCopy,
  openInChromeUrl,
  platformOf,
  readEnvironment,
} from '@/practice/ui/camera/environment';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EDGE_WIN = `${CHROME_WIN} Edg/131.0.0.0`;
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const INSTAGRAM_ANDROID = `${CHROME_ANDROID} Instagram 330.0.0.40.97 Android (34/14; 420dpi; 1080x2400; Google; Pixel 7)`;
const INSTAGRAM_IOS = `${SAFARI_IOS} Instagram 330.0.0.40.97`;
const FACEBOOK_ANDROID = `${CHROME_ANDROID} [FB_IAB/FB4A;FBAV/450.0.0.38.108;]`;
const FACEBOOK_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/450.0;]';
const WEBVIEW_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36';
const WEBVIEW_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('browserFamily: the steps that match what the player sees', () => {
  it('names the desktop browsers', () => {
    expect(browserFamily(CHROME_WIN, false)).toBe('chrome');
    expect(browserFamily(EDGE_WIN, false)).toBe('edge');
    expect(browserFamily(FIREFOX_MAC, false)).toBe('firefox');
    expect(browserFamily(SAFARI_MAC, false)).toBe('safari');
  });

  it('uses the Android browser steps for any browser on an Android phone, and the app steps inside this app', () => {
    expect(browserFamily(CHROME_ANDROID, false)).toBe('android_browser');
    expect(browserFamily(CHROME_ANDROID, true)).toBe('android');
  });

  it('gives Safari its own steps on an iPhone and the general ones to every other browser there', () => {
    expect(browserFamily(SAFARI_IOS, false)).toBe('safari');
    expect(browserFamily(CHROME_IOS, false)).toBe('other');
  });

  it('falls back to the general steps for anything it does not know', () => {
    expect(browserFamily('', false)).toBe('other');
    expect(browserFamily('SomethingElse/1.0', false)).toBe('other');
  });
});

describe("inAppBrowser: another app's own window", () => {
  it('recognises the common ones', () => {
    expect(inAppBrowser(INSTAGRAM_ANDROID, false)).toBe('Instagram');
    expect(inAppBrowser(INSTAGRAM_IOS, false)).toBe('Instagram');
    expect(inAppBrowser(FACEBOOK_ANDROID, false)).toBe('Facebook');
    expect(inAppBrowser(FACEBOOK_IOS, false)).toBe('Facebook');
    expect(inAppBrowser('Mozilla/5.0 (iPhone) Snapchat/12.0', false)).toBe('Snapchat');
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 13) MicroMessenger/8.0', false)).toBe('WeChat');
  });

  it("calls a bare Android web view or an iPhone web view without the Safari token another app's window", () => {
    expect(inAppBrowser(WEBVIEW_ANDROID, false)).toBe('WebView');
    expect(inAppBrowser(WEBVIEW_IOS, false)).toBe('WebView');
  });

  it("never calls a real browser, or this app's own Android shell, an in-app browser", () => {
    for (const ua of [CHROME_WIN, EDGE_WIN, FIREFOX_MAC, SAFARI_MAC, SAFARI_IOS, CHROME_IOS, CHROME_ANDROID]) {
      expect(inAppBrowser(ua, false), ua).toBeNull();
    }
    // The shell is an Android web view by construction.
    expect(inAppBrowser(WEBVIEW_ANDROID, true)).toBeNull();
    expect(inAppBrowser(INSTAGRAM_ANDROID, true)).toBeNull();
  });
});

describe('platformOf and readEnvironment', () => {
  it('says Android, iOS or desktop', () => {
    expect(platformOf(CHROME_ANDROID, false)).toBe('android');
    expect(platformOf(CHROME_WIN, true)).toBe('android');
    expect(platformOf(SAFARI_IOS, false)).toBe('ios');
    expect(platformOf(CHROME_WIN, false)).toBe('desktop');
  });

  it('puts the three together', () => {
    expect(readEnvironment(INSTAGRAM_ANDROID, false)).toEqual({
      family: 'android_browser',
      platform: 'android',
      inApp: 'Instagram',
    });
    expect(readEnvironment(CHROME_WIN, false)).toEqual({ family: 'chrome', platform: 'desktop', inApp: null });
  });
});

describe('the links', () => {
  it('builds an Android link that asks Chrome to open this page, with the page itself as the fallback', () => {
    const url = openInChromeUrl('https://play.example.test/practice?x=1')!;
    expect(url.startsWith('intent://play.example.test/practice?x=1#Intent;')).toBe(true);
    expect(url).toContain('scheme=https;');
    expect(url).toContain('package=com.android.chrome;');
    expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent('https://play.example.test/practice?x=1')};`);
    expect(url.endsWith(';end')).toBe(true);
  });

  it('builds no link for anything but a web page', () => {
    expect(openInChromeUrl('not a url')).toBeNull();
    expect(openInChromeUrl('file:///etc/passwd')).toBeNull();
    expect(openInChromeUrl('javascript:alert(1)')).toBeNull();
  });

  it('copies the page without its fragment', () => {
    expect(linkToCopy('https://play.example.test/practice?x=1#state')).toBe('https://play.example.test/practice?x=1');
    expect(linkToCopy('nonsense')).toBe('nonsense');
  });
});
