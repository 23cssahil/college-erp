import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../lib/http';
import { env } from '../config';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Endpoint not found' });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof ApiError ? err.status : err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  if (status >= 500) console.error('[ERP]', err);
  res.status(status).json({
    error: message,
    ...(env.nodeEnv !== 'production' && status >= 500 ? { stack: err.stack } : {}),
  });
}
