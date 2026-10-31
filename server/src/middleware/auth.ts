import type { RequestHandler } from 'express';
import type { Role } from '../../../shared/contracts.js';
import { db } from '../lib/db.js';
import { config } from '../lib/config.js';
import { asyncRoute, HttpError } from '../lib/http.js';
import { readSessionToken, hashSessionToken, publicUser, clearSessionCookie } from '../modules/auth/session.js';

export const requireAuth = asyncRoute(async (req, res, next) => {
  const token = readSessionToken(req.cookies?.[config.cookieName]);
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) }, include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
    clearSessionCookie(res);
    throw new HttpError(401, 'UNAUTHENTICATED', 'Your session is invalid or expired');
  }
  req.user = publicUser(session.user);
  next();
});

export const requireRole = (...allowed: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in'));
  if (!allowed.includes(req.user.role)) return next(new HttpError(403, 'FORBIDDEN', 'You do not have access to this action'));
  next();
};
