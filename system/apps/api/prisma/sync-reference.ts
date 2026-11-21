/**
 * Idempotent reference sync for deploys: PERMISSIONS + MENUS + system ROLE grants.
 *
 * Run on every deploy (after `prisma migrate deploy`) so that a new feature's menu entries and
 * permissions — declared in permission.catalog.ts and seed-data.ts MENUS — show up in the running
 * app without a manual re-seed. Menus stay fully manageable afterwards in System > Menu Management:
 * this never overrides a menu's order or label once it exists (only its permissionCode is kept in sync).
 *
 * SAFE for production: unlike prisma/seed.ts it does NOT provision the company, chart of accounts,
 * admin user, or re-encrypt data. It also does NOT delete "stale" permissions. It only upserts the
 * catalog and re-syncs the permission set of system (companyId = null) roles; custom company roles
 * are never touched.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { permissionCatalog } from '../src/modules/system/permission.catalog';
import { MENUS, ROLES } from './seed-data';

const prisma = new PrismaClient();

async function main() {
  console.log('[sync-reference] permissions...');
  const catalog = permissionCatalog();
  for (const p of catalog)
    await prisma.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { module: p.module, resource: p.resource, action: p.action, description: p.description },
    });

  console.log('[sync-reference] menus...');
  const menuIds = new Map<string, string>();
  let order = 0;
  for (const [code, parent, label, icon, path, permissionCode] of MENUS as any[]) {
    order += 10;
    const parentId = parent ? menuIds.get(parent) ?? null : null;
    const m = await prisma.menu.upsert({
      where: { code },
      create: { code, parentId, label, icon, path, permissionCode, sortOrder: order },
      update: { permissionCode }, // keep order/label edits made in Menu Management
    });
    menuIds.set(code, m.id);
  }

  console.log('[sync-reference] system role grants...');
  const allPerms = await prisma.permission.findMany();
  for (const [code, name, dataScope, rules] of ROLES as any[]) {
    const existing = await prisma.role.findFirst({ where: { companyId: null, code } });
    const role = existing ?? (await prisma.role.create({ data: { code, name, dataScope, isSystem: true } }));
    const hit = (p: { code: string }, r: string) =>
      r === '*' ||
      (r.startsWith('*.') ? p.code.endsWith(r.slice(1)) : r.endsWith('.') || r.endsWith('-') ? p.code.startsWith(r) : p.code === r || p.code.startsWith(r + '.'));
    const include = rules.filter((r: string) => !r.startsWith('!'));
    const exclude = rules.filter((r: string) => r.startsWith('!')).map((r: string) => r.slice(1));
    const matched = allPerms.filter((p) => include.some((r: string) => hit(p, r)) && !exclude.some((r: string) => hit(p, r)));
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: matched.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
  }

  console.log(`[sync-reference] done: ${catalog.length} permissions, ${MENUS.length} menus, ${ROLES.length} roles.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
