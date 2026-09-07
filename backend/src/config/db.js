import mysql from 'mysql2/promise';
import { env } from './env.js';

/**
 * Shared MySQL connection pool.
 * Use query() with placeholders only — never string-concatenate values.
 */
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  waitForConnections: true,
  namedPlaceholders: true,
  timezone: 'Z',
});

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
