import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtBytes, fmtDateTime, fmtNumber, getLocale } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, cn, confirm, DatePicker, Drawer, Field, Icon, Input, previewFile, Select, Spinner, Textarea, toast, NumberInput } from '@/components/ui';
import { Avatar, PriorityBadge, todayIso, usePriorities, useTaskStages, type TaskDetail } from './common';

interface Props {
  /** null = create new task */
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  defaults?: { stageId?: string; projectId?: string; assigneeId?: string };
  onCreated?: (id: string) => void;
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['tasks'] });

/** Task detail / create drawer shared by the board, list and My Tasks pages. */
export function TaskDrawer({ taskId, open, onClose, defaults, onCreated }: Props) {
  const [currentId, setCurrentId] = useState<string | null>(taskId);
  useEffect(() => setCurrentId(taskId), [taskId, open]);
  return (
    <Drawer open={open} onClose={onClose} wide title={currentId ? 'Task' : 'New task'}>
      {open && (currentId ? <TaskDetailView id={currentId} onDeleted={onClose} /> : <NewTaskForm defaults={defaults} onCreated={(id) => { setCurrentId(id); onCreated?.(id); }} onCancel={onClose} />)}
    </Drawer>
  );
}

// ------------------------------------------------------------------------------------------------- create
function NewTaskForm({ defaults, onCreated, onCancel }: { defaults?: Props['defaults']; onCreated: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const stages = useTaskStages().data ?? [];
  const priorities = usePriorities();
  const [form, setForm] = useState({
    title: '',
    description: '',
    stageId: defaults?.stageId ?? '',
    projectId: defaults?.projectId ?? '',
    customerId: '',
    assigneeId: defaults?.assigneeId ?? '',
    priorityCode: '',
    startDate: '',
    dueDate: '',
    estimateHours: '',
    tags: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/tasks', {
        ...form,
        estimateHours: form.estimateHours === '' ? undefined : Number(form.estimateHours),
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: (t) => {
      toast.success('Task created');
      invalidate(qc);
      onCreated(t.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Title" required error={errors.title}>
        <Input autoFocus value={form.title} maxLength={250} onChange={(e) => set('title', e.target.value)} placeholder="What needs to be done?" invalid={!!errors.title} />
      </Field>
      <Field label="Description">
        <Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Stage">
          <Select value={form.stageId} onChange={(e) => set('stageId', e.target.value)} options={stages.map((s) => ({ value: s.id, label: s.name }))} placeholder="First stage" />
        </Field>
        <Field label="Priority" error={errors.priorityCode}>
          <Select value={form.priorityCode} onChange={(e) => set('priorityCode', e.target.value)} options={priorities.map((p) => ({ value: p.value, label: p.label }))} placeholder="—" />
        </Field>
        <Field label="Assignee" error={errors.assigneeId}>
          <AsyncSelect resource="users" value={form.assigneeId} onChange={(v) => set('assigneeId', v ?? '')} placeholder="Unassigned" />
        </Field>
        <Field label="Project">
          <AsyncSelect resource="projects" value={form.projectId} onChange={(v) => set('projectId', v ?? '')} placeholder="No project" />
        </Field>
        <Field label="Customer">
          <AsyncSelect resource="customers" value={form.customerId} onChange={(v) => set('customerId', v ?? '')} placeholder="No customer" />
        </Field>
        <Field label="Estimate (hours)">
          <NumberInput decimals={2} min={0} max={10000} value={form.estimateHours} onChange={(v) => set('estimateHours', v)} />
        </Field>
        <Field label="Start date">
          <DatePicker value={form.startDate} onChange={(v) => set('startDate', v)} />
        </Field>
        <Field label="Due date" error={errors.dueDate}>
          <DatePicker value={form.dueDate} onChange={(v) => set('dueDate', v)} invalid={!!errors.dueDate} />
        </Field>
      </div>
      <Field label="Tags" help="Comma separated">
        <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="website, urgent" />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" icon="plus" loading={save.isPending} disabled={!form.title.trim()}>
          Create task
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------- detail
function TaskDetailView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const stages = useTaskStages().data ?? [];
  const priorities = usePriorities();
  const q = useQuery({ queryKey: ['tasks', 'detail', id], queryFn: () => api.get<TaskDetail>(`/tasks/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/tasks/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast.error(e),
  });

  if (q.isLoading || !q.data)
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  const t = q.data;
  const ro = !t.canEdit || !can('task.task.update');
  const stage = stages.find((s) => s.id === t.stageId);

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${t.code}?`, message: 'The task, its checklist, comments and time entries will be removed.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/tasks/${id}`);
      toast.success('Task deleted');
      refresh();
      onDeleted();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-medium text-slate-700">{t.code}</span>
        {stage && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: `${stage.color ?? '#64748b'}14`, color: stage.color ?? '#64748b' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color ?? '#64748b' }} />
            {stage.name}
          </span>
        )}
        <PriorityBadge code={t.priorityCode} priorities={priorities} />
        {t.completedAt && (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <Icon name="circle-check" className="h-3.5 w-3.5" /> Completed {fmtDateTime(t.completedAt)}
          </span>
        )}
        <span className="ml-auto">Reported by {t.reporterName ?? '—'}</span>
      </div>

      <InlineText value={t.title} disabled={ro} onSave={(v) => patch.mutate({ title: v })} className="text-lg font-semibold text-slate-900" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Stage">
          <Select disabled={ro} value={t.stageId} onChange={(e) => patch.mutate({ stageId: e.target.value })} options={stages.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Priority">
          <Select disabled={ro} value={t.priorityCode ?? ''} onChange={(e) => patch.mutate({ priorityCode: e.target.value || null })} options={priorities.map((p) => ({ value: p.value, label: p.label }))} placeholder="—" />
        </Field>
        <Field label="Assignee">
          <AsyncSelect resource="users" disabled={ro} value={t.assigneeId} initialLabel={t.assigneeName ?? undefined} onChange={(v) => patch.mutate({ assigneeId: v })} placeholder="Unassigned" />
        </Field>
        <Field label="Project">
          <AsyncSelect resource="projects" disabled={ro} value={t.projectId} initialLabel={t.projectName ?? undefined} onChange={(v) => patch.mutate({ projectId: v })} placeholder="No project" />
        </Field>
        <Field label="Customer">
          <AsyncSelect resource="customers" disabled={ro} value={t.customerId} initialLabel={t.customerName ?? undefined} onChange={(v) => patch.mutate({ customerId: v })} placeholder="No customer" />
        </Field>
        <Field label="Estimate (hours)">
          <InlineNumber disabled={ro} value={Number(t.estimateHours)} onSave={(v) => patch.mutate({ estimateHours: v })} />
        </Field>
        <Field label="Start date">
          <DatePicker disabled={ro} value={t.startDate?.slice(0, 10) ?? ''} onChange={(v) => patch.mutate({ startDate: v || null })} />
        </Field>
        <Field label="Due date">
          <DatePicker disabled={ro} value={t.dueDate?.slice(0, 10) ?? ''} onChange={(v) => patch.mutate({ dueDate: v || null })} />
        </Field>
      </div>

      <Field label="Tags" help={ro ? undefined : 'Comma separated, saved when you leave the field'}>
        <InlineText value={t.tags.join(', ')} disabled={ro} onSave={(v) => patch.mutate({ tags: v.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="No tags" className="text-sm" allowEmpty />
      </Field>

      <Field label="Description">
        <InlineArea value={t.description ?? ''} disabled={ro} onSave={(v) => patch.mutate({ description: v })} />
      </Field>

      <Checklist task={t} ro={ro} onChange={refresh} />
      <TimeLog task={t} ro={!can('task.task.update')} onChange={refresh} />
      <Attachments task={t} onChange={refresh} />
      <Comments task={t} onChange={refresh} />

      {can('task.task.delete') && t.canEdit && (
        <div className="flex justify-end border-t border-line pt-4">
          <Button variant="outline" icon="trash-2" className="text-red-600" onClick={remove}>
            Delete task
          </Button>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon, title, extra }: { icon: string; title: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon name={icon} className="h-4 w-4 text-slate-400" />
        {title}
      </h4>
      {extra}
    </div>
  );
}

function InlineText({ value, onSave, disabled, className, placeholder, allowEmpty }: { value: string; onSave: (v: string) => void; disabled?: boolean; className?: string; placeholder?: string; allowEmpty?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const nv = v.trim();
    if (nv === value.trim()) return;
    if (!nv && !allowEmpty) return setV(value);
    onSave(nv);
  };
  return (
    <input
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn('w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 hover:border-line focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/12 focus:outline-none disabled:hover:border-transparent', className)}
    />
  );
}

function InlineArea({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Textarea rows={5} value={v} disabled={disabled} placeholder="Add more details..." onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />;
}

function InlineNumber({ value, onSave, disabled }: { value: number; onSave: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return <NumberInput decimals={2} min={0} max={10000} disabled={disabled} value={v} onChange={setV} onBlur={() => Number(v) !== value && v !== '' && onSave(Number(v))} />;
}

// ------------------------------------------------------------------------------------------------- checklist
function Checklist({ task, ro, onChange }: { task: TaskDetail; ro: boolean; onChange: () => void }) {
  const [title, setTitle] = useState('');
  const done = task.checklist.filter((c) => c.isDone).length;
  const pct = task.checklist.length ? Math.round((done / task.checklist.length) * 100) : 0;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <section>
      <SectionTitle icon="list-checks" title="Checklist" extra={task.checklist.length > 0 && <span className="text-xs text-slate-500">{done} / {task.checklist.length}</span>} />
      {task.checklist.length > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="space-y-1">
        {task.checklist.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={c.isDone} disabled={ro} onChange={(e) => run(() => api.patch(`/tasks/${task.id}/checklist/${c.id}`, { isDone: e.target.checked }))} />
            <span className={cn('flex-1 text-sm', c.isDone && 'text-slate-400 line-through')}>{c.title}</span>
            {!ro && (
              <button type="button" aria-label="Remove item" className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600" onClick={() => run(() => api.delete(`/tasks/${task.id}/checklist/${c.id}`))}>
                <Icon name="x" className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!ro && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            run(() => api.post(`/tasks/${task.id}/checklist`, { title: title.trim() })).then(() => setTitle(''));
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an item..." maxLength={250} className="h-9" />
          <Button type="submit" size="sm" variant="secondary" icon="plus" disabled={!title.trim()}>
            Add
          </Button>
        </form>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- time tracking
function TimeLog({ task, ro, onChange }: { task: TaskDetail; ro: boolean; onChange: () => void }) {
  const [form, setForm] = useState({ date: todayIso(), hours: '', note: '' });
  const [busy, setBusy] = useState(false);
  const spent = Number(task.spentHours);
  const est = Number(task.estimateHours);
  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/time`, { date: form.date, hours: Number(form.hours), note: form.note || null });
      setForm({ date: todayIso(), hours: '', note: '' });
      onChange();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <SectionTitle
        icon="timer"
        title="Time tracking"
        extra={
          <span className={cn('text-xs font-medium', est && spent > est ? 'text-red-600' : 'text-slate-500')}>
            {fmtNumber(spent, 2)} h{est ? ` of ${fmtNumber(est, 2)} h` : ''}
          </span>
        }
      />
      {est > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', spent > est ? 'bg-red-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, (spent / est) * 100)}%` }} />
        </div>
      )}
      {!ro && (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[160px_100px_1fr_auto]">
          <DatePicker value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} clearable={false} />
          <NumberInput decimals={2} min={0.25} max={24} placeholder="Hours" value={form.hours} onChange={(v) => setForm((f) => ({ ...f, hours: v }))} />
          <Input placeholder="What did you work on?" value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          <Button icon="plus" variant="secondary" loading={busy} disabled={!form.date || !(Number(form.hours) > 0)} onClick={add}>
            Log
          </Button>
        </div>
      )}
      {task.timeLogs.length > 0 ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {task.timeLogs.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Avatar name={l.userName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-slate-800">{l.note || <span className="text-slate-400">No note</span>}</p>
                <p className="text-xs text-slate-500">
                  {l.userName} · {new Date(l.date.slice(0, 10) + 'T00:00:00').toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
              <span className="font-semibold tabular-nums">{fmtNumber(l.hours, 2)} h</span>
              {l.mine && (
                <button
                  type="button"
                  aria-label="Delete time entry"
                  className="text-slate-300 hover:text-red-600"
                  onClick={async () => {
                    try {
                      await api.delete(`/tasks/${task.id}/time/${l.id}`);
                      onChange();
                    } catch (e) {
                      toast.error(e);
                    }
                  }}
                >
                  <Icon name="trash-2" className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">No time logged yet.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- attachments
function Attachments({ task, onChange }: { task: TaskDetail; onChange: () => void }) {
  const { can } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      fd.append('entityType', 'TASK');
      fd.append('entityId', task.id);
      await api.post('/files/upload', fd);
      toast.success('Attachment uploaded');
      onChange();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <section>
      <SectionTitle
        icon="paperclip"
        title="Attachments"
        extra={
          can('files.file.upload') && (
            <>
              <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
              <Button size="sm" variant="secondary" icon="upload" loading={busy} onClick={() => input.current?.click()}>
                Upload
              </Button>
            </>
          )
        }
      />
      {task.files.length ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {task.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
              <span className="rounded-lg bg-brand-50 p-2 text-brand-600">
                <Icon name={f.mimeType.startsWith('image/') ? 'image' : f.mimeType === 'application/pdf' ? 'file-text' : 'file'} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{f.name}</p>
                <p className="text-xs text-slate-500">{fmtBytes(f.size)}</p>
              </div>
              {(f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf') && (
                <button type="button" aria-label="Preview" className="text-slate-400 hover:text-brand-600" onClick={() => previewFile({ path: `/files/${f.id}/download`, title: f.name }).catch(toast.error)}>
                  <Icon name="eye" className="h-4 w-4" />
                </button>
              )}
              <button type="button" aria-label="Download" className="text-slate-400 hover:text-brand-600" onClick={() => download(`/files/${f.id}/download`).catch(toast.error)}>
                <Icon name="download" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">No attachments.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- comments
function Comments({ task, onChange }: { task: TaskDetail; onChange: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/comments`, { body: body.trim() });
      setBody('');
      onChange();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <SectionTitle icon="messages-square" title={`Comments${task.comments.length ? ` (${task.comments.length})` : ''}`} />
      <ul className="space-y-3">
        {task.comments.map((c) => (
          <li key={c.id} className="group flex gap-3">
            <Avatar name={c.userName} size="md" />
            <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{c.userName}</p>
                <span className="text-xs text-slate-400">{fmtDateTime(c.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-sm whitespace-pre-line text-slate-700">{c.body}</p>
            </div>
            {c.mine && (
              <button
                type="button"
                aria-label="Delete comment"
                className="self-start text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"
                onClick={async () => {
                  try {
                    await api.delete(`/tasks/${task.id}/comments/${c.id}`);
                    onChange();
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              >
                <Icon name="trash-2" className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Textarea
          rows={2}
          value={body}
          maxLength={5000}
          placeholder="Write a comment... (Ctrl+Enter to send)"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
        />
        <Button icon="send" loading={busy} disabled={!body.trim()} onClick={send} className="self-end">
          Send
        </Button>
      </div>
    </section>
  );
}
