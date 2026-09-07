// Phase 2: Wallet & Chip Economy tests
// Set NODE_ENV=test BEFORE importing server so server.js skips app.listen().
process.env.NODE_ENV = 'test';
process.env.REDIS_DISABLED = '1';

import { test, after } from 'node:test';
import assert from 'node:assert';
import supertest from 'supertest';
import { createApp } from '../server.js';
import { pool } from '../config/db.js';

const request = supertest(await createApp());

// Close DB pool after all tests finish so the process exits cleanly.
after(async () => {
  await pool.end();
});

function uniq(prefix) {
  const ts = String(Date.now()).slice(-5);
  return `${prefix}-${ts}-${Math.random().toString(36).slice(2, 6)}`;
}

// Helper: register a user and return { token, user }
async function registerUser(username) {
  const r = await request.post('/auth/register').send({
    username,
    email: `${username}@example.com`,
    password: 'supersecret',
  });
  assert.equal(r.status, 201);
  return r.body;
}

// ========== POST /wallet/topup ==========

test('POST /wallet/topup -> 200 with updated balance', async () => {
  const { token } = await registerUser(uniq('topup'));
  const r = await request
    .post('/wallet/topup')
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 500 });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 1500); // 1000 welcome + 500
  assert.equal(r.body.amount, 500);
  assert.equal(r.body.type, 'TOPUP');
});

test('POST /wallet/topup without token -> 401', async () => {
  const r = await request.post('/wallet/topup').send({ amount: 100 });
  assert.equal(r.status, 401);
});

test('POST /wallet/topup invalid amount (negative) -> 400', async () => {
  const { token } = await registerUser(uniq('topneg'));
  const r = await request
    .post('/wallet/topup')
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: -100 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_AMOUNT');
});

test('POST /wallet/topup invalid amount (zero) -> 400', async () => {
  const { token } = await registerUser(uniq('topzero'));
  const r = await request
    .post('/wallet/topup')
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 0 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_AMOUNT');
});

test('POST /wallet/topup invalid amount (float) -> 400', async () => {
  const { token } = await registerUser(uniq('topfloat'));
  const r = await request
    .post('/wallet/topup')
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 99.5 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_AMOUNT');
});

test('POST /wallet/topup amount too high (>100000) -> 400', async () => {
  const { token } = await registerUser(uniq('tophigh'));
  const r = await request
    .post('/wallet/topup')
    .set('Authorization', `Bearer ${token}`)
    .send({ amount: 100001 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'AMOUNT_TOO_HIGH');
});

// ========== GET /wallet/transactions ==========

test('GET /wallet/transactions -> 200 with pagination', async () => {
  const { token } = await registerUser(uniq('txlist'));
  // Do a couple topups to create transactions
  await request.post('/wallet/topup').set('Authorization', `Bearer ${token}`).send({ amount: 100 });
  await request.post('/wallet/topup').set('Authorization', `Bearer ${token}`).send({ amount: 200 });

  const r = await request
    .get('/wallet/transactions')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.transactions));
  // Should have at least 3 transactions (welcome bonus + 2 topups)
  assert.ok(r.body.transactions.length >= 3, `expected >=3 transactions, got ${r.body.transactions.length}`);
  assert.ok(r.body.pagination, 'pagination object present');
  assert.equal(typeof r.body.pagination.page, 'number');
  assert.equal(typeof r.body.pagination.totalPages, 'number');
});

test('GET /wallet/transactions newest first', async () => {
  const { token } = await registerUser(uniq('txorder'));
  await request.post('/wallet/topup').set('Authorization', `Bearer ${token}`).send({ amount: 100 });
  await request.post('/wallet/topup').set('Authorization', `Bearer ${token}`).send({ amount: 200 });

  const r = await request
    .get('/wallet/transactions')
    .set('Authorization', `Bearer ${token}`);
  const txs = r.body.transactions;
  // Verify descending order by created_at
  for (let i = 1; i < txs.length; i++) {
    assert.ok(
      new Date(txs[i - 1].created_at) >= new Date(txs[i].created_at),
      `transactions should be newest-first: ${txs[i - 1].created_at} >= ${txs[i].created_at}`
    );
  }
});

test('GET /wallet/transactions pagination ?page=1&limit=2', async () => {
  const { token } = await registerUser(uniq('txpage'));
  // Create 4 topups + 1 welcome = 5 transactions
  for (const amt of [100, 200, 300, 400]) {
    await request.post('/wallet/topup').set('Authorization', `Bearer ${token}`).send({ amount: amt });
  }

  const r = await request
    .get('/wallet/transactions?page=1&limit=2')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.transactions.length, 2);
  assert.equal(r.body.pagination.page, 1);
  assert.equal(r.body.pagination.limit, 2);
  assert.ok(r.body.pagination.total >= 5, `total should be >=5, got ${r.body.pagination.total}`);
  assert.equal(r.body.pagination.totalPages, Math.ceil(r.body.pagination.total / 2));
});

test('GET /wallet/transactions without token -> 401', async () => {
  const r = await request.get('/wallet/transactions');
  assert.equal(r.status, 401);
});

// ========== POST /internal/wallet/adjust ==========

test('POST /internal/wallet/adjust with valid key -> 200', async () => {
  const { user } = await registerUser(uniq('adj'));
  const refId = `hand-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await request
    .post('/internal/wallet/adjust')
    .set('X-Internal-Key', 'dev-internal-key')
    .send({ user_id: user.id, amount: 500, ref_id: refId });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 1500); // 1000 welcome + 500
  assert.equal(r.body.amount, 500);
  assert.equal(r.body.idempotent, false);
});

test('POST /internal/wallet/adjust negative amount (loss) -> 200', async () => {
  const { user } = await registerUser(uniq('adjloss'));
  const refId = `hand-loss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await request
    .post('/internal/wallet/adjust')
    .set('X-Internal-Key', 'dev-internal-key')
    .send({ user_id: user.id, amount: -200, ref_id: refId });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 800); // 1000 welcome - 200
  assert.equal(r.body.type, 'LOSS');
});

test('POST /internal/wallet/adjust idempotency: same ref_id -> same result, no double charge', async () => {
  const { user } = await registerUser(uniq('adjidp'));
  const refId = `hand-idem-${Date.now()}`;

  // First call: should adjust
  const r1 = await request
    .post('/internal/wallet/adjust')
    .set('X-Internal-Key', 'dev-internal-key')
    .send({ user_id: user.id, amount: 300, ref_id: refId });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.balance, 1300);
  assert.equal(r1.body.idempotent, false);

  // Second call with same ref_id: should return same balance, no change
  const r2 = await request
    .post('/internal/wallet/adjust')
    .set('X-Internal-Key', 'dev-internal-key')
    .send({ user_id: user.id, amount: 300, ref_id: refId });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.balance, 1300); // unchanged
  assert.equal(r2.body.idempotent, true);
});

test('POST /internal/wallet/adjust without key -> 401', async () => {
  const r = await request
    .post('/internal/wallet/adjust')
    .send({ user_id: '1', amount: 100, ref_id: 'no-key' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'INVALID_INTERNAL_KEY');
});

test('POST /internal/wallet/adjust wrong key -> 401', async () => {
  const r = await request
    .post('/internal/wallet/adjust')
    .set('X-Internal-Key', 'wrong-key')
    .send({ user_id: '1', amount: 100, ref_id: 'wrong-key' });
  assert.equal(r.status, 401);
});

test('POST /internal/wallet/adjust missing fields -> 400', async () => {
  const r = await request
    .post('/internal/wallet/adjust')
    .set('X-Internal-Key', 'dev-internal-key')
    .send({ amount: 100 }); // missing user_id, ref_id
  assert.equal(r.status, 400);
});

test('POST /internal/wallet/adjust zero amount -> 400', async () => {
  const { user } = await registerUser(uniq('adjzero'));
  const r = await request
    .post('/internal/wallet/adjust')
    .set('X-Internal-Key', 'dev-internal-key')
    .send({ user_id: user.id, amount: 0, ref_id: 'zero-amt' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_AMOUNT');
});

// ========== Concurrency test ==========

test('Concurrency: 50 parallel topups -> balance correct', async () => {
  const { token, user } = await registerUser(uniq('conc'));
  const N = 50;
  const amount = 10; // 50 * 10 = 500 total topup

  const promises = [];
  for (let i = 0; i < N; i++) {
    promises.push(
      request
        .post('/wallet/topup')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount })
    );
  }
  const results = await Promise.all(promises);

  // All should succeed
  const failures = results.filter(r => r.status !== 200);
  assert.equal(failures.length, 0, `expected 0 failures, got ${failures.length}: ${JSON.stringify(failures[0]?.body)}`);

  // Final balance should be 1000 (welcome) + 500 (50 * 10) = 1500
  const me = await request.get('/users/me').set('Authorization', `Bearer ${token}`);
  assert.equal(me.body.user.balance, 1000 + N * amount, `expected balance ${1000 + N * amount}, got ${me.body.user.balance}`);
});

test('Concurrency: 50 parallel internal/wallet/adjust with unique ref_ids -> balance correct', async () => {
  const { user } = await registerUser(uniq('concadj'));
  const N = 50;
  const amount = 10;

  const promises = [];
  for (let i = 0; i < N; i++) {
    promises.push(
      request
        .post('/internal/wallet/adjust')
        .set('X-Internal-Key', 'dev-internal-key')
        .send({ user_id: user.id, amount, ref_id: `hand-conc-${i}-${Date.now()}` })
    );
  }
  const results = await Promise.all(promises);

  const failures = results.filter(r => r.status !== 200);
  assert.equal(failures.length, 0, `expected 0 failures, got ${failures.length}`);

  const me = await request.get('/users/me').set('Authorization', `Bearer ${results[0].headers.authorization || ''}`);
  // Use user_id to check balance via internal endpoint or re-register/login
  // Easier: login and check /users/me
  const loginR = await request.post('/auth/login').send({
    identifier: user.username,
    password: 'supersecret',
  });
  const meCheck = await request.get('/users/me').set('Authorization', `Bearer ${loginR.body.token}`);
  assert.equal(meCheck.body.user.balance, 1000 + N * amount, `expected ${1000 + N * amount}, got ${meCheck.body.user.balance}`);
});

test('Concurrency: duplicate ref_ids in parallel -> only one charges', async () => {
  const { user } = await registerUser(uniq('concdup'));
  const refId = `hand-dup-${Date.now()}`;
  const N = 20;
  const amount = 100;

  const promises = [];
  for (let i = 0; i < N; i++) {
    promises.push(
      request
        .post('/internal/wallet/adjust')
        .set('X-Internal-Key', 'dev-internal-key')
        .send({ user_id: user.id, amount, ref_id: refId })
    );
  }
  const results = await Promise.all(promises);

  // All should return 200 (idempotent returns success)
  const successes = results.filter(r => r.status === 200);
  assert.equal(successes.length, N, `all ${N} requests should return 200`);

  // Only one should have idempotent: false
  const nonIdempotent = successes.filter(r => r.body.idempotent === false);
  assert.equal(nonIdempotent.length, 1, `exactly 1 non-idempotent, got ${nonIdempotent.length}`);

  // Balance should be 1000 (welcome) + 100 (only one charge) = 1100
  const loginR = await request.post('/auth/login').send({
    identifier: user.username,
    password: 'supersecret',
  });
  const meCheck = await request.get('/users/me').set('Authorization', `Bearer ${loginR.body.token}`);
  assert.equal(meCheck.body.user.balance, 1100, `expected 1100, got ${meCheck.body.user.balance}`);
});
