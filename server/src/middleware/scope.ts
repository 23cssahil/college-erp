import type { Request } from 'express';
import { Department, TeacherProfile, Section, StudentProfile, ParentLink, TeacherAllocation } from '../models';
import { httpError, oid } from '../lib/http';
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
  const dept = await Department.findOne({ hodId: oid(user.id) }).select('_id');
  return dept ? String(dept._id) : null;
}

export async function getTeacherProfileId(user: AuthUser): Promise<string | null> {
  const tp = await TeacherProfile.findOne({ userId: oid(user.id) }).select('_id');
  return tp ? String(tp._id) : null;
}

export async function getCoordinatorSectionIds(user: AuthUser): Promise<string[]> {
  const secs = await Section.find({ coordinatorId: oid(user.id) }).select('_id');
  return secs.map((s: any) => String(s._id));
}

export async function getStudentProfileId(user: AuthUser): Promise<string | null> {
  const sp = await StudentProfile.findOne({ userId: oid(user.id) }).select('_id');
  return sp ? String(sp._id) : null;
}

export async function getParentChildStudentIds(user: AuthUser): Promise<string[]> {
  const links = await ParentLink.find({ parentId: oid(user.id) }).select('studentId');
  return links.map((l: any) => String(l.studentId));
}

/**
 * Build a StudentProfile Mongo filter based on the caller's scope.
 * Returns null when the caller has unrestricted (institution-wide) access.
 */
export async function studentScopeWhere(user: AuthUser): Promise<any | null> {
  switch (user.role) {
    case 'STUDENT': {
      const id = await getStudentProfileId(user);
      return { _id: id ? oid(id) : null };
    }
    case 'PARENT': {
      const ids = await getParentChildStudentIds(user);
      return { _id: { $in: ids.length ? ids.map((x) => oid(x)) : [] } };
    }
    case 'HOD': {
      const deptId = await getHodDepartmentId(user);
      return { departmentId: deptId ? oid(deptId) : null };
    }
    case 'COORDINATOR': {
      const sectionIds = await getCoordinatorSectionIds(user);
      return { sectionId: { $in: sectionIds.length ? sectionIds.map((x) => oid(x)) : [] } };
    }
    case 'TEACHER': {
      const tpId = await getTeacherProfileId(user);
      const allocs = tpId
        ? await TeacherAllocation.find({ teacherId: oid(tpId) }).select('sectionId')
        : [];
      const sectionIds = Array.from(new Set(allocs.map((a: any) => String(a.sectionId))));
      return { sectionId: { $in: sectionIds.length ? sectionIds.map((x) => oid(x)) : [] } };
    }
    default:
      return null; // unrestricted
  }
}

/** Guard: ensure the caller may access a specific student profile, else 403. */
export async function assertCanAccessStudent(user: AuthUser, studentProfileId: string) {
  const where = await studentScopeWhere(user);
  if (where === null) return; // unrestricted
  const match = await StudentProfile.findOne({ _id: oid(studentProfileId), ...where });
  if (!match) throw httpError(403, 'You are not permitted to access this student');
}
