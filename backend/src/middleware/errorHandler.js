import { errors, ApiError } from './errors.js';

/**
 * Global error handler. Express skips this in normal flow; it only runs when
 * a route throws / calls next(err). Converts ApiError -> JSON body; anything
 * else becomes a generic 500 (leak no stack in prod).
 */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    return res.status(err.status).json(body);
  }

  // Log full error server-side; return generic to client.
  console.error('[error]', {
    method: req.method,
    path: req.path,
    message: err.message,
    stack: err.stack,
  });
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal server error' },
  });
}

/** 404 for unmatched routes. */
export function notFound(req, res, next) { // eslint-disable-line no-unused-vars
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` } });
}

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
