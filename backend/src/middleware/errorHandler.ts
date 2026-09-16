import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { NODE_ENV } from '../config/index';
import { captureError } from '../config/sentry';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
  isOperational?: boolean;
}

export function createError(
  message: string,
  statusCode: number,
  code: string,
  details?: unknown
): AppError {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  error.isOperational = true;
  return error;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Map known MongoDB/Mongoose error types to HTTP codes
  let statusCode = err.statusCode ?? 500;
  let code = err.code ?? 'INTERNAL_ERROR';
  let message = err.isOperational ? err.message : 'An unexpected error occurred';

  const errName = (err as Error).name ?? '';
  const errMsg  = (err as Error).message ?? '';

  if (errName === 'ValidationError') {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = errMsg;
  } else if (errName === 'MongoServerError' || errName === 'MongoError') {
    // Duplicate key
    if ((err as unknown as { code?: number }).code === 11000) {
      statusCode = 409;
      code = 'CONFLICT';
      message = 'Duplicate entry';
    } else {
      statusCode = 500;
      code = 'DATABASE_ERROR';
      message = NODE_ENV === 'production' ? 'A database error occurred' : errMsg;
    }
  } else if (errName === 'CastError') {
    statusCode = 400;
    code = 'BAD_REQUEST';
    message = 'Invalid ID format';
  }

  logger.error('Request error', {
    method: req.method,
    url: req.url,
    statusCode,
    code,
    message: errMsg,
    stack: err.stack,
  });

  // ── Report to Sentry ────────────────────────────────────────────────────────
  // 5xx ONLY. Every 400/401/403/404/409/422 that flows through here is the API
  // working correctly — a bad password, a validation failure, a missing record.
  // Reporting those would bury the one event that means something under
  // thousands that do not, and Sentry quotas are per-event.
  //
  // `req.route?.path` is the route TEMPLATE ("/admin/:id/refunds"), not the
  // concrete URL, so no identifier leaks through the tag. It is undefined for
  // requests that never matched a route; the path is then omitted rather than
  // substituted with `req.url`, which would carry the query string.
  if (statusCode >= 500) {
    captureError(err, {
      userId: req.user?.userId?.toString(),
      storeId: req.store?._id?.toString(),
      method: req.method,
      route: req.route?.path,
      statusCode,
      errorCode: code,
    });
  }

  const responseBody: {
    success: false;
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
  } = { success: false, code, message };

  if (err.details !== undefined) {
    responseBody.details = err.details;
  }

  if (NODE_ENV !== 'production' && err.stack) {
    responseBody.stack = err.stack;
  }

  res.status(statusCode).json(responseBody);
}
