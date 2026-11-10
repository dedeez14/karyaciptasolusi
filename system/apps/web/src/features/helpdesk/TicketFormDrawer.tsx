import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Drawer, Field, Input, LookupSelect, Textarea, toast } from '@/components/ui';
import type { TicketDetail } from './common';

const empty = { subject: '', description: '', customerId: '', contactName: '', contactEmail: '', contactPhone: '', projectId: '', categoryCode: '', priorityCode: 'MEDIUM', channelCode: '', assigneeId: '' };

/** Create a ticket or edit its main fields */
export function TicketFormDrawer({ open, onClose, ticket, onSaved, defaults }: { open: boolean; onClose: () => void; ticket?: TicketDetail | null; onSaved?: (id: string) => void; defaults?: Partial<typeof empty> }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const staff = can('support.ticket.update');
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      ticket
        ? {
            subject: ticket.subject,
            description: ticket.description ?? '',
            customerId: ticket.customerId ?? '',
            contactName: ticket.contactName ?? '',
            contactEmail: ticket.contactEmail ?? '',
            contactPhone: ticket.contactPhone ?? '',
            projectId: ticket.projectId ?? '',
            categoryCode: ticket.categoryCode ?? '',
            priorityCode: ticket.priorityCode,
            channelCode: ticket.channelCode ?? '',
            assigneeId: ticket.assigneeId ?? '',
          }
        : { ...empty, ...defaults },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket]);
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = ticket ? await api.patch<{ id: string; code: string }>(`/helpdesk/tickets/${ticket.id}`, form) : await api.post<{ id: string; code: string }>('/helpdesk/tickets', form);
      toast.success(ticket ? 'Ticket updated' : `Ticket ${r.code} created`);
      qc.invalidateQueries({ queryKey: ['helpdesk'] });
      onSaved?.(r.id);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={ticket ? `Edit ${ticket.code}` : 'New ticket'}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="save" loading={busy} onClick={save}>
            {ticket ? 'Save' : 'Create ticket'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Subject" required error={errors.subject}>
          <Input value={form.subject} maxLength={250} onChange={(e) => set('subject', e.target.value)} placeholder="Short summary of the problem or request" invalid={!!errors.subject} autoFocus />
        </Field>
        <Field label="Description" error={errors.description}>
          <Textarea rows={5} value={form.description} maxLength={20000} onChange={(e) => set('description', e.target.value)} placeholder="Steps to reproduce, error message, links..." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" required error={errors.priorityCode} help="Sets the resolution target (SLA)">
            <LookupSelect category="TICKET_PRIORITY" value={form.priorityCode} onChange={(v) => set('priorityCode', v)} clearable={false} invalid={!!errors.priorityCode} />
          </Field>
          <Field label="Category" error={errors.categoryCode}>
            <LookupSelect category="TICKET_CATEGORY" value={form.categoryCode} onChange={(v) => set('categoryCode', v)} />
          </Field>
          <Field label="Customer" error={errors.customerId} help="Contact details are filled from the customer when left empty">
            <AsyncSelect resource="customers" value={form.customerId} onChange={(v) => set('customerId', v ?? '')} placeholder="None" />
          </Field>
          <Field label="Project" error={errors.projectId}>
            <AsyncSelect resource="projects" value={form.projectId} onChange={(v) => set('projectId', v ?? '')} placeholder="None" />
          </Field>
          <Field label="Contact name" error={errors.contactName}>
            <Input value={form.contactName} maxLength={150} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label="Contact e-mail" error={errors.contactEmail}>
            <Input type="email" value={form.contactEmail} maxLength={150} onChange={(e) => set('contactEmail', e.target.value)} invalid={!!errors.contactEmail} />
          </Field>
          <Field label="Contact phone" error={errors.contactPhone}>
            <Input type="tel" value={form.contactPhone} maxLength={50} onChange={(e) => set('contactPhone', e.target.value)} />
          </Field>
          <Field label="Received via" error={errors.channelCode}>
            <LookupSelect category="TICKET_CHANNEL" value={form.channelCode} onChange={(v) => set('channelCode', v)} />
          </Field>
          {staff && (
            <Field label="Assignee" error={errors.assigneeId}>
              <AsyncSelect resource="users" value={form.assigneeId} onChange={(v) => set('assigneeId', v ?? '')} placeholder="Unassigned" />
            </Field>
          )}
        </div>
      </div>
    </Drawer>
  );
}
