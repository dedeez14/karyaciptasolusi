import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtBytes } from '@/lib/format';
import { Button, cn, Icon, Modal, toast } from '@/components/ui';
import type { ResourceMeta } from './types';

interface Result {
  total: number;
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
}

/** Bulk import of master data from Excel / CSV: template -> upload -> result */
export function ImportDialog({ meta, open, onClose }: { meta: ResourceMeta; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };
  const choose = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) return toast.error('Choose an .xlsx or .csv file');
    setFile(f);
    setResult(null);
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post<Result>(`/resources/${meta.key}/import`, fd);
      setResult(r);
      if (r.created) {
        toast.success(`${r.created} ${meta.label.toLowerCase()} imported`);
        qc.invalidateQueries({ queryKey: ['resource', meta.key] });
        qc.invalidateQueries({ queryKey: ['options', meta.key] });
        qc.invalidateQueries({ queryKey: ['insights'] });
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={`Import ${meta.label}`}
      footer={
        result ? (
          <>
            <Button variant="outline" onClick={reset}>
              Import another file
            </Button>
            <Button onClick={close}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button icon="upload" loading={busy} disabled={!file} onClick={upload}>
              Import
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <div className="space-y-5">
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">1</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">Download the template</p>
                <p className="text-xs text-slate-500">Columns match the form fields. Relations accept the code or name, lists accept the code or label, switches accept Yes/No, dates use YYYY-MM-DD. Columns marked * are required.</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" icon="file-spreadsheet" onClick={() => download(`/resources/${meta.key}/import-template`, { format: 'xlsx' }).catch(toast.error)}>
                    Excel template
                  </Button>
                  <Button size="sm" variant="outline" icon="file-text" onClick={() => download(`/resources/${meta.key}/import-template`, { format: 'csv' }).catch(toast.error)}>
                    CSV template
                  </Button>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">2</span>
              <div className="flex-1">
                <p className="mb-2 text-sm font-medium text-slate-900">Upload the filled file</p>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    choose(e.dataTransfer.files[0]);
                  }}
                  onClick={() => input.current?.click()}
                  className={cn('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors', over ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-brand-300 hover:bg-slate-50')}
                >
                  <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={(e) => choose(e.target.files?.[0])} />
                  <Icon name={file ? 'file-check-2' : 'cloud-upload'} className={cn('mb-2 h-8 w-8', file ? 'text-emerald-500' : 'text-slate-400')} />
                  {file ? (
                    <>
                      <p className="text-sm font-medium text-slate-900">{file.name}</p>
                      <p className="text-xs text-slate-500">{fmtBytes(file.size)} · click to change</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-900">Drop your file here or click to browse</p>
                      <p className="text-xs text-slate-500">.xlsx or .csv, up to 2,000 rows</p>
                    </>
                  )}
                </div>
              </div>
            </li>
          </ol>
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Icon name="shield-check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            Every row is validated like the form, recorded in the audit trail, and invalid rows are skipped and reported.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <ResultBox label="Rows" value={result.total} tone="text-slate-900" />
            <ResultBox label="Imported" value={result.created} tone="text-emerald-600" />
            <ResultBox label="Failed" value={result.failed} tone={result.failed ? 'text-red-600' : 'text-slate-400'} />
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.row} className="border-t border-line/70">
                      <td className="px-3 py-2 align-top font-mono text-xs text-slate-500">{e.row}</td>
                      <td className="px-3 py-2 text-red-700">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ResultBox({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 text-center">
      <p className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
