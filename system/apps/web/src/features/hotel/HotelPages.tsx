import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, Tabs, type Tone } from '@/components/ui/primitives';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => Number(v || 0);
const STATUS: Record<string, { label: string; tone: Tone }> = {
  TENTATIVE: { label: 'Tentative', tone: 'gray' },
  CONFIRMED: { label: 'Confirmed', tone: 'blue' },
  CHECKED_IN: { label: 'In house', tone: 'green' },
  CHECKED_OUT: { label: 'Checked out', tone: 'gray' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
  NO_SHOW: { label: 'No show', tone: 'amber' },
};
const ROOM: Record<string, { label: string; cls: string }> = {
  VACANT_CLEAN: { label: 'Vacant clean', cls: 'border-green-300 bg-green-50' },
  VACANT_DIRTY: { label: 'Vacant dirty', cls: 'border-amber-300 bg-amber-50' },
  OCCUPIED: { label: 'Occupied', cls: 'border-blue-300 bg-blue-50' },
  OUT_OF_ORDER: { label: 'Out of order', cls: 'border-slate-300 bg-slate-100' },
};
const KIND: Record<string, string> = {
  ROOM: 'Room',
  FNB: 'Food & beverage',
  MINIBAR: 'Minibar',
  LAUNDRY: 'Laundry',
  OTHER: 'Other / fee',
  DEPOSIT: 'Deposit',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CITY_LEDGER: 'To company account',
};
const SOURCE: Record<string, string> = { WALK_IN: 'Walk-in', DIRECT: 'Direct', OTA: 'Online travel agent', CORPORATE: 'Corporate', GROUP: 'Group' };

interface Config {
  id: string;
  name: string;
  businessDate: string;
  pbjtPct: number;
  servicePct: number;
  serviceToStaff: boolean;
  checkoutTime: string;
}
interface GuestLite {
  id: string;
  number: string;
  guestName: string;
  nationality: string;
  arrival: string;
  departure: string;
  roomTypeId: string;
  roomId: string | null;
  balance: number;
}
interface Board {
  config: Config;
  rooms: { id: string; number: string; floor: string | null; roomTypeId: string; status: string; notes: string | null; type: string | null; guest: GuestLite | null }[];
  arrivals: GuestLite[];
  departures: GuestLite[];
  inHouse: number;
}
interface RoomType {
  id: string;
  code: string;
  name: string;
  capacity: number;
  rate: number;
  weekendRate: number | null;
  breakfast: boolean;
  isActive: boolean;
  rooms: number;
}

// ============================================================ front desk
export function FrontDeskPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['hotel', 'board'], queryFn: () => api.get<Board>('/hotel/board') });
  const [checkin, setCheckin] = useState<GuestLite | null>(null);
  const [roomId, setRoomId] = useState('');
  const [make, setMake] = useState(false);
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post(x.path, x.body ?? {}),
    onSuccess: () => (toast.success('Done'), setCheckin(null), qc.invalidateQueries({ queryKey: ['hotel'] })),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Loading />;
  const b = q.data;
  if (!b) return <EmptyState icon="concierge-bell" title="Front desk not available" />;
  const occ = b.rooms.length ? Math.round((b.inHouse / b.rooms.filter((r) => r.status !== 'OUT_OF_ORDER').length) * 100) : 0;
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Front Desk · ${b.config.name}`}
        subtitle={`Business date ${fmtDate(b.config.businessDate)} · ${b.inHouse} in house (${occ}%) · ${b.arrivals.length} arrivals · ${b.departures.length} due out`}
        actions={
          can('hotel.frontdesk') && (
            <Button icon="plus" onClick={() => setMake(true)}>
              Reservation / walk-in
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Arrivals" bodyClass="p-0">
          {!b.arrivals.length ? (
            <p className="px-4 py-3 text-sm text-slate-500">No arrivals left.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {b.arrivals.map((g) => (
                <li key={g.id} className="flex items-center gap-2 px-4 py-2">
                  <Link to={`/hotel/reservations/${g.id}`} className="flex-1 text-brand-600">
                    {g.number} · {g.guestName} {g.nationality !== 'ID' ? `(${g.nationality})` : ''}
                  </Link>
                  <span className="text-xs text-slate-500">to {fmtDate(g.departure)}</span>
                  {can('hotel.frontdesk') && (
                    <Button size="sm" icon="key-round" onClick={() => (setRoomId(''), setCheckin(g))}>
                      Check in
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Due out" bodyClass="p-0">
          {!b.departures.length ? (
            <p className="px-4 py-3 text-sm text-slate-500">Nobody due out.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {b.departures.map((g) => (
                <li key={g.id}>
                  <Link to={`/hotel/reservations/${g.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50">
                    <span className="flex-1">
                      {g.number} · {g.guestName}
                    </span>
                    <span className={`text-xs ${g.balance > 0 ? 'text-amber-700' : 'text-slate-500'}`}>balance {fmtMoney(g.balance, 0)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Rooms">
        {!b.rooms.length ? (
          <EmptyState icon="door-open" title="No rooms" description="Add room types and rooms in Rooms & Rates" />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {b.rooms.map((r) => (
              <div key={r.id} className={`rounded border p-2 text-xs ${ROOM[r.status].cls}`}>
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold">{r.number}</span>
                  <span className="text-slate-500">{r.type}</span>
                </div>
                {r.guest ? (
                  <Link to={`/hotel/reservations/${r.guest.id}`} className="mt-1 block truncate text-brand-700">
                    {r.guest.guestName}
                    <span className="block text-slate-500">out {fmtDate(r.guest.departure)}</span>
                  </Link>
                ) : (
                  <span className="mt-1 block text-slate-500">{ROOM[r.status].label}</span>
                )}
                {r.status !== 'OCCUPIED' && can('hotel.housekeeping') && (
                  <select
                    className="mt-1 w-full rounded border border-line bg-white px-1 py-0.5 text-xs"
                    value={r.status}
                    aria-label={`Status of room ${r.number}`}
                    onChange={(e) => act.mutate({ path: `/hotel/rooms/${r.id}/status`, body: { status: e.target.value } })}
                  >
                    <option value="VACANT_CLEAN">Clean</option>
                    <option value="VACANT_DIRTY">Dirty</option>
                    <option value="OUT_OF_ORDER">Out of order</option>
                  </select>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {checkin && (
        <Modal
          open
          onClose={() => setCheckin(null)}
          title={`Check in ${checkin.guestName}`}
          footer={
            <Button icon="check" disabled={!roomId} loading={act.isPending} onClick={() => act.mutate({ path: `/hotel/reservations/${checkin.id}/check-in`, body: { roomId } })}>
              Check in
            </Button>
          }
        >
          <Field label="Room" required>
            <Select
              value={roomId}
              placeholder="Choose a clean room"
              onChange={(e) => setRoomId(e.target.value)}
              options={b.rooms
                .filter((r) => r.status === 'VACANT_CLEAN')
                .map((r) => ({ value: r.id, label: `${r.number} · ${r.type}${r.roomTypeId === checkin.roomTypeId ? '' : ' (another type)'}` }))}
            />
          </Field>
          <p className="mt-2 text-xs text-slate-500">
            The guest ID must be on the reservation; a foreign guest checks in with a passport or KITAS and is reported to immigration (APOA) within 24 hours.
          </p>
        </Modal>
      )}
      {make && <ReservationForm onClose={() => setMake(false)} onSaved={(id) => navigate(`/hotel/reservations/${id}`)} />}
    </div>
  );
}

// ============================================================ reservations
interface ResRow {
  id: string;
  number: string;
  guestName: string;
  nationality: string;
  arrival: string;
  departure: string;
  nights: number;
  rate: number;
  status: string;
  source: string;
  type: string | null;
  room: string | null;
  balance: number;
}
interface Res {
  id: string;
  number: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  nationality: string;
  idType: string | null;
  idNumber: string | null;
  customerId: string | null;
  customer: { id: string; code: string; name: string } | null;
  source: string;
  sourceRef: string | null;
  roomTypeId: string;
  type: { id: string; code: string; name: string } | null;
  room: { id: string; number: string } | null;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  rate: number;
  status: string;
  notes: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  apoaReportedAt: string | null;
  apoaDue: string | null;
  nightly: { service: number; tax: number; total: number };
  folio: { id: string; date: string; kind: string; description: string; amount: number; service: number; tax: number; total: number; status: string }[];
  balance: number;
  charged: number;
}

export function ReservationsPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW' | 'CANCELLED'>('ALL');
  const [make, setMake] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['hotel', 'reservations', status], queryFn: () => api.get<ResRow[]>('/hotel/reservations', status === 'ALL' ? {} : { status }) });
  const rows = (q.data ?? []).filter((r) => !search || `${r.number} ${r.guestName} ${r.room ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Reservations"
        subtitle="Bookings by room type checked against the rooms free each night; deposits on the guest folio; corporate stays billed to the company"
        actions={
          can('hotel.frontdesk') && (
            <Button icon="plus" onClick={() => setMake(true)}>
              New reservation
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'ALL', label: 'All' },
            { value: 'CONFIRMED', label: 'Upcoming' },
            { value: 'CHECKED_IN', label: 'In house' },
            { value: 'CHECKED_OUT', label: 'Checked out' },
            { value: 'NO_SHOW', label: 'No show' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
        <div className="w-64">
          <Input placeholder="Search guest, number, room" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="calendar-days" title="No reservations" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/hotel/reservations/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.number} · {r.guestName} {r.nationality !== 'ID' ? `(${r.nationality})` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(r.arrival)} - {fmtDate(r.departure)} · {r.nights} nights · {r.type}
                      {r.room ? ` · room ${r.room}` : ''} · {SOURCE[r.source]}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    {fmtMoney(r.rate, 0)} a night
                    {r.balance !== 0 && <span className="block">balance {fmtMoney(r.balance, 0)}</span>}
                  </span>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {make && <ReservationForm onClose={() => setMake(false)} onSaved={(id) => navigate(`/hotel/reservations/${id}`)} />}
    </div>
  );
}

function ReservationForm({ r, onClose, onSaved }: { r?: Res; onClose: () => void; onSaved: (id: string) => void }) {
  const types = useQuery({ queryKey: ['hotel', 'types'], queryFn: () => api.get<RoomType[]>('/hotel/room-types') });
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    guestName: r?.guestName ?? '',
    guestPhone: r?.guestPhone ?? '',
    guestEmail: r?.guestEmail ?? '',
    nationality: r?.nationality ?? 'ID',
    idType: r?.idType ?? 'KTP',
    idNumber: '',
    customerId: r?.customerId ?? (null as string | null),
    source: r?.source ?? 'DIRECT',
    sourceRef: r?.sourceRef ?? '',
    roomTypeId: r?.roomTypeId ?? '',
    arrival: r?.arrival ?? isoDate(),
    departure: r?.departure ?? tomorrow,
    adults: str(r?.adults ?? 2),
    children: str(r?.children ?? 0),
    rate: str(r?.rate),
    status: r?.status === 'TENTATIVE' ? 'TENTATIVE' : 'CONFIRMED',
    notes: r?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const t = types.data?.find((x) => x.id === f.roomTypeId);
  const save = useMutation({
    mutationFn: () => (r ? api.put<Res>(`/hotel/reservations/${r.id}`, f) : api.post<Res>('/hotel/reservations', f)),
    onSuccess: (x) => (toast.success(`${x.number} saved`), onSaved(x.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const inHouse = r?.status === 'CHECKED_IN';
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={r ? `Reservation ${r.number}` : 'New reservation'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.guestName || !f.roomTypeId} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Guest name" required className="sm:col-span-2">
          <Input value={f.guestName} maxLength={150} onChange={(e) => setF({ ...f, guestName: e.target.value })} />
        </Field>
        <Field label="Nationality (country code)" help="ID = Indonesian" error={errors.nationality}>
          <Input value={f.nationality} maxLength={2} onChange={(e) => setF({ ...f, nationality: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="ID" error={errors.idType}>
          <Select value={f.idType} onChange={(e) => setF({ ...f, idType: e.target.value })} options={['KTP', 'PASSPORT', 'KITAS', 'SIM', 'OTHER'].map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label="ID number" error={errors.idNumber} help={r?.idNumber ? `Stored ${r.idNumber} (empty keeps it)` : 'Stored encrypted'}>
          <Input value={f.idNumber} maxLength={40} onChange={(e) => setF({ ...f, idNumber: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={f.guestPhone} maxLength={30} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} />
        </Field>
        <Field label="Room type" required error={errors.roomTypeId}>
          <Select
            disabled={inHouse}
            value={f.roomTypeId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}
            options={(types.data ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: `${x.code} · ${x.name} · ${fmtMoney(x.rate, 0)}` }))}
          />
        </Field>
        <Field label="Arrival" required>
          <DatePicker disabled={inHouse} value={f.arrival} clearable={false} onChange={(v) => setF({ ...f, arrival: v ?? isoDate() })} />
        </Field>
        <Field label="Departure" required error={errors.departure}>
          <DatePicker value={f.departure} clearable={false} onChange={(v) => setF({ ...f, departure: v ?? tomorrow })} />
        </Field>
        <Field label="Adults / children" error={errors.adults}>
          <div className="flex gap-1">
            <NumberInput decimals={0} min={1} max={20} value={f.adults} onChange={(v) => setF({ ...f, adults: v })} aria-label="Adults" />
            <NumberInput decimals={0} min={0} max={20} value={f.children} onChange={(v) => setF({ ...f, children: v })} aria-label="Children" />
          </div>
        </Field>
        <Field label="Rate a night" help={t ? `Rack ${fmtMoney(t.rate, 0)}${t.weekendRate ? `, weekend ${fmtMoney(t.weekendRate, 0)}` : ''}; before service and PBJT` : 'Empty: the room type rate'}>
          <NumberInput decimals={0} min={0} value={f.rate} placeholder={t ? String(t.rate) : ''} onChange={(v) => setF({ ...f, rate: v })} />
        </Field>
        <Field label="Source">
          <Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} options={Object.entries(SOURCE).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Booking reference (OTA / PO)">
          <Input value={f.sourceRef} maxLength={80} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
        </Field>
        {!inHouse && (
          <Field label="Status">
            <Select
              value={f.status}
              onChange={(e) => setF({ ...f, status: e.target.value })}
              options={[
                { value: 'CONFIRMED', label: 'Confirmed' },
                { value: 'TENTATIVE', label: 'Tentative' },
              ]}
            />
          </Field>
        )}
        <Field label="Company billed (city ledger)" error={errors.customerId} className="sm:col-span-2">
          <AsyncSelect resource="customers" value={f.customerId} initialLabel={r?.customer ? `${r.customer.code} - ${r.customer.name}` : undefined} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Notes" className="sm:col-span-3">
          <Textarea rows={2} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function ReservationPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hotel', 'res', id], queryFn: () => api.get<Res>(`/hotel/reservations/${id}`) });
  const board = useQuery({ queryKey: ['hotel', 'board'], queryFn: () => api.get<Board>('/hotel/board') });
  const [modal, setModal] = useState<'edit' | 'checkin' | 'charge' | 'receipt' | 'checkout' | null>(null);
  const [f, setF] = useState({ roomId: '', kind: 'FNB', description: '', amount: '', rkind: 'DEPOSIT', bankAccountId: null as string | null, settle: 'PAYMENT' });
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post(x.path, x.body ?? {}),
    onSuccess: () => (toast.success('Done'), setModal(null), qc.invalidateQueries({ queryKey: ['hotel'] })),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Loading />;
  const r = q.data;
  if (!r) return <EmptyState icon="calendar-days" title="Reservation not found" />;
  const fd = can('hotel.frontdesk');
  const open = ['TENTATIVE', 'CONFIRMED', 'CHECKED_IN', 'NO_SHOW'].includes(r.status);
  const cfg = board.data?.config;
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${r.number} · ${r.guestName}`}
        subtitle={`${fmtDate(r.arrival)} - ${fmtDate(r.departure)} · ${r.nights} nights · ${r.type?.name ?? ''}${r.room ? ` · room ${r.room.number}` : ''} · ${SOURCE[r.source]}${r.customer ? ` · ${r.customer.name}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            {fd && ['TENTATIVE', 'CONFIRMED', 'CHECKED_IN'].includes(r.status) && (
              <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                Edit
              </Button>
            )}
            {fd && ['TENTATIVE', 'CONFIRMED'].includes(r.status) && (
              <Button icon="key-round" onClick={() => (setF({ ...f, roomId: '' }), setModal('checkin'))}>
                Check in
              </Button>
            )}
            {fd && open && (
              <Button variant="outline" icon="plus" onClick={() => (setF({ ...f, kind: r.status === 'CHECKED_IN' ? 'FNB' : 'OTHER', description: '', amount: '' }), setModal('charge'))}>
                Charge
              </Button>
            )}
            {fd && open && (
              <Button
                variant="outline"
                icon="banknote"
                onClick={() => (setF({ ...f, rkind: r.status === 'CHECKED_IN' ? 'PAYMENT' : 'DEPOSIT', amount: r.balance > 0 ? String(r.balance) : '' }), setModal('receipt'))}
              >
                Payment
              </Button>
            )}
            {fd && r.status === 'CHECKED_IN' && (
              <Button icon="log-out" onClick={() => (setF({ ...f, settle: r.customerId ? 'CITY_LEDGER' : 'PAYMENT' }), setModal('checkout'))}>
                Check out
              </Button>
            )}
            {fd && ['TENTATIVE', 'CONFIRMED', 'NO_SHOW'].includes(r.status) && (
              <Button
                variant="ghost"
                icon="x"
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${r.number}?`,
                    message: 'The folio must stand at zero (refund the deposit or charge a fee first).',
                    danger: true,
                    confirmText: 'Cancel reservation',
                  })) && act.mutate({ path: `/hotel/reservations/${r.id}/cancel` })
                }
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Balance</span>
          <span className={`block text-lg font-semibold ${r.balance > 0 ? 'text-amber-700' : ''}`}>{fmtMoney(r.balance, 0)}</span>
          <span className="block text-xs text-slate-500">charged {fmtMoney(r.charged, 0)}</span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">A night</span>
          <span className="block font-semibold">{fmtMoney(r.nightly.total, 0)}</span>
          <span className="block text-xs text-slate-500">
            {fmtMoney(r.rate, 0)} + service {fmtMoney(r.nightly.service, 0)} + PBJT {fmtMoney(r.nightly.tax, 0)}
          </span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Guest</span>
          <span className="block font-semibold">
            {r.nationality} · {r.idType ?? '-'} {r.idNumber ?? ''}
          </span>
          <span className="block text-xs text-slate-500">
            {r.adults} adults{r.children ? `, ${r.children} children` : ''} {r.guestPhone ? `· ${r.guestPhone}` : ''}
          </span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Immigration (APOA)</span>
          <span className="block font-semibold">
            {r.nationality === 'ID'
              ? 'Not needed'
              : r.apoaReportedAt
                ? `Reported ${fmtDate(r.apoaReportedAt.slice(0, 10))}`
                : r.apoaDue
                  ? `Due by ${new Date(r.apoaDue).toLocaleString('id-ID')}`
                  : 'At check-in'}
          </span>
        </Card>
      </div>
      <Card title="Folio" bodyClass="p-0">
        {!r.folio.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">Nothing on the folio yet; the night audit posts the room nights.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2 text-right">Service</th>
                  <th className="px-2 py-2 text-right">PBJT</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.folio.map((l) => (
                  <tr key={l.id} className={l.status === 'VOID' ? 'text-slate-400 line-through' : ''}>
                    <td className="px-4 py-1.5">{fmtDate(l.date)}</td>
                    <td className="px-2 py-1.5">
                      {KIND[l.kind]} · {l.description}
                    </td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(l.amount, 0)}</td>
                    <td className="px-2 py-1.5 text-right">{l.service ? fmtMoney(l.service, 0) : ''}</td>
                    <td className="px-2 py-1.5 text-right">{l.tax ? fmtMoney(l.tax, 0) : ''}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{fmtMoney(l.total, 0)}</td>
                    <td className="pr-2">
                      {fd && l.status === 'POSTED' && r.status !== 'CHECKED_OUT' && l.kind !== 'CITY_LEDGER' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="x"
                          aria-label="Void line"
                          onClick={async () => (await confirm({ title: `Void ${l.description}?`, danger: true, confirmText: 'Void' })) && act.mutate({ path: `/hotel/folio-lines/${l.id}/void` })}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {r.notes && <Card bodyClass="px-4 py-3 text-sm">{r.notes}</Card>}
      {modal === 'edit' && <ReservationForm r={r} onClose={() => setModal(null)} onSaved={() => (setModal(null), qc.invalidateQueries({ queryKey: ['hotel'] }))} />}
      {modal === 'checkin' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={`Check in ${r.guestName}`}
          footer={
            <Button icon="check" disabled={!f.roomId} loading={act.isPending} onClick={() => act.mutate({ path: `/hotel/reservations/${r.id}/check-in`, body: { roomId: f.roomId } })}>
              Check in
            </Button>
          }
        >
          <Field label="Room" required>
            <Select
              value={f.roomId}
              placeholder="Choose a clean room"
              onChange={(e) => setF({ ...f, roomId: e.target.value })}
              options={(board.data?.rooms ?? [])
                .filter((x) => x.status === 'VACANT_CLEAN')
                .map((x) => ({ value: x.id, label: `${x.number} · ${x.type}${x.roomTypeId === r.roomTypeId ? '' : ' (another type)'}` }))}
            />
          </Field>
        </Modal>
      )}
      {modal === 'charge' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title="Charge to the folio"
          footer={
            <Button
              icon="check"
              disabled={!num(f.amount) || !f.description}
              loading={act.isPending}
              onClick={() => act.mutate({ path: `/hotel/reservations/${r.id}/charge`, body: { kind: f.kind, description: f.description, amount: f.amount } })}
            >
              Post
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Kind">
              <Select
                value={f.kind}
                onChange={(e) => setF({ ...f, kind: e.target.value })}
                options={(r.status === 'CHECKED_IN' ? ['FNB', 'MINIBAR', 'LAUNDRY', 'OTHER', 'ROOM'] : ['OTHER']).map((k) => ({ value: k, label: KIND[k] }))}
              />
            </Field>
            <Field label="Description" required className="sm:col-span-2">
              <Input value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <Field label="Amount (before service and PBJT)" required className="sm:col-span-2">
              <NumberInput decimals={0} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            </Field>
          </div>
          {cfg && num(f.amount) > 0 && (
            <p className="mt-2 text-sm">
              + service {cfg.servicePct}% + PBJT {cfg.pbjtPct}% ={' '}
              {fmtMoney(num(f.amount) + Math.round((num(f.amount) * cfg.servicePct) / 100) + Math.round(((num(f.amount) + Math.round((num(f.amount) * cfg.servicePct) / 100)) * cfg.pbjtPct) / 100), 0)}
            </p>
          )}
        </Modal>
      )}
      {modal === 'receipt' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title="Deposit, payment or refund"
          footer={
            <Button
              icon="check"
              disabled={!num(f.amount) || !f.bankAccountId}
              loading={act.isPending}
              onClick={() => act.mutate({ path: `/hotel/reservations/${r.id}/receipt`, body: { kind: f.rkind, amount: f.amount, bankAccountId: f.bankAccountId } })}
            >
              Record
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Kind">
              <Select value={f.rkind} onChange={(e) => setF({ ...f, rkind: e.target.value })} options={['DEPOSIT', 'PAYMENT', 'REFUND'].map((k) => ({ value: k, label: KIND[k] }))} />
            </Field>
            <Field label="Amount" required>
              <NumberInput decimals={0} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            </Field>
            <Field label={f.rkind === 'REFUND' ? 'Paid from' : 'Received into'} required>
              <AsyncSelect resource="bank-accounts" value={f.bankAccountId} onChange={(v) => setF({ ...f, bankAccountId: v })} />
            </Field>
          </div>
        </Modal>
      )}
      {modal === 'checkout' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={`Check out ${r.guestName}`}
          footer={
            <Button
              icon="check"
              disabled={r.balance > 0 && f.settle === 'PAYMENT' && !f.bankAccountId}
              loading={act.isPending}
              onClick={() => act.mutate({ path: `/hotel/reservations/${r.id}/check-out`, body: { settle: r.balance > 0 ? f.settle : 'NONE', bankAccountId: f.bankAccountId } })}
            >
              Check out
            </Button>
          }
        >
          <p className="mb-3 text-sm">
            Balance <b>{fmtMoney(r.balance, 0)}</b>
            {r.balance < 0 && ': refund it first (Payment > Refund).'}
          </p>
          {r.balance > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Settled by">
                <Select
                  value={f.settle}
                  onChange={(e) => setF({ ...f, settle: e.target.value })}
                  options={[{ value: 'PAYMENT', label: 'Payment now' }, ...(r.customerId ? [{ value: 'CITY_LEDGER', label: `Bill ${r.customer?.name ?? 'the company'}` }] : [])]}
                />
              </Field>
              {f.settle === 'PAYMENT' && (
                <Field label="Received into" required>
                  <AsyncSelect resource="bank-accounts" value={f.bankAccountId} onChange={(v) => setF({ ...f, bankAccountId: v })} />
                </Field>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Hotel services carry PBJT, not PPN: the company invoice has no PPN. The room goes to housekeeping (dirty).</p>
        </Modal>
      )}
    </div>
  );
}

// ============================================================ rooms and rates
export function RoomsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const cfgQ = useQuery({ queryKey: ['hotel', 'config'], queryFn: () => api.get<Config>('/hotel/config') });
  const types = useQuery({ queryKey: ['hotel', 'types'], queryFn: () => api.get<RoomType[]>('/hotel/room-types') });
  const board = useQuery({ queryKey: ['hotel', 'board'], queryFn: () => api.get<Board>('/hotel/board') });
  const [te, setTe] = useState<RoomType | 'new' | null>(null);
  const [re, setRe] = useState<Board['rooms'][number] | 'new' | null>(null);
  const setup = can('hotel.setup');
  const refresh = () => qc.invalidateQueries({ queryKey: ['hotel'] });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rooms & Rates"
        subtitle="PBJT jasa perhotelan from the Perda of the city / regency (at most 10%, on the amount with the service charge, UU 1/2022); service charge for the staff (Permenaker 7/2016); hotel services are not a PPN object"
      />
      {cfgQ.data && <ConfigCard key={cfgQ.data.id} c={cfgQ.data} ro={!setup} onSaved={refresh} />}
      <Card
        title="Room types"
        bodyClass="p-0"
        actions={
          setup && (
            <Button size="sm" icon="plus" onClick={() => setTe('new')}>
              Room type
            </Button>
          )
        }
      >
        {!types.data?.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {types.data.map((t) => (
              <li key={t.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => setTe(t)}>
                  <span className="flex-1">
                    {t.code} · {t.name}
                    <span className="block text-xs text-slate-500">
                      {t.capacity} guests · {t.rooms} rooms {t.breakfast ? '· breakfast' : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    {fmtMoney(t.rate, 0)}
                    {t.weekendRate && <span className="block text-xs text-slate-500">weekend {fmtMoney(t.weekendRate, 0)}</span>}
                  </span>
                  <Badge tone={t.isActive ? 'green' : 'gray'}>{t.isActive ? 'active' : 'off'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Rooms"
        bodyClass="p-0"
        actions={
          setup && (
            <Button size="sm" icon="plus" onClick={() => setRe('new')}>
              Room
            </Button>
          )
        }
      >
        {!board.data?.rooms.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {board.data.rooms.map((x) => (
              <li key={x.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50" onClick={() => setRe(x)}>
                  <span className="flex-1">
                    {x.number} · {x.type} {x.floor ? `· floor ${x.floor}` : ''}
                  </span>
                  <span className="text-xs text-slate-500">{ROOM[x.status].label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {te && <TypeForm t={te === 'new' ? undefined : te} ro={!setup} onClose={() => setTe(null)} onSaved={() => (setTe(null), refresh())} />}
      {re && <RoomForm r={re === 'new' ? undefined : re} types={types.data ?? []} ro={!setup} onClose={() => setRe(null)} onSaved={() => (setRe(null), refresh())} />}
    </div>
  );
}

function ConfigCard({ c, ro, onSaved }: { c: Config; ro: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ name: c.name, pbjtPct: str(c.pbjtPct), servicePct: str(c.servicePct), serviceToStaff: c.serviceToStaff, checkoutTime: c.checkoutTime, businessDate: c.businessDate });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put('/hotel/config', f),
    onSuccess: () => (toast.success('Saved'), setErrors({}), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Card
      title="Hotel"
      actions={
        !ro && (
          <Button size="sm" icon="save" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Name" className="sm:col-span-2">
          <Input disabled={ro} value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="PBJT %" error={errors.pbjtPct}>
          <NumberInput disabled={ro} decimals={2} min={0} max={10} value={f.pbjtPct} onChange={(v) => setF({ ...f, pbjtPct: v })} />
        </Field>
        <Field label="Service charge %">
          <NumberInput disabled={ro} decimals={2} min={0} max={25} value={f.servicePct} onChange={(v) => setF({ ...f, servicePct: v })} />
        </Field>
        <Field label="Check-out time">
          <Input disabled={ro} value={f.checkoutTime} maxLength={5} onChange={(e) => setF({ ...f, checkoutTime: e.target.value })} />
        </Field>
        <Field label="Business date" error={errors.businessDate} help="Moved by the night audit">
          <DatePicker disabled={ro} value={f.businessDate} clearable={false} onChange={(v) => setF({ ...f, businessDate: v ?? f.businessDate })} />
        </Field>
        <div className="text-sm sm:col-span-3 lg:col-span-6">
          <Checkbox disabled={ro} checked={f.serviceToStaff} onChange={(v) => setF({ ...f, serviceToStaff: v })} label="Service charge pooled for the staff (Service Charge Payable), not income" />
        </div>
      </div>
    </Card>
  );
}

function TypeForm({ t, ro, onClose, onSaved }: { t?: RoomType; ro: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: t?.code ?? '',
    name: t?.name ?? '',
    capacity: str(t?.capacity ?? 2),
    rate: str(t?.rate),
    weekendRate: str(t?.weekendRate),
    breakfast: t?.breakfast ?? false,
    isActive: t?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => (t ? api.put(`/hotel/room-types/${t.id}`, f) : api.post('/hotel/room-types', f)),
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t ? t.name : 'New room type'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name || !num(f.rate)} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required>
          <Input disabled={ro} value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input disabled={ro} value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Guests">
          <NumberInput disabled={ro} decimals={0} min={1} max={20} value={f.capacity} onChange={(v) => setF({ ...f, capacity: v })} />
        </Field>
        <Field label="Rate a night" required help="Before service and PBJT">
          <NumberInput disabled={ro} decimals={0} min={0} value={f.rate} onChange={(v) => setF({ ...f, rate: v })} />
        </Field>
        <Field label="Weekend rate" help="Friday and Saturday nights">
          <NumberInput disabled={ro} decimals={0} min={0} value={f.weekendRate} onChange={(v) => setF({ ...f, weekendRate: v })} />
        </Field>
        <div className="space-y-1 pt-2 text-sm sm:col-span-3">
          <Checkbox disabled={ro} checked={f.breakfast} onChange={(v) => setF({ ...f, breakfast: v })} label="Breakfast included" />
          <Checkbox disabled={ro} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

function RoomForm({ r, types, ro, onClose, onSaved }: { r?: Board['rooms'][number]; types: RoomType[]; ro: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ number: r?.number ?? '', floor: r?.floor ?? '', roomTypeId: r?.roomTypeId ?? '', notes: r?.notes ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (r ? api.put(`/hotel/rooms/${r.id}`, f) : api.post('/hotel/rooms', f)),
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={r ? `Room ${r.number}` : 'New room'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.number || !f.roomTypeId} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Number" required error={errors.number}>
          <Input disabled={ro} value={f.number} maxLength={10} onChange={(e) => setF({ ...f, number: e.target.value })} />
        </Field>
        <Field label="Floor">
          <Input disabled={ro} value={f.floor} maxLength={10} onChange={(e) => setF({ ...f, floor: e.target.value })} />
        </Field>
        <Field label="Type" required error={errors.roomTypeId}>
          <Select
            disabled={ro}
            value={f.roomTypeId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}
            options={types.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))}
          />
        </Field>
        <Field label="Notes" className="sm:col-span-3">
          <Input disabled={ro} value={f.notes} maxLength={200} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ night audit and reports
interface Reports {
  days: { date: string; available: number; sold: number; occupancy: number; revenue: number; adr: number; revpar: number; noShows: number }[];
  totals: { available: number; sold: number; revenue: number; occupancy: number; adr: number; revpar: number };
  pbjt: { month: string; amount: number; service: number; tax: number }[];
  foreign: {
    id: string;
    number: string;
    guestName: string;
    nationality: string;
    idType: string | null;
    idNumber: string | null;
    room: string | null;
    arrival: string;
    departure: string;
    checkedInAt: string;
    due: string;
    late: boolean;
    reportedAt: string | null;
    ref: string | null;
  }[];
}

export function AuditPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(isoDate());
  const [ref, setRef] = useState<Record<string, string>>({});
  const cfg = useQuery({ queryKey: ['hotel', 'config'], queryFn: () => api.get<Config>('/hotel/config') });
  const q = useQuery({ queryKey: ['hotel', 'reports', from, to], queryFn: () => api.get<Reports>('/hotel/reports', { from, to }) });
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post(x.path, x.body ?? {}),
    onSuccess: () => (toast.success('Done'), qc.invalidateQueries({ queryKey: ['hotel'] })),
    onError: (e) => toast.error(e),
  });
  const r = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Night Audit & Reports"
        subtitle="The night audit posts the room nights of the guests in house, marks the no-shows and moves the business date; occupancy, ADR and RevPAR; PBJT per month for the regional return; foreign guests for the immigration report"
        actions={
          cfg.data &&
          can('hotel.audit') && (
            <Button
              icon="moon"
              loading={act.isPending}
              onClick={async () =>
                (await confirm({
                  title: `Close ${fmtDate(cfg.data!.businessDate)}?`,
                  message: 'Room nights are posted to every in-house folio, reservations not arrived become no-shows, and the business date moves to the next day.',
                  confirmText: 'Run night audit',
                })) && act.mutate({ path: '/hotel/night-audit' })
              }
            >
              Night audit {fmtDate(cfg.data.businessDate)}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <div className="w-40">
          <DatePicker value={from} clearable={false} onChange={(v) => setFrom(v ?? from)} aria-label="From" />
        </div>
        <div className="w-40">
          <DatePicker value={to} clearable={false} onChange={(v) => setTo(v ?? to)} aria-label="To" />
        </div>
      </div>
      {!r ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">Occupancy</span>
              <span className="block text-lg font-semibold">{fmtNumber(r.totals.occupancy, 2)}%</span>
              <span className="block text-xs text-slate-500">
                {r.totals.sold} of {r.totals.available} room nights
              </span>
            </Card>
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">Room revenue</span>
              <span className="block text-lg font-semibold">{fmtMoney(r.totals.revenue, 0)}</span>
            </Card>
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">ADR</span>
              <span className="block text-lg font-semibold">{fmtMoney(r.totals.adr, 0)}</span>
            </Card>
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">RevPAR</span>
              <span className="block text-lg font-semibold">{fmtMoney(r.totals.revpar, 0)}</span>
            </Card>
          </div>
          <Card title="Foreign guests (APOA within 24 hours of check-in)" bodyClass="p-0">
            {!r.foreign.length ? (
              <p className="px-4 py-3 text-sm text-slate-500">No foreign guests in the period.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {r.foreign.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <Link to={`/hotel/reservations/${g.id}`} className="min-w-0 flex-1 text-brand-600">
                      {g.guestName} ({g.nationality}) · {g.idType} {g.idNumber} · room {g.room ?? '-'} · {fmtDate(g.arrival)} - {fmtDate(g.departure)}
                    </Link>
                    {g.reportedAt ? (
                      <Badge tone="green">reported {g.ref ?? ''}</Badge>
                    ) : (
                      <>
                        <Badge tone={g.late ? 'red' : 'amber'}>{g.late ? 'late' : `due ${new Date(g.due).toLocaleString('id-ID')}`}</Badge>
                        {can('hotel.frontdesk') && (
                          <>
                            <div className="w-36">
                              <Input placeholder="APOA reference" value={ref[g.id] ?? ''} onChange={(e) => setRef({ ...ref, [g.id]: e.target.value })} />
                            </div>
                            <Button size="sm" variant="outline" icon="check" onClick={() => act.mutate({ path: `/hotel/reservations/${g.id}/apoa`, body: { ref: ref[g.id] ?? '' } })}>
                              Reported
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="PBJT jasa perhotelan per month" bodyClass="p-0">
            {!r.pbjt.length ? (
              <p className="px-4 py-3 text-sm text-slate-500">No charges in the period.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {r.pbjt.map((m) => (
                  <li key={m.month} className="flex items-center gap-2 px-4 py-2">
                    <span className="flex-1">{m.month}</span>
                    <span className="text-xs text-slate-500">
                      sales {fmtMoney(m.amount, 0)} · service {fmtMoney(m.service, 0)}
                    </span>
                    <span className="w-32 text-right font-medium">PBJT {fmtMoney(m.tax, 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Night audits" bodyClass="p-0">
            {!r.days.length ? (
              <p className="px-4 py-3 text-sm text-slate-500">No night audits in the period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-right">Sold / available</th>
                      <th className="px-2 py-2 text-right">Occupancy</th>
                      <th className="px-2 py-2 text-right">Revenue</th>
                      <th className="px-2 py-2 text-right">ADR</th>
                      <th className="px-4 py-2 text-right">No-shows</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.days.map((d) => (
                      <tr key={d.date}>
                        <td className="px-4 py-1.5">{fmtDate(d.date)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {d.sold} / {d.available}
                        </td>
                        <td className="px-2 py-1.5 text-right">{fmtNumber(d.occupancy, 1)}%</td>
                        <td className="px-2 py-1.5 text-right">{fmtMoney(d.revenue, 0)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMoney(d.adr, 0)}</td>
                        <td className="px-4 py-1.5 text-right">{d.noShows}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
