/**
 * What the troubleshooting panels need to know about the page they are on, read once from the browser: which browser
 * (so the steps to allow a blocked camera are the ones the player will see), whether it is an Android phone (the only
 * place a link can ask Chrome to open this page), the link to copy, and the way to this app's settings where the camera
 * core can open them. Kept apart from the panels so tests hand them a plain object.
 */
import { isNativePlatform } from '@/platform';
import { currentUserAgent, linkToCopy, openInChromeUrl, readEnvironment } from './environment';
import type { CameraController } from './controller';
import type { TroubleEnv } from './panelViews';

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function pageTroubleEnv(controller: CameraController): TroubleEnv {
  const native = isNativePlatform();
  const env = readEnvironment(currentUserAgent(), native);
  const link = typeof window === 'undefined' ? '' : linkToCopy(window.location.href);
  return {
    family: env.family,
    platform: env.platform,
    native,
    link,
    chromeUrl: openInChromeUrl(link),
    canOpenSettings: native && controller.canOpenSettings(),
    openSettings: () => void controller.openSettings(),
    openChrome: (url) => window.location.assign(url),
    copy: copyText,
  };
}
