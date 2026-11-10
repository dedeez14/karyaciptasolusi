import { z } from 'zod';

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
  sort: z.string().regex(/^[a-zA-Z0-9_]+$/).max(50).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export type ListQuery = z.infer<typeof listQuerySchema> & { filters: Record<string, string> };

/** Parses ?page&pageSize&search&sort&order and filter params written as f.<field>=value */
export function parseListQuery(q: Record<string, unknown>): ListQuery {
  const base = listQuerySchema.parse(q);
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (k.startsWith('f.') && /^f\.[a-zA-Z0-9_]+$/.test(k) && typeof v === 'string' && v !== '') filters[k.slice(2)] = v.slice(0, 100);
  }
  return { ...base, filters };
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function paged<T>(data: T[], total: number, q: { page: number; pageSize: number }): Paged<T> {
  return { data, meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
}

export function parseDate(v: unknown): Date | undefined {
  if (!v || typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
