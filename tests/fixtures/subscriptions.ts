import { randomBytes } from 'node:crypto';
import type { PrismaClient, SubscriptionStatus, BillingInterval } from '@prisma/client';

// Member 4 can reuse this factory in isolated test databases. Never seeds dev.db.
export async function createLifecycleFixture(db: PrismaClient, options: {
  status?: SubscriptionStatus; startDate?: Date; expiryDate?: Date | null;
  nextBillingDate?: Date | null; quotationValidUntil?: Date | null; interval?: BillingInterval;
  allowPause?: boolean; allowEarlyClose?: boolean; allowRenew?: boolean; autoClose?: boolean;
} = {}) {
  const token = randomBytes(8).toString('hex');
  const startDate = options.startDate ?? new Date('2026-01-31T00:00:00Z');
  const status = options.status ?? 'ACTIVE';
  const customer = await db.customer.create({ data: { name: 'Lifecycle test buyer', email: `${token}@example.test` } });
  const product = await db.product.create({ data: { name: 'Workspace', salesPriceMinor: 15000 } });
  const plan = await db.plan.create({ data: { name: 'Monthly workspace', productId: product.id, priceMinor: 10000,
    minimumQuantity: 2, interval: options.interval ?? 'MONTHLY', allowPause: options.allowPause ?? true,
    allowEarlyClose: options.allowEarlyClose ?? true, allowRenew: options.allowRenew ?? true, autoClose: options.autoClose ?? true } });
  const subscription = await db.subscription.create({ data: {
    number: `SUB-FIXTURE-${token.toUpperCase()}`, customerId: customer.id, planId: plan.id,
    status, startDate, expiryDate: options.expiryDate === undefined ? new Date('2027-01-31T00:00:00Z') : options.expiryDate,
    quotationValidUntil: options.quotationValidUntil === undefined ? new Date('2026-12-01T00:00:00Z') : options.quotationValidUntil,
    paymentTermDays: 7, billingInterval: plan.interval,
    nextBillingDate: options.nextBillingDate === undefined ? status === 'ACTIVE' ? startDate : null : options.nextBillingDate,
    billingAnchorDay: status === 'ACTIVE' || status === 'PAUSED' ? startDate.getUTCDate() : null,
    pausedAt: status === 'PAUSED' ? new Date('2026-10-01T12:00:00Z') : null,
    closedAt: status === 'CLOSED' ? new Date('2026-10-01T12:00:00Z') : null,
    lines: { create: { productId: product.id, description: 'Workspace - saved price', quantity: 2, unitPriceMinor: 10000, taxRateBps: 1800 } },
  }, include: { lines: true } });
  return { subscription, customer, product, plan };
}
