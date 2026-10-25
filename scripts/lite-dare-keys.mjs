#!/usr/bin/env node
/**
 * Prints a fresh ECDSA P-256 key pair for VANDE verified dares and the exact commands to install it.
 * Writes NOTHING to disk and talks to no service: you run the printed commands yourself.
 *
 *   node scripts/lite-dare-keys.mjs
 *
 * - The private key (JWK) belongs only in the Worker secret DARE_SIGNING_KEY. Never commit it or put it in .env files.
 * - The public key (uncompressed point, hex) is safe to publish: it goes into the app build as VITE_DARE_PUBLIC_KEY.
 * Rotating keys: every signature names its key id (the first 8 hex of the public key's SHA-256). Add the new public
 * key to VITE_DARE_PUBLIC_KEYS next to the old one, rebuild and ship the app, then switch the Worker secret to the new
 * private key; once installed apps have updated, drop the old key from the list. Replies signed with a key the app does
 * not list stop verifying and count as ordinary local replies (nothing breaks). See docs/ROLLBACK.md.
 */
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const hex = (buf) => Buffer.from(new Uint8Array(buf)).toString('hex');

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await subtle.exportKey('jwk', pair.privateKey);
const privateJwk = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
const publicHex = hex(await subtle.exportKey('raw', pair.publicKey));

// Self-test: the printed pair signs and verifies the same way the Worker and the app do.
const probe = new TextEncoder().encode('vande-lite-dare|selftest');
const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, probe);
const reimported = await subtle.importKey('raw', Buffer.from(publicHex, 'hex'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
if (!(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, reimported, sig, probe)) || publicHex.length !== 130) {
  console.error('Self-test failed: the generated key pair did not verify. Nothing was printed.');
  process.exit(1);
}
const fingerprint = hex(await subtle.digest('SHA-256', Buffer.from(publicHex, 'hex'))).slice(0, 16);
const keyId = fingerprint.slice(0, 8);

console.log(`VANDE verified dares: a fresh signing key pair. Nothing was written to disk or sent anywhere.

1) PRIVATE key -> Worker secret (keep it secret; never commit it or put it in an .env file).
   From the backend/ folder run the command below and paste the JSON line when it asks for the value:

     npx wrangler secret put DARE_SIGNING_KEY

${privateJwk}

2) PUBLIC key -> app build (safe to publish). Add to .env.local or the CI build environment:

     VITE_DARE_PUBLIC_KEY=${publicHex}
     VITE_LITE_VERIFIED_DARES=1

   When ROTATING, keep the old key valid too: list both in VITE_DARE_PUBLIC_KEYS (comma-separated public keys),
   ship the app, then change the Worker secret. Signatures carry key id ${keyId}.

   (Verified dares also need VITE_COMMUNITY_API_URL, and each player must opt in to community sharing.)

3) Optional, Workers Paid only: full replay verification (signatures marked "dare+twist" instead of "twist").
   In backend/wrangler.toml [vars] set   LITE_VERIFY_REPLAY = "1"

Key id (what signatures carry): ${keyId}
Public key fingerprint (sha256, first 16 hex): ${fingerprint}
Clear your terminal scrollback after copying the private key.`);
