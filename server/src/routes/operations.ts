import { Router } from 'express';
import { z } from 'zod';
import {
  Period, TimetableSlot, StudentProfile, AttendanceRecord,
} from '../models';
import { wrap, httpError, oid } from '../lib/http';
import { validate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getStudentProfileId, getParentChildStudentIds, studentScopeWhere } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ PERIODS ══════════════════════ */
router.get('/periods', requirePermission('timetable:view', 'attendance:view'), wrap(async (_req, res) => {
  const items = await Period.find().sort({ number: 1 });
  res.json({ items: items.map((i) => i.toJSON()) });
}));

router.post('/periods', requirePermission('timetable:manage', 'settings:manage'), validate(z.object({
  number: z.coerce.number().int(), label: z.string().optional(), startTime: z.string(), endTime: z.string(), breakAfter: z.boolean().optional(),
})), wrap(async (req, res) => {
  const b = req.body;
  const item = await Period.findOneAndUpdate(
    { number: b.number },
    { label: b.label || `P${b.number}`, startTime: b.startTime, endTime: b.endTime, breakAfter: b.breakAfter },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await audit(req, 'SAVE', 'periods', String(item._id));
  res.json({ item: item.toJSON() });
}));

/* ══════════════════════ TIMETABLE ══════════════════════ */
router.get('/timetable', requirePermission('timetable:view'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  if (!sectionId) throw httpError(400, 'sectionId required');
  const items = await TimetableSlot.find({ sectionId: oid(sectionId) })
    .populate({ path: 'subjectId', as: 'subject', select: 'code name type' })
    .populate({ path: 'teacherId', as: 'teacher', populate: { path: 'userId', select: 'fullName' } })
    .sort({ periodNumber: 1, day: 1 });
  res.json({ items: items.map((i: any) => i.toJSON()) });
}));

const slotSchema = z.object({
  sectionId: z.string(), day: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']),
  periodNumber: z.coerce.number().int(), subjectId: z.string().nullish(), teacherId: z.string().nullish(), room: z.string().optional(),
});
router.post('/timetable/slot', requirePermission('timetable:manage', 'timetable:create'), validate(slotSchema), wrap(async (req, res) => {
  const b = req.body;
  const set = {
    subjectId: b.subjectId ? oid(b.subjectId) : null,
    teacherId: b.teacherId ? oid(b.teacherId) : null,
    room: b.room,
  };
  const item = await TimetableSlot.findOneAndUpdate(
    { sectionId: oid(b.sectionId), day: b.day, periodNumber: b.periodNumber },
    set,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await audit(req, 'SAVE', 'timetable', String(item._id));
  res.json({ item: item.toJSON() });
}));

router.delete('/timetable/slot/:id', requirePermission('timetable:manage', 'timetable:delete'), wrap(async (req, res) => {
  await TimetableSlot.deleteOne({ _id: oid(req.params.id) });
  await audit(req, 'DELETE', 'timetable', req.params.id);
  res.json({ ok: true });
}));

// Publish all draft slots for a section
router.post('/timetable/publish', requirePermission('timetable:manage'), validate(z.object({ sectionId: z.string(), publish: z.boolean().default(true) })), wrap(async (req, res) => {
  const r = await TimetableSlot.updateMany({ sectionId: oid(req.body.sectionId) }, { isPublished: req.body.publish });
  await audit(req, 'PUBLISH', 'timetable', req.body.sectionId, { count: r.modifiedCount });
  res.json({ ok: true, count: r.modifiedCount });
}));

/* ══════════════════════ ATTENDANCE ══════════════════════ */
// Roster of students for a section (for the marking screen)
router.get('/attendance/roster', requirePermission('attendance:view', 'attendance:create'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  if (!sectionId) throw httpError(400, 'sectionId required');
  const items = await StudentProfile.find({ sectionId: oid(sectionId), status: 'STUDYING' })
    .sort({ rollNo: 1 }).populate({ path: 'userId', as: 'user', select: 'fullName' });
  res.json({ items: items.map((i: any) => i.toJSON()) });
}));

// Existing records for a given section+date+period (pre-fill)
router.get('/attendance', requirePermission('attendance:view'), wrap(async (req, res) => {
  const { sectionId, date, periodNumber } = req.query as any;
  const scope = await studentScopeWhere(req.user!);
  const where: any = scope ? { ...scope } : {};
  if (sectionId) where.sectionId = oid(sectionId);
  if (date) where.date = new Date(date);
  if (periodNumber) where.periodNumber = Number(periodNumber);
  const items = await AttendanceRecord.find(where)
    .populate({ path: 'studentId', as: 'student', select: 'rollNo', populate: { path: 'userId', select: 'fullName' } });
  res.json({ items: items.map((i: any) => i.toJSON()) });
}));

// Bulk mark attendance for a class session
router.post('/attendance/mark', requirePermission('attendance:create', 'attendance:manage'), validate(z.object({
  sectionId: z.string(), subjectId: z.string().nullish(), date: z.string(), periodNumber: z.coerce.number().int(),
  records: z.array(z.object({ studentId: z.string(), status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']), remarks: z.string().optional() })),
})), wrap(async (req, res) => {
  const b = req.body;
  const date = new Date(b.date); date.setHours(0, 0, 0, 0);
  await Promise.all(b.records.map((r: any) =>
    AttendanceRecord.findOneAndUpdate(
      { studentId: oid(r.studentId), date, periodNumber: b.periodNumber },
      {
        status: r.status, remarks: r.remarks,
        subjectId: b.subjectId ? oid(b.subjectId) : null, markedBy: oid(req.user!.id),
        sectionId: oid(b.sectionId),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )));
  await audit(req, 'MARK', 'attendance', b.sectionId, { date: b.date, period: b.periodNumber, count: b.records.length });
  res.json({ ok: true, count: b.records.length });
}));

// Attendance summary — percentage per student for a section (scoped)
router.get('/attendance/summary', requirePermission('attendance:view'), wrap(async (req, res) => {
  const sectionId = req.query.sectionId as string;
  const where: any = {};
  if (sectionId) where.sectionId = oid(sectionId);
  if (req.user!.role === 'STUDENT') {
    const sp = await getStudentProfileId(req.user!);
    where.studentId = sp ? oid(sp) : null;
  } else if (req.user!.role === 'PARENT') {
    const ids = await getParentChildStudentIds(req.user!);
    where.studentId = { $in: ids.map((x) => oid(x)) };
  }
  const records = await AttendanceRecord.find(where)
    .populate({ path: 'studentId', as: 'student', select: 'rollNo', populate: { path: 'userId', select: 'fullName' } });

  const byStudent: Record<string, { total: number; present: number; info: any }> = {};
  for (const rr of records as any[]) {
    const r = rr.toJSON();
    const s = r.student;
    if (!s) continue;
    const key = s.id as string;
    byStudent[key] = byStudent[key] || { total: 0, present: 0, info: s };
    byStudent[key].total++;
    if (r.status === 'PRESENT' || r.status === 'LATE') byStudent[key].present++;
  }
  const items = Object.values(byStudent).map((v) => ({
    studentId: v.info.id, rollNo: v.info.rollNo, fullName: v.info.user?.fullName,
    total: v.total, present: v.present, percentage: v.total ? Math.round((v.present / v.total) * 1000) / 10 : 0,
  }));
  res.json({ items });
}));

export default router;
