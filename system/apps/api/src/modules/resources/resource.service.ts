import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { RequestCtx } from '../../common/context/request-context';
import { ListQuery, paged } from '../../common/utils/query';
import { RESOURCE_MAP, RESOURCES } from './resource.registry';
import { FieldDef, ResourceDef } from './resource.types';
import { buildSchemas } from './resource.schema';
import { ResourceHooks } from './resource.hooks';

type Row = Record<string, any>;

/** Column introspection from Prisma DMMF (avoids hardcoding which tables have audit columns) */
const MODEL_FIELDS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name.charAt(0).toLowerCase() + m.name.slice(1), new Set(m.fields.map((f) => f.name))]));
const has = (model: string, field: string) => MODEL_FIELDS.get(model)?.has(field) ?? false;

/**
 * Generic, metadata driven CRUD engine used by every master-data style resource.
 * Applies: RBAC, tenant isolation, branch/own data scope (ACL), field level permissions,
 * validation, field encryption, relation ownership checks, auto numbering and audit trail.
 */
@Injectable()
export class ResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly hooks: ResourceHooks,
  ) {}

  def(key: string): ResourceDef {
    const d = RESOURCE_MAP.get(key);
    if (!d) throw new NotFoundException(`Unknown resource ${key}`);
    return d;
  }

  private ops(def: ResourceDef) {
    return def.operations ?? ['read', 'create', 'update', 'delete'];
  }

  private assertOp(def: ResourceDef, op: 'read' | 'create' | 'update' | 'delete' | 'export') {
    if (op !== 'export' && !this.ops(def).includes(op)) throw new ForbiddenException(`${def.label}: ${op} is not allowed`);
    RequestCtx.assert(`${def.permission}.${op}`);
  }

  /** Fields the current user may see */
  visibleFields(def: ResourceDef): FieldDef[] {
    return def.fields.filter((f) => !f.permission || RequestCtx.can(f.permission));
  }

  /** Metadata consumed by the frontend to render tables, forms and filters */
  meta(def: ResourceDef) {
    if (!['read', 'create', 'update'].some((op) => RequestCtx.can(`${def.permission}.${op}`)) && !this.canUseOptions(def)) throw new ForbiddenException(`You do not have access to ${def.label}`);
    const can = (op: string) => RequestCtx.can(`${def.permission}.${op}`) && (op === 'export' || this.ops(def).includes(op as any));
    return {
      key: def.key,
      label: def.label,
      singular: def.singular,
      module: def.module,
      idField: def.idField ?? 'id',
      fields: this.visibleFields(def),
      defaultSort: def.defaultSort,
      autoCode: def.autoCode?.field ?? null,
      can: { read: can('read'), create: can('create'), update: can('update'), delete: can('delete'), export: can('export') },
    };
  }

  metaList() {
    return RESOURCES.filter((r) => RequestCtx.can(`${r.permission}.read`)).map((r) => ({ key: r.key, label: r.label, module: r.module }));
  }

  private baseWhere(def: ResourceDef): Row {
    const where: Row = def.scope === 'company' ? this.access.scopeWhere({ branchField: def.branchField, ownerField: def.ownerField ?? (has(def.model, 'createdById') ? 'createdById' : null) }) : {};
    if (def.softDelete !== false && has(def.model, 'deletedAt')) where.deletedAt = null;
    return where;
  }

  private async scopedWhere(def: ResourceDef): Promise<Row> {
    const where = this.baseWhere(def);
    const u = RequestCtx.user();
    if (def.key === 'companies' && !u.isSuperAdmin) where.id = { in: (await this.access.companiesFor(u.id)).map((c) => c.id) };
    // users are global records: show only people who work in the current company (and the super administrators)
    if (def.key === 'users') where.AND = [...((where.AND as Row[]) ?? []), { OR: [{ assignments: { some: { companyId: u.companyId } } }, { isSuperAdmin: true }] }];
    return where;
  }

  /**
   * Who may load the id/label list of a resource for a dropdown, besides holders of its read permission.
   * 'company': every member of the company (reference data picked in many forms).
   * prefixes: holders of any permission of the modules whose forms use the list.
   * Not listed: holders of create/update on a resource that links to it.
   */
  private static readonly OPTIONS_ACCESS: Record<string, 'company' | string[]> = {
    branches: 'company', departments: 'company', positions: 'company', uoms: 'company', currencies: 'company', countries: 'company', banks: 'company',
    'payment-terms': 'company', 'payment-methods': 'company', taxes: 'company', 'cost-centers': 'company', warehouses: 'company', products: 'company',
    'product-categories': 'company', brands: 'company', 'customer-groups': 'company', 'supplier-groups': 'company', campaigns: 'company', projects: 'company',
    users: 'company', 'task-stages': 'company', 'leave-types': 'company', holidays: 'company', 'pipeline-stages': 'company', companies: 'company',
    accounts: ['accounting.', 'hris.expense', 'hris.payroll', 'sales.payment', 'purchase.payment'],
    'work-centers': ['manufacturing.', 'maintenance.'],
    equipment: ['maintenance.', 'manufacturing.'],
    'waste-types': ['compliance.'],
    'pos-outlets': 'company', 'pos-tables': 'company', 'price-lists': 'company',
    'bank-accounts': ['accounting.', 'pos.', 'sales.payment', 'purchase.payment', 'hris.expense.pay', 'hris.payroll.pay', 'hris.payroll.create'],
    customers: ['sales.', 'pos.', 'crm.', 'support.ticket', 'task.', 'master.project', 'report.'],
    suppliers: ['purchase.', 'accounting.asset', 'accounting.cash', 'report.', 'manufacturing.', 'compliance.'],
    employees: ['hris.', 'accounting.asset', 'task.', 'report.employee-directory'],
  };

  private canUseOptions(def: ResourceDef) {
    if (RequestCtx.can(`${def.permission}.read`)) return true;
    const rule = ResourceService.OPTIONS_ACCESS[def.key];
    if (rule === 'company') return true;
    const mine = [...RequestCtx.user().permissions];
    if (rule && mine.some((p) => rule.some((prefix) => p.startsWith(prefix)))) return true;
    return RESOURCES.some((r) => r.fields.some((f) => f.relation?.resource === def.key) && (RequestCtx.can(`${r.permission}.create`) || RequestCtx.can(`${r.permission}.update`)));
  }

  private filterWhere(def: ResourceDef, filters: Record<string, string>): Row {
    const where: Row = {};
    for (const [k, v] of Object.entries(filters)) {
      const f = def.fields.find((x) => x.name === k);
      if (!f || f.encrypted || (f.permission && !RequestCtx.can(f.permission))) continue;
      if (f.type === 'boolean') where[k] = v === 'true';
      else if (f.type === 'date' || f.type === 'datetime') {
        const [from, to] = v.split('..');
        where[k] = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
      } else if (['number', 'money', 'integer', 'percent'].includes(f.type)) {
        if (Number.isFinite(Number(v))) where[k] = Number(v);
      } else if (f.type === 'text' || f.type === 'email') where[k] = { contains: v, mode: 'insensitive' };
      else where[k] = v;
    }
    return where;
  }

  async list(key: string, q: ListQuery) {
    const def = this.def(key);
    this.assertOp(def, 'read');
    const where: Row = { ...(await this.scopedWhere(def)), ...this.filterWhere(def, q.filters) };
    if (q.search && def.searchFields.length) {
      const or = def.searchFields.map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } }));
      where.AND = [...(where.AND ?? []), { OR: or }];
    }
    const sortField = q.sort && (def.fields.some((f) => f.name === q.sort && !f.encrypted) || ['createdAt', 'updatedAt'].includes(q.sort)) ? q.sort : def.defaultSort?.field ?? 'createdAt';
    const order = q.sort ? q.order : def.defaultSort?.order ?? 'asc';
    const delegate = this.prisma.delegate(def.model);
    const [rows, total] = await Promise.all([
      delegate.findMany({ where, orderBy: [{ [sortField]: order }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      delegate.count({ where }),
    ]);
    return paged(await this.present(def, rows, 'list'), total, q);
  }

  async get(key: string, id: string) {
    const def = this.def(key);
    this.assertOp(def, 'read');
    const row = await this.findOwned(def, id);
    const [presented] = await this.present(def, [row], 'detail');
    return presented;
  }

  private async findOwned(def: ResourceDef, id: string): Promise<Row> {
    const idField = def.idField ?? 'id';
    if (idField === 'id' && !/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException(`${def.singular} not found`);
    const row = await this.prisma.delegate(def.model).findFirst({ where: { ...(await this.scopedWhere(def)), [idField]: id } });
    if (!row) throw new NotFoundException(`${def.singular} not found`);
    return row;
  }

  /** Decrypt/mask, strip forbidden fields, and attach display labels for relations & lookups */
  async present(def: ResourceDef, rows: Row[], mode: 'list' | 'detail' | 'export'): Promise<Row[]> {
    const fields = this.visibleFields(def);
    const hidden = def.fields.filter((f) => !fields.includes(f)).map((f) => f.name);
    const labels = await this.resolveLabels(fields, rows);
    return rows.map((r) => {
      const out: Row = { ...r };
      for (const h of hidden) delete out[h];
      delete out.passwordHash;
      for (const f of fields) {
        if (f.encrypted && out[f.name]) {
          const plain = this.crypto.decrypt(out[f.name]);
          out[f.name] = mode === 'list' ? this.crypto.mask(plain) : plain;
        }
      }
      out._labels = labels(r);
      return out;
    });
  }

  private async resolveLabels(fields: FieldDef[], rows: Row[]) {
    const relMaps = new Map<string, Map<string, string>>();
    const lookupMap = new Map<string, string>();
    await Promise.all(
      fields
        .filter((f) => f.type === 'relation' && f.relation)
        .map(async (f) => {
          const ids = [...new Set(rows.map((r) => r[f.name]).filter(Boolean))];
          const target = RESOURCE_MAP.get(f.relation!.resource);
          if (!target || !ids.length) return;
          const idField = target.idField ?? 'id';
          const recs: Row[] = await this.prisma.delegate(target.model).findMany({
            where: { [idField]: { in: ids } },
            select: Object.fromEntries([idField, ...target.labelFields].map((k) => [k, true])),
          });
          relMaps.set(f.name, new Map(recs.map((x) => [x[idField], this.label(target, x)])));
        }),
    );
    const lookupFields = fields.filter((f) => f.type === 'lookup');
    if (lookupFields.length) {
      const cats = [...new Set(lookupFields.map((f) => f.lookup!))];
      const values = await this.prisma.lookupValue.findMany({ where: { category: { in: cats } }, select: { category: true, code: true, name: true } });
      for (const v of values) lookupMap.set(`${v.category}:${v.code}`, v.name);
    }
    const selectFields = fields.filter((f) => f.type === 'select');
    return (r: Row) => {
      const l: Record<string, string> = {};
      for (const [field, map] of relMaps) if (r[field]) l[field] = map.get(r[field]) ?? '';
      for (const f of lookupFields) if (r[f.name]) l[f.name] = lookupMap.get(`${f.lookup}:${r[f.name]}`) ?? r[f.name];
      for (const f of selectFields) if (r[f.name]) l[f.name] = f.options?.find((o) => o.value === r[f.name])?.label ?? r[f.name];
      return l;
    };
  }

  label(def: ResourceDef, row: Row): string {
    return def.labelFields.map((k) => row[k]).filter((v) => v !== null && v !== undefined && v !== '').map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))).join(' - ');
  }

  /** Lightweight id/label list for select inputs (see OPTIONS_ACCESS for who may load it). */
  async options(key: string, search?: string, ids?: string[]) {
    const def = this.def(key);
    if (!this.canUseOptions(def)) throw new ForbiddenException(`You do not have access to ${def.label}`);
    const idField = def.idField ?? 'id';
    const where: Row = { ...(await this.scopedWhere(def)), ...(def.optionsWhere ?? {}) };
    if (def.scope === 'company') {
      // options are reference data: company isolation always applies, branch/own scope does not
      delete where.OR;
      delete where.createdById;
      delete where.ownerId;
      where.companyId = RequestCtx.companyId();
    }
    if (ids?.length) {
      // keep the tenant filters (company, the users / companies limits), drop the rest
      Object.keys(where).forEach((k) => !['companyId', 'AND', ...(def.key === 'companies' ? ['id'] : [])].includes(k) && delete where[k]);
      if (def.key === 'companies' && where.id) where.AND = [...((where.AND as Row[]) ?? []), { id: where.id }];
      where[idField] = { in: ids.slice(0, 100) };
    } else if (search && def.searchFields.length) where.OR = def.searchFields.map((f) => ({ [f]: { contains: search, mode: 'insensitive' } }));
    const rows: Row[] = await this.prisma.delegate(def.model).findMany({
      where,
      take: 50,
      orderBy: [{ [def.defaultSort?.field ?? idField]: def.defaultSort?.order ?? 'asc' }],
      select: Object.fromEntries([idField, ...def.labelFields].map((k) => [k, true])),
    });
    return rows.map((r) => ({ value: r[idField], label: this.label(def, r) }));
  }

  private writableFields(def: ResourceDef) {
    return this.visibleFields(def).filter((f) => !f.readOnly);
  }

  private async prepare(def: ResourceDef, data: Row) {
    // relation ownership: prevents referencing another tenant's records (IDOR)
    for (const f of def.fields) {
      const v = data[f.name];
      if (v === null || v === undefined) continue;
      if (f.type === 'relation' && f.relation) {
        const target = RESOURCE_MAP.get(f.relation.resource)!;
        const where: Row = { [target.idField ?? 'id']: v };
        if (target.scope === 'company') where.companyId = RequestCtx.companyId();
        if (!(await this.prisma.delegate(target.model).findFirst({ where, select: { [target.idField ?? 'id']: true } }))) {
          throw new BadRequestException({ message: 'Validation failed', errors: { [f.name]: `${f.label} not found` } });
        }
      }
      if (f.type === 'lookup') {
        const ok = await this.prisma.lookupValue.findFirst({ where: { category: f.lookup!, code: v, deletedAt: null }, select: { id: true } });
        if (!ok) throw new BadRequestException({ message: 'Validation failed', errors: { [f.name]: `${f.label} is not a valid option` } });
      }
      if (f.encrypted) data[f.name] = this.crypto.encrypt(String(v));
    }
    return data;
  }

  async create(key: string, body: unknown) {
    const def = this.def(key);
    this.assertOp(def, 'create');
    const u = RequestCtx.user();
    const { create } = buildSchemas(def, this.writableFields(def));
    const data: Row = create.parse(body);
    await this.prepare(def, data);
    if (def.scope === 'company') data.companyId = u.companyId;
    if (def.branchField && !data[def.branchField] && u.branchId && has(def.model, def.branchField)) data[def.branchField] = u.branchId;
    if (has(def.model, 'createdById')) data.createdById = u.id;
    await this.hooks.beforeCreate(def, data);

    const created = await this.prisma.$transaction(async (tx) => {
      if (def.autoCode && !data[def.autoCode.field]) data[def.autoCode.field] = await this.sequence.next(def.autoCode.sequence, u.companyId, new Date(), tx);
      const row = await this.prisma.delegate(def.model, tx).create({ data });
      await this.audit.record(def.singular, String(row[def.idField ?? 'id']), 'CREATE', undefined, row, tx);
      await this.hooks.afterCreate(def, row, tx);
      return row;
    });
    return (await this.present(def, [created], 'detail'))[0];
  }

  async update(key: string, id: string, body: unknown) {
    const def = this.def(key);
    this.assertOp(def, 'update');
    const u = RequestCtx.user();
    const before = await this.findOwned(def, id);
    await this.hooks.beforeUpdate(def, before);
    const { update } = buildSchemas(def, this.writableFields(def));
    const data: Row = update.parse(body);
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
    await this.prepare(def, data);
    await this.hooks.prepareUpdate(def, before, data);
    if (has(def.model, 'updatedById')) data.updatedById = u.id;
    const idField = def.idField ?? 'id';
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.prisma.delegate(def.model, tx).update({ where: { [idField]: before[idField] }, data });
      await this.audit.record(def.singular, String(row[idField]), 'UPDATE', before, row, tx);
      return row;
    });
    if (['users', 'companies', 'branches'].includes(def.key)) this.access.invalidateUser();
    return (await this.present(def, [updated], 'detail'))[0];
  }

  async remove(key: string, id: string) {
    const def = this.def(key);
    this.assertOp(def, 'delete');
    const before = await this.findOwned(def, id);
    await this.hooks.beforeDelete(def, before);
    const idField = def.idField ?? 'id';
    await this.prisma.$transaction(async (tx) => {
      const d = this.prisma.delegate(def.model, tx);
      if (def.softDelete !== false && has(def.model, 'deletedAt')) {
        await d.update({ where: { [idField]: before[idField] }, data: { deletedAt: new Date(), ...(has(def.model, 'isActive') ? { isActive: false } : {}), ...(has(def.model, 'updatedById') ? { updatedById: RequestCtx.user().id } : {}) } });
      } else {
        try {
          await d.delete({ where: { [idField]: before[idField] } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new ConflictException(`${def.singular} is in use and cannot be deleted`);
          throw e;
        }
      }
      await this.audit.record(def.singular, String(before[idField]), 'DELETE', before, undefined, tx);
    });
    return { success: true };
  }

  /** Rows for export (max 20k), with display labels instead of ids */
  async exportRows(key: string, q: ListQuery) {
    const def = this.def(key);
    this.assertOp(def, 'export');
    const res = await this.list(key, { ...q, page: 1, pageSize: 200 });
    let rows = res.data;
    const pages = Math.min(res.meta.totalPages, 100);
    for (let p = 2; p <= pages; p++) rows = rows.concat((await this.list(key, { ...q, page: p, pageSize: 200 })).data);
    const fields = this.visibleFields(def).filter((f) => !f.encrypted);
    const columns = fields.map((f) => ({ key: f.name, label: f.label, type: f.type }));
    const data = rows.map((r) => Object.fromEntries(fields.map((f) => [f.name, r._labels?.[f.name] ?? r[f.name]])));
    this.audit.activity('export', { resource: key, rows: data.length });
    return { title: def.label, columns, rows: data };
  }

  async lookups(categories: string[]) {
    const rows = await this.prisma.lookupValue.findMany({
      where: { category: { in: categories.slice(0, 30) }, isActive: true, deletedAt: null },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { category: true, code: true, name: true, color: true },
    });
    const out: Record<string, { value: string; label: string; color: string | null }[]> = {};
    for (const r of rows) (out[r.category] ??= []).push({ value: r.code, label: r.name, color: r.color });
    return out;
  }
}
