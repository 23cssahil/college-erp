import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'crypto';
import { env } from '../config';

/** Error carrying an HTTP status code — thrown by route handlers, caught by the error middleware. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status: number, msg: string) => new ApiError(status, msg);

/** Wrap async route handlers so rejections reach the error middleware. */
export const wrap =
  (fn: (req: any, res: Response, next: any) => Promise<any>) =>
  (req: any, res: Response, next: any) => {
    fn(req, res, next).catch((err) => {
      // Prisma known errors → friendly messages
      if (err?.code === 'P2002') {
        next(httpError(409, `Duplicate value for unique field: ${JSON.stringify(err?.meta?.target || '')}`));
      } else if (err?.code === 'P2025') {
        next(httpError(404, 'Record not found'));
      } else {
        next(err);
      }
    });
  };

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const signAccessToken = (payload: { sub: string; role: string }) =>
  jwt.sign(payload, env.accessSecret, { expiresIn: `${env.accessMinutes}m` });

export const verifyAccessToken = (token: string): { sub: string; role: string } =>
  jwt.verify(token, env.accessSecret) as any;

export const genRandomId = () => randomUUID();

/** Simple readable unique numbers: invoice / receipt */
export const genSeqNo = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;

export function parsePagination(query: any) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(query.limit || 20)));
  return { page, limit, skip: (page - 1) * limit };
}
