import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { createTable, listOpenTables, getTableSummary, joinTable } from '../services/tables.js';
import { WebSocket, WebSocketServer } from 'ws';
import { joinTableSchema } from '../validators/game.js';
import { validate } from '../middleware/validate.js';

class Room {
  constructor(roomCode, roomId, minBet, maxBet, maxPlayer, host) {
    this.roomCode = roomCode;
    this.host  = host; //Room head client
    this.roomId = roomId;
    this.minBet = minBet;
    this.maxBet = maxBet;
    this.maxPlayer = maxPlayer;
    this.currentPlayers = [];
    this.status = 'OPEN';
  }

  broadcast(message) {
    this.currentPlayers.forEach(player => {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(message));
      }
    });
  }
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

function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  async function joinRoom(params, ws) {
    try {
        joinTableSchema.parse(params)
        const {roomCode, clientId, buyIn} = params;
        let room;
        let client;
        if (!ROOMS.has(roomCode)) {
          ws.send(JSON.stringify({ type: 'error', error: "Room not found" }));
          return;
        }
        room = ROOMS.get(roomCode);
        client = CLIENTS.get(clientId);
        if (!client) {
          client = new Client(clientId, ws);
          CLIENTS.set(clientId, client);
        }
        if (client.joinedRoom) {
          ws.send(JSON.stringify({ type: 'error', error: "Client already joined a room" }));
          return;
        }
        if (room.status !== 'OPEN') {
          ws.send(JSON.stringify({ type: 'error', error: "Room is not open for joining" }));
          return;
        }
        client.currentMoney = buyIn;
        client.joinedRoom = roomCode;
        room.currentPlayers.push(client);
        const result = await joinTable(clientId, roomCode, { buyIn } );
        const response = {
          type: "join",
          params: {
              success: true,
              roomId: result.id,
              roomName: result.name,
              playerNum: result.seats_taken,
              maxPlayer: result.seats_available,
              currentPlayers: room.currentPlayers.map(p => ({ clientId: p.clientId, username: p.username, money: p.currentMoney }))
          }
        }
        room.broadcast({
          type: "player-joined",
          params: {
            clientId: client.clientId,
            playerNum: result.seats_taken,
            currentPlayers: room.currentPlayers.map(p => ({ clientId: p.clientId, username: p.username, money: p.currentMoney }))
          }
        });
        ws.send(JSON.stringify(response));
        if (result.seats_taken === result.seats_available) {
          room.status = 'IN_PROGRESS';
          room.broadcast({
            type: "start-game",
            params: {}
          });
        }
      }
      catch (error) {
        // Change to using mapping for better time complexity linear -> constant
        const errorResponse = [
          {message: "IN_PROGRESS", response: "Table is already in progress"}, 
          {message: "ROOM_CLOSED", response: "Table is closed"},
          {message: "ROOM_FULL", response: "Table is full"},
          {message: "BUY_IN_TOO_LOW", response: "Buy-in is too low"},
          {message: "BUY_IN_TOO_HIGH", response: "Buy-in is too high"},
          {message: "INSUFFICIENT_BALANCE", response: "Insufficient balance"}
        ];
        for (const condition of errorResponse) {
          if (error.message === condition.message) {
            ws.send(JSON.stringify({ type: 'error', error: condition.response }));
            return;
          }
        }
        console.error('Error in joinRoom:', error);
        ws.send(JSON.stringify({ type: 'error', error: "An unexpected error occurred" }));
      }
  }

  const messageTypes = {
    "join": joinRoom,
  }

  wss.on('connection', (ws) => {

    ws.send(JSON.stringify({ type: 'connection', message: 'WebSocket connection established'   }));

    ws.on('message', (raw) => {
      console.log('Received message:', raw.toString());
      try{
      const message = JSON.parse(raw.toString());
      if (!messageTypes[message.type] || message.params === undefined) {
        console.error('Unknown message type:', message.type);
        return;
      }
        messageTypes[message.type](message.params, ws)
      }
      catch (error) {
        console.error('Error parsing message:', error);
        return;
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });

  });
}

export { createWebSocketServer, Room, Client };
export const router = Router();

// All /tables/* routes require a valid JWT.
router.use(requireAuth);

// GET /tables -> list all open rooms.
router.get('/', asyncHandler(async (req, res) => {
  const tables = await listOpenTables();
  res.json({ tables });
}));

// POST /tables -> create a room, returns the room_code for the waiting-room screen.
router.post('/', asyncHandler(async (req, res) => {
  const table = await createTable(req.user.id, req.body);
  ROOMS.set(table.room_code, new Room(table.room_code, table.room_id, table.min_bet, table.max_bet, table.max_player, table.host_id)); // NOTE: Fix this later (JAPAN)
  res.status(201).json({ table });
}));

// GET /tables/:room_code -> waiting-room / join-preview info (name, blinds, seats, status).
router.get('/:room_code', asyncHandler(async (req, res) => {
  const table = await getTableSummary(req.params.room_code);
  res.json({ table });
}));

// POST /tables/:room_code/join -> validate the join (room exists/open/not full, balance covers buy-in).
router.post('/:room_code/join', asyncHandler(async (req, res) => {
  const table = await joinTable(req.user.id, req.params.room_code, req.body);
  res.json({ table });
}));
