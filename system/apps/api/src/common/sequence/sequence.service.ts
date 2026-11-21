import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../prisma/prisma.service';

/**
 * Concurrency-safe document numbering driven by the number_sequences table.
 * Sequences that reset monthly / yearly keep one counter per period (number_sequence_periods), so a
 * document dated in another month (back-dated entry, depreciation catch-up, ...) continues that
 * month's numbering instead of restarting at 1 and colliding with existing numbers.
 */
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

    // Row lock on the sequence serialises every number of this sequence (all periods)
    const [seq] = await db.$queryRaw<
      { id: string; prefix: string; padding: number; nextNumber: number; resetPeriod: string; lastPeriod: string | null }[]
    >`SELECT id, prefix, padding, "nextNumber", "resetPeriod", "lastPeriod" FROM number_sequences WHERE "companyId" = ${companyId}::uuid AND code = ${code} FOR UPDATE`;

    const period = seq.resetPeriod === 'MONTHLY' ? `${yyyy}${mm}` : seq.resetPeriod === 'YEARLY' ? yyyy : null;
    let n: number;
    if (period) {
      await db.$executeRaw`INSERT INTO number_sequence_periods ("sequenceId", period, "nextNumber") VALUES (${seq.id}::uuid, ${period}, 1) ON CONFLICT ("sequenceId", period) DO NOTHING`;
      const [row] = await db.$queryRaw<{ nextNumber: number }[]>`SELECT "nextNumber" FROM number_sequence_periods WHERE "sequenceId" = ${seq.id}::uuid AND period = ${period}`;
      // an administrator may have raised "next number" for the current period in Number Sequences
      n = Math.max(Number(row.nextNumber), seq.lastPeriod === period ? seq.nextNumber : 1);
      await db.$executeRaw`UPDATE number_sequence_periods SET "nextNumber" = ${n + 1} WHERE "sequenceId" = ${seq.id}::uuid AND period = ${period}`;
      // the sequence row shows the latest period (what the settings page displays)
      if (!seq.lastPeriod || period >= seq.lastPeriod) await db.numberSequence.update({ where: { id: seq.id }, data: { nextNumber: n + 1, lastPeriod: period } });
    } else {
      n = seq.nextNumber;
      await db.numberSequence.update({ where: { id: seq.id }, data: { nextNumber: n + 1, lastPeriod: null } });
    }

    const prefix = seq.prefix
      .replaceAll('{YYYY}', yyyy)
      .replaceAll('{YY}', yyyy.slice(2))
      .replaceAll('{MM}', mm)
      .replaceAll('{BR}', branchCode);
    return prefix + String(n).padStart(seq.padding, '0');
  }
}
