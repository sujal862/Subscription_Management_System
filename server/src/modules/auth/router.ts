import { Router } from 'express';
import { Prisma } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { signupSchema, loginSchema } from '../../../../shared/auth.js';
import { db } from '../../lib/db.js';
import { config } from '../../lib/config.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { hashPassword, verifyPassword, verifyUnknownPassword } from '../../lib/password.js';
import { requireAuth } from '../../middleware/auth.js';
import { newSession, publicUser, readSessionToken, hashSessionToken, setSessionCookie, clearSessionCookie } from './session.js';
import { pendingRouter } from '../../lib/pending-router.js';

export const authRouter = Router();
const attemptLimit = () => rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please try again later.' } },
});

authRouter.post('/signup', attemptLimit(), asyncRoute(async (req, res) => {
  const { name, email, password } = signupSchema.parse(req.body);
  const passwordHash = await hashPassword(password);
  const session = newSession();
  try {
    // One atomic nested write: an existing Customer email causes a conflict,
    // never an implicit link to someone else's subscriptions or invoices.
    const user = await db.user.create({ data: {
      name, email, passwordHash, role: 'CUSTOMER',
      customer: { create: { name, email } },
      sessions: { create: { tokenHash: session.tokenHash, expiresAt: session.expiresAt } },
    } });
    setSessionCookie(res, session.token);
    res.status(201).json({ data: publicUser(user) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'EMAIL_IN_USE', 'This email is already registered. Please sign in or contact your administrator.');
    }
    throw error;
  }
}));

authRouter.post('/login', attemptLimit(), asyncRoute(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await db.user.findUnique({ where: { email } });
  const matches = user ? await verifyPassword(password, user.passwordHash) : await verifyUnknownPassword(password);
  if (!user || !user.isActive || !matches) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  const session = newSession();
  const signedInUser = await db.$transaction(async tx => {
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.isActive || current.passwordHash !== user.passwordHash) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    await tx.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    return current;
  });
  // An incoming cookie is never reused as the newly authenticated session.
  setSessionCookie(res, session.token);
  res.json({ data: publicUser(signedInUser) });
}));

authRouter.get('/me', requireAuth, (req, res) => { res.json({ data: req.user }); });

authRouter.post('/logout', asyncRoute(async (req, res) => {
  const token = readSessionToken(req.cookies?.[config.cookieName]);
  if (token) await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  clearSessionCookie(res);
  res.json({ data: { message: 'Signed out' } });
}));

// Password-reset behavior remains assigned to Hour 4.
authRouter.post('/forgot-password', pendingRouter('Password reset'));
authRouter.post('/reset-password', pendingRouter('Password reset'));
