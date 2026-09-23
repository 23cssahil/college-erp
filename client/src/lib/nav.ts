/* Permission-driven navigation config for the app shell. */
export interface NavItem {
  path: string;
  label: string;
  permission: string; // any ONE of these unlocks the item ('*' = always visible)
  section: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', permission: '*', section: 'Overview' },

  { path: '/students', label: 'Students', permission: 'students:view', section: 'People' },
  { path: '/teachers', label: 'Teachers', permission: 'teachers:view', section: 'People' },
  { path: '/users', label: 'Users', permission: 'users:view', section: 'People' },
  { path: '/roles', label: 'Roles & Permissions', permission: 'roles:view', section: 'People' },

  { path: '/departments', label: 'Departments', permission: 'departments:view', section: 'Academics' },
  { path: '/courses', label: 'Courses', permission: 'courses:view', section: 'Academics' },
  { path: '/academic-years', label: 'Academic Years', permission: 'academicYears:view', section: 'Academics' },
  { path: '/semesters', label: 'Semesters', permission: 'semesters:view', section: 'Academics' },
  { path: '/sections', label: 'Sections', permission: 'sections:view', section: 'Academics' },
  { path: '/subjects', label: 'Subjects', permission: 'subjects:view', section: 'Academics' },
  { path: '/allocations', label: 'Subject Allocations', permission: 'allocations:view', section: 'Academics' },

  { path: '/timetable', label: 'Timetable', permission: 'timetable:view', section: 'Operations' },
  { path: '/attendance', label: 'Attendance', permission: 'attendance:view', section: 'Operations' },
  { path: '/exams', label: 'Exams & Results', permission: 'exams:view', section: 'Operations' },
  { path: '/fees', label: 'Fees', permission: 'fees:view', section: 'Operations' },

  { path: '/notices', label: 'Notices', permission: 'notices:view', section: 'Content' },
  { path: '/documents', label: 'Documents', permission: 'documents:view', section: 'Content' },
  { path: '/reports', label: 'Reports', permission: 'reports:view', section: 'Content' },

  { path: '/audit-logs', label: 'Audit Logs', permission: 'auditLogs:view', section: 'System' },
  { path: '/settings', label: 'Settings', permission: 'settings:view', section: 'System' },
];

/* Rough guess of the "view" permission for a resource path, used as the
   default gate when a route doesn't declare one explicitly. */
export function guessViewPermission(path: string): string | undefined {
  const item = NAV_ITEMS.find((n) => n.path === path);
  if (!item || item.permission === '*') return undefined;
  return item.permission;
}
