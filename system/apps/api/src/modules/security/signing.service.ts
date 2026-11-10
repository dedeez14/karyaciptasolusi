import { Injectable, Logger } from '@nestjs/common';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { canonical } from '../../common/audit/audit-chain';

export interface SignedFacts {
  /** document kind: SI, SQ, PO, ..., PAY_IN, PAY_OUT, CASH, PAYSLIP */
  k: string;
  /** record id */
  id: string;
  n: string;
  d: string;
  a: number | null;
  cur: string | null;
}

const b64u = (b: Buffer) => b.toString('base64url');

/**
 * Digital signatures (Ed25519) for every generated document.
 * Each company has its own key pair; the private key is stored encrypted (AES-256-GCM) in the settings table.
 * Token = base64url(canonical JSON payload) "." base64url(signature) - embedded in the PDF as a QR code.
 */
@Injectable()
export class SigningService {
  private readonly logger = new Logger('Signing');

  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  private async keys(companyId: string) {
    let priv = await this.settings.raw('security.signingPrivateKey', companyId);
    let pub = await this.settings.raw('security.signingPublicKey', companyId);
    if (!priv || !pub) {
      const kp = generateKeyPairSync('ed25519');
      priv = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      pub = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      await this.settings.set('security.signingPrivateKey', priv, companyId);
      await this.settings.set('security.signingPublicKey', pub, companyId);
      this.logger.log(`Generated document signing key for company ${companyId}`);
    }
    return { priv, pub };
  }

  async publicKey(companyId: string) {
    const { pub } = await this.keys(companyId);
    const der = createPublicKey(pub).export({ type: 'spki', format: 'der' });
    return { pem: pub, fingerprint: createHash('sha256').update(der).digest('hex').match(/.{4}/g)!.slice(0, 8).join(':').toUpperCase() };
  }

  async sign(companyId: string, facts: SignedFacts): Promise<string> {
    const { priv } = await this.keys(companyId);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { code: true } });
    const payload = Buffer.from(canonical({ v: 1, c: company.code, ...facts, i: new Date().toISOString() }));
    const sig = sign(null, payload, createPrivateKey(priv));
    return `${b64u(payload)}.${b64u(sig)}`;
  }

  /** Verifies the signature only (no database facts) */
  async verifyToken(token: string): Promise<{ ok: boolean; payload?: Record<string, any>; companyId?: string }> {
    const [p, s] = token.split('.');
    if (!p || !s || p.length > 2000 || s.length > 200) return { ok: false };
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      return { ok: false };
    }
    const company = await this.prisma.company.findFirst({ where: { code: String(payload.c ?? ''), deletedAt: null }, select: { id: true } });
    if (!company) return { ok: false, payload };
    const pub = await this.settings.raw('security.signingPublicKey', company.id);
    if (!pub) return { ok: false, payload };
    const ok = verify(null, Buffer.from(p, 'base64url'), createPublicKey(pub), Buffer.from(s, 'base64url'));
    return { ok, payload, companyId: company.id };
  }
}
