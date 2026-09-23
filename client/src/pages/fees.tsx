import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { Resource, useLoad, FieldCfg } from '../components/Resource';
import { Badge, Button, Card, Field, Modal, PageHeader, Select, StatCard, TextInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const COURSE: FieldCfg = { name: 'courseId', label: 'Course (optional)', type: 'select', optionUrl: '/academic/courses' };
const inr = (n: number) => '₹' + (n || 0).toLocaleString('en-IN');
const invTone: Record<string, string> = { PAID: 'green', PARTIALLY_PAID: 'amber', ISSUED: 'blue', OVERDUE: 'red', CANCELLED: 'slate' };

export function FeesPage() {
  const { can } = useAuth();
  const mayCollect = can('fees:create') || can('fees:manage');
  const [tab, setTab] = useState<'invoices' | 'structures'>('invoices');
  const [pay, setPay] = useState<any>(null);
  const [genOpen, setGenOpen] = useState(false);
  const dues = useLoad<any>(async () => (mayCollect ? (await api.get('/fees/dues')).data : null), [tab, mayCollect]);

  return (
    <div>
      <PageHeader title="Fees" subtitle="Fee structures, invoice generation and payment collection"
        actions={<div className="flex gap-2">
          {mayCollect && tab === 'invoices' && <Button onClick={() => setGenOpen(true)}>Generate invoices</Button>}
        </div>} />

      {mayCollect && !!dues.data?.totals && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total billed" value={inr(dues.data.totals.billed)} tone="info" />
          <StatCard label="Collected" value={inr(dues.data.totals.paid)} tone="good" />
          <StatCard label="Outstanding" value={inr(dues.data.totals.due)} tone="warn" />
          <StatCard label="Unpaid invoices" value={dues.data.count} tone={dues.data.count ? 'bad' : 'good'} />
        </div>
      )}

      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {(['invoices', 'structures'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 font-semibold capitalize ${tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>{t}</button>
        ))}
      </div>

      {tab === 'invoices' ? (
        <Resource
          endpoint="/fees/invoices" title="Fee invoices" paginate pageSize={15} canDeleteKey="" searchable={false}
          filters={[{ name: 'status', label: 'Status', type: 'select', options: [
            { value: 'ISSUED', label: 'Issued' }, { value: 'PARTIALLY_PAID', label: 'Partially paid' }, { value: 'PAID', label: 'Paid' }, { value: 'OVERDUE', label: 'Overdue' },
          ] }]}
          columns={[
            { key: 'student', label: 'Student', render: (r) => <div><div className="font-medium">{r.student?.user?.fullName}</div><div className="text-xs text-slate-400">{r.student?.rollNo}</div></div> },
            { key: 'title', label: 'Title' },
            { key: 'totalAmount', label: 'Total', render: (r) => inr(r.totalAmount) },
            { key: 'paidAmount', label: 'Paid', render: (r) => inr(r.paidAmount) },
            { key: 'due', label: 'Balance', render: (r) => <span className="font-semibold">{inr(r.totalAmount - r.paidAmount)}</span> },
            { key: 'dueDate', label: 'Due date', render: (r) => r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-IN') : '—' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={invTone[r.status] || 'slate'}>{r.status.replace('_', ' ')}</Badge> },
          ]}
          rowActions={(row, { reload }) => (
            row.status !== 'PAID' && row.status !== 'CANCELLED' && can('fees:create')
              ? <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPay({ row, reload })}>Collect payment</button>
              : null
          )}
        />
      ) : (
        <Resource
          endpoint="/fees/structures" title="Fee structures" subtitle="Recurring & one-time fee heads" canEditKey="" canDeleteKey="fees:delete"
          columns={[
            { key: 'name', label: 'Head' },
            { key: 'amount', label: 'Amount', render: (r) => inr(r.amount) },
            { key: 'course', label: 'Course', render: (r) => r.course?.name || 'All' },
            { key: 'semester', label: 'Sem', render: (r) => r.semester?.number ?? '—' },
            { key: 'dueDayOfMonth', label: 'Due day' },
            { key: 'isMandatory', label: 'Type', render: (r) => <Badge tone={r.isMandatory ? 'red' : 'slate'}>{r.isMandatory ? 'Mandatory' : 'Optional'}</Badge> },
          ]}
          createFields={[
            { name: 'name', label: 'Fee head (e.g. Tuition Fee)', required: true },
            { name: 'amount', label: 'Amount', type: 'number', required: true },
            COURSE,
            { name: 'dueDayOfMonth', label: 'Due day of month (1-28)', type: 'number', default: 10 },
            { name: 'isMandatory', label: 'Mandatory', type: 'checkbox', default: true },
          ]}
        />
      )}

      {pay && <PayModal pay={pay} onClose={() => setPay(null)} />}
      {genOpen && <GenerateModal onClose={() => setGenOpen(false)} onDone={() => { setGenOpen(false); dues.reload(); }} />}
    </div>
  );
}

function PayModal({ pay, onClose }: any) {
  const { row, reload } = pay;
  const remaining = row.totalAmount - row.paidAmount;
  const [f, setF] = useState({ amount: String(remaining), method: 'CASH', txnRef: '', remarks: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { await api.post(`/fees/invoices/${row.id}/pay`, { ...f, amount: Number(f.amount) }); reload(); onClose(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Collect payment · ${row.student?.rollNo}`}>
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        <p className="text-sm text-slate-500">{row.title} · Balance <b className="text-slate-700">{inr(remaining)}</b></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><TextInput type="number" value={f.amount} onChange={(e: any) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Method"><Select value={f.method} onChange={(e: any) => setF({ ...f, method: e.target.value })}>
            {['CASH', 'UPI', 'CARD', 'NETBANKING', 'CHEQUE', 'DD'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
        </div>
        <Field label="Transaction ref"><TextInput value={f.txnRef} onChange={(e: any) => setF({ ...f, txnRef: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !Number(f.amount)}>{busy ? 'Saving…' : 'Record payment'}</Button></div>
      </div>
    </Modal>
  );
}

function GenerateModal({ onClose, onDone }: any) {
  const structures = useLoad(async () => (await api.get('/fees/structures')).data.items || [], []);
  const sections = useLoad(async () => (await api.get('/academic/sections')).data.items || [], []);
  const [f, setF] = useState({ feeStructureId: '', sectionId: '', dueDate: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [out, setOut] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { const { data } = await api.post('/fees/invoices/generate', f); setOut(`${data.created} invoice(s) generated.`); setTimeout(onDone, 800); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Generate fee invoices">
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        {out && <div className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">{out}</div>}
        <Field label="Fee structure">
          <Select value={f.feeStructureId} onChange={(e: any) => setF({ ...f, feeStructureId: e.target.value })}>
            <option value="">— Select —</option>
            {(structures.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.name} · {inr(s.amount)}</option>)}
          </Select>
        </Field>
        <Field label="Section">
          <Select value={f.sectionId} onChange={(e: any) => setF({ ...f, sectionId: e.target.value })}>
            <option value="">— Select —</option>
            {(sections.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.semester?.course?.code} Sem{s.semester?.number}-{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Due date"><TextInput type="date" value={f.dueDate} onChange={(e: any) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !f.feeStructureId || !f.sectionId || !f.dueDate}>{busy ? 'Generating…' : 'Generate'}</Button></div>
      </div>
    </Modal>
  );
}
