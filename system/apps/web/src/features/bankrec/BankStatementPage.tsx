import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, cn, confirm, DatePicker, Dropdown, EmptyState, Field, Icon, Input, Modal, NumberInput, PageHeader, Spinner, Textarea, toast } from '@/components/ui';
import { Amount, ImportLinesModal, type LedgerRow, type ParsedLine, type StatementDetail, type StatementLine } from './common';

const n = (v: unknown) => Number(v ?? 0);

export default function BankStatementPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['bankrec', 'one', id], queryFn: () => api.get<StatementDetail>(`/bank-reconciliation/${id}`) });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState<StatementLine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const d = q.data;
  const isOpen = d?.statusCode === 'OPEN';
  const canMatch = isOpen && can('accounting.bankrec.reconcile');
  const canEdit = isOpen && can('accounting.bankrec.create');
  const active = d?.lines.find((l) => l.id === activeId) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['bankrec'] });

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      await refresh();
      return r;
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const candidates = useMemo(() => {
    const list = d?.candidates ?? [];
    const t = search.trim().toLowerCase();
    const filtered = t ? list.filter((c) => `${c.number} ${c.description ?? ''} ${c.reference ?? ''} ${c.lineDescription ?? ''} ${c.amount}`.toLowerCase().includes(t)) : list;
    if (!active) return filtered;
    // closest first: same amount, then nearest date
    const target = n(active.amount);
    const day = new Date(active.date).getTime();
    return [...filtered].sort((a, b) => {
      const sa = n(a.amount) === target ? 0 : 1;
      const sb = n(b.amount) === target ? 0 : 1;
      return sa - sb || Math.abs(new Date(a.date).getTime() - day) - Math.abs(new Date(b.date).getTime() - day);
    });
  }, [d?.candidates, search, active]);
  const pickedTotal = (d?.candidates ?? []).filter((c) => picked.has(c.id)).reduce((a, c) => a + n(c.amount), 0);

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!d) return <EmptyState icon="scale" title="Statement not found" />;
  const s = d.summary;
  const diff = n(s.difference);

  const choose = (l: StatementLine) => {
    if (l.matched || !canMatch) return;
    setActiveId(l.id === activeId ? null : l.id);
    setPicked(new Set());
  };
  const match = async () => {
    if (!active) return;
    await run('match', () => api.post(`/bank-reconciliation/${d.id}/lines/${active.id}/match`, { journalLineIds: [...picked] }), 'Line matched');
    setActiveId(null);
    setPicked(new Set());
  };
  const autoMatch = async () => {
    const r = (await run('auto', () => api.post<{ matched: number; remaining: number }>(`/bank-reconciliation/${d.id}/auto-match`))) as { matched: number; remaining: number } | undefined;
    if (r) toast.success(r.matched ? `${r.matched} line${r.matched === 1 ? '' : 's'} matched automatically, ${r.remaining} left` : 'No automatic matches found - match the remaining lines by hand');
  };
  const reconcile = async () => {
    if (!(await confirm({ title: `Reconcile ${d.number}?`, message: 'The statement is locked once reconciled. You can reopen it later if something has to change.', confirmText: 'Reconcile' }))) return;
    await run('rec', () => api.post(`/bank-reconciliation/${d.id}/reconcile`), `${d.number} reconciled`);
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${d.number}?`, message: 'The statement and its lines are removed; matched book entries become available again.', confirmText: 'Delete', danger: true }))) return;
    await run('del', () => api.delete(`/bank-reconciliation/${d.id}`), 'Statement deleted');
    navigate('/accounting/bank-reconciliation');
  };
  const importLines = async (lines: ParsedLine[]) => {
    await api.post(`/bank-reconciliation/${d.id}/lines`, { lines });
    toast.success(`${lines.length} line${lines.length === 1 ? '' : 's'} added`);
    await refresh();
  };

  return (
    <div>
      <PageHeader
        back={() => navigate('/accounting/bank-reconciliation')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.number}
            {d.statusCode === 'RECONCILED' ? <Badge tone="green">Reconciled</Badge> : <Badge tone="amber">In progress</Badge>}
          </span>
        }
        subtitle={`${d.bankAccountName} · ${fmtDate(d.periodStart)} – ${fmtDate(d.periodEnd)}${d.ledgerAccount ? ` · ledger ${d.ledgerAccount}` : ''}`}
        actions={
          <>
            {canMatch && (
              <Button variant="outline" icon="wand-sparkles" loading={busy === 'auto'} onClick={autoMatch} disabled={!s.unmatchedCount}>
                Auto-match
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" icon="file-up" onClick={() => setImporting(true)}>
                Import lines
              </Button>
            )}
            {isOpen && can('accounting.bankrec.reconcile') && (
              <Button icon="check-check" loading={busy === 'rec'} onClick={reconcile} disabled={!d.canReconcile}>
                Reconcile
              </Button>
            )}
            {!isOpen && can('accounting.bankrec.reconcile') && (
              <Button variant="outline" icon="rotate-ccw" loading={busy === 'reopen'} onClick={() => run('reopen', () => api.post(`/bank-reconciliation/${d.id}/reopen`), 'Statement reopened')}>
                Reopen
              </Button>
            )}
            {isOpen && (
              <Dropdown
                trigger={<Button variant="ghost" size="icon" icon="more-vertical" aria-label="More actions" />}
                items={[
                  { label: 'Add a line', icon: 'plus', onClick: () => setAdding(true), hidden: !canEdit },
                  { label: 'Edit period & balances', icon: 'pencil', onClick: () => setEditing(true), hidden: !canEdit },
                  'divider',
                  { label: 'Delete statement', icon: 'trash-2', danger: true, onClick: remove, hidden: !can('accounting.bankrec.delete') },
                ]}
              />
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Bank closing balance" value={fmtMoney(d.closingBalance)} hint={`Opening ${fmtMoney(d.openingBalance)} + lines ${fmtMoney(s.linesTotal)}`} />
        <Summary
          label="Books, adjusted"
          value={fmtMoney(s.adjustedBook)}
          hint={
            <>
              Book {fmtMoney(s.bookBalance)} − not on bank {fmtMoney(s.outstanding)}
              {n(s.inTransit) !== 0 && <> + booked later {fmtMoney(s.inTransit)}</>}
            </>
          }
        />
        <Summary label="Difference" value={fmtMoney(diff)} tone={diff === 0 ? 'good' : 'bad'} hint={diff === 0 ? 'Bank and books agree' : 'Match or record the remaining lines'} />
        <Summary label="Lines matched" value={`${d.lines.length - s.unmatchedCount} / ${d.lines.length}`} tone={s.unmatchedCount ? 'warn' : 'good'} hint={s.unmatchedCount ? `${s.unmatchedCount} open · ${fmtMoney(s.unmatchedTotal)}` : 'All lines matched'} />
      </div>
      {n(s.statementCheck) !== 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="triangle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Opening balance + lines differs from the closing balance by <b className="tabular-nums">{fmtMoney(s.statementCheck)}</b>. A line is missing, doubled or the balances were typed wrong.
          </span>
        </div>
      )}
      {d.reconciledAt && (
        <p className="mb-4 text-xs text-slate-500">
          Reconciled {fmtDateTime(d.reconciledAt)}
          {d.reconciledBy ? ` by ${d.reconciledBy}` : ''}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card title="Bank statement" subtitle={canMatch ? 'Click an open line, then tick the book entries that make it up' : undefined} className="xl:col-span-3" bodyClass="p-0">
          {d.lines.length === 0 ? (
            <EmptyState
              icon="file-spreadsheet"
              title="No lines yet"
              description="Import the statement CSV from your internet banking, or add lines by hand."
              action={
                canEdit && (
                  <Button icon="file-up" onClick={() => setImporting(true)}>
                    Import lines
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {d.lines.map((l) => (
                <li key={l.id}>
                  <div
                    role={!l.matched && canMatch ? 'button' : undefined}
                    tabIndex={!l.matched && canMatch ? 0 : undefined}
                    onClick={() => choose(l)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose(l))}
                    className={cn('flex items-start gap-3 px-4 py-3', !l.matched && canMatch && 'cursor-pointer hover:bg-slate-50', l.id === activeId && 'bg-brand-50 ring-2 ring-brand-500 ring-inset')}
                  >
                    <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', l.matched ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                      <Icon name={l.matched ? 'check' : 'circle-dashed'} className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-sm font-medium text-slate-800">{l.description}</p>
                        <Amount value={l.amount} className="shrink-0 text-sm font-semibold" />
                      </div>
                      <p className="text-xs text-slate-500">
                        {fmtDate(l.date)}
                        {l.reference ? ` · ${l.reference}` : ''}
                      </p>
                      {l.matches.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {l.matches.map((m) => (
                            <span key={m.matchId} className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', m.status === 'POSTED' ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700')} title={m.description ?? undefined}>
                              {m.number ?? 'missing'} · {fmtDate(m.date)}
                              {m.status !== 'POSTED' && ' · voided'}
                            </span>
                          ))}
                          {canMatch && (
                            <button
                              type="button"
                              className="text-[11px] font-medium text-slate-500 hover:text-red-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                run('unmatch', () => api.delete(`/bank-reconciliation/${d.id}/lines/${l.id}/match`), 'Match removed');
                              }}
                            >
                              Unmatch
                            </button>
                          )}
                        </div>
                      )}
                      {!l.matched && canMatch && l.id === activeId && (
                        <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" icon="link" onClick={match} disabled={!picked.size} loading={busy === 'match'}>
                            Match {picked.size ? `${picked.size} entr${picked.size === 1 ? 'y' : 'ies'}` : ''}
                          </Button>
                          {can('accounting.cash.create') && (
                            <Button size="sm" variant="outline" icon="receipt" onClick={() => setRecording(l)}>
                              Record as {n(l.amount) > 0 ? 'money in' : 'money out'}
                            </Button>
                          )}
                          {canEdit && !l.matches.length && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="trash-2"
                              onClick={() => run('delline', () => api.delete(`/bank-reconciliation/${d.id}/lines/${l.id}`), 'Line deleted')}
                            >
                              Delete line
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Book entries not on a statement" subtitle={`${d.candidates.length} entr${d.candidates.length === 1 ? 'y' : 'ies'} of this account up to a month after the period`} className="xl:col-span-2" bodyClass="p-0">
          <div className="border-b border-line p-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, description, amount..." />
          </div>
          {active && (
            <div className={cn('flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs', Math.abs(pickedTotal - n(active.amount)) < 0.005 && picked.size ? 'bg-emerald-50 text-emerald-800' : 'bg-brand-50 text-brand-800')}>
              <span>
                Selected <b className="tabular-nums">{fmtMoney(pickedTotal)}</b> of <b className="tabular-nums">{fmtMoney(active.amount)}</b>
              </span>
              <button type="button" className="font-medium hover:underline" onClick={() => setActiveId(null)}>
                Cancel
              </button>
            </div>
          )}
          {candidates.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{search ? 'Nothing matches the search.' : 'Every book entry is on a statement.'}</p>
          ) : (
            <ul className="max-h-[38rem] divide-y divide-line overflow-y-auto">
              {candidates.map((c) => (
                <LedgerItem
                  key={c.id}
                  row={c}
                  selectable={!!active}
                  checked={picked.has(c.id)}
                  suggested={!!active && n(c.amount) === n(active.amount)}
                  onToggle={(v) =>
                    setPicked((p) => {
                      const nx = new Set(p);
                      if (v) nx.add(c.id);
                      else nx.delete(c.id);
                      return nx;
                    })
                  }
                />
              ))}
            </ul>
          )}
          {n(s.outstanding) !== 0 && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-slate-500">
              {s.outstandingCount} book entr{s.outstandingCount === 1 ? 'y' : 'ies'} up to {fmtDate(d.periodEnd)} not on the bank yet ({fmtMoney(s.outstanding)}), e.g. cheques not cleared.
            </p>
          )}
        </Card>
      </div>

      <ImportLinesModal open={importing} onClose={() => setImporting(false)} onImport={importLines} periodStart={d.periodStart.slice(0, 10)} periodEnd={d.periodEnd.slice(0, 10)} />
      {adding && <AddLineModal statement={d} onClose={() => setAdding(false)} onDone={refresh} />}
      {editing && <EditHeaderModal statement={d} onClose={() => setEditing(false)} onDone={refresh} />}
      {recording && <RecordModal statement={d} line={recording} onClose={() => setRecording(null)} onDone={() => (setRecording(null), setActiveId(null), refresh())} />}
    </div>
  );
}

function Summary({ label, value, hint, tone }: { label: string; value: string; hint?: React.ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={cn('card p-4', tone === 'good' && 'border-emerald-200', tone === 'bad' && 'border-red-200', tone === 'warn' && 'border-amber-200')}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-900')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function LedgerItem({ row, selectable, checked, suggested, onToggle }: { row: LedgerRow; selectable: boolean; checked: boolean; suggested: boolean; onToggle: (v: boolean) => void }) {
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm text-slate-800">{row.lineDescription || row.description || row.number}</p>
        <Amount value={row.amount} className="shrink-0 text-sm font-medium" />
      </div>
      <p className="text-xs text-slate-500">
        {fmtDate(row.date)} · {row.number}
        {row.reference ? ` · ${row.reference}` : ''}
        {suggested && <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-700">same amount</span>}
      </p>
    </div>
  );
  return (
    <li className={cn('flex items-start gap-3 px-4 py-2.5', checked && 'bg-brand-50/60')}>
      {selectable ? (
        <div className="flex w-full items-start gap-3">
          <div className="pt-0.5">
            <Checkbox checked={checked} onChange={onToggle} />
          </div>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onToggle(!checked)}>
            {body}
          </button>
        </div>
      ) : (
        body
      )}
    </li>
  );
}

function AddLineModal({ statement, onClose, onDone }: { statement: StatementDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: statement.periodEnd.slice(0, 10), description: '', reference: '', amount: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/bank-reconciliation/${statement.id}/lines`, { lines: [{ date: f.date, description: f.description, reference: f.reference || null, amount: Number(f.amount) }] });
      toast.success('Line added');
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a statement line"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!f.description.trim() || !Number(f.amount)}>
            Add line
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" required>
          <DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} min={statement.periodStart.slice(0, 10)} max={statement.periodEnd.slice(0, 10)} clearable={false} />
        </Field>
        <Field label="Amount" required help="Positive = money in, negative = money out">
          <NumberInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} fixed={2} allowNegative />
        </Field>
        <Field label="Description" required className="sm:col-span-2">
          <Input value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Reference" className="sm:col-span-2">
          <Input value={f.reference} maxLength={100} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function EditHeaderModal({ statement, onClose, onDone }: { statement: StatementDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ periodStart: statement.periodStart.slice(0, 10), periodEnd: statement.periodEnd.slice(0, 10), openingBalance: String(n(statement.openingBalance)), closingBalance: String(n(statement.closingBalance)), notes: statement.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/bank-reconciliation/${statement.id}`, { ...f, openingBalance: Number(f.openingBalance || 0), closingBalance: Number(f.closingBalance || 0) });
      toast.success('Statement updated');
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${statement.number}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From" required>
          <DatePicker value={f.periodStart} onChange={(v) => setF({ ...f, periodStart: v })} clearable={false} />
        </Field>
        <Field label="To" required>
          <DatePicker value={f.periodEnd} onChange={(v) => setF({ ...f, periodEnd: v })} clearable={false} />
        </Field>
        <Field label="Opening balance">
          <NumberInput value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} fixed={2} allowNegative />
        </Field>
        <Field label="Closing balance">
          <NumberInput value={f.closingBalance} onChange={(v) => setF({ ...f, closingBalance: v })} fixed={2} allowNegative />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function RecordModal({ statement, line, onClose, onDone }: { statement: StatementDetail; line: StatementLine; onClose: () => void; onDone: () => void }) {
  const income = n(line.amount) > 0;
  const [f, setF] = useState({ accountId: null as string | null, description: line.description, partyName: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ matched: boolean; message?: string; transaction: { number: string } }>(`/bank-reconciliation/${statement.id}/lines/${line.id}/create-transaction`, f);
      if (r.matched) toast.success(`${r.transaction.number} recorded and matched`);
      else toast.info(r.message ?? `${r.transaction.number} recorded`);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={income ? 'Record money in' : 'Record money out'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!f.accountId}>
            Record &amp; match
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <p className="font-medium text-slate-800">{line.description}</p>
          <p className="text-xs text-slate-500">
            {fmtDate(line.date)} · <Amount value={line.amount} /> · {statement.bankAccountName}
          </p>
        </div>
        <Field label={income ? 'Income account' : 'Expense account'} required help={income ? 'e.g. interest income' : 'e.g. bank charges'}>
          <AsyncSelect resource="accounts" value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} manageHref="/r/accounts" manageLabel="Chart of accounts" />
        </Field>
        <Field label="Description">
          <Input value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label={income ? 'Received from' : 'Paid to'}>
          <Input value={f.partyName} maxLength={150} onChange={(e) => setF({ ...f, partyName: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-500">
          Creates a cash &amp; bank transaction (see <Link to="/accounting/cash" className="text-brand-700 hover:underline">Cash &amp; Bank</Link>) dated on the bank date and matches it with this line.
        </p>
      </div>
    </Modal>
  );
}
