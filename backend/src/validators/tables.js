import { z } from 'zod';

// Room code: matches `tables.room_code` CHAR(6) — letters + digits, case-insensitive
// on input but always normalized to uppercase (how we generate + store it).
export const roomCodeSchema = z
  .string()
  .trim()
  .min(1, 'Room code is required')
  .length(6, 'Room code must be 6 characters')
  .regex(/^[A-Za-z0-9]+$/, 'Room code may only contain letters and numbers')
  .transform((s) => s.toUpperCase());

// Table settings a host picks when creating a room — mirrors the `tables`
// columns (name, min_bet, max_bet, max_seats) so the API and the DB schema
// never drift apart.
export const createTableSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Table name is required')
      .max(60, 'Table name must be at most 60 characters'),
    min_bet: z.coerce
      .number()
      .int('Min bet must be a whole number')
      .positive('Min bet must be greater than 0')
      .max(1_000_000, 'Min bet is too large')
      .default(10),
    max_bet: z.coerce
      .number()
      .int('Max bet must be a whole number')
      .positive('Max bet must be greater than 0')
      .max(1_000_000, 'Max bet is too large')
      .default(1000),
    max_seats: z.coerce
      .number()
      .int('Max seats must be a whole number')
      .min(2, 'A table needs at least 2 seats')
      .max(9, 'A table can have at most 9 seats')
      .default(6),
  })
  .refine((v) => v.max_bet >= v.min_bet, {
    message: 'Max bet must be greater than or equal to min bet',
    path: ['max_bet'],
  });

// Optional buy-in amount when joining; if omitted the service falls back to
// the table's min_bet.
export const joinTableSchema = z.object({
  buy_in: z.coerce
    .number()
    .int('Buy-in must be a whole number')
    .positive('Buy-in must be greater than 0')
    .max(1_000_000, 'Buy-in is too large')
    .optional(),
});
