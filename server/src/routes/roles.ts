import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { wrap, httpError } from '../lib/http';
import { validate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { PERMISSIONS } from '../permissions/catalog';

const router = Router();

// Read role + permission catalog (needed by the permission matrix UI)
router.get('/', requirePermission('roles:view', 'roles:manage', 'users:manage', 'settings:manage'), wrap(async (_req, res) => {
  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    orderBy: { id: 'asc' },
  });
  res.json({
    roles: roles.map((r) => ({
      id: r.id, name: r.name, label: r.label, isSystem: r.isSystem, userCount: r._count.users,
      permissions: r.permissions.map((p) => p.permission.key),
    })),
  });
}));

router.get('/permissions', requirePermission('roles:view', 'roles:manage'), wrap(async (_req, res) => {
  const perms = await prisma.permission.findMany({ orderBy: { key: 'asc' } });
  res.json({ permissions: perms.length ? perms : PERMISSIONS });
}));

// Replace the full permission set of a role (configurable RBAC)
router.put(
  '/:id/permissions',
  requirePermission('roles:manage'),
  validate(z.object({ permissions: z.array(z.string()).optional() })),
  wrap(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: Number(req.params.id) } });
    if (!role) throw httpError(404, 'Role not found');
    const keys: string[] = req.body.permissions || [];
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) }),
    ]);
    await audit(req, 'UPDATE', 'roles', String(role.id), { permissions: keys });
    res.json({ ok: true, count: perms.length });
  }),
);

// Rename a role label
router.put(
  '/:id',
  requirePermission('roles:manage'),
  validate(z.object({ label: z.string().min(2).optional() })),
  wrap(async (req, res) => {
    const role = await prisma.role.update({ where: { id: Number(req.params.id) }, data: { label: req.body.label } });
    await audit(req, 'UPDATE', 'roles', String(role.id), { label: role.label });
    res.json({ role });
  }),
);

export default router;
