import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { createTable, listOpenTables, getTableSummary, joinTable } from '../services/tables.js';


export const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ tables: await listOpenTables() });
}));

router.post('/', asyncHandler(async (req, res) => {
  const table = await createTable(req.user.id, req.body);
  // ROOMS.set(table.room_code, new Room(table)); ย้ายไป handleTableUpgrade() ใน game.js 
  res.status(201).json({ table });
}));

router.get('/:room_code', asyncHandler(async (req, res) => {
  res.json({ table: await getTableSummary(req.params.room_code) });
}));

router.post('/:room_code/join', asyncHandler(async (req, res) => {
  res.json({ table: await joinTable(req.user.id, req.params.room_code, req.body) });
}));
