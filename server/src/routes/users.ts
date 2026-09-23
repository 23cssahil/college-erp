import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError, parsePagination } from '../lib/http';
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
  roleId: z.number().int().positive(),
  password: z.string().min(8).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  mustChangePwd: z.boolean().optional(),
});

router.get('/', wrap(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const q = (req.query.q as string)?.trim();
  const where: any = {};
  if (q) where.OR = [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { username: { contains: q, mode: 'insensitive' } }];
  if (req.query.roleId) where.roleId = Number(req.query.roleId);
  if (req.query.status) where.status = req.query.status;

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      include: { role: { select: { id: true, name: true, label: true } } },
    }),
  ]);
  res.json({ total, page, limit, users });
}));

router.get('/:id', wrap(async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { role: true, studentProfile: true, teacherProfile: true },
  });
  if (!u) throw httpError(404, 'User not found');
  res.json({ user: u });
}));

router.post('/', requirePermission('users:create', 'users:manage'), validate(userSchema), wrap(async (req, res) => {
  const body = req.body;
  const role = await prisma.role.findUnique({ where: { id: body.roleId } });
  if (!role) throw httpError(400, 'Invalid role');
  if (body.email.includes('@') === false) throw httpError(400, 'Invalid email');

  const pass = body.password || 'ChangeMe123!';
  const user = await prisma.user.create({
    data: {
      email: body.email.toLowerCase(),
      username: body.username,
      fullName: body.fullName,
      phone: body.phone,
      roleId: body.roleId,
      status: body.status || 'ACTIVE',
      mustChangePwd: body.mustChangePwd ?? !body.password,
      passwordHash: await hashPassword(pass),
    },
    include: { role: true },
  });
  await audit(req, 'CREATE', 'users', user.id, { email: user.email, role: role.name });
  res.status(201).json({ user, initialPassword: body.password ? undefined : pass });
}));

router.put('/:id', requirePermission('users:edit', 'users:manage'), wrap(async (req, res) => {
  const body = req.body;
  const data: any = {};
  for (const k of ['fullName', 'phone', 'status']) if (body[k] !== undefined) data[k] = body[k];
  if (body.roleId) data.roleId = Number(body.roleId);
  if (body.email) data.email = String(body.email).toLowerCase();
  if (body.username) data.username = body.username;
  if (body.password) {
    if (body.password.length < 8) throw httpError(400, 'Password too short');
    data.passwordHash = await hashPassword(body.password);
    data.mustChangePwd = false;
  }
  if (body.mustChangePwd !== undefined) data.mustChangePwd = toBool(body.mustChangePwd);

  const user = await prisma.user.update({ where: { id: req.params.id }, data, include: { role: true } });
  await audit(req, 'UPDATE', 'users', user.id, { fields: Object.keys(data) });
  res.json({ user });
}));

router.delete('/:id', requirePermission('users:delete', 'users:manage'), wrap(async (req, res) => {
  if (req.params.id === req.user!.id) throw httpError(400, 'You cannot delete your own account');
  // deactivate instead of hard-delete when the user has a profile linked
  const hasProfile = await prisma.studentProfile.findUnique({ where: { userId: req.params.id } });
  const teacherProfile = await prisma.teacherProfile.findUnique({ where: { userId: req.params.id } });
  if (hasProfile || teacherProfile) {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: 'INACTIVE' } });
    await audit(req, 'DEACTIVATE', 'users', user.id);
    return res.json({ user, deactivated: true });
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  await audit(req, 'DELETE', 'users', req.params.id);
  res.json({ ok: true });
}));

export default router;
