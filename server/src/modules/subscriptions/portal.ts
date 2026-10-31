import { Router } from 'express';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { customerIdFor, requireCustomerAccount } from '../../middleware/auth.js';
import { pageSchema, amounts } from './validation.js';
import { transitionSubscription, renewalSchema, renewSubscription } from './lifecycle.js';

const summarySelect = { id: true, number: true, status: true, startDate: true, expiryDate: true,
  billingInterval: true, nextBillingDate: true, createdAt: true, plan: { select: { name: true } } } as const;
const portalSelect = { ...summarySelect, paymentTermDays: true, quotationValidUntil: true,
  pausedAt: true, closedAt: true,
  plan: { select: { name: true, allowPause: true, allowEarlyClose: true, allowRenew: true, autoClose: true } },
  lines: { orderBy: { id: 'asc' as const }, select: { id: true, description: true, quantity: true, unitPriceMinor: true, taxRateBps: true } },
} satisfies Prisma.SubscriptionSelect;
type PortalSource = Prisma.SubscriptionGetPayload<{ select: typeof portalSelect }>;
// Whitelist again for mutation responses, which originate in the staff service.
// Do not serialize customer records, catalog costs, internal relations or user data.
function portalResult(source: PortalSource) {
  const { id, number, status, startDate, expiryDate, billingInterval, nextBillingDate, createdAt,
    paymentTermDays, quotationValidUntil, pausedAt, closedAt } = source;
  const { name, allowPause, allowEarlyClose, allowRenew, autoClose } = source.plan;
  const lines = source.lines.map(({ id, description, quantity, unitPriceMinor, taxRateBps }) => ({ id, description, quantity, unitPriceMinor, taxRateBps }));
  return { id, number, status, startDate, expiryDate, billingInterval, nextBillingDate, createdAt,
    paymentTermDays, quotationValidUntil, pausedAt, closedAt,
    plan: { name, allowPause, allowEarlyClose, allowRenew, autoClose }, ...amounts(lines) };
}
async function customerAction<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof HttpError && error.code === 'BILLING_PENDING') throw new HttpError(409, error.code, 'Please contact support to process outstanding billing before changing this subscription.');
    throw error;
  }
}
export const subscriptionPortalRouter = Router();
subscriptionPortalRouter.use(requireCustomerAccount);
subscriptionPortalRouter.get('/', asyncRoute(async (req, res) => {
  const customerId = customerIdFor(req);
  const { page, pageSize, search, status } = pageSchema.extend({ status: z.enum(SubscriptionStatus).optional() }).strict().parse(req.query);
  const where: Prisma.SubscriptionWhereInput = { customerId, status,
    ...(search ? { OR: [{ number: { contains: search } }, { plan: { name: { contains: search } } }] } : {}) };
  const [total, items] = await db.$transaction([
    db.subscription.count({ where }),
    db.subscription.findMany({ where, select: summarySelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ data: { items, total, page, pageSize } });
}));
subscriptionPortalRouter.get('/:id', asyncRoute(async (req, res) => {
  const source = await db.subscription.findFirst({ where: { id: req.params.id, customerId: customerIdFor(req) }, select: portalSelect });
  if (!source) throw new HttpError(404, 'NOT_FOUND', 'Subscription not found');
  res.json({ data: portalResult(source) });
}));
subscriptionPortalRouter.post('/:id/transition', asyncRoute(async (req, res) => {
  const customerId = customerIdFor(req);
  const input = z.object({ action: z.enum(['PAUSED', 'RESUME', 'CLOSED']) }).strict().parse(req.body);
  const source = await customerAction(() => transitionSubscription(req.params.id, input, new Date(), customerId));
  res.json({ data: portalResult(source) });
}));
subscriptionPortalRouter.post('/:id/renew', asyncRoute(async (req, res) => {
  const customerId = customerIdFor(req);
  const input = renewalSchema.parse(req.body);
  const source = await customerAction(() => renewSubscription(req.params.id, input, new Date(), customerId));
  res.status(201).json({ data: portalResult(source) });
}));
