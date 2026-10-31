import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { db } from './lib/db.js';
import { HttpError, asyncRoute } from './lib/http.js';
import { requireAuth } from './middleware/auth.js';
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
app.use(express.json({ limit: '100kb' }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/health', asyncRoute(async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ data: { status: 'ok', database: 'connected', time: new Date().toISOString() } });
}));
app.use('/api/auth', authRouter);
// These gates intentionally return 501 until Member 1 implements authentication.
// Module owners may test their routers in isolation; do not bypass the shared gates.
app.use('/api/staff', requireAuth, staffRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/catalog', requireAuth, catalogRouter);
app.use('/api/subscriptions', requireAuth, subscriptionsRouter);
app.use('/api/billing', requireAuth, billingRouter);
app.use('/api/portal', requireAuth, portalRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'API route not found')));
const clientDirectory = path.resolve('dist/client');
if (config.production && existsSync(clientDirectory)) {
  app.use(express.static(clientDirectory));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDirectory, 'index.html')));
}
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.issues } });
  if (error instanceof HttpError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error instanceof SyntaxError && 'body' in error) return void res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
  console.error(error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
};
app.use(errorHandler);
