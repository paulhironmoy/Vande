#!/usr/bin/env node
/**
 * Prints fresh random secrets for `wrangler dev` in the .dev.vars format (backend/.dev.vars is gitignored):
 *
 *   node backend/local/dev-secrets.mjs > backend/.dev.vars
 *
 * Development values only. Production secrets are generated the same way but set with `wrangler secret put`
 * (docs/INFRASTRUCTURE.md) and never written to a file in the repository.
 */
import { webcrypto as crypto } from 'node:crypto';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));

console.log(
  [
    '# Local development only (wrangler dev). Never commit this file.',
    'ENVIRONMENT=development',
    'ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,https://localhost,capacitor://localhost',
    'PUBLIC_WEB_ORIGIN=http://localhost:5173',
    'PUBLIC_API_ORIGIN=http://127.0.0.1:8787',
    'VERIFY_REVEALS=1',
    // Like the in-process harness: no activity jitter and duels reveal at once (production: 60-600 s and 300 s slots).
    'ACTIVITY_JITTER_S=0',
    'DUEL_REVEAL_SLOT_S=0',
    `RATE_SALT=${random(24)}`,
    `TOKEN_KEYS=dev1:${random(32)}`,
    `DATA_KEYS=dev1:${random(32)}`,
    `IDENTITY_PEPPER=${random(32)}`,
    `DAILY_SALT_KEY=${random(32)}`,
    `RENDER_KEYS=r1:${random(32)}`,
    `ADMIN_TOKEN=${random(32)}`,
    `SIGNING_KEY='${jwk}'`,
  ].join('\n'),
);
