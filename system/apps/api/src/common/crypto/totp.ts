import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238, the format of Google / Microsoft Authenticator, Authy, 1Password):
 * HMAC-SHA1, 6 digits, 30 second steps. No third-party dependency.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** a new 160-bit secret (base32) */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 15;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_PERIOD);

/**
 * Checks a code against the current step and one step before / after (clock drift).
 * Returns the matched step, or null. Steps at or before `lastStep` are refused (a code works once).
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null | undefined, now = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const step = currentStep(now);
  let match: number | null = null;
  for (const s of [step - 1, step, step + 1]) {
    // compare every candidate (constant work), remember the match
    if (timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(c)) && match === null) match = s;
  }
  if (match === null || (lastStep !== null && lastStep !== undefined && match <= lastStep)) return null;
  return match;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_PERIOD}`;
}

/** 10 one-time recovery codes, e.g. "k7q2-9xwm" (shown once, stored hashed) */
export function newRecoveryCodes(n = 10): string[] {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => chars[x % chars.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
