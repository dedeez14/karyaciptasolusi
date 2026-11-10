# Architecture

```
apps/
  api/                         NestJS API (also serves the built PWA in production)
    prisma/schema.prisma       single source of truth for the data model
    prisma/migrations/         SQL migrations
    prisma/sql/security.sql    database-layer security (grants, triggers, constraints)
    prisma/seed.ts             idempotent seed (reference data, permissions, menus, roles, first company)
    src/
      config/env.ts            validated configuration (fails fast on weak/missing secrets)
      common/                  cross-cutting: prisma, crypto, access (RBAC+ACL), audit, settings,
                               sequences, cache, guards, filters, interceptors, export
      modules/
        auth/                  login, rotating refresh tokens, /auth/me bootstrap
        resources/             metadata-driven CRUD engine for all master data (registry + engine)
        documents/             generic trade-document engine (SQ SO DO SI PR PO GR PI ADJ TRF) + inventory
        payments/              customer receipts & supplier payments with invoice allocation
        accounting/            journal posting service + manual journals
        hris/                  leave workflow, payroll, payslips
        crm/                   lead conversion
        reports/               report registry (22 reports) + export
        files/                 file manager, encrypted storage, generated-file archive
        print/                 ONE pdf template for every document
        integrations/          Hostinger API (allow-listed), SMTP mail
        system/                users, roles, menus, settings, logs, company bootstrap, permission catalog
  web/                         React PWA
    src/lib                    api client, formatting, downloads
    src/stores                 session (zustand)
    src/components/ui          reusable UI kit (DataTable, AsyncSelect, Drawer, Modal, ...)
    src/features/*             pages per module
```

## Design principles

* **Metadata over code.** Master data screens are generated from `resource.registry.ts`. The same field
  definition produces backend validation (zod), tenant/relation checks, encryption, the table, the filter bar,
  the form, and Excel/CSV/PDF export.
* **Registries generate permissions.** `permission.catalog.ts` derives every permission from the resource,
  document and report registries. Adding a resource/report automatically adds its permissions on the next `npm run db:seed`.
* **Nothing business-specific is hard coded.** Lists (lead source, status, industry, gender, …) are
  *Lookup Values*; numbering is *Number Sequences*; posting accounts are *Posting Accounts*; behaviour switches
  are *Settings*; navigation is *Menu Management*.
* **Server computes, client previews.** Totals, taxes, stock cost and journals are always recalculated on the server.
* **One transaction per business action** with row locks (documents, stock balances, numbering) and an audit entry
  written inside the same transaction.

## How to extend

| You want to … | Do this |
|---------------|---------|
| add a master-data table | add the Prisma model → `npx prisma migrate dev` → add an entry in `resource.registry.ts` → add a menu row in *Menu Management* (path `/r/<key>`) → `npm run db:seed` |
| add a report | add an object to `report.registry.ts` (params + `run`) → `npm run db:seed` (permission) → it appears in Reports |
| add a document type | add it to `document.registry.ts` (+ posting rules in `document.service.ts#post` if it moves stock or money) and a number sequence |
| change document layout | `print/pdf.service.ts` (shared by all documents) |
| add a new list value | *Master Data → Lookup Values* (no code) |
