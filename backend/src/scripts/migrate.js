/**
 * Run the schema.sql migration.
 *
 * Usage:
 *   node src/scripts/migrate.js           # apply schema (idempotent CREATE TABLE IF NOT EXISTS)
 *   node src/scripts/migrate.js --fresh   # DROP then CREATE (dev only — destroys data)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

async function main() {
  const args = new Set(process.argv.slice(2));
  const fresh = args.has('--fresh');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'poker',
    password: process.env.DB_PASSWORD || 'pokerpass',
    database: process.env.DB_NAME || 'poker777',
    multipleStatements: true,
  });

  try {
    if (fresh) {
      console.log('[migrate] --fresh: dropping existing tables...');
      const dropSql = `
        SET FOREIGN_KEY_CHECKS = 0;
        DROP TABLE IF EXISTS transactions;
        DROP TABLE IF EXISTS tables;
        DROP TABLE IF EXISTS wallets;
        DROP TABLE IF EXISTS users;
        SET FOREIGN_KEY_CHECKS = 1;
      `;
      await conn.query(dropSql);
      console.log('[migrate] tables dropped.');
    }

    const sql = await fs.readFile(SCHEMA_PATH, 'utf8');
    await conn.query(sql);
    console.log('[migrate] schema applied:', SCHEMA_PATH);

    const [rows] = await conn.query("SHOW TABLES");
    console.log('[migrate] tables now present:', rows.map((r) => Object.values(r)[0]));
  } catch (err) {
    console.error('[migrate] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
