/**
 * Wallet Routes — POST /wallet/topup, GET /wallet/transactions, POST /internal/wallet/adjust
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { topUp, getTransactions, adjustWallet } from '../services/wallet.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

export const router = Router();

/**
 * POST /wallet/topup
 * Auth: required
 * Body: { amount: int }
 */
router.post('/wallet/topup', requireAuth, async (req, res, next) => {
  try {
    const { amount } = req.body;
    const result = await topUp(req.user.id, amount);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /wallet/transactions
 * Auth: required
 * Query: ?page=1&limit=20
 */
router.get('/wallet/transactions', requireAuth, async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await getTransactions(req.user.id, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /internal/wallet/adjust
 * Auth: X-Internal-Key header (shared secret between Core API and WS team)
 * Body: { user_id: string, amount: int, ref_id: string, note?: string }
 * Idempotent: if ref_id already exists, return 200 with existing balance
 */
router.post('/internal/wallet/adjust', async (req, res, next) => {
  try {
    // Check internal API key
    const key = req.headers['x-internal-key'];
    if (!key || key !== env.internalApiKey) {
      throw new ApiError('INVALID_INTERNAL_KEY', 'Invalid internal API key', 401);
    }

    const { user_id, amount, ref_id, note } = req.body;

    if (!user_id) {
      throw new ApiError('MISSING_USER_ID', 'user_id is required');
    }
    if (amount === undefined || amount === null) {
      throw new ApiError('MISSING_AMOUNT', 'amount is required');
    }
    if (!ref_id) {
      throw new ApiError('MISSING_REF_ID', 'ref_id is required');
    }

    const result = await adjustWallet(user_id, amount, ref_id, note);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
