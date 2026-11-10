import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { NotificationBus } from '../../common/events/notification-bus';
import { RequestCtx } from '../../common/context/request-context';
import { paged } from '../../common/utils/query';
import type { ExportTable } from '../../common/export/export.service';
import { csvRecords } from './csv';
import { addressKey, nameKey, phoneKey } from './normalize';
import { PlaceImportService } from './place-import.service';
import { ScraperRunnerService } from './scraper-runner.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// no control characters; the scraper reads one search per line
const QUERY = /^[^\u0000-\u001f\u007f]+$/;

const optNum = (min: number, max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable());

export const jobSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    queries: z
      .string()
      .transform((s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
      .pipe(
        z
          .array(z.string().max(200, 'A search can have at most 200 characters').regex(QUERY, 'Searches cannot contain control characters').refine((q) => !q.includes('#!#'), 'Searches cannot contain "#!#"'))
          .min(1, 'Enter at least one search')
          .max(50, 'At most 50 searches per run'),
      ),
    latitude: optNum(-90, 90),
    longitude: optNum(-180, 180),
    radiusKm: optNum(0.1, 100),
    zoom: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(21).nullable()),
    depth: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(1).max(10).optional()),
    languageCode: z.string().trim().max(10).optional(),
    extractEmails: z.boolean().default(true),
    fastMode: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if ((v.latitude === null) !== (v.longitude === null)) ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Enter both latitude and longitude, or neither' });
    if (v.fastMode && (v.latitude === null || v.longitude === null)) ctx.addIssue({ code: 'custom', path: ['fastMode'], message: 'Fast mode needs a map centre (latitude and longitude)' });
  });

export const placeFilterSchema = z.object({
  jobId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['NEW', 'IMPORTED', 'IGNORED']).optional()),
  hasEmail: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
  hasPhone: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
  hasWebsite: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
  minRating: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.coerce.number().min(0).max(5).optional()),
  category: z.string().trim().max(200).optional(),
  search: z.string().trim().max(100).optional(),
});
export const placeListSchema = placeFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['title', 'rating', 'reviewCount', 'createdAt', 'category']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export const selectionSchema = z
  .object({
    ids: z.array(z.uuid()).max(1000).optional(),
    filter: placeFilterSchema.optional(),
  })
  .refine((v) => v.ids?.length || v.filter, 'Choose places or a filter');

type PlaceFilter = z.infer<typeof placeFilterSchema>;

@Injectable()
export class LeadFinderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly bus: NotificationBus,
    private readonly runner: ScraperRunnerService,
    private readonly importer: PlaceImportService,
  ) {}

  // ------------------------------------------------------------------ searches

  async status() {
    RequestCtx.assert('crm.leadfinder.read');
    const companyId = RequestCtx.companyId();
    const { path, problem } = await this.runner.program(companyId);
    const [queued, running] = await Promise.all([
      this.prisma.scrapeJob.count({ where: { companyId, statusCode: 'QUEUED', deletedAt: null } }),
      this.prisma.scrapeJob.count({ where: { companyId, statusCode: 'RUNNING', deletedAt: null } }),
    ]);
    return {
      ready: !problem,
      problem,
      program: RequestCtx.can('system.setting.read') ? path : null,
      queued,
      running,
      defaults: {
        depth: await this.settings.num('marketing.scraperDepth', companyId, 3),
        languageCode: await this.settings.str('marketing.scraperLanguage', companyId, 'id'),
        timeoutMinutes: await this.settings.num('marketing.scraperTimeoutMinutes', companyId, 30),
      },
    };
  }

  async listJobs(q: { page: number; pageSize: number; status?: string; search?: string }) {
    RequestCtx.assert('crm.leadfinder.read');
    const where: Prisma.ScrapeJobWhereInput = { companyId: RequestCtx.companyId(), deletedAt: null };
    if (q.status) where.statusCode = q.status;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { queries: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.scrapeJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, omit: { logTail: true } }),
      this.prisma.scrapeJob.count({ where }),
    ]);
    return paged(
      rows.map((r) => ({ ...r, queryCount: r.queries.split('\n').filter((l) => l.trim()).length, live: this.runner.live(r.id) })),
      total,
      q,
    );
  }

  private async findJob(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Search not found');
    const job = await this.prisma.scrapeJob.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!job) throw new NotFoundException('Search not found');
    return job;
  }

  async getJob(id: string) {
    RequestCtx.assert('crm.leadfinder.read');
    const job = await this.findJob(id);
    const counts = await this.prisma.mapPlace.groupBy({ by: ['statusCode'], where: { companyId: job.companyId, jobId: job.id }, _count: { _all: true } });
    const by = Object.fromEntries(counts.map((c) => [c.statusCode, c._count._all]));
    const position = job.statusCode === 'QUEUED' ? await this.prisma.scrapeJob.count({ where: { statusCode: 'QUEUED', deletedAt: null, createdAt: { lt: job.createdAt } } }) : null;
    return { ...job, places: { new: by.NEW ?? 0, imported: by.IMPORTED ?? 0, ignored: by.IGNORED ?? 0 }, live: this.runner.live(job.id), queuePosition: position };
  }

  async createJob(body: unknown) {
    RequestCtx.assert('crm.leadfinder.run');
    const parsed = jobSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: 'Validation failed', errors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || 'queries', i.message])) });
    const v = parsed.data;
    const u = RequestCtx.user();
    const languageCode = v.languageCode || (await this.settings.str('marketing.scraperLanguage', u.companyId, 'id'));
    const lang = await this.prisma.lookupValue.findFirst({ where: { category: 'LANGUAGE', code: languageCode, isActive: true, deletedAt: null, OR: [{ companyId: null }, { companyId: u.companyId }] } });
    if (!lang) throw new BadRequestException({ message: 'Validation failed', errors: { languageCode: 'Choose a language from the list' } });
    const depth = v.depth ?? Math.min(10, Math.max(1, Math.round(await this.settings.num('marketing.scraperDepth', u.companyId, 3))));
    const { problem } = await this.runner.program(u.companyId);
    if (problem) throw new BadRequestException(problem);

    const job = await this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('SCRAPE_JOB', u.companyId, new Date(), tx);
      const row = await tx.scrapeJob.create({
        data: {
          companyId: u.companyId,
          code,
          name: v.name,
          queries: v.queries.join('\n'),
          latitude: v.latitude === null ? null : new Prisma.Decimal(v.latitude.toFixed(7)),
          longitude: v.longitude === null ? null : new Prisma.Decimal(v.longitude.toFixed(7)),
          radiusKm: v.latitude === null || v.radiusKm === null ? null : new Prisma.Decimal(v.radiusKm),
          zoom: v.latitude === null ? null : (v.zoom ?? 15),
          depth,
          languageCode,
          extractEmails: v.extractEmails,
          fastMode: v.fastMode,
          statusCode: 'QUEUED',
          createdById: u.id,
          updatedById: u.id,
        },
      });
      await this.audit.record('Lead Search', row.id, 'CREATE', undefined, row, tx);
      return row;
    });
    this.bus.emit(u.companyId);
    this.runner.kick();
    return job;
  }

  async cancelJob(id: string) {
    RequestCtx.assert('crm.leadfinder.run');
    const job = await this.findJob(id);
    if (job.statusCode === 'RUNNING') {
      if (!this.runner.cancel(job.id)) await this.prisma.scrapeJob.update({ where: { id: job.id }, data: { statusCode: 'CANCELLED', finishedAt: new Date() } });
    } else if (job.statusCode === 'QUEUED') await this.prisma.scrapeJob.update({ where: { id: job.id }, data: { statusCode: 'CANCELLED', finishedAt: new Date() } });
    else throw new ConflictException('Only queued or running searches can be cancelled');
    await this.audit.record('Lead Search', job.id, 'CANCEL', { status: job.statusCode }, { status: 'CANCELLED' });
    this.bus.emit(job.companyId);
    return { ok: true };
  }

  async retryJob(id: string) {
    RequestCtx.assert('crm.leadfinder.run');
    const job = await this.findJob(id);
    if (!['FAILED', 'CANCELLED', 'DONE'].includes(job.statusCode)) throw new ConflictException('This search is still queued or running');
    if (job.queries === '(imported file)') throw new ConflictException('An imported file cannot be run again');
    const { problem } = await this.runner.program(job.companyId);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.scrapeJob.update({ where: { id: job.id }, data: { statusCode: 'QUEUED', startedAt: null, finishedAt: null, error: null, updatedById: RequestCtx.user().id } });
    await this.audit.record('Lead Search', job.id, 'RUN_AGAIN', { status: job.statusCode }, { status: 'QUEUED' });
    this.bus.emit(job.companyId);
    this.runner.kick();
    return { ok: true };
  }

  async deleteJob(id: string) {
    RequestCtx.assert('crm.leadfinder.delete');
    const job = await this.findJob(id);
    if (job.statusCode === 'RUNNING') throw new ConflictException('Cancel the search before deleting it');
    // places stay: they are the shared, de-duplicated result list (and may already be leads)
    await this.prisma.scrapeJob.update({ where: { id: job.id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record('Lead Search', job.id, 'DELETE', job, undefined);
    await this.runner.removeFiles(job.id);
    this.bus.emit(job.companyId);
    return { ok: true };
  }

  /** Imports a CSV written earlier by google-maps-scraper (e.g. from the desktop runner) */
  async importFile(file: { originalname: string; buffer: Buffer } | undefined, name?: string) {
    RequestCtx.assert('crm.leadfinder.run');
    if (!file?.buffer?.length) throw new BadRequestException('Choose a CSV file');
    if (!/\.csv$/i.test(file.originalname)) throw new BadRequestException('Only .csv files written by google-maps-scraper can be imported');
    const records = csvRecords(file.buffer.toString('utf8'));
    if (!records.length || !('title' in records[0]) || !('latitude' in records[0])) throw new BadRequestException('This file is not a google-maps-scraper result (expected columns such as title, phone, latitude)');
    if (records.length > 20_000) throw new BadRequestException('At most 20,000 rows per file');
    const u = RequestCtx.user();
    const job = await this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('SCRAPE_JOB', u.companyId, new Date(), tx);
      const row = await tx.scrapeJob.create({
        data: {
          companyId: u.companyId,
          code,
          name: (name?.trim() || `Import ${file.originalname}`).slice(0, 200),
          queries: '(imported file)',
          statusCode: 'RUNNING',
          startedAt: new Date(),
          extractEmails: false,
          createdById: u.id,
          updatedById: u.id,
        },
      });
      await this.audit.record('Lead Search', row.id, 'IMPORT', undefined, { file: file.originalname, rows: records.length }, tx);
      return row;
    });
    const r = await this.importer.importRecords(u.companyId, job.id, records);
    await this.prisma.scrapeJob.update({ where: { id: job.id }, data: { statusCode: 'DONE', finishedAt: new Date(), resultCount: r.rows, newCount: r.created } });
    this.bus.emit(u.companyId);
    return { jobId: job.id, ...r };
  }

  // ------------------------------------------------------------------ places

  private placeWhere(f: PlaceFilter): Prisma.MapPlaceWhereInput {
    const where: Prisma.MapPlaceWhereInput = { companyId: RequestCtx.companyId() };
    const and: Prisma.MapPlaceWhereInput[] = [];
    if (f.jobId) where.jobId = f.jobId;
    if (f.status) where.statusCode = f.status;
    if (f.hasEmail) and.push({ emails: { not: null } });
    if (f.hasPhone) and.push({ phone: { not: null } });
    if (f.hasWebsite) and.push({ website: { not: null } });
    if (f.minRating !== undefined) and.push({ rating: { gte: f.minRating } });
    if (f.category) and.push({ category: { equals: f.category, mode: 'insensitive' } });
    if (f.search)
      and.push({
        OR: [
          { title: { contains: f.search, mode: 'insensitive' } },
          { address: { contains: f.search, mode: 'insensitive' } },
          { category: { contains: f.search, mode: 'insensitive' } },
          { emails: { contains: f.search, mode: 'insensitive' } },
          { phone: { contains: f.search.replace(/\D/g, '') || f.search } },
        ],
      });
    if (and.length) where.AND = and;
    return where;
  }

  async places(q: z.infer<typeof placeListSchema>) {
    RequestCtx.assert('crm.leadfinder.read');
    if (q.jobId) await this.findJob(q.jobId);
    const where = this.placeWhere(q);
    const companyId = RequestCtx.companyId();
    const [rows, total, categories, summary] = await Promise.all([
      this.prisma.mapPlace.findMany({
        where,
        // "nulls last" is only valid on optional columns
        orderBy: [(['rating', 'reviewCount', 'category'].includes(q.sort) ? { [q.sort]: { sort: q.order, nulls: 'last' } } : { [q.sort]: q.order }) as Prisma.MapPlaceOrderByWithRelationInput, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.mapPlace.count({ where }),
      this.prisma.mapPlace.groupBy({ by: ['category'], where: { companyId, ...(q.jobId ? { jobId: q.jobId } : {}), category: { not: null } }, _count: { _all: true }, orderBy: { _count: { category: 'desc' } }, take: 50 }),
      Promise.all([
        this.prisma.mapPlace.count({ where: { companyId, ...(q.jobId ? { jobId: q.jobId } : {}) } }),
        this.prisma.mapPlace.count({ where: { companyId, ...(q.jobId ? { jobId: q.jobId } : {}), emails: { not: null } } }),
        this.prisma.mapPlace.count({ where: { companyId, ...(q.jobId ? { jobId: q.jobId } : {}), phone: { not: null } } }),
        this.prisma.mapPlace.count({ where: { companyId, ...(q.jobId ? { jobId: q.jobId } : {}), statusCode: 'IMPORTED' } }),
      ]),
    ]);
    const leadIds = rows.map((r) => r.leadId).filter((x): x is string => !!x);
    const leads = leadIds.length ? await this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, code: true } }) : [];
    const lc = new Map(leads.map((l) => [l.id, l.code]));
    return {
      ...paged(
        rows.map((r) => ({ ...r, rating: r.rating === null ? null : Number(r.rating), latitude: r.latitude === null ? null : Number(r.latitude), longitude: r.longitude === null ? null : Number(r.longitude), emails: r.emails ? r.emails.split(',') : [], leadCode: r.leadId ? (lc.get(r.leadId) ?? null) : null })),
        total,
        q,
      ),
      categories: categories.map((c) => ({ value: c.category!, count: c._count._all })),
      summary: { total: summary[0], withEmail: summary[1], withPhone: summary[2], imported: summary[3] },
    };
  }

  private async selected(sel: z.infer<typeof selectionSchema>, status?: string[]) {
    const where: Prisma.MapPlaceWhereInput = sel.ids?.length ? { companyId: RequestCtx.companyId(), id: { in: sel.ids } } : this.placeWhere(sel.filter!);
    if (status) where.statusCode = sel.filter?.status && status.includes(sel.filter.status) ? sel.filter.status : { in: status };
    return this.prisma.mapPlace.findMany({ where, take: 1000, orderBy: { createdAt: 'asc' } });
  }

  async setStatus(body: unknown, statusCode: 'IGNORED' | 'NEW') {
    RequestCtx.assert('crm.leadfinder.import');
    const sel = selectionSchema.parse(body);
    const rows = await this.selected(sel, statusCode === 'IGNORED' ? ['NEW'] : ['IGNORED']);
    if (!rows.length) return { updated: 0 };
    await this.prisma.mapPlace.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { statusCode } });
    await this.audit.record('Found Place', null, statusCode === 'IGNORED' ? 'IGNORE' : 'RESTORE', undefined, { count: rows.length, ids: rows.slice(0, 50).map((r) => r.id) });
    return { updated: rows.length };
  }

  async deletePlaces(body: unknown) {
    RequestCtx.assert('crm.leadfinder.delete');
    const sel = selectionSchema.parse(body);
    const rows = await this.selected(sel, ['NEW', 'IGNORED']);
    if (!rows.length) return { deleted: 0 };
    await this.prisma.mapPlace.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await this.audit.record('Found Place', null, 'DELETE', { count: rows.length, titles: rows.slice(0, 50).map((r) => r.title) }, undefined);
    return { deleted: rows.length };
  }

  /**
   * Creates leads from found places. Places that already exist as a lead or customer (same e-mail,
   * same phone, or same name at a similar address) are not added again; places that match an
   * existing lead are linked to it.
   */
  async addToLeads(body: unknown) {
    RequestCtx.assert('crm.leadfinder.import');
    RequestCtx.assert('crm.lead.create');
    const sel = selectionSchema.parse(body);
    const u = RequestCtx.user();
    const places = await this.selected(sel, ['NEW']);
    const result = { created: 0, linkedToExistingLead: 0, skippedCustomer: 0, skippedDuplicateInSelection: 0, considered: places.length, leads: [] as { id: string; code: string; name: string }[] };
    if (!places.length) return result;

    const [leads, customers] = await Promise.all([
      this.prisma.lead.findMany({ where: { companyId: u.companyId, deletedAt: null }, select: { id: true, name: true, companyName: true, email: true, phone: true, address: true } }),
      this.prisma.customer.findMany({ where: { companyId: u.companyId, deletedAt: null }, select: { id: true, name: true, email: true, phone: true } }),
    ]);
    type Owner = { kind: 'lead' | 'customer'; id: string };
    const byEmail = new Map<string, Owner>();
    const byPhone = new Map<string, Owner>();
    const byName = new Map<string, { owner: Owner; address: string }[]>();
    const index = (o: Owner, name: string | null, email: string | null, phone: string | null, address: string | null) => {
      if (email) byEmail.set(email.toLowerCase(), o);
      const pk = phoneKey(phone);
      if (pk) byPhone.set(pk, o);
      const nk = nameKey(name);
      if (nk) byName.set(nk, [...(byName.get(nk) ?? []), { owner: o, address: addressKey(address) }]);
    };
    for (const c of customers) index({ kind: 'customer', id: c.id }, c.name, c.email, c.phone, null);
    for (const l of leads) {
      index({ kind: 'lead', id: l.id }, l.companyName || l.name, l.email, l.phone, l.address);
      if (l.companyName && l.companyName !== l.name) index({ kind: 'lead', id: l.id }, l.name, null, null, l.address);
    }
    const match = (p: (typeof places)[number]): Owner | null => {
      for (const e of (p.emails ?? '').split(',').filter(Boolean)) {
        const o = byEmail.get(e);
        if (o) return o;
      }
      const pk = phoneKey(p.phone);
      if (pk && byPhone.has(pk)) return byPhone.get(pk)!;
      const cands = byName.get(nameKey(p.title)) ?? [];
      const ak = addressKey(p.address);
      // same name only counts when both have an address and the addresses start alike
      const hit = cands.find((c) => ak && c.address && (c.address.startsWith(ak.slice(0, 18)) || ak.startsWith(c.address.slice(0, 18))));
      return hit?.owner ?? null;
    };

    const source = await this.prisma.lookupValue.findFirst({ where: { category: 'LEAD_SOURCE', code: 'GOOGLE_MAPS', isActive: true, deletedAt: null, OR: [{ companyId: null }, { companyId: u.companyId }] } });
    const status = await this.prisma.lookupValue.findFirst({ where: { category: 'LEAD_STATUS', code: 'NEW', isActive: true, deletedAt: null, OR: [{ companyId: null }, { companyId: u.companyId }] } });
    const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);

    for (const p of places) {
      const owner = match(p);
      if (owner?.kind === 'lead') {
        await this.prisma.mapPlace.update({ where: { id: p.id }, data: { statusCode: 'IMPORTED', leadId: owner.id } });
        result.linkedToExistingLead++;
        continue;
      }
      if (owner?.kind === 'customer') {
        // already a customer: set aside (can be restored from "Ignored") so it is not offered again
        await this.prisma.mapPlace.update({ where: { id: p.id }, data: { statusCode: 'IGNORED' } });
        result.skippedCustomer++;
        continue;
      }
      const emails = (p.emails ?? '').split(',').filter(Boolean);
      const noteLines = [
        p.category && `Category: ${p.category}`,
        p.rating !== null && `Google rating: ${fmt(Number(p.rating))} (${p.reviewCount ?? 0} reviews)`,
        emails.length > 1 && `Other e-mails: ${emails.slice(1).join(', ')}`,
        p.query && `Found with: ${p.query}`,
      ].filter(Boolean);
      const lead = await this.prisma.$transaction(async (tx) => {
        const code = await this.sequence.next('LEAD', u.companyId, new Date(), tx);
        const row = await tx.lead.create({
          data: {
            companyId: u.companyId,
            branchId: u.branchId,
            code,
            name: p.title.slice(0, 150),
            companyName: p.title.slice(0, 150),
            email: emails[0] ?? null,
            phone: p.phone,
            website: p.website,
            address: p.address,
            mapsUrl: p.mapsUrl?.slice(0, 500) ?? null,
            mapPlaceId: p.id,
            sourceCode: source?.code ?? null,
            statusCode: status?.code ?? null,
            ownerId: u.id,
            notes: noteLines.join('\n') || null,
            createdById: u.id,
            updatedById: u.id,
          },
        });
        await tx.mapPlace.update({ where: { id: p.id }, data: { statusCode: 'IMPORTED', leadId: row.id } });
        await this.audit.record('Lead', row.id, 'CREATE', undefined, { ...row, from: 'Google Maps lead finder' }, tx);
        return row;
      });
      // later places in the same selection that point to the same business are linked, not duplicated
      index({ kind: 'lead', id: lead.id }, p.title, emails[0] ?? null, p.phone, p.address);
      result.created++;
      if (result.leads.length < 20) result.leads.push({ id: lead.id, code: lead.code, name: lead.name });
    }
    this.bus.emit(u.companyId);
    return result;
  }

  async exportTable(q: z.infer<typeof placeListSchema>): Promise<ExportTable> {
    RequestCtx.assert('crm.leadfinder.read');
    const where = this.placeWhere(q);
    const rows = await this.prisma.mapPlace.findMany({ where, orderBy: { title: 'asc' }, take: 20_000 });
    const job = q.jobId ? await this.findJob(q.jobId) : null;
    return {
      title: job ? `Google Maps results - ${job.name}` : 'Google Maps results',
      subtitle: `${rows.length} places`,
      columns: [
        { key: 'title', label: 'Business' },
        { key: 'category', label: 'Category' },
        { key: 'phone', label: 'Phone' },
        { key: 'emails', label: 'E-mail' },
        { key: 'website', label: 'Website' },
        { key: 'address', label: 'Address' },
        { key: 'rating', label: 'Rating', type: 'number' },
        { key: 'reviewCount', label: 'Reviews', type: 'integer' },
        { key: 'status', label: 'Status' },
        { key: 'query', label: 'Search' },
        { key: 'latitude', label: 'Latitude' },
        { key: 'longitude', label: 'Longitude' },
        { key: 'mapsUrl', label: 'Google Maps' },
      ],
      rows: rows.map((r) => ({
        title: r.title,
        category: r.category ?? '',
        phone: r.phone ?? '',
        emails: (r.emails ?? '').split(',').join(', '),
        website: r.website ?? '',
        address: r.address ?? '',
        rating: r.rating === null ? '' : Number(r.rating),
        reviewCount: r.reviewCount ?? '',
        status: r.statusCode === 'IMPORTED' ? 'Added to leads' : r.statusCode === 'IGNORED' ? 'Ignored' : 'New',
        query: r.query ?? '',
        latitude: r.latitude === null ? '' : Number(r.latitude),
        longitude: r.longitude === null ? '' : Number(r.longitude),
        mapsUrl: r.mapsUrl ?? '',
      })),
    };
  }
}
