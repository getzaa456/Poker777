// Runs backend/src/server.js unchanged, but swaps `ioredis` for ioredis-mock and
// `mysql2/promise` for an in-memory fake (see hooks.mjs). Data lives in RAM only:
// restarting wipes every account and room. Seeds two test players on start.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);

process.env.PORT = process.env.DEMO_PORT || '4000';
process.env.NODE_ENV = 'development';
process.env.REDIS_HOST = '127.0.0.1';

await import('../../backend/src/server.js');

const base = `http://localhost:${process.env.PORT}`;
const password = 'demo-pass-123';
for (const username of ['player1', 'player2']) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@poker777.test`, password }),
  });
  console.log(`[demo] seeded ${username}: ${res.ok ? 'ok' : `HTTP ${res.status}`}`);
}
console.log(`[demo] ready. Log in as player1 / player2 (password in test_host.md) at http://localhost:3000`);
