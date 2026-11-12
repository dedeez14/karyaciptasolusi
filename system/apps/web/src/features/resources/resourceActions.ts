import { api } from '@/lib/api';
import { previewFile } from '@/components/ui';
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
  letters: [
    {
      label: 'Preview & print (signed PDF)',
      icon: 'printer',
      permission: 'hris.letter.read',
      run: (r) => previewFile({ path: `/letters/${r.id}/pdf`, title: `${r.subject ?? 'Letter'} ${r.number ?? ''}`.trim() }),
      success: 'Letter opened',
    },
    {
      label: 'Use again (new document from this one)',
      icon: 'copy',
      permission: 'hris.letter.create',
      run: async (r) => window.location.assign(`/document-center?from=${encodeURIComponent(String(r.id))}`),
      success: 'Opening the Document Center',
    },
    {
      label: 'Send by e-mail',
      icon: 'send',
      permission: 'hris.letter.read',
      run: async (r) => {
        const to = window.prompt(`Send ${r.number ?? 'this document'} (signed PDF) to which e-mail address?`)?.trim();
        if (!to) throw new Error('Not sent');
        if (!/^\S+@\S+\.\S+$/.test(to)) throw new Error('That is not a valid e-mail address');
        return api.post(`/letters/${r.id}/email`, { to });
      },
      success: 'E-mail sent',
    },
  ],
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
