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
  findWinners
} from '../services/game.js';
import { syncPlayerBalances } from '../services/wallet.js';
import { pool } from '../config/db.js';


export const wss = new WebSocketServer({ noServer: true });
const CHANNEL = 'poker:events';
// [เพิ่มแก้ไข]: เพิ่ม Helper Function ป้องกัน Bug Redis String 'false' ถูกตีความว่าเป็น Boolean true
const parseBool = (val) => val === true || val === 'true';
// กำหนดเวลาแต่ละ Turn (เช่น 15 วินาที)
const TURN_TIMEOUT_MS = 15000;

// Object สำหรับเก็บ reference ของ setTimeout แต่ละ roomCode บน Server Node.js
const roomTimers = {};

redisSub.subscribe(CHANNEL);
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
                  clientId: currentTurn
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
      status: parseBool(p.isFolded) ? 'FOLDED' : (p.status || 'ACTIVE'),
    };
  });

  const currentTurnPlayer = room.players ? room.players[room.currentTurn] : null;

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
      current_turn: room.currentTurn,
      current_turn_name: currentTurnPlayer ? currentTurnPlayer.username : '',
      turn_deadline: room.turnDeadline || null,
      pot: Number(room.pot) || 0,
      current_bet: Number(room.currentBet) || 0,
      winner: room.winner || null,
      winner_name: room.winnerName || null,
      winning_hand: room.winningHand || null,
      last_action: room.lastAction || {
        client_id: null,
        action: null,
        amount: 0,
        timed_out: false,
      },
      community_cards: (typeof room.communityCards === 'string'
        ? JSON.parse(room.communityCards)
        : room.communityCards || []).map(parseCard).filter(Boolean),
      players: playersList,
    },
  };
}

// ฟังก์ชันสำหรับจัดการคนออกจากห้อง (ใช้ซ้ำได้ทั้งสั่งผ่าน WS และตอน disconnect)
async function handleLeaveRoom(ws) {
  const roomCode = ws.roomCode;
  const clientId = ws.clientId;

  if (!roomCode || !clientId) return;

  try {
    await withLock(roomCode, async () => {
      const room = await getRoom(roomCode);
      if (!room) return;

      const seats = (await getRoomSeats(roomCode)) || {};
      let leavingSeatKey = null;

      for (const [seatKey, playerId] of Object.entries(seats)) {
        if (playerId === clientId) {
          leavingSeatKey = seatKey;
          break;
        }
      }

      // Sync DB ชิปล่าสุดและส่วนต่าง Buy-in เมื่อผู้เล่นออกจากห้อง
      const leavingPlayer = await getPlayer(roomCode, clientId);
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
                const turnResult = await advanceTurn(roomCode);
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
      }
    });
  } catch (err) {
    console.error('Leave room error:', err);
  } finally {
    ws.roomCode = null;
    ws.clientId = null;
  }
}

wss.on('connection', (ws) => {
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
            const isAlreadyInRoom = Object.values(existingSeats).includes(clientId);

            if (isAlreadyInRoom) {
              return ws.send(
                JSON.stringify({ type: 'error', error: 'Player is already in this room' })
              );
            }

            let tableInfo;
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

            const profile = await getUserProfile(clientId);

            ws.roomCode = roomCode;
            ws.clientId = clientId;

            let room = await getRoom(roomCode);
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
              };
              await updateRoom(roomCode, initialRoom);
              room = await getRoom(roomCode);
            }

            const occupiedSeatIndices = Object.keys(existingSeats).map((s) => Number(s.replace('seat_', '')));
            const maxSeats = Number(room.maxPlayer) || 6;

            let availableSeatIndex = -1;
            for (let i = 0; i < maxSeats; i++) {
              if (!occupiedSeatIndices.includes(i)) {
                availableSeatIndex = i;
                break;
              }
            }

            const actualBuyIn = Number(buyIn ?? tableInfo.min_bet);

            // [เพิ่มแก้ไข]: บันทึก buyIn ไว้ใน Redis สำหรับเปรียบเทียบกำไร/ขาดทุนตอน Sync ยอดลง DB
            await updatePlayer(roomCode, clientId, {
              clientId,
              username: profile.display_name || profile.username,
              chips: actualBuyIn,
              buyIn: actualBuyIn,
              avatarId: profile.avatar_id ?? '',
              seatIndex: availableSeatIndex >= 0 ? availableSeatIndex : 0,
              isFolded: false,
            });

            if (availableSeatIndex >= 0) {
              await setPlayerSeat(roomCode, availableSeatIndex, clientId);
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

            await redisPub.publish(
              CHANNEL,
              JSON.stringify({
                eventType: 'player_join',
                roomCode,
                clientId,
                room: {
                  ...room,
                  players: playersMap,
                },
              })
            );
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

          const seats = await getRoomSeats(roomCode);
          const seatedPlayerIds = seats ? Object.values(seats).filter(Boolean) : [];
          const playerIds = [];

          for (const pid of seatedPlayerIds) {
            const player = await getPlayer(roomCode, pid);
            if (player && Number(player.chips) > 0) {
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
            await updatePlayer(roomCode, pid, { isFolded: false });

            await redisState.hset(`room:${roomCode}:cards`, pid, JSON.stringify(holeCardsMap[pid]));
            const pData = await getPlayer(roomCode, pid);
            if (pData) playersMap[pid] = pData;
          }
          await redisState.del(`room:${roomCode}:acted_players`);

          const turnDeadline = Date.now() + TURN_TIMEOUT_MS;

          const roomUpdates = {
            status: 'IN_PROGRESS',
            phase: 'PREFLOP',
            pot: 0,
            currentBet: 0,
            currentTurn: playerIds[0],
            turnDeadline: turnDeadline,
            communityCards: JSON.stringify([]),
            deck: JSON.stringify(deck),
            roundId: Date.now(), // [แก้ไข]: เพิ่ม roundId สำหรับอ้างอิงรอบการเล่นใน Idempotency Settlement
          };

          await updateRoom(roomCode, roomUpdates);
          const updatedRoom = await getRoom(roomCode);

          // เริ่ม Timer สำหรับผู้เล่นคนแรก
          startTurnTimer(roomCode, playerIds[0]);

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

            if (room.currentTurn && String(room.currentTurn) !== String(clientId)) {
              return ws.send(JSON.stringify({ type: 'error', error: 'Not your turn' }));
            }

            const playerBet = await getPlayerBet(roomCode, clientId);
            const roomCurrentBet = Number(room.currentBet) || 0;
            let chipsToPut = 0;

            switch (upperAction) {
              case 'BET':
                chipsToPut = Number(amount) || 0;
                if (chipsToPut <= 0 || playerBet > 0) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Bet must be positive and made before betting' }));
                }
                if (Number(player.chips) < chipsToPut) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Insufficient balance' }));
                }
                await updateRoom(roomCode, { currentBet: chipsToPut });
                break;
              case 'RAISE': {
                const newBetAmount = Number(amount) || 0;
                if (newBetAmount <= Number(room.currentBet || 0)) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Raise must be higher than current bet' }));
                }
                chipsToPut = newBetAmount - playerBet;
                if (Number(player.chips) < chipsToPut) {
                  return ws.send(JSON.stringify({ type: 'error', error: 'Insufficient balance' }));
                }
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
                break;
              default:
                return ws.send(JSON.stringify({ type: 'error', error: 'Invalid game action' }));
            }

              clearTurnTimer(roomCode);

            if (chipsToPut > 0) {
              if (player.chips < chipsToPut) {
                return ws.send(JSON.stringify({ type: 'error', error: 'Insufficient balance' }));
              }
              await updatePlayer(roomCode, clientId, { chips: player.chips - chipsToPut });
              await addPot(roomCode, chipsToPut);
              await setPlayerBet(roomCode, clientId, playerBet + chipsToPut);
            }

            // บันทึกว่าผู้เล่นรายนี้ได้กระทำ Action ในรอบนี้แล้ว
            await redisState.sadd(`room:${roomCode}:acted_players`, clientId);

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
              const playerIds = seats ? Object.values(seats) : [];
              if (playerIds.length > 0) {
                const currentIndex = playerIds.indexOf(clientId);
                for (let i = 1; i < playerIds.length; i++) {
                  const checkPid = playerIds[(currentIndex + i) % playerIds.length];
                  const checkPlayer = await getPlayer(roomCode, checkPid);
                  if (checkPlayer && !parseBool(checkPlayer.isFolded) && Number(checkPlayer.chips) > 0) {
                    finalNextTurn = checkPid;
                    break;
                  }
                }
              }

              if (finalNextTurn) {
                turnDeadline = Date.now() + TURN_TIMEOUT_MS;
                await updateRoom(roomCode, { currentTurn: finalNextTurn, turnDeadline });
                startTurnTimer(roomCode, finalNextTurn);
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

  ws.on('close', () => {
    void handleLeaveRoom(ws);
  });

  ws.on('error', () => {
    void handleLeaveRoom(ws);
  });
});


/**
 * ฟังก์ชันเริ่มนับถอยหลัง Turn และจัดการเมื่อหมดเวลา (Timeout)
 */
async function startTurnTimer(roomCode, currentTurnPlayerId) {
  clearTurnTimer(roomCode);

  if (!currentTurnPlayerId) return;

  roomTimers[roomCode] = setTimeout(async () => {
    try {
      await withLock(roomCode, async () => {
        const room = await getRoom(roomCode);

        if (room && String(room.currentTurn) === String(currentTurnPlayerId) &&
          (room.status === 'IN_PROGRESS' || room.status === 'RUNNING')) {

          console.log(`[Timer] Player ${currentTurnPlayerId} timed out in room ${roomCode}`);

          const playerBet = await getPlayerBet(roomCode, currentTurnPlayerId);
          const currentBet = Number(room.currentBet) || 0;
          const autoAction = (playerBet >= currentBet) ? 'CHECK' : 'FOLD';

          if (autoAction === 'FOLD') {
            await setPlayerFolded(roomCode, currentTurnPlayerId);
          }

          await redisState.sadd(`room:${roomCode}:acted_players`, currentTurnPlayerId);

          const activePlayers = await getActivePlayers(roomCode);
          let phaseResult = { isAdvanced: false, isFinished: false };

          if (activePlayers.length === 1) {
            await handleEarlyFinishGame(roomCode, activePlayers[0]);
            phaseResult = { isAdvanced: true, isFinished: true };
          } else {
            phaseResult = await advancePhaseIfNeeded(roomCode);
          }

          // ถ้าเกมจบแล้ว ไม่ต้องส่ง game_action_performed อีก
          if (phaseResult.isFinished) return;

          let finalNextTurn = null;
          let turnDeadline = null;

          if (phaseResult.isAdvanced) {
            finalNextTurn = phaseResult.nextTurn;
            turnDeadline = phaseResult.turnDeadline;
          } else {
            const seats = await getRoomSeats(roomCode);
            const playerIds = seats ? Object.values(seats) : [];
            if (playerIds.length > 0) {
              const currentIndex = playerIds.indexOf(currentTurnPlayerId);
              for (let i = 1; i < playerIds.length; i++) {
                const checkPid = playerIds[(currentIndex + i) % playerIds.length];
                const checkPlayer = await getPlayer(roomCode, checkPid);
                if (checkPlayer && !parseBool(checkPlayer.isFolded) && Number(checkPlayer.chips) > 0) {
                  finalNextTurn = checkPid;
                  break;
                }
              }
            }

            if (finalNextTurn) {
              turnDeadline = Date.now() + TURN_TIMEOUT_MS;
              await updateRoom(roomCode, { currentTurn: finalNextTurn, turnDeadline });
              startTurnTimer(roomCode, finalNextTurn);
            }
          }

          const updatedRoom = await getRoom(roomCode);

          await redisPub.publish(
            CHANNEL,
            JSON.stringify({
              eventType: 'game_action_performed',
              roomCode,
              clientId: currentTurnPlayerId,
              action: autoAction,
              amount: 0,
              timedOut: true,
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
        }
      });
    } catch (err) {
      console.error(`[Timer] Error handling timeout for room ${roomCode}:`, err);
    }
  }, TURN_TIMEOUT_MS);
}

/**
 * ฟังก์ชันยกเลิก Timer ประจำห้อง
 */
function clearTurnTimer(roomCode) {
  if (roomTimers[roomCode]) {
    clearTimeout(roomTimers[roomCode]);
    delete roomTimers[roomCode];
  }
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

  if (bettingPlayerIds.length === 0) {
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

  // ตรวจสอบว่าผู้เล่นทุกคนในรอบนี้ได้กระทำ Action แล้วหรือยัง
  const actedPlayers = (await redisState.smembers(`room:${roomCode}:acted_players`)) || [];
  const allActed = bettingPlayerIds.every((pid) => actedPlayers.includes(pid));
  if (!allActed) return { isAdvanced: false, isFinished: false };

  // ตรวจสอบว่าทุกคนที่ยังเล่นอยู่ ลงเงินเดิมพันเท่ากับ currentBet หรือยัง (ยกเว้นผู้เล่นที่ All-in)
  let isRoundComplete = true;
  for (const pid of bettingPlayerIds) {
    const player = await getPlayer(roomCode, pid);
    const bet = await getPlayerBet(roomCode, pid);
    if (player && Number(player.chips) > 0 && Number(bet) !== Number(room.currentBet)) {
      isRoundComplete = false;
      break;
    }
  }

  if (!isRoundComplete) return { isAdvanced: false, isFinished: false };

  // รีเซ็ตการบันทึก Acted Players และยอด Bet ของผู้เล่นทุกคนเพื่อเตรียมเข้าสู่รอบใหม่
  await redisState.del(`room:${roomCode}:acted_players`);
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
  await updateRoom(roomCode, {
    phase: nextPhase,
    currentBet: 0,
    communityCards: JSON.stringify(communityCards),
    deck: JSON.stringify(deck),
    currentTurn: bettingPlayerIds[0],
    turnDeadline: turnDeadline
  });

  // เริ่ม Timer สำหรับผู้เล่นคนแรกของ Phase ใหม่
  startTurnTimer(roomCode, bettingPlayerIds[0]);

  // คืนค่าไพ่และ nextTurn สำหรับนำไปส่งต่อใน game_action_performed
  return {
    isAdvanced: true,
    isFinished: false,
    dealFlop,
    dealTurn,
    dealRiver,
    nextTurn: bettingPlayerIds[0],
    turnDeadline,
  };
}

// ฟังก์ชันประมวลผลหาผู้ชนะช่วง Showdown ด้วย game.js
async function handleShowdown(roomCode, room, communityCards, activePlayerIds) {
  clearTurnTimer(roomCode);

  // ดึงไพ่ในมือของผู้เล่นทุกคนจาก Redis
  const rawCardsMap = await redisState.hgetall(`room:${roomCode}:cards`);
  const activePlayersWithCards = [];
  const holeCardsMap = {};

  for (const pid of activePlayerIds) {
    const rawCards = rawCardsMap ? rawCardsMap[pid] : null;
    const holeCards = rawCards ? JSON.parse(rawCards) : [];
    holeCardsMap[pid] = holeCards;
    activePlayersWithCards.push({ clientId: pid, holeCards });
  }

  // เรียกใช้ฟังก์ชัน findWinners จาก game.js คำนวณความใหญ่ของชุดไพ่
  const { winners, handTitle } = findWinners(activePlayersWithCards, communityCards);

  const potAmount = Number(room.pot) || 0;

  if (winners.length > 0) {
    // คำนวณการแบ่งเงิน Pot (รองรับกรณีไพ่เท่ากัน / Split Pot)
    const splitShare = Math.floor(potAmount / winners.length);
    let remainder = potAmount % winners.length;

    for (const winner of winners) {
      const winnerPlayer = await getPlayer(roomCode, winner.clientId);
      if (winnerPlayer) {
        const prize = splitShare + (remainder > 0 ? 1 : 0);
        remainder -= 1;
        await updatePlayer(roomCode, winner.clientId, {
          chips: Number(winnerPlayer.chips) + prize
        });
      }
    }
  }

  const primaryWinner = winners[0] ? winners[0].clientId : null;
  const winnerPlayerObj = primaryWinner ? await getPlayer(roomCode, primaryWinner) : null;
  const seats = await getRoomSeats(roomCode);
  const allPlayerIds = seats ? Object.values(seats).filter(Boolean) : [];
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
      winnerIds: winners.map((winner) => winner.clientId),
      winningHand: handTitle,
      splitPot: winners.length > 1,
      currentMoney: winnerPlayerObj ? Number(winnerPlayerObj.chips) || 0 : 0,
    })
  );

  // ลบข้อมูลไพ่ชั่วคราวใน Redis ออก
  await redisState.del(`room:${roomCode}:cards`);
  await redisState.del(`room:${roomCode}:acted_players`);
}