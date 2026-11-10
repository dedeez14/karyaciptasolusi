import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { CryptoService } from '../../common/crypto/crypto.service';

/**
 * Private file storage outside the web root.
 * Files are stored under random names and encrypted at rest (AES-256-GCM).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('Storage');
  readonly root = resolve(env.STORAGE_DIR);

  constructor(private readonly crypto: CryptoService) {}

  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
    this.logger.log(`File storage: ${this.root}`);
  }

  private pathFor(key: string) {
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Path traversal blocked');
    return p;
  }

  async put(companyId: string, data: Buffer, encrypt = true): Promise<string> {
    const key = `${companyId}/${randomUUID()}`;
    await mkdir(join(this.root, companyId), { recursive: true });
    await writeFile(this.pathFor(key), encrypt ? this.crypto.encryptBuffer(data) : data, { mode: 0o600 });
    return key;
  }

  async get(key: string, encrypted = true): Promise<Buffer> {
    const raw = await readFile(this.pathFor(key));
    return encrypted ? this.crypto.decryptBuffer(raw) : raw;
  }

  async remove(key: string) {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }
}
