import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RequestCtx } from '../../common/context/request-context';

export const num = (v: unknown) => Number(v ?? 0);
export const round2 = (v: number) => Math.round(v * 100) / 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(id: string): string {
  if (!UUID.test(id ?? '')) throw new NotFoundException('Record not found');
  return id;
}
export function uuids(csv?: string, max = 200): string[] {
  return [...new Set(String(csv ?? '').split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, max);
}

/** 'YYYY-MM-DD' -> UTC date (end of day when `end`) */
export function day(s: string | undefined, end = false): Date | undefined {
  if (!s) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('Invalid date');
  return new Date(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
}

/** 'YYYY-MM' -> [first day, last day] in UTC */
export function monthRange(m?: string): { start: Date; end: Date; key: string } {
  const now = new Date();
  const key = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, mo] = key.split('-').map(Number);
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 0, 23, 59, 59, 999)), key };
}

export const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
export const yearStart = () => new Date(Date.UTC(new Date().getFullYear(), 0, 1));

/** user sees every record of the company (not only own / branch) */
export function seesCompany(managePermission?: string): boolean {
  const u = RequestCtx.user();
  return u.isSuperAdmin || u.dataScope === 'ALL' || u.dataScope === 'COMPANY' || (!!managePermission && RequestCtx.can(managePermission));
}
