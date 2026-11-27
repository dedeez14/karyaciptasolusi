import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, StatCard, Tabs, type Tone } from '@/components/ui/primitives';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => Number(v || 0);
const STATUS: Record<string, { label: string; tone: Tone }> = {
  APPLICANT: { label: 'Applicant', tone: 'blue' },
  ACTIVE: { label: 'Active', tone: 'green' },
  GRADUATED: { label: 'Graduated', tone: 'gray' },
  LEFT: { label: 'Left', tone: 'amber' },
  REJECTED: { label: 'Rejected', tone: 'red' },
};
const KIND: Record<string, string> = {
  ENTRY: 'Entry fee (uang pangkal)',
  MONTHLY: 'Monthly (SPP)',
  ANNUAL: 'Annual (first month of the year)',
  ITEM: 'Goods sold apart (PPN)',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (p: string) =>
  /^\d{4}-\d{2}$/.test(p) ? `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : p === 'ENTRY' ? 'Entry fee' : p.startsWith('ITEM-') ? `Goods ${fmtDate(p.slice(5))}` : p;
const nextYear = (y: string) => `${Number(y.slice(0, 4)) + 1}/${Number(y.slice(5)) + 1}`;

interface Setup {
  config: {
    id: string;
    name: string;
    npsn: string | null;
    kind: string;
    licenceNo: string | null;
    licenceExpiry: string | null;
    licenceValid: boolean;
    academicYear: string;
    firstMonth: number;
    dueDay: number;
    maxGrade: number;
  };
  classes: { id: string; academicYear: string; grade: number; name: string; homeroomId: string | null; homeroom: string | null; students: number }[];
  fees: { id: string; code: string; name: string; kind: string; productId: string | null; rates: Record<string, number>; isActive: boolean }[];
}
type Klass = Setup['classes'][number];
type Fee = Setup['fees'][number];
interface StudentRow {
  id: string;
  regNumber: string;
  nis: string | null;
  nisn: string | null;
  name: string;
  sex: string;
  grade: number;
  status: string;
  class: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  open: number;
}
interface Student {
  id: string;
  regNumber: string;
  nis: string | null;
  nisn: string | null;
  nik: string | null;
  name: string;
  sex: string;
  birthDate: string;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  address: string | null;
  grade: number;
  status: string;
  enrolledOn: string | null;
  leftOn: string | null;
  notes: string | null;
  class: { id: string; name: string; academicYear: string } | null;
  discounts: { id: string; feeId: string; fee: string | null; pct: number; reason: string | null; validTo: string | null }[];
  bills: {
    id: string;
    period: string;
    amount: number;
    status: string;
    invoice: { id: string; number: string; date: string; dueDate: string | null; status: string; grandTotal: number; paidAmount: number } | null;
  }[];
}
const useSetup = () => useQuery({ queryKey: ['school', 'setup'], queryFn: () => api.get<Setup>('/school/setup') });

function LicenceBanner({ s }: { s?: Setup }) {
  if (!s || s.config.licenceValid) return null;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      No valid operating licence is recorded. Education is PPN-exempt only from a licensed unit (PP 49/2022 Art. 16(4)), so fee billing is blocked for a PKP until the licence is entered in{' '}
      <Link to="/school/setup" className="underline">
        Classes & Fees
      </Link>
      .
    </div>
  );
}

// ============================================================ students
export function StudentsPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const setup = useSetup();
  const [status, setStatus] = useState<'CURRENT' | 'APPLICANT' | 'ACTIVE' | 'GRADUATED' | 'LEFT' | 'REJECTED'>('CURRENT');
  const [classId, setClassId] = useState('');
  const [search, setSearch] = useState('');
  const [make, setMake] = useState(false);
  const q = useQuery({
    queryKey: ['school', 'students', status, classId, search],
    queryFn: () => api.get<StudentRow[]>('/school/students', { ...(status === 'CURRENT' ? {} : { status }), ...(classId ? { classId } : {}), ...(search ? { q: search } : {}) }),
  });
  const year = setup.data?.config.academicYear;
  const classes = (setup.data?.classes ?? []).filter((c) => c.academicYear === year);
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Students"
        subtitle={`Admission (PPDB) to graduation${year ? ` · academic year ${year}` : ''}; every student is billed as a customer so fees are paid through Sales`}
        actions={
          can('school.students') && (
            <Button icon="plus" onClick={() => setMake(true)}>
              New applicant
            </Button>
          )
        }
      />
      <LicenceBanner s={setup.data} />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'CURRENT', label: 'Current' },
            { value: 'APPLICANT', label: 'Applicants' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'GRADUATED', label: 'Graduated' },
            { value: 'LEFT', label: 'Left' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />
        <div className="w-44">
          <Select value={classId} placeholder="All classes" onChange={(e) => setClassId(e.target.value)} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <div className="w-64">
          <Input placeholder="Search name, NIS, NISN, reg. no." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="graduation-cap" title="No students" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Student</th>
                  <th className="px-2">NIS / NISN</th>
                  <th className="px-2">Class</th>
                  <th className="px-2">Guardian</th>
                  <th className="px-2 text-right">Unpaid</th>
                  <th className="px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/school/students/${s.id}`)}>
                    <td className="px-4 py-2">
                      <Link to={`/school/students/${s.id}`} className="font-medium text-brand-700" onClick={(e) => e.stopPropagation()}>
                        {s.name}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {s.regNumber} · {s.sex === 'M' ? 'Male' : 'Female'}
                      </span>
                    </td>
                    <td className="px-2 text-xs">
                      {s.nis ?? '-'}
                      <span className="block text-slate-500">{s.nisn ?? ''}</span>
                    </td>
                    <td className="px-2">{s.class ?? `grade ${s.grade}`}</td>
                    <td className="px-2 text-xs">
                      {s.guardianName ?? '-'}
                      <span className="block text-slate-500">{s.guardianPhone ?? ''}</span>
                    </td>
                    <td className={`px-2 text-right ${s.open > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{s.open > 0 ? fmtMoney(s.open, 0) : '-'}</td>
                    <td className="px-4">
                      <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {make && <StudentForm onClose={() => setMake(false)} onSaved={(id) => navigate(`/school/students/${id}`)} />}
    </div>
  );
}

function StudentForm({ s, onClose, onSaved }: { s?: Student; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    name: s?.name ?? '',
    sex: s?.sex ?? 'M',
    birthDate: s?.birthDate ?? '',
    nisn: s?.nisn ?? '',
    nik: '',
    guardianName: s?.guardianName ?? '',
    guardianPhone: s?.guardianPhone ?? '',
    guardianEmail: s?.guardianEmail ?? '',
    address: s?.address ?? '',
    grade: str(s?.grade ?? 1),
    notes: s?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (s ? api.put<Student>(`/school/students/${s.id}`, f) : api.post<Student>('/school/students', f)),
    onSuccess: (x) => (toast.success(`${x.name} saved`), onSaved(x.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={s ? s.name : 'New applicant'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.name || !f.birthDate} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Full name" required className="sm:col-span-2">
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Sex">
          <Select
            value={f.sex}
            onChange={(e) => setF({ ...f, sex: e.target.value })}
            options={[
              { value: 'M', label: 'Male' },
              { value: 'F', label: 'Female' },
            ]}
          />
        </Field>
        <Field label="Date of birth" required error={errors.birthDate}>
          <DatePicker value={f.birthDate || null} onChange={(v) => setF({ ...f, birthDate: v ?? '' })} />
        </Field>
        <Field label="Grade applied for" error={errors.grade} help={s && s.status !== 'APPLICANT' ? 'Changed by moving class' : '0 = kindergarten'}>
          <NumberInput decimals={0} min={0} max={12} disabled={!!s && s.status !== 'APPLICANT'} value={f.grade} onChange={(v) => setF({ ...f, grade: v })} />
        </Field>
        <Field label="NISN" help="10 digits, from Dapodik" error={errors.nisn}>
          <Input value={f.nisn} maxLength={10} inputMode="numeric" onChange={(e) => setF({ ...f, nisn: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="NIK" error={errors.nik} help={s?.nik ? `Stored ${s.nik} (empty keeps it)` : 'Stored encrypted (personal data)'}>
          <Input value={f.nik} maxLength={16} inputMode="numeric" onChange={(e) => setF({ ...f, nik: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Parent / guardian">
          <Input value={f.guardianName} maxLength={150} onChange={(e) => setF({ ...f, guardianName: e.target.value })} />
        </Field>
        <Field label="Guardian phone">
          <Input value={f.guardianPhone} maxLength={30} onChange={(e) => setF({ ...f, guardianPhone: e.target.value })} />
        </Field>
        <Field label="Guardian e-mail" error={errors.guardianEmail} className="sm:col-span-2">
          <Input type="email" value={f.guardianEmail} maxLength={150} onChange={(e) => setF({ ...f, guardianEmail: e.target.value })} />
        </Field>
        <Field label="Address" className="sm:col-span-3">
          <Input value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

export function StudentPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const setup = useSetup();
  const q = useQuery({ queryKey: ['school', 'student', id], queryFn: () => api.get<Student>(`/school/students/${id}`) });
  const [modal, setModal] = useState<'' | 'edit' | 'enrol' | 'move' | 'leave' | 'discount' | 'items'>('');
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post<Student>(x.path, x.body ?? {}),
    onSuccess: (x) => (toast.success('Done'), setModal(''), qc.setQueryData(['school', 'student', id], x), qc.invalidateQueries({ queryKey: ['school'] })),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Loading />;
  const s = q.data;
  if (!s) return <EmptyState icon="graduation-cap" title="Student not found" />;
  const fees = setup.data?.fees ?? [];
  const year = setup.data?.config.academicYear ?? '';
  const classes = (setup.data?.classes ?? []).filter((c) => c.academicYear === (s.class?.academicYear ?? year));
  const entryBilled = s.bills.some((b) => b.period === 'ENTRY' && b.status === 'POSTED');
  const open = s.bills.filter((b) => b.status === 'POSTED' && b.invoice && ['CONFIRMED', 'PARTIAL'].includes(b.invoice.status)).reduce((a, b) => a + b.invoice!.grandTotal - b.invoice!.paidAmount, 0);
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => history.back()}
        title={
          <span className="flex items-center gap-2">
            {s.name} <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
          </span>
        }
        subtitle={`${s.regNumber}${s.nis ? ` · NIS ${s.nis}` : ''}${s.class ? ` · class ${s.class.name} (${s.class.academicYear})` : ` · grade ${s.grade}`}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('school.students') && ['APPLICANT', 'ACTIVE'].includes(s.status) && (
              <Button variant="secondary" icon="pencil" onClick={() => setModal('edit')}>
                Edit
              </Button>
            )}
            {s.status === 'APPLICANT' && can('school.students') && (
              <>
                <Button
                  variant="secondary"
                  icon="x"
                  onClick={async () => (await confirm({ title: `Reject ${s.name}?`, danger: true, confirmText: 'Reject' })) && act.mutate({ path: `/school/students/${id}/reject` })}
                >
                  Reject
                </Button>
                <Button icon="user-check" onClick={() => setModal('enrol')}>
                  Enrol
                </Button>
              </>
            )}
            {s.status === 'ACTIVE' && can('school.students') && (
              <>
                <Button variant="secondary" icon="arrow-right-left" onClick={() => setModal('move')}>
                  Move class
                </Button>
                <Button variant="secondary" icon="log-out" onClick={() => setModal('leave')}>
                  Leaves
                </Button>
              </>
            )}
            {s.status === 'ACTIVE' && !entryBilled && can('school.billing') && (
              <Button
                variant="secondary"
                icon="receipt"
                onClick={async () => (await confirm({ title: 'Bill the entry fee now?', confirmText: 'Bill' })) && act.mutate({ path: `/school/students/${id}/entry-bill`, body: { date: isoDate() } })}
              >
                Bill entry fee
              </Button>
            )}
            {['APPLICANT', 'ACTIVE'].includes(s.status) && can('school.billing') && fees.some((f) => f.kind === 'ITEM' && f.isActive) && (
              <Button variant="secondary" icon="shopping-bag" onClick={() => setModal('items')}>
                Sell books / uniform
              </Button>
            )}
          </div>
        }
      />
      <LicenceBanner s={setup.data} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Student">
          <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Born</dt>
            <dd className="col-span-2">
              {fmtDate(s.birthDate)} · {s.sex === 'M' ? 'Male' : 'Female'}
            </dd>
            <dt className="text-slate-500">NISN</dt>
            <dd className="col-span-2">{s.nisn ?? '-'}</dd>
            <dt className="text-slate-500">NIK</dt>
            <dd className="col-span-2">{s.nik ?? '-'}</dd>
            <dt className="text-slate-500">Guardian</dt>
            <dd className="col-span-2">
              {s.guardianName ?? '-'}
              {s.guardianPhone && <span className="block text-xs text-slate-500">{s.guardianPhone}</span>}
              {s.guardianEmail && <span className="block text-xs text-slate-500">{s.guardianEmail}</span>}
            </dd>
            <dt className="text-slate-500">Address</dt>
            <dd className="col-span-2">{s.address ?? '-'}</dd>
            <dt className="text-slate-500">Enrolled</dt>
            <dd className="col-span-2">{s.enrolledOn ? fmtDate(s.enrolledOn) : '-'}</dd>
            {s.leftOn && (
              <>
                <dt className="text-slate-500">Left</dt>
                <dd className="col-span-2">{fmtDate(s.leftOn)}</dd>
              </>
            )}
          </dl>
          {s.notes && <p className="mt-3 whitespace-pre-line text-xs text-slate-600">{s.notes}</p>}
        </Card>
        <Card className="lg:col-span-2" title="Bills" subtitle={open > 0 ? `Unpaid ${fmtMoney(open, 0)}: payments are received in Sales` : 'Nothing unpaid'} bodyClass="p-0">
          {!s.bills.length ? (
            <p className="px-4 py-3 text-sm text-slate-500">No bills yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {s.bills.map((b) => (
                <li key={b.id} className={`flex flex-wrap items-center gap-2 px-4 py-2 ${b.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                  <span className="flex-1">
                    {monthLabel(b.period)}
                    {b.invoice && (
                      <>
                        {' · '}
                        <Link className="text-brand-600" to={`/documents/SI/${b.invoice.id}`}>
                          {b.invoice.number}
                        </Link>
                        {b.invoice.dueDate && <span className="text-xs text-slate-500"> due {fmtDate(b.invoice.dueDate)}</span>}
                      </>
                    )}
                  </span>
                  <span className="text-right">
                    {fmtMoney(b.amount, 0)}
                    {b.invoice && b.status === 'POSTED' && <span className="block text-xs text-slate-500">paid {fmtMoney(b.invoice.paidAmount, 0)}</span>}
                  </span>
                  {b.status === 'POSTED' && can('school.billing') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      icon="undo-2"
                      aria-label="Cancel bill"
                      onClick={async () =>
                        (await confirm({
                          title: `Cancel the ${monthLabel(b.period)} bill?`,
                          message: 'The invoice is cancelled too (it must be unpaid).',
                          danger: true,
                          confirmText: 'Cancel bill',
                        })) && act.mutate({ path: `/school/bills/${b.id}/cancel` })
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card
        title="Scholarships & discounts"
        subtitle="A percentage off a fee type, shown as a discount on the invoice"
        actions={
          can('school.students') &&
          ['APPLICANT', 'ACTIVE'].includes(s.status) && (
            <Button size="sm" icon="plus" onClick={() => setModal('discount')}>
              Add
            </Button>
          )
        }
      >
        {!s.discounts.length ? (
          <p className="text-sm text-slate-500">None.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {s.discounts.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2">
                <span className="flex-1">
                  {d.fee} · <strong>{fmtNumber(d.pct)}%</strong>
                  {d.reason && <span className="text-slate-500"> · {d.reason}</span>}
                  {d.validTo && <span className="block text-xs text-slate-500">until {fmtDate(d.validTo)}</span>}
                </span>
                {can('school.students') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    icon="trash-2"
                    aria-label="Remove discount"
                    onClick={async () =>
                      (await confirm({ title: `Remove the ${d.fee} discount?`, danger: true, confirmText: 'Remove' })) &&
                      act.mutate({ path: `/school/students/${id}/discounts/remove`, body: { feeId: d.feeId, pct: d.pct } })
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {modal === 'edit' && <StudentForm s={s} onClose={() => setModal('')} onSaved={() => (setModal(''), qc.invalidateQueries({ queryKey: ['school'] }))} />}
      {modal === 'enrol' && <EnrolModal s={s} classes={classes} pending={act.isPending} onClose={() => setModal('')} onSubmit={(body) => act.mutate({ path: `/school/students/${id}/enrol`, body })} />}
      {modal === 'move' && (
        <PickModal
          title="Move to class"
          options={classes.filter((c) => c.id !== s.class?.id).map((c) => ({ value: c.id, label: `${c.name} (grade ${c.grade})` }))}
          pending={act.isPending}
          onClose={() => setModal('')}
          onSubmit={(classId) => act.mutate({ path: `/school/students/${id}/move`, body: { classId } })}
        />
      )}
      {modal === 'leave' && <LeaveModal pending={act.isPending} onClose={() => setModal('')} onSubmit={(body) => act.mutate({ path: `/school/students/${id}/leave`, body })} />}
      {modal === 'discount' && (
        <DiscountModal
          fees={fees.filter((f) => f.kind !== 'ITEM')}
          pending={act.isPending}
          onClose={() => setModal('')}
          onSubmit={(body) => act.mutate({ path: `/school/students/${id}/discounts`, body })}
        />
      )}
      {modal === 'items' && (
        <ItemsModal
          s={s}
          fees={fees.filter((f) => f.kind === 'ITEM' && f.isActive)}
          pending={act.isPending}
          onClose={() => setModal('')}
          onSubmit={(body) => act.mutate({ path: `/school/students/${id}/items`, body })}
        />
      )}
    </div>
  );
}

function EnrolModal({ s, classes, pending, onClose, onSubmit }: { s: Student; classes: Klass[]; pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const fit = classes.filter((c) => c.grade === s.grade);
  const [f, setF] = useState({ classId: fit.length === 1 ? fit[0].id : '', date: isoDate(), nis: '', billEntry: true });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Enrol ${s.name}`}
      footer={
        <Button icon="user-check" loading={pending} disabled={!f.classId} onClick={() => onSubmit({ ...f, nis: f.nis || null })}>
          Enrol
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Class" required>
          <Select
            value={f.classId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, classId: e.target.value })}
            options={classes.map((c) => ({ value: c.id, label: `${c.name} · grade ${c.grade}${c.grade === s.grade ? '' : ' (other grade)'} · ${c.students} students` }))}
          />
        </Field>
        <Field label="Date">
          <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="NIS" help="Empty takes the next number">
          <Input value={f.nis} maxLength={20} onChange={(e) => setF({ ...f, nis: e.target.value })} />
        </Field>
        <Field label=" ">
          <Checkbox checked={f.billEntry} onChange={(v) => setF({ ...f, billEntry: v })} label="Bill the entry fee now" />
        </Field>
      </div>
      {!classes.length && <p className="mt-2 text-xs text-amber-700">Add the classes of the current academic year in Classes & Fees first.</p>}
    </Modal>
  );
}

function PickModal({
  title,
  options,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  options: { value: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState('');
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={title}
      footer={
        <Button icon="check" loading={pending} disabled={!v} onClick={() => onSubmit(v)}>
          Save
        </Button>
      }
    >
      <Select value={v} placeholder="Choose" onChange={(e) => setV(e.target.value)} options={options} aria-label={title} />
    </Modal>
  );
}

function LeaveModal({ pending, onClose, onSubmit }: { pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({ date: isoDate(), note: '' });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Student leaves"
      footer={
        <Button icon="log-out" loading={pending} onClick={() => onSubmit({ date: f.date, note: f.note || null })}>
          Save
        </Button>
      }
    >
      <Field label="Date">
        <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
      </Field>
      <Field label="Reason" className="mt-3" help="Transfer (mutasi) to another school, moved away">
        <Input value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <p className="mt-2 text-xs text-slate-500">Unpaid bills stay open; cancel the ones not owed.</p>
    </Modal>
  );
}

function DiscountModal({ fees, pending, onClose, onSubmit }: { fees: Fee[]; pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({ feeId: '', pct: '', reason: '', validTo: '' });
  return (
    <Modal
      open
      onClose={onClose}
      title="Scholarship / discount"
      footer={
        <Button icon="check" loading={pending} disabled={!f.feeId || !num(f.pct)} onClick={() => onSubmit({ feeId: f.feeId, pct: num(f.pct), reason: f.reason || null, validTo: f.validTo || null })}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Fee" required>
          <Select value={f.feeId} placeholder="Choose" onChange={(e) => setF({ ...f, feeId: e.target.value })} options={fees.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} />
        </Field>
        <Field label="Discount %" required>
          <NumberInput decimals={2} min={0} max={100} value={f.pct} onChange={(v) => setF({ ...f, pct: v })} />
        </Field>
        <Field label="Reason" help="Sibling, scholarship, staff child">
          <Input value={f.reason} maxLength={150} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        <Field label="Valid until">
          <DatePicker value={f.validTo || null} onChange={(v) => setF({ ...f, validTo: v ?? '' })} />
        </Field>
      </div>
    </Modal>
  );
}

function ItemsModal({ s, fees, pending, onClose, onSubmit }: { s: Student; fees: Fee[]; pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const [date, setDate] = useState(isoDate());
  const [qty, setQty] = useState<Record<string, string>>({});
  const priced = fees.filter((x) => (x.rates[String(s.grade)] ?? 0) > 0);
  const items = priced.filter((x) => num(qty[x.id] ?? '') > 0).map((x) => ({ feeId: x.id, qty: num(qty[x.id]) }));
  const total = items.reduce((a, i) => a + i.qty * (priced.find((x) => x.id === i.feeId)!.rates[String(s.grade)] ?? 0), 0);
  return (
    <Modal
      open
      onClose={onClose}
      title="Sell books / uniform"
      footer={
        <Button icon="receipt" loading={pending} disabled={!items.length} onClick={() => onSubmit({ date, items })}>
          Make invoice
        </Button>
      }
    >
      <Field label="Date">
        <DatePicker value={date} clearable={false} onChange={(v) => setDate(v ?? isoDate())} />
      </Field>
      {!priced.length ? (
        <p className="mt-3 text-sm text-slate-500">No item has a price for grade {s.grade}.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-line">
            {priced.map((x) => (
              <tr key={x.id}>
                <td className="py-1.5">{x.name}</td>
                <td className="text-right">{fmtMoney(x.rates[String(s.grade)], 0)}</td>
                <td className="w-28 pl-2">
                  <NumberInput decimals={0} min={0} max={1000} value={qty[x.id] ?? ''} onChange={(v) => setQty({ ...qty, [x.id]: v })} aria-label={`Quantity of ${x.name}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-sm">
        Before PPN <strong>{fmtMoney(total, 0)}</strong>
      </p>
      <p className="text-xs text-slate-500">Goods sold apart from the schooling are not exempt education: PPN 12% (DPP 11/12) for a PKP.</p>
    </Modal>
  );
}

// ============================================================ billing
interface RunPreview {
  period: string;
  academicYear: string;
  rows: {
    studentId: string;
    name: string;
    nis: string | null;
    class: string | null;
    billed: boolean;
    lines: { code: string; description: string; amount: number; discountPct: number; net: number }[];
    total: number;
  }[];
}
interface RunResult {
  created: number;
  skipped: number;
  total: number;
  errors: { name: string; error: string }[];
}
interface Arrears {
  asOf: string;
  rows: {
    studentId: string;
    name: string;
    nis: string | null;
    status: string;
    class: string | null;
    guardianPhone: string | null;
    invoices: number;
    open: number;
    overdue: number;
    daysOverdue: number;
  }[];
  open: number;
  overdue: number;
}
interface Summary {
  year: string;
  students: number;
  applicants: number;
  months: { period: string; invoices: number; billed: number; paid: number; rate: number }[];
}

export function BillingPage() {
  const setup = useSetup();
  const [tab, setTab] = useState<'run' | 'arrears' | 'summary' | 'promote'>('run');
  return (
    <div className="space-y-5">
      <PageHeader title="School Billing" subtitle="Monthly fee run, arrears per student, collection per month, and the year-end promotion" />
      <LicenceBanner s={setup.data} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'run', label: 'Monthly run' },
          { value: 'arrears', label: 'Arrears' },
          { value: 'summary', label: 'Collection' },
          { value: 'promote', label: 'Year end' },
        ]}
      />
      {setup.isLoading ? (
        <Loading />
      ) : (
        setup.data && (tab === 'run' ? <RunTab /> : tab === 'arrears' ? <ArrearsTab /> : tab === 'summary' ? <SummaryTab s={setup.data} /> : <PromoteTab s={setup.data} />)
      )}
    </div>
  );
}

function RunTab() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [period, setPeriod] = useState(isoDate().slice(0, 7));
  const [date, setDate] = useState(isoDate());
  const [result, setResult] = useState<RunResult | null>(null);
  const q = useQuery({ queryKey: ['school', 'run', period], queryFn: () => api.get<RunPreview>('/school/billing/preview', { period }), enabled: /^\d{4}-\d{2}$/.test(period) });
  const run = useMutation({
    mutationFn: () => api.post<RunResult>('/school/billing/run', { period, date }),
    onSuccess: (r) => (setResult(r), toast.success(`${r.created} invoices made`), qc.invalidateQueries({ queryKey: ['school'] })),
    onError: (e) => toast.error(e),
  });
  const rows = q.data?.rows ?? [];
  const todo = rows.filter((r) => !r.billed && r.total > 0);
  return (
    <div className="space-y-4">
      <Card bodyClass="flex flex-wrap items-end gap-3">
        <Field label="Month">
          <div className="w-40">
            <Input type="month" value={period} onChange={(e) => e.target.value && (setPeriod(e.target.value), setResult(null))} aria-label="Month" />
          </div>
        </Field>
        <Field label="Invoice date">
          <DatePicker value={date} clearable={false} onChange={(v) => setDate(v ?? isoDate())} />
        </Field>
        <span className="flex-1 text-sm text-slate-600">
          {q.data && (
            <>
              Academic year {q.data.academicYear} · {todo.length} to bill,{' '}
              {fmtMoney(
                todo.reduce((a, r) => a + r.total, 0),
                0,
              )}
              {rows.length - todo.length > 0 && ` · ${rows.length - todo.length} billed already or nothing due`}
            </>
          )}
        </span>
        {can('school.billing') && (
          <Button
            icon="play"
            loading={run.isPending}
            disabled={!todo.length}
            onClick={async () => (await confirm({ title: `Make ${todo.length} invoices for ${monthLabel(period)}?`, confirmText: 'Run billing' })) && run.mutate()}
          >
            Run billing
          </Button>
        )}
      </Card>
      {result && (
        <div className={`rounded border px-4 py-2 text-sm ${result.errors.length ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
          {result.created} invoices made, {fmtMoney(result.total, 0)}; {result.skipped} skipped.
          {result.errors.map((e, i) => (
            <span key={i} className="block text-amber-800">
              {e.name}: {e.error}
            </span>
          ))}
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="receipt" title="No active students in this academic year" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Student</th>
                  <th className="px-2">Class</th>
                  <th className="px-2">Fees</th>
                  <th className="px-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.studentId} className={r.billed ? 'text-slate-400' : ''}>
                    <td className="px-4 py-2">
                      <Link to={`/school/students/${r.studentId}`} className="text-brand-700">
                        {r.name}
                      </Link>
                      <span className="block text-xs text-slate-500">{r.nis}</span>
                    </td>
                    <td className="px-2">{r.class}</td>
                    <td className="px-2 text-xs">
                      {r.lines.map((l) => (
                        <span key={l.code} className="block">
                          {l.code} {fmtMoney(l.amount, 0)}
                          {l.discountPct > 0 && ` less ${fmtNumber(l.discountPct)}%`}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 text-right">{r.billed ? 'Billed' : fmtMoney(r.total, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Annual fees are billed with the first month of the academic year. Education by a licensed unit is PPN-exempt (PP 49/2022 Art. 16); a PKP reports it on faktur code 08.
      </p>
    </div>
  );
}

function ArrearsTab() {
  const [asOf, setAsOf] = useState(isoDate());
  const q = useQuery({ queryKey: ['school', 'arrears', asOf], queryFn: () => api.get<Arrears>('/school/arrears', { asOf }) });
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="As of">
          <DatePicker value={asOf} clearable={false} onChange={(v) => setAsOf(v ?? isoDate())} />
        </Field>
        {q.data && (
          <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-md">
            <StatCard label="Unpaid" value={fmtMoney(q.data.open, 0)} icon="wallet" tone="amber" />
            <StatCard label="Overdue" value={fmtMoney(q.data.overdue, 0)} icon="alarm-clock" tone={q.data.overdue ? 'red' : 'gray'} />
          </div>
        )}
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="check-circle" title="No arrears" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Student</th>
                  <th className="px-2">Class</th>
                  <th className="px-2">Guardian phone</th>
                  <th className="px-2 text-right">Invoices</th>
                  <th className="px-2 text-right">Unpaid</th>
                  <th className="px-2 text-right">Overdue</th>
                  <th className="px-4 text-right">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.studentId}>
                    <td className="px-4 py-2">
                      <Link to={`/school/students/${r.studentId}`} className="text-brand-700">
                        {r.name}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {r.nis} {r.status !== 'ACTIVE' && `· ${STATUS[r.status].label}`}
                      </span>
                    </td>
                    <td className="px-2">{r.class ?? '-'}</td>
                    <td className="px-2 text-xs">{r.guardianPhone ?? '-'}</td>
                    <td className="px-2 text-right">{r.invoices}</td>
                    <td className="px-2 text-right">{fmtMoney(r.open, 0)}</td>
                    <td className={`px-2 text-right ${r.overdue ? 'text-red-700' : ''}`}>{r.overdue ? fmtMoney(r.overdue, 0) : '-'}</td>
                    <td className="px-4 text-right">{r.daysOverdue || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryTab({ s }: { s: Setup }) {
  const years = [...new Set([s.config.academicYear, ...s.classes.map((c) => c.academicYear)])].sort().reverse();
  const [year, setYear] = useState(s.config.academicYear);
  const q = useQuery({ queryKey: ['school', 'summary', year], queryFn: () => api.get<Summary>('/school/summary', { year }) });
  const d = q.data;
  const billed = d?.months.reduce((a, m) => a + m.billed, 0) ?? 0;
  const paid = d?.months.reduce((a, m) => a + m.paid, 0) ?? 0;
  return (
    <div className="space-y-4">
      <div className="w-44">
        <Select value={year} onChange={(e) => setYear(e.target.value)} options={years.map((y) => ({ value: y, label: y }))} aria-label="Academic year" />
      </div>
      {d && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Active students" value={d.students} icon="graduation-cap" />
          <StatCard label="Applicants" value={d.applicants} icon="user-plus" tone="gray" />
          <StatCard label="Billed (monthly runs)" value={fmtMoney(billed, 0)} icon="receipt" tone="green" />
          <StatCard label="Collected" value={billed ? `${fmtNumber(Math.round((paid / billed) * 1000) / 10)}%` : '-'} hint={fmtMoney(paid, 0)} icon="wallet" tone="amber" />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading || !d ? (
          <Loading />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Month</th>
                <th className="px-2 text-right">Invoices</th>
                <th className="px-2 text-right">Billed</th>
                <th className="px-2 text-right">Paid</th>
                <th className="px-4">Collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.months.map((m) => (
                <tr key={m.period}>
                  <td className="px-4 py-2">{monthLabel(m.period)}</td>
                  <td className="px-2 text-right">{m.invoices || '-'}</td>
                  <td className="px-2 text-right">{m.billed ? fmtMoney(m.billed, 0) : '-'}</td>
                  <td className="px-2 text-right">{m.paid ? fmtMoney(m.paid, 0) : '-'}</td>
                  <td className="px-4">
                    {m.billed > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 overflow-hidden rounded bg-slate-100">
                          <div className="h-2 bg-green-500" style={{ width: `${Math.min(100, m.rate)}%` }} />
                        </div>
                        <span className="text-xs">{fmtNumber(m.rate)}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function PromoteTab({ s }: { s: Setup }) {
  const can = useSession((x) => x.can);
  const qc = useQueryClient();
  const cur = s.config.academicYear;
  const toYear = nextYear(cur);
  const from = s.classes.filter((c) => c.academicYear === cur);
  const to = s.classes.filter((c) => c.academicYear === toYear);
  const guess = (c: Klass) =>
    c.grade >= s.config.maxGrade ? '' : ((to.find((t) => t.grade === c.grade + 1 && t.name.replace(/^\d+/, '') === c.name.replace(/^\d+/, '')) ?? to.find((t) => t.grade === c.grade + 1))?.id ?? '');
  const [moves, setMoves] = useState<Record<string, string>>(() => Object.fromEntries(from.map((c) => [c.id, guess(c)])));
  const [date, setDate] = useState(isoDate());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const promote = useMutation({
    mutationFn: () => api.post<{ moved: number; graduated: number }>('/school/promote', { toYear, date, moves: from.map((c) => ({ fromClassId: c.id, toClassId: moves[c.id] || null })) }),
    onSuccess: (r) => (toast.success(`${r.moved} moved up, ${r.graduated} graduated; the year is now ${toYear}`), qc.invalidateQueries({ queryKey: ['school'] })),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const bad = from.some((c) => !moves[c.id] && c.grade < s.config.maxGrade);
  return (
    <Card title={`Year end: ${cur} to ${toYear}`} subtitle="Every class of this year moves to a class of the next year; the last grade graduates">
      {!to.length ? (
        <p className="text-sm text-amber-700">Add the classes of {toYear} in Classes & Fees first.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">Class {cur}</th>
                <th className="text-right">Students</th>
                <th className="pl-4">Goes to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {from.map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5">
                    {c.name} <span className="text-xs text-slate-500">grade {c.grade}</span>
                  </td>
                  <td className="text-right">{c.students}</td>
                  <td className="w-72 pl-4">
                    <Select
                      value={moves[c.id] ?? ''}
                      placeholder={c.grade >= s.config.maxGrade ? 'Graduates' : 'Choose a class'}
                      onChange={(e) => setMoves({ ...moves, [c.id]: e.target.value })}
                      options={to.map((t) => ({ value: t.id, label: `${t.name} (grade ${t.grade})` }))}
                      aria-label={`Next class of ${c.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.moves && <p className="mt-2 text-sm text-red-600">{errors.moves}</p>}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Date">
              <DatePicker value={date} clearable={false} onChange={(v) => setDate(v ?? isoDate())} />
            </Field>
            {can('school.students') && (
              <Button
                icon="graduation-cap"
                loading={promote.isPending}
                disabled={bad}
                onClick={async () =>
                  (await confirm({ title: `Close ${cur} and move every student to ${toYear}?`, message: 'This cannot be undone in one step.', danger: true, confirmText: 'Promote' })) &&
                  promote.mutate()
                }
              >
                Promote
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ============================================================ set-up
export function SetupPage() {
  const can = useSession((s) => s.can);
  const q = useSetup();
  const [klass, setKlass] = useState<Klass | 'new' | null>(null);
  const [fee, setFee] = useState<Fee | 'new' | null>(null);
  const [all, setAll] = useState(false);
  if (q.isLoading) return <Loading />;
  const s = q.data;
  if (!s) return <EmptyState icon="school" title="School set-up not available" />;
  const classes = all ? s.classes : s.classes.filter((c) => c.academicYear === s.config.academicYear || c.academicYear === nextYear(s.config.academicYear));
  const ro = !can('school.setup');
  return (
    <div className="space-y-5">
      <PageHeader title="Classes & Fee Types" subtitle="School identity and operating licence, classes per academic year, and the fee types with their amount per grade" />
      <ConfigCard s={s} ro={ro} />
      <Card
        title="Classes"
        subtitle={`Academic year ${s.config.academicYear} and the next`}
        actions={
          <div className="flex items-center gap-2">
            <Checkbox checked={all} onChange={setAll} label="Earlier years" />
            {!ro && (
              <Button size="sm" icon="plus" onClick={() => setKlass('new')}>
                Class
              </Button>
            )}
          </div>
        }
        bodyClass="p-0"
      >
        {!classes.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">No classes.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Year</th>
                <th className="px-2">Class</th>
                <th className="px-2 text-right">Grade</th>
                <th className="px-2">Homeroom teacher</th>
                <th className="px-2 text-right">Students</th>
                <th className="px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {classes.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2">{c.academicYear}</td>
                  <td className="px-2 font-medium">{c.name}</td>
                  <td className="px-2 text-right">{c.grade}</td>
                  <td className="px-2">{c.homeroom ?? '-'}</td>
                  <td className="px-2 text-right">{c.students}</td>
                  <td className="px-4 text-right">{!ro && <Button variant="ghost" size="icon" icon="pencil" aria-label={`Edit ${c.name}`} onClick={() => setKlass(c)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card
        title="Fee types"
        subtitle="Each fee is a product on the invoice; education fees are PPN-exempt with a valid licence, goods sold apart carry PPN"
        actions={
          !ro && (
            <Button size="sm" icon="plus" onClick={() => setFee('new')}>
              Fee type
            </Button>
          )
        }
        bodyClass="p-0"
      >
        {!s.fees.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">No fee types.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Fee</th>
                <th className="px-2">Kind</th>
                <th className="px-2">Amount per grade</th>
                <th className="px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.fees.map((f) => (
                <tr key={f.id} className={f.isActive ? '' : 'text-slate-400'}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{f.code}</span> {f.name}
                    {!f.isActive && <span className="text-xs"> (inactive)</span>}
                  </td>
                  <td className="px-2 text-xs">{KIND[f.kind]}</td>
                  <td className="px-2 text-xs">
                    {Object.entries(f.rates)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([g, v]) => `${g}: ${fmtMoney(v, 0)}`)
                      .join(' · ') || '-'}
                  </td>
                  <td className="px-4 text-right">{!ro && <Button variant="ghost" size="icon" icon="pencil" aria-label={`Edit ${f.code}`} onClick={() => setFee(f)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {klass && <ClassForm s={s} c={klass === 'new' ? undefined : klass} onClose={() => setKlass(null)} />}
      {fee && <FeeForm s={s} f={fee === 'new' ? undefined : fee} onClose={() => setFee(null)} />}
    </div>
  );
}

function ConfigCard({ s, ro }: { s: Setup; ro: boolean }) {
  const qc = useQueryClient();
  const c = s.config;
  const [f, setF] = useState({
    name: c.name,
    npsn: c.npsn ?? '',
    kind: c.kind,
    licenceNo: c.licenceNo ?? '',
    licenceExpiry: c.licenceExpiry ?? '',
    academicYear: c.academicYear,
    firstMonth: String(c.firstMonth),
    dueDay: String(c.dueDay),
    maxGrade: String(c.maxGrade),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put<Setup>('/school/config', { ...f, licenceExpiry: f.licenceExpiry || null }),
    onSuccess: (x) => (toast.success('Saved'), setErrors({}), qc.setQueryData(['school', 'setup'], x)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Card title="School" actions={<Badge tone={c.licenceValid ? 'green' : 'amber'}>{c.licenceValid ? 'Licence valid: fees PPN-exempt' : 'No valid licence'}</Badge>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Name" required className="sm:col-span-2">
          <Input disabled={ro} value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="NPSN" help="8 digits" error={errors.npsn}>
          <Input disabled={ro} value={f.npsn} maxLength={8} inputMode="numeric" onChange={(e) => setF({ ...f, npsn: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Education">
          <Select
            disabled={ro}
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={[
              { value: 'FORMAL', label: 'Formal (school)' },
              { value: 'NONFORMAL', label: 'Nonformal (course, LKP, PKBM)' },
            ]}
          />
        </Field>
        <Field label="Operating licence no." help="Izin operasional / izin pendirian" className="sm:col-span-2">
          <Input disabled={ro} value={f.licenceNo} maxLength={80} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} />
        </Field>
        <Field label="Licence valid until" help="Empty if it does not expire">
          <DatePicker disabled={ro} value={f.licenceExpiry || null} onChange={(v) => setF({ ...f, licenceExpiry: v ?? '' })} />
        </Field>
        <Field label="Academic year" error={errors.academicYear} help="Moves on with the year-end promotion">
          <Input disabled={ro} value={f.academicYear} maxLength={9} onChange={(e) => setF({ ...f, academicYear: e.target.value })} />
        </Field>
        <Field label="Year starts in">
          <Select disabled={ro} value={f.firstMonth} onChange={(e) => setF({ ...f, firstMonth: e.target.value })} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
        </Field>
        <Field label="Fees due on day" error={errors.dueDay}>
          <NumberInput disabled={ro} decimals={0} min={1} max={28} value={f.dueDay} onChange={(v) => setF({ ...f, dueDay: v })} />
        </Field>
        <Field label="Last grade" help="Graduates at year end (SD 6, SMP 9, SMA 12)" error={errors.maxGrade}>
          <NumberInput disabled={ro} decimals={0} min={1} max={12} value={f.maxGrade} onChange={(v) => setF({ ...f, maxGrade: v })} />
        </Field>
        {!ro && (
          <div className="flex items-end">
            <Button icon="check" loading={save.isPending} disabled={!f.name} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function ClassForm({ s, c, onClose }: { s: Setup; c?: Klass; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ academicYear: c?.academicYear ?? s.config.academicYear, grade: str(c?.grade ?? 1), name: c?.name ?? '', homeroomId: c?.homeroomId ?? (null as string | null) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (c ? api.put<Setup>(`/school/classes/${c.id}`, f) : api.post<Setup>('/school/classes', f)),
    onSuccess: (x) => (toast.success('Class saved'), qc.setQueryData(['school', 'setup'], x), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={c ? `Class ${c.name}` : 'New class'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Academic year" error={errors.academicYear}>
          <Select
            value={f.academicYear}
            onChange={(e) => setF({ ...f, academicYear: e.target.value })}
            options={[...new Set([s.config.academicYear, nextYear(s.config.academicYear), f.academicYear])].map((y) => ({ value: y, label: y }))}
          />
        </Field>
        <Field label="Grade" error={errors.grade}>
          <NumberInput decimals={0} min={0} max={12} value={f.grade} onChange={(v) => setF({ ...f, grade: v })} />
        </Field>
        <Field label="Name" required error={errors.name} help="e.g. 1A, VII-B">
          <Input value={f.name} maxLength={30} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Homeroom teacher (wali kelas)" error={errors.homeroomId} className="sm:col-span-3">
          <AsyncSelect resource="employees" value={f.homeroomId} initialLabel={c?.homeroom ?? undefined} onChange={(v) => setF({ ...f, homeroomId: v })} />
        </Field>
      </div>
    </Modal>
  );
}

function FeeForm({ s, f: fee, onClose }: { s: Setup; f?: Fee; onClose: () => void }) {
  const qc = useQueryClient();
  // every grade from the lowest in use (0 kindergarten, 7 for an SMP) to the last grade
  const used = [...s.classes.map((c) => c.grade), ...Object.keys(fee?.rates ?? {}).map(Number)];
  const low = used.length ? Math.min(...used, s.config.maxGrade) : 1;
  const grades = [...new Set([...Array.from({ length: s.config.maxGrade - low + 1 }, (_, i) => low + i), ...used])].sort((a, b) => a - b);
  const [f, setF] = useState({ code: fee?.code ?? '', name: fee?.name ?? '', kind: fee?.kind ?? 'MONTHLY', isActive: fee?.isActive ?? true });
  const [rates, setRates] = useState<Record<string, string>>(Object.fromEntries(grades.map((g) => [String(g), str(fee?.rates[String(g)])])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        rates: Object.fromEntries(
          Object.entries(rates)
            .filter(([, v]) => v !== '')
            .map(([k, v]) => [k, num(v)]),
        ),
      };
      return fee ? api.put<Setup>(`/school/fees/${fee.id}`, body) : api.post<Setup>('/school/fees', body);
    },
    onSuccess: (x) => (toast.success('Fee saved'), qc.setQueryData(['school', 'setup'], x), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const first = rates[String(grades[0])] ?? '';
  return (
    <Modal
      open
      onClose={onClose}
      title={fee ? `Fee ${fee.code}` : 'New fee type'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required error={errors.code}>
          <Input disabled={!!fee} value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Kind" error={errors.kind} className="sm:col-span-2">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label=" ">
          <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </Field>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">{f.kind === 'ITEM' ? 'Price per grade' : 'Amount per grade'}</span>
          {grades.length > 1 && (
            <Button variant="ghost" size="sm" icon="copy" disabled={!first} onClick={() => setRates(Object.fromEntries(grades.map((g) => [String(g), first])))}>
              Same for every grade
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {grades.map((g) => (
            <Field key={g} label={g === 0 ? 'Kindergarten (0)' : `Grade ${g}`}>
              <NumberInput decimals={0} min={0} value={rates[String(g)] ?? ''} onChange={(v) => setRates({ ...rates, [String(g)]: v })} />
            </Field>
          ))}
        </div>
        {errors.rates && <p className="mt-1 text-xs text-red-600">{errors.rates}</p>}
        <p className="mt-2 text-xs text-slate-500">An empty grade is not billed this fee.</p>
      </div>
    </Modal>
  );
}
