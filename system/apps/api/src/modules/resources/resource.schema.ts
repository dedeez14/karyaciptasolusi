import { z, ZodTypeAny } from 'zod';
import { FieldDef, ResourceDef } from './resource.types';

const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

function fieldSchema(f: FieldDef): ZodTypeAny {
  let s: ZodTypeAny;
  switch (f.type) {
    case 'number':
    case 'money':
    case 'percent':
    case 'integer': {
      let n = z.coerce.number({ error: `${f.label} must be a number` });
      if (f.type === 'integer') n = n.int();
      if (f.min !== undefined) n = n.min(f.min, `${f.label} must be at least ${f.min}`);
      if (f.max !== undefined) n = n.max(f.max, `${f.label} must be at most ${f.max}`);
      s = n;
      break;
    }
    case 'date':
    case 'datetime':
      s = z.coerce.date({ error: `${f.label} is not a valid date` });
      break;
    case 'boolean':
      s = z.boolean();
      break;
    case 'select':
      s = z.enum((f.options ?? []).map((o) => o.value) as [string, ...string[]]);
      break;
    case 'relation':
      s = f.relation && ['currencies', 'countries'].includes(f.relation.resource) ? z.string().trim().max(10) : z.uuid({ error: `${f.label} is invalid` });
      break;
    case 'tags':
      s = z.array(z.string().trim().max(50)).max(30);
      break;
    case 'email':
      s = z.email({ error: `${f.label} is not a valid email` }).max(f.max ?? 150);
      break;
    case 'url':
      s = z.url({ error: `${f.label} is not a valid URL`, protocol: /^https?$/ }).max(f.max ?? 255);
      break;
    case 'color':
      s = z.string().regex(/^#[0-9a-fA-F]{3,8}$|^[a-z]+$/, `${f.label} is not a valid color`).max(20);
      break;
    default: {
      let t = z.string().trim().max(f.max ?? 255, `${f.label} is too long`);
      // block control characters (log forging / header injection)
      t = t.regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F]*$/, `${f.label} contains invalid characters`);
      if (f.required) t = t.min(1, `${f.label} is required`);
      s = t;
    }
  }
  if (f.type === 'boolean') return s.optional();
  if (f.required) return z.preprocess((v) => (v === '' || v === null ? undefined : v), s);
  // numeric columns are NOT NULL with DB defaults -> treat empty as "not provided"
  if (['number', 'money', 'percent', 'integer'].includes(f.type)) return z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional());
  return z.preprocess(emptyToNull, s.nullable().optional());
}

/** Builds the create/update validation schemas from the resource metadata (single source of truth). */
export function buildSchemas(def: ResourceDef, writableFields: FieldDef[]) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const f of writableFields) {
    if (f.readOnly) continue;
    let s = fieldSchema(f);
    if (def.autoCode?.field === f.name) s = z.preprocess(emptyToNull, z.string().trim().max(f.max ?? 40).nullable().optional());
    shape[f.name] = s;
  }
  const create = z.object(shape).strip();
  const updateShape: Record<string, ZodTypeAny> = {};
  for (const [k, v] of Object.entries(shape)) {
    const f = writableFields.find((x) => x.name === k);
    if (f?.immutable) continue;
    updateShape[k] = v.optional();
  }
  return { create, update: z.object(updateShape).strip() };
}
