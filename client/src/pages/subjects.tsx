import { Resource, FieldCfg } from '../components/Resource';
import { Badge } from '../components/ui';

const DEPT: FieldCfg = { name: 'departmentId', label: 'Department', type: 'select', required: true, optionUrl: '/academic/departments' };
const COURSE: FieldCfg = { name: 'courseId', label: 'Course', type: 'select', required: true, optionUrl: '/academic/courses' };
const SEM: FieldCfg = { name: 'semesterId', label: 'Semester', type: 'select', required: true, optionUrl: '/academic/semesters' };

export function SubjectsPage() {
  return (
    <Resource
      endpoint="/subjects" title="Subjects" subtitle="Curriculum subjects per course & semester"
      searchable paginate canEditKey="subjects:edit" canDeleteKey="subjects:delete"
      filters={[COURSE, SEM, DEPT]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Subject' },
        { key: 'course', label: 'Course', render: (r) => r.course?.name },
        { key: 'semester', label: 'Sem', render: (r) => r.semester?.number },
        { key: 'department', label: 'Dept', render: (r) => r.department?.code },
        { key: 'credits', label: 'Credits' },
        { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'LAB' ? 'amber' : r.type === 'THEORY_LAB' ? 'violet' : 'blue'}>{r.type}</Badge> },
        { key: 'ltp', label: 'L-T-P', render: (r) => r.ltp || '—' },
      ]}
      createFields={[
        { name: 'code', label: 'Subject code', required: true },
        { name: 'name', label: 'Subject name', required: true },
        COURSE, DEPT, SEM,
        { name: 'credits', label: 'Credits', type: 'number', default: 3 },
        { name: 'type', label: 'Type', type: 'select', default: 'THEORY', options: [
          { value: 'THEORY', label: 'Theory' }, { value: 'LAB', label: 'Lab' }, { value: 'THEORY_LAB', label: 'Theory + Lab' },
        ] },
        { name: 'ltp', label: 'L-T-P', hint: 'e.g. 3-1-2' },
      ]}
      transformForm={(row) => ({
        code: row.code, name: row.name, courseId: row.courseId, departmentId: row.departmentId,
        semesterId: row.semesterId, credits: row.credits, type: row.type, ltp: row.ltp,
      })}
    />
  );
}
