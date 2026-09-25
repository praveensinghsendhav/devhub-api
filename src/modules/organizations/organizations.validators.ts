import { z } from 'zod';
import { INVITABLE_ROLES, ORGANIZATION_SIZES } from '../../shared/index.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(255);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const registerOrganizationSchema = z.object({
  organization: z.object({
    name: z.string().trim().min(2, 'Organization name is too short').max(120),
    website: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((value) => (value ? value : undefined))
      .pipe(z.string().url('Enter a valid website URL (https://…)').optional()),
    industry: optionalText(80),
    size: z.enum(ORGANIZATION_SIZES).optional(),
    country: optionalText(80),
  }),
  owner: z.object({
    name: z.string().trim().min(2, 'Enter your full name').max(120),
    email,
    password: passwordSchema,
  }),
  deviceName: z.string().trim().max(120).optional(),
});

export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema>;

export const createInvitesSchema = z.object({
  emails: z
    .array(email)
    .min(1, 'Add at least one email')
    .max(20, 'You can invite up to 20 people at once')
    .transform((list) => [...new Set(list)]),
  role: z.enum(INVITABLE_ROLES).default('MEMBER'),
});

export type CreateInvitesInput = z.infer<typeof createInvitesSchema>;

export const inviteIdSchema = z.string().uuid('Invalid invite id');

const inviteToken = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/, 'This invite link is invalid');

export const previewInviteSchema = z.object({ token: inviteToken });

export const acceptInviteSchema = z.object({
  token: inviteToken,
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  password: passwordSchema,
  deviceName: z.string().trim().max(120).optional(),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
