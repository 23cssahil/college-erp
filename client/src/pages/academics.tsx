import { api, errMsg } from '../lib/api';
import { Resource, useLoad } from '../components/Resource';
import { Badge } from '../components/ui';

const DEPT_OPTS = { optionUrl: '/academic/departments' };
const COURSE_OPTS = { optionUrl: '/academic/courses' };
// server returns a composed label: "BTCS · Semester 3" so the course/department is visible
const SEM_OPTS = { optionUrl: '/academic/semesters', optionLabelKey: 'label' };

/* ══════════════ Departments ══════════════ */
export function DepartmentsPage() {
  return (
    <Resource
      endpoint="/academic/departments" title="Departments" subtitle="Academic departments with HOD assignment"
      searchable={false} paginate={false} canEditKey="departments:edit"
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'hod', label: 'HOD', render: (r) => r.hod?.fullName || <span className="text-slate-400">Not assigned</span> },
        { key: '_count', label: 'Courses', render: (r) => r._count?.courses ?? 0 },
        { key: 'students', label: 'Students', render: (r) => r._count?.students ?? 0 },
        { key: 'teachers', label: 'Teachers', render: (r) => r._count?.teachers ?? 0 },
        { key: 'isActive', label: 'Status', render: (r) => <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
      ]}
      createFields={[
        { name: 'code', label: 'Code (e.g. CSE)', required: true },
        { name: 'name', label: 'Department name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'isActive', label: 'Active', type: 'checkbox', default: true },
      ]}
      rowActions={(row, { reload }) => <HodButton row={row} reload={reload} />}
    />
  );
}

function HodButton({ row, reload }: { row: any; reload: () => void }) {
  const { data } = useLoad<any[]>(async () => {
    const { data } = await api.get('/teachers', { params: { departmentId: row.id, limit: 100 } });
    return data.items || [];
  }, [row.id]);
  async function assign(userId: string) {
    try {
      await api.post(`/academic/departments/${row.id}/hod`, { userId: userId || null });
      reload();
    } catch (e) { alert(errMsg(e)); }
  }
  return (
    <select className="input !w-auto !py-1 text-xs" value={row.hod?.id || ''} onChange={(e) => assign(e.target.value)}
      title="Assign HOD">
      <option value="">Assign HOD…</option>
      {(data || []).map((t: any) => <option key={t.id} value={t.userId}>{t.user?.fullName}</option>)}
    </select>
  );
}

/* ══════════════ Courses ══════════════ */
export function CoursesPage() {
  return (
    <Resource
      endpoint="/academic/courses" title="Courses" subtitle="Degree programmes; semesters are generated per course"
      paginate={false} canEditKey="courses:edit"
      filters={[{ name: 'departmentId', label: 'Department', type: 'select', ...DEPT_OPTS }]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department', render: (r) => r.department?.name },
        { key: 'durationSemesters', label: 'Duration' },
        { key: 'type', label: 'Type', render: (r) => <Badge tone="violet">{r.type || 'DEGREE'}</Badge> },
        { key: 'sem', label: 'Semesters', render: (r) => r._count?.semesters ?? 0 },
        { key: 'students', label: 'Students', render: (r) => r._count?.students ?? 0 },
      ]}
      createFields={[
        { name: 'code', label: 'Code (e.g. BTCE)', required: true },
        { name: 'name', label: 'Course name', required: true },
        { name: 'departmentId', label: 'Department', type: 'select', required: true, ...DEPT_OPTS },
        { name: 'durationSemesters', label: 'Duration (semesters)', type: 'number', default: 8 },
        { name: 'type', label: 'Type', type: 'select', options: [
          { value: 'DEGREE', label: 'Degree' }, { value: 'DIPLOMA', label: 'Diploma' }, { value: 'POSTGRADUATE', label: 'Post Graduate' },
        ], default: 'DEGREE' },
      ]}
      rowActions={(row, { reload }) => <BootstrapSemesters row={row} reload={reload} />}
    />
  );
}

function BootstrapSemesters({ row, reload }: { row: any; reload: () => void }) {
  return (
    <button className="btn-ghost !px-2 !py-1 text-xs" title="Create all semesters for this course"
      onClick={async () => {
        try {
          const { data } = await api.post(`/academic/courses/${row.id}/semesters/bootstrap`);
          alert(data.created ? `${data.created} semesters created` : 'All semesters already exist');
          reload();
        } catch (e) { alert(errMsg(e)); }
      }}>⚙ Gen semesters</button>
  );
}

/* ══════════════ Academic Years ══════════════ */
export function AcademicYearsPage() {
  return (
    <Resource
      endpoint="/academic/academic-years" title="Academic Years" subtitle="One year is active at a time (e.g. 2026-27)"
      paginate={false} canCreateKey="academicYears:manage" canEditKey="academicYears:manage" canDeleteKey=""
      columns={[
        { key: 'label', label: 'Label' },
        { key: 'startDate', label: 'Start', render: (r) => new Date(r.startDate).toLocaleDateString('en-IN') },
        { key: 'endDate', label: 'End', render: (r) => new Date(r.endDate).toLocaleDateString('en-IN') },
        { key: 'isActive', label: 'Status', render: (r) => <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
      ]}
      createFields={[
        { name: 'label', label: 'Label (e.g. 2027-28)', required: true },
        { name: 'startDate', label: 'Start date', type: 'date', required: true },
        { name: 'endDate', label: 'End date', type: 'date', required: true },
      ]}
      rowActions={(row, { reload }) => !row.isActive && (
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => {
          try { await api.post(`/academic/academic-years/${row.id}/activate`); reload(); } catch (e) { alert(errMsg(e)); }
        }}>Activate</button>
      )}
    />
  );
}

/* ══════════════ Semesters ══════════════ */
export function SemestersPage() {
  return (
    <Resource
      endpoint="/academic/semesters" title="Semesters" subtitle="Offered per course; use ⚙ on a course to generate all at once"
      paginate={false} canEditKey="semesters:manage"
      filters={[{ name: 'departmentId', label: 'Department', type: 'select', ...DEPT_OPTS }]}
      columns={[
        { key: 'number', label: '#' },
        { key: 'name', label: 'Name' },
        { key: 'course', label: 'Course', render: (r) => r.course?.name },
      ]}
      createFields={[
        { name: 'courseId', label: 'Course', type: 'select', required: true, ...COURSE_OPTS },
        { name: 'number', label: 'Semester number', type: 'number', required: true },
        { name: 'name', label: 'Name (optional)' },
      ]}
      transformForm={(row) => ({ courseId: row.courseId, number: row.number, name: row.name })}
    />
  );
}

/* ══════════════ Sections ══════════════ */
export function SectionsPage() {
  return (
    <Resource
      endpoint="/academic/sections" title="Sections" subtitle="Sections within semesters; assign a coordinator per section"
      paginate={false} canEditKey="sections:edit"
      filters={[
        { name: 'departmentId', label: 'Department', type: 'select', ...DEPT_OPTS },
        { name: 'semesterId', label: 'Semester', type: 'select', dependsOn: 'departmentId', ...SEM_OPTS },
      ]}
      columns={[
        { key: 'name', label: 'Section' },
        { key: 'course', label: 'Course', render: (r) => r.semester?.course?.name || <span className="text-slate-400">—</span> },
        { key: 'semester', label: 'Semester', render: (r) => r.semester ? `Sem ${r.semester.number}` : <span className="text-amber-500">not set</span> },
        { key: 'capacity', label: 'Capacity' },
        { key: 'students', label: 'Students', render: (r) => r._count?.students ?? 0 },
        { key: 'coordinator', label: 'Coordinator', render: (r) => r.coordinator?.fullName || <span className="text-slate-400">—</span> },
      ]}
      createFields={[
        { name: 'semesterId', label: 'Semester (course + sem)', type: 'select', required: true, ...SEM_OPTS },
        { name: 'name', label: 'Section name (A/B/C)', required: true },
        { name: 'capacity', label: 'Capacity', type: 'number', default: 60 },
      ]}
      transformForm={(row) => ({ semesterId: row.semesterId, name: row.name, capacity: row.capacity })}
      rowActions={(row, { reload }) => <CoordinatorButton row={row} reload={reload} />}
    />
  );
}

function CoordinatorButton({ row, reload }: { row: any; reload: () => void }) {
  const { data } = useLoad<any[]>(async () => (await api.get('/teachers', { params: { limit: 200 } })).data.items || [], []);
  return (
    <select className="input !w-auto !py-1 text-xs" value={row.coordinator?.id || ''} title="Assign coordinator"
      onChange={async (e) => {
        const userId = e.target.value;
        if (!userId) return;
        try {
          await api.post('/teachers/assign-coordinator', { userId, sectionId: row.id });
          reload();
        } catch (err) { alert(errMsg(err)); }
      }}>
      <option value="">Assign coordinator…</option>
      {(data || []).map((t: any) => <option key={t.id} value={t.userId}>{t.user?.fullName}</option>)}
    </select>
  );
}
