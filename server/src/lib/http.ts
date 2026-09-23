import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'crypto';
import { Types } from 'mongoose';
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

/** Cast a request id to an ObjectId, or throw a clean 404 (invalid ids never reach the driver). */
export const oid = (id: any, msg = 'Not found'): Types.ObjectId => {
  if (!Types.ObjectId.isValid(id)) throw httpError(404, msg);
  return new Types.ObjectId(id);
};

/** Wrap async route handlers so rejections reach the error middleware. */
export const wrap =
  (fn: (req: any, res: Response, next: any) => Promise<any>) =>
  (req: any, res: Response, next: any) => {
    fn(req, res, next).catch((err) => {
      // Mongoose / Mongo errors → friendly HTTP responses
      if (err?.code === 11000) {
        const field = Object.keys(err.keyValue || err.key || {})[0] || 'unique field';
        next(httpError(409, `Duplicate value for ${field}`));
      } else if (err?.name === 'CastError') {
        next(httpError(400, 'Invalid id format'));
      } else if (err?.name === 'ValidationError') {
        const first = Object.values(err.errors)[0] as any;
        next(httpError(422, first?.message || 'Invalid data'));
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
