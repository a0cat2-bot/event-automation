import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

type RequestSchemas = Partial<Record<'body' | 'params' | 'query', ZodTypeAny>>;

export function validate(schemas: RequestSchemas) {
  return (request: Request, response: Response, next: NextFunction) => {
    for (const target of ['params', 'query', 'body'] as const) {
      const schema = schemas[target];
      if (!schema) continue;

      const result = schema.safeParse(request[target]);
      if (!result.success) {
        response.status(400).json({
          error: 'Validation failed',
          target,
          issues: result.error.issues,
        });
        return;
      }
    }

    next();
  };
}
