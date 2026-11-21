import { Injectable } from '@nestjs/common';
import { createHmac, hkdfSync } from 'node:crypto';
import { PNG } from 'pngjs';
import { env } from '../../config/env';

const MAGIC = Buffer.from('KCSW');

/**
 * Steganography (LSB) for leak tracing: hides "who downloaded this image and when" in the least significant
 * bit of the RGB channels of PNG images. Invisible to the eye; an HMAC tag proves the mark is genuine.
 * Note: steganography is for tracing, not for confidentiality - re-encoding (e.g. JPEG) destroys the mark.
 */
@Injectable()
export class WatermarkService {
  private readonly key = Buffer.from(hkdfSync('sha256', Buffer.from(env.HMAC_KEY, 'base64'), Buffer.alloc(0), 'kcs-watermark-v1', 32));

  private pack(payload: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify(payload));
    const tag = createHmac('sha256', this.key).update(body).digest().subarray(0, 16);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length);
    return Buffer.concat([MAGIC, len, body, tag]);
  }

  embed(png: Buffer, payload: Record<string, unknown>): Buffer | null {
    let img: PNG;
    try {
      img = PNG.sync.read(png);
    } catch {
      return null;
    }
    const data = this.pack(payload);
    const bits = data.length * 8;
    const capacity = (img.data.length / 4) * 3;
    if (bits > capacity) return null; // image too small
    let bit = 0;
    for (let i = 0; i < img.data.length && bit < bits; i++) {
      if (i % 4 === 3) continue; // keep alpha untouched
      const b = (data[bit >> 3] >> (7 - (bit & 7))) & 1;
      img.data[i] = (img.data[i] & 0xfe) | b;
      bit++;
    }
    return PNG.sync.write(img);
  }

  detect(png: Buffer): { found: boolean; valid?: boolean; payload?: Record<string, unknown> } {
    let img: PNG;
    try {
      img = PNG.sync.read(png);
    } catch {
      return { found: false };
    }
    const readBytes = (offsetBytes: number, count: number) => {
      const out = Buffer.alloc(count);
      let bit = 0;
      const start = offsetBytes * 8;
      for (let i = 0, n = 0; i < img.data.length && bit < start + count * 8; i++) {
        if (i % 4 === 3) continue;
        if (n >= start) {
          const k = n - start;
          out[k >> 3] |= (img.data[i] & 1) << (7 - (k & 7));
          bit = n + 1;
        }
        n++;
      }
      return out;
    };
    if (!readBytes(0, 4).equals(MAGIC)) return { found: false };
    const len = readBytes(4, 2).readUInt16BE(0);
    if (len === 0 || len > 4000) return { found: false };
    const body = readBytes(6, len);
    const tag = readBytes(6 + len, 16);
    const valid = createHmac('sha256', this.key).update(body).digest().subarray(0, 16).equals(tag);
    try {
      return { found: true, valid, payload: JSON.parse(body.toString('utf8')) };
    } catch {
      return { found: true, valid: false };
    }
  }
}
