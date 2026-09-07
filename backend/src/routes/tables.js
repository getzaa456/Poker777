import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { createTable, listOpenTables, getTableSummary, joinTable } from '../services/tables.js';

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
