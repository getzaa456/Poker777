import 'dotenv/config';
import fs from 'node:fs';

/** Read a required env var; throws clearly if missing. */
function required(name, fallback = null) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== null) return fallback;
    throw new Error(`[config] Missing env var: ${name}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: parseInt(required('PORT', '4000'), 10),

  corsOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    host: required('DB_HOST', '127.0.0.1'),
    port: parseInt(required('DB_PORT', '3306'), 10),
    user: required('DB_USER', 'poker'),
    password: required('DB_PASSWORD', 'pokerpass'),
    database: required('DB_NAME', 'poker777'),
    connectionLimit: parseInt(required('DB_CONNECTION_LIMIT', '10'), 10),
  },

  redis: {
    host: required('REDIS_HOST', '127.0.0.1'),
    port: parseInt(required('REDIS_PORT', '6379'), 10),
    keyPrefix: required('REDIS_KEY_PREFIX', 'poker:'),
  },

  jwt: {
    secret: required('JWT_SECRET', 'dev-only-change-me-in-production-please-32-chars-min'),
    expiresIn: required('JWT_EXPIRES_IN', '24h'),
    issuer: required('JWT_ISSUER', 'poker777'),
  },

  economy: {
    welcomeBonus: parseInt(required('WELCOME_BONUS', '1000'), 10),
    topupMin: parseInt(required('TOPUP_MIN', '1'), 10),
    topupMax: parseInt(required('TOPUP_MAX', '100000'), 10),
  },

  internalApiKey: required('INTERNAL_API_KEY', 'dev-internal-key-change-me'),
};

// Fail-fast in non-test environments if JWT secret is obviously weak.
if (!env.isTest && env.jwt.secret.length < 32) {
  throw new Error(
    '[config] JWT_SECRET must be at least 32 characters. Set a strong value in .env (use Secrets Manager in prod).'
  );
}

// Sanity log (no secrets) on boot.
if (!env.isTest) {
  console.log(
    `[config] env=${env.nodeEnv} port=${env.port} db=${env.db.host}:${env.db.port}/${env.db.database} redis=${env.redis.host}:${env.redis.port} corsOrigins=${env.corsOrigins.length}`
  );
}
