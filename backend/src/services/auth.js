import bcrypt from 'bcryptjs';
import { jwt } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../config/db.js';
import { errors } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { registerSchema, loginSchema, updateUserSchema } from '../validators/auth.js';

const BCRYPT_COST = 12;

/**
 * Register a new user. Welcome bonus is credited atomically in the same
 * DB transaction so we never end up with a user but no wallet/transaction.
 *
 * Idempotency: ref_id = `register:<userId>` — if re-run after a partial
 * failure it cannot double-credit because the transactions table has a
 * unique constraint on ref_id.
 */
export async function registerUser(input) {
  const { username, email, password } = validate(registerSchema, input);

  // Pre-check to give a nicer 409 (the unique constraints will still reject
  // any race that slips between the check and the insert).
  const [existing] = await pool.query(
    `SELECT username FROM users WHERE username = :username OR email = :email LIMIT 1`,
    { username, email }
  );
  if (existing.length) {
    const clash = existing[0].username === username ? 'username' : 'email';
    throw errors.conflict(
      clash === 'username' ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN',
      `${clash === 'username' ? 'Username' : 'Email'} already registered`
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const bonus = env.economy.welcomeBonus;

  const { userId } = await withTransaction(async (conn) => {
    const [userRows] = await conn.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES (:username, :email, :passwordHash)`,
      { username, email, passwordHash }
    );
    const newUserId = String(userRows.insertId);

    // Create wallet with the welcome bonus as the starting balance.
    await conn.query(
      `INSERT INTO wallets (user_id, balance) VALUES (:userId, :bonus)`,
      { userId: newUserId, bonus }
    );

    // Append the ledger row. ref_id guarantees idempotency.
    await conn.query(
      `INSERT INTO transactions (user_id, type, amount, balance_after, ref_id)
       VALUES (:userId, 'BONUS', :bonus, :bonus, :refId)`,
      { userId: newUserId, bonus, refId: `register:${newUserId}` }
    );

    return { userId: newUserId };
  });

  const token = signJwt(userId, username);
  return {
    token,
    user: { id: userId, username, email, avatar_id: null, balance: bonus },
  };
}

/**
 * Login by username or email. Single 401 for any failure — do not leak
 * whether the username exists.
 */
export async function loginUser(input) {
  const { identifier, password } = validate(loginSchema, input);

  // Look up by username OR email.
  const [rows] = await pool.query(
    `SELECT id, username, email, password_hash
       FROM users
      WHERE username = :identifier OR email = :identifier
      LIMIT 1`,
    { identifier }
  );
  // Always run a bcrypt compare even when not found, to keep timing uniform.
  const dummyHash = '$2a$12$000000000000000000000000000000000000000000000000000000';
  const hash = rows.length ? rows[0].password_hash : dummyHash;
  const ok = await bcrypt.compare(password, hash);
  if (!rows.length || !ok) {
    throw errors.unauthorized('Invalid credentials');
  }

  const user = rows[0];
  const token = signJwt(String(user.id), user.username);
  return { token, user: { id: String(user.id), username: user.username } };
}

/** Fetch the current user's profile + wallet balance. */
export async function getUserProfile(userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.email, u.display_name, u.avatar_id, u.created_at,
            w.balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
      WHERE u.id = :userId
      LIMIT 1`,
    { userId }
  );
  if (!rows.length) throw errors.notFound('User not found');
  const u = rows[0];
  return {
    id: String(u.id),
    username: u.username,
    email: u.email,
    display_name: u.display_name,
    avatar_id: u.avatar_id,
    balance: u.balance ?? 0,
    created_at: u.created_at,
  };
}

/** Patch display_name / avatar_id for the current user. */
export async function updateUserProfile(userId, patch) {
  const data = validate(updateUserSchema, patch);

  const [result] = await pool.query(
    `UPDATE users SET
        avatar_id  = COALESCE(:avatar_id, avatar_id),
        display_name = COALESCE(:display_name, display_name)
      WHERE id = :userId`,
    {
      avatar_id: data.avatar_id ?? null,
      display_name: data.display_name ?? null,
      userId,
    }
  );
  if (result.affectedRows === 0) throw errors.notFound('User not found');
  return getUserProfile(userId);
}

function signJwt(userId, username) {
  return jwt.sign({ sub: userId, username }, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
    issuer: env.jwt.issuer,
  });
}
