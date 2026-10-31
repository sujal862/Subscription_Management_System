import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { config } from './lib/config.js';
import { db } from './lib/db.js';
import { HttpError, asyncRoute } from './lib/http.js';
import { requireAuth, requireRole, requireCustomerAccount } from './middleware/auth.js';
import { requireSafeOrigin } from './middleware/origin.js';
import { authRouter } from './modules/auth/router.js';
import { staffRouter } from './modules/staff/router.js';
import { dashboardRouter } from './modules/dashboard/router.js';
import { catalogRouter } from './modules/catalog/router.js';
import { subscriptionsRouter } from './modules/subscriptions/router.js';
import { billingRouter } from './modules/billing/router.js';
import { portalRouter } from './modules/portal/router.js';
import type { ErrorRequestHandler } from 'express';
export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', requireSafeOrigin);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.get('/api/health', asyncRoute(async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ data: { status: 'ok', database: 'connected', time: new Date().toISOString() } });
}));
app.use('/api/auth', authRouter);
// Each module must also enforce its operation-specific rules and customer scope.
app.use('/api/staff', requireAuth, requireRole('ADMIN'), staffRouter);
app.use('/api/dashboard', requireAuth, requireRole('ADMIN', 'STAFF'), dashboardRouter);
app.use('/api/catalog', requireAuth, requireRole('ADMIN', 'STAFF'), catalogRouter);
app.use('/api/subscriptions', requireAuth, requireRole('ADMIN', 'STAFF'), subscriptionsRouter);
app.use('/api/billing', requireAuth, requireRole('ADMIN', 'STAFF'), billingRouter);
app.use('/api/portal', requireAuth, requireCustomerAccount, portalRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'API route not found')));
const clientDirectory = path.resolve('dist/client');
if (config.production && existsSync(clientDirectory)) {
  app.use(express.static(clientDirectory));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDirectory, 'index.html')));
}
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.issues } });
  if (error instanceof HttpError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return void res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with those details already exists.' } });
    if (['P2025', 'P2034', 'P1008'].includes(error.code)) return void res.status(409).json({ error: { code: 'RETRY_OPERATION', message: 'The record changed or another operation is in progress. Refresh and retry.' } });
    if (error.code === 'P2003') return void res.status(409).json({ error: { code: 'RECORD_REFERENCED', message: 'This record is referenced by other data and cannot be removed.' } });
  }
  if (error instanceof SyntaxError && 'body' in error) return void res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
  if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  console.error(error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
};
app.use(errorHandler);
