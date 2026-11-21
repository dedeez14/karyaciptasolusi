import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationBus } from '../../common/events/notification-bus';
import { scanWebsite } from './site-scan';

/** websites read at the same time (all companies together) */
const CONCURRENCY = 4;

/**
 * Finds e-mail addresses of found places by reading their websites (the Google Maps scraper only does this in
 * its normal mode, which Google often blocks; fast mode never visits websites).
 * Runs in the background after a search and on request; every place is checked once unless asked again.
 */
@Injectable()
export class EmailFinderService implements OnModuleInit {
  private readonly log = new Logger('LeadFinderEmails');
  /** place id -> company id, waiting to be read */
  private readonly queue = new Map<string, string>();
  private readonly active = new Set<string>();
  private workers = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: NotificationBus,
  ) {}

  /** websites that were still waiting when the server stopped */
  async onModuleInit() {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const jobs = await this.prisma.scrapeJob.findMany({ where: { extractEmails: true, deletedAt: null, createdAt: { gte: since } }, select: { id: true } }).catch(() => []);
    const rows = jobs.length
      ? await this.prisma.mapPlace
          .findMany({ where: { jobId: { in: jobs.map((j) => j.id) }, website: { not: null }, emails: null, emailCheckedAt: null }, select: { id: true, companyId: true }, take: 5000 })
          .catch(() => [])
      : [];
    for (const r of rows) this.queue.set(r.id, r.companyId);
    if (rows.length) this.log.log(`${rows.length} website(s) still to read`);
    this.pump();
  }

  /** queues the places of a search that have a website and no e-mail yet */
  async enqueueJob(companyId: string, jobId: string) {
    const rows = await this.prisma.mapPlace.findMany({ where: { companyId, jobId, website: { not: null }, emails: null, emailCheckedAt: null }, select: { id: true } });
    for (const r of rows) this.queue.set(r.id, companyId);
    this.pump();
    return rows.length;
  }

  /** queues chosen places again (also those checked before); returns how many have a website */
  async enqueuePlaces(companyId: string, ids: string[]) {
    const rows = await this.prisma.mapPlace.findMany({ where: { companyId, id: { in: ids }, website: { not: null } }, select: { id: true } });
    if (rows.length) await this.prisma.mapPlace.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { emailCheckedAt: null, emailNote: null } });
    for (const r of rows) this.queue.set(r.id, companyId);
    this.pump();
    return rows.length;
  }

  /** waiting or being read, for one search or the whole company */
  pending(companyId: string, placeIds?: Set<string>) {
    let n = 0;
    for (const [id, c] of this.queue) if (c === companyId && (!placeIds || placeIds.has(id))) n++;
    for (const id of this.active) if (!placeIds || placeIds.has(id)) n++;
    return n;
  }

  isPending(id: string) {
    return this.queue.has(id) || this.active.has(id);
  }

  private pump() {
    while (this.workers < CONCURRENCY && this.queue.size) {
      this.workers++;
      void this.work().finally(() => {
        this.workers--;
        this.pump();
      });
    }
  }

  private async work() {
    while (this.queue.size) {
      const [id, companyId] = this.queue.entries().next().value as [string, string];
      this.queue.delete(id);
      this.active.add(id);
      try {
        await this.checkOne(id, companyId);
      } catch (e) {
        this.log.warn(`place ${id}: ${(e as Error).message}`);
      } finally {
        this.active.delete(id);
      }
    }
  }

  private async checkOne(id: string, companyId: string) {
    const place = await this.prisma.mapPlace.findFirst({ where: { id, companyId }, select: { id: true, website: true, emails: true, leadId: true } });
    if (!place?.website) return;
    const r = await scanWebsite(place.website);
    const merged = [...new Set([...(place.emails ? place.emails.split(',') : []), ...r.emails])].slice(0, 5);
    await this.prisma.mapPlace.update({
      where: { id },
      data: { emails: merged.length ? merged.join(',').slice(0, 1000) : null, emailCheckedAt: new Date(), emailNote: r.note.slice(0, 200) },
    });
    // a lead made from this place before the e-mail was known gets it too (only when its e-mail is still empty)
    if (place.leadId && merged.length) await this.prisma.lead.updateMany({ where: { id: place.leadId, companyId, email: null, deletedAt: null }, data: { email: merged[0] } });
    this.bus.emit(companyId);
  }
}
