import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { forEachCompany, periodFromIndex, periodIndex, todayIso } from '../billing/job-context';
import { AssetService } from './asset.service';

/** Posts last month's depreciation on the 1st of every month (02:00 server time). */
@Injectable()
export class AssetScheduler {
  private readonly logger = new Logger('AssetScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly assets: AssetService,
  ) {}

  @Cron('0 2 1 * *', { name: 'asset-depreciation' })
  async monthly() {
    const period = periodFromIndex(periodIndex(todayIso().slice(0, 7)) - 1);
    await forEachCompany(this.prisma, this.logger, 'asset-depreciation', async (companyId) => {
      if (!(await this.settings.bool('accounting.autoDepreciation', companyId, true))) return null;
      const r = await this.assets.run(period);
      return r.entries || r.failed ? `${period}: ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'} posted, ${r.failed} failed` : null;
    });
  }
}
