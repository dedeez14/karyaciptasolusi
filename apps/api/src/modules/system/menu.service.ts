import { Injectable } from '@nestjs/common';
import type { Menu } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MemoryCache } from '../../common/cache/memory-cache';
import { AuthUser } from '../../common/context/request-context';

export interface MenuNode {
  id: string;
  code: string;
  label: string;
  icon: string | null;
  path: string | null;
  children: MenuNode[];
}

/** Database driven navigation filtered by the user's permissions. */
@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService, private readonly cache: MemoryCache) {}

  all(): Promise<Menu[]> {
    return this.cache.wrap('menu:all', 300, () => this.prisma.menu.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }));
  }

  async treeFor(u: AuthUser): Promise<MenuNode[]> {
    const menus = (await this.all()).filter((m) => m.isActive);
    const allowed = (m: Menu) => !m.permissionCode || u.isSuperAdmin || u.permissions.has(m.permissionCode);
    const build = (parentId: string | null): MenuNode[] =>
      menus
        .filter((m) => m.parentId === parentId)
        .map((m) => ({ id: m.id, code: m.code, label: m.label, icon: m.icon, path: m.path, children: build(m.id) }))
        .filter((n) => {
          const src = menus.find((m) => m.id === n.id)!;
          return n.children.length > 0 || (n.path && allowed(src));
        });
    return build(null);
  }

  invalidate() {
    this.cache.invalidate('menu:');
  }
}
