import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { Resource, useLoad, FieldCfg } from '../components/Resource';
import { Badge, Button, Card, Field, PageHeader, Select, TextInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const priTone: Record<string, string> = { URGENT: 'red', HIGH: 'amber', NORMAL: 'blue' };

/* ══════════════════════ NOTICES ══════════════════════ */
export function NoticesPage() {
  const { user } = useAuth();
  return (
    <Resource
      endpoint="/notices" title="Notices" subtitle="Broadcast announcements; visible per target audience"
      paginate={false} canEditKey="" canDeleteKey="notices:delete"
      columns={[
        { key: 'title', label: 'Title', render: (r) => (
          <div><div className="font-semibold text-slate-700">{r.title}</div><div className="text-xs text-slate-400">{r.body?.slice(0, 90)}</div></div>
        ) },
        { key: 'priority', label: 'Priority', render: (r) => <Badge tone={priTone[r.priority]}>{r.priority}</Badge> },
        { key: 'audience', label: 'Audience', render: (r) => (
          <div className="flex flex-wrap gap-1">
            {(r.roles || []).map((x: any) => <Badge key={x.id} tone="slate">{x.label || x.name}</Badge>)}
            {!(r.roles || []).length && <span className="text-xs text-slate-400">Everyone</span>}
          </div>
        ) },
        { key: 'publishAt', label: 'Published', render: (r) => new Date(r.publishAt).toLocaleDateString('en-IN') },
        { key: 'author', label: 'By', render: (r) => r.author?.fullName || '—' },
      ]}
      createFields={[
        { name: 'title', label: 'Title', required: true },
        { name: 'body', label: 'Message', type: 'textarea', required: true },
        { name: 'priority', label: 'Priority', type: 'select', default: 'NORMAL', options: [
          { value: 'NORMAL', label: 'Normal' }, { value: 'HIGH', label: 'High' }, { value: 'URGENT', label: 'Urgent' } ] },
        { name: 'publishAt', label: 'Publish date', type: 'date' },
        { name: 'expiryAt', label: 'Expiry date (optional)', type: 'date' },
        { name: 'roleIds', label: 'Target roles (empty = all)', type: 'multiselect', optionUrl: '/roles', optionLabelKey: 'label', optionValueKey: 'id' },
        { name: 'departmentIds', label: 'Target departments', type: 'multiselect', optionUrl: '/academic/departments' },
        { name: 'sectionIds', label: 'Target sections', type: 'multiselect', optionUrl: '/academic/sections' },
      ]}
      template={(form) => ({
        ...form,
        roleIds: (form.roleIds || []).map(Number),
        departmentIds: form.departmentIds || [],
        sectionIds: form.sectionIds || [],
        courseIds: [],
      })}
      rowActions={(row) => (
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => {
          try { await api.post(`/notices/${row.id}/read`); } catch { /* students only */ }
        }} title="Mark read">👁</button>
      )}
      extraActions={null}
    />
  );
}

/* ══════════════════════ DOCUMENTS ══════════════════════ */
export function DocumentsPage() {
  const { can } = useAuth();
  const mayUpload = can('documents:create') || can('documents:manage');
  const list = useLoad<any[]>(async () => (await api.get('/documents')).data.items || [], []);
  const roles = useLoad<any[]>(async () => (await api.get('/roles')).data.roles || [], []);
  const [form, setForm] = useState({ title: '', category: 'GENERAL', roleIds: [] as string[] });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setErr('Choose a file first');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', form.title || file.name);
      fd.append('category', form.category);
      fd.append('roleIds', JSON.stringify(form.roleIds.map(Number)));
      await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFile(null); setForm({ title: '', category: 'GENERAL', roleIds: [] });
      list.reload();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Documents" subtitle="Circulars, forms & notices repository (role-scoped)" />
      {mayUpload && (
        <Card className="mb-5">
          <form onSubmit={upload} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {err && <div className="sm:col-span-4 rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
            <Field label="File"><input type="file" required className="input" onChange={(e: any) => setFile(e.target.files?.[0] || null)} /></Field>
            <Field label="Title"><TextInput value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} placeholder="optional" /></Field>
            <Field label="Category">
              <Select value={form.category} onChange={(e: any) => setForm({ ...form, category: e.target.value })}>
                {['GENERAL', 'CIRCULAR', 'FORM', 'SYLLABUS', 'RESULT', 'POLICY'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Visible to" hint="empty = all">
              <Select multiple value={form.roleIds} onChange={(e: any) => setForm({ ...form, roleIds: Array.from(e.target.selectedOptions).map((o: any) => o.value) })}>
                {(roles.data || []).map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-4"><Button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload document'}</Button></div>
          </form>
        </Card>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Title</th><th>Category</th><th>File</th><th>Size</th><th>Visible to</th><th>Uploaded</th></tr></thead>
          <tbody>
            {list.loading ? <tr><td colSpan={6} className="text-center text-slate-400">Loading…</td></tr> : (list.data || []).map((d: any) => (
              <tr key={d.id}>
                <td className="font-medium">{d.title}</td>
                <td><Badge tone="slate">{d.category}</Badge></td>
                <td><a href={d.filePath} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{d.fileName}</a></td>
                <td>{d.sizeKB} KB</td>
                <td className="text-xs text-slate-500">{(d.rolesVisible || []).map((r: any) => r.name).join(', ') || 'Everyone'}</td>
                <td className="text-slate-500">{new Date(d.createdAt).toLocaleDateString('en-IN')} · {d.uploader?.fullName}</td>
                {mayUpload && <td className="text-right"><button className="btn-ghost !px-2 !py-1 text-xs text-rose-600" onClick={async () => {
                  if (!confirm('Delete this document?')) return;
                  try { await api.delete(`/documents/${d.id}`); list.reload(); } catch (e) { alert(errMsg(e)); }
                }}>Delete</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
