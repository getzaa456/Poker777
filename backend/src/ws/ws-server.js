import { WebSocketServer } from 'ws';
import { getUserProfile } from '../services/auth.js';
import { redisPub, redisSub } from '../config/redisClient.js';
import {
  updateRoom,
  getRoom,
  addPot,
  getPlayerBet,
  setPlayerBet,
  setPlayerFolded,
} from '../services/roomService.js';
import { withLock } from '../services/lockService.js';
import { joinTable } from '../services/tables.js';

export const wss = new WebSocketServer({ noServer: true });
const CHANNEL = 'poker:events';


redisSub.subscribe(CHANNEL);
redisSub.on('message', (channel, message) => {
  if (channel !== CHANNEL) return;

  try {
    const data = JSON.parse(message);
    const { eventType, roomCode, room, holeCardsMap, clientId } = data;

    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.roomCode === roomCode) {

        switch (eventType) {

          // เมื่อมีคน Join เข้ามา
          case 'player_join': {
            if (client.clientId !== clientId) {
              const privateHoleCards = {};
              const payload = formatTablePayload('table_state', room, privateHoleCards);
              client.send(JSON.stringify(payload));
              
            }
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

const suits = ['H', 'D', 'C', 'S']; // โพดำ, โพแดง, ข้าวหลามตัด, ดอกจิก
const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

// ฟังก์ชันสร้างและสับไพ่
function createShuffledDeck() {
  const deck = [];
  for (const s of suits) {
    for (const v of values) deck.push(v + s);
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ฟังก์ชันแปลง string ไพ่ เช่น "AH" -> { rank: "A", suit: "H" }
function parseCard(cardStr) {
  if (!cardStr || cardStr.length < 2) return null;
  return {
    rank: cardStr.slice(0, -1),
    suit: cardStr.slice(-1),
  };
}

// ฟังก์ชันแปลง State จาก Redis ให้เป็น Payload 
function formatTablePayload(eventType, room, holeCardsMap = {}) {
  const playerIds = Object.keys(room.players || {});

  const playersList = playerIds.map((pid, index) => {
    const p = room.players[pid];
    // ดึงไพ่โฮลการ์ดตาม Map ที่ส่งเข้ามา
    const rawCards = holeCardsMap[pid] || [];

    return {
      client_id: pid,
      seat: index + 1,
      username: p.username || '',
      chips: p.chips || 0,
      avatar_id: p.avatarId ?? null,
      hole_cards: rawCards.map(parseCard).filter(Boolean),
      status: p.status || 'ACTIVE',
    };
  });

  const currentTurnPlayer = room.players[room.currentTurn];

  return {
    type: eventType, // กำหนดประเภทตามที่ส่งเข้ามา ('GAME_STARTED', 'TABLE_STATE', 'SHOWDOWN')
    params: {
      room_code: room.roomCode,
      room_name: room.roomName || '',
      player_count: playerIds.length,
      max_players: room.maxPlayer || 6,
      status: room.status,
      phase: room.phase,
      host_id: room.hostId,
      current_turn: room.currentTurn,
      current_turn_name: currentTurnPlayer ? currentTurnPlayer.username : '',
      turn_deadline: room.turnDeadline || null,
      pot: room.pot || 0,
      current_bet: room.currentBet || 0,
      winner: room.winner || null,
      winner_name: room.winnerName || null,
      winning_hand: room.winningHand || null,
      last_action: room.lastAction || {
        client_id: null,
        action: null,
        amount: 0,
        timed_out: false,
      },
      community_cards: (room.communityCards || []).map(parseCard).filter(Boolean),
      players: playersList,
    },
  };
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

      // กรณีผู้เล่นส่งคำขอเข้าห้อง ({ type: 'join', params: { roomCode, clientId, buyIn } })
      if (type === 'join') {
        const { roomCode, clientId, buyIn } = params || {};


        if (String(ws.userId) !== String(clientId)) {
          return ws.send(
            JSON.stringify({ type: 'error', error: 'Client identity does not match token' })
          );
        }

        await withLock(roomCode, async () => {
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
            room = {
              roomCode: tableInfo.room_code || roomCode,
              roomId: tableInfo.id,
              roomName: tableInfo.name || '',
              minBet: tableInfo.min_bet,
              maxBet: tableInfo.max_bet,
              maxPlayer: tableInfo.max_seats || 6,
              status: 'OPEN',
              currentBet: 0,
              pot: 0,
              players: {},
            };
          }

          const actualBuyIn = buyIn ?? tableInfo.min_bet;
          room.players[clientId] = {
            clientId,
            username: profile.display_name || profile.username,
            chips: Number(actualBuyIn),
            avatarId: profile.avatar_id ?? null,
          };

          await updateRoom(roomCode, room);

          const currentPlayers = Object.values(room.players).map((p) => ({
            clientId: p.clientId,
            username: p.username,
            money: p.chips,
          }));

          ws.send(
            JSON.stringify({
              type: 'join',
              params: {
                success: true,
                roomId: room.roomId,
                roomName: room.roomName || '',
                playerNum: Object.keys(room.players).length,
                maxPlayer: room.maxPlayer,
                currentPlayers: currentPlayers,
              },
            })
          );

          await redisPub.publish(
            CHANNEL,
            JSON.stringify({
              eventType: 'player_join',
              roomCode,
              clientId,
              room,
            })
          );
        });
      }
      // กรณีผู้เล่นขอออกจากห้อง ({ type: 'leave-room' })
      else if (type === 'leave-room') {
        const roomCode = ws.roomCode;
        const clientId = ws.clientId;

        if (!roomCode || !clientId) {
          return ws.send(
            JSON.stringify({ type: 'error', error: 'You are not in a room' })
          );
        }

        await withLock(roomCode, async () => {
          let room = await getRoom(roomCode);

          if (room && room.players) {
            delete room.players[clientId];
            const remainingPlayerIds = Object.keys(room.players);

            if (remainingPlayerIds.length === 0) {
              room.status = 'OPEN';
              room.pot = 0;
              room.currentBet = 0;
            } else {
              if (String(room.hostId) === String(clientId)) {
                room.hostId = remainingPlayerIds[0];
              }

              if (remainingPlayerIds.length < 2) {
                room.status = 'OPEN';
                room.pot = 0;
                room.currentBet = 0;
              }
            }
            await updateRoom(roomCode, room);
          }

          await redisPub.publish(
            CHANNEL,
            JSON.stringify({
              eventType: 'table_updated',
              roomCode,
              room,
            })
          );
        });

        ws.roomCode = null;
        ws.clientId = null;

        ws.send(
          JSON.stringify({
            type: 'left_room',
            params: { room_code: roomCode },
          })
        );
      }

      // กรณี Host สั่งเริ่มเกม ({ type: 'start-game' })
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

          const playerIds = Object.keys(room.players || {});
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
          playerIds.forEach((pid) => {
            holeCardsMap[pid] = [deck.pop(), deck.pop()];
          });

          room.status = 'IN_PROGRESS';
          room.phase = 'PREFLOP';
          room.pot = 0;
          room.currentBet = room.minBet || 0;
          room.communityCards = [];
          room.currentTurn = playerIds[0];
          room.deck = deck;

          await updateRoom(roomCode, room);

          await redisPub.publish(
            CHANNEL,
            JSON.stringify({
              eventType: 'game_started',
              roomCode,
              room,
              holeCardsMap,
            })
          );
        });
      }

      // กรณีผู้เล่นทำ Action ในเกม ({ type: 'GAME_ACTION', params: { action, amount } })
      else if (type === 'game-action') {
        const { action, amount } = params || {};
        const clientId = ws.clientId;
        const roomCode = ws.roomCode;

        if (!roomCode || !clientId) {
          return ws.send(JSON.stringify({ type: 'error', error: 'You are not in a room' }));
        }

        const upperAction = String(action || '').toUpperCase();


        await withLock(roomCode, async () => {
          const room = await getRoom(roomCode);
          const playerBet = await getPlayerBet(roomCode, clientId);

          let chipsToPut = 0;
          let eventType = '';

          switch (upperAction) {
            case 'BET':
              chipsToPut = Number(amount) || 0;
              await updateRoom(roomCode, { currentBet: chipsToPut, currentTurn: nextTurn });
              await setPlayerBet(roomCode, clientId, chipsToPut);
              eventType = 'BET_SUCCESS';
              break;

            case 'RAISE':
              const newBetAmount = Number(amount) || 0;
              chipsToPut = newBetAmount - playerBet;
              await updateRoom(roomCode, { currentBet: newBetAmount, currentTurn: nextTurn });
              await setPlayerBet(roomCode, clientId, newBetAmount);
              eventType = 'RAISE_SUCCESS';
              break;

            case 'CALL':
              chipsToPut = room.currentBet - playerBet;
              await updateRoom(roomCode, { currentTurn: nextTurn });
              await setPlayerBet(roomCode, clientId, room.currentBet);
              eventType = 'CALL_SUCCESS';
              break;

            case 'CHECK':
              chipsToPut = 0;
              await updateRoom(roomCode, { currentTurn: nextTurn });
              eventType = 'CHECK_SUCCESS';
              break;

            case 'FOLD':
              chipsToPut = 0;
              await setPlayerFolded(roomCode, clientId);
              await updateRoom(roomCode, { currentTurn: nextTurn });
              eventType = 'FOLD_SUCCESS';
              break;

            default:
              throw new Error('Invalid game action');
          }

          let updatedPot = room.pot || 0;
          if (chipsToPut > 0) {
            updatedPot = await addPot(roomCode, chipsToPut);
          }

          const eventData = {
            type: 'GAME_ACTION',
            eventType,
            roomCode,
            clientId,
            action: upperAction,
            amount: chipsToPut,
            currentBet: upperAction === 'BET' || upperAction === 'RAISE' ? amount : room.currentBet,
            pot: updatedPot,
            nextTurn,
          };

          await redisPub.publish(CHANNEL, JSON.stringify(eventData));
        });
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
    void leaveRoom(ws);
  });

  ws.on('error', () => {
    void leaveRoom(ws);
  });
});


