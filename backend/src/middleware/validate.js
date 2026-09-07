import { z } from 'zod';
import { errors } from './errors.js';

/** Convert a zod validation failure into a 400 ApiError with field details. */
export function zodToApiError(err, message = 'Validation failed') {
  const details = err.errors.map((e) => ({
    field: e.path.join('.') || '_',
    issue: e.message,
  }));
  return errors.badRequest(message, details);
}

/** Validate a value against a zod schema; throws ApiError on failure. */
export function validate(schema, value, message = 'Validation failed') {
  const result = schema.safeParse(value);
  if (!result.success) throw zodToApiError(result.error, message);
  return result.data;
}
