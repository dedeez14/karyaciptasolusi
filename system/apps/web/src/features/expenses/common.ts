import type { ApprovalInfo } from '@/features/approvals/ApprovalPanel';

export interface ExpenseRow {
  id: string;
  number: string;
  date: string;
  title: string;
  statusCode: string;
  totalAmount: string;
  employeeId: string;
  employeeName: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface ExpenseLine {
  id?: string;
  date: string;
  categoryCode: string | null;
  accountId: string | null;
  accountName?: string | null;
  description: string;
  amount: string;
  projectId: string | null;
  projectName?: string | null;
  costCenterId: string | null;
  costCenterName?: string | null;
}

export interface ExpenseDetail extends ExpenseRow {
  notes: string | null;
  employeeCode: string | null;
  paidBankAccountName: string | null;
  approvedByName: string | null;
  createdByName: string | null;
  lines: ExpenseLine[];
  files: { id: string; name: string; size: number; mimeType: string; createdAt: string }[];
  journals: { id: string; number: string; status: string; sourceType: string; date: string }[];
  approval: ApprovalInfo;
  can: { edit: boolean; delete: boolean; submit: boolean; withdraw: boolean; approve: boolean; reject: boolean; pay: boolean; cancel: boolean; upload: boolean };
}

export const EXPENSE_FLOW = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID'];
