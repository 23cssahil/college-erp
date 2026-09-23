/**
 * Permission catalog — the single source of truth for the whole RBAC system.
 *
 * The seed script copies PERMISSIONS into the `Permission` table and wires the
 * default role→permission mapping (ROLE_GRANTS) into `RolePermission`. Admins can
 * later edit these grants at runtime (Role Management UI); this file only defines
 * the *defaults*. Nothing here is trusted from the frontend — every protected route
 * calls requirePermission(...) which checks the DB-backed grants.
 *
 * Key format:  "<module>:<action>"   e.g. "students:create"
 * A grant of  "<module>:*"  or  "*:*"  acts as a wildcard.
 */

export const MODULES = [
  'dashboard',
  'users',
  'roles',
  'departments',
  'courses',
  'academicYears',
  'semesters',
  'sections',
  'subjects',
  'students',
  'teachers',
  'allocations',
  'timetable',
  'attendance',
  'exams',
  'marks',
  'results',
  'fees',
  'notices',
  'documents',
  'reports',
  'auditLogs',
  'settings',
] as const;

const ACTIONS = ['view', 'create', 'edit', 'delete', 'manage'] as const;

/** Flatten into the full list of permission keys with human labels. */
export const PERMISSIONS: { key: string; module: string; action: string; label: string }[] =
  MODULES.flatMap((module) =>
    ACTIONS.map((action) => ({
      key: `${module}:${action}`,
      module,
      action,
      label: `${action} ${module}`,
    })),
  );

const grant = (module: string, ...actions: (typeof ACTIONS)[number][]) =>
  actions.map((a) => `${module}:${a}`);

const allOf = (module: string) => grant(module, 'view', 'create', 'edit', 'delete', 'manage');

/**
 * Default role → permission grants.
 * SUPER_ADMIN gets the "*:*" super grant (handled specially in middleware).
 */
export const ROLE_GRANTS: Record<string, (string | string[])[]> = {
  SUPER_ADMIN: ['*:*'],

  PRINCIPAL: [
    'dashboard:view',
    allOf('departments'), allOf('courses'), allOf('academicYears'),
    allOf('semesters'), allOf('sections'), allOf('subjects'),
    allOf('students'), allOf('teachers'), allOf('allocations'),
    allOf('timetable'), allOf('attendance'), allOf('exams'), allOf('marks'),
    allOf('results'), allOf('fees'), allOf('notices'), allOf('documents'),
    allOf('reports'), 'auditLogs:view', 'settings:view', 'settings:manage',
    'users:view', 'users:create', 'users:edit',
  ],

  ADMIN: [
    'dashboard:view',
    'departments:view', 'courses:view', 'academicYears:view', 'academicYears:manage',
    'semesters:view', 'sections:view', 'sections:create', 'sections:edit',
    allOf('students'), allOf('teachers'), 'subjects:view', 'subjects:create', 'subjects:edit',
    allOf('allocations'), allOf('timetable'), allOf('attendance'),
    allOf('notices'), allOf('documents'), allOf('fees'), allOf('reports'),
    'users:view', 'users:create', 'users:edit',
  ],

  HOD: [
    'dashboard:view',
    'departments:view', 'courses:view', 'semesters:view', 'sections:view',
    allOf('subjects'), allOf('students'), allOf('teachers'),
    allOf('allocations'), allOf('timetable'), allOf('attendance'),
    allOf('exams'), allOf('marks'), allOf('results'),
    allOf('notices'), allOf('documents'), 'reports:view',
  ],

  COORDINATOR: [
    'dashboard:view',
    'students:view', 'teachers:view', 'subjects:view', 'allocations:view',
    'timetable:view', allOf('attendance'), 'exams:view', 'marks:view',
    'results:view', 'notices:view', 'reports:view',
  ],

  TEACHER: [
    'dashboard:view',
    'students:view', 'subjects:view', 'allocations:view',
    'timetable:view', allOf('attendance'), 'exams:view',
    'marks:view', 'marks:create', 'marks:edit',
    'notices:view', 'documents:view', 'documents:create',
  ],

  EXAM_CELL: [
    'dashboard:view',
    'students:view', 'subjects:view',
    allOf('exams'), allOf('marks'), allOf('results'), 'notices:view', 'notices:create',
    'notices:edit', 'reports:view', 'documents:view',
  ],

  ACCOUNTANT: [
    'dashboard:view',
    'students:view', allOf('fees'), 'reports:view',
    'notices:view', 'documents:view',
  ],

  STUDENT: [
    'dashboard:view',
    'attendance:view', 'results:view', 'fees:view', 'notices:view',
    'timetable:view', 'documents:view',
  ],

  PARENT: [
    'dashboard:view',
    'attendance:view', 'results:view', 'fees:view', 'notices:view',
  ],
};

/** Expand shorthand arrays (which may contain allOf(...) results) — pure helper for seed. */
export function expandGrants(role: string): string[] {
  const raw = (ROLE_GRANTS[role] || []).flat() as string[];
  return Array.from(new Set(raw));
}
