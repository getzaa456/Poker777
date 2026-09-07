import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { errors } from './errors.js';

/**
 * Auth middleware: verifies Bearer JWT and attaches decoded payload to req.user.
 * Throws 401 for missing/malformed/expired tokens.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(errors.unauthorized('Missing or malformed Authorization header'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = jwt.verify(token, env.jwt.secret, {
      issuer: env.jwt.issuer,
    });
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    // jwt throws TokenExpiredError or JsonWebTokenError; both -> 401.
    return next(errors.unauthorized('Invalid or expired token'));
  }
}

export { jwt };
