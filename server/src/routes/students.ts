import { Router } from 'express';
import { z } from 'zod';
import {
  User, Role, StudentProfile, Course, Department, Semester, Section, AcademicYear,
  AcademicRecord, ParentLink,
} from '../models';
import { wrap, httpError, parsePagination, oid } from '../lib/http';
import { validate, blankToUndef, toDate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { studentScopeWhere, assertCanAccessStudent } from '../middleware/scope';
import { hashPassword } from '../lib/tokens';
import { audit } from '../middleware/audit';
import { iRegex } from '../models';

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

const USER_SELECT = 'fullName email username phone photoUrl status';

router.get('/', requirePermission('students:view'), wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const scope = await studentScopeWhere(req.user!);
  const where: any = scope ? { ...scope } : {};
  if (req.query.courseId) where.courseId = oid(req.query.courseId as string);
  if (req.query.departmentId) where.departmentId = oid(req.query.departmentId as string);
  if (req.query.semesterId) where.semesterId = oid(req.query.semesterId as string);
  if (req.query.sectionId) where.sectionId = oid(req.query.sectionId as string);
  const q = (req.query.q as string)?.trim();
  if (q) {
    const userIds = (await User.find({ $or: [{ fullName: iRegex(q) }, { username: iRegex(q) }] }).select('_id')).map((u: any) => u._id);
    where.$or = [{ rollNo: iRegex(q) }, { enrollmentNo: iRegex(q) }, { userId: { $in: userIds } }];
  }

  const [total, docs] = await Promise.all([
    StudentProfile.countDocuments(where),
    StudentProfile.find(where).skip(skip).limit(limit).sort({ rollNo: 1 })
      .populate({ path: 'userId', as: 'user', select: USER_SELECT })
      .populate({ path: 'courseId', as: 'course', select: 'name' })
      .populate({ path: 'departmentId', as: 'department', select: 'code' })
      .populate({ path: 'semesterId', as: 'semester', select: 'number' })
      .populate({ path: 'sectionId', as: 'section', select: 'name' }),
  ]);
  res.json({ total, page, limit, items: docs.map((d: any) => d.toJSON()) });
}));

router.get('/:id', requirePermission('students:view'), wrap(async (req, res) => {
  await assertCanAccessStudent(req.user!, req.params.id);
  const id = oid(req.params.id);
  const item = await StudentProfile.findById(id)
    .populate({ path: 'userId', as: 'user', select: USER_SELECT })
    .populate({ path: 'courseId', as: 'course' })
    .populate({ path: 'departmentId', as: 'department' })
    .populate({ path: 'semesterId', as: 'semester' })
    .populate({ path: 'sectionId', as: 'section' })
    .populate({ path: 'batchId', as: 'batch' });
  if (!item) throw httpError(404, 'Student not found');
  const j: any = item.toJSON();
  const history = await AcademicRecord.find({ studentId: id }).sort({ datedAt: -1 });
  const parentLinks = await ParentLink.find({ studentId: id })
    .populate({ path: 'parentId', as: 'parent', select: 'fullName phone email' });
  j.academicHistory = history.map((h) => h.toJSON());
  j.parents = parentLinks.map((p: any) => { const o = p.toJSON(); return { relation: o.relation, parent: o.parent }; });
  res.json({ item: j });
}));

router.post('/', requirePermission('students:create'), validate(studentSchema), wrap(async (req, res) => {
  const b = req.body;
  const role = await Role.findOne({ name: 'STUDENT' });
  if (!role) throw httpError(500, 'STUDENT role missing — run the seed');

  const user = await User.create({
    email: b.email.toLowerCase(),
    username: b.rollNo,
    fullName: b.fullName,
    phone: b.phone,
    status: 'ACTIVE',
    mustChangePwd: true,
    roleId: role._id,
    passwordHash: await hashPassword(b.password || 'student123'),
  });

  const student = await StudentProfile.create({
    enrollmentNo: b.enrollmentNo,
    rollNo: b.rollNo,
    userId: user._id,
    courseId: oid(b.courseId),
    departmentId: oid(b.departmentId),
    semesterId: oid(b.semesterId),
    ...(b.sectionId ? { sectionId: oid(b.sectionId) } : {}),
    ...(b.batchId ? { batchId: oid(b.batchId) } : {}),
    fatherName: b.fatherName, motherName: b.motherName, guardianPhone: b.guardianPhone,
    dob: toDate(b.dob), gender: b.gender, address: b.address,
    admissionDate: toDate(b.admissionDate) || new Date(),
  });

  const out = student.toJSON();
  (out as any).user = { id: String(user._id), email: user.email, username: user.username };
  await audit(req, 'CREATE', 'students', String(student._id), { rollNo: student.rollNo });
  res.status(201).json({ item: out });
}));

router.put('/:id', requirePermission('students:edit'), wrap(async (req, res) => {
  const b = req.body;
  const id = oid(req.params.id);
  const data: any = {};
  for (const k of ['enrollmentNo', 'rollNo', 'fatherName', 'motherName', 'guardianPhone', 'address']) if (b[k] !== undefined) data[k] = b[k];
  for (const k of ['courseId', 'departmentId', 'semesterId']) if (b[k]) data[k] = oid(b[k]);
  if ('sectionId' in b) data.sectionId = blankToUndef(b.sectionId) ? oid(b.sectionId) : null;
  if (b.dob) data.dob = new Date(b.dob);
  if (b.gender) data.gender = b.gender;
  if (b.status) data.status = b.status;

  const student = await StudentProfile.findByIdAndUpdate(id, data, { new: true });
  if (!student) throw httpError(404, 'Student not found');

  const userData: any = {};
  if (b.fullName) userData.fullName = b.fullName;
  if (b.email) userData.email = String(b.email).toLowerCase();
  if (b.phone !== undefined) userData.phone = b.phone;
  if (Object.keys(userData).length) await User.updateOne({ _id: student.userId }, userData);

  const out = student.toJSON();
  const u = await User.findById(student.userId).select(USER_SELECT);
  (out as any).user = u ? u.toJSON() : undefined;
  await audit(req, 'UPDATE', 'students', String(student._id));
  res.json({ item: out });
}));

// Promotion: move a student to the next semester, snapshotting history
router.post('/:id/promote', requirePermission('students:manage', 'students:edit'), validate(z.object({
  toSemesterId: z.string(), toSectionId: z.string().optional(), remark: z.string().optional(),
})), wrap(async (req, res) => {
  const student = await StudentProfile.findById(oid(req.params.id)).populate({ path: 'semesterId' });
  if (!student) throw httpError(404, 'Student not found');
  const targetSem = await Semester.findById(oid(req.body.toSemesterId));
  if (!targetSem) throw httpError(404, 'Target semester not found');
  const curSem: any = student.semesterId;
  const toSection = blankToUndef(req.body.toSectionId) ? oid(req.body.toSectionId) : student.sectionId;

  await AcademicRecord.create({
    studentId: student._id, academicYearId: student.batchId, semesterId: student.semesterId,
    sectionId: student.sectionId, remark: `Completed ${curSem?.name || 'Sem ' + curSem?.number}`,
  });
  await StudentProfile.updateOne({ _id: student._id }, { semesterId: targetSem._id, sectionId: toSection });
  await AcademicRecord.create({
    studentId: student._id, academicYearId: student.batchId, semesterId: targetSem._id,
    sectionId: toSection, remark: req.body.remark || `Promoted to ${targetSem.name || 'Sem ' + targetSem.number}`,
  });
  await audit(req, 'PROMOTE', 'students', String(student._id), { to: String(targetSem._id) });
  res.json({ ok: true });
}));

// Ensure a student login exists (creates one if the account was skipped)
router.post('/:id/create-login', requirePermission('students:manage', 'students:create'), validate(z.object({ password: z.string().min(8).optional() })), wrap(async (req, res) => {
  const student = await StudentProfile.findById(oid(req.params.id));
  if (!student) throw httpError(404, 'Student not found');
  const existing = await User.findById(student.userId);
  if (!existing) throw httpError(404, 'No user linked');
  const pass = req.body.password || 'student123';
  existing.passwordHash = await hashPassword(pass);
  existing.mustChangePwd = true;
  existing.status = 'ACTIVE';
  await existing.save();
  await audit(req, 'CREATE_LOGIN', 'students', String(student._id));
  res.json({ ok: true, username: existing.username, initialPassword: pass });
}));

// Parent linking: attach an existing PARENT user (or create one) to a student
router.post('/:id/parents', requirePermission('students:edit', 'students:manage'), validate(z.object({
  parentId: z.string().optional(),
  parent: z.object({ fullName: z.string(), email: z.string().email(), phone: z.string().optional(), password: z.string().min(8).optional() }).optional(),
  relation: z.string().default('GUARDIAN'),
})), wrap(async (req, res) => {
  const student = await StudentProfile.findById(oid(req.params.id));
  if (!student) throw httpError(404, 'Student not found');
  let parentId = blankToUndef(req.body.parentId);
  if (!parentId && req.body.parent) {
    const role = await Role.findOne({ name: 'PARENT' });
    if (!role) throw httpError(500, 'PARENT role missing — run the seed');
    const u = await User.create({
      email: req.body.parent.email.toLowerCase(),
      username: req.body.parent.email.split('@')[0] + '.' + student.rollNo,
      fullName: req.body.parent.fullName, phone: req.body.parent.phone, roleId: role._id,
      mustChangePwd: true, passwordHash: await hashPassword(req.body.parent.password || 'parent123'),
    });
    parentId = String(u._id);
  }
  if (!parentId) throw httpError(400, 'Provide parentId or a new parent object');
  await ParentLink.findOneAndUpdate(
    { parentId: oid(parentId), studentId: student._id },
    { relation: req.body.relation },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await audit(req, 'LINK_PARENT', 'students', String(student._id), { parentId });
  res.json({ ok: true, parentId });
}));

router.delete('/:id', requirePermission('students:delete'), wrap(async (req, res) => {
  const s = await StudentProfile.findById(oid(req.params.id));
  if (!s) throw httpError(404, 'Student not found');
  // soft: deactivate the user, keep academic history intact
  await User.updateOne({ _id: s.userId }, { status: 'INACTIVE' });
  await StudentProfile.updateOne({ _id: s._id }, { status: 'DROPPED' });
  await audit(req, 'DEACTIVATE', 'students', String(s._id));
  res.json({ ok: true });
}));

export default router;
