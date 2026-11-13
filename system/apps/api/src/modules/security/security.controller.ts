import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Permission, Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { RESOURCES } from '../resources/resource.registry';
import { SigningService, tokenHash } from './signing.service';
import { TransportService } from './transport.service';
import { WatermarkService } from './watermark.service';

const DOC_TITLES: Record<string, string> = {
  LETTER: 'Company letter',
  SQ: 'Quotation',
  SO: 'Sales Order',
  DO: 'Delivery Order',
  SI: 'Invoice',
  PR: 'Purchase Request',
  PO: 'Purchase Order',
  GR: 'Goods Receipt',
  PI: 'Purchase Invoice',
  ADJ: 'Stock Adjustment',
  TRF: 'Stock Transfer',
  PAY_IN: 'Official Receipt',
  PAY_OUT: 'Payment Voucher',
  CASH: 'Cash / Bank Voucher',
  PAYSLIP: 'Payslip',
};

@Controller()
export class SecurityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: SigningService,
    private readonly transport: TransportService,
    private readonly watermark: WatermarkService,
    private readonly audit: AuditService,
  ) {}

  /** Server public key for the encrypted transport handshake */
  @Public()
  @Get('public/transport-key')
  async transportKey() {
    return { enabled: await this.transport.enabled(), publicKey: this.transport.publicKey(), curve: 'P-256', cipher: 'AES-256-GCM', kdf: 'HKDF-SHA256' };
  }

  /**
   * Public document verification (target of the QR code printed on every PDF).
   * Checks the Ed25519 signature and that the document still exists with the same facts.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('public/verify')
  async verify(@Query('t') t = '', @Query('c') c = '') {
    if (!t && /^[0-9a-f]{20}$/.test(String(c))) t = (await this.prisma.signedFile.findFirst({ where: { code: String(c) }, select: { token: true } }))?.token ?? '';
    const r = await this.signing.verifyToken(String(t).slice(0, 2500));
    if (!r.ok || !r.payload || !r.companyId) return { valid: false, message: 'This document could not be verified. The signature is missing or invalid - the document may have been altered.' };
    const p = r.payload;
    const company = await this.prisma.company.findUnique({ where: { id: r.companyId }, select: { name: true, legalName: true } });
    let current: { status: string; amount: number | null } | null = null;
    if (/^(SQ|SO|DO|SI|PR|PO|GR|PI|ADJ|TRF)$/.test(p.k)) {
      const d = await this.prisma.tradeDocument.findFirst({ where: { id: p.id, companyId: r.companyId, deletedAt: null }, select: { status: true, grandTotal: true } });
      if (d) current = { status: d.status, amount: Number(d.grandTotal) };
    } else if (p.k === 'PAY_IN' || p.k === 'PAY_OUT') {
      const d = await this.prisma.payment.findFirst({ where: { id: p.id, companyId: r.companyId, deletedAt: null }, select: { status: true, amount: true } });
      if (d) current = { status: d.status, amount: Number(d.amount) };
    } else if (p.k === 'CASH') {
      const d = await this.prisma.cashTransaction.findFirst({ where: { id: p.id, companyId: r.companyId, deletedAt: null }, select: { status: true, amount: true } });
      if (d) current = { status: d.status, amount: Number(d.amount) };
    } else if (p.k === 'PAYSLIP') {
      const d = await this.prisma.payslip.findFirst({ where: { id: p.id, payrollRun: { companyId: r.companyId } }, select: { payrollRun: { select: { status: true } } } });
      if (d) current = { status: d.payrollRun.status, amount: null };
    }
    const warnings: string[] = [];
    if (!current) warnings.push('The document no longer exists in our system.');
    else {
      if (current.status === 'CANCELLED') warnings.push('This document has been cancelled.');
      if (p.a !== null && current.amount !== null && Math.abs(current.amount - Number(p.a)) > 0.005) warnings.push('The amount on this document differs from our records.');
    }
    return {
      valid: true,
      message: warnings.length
        ? 'The signature is genuine, but please note the warnings below.'
        : `This QR code was issued by ${company?.legalName || company?.name || 'us'} for the document below. Make sure every detail on your copy matches exactly - if anything differs, the copy has been altered.`,
      warnings,
      document: { type: DOC_TITLES[p.k] ?? p.k, number: p.n, date: p.d, amount: p.a, currency: p.cur, party: p.p ?? null, issuedAt: p.i, status: current?.status ?? null },
      issuer: company?.legalName || company?.name,
      fingerprint: (await this.signing.publicKey(r.companyId)).fingerprint,
      token: String(t),
    };
  }

  /**
   * Checks a PDF file against the fingerprints of the files we issued. The browser hashes the file
   * locally (the document itself is never uploaded) and sends the SHA-256 plus the signature token
   * found in the file's metadata or in the scanned QR code.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('public/verify/file')
  async verifyFile(@Body() body: { sha256?: string; token?: string }) {
    const sha = String(body?.sha256 ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new BadRequestException('Invalid file fingerprint');
    const token = String(body?.token ?? '').slice(0, 2500);
    const exact = await this.prisma.signedFile.findFirst({ where: { sha256: sha }, orderBy: { createdAt: 'asc' } });
    if (exact) {
      const company = await this.prisma.company.findUnique({ where: { id: exact.companyId }, select: { name: true, legalName: true } });
      return {
        result: 'MATCH',
        message: 'This file is exactly the document we issued. It has not been modified.',
        document: { type: DOC_TITLES[exact.docKind] ?? exact.docKind, number: exact.docNumber, issuedAt: exact.createdAt },
        issuer: company?.legalName || company?.name,
      };
    }
    if (token) {
      const r = await this.signing.verifyToken(token);
      if (r.ok && r.payload) {
        const issued = await this.prisma.signedFile.count({ where: { tokenHash: tokenHash(token) } });
        const document = { type: DOC_TITLES[r.payload.k] ?? r.payload.k, number: r.payload.n, issuedAt: r.payload.i };
        if (issued)
          return { result: 'ALTERED', message: 'This file has been modified after it was issued. Its contents cannot be trusted - ask the issuer for the original.', document };
        return { result: 'UNKNOWN', message: 'The signature is valid, but this document was issued before file fingerprints were recorded. Compare the details on the file with the verification result.', document };
      }
    }
    return { result: 'NOT_FOUND', message: 'This file does not match any document we issued. It was modified or did not come from us.' };
  }

  @Get('security/overview')
  @Permission('system.security.read')
  async overview() {
    const companyId = RequestCtx.companyId();
    const [legacyUsers, totalUsers, signing, auditEntries] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null, NOT: { passwordHash: { startsWith: 'p1$' } } } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.signing.publicKey(companyId),
      this.prisma.auditLog.count({ where: { companyId } }),
    ]);
    return {
      password: { algorithm: 'Argon2id (m=19 MiB, t=2, p=1)', salt: '16-byte random salt per password', pepper: 'HMAC-SHA256 server pepper', totalUsers, legacyUsers },
      transport: { enabled: await this.transport.enabled(), keyAgreement: 'ECDH P-256 (ephemeral client key x server key)', cipher: 'AES-256-GCM', kdf: 'HKDF-SHA256', replayProtection: 'timestamp window + single-use nonce', fingerprint: this.transport.fingerprint() },
      signing: { algorithm: 'Ed25519', fingerprint: signing.fingerprint, publicKeyPem: signing.pem },
      atRest: {
        cipher: 'AES-256-GCM (field level) + encrypted file storage + encrypted backups',
        fields: RESOURCES.flatMap((r) => r.fields.filter((f) => f.encrypted).map((f) => `${r.label}: ${f.label}`)).concat(['Users: Phone', 'Settings: secrets (SMTP, Hostinger, keys)']),
      },
      audit: { algorithm: 'HMAC-SHA256 hash chain', entries: auditEntries },
      steganography: { method: 'LSB watermark in PNG downloads (user + time, HMAC-tagged)' },
    };
  }

  @Post('security/watermark/detect')
  @Permission('system.security.read')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  async detect(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Upload a PNG image');
    const r = this.watermark.detect(file.buffer);
    let user: string | null = null;
    if (r.found && r.payload?.u) user = (await this.prisma.user.findUnique({ where: { id: String(r.payload.u) }, select: { fullName: true } }))?.fullName ?? null;
    this.audit.activity('security.watermark.detect', { found: r.found, valid: r.valid });
    return { ...r, userName: user };
  }
}
