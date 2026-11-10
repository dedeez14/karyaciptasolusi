// Clears all business data so the system can be used (or tested) from a clean state, while keeping the setup.
//
//   node apps/api/scripts/reset-business-data.mjs --yes                 (from system/)
//   node apps/api/scripts/reset-business-data.mjs --yes --include-uploads
//
// Removed: customers, suppliers, products, employees, projects, CRM records, every transaction (documents,
// payments, journals, stock, cash, attendance, leave, payroll, tasks, subscriptions, assets, budgets, approvals,
// expense claims, tickets), generated PDFs/exports, document fingerprints and number counters (back to 1).
// Setup records created by people (e.g. an extra tax or warehouse) are removed as well; records created by the
// company template (createdById IS NULL) are kept.
// Kept: companies, branches, users, roles & permissions, menus, settings, lookup values, chart of accounts,
// posting accounts, currencies / countries / banks, approval rules, holidays, exchange rates, the audit trail
// and activity log (append-only history), sessions, and files uploaded by people (unless --include-uploads).
//
// An encrypted backup is written first (scripts/backup.mjs) unless --no-backup is given.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const args = new Set(process.argv.slice(2));
const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const systemDir = resolve(apiDir, '..', '..');
const env = Object.fromEntries(
  readFileSync(join(apiDir, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

if (!args.has('--yes')) {
  console.log('This permanently deletes all business data (see the header of this script).');
  console.log('Run again with --yes to continue. An encrypted backup is made first unless --no-backup.');
  process.exit(1);
}

if (!args.has('--no-backup')) {
  const b = spawnSync(process.execPath, [join(systemDir, 'scripts', 'backup.mjs')], { stdio: 'inherit', env: process.env });
  if (b.status !== 0) {
    console.error('Backup failed - nothing was deleted.');
    process.exit(1);
  }
}

/** transactional and business master tables - emptied completely */
const TRUNCATE = [
  // sales / purchase / inventory
  'trade_document_lines', 'trade_documents', 'payment_allocations', 'payments', 'stock_movements', 'stock_balances',
  'subscription_lines', 'subscriptions', 'invoice_reminders',
  // accounting
  'journal_lines', 'journal_entries', 'cash_transactions', 'asset_depreciations', 'fixed_assets', 'budget_lines', 'budgets',
  'approval_requests', 'expense_claim_lines', 'expense_claims',
  // CRM / projects / tasks / helpdesk
  'crm_activities', 'opportunities', 'leads', 'campaigns', 'projects', 'task_time_logs', 'task_comments', 'task_checklist_items', 'tasks',
  'ticket_messages', 'tickets',
  // HRIS
  'payslips', 'payroll_runs', 'attendances', 'leave_requests', 'employee_salary_components', 'employees',
  // partners & products
  'customers', 'suppliers', 'products',
  // security / numbering
  'signed_files', 'number_sequence_periods',
];

/** setup tables: only rows created by people are removed, template rows stay */
const USER_CREATED = [
  'bank_accounts', 'brands', 'cost_centers', 'customer_groups', 'supplier_groups', 'product_categories', 'departments', 'positions',
  'leave_types', 'salary_components', 'payment_methods', 'payment_terms', 'pipeline_stages', 'taxes', 'uoms', 'warehouses',
  'fiscal_periods', 'task_stages', 'file_folders',
];

const client = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
await client.connect();
const storage = resolve(apiDir, env.STORAGE_DIR ?? './storage');
let files = [];
try {
  await client.query('BEGIN');
  const before = {};
  for (const t of [...TRUNCATE, ...USER_CREATED]) before[t] = Number((await client.query(`SELECT count(*) AS c FROM "${t}"`)).rows[0].c);

  // stored files: generated documents / exports always, uploads only on request
  const fileWhere = args.has('--include-uploads') ? 'TRUE' : `source <> 'UPLOAD' OR "entityType" IS NOT NULL`;
  files = (await client.query(`DELETE FROM stored_files WHERE ${fileWhere} RETURNING "storageKey"`)).rows.map((r) => r.storageKey);
  // folders that still hold kept files stay
  await client.query(`UPDATE file_folders SET "createdById" = NULL WHERE id IN (SELECT "folderId" FROM stored_files WHERE "folderId" IS NOT NULL)`);

  // TRUNCATE (not DELETE): row-level protection triggers such as "posted journals are immutable" do not apply to a full reset
  await client.query(`TRUNCATE ${TRUNCATE.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
  const removed = {};
  for (const t of USER_CREATED) removed[t] = (await client.query(`DELETE FROM "${t}" WHERE "createdById" IS NOT NULL`)).rowCount;
  await client.query(`UPDATE number_sequences SET "nextNumber" = 1, "lastPeriod" = NULL`);
  await client.query('COMMIT');

  console.log('\nCleared:');
  for (const t of TRUNCATE) if (before[t]) console.log(`  ${t.padEnd(28)} ${before[t]}`);
  for (const t of USER_CREATED) if (removed[t]) console.log(`  ${t.padEnd(28)} ${removed[t]} (created by users; template rows kept)`);
  console.log(`  stored_files                 ${files.length}`);
  console.log('  number_sequences             reset to 1');
} catch (e) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Reset failed, nothing was changed:', e.message);
  process.exit(1);
} finally {
  await client.end();
}

// encrypted blobs of the removed files
let blobs = 0;
for (const key of files) {
  const p = resolve(storage, key);
  if (p.startsWith(storage) && existsSync(p)) {
    rmSync(p);
    blobs++;
  }
}
console.log(`  storage blobs                ${blobs}`);
console.log('\nDone. Restart the API so open sessions reload their data.');
