import crypto from 'node:crypto';

// Only one invitation is active per computer. No persistent credential is in a QR.
export class PairingInvitations {
  constructor(now = Date.now) { this.now = now; this.invitation = null; }
  create() {
    const code = crypto.randomBytes(32).toString('base64url');
    this.invitation = {code, expiresAt: this.now() + 120000};
    return {...this.invitation};
  }
  redeem(code) {
    const current = this.invitation;
    if (!current || current.expiresAt <= this.now() || typeof code !== 'string') return false;
    const input = Buffer.from(code), expected = Buffer.from(current.code);
    if (input.length !== expected.length || !crypto.timingSafeEqual(input, expected)) return false;
    this.invitation = null; // consume synchronously before any async response
    return true;
  }
}
