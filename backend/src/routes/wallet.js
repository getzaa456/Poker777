/**
 * Wallet Routes — GET /wallet/transactions, /wallet/history, /wallet/reward*, POST /internal/wallet/adjust
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getTransactions, getHandHistory, adjustWallet } from '../services/wallet.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';
import { getRewardStatus, startReward, claimReward } from '../services/reward.js';

export const router = Router();

// [แก้บัค]: ลบ POST /wallet/topup — เติมเหรียญฟรีได้ครั้งละ 100,000 ไม่จำกัดครั้ง (เศรษฐกิจในเกมพัง)
// เหรียญฟรีตอนนี้มาจาก /wallet/reward (ดูคลิป + กล่องสุ่ม มี cooldown และจำกัดต่อวัน) เท่านั้น

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

router.get('/wallet/history', requireAuth, async (req, res, next) => {
  try {
    const result = await getHandHistory(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// [เพิ่มฟีเจอร์]: เหรียญหมด -> ดูคลิป -> เลือกกล่อง (กติกาและการกันโกงอยู่ใน services/reward.js)
router.get('/wallet/reward', requireAuth, async (req, res, next) => {
  try {
    res.json(await getRewardStatus(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post('/wallet/reward/start', requireAuth, async (req, res, next) => {
  try {
    res.json(await startReward(req.user.id));
  } catch (err) {
    next(err);
  }
});

// Body: { session_id: string, box: 0 | 1 | 2 }
router.post('/wallet/reward/claim', requireAuth, async (req, res, next) => {
  try {
    res.json(await claimReward(req.user.id, req.body));
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
