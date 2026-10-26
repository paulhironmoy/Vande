/**
 * Passkey (WebAuthn) linking adapter. The interface is what the routes call; production activation needs a WebAuthn
 * verifier (attestation "none", user verification required, RP id = the web origin's host, origins = the web origin
 * and the Android app's `android:apk-key-hash:` origin), registered challenges stored per session with a short TTL,
 * and PASSKEYS_ENABLED=1. Until then the routes answer 503. docs/SECURITY.md, "Passkeys", lists the steps.
 *
 * The mock below exists for tests and local development only: it accepts `mock-passkey:<credential id>` strings.
 */
export interface PasskeyVerifier {
  /** Verifies a registration response for the signed-in player; returns the credential's stable id. */
  verifyRegistration(uid: string, credential: string, nowMs: number): Promise<{ credentialId: string } | null>;
  /** Verifies an assertion (sign-in for recovery); returns the credential id it belongs to. */
  verifyAssertion(credential: string, nowMs: number): Promise<{ credentialId: string } | null>;
}

const MOCK_RE = /^mock-passkey:([A-Za-z0-9_-]{8,64})$/;

export const mockPasskeyVerifier: PasskeyVerifier = {
  async verifyRegistration(_uid, credential) {
    const m = MOCK_RE.exec(credential);
    return m ? { credentialId: m[1] } : null;
  },
  async verifyAssertion(credential) {
    const m = MOCK_RE.exec(credential);
    return m ? { credentialId: m[1] } : null;
  },
};
