import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { cityFromAddress, normalizeEmail } from './render';

const codes = z.array(z.string().trim().max(50).regex(/^[A-Za-z0-9_.-]+$/)).max(50).default([]);
const optUuid = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.uuid().optional());
const optDate = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

/** Who receives a campaign. Stored as JSON on the campaign. */
export const audienceSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('LEADS'),
    statusCodes: codes,
    sourceCodes: codes,
    industryCodes: codes,
    campaignId: optUuid,
    createdFrom: optDate,
    createdTo: optDate,
  }),
  z.object({
    source: z.literal('CUSTOMERS'),
    groupId: optUuid,
    industryCodes: codes,
  }),
  z.object({
    source: z.literal('MAP_PLACES'),
    jobId: optUuid,
    category: z.string().trim().max(100).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    statusCodes: codes,
  }),
  z.object({
    source: z.literal('MANUAL'),
    /** one contact per line: "email" or "email, name" (comma, semicolon or tab separated) */
    list: z.string().max(200_000).default(''),
  }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export interface Contact {
  email: string;
  name: string | null;
  company: string | null;
  city: string | null;
  entityType: 'LEAD' | 'CUSTOMER' | 'MAP_PLACE' | 'MANUAL';
  entityId: string | null;
}

export interface AudienceResult {
  contacts: Contact[];
  found: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
}

const MAX_CONTACTS = 50_000;

async function rawContacts(prisma: PrismaService, companyId: string, a: Audience): Promise<{ raw: string | null; contact: Omit<Contact, 'email'> }[]> {
  if (a.source === 'LEADS') {
    const where: Prisma.LeadWhereInput = { companyId, deletedAt: null };
    if (a.statusCodes.length) where.statusCode = { in: a.statusCodes };
    if (a.sourceCodes.length) where.sourceCode = { in: a.sourceCodes };
    if (a.industryCodes.length) where.industryCode = { in: a.industryCodes };
    if (a.campaignId) where.campaignId = a.campaignId;
    if (a.createdFrom || a.createdTo)
      where.createdAt = { ...(a.createdFrom ? { gte: new Date(`${a.createdFrom}T00:00:00`) } : {}), ...(a.createdTo ? { lte: new Date(`${a.createdTo}T23:59:59.999`) } : {}) };
    const rows = await prisma.lead.findMany({ where, select: { id: true, name: true, companyName: true, email: true, address: true }, orderBy: { createdAt: 'asc' }, take: MAX_CONTACTS });
    return rows.map((r) => ({ raw: r.email, contact: { name: r.name, company: r.companyName, city: cityFromAddress(r.address), entityType: 'LEAD', entityId: r.id } }));
  }
  if (a.source === 'CUSTOMERS') {
    const where: Prisma.CustomerWhereInput = { companyId, deletedAt: null, isActive: true };
    if (a.groupId) where.groupId = a.groupId;
    if (a.industryCodes.length) where.industryCode = { in: a.industryCodes };
    const rows = await prisma.customer.findMany({ where, select: { id: true, name: true, contactPerson: true, email: true, city: true }, orderBy: { name: 'asc' }, take: MAX_CONTACTS });
    return rows.map((r) => ({ raw: r.email, contact: { name: r.contactPerson || r.name, company: r.name, city: r.city, entityType: 'CUSTOMER', entityId: r.id } }));
  }
  if (a.source === 'MAP_PLACES') {
    const where: Prisma.MapPlaceWhereInput = { companyId, emails: { not: null } };
    if (a.jobId) where.jobId = a.jobId;
    if (a.category) where.category = { contains: a.category, mode: 'insensitive' };
    if (a.minRating !== undefined && a.minRating > 0) where.rating = { gte: a.minRating };
    where.statusCode = { in: a.statusCodes.length ? a.statusCodes.filter((s) => s !== 'IGNORED') : ['NEW', 'IMPORTED'] };
    const rows = await prisma.mapPlace.findMany({ where, select: { id: true, title: true, emails: true, address: true }, orderBy: { createdAt: 'asc' }, take: MAX_CONTACTS });
    return rows.map((r) => {
      // first valid address of the comma / space separated list found on the website
      const first = (r.emails ?? '').split(/[\s,;]+/).find((e) => normalizeEmail(e)) ?? r.emails;
      return { raw: first, contact: { name: null, company: r.title, city: cityFromAddress(r.address), entityType: 'MAP_PLACE', entityId: r.id } };
    });
  }
  const lines = a.list.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_CONTACTS);
  return lines.map((l) => {
    const [email, ...rest] = l.split(/[,;\t]/);
    const name = rest.join(' ').trim() || null;
    return { raw: email, contact: { name, company: null, city: null, entityType: 'MANUAL', entityId: null } };
  });
}

/** Contacts of an audience after removing invalid addresses, duplicates and the do-not-email list. */
export async function resolveAudience(prisma: PrismaService, companyId: string, a: Audience): Promise<AudienceResult> {
  const raw = await rawContacts(prisma, companyId, a);
  const suppressed = new Set((await prisma.emailSuppression.findMany({ where: { companyId }, select: { email: true } })).map((s) => s.email));
  const seen = new Set<string>();
  const contacts: Contact[] = [];
  let invalid = 0;
  let duplicates = 0;
  let blocked = 0;
  for (const r of raw) {
    const email = normalizeEmail(r.raw);
    if (!email) {
      invalid++;
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    if (suppressed.has(email)) {
      blocked++;
      continue;
    }
    contacts.push({ email, ...r.contact });
  }
  return { contacts, found: raw.length, invalid, duplicates, suppressed: blocked };
}
