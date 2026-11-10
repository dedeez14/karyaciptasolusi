import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Activity } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FileOutputService } from '../files/file-output.service';
import { REPORT_MAP, REPORTS, ReportCtx, ReportDef } from './report.registry';

const SAFE = /^[\w\-:.,]{0,60}$/;

@Controller('reports')
export class ReportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly output: FileOutputService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  private ctx(def: ReportDef, q: Record<string, unknown>): ReportCtx {
    return { prisma: this.prisma, companyId: RequestCtx.companyId(), p: this.params(def, q), decrypt: (v) => this.crypto.decrypt(v), can: (c) => RequestCtx.can(c) };
  }

  private def(key: string): ReportDef {
    const d = REPORT_MAP.get(key);
    if (!d) throw new NotFoundException('Report not found');
    RequestCtx.assert(`report.${d.key}.view`);
    return d;
  }

  private params(def: ReportDef, q: Record<string, unknown>) {
    const p: Record<string, string | undefined> = {};
    for (const param of def.params) {
      const v = q[param.name];
      if (typeof v !== 'string' || !v || !SAFE.test(v)) continue;
      if (param.type === 'date' && Number.isNaN(Date.parse(v))) continue;
      if (param.type === 'relation' && !/^[0-9a-f-]{36}$/i.test(v)) continue;
      if (param.type === 'select' && !param.options?.some((o) => o.value === v)) continue;
      p[param.name] = v;
    }
    return p;
  }

  @Get()
  list() {
    return REPORTS.filter((r) => RequestCtx.can(`report.${r.key}.view`)).map(({ run, ...r }) => r);
  }

  @Get(':key')
  async run(@Param('key') key: string, @Query() q: Record<string, unknown>) {
    const def = this.def(key);
    const { run, ...meta } = def;
    const result = await run(this.ctx(def, q));
    return { report: meta, ...result };
  }

  @Activity('report.export')
  @Get(':key/export')
  async export(@Param('key') key: string, @Query() q: Record<string, unknown>, @Res() res: Response) {
    const def = this.def(key);
    const r = await def.run(this.ctx(def, q));
    this.audit.activity('report.export', { report: key, format: q.format });
    await this.output.sendTable(res, { title: def.label, subtitle: r.subtitle, columns: r.columns, rows: r.rows, totals: r.totals }, String(q.format ?? 'xlsx'), q.save === '1');
  }
}
