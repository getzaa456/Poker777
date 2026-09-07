import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

// In test and dev modes, disable rate limiting so suites aren't blocked by it.
const skip = env.isTest || env.nodeEnv === 'development';

/**
 * Stricter rate limit for auth endpoints (login/register brute-force protection).
 * 10 requests per minute per IP.
 */
export const authLimiter = skip
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many auth attempts. Try again in a minute.' } },
    });

/**
 * Generic API-wide limiter (applied later in server.js).
 */
export const apiLimiter = skip
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
    });
