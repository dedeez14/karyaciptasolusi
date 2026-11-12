import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { MemberPicker } from './pos-components';

interface MemberRow {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  memberNo: string;
  points: number;
  memberSince: string | null;
  marketingConsent: boolean;
}
interface MemberDetail extends MemberRow {
  consentAt: string | null;
  history: { id: string; points: number; reason: string; createdAt: string }[];
}

/** Point of Sale > Members & Points */
export default function PosMembersPage() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['pos', 'members', 'list', search], queryFn: () => api.get<MemberRow[]>('/pos/members', { search }) });
  const qc = useQueryClient();
  return (
    <div className="space-y-5">
      <PageHeader title="Members & Points" subtitle="Loyalty members registered at the cashier, with their recorded consent (UU 27/2022) and points history" />
      <Card
        title="Members"
        actions={
          <div className="flex gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, member no." className="h-8 w-56" />
            <div className="w-56">
              <MemberPicker value={null} onChange={(m) => m && (qc.invalidateQueries({ queryKey: ['pos', 'members'] }), setOpen(m.id))} />
            </div>
          </div>
        }
        bodyClass="p-0"
      >
        {q.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="id-card" title="No members yet" description="Members are registered at the cashier or here" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setOpen(m.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{m.name}</span> <span className="text-xs text-slate-500">{m.memberNo}</span>
                    <span className="block text-xs text-slate-500">
                      {m.phone} {m.memberSince ? `· since ${fmtDate(m.memberSince)}` : ''}
                    </span>
                  </span>
                  {m.marketingConsent && <Badge tone="green">Promotions OK</Badge>}
                  <Badge tone="blue">{fmtNumber(m.points)} pts</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <MemberDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MemberDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['pos', 'members', 'one', id], queryFn: () => api.get<MemberDetail>(`/pos/members/${id}`) });
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [ending, setEnding] = useState(false);
  const adjust = useMutation({
    mutationFn: () => api.post<MemberDetail>(`/pos/members/${id}/points`, { points: Number(points), reason }),
    onSuccess: (m) => {
      qc.setQueryData(['pos', 'members', 'one', id], m);
      qc.invalidateQueries({ queryKey: ['pos', 'members', 'list'] });
      setPoints('');
      setReason('');
      toast.success('Points adjusted');
    },
    onError: (e) => toast.error(e),
  });
  const end = useMutation({
    mutationFn: () => api.post(`/pos/members/${id}/end`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos', 'members'] });
      toast.success('Membership ended');
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  const m = q.data;
  return (
    <Modal open onClose={onClose} title={m ? `${m.name} · ${m.memberNo}` : 'Member'} size="lg">
      {!m ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Points</p>
              <p className="text-xl font-semibold">{fmtNumber(m.points)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Phone</p>
              <p className="font-medium">{m.phone ?? '-'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Consent recorded</p>
              <p className="font-medium">{m.consentAt ? fmtDateTime(m.consentAt) : '-'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Promotions</p>
              <p className="font-medium">{m.marketingConsent ? 'Agreed' : 'Not agreed'}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 font-medium">Points history</p>
            {!m.history.length ? (
              <p className="text-xs text-slate-500">No points yet</p>
            ) : (
              <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line">
                {m.history.map((h) => (
                  <li key={h.id} className="flex justify-between px-3 py-1.5">
                    <span>
                      {h.reason} <span className="text-xs text-slate-500">· {fmtDateTime(h.createdAt)}</span>
                    </span>
                    <span className={cn('font-semibold tabular-nums', h.points < 0 ? 'text-red-600' : 'text-emerald-700')}>
                      {h.points > 0 ? '+' : ''}
                      {fmtNumber(h.points)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {can('pos.member.manage') && (
            <>
              <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[8rem_1fr_auto]">
                <Field label="Adjust points" help="Negative to deduct">
                  <NumberInput allowNegative value={points} onChange={setPoints} />
                </Field>
                <Field label="Reason">
                  <Input value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} placeholder="Birthday bonus, correction..." />
                </Field>
                <Button loading={adjust.isPending} disabled={!Number(points) || reason.trim().length < 3} onClick={() => adjust.mutate()}>
                  Adjust
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-red-50 p-3 text-xs text-red-800">
                <span>Ending the membership withdraws the consent; unused points lapse.</span>
                {ending ? (
                  <Button size="sm" variant="danger" loading={end.isPending} onClick={() => end.mutate()}>
                    Confirm end
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEnding(true)}>
                    End membership
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
