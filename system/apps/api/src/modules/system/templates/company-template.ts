/**
 * Default data copied into every NEW company (editable afterwards from the UI).
 * This is seed/template data - the application never reads these constants at runtime.
 */
import type { AccountType } from '@prisma/client';

type Acc = [code: string, name: string, type: AccountType, parent: string | null, isGroup?: boolean];

export const COA_TEMPLATE: Acc[] = [
  ['1-0000', 'Assets', 'ASSET', null, true],
  ['1-1000', 'Current Assets', 'ASSET', '1-0000', true],
  ['1-1100', 'Cash on Hand', 'ASSET', '1-1000'],
  ['1-1200', 'Bank', 'ASSET', '1-1000'],
  ['1-1300', 'Accounts Receivable', 'ASSET', '1-1000'],
  ['1-1400', 'Inventory', 'ASSET', '1-1000'],
  ['1-1500', 'VAT In (Prepaid Tax)', 'ASSET', '1-1000'],
  ['1-1600', 'Prepaid Expenses', 'ASSET', '1-1000'],
  ['1-1700', 'Employee Advances', 'ASSET', '1-1000'],
  ['1-2000', 'Fixed Assets', 'ASSET', '1-0000', true],
  ['1-2100', 'Office Equipment', 'ASSET', '1-2000'],
  ['1-2200', 'Computer Equipment', 'ASSET', '1-2000'],
  ['1-2900', 'Accumulated Depreciation', 'ASSET', '1-2000'],
  ['2-0000', 'Liabilities', 'LIABILITY', null, true],
  ['2-1000', 'Current Liabilities', 'LIABILITY', '2-0000', true],
  ['2-1100', 'Accounts Payable', 'LIABILITY', '2-1000'],
  ['2-1200', 'Goods Received Not Invoiced', 'LIABILITY', '2-1000'],
  ['2-1300', 'VAT Out', 'LIABILITY', '2-1000'],
  ['2-1400', 'Salaries Payable', 'LIABILITY', '2-1000'],
  ['2-1500', 'Payroll Deductions Payable', 'LIABILITY', '2-1000'],
  ['2-1600', 'Accrued Expenses', 'LIABILITY', '2-1000'],
  ['2-1700', 'Customer Deposits', 'LIABILITY', '2-1000'],
  ['3-0000', 'Equity', 'EQUITY', null, true],
  ['3-1000', 'Share Capital', 'EQUITY', '3-0000'],
  ['3-2000', 'Retained Earnings', 'EQUITY', '3-0000'],
  ['3-3000', 'Current Year Earnings', 'EQUITY', '3-0000'],
  ['4-0000', 'Income', 'INCOME', null, true],
  ['4-1000', 'Sales Revenue - Goods', 'INCOME', '4-0000'],
  ['4-1100', 'Service Revenue', 'INCOME', '4-0000'],
  ['4-9000', 'Other Income', 'INCOME', '4-0000'],
  ['4-9100', 'Inventory Adjustment Gain', 'INCOME', '4-0000'],
  ['5-0000', 'Cost of Sales', 'EXPENSE', null, true],
  ['5-1000', 'Cost of Goods Sold', 'EXPENSE', '5-0000'],
  ['6-0000', 'Operating Expenses', 'EXPENSE', null, true],
  ['6-1000', 'Salaries & Wages', 'EXPENSE', '6-0000'],
  ['6-1100', 'Employee Benefits', 'EXPENSE', '6-0000'],
  ['6-2000', 'Rent', 'EXPENSE', '6-0000'],
  ['6-2100', 'Utilities', 'EXPENSE', '6-0000'],
  ['6-2200', 'Internet, Hosting & Cloud', 'EXPENSE', '6-0000'],
  ['6-2300', 'Marketing & Advertising', 'EXPENSE', '6-0000'],
  ['6-2400', 'Office Supplies', 'EXPENSE', '6-0000'],
  ['6-2500', 'Transportation', 'EXPENSE', '6-0000'],
  ['6-2600', 'Professional Fees', 'EXPENSE', '6-0000'],
  ['6-2700', 'Bank Charges', 'EXPENSE', '6-0000'],
  ['6-2800', 'Depreciation Expense', 'EXPENSE', '6-0000'],
  ['6-2900', 'Inventory Adjustment Loss', 'EXPENSE', '6-0000'],
  ['6-3000', 'General Purchases & Services', 'EXPENSE', '6-0000'],
  ['6-9000', 'Other Expenses', 'EXPENSE', '6-0000'],
];

/** functional posting key -> [label, account code] */
export const ACCOUNT_MAPPING_TEMPLATE: [string, string, string][] = [
  ['CASH', 'Default Cash', '1-1100'],
  ['AR', 'Accounts Receivable', '1-1300'],
  ['AP', 'Accounts Payable', '2-1100'],
  ['INVENTORY', 'Inventory', '1-1400'],
  ['GRNI', 'Goods Received Not Invoiced', '2-1200'],
  ['SALES', 'Sales Revenue (goods)', '4-1000'],
  ['SERVICE_REVENUE', 'Service Revenue', '4-1100'],
  ['COGS', 'Cost of Goods Sold', '5-1000'],
  ['TAX_OUT', 'Output Tax (VAT Out)', '2-1300'],
  ['TAX_IN', 'Input Tax (VAT In)', '1-1500'],
  ['PURCHASE_EXPENSE', 'Purchases of services / non-stock', '6-3000'],
  ['STOCK_GAIN', 'Inventory Adjustment Gain', '4-9100'],
  ['STOCK_LOSS', 'Inventory Adjustment Loss', '6-2900'],
  ['SALARY_EXPENSE', 'Salary Expense', '6-1000'],
  ['SALARY_PAYABLE', 'Salaries Payable', '2-1400'],
  ['PAYROLL_DEDUCTION', 'Payroll Deductions Payable', '2-1500'],
  ['RETAINED_EARNINGS', 'Retained Earnings', '3-2000'],
  ['CURRENT_EARNINGS', 'Current Year Earnings', '3-3000'],
  ['EXPENSE_PAYABLE', 'Employee reimbursements payable', '2-1600'],
  ['FIXED_ASSET', 'Fixed assets (default)', '1-2200'],
  ['ACCUM_DEPRECIATION', 'Accumulated depreciation', '1-2900'],
  ['DEPRECIATION_EXPENSE', 'Depreciation expense', '6-2800'],
  ['ASSET_DISPOSAL_GAIN', 'Gain on asset disposal', '4-9000'],
  ['ASSET_DISPOSAL_LOSS', 'Loss on asset disposal', '6-9000'],
];

/** code, name, prefix, reset */
export const SEQUENCE_TEMPLATE: [string, string, string, string][] = [
  ['SQ', 'Sales Quotation', 'QUO/{YYYY}/', 'YEARLY'],
  ['SO', 'Sales Order', 'SO/{YYYY}/', 'YEARLY'],
  ['DO', 'Delivery Order', 'DO/{YYYY}/', 'YEARLY'],
  ['SI', 'Sales Invoice', 'INV/{YYYY}/{MM}/', 'MONTHLY'],
  ['PR', 'Purchase Request', 'PRQ/{YYYY}/', 'YEARLY'],
  ['PO', 'Purchase Order', 'PO/{YYYY}/', 'YEARLY'],
  ['GR', 'Goods Receipt', 'GRN/{YYYY}/', 'YEARLY'],
  ['PI', 'Purchase Invoice', 'BILL/{YYYY}/{MM}/', 'MONTHLY'],
  ['ADJ', 'Stock Adjustment', 'ADJ/{YYYY}/', 'YEARLY'],
  ['TRF', 'Stock Transfer', 'TRF/{YYYY}/', 'YEARLY'],
  ['PAY_IN', 'Customer Receipt', 'RCV/{YYYY}/{MM}/', 'MONTHLY'],
  ['PAY_OUT', 'Supplier Payment', 'PAY/{YYYY}/{MM}/', 'MONTHLY'],
  ['JE', 'Journal Entry', 'JV/{YYYY}/{MM}/', 'MONTHLY'],
  ['CASH_IN', 'Cash / Bank Receipt', 'CR/{YYYY}/{MM}/', 'MONTHLY'],
  ['CASH_OUT', 'Cash / Bank Payment', 'CV/{YYYY}/{MM}/', 'MONTHLY'],
  ['BANK_TRANSFER', 'Bank Transfer', 'BT/{YYYY}/{MM}/', 'MONTHLY'],
  ['PAYROLL', 'Payroll Run', 'PYR/{YYYY}/', 'YEARLY'],
  ['PRODUCT', 'Product Code', 'PRD-', 'NEVER'],
  ['CUSTOMER', 'Customer Code', 'CUS-', 'NEVER'],
  ['SUPPLIER', 'Supplier Code', 'SUP-', 'NEVER'],
  ['EMPLOYEE', 'Employee ID', 'EMP-', 'NEVER'],
  ['LEAD', 'Lead Code', 'LD-', 'NEVER'],
  ['OPPORTUNITY', 'Opportunity Code', 'OPP-', 'NEVER'],
  ['CAMPAIGN', 'Campaign Code', 'CMP-', 'NEVER'],
  ['PROJECT', 'Project Code', 'PRJ-', 'NEVER'],
  ['TASK', 'Task Code', 'TASK-', 'NEVER'],
  ['SUBSCRIPTION', 'Subscription Code', 'SUB-', 'NEVER'],
  ['ASSET', 'Fixed Asset Code', 'FA-', 'NEVER'],
  ['BUDGET', 'Budget Code', 'BGT-', 'NEVER'],
  ['EXPENSE', 'Expense Claim', 'EXP/{YYYY}/{MM}/', 'MONTHLY'],
  ['TICKET', 'Support Ticket', 'TCK-', 'NEVER'],
];

export const SIMPLE_TEMPLATE = {
  uom: [['PCS', 'Pieces'], ['UNIT', 'Unit'], ['BOX', 'Box'], ['PKG', 'Package'], ['KG', 'Kilogram'], ['LTR', 'Liter'], ['M', 'Meter'], ['HR', 'Hour'], ['DAY', 'Day'], ['MON', 'Month'], ['YEAR', 'Year'], ['LIC', 'License'], ['PRJ', 'Project']],
  paymentMethod: [['CASH', 'Cash'], ['TRANSFER', 'Bank Transfer'], ['CARD', 'Debit / Credit Card'], ['QRIS', 'QRIS'], ['EWALLET', 'E-Wallet'], ['CHEQUE', 'Cheque / Giro']],
  customerGroup: [['CORP', 'Corporate'], ['SME', 'Small & Medium Business'], ['GOV', 'Government'], ['EDU', 'Education'], ['IND', 'Individual']],
  supplierGroup: [['VENDOR', 'Goods Vendor'], ['SERVICE', 'Service Provider'], ['CLOUD', 'Cloud & Hosting'], ['CONTRACTOR', 'Contractor / Freelancer']],
  productCategory: [['SOFTWARE', 'Software Development'], ['WEB', 'Website & Hosting'], ['LICENSE', 'Software License'], ['HARDWARE', 'Hardware'], ['SUPPORT', 'Maintenance & Support'], ['CONSULT', 'Consulting & Training']],
  department: [['MGT', 'Management'], ['FIN', 'Finance & Accounting'], ['HR', 'Human Resources'], ['SALES', 'Sales'], ['MKT', 'Marketing'], ['IT', 'Engineering & IT'], ['OPS', 'Operations']],
  costCenter: [['HO', 'Head Office'], ['PRJ', 'Projects'], ['MKT', 'Marketing']],
};

export const PAYMENT_TERM_TEMPLATE: [string, string, number][] = [
  ['COD', 'Cash on Delivery', 0],
  ['NET7', 'Net 7 Days', 7],
  ['NET14', 'Net 14 Days', 14],
  ['NET30', 'Net 30 Days', 30],
  ['NET45', 'Net 45 Days', 45],
  ['NET60', 'Net 60 Days', 60],
];

export const TAX_TEMPLATE: [string, string, number][] = [
  ['PPN11', 'VAT (PPN) 11%', 11],
  ['PPN12', 'VAT (PPN) 12%', 12],
];

export const STAGE_TEMPLATE: [string, string, number, boolean, boolean][] = [
  ['NEW', 'New', 10, false, false],
  ['QUALIFIED', 'Qualified', 25, false, false],
  ['PROPOSAL', 'Proposal Sent', 50, false, false],
  ['NEGOTIATION', 'Negotiation', 75, false, false],
  ['WON', 'Won', 100, true, false],
  ['LOST', 'Lost', 0, false, true],
];

export const POSITION_TEMPLATE: [string, string, string][] = [
  ['DIR', 'Director', 'EXECUTIVE'],
  ['MGR', 'Manager', 'MANAGER'],
  ['SPV', 'Supervisor', 'SUPERVISOR'],
  ['SR', 'Senior Staff', 'STAFF'],
  ['STAFF', 'Staff', 'STAFF'],
  ['INTERN', 'Intern', 'ENTRY'],
];

export const LEAVE_TEMPLATE: [string, string, number, boolean][] = [
  ['ANNUAL', 'Annual Leave', 12, true],
  ['SICK', 'Sick Leave', 0, true],
  ['MATERNITY', 'Maternity Leave', 90, true],
  ['MARRIAGE', 'Marriage Leave', 3, true],
  ['BEREAVEMENT', 'Bereavement Leave', 2, true],
  ['UNPAID', 'Unpaid Leave', 0, false],
];

/** code, name, kind, calcType, amount, mappingKey */
export const SALARY_COMPONENT_TEMPLATE: [string, string, 'EARNING' | 'DEDUCTION', 'FIXED' | 'PERCENT_BASE', number][] = [
  ['TRANSPORT', 'Transport Allowance', 'EARNING', 'FIXED', 0],
  ['MEAL', 'Meal Allowance', 'EARNING', 'FIXED', 0],
  ['POSITION', 'Position Allowance', 'EARNING', 'FIXED', 0],
  ['OVERTIME', 'Overtime', 'EARNING', 'FIXED', 0],
  ['BPJS_TK', 'BPJS Ketenagakerjaan (Employee)', 'DEDUCTION', 'PERCENT_BASE', 2],
  ['BPJS_KES', 'BPJS Kesehatan (Employee)', 'DEDUCTION', 'PERCENT_BASE', 1],
  ['PPH21', 'Income Tax (PPh 21)', 'DEDUCTION', 'FIXED', 0],
];

/** code, name, color, isDone */
export const TASK_STAGE_TEMPLATE: [string, string, string, boolean][] = [
  ['BACKLOG', 'Backlog', '#94a3b8', false],
  ['TODO', 'To Do', '#3b82f6', false],
  ['IN_PROGRESS', 'In Progress', '#f59e0b', false],
  ['REVIEW', 'Review', '#8b5cf6', false],
  ['DONE', 'Done', '#16a34a', true],
];
