import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from './http';

/** Validate req.body (default), or a chosen source, against a Zod schema. */
export const validate =
  (schema: z.ZodTypeAny, source: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const first = result.error.errors[0];
      return next(new ApiError(422, `${first.path.join('.') || 'body'}: ${first.message}`));
    }
    req[source] = result.data;
    next();
  };

// Common reusable schemas
export const idParam = z.object({ id: z.string().min(1) });
export const optionalStr = z.string().trim().optional();
export const blankToUndef = (v?: string | null) => {
  const s = (v ?? '').toString().trim();
  return s.length ? s : undefined;
};
export const toBool = (v: any) => v === true || v === 'true' || v === 1 || v === '1';
export const toDate = (v?: string | null) => (v ? new Date(v) : undefined);
export const toNum = (v: any) => (v === '' || v == null ? undefined : Number(v));
