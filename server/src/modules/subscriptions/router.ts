import { Router } from 'express';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
export { subscriptionPortalRouter } from './portal.js';
import { draftSchema, customerSchema, pageSchema, amounts } from './validation.js';
import { templatesRouter, quotationSchema, createQuotation } from './quotations.js';
import { lifecycleInclude, lifecycleTransitionSchema, transitionSubscription, renewalSchema, renewSubscription, processSubscriptionLifecycle } from './lifecycle.js';
import { startSubscriptionLifecycleScheduler } from './scheduler.js';

const missing = (name: string): never => { throw new HttpError(404, 'NOT_FOUND', `${name} not found`); };
const invalid = (message: string): never => { throw new HttpError(400, 'VALIDATION_ERROR', message); };
const customerInclude = { _count: { select: { subscriptions: true } } } as const;
const detailInclude = lifecycleInclude;

// Isolated tests mount these handlers. Production always applies the shared auth
// gate in app.ts and the role gate on subscriptionsRouter below.
export function createSubscriptionHandlers() {
  const router = Router();
  router.get('/customers', asyncRoute(async (req, res) => {
    const { page, pageSize, search } = pageSchema.parse(req.query);
    const where: Prisma.CustomerWhereInput = search ? { OR: ['name', 'email', 'company', 'phone'].map(key => ({ [key]: { contains: search } })) } : {};
    const [total, items] = await db.$transaction([
      db.customer.count({ where }),
      db.customer.findMany({ where, include: customerInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ data: { items, page, pageSize, total } });
  }));
  router.post('/customers', asyncRoute(async (req, res) => {
    const data = customerSchema.parse(req.body);
    if ((await db.$queryRaw<{ id: string }[]>`SELECT id FROM Customer WHERE lower(email) = ${data.email} LIMIT 1`).length) throw new HttpError(409, 'CONFLICT', 'A customer with this email already exists');
    try { res.status(201).json({ data: await db.customer.create({ data, include: customerInclude }) }); }
    catch (error) { customerConflict(error); }
  }));
  router.get('/customers/:id', asyncRoute(async (req, res) => {
    res.json({ data: await db.customer.findUnique({ where: { id: req.params.id }, include: customerInclude }) ?? missing('Customer') });
  }));
  router.patch('/customers/:id', asyncRoute(async (req, res) => {
    const data = customerSchema.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one field').parse(req.body);
    if (!await db.customer.findUnique({ where: { id: req.params.id } })) missing('Customer');
    if (data.email && (await db.$queryRaw<{ id: string }[]>`SELECT id FROM Customer WHERE lower(email) = ${data.email} AND id != ${req.params.id} LIMIT 1`).length) throw new HttpError(409, 'CONFLICT', 'A customer with this email already exists');
    try { res.json({ data: await db.customer.update({ where: { id: req.params.id }, data, include: customerInclude }) }); }
    catch (error) { customerConflict(error); }
  }));
  router.use('/templates', templatesRouter);
  router.post('/process-lifecycle', asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.json({ data: await processSubscriptionLifecycle() });
  }));
  router.get('/', asyncRoute(async (req, res) => {
    const { page, pageSize, search, status, customerId } = pageSchema.extend({ status: z.enum(SubscriptionStatus).optional(), customerId: z.string().min(1).optional() }).parse(req.query);
    const where: Prisma.SubscriptionWhereInput = { status, customerId, ...(search ? { OR: [{ number: { contains: search } }, { customer: { name: { contains: search } } }, { plan: { name: { contains: search } } }] } : {}) };
    const [total, items] = await db.$transaction([
      db.subscription.count({ where }),
      db.subscription.findMany({ where, select: { id: true, number: true, status: true, startDate: true, expiryDate: true, createdAt: true, customer: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ data: { items, page, pageSize, total } });
  }));
  router.post('/', asyncRoute(async (req, res) => {
    if (req.body && typeof req.body === 'object' && 'templateId' in req.body) {
      const data = await createQuotation(quotationSchema.parse(req.body));
      return void res.status(201).json({ data });
    }
    const input = draftSchema.parse(req.body);
    const data = await db.$transaction(async tx => {
      if (!await tx.customer.findUnique({ where: { id: input.customerId } })) missing('Customer');
      const plan = await tx.plan.findUnique({ where: { id: input.planId }, include: { product: true } }) ?? missing('Plan');
      const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
      if (!plan.isActive || !plan.product.isActive) invalid('The plan and its product must be active');
      if ((plan.availableFrom && startDate < plan.availableFrom) || (plan.availableUntil && startDate > plan.availableUntil)) invalid('Plan is unavailable on the selected start date');
      if (input.lines[0].productId !== plan.productId) invalid('The first line must be the plan product');
      if (input.lines[0].quantity < plan.minimumQuantity) invalid(`The primary line requires at least ${plan.minimumQuantity} units`);
      const products = await tx.product.findMany({ where: { id: { in: input.lines.map(line => line.productId) } }, include: { variants: true } });
      const taxes = await tx.taxRule.findMany({ where: { id: { in: input.lines.flatMap(line => line.taxRuleId ? [line.taxRuleId] : []) } } });
      const lines = input.lines.map((line, index) => {
        const product = products.find(p => p.id === line.productId);
        if (!product?.isActive) return invalid('Each product must exist and be active');
        const variant = line.variantId ? product.variants.find(v => v.id === line.variantId && v.isActive) : undefined;
        if (line.variantId && !variant) invalid('Variant must be active and belong to the selected product');
        const unitPriceMinor = (index === 0 ? plan.priceMinor : product.salesPriceMinor) + (variant?.priceAdjustmentMinor ?? 0);
        if (unitPriceMinor < 0 || unitPriceMinor > 2147483647) invalid('Catalog price is out of range');
        // No role-specific override policy is defined in the shared contract yet.
        if (line.unitPriceMinor !== undefined && line.unitPriceMinor !== unitPriceMinor) invalid('Price overrides are unavailable; use the current catalog price');
        const tax = line.taxRuleId ? taxes.find(t => t.id === line.taxRuleId && t.isActive) : undefined;
        if (line.taxRuleId && !tax) invalid('Tax rule must exist and be active');
        if (tax && (tax.rateBps < 0 || tax.rateBps > 10000)) invalid('Invalid catalog tax rate');
        return { productId: product.id, variantId: variant?.id ?? null, quantity: line.quantity, unitPriceMinor, taxRuleId: tax?.id ?? null, taxRateBps: tax?.rateBps ?? 0, description: `${product.name}${variant ? ` — ${variant.name}` : ''}` };
      });
      amounts(lines);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await tx.subscription.create({ data: {
            number: `SUB-${new Date().getUTCFullYear()}-${randomBytes(8).toString('hex').toUpperCase()}`,
            customerId: input.customerId, planId: input.planId, status: 'DRAFT', startDate,
            expiryDate: input.expiryDate ? new Date(`${input.expiryDate}T00:00:00.000Z`) : null,
            paymentTermDays: input.paymentTermDays, billingInterval: plan.interval, lines: { create: lines },
          }, include: detailInclude });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        }
      }
      throw new HttpError(409, 'CONFLICT', 'Could not allocate a subscription number; please retry');
    });
    res.status(201).json({ data: { ...data, ...amounts(data.lines) } });
  }));
  router.post('/:id/transition', asyncRoute(async (req, res) => {
    const input = lifecycleTransitionSchema.parse(req.body);
    res.json({ data: await transitionSubscription(req.params.id, input) });
  }));
  router.post('/:id/renew', asyncRoute(async (req, res) => {
    res.status(201).json({ data: await renewSubscription(req.params.id, renewalSchema.parse(req.body)) });
  }));
  router.get('/:id', asyncRoute(async (req, res) => {
    const data = await db.subscription.findUnique({ where: { id: req.params.id }, include: detailInclude }) ?? missing('Subscription');
    res.json({ data: { ...data, ...amounts(data.lines) } });
  }));
  return router;
}
function customerConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') throw new HttpError(409, 'CONFLICT', 'A customer with this email already exists');
    if (error.code === 'P2025') missing('Customer');
  }
  throw error;
}
export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireRole('ADMIN', 'STAFF'), createSubscriptionHandlers());
if (process.env.NODE_ENV !== 'test') startSubscriptionLifecycleScheduler();
