import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useLoad } from '../components/Resource';
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const examTypes = ['INTERNAL', 'MID_SEM', 'FINAL_SEM', 'SUPPLEMENTARY', 'PRACTICAL'];
const statusTone: Record<string, string> = { SCHEDULED: 'slate', ONGOING: 'amber', COMPLETED: 'blue', RESULT_PUBLISHED: 'green' };

export function ExamsPage() {
  const { can } = useAuth();
  const mayManage = can('exams:manage') || can('exams:create');
  const mayMarks = can('marks:create') || can('marks:edit') || can('marks:manage');
  const mayPublish = can('results:manage') || can('results:edit');

  const exams = useLoad<any[]>(async () => (await api.get('/exams')).data.items || [], []);
  const [selected, setSelected] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [showSubjects, setShowSubjects] = useState(false);
  const [marksFor, setMarksFor] = useState<any>(null);
  const [resultsOpen, setResultsOpen] = useState(false);

  const exam = useMemo(() => (exams.data || []).find((e) => e.id === selected), [exams.data, selected]);
  const subjects = useLoad<any[]>(async () => {
    if (!selected) return [];
    return (await api.get(`/exams/${selected}/subjects`)).data.items || [];
  }, [selected]);

  return (
    <div>
      <PageHeader title="Exams & Results" subtitle="Schedule exams, add subjects, enter marks and publish results"
        actions={mayManage && <Button onClick={() => setShowCreate(true)}>+ New exam</Button>} />

      <Card className="mb-4">
        <div className="table-wrap !shadow-none !ring-0">
          <table className="data">
            <thead><tr><th>Exam</th><th>Type</th><th>Window</th><th>Subjects</th><th>Status</th></tr></thead>
            <tbody>
              {(exams.data || []).map((e) => (
                <tr key={e.id} className={selected === e.id ? 'bg-brand-50' : 'cursor-pointer'} onClick={() => setSelected(e.id)}>
                  <td className="font-medium text-slate-700">{e.name}</td>
                  <td>{e.type.replace('_', ' ')}</td>
                  <td className="text-slate-500">{new Date(e.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}–{new Date(e.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                  <td>{e._count?.subjects ?? 0}</td>
                  <td><Badge tone={statusTone[e.status] || 'slate'}>{e.status.replace('_', ' ')}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {exam && (
        <Card title={exam.name} action={
          <div className="flex flex-wrap gap-2">
            {mayManage && <Button variant="secondary" onClick={() => setShowSubjects(true)}>+ Add subject</Button>}
            {mayPublish && (
              <Button variant={exam.status === 'RESULT_PUBLISHED' ? 'secondary' : 'primary'} onClick={async () => {
                const publish = exam.status !== 'RESULT_PUBLISHED';
                if (!confirm(`${publish ? 'Publish' : 'Unpublish'} all results for this exam?`)) return;
                try { await api.post(`/exams/${exam.id}/publish`, { publish }); exams.reload(); } catch (e) { alert(errMsg(e)); }
              }}>{exam.status === 'RESULT_PUBLISHED' ? 'Unpublish results' : 'Publish results'}</Button>
            )}
            {can('results:view') && <Button variant="secondary" onClick={() => setResultsOpen(true)}>View results</Button>}
          </div>
        }>
          {subjects.loading ? <Spinner /> : (subjects.data || []).length === 0
            ? <Empty text="No subjects added yet" />
            : (
            <div className="table-wrap !shadow-none !ring-0">
              <table className="data">
                <thead><tr><th>Subject</th><th>Code</th><th>Max</th><th>Pass</th><th>Entered</th><th></th></tr></thead>
                <tbody>
                  {subjects.data!.map((s: any) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.subject?.name}</td>
                      <td className="text-slate-500">{s.subject?.code}</td>
                      <td>{s.maxMarks}</td>
                      <td>{s.passMarks}</td>
                      <td>{s._count?.results ?? 0}</td>
                      <td className="text-right">
                        {mayMarks && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setMarksFor(s)}>Enter marks</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {showCreate && <CreateExam onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); exams.reload(); }} />}
      {showSubjects && exam && <AddSubject exam={exam} onClose={() => setShowSubjects(false)} onDone={() => { setShowSubjects(false); subjects.reload(); exams.reload(); }} />}
      {marksFor && exam && <MarksModal examSubject={marksFor} onClose={() => setMarksFor(null)} onDone={() => { setMarksFor(null); subjects.reload(); }} />}
      {resultsOpen && exam && <ResultsModal exam={exam} onClose={() => setResultsOpen(false)} />}
    </div>
  );
}

function CreateExam({ onClose, onDone }: any) {
  const years = useLoad(async () => (await api.get('/academic/academic-years')).data.items || [], []);
  const active = (years.data || []).find((y: any) => y.isActive) || (years.data || [])[0];
  const [f, setF] = useState({ name: '', type: 'MID_SEM', academicYearId: active?.id || '', startDate: '', endDate: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { await api.post('/exams', f); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New exam">
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        <Field label="Name"><TextInput value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} placeholder="Mid Semester I – 2026-27" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.type} onChange={(e: any) => setF({ ...f, type: e.target.value })}>{examTypes.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Academic year"><Select value={f.academicYearId} onChange={(e: any) => setF({ ...f, academicYearId: e.target.value })}>
            <option value="">—</option>{(years.data || []).map((y: any) => <option key={y.id} value={y.id}>{y.label}</option>)}</Select></Field>
          <Field label="Start date"><TextInput type="date" value={f.startDate} onChange={(e: any) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="End date"><TextInput type="date" value={f.endDate} onChange={(e: any) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !f.name || !f.academicYearId || !f.startDate}>{busy ? 'Creating…' : 'Create'}</Button></div>
      </div>
    </Modal>
  );
}

function AddSubject({ exam, onClose, onDone }: any) {
  const subjects = useLoad(async () => (await api.get('/subjects', { params: { limit: 300 } })).data.items || [], []);
  const [f, setF] = useState({ subjectId: '', maxMarks: 100, passMarks: 40, weightage: 100, date: exam.startDate?.slice(0, 10) || '', startTime: '09:00', endTime: '12:00' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { await api.post(`/exams/${exam.id}/subjects`, f); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add subject to exam">
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        <Field label="Subject">
          <Select value={f.subjectId} onChange={(e: any) => setF({ ...f, subjectId: e.target.value })}>
            <option value="">— Select —</option>
            {(subjects.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max marks"><TextInput type="number" value={f.maxMarks} onChange={(e: any) => setF({ ...f, maxMarks: Number(e.target.value) })} /></Field>
          <Field label="Pass marks"><TextInput type="number" value={f.passMarks} onChange={(e: any) => setF({ ...f, passMarks: Number(e.target.value) })} /></Field>
          <Field label="Weightage"><TextInput type="number" value={f.weightage} onChange={(e: any) => setF({ ...f, weightage: Number(e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><TextInput type="date" value={f.date} onChange={(e: any) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Start"><TextInput type="time" value={f.startTime} onChange={(e: any) => setF({ ...f, startTime: e.target.value })} /></Field>
          <Field label="End"><TextInput type="time" value={f.endTime} onChange={(e: any) => setF({ ...f, endTime: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !f.subjectId}>{busy ? 'Adding…' : 'Add'}</Button></div>
      </div>
    </Modal>
  );
}

function MarksModal({ examSubject, onClose, onDone }: any) {
  const roster = useLoad<any>(async () => (await api.get(`/exams/roster/${examSubject.id}`)).data, [examSubject.id]);
  const [entries, setEntries] = useState<Record<string, { marks: string; absent: boolean }>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');

  const students = roster.data?.students || [];
  const initedRef = useRef('');
  useEffect(() => {
    if (students.length && initedRef.current !== examSubject.id) {
      initedRef.current = examSubject.id;
      const init: Record<string, { marks: string; absent: boolean }> = {};
      for (const s of students) {
        const r = s.results?.[0];
        init[s.id] = { marks: r?.marksObtained != null ? String(r.marksObtained) : '', absent: r?.status === 'ABSENT' };
      }
      setEntries(init);
    }
  }, [students, examSubject.id]);

  async function save() {
    setBusy(true); setErr(''); setOk('');
    try {
      const payload = Object.entries(entries).map(([studentId, v]) => ({ studentId, marks: v.absent || v.marks === '' ? null : Number(v.marks), absent: v.absent }));
      await api.post('/exams/marks', { examSubjectId: examSubject.id, entries: payload });
      setOk(`Saved ${payload.length} marks.`);
      setTimeout(onDone, 700);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Marks · ${examSubject.subject?.name}`} wide>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        {ok && <div className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">{ok}</div>}
        <p className="text-sm text-slate-500">Max {examSubject.maxMarks} · Pass {examSubject.passMarks}</p>
        {roster.loading ? <Spinner /> : (
          <div className="max-h-[50vh] overflow-y-auto">
            <table className="data">
              <thead><tr><th>Roll No</th><th>Student</th><th>Marks</th><th>Absent</th></tr></thead>
              <tbody>
                {students.map((s: any) => {
                  const e = entries[s.id] || { marks: '', absent: false };
                  return (
                    <tr key={s.id}>
                      <td className="font-medium">{s.rollNo}</td>
                      <td>{s.user?.fullName}</td>
                      <td>
                        <TextInput type="number" className="!w-24" disabled={e.absent} value={e.marks}
                          onChange={(ev: any) => setEntries((x) => ({ ...x, [s.id]: { ...e, marks: ev.target.value } }))} />
                      </td>
                      <td>
                        <input type="checkbox" className="h-4 w-4 accent-rose-600" checked={e.absent}
                          onChange={(ev) => setEntries((x) => ({ ...x, [s.id]: { ...e, absent: ev.target.checked } }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={save} disabled={busy || !students.length}>{busy ? 'Saving…' : 'Save marks'}</Button></div>
      </div>
    </Modal>
  );
}

function ResultsModal({ exam, onClose }: any) {
  const res = useLoad<any>(async () => (await api.get('/exams/view/results', { params: { examId: exam.id } })).data, [exam.id]);
  const rows = res.data?.rows || [];
  const subjectCodes: string[] = rows[0] ? Object.keys(rows[0].marks || {}) : [];
  return (
    <Modal open onClose={onClose} title={`Results · ${exam.name}`} wide>
      {res.loading ? <Spinner /> : rows.length === 0 ? <Empty text="No marks entered yet" /> : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="data">
            <thead><tr><th>Roll No</th><th>Student</th><th>Sec</th>{subjectCodes.map((c) => <th key={c}>{c}</th>)}<th>Total</th><th>%</th></tr></thead>
            <tbody>
              {rows.map((r: any) => {
                const pct = r.max ? Math.round((r.total / r.max) * 1000) / 10 : 0;
                return (
                  <tr key={r.studentId}>
                    <td className="font-medium">{r.rollNo}</td>
                    <td>{r.fullName}</td>
                    <td>{r.section || '—'}</td>
                    {subjectCodes.map((c) => {
                      const m = r.marks[c];
                      return <td key={c} className={m?.status === 'FAIL' ? 'text-rose-600' : m?.status === 'ABSENT' ? 'text-slate-400' : ''}>
                        {m ? (m.obtained == null ? `A/${m.max}` : `${m.obtained}/${m.max}`) : '—'}
                      </td>;
                    })}
                    <td className="font-semibold">{r.total}/{r.max}</td>
                    <td className={pct >= 75 ? 'text-emerald-600' : pct >= 40 ? 'text-brand-600' : 'text-rose-600'}>{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
