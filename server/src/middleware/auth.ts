import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { httpError } from '../lib/http';
import { verifyAccessToken } from '../lib/http';

export interface AuthUser {
  id: string;
  role: string; // RoleName
  roleId: number;
  fullName: string;
  permissions: Set<string>; // expanded grant keys
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Load the effective permission keys for a role from the DB (cached per request). */
export async function loadPermissionsForRole(roleId: number): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: { select: { key: true } } },
  });
  return new Set(rows.map((r) => r.permission.key));
}

/** Check a permission key against the user's grants, honouring "*:*" and "module:*". */
export function userHas(user: AuthUser, needed: string): boolean {
  if (user.permissions.has('*:*')) return true;
  if (user.permissions.has(needed)) return true;
  const [mod] = needed.split(':');
  if (user.permissions.has(`${mod}:*`)) return true;
  return false;
}

/** Verify Bearer token and hydrate req.user. Rejects inactive/deleted accounts. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw httpError(401, 'Authentication required');

    let payload: { sub: string; role: string };
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw httpError(401, 'Invalid or expired token');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user) throw httpError(401, 'Account not found');
    if (user.status !== 'ACTIVE') throw httpError(403, `Account is ${user.status.toLowerCase()}`);

    const permissions = await loadPermissionsForRole(user.roleId);
    req.user = {
      id: user.id,
      role: user.role.name,
      roleId: user.roleId,
      fullName: user.fullName,
      permissions,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Route guard: require one of the given permission keys (any-of). */
export const requirePermission =
  (...keys: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(httpError(401, 'Authentication required'));
    if (keys.length === 0 || keys.some((k) => userHas(req.user!, k))) return next();
    next(httpError(403, `Forbidden: requires ${keys.join(' or ')}`));
  };

/** Route guard: require the user's role to be one of the listed roles. */
export const requireRole =
  (...roles: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(httpError(401, 'Authentication required'));
    if (roles.includes(req.user.role)) return next();
    next(httpError(403, 'Forbidden for your role'));
  };
