import { Router } from 'express';
import { z } from 'zod';
import {
  User, Role, TeacherProfile, TeacherAllocation, Department, Section,
} from '../models';
import { wrap, httpError, parsePagination, oid } from '../lib/http';
import { validate, blankToUndef, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { getHodDepartmentId } from '../middleware/scope';
import { hashPassword } from '../lib/tokens';
import { audit } from '../middleware/audit';
import { iRegex } from '../models';

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

const USER_SELECT = 'fullName email username phone photoUrl status';

router.get('/', requirePermission('teachers:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where: any = {};
  if (req.query.departmentId) where.departmentId = oid(req.query.departmentId as string);
  if (req.user!.role === 'HOD') {
    const deptId = await getHodDepartmentId(req.user!);
    where.departmentId = deptId ? oid(deptId) : null;
  }
  const q = (req.query.q as string)?.trim();
  if (q) {
    const userIds = (await User.find({ fullName: iRegex(q) }).select('_id')).map((u: any) => u._id);
    where.$or = [{ employeeCode: iRegex(q) }, { userId: { $in: userIds } }];
  }

  const [total, docs] = await Promise.all([
    TeacherProfile.countDocuments(where),
    TeacherProfile.find(where).skip(skip).limit(limit).sort({ employeeCode: 1 })
      .populate({ path: 'userId', as: 'user', select: USER_SELECT })
      .populate({ path: 'departmentId', as: 'department', select: 'code name' }),
  ]);
  const items = await Promise.all(docs.map(async (t: any) => {
    const j = t.toJSON();
    j._count = { allocations: await TeacherAllocation.countDocuments({ teacherId: t._id }) };
    return j;
  }));
  res.json({ total, page, limit, items });
}));

router.get('/:id', requirePermission('teachers:view'), wrap(async (req, res) => {
  const id = oid(req.params.id);
  const item = await TeacherProfile.findById(id)
    .populate({ path: 'userId', as: 'user', select: USER_SELECT })
    .populate({ path: 'departmentId', as: 'department' });
  if (!item) throw httpError(404, 'Teacher not found');
  const allocations = await TeacherAllocation.find({ teacherId: id })
    .populate({ path: 'subjectId', as: 'subject', select: 'code name' })
    .populate({ path: 'sectionId', as: 'section', populate: { path: 'semesterId', select: 'number' } });
  const j: any = item.toJSON();
  j.allocations = allocations.map((a: any) => a.toJSON());
  res.json({ item: j });
}));

router.post('/', requirePermission('teachers:create'), validate(teacherSchema), wrap(async (req, res) => {
  const b = req.body;
  const role = await Role.findOne({ name: 'TEACHER' });
  if (!role) throw httpError(500, 'TEACHER role missing — run the seed');

  const user = await User.create({
    email: b.email.toLowerCase(), username: b.employeeCode, fullName: b.fullName, phone: b.phone,
    roleId: role._id, status: 'ACTIVE', mustChangePwd: true,
    passwordHash: await hashPassword(b.password || 'teacher123'),
  });
  const teacher = await TeacherProfile.create({
    employeeCode: b.employeeCode,
    departmentId: oid(b.departmentId),
    designation: b.designation || 'Assistant Professor',
    qualification: b.qualification, specialization: b.specialization,
    joiningDate: toDate(b.joiningDate),
    userId: user._id,
  });
  const out = teacher.toJSON();
  (out as any).user = { id: String(user._id), email: user.email, username: user.username };
  await audit(req, 'CREATE', 'teachers', String(teacher._id), { employeeCode: teacher.employeeCode });
  res.status(201).json({ item: out });
}));

router.put('/:id', requirePermission('teachers:edit'), wrap(async (req, res) => {
  const b = req.body;
  const id = oid(req.params.id);
  const data: any = {};
  for (const k of ['employeeCode', 'designation', 'qualification', 'specialization', 'status']) if (b[k]) data[k] = b[k];
  if (b.departmentId) data.departmentId = oid(b.departmentId);
  if (b.joiningDate) data.joiningDate = new Date(b.joiningDate);

  const t = await TeacherProfile.findByIdAndUpdate(id, data, { new: true });
  if (!t) throw httpError(404, 'Teacher not found');

  const userData: any = {};
  if (b.fullName) userData.fullName = b.fullName;
  if (b.email) userData.email = String(b.email).toLowerCase();
  if (b.phone !== undefined) userData.phone = b.phone;
  if (Object.keys(userData).length) await User.updateOne({ _id: t.userId }, userData);

  const out = t.toJSON();
  const u = await User.findById(t.userId).select(USER_SELECT);
  const dept = await Department.findById(t.departmentId);
  (out as any).user = u ? u.toJSON() : undefined;
  (out as any).department = dept ? dept.toJSON() : undefined;
  await audit(req, 'UPDATE', 'teachers', String(t._id));
  res.json({ item: out });
}));

router.post('/:id/create-login', requirePermission('teachers:manage', 'teachers:edit'), validate(z.object({ password: z.string().min(8).optional() })), wrap(async (req, res) => {
  const t = await TeacherProfile.findById(oid(req.params.id));
  if (!t) throw httpError(404, 'Teacher not found');
  const pass = req.body.password || 'teacher123';
  await User.updateOne({ _id: t.userId }, { passwordHash: await hashPassword(pass), mustChangePwd: true, status: 'ACTIVE' });
  await audit(req, 'CREATE_LOGIN', 'teachers', String(t._id));
  res.json({ ok: true, initialPassword: pass });
}));

/* ── Subject allocation (teacher ↔ subject ↔ section) ───────────────── */
router.get('/:id/allocations', requirePermission('teachers:view', 'allocations:view'), wrap(async (req, res) => {
  const items = await TeacherAllocation.find({ teacherId: oid(req.params.id) })
    .populate({ path: 'subjectId', as: 'subject', select: 'code name semesterId' })
    .populate({ path: 'sectionId', as: 'section', populate: { path: 'semesterId', select: 'number courseId' } });
  res.json({ items: items.map((i: any) => i.toJSON()) });
}));

router.post('/:id/allocate', requirePermission('allocations:create', 'allocations:manage', 'teachers:edit'), validate(z.object({
  subjectId: z.string(), sectionId: z.string(), role: z.enum(['PRIMARY', 'LAB', 'COORDINATOR']).default('PRIMARY'),
})), wrap(async (req, res) => {
  const teacher = await TeacherProfile.findById(oid(req.params.id));
  if (!teacher) throw httpError(404, 'Teacher not found');
  const item = await TeacherAllocation.findOneAndUpdate(
    { teacherId: teacher._id, subjectId: oid(req.body.subjectId), sectionId: oid(req.body.sectionId), role: req.body.role },
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await audit(req, 'ALLOCATE', 'allocations', String(item._id), { teacher: teacher.employeeCode, subject: req.body.subjectId });
  res.status(201).json({ item: item.toJSON() });
}));

router.delete('/:id/allocate/:allocId', requirePermission('allocations:delete', 'allocations:manage', 'teachers:edit'), wrap(async (req, res) => {
  await TeacherAllocation.deleteOne({ _id: oid(req.params.allocId) });
  await audit(req, 'UNALLOCATE', 'allocations', req.params.allocId);
  res.json({ ok: true });
}));

/* ── Coordinator assignment (teacher → section) ─────────────────────── */
router.post('/assign-coordinator', requirePermission('allocations:manage', 'sections:edit', 'departments:manage'), validate(z.object({
  userId: z.string(), sectionId: z.string(),
})), wrap(async (req, res) => {
  const { userId, sectionId } = req.body;
  const teacher = await TeacherProfile.findOne({ userId: oid(userId) });
  if (!teacher) throw httpError(400, 'User is not a teacher');
  const item = await Section.findByIdAndUpdate(oid(sectionId), { coordinatorId: oid(userId) }, { new: true })
    .populate({ path: 'coordinatorId', as: 'coordinator', select: 'fullName' })
    .populate({ path: 'semesterId', as: 'semester', select: 'number' });
  if (!item) throw httpError(404, 'Section not found');
  await audit(req, 'ASSIGN_COORDINATOR', 'sections', String(item._id), { userId, sectionId });
  res.json({ item: item.toJSON() });
}));

router.delete('/:id', requirePermission('teachers:delete'), wrap(async (req, res) => {
  const t = await TeacherProfile.findById(oid(req.params.id));
  if (!t) throw httpError(404, 'Teacher not found');
  await User.updateOne({ _id: t.userId }, { status: 'INACTIVE' });
  await TeacherProfile.updateOne({ _id: t._id }, { status: 'RESIGNED' });
  await audit(req, 'DEACTIVATE', 'teachers', String(t._id));
  res.json({ ok: true });
}));

export default router;
