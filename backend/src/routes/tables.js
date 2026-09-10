import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { createTable, listOpenTables, getTableSummary, joinTable } from '../services/tables.js';
import { getUserProfile } from '../services/auth.js';
import { WebSocket, WebSocketServer } from 'ws';
import { URL } from 'node:url';
import { joinTableSchema } from '../validators/game.js';
import { validate } from '../middleware/validate.js';
import { jwt } from '../middleware/auth.js';
import { env } from '../config/env.js';

class Room {
  constructor(table) {
    this.roomCode = table.room_code;
    this.roomId = table.id;
    this.name = table.name;
    this.minBet = table.min_bet;
    this.maxBet = table.max_bet;
    this.maxPlayer = table.max_seats;
    this.host = table.host_id;
    this.currentPlayers = new Map();
    this.status = 'OPEN';
    this.communityCards = [];
    this.holeCards = new Map();
    this.pot = 0;
    this.phase = 'WAITING';
    this.currentTurn = null;
    this.turnDeadline = null;
    this.turnTimer = null;
    this.deck = [];
    this.folded = new Set();
    this.acted = new Set();
    this.contributions = new Map();
    this.currentBet = 0;
    this.winner = null;
    this.winnerName = null;
    this.winningHand = null;
    this.lastAction = null;
  }

  state() {
    return {
      room_code: this.roomCode,
      room_name: this.name,
      player_count: this.currentPlayers.size,
      max_players: this.maxPlayer,
      status: this.status,
      phase: this.phase,
      host_id: String(this.host),
      current_turn: this.currentTurn,
      current_turn_name: this.currentTurn ? this.currentPlayers.get(this.currentTurn)?.username || this.currentTurn : null,
      turn_deadline: this.turnDeadline,
      pot: this.pot,
      current_bet: this.currentBet,
      winner: this.winner,
      winner_name: this.winnerName,
      winning_hand: this.winningHand,
      last_action: this.lastAction,
      community_cards: this.communityCards,
      players: [...this.currentPlayers.values()].map((player, seat) => ({
        client_id: player.clientId,
        seat,
        username: player.username || player.clientId,
        chips: player.chips ?? null,
        avatar_id: player.avatarId ?? null,
        hole_cards: this.holeCards.get(player.clientId) || [],
        status: this.folded.has(player.clientId) ? 'FOLDED' : (String(this.currentTurn) === String(player.clientId) ? 'YOUR TURN' : 'IN'),
      })),
    };
  }

  send(socket, type, params = this.state()) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, params }));
    }
  }

  broadcast(type = 'TABLE_STATE', params = this.state()) {
    for (const player of this.currentPlayers.values()) this.send(player.ws, type, params);
  }
}

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function shuffledDeck() {
  const deck = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function startGame(room) {
  if (room.currentPlayers.size < 2 || !['WAITING', 'SHOWDOWN'].includes(room.phase)) return false;
  room.deck = shuffledDeck();
  room.communityCards = [];
  room.pot = 0;
  room.phase = 'PREFLOP';
  room.status = 'IN_PROGRESS';
  room.currentTurn = [...room.currentPlayers.keys()][0];
  room.folded.clear();
  room.acted.clear();
  room.contributions.clear();
  room.currentBet = 0;
  room.winner = null;
  room.currentPlayers.forEach((player) => {
    room.holeCards.set(player.clientId, [room.deck.pop(), room.deck.pop()]);
  });
  room.broadcast('GAME_STARTED');
  armTurn(room);
  return true;
}

function activePlayers(room) {
  return [...room.currentPlayers.keys()].filter((id) => !room.folded.has(id));
}

function armTurn(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnDeadline = Date.now() + 15000;
  room.turnTimer = setTimeout(() => performAction(room, room.currentTurn, 'FOLD', 0, true), 15000);
  room.broadcast('TABLE_STATE');
}

function handScore(cards) {
  const values = cards.map((card) => ({ ...card, value: RANKS.indexOf(card.rank) + 2 }));
  const counts = new Map();
  values.forEach((card) => counts.set(card.value, (counts.get(card.value) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const suits = new Map();
  values.forEach((card) => suits.set(card.suit, [...(suits.get(card.suit) || []), card.value]));
  const flush = [...suits.values()].find((list) => list.length >= 5);
  const unique = [...new Set(values.map((card) => card.value))].sort((a, b) => b - a);
  const straightHighFor = (list) => {
    const ordered = [...new Set(list)].sort((a, b) => b - a);
    if (ordered.includes(14)) ordered.push(1);
    for (let index = 0; index <= ordered.length - 5; index += 1) {
      if (ordered[index] - ordered[index + 4] === 4) return ordered[index];
    }
    return null;
  };
  const straightHigh = straightHighFor(unique);
  const straightFlushHigh = [...suits.values()]
    .filter((list) => list.length >= 5)
    .map(straightHighFor)
    .find((high) => high !== null);
  if (straightFlushHigh) return [8, straightFlushHigh];
  if (groups[0]?.[1] === 4) return [7, groups[0][0]];
  if (groups[0]?.[1] === 3 && groups[1]?.[1] >= 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...flush.sort((a, b) => b - a).slice(0, 5)];
  if (straightHigh) return [4, straightHigh];
  if (groups[0]?.[1] === 3) return [3, groups[0][0]];
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) return [2, groups[0][0], groups[1][0]];
  if (groups[0]?.[1] === 2) return [1, groups[0][0]];
  return [0, ...unique.slice(0, 5)];
}

function compareScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function finishGame(room) {
  const ids = activePlayers(room);
  if (!ids.length) return;
  const board = room.communityCards;
  const winnerId = ids.reduce((best, id) => {
    const score = handScore([...(room.holeCards.get(id) || []), ...board]);
    if (!best || compareScores(score, best.score) > 0) return { id, score };
    return best;
  }, null).id;
  const winner = room.currentPlayers.get(winnerId);
  winner.chips += room.pot;
  room.winner = winnerId;
  room.winnerName = winner.username;
  room.winningHand = handName(handScore([...(room.holeCards.get(winnerId) || []), ...board])[0]);
  room.pot = 0;
  room.phase = 'SHOWDOWN';
  room.status = 'OPEN';
  room.currentTurn = null;
  room.lastAction = null;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnDeadline = null;
  room.broadcast('SHOWDOWN');
}

function handName(category) {
  return ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'][category] || 'High card';
}

function advanceStreet(room) {
  room.acted.clear();
  room.contributions.clear();
  room.currentBet = 0;
  if (room.phase === 'PREFLOP') {
    room.communityCards.push(...room.deck.splice(0, 3));
    room.phase = 'FLOP';
  } else if (room.phase === 'FLOP') {
    room.communityCards.push(room.deck.pop());
    room.phase = 'TURN';
  } else if (room.phase === 'TURN') {
    room.communityCards.push(room.deck.pop());
    room.phase = 'RIVER';
  } else {
    finishGame(room);
    return;
  }
  room.currentTurn = activePlayers(room)[0];
  armTurn(room);
}

function performAction(room, clientId, action, amount, timedOut = false) {
  if (!room.currentPlayers.has(clientId) || room.folded.has(clientId)) return;
  if (action === 'FOLD') room.folded.add(clientId);
  else {
    const player = room.currentPlayers.get(clientId);
    const alreadyContributed = room.contributions.get(clientId) || 0;
    const requested = action === 'CALL'
      ? Math.max(0, room.currentBet - alreadyContributed)
      : Math.max(0, Number(amount) || 0);
    const wager = Math.min(requested, player.chips);
    player.chips -= wager;
    room.pot += wager;
    room.contributions.set(clientId, alreadyContributed + wager);
    if (action === 'BET' || action === 'RAISE') room.currentBet = Math.max(room.currentBet, alreadyContributed + wager);
  }
  room.acted.add(clientId);
  room.lastAction = { client_id: clientId, action, amount: Number(amount) || 0, timed_out: timedOut };
  room.broadcast('GAME_ACTION', { client_id: clientId, action, amount: Number(amount) || 0, timed_out: timedOut });
  const active = activePlayers(room);
  if (active.length <= 1) return finishGame(room);
  if (active.every((id) => room.acted.has(id))) return advanceStreet(room);
  const ids = [...room.currentPlayers.keys()];
  let next = ids[(ids.indexOf(clientId) + 1) % ids.length];
  while (room.folded.has(next)) next = ids[(ids.indexOf(next) + 1) % ids.length];
  room.currentTurn = next;
  armTurn(room);
}

class Client {
  constructor(clientId, ws) {
    this.clientId = clientId;
    this.ws = ws;
    this.currentMoney = 0;
    this.joinedRoom = null;
  }
}

const ROOMS = new Map();
const CLIENTS = new Map();
const wss = new WebSocketServer({ noServer: true });

async function joinRoom(params, ws) {
  const data = validate(joinTableSchema, params);
  if (String(ws.userId) !== String(data.clientId)) {
    return ws.send(JSON.stringify({ type: 'error', error: 'Client identity does not match token' }));
  }
  const room = ROOMS.get(data.roomCode);
  if (!room) return ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));

  let client = CLIENTS.get(data.clientId);
  if (!client) {
    client = new Client(data.clientId, ws);
    CLIENTS.set(data.clientId, client);
  }
  if (client.joinedRoom && client.joinedRoom !== room) {
    return ws.send(JSON.stringify({ type: 'error', error: 'Client already joined a room' }));
  }
  if (!room.currentPlayers.has(data.clientId) && room.currentPlayers.size >= room.maxPlayer) {
    return ws.send(JSON.stringify({ type: 'error', error: 'Table is full' }));
  }

  try {
    await joinTable(data.clientId, data.roomCode, { buy_in: data.buyIn });
  } catch (error) {
    const messages = {
      ROOM_IN_PROGRESS: 'Table is already in progress',
      ROOM_CLOSED: 'Table is closed',
      ROOM_FULL: 'Table is full',
      BUY_IN_TOO_LOW: 'Buy-in is too low',
      BUY_IN_TOO_HIGH: 'Buy-in is too high',
      INSUFFICIENT_BALANCE: 'Insufficient balance',
    };
    return ws.send(JSON.stringify({ type: 'error', error: messages[error.code] || error.message }));
  }

  const profile = await getUserProfile(data.clientId);
  client.ws = ws;
  client.username = profile.display_name || profile.username;
  client.chips = Number(profile.balance || 0);
  client.avatarId = profile.avatar_id ?? null;
  client.joinedRoom = room;
  room.currentPlayers.set(data.clientId, client);
  room.status = room.currentPlayers.size >= room.maxPlayer ? 'IN_PROGRESS' : 'OPEN';
  room.broadcast();
}

function leaveRoom(ws) {
  for (const room of ROOMS.values()) {
    for (const [clientId, client] of room.currentPlayers) {
      if (client.ws !== ws) continue;
      room.currentPlayers.delete(clientId);
      client.joinedRoom = null;
      if (String(room.host) === String(clientId)) {
        room.host = room.currentPlayers.keys().next().value || room.host;
      }
      room.lastAction = { client_id: clientId, action: 'LEAVE', amount: 0, timed_out: false };
      room.status = 'OPEN';
      room.phase = 'WAITING';
      room.currentTurn = null;
      room.communityCards = [];
      room.contributions.clear();
      room.currentBet = 0;
      room.holeCards.clear();
      if (room.turnTimer) {
        clearTimeout(room.turnTimer);
        room.turnTimer = null;
      }
      room.broadcast();
    }
  }
}

function leaveRoomByClient(client) {
  if (!client?.joinedRoom) return false;
  const room = client.joinedRoom;
  const socket = client.ws;
  leaveRoom(socket);
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'LEFT_ROOM', params: { room_code: room.roomCode } }));
    socket.close(1000, 'Left room');
  }
  return true;
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connection', message: 'WebSocket connection established' }));
  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'join') await joinRoom(message.params || {}, ws);
      else if (message.type === 'LEAVE_ROOM') {
        const client = [...CLIENTS.values()].find((item) => item.ws === ws);
        if (!leaveRoomByClient(client)) ws.send(JSON.stringify({ type: 'error', error: 'You are not in a room' }));
      }
      else if (message.type === 'START_GAME') {
        const client = [...CLIENTS.values()].find((item) => item.ws === ws);
        if (!client?.joinedRoom || String(client.clientId) !== String(client.joinedRoom.host)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'Only the room host can start the game' }));
        }
        if (!startGame(client.joinedRoom)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'At least 2 players are required to start' }));
        }
      }
      else if (message.type === 'GAME_ACTION') {
        const client = [...CLIENTS.values()].find((item) => item.ws === ws);
        const room = client?.joinedRoom;
        if (!room || room.phase === 'WAITING') return;
        if (String(room.currentTurn) !== String(client.clientId)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'It is not your turn' }));
        }
        const action = String(message.params?.action || '').toUpperCase();
        if (!['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'].includes(action)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'Invalid game action' }));
        }
        const amount = Math.max(0, Number(message.params?.amount || 0));
        performAction(room, client.clientId, action, amount);
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: error.message || 'Invalid message' }));
    }
  });
  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

export function handleTableUpgrade(request, socket, head) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const claims = jwt.verify(token, env.jwt.secret, { issuer: env.jwt.issuer });
    request.userId = String(claims.sub);
  } catch (_) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.userId = request.userId;
    wss.emit('connection', ws, request);
  });
}

export const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ tables: await listOpenTables() });
}));

router.post('/', asyncHandler(async (req, res) => {
  const table = await createTable(req.user.id, req.body);
  ROOMS.set(table.room_code, new Room(table));
  res.status(201).json({ table });
}));

router.get('/:room_code', asyncHandler(async (req, res) => {
  res.json({ table: await getTableSummary(req.params.room_code) });
}));

router.post('/:room_code/join', asyncHandler(async (req, res) => {
  res.json({ table: await joinTable(req.user.id, req.params.room_code, req.body) });
}));
