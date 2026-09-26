import { redisState , redisPub} from '../config/redisClient.js';

const CHANNEL = 'poker:events';
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

// 7. บันทึก/อัปเดตชิปและสถานะผู้เล่น
export async function updatePlayer(roomId, playerId, playerData) {
  // บันทึกลง Redis Hash: room:101:player:p_99
  await redisState.hset(`room:${roomId}:player:${playerId}`, playerData);
  await redisState.expire(`room:${roomId}:player:${playerId}`, 7200);
}

// 8. ดึงข้อมูลผู้เล่นมาคำนวณในเกม
export async function getPlayer(roomId, playerId) {
  const data = await redisState.hgetall(`room:${roomId}:player:${playerId}`);
  if (!data) return null;

  return {
    ...data,
    chips: Number(data.chips || 0),
    currentBet: Number(data.currentBet || 0),
    seatIndex: Number(data.seatIndex || 0)
  };
}

// 9. แจกไพ่ให้ผู้เล่น (เก็บแยก Key)
export async function setPlayerCards(roomId, playerId, cardsArray) {
  await redisState.set(
    `room:${roomId}:cards:${playerId}`,
    JSON.stringify(cardsArray),
    'EX', 7200
  );
}

// 10. ดึงไพ่ของผู้เล่น (คืนค่าเป็น Array)
export async function getPlayerCards(roomId, playerId) {
  const rawCards = await redisState.get(`room:${roomId}:cards:${playerId}`);
  return rawCards ? JSON.parse(rawCards) : [];
}

// 11. อัปเดตและดึงไพ่กลางบนโต๊ะ (Flop/Turn/River)
export async function setCommunityCards(roomId, cardsArray) {
  await redisState.set(`room:${roomId}:community`, JSON.stringify(cardsArray), 'EX', 7200);
}

export async function getCommunityCards(roomId) {
  const raw = await redisState.get(`room:${roomId}:community`);
  return raw ? JSON.parse(raw) : [];
}

// 12. ดึงผู้เล่นทุกคนที่อยู่ในเก้าอี้รอบโต๊ะ
export async function getRoomSeats(roomId) {
  return await redisState.hgetall(`room:${roomId}:seats`);
}

// 13. ผูกผู้เล่นเข้ากับเก้าอี้
export async function setPlayerSeat(roomId, seatIndex, playerId) {
  await redisState.hset(`room:${roomId}:seats`, `seat_${seatIndex}`, playerId);
}

// 14. เคลียร์ State ขยะชั่วคราวทิ้งเมื่อจบตานั้นๆ
export async function resetRoundState(roomId) {
  await redisState.del(`room:${roomId}:bets`);      // ล้างยอดเดิมพันสะสมประจำรอบ
  await redisState.del(`room:${roomId}:folded`);    // ล้างสถานะการหมอบ
  await redisState.del(`room:${roomId}:community`); // ล้างไพ่กลาง
  await redisState.del(`room:${roomId}:cards`);
  await redisState.del(`room:${roomId}:contributions`);
  await redisState.del(`room:${roomId}:acted_players`);
  await redisState.del(`room:${roomId}:raise_locked`);

  // อัปเดต State ห้องเตรียมพร้อมรอบใหม่
  await redisState.hset(`room:${roomId}`, {
    pot: 0,
    currentBet: 0,
    currentTurn: '',
    currentTurnSeat: '',
    turnDeadline: '',
    phase: 'WAITING',
    status: 'WAITING',
    minRaise: 0,
    deck: '',
    stage: 'WAITING',
  });
}

// ดึงรายชื่อผู้เล่นที่ยังอยู่ในเกม (ยังไม่ FOLD)
export async function getActivePlayers(roomId) {
  const seats = await getRoomSeats(roomId);
  if (!seats) return [];

  const playerIds = Object.values(seats);
  const activePlayerIds = [];

  const foldedMap = (await redisState.hgetall(`room:${roomId}:folded`)) || {};

  for (const pid of playerIds) {
    if (foldedMap[pid] === 'true') continue;

    const pData = await getPlayer(roomId, pid);
    if (pData && pData.isFolded !== 'true' && pData.status !== 'FOLDED') {
      activePlayerIds.push(pid);
    }
  }

  return activePlayerIds;
}

// หมุนหา Turn ถัดไปของผู้เล่นตามลำดับเก้าอี้
export async function advanceTurn(roomId) {
  const room = await getRoom(roomId);
  const seats = await getRoomSeats(roomId);

  if (!seats || Object.keys(seats).length === 0) {
    return { nextPlayerId: null, nextSeatKey: null, timeLimit: 15 };
  }

  const sortedSeats = Object.entries(seats).sort(([keyA], [keyB]) => {
    const idxA = parseInt(keyA.replace('seat_', ''), 10) || 0;
    const idxB = parseInt(keyB.replace('seat_', ''), 10) || 0;
    return idxA - idxB;
  });

  const currentTurn = room?.currentTurn;
  let currentIndex = sortedSeats.findIndex(([_, pid]) => String(pid) === String(currentTurn));
  if (currentIndex === -1) currentIndex = 0;

  const totalSeats = sortedSeats.length;
  let nextPlayerId = null;
  let nextSeatKey = null;

  const foldedMap = (await redisState.hgetall(`room:${roomId}:folded`)) || {};
  const actedPlayers = new Set((await redisState.smembers(`room:${roomId}:acted_players`)).map(String));

  for (let i = 1; i <= totalSeats; i++) {
    const checkIdx = (currentIndex + i) % totalSeats;
    const [seatKey, pid] = sortedSeats[checkIdx];

    if (foldedMap[pid] === 'true' || actedPlayers.has(String(pid))) continue;

    const pData = await getPlayer(roomId, pid);
    if (pData && pData.isFolded !== 'true' && pData.status !== 'FOLDED'
      && Number(pData.chips) > 0) {
      nextPlayerId = pid;
      nextSeatKey = seatKey;
      break;
    }
  }

  // อัปเดต Turn ใหม่ลง Redis
  if (nextPlayerId) {
    await updateRoom(roomId, {
      currentTurn: nextPlayerId,
      currentTurnSeat: nextSeatKey,
    });
  }

  return {
    nextPlayerId,
    nextSeatKey,
    timeLimit: 15,
  };
}

// จบเกม มอบเงิน Pot ให้ผู้ชนะ และประกาศผล
export async function finishGameWithWinner(roomId, winnerId) {
  const room = await getRoom(roomId);
  if (!room) return;

  const pot = Number(room.pot) || 0;
  let winnerNewChips = 0;

  if (winnerId) {
    const winner = await getPlayer(roomId, winnerId);
    if (winner) {
      const currentChips = Number(winner.chips) || 0;
      winnerNewChips = currentChips + pot;

      await updatePlayer(roomId, winnerId, {
        chips: winnerNewChips,
      });
    }
  }

  const seats = await getRoomSeats(roomId);
  for (const playerId of Object.values(seats || {})) {
    await updatePlayer(roomId, playerId, {
      isFolded: false,
      isAllIn: false,
      status: 'WAITING',
    });
  }

  await updateRoom(roomId, {
    status: 'WAITING',
    phase: 'WAITING',
    currentTurn: '',
    currentTurnSeat: '',
    turnDeadline: '',
    currentBet: 0,
    pot: 0,
    winner: winnerId || '',
  });

  await redisPub.publish(
    CHANNEL,
    JSON.stringify({
      eventType: 'game_finished',
      roomCode: roomId,
      winnerId: winnerId,
      currentMoney: winnerNewChips,
    })
  );

  await resetRoundState(roomId);
}