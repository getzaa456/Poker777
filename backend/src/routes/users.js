import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getUserProfile, updateUserProfile } from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';

export const router = Router();

// All /users/* routes require a valid JWT.
router.use(requireAuth);

router.get('/me', asyncHandler(async (req, res) => {
  const user = await getUserProfile(req.user.id);
  res.json({ user });
}));

router.patch('/me', asyncHandler(async (req, res) => {
  const user = await updateUserProfile(req.user.id, req.body);
  res.json({ user });
}));
