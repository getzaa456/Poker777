import { z } from 'zod';

export const topupSchema = z.object({
  amount: z.number().int('Amount must be an integer').positive('Amount must be > 0'),
});

export const adjustSchema = z.object({
  user_id: z.string().min(1, 'user_id required'),
  amount: z.number().int('Amount must be an integer'),   // positive = credit, negative = debit
  ref_id: z.string().min(1).max(60, 'ref_id max 60 chars'),
  type: z.enum(['SETTLE', 'BUYIN', 'TOPUP', 'BONUS']).default('SETTLE'),
});

export const transactionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
