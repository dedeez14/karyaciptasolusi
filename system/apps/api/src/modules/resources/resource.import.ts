import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestCtx } from '../../common/context/request-context';
import { ResourceService } from './resource.service';
import { RESOURCE_MAP } from './resource.registry';
import { FieldDef, ResourceDef } from './resource.types';

const MAX_ROWS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCsv(text: string): string[][] {
  const first = text.split('\n')[0] ?? '';
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Bulk import of master data from Excel / CSV, re-using the same validation, permissions and audit as the form. */
@Injectable()
export class ResourceImportService {
  constructor(private readonly prisma: PrismaService, private readonly resources: ResourceService) {}

  private fields(def: ResourceDef): FieldDef[] {
    return this.resources.visibleFields(def).filter((f) => !f.readOnly);
  }

  template(key: string) {
    const def = this.resources.def(key);
    RequestCtx.assert(`${def.permission}.create`);
    const fields = this.fields(def);
    return {
      title: `${def.label} import template`,
      subtitle: 'One row per record. Relations accept the code or name, lists accept the code or label, switches accept Yes/No, dates YYYY-MM-DD.',
      columns: fields.map((f) => ({ key: f.name, label: f.label + (f.required && def.autoCode?.field !== f.name ? ' *' : ''), type: 'text' })),
      rows: [],
    };
  }

  private async readRows(buffer: Buffer, filename: string): Promise<string[][]> {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv' || ext === 'txt') return parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
    if (ext !== 'xlsx') throw new BadRequestException('Upload an .xlsx or .csv file');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const out: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = (r.values as unknown[]).slice(1).map((v: any) => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') return String(v.result ?? v.text ?? v.richText?.map((t: any) => t.text).join('') ?? '');
        return String(v);
      });
      out.push(vals);
    });
    return out;
  }

  private async resolve(f: FieldDef, raw: string): Promise<unknown> {
    const v = raw.trim();
    if (v === '') return undefined;
    switch (f.type) {
      case 'boolean':
        return ['1', 'yes', 'y', 'true', 'ya', 'active'].includes(v.toLowerCase());
      case 'number':
      case 'integer':
      case 'money':
      case 'percent': {
        // accepts 1.234.567,89 / 1,234,567.89 / 1234567.89
        const cleaned = v.replace(/[^\d.,-]/g, '');
        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');
        const decimalSep = lastComma > lastDot ? ',' : '.';
        const normalized = decimalSep === ',' ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
        return Number(normalized);
      }
      case 'lookup': {
        const lv = await this.prisma.lookupValue.findFirst({
          where: { category: f.lookup!, deletedAt: null, OR: [{ code: { equals: v, mode: 'insensitive' } }, { name: { equals: v, mode: 'insensitive' } }] },
          select: { code: true },
        });
        return lv?.code ?? v;
      }
      case 'relation': {
        if (UUID.test(v)) return v;
        const target = RESOURCE_MAP.get(f.relation!.resource)!;
        const idField = target.idField ?? 'id';
        const term = v.split(' - ')[0].trim();
        const where: Record<string, unknown> = { OR: target.labelFields.map((lf) => ({ [lf]: { equals: term, mode: 'insensitive' } })) };
        if (target.scope === 'company') where.companyId = RequestCtx.companyId();
        const row = await this.prisma.delegate(target.model).findFirst({ where, select: { [idField]: true } });
        if (!row) throw new BadRequestException(`${f.label} "${v}" not found`);
        return row[idField];
      }
      case 'tags':
        return v
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean);
      default:
        return v;
    }
  }

  async import(key: string, buffer: Buffer, filename: string) {
    const def = this.resources.def(key);
    RequestCtx.assert(`${def.permission}.create`);
    const fields = this.fields(def);
    const rows = await this.readRows(buffer, filename);
    const norm = (s: string) => s.replace(/\*/g, '').trim().toLowerCase();
    const match = (h: string) => fields.find((f) => norm(f.label) === norm(h) || f.name.toLowerCase() === norm(h));
    const headerIdx = rows.findIndex((r) => r.some((c) => match(c)));
    if (headerIdx < 0) throw new BadRequestException('No matching column headers found. Download the import template first.');
    const header = rows[headerIdx].map((h) => match(h) ?? null);
    const data = rows.slice(headerIdx + 1);
    if (data.length > MAX_ROWS) throw new BadRequestException(`Too many rows (maximum ${MAX_ROWS} per file)`);

    let created = 0;
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < data.length; i++) {
      const body: Record<string, unknown> = {};
      try {
        for (let c = 0; c < header.length; c++) {
          const f = header[c];
          if (!f) continue;
          const val = await this.resolve(f, data[i][c] ?? '');
          if (val !== undefined) body[f.name] = val;
        }
        await this.resources.create(key, body);
        created++;
      } catch (e: any) {
        const fieldErrors = e?.response?.errors as Record<string, string> | undefined;
        const detail = fieldErrors
          ? Object.entries(fieldErrors)
              .map(([k, m]) => `${fields.find((f) => f.name === k)?.label ?? k}: ${m}`)
              .join('; ')
          : e?.issues
            ? e.issues.map((x: any) => `${fields.find((f) => f.name === x.path?.[0])?.label ?? x.path?.join('.')}: ${x.message}`).join('; ')
            : e?.message;
        errors.push({ row: headerIdx + i + 2, message: String(detail ?? 'Invalid row').slice(0, 300) });
      }
    }
    return { total: data.length, created, failed: errors.length, errors: errors.slice(0, 200) };
  }
}
