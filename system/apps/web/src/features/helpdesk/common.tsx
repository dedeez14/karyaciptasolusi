import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Icon, Tooltip, type Tone } from '@/components/ui';

export type SlaState = 'none' | 'on_track' | 'at_risk' | 'breached' | 'met';

export interface TicketRow {
  id: string;
  code: string;
  subject: string;
  description: string | null;
  customerId: string | null;
  customerName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  projectId: string | null;
  projectName: string | null;
  categoryCode: string | null;
  priorityCode: string;
  statusCode: string;
  channelCode: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdByName: string | null;
  dueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  satisfaction: number | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  sla: SlaState;
}

export interface TicketDetail extends TicketRow {
  canEdit: boolean;
  canDelete: boolean;
  messages: { id: string; body: string; isInternal: boolean; authorName: string; fromCustomer: boolean; mine: boolean; createdAt: string }[];
  files: { id: string; name: string; size: number; mimeType: string; createdAt: string }[];
}

export interface TicketSummary {
  open: number;
  unassigned: number;
  breached: number;
  mine: number;
  resolvedWeek: number;
  avgFirstResponseHours: number | null;
}

export const TICKET_LOOKUPS = ['TICKET_STATUS', 'TICKET_PRIORITY', 'TICKET_CATEGORY', 'TICKET_CHANNEL'];
export const CLOSED_STATUSES = ['RESOLVED', 'CLOSED'];

const SLA: Record<SlaState, { label: string; tone: Tone; icon: string }> = {
  none: { label: 'No SLA', tone: 'gray', icon: 'minus' },
  on_track: { label: 'On track', tone: 'green', icon: 'timer' },
  at_risk: { label: 'At risk', tone: 'amber', icon: 'alarm-clock' },
  breached: { label: 'Breached', tone: 'red', icon: 'siren' },
  met: { label: 'SLA met', tone: 'green', icon: 'circle-check' },
};

/** Remaining / overdue time in words, e.g. "3h 20m left", "2d overdue" */
export function dueIn(dueAt: string | null, now = Date.now()) {
  if (!dueAt) return '';
  const diff = new Date(dueAt).getTime() - now;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const txt = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  return diff >= 0 ? `${txt} left` : `${txt} overdue`;
}

export function SlaBadge({ t, compact }: { t: Pick<TicketRow, 'sla' | 'dueAt' | 'resolvedAt'>; compact?: boolean }) {
  const s = SLA[t.sla];
  if (t.sla === 'none') return null;
  const open = !t.resolvedAt;
  return (
    <Tooltip side="top" content={t.dueAt ? `Resolution target ${fmtDateTime(t.dueAt)}` : s.label}>
      <span>
        <Badge tone={s.tone}>
          <Icon name={s.icon} className="h-3 w-3" />
          {compact && open ? dueIn(t.dueAt) : s.label}
        </Badge>
      </span>
    </Tooltip>
  );
}

export function useTicketSummary() {
  return useQuery({ queryKey: ['helpdesk', 'summary'], queryFn: () => api.get<TicketSummary>('/helpdesk/tickets/summary'), staleTime: 15_000 });
}
