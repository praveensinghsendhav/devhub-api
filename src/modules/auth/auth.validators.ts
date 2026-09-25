import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  deviceName: z.string().trim().max(120).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const updateStatusSchema = z.object({
  status: z.enum(['online', 'away', 'busy', 'dnd', 'offline']),
  customStatus: z.string().trim().max(120).nullable().optional(),
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
