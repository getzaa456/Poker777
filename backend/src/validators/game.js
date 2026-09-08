import { z } from 'zod';

export const joinTableSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  roomCode: z.string().min(1, 'Room code is required'),
  buyIn: z.number().min(1, 'Buy-in must be at least 1')
});

export const webScoketConnectionSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required')
});