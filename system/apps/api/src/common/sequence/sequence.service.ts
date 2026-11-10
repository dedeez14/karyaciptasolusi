import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../prisma/prisma.service';

/** Concurrency-safe document numbering driven by the number_sequences table. */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(code: string, companyId: string, date: Date = new Date(), tx?: Tx, branchCode = ''): Promise<string> {
    const db = tx ?? this.prisma;
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');

    // Create lazily with a sane default when an administrator has not configured it yet
    await db.numberSequence.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name: code, prefix: `${code}/{YYYY}/`, padding: 5 },
      update: {},
    });

    // Row lock guarantees uniqueness under concurrent requests
    const [seq] = await db.$queryRaw<
      { id: string; prefix: string; padding: number; nextNumber: number; resetPeriod: string; lastPeriod: string | null }[]
    >`SELECT id, prefix, padding, "nextNumber", "resetPeriod", "lastPeriod" FROM number_sequences WHERE "companyId" = ${companyId}::uuid AND code = ${code} FOR UPDATE`;

    const period = seq.resetPeriod === 'MONTHLY' ? `${yyyy}${mm}` : seq.resetPeriod === 'YEARLY' ? yyyy : null;
    let n = seq.nextNumber;
    if (period && seq.lastPeriod !== period) n = 1;

    await db.numberSequence.update({ where: { id: seq.id }, data: { nextNumber: n + 1, lastPeriod: period } });

    const prefix = seq.prefix
      .replaceAll('{YYYY}', yyyy)
      .replaceAll('{YY}', yyyy.slice(2))
      .replaceAll('{MM}', mm)
      .replaceAll('{BR}', branchCode);
    return prefix + String(n).padStart(seq.padding, '0');
  }
}
