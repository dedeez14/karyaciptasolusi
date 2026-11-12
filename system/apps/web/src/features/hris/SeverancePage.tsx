import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, isoDate } from '@/lib/format';
import { AsyncSelect, Button, Card, DatePicker, EmptyState, Field, Icon, NumberInput, PageHeader, Select, toast } from '@/components/ui';

interface Estimate {
  employee: { code: string; fullName: string; joinDate: string };
  wage: number;
  unusedLeaveDays: number;
  reason: string;
  kind: 'PKWT' | 'PKWTT';
  months: number;
  years: number;
  compensation: number;
  pesangon: number;
  upmk: number;
  uph: number;
  total: number;
  pesangonMonths: number;
  upmkMonths: number;
}

const REASONS = [
  { value: 'RESIGN', label: 'Resignation by the employee', hint: 'No pesangon / UPMK; unused leave is paid (plus uang pisah if the company rules give one)' },
  { value: 'EFFICIENCY', label: 'Efficiency / restructuring', hint: '1 x pesangon + 1 x UPMK' },
  { value: 'CLOSURE_LOSS', label: 'Business closed after losses', hint: '1 x pesangon + 1 x UPMK' },
  { value: 'MERGER_EMPLOYEE', label: 'Merger - employee does not continue', hint: '1 x pesangon + 1 x UPMK' },
  { value: 'MERGER_EMPLOYER', label: 'Merger - employer does not continue', hint: '2 x pesangon + 1 x UPMK' },
  { value: 'EMPLOYER_FAULT', label: 'Employer at fault', hint: '2 x pesangon + 1 x UPMK' },
  { value: 'RETIREMENT', label: 'Retirement', hint: '2 x pesangon + 1 x UPMK (UU 27/2026)' },
  { value: 'DEATH', label: 'Death of the employee', hint: '2 x pesangon + 1 x UPMK, paid to the heirs' },
  { value: 'MUTUAL', label: 'Other / mutual agreement', hint: '1 x pesangon + 1 x UPMK as a starting point' },
];

/** HRIS > End of employment: what is due by law when employment ends (estimate to prepare the settlement) */
export default function SeverancePage() {
  const [f, setF] = useState({ employeeId: '', endDate: isoDate(), reason: 'RESIGN', contract: '', unused: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const calc = useMutation({
    mutationFn: () =>
      api.post<Estimate>('/hris/severance-estimate', {
        employeeId: f.employeeId,
        endDate: f.endDate,
        reason: f.reason,
        ...(f.contract ? { contract: f.contract === 'PKWT' } : {}),
        ...(f.unused !== '' ? { unusedLeaveDays: Number(f.unused) } : {}),
      }),
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  const r = calc.data;

  return (
    <div className="space-y-5">
      <PageHeader title="End of Employment" subtitle="Pesangon, UPMK, unused leave and PKWT compensation under UU 27/2026 and PP 35/2021" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Employee and reason">
          <div className="grid gap-4">
            <Field label="Employee" required error={errors.employeeId}>
              <AsyncSelect resource="employees" value={f.employeeId || null} onChange={(v) => setF({ ...f, employeeId: v ?? '' })} />
            </Field>
            <Field label="Last working day" required error={errors.endDate}>
              <DatePicker clearable={false} value={f.endDate} onChange={(v) => setF({ ...f, endDate: v })} />
            </Field>
            <Field label="Agreement">
              <Select
                value={f.contract}
                onChange={(e) => setF({ ...f, contract: e.target.value })}
                placeholder="From the employment type"
                options={[
                  { value: 'PKWT', label: 'Fixed-term (PKWT)', hint: 'Compensation: months of service / 12 x 1 month wage' },
                  { value: 'PKWTT', label: 'Permanent (PKWTT)', hint: 'Pesangon, UPMK and unused leave' },
                ]}
              />
            </Field>
            {f.contract !== 'PKWT' && (
              <Field label="Reason">
                <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={REASONS} />
              </Field>
            )}
            <Field label="Unused annual leave (days)" help="Empty = taken from the leave balance this year">
              <NumberInput decimals={1} min={0} max={365} value={f.unused} onChange={(v) => setF({ ...f, unused: v })} />
            </Field>
            <Button icon="calculator" loading={calc.isPending} disabled={!f.employeeId} onClick={() => calc.mutate()}>
              Calculate
            </Button>
          </div>
        </Card>
        <Card title="What is due" className="lg:col-span-2">
          {!r ? (
            <EmptyState icon="calculator" title="Choose an employee and calculate" description="The wage is the base salary plus fixed allowances (tunjangan tetap)." />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Employee</p>
                  <p className="font-medium">{r.employee.fullName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Service</p>
                  <p className="font-medium">
                    {r.years} yr {r.months % 12} mo
                  </p>
                  <p className="text-xs text-slate-400">since {fmtDate(r.employee.joinDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Monthly wage</p>
                  <p className="font-medium tabular-nums">{fmtMoney(r.wage, 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Agreement</p>
                  <p className="font-medium">{r.kind}</p>
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {r.kind === 'PKWT' ? (
                    <tr>
                      <td className="py-2">PKWT compensation ({r.months} months / 12 x wage)</td>
                      <td className="py-2 text-right tabular-nums">{fmtMoney(r.compensation, 0)}</td>
                    </tr>
                  ) : (
                    <>
                      <tr>
                        <td className="py-2">Uang pesangon ({r.pesangonMonths} x wage) · {r.reason}</td>
                        <td className="py-2 text-right tabular-nums">{fmtMoney(r.pesangon, 0)}</td>
                      </tr>
                      <tr>
                        <td className="py-2">Uang penghargaan masa kerja ({r.upmkMonths} x wage)</td>
                        <td className="py-2 text-right tabular-nums">{fmtMoney(r.upmk, 0)}</td>
                      </tr>
                    </>
                  )}
                  <tr>
                    <td className="py-2">Uang penggantian hak - unused leave ({r.unusedLeaveDays} days)</td>
                    <td className="py-2 text-right tabular-nums">{fmtMoney(r.uph, 0)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right text-lg tabular-nums">{fmtMoney(r.total, 0)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
                An estimate to prepare the settlement. UU 27/2026 took effect on 28 Oct 2026 and its implementing regulations are still being issued; check the multipliers against the law, the work agreement and the company regulation (PP / PKB). Severance is taxed with final PPh 21 (PP 68/2009), return travel cost and other rights are not included.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
