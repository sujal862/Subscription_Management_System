import { Router } from 'express';
import { asyncRoute } from '../../lib/http.js';
import { dashboardFilterSchema, overdueQuerySchema, dashboardSummary, overdueInvoices } from './service.js';

export const dashboardRouter = Router();
dashboardRouter.get('/summary', asyncRoute(async (req, res) => {
  res.json({ data: await dashboardSummary(dashboardFilterSchema.parse(req.query)) });
}));
dashboardRouter.get('/overdue', asyncRoute(async (req, res) => {
  res.json({ data: await overdueInvoices(overdueQuerySchema.parse(req.query)) });
}));
