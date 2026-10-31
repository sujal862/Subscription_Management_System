import { z } from 'zod';

export const emailSchema = z.string().trim().max(254).email('Enter a valid email address')
  .transform(value => value.toLowerCase());

export const passwordSchema = z.string()
  .min(9, 'Password must contain at least 9 characters')
  .max(128, 'Password must contain at most 128 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[^A-Za-z0-9\s]/, 'Password must include a special character');

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(100),
  email: emailSchema,
  password: passwordSchema,
}).strict();

export const loginSchema = z.object({
  email: emailSchema,
  // Do not trim or change a password when verifying it.
  password: z.string().min(1, 'Enter your password').max(128),
}).strict();
