import { Router } from 'express';

export const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'poker777-core-api',
    time: new Date().toISOString(),
  });
});
