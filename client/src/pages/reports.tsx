import { useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useLoad, Pie } from '../components/Resource';
import { Badge, Button, Card, PageHeader, Select, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

/* ══════════════════════ REPORTS ══════════════════════ */
export function ReportsPage() {
  const enrollment = useLoad<any>(async () => (await api.get('/reports/enrollment')).data, []);
  const sections = useLoad(async () => (await api.get('/academic/sections')).data.items || [], []);
  const [sectionId, setSectionId] = useState('');
  const att = useLoad<any>(async () => {
    if (!sectionId) return null;
    return (await api.get('/reports/attendance-overview', { params: { sectionId } })).data;
  }, [sectionId]);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Institutional analytics across enrollment and attendance" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Enrollment by department">
          {enrollment.loading ? <Spinner /> : (
            <Pie parts={(enrollment.data?.byDepartment || []).map((x: any, i: number) => ({
              label: x.department, value: x.count, color: ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 6],
            }))} />
          )}
        </Card>

        <Card title="Attendance overview">
          <div className="mb-4">
            <Select value={sectionId} onChange={(e: any) => setSectionId(e.target.value)} className="max-w-xs">
              <option value="">— Select a section —</option>
              {(sections.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.semester?.course?.code} Sem{s.semester?.number}-{s.name}</option>)}
            </Select>
          </div>
          {att.data ? (
            <>
              <div className="mb-4 text-center">
                <div className="text-3xl font-extrabold text-slate-800">{att.data.percentage}%</div>
                <div className="text-sm text-slate-500">attendance across {att.data.total} records</div>
              </div>
              <Pie parts={[
                { label: 'Present', value: att.data.statusCounts?.PRESENT || 0, color: '#10b981' },
                { label: 'Absent', value: att.data.statusCounts?.ABSENT || 0, color: '#ef4444' },
                { label: 'Late', value: att.data.statusCounts?.LATE || 0, color: '#f59e0b' },
                { label: 'Excused', value: att.data.statusCounts?.EXCUSED || 0, color: '#94a3b8' },
              ]} />
            </>
          ) : <p className="text-sm text-slate-500">{sectionId ? 'Loading…' : 'Select a section to view its attendance report.'}</p>}
        </Card>
      </div>
    </div>
  );
}

/* ══════════════════════ AUDIT LOGS ══════════════════════ */
const actionTone: Record<string, string> = { CREATE: 'green', UPDATE: 'blue', DELETE: 'red', ASSIGN: 'violet', PUBLISH_RESULT: 'amber' };
export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const logs = useLoad<any>(async () => (await api.get('/audit-logs', { params: { page, limit: 25, ...(entity && { entity }) } })).data, [page, entity]);
  const total = logs.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Immutable trail of every privileged action" />
      <div className="mb-4 flex items-center gap-3">
        <TextInput placeholder="Filter by entity (e.g. students)" className="max-w-xs" value={entity}
          onChange={(e: any) => { setPage(1); setEntity(e.target.value); }} />
        <span className="text-sm text-slate-500">{total} entries</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {logs.loading ? <tr><td colSpan={5} className="text-center text-slate-400">Loading…</td></tr> : (logs.data?.items || []).map((l: any) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-slate-500">{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                <td>{l.user?.fullName || 'System'}</td>
                <td><Badge tone={actionTone[l.action] || 'slate'}>{l.action}</Badge></td>
                <td className="text-slate-600">{l.entity}{l.entityId ? ` · ${String(l.entityId).slice(0, 8)}` : ''}</td>
                <td className="max-w-xs truncate text-xs text-slate-400">{l.meta ? JSON.stringify(l.meta) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>page {page}/{pages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ SETTINGS ══════════════════════ */
const KNOWN: { key: string; label: string; hint?: string }[] = [
  { key: 'collegeName', label: 'College name' },
  { key: 'collegeAddress', label: 'Address' },
  { key: 'collegePhone', label: 'Contact phone' },
  { key: 'collegeEmail', label: 'Contact email' },
  { key: 'academicTerm', label: 'Current academic term' },
  { key: 'attendanceWarningPercent', label: 'Attendance warning %', hint: 'students below this are flagged' },
  { key: 'feeLateFeePercent', label: 'Fee late fee %' },
];

export function SettingsPage() {
  const { can } = useAuth();
  const mayEdit = can('settings:manage');
  const items = useLoad<any[]>(async () => (await api.get('/settings')).data.items || [], []);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (items.data) setForm(Object.fromEntries(items.data.map((s: any) => [s.key, s.value])));
  }, [items.data]);

  async function save() {
    setSaving(true); setMsg('');
    try { await api.put('/settings', { settings: form }); setMsg('Settings saved.'); items.reload(); }
    catch (e) { setMsg(errMsg(e)); } finally { setSaving(false); }
  }

  const knownKeys = KNOWN.map((k) => k.key);
  const extra = Object.keys(form).filter((k) => !knownKeys.includes(k));

  return (
    <div>
      <PageHeader title="System Settings" subtitle="Global configuration applied across the ERP" />
      <Card
        action={mayEdit && <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>}
      >
        {msg && <div className={`mb-3 rounded-lg px-4 py-2.5 text-sm ring-1 ${msg.includes('saved') ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}>{msg}</div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {KNOWN.map((k) => (
            <label key={k.key} className="block">
              <span className="label">{k.label}</span>
              <input className="input" value={form[k.key] || ''} disabled={!mayEdit}
                onChange={(e) => setForm({ ...form, [k.key]: e.target.value })} />
              {k.hint && <span className="mt-1 block text-xs text-slate-400">{k.hint}</span>}
            </label>
          ))}
          {extra.map((k) => (
            <label key={k} className="block">
              <span className="label">{k}</span>
              <input className="input" value={form[k] || ''} disabled={!mayEdit} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        {!mayEdit && <p className="mt-4 text-sm text-slate-400">You have view-only access to settings.</p>}
      </Card>
    </div>
  );
}
