import { api } from '@/lib/api';
import type { Row } from './types';

export interface RowAction {
  label: string;
  icon: string;
  permission: string;
  visible?: (row: Row) => boolean;
  confirm?: string;
  danger?: boolean;
  run: (row: Row) => Promise<unknown>;
  success: string;
}

/** Extra, resource-specific row actions plugged into the generic resource page. */
export const RESOURCE_ACTIONS: Record<string, RowAction[]> = {
  leads: [
    {
      label: 'Convert to customer',
      icon: 'user-check',
      permission: 'crm.lead.update',
      visible: (r) => !r.customerId,
      confirm: 'Create a customer (and an opportunity when the lead has an estimated value) from this lead?',
      run: (r) => api.post(`/crm/leads/${r.id}/convert`),
      success: 'Lead converted to customer',
    },
  ],
  'leave-requests': [
    { label: 'Approve', icon: 'check', permission: 'hris.leave.approve', visible: (r) => r.status === 'PENDING', run: (r) => api.post(`/hris/leave-requests/${r.id}/approve`), success: 'Leave approved' },
    { label: 'Reject', icon: 'x', permission: 'hris.leave.approve', visible: (r) => r.status === 'PENDING', danger: true, confirm: 'Reject this leave request?', run: (r) => api.post(`/hris/leave-requests/${r.id}/reject`), success: 'Leave rejected' },
    { label: 'Cancel leave', icon: 'ban', permission: 'hris.leave.update', visible: (r) => r.status === 'APPROVED' || r.status === 'PENDING', danger: true, confirm: 'Cancel this leave?', run: (r) => api.post(`/hris/leave-requests/${r.id}/cancel`), success: 'Leave cancelled' },
  ],
};

/** Rows that can no longer be edited/deleted through the generic form */
export const LOCKED: Record<string, (row: Row) => boolean> = {
  'leave-requests': (r) => r.status !== 'PENDING',
  'fiscal-periods': (r) => !!r.isClosed,
};
