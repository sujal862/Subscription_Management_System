import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { pendingRouter } from '../../lib/pending-router.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import {
  listInvoices,
  getInvoiceById,
  confirmInvoice,
  cancelInvoice,
  recordPayment,
  listPaymentsForInvoice,
} from './service.js';
import { calculateInvoice, type LineCalculationInput } from './calculation.js';
import { runBillingCycle } from './recurring.js';
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
  overdue: z.preprocess(v => v === 'true' || v === true, z.boolean().optional()),
});

// GET /api/billing/invoices - Paginated invoice list with search/filters
billingRouter.get('/invoices', asyncRoute(async (req, res) => {
  const query = listInvoicesQuerySchema.parse(req.query);
  const result = await listInvoices({
    page: query.page,
    pageSize: query.pageSize,
    status: query.status as InvoiceStatus | undefined,
    customerId: query.customerId,
    overdue: query.overdue,
  });

  res.json({ data: result });
}));

// GET /api/billing/invoices/:id - Detailed invoice view with snapshots and lines
billingRouter.get('/invoices/:id', asyncRoute(async (req, res) => {
  const invoice = await getInvoiceById(req.params.id);
  res.json({ data: invoice });
}));

// POST /api/billing/invoices/:id/confirm - Transition invoice from DRAFT to CONFIRMED
billingRouter.post('/invoices/:id/confirm', asyncRoute(async (req, res) => {
  const invoice = await confirmInvoice(req.params.id);
  res.json({ data: invoice });
}));

// POST /api/billing/invoices/:id/cancel - Cancel invoice (blocks if payments exist)
billingRouter.post('/invoices/:id/cancel', asyncRoute(async (req, res) => {
  const invoice = await cancelInvoice(req.params.id);
  res.json({ data: invoice });
}));

const recordPaymentSchema = z.object({
  method: z.string().trim().min(1, 'Payment method is required').max(50),
  amountMinor: z.number().int().positive('Payment amount must be a positive integer in paise').max(2147483647),
  paidAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().max(2000).optional(),
  reference: z.string().max(200).optional(),
}).strict();

// GET /api/billing/invoices/:id/payments - List recorded payments for invoice
billingRouter.get('/invoices/:id/payments', asyncRoute(async (req, res) => {
  const result = await listPaymentsForInvoice(req.params.id);
  res.json({ data: result });
}));

// POST /api/billing/invoices/:id/payments - Record a payment against an invoice
billingRouter.post('/invoices/:id/payments', asyncRoute(async (req, res) => {
  const body = recordPaymentSchema.parse(req.body);
  const paidAt = body.paidAt ? new Date(body.paidAt) : undefined;
  const result = await recordPayment(req.params.id, {
    method: body.method,
    amountMinor: body.amountMinor,
    paidAt,
    note: body.note,
    reference: body.reference,
  });

  res.status(201).json({ data: result });
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

const runBillingCycleSchema = z.object({
  targetDate: z.iso.datetime({ offset: true }).optional(),
  subscriptionId: z.string().min(1).max(100).optional(),
  maxCatchUpCycles: z.number().int().positive().max(100).optional(),
}).strict();

// POST /api/billing/run - Execute recurring billing cycle for due active subscriptions
billingRouter.post('/run', asyncRoute(async (req, res) => {
  const body = runBillingCycleSchema.parse(req.body || {});
  const targetDate = body.targetDate ? new Date(body.targetDate) : new Date();
  const result = await runBillingCycle({
    targetDate,
    subscriptionId: body.subscriptionId,
    maxCatchUpCycles: body.maxCatchUpCycles,
  });

  res.json({ data: { ...result, errors: result.errors.map(error => ({
    subscriptionId: error.subscriptionId, subscriptionNumber: error.subscriptionNumber,
    error: 'Billing could not complete for this subscription. Check its configuration and retry.',
  })) } });
}));

// Member 4: Customer invoices portal will be implemented in Hour 5.
export const billingPortalRouter = pendingRouter('Customer invoices');
