import Redis from 'ioredis';

// กำหนดการเชื่อมต่อ ElastiCache Endpoint
const config = {
  host: process.env.REDIS_HOST, // อ่านค่า AWS ElastiCache Primary Endpoint จาก env
  port: 6379,                   // พอร์ตมาตรฐาน Redis
  tls: {},                      // เปิด SSL/TLS เพื่อความปลอดภัยบน AWS (จำเป็นสำหรับ ElastiCache)
};

// 1. ท่ออ่าน-เขียน State: ใช้สำหรับคำสั่ง HSET, HGETALL, HINCRBY (อัปเดต/อ่านสถานะเกม)
export const redisState = new Redis(config);

// 2. ท่อ Publisher: ใช้สำหรับยิงคำสั่ง PUBLISH กระจายข่าวสารไปยัง EC2 เครื่องอื่น
export const redisPub = new Redis(config);

// 3. ท่อ Subscriber: ใช้สำหรับสั่ง SUBSCRIBE รอฟังข่าวสารอย่างเดียว
// (เหตุผลที่ต้องแยก: ท่อที่สั่ง Subscribe แล้ว จะโดนล็อกให้รับฟังข่าวได้อย่างเดียว ไม่สามารถส่งคำสั่งอื่นได้)
export const redisSub = new Redis(config);