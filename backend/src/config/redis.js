import { env } from './env.js';

/**
 * Lazy Redis client. We only create the client on first access (not on import)
 * so that test suites that exercise only the DB path don't hang on a Redis
 * connection. Set REDIS_DISABLED=1 to skip Redis entirely.
 *
 * The Game (WebSocket) team is the writer of table-state keys
 * (poker:table:{id}:state, ...:seats). This client is used by the Core API
 * for reads (e.g. merging live seat counts into GET /tables) and for the
 * internal settlement endpoint idempotency in later phases.
 */
let _redis = null;
export async function getRedis() {
  if (process.env.REDIS_DISABLED === '1' || env.redis.host === '') return null;
  if (!_redis) {
    const { default: Redis } = await import('ioredis');
    _redis = new Redis({
      host: env.redis.host,
      port: env.redis.port,
      keyPrefix: env.redis.keyPrefix,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 200, 1000),
    });
    _redis.on('error', (err) => {
      // Don't crash the process if Redis blips; the API degrades (tables list
      // falls back to DB-only seat counts).
      console.error('[redis] error:', err.message);
    });
  }
  return _redis;
}
