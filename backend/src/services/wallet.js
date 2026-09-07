/**
 * Wallet Service — topup, transactions, internal adjust
 */
import { pool, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

/**
 * POST /wallet/topup — เติมชิป
 * Atomic: UPDATE wallets + INSERT transactions ใน DB transaction เดียว
 */
export async function topUp(userId, amount) {
  // Validate
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError('INVALID_AMOUNT', 'Amount must be a positive integer');
  }
  if (amount < env.economy.topupMin) {
    throw new ApiError('AMOUNT_TOO_LOW', `Minimum topup is ${env.economy.topupMin}`);
  }
  if (amount > env.economy.topupMax) {
    throw new ApiError('AMOUNT_TOO_HIGH', `Maximum topup is ${env.economy.topupMax}`);
  }

  const refId = `topup:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  return withTransaction(async (conn) => {
    // Lock wallet row and read current balance
    const [walletRows] = await conn.query(
      `SELECT balance FROM wallets WHERE user_id = :userId FOR UPDATE`,
      { userId }
    );

    if (!walletRows.length) {
      throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    }

    const balanceAfter = walletRows[0].balance + amount;

    // Update wallet
    await conn.query(
      `UPDATE wallets SET balance = :balanceAfter, version = version + 1, updated_at = NOW()
       WHERE user_id = :userId`,
      { balanceAfter, userId }
    );

    // Insert transaction
    await conn.query(
      `INSERT INTO transactions (user_id, amount, type, ref_id, balance_after, note)
       VALUES (:userId, :amount, 'TOPUP', :refId, :balanceAfter, :note)`,
      {
        userId,
        amount,
        refId,
        balanceAfter,
        note: `Topup ${amount} chips`,
      }
    );

    return { balance: balanceAfter, amount, type: 'TOPUP' };
  });
}

/**
 * GET /wallet/transactions — pagination, newest first
 */
export async function getTransactions(userId, page = 1, limit = 20) {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT id, amount, type, ref_id, balance_after, note, created_at
     FROM transactions
     WHERE user_id = :userId
     ORDER BY created_at DESC, id DESC
     LIMIT :limit OFFSET :offset`,
    { userId, limit, offset }
  );

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM transactions WHERE user_id = :userId`,
    { userId }
  );
  const total = countResult[0].total;

  return {
    transactions: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * POST /internal/wallet/adjust — สำหรับ WS team
 * Idempotent: ถ้า ref_id ซ้ำ → return 200 เดิม ไม่ปรับยอดซ้ำ
 */
export async function adjustWallet(userId, amount, refId, note = '') {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new ApiError('INVALID_AMOUNT', 'Amount must be a non-zero integer');
  }

  return withTransaction(async (conn) => {
    const txType = amount > 0 ? 'WIN' : 'LOSS';

    // 1. Lock wallet row first — prevents race on balance
    const [walletRows] = await conn.query(
      `SELECT balance FROM wallets WHERE user_id = :userId FOR UPDATE`,
      { userId }
    );

    if (!walletRows.length) {
      throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    }

    // 2. Check idempotency AFTER acquiring wallet lock
    //    This ensures that two parallel requests with the same ref_id
    //    serialize through the wallet lock — the second one sees the
    //    transaction already committed by the first.
    const [existing] = await conn.query(
      `SELECT balance_after, amount FROM transactions WHERE ref_id = :refId LIMIT 1`,
      { refId }
    );

    if (existing.length > 0) {
      return {
        balance: existing[0].balance_after,
        amount: existing[0].amount,
        type: 'SETTLE',
        idempotent: true,
      };
    }

    const currentBalance = walletRows[0].balance;
    const balanceAfter = currentBalance + amount;

    if (balanceAfter < 0) {
      throw new ApiError('INSUFFICIENT_BALANCE', 'Insufficient balance');
    }

    // 3. Update wallet
    await conn.query(
      `UPDATE wallets SET balance = :balanceAfter, version = version + 1, updated_at = NOW()
       WHERE user_id = :userId`,
      { balanceAfter, userId }
    );

    // 4. Insert transaction
    await conn.query(
      `INSERT INTO transactions (user_id, amount, type, ref_id, balance_after, note)
       VALUES (:userId, :amount, :txType, :refId, :balanceAfter, :note)`,
      {
        userId,
        amount,
        refId,
        balanceAfter,
        txType,
        note: note || `Adjust ${amount} chips (hand: ${refId})`,
      }
    );

    return { balance: balanceAfter, amount, type: txType, idempotent: false };
  });
}
