import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import type { User } from '@prisma/client';
import type { PublicUser } from '../../../../shared/contracts.js';
import { config } from '../../lib/config.js';

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function newSession() {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + SESSION_DURATION_MS) };
}
export function sessionCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
}
export function setSessionCookie(res: Response, token: string) {
  res.cookie(config.cookieName, token, { ...sessionCookieOptions(), maxAge: SESSION_DURATION_MS });
}
export function clearSessionCookie(res: Response) { res.clearCookie(config.cookieName, sessionCookieOptions()); }
export function readSessionToken(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function publicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role, customerId: user.customerId };
}
