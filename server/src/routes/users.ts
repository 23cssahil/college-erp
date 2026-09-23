import { Router } from 'express';
import { z } from 'zod';
import { User, Role, StudentProfile, TeacherProfile } from '../models';
import { wrap, httpError, parsePagination, oid } from '../lib/http';
import { validate, toBool } from '../lib/validate';
import { hashPassword } from '../lib/tokens';
import { requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';

const router = Router();
router.use(requirePermission('users:view', 'users:create', 'users:edit', 'users:delete', 'users:manage'));

const userSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(40),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  roleId: z.string().min(1),
  password: z.string().min(8).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  mustChangePwd: z.boolean().optional(),
});

router.get('/', wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const q = (req.query.q as string)?.trim();
  const where: any = {};
  if (q) where.$or = [{ fullName: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }, { username: { $regex: q, $options: 'i' } }];
  if (req.query.roleId) where.roleId = oid(req.query.roleId as string);
  if (req.query.status) where.status = req.query.status;

  const [total, users] = await Promise.all([
    User.countDocuments(where),
    User.find(where).skip(skip).limit(limit).sort({ createdAt: -1 })
      .populate({ path: 'roleId', as: 'role', select: 'name label' }),
  ]);
  res.json({ total, page, limit, users: users.map((u: any) => u.toJSON()) });
}));

router.get('/:id', wrap(async (req, res) => {
  const u = await User.findById(oid(req.params.id))
    .populate({ path: 'roleId', as: 'role' });
  if (!u) throw httpError(404, 'User not found');
  const student = await StudentProfile.findOne({ userId: u._id });
  const teacher = await TeacherProfile.findOne({ userId: u._id });
  const j: any = u.toJSON();
  j.studentProfile = student ? student.toJSON() : null;
  j.teacherProfile = teacher ? teacher.toJSON() : null;
  res.json({ user: j });
}));

router.post('/', requirePermission('users:create', 'users:manage'), validate(userSchema), wrap(async (req, res) => {
  const body = req.body;
  const role = await Role.findById(oid(body.roleId));
  if (!role) throw httpError(400, 'Invalid role');

  const pass = body.password || 'ChangeMe123!';
  const user = await User.create({
    email: body.email.toLowerCase(),
    username: body.username,
    fullName: body.fullName,
    phone: body.phone,
    roleId: role._id,
    status: body.status || 'ACTIVE',
    mustChangePwd: body.mustChangePwd ?? !body.password,
    passwordHash: await hashPassword(pass),
  });
  const out = user.toJSON();
  (out as any).role = { id: String(role._id), name: role.name, label: role.label };
  await audit(req, 'CREATE', 'users', String(user._id), { email: user.email, role: role.name });
  res.status(201).json({ user: out, initialPassword: body.password ? undefined : pass });
}));

router.put('/:id', requirePermission('users:edit', 'users:manage'), wrap(async (req, res) => {
  const body = req.body;
  const data: any = {};
  for (const k of ['fullName', 'phone', 'status']) if (body[k] !== undefined) data[k] = body[k];
  if (body.roleId) data.roleId = oid(body.roleId);
  if (body.email) data.email = String(body.email).toLowerCase();
  if (body.username) data.username = body.username;
  if (body.password) {
    if (body.password.length < 8) throw httpError(400, 'Password too short');
    data.passwordHash = await hashPassword(body.password);
    data.mustChangePwd = false;
  }
  if (body.mustChangePwd !== undefined) data.mustChangePwd = toBool(body.mustChangePwd);

  const user = await User.findByIdAndUpdate(oid(req.params.id), data, { new: true })
    .populate({ path: 'roleId', as: 'role', select: 'name label' });
  if (!user) throw httpError(404, 'User not found');
  await audit(req, 'UPDATE', 'users', String(user._id), { fields: Object.keys(data) });
  res.json({ user: user.toJSON() });
}));

router.delete('/:id', requirePermission('users:delete', 'users:manage'), wrap(async (req, res) => {
  const id = oid(req.params.id);
  if (String(id) === req.user!.id) throw httpError(400, 'You cannot delete your own account');
  // deactivate instead of hard-delete when the user has a profile linked
  const hasProfile = await StudentProfile.findOne({ userId: id });
  const teacherProfile = await TeacherProfile.findOne({ userId: id });
  if (hasProfile || teacherProfile) {
    const user = await User.findByIdAndUpdate(id, { status: 'INACTIVE' }, { new: true });
    await audit(req, 'DEACTIVATE', 'users', String(user?._id));
    return res.json({ user: user?.toJSON(), deactivated: true });
  }
  await User.deleteOne({ _id: id });
  await audit(req, 'DELETE', 'users', req.params.id);
  res.json({ ok: true });
}));

export default router;
