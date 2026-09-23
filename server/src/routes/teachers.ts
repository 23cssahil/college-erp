import { Router } from 'express';
import { z } from 'zod';
import { UserStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { wrap, httpError, parsePagination } from '../lib/http';
import { validate, blankToUndef, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getHodDepartmentId } from '../middleware/scope';
import { hashPassword } from '../lib/tokens';
import { audit } from '../middleware/audit';

const router = Router();

const teacherSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  employeeCode: z.string().min(1),
  departmentId: z.string(),
  designation: z.string().optional(),
  qualification: z.string().optional(),
  specialization: z.string().optional(),
  joiningDate: z.string().optional(),
  phone: z.string().optional(),
  password: z.string().min(8).optional(),
});

router.get('/', requirePermission('teachers:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where: any = {};
  if (req.query.departmentId) where.departmentId = req.query.departmentId;
  if (req.user!.role === 'HOD') {
    const deptId = await getHodDepartmentId(req.user!);
    where.departmentId = deptId || '__none__';
  }
  const q = (req.query.q as string)?.trim();
  if (q) where.OR = [{ user: { fullName: { contains: q, mode: 'insensitive' } } }, { employeeCode: { contains: q, mode: 'insensitive' } }];

  const [total, items] = await prisma.$transaction([
    prisma.teacherProfile.count({ where }),
    prisma.teacherProfile.findMany({
      where, skip, take: limit, orderBy: { employeeCode: 'asc' },
      include: {
        user: { select: { id: true, fullName: true, email: true, username: true, phone: true, photoUrl: true, status: true } },
        department: { select: { id: true, code: true, name: true } },
        _count: { select: { allocations: true } },
      },
    }),
  ]);
  res.json({ total, page, limit, items });
}));

router.get('/:id', requirePermission('teachers:view'), wrap(async (req, res) => {
  const item = await prisma.teacherProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, fullName: true, email: true, username: true, phone: true, photoUrl: true, status: true } },
      department: true,
      allocations: { include: { subject: { select: { code: true, name: true } }, section: { include: { semester: { select: { number: true } } } } } },
    },
  });
  if (!item) throw httpError(404, 'Teacher not found');
  res.json({ item });
}));

router.post('/', requirePermission('teachers:create'), validate(teacherSchema), wrap(async (req, res) => {
  const b = req.body;
  const role = await prisma.role.findUnique({ where: { name: 'TEACHER' } });
  const teacher = await prisma.teacherProfile.create({
    data: {
      employeeCode: b.employeeCode,
      department: { connect: { id: b.departmentId } },
      designation: b.designation || 'Assistant Professor',
      qualification: b.qualification, specialization: b.specialization,
      joiningDate: toDate(b.joiningDate),
      user: {
        create: {
          email: b.email.toLowerCase(), username: b.employeeCode, fullName: b.fullName, phone: b.phone,
          roleId: role!.id, status: UserStatus.ACTIVE, mustChangePwd: true,
          passwordHash: await hashPassword(b.password || 'teacher123'),
        },
      },
    },
    include: { user: { select: { id: true, email: true, username: true } } },
  });
  await audit(req, 'CREATE', 'teachers', teacher.id, { employeeCode: teacher.employeeCode });
  res.status(201).json({ item: teacher });
}));

router.put('/:id', requirePermission('teachers:edit'), wrap(async (req, res) => {
  const b = req.body;
  const data: any = {};
  for (const k of ['employeeCode', 'departmentId', 'designation', 'qualification', 'specialization', 'status']) if (b[k]) data[k] = b[k];
  if (b.joiningDate) data.joiningDate = new Date(b.joiningDate);
  const userData: any = {};
  if (b.fullName) userData.fullName = b.fullName;
  if (b.email) userData.email = String(b.email).toLowerCase();
  if (b.phone !== undefined) userData.phone = b.phone;

  const item = await prisma.$transaction(async (tx: any) => {
    const t = await tx.teacherProfile.update({ where: { id: req.params.id }, data });
    if (Object.keys(userData).length) await tx.user.update({ where: { id: t.userId }, data: userData });
    return tx.teacherProfile.findUniqueOrThrow({ where: { id: t.id }, include: { user: { select: { fullName: true, email: true, phone: true } }, department: true } });
  });
  await audit(req, 'UPDATE', 'teachers', item.id);
  res.json({ item });
}));

router.post('/:id/create-login', requirePermission('teachers:manage', 'teachers:edit'), validate(z.object({ password: z.string().min(8).optional() })), wrap(async (req, res) => {
  const t = await prisma.teacherProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  const pass = req.body.password || 'teacher123';
  await prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(pass), mustChangePwd: true, status: 'ACTIVE' } });
  await audit(req, 'CREATE_LOGIN', 'teachers', t.id);
  res.json({ ok: true, initialPassword: pass });
}));

/* ── Subject allocation (teacher ↔ subject ↔ section) ───────────────── */
router.get('/:id/allocations', requirePermission('teachers:view', 'allocations:view'), wrap(async (req, res) => {
  const items = await prisma.teacherAllocation.findMany({
    where: { teacherId: req.params.id },
    include: { subject: { select: { code: true, name: true, semesterId: true } }, section: { include: { semester: { select: { number: true, courseId: true } } } } },
  });
  res.json({ items });
}));

router.post('/:id/allocate', requirePermission('allocations:create', 'allocations:manage', 'teachers:edit'), validate(z.object({
  subjectId: z.string(), sectionId: z.string(), role: z.enum(['PRIMARY', 'LAB', 'COORDINATOR']).default('PRIMARY'),
})), wrap(async (req, res) => {
  const teacher = await prisma.teacherProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  const item = await prisma.teacherAllocation.upsert({
    where: { teacherId_subjectId_sectionId_role: { teacherId: teacher.id, subjectId: req.body.subjectId, sectionId: req.body.sectionId, role: req.body.role } },
    create: { teacherId: teacher.id, subjectId: req.body.subjectId, sectionId: req.body.sectionId, role: req.body.role },
    update: {},
  });
  await audit(req, 'ALLOCATE', 'allocations', item.id, { teacher: teacher.employeeCode, subject: req.body.subjectId });
  res.status(201).json({ item });
}));

router.delete('/:id/allocate/:allocId', requirePermission('allocations:delete', 'allocations:manage', 'teachers:edit'), wrap(async (req, res) => {
  await prisma.teacherAllocation.delete({ where: { id: req.params.allocId } });
  await audit(req, 'UNALLOCATE', 'allocations', req.params.allocId);
  res.json({ ok: true });
}));

/* ── Coordinator assignment (teacher → section) ─────────────────────── */
router.post('/assign-coordinator', requirePermission('allocations:manage', 'sections:edit', 'departments:manage'), validate(z.object({
  userId: z.string(), sectionId: z.string(),
})), wrap(async (req, res) => {
  const { userId, sectionId } = req.body;
  const teacher = await prisma.teacherProfile.findFirst({ where: { userId } });
  if (!teacher) throw httpError(400, 'User is not a teacher');
  const item = await prisma.sections.update({ where: { id: sectionId }, data: { coordinatorId: userId }, include: { coordinator: { select: { id: true, fullName: true } }, semester: { select: { number: true } } } });
  await audit(req, 'ASSIGN_COORDINATOR', 'sections', item.id, { userId, sectionId });
  res.json({ item });
}));

router.delete('/:id', requirePermission('teachers:delete'), wrap(async (req, res) => {
  const t = await prisma.teacherProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  await prisma.user.update({ where: { id: t.userId }, data: { status: 'INACTIVE' } });
  await prisma.teacherProfile.update({ where: { id: t.id }, data: { status: 'RESIGNED' } });
  await audit(req, 'DEACTIVATE', 'teachers', t.id);
  res.json({ ok: true });
}));

export default router;
