import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { pendingRouter } from '../../lib/pending-router.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { listInvoices, getInvoiceById } from './service.js';
import { calculateInvoice, type LineCalculationInput } from './calculation.js';
import { db } from '../../lib/db.js';
import type { InvoiceStatus } from '@prisma/client';

export const billingRouter = Router();

// Middleware: ensure caller is STAFF or ADMIN if authenticated
export const requireStaffOrAdmin: RequestHandler = (req, _res, next) => {
  const user = (req as unknown as { user?: { role?: string } }).user;
  if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') {
    return next(new HttpError(403, 'FORBIDDEN', 'Staff or Admin role required'));
  }
  next();
};

billingRouter.use(requireStaffOrAdmin);

const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED'] as const).optional(),
  customerId: z.string().optional(),
});

// GET /api/billing/invoices - Paginated invoice list with search/filters
billingRouter.get('/invoices', asyncRoute(async (req, res) => {
  const query = listInvoicesQuerySchema.parse(req.query);
  const result = await listInvoices({
    page: query.page,
    pageSize: query.pageSize,
    status: query.status as InvoiceStatus | undefined,
    customerId: query.customerId,
  });

  res.json({ data: result });
}));

// GET /api/billing/invoices/:id - Detailed invoice view with snapshots and lines
billingRouter.get('/invoices/:id', asyncRoute(async (req, res) => {
  const invoice = await getInvoiceById(req.params.id);
  res.json({ data: invoice });
}));

const previewInvoiceSchema = z.object({
  subscriptionId: z.string().min(1),
});

// POST /api/billing/invoices/preview - Read actual subscription lines & preview calculated invoice
billingRouter.post('/invoices/preview', asyncRoute(async (req, res) => {
  const { subscriptionId } = previewInvoiceSchema.parse(req.body);

  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: { lines: true, customer: true },
  });

  if (!subscription) {
    throw new HttpError(404, 'NOT_FOUND', 'Subscription not found');
  }

  const inputs: LineCalculationInput[] = subscription.lines.map(line => ({
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    taxRateBps: line.taxRateBps,
    discountMinor: 0,
  }));

  const calculated = calculateInvoice(inputs);

  res.json({
    data: {
      subscriptionId: subscription.id,
      subscriptionNumber: subscription.number,
      customer: {
        name: subscription.customer.name,
        email: subscription.customer.email,
        address: subscription.customer.address,
      },
      ...calculated,
    },
  });
}));

// Member 4: Customer invoices portal will be implemented in Hour 5.
export const billingPortalRouter = pendingRouter('Customer invoices');
