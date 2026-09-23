import { Router } from 'express';
import { z } from 'zod';
import { UserStatus, RoleName } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { wrap, httpError, parsePagination } from '../lib/http';
import { validate, blankToUndef, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { studentScopeWhere, assertCanAccessStudent } from '../middleware/scope';
import { hashPassword } from '../lib/tokens';
import { audit } from '../middleware/audit';

const router = Router();

const studentSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  enrollmentNo: z.string().min(1),
  rollNo: z.string().min(1),
  sectionId: z.string().optional(),
  courseId: z.string(),
  departmentId: z.string(),
  semesterId: z.string(),
  batchId: z.string().optional(),
  fatherName: z.string().optional(),
  motherName: z.string().optional(),
  guardianPhone: z.string().optional(),
  phone: z.string().optional(),
  dob: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  address: z.string().optional(),
  admissionDate: z.string().optional(),
  createLogin: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

router.get('/', requirePermission('students:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const scope = await studentScopeWhere(req.user!);
  const where: any = scope ? { AND: [scope] } : {};
  if (req.query.courseId) where.courseId = req.query.courseId;
  if (req.query.departmentId) where.departmentId = req.query.departmentId;
  if (req.query.semesterId) where.semesterId = req.query.semesterId;
  if (req.query.sectionId) where.sectionId = req.query.sectionId;
  const q = (req.query.q as string)?.trim();
  if (q) where.AND = [...(where.AND || []), { OR: [
    { user: { fullName: { contains: q, mode: 'insensitive' } } },
    { rollNo: { contains: q, mode: 'insensitive' } },
    { enrollmentNo: { contains: q, mode: 'insensitive' } },
  ] }];

  const [total, items] = await prisma.$transaction([
    prisma.studentProfile.count({ where }),
    prisma.studentProfile.findMany({
      where, skip, take: limit, orderBy: { rollNo: 'asc' },
      include: {
        user: { select: { id: true, fullName: true, email: true, username: true, phone: true, photoUrl: true, status: true } },
        course: { select: { name: true } }, department: { select: { code: true } },
        semester: { select: { number: true } }, section: { select: { name: true } },
      },
    }),
  ]);
  res.json({ total, page, limit, items });
}));

router.get('/:id', requirePermission('students:view'), wrap(async (req, res) => {
  await assertCanAccessStudent(req.user!, req.params.id);
  const item = await prisma.studentProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, fullName: true, email: true, username: true, phone: true, photoUrl: true, status: true } },
      course: true, department: true, semester: true, section: true, batch: true,
      academicHistory: { orderBy: { datedAt: 'desc' } },
      parents: { include: { parent: { select: { id: true, fullName: true, phone: true, email: true } } } },
    },
  });
  if (!item) throw httpError(404, 'Student not found');
  res.json({ item });
}));

router.post('/', requirePermission('students:create'), validate(studentSchema), wrap(async (req, res) => {
  const b = req.body;
  const student = await prisma.studentProfile.create({
    data: {
      enrollmentNo: b.enrollmentNo,
      rollNo: b.rollNo,
      course: { connect: { id: b.courseId } },
      department: { connect: { id: b.departmentId } },
      semester: { connect: { id: b.semesterId } },
      ...(b.sectionId ? { section: { connect: { id: b.sectionId } } } : {}),
      ...(b.batchId ? { batch: { connect: { id: b.batchId } } } : {}),
      fatherName: b.fatherName, motherName: b.motherName, guardianPhone: b.guardianPhone,
      dob: toDate(b.dob), gender: b.gender, address: b.address,
      admissionDate: toDate(b.admissionDate) || new Date(),
      user: {
        create: {
          email: b.email.toLowerCase(),
          username: b.rollNo,
          fullName: b.fullName,
          phone: b.phone,
          status: UserStatus.ACTIVE,
          mustChangePwd: true,
          role: { connect: { name: RoleName.STUDENT } },
          passwordHash: await hashPassword(b.password || 'student123'),
        },
      },
    },
    include: { user: { select: { id: true, email: true, username: true } } },
  });
  await audit(req, 'CREATE', 'students', student.id, { rollNo: student.rollNo });
  res.status(201).json({ item: student });
}));

router.put('/:id', requirePermission('students:edit'), wrap(async (req, res) => {
  const b = req.body;
  const data: any = {};
  for (const k of ['enrollmentNo', 'rollNo', 'fatherName', 'motherName', 'guardianPhone', 'address']) if (b[k] !== undefined) data[k] = b[k];
  for (const k of ['courseId', 'departmentId', 'semesterId']) if (b[k]) data[k] = b[k];
  if ('sectionId' in b) data.sectionId = blankToUndef(b.sectionId) || null;
  if (b.dob) data.dob = new Date(b.dob);
  if (b.gender) data.gender = b.gender;
  if (b.status) data.status = b.status;

  const userData: any = {};
  if (b.fullName) userData.fullName = b.fullName;
  if (b.email) userData.email = String(b.email).toLowerCase();
  if (b.phone !== undefined) userData.phone = b.phone;

  const item = await prisma.$transaction(async (tx: any) => {
    const student = await tx.studentProfile.update({ where: { id: req.params.id }, data });
    if (Object.keys(userData).length) await tx.user.update({ where: { id: student.userId }, data: userData });
    return tx.studentProfile.findUniqueOrThrow({ where: { id: student.id }, include: { user: { select: { fullName: true, email: true, phone: true } } } });
  });
  await audit(req, 'UPDATE', 'students', item.id);
  res.json({ item });
}));

// Promotion: move a whole section to the next semester, snapshotting history
router.post('/:id/promote', requirePermission('students:manage', 'students:edit'), validate(z.object({
  toSemesterId: z.string(), toSectionId: z.string().optional(), remark: z.string().optional(),
})), wrap(async (req, res) => {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { id: req.params.id }, include: { semester: true } });
  const targetSem = await prisma.semester.findUniqueOrThrow({ where: { id: req.body.toSemesterId } });
  await prisma.$transaction([
    prisma.academicRecord.create({
      data: { studentId: student.id, academicYearId: student.batchId || '', semesterId: student.semesterId, sectionId: student.sectionId, remark: `Completed ${student.semester.name || 'Sem ' + student.semester.number}` },
    }),
    prisma.studentProfile.update({
      where: { id: student.id },
      data: { semesterId: targetSem.id, sectionId: blankToUndef(req.body.toSectionId) || student.sectionId },
    }),
    prisma.academicRecord.create({
      data: { studentId: student.id, academicYearId: student.batchId || '', semesterId: targetSem.id, sectionId: blankToUndef(req.body.toSectionId) || student.sectionId, remark: req.body.remark || `Promoted to ${targetSem.name || 'Sem ' + targetSem.number}` },
    }),
  ]);
  await audit(req, 'PROMOTE', 'students', student.id, { to: targetSem.id });
  res.json({ ok: true });
}));

// Ensure a student login exists (creates one if the account was skipped)
router.post('/:id/create-login', requirePermission('students:manage', 'students:create'), validate(z.object({ password: z.string().min(8).optional() })), wrap(async (req, res) => {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  const existing = await prisma.user.findUnique({ where: { id: student.userId } });
  if (!existing) throw httpError(404, 'No user linked');
  const pass = req.body.password || 'student123';
  await prisma.user.update({ where: { id: student.userId }, data: { passwordHash: await hashPassword(pass), mustChangePwd: true, status: 'ACTIVE' } });
  await audit(req, 'CREATE_LOGIN', 'students', student.id);
  res.json({ ok: true, username: existing.username, initialPassword: pass });
}));

// Parent linking: attach an existing PARENT user (or create one) to a student
router.post('/:id/parents', requirePermission('students:edit', 'students:manage'), validate(z.object({
  parentId: z.string().optional(),
  parent: z.object({ fullName: z.string(), email: z.string().email(), phone: z.string().optional(), password: z.string().min(8).optional() }).optional(),
  relation: z.string().default('GUARDIAN'),
})), wrap(async (req, res) => {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  let parentId = blankToUndef(req.body.parentId);
  if (!parentId && req.body.parent) {
    const role = await prisma.role.findUnique({ where: { name: 'PARENT' } });
    const u = await prisma.user.create({
      data: {
        email: req.body.parent.email.toLowerCase(), username: req.body.parent.email.split('@')[0] + '.' + student.rollNo,
        fullName: req.body.parent.fullName, phone: req.body.parent.phone, roleId: role!.id,
        mustChangePwd: true, passwordHash: await hashPassword(req.body.parent.password || 'parent123'),
      },
    });
    parentId = u.id;
  }
  if (!parentId) throw httpError(400, 'Provide parentId or a new parent object');
  await prisma.parentLink.upsert({
    where: { parentId_studentId: { parentId, studentId: student.id } },
    create: { parentId, studentId: student.id, relation: req.body.relation },
    update: { relation: req.body.relation },
  });
  await audit(req, 'LINK_PARENT', 'students', student.id, { parentId });
  res.json({ ok: true, parentId });
}));

router.delete('/:id', requirePermission('students:delete'), wrap(async (req, res) => {
  const s = await prisma.studentProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  // soft: deactivate the user, keep academic history intact
  await prisma.user.update({ where: { id: s.userId }, data: { status: 'INACTIVE' } });
  await prisma.studentProfile.update({ where: { id: s.id }, data: { status: 'DROPPED' } });
  await audit(req, 'DEACTIVATE', 'students', s.id);
  res.json({ ok: true });
}));

export default router;
