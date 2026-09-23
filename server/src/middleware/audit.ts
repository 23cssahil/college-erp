import type { Request } from 'express';
import { prisma } from '../lib/prisma';

/** Fire-and-forget audit trail writer. Never throws into the request path. */
export async function audit(
  req: Request,
  action: string,
  entity: string,
  entityId?: string,
  detail?: unknown,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        detail: detail ? JSON.stringify(detail).slice(0, 2000) : null,
        ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip,
      },
    });
  } catch {
    /* auditing must not break the request */
  }
}
