import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { httpError } from '../lib/http';
import type { AuthUser } from './auth';

/**
 * Data-scoping helpers. Even when a role *can* view a module, these constrain
 * WHICH rows they see:
 *   HOD         → own department only
 *   COORDINATOR → sections they coordinate
 *   TEACHER     → allocations they hold (+ own timetable/attendance)
 *   STUDENT     → self only
 *   PARENT      → linked children only
 * Roles with institution-wide grants (ADMIN/PRINCIPAL/SUPER_ADMIN/EXAM_CELL/ACCOUNTANT)
 * are resolved by their permission keys instead.
 */

export async function getHodDepartmentId(user: AuthUser): Promise<string | null> {
  const dept = await prisma.department.findFirst({ where: { hodId: user.id } });
  return dept?.id ?? null;
}

export async function getTeacherProfileId(user: AuthUser): Promise<string | null> {
  const tp = await prisma.teacherProfile.findUnique({ where: { userId: user.id } });
  return tp?.id ?? null;
}

export async function getCoordinatorSectionIds(user: AuthUser): Promise<string[]> {
  const secs = await prisma.sections.findMany({
    where: { coordinatorId: user.id },
    select: { id: true },
  });
  return secs.map((s) => s.id);
}

export async function getStudentProfileId(user: AuthUser): Promise<string | null> {
  const sp = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
  return sp?.id ?? null;
}

export async function getParentChildStudentIds(user: AuthUser): Promise<string[]> {
  const links = await prisma.parentLink.findMany({
    where: { parentId: user.id },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

/**
 * Build a Prisma `where` fragment for StudentProfile queries based on the caller's scope.
 * Returns null when the caller has unrestricted (institution-wide) access.
 */
export async function studentScopeWhere(user: AuthUser): Promise<any | null> {
  switch (user.role) {
    case 'STUDENT': {
      const id = await getStudentProfileId(user);
      return { id: id || '__none__' };
    }
    case 'PARENT': {
      const ids = await getParentChildStudentIds(user);
      return { id: { in: ids.length ? ids : ['__none__'] } };
    }
    case 'HOD': {
      const deptId = await getHodDepartmentId(user);
      return { departmentId: deptId || '__none__' };
    }
    case 'COORDINATOR': {
      const sectionIds = await getCoordinatorSectionIds(user);
      return { sectionId: { in: sectionIds.length ? sectionIds : ['__none__'] } };
    }
    case 'TEACHER': {
      // teachers see students in sections where they hold an allocation
      const tpId = await getTeacherProfileId(user);
      const allocs = tpId
        ? await prisma.teacherAllocation.findMany({ where: { teacherId: tpId }, select: { sectionId: true } })
        : [];
      const sectionIds = Array.from(new Set(allocs.map((a) => a.sectionId)));
      return { sectionId: { in: sectionIds.length ? sectionIds : ['__none__'] } };
    }
    default:
      return null; // unrestricted
  }
}

/** Guard: ensure the caller may access a specific student profile, else 403. */
export async function assertCanAccessStudent(user: AuthUser, studentProfileId: string) {
  const where = await studentScopeWhere(user);
  if (where === null) return; // unrestricted
  const match = await prisma.studentProfile.findFirst({ where: { id: studentProfileId, AND: [where] } });
  if (!match) throw httpError(403, 'You are not permitted to access this student');
}
