// Set NODE_ENV=test BEFORE importing server so server.js skips app.listen().
process.env.NODE_ENV = 'test';
process.env.REDIS_DISABLED = '1';

import { test, after } from 'node:test';
import assert from 'node:assert';
import supertest from 'supertest';
import { createApp } from '../server.js';
import { pool } from '../config/db.js';

const request = supertest(await createApp());

after(async () => {
  await pool.end();
});

function uniq(prefix) {
  const ts = String(Date.now()).slice(-5);
  return `${prefix}-${ts}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerUser(prefix) {
  const username = uniq(prefix);
  const reg = await request.post('/auth/register').send({
    username,
    email: `${username}@example.com`,
    password: 'supersecret',
  });
  return { token: reg.body.token, user: reg.body.user };
}

test('POST /tables without auth -> 401', async () => {
  const r = await request.post('/tables').send({ name: 'No Auth Room' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHORIZED');
});

test('POST /tables creates a room with a random 6-char room_code', async () => {
  const { token } = await registerUser('host');
  const r = await request
    .post('/tables')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Dream Room', min_bet: 50, max_bet: 5000, max_seats: 6 });

  assert.equal(r.status, 201);
  assert.equal(r.body.table.name, 'Dream Room');
  assert.equal(r.body.table.status, 'OPEN');
  assert.equal(r.body.table.min_bet, 50);
  assert.equal(r.body.table.max_bet, 5000);
  assert.equal(r.body.table.max_seats, 6);
  assert.match(r.body.table.room_code, /^[A-Z0-9]{6}$/);
});

test('POST /tables defaults min_bet/max_bet/max_seats when omitted', async () => {
  const { token } = await registerUser('hostdef');
  const r = await request
    .post('/tables')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Defaults Room' });
  assert.equal(r.status, 201);
  assert.equal(r.body.table.min_bet, 10);
  assert.equal(r.body.table.max_bet, 1000);
  assert.equal(r.body.table.max_seats, 6);
});

test('POST /tables rejects max_bet < min_bet -> 400 BAD_REQUEST', async () => {
  const { token } = await registerUser('hostbad');
  const r = await request
    .post('/tables')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Bad Room', min_bet: 500, max_bet: 100 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'BAD_REQUEST');
});

test('POST /tables rejects missing name -> 400 BAD_REQUEST', async () => {
  const { token } = await registerUser('hostnoname');
  const r = await request.post('/tables').set('Authorization', `Bearer ${token}`).send({});
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'BAD_REQUEST');
});

test('GET /tables/:room_code returns the room for a valid code', async () => {
  const { token } = await registerUser('lookup');
  const created = await request
    .post('/tables')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Findable Room', min_bet: 10, max_bet: 1000, max_seats: 6 });

  const r = await request
    .get(`/tables/${created.body.table.room_code}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.table.room_code, created.body.table.room_code);
  assert.equal(r.body.table.name, 'Findable Room');
});

test('GET /tables/:room_code with unknown code -> 404 ROOM_NOT_FOUND', async () => {
  const { token } = await registerUser('lookupmiss');
  const r = await request.get('/tables/ZZZZZZ').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'ROOM_NOT_FOUND');
});

test('GET /tables/:room_code with malformed code -> 400 BAD_REQUEST', async () => {
  const { token } = await registerUser('lookupbad');
  const r = await request.get('/tables/abc').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'BAD_REQUEST');
});

test('POST /tables/:room_code/join -> 200 when balance covers min_bet', async () => {
  const { token: hostToken } = await registerUser('joinhost');
  const created = await request
    .post('/tables')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ name: 'Joinable Room', min_bet: 10, max_bet: 1000, max_seats: 6 });

  // Welcome bonus is 1000, well above the 10-chip min_bet.
  const { token: joinerToken } = await registerUser('joiner');
  const r = await request
    .post(`/tables/${created.body.table.room_code}/join`)
    .set('Authorization', `Bearer ${joinerToken}`)
    .send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.table.room_code, created.body.table.room_code);
});

test('POST /tables/:room_code/join with unknown code -> 404 ROOM_NOT_FOUND', async () => {
  const { token } = await registerUser('joinmiss');
  const r = await request.post('/tables/ZZZZZZ/join').set('Authorization', `Bearer ${token}`).send({});
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'ROOM_NOT_FOUND');
});

test('POST /tables/:room_code/join with buy_in above balance -> 400 INSUFFICIENT_BALANCE', async () => {
  const { token: hostToken } = await registerUser('joinhost2');
  const created = await request
    .post('/tables')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ name: 'Expensive Room', min_bet: 10, max_bet: 1_000_000, max_seats: 6 });

  const { token: joinerToken } = await registerUser('poorjoiner');
  const r = await request
    .post(`/tables/${created.body.table.room_code}/join`)
    .set('Authorization', `Bearer ${joinerToken}`)
    .send({ buy_in: 999999 }); // welcome bonus is only 1000
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INSUFFICIENT_BALANCE');
  assert.equal(r.body.error.details.required, 999999);
});

test('POST /tables/:room_code/join with buy_in below table min_bet -> 400 BUY_IN_TOO_LOW', async () => {
  const { token: hostToken } = await registerUser('joinhost3');
  const created = await request
    .post('/tables')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ name: 'High Stakes Room', min_bet: 500, max_bet: 5000, max_seats: 6 });

  const { token: joinerToken } = await registerUser('cheapjoiner');
  const r = await request
    .post(`/tables/${created.body.table.room_code}/join`)
    .set('Authorization', `Bearer ${joinerToken}`)
    .send({ buy_in: 50 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'BUY_IN_TOO_LOW');
});

test('POST /tables/:room_code/join on a CLOSED room -> 409 ROOM_CLOSED', async () => {
  const { token: hostToken } = await registerUser('joinhost4');
  const created = await request
    .post('/tables')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ name: 'Soon Closed Room', min_bet: 10, max_bet: 1000, max_seats: 6 });

  await pool.query(`UPDATE tables SET status = 'CLOSED' WHERE room_code = :code`, {
    code: created.body.table.room_code,
  });

  const { token: joinerToken } = await registerUser('lockedout');
  const r = await request
    .post(`/tables/${created.body.table.room_code}/join`)
    .set('Authorization', `Bearer ${joinerToken}`)
    .send({});
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'ROOM_CLOSED');
});
