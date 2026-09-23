import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError } from '../lib/http';
import { validate, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getStudentProfileId, getParentChildStudentIds, getTeacherProfileId, getCoordinatorSectionIds, studentScopeWhere } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ PERIODS ══════════════════════ */
router.get('/periods', requirePermission('timetable:view', 'attendance:view'), wrap(async (_req, res) => {
  res.json({ items: await prisma.period.findMany({ orderBy: { number: 'asc' } }) });
}));

router.post('/periods', requirePermission('timetable:manage', 'settings:manage'), validate(z.object({
  number: z.coerce.number().int(), label: z.string().optional(), startTime: z.string(), endTime: z.string(), breakAfter: z.boolean().optional(),
})), wrap(async (req, res) => {
  const item = await prisma.period.upsert({
    where: { number: req.body.number },
    create: { ...req.body, label: req.body.label || `P${req.body.number}` },
    update: req.body,
  });
  await audit(req, 'SAVE', 'periods', String(item.id));
  res.json({ item });
}));

/* ══════════════════════ TIMETABLE ══════════════════════ */
router.get('/timetable', requirePermission('timetable:view'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  if (!sectionId) throw httpError(400, 'sectionId required');
  const items = await prisma.timetableSlot.findMany({
    where: { sectionId },
    include: {
      subject: { select: { id: true, code: true, name: true, type: true } },
      teacher: { select: { id: true, user: { select: { fullName: true } } } },
    },
    orderBy: [{ periodNumber: 'asc' }, { day: 'asc' }],
  });
  res.json({ items });
}));

const slotSchema = z.object({
  sectionId: z.string(), day: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']),
  periodNumber: z.coerce.number().int(), subjectId: z.string().nullish(), teacherId: z.string().nullish(), room: z.string().optional(),
});
router.post('/timetable/slot', requirePermission('timetable:manage', 'timetable:create'), validate(slotSchema), wrap(async (req, res) => {
  const b = req.body;
  const data = {
    subjectId: b.subjectId || null, teacherId: b.teacherId || null, room: b.room,
  };
  const item = await prisma.timetableSlot.upsert({
    where: { sectionId_day_periodNumber: { sectionId: b.sectionId, day: b.day, periodNumber: b.periodNumber } },
    create: { sectionId: b.sectionId, day: b.day, periodNumber: b.periodNumber, ...data },
    update: data,
  });
  await audit(req, 'SAVE', 'timetable', item.id);
  res.json({ item });
}));

router.delete('/timetable/slot/:id', requirePermission('timetable:manage', 'timetable:delete'), wrap(async (req, res) => {
  await prisma.timetableSlot.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'timetable', req.params.id);
  res.json({ ok: true });
}));

// Publish all draft slots for a section
router.post('/timetable/publish', requirePermission('timetable:manage'), validate(z.object({ sectionId: z.string(), publish: z.boolean().default(true) })), wrap(async (req, res) => {
  const { count } = await prisma.timetableSlot.updateMany({ where: { sectionId: req.body.sectionId }, data: { isPublished: req.body.publish } });
  await audit(req, 'PUBLISH', 'timetable', req.body.sectionId, { count });
  res.json({ ok: true, count });
}));

/* ══════════════════════ ATTENDANCE ══════════════════════ */
// Roster of students for a section (for the marking screen)
router.get('/attendance/roster', requirePermission('attendance:view', 'attendance:create'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  if (!sectionId) throw httpError(400, 'sectionId required');
  const items = await prisma.studentProfile.findMany({
    where: { sectionId, status: 'STUDYING' }, orderBy: { rollNo: 'asc' },
    include: { user: { select: { fullName: true } } },
  });
  res.json({ items });
}));

// Existing records for a given section+date+period (pre-fill)
router.get('/attendance', requirePermission('attendance:view'), wrap(async (req, res) => {
  const { sectionId, date, periodNumber } = req.query as any;
  const scope = await studentScopeWhere(req.user!);
  const where: any = {};
  if (sectionId) where.sectionId = sectionId;
  if (date) where.date = new Date(date);
  if (periodNumber) where.periodNumber = Number(periodNumber);
  if (scope) where.AND = [scope];
  const items = await prisma.attendanceRecord.findMany({ where, include: { student: { select: { id: true, rollNo: true, user: { select: { fullName: true } } } } } });
  res.json({ items });
}));

// Bulk mark attendance for a class session
router.post('/attendance/mark', requirePermission('attendance:create', 'attendance:manage'), validate(z.object({
  sectionId: z.string(), subjectId: z.string().nullish(), date: z.string(), periodNumber: z.coerce.number().int(),
  records: z.array(z.object({ studentId: z.string(), status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']), remarks: z.string().optional() })),
})), wrap(async (req, res) => {
  const b = req.body;
  const date = new Date(b.date); date.setHours(0, 0, 0, 0);
  const ops = b.records.map((r: any) =>
    prisma.attendanceRecord.upsert({
      where: { studentId_date_periodNumber: { studentId: r.studentId, date, periodNumber: b.periodNumber } },
      create: { studentId: r.studentId, date, periodNumber: b.periodNumber, sectionId: b.sectionId, subjectId: b.subjectId || null, status: r.status, remarks: r.remarks, markedBy: req.user!.id },
      update: { status: r.status, remarks: r.remarks, subjectId: b.subjectId || null, markedBy: req.user!.id },
    }),
  );
  await prisma.$transaction(ops);
  await audit(req, 'MARK', 'attendance', b.sectionId, { date: b.date, period: b.periodNumber, count: b.records.length });
  res.json({ ok: true, count: b.records.length });
}));

// Attendance summary — percentage per student for a section (scoped)
router.get('/attendance/summary', requirePermission('attendance:view'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  let studentIds: string[] | null = null;
  if (req.user!.role === 'STUDENT') {
    const sp = await getStudentProfileId(req.user!);
    studentIds = sp ? [sp] : [];
  } else if (req.user!.role === 'PARENT') {
    studentIds = await getParentChildStudentIds(req.user!);
  }
  const where: any = {};
  if (sectionId) where.sectionId = sectionId;
  if (studentIds) where.studentId = { in: studentIds };
  const records = await prisma.attendanceRecord.findMany({
    where,
    include: { student: { select: { id: true, rollNo: true, user: { select: { fullName: true } } } } },
  });
  const byStudent: Record<string, { total: number; present: number; info: any }> = {};
  for (const r of records) {
    const s = r.student!;
    byStudent[s.id] = byStudent[s.id] || { total: 0, present: 0, info: s };
    byStudent[s.id].total++;
    if (r.status === 'PRESENT' || r.status === 'LATE') byStudent[s.id].present++;
  }
  const items = Object.values(byStudent).map((v) => ({
    studentId: v.info.id, rollNo: v.info.rollNo, fullName: v.info.user.fullName,
    total: v.total, present: v.present, percentage: v.total ? Math.round((v.present / v.total) * 1000) / 10 : 0,
  }));
  res.json({ items });
}));

export default router;
