import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { createTable, listOpenTables, getTableSummary, joinTable } from '../services/tables.js';
import { WebSocket, WebSocketServer } from 'ws';


const wss = new WebSocketServer({ noServer: true });

const messageTypes = {
  JOIN_TABLE: async (roomCode, userId, buyIn) => {
    const result = getTableSummary(roomCode);
    try {
      await joinTable(userId, roomCode, { buyIn });
      return { type: 'join-table', roomCode, userId, buyIn };
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
          return { type: 'error', error: condition.response };
        }
      }
    }
  }
}

wss.on('connection', (ws, request) => {
  console.log('WebSocket connection established');
  ws.send(JSON.stringify({ type: 'connection-established' }));
});

wss.on('message', (message) => {
  console.log('Received message:', message);
  // Handle incoming messages from clients here
  const parsedMessage = JSON.parse(message);
});

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
