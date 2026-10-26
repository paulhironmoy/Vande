/**
 * Server-side push delivery behind an adapter. Production: Firebase Cloud Messaging HTTP v1 with a service account
 * (secret FCM_SERVICE_ACCOUNT; OAuth2 JWT-bearer flow signed with RS256 in WebCrypto). Messages carry ids and a
 * kind only; the visible text comes from Android string resources named by `title_loc_key`/`body_loc_key`
 * (notif_<kind>_title / notif_<kind>_body), so no player text and no spoiler ever passes through FCM. Without the
 * secret, notifications are counted and dropped. Tests use MockPushSender.
 */
import type { NotifyKind } from './messages';
import { fromBase64Url, toBase64Url, utf8 } from '../security/encoding';

export interface PushMessage {
  kind: NotifyKind;
  matchId: string;
  cupId?: string;
  jobId?: string;
  collapseKey: string;
}

export type PushResult = 'sent' | 'invalid_token' | 'retry';

export interface PushSender {
  readonly name: string;
  send(token: string, platform: string, message: PushMessage): Promise<PushResult>;
}

export class MockPushSender implements PushSender {
  readonly name = 'mock';
  sent: Array<{ token: string; platform: string; message: PushMessage }> = [];
  /** Tokens the "provider" reports as unregistered. */
  invalid = new Set<string>();
  /** The next N sends report a transient failure. */
  failNext = 0;
  async send(token: string, platform: string, message: PushMessage): Promise<PushResult> {
    if (this.failNext > 0) {
      this.failNext--;
      return 'retry';
    }
    if (this.invalid.has(token)) return 'invalid_token';
    this.sent.push({ token, platform, message });
    return 'sent';
  }
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> | null {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return fromBase64Url(b64);
}

export function fcmSender(opts: { serviceAccountJson: string; fetch(input: string, init?: RequestInit): Promise<Response>; now(): number }): PushSender | null {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(opts.serviceAccountJson) as ServiceAccount;
  } catch {
    return null;
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
  const der = pemToPkcs8(sa.private_key);
  if (!der) return null;
  const keyPromise = crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']).catch(() => null);
  let cached: { token: string; exp: number } | null = null;

  async function accessToken(): Promise<string | null> {
    const now = opts.now();
    if (cached && cached.exp - 60_000 > now) return cached.token;
    const key = await keyPromise;
    if (!key) return null;
    const iat = Math.floor(now / 1000);
    const header = toBase64Url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claims = toBase64Url(
      utf8(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })),
    );
    const sig = toBase64Url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${header}.${claims}`))));
    const res = await opts.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${sig}`,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    cached = { token: body.access_token, exp: now + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  return {
    name: 'fcm',
    async send(token, _platform, message) {
      const bearer = await accessToken();
      if (!bearer) return 'retry';
      const res = await opts.fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            data: { kind: message.kind, matchId: message.matchId, ...(message.cupId ? { cupId: message.cupId } : {}), ...(message.jobId ? { jobId: message.jobId } : {}) },
            android: {
              collapse_key: message.collapseKey.slice(0, 64),
              notification: { title_loc_key: `notif_${message.kind}_title`, body_loc_key: `notif_${message.kind}_body`, channel_id: 'matches', tag: message.matchId },
            },
          },
        }),
      });
      if (res.ok) return 'sent';
      if (res.status === 404 || res.status === 400) return 'invalid_token';
      return 'retry';
    },
  };
}
