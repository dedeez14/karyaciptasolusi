import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { NotificationBus } from '../../common/events/notification-bus';
import { runAsSystem } from '../billing/job-context';

/** Sections a block can belong to (see the web-contents resource) */
const SECTIONS = ['SERVICE', 'PORTFOLIO', 'TESTIMONIAL', 'FAQ', 'CLIENT', 'STAT', 'REASON', 'STEP', 'JOB'] as const;
const HIDEABLE = ['stats', 'clients', 'portfolio', 'services', 'whyus', 'testimonials', 'consultation', 'faq', 'blog', 'business', 'career', 'newsletter', 'contact'];
const CACHE_MS = 60_000;

/** strip control characters (keeps new lines) and trim */
const clean = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim())
    .pipe(z.string().max(max));

export const enquirySchema = z.object({
  kind: z.enum(['contact', 'newsletter']).default('contact'),
  name: clean(150).default(''),
  email: clean(150).pipe(z.email('Alamat e-mail tidak valid')),
  phone: clean(50).optional(),
  subject: clean(150).optional(),
  message: clean(4000).optional(),
  /** honeypot: people never see this field, bots fill it */
  website: z.string().max(500).optional(),
});

const lines = (v: string) =>
  v
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const safeUrl = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s; // path on the website itself
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
};

/**
 * Public content of the company website (karyaciptasolusi.com) and its contact form.
 * Only published blocks and settings of the "website" group leave the system; nothing else about the company.
 */
@Injectable()
export class WebsiteService {
  private readonly log = new Logger(WebsiteService.name);
  private cache: { at: number; companyId: string; data: unknown } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly bus: NotificationBus,
  ) {}

  /** The company that owns the website: WEBSITE_COMPANY_CODE, else the oldest active company */
  private async companyId(): Promise<string> {
    const code = (process.env.WEBSITE_COMPANY_CODE ?? '').trim();
    const c = await this.prisma.company.findFirst({
      where: { isActive: true, deletedAt: null, ...(code ? { code } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Website is not configured');
    return c.id;
  }

  async content() {
    const companyId = await this.companyId();
    if (this.cache && this.cache.companyId === companyId && Date.now() - this.cache.at < CACHE_MS) return this.cache.data;
    const data = await runAsSystem(companyId, 'website-content', () => this.build(companyId));
    this.cache = { at: Date.now(), companyId, data };
    return data;
  }

  private async build(companyId: string) {
    const s = (k: string) => this.settings.str(`website.${k}`, companyId, '').then((v) => (v ?? '').trim());
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true, phone: true, email: true, address: true, city: true } });
    const blocks = await this.prisma.webContent.findMany({
      where: { companyId, isPublished: true, deletedAt: null, section: { in: [...SECTIONS] } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const of = (sec: (typeof SECTIONS)[number]) => blocks.filter((b) => b.section === sec);
    const tags = (v: string | null) => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const updatedAt = blocks.reduce<Date | null>((m, b) => (!m || b.updatedAt > m ? b.updatedAt : m), null);
    let address = await s('address');
    if (!address && company?.address) address = [company.address, company.city].filter(Boolean).join(', ');
    const whatsapp = (await s('whatsapp')).replace(/\D/g, '');

    return {
      updatedAt: updatedAt?.toISOString() ?? null,
      company: {
        name: company?.name ?? '',
        phone: (await s('phone')) || company?.phone || '',
        whatsapp,
        email: (await s('email')) || company?.email || '',
        address,
        mapsUrl: safeUrl(await s('mapsUrl')) ?? '',
        mapsEmbedUrl: /^https:\/\/www\.google\.com\/maps\/embed\?/.test(await s('mapsEmbedUrl')) ? await s('mapsEmbedUrl') : '',
        hours: lines(await s('hours')),
        social: Object.fromEntries(
          (await Promise.all(['instagram', 'linkedin', 'facebook', 'tiktok', 'youtube'].map(async (k) => [k, safeUrl(await s(k))] as const))).filter(([, v]) => v),
        ),
      },
      hero: {
        badge: await s('heroBadge'),
        title: await s('heroTitle'),
        subtitle: await s('heroSubtitle'),
        typing: lines(await s('heroTyping')),
        ctaText: await s('ctaText'),
      },
      announcement: (await s('announcement')) || null,
      hiddenSections: lines((await s('hiddenSections')).replace(/,/g, '\n'))
        .map((v) => v.toLowerCase())
        .filter((v) => HIDEABLE.includes(v)),
      services: of('SERVICE').map((b) => ({ title: b.title, desc: b.body ?? '', icon: b.icon, image: safeUrl(b.imageUrl), link: safeUrl(b.linkUrl) })),
      portfolio: of('PORTFOLIO').map((b) => ({ title: b.title, summary: b.body ?? '', category: b.subtitle ?? '', url: safeUrl(b.linkUrl), image: safeUrl(b.imageUrl), tech: tags(b.tags) })),
      testimonials: of('TESTIMONIAL').map((b) => ({ name: b.title, role: b.subtitle ?? '', content: b.body ?? '', rating: Math.min(5, Math.max(1, Number.parseInt(b.value ?? '5', 10) || 5)) })),
      faqs: of('FAQ').map((b) => ({ q: b.title, a: b.body ?? '' })),
      clients: of('CLIENT').map((b) => ({ name: b.title, logo: safeUrl(b.imageUrl), url: safeUrl(b.linkUrl) })),
      stats: of('STAT').map((b) => {
        // "Rp 30+" -> prefix "Rp ", value 30, suffix "+"
        const m = /^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/.exec((b.value ?? '').trim());
        return { value: m ? Number(m[2].replace(',', '.')) : 0, prefix: m?.[1] ?? '', suffix: m?.[3] ?? '', label: b.title, sub: b.subtitle ?? '', icon: b.icon };
      }),
      reasons: of('REASON').map((b) => ({ title: b.title, desc: b.body ?? '', icon: b.icon })),
      steps: of('STEP').map((b) => ({ title: b.title, desc: b.body ?? '', icon: b.icon })),
      jobs: of('JOB').map((b) => {
        const all = lines(b.body ?? '');
        return {
          title: b.title,
          type: b.subtitle ?? '',
          location: b.linkUrl ?? '',
          salary: b.value ?? '',
          edu: b.tags ?? '',
          desc: all.filter((l) => !l.startsWith('- ')).join('\n'),
          requirements: all.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()),
        };
      }),
    };
  }

  /** Contact form / newsletter: becomes a CRM lead with source WEBSITE (status NEW) */
  async enquiry(raw: unknown) {
    const parsed = enquirySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Data tidak valid');
    const b = parsed.data;
    if (b.website) return { ok: true }; // bot: pretend it worked, store nothing
    const name = b.name || (b.kind === 'newsletter' ? b.email.split('@')[0] : '');
    if (!name) throw new BadRequestException('Nama wajib diisi');
    if (b.kind === 'contact' && !b.message) throw new BadRequestException('Pesan wajib diisi');

    const companyId = await this.companyId();
    await runAsSystem(companyId, 'website-enquiry', async () => {
      const email = b.email.toLowerCase();
      if (b.kind === 'newsletter') {
        const known = await this.prisma.lead.findFirst({ where: { companyId, email, deletedAt: null }, select: { id: true } });
        if (known) return; // already a lead: nothing new to tell the team
      } else {
        // the same message twice within 10 minutes (double click, retry) is stored once
        const recent = await this.prisma.lead.findFirst({
          where: { companyId, email, sourceCode: 'WEBSITE', deletedAt: null, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
          select: { id: true },
        });
        if (recent) return;
      }
      const ownerName = (await this.settings.str('website.enquiryOwner', companyId, ''))?.trim();
      const owner = ownerName ? await this.prisma.user.findFirst({ where: { username: ownerName, deletedAt: null, isActive: true }, select: { id: true } }) : null;
      const notes =
        b.kind === 'newsletter'
          ? 'Subscribed to the newsletter on the website.'
          : [`Website contact form${b.subject ? ` - ${b.subject}` : ''}`, '', b.message ?? ''].join('\n');
      const lead = await this.prisma.$transaction(async (tx) => {
        const code = await this.sequence.next('LEAD', companyId, new Date(), tx);
        return tx.lead.create({
          data: { companyId, code, name, email, phone: b.phone || null, sourceCode: 'WEBSITE', statusCode: 'NEW', ownerId: owner?.id ?? null, notes },
          select: { id: true, code: true },
        });
      });
      await this.audit.record('Lead', lead.id, 'CREATE', undefined, { code: lead.code, sourceCode: 'WEBSITE', kind: b.kind });
      this.bus.emit(companyId);
    });
    return { ok: true };
  }

  /** Called after website content or settings change so the site sees it within seconds */
  invalidate() {
    this.cache = null;
  }
}
