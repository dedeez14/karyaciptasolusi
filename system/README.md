# KCS ERP — Karya Cipta Solusi

Business management suite for **karyaciptasolusi.com**: marketing & CRM → sales → purchasing → inventory → accounting → HRIS & payroll → file management → reports.
Runs locally on your PC, installable as a **PWA** (desktop & phone), multi company / multi branch, English UI.

| Layer    | Technology |
|----------|------------|
| Backend  | Node.js 20+ · NestJS 11 · Prisma 6 · Zod · Argon2id · pdfkit · ExcelJS |
| Frontend | React 19 · Vite 6 · TypeScript · Tailwind CSS 4 · TanStack Query · Zustand · Recharts · vite-plugin-pwa |
| Database | PostgreSQL 14+ (tested on 17) |

---

## Mulai cepat (Quick start)

The ERP lives in the `system/` folder of the repository (the company website is at the repository root).

```bash
cd system
npm install                 # install all workspaces
npm run setup               # create apps/api/.env with random secrets + roles, database, migrations, security, seed
npm run dev                 # API http://localhost:3000  +  web http://localhost:5173
```

Sign in with user **admin**; the initial password is the value of `SEED_ADMIN_PASSWORD` in `apps/api/.env`.
You will be asked to change it on first sign-in.

**Production mode on your PC (one process, one port):**

```bash
npm run build
npm start                   # open http://localhost:3000 and click "Install" in the address bar
```

Other commands:

| Command | Purpose |
|---------|---------|
| `npm run db:migrate` | apply new migrations + re-apply database security |
| `npm run db:seed` | re-sync permissions, menus, roles (idempotent) |
| `npm run db:backup` | encrypted database dump + file storage copy into `backups/` (set `PG_DUMP` if pg_dump is not on PATH) |
| `node scripts/restore.mjs backups/<file>.dump.enc` | restore a backup |
| `npm run typecheck` | TypeScript check of API and web |

> Access from your phone on the same Wi-Fi: set `HOST=0.0.0.0` in `apps/api/.env`, add the phone URL to `CORS_ORIGINS`,
> and put HTTPS in front (e.g. Caddy) — PWAs and secure cookies require HTTPS outside `localhost`.

---

## Modules

| Menu | Highlights |
|------|------------|
| Dashboard | KPIs (sales, receivables, purchases, payables, cash, pipeline, staff, low stock), 12-month chart, top customers, quick actions — each widget only shown with permission |
| Marketing & CRM | Leads (convert to customer + opportunity), opportunities & pipeline stages, campaigns (budget vs cost), activities |
| Sales | Quotation → Sales Order → Delivery Order → Invoice → Customer Receipt, partial conversions, AR aging |
| Purchase | Purchase Request → Purchase Order → Goods Receipt → Purchase Invoice → Supplier Payment |
| Inventory | Perpetual moving-average stock per warehouse, adjustments, transfers, stock card, low-stock alerts |
| Accounting | Chart of accounts, automatic journals from every transaction, manual journals, posting accounts, fiscal period locking, trial balance, GL, P&L, balance sheet |
| HRIS | Employees (encrypted NIK/NPWP/bank no.), attendance, leave with approval, salary components, payroll with journal + payslip PDF |
| File Manager | Folders, multi-upload, tags, categories, filters, group-by, bulk move/tag/delete, preview, encrypted at rest, generated PDFs & exports archived automatically |
| Reports | 22 reports, filterable, charts, export to Excel / CSV / PDF, save to File Manager |
| Master Data | Every list is data, not code: products, categories, brands, units, customers, suppliers, groups, terms, methods, currencies, rates, countries, banks, projects, stages, lookup values |
| System | Companies, branches, users (per company/branch roles), roles & permission matrix, menu management, number sequences, settings, Hostinger integration, audit trail, activity log, active sessions |

All business documents (quotation, order, delivery, invoice, PO, receipt, payslip, report tables …) are rendered by **one PDF template**,
so every document has the same letterhead, layout, totals block, amount in words, signatures and footer. Colours, paper size, footer, payment
instructions and default terms are configurable in *System → Settings → document / sales*.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SECURITY.md](docs/SECURITY.md).
