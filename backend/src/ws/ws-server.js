import { WebSocketServer } from 'ws';
import { getUserProfile } from '../services/auth.js';
import { redisPub, redisSub, redisState } from '../config/redisClient.js';
import {
  updateRoom,
  getRoom,
  addPot,
  getPlayerBet,
  setPlayerBet,
  setPlayerFolded,
  getPlayer,
  updatePlayer,
  getRoomSeats,
  resetRoundState,
  setPlayerSeat,
  getActivePlayers,
  finishGameWithWinner,
  advanceTurn
} from '../services/roomService.js';
import { withLock } from '../services/lockService.js';
import { joinTable } from '../services/tables.js';
import {
  createShuffledDeck,
  parseCard,
  findWinners,
  distributeSidePots,
  selectBlindPositions,
  isBettingRoundComplete,
} from '../services/game.js';
import { syncPlayerBalances } from '../services/wallet.js';
import { pool } from '../config/db.js';


export const wss = new WebSocketServer({ noServer: true });
const CHANNEL = 'poker:events';
// [เพิ่มแก้ไข]: เพิ่ม Helper Function ป้องกัน Bug Redis String 'false' ถูกตีความว่าเป็น Boolean true
const parseBool = (val) => val === true || val === 'true';
// กำหนดเวลาแต่ละ Turn (เช่น 15 วินาที)
const TURN_TIMEOUT_MS = 15000;
const DISCONNECT_GRACE_MS = 30000;
const SMALL_BLIND = Math.max(1, Math.floor(Number(process.env.POKER_SMALL_BLIND) || 10));
const BIG_BLIND = Math.max(SMALL_BLIND, Math.floor(Number(process.env.POKER_BIG_BLIND) || 20));
const TURN_TIMER_KEY = 'poker:turn-timers';
const DISCONNECT_TIMER_KEY = 'poker:disconnect-timers';

if (process.env.REDIS_DISABLED !== '1') redisSub.subscribe(CHANNEL);
redisSub.on('message', (channel, message) => {
  if (channel !== CHANNEL) return;

  try {
    const data = JSON.parse(message);
    const {
      eventType,
      roomCode,
      room,
      holeCardsMap,
      clientId,
      action,
      amount,
      timedOut,
      nextTurn,
      currentTurn,
      dealFlop,
      dealTurn,
      dealRiver,
      winner,
      turnDeadline,
      serverTime,
      winnerId,
      pot,
      currentBet,
    } = data;

    wss.clients.forEach((client) => {
      const isSameRoom = String(client.roomCode) === String(roomCode);

      if (client.readyState === 1 && isSameRoom) {

        switch (eventType) {
          // เมื่อมีคน Join เข้ามา (ส่งแจ้งเตือนหาคนอื่นในห้อง)
          case 'player_join': {
            if (String(client.clientId) !== String(clientId)) {
              const playersObj = room?.players || {};
              const currentPlayers = Object.values(playersObj).map((p) => ({
                clientId: p.clientId,
                username: p.username,
                money: p.chips,
                seat: Number(p.seatIndex) + 1,
              }));

              const payload = {
                type: 'player-join',
                params: {
                  clientId: clientId,
                  playerNum: currentPlayers.length,
                  currentPlayers: currentPlayers,
                  pot: Number(room?.pot) || 0,
                },
              };

              console.log(`[WS] Sending player-join notification to client: ${client.clientId}`);
              client.send(JSON.stringify(payload));
            } else {
              console.log(`[WS] Skipped sending to self (${client.clientId})`);
            }
            break;
          }
          // เมื่อมีคนออกจากห้อง (ส่งแจ้งเตือนหาคนอื่นในห้อง)
          case 'player_left': {
            const currentPlayersList = data.currentPlayers || [];

            const payload = {
              type: 'left-room',
              params: {
                clientId: clientId,
                playerNum: currentPlayersList.length,
                currentPlayers: currentPlayersList,
              },
            };

            client.send(JSON.stringify(payload));
            break;
          }
          // รองรับการสลับ Turn เมื่อมีคนออกหรือหมดเวลา
          case 'next_turn': {
            client.send(
              JSON.stringify({
                type: 'turn-start',
                params: {
                  clientId: currentTurn,
                  turn_deadline: turnDeadline || null,
                  server_time: Date.now(),
                },
              })
            );
            break;
          }

          // รองรับการจบเกมจากการหมอบหมด/คนออกจนเหลือคนเดียว
          case 'game_finished': {
            client.send(
              JSON.stringify({
                type: 'winner',
                params: {
                  winnerId: winnerId,
                  current_money: data.currentMoney || 0,
                },
              })
            );
            break;
          }
          // กรณีเริ่มเกมใหม่
          case 'game_started': {
            const privateHoleCards = {};
            if (holeCardsMap && holeCardsMap[client.clientId]) {
              privateHoleCards[client.clientId] = holeCardsMap[client.clientId];
            }
            const payload = formatTablePayload('game_started', room, privateHoleCards);
            client.send(JSON.stringify(payload));
            break;
          }

          // กรณีทำ Action ในเกม (Bet, Raise, Call, Check, Fold)
          case 'game_action_performed': {
            client.send(
              JSON.stringify({
                type: 'game-action',
                params: {
                  clientId: clientId,
                  action: action,
                  amount: amount,
                  timed_out: timedOut || false,
                  pot: pot || 0,
                  currentBet: currentBet || 0,
                },
              })
            );

            // 2. ถ้ามีการเปิดไพ่ Flop (3 ใบ)
            if (dealFlop) {
              client.send(
                JSON.stringify({
                  type: 'deal-flop',
                  params: { card: toCardObjectArray(dealFlop) },
                })
              );
            }

            // 3. ถ้ามีการเปิดไพ่ Turn (1 ใบ)
            if (dealTurn) {
              client.send(
                JSON.stringify({
                  type: 'deal-turn',
                  params: { card: toCardObjectArray(dealTurn) },
                })
              );
            }

            // 4. ถ้ามีการเปิดไพ่ River (1 ใบ)
            if (dealRiver) {
              client.send(
                JSON.stringify({
                  type: 'deal-river',
                  params: { card: toCardObjectArray(dealRiver) },
                })
              );
            }

            // 5. สลับ Turn ไปหาผู้เล่นคนถัดไป (ส่งเวลานับถอยหลังเพื่อ Time Sync)
            if (nextTurn) {
              client.send(
                JSON.stringify({
                  type: 'turn-start',
                  params: {
                    clientId: nextTurn,
                    turn_deadline: turnDeadline || null,
                    server_time: serverTime || Date.now(),
                  },
                })
              );
            }

            // 6. ถ้าเกมจบ มีผู้ชนะ
            if (winner) {
              client.send(
                JSON.stringify({
                  type: 'winner',
                  params: {
                    winnerId: winner.winnerId,
                    current_money: winner.currentMoney,
                  },
                })
              );
            }
            break;
          }

          // กรณีอัปเดตสถานะโต๊ะ (เช่น มีคนออก, หมุน Turn, ลง Bet, เก้าอี้เปลี่ยน)
          case 'table_updated': {
            const privateHoleCards = {};
            if (holeCardsMap && holeCardsMap[client.clientId]) {
              privateHoleCards[client.clientId] = holeCardsMap[client.clientId];
            }
            const payload = formatTablePayload('table_state', room, privateHoleCards);
            client.send(JSON.stringify(payload));
            break;
          }

          // กรณีเปิดไพ่จบมือ (Showdown) - ส่งไพ่ของทุกคนให้เห็นครบ ไม่ต้องซ่อน
          case 'showdown': {
            const payload = formatTablePayload('showdown', room, holeCardsMap || {});
            payload.params.winnerId = winnerId || null;
            payload.params.winnerIds = Array.isArray(data.winnerIds) ? data.winnerIds : [];
            payload.params.winningHand = data.winningHand || room?.winningHand || null;
            payload.params.splitPot = Boolean(data.splitPot);
            payload.params.side_pots = data.sidePots || [];
            payload.params.payouts = data.payouts || {};
            client.send(JSON.stringify(payload));
            break;
          }

          case 'tournament_finished': {
            const payload = formatTablePayload('tournament_finished', room, holeCardsMap || {});
            client.send(JSON.stringify(payload));
            break;
          }

          // กรณี Event ทั่วไปที่ไม่มีการปรับแต่ง Payload พิเศษ
          default: {
            client.send(JSON.stringify(data));
            break;
          }
        }
      }
    });
  } catch (err) {
    console.error('Error processing Redis message:', err);
  }
});

function toCardObjectArray(cards) {
  if (!cards) return [];
  const cardList = Array.isArray(cards) ? cards : [cards];
  return cardList.map(parseCard).filter(Boolean);
}

function sortedSeatEntries(seats) {
  return Object.entries(seats || {}).sort(([left], [right]) =>
    Number(left.replace('seat_', '')) - Number(right.replace('seat_', ''))
  );
}

function findNextPlayer(entries, currentId, eligibleIds) {
  if (!entries.length) return null;
  const eligible = new Set([...eligibleIds].map(String));
  const currentIndex = entries.findIndex(([, playerId]) => String(playerId) === String(currentId));
  const start = currentIndex < 0 ? 0 : currentIndex + 1;
  for (let offset = 0; offset < entries.length; offset += 1) {
    const playerId = entries[(start + offset) % entries.length][1];
    if (eligible.has(String(playerId))) return playerId;
  }
  return null;
}

function findFirstAfterSeat(entries, seatIndex, eligibleIds) {
  const eligible = new Set([...eligibleIds].map(String));
  const startIndex = entries.findIndex(([seatKey]) =>
    Number(seatKey.replace('seat_', '')) === Number(seatIndex)
  );
  const start = startIndex < 0 ? 0 : startIndex + 1;
  for (let offset = 0; offset < entries.length; offset += 1) {
    const playerId = entries[(start + offset) % entries.length][1];
    if (eligible.has(String(playerId))) return playerId;
  }
  return null;
}

function formatTablePayload(eventType, room, holeCardsMap = {}) {
  const playerIds = Object.keys(room.players || {});

  const playersList = playerIds.map((pid) => {
    const p = room.players[pid];
    const rawCards = holeCardsMap[pid] || [];

    return {
      client_id: pid,
      seat: (p.seatIndex !== undefined ? Number(p.seatIndex) : 0) + 1,
      username: p.username || '',
      chips: Number(p.chips) || 0,
      avatar_id: p.avatarId ?? null,
      hole_cards: rawCards.map(parseCard).filter(Boolean),
      // [เพิ่มแก้ไข]: ใช้ parseBool ป้องกันปัญหา String 'false'
      status: parseBool(p.isFolded) ? 'FOLDED'
        : parseBool(p.isDisconnected) ? 'DISCONNECTED'
          : parseBool(p.isAllIn) ? 'ALL_IN' : (p.status || 'ACTIVE'),
    };
  });

  const currentTurnPlayer = room.players ? room.players[room.currentTurn] : null;
  let lastAction = room.lastAction || {
    client_id: null,
    action: null,
    amount: 0,
    timed_out: false,
  };
  if (typeof lastAction === 'string') {
    try {
      lastAction = JSON.parse(lastAction);
    } catch {
      lastAction = null;
    }
  }

  return {
    type: eventType,
    params: {
      room_code: room.roomCode,
      room_name: room.roomName || '',
      player_count: playerIds.length,
      max_players: Number(room.maxPlayer) || 6,
      status: room.status,
      phase: room.phase,
      host_id: room.hostId,
      current_turn: room.currentTurn || null,
      current_turn_name: currentTurnPlayer ? currentTurnPlayer.username : '',
      turn_deadline: room.turnDeadline || null,
      pot: Number(room.pot) || 0,
      current_bet: Number(room.currentBet) || 0,
      min_raise: Number(room.minRaise) || Number(room.bigBlind) || BIG_BLIND,
      winner: room.winner || null,
      winner_name: room.winnerName || null,
      winning_hand: room.winningHand || null,
      dealer_seat: Number(room.dealerSeat) || 0,
      small_blind: Number(room.smallBlind) || SMALL_BLIND,
      big_blind: Number(room.bigBlind) || BIG_BLIND,
      last_action: lastAction,
      community_cards: (typeof room.communityCards === 'string'
        ? JSON.parse(room.communityCards)
        : room.communityCards || []).map(parseCard).filter(Boolean),
      players: playersList,
    },
  };
}

async function publishRoomState(roomCode) {
  const room = await getRoom(roomCode);
  if (!room) return;
  const seats = (await getRoomSeats(roomCode)) || {};
  const players = {};
  for (const clientId of Object.values(seats)) {
    const player = await getPlayer(roomCode, clientId);
    if (player) players[clientId] = player;
  }
  const holeCardsMap = await redisState.hgetall(`room:${roomCode}:cards`);
  await redisPub.publish(CHANNEL, JSON.stringify({
    eventType: 'table_updated',
    roomCode,
    room: { ...room, players },
    holeCardsMap: Object.fromEntries(Object.entries(holeCardsMap || {}).map(([clientId, cards]) => [
      clientId,
      JSON.parse(cards),
    ])),
  }));
}

async function clearDisconnectTimer(roomCode, clientId) {
  await redisState.zrem(DISCONNECT_TIMER_KEY, `${roomCode}:${clientId}`);
}

async function handleDisconnect(ws) {
  const { roomCode, clientId } = ws;
  if (!roomCode || !clientId) return;

  try {
    await withLock(roomCode, async () => {
      const player = await getPlayer(roomCode, clientId);
      if (!player) return;
      const deadline = Date.now() + DISCONNECT_GRACE_MS;
      await updatePlayer(roomCode, clientId, {
        isDisconnected: true,
        disconnectDeadline: deadline,
      });
      await redisState.zadd(DISCONNECT_TIMER_KEY, deadline, `${roomCode}:${clientId}`);
    });
    await publishRoomState(roomCode);
  } catch (error) {
    console.error(`[WS] Failed to schedule reconnect grace for ${roomCode}/${clientId}:`, error);
  } finally {
    ws.roomCode = null;
    ws.clientId = null;
  }
}

// ฟังก์ชันสำหรับจัดการคนออกจากห้อง (ใช้ซ้ำได้ทั้งสั่งผ่าน WS และตอน disconnect)
async function handleLeaveRoom(ws, onlyIfDisconnectExpired = false) {
  const roomCode = ws.roomCode;
  const clientId = ws.clientId;

  if (!roomCode || !clientId) return;

  try {
    await withLock(roomCode, async () => {
      const room = await getRoom(roomCode);
      if (!room) return;

      const leavingPlayer = await getPlayer(roomCode, clientId);
      if (onlyIfDisconnectExpired && (!parseBool(leavingPlayer?.isDisconnected)
        || Number(leavingPlayer.disconnectDeadline) > Date.now())) return;
      await clearDisconnectTimer(roomCode, clientId);

      const seats = (await getRoomSeats(roomCode)) || {};
      let leavingSeatKey = null;

      for (const [seatKey, playerId] of Object.entries(seats)) {
        if (playerId === clientId) {
          leavingSeatKey = seatKey;
          break;
        }
      }

      // Sync DB ชิปล่าสุดและส่วนต่าง Buy-in เมื่อผู้เล่นออกจากห้อง
      if (leavingPlayer) {
        const finalChips = Number(leavingPlayer.chips) || 0;
        const initialBuyIn = Number(leavingPlayer.buyIn) || finalChips;
        const roundId = room.roundId || Date.now();
        syncPlayerBalances(roomCode, roundId, { [clientId]: finalChips }, { [clientId]: initialBuyIn }).catch(err =>
          console.error('Error syncing leaving player balance:', err)
        );
      }

      if (leavingSeatKey) {
        await redisState.hdel(`room:${roomCode}:seats`, leavingSeatKey);
      }

      const updatedSeats = (await getRoomSeats(roomCode)) || {};
      const remainingPlayerIds = Object.values(updatedSeats);
      const roomUpdates = {};
      let roomDeleted = false;

      const isGameRunning = room.status === 'PLAYING' || room.status === 'RUNNING' || room.status === 'IN_PROGRESS';

      if (remainingPlayerIds.length === 0) {
        // 1. กรณีไม่มีคนเหลือในห้องเลย
        clearTurnTimer(roomCode);
        await deleteRoom(roomCode);
        roomDeleted = true;
      } else if (remainingPlayerIds.length < 2) {
        // 2. กรณีเหลือผู้เล่นคนเดียวในห้อง
        clearTurnTimer(roomCode);
        if (String(room.hostId) === String(clientId)) {
          roomUpdates.hostId = remainingPlayerIds[0];
        }

        if (isGameRunning) {
          await handleEarlyFinishGame(roomCode, remainingPlayerIds[0]);
        } else {
          await resetRoundState(roomCode);
        }
        roomUpdates.status = 'OPEN';
      } else {
        // 3. กรณีเหลือผู้เล่นตั้งแต่ 2 คนขึ้นไป
        if (String(room.hostId) === String(clientId)) {
          roomUpdates.hostId = remainingPlayerIds[0];
        }

        if (isGameRunning) {
          // Mark ผู้เล่นที่ออกเป็น FOLDED
          await updatePlayer(roomCode, clientId, { isFolded: 'true', status: 'FOLDED' });

          const activePlayerIds = await getActivePlayers(roomCode);

          if (activePlayerIds.length === 1) {
            // เหลือผู้เล่นไม่หมอบเพียงคนเดียว -> จบรอบและแจก Pot ทันที
            await handleEarlyFinishGame(roomCode, activePlayerIds[0]);
          } else {
            // ตรวจสอบว่าการกดออก/หมอบนี้ส่งผลให้เงื่อนไขการเปลี่ยน Phase สมบูรณ์หรือไม่
            const phaseResult = await advancePhaseIfNeeded(roomCode);

            if (phaseResult.isAdvanced) {
              // กรณีเปลี่ยน Phase สำเร็จ (และเกมยังไม่จบ)
              if (!phaseResult.isFinished && phaseResult.nextTurn) {
                await redisPub.publish(
                  CHANNEL,
                  JSON.stringify({
                    eventType: 'next_turn',
                    roomCode,
                    currentTurn: phaseResult.nextTurn,
                    turnDeadline: phaseResult.turnDeadline,
                  })
                );
              }
            } else {
              // ถ้ายังอยู่ใน Phase เดิม และเป็น Turn ของคนที่เพิ่งออกไป -> สลับ Turn ไปหาคนถัดไป
              const isCurrentTurn = Boolean(room.currentTurn) && (
                String(room.currentTurn) === String(clientId) ||
                String(room.currentTurnSeat) === String(leavingSeatKey)
              );

              if (isCurrentTurn) {
                clearTurnTimer(roomCode);
                const turnResult = await advanceTurn(roomCode, leavingSeatKey);
                const turnDeadline = Date.now() + TURN_TIMEOUT_MS;
                await updateRoom(roomCode, { currentTurn: turnResult.nextPlayerId, turnDeadline });

                startTurnTimer(roomCode, turnResult.nextPlayerId);

                await redisPub.publish(
                  CHANNEL,
                  JSON.stringify({
                    eventType: 'next_turn',
                    roomCode,
                    currentTurn: turnResult.nextPlayerId,
                    turnDeadline: turnDeadline,
                  })
                );
              }
            }
          }
        }
      }

      if (!roomDeleted && Object.keys(roomUpdates).length > 0) {
        await updateRoom(roomCode, roomUpdates);
      }

      // เตรียมข้อมูลแจ้งเตือน player_left ให้ผู้เล่นอื่นที่เหลืออยู่
      const currentPlayers = [];
      for (const pid of remainingPlayerIds) {
        const pData = await getPlayer(roomCode, pid);
        if (pData) {
          currentPlayers.push({
            clientId: pData.clientId,
            username: pData.username,
            money: Number(pData.chips) || 0,
            seat: Number(pData.seatIndex) + 1,
          });
        }
      }

      if (!roomDeleted) {
        await redisPub.publish(
          CHANNEL,
          JSON.stringify({
            eventType: 'player_left',
            roomCode,
            clientId,
            currentPlayers,
          })
        );
        // [แก้บัค]: การลุกอาจทำให้เปลี่ยน Phase (แจกไพ่กลาง) หรือเปลี่ยน Host แต่เดิมส่งแค่ next_turn
        // Client จึงไม่เห็นไพ่กลาง/Host ใหม่ -> ส่ง Snapshot โต๊ะเต็มให้ทุกคน
        await publishRoomState(roomCode);
      }
    });
  } catch (err) {
    console.error('Leave room error:', err);
  } finally {
    ws.roomCode = null;
    ws.clientId = null;
  }
}

// [แก้บัค]: ไม่มี Heartbeat -> ถ้าเน็ตผู้เล่นค้างแบบ Half-open (มือถือเปลี่ยนเสา/Wi-Fi ค้าง) Server ไม่รู้ว่าหลุด
// ผู้เล่นไม่ถูก Mark DISCONNECTED และไม่ถูกลุกจากโต๊ะเลย (ที่นั่งผีโดน Auto-fold ทุกมือ)
// และบน AWS ALB จะตัด Connection ที่ idle เกิน 60 วินาที -> Ping ทุก 15 วินาที ถ้าไม่ตอบ Pong ภายในรอบถัดไปให้ตัดทิ้ง
const HEARTBEAT_MS = 15000;
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate(); // ยิง 'close' -> handleDisconnect -> เริ่มนับ Grace period
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(
    JSON.stringify({
      type: 'connection',
      message: 'WebSocket connection established',
    })
  );

  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      const { type, params } = message;

      if (type === 'join') {
        const { roomCode, clientId, buyIn } = params || {};

        if (String(ws.userId) !== String(clientId)) {
          return ws.send(
            JSON.stringify({ type: 'error', error: 'Client identity does not match token' })
          );
        }

        try {
          await withLock(roomCode, async () => {
            const existingSeats = (await getRoomSeats(roomCode)) || {};
            const existingSeat = Object.entries(existingSeats).find(([, playerId]) =>
              String(playerId) === String(clientId)
            );
            const existingPlayer = existingSeat ? await getPlayer(roomCode, clientId) : null;
            const isRejoin = Boolean(existingSeat && existingPlayer);
            const currentRoom = await getRoom(roomCode);

            if (!isRejoin && ['IN_PROGRESS', 'RUNNING'].includes(currentRoom?.status)) {
              return ws.send(JSON.stringify({ type: 'error', error: 'Table is already in progress' }));
            }

            let tableInfo;
            if (!isRejoin) {
              try {
                tableInfo = await joinTable(clientId, roomCode, { buy_in: buyIn });
              } catch (error) {
                const messages = {
                  ROOM_IN_PROGRESS: 'Table is already in progress',
                  ROOM_CLOSED: 'Table is closed',
                  ROOM_FULL: 'Table is full',
                  BUY_IN_TOO_LOW: 'Buy-in is too low',
                  BUY_IN_TOO_HIGH: 'Buy-in is too high',
                  INSUFFICIENT_BALANCE: 'Insufficient balance',
                };
                return ws.send(
                  JSON.stringify({ type: 'error', error: messages[error.code] || error.message })
                );
              }
            } else {
              tableInfo = { room_code: roomCode };
            }

            const profile = isRejoin ? null : await getUserProfile(clientId);

            for (const currentClient of wss.clients) {
              if (currentClient !== ws && currentClient.readyState === 1
                && String(currentClient.roomCode) === String(roomCode)
                && String(currentClient.clientId) === String(clientId)) {
                currentClient.roomCode = null;
                currentClient.clientId = null;
                currentClient.close();
              }
            }

            ws.roomCode = roomCode;
            ws.clientId = clientId;
            await clearDisconnectTimer(roomCode, clientId);

            let room = currentRoom;
            if (!room) {
              const initialRoom = {
                roomCode: tableInfo.room_code || roomCode,
                roomId: tableInfo.id,
                roomName: tableInfo.name || '',
                minBet: tableInfo.min_bet,
                maxBet: tableInfo.max_bet,
                maxPlayer: tableInfo.max_seats || 6,
                status: 'OPEN',
                currentBet: 0,
                pot: 0,
                hostId: clientId,
                smallBlind: SMALL_BLIND,
                bigBlind: BIG_BLIND,
              };
              await updateRoom(roomCode, initialRoom);
              room = await getRoom(roomCode);
            }

            if (isRejoin) {
              await updatePlayer(roomCode, clientId, {
                isDisconnected: false,
                disconnectDeadline: '',
                status: parseBool(existingPlayer.isFolded) ? 'FOLDED'
                  : parseBool(existingPlayer.isAllIn) ? 'ALL_IN'
                    : (room.status === 'IN_PROGRESS' ? 'ACTIVE' : 'WAITING'),
              });
            } else {
              const occupiedSeatIndices = Object.keys(existingSeats).map((s) => Number(s.replace('seat_', '')));
              const maxSeats = Number(room.maxPlayer) || 6;

              let availableSeatIndex = -1;
              for (let i = 0; i < maxSeats; i++) {
                if (!occupiedSeatIndices.includes(i)) {
                  availableSeatIndex = i;
                  break;
                }
              }

              if (availableSeatIndex < 0) {
                return ws.send(JSON.stringify({ type: 'error', error: 'Table is full' }));
              }

              const actualBuyIn = Number(buyIn ?? tableInfo.min_bet);

              await updatePlayer(roomCode, clientId, {
                clientId,
                username: profile.display_name || profile.username,
                chips: actualBuyIn,
                buyIn: actualBuyIn,
                avatarId: profile.avatar_id ?? '',
                seatIndex: availableSeatIndex >= 0 ? availableSeatIndex : 0,
                isFolded: false,
                isAllIn: false,
                isDisconnected: false,
                status: 'WAITING',
              });

              if (availableSeatIndex >= 0) {
                await setPlayerSeat(roomCode, availableSeatIndex, clientId);
              }
            }

            const updatedSeats = (await getRoomSeats(roomCode)) || {};
            const playerIds = Object.values(updatedSeats);

            const currentPlayers = [];
            const playersMap = {};

            for (const pid of playerIds) {
              const pData = await getPlayer(roomCode, pid);
              if (pData) {
                currentPlayers.push({
                  clientId: pData.clientId,
                  username: pData.username,
                  money: pData.chips,
                  seat: Number(pData.seatIndex) + 1,
                  seat: Number(pData.seatIndex) + 1,
                });
                playersMap[pData.clientId] = pData;
              }
            }

            ws.send(
              JSON.stringify({
                type: 'join',
                params: {
                  success: true,
                  roomId: room.roomId,
                  roomName: room.roomName || '',
                  playerNum: currentPlayers.length,
                  maxPlayer: Number(room.maxPlayer),
                  currentPlayers: currentPlayers,
                  pot: Number(room.pot) || 0,
                },
              })
            );

            const roomSnapshot = { ...room, players: playersMap };
            const rawCards = await redisState.hget(`room:${roomCode}:cards`, clientId);
            const privateCards = rawCards ? JSON.parse(rawCards) : [];
            const latestRoom = await getRoom(roomCode);
            ws.send(JSON.stringify(formatTablePayload(
              'table_state',
              { ...latestRoom, players: playersMap },
              { [clientId]: privateCards },
            )));

            if (isRejoin) {
              await publishRoomState(roomCode);
            } else {
              await redisPub.publish(
                CHANNEL,
                JSON.stringify({ eventType: 'player_join', roomCode, clientId, room: roomSnapshot })
              );
            }
          });
        } catch (err) {
          ws.send(
            JSON.stringify({ type: 'error', error: err.message || 'Join room failed' })
          );
        }
      }
      else if (type === 'leave-room') {
        const roomCode = ws.roomCode;
        if (!roomCode) {
          return ws.send(
            JSON.stringify({ type: 'error', error: 'You are not in a room' })
          );
        }

        await handleLeaveRoom(ws);

        ws.send(
          JSON.stringify({
            type: 'left_room',
            params: { room_code: roomCode },
          })
        );
      }
      else if (type === 'start-game') {
        const roomCode = ws.roomCode;
        const clientId = ws.clientId;

        if (!roomCode || !clientId) {
          return ws.send(
            JSON.stringify({ type: 'error', error: 'You are not in a room' })
          );
        }

        await withLock(roomCode, async () => {
          const room = await getRoom(roomCode);
          if (!room) {
            return ws.send(
              JSON.stringify({ type: 'error', error: 'Room not found' })
            );
          }

          if (String(room.hostId) !== String(clientId)) {
            return ws.send(
              JSON.stringify({
                type: 'error',
                error: 'Only the room host can start the game',
              })
            );
          }

          if (room.status === 'IN_PROGRESS' || room.status === 'RUNNING') {
            return ws.send(JSON.stringify({ type: 'error', error: 'A hand is already in progress' }));
          }

          const seats = await getRoomSeats(roomCode);
          const seatEntries = sortedSeatEntries(seats).filter(([, playerId]) => Boolean(playerId));
          const seatedPlayerIds = seatEntries.map(([, playerId]) => playerId);
          const playerIds = [];

          for (const pid of seatedPlayerIds) {
            const player = await getPlayer(roomCode, pid);
            if (player && Number(player.chips) > 0 && !parseBool(player.isDisconnected)) {
              playerIds.push(pid);
            }
          }

          if (playerIds.length === 1) {
            await handleTournamentFinish(roomCode, playerIds[0]);
            return;
          }

          if (playerIds.length < 2) {
            return ws.send(
              JSON.stringify({
                type: 'error',
                error: 'At least 2 players are required to start',
              })
            );
          }

          const deck = createShuffledDeck();
          const holeCardsMap = {};
          const playersMap = {};

          for (const pid of playerIds) {
            holeCardsMap[pid] = [deck.pop(), deck.pop()];

            await setPlayerBet(roomCode, pid, 0);
            await updatePlayer(roomCode, pid, {
              isFolded: false,
              isAllIn: false,
              status: 'ACTIVE',
            });

            await redisState.hset(`room:${roomCode}:cards`, pid, JSON.stringify(holeCardsMap[pid]));
            const pData = await getPlayer(roomCode, pid);
            if (pData) playersMap[pid] = pData;
          }
          await redisState.del(`room:${roomCode}:acted_players`);
          await redisState.del(`room:${roomCode}:raise_locked`);
          await redisState.del(`room:${roomCode}:folded`);
          await redisState.del(`room:${roomCode}:contributions`);

          const eligibleSeats = seatEntries.filter(([, playerId]) => playerIds.includes(playerId));
          const blindPositions = selectBlindPositions(
            eligibleSeats,
            room.dealerSeat === undefined ? null : Number(room.dealerSeat),
          );
          const {
            dealerSeat,
            smallBlindId,
            bigBlindId,
            smallBlindSeat,
            bigBlindSeat,
          } = blindPositions;
          const roomSmallBlind = Math.max(1, Math.floor(Number(room.smallBlind) || SMALL_BLIND));
          const roomBigBlind = Math.max(roomSmallBlind, Math.floor(Number(room.bigBlind) || BIG_BLIND));
          const contributionFields = {};

          for (const [blindId, requestedBlind] of [[smallBlindId, roomSmallBlind], [bigBlindId, roomBigBlind]]) {
            const blindPlayer = await getPlayer(roomCode, blindId);
            const blindAmount = Math.min(Number(blindPlayer.chips) || 0, requestedBlind);
            const blindBet = await getPlayerBet(roomCode, blindId);
            await updatePlayer(roomCode, blindId, {
              chips: Number(blindPlayer.chips) - blindAmount,
              isAllIn: blindAmount > 0 && blindAmount === Number(blindPlayer.chips),
              status: blindAmount > 0 && blindAmount === Number(blindPlayer.chips) ? 'ALL_IN' : 'ACTIVE',
            });
            await setPlayerBet(roomCode, blindId, blindBet + blindAmount);
            contributionFields[blindId] = blindAmount;
            if (blindAmount > 0) await addPot(roomCode, blindAmount);
          }
          await redisState.hset(`room:${roomCode}:contributions`, contributionFields);

          const currentBet = Math.max(
            await getPlayerBet(roomCode, smallBlindId),
            await getPlayerBet(roomCode, bigBlindId),
          );
          const blindPot = Object.values(contributionFields).reduce((sum, amount) => sum + amount, 0);
          const playerIdsWithChips = [];
          for (const pid of playerIds) {
            const player = await getPlayer(roomCode, pid);
            if (Number(player?.chips) > 0) playerIdsWithChips.push(pid);
          }
          const preflopFirstToAct = findNextPlayer(eligibleSeats, bigBlindId, playerIdsWithChips);

          const turnDeadline = Date.now() + TURN_TIMEOUT_MS;

          const roomUpdates = {
            status: 'IN_PROGRESS',
            phase: 'PREFLOP',
            pot: blindPot,
            currentBet,
            currentTurn: preflopFirstToAct,
            currentTurnSeat: preflopFirstToAct
              ? eligibleSeats.find(([, playerId]) => String(playerId) === String(preflopFirstToAct))[0]
              : null,
            turnDeadline: preflopFirstToAct ? turnDeadline : null,
            minRaise: roomBigBlind,
            communityCards: JSON.stringify([]),
            deck: JSON.stringify(deck),
            dealerSeat,
            smallBlind: roomSmallBlind,
            bigBlind: roomBigBlind,
            smallBlindSeat,
            bigBlindSeat,
            roundId: Date.now(), // [แก้ไข]: เพิ่ม roundId สำหรับอ้างอิงรอบการเล่นใน Idempotency Settlement
            winner: '',
            winnerName: '',
            winningHand: '',
            lastAction: '',
          };

          for (const pid of playerIds) {
            const pData = await getPlayer(roomCode, pid);
            if (pData) playersMap[pid] = pData;
          }
          await updateRoom(roomCode, roomUpdates);
          const updatedRoom = await getRoom(roomCode);

          if (preflopFirstToAct) startTurnTimer(roomCode, preflopFirstToAct, turnDeadline);

          await redisPub.publish(
            CHANNEL,
            JSON.stringify({
              eventType: 'game_started',
              roomCode,
              room: {
                ...updatedRoom,
                players: playersMap,
              },
              holeCardsMap,
            })
          );

          if (playerIdsWithChips.length === 0) await advancePhaseIfNeeded(roomCode);
        });
      }
      else if (type === 'game-action') {
        const { action, amount } = params || {};
        const clientId = ws.clientId;
        const roomCode = ws.roomCode;

        if (!roomCode || !clientId) {
          return ws.send(JSON.stringify({ type: 'error', error: 'You are not in a room' }));
        }

        const upperAction = String(action || '').toUpperCase();

        try {
          await withLock(roomCode, async () => {
            const room = await getRoom(roomCode);
            const player = await getPlayer(roomCode, clientId);

            if (!room || !player) {
              return ws.send(JSON.stringify({ type: 'error', error: 'Player or Room not found' }));
            }

            if (room.status !== 'IN_PROGRESS' && room.status !== 'RUNNING') {
              return ws.send(JSON.stringify({ type: 'error', error: 'There is no active hand' }));
            }

            if (parseBool(player.isFolded) || Number(player.chips) <= 0) {
              return ws.send(JSON.stringify({ type: 'error', error: 'You cannot act in this hand' }));
            }

            if (String(room.currentTurn) !== String(clientId)) {
              return ws.send(JSON.stringify({ type: 'error', error: 'Not your turn' }));
            }

            const playerBet = await getPlayerBet(roomCode, clientId);
            const roomCurrentBet = Number(room.currentBet) || 0;
            let chipsToPut = 0;
            let fullRaise = false;
            let nextMinRaise = Number(room.minRaise) || Number(room.bigBlind) || BIG_BLIND;
            const requestedAmount = amount === undefined || amount === null ? 0 : Number(amount);

            if (upperAction === 'RAISE'
              && await redisState.sismember(`room:${roomCode}:raise_locked`, clientId)) {
              return ws.send(JSON.stringify({ type: 'error', error: 'A short all-in did not reopen raising' }));
            }
            const previouslyActed = await redisState.smembers(`room:${roomCode}:acted_players`);

            if (!Number.isSafeInteger(requestedAmount) || requestedAmount < 0) {
              return ws.send(JSON.stringify({ type: 'error', error: 'Bet amount must be a non-negative integer' }));
            }

            switch (upperAction) {
              case 'BET':
                chipsToPut = requestedAmount;
                if (roomCurrentBet !== 0 || chipsToPut <= 0 || playerBet > 0) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Bet must be positive and made before betting' }));
                }
                if (Number(player.chips) < chipsToPut) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Insufficient balance' }));
                }
                if (chipsToPut < (Number(room.bigBlind) || BIG_BLIND)
                  && chipsToPut !== Number(player.chips)) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Bet is below the minimum bet' }));
                }
                await updateRoom(roomCode, { currentBet: chipsToPut });
                nextMinRaise = chipsToPut;
                fullRaise = true;
                break;
              case 'RAISE': {
                const newBetAmount = requestedAmount;
                chipsToPut = newBetAmount - playerBet;
                const isAllInRaise = chipsToPut === Number(player.chips);
                const raiseSize = newBetAmount - roomCurrentBet;
                if (raiseSize <= 0 || chipsToPut <= 0 || Number(player.chips) < chipsToPut) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Insufficient balance' }));
                }
                if (raiseSize < nextMinRaise && !isAllInRaise) {
                  return ws.send(JSON.stringify({ type: 'error', error: `Minimum raise is ${nextMinRaise}` }));
                }
                fullRaise = raiseSize >= nextMinRaise;
                if (fullRaise) nextMinRaise = raiseSize;
                await updateRoom(roomCode, { currentBet: newBetAmount });
                break;
              }
              case 'CALL': {
                const maxToCall = roomCurrentBet - playerBet;
                if (maxToCall <= 0) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Nothing to call; use CHECK' }));
                }
                chipsToPut = Math.min(Number(player.chips) || 0, Math.max(0, maxToCall));
                break;
              }
              case 'CHECK':
                if (playerBet !== roomCurrentBet) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'You must CALL or FOLD' }));
                }
                chipsToPut = 0;
                break;
              case 'FOLD':
                chipsToPut = 0;
                await setPlayerFolded(roomCode, clientId);
                await updatePlayer(roomCode, clientId, { isFolded: true, status: 'FOLDED' });
                break;
              default:
                return ws.send(JSON.stringify({ type: 'error', error: 'Invalid game action' }));
            }

            await clearTurnTimer(roomCode);

            if (chipsToPut > 0) {
              if (player.chips < chipsToPut) {
                return ws.send(JSON.stringify({ type: 'error', error: 'Insufficient balance' }));
              }
              const remainingChips = Number(player.chips) - chipsToPut;
              await updatePlayer(roomCode, clientId, {
                chips: remainingChips,
                isAllIn: remainingChips === 0,
                status: remainingChips === 0 ? 'ALL_IN' : 'ACTIVE',
              });
              await addPot(roomCode, chipsToPut);
              await setPlayerBet(roomCode, clientId, playerBet + chipsToPut);
              await redisState.hincrby(`room:${roomCode}:contributions`, clientId, chipsToPut);
            }

            // บันทึกว่าผู้เล่นรายนี้ได้กระทำ Action ในรอบนี้แล้ว
            if (fullRaise) {
              await redisState.del(`room:${roomCode}:acted_players`);
              await redisState.del(`room:${roomCode}:raise_locked`);
            } else if (upperAction === 'RAISE') {
              for (const priorId of previouslyActed) {
                const priorBet = await getPlayerBet(roomCode, priorId);
                const priorPlayer = await getPlayer(roomCode, priorId);
                if (priorBet < requestedAmount && Number(priorPlayer?.chips) > 0) {
                  await redisState.srem(`room:${roomCode}:acted_players`, priorId);
                  await redisState.sadd(`room:${roomCode}:raise_locked`, priorId);
                }
              }
            }
            await redisState.sadd(`room:${roomCode}:acted_players`, clientId);
            await updateRoom(roomCode, {
              minRaise: nextMinRaise,
              lastAction: JSON.stringify({
                client_id: clientId,
                action: upperAction,
                amount: chipsToPut,
                timed_out: false,
              }),
            });

            // ตรวจสอบการเลื่อน Phase
            const phaseResult = await advancePhaseIfNeeded(roomCode);

            let finalNextTurn = null;
            let turnDeadline = null;

            if (phaseResult.isAdvanced) {
              if (!phaseResult.isFinished) {
                finalNextTurn = phaseResult.nextTurn;
                turnDeadline = phaseResult.turnDeadline;
              }
            } else {
              // ถ้ายังไม่เปลี่ยน Phase ให้หาผู้เล่นคนถัดไปในรอบ
              const seats = await getRoomSeats(roomCode);
              const seatEntries = sortedSeatEntries(seats);
              const candidateIds = [];
              const acted = new Set((await redisState.smembers(`room:${roomCode}:acted_players`)).map(String));
              for (const [, playerId] of seatEntries) {
                const candidate = await getPlayer(roomCode, playerId);
                if (candidate && !parseBool(candidate.isFolded) && Number(candidate.chips) > 0
                  && !acted.has(String(playerId))) {
                  candidateIds.push(playerId);
                }
              }
              finalNextTurn = findNextPlayer(seatEntries, clientId, candidateIds);

              if (finalNextTurn) {
                turnDeadline = Date.now() + TURN_TIMEOUT_MS;
                const nextSeat = seatEntries.find(([, playerId]) => String(playerId) === String(finalNextTurn))?.[0] || null;
                await updateRoom(roomCode, { currentTurn: finalNextTurn, currentTurnSeat: nextSeat, turnDeadline });
                startTurnTimer(roomCode, finalNextTurn, turnDeadline);
              } else {
                await updateRoom(roomCode, { currentTurn: '', currentTurnSeat: '', turnDeadline: '' });
              }
            }

            const updatedRoom = await getRoom(roomCode);

            await redisPub.publish(
              CHANNEL,
              JSON.stringify({
                eventType: 'game_action_performed',
                roomCode,
                clientId,
                action: upperAction,
                amount: chipsToPut,
                timedOut: false,
                nextTurn: finalNextTurn,
                turnDeadline: turnDeadline,
                serverTime: Date.now(),
                pot: updatedRoom?.pot || 0,
                currentBet: updatedRoom?.currentBet || 0,
                dealFlop: phaseResult?.dealFlop || null,
                dealTurn: phaseResult?.dealTurn || null,
                dealRiver: phaseResult?.dealRiver || null,
              })
            );
          });
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', error: error.message || 'Invalid game action request' }));
        }
      }
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: error.message || 'Invalid message format',
        })
      );
    }
  });

  ws.on('close', () => void handleDisconnect(ws));
  ws.on('error', () => void handleDisconnect(ws));
});


function startTurnTimer(roomCode, currentTurnPlayerId, deadline) {
  if (!currentTurnPlayerId) {
    clearTurnTimer(roomCode);
    return;
  }
  const turnDeadline = Number(deadline) || Date.now() + TURN_TIMEOUT_MS;
  void redisState.zadd(TURN_TIMER_KEY, turnDeadline, roomCode)
    .catch((error) => console.error(`[Timer] Failed to persist deadline for ${roomCode}:`, error));
}

function clearTurnTimer(roomCode) {
  void redisState.zrem(TURN_TIMER_KEY, roomCode)
    .catch((error) => console.error(`[Timer] Failed to clear deadline for ${roomCode}:`, error));
}

async function processDueTurnTimers() {
  const dueRooms = await redisState.zrangebyscore(TURN_TIMER_KEY, 0, Date.now());
  for (const roomCode of dueRooms) {
    try {
      await withLock(roomCode, async () => {
        const room = await getRoom(roomCode);
        const deadline = Number(room?.turnDeadline) || 0;
        if (!room || !room.currentTurn || deadline > Date.now()
          || !['IN_PROGRESS', 'RUNNING'].includes(room.status)) {
          if (deadline > Date.now()) {
            await redisState.zadd(TURN_TIMER_KEY, deadline, roomCode);
          } else {
            await redisState.zrem(TURN_TIMER_KEY, roomCode);
          }
          return;
        }

        const clientId = room.currentTurn;
        console.log(`[Timer] Player ${clientId} timed out in room ${roomCode}`);
        const playerBet = await getPlayerBet(roomCode, clientId);
        const currentBet = Number(room.currentBet) || 0;
        const autoAction = playerBet >= currentBet ? 'CHECK' : 'FOLD';

        if (autoAction === 'FOLD') {
          await setPlayerFolded(roomCode, clientId);
          await updatePlayer(roomCode, clientId, { isFolded: true, status: 'FOLDED' });
        }

        await clearTurnTimer(roomCode);
        await redisState.sadd(`room:${roomCode}:acted_players`, clientId);
        await updateRoom(roomCode, {
          lastAction: JSON.stringify({
            client_id: clientId,
            action: autoAction,
            amount: 0,
            timed_out: true,
          }),
        });
        const activePlayers = await getActivePlayers(roomCode);
        let phaseResult = { isAdvanced: false, isFinished: false };

        if (activePlayers.length === 1) {
          await handleEarlyFinishGame(roomCode, activePlayers[0]);
          phaseResult = { isAdvanced: true, isFinished: true };
        } else {
          phaseResult = await advancePhaseIfNeeded(roomCode);
        }
        if (phaseResult.isFinished) return;

        let nextTurn = phaseResult.isAdvanced ? phaseResult.nextTurn : null;
        let turnDeadline = phaseResult.turnDeadline || null;
        if (!phaseResult.isAdvanced) {
          const seats = sortedSeatEntries(await getRoomSeats(roomCode));
          const acted = new Set((await redisState.smembers(`room:${roomCode}:acted_players`)).map(String));
          const candidates = [];
          for (const [, playerId] of seats) {
            const candidate = await getPlayer(roomCode, playerId);
            if (candidate && !parseBool(candidate.isFolded) && Number(candidate.chips) > 0 && !acted.has(String(playerId))) {
              candidates.push(playerId);
            }
          }
          nextTurn = candidates.length ? findNextPlayer(seats, clientId, candidates) : null;
          if (nextTurn) {
            turnDeadline = Date.now() + TURN_TIMEOUT_MS;
            // [แก้บัค]: ต้องอัปเดต currentTurnSeat ด้วย ไม่งั้น handleLeaveRoom จะเข้าใจผิดว่าคนที่หมดเวลายังถือ Turn อยู่
            const nextSeat = seats.find(([, playerId]) => String(playerId) === String(nextTurn))?.[0] || '';
            await updateRoom(roomCode, { currentTurn: nextTurn, currentTurnSeat: nextSeat, turnDeadline });
            startTurnTimer(roomCode, nextTurn, turnDeadline);
          }
        }

        const updatedRoom = await getRoom(roomCode);
        await redisPub.publish(CHANNEL, JSON.stringify({
          eventType: 'game_action_performed',
          roomCode,
          clientId,
          action: autoAction,
          amount: 0,
          timedOut: true,
          nextTurn,
          turnDeadline,
          serverTime: Date.now(),
          pot: updatedRoom?.pot || 0,
          currentBet: updatedRoom?.currentBet || 0,
          dealFlop: phaseResult.dealFlop || null,
          dealTurn: phaseResult.dealTurn || null,
          dealRiver: phaseResult.dealRiver || null,
        }));
      });
    } catch (error) {
      if (error.message !== 'Room is busy') {
        console.error(`[Timer] Error handling timeout for room ${roomCode}:`, error);
      }
    }
  }
}

async function processDueDisconnectTimers() {
  const duePlayers = await redisState.zrangebyscore(DISCONNECT_TIMER_KEY, 0, Date.now());
  for (const key of duePlayers) {
    const separator = key.indexOf(':');
    if (separator < 0) continue;
    const roomCode = key.slice(0, separator);
    const clientId = key.slice(separator + 1);
    await handleLeaveRoom({ roomCode, clientId }, true);
  }
}

if (process.env.REDIS_DISABLED !== '1') {
  const timerPoller = setInterval(() => {
    void processDueTurnTimers().catch((error) => console.error('[Timer] Turn poll failed:', error));
    void processDueDisconnectTimers().catch((error) => console.error('[Timer] Disconnect poll failed:', error));
  }, 500);
  timerPoller.unref();
}

async function deleteRoom(roomCode) {
  const keys = [];
  let cursor = '0';
  const pattern = `room:${roomCode}:*`;

  do {
    const result = await redisState.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');

  keys.push(`room:${roomCode}`);
  if (keys.length > 0) {
    await redisState.del(...keys);
  }

  await pool.query('DELETE FROM tables WHERE room_code = :roomCode', { roomCode });
}

// [เพิ่มแก้ไข]: ฟังก์ชันจัดการคนชนะเมื่อหมอบหมดจนเหลือคนเดียว พร้อม Sync DB
async function handleEarlyFinishGame(roomCode, winnerId) {
  clearTurnTimer(roomCode);
  await finishGameWithWinner(roomCode, winnerId);

  // รวบรวมชิปล่าสุดและ buyIn เพื่อ Sync DB
  const seats = await getRoomSeats(roomCode);
  const allPlayerIds = seats ? Object.values(seats).filter(Boolean) : [];
  const playerChipsMap = {};
  const playerBuyInsMap = {};

  for (const pid of allPlayerIds) {
    const pData = await getPlayer(roomCode, pid);
    if (pData) {
      playerChipsMap[pid] = Number(pData.chips) || 0;
      playerBuyInsMap[pid] = Number(pData.buyIn) || Number(pData.chips) || 0;
    }
  }

  const room = await getRoom(roomCode);
  const roundId = room?.roundId || Date.now();

  syncPlayerBalances(roomCode, roundId, playerChipsMap, playerBuyInsMap).catch(err =>
    console.error('Error syncing DB balances on early finish:', err)
  );
  await resetSettlementBaseline(roomCode, playerChipsMap);
}

// [แก้บัค]: syncPlayerBalances คิดส่วนต่างจาก buyIn ตั้งต้น ถ้าไม่ขยับ buyIn ตามชิปที่ Settle แล้ว
// มือถัดๆ ไปจะนับกำไร/ขาดทุนก้อนเดิมซ้ำทุกมือ (refId เปลี่ยนตาม roundId จึงไม่ติด Idempotency)
async function resetSettlementBaseline(roomCode, playerChipsMap) {
  for (const [pid, chips] of Object.entries(playerChipsMap)) {
    await updatePlayer(roomCode, pid, { buyIn: chips });
  }
}

async function handleTournamentFinish(roomCode, winnerId) {
  clearTurnTimer(roomCode);

  const winner = await getPlayer(roomCode, winnerId);
  const seats = await getRoomSeats(roomCode);
  const playerIds = seats ? Object.values(seats).filter(Boolean) : [];
  const players = {};

  for (const pid of playerIds) {
    const player = await getPlayer(roomCode, pid);
    if (player) players[pid] = player;
  }

  await updateRoom(roomCode, {
    status: 'TOURNAMENT_FINISHED',
    phase: 'FINISHED',
    currentTurn: null,
    turnDeadline: null,
    winner: winnerId,
    winnerName: winner?.username || '',
    pot: 0,
    currentBet: 0,
  });

  await redisPub.publish(
    CHANNEL,
    JSON.stringify({
      eventType: 'tournament_finished',
      roomCode,
      room: {
        ...(await getRoom(roomCode)),
        players,
      },
      winnerId,
      currentMoney: Number(winner?.chips) || 0,
    })
  );
}

// ฟังก์ชันตรวจสอบและเปลี่ยน Phase การเล่น (Preflop -> Flop -> Turn -> River -> Showdown)
async function advancePhaseIfNeeded(roomCode) {
  const room = await getRoom(roomCode);
  if (!room || (room.status !== 'IN_PROGRESS' && room.status !== 'RUNNING')) {
    return { isAdvanced: false, isFinished: false };
  }

  const activePlayerIds = await getActivePlayers(roomCode);

  // ถ้าหมอบจนเหลือผู้เล่นคนเดียว -> ให้คนนั้นชนะทันที
  if (activePlayerIds.length === 1) {
    await handleEarlyFinishGame(roomCode, activePlayerIds[0]);
    return { isAdvanced: true, isFinished: true };
  }

  const bettingPlayerIds = [];
  for (const pid of activePlayerIds) {
    const player = await getPlayer(roomCode, pid);
    if (player && Number(player.chips) > 0) {
      bettingPlayerIds.push(pid);
    }
  }

  // ตรวจสอบว่าผู้เล่นทุกคนในรอบนี้ได้กระทำ Action แล้วหรือยัง
  const actedPlayers = (await redisState.smembers(`room:${roomCode}:acted_players`)) || [];
  const bettingPlayers = [];
  const currentBets = {};
  for (const pid of bettingPlayerIds) {
    const player = await getPlayer(roomCode, pid);
    if (!player) continue;
    bettingPlayers.push({ clientId: pid, chips: player.chips, isFolded: parseBool(player.isFolded) });
    currentBets[pid] = await getPlayerBet(roomCode, pid);
  }

  if (!isBettingRoundComplete(bettingPlayers, actedPlayers, room.currentBet, currentBets)) {
    return { isAdvanced: false, isFinished: false };
  }

  if (bettingPlayerIds.length <= 1) {
    clearTurnTimer(roomCode);
    const deck = typeof room.deck === 'string' ? JSON.parse(room.deck) : (room.deck || []);
    const communityCards = typeof room.communityCards === 'string'
      ? JSON.parse(room.communityCards)
      : (room.communityCards || []);

    while (communityCards.length < 5 && deck.length > 0) {
      communityCards.push(deck.pop());
    }

    await updateRoom(roomCode, {
      communityCards: JSON.stringify(communityCards),
      deck: JSON.stringify(deck),
    });
    await handleShowdown(roomCode, room, communityCards, activePlayerIds);
    return { isAdvanced: true, isFinished: true };
  }

  // รีเซ็ตการบันทึก Acted Players และยอด Bet ของผู้เล่นทุกคนเพื่อเตรียมเข้าสู่รอบใหม่
  await redisState.del(`room:${roomCode}:acted_players`);
  await redisState.del(`room:${roomCode}:raise_locked`);
  for (const pid of bettingPlayerIds) {
    await setPlayerBet(roomCode, pid, 0);
  }

  let deck = typeof room.deck === 'string' ? JSON.parse(room.deck) : (room.deck || []);
  let communityCards = typeof room.communityCards === 'string'
    ? JSON.parse(room.communityCards)
    : (room.communityCards || []);

  let nextPhase = room.phase;
  let dealFlop = null;
  let dealTurn = null;
  let dealRiver = null;

  // เลื่อน Phase และดึงไพ่เก็บเข้าตัวแปร
  if (room.phase === 'PREFLOP') {
    nextPhase = 'FLOP';
    dealFlop = [deck.pop(), deck.pop(), deck.pop()];
    communityCards.push(...dealFlop);
  } else if (room.phase === 'FLOP') {
    nextPhase = 'TURN';
    dealTurn = [deck.pop()];
    communityCards.push(...dealTurn);
  } else if (room.phase === 'TURN') {
    nextPhase = 'RIVER';
    dealRiver = [deck.pop()];
    communityCards.push(...dealRiver);
  } else if (room.phase === 'RIVER') {
    // จบการเดิมพันรอบสุดท้าย -> ประมวลผลวัดแต้มไพ่ (Showdown)
    clearTurnTimer(roomCode);
    await handleShowdown(roomCode, room, communityCards, activePlayerIds);
    return { isAdvanced: true, isFinished: true };
  }

  const turnDeadline = Date.now() + TURN_TIMEOUT_MS;

  // อัปเดตข้อมูล State ของห้องลง Redis
  const seatEntries = sortedSeatEntries(await getRoomSeats(roomCode));
  const firstToAct = findFirstAfterSeat(seatEntries, room.dealerSeat, bettingPlayerIds);
  const bigBlind = Number(room.bigBlind) || BIG_BLIND;

  await updateRoom(roomCode, {
    phase: nextPhase,
    currentBet: 0,
    minRaise: bigBlind,
    communityCards: JSON.stringify(communityCards),
    deck: JSON.stringify(deck),
    currentTurn: firstToAct,
    currentTurnSeat: firstToAct
      ? seatEntries.find(([, playerId]) => String(playerId) === String(firstToAct))?.[0] || null
      : null,
    turnDeadline: firstToAct ? turnDeadline : null,
  });

  // เริ่ม Timer สำหรับผู้เล่นคนแรกของ Phase ใหม่
  if (firstToAct) startTurnTimer(roomCode, firstToAct, turnDeadline);

  // คืนค่าไพ่และ nextTurn สำหรับนำไปส่งต่อใน game_action_performed
  return {
    isAdvanced: true,
    isFinished: false,
    dealFlop,
    dealTurn,
    dealRiver,
    nextTurn: firstToAct,
    turnDeadline: firstToAct ? turnDeadline : null,
  };
}

// ฟังก์ชันประมวลผลหาผู้ชนะช่วง Showdown ด้วย game.js
async function handleShowdown(roomCode, room, communityCards, activePlayerIds) {
  clearTurnTimer(roomCode);

  // ดึงไพ่ในมือของผู้เล่นทุกคนจาก Redis
  const rawCardsMap = await redisState.hgetall(`room:${roomCode}:cards`);
  const playersWithCards = [];
  const holeCardsMap = {};
  const seats = await getRoomSeats(roomCode);
  const seatEntries = sortedSeatEntries(seats);
  const dealerPosition = seatEntries.findIndex(([seatKey]) =>
    Number(seatKey.replace('seat_', '')) === Number(room.dealerSeat)
  );
  const firstAfterDealer = dealerPosition < 0 ? 0 : dealerPosition + 1;
  const orderedSeatEntries = [
    ...seatEntries.slice(firstAfterDealer),
    ...seatEntries.slice(0, firstAfterDealer),
  ];
  const allPlayerIds = orderedSeatEntries.map(([, clientId]) => clientId).filter(Boolean);

  for (const pid of allPlayerIds) {
    const rawCards = rawCardsMap ? rawCardsMap[pid] : null;
    const holeCards = rawCards ? JSON.parse(rawCards) : [];
    const isFolded = !activePlayerIds.some((activeId) => String(activeId) === String(pid));
    if (!isFolded) holeCardsMap[pid] = holeCards;
    const player = await getPlayer(roomCode, pid);
    playersWithCards.push({
      clientId: pid,
      holeCards,
      isFolded,
      chips: Number(player?.chips) || 0,
      buyIn: Number(player?.buyIn) || 0,
    });
  }

  const contributions = await redisState.hgetall(`room:${roomCode}:contributions`);
  const { handTitle } = findWinners(
    playersWithCards.filter((player) => !player.isFolded),
    communityCards,
  );
  const { pots, payouts } = distributeSidePots(playersWithCards, contributions, communityCards);
  const winnerIds = [...new Set(pots.flatMap((pot) => pot.winnerIds || []))];

  for (const player of playersWithCards) {
    const prize = Number(payouts[player.clientId]) || 0;
    if (prize > 0) {
      await updatePlayer(roomCode, player.clientId, { chips: player.chips + prize });
    }
  }

  const primaryWinner = winnerIds[0] || null;
  const winnerPlayerObj = primaryWinner ? await getPlayer(roomCode, primaryWinner) : null;
  const playersWithChips = [];

  for (const pid of allPlayerIds) {
    const player = await getPlayer(roomCode, pid);
    if (player && Number(player.chips) > 0) {
      playersWithChips.push(pid);
    }
  }

  // จบมือและรอให้ Host เริ่มรอบถัดไป ถ้ายังมีผู้เล่นเหลืออย่างน้อยสองคน
  await updateRoom(roomCode, {
    status: playersWithChips.length >= 2 ? 'WAITING' : 'TOURNAMENT_FINISHED',
    phase: playersWithChips.length >= 2 ? 'WAITING' : 'FINISHED',
    winner: primaryWinner,
    winnerName: winnerPlayerObj ? winnerPlayerObj.username : '',
    winningHand: handTitle,
    pot: 0,
    currentBet: 0,
    currentTurn: null,
    turnDeadline: null
  });

  await redisState.del(`room:${roomCode}:contributions`);

  const playerChipsMap = {};
  // [เพิ่มแก้ไข]: เพิ่ม Object playerBuyInsMap สำหรับเก็บยอด buyIn ตั้งต้น
  const playerBuyInsMap = {};

  for (const pid of allPlayerIds) {
    // 1. รีเซ็ตสถานะผู้เล่นทุกคนเป็น WAITING
    await updatePlayer(roomCode, pid, {
      isFolded: false,
      isAllIn: false,
      status: 'WAITING'
    });

    // 2. รวบรวมชิปล่าสุดของผู้เล่น
    const pData = await getPlayer(roomCode, pid);
    if (pData) {
      playerChipsMap[pid] = Number(pData.chips) || 0;
      // [เพิ่มแก้ไข]: รวบรวมยอด buyIn ส่งไปคำนวณกำไร/ขาดทุน
      playerBuyInsMap[pid] = Number(pData.buyIn) || Number(pData.chips) || 0;
    }
  }

  // 3. ดึงข้อมูลห้องล่าสุดหลังจากอัปเดตสถานะผู้เล่นทุกคนเรียบร้อยแล้ว
  const updatedRoom = await getRoom(roomCode);
  const players = {};

  for (const pid of allPlayerIds) {
    const player = await getPlayer(roomCode, pid);
    if (player) {
      players[pid] = player;
    }
  }

  // 4. เรียกฟังก์ชัน Sync ชิปลง DB
  // [เพิ่มแก้ไข]: ส่ง playerBuyInsMap ในพารามิเตอร์ที่ 3
  const roundId = room.roundId || Date.now();
  syncPlayerBalances(roomCode, roundId, playerChipsMap, playerBuyInsMap).catch(err =>
    console.error('Error syncing DB balances:', err)
  );
  await resetSettlementBaseline(roomCode, playerChipsMap);

  // ส่งผลจบมือหรือจบการแข่งขันให้ client
  await redisPub.publish(
    CHANNEL,
    JSON.stringify({
      eventType: playersWithChips.length >= 2 ? 'showdown' : 'tournament_finished',
      roomCode,
      room: {
        ...updatedRoom,
        players,
      },
      holeCardsMap,
      winnerId: primaryWinner,
      winnerIds,
      winningHand: handTitle,
      splitPot: pots.some((pot) => (pot.winnerIds || []).length > 1),
      sidePots: pots,
      payouts,
      currentMoney: winnerPlayerObj ? Number(winnerPlayerObj.chips) || 0 : 0,
    })
  );

  // ลบข้อมูลไพ่ชั่วคราวใน Redis ออก
  await redisState.del(`room:${roomCode}:cards`);
  await redisState.del(`room:${roomCode}:acted_players`);
  await redisState.del(`room:${roomCode}:raise_locked`);
}