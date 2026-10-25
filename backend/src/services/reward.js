/**
 * [เพิ่มฟีเจอร์] Reward Service — เหรียญหมด -> ดูคลิป -> เลือก 1 ใน 3 กล่อง
 *
 * กันโกง (Server เป็นคนตัดสินทุกอย่าง หน้าเว็บแค่แสดงผล):
 *  - รางวัลทั้ง 3 กล่องสุ่มด้วย crypto ตอน start และเก็บไว้ใน Redis เท่านั้น ไม่ส่งให้หน้าเว็บจนกว่าจะ claim
 *  - claim ได้เมื่อเวลาผ่านไปครบ watchSeconds นับจากเวลาที่ Server จดไว้ (ยิง API ตรงๆ ก็ข้ามเวลาไม่ได้)
 *  - session ใช้ได้ครั้งเดียว: ลบ key แล้วเช็คว่าลบได้จริง (claim พร้อมกันหลาย request ผ่านได้แค่ 1)
 *  - ref_id ใน transactions เป็น UNIQUE อีกชั้น -> ให้เหรียญซ้ำไม่ได้แม้ Redis มีปัญหา
 *  - รับได้เฉพาะตอนเงินใน Wallet ต่ำกว่า maxBalance + cooldown + จำกัดจำนวนครั้งต่อวัน
 */
import { randomInt, randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { redisState } from '../config/redisClient.js';
import { ApiError } from '../middleware/errors.js';

const BOX_COUNT = 3;
const SESSION_TTL_SECONDS = 600;
// [amount, weight] — ส่วนใหญ่ได้น้อย นานๆ ทีได้ก้อนใหญ่
const PRIZES = [[100, 35], [300, 30], [500, 20], [1000, 12], [3000, 3]];
const TOTAL_WEIGHT = PRIZES.reduce((sum, [, weight]) => sum + weight, 0);

const sessionKey = (userId) => `reward:session:${userId}`;
const cooldownKey = (userId) => `reward:cooldown:${userId}`;
const dailyKey = (userId) => `reward:daily:${userId}:${new Date().toISOString().slice(0, 10)}`;

function drawPrize() {
  let roll = randomInt(TOTAL_WEIGHT);
  for (const [amount, weight] of PRIZES) {
    if (roll < weight) return amount;
    roll -= weight;
  }
  return PRIZES[0][0];
}

async function getBalance(userId) {
  const [rows] = await pool.query(`SELECT balance FROM wallets WHERE user_id = :userId LIMIT 1`, { userId });
  if (!rows.length) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', 404);
  return Number(rows[0].balance) || 0;
}

/** สถานะสำหรับแสดงปุ่ม: รับได้ไหม ถ้าไม่ได้เพราะอะไร */
export async function getRewardStatus(userId) {
  const { maxBalance, dailyLimit } = env.reward;
  const [balance, cooldownTtl, usedToday] = await Promise.all([
    getBalance(userId),
    redisState.ttl(cooldownKey(userId)),
    redisState.get(dailyKey(userId)),
  ]);
  const remainingToday = Math.max(0, dailyLimit - (Number(usedToday) || 0));
  let reason = null;
  if (balance >= maxBalance) reason = 'BALANCE_TOO_HIGH';
  else if (remainingToday <= 0) reason = 'DAILY_LIMIT';
  else if (cooldownTtl > 0) reason = 'COOLDOWN';
  return {
    eligible: reason === null,
    reason,
    balance,
    max_balance: maxBalance,
    cooldown_seconds: Math.max(0, cooldownTtl),
    remaining_today: remainingToday,
    watch_seconds: env.reward.watchSeconds,
  };
}

/** เริ่มดูคลิป: จดเวลาเริ่ม + สุ่มรางวัลเก็บไว้ฝั่ง Server */
export async function startReward(userId) {
  const status = await getRewardStatus(userId);
  if (!status.eligible) {
    const messages = {
      BALANCE_TOO_HIGH: `Free chips are only for players with less than ${status.max_balance} chips.`,
      DAILY_LIMIT: 'You have used all your free chips for today.',
      COOLDOWN: `Try again in ${status.cooldown_seconds} seconds.`,
    };
    throw new ApiError(`REWARD_${status.reason}`, messages[status.reason], status.reason === 'BALANCE_TOO_HIGH' ? 409 : 429, status);
  }

  const watchMs = env.reward.watchSeconds * 1000;
  const fresh = {
    id: randomUUID(),
    startedAt: Date.now(),
    prizes: Array.from({ length: BOX_COUNT }, drawPrize),
  };
  // NX: ถ้ามี session ค้างอยู่ (เช่นรีเฟรชหน้า) ใช้อันเดิม ไม่สุ่มใหม่และไม่รีเซ็ตเวลา
  const created = await redisState.set(sessionKey(userId), JSON.stringify(fresh), 'EX', SESSION_TTL_SECONDS, 'NX');
  const session = created ? fresh : JSON.parse(await redisState.get(sessionKey(userId)) || 'null') || fresh;
  return {
    session_id: session.id,
    watch_seconds: env.reward.watchSeconds,
    ready_in_ms: Math.max(0, session.startedAt + watchMs - Date.now()),
    boxes: BOX_COUNT,
  };
}

/** เลือกกล่อง: ตรวจ session/เวลา -> ใช้ session ทิ้ง -> เติมเหรียญ -> เฉลยทุกกล่อง */
export async function claimReward(userId, input = {}) {
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const box = input.box;
  if (!Number.isInteger(box) || box < 0 || box >= BOX_COUNT) {
    throw new ApiError('INVALID_BOX', `box must be an integer from 0 to ${BOX_COUNT - 1}`);
  }

  const key = sessionKey(userId);
  const session = JSON.parse(await redisState.get(key) || 'null');
  if (!session || !sessionId || session.id !== sessionId) {
    throw new ApiError('REWARD_SESSION_INVALID', 'This reward has expired or was already claimed. Start again.', 409);
  }
  const readyInMs = session.startedAt + env.reward.watchSeconds * 1000 - Date.now();
  if (readyInMs > 0) {
    throw new ApiError('REWARD_TOO_EARLY', 'Finish watching the video first.', 425, { ready_in_ms: readyInMs });
  }
  // ใช้ได้ครั้งเดียว: request ที่ลบ key ได้เป็นคนแรกเท่านั้นที่ไปต่อ
  if ((await redisState.del(key)) !== 1) {
    throw new ApiError('REWARD_SESSION_INVALID', 'This reward was already claimed.', 409);
  }

  const amount = session.prizes[box];
  const refId = `reward:${session.id}`;
  const balance = await withTransaction(async (conn) => {
    const [walletRows] = await conn.query(
      `SELECT balance FROM wallets WHERE user_id = :userId FOR UPDATE`,
      { userId }
    );
    if (!walletRows.length) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    const balanceAfter = Number(walletRows[0].balance) + amount;
    // ref_id UNIQUE -> ถ้าเคยให้ไปแล้ว INSERT จะพังและ transaction ถูก rollback ทั้งก้อน
    await conn.query(
      `INSERT INTO transactions (user_id, amount, type, ref_id, balance_after, note)
       VALUES (:userId, :amount, 'BONUS', :refId, :balanceAfter, :note)`,
      { userId, amount, refId, balanceAfter, note: `Mystery box reward ${amount} chips` }
    );
    await conn.query(
      `UPDATE wallets SET balance = :balanceAfter, version = version + 1, updated_at = NOW()
       WHERE user_id = :userId`,
      { balanceAfter, userId }
    );
    return balanceAfter;
  });

  if (env.reward.cooldownSeconds > 0) {
    await redisState.set(cooldownKey(userId), '1', 'EX', env.reward.cooldownSeconds);
  }
  const daily = dailyKey(userId);
  await redisState.incr(daily);
  await redisState.expire(daily, 26 * 60 * 60);

  return { box, amount, prizes: session.prizes, balance };
}
