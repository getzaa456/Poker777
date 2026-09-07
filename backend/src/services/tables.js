import { pool } from '../config/db.js';
import { getRedis } from '../config/redis.js';
import { errors, ApiError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { createTableSchema, joinTableSchema, roomCodeSchema } from '../validators/tables.js';

// Letters/digits with ambiguous glyphs (0/O, 1/I) removed so a room code is
// easy to read aloud / retype from a screen.
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 8;

function randomRoomCode() {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Best-effort live seat count for a table. The Game/WebSocket team owns the
 * `table:{id}:seats` Redis key (see schema.sql header comment) — we only
 * ever read it here. Returns null (unknown) if Redis is disabled/unreachable
 * so callers can degrade gracefully instead of hard-failing.
 */
async function getLiveSeatCount(tableId) {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const count = await redis.scard(`table:${tableId}:seats`);
    return Number.isFinite(count) ? count : null;
  } catch (err) {
    console.error('[tables] redis seat lookup failed:', err.message);
    return null;
  }
}

function serializeTable(row, seatsTaken) {
  return {
    id: String(row.id),
    room_code: row.room_code,
    name: row.name,
    host_id: String(row.host_id),
    min_bet: row.min_bet,
    max_bet: row.max_bet,
    max_seats: row.max_seats,
    status: row.status,
    created_at: row.created_at,
    seats_taken: seatsTaken,
    seats_available: seatsTaken === null ? null : Math.max(row.max_seats - seatsTaken, 0),
  };
}

async function findTableRow(roomCode) {
  const code = validate(roomCodeSchema, roomCode, 'Invalid room code');
  const [rows] = await pool.query(`SELECT * FROM tables WHERE room_code = :code LIMIT 1`, { code });
  return rows[0] || null;
}

function roomNotFoundError() {
  return new ApiError('ROOM_NOT_FOUND', 'Room not found — double-check the room code and try again.', 404);
}

/**
 * Create a room. Retries on room_code collisions (the column has a UNIQUE
 * constraint) — astronomically unlikely at 6 chars from a 33-char alphabet
 * (~1.3B combinations), but we defend against the race anyway rather than
 * pre-checking then inserting.
 */
export async function createTable(hostId, input) {
  const data = validate(createTableSchema, input);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const roomCode = randomRoomCode();
    try {
      const [result] = await pool.query(
        `INSERT INTO tables (room_code, name, host_id, min_bet, max_bet, max_seats, status)
         VALUES (:roomCode, :name, :hostId, :minBet, :maxBet, :maxSeats, 'OPEN')`,
        {
          roomCode,
          name: data.name,
          hostId,
          minBet: data.min_bet,
          maxBet: data.max_bet,
          maxSeats: data.max_seats,
        }
      );
      const [rows] = await pool.query(`SELECT * FROM tables WHERE id = :id LIMIT 1`, { id: result.insertId });
      return serializeTable(rows[0], 0);
    } catch (err) {
      // room_code collision — try another random code.
      if (err && err.code === 'ER_DUP_ENTRY' && /uq_tables_room_code/.test(err.message || '')) {
        continue;
      }
      throw err;
    }
  }
  throw errors.internal('Could not allocate a free room code — please try again.');
}

/**
 * Table info for the waiting-room screen / join preview: DB row + best-effort
 * live seat count. Does not touch the caller's wallet or change anything.
 */
export async function getTableSummary(roomCode) {
  const row = await findTableRow(roomCode);
  if (!row) throw roomNotFoundError();
  const seatsTaken = await getLiveSeatCount(row.id);
  return serializeTable(row, seatsTaken);
}

/**
 * Validate a join attempt against every failure mode we can check from here:
 *  - room doesn't exist            -> 404 ROOM_NOT_FOUND
 *  - room closed / already playing -> 409 ROOM_CLOSED / ROOM_IN_PROGRESS
 *  - room full (live seat count)   -> 409 ROOM_FULL
 *  - buy-in outside the table's min/max_bet -> 400 BUY_IN_TOO_LOW / TOO_HIGH
 *  - wallet balance can't cover it -> 400 INSUFFICIENT_BALANCE
 *
 * On success returns the table so the client can proceed to the table screen
 * / open a game session. Core API does not itself seat the player — that is
 * the Game/WebSocket team's job once the client connects.
 */
export async function joinTable(userId, roomCode, input) {
  const { buy_in } = validate(joinTableSchema, input || {});

  const row = await findTableRow(roomCode);
  if (!row) throw roomNotFoundError();

  if (row.status === 'CLOSED') {
    throw new ApiError('ROOM_CLOSED', 'This room has been closed by the host.', 409);
  }
  if (row.status === 'IN_PROGRESS') {
    throw new ApiError('ROOM_IN_PROGRESS', 'This room already has a hand in progress. Try again shortly.', 409);
  }

  const seatsTaken = await getLiveSeatCount(row.id);
  if (seatsTaken !== null && seatsTaken >= row.max_seats) {
    throw new ApiError('ROOM_FULL', 'This room is full.', 409, {
      max_seats: row.max_seats,
      seats_taken: seatsTaken,
    });
  }

  if (buy_in !== undefined && buy_in < row.min_bet) {
    throw new ApiError('BUY_IN_TOO_LOW', `The minimum buy-in for this room is ${row.min_bet} chips.`, 400, {
      min_bet: row.min_bet,
    });
  }
  if (buy_in !== undefined && buy_in > row.max_bet) {
    throw new ApiError('BUY_IN_TOO_HIGH', `The maximum buy-in for this room is ${row.max_bet} chips.`, 400, {
      max_bet: row.max_bet,
    });
  }

  const [walletRows] = await pool.query(`SELECT balance FROM wallets WHERE user_id = :userId LIMIT 1`, { userId });
  const balance = walletRows.length ? walletRows[0].balance : 0;
  const requiredAmount = buy_in ?? row.min_bet;

  if (balance < requiredAmount) {
    throw new ApiError('INSUFFICIENT_BALANCE', 'Your chip balance is not enough to join this room.', 400, {
      required: requiredAmount,
      balance,
    });
  }

  return serializeTable(row, seatsTaken);
}
