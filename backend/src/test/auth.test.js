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

// `app` is an Express instance; supertest uses it directly without binding a
// port, so no listen() is needed.

function uniq(prefix) {
  // Use short timestamp suffix (last 5 digits of Date.now()) to stay within 30-char limit.
  const ts = String(Date.now()).slice(-5);
  return `${prefix}-${ts}-${Math.random().toString(36).slice(2, 6)}`;
}

test('GET /health returns ok', async () => {
  const r = await request.get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('POST /auth/register -> 201 with token + welcome bonus', async () => {
  const username = uniq('user');
  const r = await request.post('/auth/register').send({
    username,
    email: `${username}@example.com`,
    password: 'supersecret',
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.token, 'token present');
  assert.equal(r.body.user.username, username);
  assert.equal(r.body.user.balance, 1000, 'welcome bonus credited');
});

test('POST /auth/register duplicate username -> 409 USERNAME_TAKEN', async () => {
  const username = uniq('dupe');
  await request.post('/auth/register').send({
    username,
    email: `${username}@example.com`,
    password: 'supersecret',
  });
  const r = await request.post('/auth/register').send({
    username,
    email: `other-${username}@example.com`,
    password: 'supersecret',
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'USERNAME_TAKEN');
});

test('POST /auth/register invalid input -> 400 with details', async () => {
  const r = await request.post('/auth/register').send({
    username: 'ab', // too short
    email: 'not-an-email',
    password: '123',
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'BAD_REQUEST');
  assert.ok(Array.isArray(r.body.error.details));
});

test('POST /auth/login with username -> 200 token', async () => {
  const username = uniq('login');
  await request.post('/auth/register').send({
    username,
    email: `${username}@example.com`,
    password: 'supersecret',
  });
  const r = await request.post('/auth/login').send({
    identifier: username,
    password: 'supersecret',
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.user.username, username);
});

test('POST /auth/login with email -> 200 token', async () => {
  const username = uniq('loginmail');
  const email = `${username}@example.com`;
  await request.post('/auth/register').send({
    username,
    email,
    password: 'supersecret',
  });
  const r = await request.post('/auth/login').send({
    identifier: email,
    password: 'supersecret',
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});

test('POST /auth/login wrong password -> 401 (same regardless of existence)', async () => {
  const r1 = await request.post('/auth/login').send({
    identifier: 'definitely-no-such-user',
    password: 'whatever',
  });
  const r2 = await request.post('/auth/login').send({
    identifier: 'definitely-no-such-user',
    password: 'other',
  });
  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  assert.equal(r1.body.error.code, 'UNAUTHORIZED');
  assert.equal(r2.body.error.code, 'UNAUTHORIZED');
});

test('GET /users/me without token -> 401', async () => {
  const r = await request.get('/users/me');
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHORIZED');
});

test('GET /users/me with bad token -> 401', async () => {
  const r = await request.get('/users/me').set('Authorization', 'Bearer not.a.jwt');
  assert.equal(r.status, 401);
});

test('GET /users/me with valid token -> 200 profile + balance', async () => {
  const username = uniq('me');
  const reg = await request.post('/auth/register').send({
    username,
    email: `${username}@example.com`,
    password: 'supersecret',
  });
  const r = await request.get('/users/me').set('Authorization', `Bearer ${reg.body.token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, username);
  assert.equal(r.body.user.balance, 1000);
});

test('PATCH /users/me updates avatar_id -> 200', async () => {
  const username = uniq('av');
  const reg = await request.post('/auth/register').send({
    username,
    email: `${username}@example.com`,
    password: 'supersecret',
  });
  const r = await request
    .patch('/users/me')
    .set('Authorization', `Bearer ${reg.body.token}`)
    .send({ avatar_id: 'robot-07' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.avatar_id, 'robot-07');
});

test('Unknown route -> 404 NOT_FOUND', async () => {
  const r = await request.get('/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
});
