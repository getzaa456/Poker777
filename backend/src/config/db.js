import mysql from 'mysql2/promise';
import fs from 'node:fs';
import { env } from './env.js';

const baseConfig = {
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  waitForConnections: true,
  namedPlaceholders: true,
  timezone: 'Z',
  ssl: env.db.sslCa
    ? { ca: fs.readFileSync(env.db.sslCa), rejectUnauthorized: true }
    : undefined,
};

/**
 * Primary (writer) MySQL pool — every write, and every read that must see the
 * latest data (balances, login, a table that was just created, transactions).
 * Use query() with placeholders only — never string-concatenate values.
 */
export const pool = mysql.createPool({ ...baseConfig, host: env.db.host });

// RDS MySQL read replicas each have their own endpoint (there is no shared reader
// endpoint like Aurora), so spread reads across them round-robin.
const replicaPools = env.db.readHosts.map((host) => mysql.createPool({ ...baseConfig, host }));
let nextReplica = 0;

// Errors that mean "this replica is unreachable", not "the query is wrong".
const CONNECTION_ERRORS = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_SERVER_SHUTDOWN',
]);

/**
 * Pool for read-only queries that can be a moment behind the primary (replication
 * lag is usually milliseconds): room lists, transaction history, hand history/stats.
 * Without DB_READ_HOSTS — or if a replica is unreachable — it reads from the primary.
 */
export const readPool = {
  async query(sql, params) {
    if (!replicaPools.length) return pool.query(sql, params);
    const replica = replicaPools[nextReplica++ % replicaPools.length];
    try {
      return await replica.query(sql, params);
    } catch (err) {
      if (!CONNECTION_ERRORS.has(err?.code)) throw err;
      console.warn(`[db] read replica unavailable (${err.code}); reading from primary`);
      return pool.query(sql, params);
    }
  },
};

/** Run a function inside a transaction. Rolls back on any throw. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore rollback error */ }
    throw err;
  } finally {
    conn.release();
  }
}
