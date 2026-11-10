import { useMemo, useState } from 'react';
import { Button, Field, Modal, Select, Textarea, toast } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { parseAmount, parseCsv, parseDate, guessColumn, type DateStyle, type NumberStyle } from './csv';

export interface StatementRow {
  id: string;
  number: string;
  bankAccountId: string;
  bankAccountName: string | null;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  statusCode: 'OPEN' | 'RECONCILED';
  lineCount: number;
  matchedCount: number;
}

export interface LedgerRow {
  id: string;
  date: string;
  number: string;
  description: string | null;
  reference: string | null;
  sourceType: string | null;
  amount: string;
  lineDescription: string | null;
  status?: string;
}

export interface StatementLine {
  id: string;
  lineNo: number;
  date: string;
  description: string;
  reference: string | null;
  amount: string;
  cashTransactionId: string | null;
  matched: boolean;
  voidedMatch: boolean;
  matches: (LedgerRow & { matchId: string })[];
}

export interface StatementDetail extends Omit<StatementRow, 'lineCount' | 'matchedCount' | 'bankAccountName'> {
  bankAccountName: string;
  ledgerAccount: string | null;
  notes: string | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
  lines: StatementLine[];
  candidates: LedgerRow[];
  canReconcile: boolean;
  summary: {
    linesTotal: string;
    statementCheck: string;
    bookBalance: string;
    outstanding: string;
    outstandingCount: number;
    inTransit: string;
    adjustedBook: string;
    difference: string;
    unmatchedCount: number;
    unmatchedTotal: string;
  };
}

export interface ParsedLine {
  date: string;
  description: string;
  reference: string | null;
  amount: number;
}

/** signed amount: money in green, money out plain with a minus */
export function Amount({ value, className = '' }: { value: string | number; className?: string }) {
  const v = Number(value);
  return <span className={`tabular-nums ${v > 0 ? 'text-emerald-700' : v < 0 ? 'text-slate-800' : 'text-slate-400'} ${className}`}>{v > 0 ? '+' : ''}{fmtMoney(v)}</span>;
}

/**
 * Import statement lines from a CSV export of the bank: map the columns, check the preview, add the lines.
 * Amount can be one signed column or separate money-in / money-out columns.
 */
export function ImportLinesModal({ open, onClose, onImport, periodStart, periodEnd }: { open: boolean; onClose: () => void; onImport: (lines: ParsedLine[]) => Promise<void>; periodStart: string; periodEnd: string }) {
  const [text, setText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [numberStyle, setNumberStyle] = useState<NumberStyle>('auto');
  const [dateStyle, setDateStyle] = useState<DateStyle>('auto');
  const [cols, setCols] = useState({ date: -1, description: -1, reference: -1, amount: -1, credit: -1, debit: -1 });
  const [busy, setBusy] = useState(false);

  const table = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);
  const headers = useMemo(() => (table.length ? (hasHeader ? table[0] : table[0].map((_, i) => `Column ${i + 1}`)) : []), [table, hasHeader]);
  const body = hasHeader ? table.slice(1) : table;

  const load = (t: string) => {
    setText(t);
    const rows = parseCsv(t);
    const h = (rows[0] ?? []).map((x) => x.toLowerCase());
    const credit = guessColumn(h, /^(credit|kredit|cr|masuk|mutasi masuk|money in)/);
    const debit = guessColumn(h, /^(debit|debet|db|dr|keluar|mutasi keluar|money out)/);
    setMode(credit >= 0 && debit >= 0 ? 'split' : 'single');
    setCols({
      date: guessColumn(h, /tanggal|tgl|date|posting|valuta/),
      description: guessColumn(h, /keterangan|deskripsi|description|uraian|remark|narrative|detail/),
      reference: guessColumn(h, /^(ref|reference|referensi|no\.? ?ref|cheque|berita)/),
      amount: guessColumn(h, /^(amount|jumlah|nominal|mutasi)$/, /amount|jumlah|nominal/),
      credit,
      debit,
    });
  };

  const parsed = useMemo(() => {
    return body.map((r, i) => {
      const date = cols.date >= 0 ? parseDate(r[cols.date] ?? '', dateStyle) : null;
      const description = cols.description >= 0 ? (r[cols.description] ?? '').trim() : '';
      const reference = cols.reference >= 0 ? (r[cols.reference] ?? '').trim() || null : null;
      let amount = NaN;
      if (mode === 'single') amount = cols.amount >= 0 ? parseAmount(r[cols.amount] ?? '', numberStyle) : NaN;
      else {
        const cr = cols.credit >= 0 ? parseAmount(r[cols.credit] ?? '', numberStyle) : NaN;
        const db = cols.debit >= 0 ? parseAmount(r[cols.debit] ?? '', numberStyle) : NaN;
        amount = (Number.isFinite(cr) ? Math.abs(cr) : 0) - (Number.isFinite(db) ? Math.abs(db) : 0);
      }
      const errors: string[] = [];
      if (!date) errors.push('date');
      else if (date < periodStart || date > periodEnd) errors.push('outside period');
      if (!description) errors.push('description');
      if (!Number.isFinite(amount) || amount === 0) errors.push('amount');
      return { row: i + 1, date: date ?? '', description: description.slice(0, 500), reference: reference?.slice(0, 100) ?? null, amount: Math.round(amount * 100) / 100, errors };
    });
  }, [body, cols, mode, numberStyle, dateStyle, periodStart, periodEnd]);
  const good = parsed.filter((p) => !p.errors.length);
  const bad = parsed.length - good.length;
  const total = good.reduce((a, p) => a + p.amount, 0);

  const colSelect = (label: string, key: keyof typeof cols, optional = false) => (
    <Field label={label}>
      <Select value={String(cols[key])} onChange={(e) => setCols((c) => ({ ...c, [key]: Number(e.target.value) }))} options={[...(optional ? [{ value: '-1', label: 'Not in the file' }] : [{ value: '-1', label: 'Choose a column' }]), ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }))]} />
    </Field>
  );

  const submit = async () => {
    setBusy(true);
    try {
      await onImport(good.map(({ date, description, reference, amount }) => ({ date, description, reference, amount })));
      setText('');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Import statement lines"
      footer={
        <>
          <span className="mr-auto text-xs text-slate-500">{parsed.length ? `${good.length} ready · ${bad} with problems · net ${fmtMoney(total)}` : 'CSV exported from internet banking'}</span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!good.length}>
            Add {good.length} line{good.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50/40">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) load(await f.text());
                e.target.value = '';
              }}
            />
          </label>
          <span className="text-xs text-slate-500">or paste the rows below. Separators , ; and tab are detected.</span>
        </div>
        <Textarea rows={4} value={text} onChange={(e) => load(e.target.value)} placeholder={'Tanggal;Keterangan;Debet;Kredit\n06/12/2026;TRANSFER MASUK PT ABC;;2.500.000,00'} className="font-mono text-xs" />
        {table.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="First row">
                <Select value={hasHeader ? 'h' : 'd'} onChange={(e) => setHasHeader(e.target.value === 'h')} options={[{ value: 'h', label: 'Column names' }, { value: 'd', label: 'Data' }]} />
              </Field>
              <Field label="Amounts">
                <Select value={mode} onChange={(e) => setMode(e.target.value as 'single' | 'split')} options={[{ value: 'single', label: 'One column (+ in / - out)' }, { value: 'split', label: 'Money in and money out columns' }]} />
              </Field>
              <Field label="Number format">
                <Select value={numberStyle} onChange={(e) => setNumberStyle(e.target.value as NumberStyle)} options={[{ value: 'auto', label: 'Detect' }, { value: 'id', label: '1.234.567,89 (Indonesian)' }, { value: 'en', label: '1,234,567.89 (English)' }]} />
              </Field>
              {colSelect('Date', 'date')}
              {colSelect('Description', 'description')}
              {colSelect('Reference', 'reference', true)}
              {mode === 'single' ? colSelect('Amount', 'amount') : (
                <>
                  {colSelect('Money in (credit)', 'credit')}
                  {colSelect('Money out (debit)', 'debit')}
                </>
              )}
              <Field label="Date format">
                <Select value={dateStyle} onChange={(e) => setDateStyle(e.target.value as DateStyle)} options={[{ value: 'auto', label: 'Detect (day first)' }, { value: 'dmy', label: 'Day / month / year' }, { value: 'mdy', label: 'Month / day / year' }]} />
              </Field>
            </div>
            <div className="max-h-64 overflow-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 200).map((p) => (
                    <tr key={p.row} className="border-t border-line">
                      <td className="px-3 py-1.5 text-xs text-slate-400">{p.row}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{p.date ? fmtDate(p.date) : '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className="line-clamp-1">{p.description || '—'}</span>
                        {p.reference && <span className="block text-xs text-slate-400">{p.reference}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">{Number.isFinite(p.amount) ? <Amount value={p.amount} /> : '—'}</td>
                      <td className="px-3 py-1.5 text-xs">{p.errors.length ? <span className="text-red-600">Check {p.errors.join(', ')}</span> : <span className="text-emerald-600">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
