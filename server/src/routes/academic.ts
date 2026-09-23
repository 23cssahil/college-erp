import { Router } from 'express';
import { z } from 'zod';
import {
  AcademicYear, Department, Course, Semester, Section, User,
  TeacherProfile, StudentProfile, Subject,
} from '../models';
import { wrap, httpError, oid } from '../lib/http';
import { validate, toDate, blankToUndef } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getHodDepartmentId } from '../middleware/scope';
import { audit } from '../middleware/audit';

const router = Router();

/* ══════════════════════ ACADEMIC YEARS ══════════════════════ */
const aySchema = z.object({
  label: z.string().min(3),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

router.get('/academic-years', requirePermission('academicYears:view', 'academicYears:manage', 'dashboard:view'), wrap(async (_req, res) => {
  const items = await AcademicYear.find().sort({ startDate: -1 });
  res.json({ items: items.map((i) => i.toJSON()) });
}));

router.post('/academic-years', requirePermission('academicYears:manage', 'academicYears:create'), validate(aySchema), wrap(async (req, res) => {
  const item = await AcademicYear.create(req.body);
  await audit(req, 'CREATE', 'academicYears', String(item._id), { label: item.label });
  res.status(201).json({ item: item.toJSON() });
}));

router.put('/academic-years/:id', requirePermission('academicYears:manage', 'academicYears:edit'), validate(aySchema.partial()), wrap(async (req, res) => {
  const item = await AcademicYear.findByIdAndUpdate(oid(req.params.id), req.body, { new: true });
  if (!item) throw httpError(404, 'Not found');
  await audit(req, 'UPDATE', 'academicYears', String(item._id));
  res.json({ item: item.toJSON() });
}));

// Activate exactly one academic year; historical data is preserved, not destroyed
router.post('/academic-years/:id/activate', requirePermission('academicYears:manage'), wrap(async (req, res) => {
  const id = oid(req.params.id);
  const ay = await AcademicYear.findById(id);
  if (!ay) throw httpError(404, 'Not found');
  await AcademicYear.updateMany({ isActive: true }, { isActive: false });
  await AcademicYear.updateOne({ _id: id }, { isActive: true });
  await audit(req, 'ACTIVATE', 'academicYears', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ DEPARTMENTS ══════════════════════ */
const deptSchema = z.object({
  code: z.string().min(1).max(15),
  name: z.string().min(2),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get('/departments', requirePermission('departments:view', 'dashboard:view'), wrap(async (req, res) => {
  let where: any = {};
  // HOD is auto-scoped to their own department unless they can manage all
  if (req.user!.role === 'HOD') {
    const hodDept = await getHodDepartmentId(req.user!);
    where = { _id: hodDept ? oid(hodDept) : null };
  }
  const docs = await Department.find(where).sort({ name: 1 })
    .populate({ path: 'hodId', as: 'hod', select: 'fullName' });
  const items = await Promise.all(docs.map(async (d: any) => {
    const j = d.toJSON();
    j._count = {
      courses: await Course.countDocuments({ departmentId: d._id }),
      students: await StudentProfile.countDocuments({ departmentId: d._id }),
      teachers: await TeacherProfile.countDocuments({ departmentId: d._id }),
    };
    return j;
  }));
  res.json({ items });
}));

router.post('/departments', requirePermission('departments:create', 'departments:manage'), validate(deptSchema), wrap(async (req, res) => {
  const item = await Department.create(req.body);
  await audit(req, 'CREATE', 'departments', String(item._id), { code: item.code });
  res.status(201).json({ item: item.toJSON() });
}));

router.put('/departments/:id', requirePermission('departments:edit', 'departments:manage'), validate(deptSchema.partial()), wrap(async (req, res) => {
  const item = await Department.findByIdAndUpdate(oid(req.params.id), req.body, { new: true });
  if (!item) throw httpError(404, 'Not found');
  await audit(req, 'UPDATE', 'departments', String(item._id));
  res.json({ item: item.toJSON() });
}));

router.delete('/departments/:id', requirePermission('departments:delete', 'departments:manage'), wrap(async (req, res) => {
  const id = oid(req.params.id);
  const count = await Course.countDocuments({ departmentId: id });
  if (count > 0) throw httpError(409, 'Department has courses; deactivate it instead');
  await Department.deleteOne({ _id: id });
  await audit(req, 'DELETE', 'departments', req.params.id);
  res.json({ ok: true });
}));

// Assign HOD (a teacher user)
router.post('/departments/:id/hod', requirePermission('departments:manage', 'departments:edit'), validate(z.object({ userId: z.string().nullish() })), wrap(async (req, res) => {
  const raw = blankToUndef(req.body.userId);
  let hodId: any = null;
  if (raw) {
    hodId = oid(raw);
    const teacher = await TeacherProfile.findOne({ userId: hodId });
    if (!teacher) throw httpError(400, 'Selected user is not a teacher');
    // clear HOD from any other department first (a user leads one dept)
    await Department.updateMany({ hodId }, { hodId: null });
  }
  const item = await Department.findByIdAndUpdate(oid(req.params.id), { hodId }, { new: true })
    .populate({ path: 'hodId', as: 'hod', select: 'fullName' });
  if (!item) throw httpError(404, 'Not found');
  await audit(req, 'ASSIGN_HOD', 'departments', String(item._id), { userId: raw });
  res.json({ item: item.toJSON() });
}));

/* ══════════════════════ COURSES ══════════════════════ */
const courseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(2),
  departmentId: z.string(),
  durationSemesters: z.coerce.number().int().min(1).max(12).default(8),
  type: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get('/courses', requirePermission('courses:view', 'dashboard:view'), wrap(async (req, res) => {
  const where: any = {};
  if (req.query.departmentId) where.departmentId = oid(req.query.departmentId as string);
  if (req.user!.role === 'HOD') {
    const hodDept = await getHodDepartmentId(req.user!);
    where.departmentId = hodDept ? oid(hodDept) : null;
  }
  const docs = await Course.find(where).sort({ name: 1 })
    .populate({ path: 'departmentId', as: 'department', select: 'code name' });
  const items = await Promise.all(docs.map(async (c: any) => {
    const j = c.toJSON();
    j._count = {
      semesters: await Semester.countDocuments({ courseId: c._id }),
      students: await StudentProfile.countDocuments({ courseId: c._id }),
    };
    return j;
  }));
  res.json({ items });
}));

router.post('/courses', requirePermission('courses:create', 'courses:manage'), validate(courseSchema), wrap(async (req, res) => {
  const item = await Course.create({ ...req.body, departmentId: oid(req.body.departmentId) });
  await audit(req, 'CREATE', 'courses', String(item._id), { code: item.code });
  res.status(201).json({ item: item.toJSON() });
}));

router.put('/courses/:id', requirePermission('courses:edit', 'courses:manage'), validate(courseSchema.partial()), wrap(async (req, res) => {
  const data: any = { ...req.body };
  if (data.departmentId) data.departmentId = oid(data.departmentId);
  const item = await Course.findByIdAndUpdate(oid(req.params.id), data, { new: true });
  if (!item) throw httpError(404, 'Not found');
  await audit(req, 'UPDATE', 'courses', String(item._id));
  res.json({ item: item.toJSON() });
}));

router.delete('/courses/:id', requirePermission('courses:delete', 'courses:manage'), wrap(async (req, res) => {
  const id = oid(req.params.id);
  const count = await StudentProfile.countDocuments({ courseId: id });
  if (count > 0) throw httpError(409, 'Course has enrolled students; deactivate instead');
  await Course.deleteOne({ _id: id });
  await audit(req, 'DELETE', 'courses', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ SEMESTERS ══════════════════════ */
router.get('/semesters', requirePermission('semesters:view', 'dashboard:view'), wrap(async (req, res) => {
  const where: any = {};
  if (req.query.courseId) where.courseId = oid(req.query.courseId as string);
  if (req.query.departmentId) {
    const courses = await Course.find({ departmentId: oid(req.query.departmentId as string) }).select('_id');
    where.courseId = { $in: courses.map((c) => c._id) };
  }
  const docs = await Semester.find(where)
    .populate({ path: 'courseId', as: 'course', select: 'name code' });
  const items = await Promise.all(docs.map(async (s: any) => {
    const j = s.toJSON();
    // composed label so dropdowns can tell which course/department a semester belongs to
    j.label = `${j.course?.code || '—'} · ${j.name || `Semester ${j.number}`}`;
    j._count = {
      sections: await Section.countDocuments({ semesterId: s._id }),
      subjects: await Subject.countDocuments({ semesterId: s._id }),
    };
    return j;
  }));
  // sort by course code then number
  items.sort((a: any, b: any) => (a.course?.code || '').localeCompare(b.course?.code || '') || a.number - b.number);
  res.json({ items });
}));

router.post('/semesters', requirePermission('semesters:create', 'semesters:manage', 'courses:manage'), validate(z.object({
  courseId: z.string(), number: z.coerce.number().int().min(1), name: z.string().optional(),
})), wrap(async (req, res) => {
  const { courseId, number } = req.body;
  const item = await Semester.create({ courseId: oid(courseId), number, name: req.body.name || `Semester ${number}` });
  await audit(req, 'CREATE', 'semesters', String(item._id));
  res.status(201).json({ item: item.toJSON() });
}));

// convenience: auto-create all semesters for a course
router.post('/courses/:id/semesters/bootstrap', requirePermission('semesters:manage', 'courses:manage'), wrap(async (req, res) => {
  const course = await Course.findById(oid(req.params.id));
  if (!course) throw httpError(404, 'Course not found');
  let created = 0;
  for (let n = 1; n <= course.durationSemesters; n++) {
    const exists = await Semester.findOne({ courseId: course._id, number: n });
    if (!exists) { await Semester.create({ courseId: course._id, number: n, name: `Semester ${n}` }); created++; }
  }
  await audit(req, 'BOOTSTRAP', 'semesters', String(course._id), { created });
  res.json({ ok: true, created });
}));

router.delete('/semesters/:id', requirePermission('semesters:delete', 'semesters:manage'), wrap(async (req, res) => {
  await Semester.deleteOne({ _id: oid(req.params.id) });
  await audit(req, 'DELETE', 'semesters', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ SECTIONS ══════════════════════ */
const sectionSchema = z.object({
  semesterId: z.string(),
  name: z.string().min(1).max(5),
  capacity: z.coerce.number().int().min(1).default(60),
  coordinatorId: z.string().nullish(),
  isActive: z.boolean().optional(),
});

router.get('/sections', requirePermission('sections:view', 'dashboard:view'), wrap(async (req, res) => {
  const where: any = {};
  if (req.query.semesterId) where.semesterId = oid(req.query.semesterId as string);
  if (req.query.departmentId && !req.query.semesterId) {
    // sections don't store a department; resolve dept → its courses → their semesters
    const courses = await Course.find({ departmentId: oid(req.query.departmentId as string) }).select('_id');
    const sems = await Semester.find({ courseId: { $in: courses.map((c) => c._id) } }).select('_id');
    where.semesterId = { $in: sems.map((s) => s._id) };
  }
  const docs = await Section.find(where)
    .populate({ path: 'coordinatorId', as: 'coordinator', select: 'fullName' })
    .populate({ path: 'semesterId', as: 'semester', populate: { path: 'courseId', select: 'name code' } });
  const items = await Promise.all(docs.map(async (s: any) => {
    const j = s.toJSON();
    j._count = { students: await StudentProfile.countDocuments({ sectionId: s._id }) };
    return j;
  }));
  items.sort((a: any, b: any) =>
    (a.semester?.course?.name || '').localeCompare(b.semester?.course?.name || '')
    || (a.semester?.number || 0) - (b.semester?.number || 0)
    || (a.name || '').localeCompare(b.name || ''));
  res.json({ items });
}));

router.post('/sections', requirePermission('sections:create', 'sections:manage'), validate(sectionSchema), wrap(async (req, res) => {
  const data: any = {
    semesterId: oid(req.body.semesterId), name: req.body.name, capacity: req.body.capacity,
  };
  if (blankToUndef(req.body.coordinatorId)) data.coordinatorId = oid(req.body.coordinatorId);
  const item = await Section.create(data);
  await item.populate({ path: 'coordinatorId', as: 'coordinator', select: 'fullName' });
  await audit(req, 'CREATE', 'sections', String(item._id));
  res.status(201).json({ item: item.toJSON() });
}));

router.put('/sections/:id', requirePermission('sections:edit', 'sections:manage'), validate(sectionSchema.partial()), wrap(async (req, res) => {
  const data: any = { ...req.body };
  if (data.semesterId) data.semesterId = oid(data.semesterId);
  if ('coordinatorId' in data) data.coordinatorId = blankToUndef(data.coordinatorId) ? oid(data.coordinatorId) : null;
  const item = await Section.findByIdAndUpdate(oid(req.params.id), data, { new: true })
    .populate({ path: 'coordinatorId', as: 'coordinator', select: 'fullName' });
  if (!item) throw httpError(404, 'Not found');
  await audit(req, 'UPDATE', 'sections', String(item._id));
  res.json({ item: item.toJSON() });
}));

router.delete('/sections/:id', requirePermission('sections:delete', 'sections:manage'), wrap(async (req, res) => {
  const id = oid(req.params.id);
  const count = await StudentProfile.countDocuments({ sectionId: id });
  if (count > 0) throw httpError(409, 'Section has students');
  await Section.deleteOne({ _id: id });
  await audit(req, 'DELETE', 'sections', req.params.id);
  res.json({ ok: true });
}));

export default router;
