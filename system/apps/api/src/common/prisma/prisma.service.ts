import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');

  constructor() {
    super({ log: [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }] });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Access a model delegate by name (used by the generic resource engine). */
  delegate(model: string, tx?: Tx): any {
    const client: any = tx ?? this;
    const d = client[model];
    if (!d) throw new Error(`Unknown model delegate: ${model}`);
    return d;
  }
}
