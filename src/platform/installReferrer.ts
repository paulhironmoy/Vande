/**
 * Install-referrer handoff: an invite survives installing the app.
 *
 *   1. A friend opens https://<web>/i/<token> in the browser (no app needed) and may tap "Get the app".
 *   2. That button opens playStoreUrl(): the Play Store listing with `referrer=vc_invite=<token>&vc_a=<code>`.
 *   3. On the first launch the native InstallReferrer plugin (Play Install Referrer API, see docs/INFRASTRUCTURE.md)
 *      returns that referrer string once; this module turns it into vandecricket://i/<token> for DeepLinkSource.
 * A highlight landing (https://<web>/h/<code>) does the same with `referrer=vc_h=<code>` → vandecricket://h/<code>.
 * The referrer holds an invite token or a highlight code and an attribution code only (no personal data), and is
 * read once; `onInstall` reports the install against the attribution code (POST /v1/attribution, event "install").
 */
import type { SecureStore } from '@/contracts';
import { ATTRIBUTION_RE, HIGHLIGHT_CODE_RE, INVITE_TOKEN_RE } from '@/net/shared/ids';
import { nativePlugin, type PluginBox } from './capacitor';

export const PLAY_PACKAGE = 'in.vande.cricket';
const READ_FLAG = 'vc.referrer.read';
/** The attribution code of an attributed install, kept until src/net/attribution.ts has reported it. */
export const INSTALL_CODE_KEY = 'vc.attr.install';

export function playStoreUrl(target: { token: string; attribution?: string | null } | { highlight: string }, pkg = PLAY_PACKAGE): string {
  const parts: string[] = [];
  if ('highlight' in target) {
    if (HIGHLIGHT_CODE_RE.test(target.highlight)) parts.push(`vc_h=${target.highlight}`);
  } else {
    parts.push(`vc_invite=${target.token}`);
    if (target.attribution && ATTRIBUTION_RE.test(target.attribution)) parts.push(`vc_a=${target.attribution}`);
  }
  const referrer = parts.length ? `&referrer=${encodeURIComponent(parts.join('&'))}` : '';
  return `https://play.google.com/store/apps/details?id=${pkg}${referrer}`;
}

function referrerParams(referrer: string | null | undefined): URLSearchParams | null {
  if (!referrer) return null;
  try {
    return new URLSearchParams(/%[0-9a-f]{2}/i.test(referrer) ? decodeURIComponent(referrer) : referrer);
  } catch {
    return null;
  }
}

/** The highlight code carried by an install from a highlight landing, if any. */
export function parseHighlightReferrer(referrer: string | null | undefined): { code: string } | null {
  const code = referrerParams(referrer)?.get('vc_h');
  return code && HIGHLIGHT_CODE_RE.test(code) ? { code } : null;
}

export function parseInstallReferrer(referrer: string | null | undefined): { token: string; attribution: string | null } | null {
  const params = referrerParams(referrer);
  if (!params) return null;
  const token = params.get('vc_invite');
  if (!token || !INVITE_TOKEN_RE.test(token)) return null;
  const a = params.get('vc_a');
  return { token, attribution: a && ATTRIBUTION_RE.test(a) ? a : null };
}

/** The native plugin's interface (Android: com.android.installreferrer). */
export interface InstallReferrerPlugin {
  getReferrer(): Promise<{ referrer: string | null }>;
}

export function createInstallReferrerSource(o: {
  plugin: InstallReferrerPlugin | null;
  store: SecureStore;
  timeoutMs?: number;
  /** Called once with the attribution code of an attributed install (best effort; never blocks the launch). */
  onInstall?: (code: string) => void;
}): { pendingInviteUrl(): Promise<string | null> } {
  return {
    async pendingInviteUrl() {
      if (!o.plugin || (await o.store.get(READ_FLAG))) return null;
      await o.store.set(READ_FLAG, '1');
      const timeout = new Promise<{ referrer: null }>((resolve) => setTimeout(() => resolve({ referrer: null }), o.timeoutMs ?? 3_000));
      const answer = await Promise.race([o.plugin.getReferrer().catch(() => ({ referrer: null })), timeout]);
      const report = (code: string) => {
        void o.store.set(INSTALL_CODE_KEY, code).catch(() => undefined);
        try {
          o.onInstall?.(code);
        } catch {
          /* attribution is best effort */
        }
      };
      const r = parseInstallReferrer(answer.referrer);
      if (r) {
        if (r.attribution) report(r.attribution);
        return `vandecricket://i/${r.token}${r.attribution ? `?a=${r.attribution}` : ''}`;
      }
      const h = parseHighlightReferrer(answer.referrer);
      if (!h) return null;
      report(h.code);
      return `vandecricket://h/${h.code}`;
    },
  };
}

/** The native referrer plugin, boxed (never resolve a promise with the proxy itself, see PluginBox). */
export function nativeInstallReferrer(): Promise<PluginBox<InstallReferrerPlugin> | null> {
  return nativePlugin<InstallReferrerPlugin>('VandeInstallReferrer').catch(() => null);
}
