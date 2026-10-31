import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/http.js';
import { amounts, draftSchema } from './validation.js';
import { quoteDraft } from './quotations.js';

export const lifecycleInclude = {
  customer: true,
  plan: { select: { id: true, name: true, productId: true, minimumQuantity: true, interval: true,
    isActive: true, availableFrom: true, availableUntil: true, allowPause: true,
    allowEarlyClose: true, allowRenew: true, autoClose: true, product: { select: { isActive: true } } } },
  lines: { orderBy: { id: 'asc' as const } },
} satisfies Prisma.SubscriptionInclude;
type Subscription = Prisma.SubscriptionGetPayload<{ include: typeof lifecycleInclude }>;
type Transaction = Prisma.TransactionClient;
export const lifecycleTransitionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('QUOTATION'), validDays: z.number().int().min(1).max(365).default(14) }).strict(),
  z.object({ action: z.enum(['CONFIRMED', 'ACTIVE', 'PAUSED', 'RESUME', 'CLOSED']) }).strict(),
]);
export const renewalSchema = z.object({
  startDate: draftSchema.shape.startDate,
  expiryDate: draftSchema.shape.startDate,
}).strict().refine(value => value.expiryDate > value.startDate, { path: ['expiryDate'], message: 'Renewal expiry must follow its start date' });
const invalid = (message: string): never => { throw new HttpError(400, 'VALIDATION_ERROR', message); };
const conflict = (message: string, code = 'INVALID_TRANSITION'): never => { throw new HttpError(409, code, message); };
const denied = (message: string): never => { throw new HttpError(403, 'PLAN_ACTION_DENIED', message); };
const utcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const lifecycleResult = (subscription: Subscription) => ({ ...subscription, ...amounts(subscription.lines) });
async function load(tx: Transaction, id: string, customerId?: string) {
  const subscription = await tx.subscription.findFirst({ where: { id, ...(customerId ? { customerId } : {}) }, include: lifecycleInclude });
  if (!subscription) throw new HttpError(404, 'NOT_FOUND', 'Subscription not found');
  return subscription;
}

function validateTerm(subscription: Subscription, now: Date, requireQuotation = false, allowExpiredCatchUp = false) {
  const { plan, startDate, expiryDate, lines } = subscription;
  if (!plan.isActive || !plan.product.isActive) invalid('The plan and its primary product must be active');
  if ((plan.availableFrom && startDate < plan.availableFrom) || (plan.availableUntil && startDate > plan.availableUntil)) invalid('The plan is unavailable on the subscription start date');
  if (expiryDate && (expiryDate <= startDate || (!allowExpiredCatchUp && expiryDate <= now))) invalid('The subscription term has expired or has invalid date ordering');
  const primary = lines.find(line => line.productId === plan.productId);
  if (!primary || primary.quantity < plan.minimumQuantity) invalid('The primary product must satisfy the plan minimum quantity');
  if (!lines.length || lines.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || !Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0 || !Number.isInteger(line.taxRateBps) || line.taxRateBps < 0 || line.taxRateBps > 10000)) invalid('Subscription lines contain invalid quantities or amounts');
  amounts(lines);
  if (requireQuotation && (!subscription.quotationValidUntil || subscription.quotationValidUntil <= now)) conflict('The quotation has expired; prepare a new quotation', 'QUOTATION_EXPIRED');
}

// Stop only after all period STARTS before the boundary have been processed by
// Member 4. Expiry is exclusive, matching billing/recurring.ts. Never move its cursor.
function requireBillingCaughtUp(subscription: Subscription, boundary: Date) {
  if (subscription.status !== 'ACTIVE') return;
  const cutoff = subscription.expiryDate && subscription.expiryDate < boundary ? subscription.expiryDate : boundary;
  const exclusive = subscription.expiryDate && subscription.expiryDate <= boundary;
  if (!subscription.nextBillingDate || subscription.nextBillingDate < cutoff || (!exclusive && subscription.nextBillingDate.getTime() === cutoff.getTime())) conflict('Run billing for the outstanding periods before pausing or closing this subscription', 'BILLING_PENDING');
}
async function update(tx: Transaction, old: Subscription, data: Prisma.SubscriptionUpdateManyMutationInput) {
  const changed = await tx.subscription.updateMany({ where: { id: old.id, customerId: old.customerId, status: old.status, updatedAt: old.updatedAt }, data });
  if (changed.count !== 1) conflict('Subscription changed; refresh and retry', 'STALE_SUBSCRIPTION');
  return lifecycleResult(await load(tx, old.id, old.customerId));
}

export async function transitionSubscription(id: string, input: z.infer<typeof lifecycleTransitionSchema>, now = new Date(), customerId?: string) {
  if (customerId && !['PAUSED', 'RESUME', 'CLOSED'].includes(input.action)) denied('This customer action is not permitted');
  if (input.action === 'QUOTATION') return quoteDraft(id, input.validDays);
  return db.$transaction(async tx => {
    const subscription = await load(tx, id, customerId);
    switch (input.action) {
      case 'CONFIRMED':
        if (subscription.status !== 'QUOTATION') conflict('Only a quotation can be confirmed');
        validateTerm(subscription, now, true);
        return update(tx, subscription, { status: 'CONFIRMED' });
      case 'ACTIVE':
        if (subscription.status !== 'CONFIRMED') conflict('Only a confirmed subscription can be activated');
        // A previously confirmed term may have elapsed during downtime. Activate
        // it for bounded billing catch-up; expiry closure still waits for its cursor.
        validateTerm(subscription, now, false, true);
        if (subscription.startDate > now) conflict('This subscription cannot activate before its start date', 'NOT_DUE');
        return update(tx, subscription, { status: 'ACTIVE', nextBillingDate: subscription.startDate,
          billingAnchorDay: subscription.startDate.getUTCDate(), pausedAt: null, closedAt: null });
      case 'PAUSED':
        if (subscription.status !== 'ACTIVE') conflict('Only an active subscription can be paused');
        if (!subscription.plan.allowPause) denied('This plan does not allow pausing');
        if (subscription.expiryDate && subscription.expiryDate <= now) conflict('An expired subscription cannot be paused');
        requireBillingCaughtUp(subscription, now);
        return update(tx, subscription, { status: 'PAUSED', pausedAt: now });
      case 'RESUME':
        if (subscription.status !== 'PAUSED') conflict('Only a paused subscription can be resumed');
        if (!subscription.plan.allowPause) denied('This plan does not allow resuming a paused subscription');
        validateTerm(subscription, now);
        return update(tx, subscription, { status: 'ACTIVE', pausedAt: null, nextBillingDate: utcDay(now) });
      case 'CLOSED':
        if (subscription.status !== 'ACTIVE' && subscription.status !== 'PAUSED') conflict('Only active or paused subscriptions can be closed');
        if ((!subscription.expiryDate || now < subscription.expiryDate) && !subscription.plan.allowEarlyClose) denied('This plan does not allow early closure');
        requireBillingCaughtUp(subscription, now);
        return update(tx, subscription, { status: 'CLOSED', closedAt: now });
    }
  });
}

export async function renewSubscription(id: string, input: z.infer<typeof renewalSchema>, now = new Date(), customerId?: string) {
  return db.$transaction(async tx => {
    const source = await load(tx, id, customerId);
    if (!['ACTIVE', 'PAUSED', 'CLOSED'].includes(source.status)) conflict('Only active, paused or closed subscriptions can be renewed');
    if (!source.plan.allowRenew) denied('This plan does not allow renewal');
    const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
    const expiryDate = new Date(`${input.expiryDate}T00:00:00.000Z`);
    const boundary = source.status === 'CLOSED' && source.closedAt && (!source.expiryDate || source.closedAt < source.expiryDate) ? source.closedAt : source.expiryDate;
    if (!boundary) return invalid('Close an open-ended subscription before starting a renewal term');
    if (startDate < boundary || startDate < utcDay(now)) invalid('Renewal must start after the current term and cannot start in the past');
    const marker = `[Renewal of ${source.number}]`;
    const existing = await tx.subscription.findFirst({ where: { customerId: source.customerId, planId: source.planId, startDate,
      lines: { some: { description: { startsWith: marker } } } }, include: lifecycleInclude });
    if (existing) {
      if (existing.expiryDate?.getTime() !== expiryDate.getTime()) conflict('A renewal already exists for this start date with different expiry', 'RENEWAL_EXISTS');
      return lifecycleResult(existing);
    }
    const renewed = { ...source, startDate, expiryDate };
    validateTerm(renewed, now);
    // A renewal is a separate draft requiring its own commercial approval.
    // Preserve old invoice/payment records and snapshot prices; use current plan interval for the new term.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const subscription = await tx.subscription.create({ data: {
          number: `SUB-${now.getUTCFullYear()}-${randomBytes(8).toString('hex').toUpperCase()}`,
          customerId: source.customerId, planId: source.planId, startDate, expiryDate, status: 'DRAFT',
          billingInterval: source.plan.interval, paymentTermDays: source.paymentTermDays,
          lines: { create: source.lines.map((line, index) => ({ productId: line.productId, variantId: line.variantId,
            description: index === 0 ? `${marker} ${line.description}` : line.description, quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor, taxRuleId: line.taxRuleId, taxRateBps: line.taxRateBps })) },
        }, include: lifecycleInclude });
        return lifecycleResult(subscription);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    return conflict('Could not allocate a renewal number; retry', 'NUMBER_CONFLICT');
  });
}

export interface LifecycleRunResult { activated: string[]; closed: string[]; deferred: { id: string; number: string; reason: string }[] }
// Scheduler hook: run before billing to activate due terms, then after billing to
// close expired terms only when the persisted billing cursor has reached expiry.
export async function processSubscriptionLifecycle(options: { now?: Date; limit?: number } = {}): Promise<LifecycleRunResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 1000) invalid('Invalid lifecycle processing options');
  const result: LifecycleRunResult = { activated: [], closed: [], deferred: [] };
  const due = await db.subscription.findMany({ where: { status: 'CONFIRMED', startDate: { lte: now } }, select: { id: true, number: true }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: limit });
  for (const { id, number } of due) {
    try { await transitionSubscription(id, { action: 'ACTIVE' }, now); result.activated.push(id); }
    catch (error) { result.deferred.push({ id, number, reason: error instanceof HttpError ? error.message : 'Activation failed; retry on the next run' }); }
  }
  const expired = await db.subscription.findMany({ where: { status: { in: ['ACTIVE', 'PAUSED'] }, expiryDate: { lte: now }, plan: { autoClose: true } }, select: { id: true, number: true }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }], take: limit });
  for (const { id, number } of expired) {
    try { await transitionSubscription(id, { action: 'CLOSED' }, now); result.closed.push(id); }
    catch (error) { result.deferred.push({ id, number, reason: error instanceof HttpError ? error.message : 'Closure failed; retry on the next run' }); }
  }
  return result;
}
