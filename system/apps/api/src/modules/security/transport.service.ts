import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createECDH, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { SettingsService } from '../../common/settings/settings.service';
import { MemoryCache } from '../../common/cache/memory-cache';

export interface Envelope {
  __enc: 1;
  iv: string;
  ct: string;
}

const MAX_SKEW_MS = 5 * 60_000;

/**
 * Application-layer transport security between the PWA and the API (in addition to HTTPS):
 *  - key agreement: ECDH P-256 (browser ephemeral key per page load  x  server static key)
 *  - key derivation: HKDF-SHA256 -> AES-256-GCM key
 *  - every request is signed (GCM tag over METHOD | URL | timestamp | nonce, plus the encrypted body)
 *  - replay protection: timestamp window + single-use nonce
 *  - JSON request and response bodies are encrypted, so they are unreadable in DevTools, proxies and logs
 */
@Injectable()
export class TransportService implements OnModuleInit {
  private readonly logger = new Logger('Transport');
  private ecdh = createECDH('prime256v1');
  private publicRaw = '';

  constructor(private readonly settings: SettingsService, private readonly cache: MemoryCache) {}

  async onModuleInit() {
    const stored = await this.settings.raw('security.transportPrivateKey', null).catch(() => null);
    if (stored) this.ecdh.setPrivateKey(Buffer.from(stored, 'base64'));
    else {
      this.ecdh.generateKeys();
      await this.settings.set('security.transportPrivateKey', this.ecdh.getPrivateKey('base64'), null).catch((e) => this.logger.warn(`Transport key not persisted: ${e.message}`));
    }
    this.publicRaw = this.ecdh.getPublicKey().toString('base64url');
  }

  enabled() {
    return this.settings.bool('security.apiEncryption', null, true);
  }

  publicKey() {
    return this.publicRaw;
  }

  fingerprint() {
    return createHash('sha256').update(this.ecdh.getPublicKey()).digest('hex').match(/.{4}/g)!.slice(0, 8).join(':').toUpperCase();
  }

  private key(clientKey: string): Buffer {
    const id = `tk:${clientKey}`;
    const hit = this.cache.get<Buffer>(id);
    if (hit) return hit;
    let shared: Buffer;
    try {
      shared = this.ecdh.computeSecret(Buffer.from(clientKey, 'base64url'));
    } catch {
      throw new BadRequestException('Invalid client key');
    }
    const k = Buffer.from(hkdfSync('sha256', shared, Buffer.from('kcs-transport-v1'), Buffer.from('aes-256-gcm'), 32));
    return this.cache.set(id, k, 3600);
  }

  /** Validates timestamp + nonce and returns the session key */
  check(clientKey: string, ts: string, nonce: string): Buffer {
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(clientKey) || !/^\d{13}$/.test(ts) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce)) throw new BadRequestException('Request is not signed');
    if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) throw new BadRequestException('Request expired - check the computer clock');
    const seen = `nonce:${clientKey.slice(0, 24)}:${nonce}`;
    if (this.cache.get(seen)) throw new BadRequestException('Replayed request rejected');
    this.cache.set(seen, true, MAX_SKEW_MS / 1000 * 2);
    return this.key(clientKey);
  }

  aad(method: string, url: string, ts: string, nonce: string) {
    return Buffer.from(`${method.toUpperCase()}\n${url}\n${ts}\n${nonce}`);
  }

  decrypt(key: Buffer, env: Envelope, aad: Buffer): Buffer {
    try {
      const iv = Buffer.from(env.iv, 'base64url');
      const raw = Buffer.from(env.ct, 'base64url');
      const d = createDecipheriv('aes-256-gcm', key, iv);
      d.setAAD(aad);
      d.setAuthTag(raw.subarray(raw.length - 16));
      return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
    } catch {
      throw new BadRequestException('Request signature invalid');
    }
  }

  /** X-Sig = base64url(iv) "." base64url(tag) of an empty plaintext: authenticates requests without JSON body */
  verifySig(key: Buffer, sig: string, aad: Buffer) {
    const [iv, tag] = (sig ?? '').split('.');
    if (!iv || !tag) throw new BadRequestException('Request is not signed');
    this.decrypt(key, { __enc: 1, iv, ct: tag }, aad);
  }

  encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Envelope {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(aad);
    const ct = Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
    return { __enc: 1, iv: iv.toString('base64url'), ct: ct.toString('base64url') };
  }

  isEnvelope(v: unknown): v is Envelope {
    return !!v && typeof v === 'object' && (v as any).__enc === 1 && typeof (v as any).iv === 'string' && typeof (v as any).ct === 'string';
  }
}
