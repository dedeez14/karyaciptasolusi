import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { forEachCompany } from '../billing/job-context';
import { MarketplaceService, todayWib } from './marketplace.service';
import { MarketplacePostingService } from './marketplace-posting.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** current hour in Asia/Jakarta */
const hourWib = () => new Date(Date.now() + 7 * 3_600_000).getUTCHours();
const dayWib = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const yesterdayWib = () => new Date(Date.now() + 7 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);

/**
 * Daily marketplace job, set per store in Stores & Listings:
 *  - "Sync every day": reads the store through its API (Gumroad: products, sales, payouts);
 *  - "Book orders every day": books the orders up to yesterday when nothing blocks the settlement.
 * The job runs once a day per store, from the hour chosen (Jakarta time); the server checks every 15 minutes, so a
 * server that was off at that hour catches up when it starts. Work is done as the audited "system" actor.
 */
@Injectable()
export class MarketplaceScheduler {
  private readonly logger = new Logger('MarketplaceScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mp: MarketplaceService,
    private readonly posting: MarketplacePostingService,
  ) {}

  @Cron('*/15 * * * *', { name: 'marketplace-daily' })
  async tick() {
    await forEachCompany(this.prisma, this.logger, 'marketplace-daily', async (companyId) => {
      const today = todayWib();
      const hour = hourWib();
      const stores = await this.prisma.marketplaceStore.findMany({ where: { companyId, isActive: true, kind: 'STORE', OR: [{ autoSync: true }, { autoSettle: true }] } });
      const due = stores.filter((s) => hour >= s.autoHour && (!s.lastAutoRunAt || dayWib(s.lastAutoRunAt) < today));
      const done: string[] = [];
      for (const s of due) done.push(`${s.code}: ${await this.runStore(s.id)}`);
      return done.length ? done.join(' | ') : null;
    });
  }

  /** "Run now" from the store list: the same work as the daily job, as the user who clicks */
  async runNow(id: string) {
    RequestCtx.assert('marketplace.import');
    if (!UUID.test(id)) throw new NotFoundException('Store not found');
    const s = await this.mp.store(id);
    if (s.autoSettle) RequestCtx.assert('marketplace.post');
    const result = await this.runStore(s.id);
    return { result };
  }

  /** sync and / or settlement of one store; never throws, the outcome is stored on the store */
  private async runStore(storeId: string): Promise<string> {
    const s = await this.prisma.marketplaceStore.findUniqueOrThrow({ where: { id: storeId } });
    const parts: string[] = [];
    let failed = false;
    if (s.autoSync) {
      try {
        const r = await this.mp.sync(s.id);
        parts.push(`sync: ${r.orders.created} new orders, ${r.orders.updated} refunds updated, ${r.listings.created} new listings, ${r.payouts} payouts${r.messages.length ? ` (${r.messages.length} note(s))` : ''}`);
      } catch (e) {
        failed = true;
        parts.push(`sync failed: ${(e as Error).message}`);
      }
    }
    if (s.autoSettle) {
      if (failed) parts.push('booking skipped: the sync failed');
      else {
        const to = yesterdayWib();
        try {
          const p = await this.posting.preview(s.id, { to });
          const blocking = p.issues.filter((i) => !/^No orders or refunds/.test(i));
          if (!p.orders && !p.refundsLater) parts.push(`nothing to book up to ${to}`);
          else if (blocking.length) {
            failed = true;
            parts.push(`booking blocked: ${blocking.join('; ')}`);
          } else {
            const r = await this.posting.settle(s.id, { to });
            parts.push(`booked ${r.number}: ${r.orders} order(s), invoiced ${r.gross}, fees ${r.fees}`);
          }
        } catch (e) {
          failed = true;
          parts.push(`booking failed: ${(e as Error).message}`);
        }
      }
    }
    const result = (parts.join(' · ') || 'nothing set to run').slice(0, 500);
    await this.prisma.marketplaceStore.update({ where: { id: s.id }, data: { lastAutoRunAt: new Date(), lastAutoResult: `${failed ? 'ERROR ' : ''}${result}`.slice(0, 500) } });
    await this.audit.record('Marketplace Store', s.id, 'DAILY_JOB', undefined, { result, failed });
    return result;
  }
}
