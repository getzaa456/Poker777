import { z } from 'zod';

// Username: 3-30 chars, alphanumeric + underscore + hyphen.
export const usernameSchema = z
  .string()
  .min(3, 'Username must be 3-30 characters')
  .max(30, 'Username must be 3-30 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Username may only contain letters, numbers, hyphen, underscore');

// Email: RFC-ish pragmatic.
export const emailSchema = z
  .string()
  .email('Invalid email format')
  .max(255, 'Email too long')
  .toLowerCase();

// Password: at least 8 chars. Hashed with bcrypt later.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long (max 128)');

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  // Allow login by username OR email in a single field.
  identifier: z.string().min(3, 'Identifier required').max(255),
  password: z.string().min(1, 'Password required'),
});

export const updateUserSchema = z.object({
  avatar_id: z.string().min(1).max(40).optional(),
  display_name: z.string().min(1).max(40).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'No updatable fields provided' });
