/**
 * No YouTube or OAuth secret, no server-only key name and no upload endpoint may reach the client: neither the client
 * sources (everything under src/, which is all the app and admin bundles can contain) nor a built bundle in dist/
 * when one exists. The YouTube adapter, its OAuth refresh and the render signing keys live only in backend/ and
 * render-service/, which no client module imports. (Vite's import.meta.glob reads the files as raw text.)
 */
import { describe, expect, it } from 'vitest';

const FORBIDDEN: RegExp[] = [
  /YT_CLIENT_SECRET/,
  /YT_REFRESH_TOKEN/,
  /YT_CLIENT_ID/,
  /RENDER_KEYS?\b/,
  /FCM_SERVICE_ACCOUNT/,
  /DAILY_SALT_KEY/,
  /IDENTITY_PEPPER/,
  /\bclient_secret\b/,
  /\brefresh_token\b/,
  /oauth2\.googleapis\.com/,
  /googleapis\.com\/upload/,
  /youtube\/v3\/videos/,
  /uploadType=resumable/,
  /\/v1\/internal\//,
];

const texts = (files: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => typeof e[1] === 'string'));
const sources = texts(import.meta.glob(['/src/**/*.{ts,tsx,js,mjs}', '/index.html', '/admin.html'], { query: '?raw', import: 'default', eager: true }));
const built = texts(import.meta.glob(['/dist/**/*.{js,html}', '/dist-pages/**/*.{js,html}'], { query: '?raw', import: 'default', eager: true }));

function offenders(files: Record<string, string>): string[] {
  const hits: string[] = [];
  for (const [path, text] of Object.entries(files)) for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${path}: ${re}`);
  return hits;
}

describe('client bundle hygiene', () => {
  it('client sources name no YouTube or OAuth secret and no upload endpoint', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(offenders(sources)).toEqual([]);
  });

  it('no client module imports the Worker or the render service', () => {
    const hits = Object.entries(sources).filter(([path, text]) => /\.(ts|tsx)$/.test(path) && /from ['"](\.\.\/)+(backend|render-service)\//.test(text));
    expect(hits.map(([p]) => p)).toEqual([]);
  });

  it('a built bundle (dist/, when present) has none of them either', () => {
    expect(offenders(built)).toEqual([]);
  });
});
