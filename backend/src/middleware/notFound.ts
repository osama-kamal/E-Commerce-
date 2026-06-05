import { Request, Response, NextFunction } from 'express';
import { createError } from './errorHandler';

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  const error = createError(
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    'NOT_FOUND'
  );
  next(error);
}
