import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ParsedRequest {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
}

/**
 * Middleware factory — validates req against a Zod schema that can cover
 * body, params, and/or query. Returns 422 with per-field details on failure.
 *
 * On success the PARSED result is written back onto the request, so handlers
 * receive coerced values (`z.coerce.number()`), applied `.default()`s, and
 * objects with unknown keys stripped.
 *
 * Previously the parsed data was discarded and `next()` was called with the raw
 * request, which made every `.default()` and `z.coerce.*` in every schema inert
 * — handlers had to re-parse by hand (`Number(req.query.page) || 1`), and the
 * schemas provided no mass-assignment protection at all.
 *
 * ⚠️  Because the parsed value replaces the original, any field a handler reads
 * MUST be declared in the schema — an undeclared field is silently dropped.
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

    const parsed = result.data as ParsedRequest;

    // Only overwrite the sections the schema actually declares. Zod strips keys
    // it doesn't know about, so a body-only schema leaves query/params untouched
    // rather than blanking them.
    if (parsed.body !== undefined) {
      req.body = parsed.body;
    }
    if (parsed.query !== undefined) {
      // req.query is a getter on the Express request prototype; assigning here
      // shadows it with an own property, which is what downstream handlers read.
      (req as unknown as { query: unknown }).query = parsed.query;
    }
    if (parsed.params !== undefined) {
      // Mutate in place — Express holds a reference to this object while
      // dispatching the matched layer.
      Object.assign(req.params, parsed.params);
    }

    next();
  };
}
