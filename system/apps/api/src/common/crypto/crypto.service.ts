import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { env } from '../../config/env';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

/**
 * Central cryptography service.
 *  - AES-256-GCM authenticated encryption for fields and files (format: v1:iv:tag:cipher)
 *  - HMAC-SHA256 blind index for searching encrypted values
 *  - Argon2id password hashing
 */
@Injectable()
export class CryptoService {
  private readonly key = Buffer.from(env.ENCRYPTION_KEY, 'base64').subarray(0, 32);
  private readonly hmacKey = Buffer.from(env.HMAC_KEY, 'base64');

  isEncrypted(value: unknown): boolean {
    return typeof value === 'string' && value.startsWith(VERSION + ':') && value.split(':').length === 4;
  }

  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return plain === '' ? '' : null;
    if (this.isEncrypted(plain)) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
  }

  decrypt(value: string | null | undefined): string | null {
    if (!value) return value ?? null;
    if (!this.isEncrypted(value)) return value;
    const [, ivB64, tagB64, dataB64] = value.split(':');
    try {
      const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null; // tampered or wrong key - never leak details
    }
  }

  /** Encrypt binary payload (files). Layout: [12 iv][16 tag][cipher] */
  encryptBuffer(buf: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]);
  }

  decryptBuffer(buf: Buffer): Buffer {
    const decipher = createDecipheriv(ALGO, this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  }

  /** Mask sensitive value for display: ********1234 */
  mask(value: string | null | undefined, visible = 4): string | null {
    if (!value) return value ?? null;
    if (value.length <= visible) return '*'.repeat(value.length);
    return '*'.repeat(Math.min(8, value.length - visible)) + value.slice(-visible);
  }

  blindIndex(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value.trim().toLowerCase()).digest('hex');
  }

  sha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  randomToken(bytes = 48): string {
    return randomBytes(bytes).toString('base64url');
  }

  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  private readonly pepper = Buffer.from(env.PASSWORD_PEPPER, 'base64');

  /** HMAC-SHA256 with the server-side pepper: a stolen database alone is not enough to brute-force passwords */
  private peppered(password: string) {
    return createHmac('sha256', this.pepper).update(password.normalize('NFKC')).digest('base64');
  }

  /**
   * Salting & hashing: Argon2id (memory-hard, random 16-byte salt per password, OWASP parameters)
   * over the peppered password. Stored as `p1$<argon2 encoded hash incl. salt>`.
   */
  async hashPassword(password: string): Promise<string> {
    return 'p1$' + (await argonHash(this.peppered(password), { memoryCost: 19456, timeCost: 2, parallelism: 1 }));
  }

  verifyPassword(hash: string, password: string): Promise<boolean> {
    if (hash.startsWith('p1$')) return argonVerify(hash.slice(3), this.peppered(password)).catch(() => false);
    return argonVerify(hash, password).catch(() => false); // legacy (pre-pepper) hash
  }

  /** true when the stored hash uses an older scheme and should be upgraded at the next successful login */
  needsRehash(hash: string) {
    return !hash.startsWith('p1$');
  }
}
