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
  setPlayerSeat
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
      dealFlop,
      dealTurn,
      winner
    } = data;

    wss.clients.forEach((client) => {
      const isSameRoom = String(client.roomCode) === String(roomCode);

      if (client.readyState === 1 && isSameRoom) {

        switch (eventType) {
          // เมื่อมีคน Join เข้ามา (ส่งแจ้งเตือนหาคนอื่นในห้อง)
          case 'player_join': {
            if (String(client.clientId) !== String(clientId)) {
              const currentPlayers = Object.values(room.players || {}).map((p) => ({
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
                  action,
                  amount,
                  timed_out: timedOut || false,
                },
              })
            );

            if (nextTurn) {
              client.send(
                JSON.stringify({
                  type: 'turn-start',
                  params: { clientId: nextTurn },
                })
              );
            }

            if (dealFlop) {
              client.send(
                JSON.stringify({
                  type: 'deal-flop',
                  params: { card: dealFlop },
                })
              );
            }

            if (dealTurn) {
              client.send(
                JSON.stringify({
                  type: 'deal-turn',
                  params: { card: dealTurn },
                })
              );
            }

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

const suits = ['H', 'D', 'C', 'S'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

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

function parseCard(cardStr) {
  if (!cardStr || cardStr.length < 2) return null;
  return {
    rank: cardStr.slice(0, -1),
    suit: cardStr.slice(-1),
  };
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
      status: p.isFolded ? 'FOLDED' : (p.status || 'ACTIVE'),
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

      if (leavingSeatKey) {
        await redisState.hdel(`room:${roomCode}:seats`, leavingSeatKey);
      }

      const updatedSeats = (await getRoomSeats(roomCode)) || {};
      const remainingPlayerIds = Object.values(updatedSeats);

      const roomUpdates = {};

      if (remainingPlayerIds.length === 0) {
        await resetRoundState(roomCode);
        roomUpdates.status = 'OPEN';
        roomUpdates.hostId = '';
      } else {
        if (String(room.hostId) === String(clientId)) {
          roomUpdates.hostId = remainingPlayerIds[0];
        }

        if (remainingPlayerIds.length < 2) {
          await resetRoundState(roomCode);
          roomUpdates.status = 'OPEN';
        }
      }

      if (Object.keys(roomUpdates).length > 0) {
        await updateRoom(roomCode, roomUpdates);
      }

      const currentPlayers = [];
      const remainingPlayersMap = {};

      for (const pid of remainingPlayerIds) {
        const pData = await getPlayer(roomCode, pid);
        if (pData) {
          remainingPlayersMap[pid] = pData;
          currentPlayers.push({
            clientId: pData.clientId,
            username: pData.username,
            money: Number(pData.chips) || 0,
          });
        }
      }

      await redisPub.publish(
        CHANNEL,
        JSON.stringify({
          eventType: 'player_left',
          roomCode,
          clientId,
          currentPlayers,
        })
      );
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

            const actualBuyIn = buyIn ?? tableInfo.min_bet;

            await updatePlayer(roomCode, clientId, {
              clientId,
              username: profile.display_name || profile.username,
              chips: Number(actualBuyIn),
              avatarId: profile.avatar_id ?? '',
              seatIndex: availableSeatIndex >= 0 ? availableSeatIndex : 0,
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
          const playerIds = seats ? Object.values(seats).filter(Boolean) : [];

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

            const pData = await getPlayer(roomCode, pid);
            if (pData) playersMap[pid] = pData;
          }

          const minBet = Number(room.minBet) || 0;
          const roomUpdates = {
            status: 'IN_PROGRESS',
            phase: 'PREFLOP',
            pot: 0,
            currentBet: minBet,
            currentTurn: playerIds[0],
            communityCards: JSON.stringify([]),
            deck: JSON.stringify(deck),
          };

          await updateRoom(roomCode, roomUpdates);
          const updatedRoom = await getRoom(roomCode);

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
            let chipsToPut = 0;

            const seats = await getRoomSeats(roomCode);
            const playerIds = seats ? Object.values(seats) : [];

            // ค้นหาผู้เล่นคนถัดไปที่ยังไม่หมอบ (isFolded !== true)
            let nextTurn = null;
            if (playerIds.length > 0) {
              const currentIndex = playerIds.indexOf(clientId);
              for (let i = 1; i < playerIds.length; i++) {
                const checkPid = playerIds[(currentIndex + i) % playerIds.length];
                const checkPlayer = await getPlayer(roomCode, checkPid);
                if (checkPlayer && !checkPlayer.isFolded) {
                  nextTurn = checkPid;
                  break;
                }
              }
            }

            switch (upperAction) {
              case 'BET':
                chipsToPut = Number(amount) || 0;
                await updateRoom(roomCode, { currentBet: chipsToPut });
                break;
              case 'RAISE':
                const newBetAmount = Number(amount) || 0;
                chipsToPut = newBetAmount - playerBet;
                await updateRoom(roomCode, { currentBet: newBetAmount });
                break;
              case 'CALL':
                chipsToPut = (room.currentBet || 0) - playerBet;
                break;
              case 'CHECK':
                chipsToPut = 0;
                break;
              case 'FOLD':
                chipsToPut = 0;
                await setPlayerFolded(roomCode, clientId);
                break;
              default:
                return ws.send(JSON.stringify({ type: 'error', error: 'Invalid game action' }));
            }

            if (chipsToPut > 0) {
              if (player.chips < chipsToPut) {
                return ws.send(JSON.stringify({ type: 'error', error: 'Insufficient balance' }));
              }
              await updatePlayer(roomCode, clientId, { chips: player.chips - chipsToPut });
              await addPot(roomCode, chipsToPut);
              await setPlayerBet(roomCode, clientId, playerBet + chipsToPut);
            }

            if (nextTurn) {
              await updateRoom(roomCode, { currentTurn: nextTurn });
            }

            await redisPub.publish(
              CHANNEL,
              JSON.stringify({
                eventType: 'game_action_performed',
                roomCode,
                clientId,
                action: upperAction,
                amount: chipsToPut,
                timedOut: false,
                nextTurn,
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