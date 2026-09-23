import { Router } from 'express';
import { z } from 'zod';
import { Role, User, Permission } from '../models';
import { wrap, httpError, oid } from '../lib/http';
import { validate } from '../lib/validate';
import { requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { PERMISSIONS } from '../permissions/catalog';

const router = Router();

// Read role + permission catalog (needed by the permission matrix UI)
router.get('/', requirePermission('roles:view', 'roles:manage', 'users:manage', 'settings:manage'), wrap(async (_req, res) => {
  const roles = await Role.find().sort({ createdAt: 1 });
  const out = await Promise.all(roles.map(async (r: any) => {
    const userCount = await User.countDocuments({ roleId: r._id });
    return {
      id: String(r._id), name: r.name, label: r.label, isSystem: r.isSystem,
      userCount, permissions: r.permissionKeys,
    };
  }));
  res.json({ roles: out });
}));

router.get('/permissions', requirePermission('roles:view', 'roles:manage'), wrap(async (_req, res) => {
  const perms = await Permission.find().sort({ key: 1 });
  res.json({ permissions: perms.length ? perms.map((p: any) => ({ key: p.key, module: p.module, action: p.action, label: p.label })) : PERMISSIONS });
}));

// Replace the full permission set of a role (configurable RBAC)
router.put(
  '/:id/permissions',
  requirePermission('roles:manage'),
  validate(z.object({ permissions: z.array(z.string()).optional() })),
  wrap(async (req, res) => {
    const role = await Role.findById(oid(req.params.id));
    if (!role) throw httpError(404, 'Role not found');
    const keys: string[] = req.body.permissions || [];
    role.permissionKeys = keys;
    await role.save();
    await audit(req, 'UPDATE', 'roles', String(role._id), { permissions: keys });
    res.json({ ok: true, count: keys.length });
  }),
);

// Rename a role label
router.put(
  '/:id',
  requirePermission('roles:manage'),
  validate(z.object({ label: z.string().min(2).optional() })),
  wrap(async (req, res) => {
    const role = await Role.findByIdAndUpdate(oid(req.params.id), { label: req.body.label }, { new: true });
    if (!role) throw httpError(404, 'Role not found');
    await audit(req, 'UPDATE', 'roles', String(role._id), { label: role.label });
    res.json({ role: { id: String(role._id), name: role.name, label: role.label, isSystem: role.isSystem } });
  }),
);

export default router;
