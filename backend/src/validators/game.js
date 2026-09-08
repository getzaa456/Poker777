import { z } from 'zod';

export const joinTableSchema = z.object({
  type: z.string().min(1, 'Type is required'),
  client_id: z.string().min(1, 'Client ID is required'),
  room_code: z.string().min(1, 'Room code is required'),
  buy_in: z.number().min(1, 'Buy-in must be at least 1')
});

export const webScoketConnectionSchema = z.object({
  type: z.string().min(1, 'Type is required'),
  client_id: z.string().min(1, 'Client ID is required')
});