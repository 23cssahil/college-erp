import { Route, Routes } from 'react-router-dom';
import { Protected } from './auth/Protected';
import AppLayout from './layout/AppLayout';
import { Login, ForgotPassword, ResetPassword, Unauthorized, NotFound } from './pages/auth';
import Dashboard from './pages/Dashboard';
import { DepartmentsPage, CoursesPage, AcademicYearsPage, SemestersPage, SectionsPage } from './pages/academics';
import { StudentsPage, TeachersPage, AllocationsPage } from './pages/people';
import { SubjectsPage } from './pages/subjects';
import { UsersPage, RolesPage } from './pages/admin';
import { TimetablePage, AttendancePage } from './pages/operations';
import { ExamsPage } from './pages/exams';
import { FeesPage } from './pages/fees';
import { NoticesPage, DocumentsPage } from './pages/content';
import { ReportsPage, AuditLogsPage, SettingsPage } from './pages/reports';

const gate = (permission: string, el: JSX.Element) => <Protected permission={permission}>{el}</Protected>;

export default function App() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      {/* authenticated app shell */}
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<Dashboard />} />

        <Route path="departments" element={gate('departments:view', <DepartmentsPage />)} />
        <Route path="courses" element={gate('courses:view', <CoursesPage />)} />
        <Route path="academic-years" element={gate('academicYears:view', <AcademicYearsPage />)} />
        <Route path="semesters" element={gate('semesters:view', <SemestersPage />)} />
        <Route path="sections" element={gate('sections:view', <SectionsPage />)} />
        <Route path="subjects" element={gate('subjects:view', <SubjectsPage />)} />
        <Route path="allocations" element={gate('allocations:view', <AllocationsPage />)} />

        <Route path="students" element={gate('students:view', <StudentsPage />)} />
        <Route path="teachers" element={gate('teachers:view', <TeachersPage />)} />
        <Route path="users" element={gate('users:view', <UsersPage />)} />
        <Route path="roles" element={gate('roles:view', <RolesPage />)} />

        <Route path="timetable" element={gate('timetable:view', <TimetablePage />)} />
        <Route path="attendance" element={gate('attendance:view', <AttendancePage />)} />
        <Route path="exams" element={gate('exams:view', <ExamsPage />)} />
        <Route path="fees" element={gate('fees:view', <FeesPage />)} />

        <Route path="notices" element={gate('notices:view', <NoticesPage />)} />
        <Route path="documents" element={gate('documents:view', <DocumentsPage />)} />
        <Route path="reports" element={gate('reports:view', <ReportsPage />)} />

        <Route path="audit-logs" element={gate('auditLogs:view', <AuditLogsPage />)} />
        <Route path="settings" element={gate('settings:view', <SettingsPage />)} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
