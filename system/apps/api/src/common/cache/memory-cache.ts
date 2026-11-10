import { Injectable } from '@nestjs/common';

interface Entry<T> {
  value: T;
  expires: number;
}

/** Small in-process TTL cache (permissions, menus, settings). Prefix based invalidation. */
@Injectable()
export class MemoryCache {
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly maxEntries = 5000;

  get<T>(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds = 60): T {
    if (this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first) this.store.delete(first);
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    return value;
  }

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    return this.set(key, await factory(), ttlSeconds);
  }

  invalidate(prefix: string): void {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }

  clear(): void {
    this.store.clear();
  }
}
