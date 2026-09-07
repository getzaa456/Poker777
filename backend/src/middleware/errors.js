/**
 * Normalised API error. Throw this anywhere; the error middleware turns it
 * into the response body { error: { code, message, details? } }.
 *
 * Keep codes STABLE — the frontend and the Game team's WS error format
 * (see docs/CONTRACTS.md) rely on them.
 */
export class ApiError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Common factory errors so handlers stay terse. */
export const errors = {
  badRequest: (message = 'Bad request', details = null) =>
    new ApiError('BAD_REQUEST', message, 400, details),
  unauthorized: (message = 'Unauthorized') =>
    new ApiError('UNAUTHORIZED', message, 401),
  forbidden: (message = 'Forbidden') =>
    new ApiError('FORBIDDEN', message, 403),
  notFound: (message = 'Not found') =>
    new ApiError('NOT_FOUND', message, 404),
  conflict: (code, message, details = null) =>
    new ApiError(code, message, 409, details),
  tooMany: (message = 'Too many requests') =>
    new ApiError('RATE_LIMITED', message, 429),
  internal: (message = 'Internal server error') =>
    new ApiError('INTERNAL', message, 500),
};
