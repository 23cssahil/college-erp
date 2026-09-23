import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { Resource, useLoad, FieldCfg } from '../components/Resource';
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, Spinner, TextInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const DEPT: FieldCfg = { name: 'departmentId', label: 'Department', type: 'select', required: true, optionUrl: '/academic/departments' };
const COURSE: FieldCfg = { name: 'courseId', label: 'Course', type: 'select', required: true, optionUrl: '/academic/courses' };
const SEM: FieldCfg = { name: 'semesterId', label: 'Semester', type: 'select', required: true, optionUrl: '/academic/semesters' };
const SECTION: FieldCfg = { name: 'sectionId', label: 'Section', type: 'select', optionUrl: '/academic/sections' };

/* ══════════════════════ STUDENTS ══════════════════════ */
export function StudentsPage() {
  const [modal, setModal] = useState<{ kind: 'promote' | 'parents' | 'login'; row: any } | null>(null);

  return (
    <>
      <Resource
        endpoint="/students" title="Students" subtitle="Admissions, records, logins & promotion"
        searchable paginate canEditKey="students:edit" canDeleteKey="students:delete"
        filters={[COURSE, SECTION]}
        columns={[
          { key: 'rollNo', label: 'Roll No' },
          { key: 'user', label: 'Name', render: (r) => (
            <div>
              <div className="font-medium text-slate-700">{r.user?.fullName}</div>
              <div className="text-xs text-slate-400">{r.user?.email}</div>
            </div>
          ) },
          { key: 'course', label: 'Course', render: (r) => r.course?.name },
          { key: 'semester', label: 'Sem', render: (r) => r.semester?.number },
          { key: 'section', label: 'Sec', render: (r) => r.section?.name || '—' },
          { key: 'status', label: 'Login', render: (r) => <Badge tone={r.user ? 'green' : 'slate'}>{r.user ? 'Active' : 'No login'}</Badge> },
        ]}
        createFields={[
          { name: 'fullName', label: 'Full name', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'enrollmentNo', label: 'Enrollment no', required: true },
          { name: 'rollNo', label: 'Roll no (becomes username)', required: true },
          DEPT, COURSE, SEM, SECTION,
          { name: 'gender', label: 'Gender', type: 'select', options: [
            { value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'OTHER', label: 'Other' } ] },
          { name: 'dob', label: 'Date of birth', type: 'date' },
          { name: 'phone', label: 'Phone' },
          { name: 'fatherName', label: 'Father name' },
          { name: 'motherName', label: 'Mother name' },
          { name: 'guardianPhone', label: 'Guardian phone' },
          { name: 'admissionDate', label: 'Admission date', type: 'date' },
          { name: 'address', label: 'Address', type: 'textarea' },
          { name: 'createLogin', label: 'Create student login now', type: 'checkbox', default: true },
          { name: 'password', label: 'Initial password', hint: 'default: student123 (must change on first login)' },
        ]}
        transformForm={(row) => ({
          fullName: row.user?.fullName, email: row.user?.email, rollNo: row.rollNo, enrollmentNo: row.enrollmentNo,
          departmentId: row.departmentId, courseId: row.courseId, semesterId: row.semesterId, sectionId: row.sectionId || '',
          gender: row.gender || '', dob: row.dob ? String(row.dob).slice(0, 10) : '', phone: row.user?.phone,
          fatherName: row.fatherName, motherName: row.motherName, guardianPhone: row.guardianPhone, address: row.address,
        })}
        rowActions={(row) => (
          <>
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setModal({ kind: 'login', row })}>Login</button>
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setModal({ kind: 'promote', row })}>Promote</button>
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setModal({ kind: 'parents', row })}>Parent</button>
          </>
        )}
      />
      {modal && <StudentModal modal={modal} onClose={() => setModal(null)} />}
    </>
  );
}

function StudentModal({ modal, onClose }: { modal: any; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [out, setOut] = useState('');
  const [f, setF] = useState<any>({ password: '', toSemesterId: '', relation: 'FATHER', pName: '', pEmail: '', pPhone: '' });

  async function run() {
    setBusy(true); setErr(''); setOut('');
    try {
      if (modal.kind === 'login') {
        const { data } = await api.post(`/students/${modal.row.id}/create-login`, { password: f.password || undefined });
        setOut(`Login ready — username: ${data.credential?.username || modal.row.rollNo}, password: ${data.credential?.password || f.password || 'student123'}`);
      } else if (modal.kind === 'promote') {
        await api.post(`/students/${modal.row.id}/promote`, { toSemesterId: f.toSemesterId });
        setOut('Student promoted and academic record updated.');
      } else {
        await api.post(`/students/${modal.row.id}/parents`, {
          relation: f.relation,
          parent: { fullName: f.pName, email: f.pEmail, phone: f.pPhone || undefined },
        });
        setOut('Parent linked (a PARENT login was created).');
      }
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }

  const sems = useLoad(async () => {
    const { data } = await api.get('/academic/semesters', { params: { _: modal.row.courseId } });
    return (data.items || []).filter((s: any) => s.courseId === modal.row.courseId);
  }, [modal.row.courseId]);

  const titles = { login: 'Create / reset login', promote: 'Promote student', parents: 'Link parent / guardian' };

  return (
    <Modal open onClose={onClose} title={`${titles[modal.kind as keyof typeof titles]} — ${modal.row.rollNo}`}>
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        {out && <div className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">{out}</div>}

        {modal.kind === 'login' && (
          <Field label="Password" hint="leave blank for default student123">
            <TextInput value={f.password} onChange={(e: any) => setF({ ...f, password: e.target.value })} />
          </Field>
        )}

        {modal.kind === 'promote' && (
          <Field label="Promote to semester">
            <Select value={f.toSemesterId} onChange={(e: any) => setF({ ...f, toSemesterId: e.target.value })}>
              <option value="">— Select —</option>
              {(sems.data || []).map((s: any) => <option key={s.id} value={s.id}>Sem {s.number} — {s.name}</option>)}
            </Select>
          </Field>
        )}

        {modal.kind === 'parents' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Relation">
              <Select value={f.relation} onChange={(e: any) => setF({ ...f, relation: e.target.value })}>
                {['FATHER', 'MOTHER', 'GUARDIAN'].map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Full name"><TextInput value={f.pName} onChange={(e: any) => setF({ ...f, pName: e.target.value })} /></Field>
            <Field label="Email"><TextInput type="email" value={f.pEmail} onChange={(e: any) => setF({ ...f, pEmail: e.target.value })} /></Field>
            <Field label="Phone"><TextInput value={f.pPhone} onChange={(e: any) => setF({ ...f, pPhone: e.target.value })} /></Field>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={run} disabled={busy || (modal.kind === 'promote' && !f.toSemesterId) || (modal.kind === 'parents' && (!f.pName || !f.pEmail))}>
            {busy ? 'Working…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════ TEACHERS ══════════════════════ */
export function TeachersPage() {
  const { can } = useAuth();
  const mayAllocate = can('allocations:create') || can('allocations:manage') || can('teachers:edit');
  const mayCreateLogin = can('teachers:create') || can('teachers:edit') || can('users:manage');
  const [alloc, setAlloc] = useState<any>(null);
  return (
    <>
      <Resource
        endpoint="/teachers" title="Teachers" subtitle="Faculty records, subject allocations & logins"
        searchable paginate canEditKey="teachers:edit" canDeleteKey="teachers:delete"
        filters={[DEPT]}
        columns={[
          { key: 'employeeCode', label: 'Emp Code' },
          { key: 'user', label: 'Name', render: (r) => (
            <div><div className="font-medium text-slate-700">{r.user?.fullName}</div><div className="text-xs text-slate-400">{r.user?.email}</div></div>
          ) },
          { key: 'department', label: 'Dept', render: (r) => r.department?.code },
          { key: 'designation', label: 'Designation', render: (r) => r.designation || '—' },
          { key: 'allocations', label: 'Subjects', render: (r) => r.allocations?.length || r._count?.allocations || 0 },
          { key: 'role', label: 'Role', render: (r) => <Badge tone={r.user?.role?.name === 'HOD' ? 'violet' : 'blue'}>{r.user?.role?.label || 'Teacher'}</Badge> },
        ]}
        createFields={[
          { name: 'fullName', label: 'Full name', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'employeeCode', label: 'Employee code', required: true, perma: true },
          DEPT,
          { name: 'designation', label: 'Designation' },
          { name: 'qualification', label: 'Qualification' },
          { name: 'specialization', label: 'Specialization' },
          { name: 'phone', label: 'Phone' },
          { name: 'joiningDate', label: 'Joining date', type: 'date' },
          { name: 'password', label: 'Initial password', hint: 'default: teacher123' },
        ]}
        transformForm={(row) => ({
          fullName: row.user?.fullName, email: row.user?.email, departmentId: row.departmentId,
          designation: row.designation, qualification: row.specialization ? row.qualification : row.qualification,
          specialization: row.specialization, phone: row.user?.phone,
        })}
        rowActions={(row) => (
          <>
            {mayAllocate && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setAlloc(row)}>Allocate</button>}
            {mayCreateLogin && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => {
              if (!confirm('Create/reset login for this teacher?')) return;
              try { const { data } = await api.post(`/teachers/${row.id}/create-login`, {}); alert(`Login ready — user: ${data.credential?.username}, password: ${data.credential?.password}`); }
              catch (e) { alert(errMsg(e)); }
            }}>Login</button>}
          </>
        )}
      />
      {alloc && <AllocModal teacher={alloc} onClose={() => setAlloc(null)} />}
    </>
  );
}

function AllocModal({ teacher, onClose }: { teacher: any; onClose: () => void }) {
  const [f, setF] = useState({ subjectId: '', sectionId: '', role: 'PRIMARY' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [list, setList] = useState<any[]>(teacher.allocations || []);
  const subjects = useLoad(async () => (await api.get('/subjects', { params: { departmentId: teacher.departmentId, limit: 200 } })).data.items || [], [teacher.departmentId]);
  const sections = useLoad(async () => (await api.get('/academic/sections')).data.items || [], []);

  async function add() {
    setBusy(true); setErr('');
    try {
      await api.post(`/teachers/${teacher.id}/allocate`, f);
      const { data } = await api.get(`/teachers/${teacher.id}/allocations`);
      setList(data.items || []);
      setF({ subjectId: '', sectionId: '', role: 'PRIMARY' });
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await api.delete(`/teachers/${teacher.id}/allocate/${id}`); setList((l) => l.filter((x) => x.id !== id)); }
    catch (e) { alert(errMsg(e)); }
  }

  return (
    <Modal open onClose={onClose} title={`Subject allocations — ${teacher.user?.fullName}`}>
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
        <div className="space-y-2">
          {list.length === 0 && <p className="text-sm text-slate-400">No subjects allocated yet.</p>}
          {list.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span>{a.subject?.name || a.subjectId} · Sec {a.section?.name || a.sectionId} <Badge tone="slate">{a.role}</Badge></span>
              <button className="text-xs text-rose-600 hover:underline" onClick={() => remove(a.id)}>remove</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <Field label="Subject">
            <Select value={f.subjectId} onChange={(e: any) => setF({ ...f, subjectId: e.target.value })}>
              <option value="">—</option>
              {(subjects.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
            </Select>
          </Field>
          <Field label="Section">
            <Select value={f.sectionId} onChange={(e: any) => setF({ ...f, sectionId: e.target.value })}>
              <option value="">—</option>
              {(sections.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.semester?.course?.code} Sem{s.semester?.number}-{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Role">
            <Select value={f.role} onChange={(e: any) => setF({ ...f, role: e.target.value })}>
              {['PRIMARY', 'LAB', 'COORDINATOR'].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={add} disabled={busy || !f.subjectId || !f.sectionId}>{busy ? 'Adding…' : 'Add allocation'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ════════════════════ SUBJECT ALLOCATIONS (who teaches what) ════════════════════ */
export function AllocationsPage() {
  const { can } = useAuth();
  const mayManage = can('allocations:create') || can('allocations:manage') || can('teachers:edit');
  const [filterSection, setFilterSection] = useState('');
  const [f, setF] = useState({ teacherId: '', subjectId: '', sectionId: '', role: 'PRIMARY' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const list = useLoad<any[]>(async () => {
    const params = filterSection ? { sectionId: filterSection } : {};
    return (await api.get('/allocations', { params })).data.items || [];
  }, [filterSection]);
  const teachers = useLoad(async () => (await api.get('/teachers', { params: { limit: 200 } })).data.items || [], []);
  const subjects = useLoad(async () => (await api.get('/subjects', { params: { limit: 200 } })).data.items || [], []);
  const sections = useLoad(async () => (await api.get('/academic/sections')).data.items || [], []);

  async function add() {
    setBusy(true); setErr('');
    try {
      await api.post('/allocations', f);
      setF({ teacherId: '', subjectId: '', sectionId: '', role: 'PRIMARY' });
      list.reload();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm('Remove this allocation?')) return;
    try { await api.delete(`/allocations/${id}`); list.reload(); } catch (e) { alert(errMsg(e)); }
  }

  const sectionLabel = (s: any) => s ? `${s.semester?.course?.code ?? ''} · Sem ${s.semester?.number ?? '?'} · Sec ${s.name}` : '—';

  return (
    <div>
      <PageHeader title="Subject Allocations" subtitle="Assign which teacher teaches which subject to which section"
        actions={
          <Select value={filterSection} onChange={(e: any) => setFilterSection(e.target.value)} className="!w-auto max-w-xs">
            <option value="">All sections</option>
            {(sections.data || []).map((s: any) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
          </Select>
        } />

      {mayManage && (
        <Card className="mb-4" title="Add allocation">
          {err && <div className="mb-3 rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{err}</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Teacher">
              <Select value={f.teacherId} onChange={(e: any) => setF({ ...f, teacherId: e.target.value })}>
                <option value="">— Select teacher —</option>
                {(teachers.data || []).map((t: any) => <option key={t.id} value={t.id}>{t.user?.fullName} ({t.employeeCode})</option>)}
              </Select>
            </Field>
            <Field label="Subject">
              <Select value={f.subjectId} onChange={(e: any) => setF({ ...f, subjectId: e.target.value })}>
                <option value="">— Select subject —</option>
                {(subjects.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </Select>
            </Field>
            <Field label="Section">
              <Select value={f.sectionId} onChange={(e: any) => setF({ ...f, sectionId: e.target.value })}>
                <option value="">— Select section —</option>
                {(sections.data || []).map((s: any) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
              </Select>
            </Field>
            <Field label="Role">
              <Select value={f.role} onChange={(e: any) => setF({ ...f, role: e.target.value })}>
                {['PRIMARY', 'LAB', 'COORDINATOR'].map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button className="w-full" onClick={add} disabled={busy || !f.teacherId || !f.subjectId || !f.sectionId}>
                {busy ? 'Assigning…' : '+ Assign'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Teacher</th><th>Subject</th><th>Section</th><th>Role</th>{mayManage && <th className="text-right">Actions</th>}</tr></thead>
          <tbody>
            {list.loading ? <tr><td colSpan={5}><Spinner /></td></tr> : null}
            {!list.loading && (list.data || []).map((a: any) => (
              <tr key={a.id}>
                <td>
                  <div className="font-medium text-slate-700">{a.teacher?.user?.fullName || '—'}</div>
                  <div className="text-xs text-slate-400">{a.teacher?.employeeCode}</div>
                </td>
                <td>
                  <div className="font-medium text-slate-700">{a.subject?.name || '—'}</div>
                  <div className="text-xs text-slate-400">{a.subject?.code} {a.subject?.type && <Badge tone="slate">{a.subject.type}</Badge>}</div>
                </td>
                <td>{sectionLabel(a.section)}</td>
                <td><Badge tone={a.role === 'PRIMARY' ? 'blue' : a.role === 'LAB' ? 'amber' : 'violet'}>{a.role}</Badge></td>
                {mayManage && <td className="text-right"><button className="btn-ghost !px-2 !py-1 text-xs text-rose-600" onClick={() => remove(a.id)}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!list.loading && !(list.data || []).length && <Empty text="No allocations yet — assign a teacher to a subject & section above" />}
      </div>
    </div>
  );
}
