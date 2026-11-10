import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryCache } from '../cache/memory-cache';
import { CryptoService } from '../crypto/crypto.service';

/**
 * Database driven configuration (no hardcoded business values).
 * Resolution order: company override -> global value -> caller fallback.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly cache: MemoryCache, private readonly crypto: CryptoService) {}

  private async all(companyId: string | null) {
    return this.cache.wrap(`settings:${companyId ?? 'global'}`, 120, async () => {
      const rows = await this.prisma.setting.findMany({ where: { OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] } });
      const map = new Map<string, (typeof rows)[number]>();
      for (const r of rows.filter((r) => r.companyId === null)) map.set(r.key, r);
      for (const r of rows.filter((r) => r.companyId !== null)) map.set(r.key, r);
      return map;
    });
  }

  async raw(key: string, companyId: string | null = null): Promise<string | null> {
    const row = (await this.all(companyId)).get(key);
    if (!row || row.value === null) return null;
    return row.isSecret ? this.crypto.decrypt(row.value) : row.value;
  }

  async str(key: string, companyId: string | null, fallback = ''): Promise<string> {
    return (await this.raw(key, companyId)) ?? fallback;
  }

  async num(key: string, companyId: string | null, fallback: number): Promise<number> {
    const v = Number(await this.raw(key, companyId));
    return Number.isFinite(v) && (await this.raw(key, companyId)) !== null ? v : fallback;
  }

  async bool(key: string, companyId: string | null, fallback: boolean): Promise<boolean> {
    const v = await this.raw(key, companyId);
    return v === null ? fallback : v === 'true' || v === '1';
  }

  async json<T>(key: string, companyId: string | null, fallback: T): Promise<T> {
    const v = await this.raw(key, companyId);
    if (!v) return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }

  /** Settings list for the UI. Secrets are never returned - only whether they are set. */
  async list(companyId: string) {
    const map = await this.all(companyId);
    return [...map.values()]
      .filter((s) => s.group !== 'internal')
      .sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key))
      .map((s) => ({
        key: s.key,
        group: s.group,
        label: s.label,
        description: s.description,
        valueType: s.valueType,
        isSecret: s.isSecret,
        scope: s.companyId ? 'company' : 'global',
        value: s.isSecret ? null : s.value,
        hasValue: s.value !== null && s.value !== '',
      }));
  }

  async set(key: string, value: string | null, companyId: string | null, userId?: string) {
    const template = await this.prisma.setting.findFirst({ where: { key, companyId: null } });
    if (!template) throw new Error(`Unknown setting ${key}`);
    const stored = template.isSecret && value ? this.crypto.encrypt(value) : value;
    if (companyId) {
      await this.prisma.setting.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, group: template.group, value: stored, valueType: template.valueType, label: template.label, description: template.description, isSecret: template.isSecret, updatedById: userId },
        update: { value: stored, updatedById: userId },
      });
    } else {
      await this.prisma.setting.update({ where: { id: template.id }, data: { value: stored, updatedById: userId } });
    }
    this.cache.invalidate('settings:');
  }
}
