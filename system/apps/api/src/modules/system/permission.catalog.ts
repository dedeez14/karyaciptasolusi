import { RESOURCES } from '../resources/resource.registry';
import { DOC_TYPES } from '../documents/document.registry';
import { REPORTS } from '../reports/report.registry';

export interface PermissionDef {
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string;
}

const make = (code: string, description: string): PermissionDef => {
  const parts = code.split('.');
  return { code, module: parts[0], resource: parts.slice(1, -1).join('.'), action: parts[parts.length - 1], description };
};

/**
 * The complete permission catalog, derived from the registries so that every new
 * resource / document / report automatically gets its permissions (nothing to maintain by hand).
 */
export function permissionCatalog(): PermissionDef[] {
  const out: PermissionDef[] = [];
  for (const r of RESOURCES) {
    const ops = r.operations ?? ['read', 'create', 'update', 'delete'];
    for (const op of [...ops, 'export']) out.push(make(`${r.permission}.${op}`, `${op} ${r.label}`));
    for (const f of r.fields) if (f.permission && !out.some((p) => p.code === f.permission)) out.push(make(f.permission, `View/edit ${f.label} of ${r.label}`));
  }
  for (const d of DOC_TYPES) for (const op of ['read', 'create', 'update', 'delete', 'confirm', 'cancel', 'print']) out.push(make(`${d.permission}.${op}`, `${op} ${d.label}`));
  for (const r of REPORTS) out.push(make(`report.${r.key}.view`, `View report: ${r.label}`));
  const extra: [string, string][] = [
    ['sales.payment.read', 'View customer receipts'],
    ['sales.payment.create', 'Record customer receipts'],
    ['sales.payment.cancel', 'Cancel customer receipts'],
    ['purchase.payment.read', 'View supplier payments'],
    ['purchase.payment.create', 'Record supplier payments'],
    ['purchase.payment.cancel', 'Cancel supplier payments'],
    ['inventory.stock.read', 'View stock levels'],
    ['accounting.journal.read', 'View journals'],
    ['accounting.journal.create', 'Create draft journals'],
    ['accounting.journal.post', 'Post journals'],
    ['accounting.journal.void', 'Void journals'],
    ['hris.leave.approve', 'Approve or reject leave'],
    ['hris.payroll.create', 'Generate payroll'],
    ['hris.payroll.confirm', 'Confirm / cancel payroll'],
    ['files.file.read', 'Browse files'],
    ['files.file.upload', 'Upload files'],
    ['files.file.download', 'Download files'],
    ['files.file.update', 'Rename, move and tag files'],
    ['files.file.delete', 'Delete files'],
    ['files.folder.manage', 'Manage folders'],
    ['system.user.create', 'Create users'],
    ['system.user.update', 'Edit users and their access'],
    ['system.user.delete', 'Delete users'],
    ['system.user.reset-password', 'Reset user passwords'],
    ['system.role.read', 'View roles'],
    ['system.role.create', 'Create roles'],
    ['system.role.update', 'Edit roles and permissions'],
    ['system.role.delete', 'Delete roles'],
    ['system.menu.read', 'View menus'],
    ['system.menu.update', 'Manage menus'],
    ['system.setting.read', 'View settings'],
    ['system.setting.update', 'Change settings'],
    ['system.audit.read', 'View audit trail'],
    ['system.activity.read', 'View activity log'],
    ['system.session.read', 'View active sessions'],
    ['system.session.revoke', 'Revoke sessions'],
    ['accounting.cash.read', 'View cash & bank transactions'],
    ['accounting.cash.create', 'Record cash & bank transactions'],
    ['accounting.cash.cancel', 'Cancel cash & bank transactions'],
    ['task.task.read', 'View tasks'],
    ['task.task.create', 'Create tasks'],
    ['task.task.update', 'Edit, move, comment and log time on tasks'],
    ['task.task.delete', 'Delete tasks'],
    ['task.task.manage', 'Manage every task of the company (not only own)'],
    ['system.security.read', 'Open the Security Center (keys, integrity checks, watermark detection)'],
    ['integration.hostinger.read', 'View Hostinger services'],
    ['integration.hostinger.manage', 'Control Hostinger services (start/stop VPS)'],
  ];
  for (const [code, d] of extra) if (!out.some((p) => p.code === code)) out.push(make(code, d));
  return out;
}
