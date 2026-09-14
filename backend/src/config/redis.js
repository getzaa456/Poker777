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
let _publisher = null;
let _subscriber = null;

function redisDisabled() {
  return process.env.REDIS_DISABLED === '1' || env.redis.host === '';
}

async function createClient() {
  const { default: Redis } = await import('ioredis');
  const client = new Redis({
    host: env.redis.host,
    port: env.redis.port,
    keyPrefix: env.redis.keyPrefix,
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 200, 1000),
  });
  client.on('error', (err) => console.error('[redis] error:', err.message));
  return client;
}

export async function getRedis() {
  if (redisDisabled()) return null;
  if (!_redis) {
    _redis = await createClient();
  }
  return _redis;
}

// Pub/Sub connections must not be shared with the command connection.
export async function getRedisPublisher() {
  if (redisDisabled()) return null;
  if (!_publisher) _publisher = await createClient();
  return _publisher;
}

export async function getRedisSubscriber() {
  if (redisDisabled()) return null;
  if (!_subscriber) _subscriber = await createClient();
  return _subscriber;
}

export async function withRedisLock(key, work, ttlMs = 5000) {
  const redis = await getRedis();
  if (!redis) {
    if (env.isProd) return false;
    return work();
  }
  const lockKey = `lock:${key}`;
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
  if (!acquired) return false;
  try {
    return await work();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      token
    );
  }
}
