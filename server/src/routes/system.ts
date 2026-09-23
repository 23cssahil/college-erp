import { Router } from 'express';
import { z } from 'zod';
import {
  Notice, StudentProfile, AttendanceRecord, FeeInvoice, TimetableSlot, Exam,
  ParentLink, TeacherAllocation, ExamSubject, ExamResult, Section, Course,
  Department, TeacherProfile, Subject, AcademicYear, AuditLog, SystemSetting,
} from '../models';
import { wrap, httpError, oid, parsePagination } from '../lib/http';
import { validate } from '../lib/validate';
import { authenticate, requirePermission } from '../middleware/auth';
import { getHodDepartmentId, getTeacherProfileId, getCoordinatorSectionIds } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ DASHBOARD (role-aware) ══════════════════════ */
router.get('/dashboard', authenticate, wrap(async (req, res) => {
  const user = req.user!;
  const role = user.role;

  const noticeDocs = await Notice.find({ $or: [{ expiryAt: null }, { expiryAt: { $gte: new Date() } }] })
    .sort({ publishAt: -1 }).limit(5)
    .populate({ path: 'createdBy', as: 'author', select: 'fullName' });
  const notices = noticeDocs.map((n: any) => n.toJSON());

  if (role === 'STUDENT') {
    const sp: any = await StudentProfile.findOne({ userId: oid(user.id) }).populate([
      { path: 'courseId', as: 'course' }, { path: 'sectionId', as: 'section' },
      { path: 'semesterId', as: 'semester' }, { path: 'departmentId', as: 'department' },
      { path: 'userId', as: 'user', select: 'photoUrl' },
    ]);
    if (!sp) return res.json({ role, cards: [], notices });
    const spj: any = sp.toJSON();
    const att = await AttendanceRecord.aggregate([{ $match: { studentId: sp._id } }, { $group: { _id: '$status', c: { $sum: 1 } } }]);
    let total = 0, present = 0;
    for (const a of att) { total += a.c; if (a._id === 'PRESENT' || a._id === 'LATE') present += a.c; }
    const feeAgg = await FeeInvoice.aggregate([{ $match: { studentId: sp._id } }, { $group: { _id: null, totalAmount: { $sum: '$totalAmount' }, paidAmount: { $sum: '$paidAmount' } } }]);
    const due = feeAgg[0] || { totalAmount: 0, paidAmount: 0 };
    const timetableDocs = spj.sectionId ? await TimetableSlot.find({ sectionId: spj.sectionId, isPublished: true }).populate([
      { path: 'subjectId', as: 'subject' }, { path: 'teacherId', as: 'teacher', populate: { path: 'userId', as: 'user' } },
    ]).sort({ day: 1, periodNumber: 1 }) : [];
    const upcomingExamsDocs = await Exam.find({ startDate: { $gte: new Date() } }).sort({ startDate: 1 }).limit(5);
    const upcomingExams = upcomingExamsDocs.map((e: any) => e.toJSON());
    return res.json({
      role, notices,
      profile: { name: user.fullName, course: spj.course?.name, department: spj.department?.code, semester: spj.semester?.number, section: spj.section?.name, rollNo: spj.rollNo, photoUrl: spj.user?.photoUrl },
      cards: [
        { label: 'Attendance', value: total ? Math.round((present / total) * 100) + '%' : '—', tone: total && present / total < 0.75 ? 'warn' : 'good' },
        { label: 'Fee Due', value: '₹' + ((due.totalAmount || 0) - (due.paidAmount || 0)).toLocaleString('en-IN'), tone: (due.totalAmount || 0) > (due.paidAmount || 0) ? 'warn' : 'good' },
        { label: 'Upcoming Exams', value: upcomingExams.length, tone: 'info' },
      ],
      timetable: timetableDocs.map((t: any) => t.toJSON()), upcomingExams,
    });
  }

  if (role === 'PARENT') {
    const links = await ParentLink.find({ parentId: oid(user.id) }).populate({
      path: 'studentId', as: 'student',
      populate: [{ path: 'userId', as: 'user', select: 'fullName' }, { path: 'courseId', as: 'course' }, { path: 'sectionId', as: 'section' }],
    });
    return res.json({
      role, notices,
      children: links.map((l: any) => {
        const s = l.toJSON().student; if (!s) return null;
        return { id: s.id, name: s.user?.fullName, rollNo: s.rollNo, course: s.course?.name, section: s.section?.name };
      }).filter(Boolean),
    });
  }

  if (role === 'TEACHER') {
    const tpId = await getTeacherProfileId(user);
    const allocsRaw: any[] = tpId ? await TeacherAllocation.find({ teacherId: oid(tpId) }).populate([
      { path: 'subjectId', as: 'subject' }, { path: 'sectionId', as: 'section' },
    ]) : [];
    const allocs = allocsRaw.map((a: any) => a.toJSON());
    const sectionIds = Array.from(new Set(allocs.map((a: any) => String(a.sectionId))));
    const todaysSlots = tpId ? await TimetableSlot.find({ teacherId: oid(tpId), sectionId: { $in: sectionIds.map((x) => oid(x)) } }) : [];
    let pendingMarks = 0;
    if (tpId) {
      const subjIds = Array.from(new Set(allocs.map((a: any) => String(a.subjectId))));
      const esList = await ExamSubject.find({ subjectId: { $in: subjIds.map((x) => oid(x)) } }).select('_id');
      const esIds = esList.map((e: any) => String(e._id));
      const withResults = await ExamResult.distinct('examSubjectId', { examSubjectId: { $in: esIds.map((x) => oid(x)) } });
      const withSet = new Set(withResults.map(String));
      pendingMarks = esIds.filter((id) => !withSet.has(id)).length;
    }
    return res.json({
      role, notices,
      cards: [
        { label: 'My Subjects', value: allocs.length, tone: 'info' },
        { label: 'Sections', value: sectionIds.length, tone: 'info' },
        { label: 'Classes Today', value: todaysSlots.length, tone: 'good' },
        { label: 'Marks Pending', value: pendingMarks, tone: pendingMarks ? 'warn' : 'good' },
      ],
      allocations: allocs.map((a: any) => ({ subject: a.subject?.name, section: a.section?.name })),
    });
  }

  if (role === 'COORDINATOR') {
    const sectionIds = await getCoordinatorSectionIds(user);
    const studentCount = await StudentProfile.countDocuments({ sectionId: { $in: sectionIds.map((x) => oid(x)) } });
    const sections = await Section.find({ _id: { $in: sectionIds.map((x) => oid(x)) } })
      .populate({ path: 'semesterId', as: 'semester', populate: { path: 'courseId', as: 'course', select: 'name' } });
    return res.json({
      role, notices,
      cards: [
        { label: 'My Sections', value: sectionIds.length, tone: 'info' },
        { label: 'Students', value: studentCount, tone: 'good' },
      ],
      sections: sections.map((s: any) => s.toJSON()),
    });
  }

  if (role === 'HOD') {
    const deptId = await getHodDepartmentId(user);
    const dOid = deptId ? oid(deptId) : null;
    const [students, teachers, courses, subjects] = await Promise.all([
      StudentProfile.countDocuments({ departmentId: dOid }),
      TeacherProfile.countDocuments({ departmentId: dOid }),
      Course.countDocuments({ departmentId: dOid }),
      Subject.countDocuments({ departmentId: dOid }),
    ]);
    const dept = deptId ? await Department.findById(dOid).select('code name') : null;
    return res.json({
      role, notices,
      cards: [
        { label: 'Students', value: students, tone: 'info' }, { label: 'Teachers', value: teachers, tone: 'info' },
        { label: 'Courses', value: courses, tone: 'good' }, { label: 'Subjects', value: subjects, tone: 'good' },
      ],
      department: dept ? dept.toJSON() : null,
    });
  }

  // ADMIN / PRINCIPAL / SUPER_ADMIN / EXAM_CELL / ACCOUNTANT
  const [students, teachers, departments, courses, activeYear] = await Promise.all([
    StudentProfile.countDocuments(), TeacherProfile.countDocuments(), Department.countDocuments(), Course.countDocuments(),
    AcademicYear.findOne({ isActive: true }),
  ]);
  const activeYearJson = activeYear ? (activeYear as any).toJSON() : null;

  if (role === 'ACCOUNTANT') {
    const agg = await FeeInvoice.aggregate([{ $group: { _id: null, totalAmount: { $sum: '$totalAmount' }, paidAmount: { $sum: '$paidAmount' } } }]);
    const s = agg[0] || { totalAmount: 0, paidAmount: 0 };
    return res.json({
      role, notices, activeYear: activeYearJson,
      cards: [
        { label: 'Total Billed', value: '₹' + (s.totalAmount || 0).toLocaleString('en-IN'), tone: 'info' },
        { label: 'Collected', value: '₹' + (s.paidAmount || 0).toLocaleString('en-IN'), tone: 'good' },
        { label: 'Outstanding', value: '₹' + ((s.totalAmount || 0) - (s.paidAmount || 0)).toLocaleString('en-IN'), tone: 'warn' },
      ],
    });
  }

  const deptDocs = await Department.find().sort({ name: 1 });
  const [stuCounts, teaCounts] = await Promise.all([
    StudentProfile.aggregate([{ $group: { _id: '$departmentId', c: { $sum: 1 } } }]),
    TeacherProfile.aggregate([{ $group: { _id: '$departmentId', c: { $sum: 1 } } }]),
  ]);
  const stuMap: Record<string, number> = Object.fromEntries(stuCounts.map((x: any) => [String(x._id), x.c]));
  const teaMap: Record<string, number> = Object.fromEntries(teaCounts.map((x: any) => [String(x._id), x.c]));

  return res.json({
    role, notices, activeYear: activeYearJson,
    cards: [
      { label: 'Students', value: students, tone: 'info' },
      { label: 'Teachers', value: teachers, tone: 'info' },
      { label: 'Departments', value: departments, tone: 'good' },
      { label: 'Courses', value: courses, tone: 'good' },
    ],
    deptBreakdown: deptDocs.map((d: any) => ({ ...d.toJSON(), _count: { students: stuMap[String(d._id)] || 0, teachers: teaMap[String(d._id)] || 0 } })),
  });
}));

/* ══════════════════════ REPORTS ══════════════════════ */
router.get('/reports/attendance-overview', requirePermission('reports:view', 'attendance:view'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  if (!sectionId) throw httpError(400, 'sectionId required');
  const agg = await AttendanceRecord.aggregate([{ $match: { sectionId: oid(sectionId) } }, { $group: { _id: '$status', c: { $sum: 1 } } }]);
  const map: any = {};
  for (const r of agg) map[r._id] = r.c;
  const total = Object.values(map).reduce((s: number, n: any) => s + n, 0);
  res.json({ statusCounts: map, total, percentage: total ? Math.round(((map.PRESENT || 0) + (map.LATE || 0)) / total * 1000) / 10 : 0 });
}));

router.get('/reports/enrollment', requirePermission('reports:view'), wrap(async (_req, res) => {
  const [byDept, depts, bySem] = await Promise.all([
    StudentProfile.aggregate([{ $group: { _id: '$departmentId', c: { $sum: 1 } } }]),
    Department.find(),
    StudentProfile.aggregate([{ $group: { _id: '$semesterId', c: { $sum: 1 } } }]),
  ]);
  res.json({
    byDepartment: byDept.map((b: any) => ({ department: depts.find((d: any) => String(d._id) === String(b._id))?.name || '—', count: b.c })),
    bySemester: bySem.map((b: any) => ({ semesterId: String(b._id), count: b.c })),
  });
}));

/* ══════════════════════ AUDIT LOGS ══════════════════════ */
router.get('/audit-logs', requirePermission('auditLogs:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where: any = {};
  if (req.query.entity) where.entity = req.query.entity;
  if (req.query.userId) where.userId = oid(req.query.userId as string);
  const [total, docs] = await Promise.all([
    AuditLog.countDocuments(where),
    AuditLog.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'userId', as: 'user', select: 'fullName username' }),
  ]);
  res.json({ total, page, limit, items: docs.map((d: any) => d.toJSON()) });
}));

/* ══════════════════════ SETTINGS ══════════════════════ */
router.get('/settings', requirePermission('settings:view', 'dashboard:view'), wrap(async (_req, res) => {
  res.json({ items: await SystemSetting.find() });
}));

router.put('/settings', requirePermission('settings:manage'), validate(z.object({ settings: z.record(z.string()) })), wrap(async (req, res) => {
  const entries = Object.entries(req.body.settings);
  await Promise.all(entries.map(([key, value]) =>
    SystemSetting.findOneAndUpdate({ key }, { value: String(value) }, { upsert: true, new: true, setDefaultsOnInsert: true }),
  ));
  await audit(req, 'UPDATE', 'settings', undefined, { keys: entries.map(([k]) => k) });
  res.json({ ok: true, count: entries.length });
}));

export default router;
