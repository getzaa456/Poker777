import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { registerUser, loginUser } from '../services/auth.js';

export const router = Router();

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const result = await registerUser(req.body);
  res.status(201).json(result);
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const result = await loginUser(req.body);
  res.json(result);
}));
