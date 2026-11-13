import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestCtx } from '../../common/context/request-context';

const safeLink = (v: string | null) => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
};

/** Running text under the top bar: every signed-in user of the company sees the active announcements */
@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('active')
  async active() {
    const companyId = RequestCtx.companyId();
    const now = new Date();
    const rows = await this.prisma.announcement.findMany({
      where: {
        companyId,
        isActive: true,
        deletedAt: null,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 10,
      select: { id: true, message: true, tone: true, linkUrl: true, updatedAt: true },
    });
    return rows.map((r) => ({ id: r.id, message: r.message, tone: r.tone, link: safeLink(r.linkUrl), updatedAt: r.updatedAt.toISOString() }));
  }
}
