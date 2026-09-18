import { WebSocketServer } from 'ws';
import { redisPub, redisSub } from './redisClient.js';
import {
  updateRoom,
  getRoom,
  addPot,
  getPlayerBet,
  setPlayerBet,
  setPlayerFolded,
} from './roomService.js';
import { withLock } from './lockService.js';

// เปิด WebSocket Server บนพอร์ต 8080 ของ EC2 เครื่องนี้
const wss = new WebSocketServer({ port: 8080 });
const CHANNEL = 'poker:events'; // ชื่อช่องสัญญาณ Redis Pub/Sub

// -------------------------------------------------------------------
// Step A: ฝั่งรอรับข่าวจาก Redis Pub/Sub (ทำงานเมื่อมี EC2 เครื่องไหนก็ได้ Publish มา)
// -------------------------------------------------------------------
redisSub.subscribe(CHANNEL); // ลงทะเบียนฟังช่อง poker:events
redisSub.on('message', (channel, message) => {
  if (channel === CHANNEL) {
    // Deserialization: แปลงข้อความ String JSON จาก Redis กลับมาเป็น JavaScript Object
    const event = JSON.parse(message);

    // วนลูปส่งต่อข่าวสารให้ Client ที่เกาะอยู่กับ WebSocket ของ EC2 เครื่องนี้
    wss.clients.forEach((client) => {
      // ตรวจสอบว่าท่อ WebSocket ยังไม่หลุด และผู้เล่นอยู่นั่งตรงกับ roomId ของ Event หรือไม่
      if (client.readyState === 1 && client.roomId === event.roomId) {
        // ยิงข้อมูล Event ไปหา Client (แปลง Object เป็น String JSON)
        client.send(JSON.stringify(event));
      }
    });
  }
});

// -------------------------------------------------------------------
// Step B: ฝั่งรับคำสั่ง WebSocket จากผู้เล่นที่เชื่อมต่อเข้ามาที่ EC2 เครื่องนี้
// -------------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    // แปลงข้อความที่ส่งมาจากผู้เล่นให้อยู่ในรูปแบบ Object
    const payload = JSON.parse(data);
    const { roomId, action, playerId, amount, nextTurn } = payload;

    // 1. กรณีผู้เล่นขอเชื่อมต่อเข้าห้อง (JOIN)
    if (action === 'JOIN') {
      ws.roomId = roomId;     // จำไว้ใน Socket connection ว่าผู้เล่นคนนี้อยู่ห้องไหน
      ws.playerId = playerId; // จำไว้ว่าผู้เล่นคนนี้เป็นใคร
      const currentRoom = await getRoom(roomId); // ดึง State ทั้งหมดจาก Redis
      ws.send(JSON.stringify({ type: 'SYNC_STATE', data: currentRoom })); // ส่ง State ล่าสุดให้ผู้เล่นรายนี้คนเดียว
      return;
    }

    // 2. กรณีผู้เล่นทำ Action ในเกม (BET, RAISE, CALL, CHECK, FOLD)
    try {
      // ครอบ Logic ด้วย Distributed Lock เพื่อประมวลผลทีละคำสั่งต่อหนึ่งห้อง
      await withLock(roomId, async () => {
        const room = await getRoom(roomId);                     // ดึง State ห้องล่าสุดจาก Redis
        const playerBet = await getPlayerBet(roomId, playerId); // ดึงยอดที่เคยลงไว้ในรอบนี้

        let chipsToPut = 0; // จำนวนชิปจริงที่ต้องหักเพิ่มจากตัวผู้เล่นเข้า Pot
        let eventType = '';

        switch (action) {
          case 'BET':
            // เปิดเดิมพันคนแรก: ชิปที่ลง = amount เต็มจำนวน
            chipsToPut = amount;
            await updateRoom(roomId, { currentBet: amount, currentTurn: nextTurn });
            await setPlayerBet(roomId, playerId, amount);
            eventType = 'BET_SUCCESS';
            break;

          case 'RAISE':
            // เกทับ: ชิปที่ต้องจ่ายเพิ่ม = amount ใหม่ - ชิปที่เคยลงไว้แล้วในรอบนี้
            chipsToPut = amount - playerBet;
            await updateRoom(roomId, { currentBet: amount, currentTurn: nextTurn });
            await setPlayerBet(roomId, playerId, amount);
            eventType = 'RAISE_SUCCESS';
            break;

          case 'CALL':
            // สู้ราคา: ชิปที่ต้องจ่ายเพิ่ม = currentBet ของโต๊ะ - ชิปที่เคยลงไว้แล้ว
            chipsToPut = room.currentBet - playerBet;
            await updateRoom(roomId, { currentTurn: nextTurn });
            await setPlayerBet(roomId, playerId, room.currentBet);
            eventType = 'CALL_SUCCESS';
            break;

          case 'CHECK':
            // ผ่าน: ไม่มีการลงชิปเพิ่ม สลับตาให้คนถัดไป
            chipsToPut = 0;
            await updateRoom(roomId, { currentTurn: nextTurn });
            eventType = 'CHECK_SUCCESS';
            break;

          case 'FOLD':
            // หมอบ: ไม่ลงชิปเพิ่ม บันทึกว่าหมอบ แล้วสลับตาให้คนถัดไป
            chipsToPut = 0;
            await setPlayerFolded(roomId, playerId);
            await updateRoom(roomId, { currentTurn: nextTurn });
            eventType = 'FOLD_SUCCESS';
            break;

          default:
            throw new Error('Invalid Action');
        }

        // หากมีการลงชิปเพิ่ม ให้สั่ง Redis บวกยอดเข้า Pot
        let updatedPot = room.pot;
        if (chipsToPut > 0) {
          updatedPot = await addPot(roomId, chipsToPut);
        }

        // สร้าง Object ข้อมูลที่จะกระจายบอกผู้เล่นทุกคน
        const eventData = {
          roomId,
          type: eventType,
          playerId,
          amount: chipsToPut,
          currentBet: action === 'BET' || action === 'RAISE' ? amount : room.currentBet,
          pot: updatedPot,
          nextTurn,
        };

        // Serialization: แปลง Object เป็น JSON String แล้ว Publish ออกไปที่ ElastiCache
        // เพื่อให้ ElastiCache ผลักข้อมูลนี้ให้ EC2 ทุกเครื่อง กระจายส่งต่อให้ผู้เล่นในหน้าจอของตัวเอง
        await redisPub.publish(CHANNEL, JSON.stringify(eventData));
      });
    } catch (err) {
      // ส่งข้อความแจ้งเตือนความผิดพลาดกลับไปหา Client เครื่องที่ส่งคำสั่งเข้ามา
      ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
    }
  });
});


