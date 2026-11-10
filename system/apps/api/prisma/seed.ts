/**
 * Idempotent seed: global reference data, permissions (generated from the registries),
 * menus, roles, the first company (fully provisioned) and the super administrator.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { permissionCatalog } from '../src/modules/system/permission.catalog';
import { CompanyBootstrapService } from '../src/modules/system/company-bootstrap.service';
import { BANKS, COUNTRIES, CURRENCIES, LOOKUPS, MENUS, ROLES, SETTINGS } from './seed-data';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding reference data...');
  for (const [code, name, symbol, decimals] of CURRENCIES) await prisma.currency.upsert({ where: { code }, create: { code, name, symbol, decimals }, update: {} });
  for (const [code, name, phoneCode] of COUNTRIES) await prisma.country.upsert({ where: { code }, create: { code, name, phoneCode }, update: {} });
  for (const [code, name, swiftCode] of BANKS) await prisma.bank.upsert({ where: { code }, create: { code, name, swiftCode }, update: {} });
  for (const [category, values] of Object.entries(LOOKUPS)) {
    let i = 0;
    for (const [code, name, color] of values) {
      const exists = await prisma.lookupValue.findFirst({ where: { companyId: null, category, code } });
      if (!exists) await prisma.lookupValue.create({ data: { category, code, name, color, sortOrder: (i += 10) } });
    }
  }
  for (const [group, key, label, valueType, value, isSecret, description] of SETTINGS) {
    const exists = await prisma.setting.findFirst({ where: { companyId: null, key } });
    if (!exists) await prisma.setting.create({ data: { group, key, label, valueType, value, isSecret, description } });
    else await prisma.setting.update({ where: { id: exists.id }, data: { group, label, valueType, isSecret, description } });
  }

  console.log('Syncing permissions...');
  const catalog = permissionCatalog();
  for (const p of catalog) await prisma.permission.upsert({ where: { code: p.code }, create: p, update: { module: p.module, resource: p.resource, action: p.action, description: p.description } });
  const stale = await prisma.permission.findMany({ where: { code: { notIn: catalog.map((p) => p.code) } } });
  if (stale.length) await prisma.permission.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });

  console.log('Syncing menus...');
  const menuIds = new Map<string, string>();
  let order = 0;
  for (const [code, parent, label, icon, path, permissionCode] of MENUS) {
    order += 10;
    const parentId = parent ? menuIds.get(parent) ?? null : null;
    const m = await prisma.menu.upsert({ where: { code }, create: { code, parentId, label, icon, path, permissionCode, sortOrder: order }, update: { permissionCode } });
    menuIds.set(code, m.id);
  }

  console.log('Syncing roles...');
  const allPerms = await prisma.permission.findMany();
  for (const [code, name, dataScope, rules] of ROLES) {
    const existing = await prisma.role.findFirst({ where: { companyId: null, code } });
    const role = existing ?? (await prisma.role.create({ data: { code, name, dataScope, isSystem: true } }));
    const matched = allPerms.filter((p) =>
      rules.some((r) => r === '*' || (r.startsWith('*.') ? p.code.endsWith(r.slice(1)) : r.endsWith('.') || r.endsWith('-') ? p.code.startsWith(r) : p.code === r || p.code.startsWith(r + '.'))),
    );
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: matched.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
  }

  console.log('Provisioning company...');
  let company = await prisma.company.findUnique({ where: { code: 'KCS' } });
  if (!company) {
    company = await prisma.company.create({
      data: { code: 'KCS', name: 'Karya Cipta Solusi', legalName: 'PT Karya Cipta Solusi', website: 'https://karyaciptasolusi.com', email: 'info@karyaciptasolusi.com', countryCode: 'ID', currencyCode: 'IDR', city: 'Jakarta' },
    });
  }
  const ho = await new CompanyBootstrapService().bootstrap(prisma, company.id);

  const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').toLowerCase();
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@karyaciptasolusi.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!(await prisma.user.findUnique({ where: { username } }))) {
    if (!password || password.length < 10) throw new Error('Set SEED_ADMIN_PASSWORD (min 10 chars) in apps/api/.env');
    const admin = await prisma.user.create({
      data: {
        username,
        email,
        fullName: 'System Administrator',
        passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
        isSuperAdmin: true,
        mustChangePassword: true,
        defaultCompanyId: company.id,
        defaultBranchId: ho.id,
        passwordChangedAt: new Date(),
      },
    });
    const adminRole = await prisma.role.findFirstOrThrow({ where: { companyId: null, code: 'ADMINISTRATOR' } });
    await prisma.userAssignment.create({ data: { userId: admin.id, companyId: company.id, roleId: adminRole.id } });
    console.log(`Super administrator "${username}" created (password from SEED_ADMIN_PASSWORD).`);
  }
  console.log(`Done. ${catalog.length} permissions, ${MENUS.length} menus, ${ROLES.length} roles.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
