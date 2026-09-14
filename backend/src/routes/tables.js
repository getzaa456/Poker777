import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { createTable, listOpenTables, getTableSummary, joinTable } from '../services/tables.js';
import { getUserProfile } from '../services/auth.js';
import { WebSocket, WebSocketServer } from 'ws';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { joinTableSchema } from '../validators/game.js';
import { validate } from '../middleware/validate.js';
import { jwt } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { getRedis, getRedisPublisher, getRedisSubscriber, withRedisLock } from '../config/redis.js';

const PUBSUB_CHANNEL = 'chat';
const INSTANCE_ID = process.env.INSTANCE_ID || randomUUID();
let pubSubPromise = null;
let publishQueue = Promise.resolve();

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
    this.eventVersion = 0;
  }

  state(clientId = null) {
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
        hole_cards: String(player.clientId) === String(clientId) ? (this.holeCards.get(player.clientId) || []) : [],
        status: this.folded.has(player.clientId) ? 'FOLDED' : (String(this.currentTurn) === String(player.clientId) ? 'YOUR TURN' : 'IN'),
      })),
    };
  }

  send(socket, type, params = null) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const player = [...this.currentPlayers.values()].find((item) => item.ws === socket);
      const payload = params ?? this.state(player?.clientId);
      socket.send(JSON.stringify({ type, params: payload }));
    }
  }

  internalState() {
    return {
      ...this.state(),
      players: [...this.currentPlayers.values()].map((player) => ({
        client_id: player.clientId,
        username: player.username,
        chips: player.chips,
        avatar_id: player.avatarId,
      })),
      hole_cards: [...this.holeCards.entries()],
      folded: [...this.folded],
      acted: [...this.acted],
      contributions: [...this.contributions.entries()],
      deck: this.deck,
    };
  }

  applyInternalState(snapshot) {
    if (!snapshot) return;
    this.status = snapshot.status;
    this.phase = snapshot.phase;
    this.currentTurn = snapshot.current_turn;
    this.turnDeadline = snapshot.turn_deadline;
    this.pot = snapshot.pot;
    this.currentBet = snapshot.current_bet;
    this.winner = snapshot.winner;
    this.winnerName = snapshot.winner_name;
    this.winningHand = snapshot.winning_hand;
    this.lastAction = snapshot.last_action;
    this.communityCards = snapshot.community_cards || [];
    this.host = snapshot.host_id;
    this.currentPlayers = new Map((snapshot.players || []).map((player) => {
      const local = this.currentPlayers.get(player.client_id);
      return [player.client_id, { ...player, clientId: player.client_id, ws: local?.ws || null }];
    }));
    this.holeCards = new Map(snapshot.hole_cards || []);
    this.folded = new Set(snapshot.folded || []);
    this.acted = new Set(snapshot.acted || []);
    this.contributions = new Map(snapshot.contributions || []);
    this.deck = snapshot.deck || [];
  }

  broadcast(type = 'TABLE_STATE', params = null) {
    publishRoomEvent(this, type, params);
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
  armTurn(room);
  return true;
}

function activePlayers(room) {
  return [...room.currentPlayers.keys()].filter((id) => !room.folded.has(id));
}

function armTurn(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnDeadline = Date.now() + 15000;
  scheduleTurnTimer(room);
  room.broadcast('TABLE_STATE');
}

function scheduleTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (!room.currentTurn || !room.turnDeadline || room.phase === 'WAITING' || room.phase === 'SHOWDOWN') return;
  const delay = Math.max(0, Number(room.turnDeadline) - Date.now());
  room.turnTimer = setTimeout(() => {
    void withRedisLock(`room:${room.roomCode}`, async () => {
      await restoreRoomSnapshot(room);
      if (room.currentTurn && Number(room.turnDeadline) <= Date.now()) {
        performAction(room, room.currentTurn, 'FOLD', 0, true);
      }
    });
  }, delay);
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

function deliverRoomEvent(event) {
  const room = ROOMS.get(event.roomCode);
  if (!room) return;
  if (event.version && event.version <= room.eventVersion) return;
  room.eventVersion = event.version || room.eventVersion;
  room.applyInternalState(event.snapshot);
  scheduleTurnTimer(room);
  const stateEvent = ['TABLE_STATE', 'GAME_STARTED', 'SHOWDOWN'].includes(event.type);
  for (const player of room.currentPlayers.values()) {
    room.send(player.ws, event.type, stateEvent ? null : event.params);
  }
}

async function ensurePubSub() {
  if (pubSubPromise) return pubSubPromise;
  pubSubPromise = (async () => {
    const subscriber = await getRedisSubscriber();
    const publisher = await getRedisPublisher();
    if (!subscriber || !publisher) return false;
    await subscriber.subscribe(PUBSUB_CHANNEL);
    subscriber.on('message', (channel, raw) => {
      if (channel !== PUBSUB_CHANNEL) return;
      try {
        deliverRoomEvent(JSON.parse(raw));
      } catch (error) {
        console.error('[redis] invalid table event:', error.message);
      }
    });
    return true;
  })().catch((error) => {
    pubSubPromise = null;
    console.error('[redis] pub/sub unavailable:', error.message);
    return false;
  });
  return pubSubPromise;
}

async function publishRoomEvent(room, type, params) {
  publishQueue = publishQueue.then(async () => {
    try {
      await ensurePubSub();
      const publisher = await getRedisPublisher();
      if (publisher) {
        const version = await publisher.incr(`table-event:${room.roomCode}`);
        const event = {
          event_id: randomUUID(),
          instance_id: INSTANCE_ID,
          version,
          roomCode: room.roomCode,
          type,
          params: params ?? room.state(),
          snapshot: room.internalState(),
        };
        await publisher.set(`table-snapshot:${room.roomCode}`, JSON.stringify({ version, snapshot: event.snapshot }), 'EX', 3600);
        await publisher.publish(PUBSUB_CHANNEL, JSON.stringify(event));
        return;
      }
      if (env.isProd) {
        console.error('[redis] table event unavailable; refusing local-only state in production');
        return;
      }
    } catch (error) {
      console.error('[redis] table event publish failed:', error.message);
      if (env.isProd) return;
    }
    deliverRoomEvent({
      event_id: randomUUID(),
      instance_id: INSTANCE_ID,
      roomCode: room.roomCode,
      type,
      params: params ?? room.state(),
      snapshot: room.internalState(),
    });
  });
  return publishQueue;
}

async function restoreRoomSnapshot(room) {
  try {
    const redis = await getRedis();
    const saved = redis && await redis.get(`table-snapshot:${room.roomCode}`);
    if (!saved) return;
    const { version, snapshot } = JSON.parse(saved);
    room.eventVersion = Number(version) || 0;
    room.applyInternalState(snapshot);
  } catch (error) {
    console.error('[redis] table snapshot restore failed:', error.message);
  }
}

async function joinRoom(params, ws) {
  const data = validate(joinTableSchema, params);
  if (String(ws.userId) !== String(data.clientId)) {
    return ws.send(JSON.stringify({ type: 'error', error: 'Client identity does not match token' }));
  }
  await ensurePubSub();
  let room = ROOMS.get(data.roomCode);
  if (!room) {
    const table = await getTableSummary(data.roomCode);
    room = new Room(table);
    await restoreRoomSnapshot(room);
    ROOMS.set(data.roomCode, room);
  }
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

  const joined = await withRedisLock(`room:${room.roomCode}`, async () => {
    await restoreRoomSnapshot(room);
    if (!room.currentPlayers.has(data.clientId) && room.currentPlayers.size >= room.maxPlayer) {
      return { error: 'Table is full' };
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
      return { error: messages[error.code] || error.message };
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
    return { ok: true };
  });
  if (joined === false) return ws.send(JSON.stringify({ type: 'error', error: 'Table is busy, please retry' }));
  if (joined.error) return ws.send(JSON.stringify({ type: 'error', error: joined.error }));
}

async function leaveRoom(ws) {
  for (const room of ROOMS.values()) {
    const client = [...room.currentPlayers.values()].find((item) => item.ws === ws);
    if (!client) continue;
    await withRedisLock(`room:${room.roomCode}`, async () => {
      await restoreRoomSnapshot(room);
      const current = room.currentPlayers.get(client.clientId);
      if (!current || current.ws !== ws) return;
      room.currentPlayers.delete(client.clientId);
      current.joinedRoom = null;
      if (String(room.host) === String(client.clientId)) {
        room.host = room.currentPlayers.keys().next().value || room.host;
      }
      room.lastAction = { client_id: client.clientId, action: 'LEAVE', amount: 0, timed_out: false };
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
    });
  }
}

async function leaveRoomByClient(client) {
  if (!client?.joinedRoom) return false;
  const room = client.joinedRoom;
  const socket = client.ws;
  await leaveRoom(socket);
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
        if (!(await leaveRoomByClient(client))) ws.send(JSON.stringify({ type: 'error', error: 'You are not in a room' }));
      }
      else if (message.type === 'START_GAME') {
        const client = [...CLIENTS.values()].find((item) => item.ws === ws);
        if (!client?.joinedRoom || String(client.clientId) !== String(client.joinedRoom.host)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'Only the room host can start the game' }));
        }
        const started = await withRedisLock(`room:${client.joinedRoom.roomCode}`, async () => {
          await restoreRoomSnapshot(client.joinedRoom);
          if (String(client.joinedRoom.host) !== String(client.clientId)) return false;
          return startGame(client.joinedRoom);
        });
        if (started === false) {
          return ws.send(JSON.stringify({ type: 'error', error: 'At least 2 players are required to start' }));
        }
      }
      else if (message.type === 'GAME_ACTION') {
        const client = [...CLIENTS.values()].find((item) => item.ws === ws);
        const room = client?.joinedRoom;
        if (!room) return;
        const action = String(message.params?.action || '').toUpperCase();
        if (!['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'].includes(action)) {
          return ws.send(JSON.stringify({ type: 'error', error: 'Invalid game action' }));
        }
        const amount = Math.max(0, Number(message.params?.amount || 0));
        await withRedisLock(`room:${room.roomCode}`, async () => {
          await restoreRoomSnapshot(room);
          if (room.phase === 'WAITING') return;
          if (String(room.currentTurn) !== String(client.clientId)) {
            ws.send(JSON.stringify({ type: 'error', error: 'It is not your turn' }));
            return;
          }
          performAction(room, client.clientId, action, amount);
        });
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: error.message || 'Invalid message' }));
    }
  });
  ws.on('close', () => { void leaveRoom(ws); });
  ws.on('error', () => { void leaveRoom(ws); });
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
