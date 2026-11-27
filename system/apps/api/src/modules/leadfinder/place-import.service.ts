import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { clean, int, mapsUrl, normPhone, num, placeKey, splitEmails, website } from './normalize';

export interface PlaceData {
  placeKey: string;
  query: string | null;
  title: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  emails: string[];
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  businessStatus: string | null;
}

export interface ImportResult {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
}

/** Turns scraper CSV records into MapPlace rows (deduplicated per company, richer data wins). */
@Injectable()
export class PlaceImportService {
  constructor(private readonly prisma: PrismaService) {}

  toPlace(r: Record<string, string>, queries?: Map<string, string>): PlaceData | null {
    const title = clean(r.title, 300);
    const key = placeKey(r);
    if (!title || !key) return null;
    const lat = num(r.latitude);
    const lng = num(r.longitude);
    const okLat = lat !== null && lat >= -90 && lat <= 90 ? lat : null;
    const okLng = lng !== null && lng >= -180 && lng <= 180 ? lng : null;
    const rating = num(r.review_rating);
    return {
      placeKey: key,
      query: queries?.get(clean(r.input_id, 200) ?? '') ?? null,
      title,
      category: clean(r.category, 200),
      address: clean(r.address, 1000),
      phone: normPhone(r.phone),
      website: website(r.website),
      emails: splitEmails(r.emails),
      rating: rating !== null && rating >= 0 && rating <= 5 ? Math.round(rating * 100) / 100 : null,
      reviewCount: int(r.review_count),
      latitude: okLat,
      longitude: okLng,
      mapsUrl: mapsUrl(r, title, okLat, okLng),
      businessStatus: clean(r.status, 50),
    };
  }

  /** Two rows of the same place: keep every value the first one is missing, union the e-mails */
  private merge(a: PlaceData, b: PlaceData): PlaceData {
    return {
      ...a,
      query: a.query ?? b.query,
      category: a.category ?? b.category,
      address: a.address ?? b.address,
      phone: a.phone ?? b.phone,
      website: a.website ?? b.website,
      emails: [...new Set([...a.emails, ...b.emails])].slice(0, 5),
      rating: b.rating ?? a.rating,
      reviewCount: Math.max(a.reviewCount ?? 0, b.reviewCount ?? 0) || a.reviewCount || b.reviewCount,
      latitude: a.latitude ?? b.latitude,
      longitude: a.longitude ?? b.longitude,
      mapsUrl: a.mapsUrl?.includes('/maps/place') ? a.mapsUrl : (b.mapsUrl ?? a.mapsUrl),
      businessStatus: a.businessStatus ?? b.businessStatus,
    };
  }

  async importRecords(companyId: string, jobId: string | null, records: Record<string, string>[], queries?: Map<string, string>): Promise<ImportResult> {
    const byKey = new Map<string, PlaceData>();
    let skipped = 0;
    for (const r of records) {
      const p = this.toPlace(r, queries);
      if (!p) {
        skipped++;
        continue;
      }
      const prev = byKey.get(p.placeKey);
      byKey.set(p.placeKey, prev ? this.merge(prev, p) : p);
    }
    const items = [...byKey.values()];
    let created = 0;
    let updated = 0;
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      const existing = await this.prisma.mapPlace.findMany({ where: { companyId, placeKey: { in: chunk.map((c) => c.placeKey) } } });
      const ex = new Map(existing.map((e) => [e.placeKey, e]));
      const fresh = chunk.filter((c) => !ex.has(c.placeKey));
      if (fresh.length) {
        const r = await this.prisma.mapPlace.createMany({
          data: fresh.map((p) => ({ companyId, jobId, ...this.columns(p) })),
          skipDuplicates: true,
        });
        created += r.count;
      }
      for (const p of chunk.filter((c) => ex.has(c.placeKey))) {
        const e = ex.get(p.placeKey)!;
        const before: PlaceData = {
          placeKey: e.placeKey,
          query: e.query,
          title: e.title,
          category: e.category,
          address: e.address,
          phone: e.phone,
          website: e.website,
          emails: e.emails ? e.emails.split(',').filter(Boolean) : [],
          rating: e.rating === null ? null : Number(e.rating),
          reviewCount: e.reviewCount,
          latitude: e.latitude === null ? null : Number(e.latitude),
          longitude: e.longitude === null ? null : Number(e.longitude),
          mapsUrl: e.mapsUrl,
          businessStatus: e.businessStatus,
        };
        const merged = this.merge(before, p);
        const cols = this.columns(merged);
        const changed = (Object.keys(cols) as (keyof typeof cols)[]).some((k) => String(cols[k] ?? '') !== String((e as Record<string, unknown>)[k] ?? ''));
        // a place nobody has handled yet moves to the latest search that found it (so that search shows it);
        // places already added to leads or ignored stay where they are
        const move = !!jobId && e.statusCode === 'NEW' && e.jobId !== jobId;
        if (!changed && !move) continue;
        await this.prisma.mapPlace.update({ where: { id: e.id }, data: { ...(changed ? cols : {}), ...(move ? { jobId } : {}) } });
        if (changed) updated++;
      }
    }
    return { rows: records.length, created, updated, skipped };
  }

  private columns(p: PlaceData) {
    return {
      placeKey: p.placeKey,
      query: p.query?.slice(0, 300) ?? null,
      title: p.title,
      category: p.category,
      address: p.address,
      phone: p.phone,
      website: p.website,
      emails: p.emails.length ? p.emails.join(',').slice(0, 1000) : null,
      rating: p.rating === null ? null : new Prisma.Decimal(p.rating),
      reviewCount: p.reviewCount,
      latitude: p.latitude === null ? null : new Prisma.Decimal(p.latitude.toFixed(7)),
      longitude: p.longitude === null ? null : new Prisma.Decimal(p.longitude.toFixed(7)),
      mapsUrl: p.mapsUrl,
      businessStatus: p.businessStatus,
    };
  }
}
