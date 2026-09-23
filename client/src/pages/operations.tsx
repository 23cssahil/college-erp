import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useLoad, Pie } from '../components/Resource';
import { Badge, Button, Card, Field, Modal, PageHeader, Select, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dayLabel: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat' };

/* ══════════════════════ TIMETABLE ══════════════════════ */
export function TimetablePage() {
  const { can } = useAuth();
  const mayEdit = can('timetable:manage') || can('timetable:create');
  const sections = useLoad(async () => (await api.get('/academic/sections')).data.items || [], []);
  const [sectionId, setSectionId] = useState('');
  const section = useMemo(() => (sections.data || []).find((s: any) => s.id === sectionId), [sections.data, sectionId]);

  const periods = useLoad(async () => (await api.get('/periods')).data.items || [], []);
  const slots = useLoad<any[]>(async () => {
    if (!sectionId) return [];
    return (await api.get('/timetable', { params: { sectionId } })).data.items || [];
  }, [sectionId]);
  const subjects = useLoad(async () => {
    if (!section?.semesterId) return [];
    return (await api.get('/subjects', { params: { semesterId: section.semesterId, limit: 200 } })).data.items || [];
  }, [section?.semesterId]);
  const teachers = useLoad(async () => (await api.get('/teachers', { params: { limit: 200 } })).data.items || [], []);
  const allocations = useLoad<any[]>(async () => {
    if (!sectionId) return [];
    return (await api.get('/allocations', { params: { sectionId } })).data.items || [];
  }, [sectionId]);

  const [cell, setCell] = useState<{ day: string; periodNumber: number } | null>(null);
  const [showPeriods, setShowPeriods] = useState(false);
  const grid = useMemo(() => {
    const g: Record<string, any> = {};
    for (const s of slots.data || []) g[`${s.day}-${s.periodNumber}`] = s;
    return g;
  }, [slots.data]);

  const published = section?.timetablePublished;

  return (
    <div>
      <PageHeader title="Timetable" subtitle="Assign subjects & teachers per period; publish to make visible to students"
        actions={mayEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setShowPeriods(true)}>⏰ Manage periods</Button>
            {sectionId && (
              <Button variant={published ? 'primary' : 'secondary'} disabled={!!published} onClick={async () => {
                try { await api.post('/timetable/publish', { sectionId, publish: true }); alert('Timetable published'); slots.reload(); sections.reload(); }
                catch (e) { alert(errMsg(e)); }
              }}>{published ? 'Published ✓' : 'Publish timetable'}</Button>
            )}
          </div>
        )} />

      <Card className="mb-4">
        <Field label="Section">
          <Select value={sectionId} onChange={(e: any) => setSectionId(e.target.value)} className="max-w-md">
            <option value="">— Select a section —</option>
            {(sections.data || []).map((s: any) => (
              <option key={s.id} value={s.id}>{s.semester?.course?.code} · Sem {s.semester?.number} · Section {s.name}</option>
            ))}
          </Select>
        </Field>
      </Card>

      {!sectionId ? <Card><p className="text-sm text-slate-500">Choose a section to edit its timetable.</p></Card>
        : slots.loading ? <Spinner />
        : !(periods.data || []).length ? (
        <Card><p className="text-sm text-slate-500">
          No periods defined yet — the timetable grid needs a bell schedule first.
          {' '}{mayEdit && <button className="font-semibold text-brand-600 underline" onClick={() => setShowPeriods(true)}>Add periods →</button>}
        </p></Card>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Period</th>{DAYS.map((d) => <th key={d}>{dayLabel[d]}</th>)}</tr></thead>
            <tbody>
              {(periods.data || []).map((p: any) => (
                <tr key={p.number}>
                  <td className="whitespace-nowrap font-semibold text-slate-600">
                    P{p.number} <span className="text-xs font-normal text-slate-400">{p.startTime}–{p.endTime}</span>
                    {p.breakAfter && <Badge tone="amber">break</Badge>}
                  </td>
                  {DAYS.map((d) => {
                    const s = grid[`${d}-${p.number}`];
                    return (
                      <td key={d} className="align-top">
                        <button disabled={!mayEdit} onClick={() => setCell({ day: d, periodNumber: p.number })}
                          className={`w-full rounded-lg p-2 text-left text-xs transition ${s ? 'bg-brand-50 hover:bg-brand-100' : 'bg-slate-50 hover:bg-slate-100'} ${!mayEdit && 'cursor-default'}`}>
                          {s ? (
                            <>
                              <div className="font-semibold text-brand-700">{s.subject?.name || 'Free'}</div>
                              {s.subject?.code && <div className="text-[10px] text-slate-400">{s.subject.code}</div>}
                              {s.teacher && <div className="mt-0.5 text-slate-500">👤 {s.teacher.user?.fullName}</div>}
                              {s.room && <div className="text-slate-400">🚪 {s.room}</div>}
                            </>
                          ) : <span className="text-slate-300">+ assign</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cell && (
        <SlotModal
          sectionId={sectionId} day={cell.day} periodNumber={cell.periodNumber}
          slot={grid[`${cell.day}-${cell.periodNumber}`]}
          subjects={subjects.data || []} teachers={teachers.data || []} allocations={allocations.data || []}
          onClose={() => setCell(null)} onSaved={() => { setCell(null); slots.reload(); }}
        />
      )}

      {showPeriods && (
        <PeriodsModal
          periods={periods.data || []}
          onClose={() => setShowPeriods(false)}
          onSaved={() => { setShowPeriods(false); periods.reload(); }}
        />
      )}
    </div>
  );
}

/* ── bell-schedule editor: each period becomes a row in the grid ── */
function PeriodsModal({ periods, onClose, onSaved }: any) {
  const [rows, setRows] = useState<any[]>(periods.map((p: any) => ({
    number: p.number, startTime: p.startTime, endTime: p.endTime, breakAfter: !!p.breakAfter,
  })));
  const [removed, setRemoved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function upd(i: number, patch: any) { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function addRow() {
    const next = rows.reduce((m, r) => Math.max(m, r.number), 0) + 1;
    setRows((r) => [...r, { number: next, startTime: '09:00', endTime: '09:55', breakAfter: false, isNew: true }]);
  }
  function removeRow(i: number) {
    const row = rows[i];
    if (!row.isNew) setRemoved((d) => [...d, row.number]);
    setRows((r) => r.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true); setErr('');
    try {
      for (const n of removed) await api.delete(`/periods/${n}`);
      for (const r of rows) {
        if (!r.startTime || !r.endTime) throw new Error(`Period ${r.number}: start and end time are required`);
        await api.post('/periods', { number: r.number, startTime: r.startTime, endTime: r.endTime, breakAfter: r.breakAfter });
      }
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Manage periods (bell schedule)">
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        <p className="text-xs text-slate-500">Each period becomes a row in the timetable grid. Times are 24-hour.</p>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-9 text-sm font-semibold text-slate-600">P{r.number}</span>
            <TextInput type="time" value={r.startTime} onChange={(e: any) => upd(i, { startTime: e.target.value })} className="w-32" />
            <span className="text-slate-400">→</span>
            <TextInput type="time" value={r.endTime} onChange={(e: any) => upd(i, { endTime: e.target.value })} className="w-32" />
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={r.breakAfter} onChange={(e: any) => upd(i, { breakAfter: e.target.checked })} />
              break after
            </label>
            <button type="button" className="ml-auto text-xs text-rose-500 hover:underline" onClick={() => removeRow(i)}>remove</button>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-400">No periods yet.</p>}
        <div className="flex items-center justify-between pt-2">
          <Button variant="secondary" onClick={addRow}>+ Add period</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save periods'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SlotModal({ sectionId, day, periodNumber, slot, subjects, teachers, allocations, onClose, onSaved }: any) {
  const [f, setF] = useState({ subjectId: slot?.subject?.id || '', teacherId: slot?.teacher?.id || '', room: slot?.room || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // When a subject is picked, offer only teachers allocated to it for this section;
  // auto-select when there is exactly one.
  const allocated = f.subjectId ? (allocations || []).filter((a: any) => a.subject?.id === f.subjectId) : [];
  const teacherOpts = f.subjectId ? (teachers || []).filter((t: any) => allocated.some((a: any) => a.teacher?.id === t.id)) : (teachers || []);

  function pickSubject(id: string) {
    const next = (allocations || []).filter((a: any) => a.subject?.id === id);
    setF((s) => ({ ...s, subjectId: id, teacherId: next.length === 1 ? next[0]?.teacher?.id || s.teacherId : s.teacherId }));
  }

  async function save() {
    setBusy(true); setErr('');
    try {
      await api.post('/timetable/slot', { sectionId, day, periodNumber, subjectId: f.subjectId || null, teacherId: f.teacherId || null, room: f.room || undefined });
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function clear() {
    if (!slot) return onClose();
    try { await api.delete(`/timetable/slot/${slot.id}`); onSaved(); } catch (e) { alert(errMsg(e)); }
  }

  return (
    <Modal open onClose={onClose} title={`${dayLabel[day]} · Period ${periodNumber}`}>
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        <Field label="Subject">
          <Select value={f.subjectId} onChange={(e: any) => pickSubject(e.target.value)}>
            <option value="">— Free / break —</option>
            {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Teacher" hint={f.subjectId ? 'Only teachers allocated to this subject & section are listed' : undefined}>
          <Select value={f.teacherId} onChange={(e: any) => setF({ ...f, teacherId: e.target.value })}>
            <option value="">— Any —</option>
            {teacherOpts.map((t: any) => <option key={t.id} value={t.id}>{t.user?.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Room"><TextInput value={f.room} onChange={(e: any) => setF({ ...f, room: e.target.value })} /></Field>
        <div className="flex justify-between">
          <Button variant="danger" onClick={clear}>{slot ? 'Clear cell' : 'Cancel'}</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save slot'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════ ATTENDANCE ══════════════════════ */
export function AttendancePage() {
  const { can } = useAuth();
  const mayMark = can('attendance:create') || can('attendance:manage');
  const isStudent = can('students:view') === false; // students only see their own summary
  const sections = useLoad(async () => (await api.get('/academic/sections')).data.items || [], []);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [periodNumber, setPeriodNumber] = useState(1);
  const periods = useLoad(async () => (await api.get('/periods')).data.items || [], []);

  const roster = useLoad<any[]>(async () => {
    if (!sectionId) return [];
    return (await api.get('/attendance/roster', { params: { sectionId } })).data.items || [];
  }, [sectionId]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const r of roster.data || []) init[r.id] = 'PRESENT';
    setMarks(init);
  }, [roster.data]);

  const summary = useLoad<any>(async () => {
    if (!sectionId) return null;
    return (await api.get('/attendance/summary', { params: { sectionId } })).data;
  }, [sectionId]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit() {
    setBusy(true); setMsg('');
    try {
      const records = Object.entries(marks).map(([studentId, status]) => ({ studentId, status }));
      const { data } = await api.post('/attendance/mark', { sectionId, date, periodNumber, records });
      setMsg(`Saved attendance for ${data.marked ?? records.length} students.`);
      summary.reload();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }

  // Students/parents can't access the section-wide register; their own
  // attendance is summarised on the dashboard.
  if (!mayMark) {
    return (
      <div>
        <PageHeader title="Attendance" subtitle="Your attendance record" />
        <Card>
          <p className="text-sm text-slate-600">Your attendance percentage is shown on your dashboard. Contact your subject teacher or coordinator if you believe a record is incorrect.</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Daily attendance register and section-wise summary" />
      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Section">
            <Select value={sectionId} onChange={(e: any) => setSectionId(e.target.value)}>
              <option value="">— Select —</option>
              {(sections.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.semester?.course?.code} Sem{s.semester?.number}-{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Date"><TextInput type="date" value={date} onChange={(e: any) => setDate(e.target.value)} /></Field>
          <Field label="Period">
            <Select value={periodNumber} onChange={(e: any) => setPeriodNumber(Number(e.target.value))}>
              {(periods.data || []).map((p: any) => <option key={p.number} value={p.number}>P{p.number}</option>)}
            </Select>
          </Field>
          {mayMark && <div className="flex items-end"><Button className="w-full" disabled={!sectionId || busy} onClick={submit}>{busy ? 'Saving…' : 'Mark attendance'}</Button></div>}
        </div>
      </Card>

      {msg && <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ring-1 ${msg.startsWith('Saved') ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}>{msg}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {!sectionId ? <Card><p className="text-sm text-slate-500">Select a section to load its roster.</p></Card>
            : roster.loading ? <Spinner /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Roll No</th><th>Student</th><th>Status</th></tr></thead>
                <tbody>
                  {(roster.data || []).map((r: any) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.rollNo}</td>
                      <td>{r.user?.fullName}</td>
                      <td>
                        <div className="flex gap-1">
                          {['PRESENT', 'ABSENT', 'LATE'].map((st) => (
                            <button key={st} disabled={!mayMark} onClick={() => setMarks((m) => ({ ...m, [r.id]: st }))}
                              className={`rounded px-2 py-1 text-xs font-semibold ${marks[r.id] === st ? statusActive(st) : 'bg-slate-100 text-slate-500'} ${!mayMark && 'cursor-default'}`}>
                              {st[0]}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Card title="Section summary" className="h-fit">
          {summary.data ? (
            <Pie parts={[
              { label: 'Present', value: summary.data.statusCounts?.PRESENT || 0, color: '#10b981' },
              { label: 'Absent', value: summary.data.statusCounts?.ABSENT || 0, color: '#ef4444' },
              { label: 'Late', value: summary.data.statusCounts?.LATE || 0, color: '#f59e0b' },
            ]} />
          ) : <p className="text-sm text-slate-500">{sectionId ? 'No records yet' : 'Select a section'}</p>}
          {summary.data?.percentage != null && (
            <div className="mt-4 text-center">
              <div className="text-3xl font-extrabold text-slate-800">{summary.data.percentage}%</div>
              <div className="text-sm text-slate-500">overall attendance</div>
            </div>
          )}
        </Card>
      </div>
      {isStudent && null}
    </div>
  );
}

function statusActive(st: string) {
  return st === 'PRESENT' ? 'bg-emerald-500 text-white' : st === 'ABSENT' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-white';
}
