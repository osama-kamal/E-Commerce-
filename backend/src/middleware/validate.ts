import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Middleware factory — validates req against a Zod schema that can cover
 * body, params, and/or query. Returns 422 with per-field details on failure.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      const details = (result.error as ZodError).errors.map((e) => ({
        field: e.path.slice(1).join('.'), // strip leading 'body'/'params'/'query'
        message: e.message,
      }));

      res.status(422).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details,
      });
      return;
    }

    next();
  };
}
