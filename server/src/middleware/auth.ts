import type { Request, Response, NextFunction } from 'express';
import { User, Role } from '../models';
import { httpError, verifyAccessToken } from '../lib/http';

export interface AuthUser {
  id: string;
  role: string; // RoleName
  roleId: string;
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

/** Load the effective permission keys for a role from the DB. */
export async function loadPermissionsForRole(roleId: string): Promise<Set<string>> {
  const role = await Role.findById(roleId).select('permissionKeys');
  return new Set(role?.permissionKeys || []);
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

    const user = await User.findById(payload.sub).populate('roleId');
    if (!user) throw httpError(401, 'Account not found');
    if (user.status !== 'ACTIVE') throw httpError(403, `Account is ${user.status.toLowerCase()}`);
    const role: any = (user as any).roleId;

    const permissions = await loadPermissionsForRole(String(role._id));
    req.user = {
      id: String(user._id),
      role: role.name,
      roleId: String(role._id),
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
    next(httpError(403, 'You are not authorised to perform this action'));
  };

/** Route guard: require the user's role to be one of the listed roles. */
export const requireRole =
  (...roles: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(httpError(401, 'Authentication required'));
    if (roles.includes(req.user.role)) return next();
    next(httpError(403, 'You are not authorised to perform this action'));
  };
