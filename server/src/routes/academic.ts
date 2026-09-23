import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError } from '../lib/http';
import { validate, toDate, toBool, blankToUndef } from '../lib/validate';
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
  res.json({ items: await prisma.academicYear.findMany({ orderBy: { startDate: 'desc' } }) });
}));

router.post('/academic-years', requirePermission('academicYears:manage', 'academicYears:create'), validate(aySchema), wrap(async (req, res) => {
  const item = await prisma.academicYear.create({ data: req.body });
  await audit(req, 'CREATE', 'academicYears', item.id, { label: item.label });
  res.status(201).json({ item });
}));

router.put('/academic-years/:id', requirePermission('academicYears:manage', 'academicYears:edit'), validate(aySchema.partial()), wrap(async (req, res) => {
  const item = await prisma.academicYear.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'UPDATE', 'academicYears', item.id);
  res.json({ item });
}));

// Activate exactly one academic year; historical data is preserved, not destroyed
router.post('/academic-years/:id/activate', requirePermission('academicYears:manage'), wrap(async (req, res) => {
  const id = req.params.id;
  await prisma.academicYear.findUniqueOrThrow({ where: { id } });
  await prisma.$transaction([
    prisma.academicYear.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.academicYear.update({ where: { id }, data: { isActive: true } }),
  ]);
  await audit(req, 'ACTIVATE', 'academicYears', id);
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
    where = { id: hodDept || '__none__' };
  }
  const items = await prisma.department.findMany({
    where,
    include: { hod: { select: { id: true, fullName: true } }, _count: { select: { courses: true, students: true, teachers: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ items });
}));

router.post('/departments', requirePermission('departments:create', 'departments:manage'), validate(deptSchema), wrap(async (req, res) => {
  const item = await prisma.department.create({ data: req.body });
  await audit(req, 'CREATE', 'departments', item.id, { code: item.code });
  res.status(201).json({ item });
}));

router.put('/departments/:id', requirePermission('departments:edit', 'departments:manage'), validate(deptSchema.partial()), wrap(async (req, res) => {
  const item = await prisma.department.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'UPDATE', 'departments', item.id);
  res.json({ item });
}));

router.delete('/departments/:id', requirePermission('departments:delete', 'departments:manage'), wrap(async (req, res) => {
  const count = await prisma.course.count({ where: { departmentId: req.params.id } });
  if (count > 0) throw httpError(409, 'Department has courses; deactivate it instead');
  await prisma.department.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'departments', req.params.id);
  res.json({ ok: true });
}));

// Assign HOD (a teacher user)
router.post('/departments/:id/hod', requirePermission('departments:manage', 'departments:edit'), validate(z.object({ userId: z.string().nullish() })), wrap(async (req, res) => {
  const userId = blankToUndef(req.body.userId) || null;
  if (userId) {
    const teacher = await prisma.teacherProfile.findFirst({ where: { userId } });
    if (!teacher) throw httpError(400, 'Selected user is not a teacher');
  }
  // clear HOD from any other department first (a user leads one dept)
  if (userId) await prisma.department.updateMany({ where: { hodId: userId }, data: { hodId: null } });
  const item = await prisma.department.update({ where: { id: req.params.id }, data: { hodId: userId }, include: { hod: { select: { id: true, fullName: true } } } });
  await audit(req, 'ASSIGN_HOD', 'departments', item.id, { userId });
  res.json({ item });
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
  if (req.query.departmentId) where.departmentId = req.query.departmentId;
  if (req.user!.role === 'HOD') {
    const hodDept = await getHodDepartmentId(req.user!);
    where.departmentId = hodDept || '__none__';
  }
  const items = await prisma.course.findMany({
    where,
    include: { department: { select: { id: true, code: true, name: true } }, _count: { select: { semesters: true, students: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ items });
}));

router.post('/courses', requirePermission('courses:create', 'courses:manage'), validate(courseSchema), wrap(async (req, res) => {
  const item = await prisma.course.create({ data: req.body });
  await audit(req, 'CREATE', 'courses', item.id, { code: item.code });
  res.status(201).json({ item });
}));

router.put('/courses/:id', requirePermission('courses:edit', 'courses:manage'), validate(courseSchema.partial()), wrap(async (req, res) => {
  const item = await prisma.course.update({ where: { id: req.params.id }, data: req.body });
  await audit(req, 'UPDATE', 'courses', item.id);
  res.json({ item });
}));

router.delete('/courses/:id', requirePermission('courses:delete', 'courses:manage'), wrap(async (req, res) => {
  const count = await prisma.studentProfile.count({ where: { courseId: req.params.id } });
  if (count > 0) throw httpError(409, 'Course has enrolled students; deactivate instead');
  await prisma.course.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'courses', req.params.id);
  res.json({ ok: true });
}));

/* ══════════════════════ SEMESTERS ══════════════════════ */
router.get('/semesters', requirePermission('semesters:view', 'dashboard:view'), wrap(async (req, res) => {
  const where: any = {};
  if (req.query.courseId) where.courseId = req.query.courseId;
  const items = await prisma.semester.findMany({
    where,
    include: { course: { select: { id: true, name: true, code: true } }, _count: { select: { sections: true, subjects: true } } },
    orderBy: [{ course: { name: 'asc' } }, { number: 'asc' }],
  });
  res.json({ items });
}));

router.post('/semesters', requirePermission('semesters:create', 'semesters:manage', 'courses:manage'), validate(z.object({
  courseId: z.string(), number: z.coerce.number().int().min(1), name: z.string().optional(),
})), wrap(async (req, res) => {
  const { courseId, number } = req.body;
  const item = await prisma.semester.create({ data: { courseId, number, name: req.body.name || `Semester ${number}` } });
  await audit(req, 'CREATE', 'semesters', item.id);
  res.status(201).json({ item });
}));

// convenience: auto-create all semesters for a course
router.post('/courses/:id/semesters/bootstrap', requirePermission('semesters:manage', 'courses:manage'), wrap(async (req, res) => {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: req.params.id } });
  let created = 0;
  for (let n = 1; n <= course.durationSemesters; n++) {
    const exists = await prisma.semester.findUnique({ where: { courseId_number: { courseId: course.id, number: n } } });
    if (!exists) { await prisma.semester.create({ data: { courseId: course.id, number: n, name: `Semester ${n}` } }); created++; }
  }
  await audit(req, 'BOOTSTRAP', 'semesters', course.id, { created });
  res.json({ ok: true, created });
}));

router.delete('/semesters/:id', requirePermission('semesters:delete', 'semesters:manage'), wrap(async (req, res) => {
  await prisma.semester.delete({ where: { id: req.params.id } });
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
  if (req.query.semesterId) where.semesterId = req.query.semesterId;
  const items = await prisma.sections.findMany({
    where,
    include: {
      coordinator: { select: { id: true, fullName: true } },
      semester: { include: { course: { select: { name: true, code: true } } } },
      _count: { select: { students: true } },
    },
    orderBy: [{ semester: { course: { name: 'asc' } } }, { semester: { number: 'asc' } }, { name: 'asc' }],
  });
  res.json({ items });
}));

router.post('/sections', requirePermission('sections:create', 'sections:manage'), validate(sectionSchema), wrap(async (req, res) => {
  const data: any = {
    semesterId: req.body.semesterId, name: req.body.name, capacity: req.body.capacity,
    coordinatorId: blankToUndef(req.body.coordinatorId) || undefined,
  };
  const item = await prisma.sections.create({ data, include: { coordinator: { select: { id: true, fullName: true } } } });
  await audit(req, 'CREATE', 'sections', item.id);
  res.status(201).json({ item });
}));

router.put('/sections/:id', requirePermission('sections:edit', 'sections:manage'), validate(sectionSchema.partial()), wrap(async (req, res) => {
  const data: any = { ...req.body };
  if ('coordinatorId' in data) data.coordinatorId = blankToUndef(data.coordinatorId) || null;
  const item = await prisma.sections.update({ where: { id: req.params.id }, data, include: { coordinator: { select: { id: true, fullName: true } } } });
  await audit(req, 'UPDATE', 'sections', item.id);
  res.json({ item });
}));

router.delete('/sections/:id', requirePermission('sections:delete', 'sections:manage'), wrap(async (req, res) => {
  const count = await prisma.studentProfile.count({ where: { sectionId: req.params.id } });
  if (count > 0) throw httpError(409, 'Section has students');
  await prisma.sections.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'sections', req.params.id);
  res.json({ ok: true });
}));

export default router;
