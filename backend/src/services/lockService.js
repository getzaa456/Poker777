import { redisState } from '../config/redisClient.js';

// สคริปต์ Lua สำหรับปลดล็อก: จะลบ Key ก็ต่อเมื่อ Token ตรงกับคนที่สร้างขึ้นเท่านั้น
// หมายความว่า: ป้องกันไม่ให้ EC2 เครื่องเราไปเผลอลบ Lock ของ EC2 เครื่องอื่นที่อาจจะทำงานช้าจน Lock เราหมดอายุไปแล้ว
const UNLOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
`;

export async function withLock(roomId, actionLogic) {
  const lockKey = `lock:room:${roomId}`;                  // ชื่อ Key สำหรับล็อกห้องนี้
  const token = Math.random().toString(36).substring(2);  // สร้าง Token สุ่มเพื่อระบุตัวตนของผู้ถือ Lock

  // สั่ง Redis สร้าง Key ล็อก
  // 'PX', 3000 = ให้ Lock มีอายุขัย 3000 มิลลิวินาที (3 วินาที) แล้วลบตัวเองอัตโนมัติกัน ค้าง
  // 'NX' = บันทึกสำเร็จก็ต่อเมื่อ Key นี้ "ยังไม่มีอยู่" เท่านั้น (ถ้ามีคนล็อกอยู่แล้วจะคืนค่า null)
  // [แก้บัค]: เดิมขอครั้งเดียวไม่ได้ก็ throw ทันที -> Action/การหลุดเน็ตที่ชนกับงานอื่นหายไปเลย
  // (เช่น handleDisconnect ชนกับ Timer ทำให้เกิดที่นั่งผีที่ไม่มีวันถูกลบ) จึงรอแล้วลองใหม่ประมาณ 2 วินาที
  let isAcquired = null;
  for (let attempt = 0; attempt < 40 && !isAcquired; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 30 + Math.floor(Math.random() * 40)));
    isAcquired = await redisState.set(lockKey, token, 'PX', 3000, 'NX');
  }

  // ถ้ายังขอกุญแจไม่ได้ แสดงว่ามีคำสั่งอื่นของห้องนี้กำลังประมวลผลอยู่บน EC2 เครื่องอื่นนานผิดปกติ
  if (!isAcquired) throw new Error('Room is busy');

  try {
    // ได้กุญแจแล้ว: ให้รัน Logic ของเกมบน EC2 เครื่องนี้
    return await actionLogic();
  } finally {
    // ทำงานเสร็จแล้ว (หรือเกิด Error): สั่งรัน Lua Script บน Redis เพื่อปลดล็อกออกทันที
    await redisState.eval(UNLOCK_SCRIPT, 1, lockKey, token);
  }
}