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
    ['pos.sale.create', 'Sell at the point of sale (open / close own shift)'],
    ['pos.sale.void', 'Void point-of-sale receipts of an open shift'],
    ['pos.session.manage', 'View all cashier shifts, close them and see the daily recap'],
    ['pos.kitchen.view', 'Use the kitchen display (KDS) and the order-ready queue board'],
    ['pos.setup', 'Set up POS menus: modifiers, stations, recipes, price lists and promotions'],
    ['pos.member.manage', 'Register loyalty members and adjust their points'],
    ['manufacturing.bom.read', 'View bills of materials'],
    ['manufacturing.bom.create', 'Create bills of materials'],
    ['manufacturing.bom.update', 'Edit bills of materials'],
    ['manufacturing.bom.delete', 'Delete bills of materials'],
    ['manufacturing.order.read', 'View work orders'],
    ['manufacturing.order.create', 'Create and release work orders'],
    ['manufacturing.order.confirm', 'Finish work orders (issue materials, receive products)'],
    ['manufacturing.order.cancel', 'Cancel work orders'],
    ['manufacturing.order.report', 'Report production on the shop floor (start / finish steps, quantities)'],
    ['manufacturing.mrp.run', 'Run material requirements planning and create the planned orders'],
    ['maintenance.order.read', 'View maintenance orders, plans, downtime and OEE'],
    ['maintenance.order.manage', 'Create and complete maintenance orders, record downtime and counters'],
    ['maintenance.plan.manage', 'Set up preventive maintenance plans'],
    ['quality.plan.manage', 'Set up inspection plans and their specifications'],
    ['quality.inspection.read', 'View inspections, certificates of analysis and non-conformances'],
    ['quality.inspection.record', 'Record inspection results'],
    ['quality.inspection.release', 'Release or reject inspected lots (quality decision)'],
    ['quality.ncr.manage', 'Handle non-conformance reports (disposition, corrective action, closing)'],
    ['compliance.read', 'View certificates, TKDN assessments, B3 waste records and SIINas reports'],
    ['compliance.certificate.manage', 'Register certificates and licences (halal, BPOM, SNI, TKDN...)'],
    ['compliance.tkdn.manage', 'Prepare TKDN self-assessments'],
    ['compliance.waste.manage', 'Record B3 waste stored and handed over'],
    ['compliance.siinas.manage', 'Prepare and mark the quarterly SIINas report'],
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
    ['sales.subscription.read', 'View recurring billing'],
    ['sales.subscription.create', 'Create subscriptions'],
    ['sales.subscription.update', 'Edit subscriptions'],
    ['sales.subscription.delete', 'Delete subscriptions'],
    ['sales.subscription.run', 'Generate invoices from subscriptions now'],
    ['accounting.asset.read', 'View fixed assets'],
    ['accounting.asset.create', 'Register fixed assets'],
    ['accounting.asset.update', 'Edit fixed assets'],
    ['accounting.asset.delete', 'Delete fixed assets'],
    ['accounting.asset.depreciate', 'Run depreciation'],
    ['accounting.asset.dispose', 'Dispose fixed assets'],
    ['accounting.budget.read', 'View budgets'],
    ['accounting.budget.create', 'Create budgets'],
    ['accounting.budget.update', 'Edit budgets'],
    ['accounting.budget.delete', 'Delete budgets'],
    ['accounting.budget.approve', 'Approve budgets'],
    ['approval.request.read', 'View approval requests'],
    ['approval.request.decide', 'Approve or reject requests assigned to you'],
    ['system.approval-rule.read', 'View approval rules'],
    ['system.approval-rule.create', 'Create approval rules'],
    ['system.approval-rule.update', 'Edit approval rules'],
    ['system.approval-rule.delete', 'Delete approval rules'],
    ['hris.expense.read', 'View expense claims'],
    ['hris.expense.create', 'Create expense claims'],
    ['hris.expense.update', 'Edit and submit expense claims'],
    ['hris.expense.delete', 'Delete draft expense claims'],
    ['hris.expense.approve', 'Approve or reject expense claims'],
    ['hris.expense.pay', 'Pay approved expense claims'],
    ['hris.expense.manage', 'See every employee\'s expense claims'],
    ['support.ticket.read', 'View support tickets'],
    ['support.ticket.create', 'Create support tickets'],
    ['support.ticket.update', 'Update, reply and assign tickets'],
    ['support.ticket.delete', 'Delete tickets'],
    ['support.ticket.manage', 'See every ticket (not only own / assigned)'],
    ['accounting.opening.read', 'View opening balances'],
    ['accounting.opening.manage', 'Enter and post opening balances (go-live)'],
    ['accounting.bankrec.read', 'View bank reconciliations'],
    ['accounting.bankrec.create', 'Import bank statements'],
    ['accounting.bankrec.reconcile', 'Match and reconcile bank statements'],
    ['accounting.bankrec.delete', 'Delete bank statements'],
    ['accounting.closing.read', 'View year-end closing'],
    ['accounting.closing.close', 'Close a financial year'],
    ['accounting.closing.reopen', 'Reopen a closed financial year'],
    ['hris.payroll.pay', 'Pay salaries and export bank transfer files'],
    ['task.timesheet.read', 'View timesheets'],
    ['task.timesheet.manage', "See and edit everyone's time entries"],
    ['task.billing.create', 'Invoice billable project hours'],
    ['crm.leadfinder.read', 'View Google Maps lead searches and results'],
    ['crm.leadfinder.run', 'Start and cancel Google Maps lead searches'],
    ['crm.leadfinder.import', 'Turn found places into leads'],
    ['crm.leadfinder.delete', 'Delete lead searches and found places'],
    ['crm.emailcampaign.read', 'View e-mail campaigns'],
    ['crm.emailcampaign.create', 'Create e-mail campaigns'],
    ['crm.emailcampaign.update', 'Edit e-mail campaigns'],
    ['crm.emailcampaign.delete', 'Delete e-mail campaigns'],
    ['crm.emailcampaign.send', 'Send, schedule, pause and test e-mail campaigns'],
    ['crm.suppression.manage', 'Manage the do-not-email list'],
    ['integration.hostinger.read', 'View Hostinger services'],
    ['integration.hostinger.manage', 'Control Hostinger services (start/stop VPS)'],
  ];
  for (const [code, d] of extra) if (!out.some((p) => p.code === code)) out.push(make(code, d));
  return out;
}
