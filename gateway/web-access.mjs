import crypto from 'node:crypto';

// Explicit origins only. No wildcard credentials, no forwarding of arbitrary URLs.
export class WebAccess {
  constructor(origins = []) {
    this.origins = new Set(origins.map(value => {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.origin !== value) throw new Error('webOrigins must contain exact HTTPS origins');
      return value;
    }));
    this.tickets = new Map();
  }
  accepts(origin) { return typeof origin === 'string' && this.origins.has(origin); }
  issue(origin) {
    if (!this.accepts(origin)) return null;
    for (const [key, value] of this.tickets) if (value.expires <= Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 1024) return null;
    const ticket = crypto.randomBytes(32).toString('base64url');
    this.tickets.set(ticket, {origin, expires: Date.now() + 30000});
    return ticket;
  }
  redeem(ticket, origin) {
    const value = this.tickets.get(ticket);
    if (!value || value.origin !== origin || !this.accepts(origin)) return false;
    this.tickets.delete(ticket);
    return value.expires > Date.now();
  }
  cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true; // Native clients keep their existing bearer flow.
    if (!this.accepts(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }
}
