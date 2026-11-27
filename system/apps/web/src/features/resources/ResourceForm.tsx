import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Drawer, Field, Icon, Spinner, toast } from '@/components/ui';
import { FieldInput, useLookups } from './FieldInput';
import type { ResourceMeta, Row } from './types';

/** Metadata driven create / edit form (drawer). */
export function ResourceForm({ meta, id, open, onClose, onSaved }: { meta: ResourceMeta; id: string | null; open: boolean; onClose: () => void; onSaved?: (row: Row) => void }) {
  const qc = useQueryClient();
  const isEdit = !!id;
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lookups = useLookups(meta.fields.filter((f) => f.type === 'lookup').map((f) => f.lookup!));
  const record = useQuery({ queryKey: ['resource', meta.key, 'one', id], queryFn: () => api.get<Row>(`/resources/${meta.key}/${id}`), enabled: open && isEdit });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (isEdit) {
      if (record.data) setValues(record.data);
    } else {
      setValues(Object.fromEntries(meta.fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default])));
    }
  }, [open, isEdit, record.data, meta.fields]);

  const sections = useMemo(() => {
    const map = new Map<string, typeof meta.fields>();
    for (const f of meta.fields) {
      if (isEdit ? false : f.readOnly) continue;
      const s = f.section ?? 'General';
      map.set(s, [...(map.get(s) ?? []), f]);
    }
    return [...map.entries()];
  }, [meta.fields, isEdit]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      for (const f of meta.fields) {
        if (f.readOnly || (isEdit && f.immutable)) continue;
        if (f.name in values) payload[f.name] = values[f.name];
      }
      return isEdit ? api.patch<Row>(`/resources/${meta.key}/${id}`, payload) : api.post<Row>(`/resources/${meta.key}`, payload);
    },
    onSuccess: (row) => {
      toast.success(`${meta.singular} ${isEdit ? 'updated' : 'created'}`);
      qc.invalidateQueries({ queryKey: ['resource', meta.key] });
      qc.invalidateQueries({ queryKey: ['options', meta.key] });
      qc.invalidateQueries({ queryKey: ['insights'] }); // purpose-built views (trees, cards, 360 pages)
      onSaved?.(row);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide={meta.fields.length > 10}
      title={`${isEdit ? 'Edit' : 'New'} ${meta.singular}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="resource-form" loading={save.isPending} icon="save">
            Save
          </Button>
        </>
      }
    >
      {isEdit && record.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <form id="resource-form" onSubmit={submit} className="space-y-6" noValidate>
          {sections.map(([section, fields]) => (
            <fieldset key={section}>
              {sections.length > 1 && <legend className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{section}</legend>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <Field
                    key={f.name}
                    label={
                      <span className="inline-flex items-center gap-1">
                        {f.label}
                        {f.encrypted && <Icon name="lock" className="h-3 w-3 text-emerald-600" />}
                      </span>
                    }
                    required={f.required && meta.autoCode !== f.name}
                    error={errors[f.name]}
                    help={f.help ?? (meta.autoCode === f.name && !isEdit ? 'Leave empty to generate automatically' : undefined)}
                    className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : undefined}
                  >
                    <FieldInput
                      field={f}
                      value={values[f.name]}
                      lookups={lookups}
                      invalid={!!errors[f.name]}
                      disabled={f.readOnly || (isEdit && f.immutable)}
                      initialLabel={values._labels?.[f.name]}
                      onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
                    />
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
        </form>
      )}
    </Drawer>
  );
}
