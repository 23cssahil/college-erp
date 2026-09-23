import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Alert, Badge, Button, Empty, Field, Modal, PageHeader, Select, Spinner, TextArea, TextInput } from './ui';

/* ── data loading hook ───────────────────────────────────── */
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await fn()); } catch (e: any) { setError(errMsg(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, reload: run, setData };
}

/* ── field config ────────────────────────────────────────── */
export interface FieldCfg {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'email' | 'date' | 'month' | 'time' | 'select' | 'multiselect' | 'textarea' | 'checkbox';
  options?: { value: any; label: string }[];
  optionUrl?: string;              // fetch {items:[{id,name,...}]} for select options
  optionLabelKey?: string;         // property used as visible label (default: name)
  optionValueKey?: string;         // property used as value (default: id)
  dependsOn?: string;              // filter field name: options reload when that filter changes
  required?: boolean;
  hint?: string;
  perma?: boolean;                 // hidden while editing (immutable)
  default?: any;
}

export interface Column {
  key: string;
  label: string;
  render?: (row: any) => any;
}

export interface ResourceProps {
  endpoint: string;                 // e.g. '/academic/departments'
  title: string;
  subtitle?: string;
  idKey?: string;                   // default 'id'
  columns: Column[];
  createFields?: FieldCfg[];        // omit to disable create
  editFields?: FieldCfg[];          // defaults to createFields minus perma
  canCreateKey?: string;            // permission for create (default: inferred from endpoint)
  canEditKey?: string;
  canDeleteKey?: string;
  searchable?: boolean;
  paginate?: boolean;
  filters?: FieldCfg[];             // select filters serialized into query string
  transformForm?: (row: any) => any; // row -> initial form values on edit
  rowActions?: (row: any, helpers: { reload: () => void }) => any;
  template?: (form: any) => any;     // form -> request body (both create & edit)
  extraActions?: any;
  pageSize?: number;
}

function inferModule(endpoint: string): string {
  const seg = endpoint.split('/').filter(Boolean).pop() || '';
  return seg.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // academic-years -> academicYears
}

const emptyForm = (fields: FieldCfg[]) =>
  Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? (f.default ?? false) : f.default ?? (f.type === 'multiselect' ? [] : '')]));

export function Resource(p: ResourceProps) {
  const { can } = useAuth();
  const mod = useMemo(() => inferModule(p.endpoint), [p.endpoint]);
  const mayCreate = can(p.canCreateKey || `${mod}:create`);
  const mayEdit = can(p.canEditKey || `${mod}:edit`);
  const mayDelete = can(p.canDeleteKey || `${mod}:delete`);
  const createFields = p.createFields || [];
  const editFields = p.editFields || createFields.filter((f) => !f.perma);

  const [form, setForm] = useState<any>(null);       // null = closed, {} = create
  const [editing, setEditing] = useState<any>(null); // row being edited
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [flash, setFlash] = useState('');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [fq, setFq] = useState<Record<string, string>>({});
  const [optionCache, setOptionCache] = useState<Record<string, { value: any; label: string }[]>>({});

  // resolve optionUrl selects (cache key includes the dependsOn value so child
  // option lists reload when their parent changes — parent lives in the filter
  // bar (fq) or inside the open form (form), depending on where the field renders)
  const optKey = (f: FieldCfg, src?: Record<string, string>) => {
    const s = src || fq;
    const dep = f.dependsOn ? s[f.dependsOn] : '';
    return f.dependsOn && dep ? `${f.optionUrl}?${f.dependsOn}=${dep}` : f.optionUrl!;
  };
  const optSources = useMemo(() => {
    const list: { f: FieldCfg; src: Record<string, string> }[] = [];
    for (const f of [...createFields, ...editFields]) if (f.optionUrl) list.push({ f, src: (form || {}) as Record<string, string> });
    for (const f of p.filters || []) if (f.optionUrl) list.push({ f, src: fq });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFields, editFields, p.filters, form, fq]);
  useEffect(() => {
    (async () => {
      const need = optSources.filter(({ f, src }) => !optionCache[optKey(f, src)]);
      if (!need.length) return;
      const entries = await Promise.all(need.map(async ({ f, src }) => {
        const key = optKey(f, src);
        try {
          const { data } = await api.get(key);
          const items = data.items || data.roles || data.permissions || (Array.isArray(data) ? data : []);
          return [key, items.map((i: any) => ({ value: i[f.optionValueKey || 'id'], label: i[f.optionLabelKey || 'name'] || `${i.name} (${i.code || i.id})` }))];
        } catch { return [key, []]; }
      }));
      setOptionCache((c) => ({ ...c, ...Object.fromEntries(entries) }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optSources, optionCache]);

  const pageSize = p.pageSize || 20;
  const query: any = p.paginate ? { page, limit: pageSize } : {};
  if (p.searchable && q.trim()) query.q = q.trim();
  Object.entries(fq).forEach(([k, v]) => { if (v) query[k] = v; });

  const load = useLoad<{ items: any[]; total?: number }>(async () => {
    const { data } = await api.get(p.endpoint, { params: query });
    const items = data.items || (Array.isArray(data) ? data : []);
    return { items, total: data.total };
  }, [p.endpoint, page, q, JSON.stringify(fq)]);

  const rows = load.data?.items || [];
  const total = load.data?.total ?? rows.length;
  const pages = p.paginate ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormErr('');
    try {
      let body = p.template ? p.template(form) : { ...form };
      // send empty strings as undefined (backend zod treats '' as invalid for ids/dates)
      body = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? undefined : v]));
      if (editing) {
        await api.put(`${p.endpoint}/${editing[p.idKey || 'id']}`, body);
      } else {
        const { data } = await api.post(p.endpoint, body);
        const cred = data?.credential || data?.item?.credential;
        if (cred) setFlash(`Login created — username: ${cred.username || cred.rollNo}, password: ${cred.password}`);
      }
      setForm(null); setEditing(null);
      load.reload();
    } catch (err) { setFormErr(errMsg(err)); }
    finally { setSaving(false); }
  }

  async function remove(row: any) {
    if (!confirm(`Delete ${row[p.columns[0].key] ?? row[p.idKey || 'id']}? This cannot be undone.`)) return;
    try { await api.delete(`${p.endpoint}/${row[p.idKey || 'id']}`); load.reload(); }
    catch (e) { alert(errMsg(e)); }
  }

  function openEdit(row: any) {
    const init: any = {};
    for (const f of editFields) {
      let v = row[f.name];
      if (v === undefined || v === null) {
        // allow nested lookup like course.id via transformForm override
        v = f.name.includes('.') ? f.name.split('.').reduce((o: any, k) => o?.[k], row) : '';
      }
      if (f.type === 'date' && v) v = String(v).slice(0, 10);
      if (f.type === 'month' && v) v = String(v).slice(0, 7);
      init[f.name] = v ?? (f.type === 'checkbox' ? false : f.type === 'multiselect' ? [] : '');
    }
    setEditing(row);
    setForm(p.transformForm ? { ...init, ...p.transformForm(row) } : init);
    setFormErr('');
  }

  const onFormChange = (f: FieldCfg, v: any) => setForm((s: any) => {
    const next = { ...s, [f.name]: v };
    // changing a parent field resets form fields that depend on it
    for (const g of [...createFields, ...editFields]) if (g.dependsOn === f.name) next[g.name] = '';
    return next;
  });

  const fieldInput = (f: FieldCfg, value: any, onChange: (v: any) => void, src?: Record<string, string>) => {
    const options = f.options || (f.optionUrl ? optionCache[optKey(f, src)] || [] : []);
    switch (f.type) {
      case 'select':
      case 'multiselect':
        return (
          <Select multiple={f.type === 'multiselect'} value={f.type === 'multiselect' ? undefined : value}
            onChange={(e: any) => {
              if (f.type !== 'multiselect') return onChange(e.target.value);
              onChange(Array.from(e.target.selectedOptions).map((o: any) => o.value));
            }}>
            {f.type !== 'multiselect' && <option value="">— Select —</option>}
            {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
          </Select>
        );
      case 'textarea':
        return <TextArea value={value} onChange={(e: any) => onChange(e.target.value)} required={f.required} />;
      case 'checkbox':
        return (
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-brand-600" />
        );
      case 'number':
        return <TextInput type="number" step="any" value={value} onChange={(e: any) => onChange(e.target.value)} required={f.required} />;
      default:
        return <TextInput type={f.type || 'text'} value={value} onChange={(e: any) => onChange(e.target.value)} required={f.required} />;
    }
  };

  return (
    <div>
      <PageHeader title={p.title} subtitle={p.subtitle} actions={
        <div className="flex flex-wrap items-center gap-2">
          {p.extraActions}
          {mayCreate && createFields.length > 0 && (
            <Button onClick={() => { setEditing(null); setForm(emptyForm(createFields)); setFormErr(''); }}>+ Add</Button>
          )}
        </div>
      } />

      {(flash || load.error) && <Alert kind={flash ? 'success' : 'error'}>{flash || load.error}</Alert>}

      {(p.searchable || p.filters?.length) && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {p.searchable && (
            <TextInput placeholder="Search name / roll no / code…" className="max-w-xs"
              value={q} onChange={(e: any) => { setPage(1); setQ(e.target.value); }} />
          )}
          {(p.filters || []).map((f) => {
            return (
              <div key={f.name} className="w-52">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{f.label}</div>
                {fieldInput(f, fq[f.name] || '', (v: any) => {
                  setPage(1);
                  setFq((s) => {
                    const next = { ...s, [f.name]: v };
                    // changing a parent filter clears any child filters that depend on it
                    for (const g of p.filters || []) if (g.dependsOn === f.name) next[g.name] = '';
                    return next;
                  });
                })}
              </div>
            );
          })}
        </div>
      )}

      {load.loading ? <Spinner /> : rows.length === 0 ? <Empty text="No records yet" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{p.columns.map((c) => <th key={c.key}>{c.label}</th>)}{(mayEdit || mayDelete || p.rowActions) && <th className="text-right">Actions</th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[p.idKey || 'id']}>
                  {p.columns.map((c) => (
                    <td key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>
                  ))}
                  {(mayEdit || mayDelete || p.rowActions) && (
                    <td className="whitespace-nowrap text-right">
                      {p.rowActions?.(row, { reload: load.reload })}
                      {mayEdit && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openEdit(row)}>Edit</button>}
                      {mayDelete && <button className="btn-ghost !px-2 !py-1 text-xs text-rose-600" onClick={() => remove(row)}>Delete</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.paginate && pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>{total} records · page {page}/{pages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Modal open={!!form} onClose={() => { setForm(null); setEditing(null); }} title={editing ? `Edit ${p.title.replace(/s$/, '')}` : `New ${p.title.replace(/s$/, '')}`}>
        {form && (
          <form onSubmit={save} className="space-y-4">
            {formErr && <Alert>{formErr}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(editing ? editFields : createFields).map((f) => (
                <div key={f.name} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  {f.type === 'checkbox' ? (
                    <label className="flex items-center gap-2 pt-6">
                      {fieldInput(f, form[f.name], (v) => onFormChange(f, v), form)}
                      <span className="text-sm font-medium text-slate-600">{f.label}</span>
                    </label>
                  ) : (
                    <Field label={f.label} hint={f.hint}>
                      {fieldInput(f, form[f.name], (v) => onFormChange(f, v), form)}
                    </Field>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => { setForm(null); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ── tiny css pie/donut (no chart lib) ───────────────────── */
export function Pie({ parts, size = 140 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const stops = parts.map((p) => {
    const from = (acc / total) * 360; acc += p.value;
    return `${p.color} ${from}deg ${(acc / total) * 360}deg`;
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: `conic-gradient(${stops.join(',') || '#e2e8f0 0deg 360deg'})`,
      }} className="relative shrink-0">
        <div className="absolute inset-[22%] grid place-items-center rounded-full bg-white text-sm font-bold text-slate-700">{total}</div>
      </div>
      <div className="space-y-1">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-sm" style={{ background: p.color }} />
            <span className="text-slate-600">{p.label}</span>
            <span className="font-semibold text-slate-800">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
