import { redisState } from './redisClient.js';

// 1. บันทึก/แก้ไขข้อมูลห้องแบบ Hash (HSET)
export async function updateRoom(roomId, fields) {
  await redisState.hset(`room:${roomId}`, fields);
  await redisState.expire(`room:${roomId}`, 7200); // รีเซ็ต TTL ให้ห้องนี้คงอยู่ใน RAM ต่ออีก 2 ชม. (7200 วินาที)
}

// 2. ดึงข้อมูลห้องทั้งหมด (HGETALL)
export async function getRoom(roomId) {
  const data = await redisState.hgetall(`room:${roomId}`);
  if (!data || Object.keys(data).length === 0) return null;
  
  // แปลงค่าจาก String ที่ได้จาก Redis กลับเป็น Number เพื่อนำไปคำนวณชิปใน Node.js
  return {
    ...data,
    pot: Number(data.pot || 0),
    currentBet: Number(data.currentBet || 0),
  };
}

// 3. บวกเงินกองกลาง (Pot) แบบ Atomic (HINCRBY)
// หมายความว่า: คำนวณบวกเลขบน RAM ของ ElastiCache ทันที ไม่ต้องดึงค่ามาบวกใน Node.js เอง
export async function addPot(roomId, amount) {
  return await redisState.hincrby(`room:${roomId}`, 'pot', amount);
}

// 4. อ่านยอดเดิมพันที่ผู้เล่นคนนี้เคยลงไว้ในรอบปัจจุบัน
export async function getPlayerBet(roomId, playerId) {
  const bet = await redisState.hget(`room:${roomId}:bets`, playerId);
  return Number(bet || 0);
}

// 5. บันทึกยอดเดิมพันรวมของผู้เล่นคนนี้ในรอบปัจจุบัน
export async function setPlayerBet(roomId, playerId, amount) {
  await redisState.hset(`room:${roomId}:bets`, playerId, amount);
  await redisState.expire(`room:${roomId}:bets`, 7200);
}

// 6. บันทึกสถานะผู้เล่นหมอบไพ่ (FOLD)
export async function setPlayerFolded(roomId, playerId) {
  await redisState.hset(`room:${roomId}:folded`, playerId, 'true');
}