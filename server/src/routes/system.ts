import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError, parsePagination } from '../lib/http';
import { validate } from '../lib/validate';
import { authenticate, requirePermission } from '../middleware/auth';
import { getHodDepartmentId, getStudentProfileId, getTeacherProfileId, getCoordinatorSectionIds, getParentChildStudentIds } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ DASHBOARD (role-aware) ══════════════════════ */
router.get('/dashboard', authenticate, wrap(async (req, res) => {
  const user = req.user!;
  const role = user.role;

  // shared helpers
  const notices = await prisma.notice.findMany({ where: { OR: [{ expiryAt: null }, { expiryAt: { gte: new Date() } }] }, orderBy: { publishAt: 'desc' }, take: 5, include: { author: { select: { fullName: true } } } });

  if (role === 'STUDENT') {
    const sp = await prisma.studentProfile.findUnique({ where: { userId: user.id }, include: { course: true, section: true, semester: true, department: true, user: { select: { photoUrl: true } } } });
    if (!sp) return res.json({ role, cards: [], notices });
    const att = await prisma.attendanceRecord.groupBy({ by: ['status'], where: { studentId: sp.id }, _count: true });
    const total = att.reduce((s: number, a: any) => s + a._count, 0);
    const present = att.filter((a: any) => a.status === 'PRESENT' || a.status === 'LATE').reduce((s: number, a: any) => s + a._count, 0);
    const due = await prisma.feeInvoice.aggregate({ where: { studentId: sp.id }, _sum: { totalAmount: true, paidAmount: true } });
    const timetable = sp.sectionId ? await prisma.timetableSlot.findMany({ where: { sectionId: sp.sectionId, isPublished: true }, include: { subject: true, teacher: { include: { user: true } } }, orderBy: [{ day: 'asc' }, { periodNumber: 'asc' }] }) : [];
    const upcomingExams = await prisma.exam.findMany({ where: { startDate: { gte: new Date() } }, take: 5, orderBy: { startDate: 'asc' } });
    return res.json({
      role, notices,
      profile: { name: user.fullName, course: sp.course?.name, department: sp.department?.code, semester: sp.semester?.number, section: sp.section?.name, rollNo: sp.rollNo, photoUrl: sp.user.photoUrl },
      cards: [
        { label: 'Attendance', value: total ? Math.round((present / total) * 100) + '%' : '—', tone: total && present / total < 0.75 ? 'warn' : 'good' },
        { label: 'Fee Due', value: '₹' + ((due._sum.totalAmount || 0) - (due._sum.paidAmount || 0)).toLocaleString('en-IN'), tone: (due._sum.totalAmount || 0) > (due._sum.paidAmount || 0) ? 'warn' : 'good' },
        { label: 'Upcoming Exams', value: upcomingExams.length, tone: 'info' },
      ],
      timetable, upcomingExams,
    });
  }

  if (role === 'PARENT') {
    const kids = await prisma.parentLink.findMany({ where: { parentId: user.id }, include: { student: { include: { user: { select: { fullName: true } }, course: true, section: true } } } });
    return res.json({ role, notices, children: kids.map((k: any) => ({ id: k.student.id, name: k.student.user.fullName, rollNo: k.student.rollNo, course: k.student.course?.name, section: k.student.section?.name })) });
  }

  if (role === 'TEACHER') {
    const tpId = await getTeacherProfileId(user);
    const allocs = tpId ? await prisma.teacherAllocation.findMany({ where: { teacherId: tpId }, include: { subject: true, section: true } }) : [];
    const sectionIds = Array.from(new Set(allocs.map((a: any) => a.sectionId)));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaysClasses = tpId ? await prisma.timetableSlot.findMany({ where: { teacherId: tpId, subject: { allocations: { some: { sectionId: { in: sectionIds } } } } }, include: { subject: true, section: true } }) : [];
    const pendingMarks = tpId ? await prisma.examSubject.count({ where: { subject: { allocations: { some: { teacherId: tpId } } }, results: { none: {} } } }) : 0;
    return res.json({
      role, notices,
      cards: [
        { label: 'My Subjects', value: allocs.length, tone: 'info' },
        { label: 'Sections', value: sectionIds.length, tone: 'info' },
        { label: 'Classes Today', value: todaysClasses.length, tone: 'good' },
        { label: 'Marks Pending', value: pendingMarks, tone: pendingMarks ? 'warn' : 'good' },
      ],
      allocations: allocs.map((a: any) => ({ subject: a.subject.name, section: a.section.name })),
    });
  }

  if (role === 'COORDINATOR') {
    const sectionIds = await getCoordinatorSectionIds(user);
    const studentCount = await prisma.studentProfile.count({ where: { sectionId: { in: sectionIds } } });
    return res.json({
      role, notices,
      cards: [
        { label: 'My Sections', value: sectionIds.length, tone: 'info' },
        { label: 'Students', value: studentCount, tone: 'good' },
      ],
      sections: await prisma.sections.findMany({ where: { id: { in: sectionIds } }, include: { semester: { include: { course: { select: { name: true } } } } } }),
    });
  }

  if (role === 'HOD') {
    const deptId = await getHodDepartmentId(user);
    const [students, teachers, courses, subjects] = await Promise.all([
      prisma.studentProfile.count({ where: { departmentId: deptId || '__none__' } }),
      prisma.teacherProfile.count({ where: { departmentId: deptId || '__none__' } }),
      prisma.course.count({ where: { departmentId: deptId || '__none__' } }),
      prisma.subject.count({ where: { departmentId: deptId || '__none__' } }),
    ]);
    return res.json({
      role, notices,
      cards: [
        { label: 'Students', value: students, tone: 'info' }, { label: 'Teachers', value: teachers, tone: 'info' },
        { label: 'Courses', value: courses, tone: 'good' }, { label: 'Subjects', value: subjects, tone: 'good' },
      ],
      department: await prisma.department.findUnique({ where: { id: deptId || '__none__' }, select: { code: true, name: true } }),
    });
  }

  // ADMIN / PRINCIPAL / SUPER_ADMIN / EXAM_CELL / ACCOUNTANT
  const [students, teachers, departments, courses, activeYear] = await Promise.all([
    prisma.studentProfile.count(), prisma.teacherProfile.count(), prisma.department.count(), prisma.course.count(),
    prisma.academicYear.findFirst({ where: { isActive: true } }),
  ]);

  if (role === 'ACCOUNTANT') {
    const agg = await prisma.feeInvoice.aggregate({ _sum: { totalAmount: true, paidAmount: true } });
    return res.json({
      role, notices, activeYear,
      cards: [
        { label: 'Total Billed', value: '₹' + (agg._sum.totalAmount || 0).toLocaleString('en-IN'), tone: 'info' },
        { label: 'Collected', value: '₹' + (agg._sum.paidAmount || 0).toLocaleString('en-IN'), tone: 'good' },
        { label: 'Outstanding', value: '₹' + ((agg._sum.totalAmount || 0) - (agg._sum.paidAmount || 0)).toLocaleString('en-IN'), tone: 'warn' },
      ],
    });
  }

  return res.json({
    role, notices, activeYear,
    cards: [
      { label: 'Students', value: students, tone: 'info' },
      { label: 'Teachers', value: teachers, tone: 'info' },
      { label: 'Departments', value: departments, tone: 'good' },
      { label: 'Courses', value: courses, tone: 'good' },
    ],
    deptBreakdown: await prisma.department.findMany({ include: { _count: { select: { students: true, teachers: true } } }, orderBy: { name: 'asc' } }),
  });
}));

/* ══════════════════════ REPORTS ══════════════════════ */
router.get('/reports/attendance-overview', requirePermission('reports:view', 'attendance:view'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  if (!sectionId) throw httpError(400, 'sectionId required');
  const records = await prisma.attendanceRecord.groupBy({ by: ['status'], where: { sectionId }, _count: true });
  const map: any = {};
  for (const r of records) map[r.status] = r._count;
  const total = Object.values(map).reduce((s: number, n: any) => s + n, 0);
  res.json({ statusCounts: map, total, percentage: total ? Math.round(((map.PRESENT + map.LATE || 0) / total) * 1000) / 10 : 0 });
}));

router.get('/reports/enrollment', requirePermission('reports:view'), wrap(async (_req, res) => {
  const byDept = await prisma.studentProfile.groupBy({ by: ['departmentId'], _count: true });
  const depts = await prisma.department.findMany();
  const bySem = await prisma.studentProfile.groupBy({ by: ['semesterId'], _count: true });
  res.json({
    byDepartment: byDept.map((b: any) => ({ department: depts.find((d) => d.id === b.departmentId)?.name || '—', count: b._count })),
    bySemester: bySem.map((b: any) => ({ semesterId: b.semesterId, count: b._count })),
  });
}));

/* ══════════════════════ AUDIT LOGS ══════════════════════ */
router.get('/audit-logs', requirePermission('auditLogs:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where: any = {};
  if (req.query.entity) where.entity = req.query.entity;
  if (req.query.userId) where.userId = req.query.userId;
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { fullName: true, username: true } } } }),
  ]);
  res.json({ total, page, limit, items });
}));

/* ══════════════════════ SETTINGS ══════════════════════ */
router.get('/settings', requirePermission('settings:view', 'dashboard:view'), wrap(async (_req, res) => {
  res.json({ items: await prisma.systemSetting.findMany() });
}));

router.put('/settings', requirePermission('settings:manage'), validate(z.object({ settings: z.record(z.string()) })), wrap(async (req, res) => {
  const entries = Object.entries(req.body.settings);
  await prisma.$transaction(entries.map(([key, value]: any) =>
    prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } }),
  ));
  await audit(req, 'UPDATE', 'settings', undefined, { keys: entries.map(([k]) => k) });
  res.json({ ok: true, count: entries.length });
}));

export default router;
