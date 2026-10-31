import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/http.js';
import { createInvoiceFromSubscription } from './service.js';
import { calculateNextPeriod } from './calendar.js';

export interface BillingRunOptions {
  targetDate?: Date; subscriptionId?: string; maxCatchUpCycles?: number; maxSubscriptions?: number;
}
export interface BillingRunResult {
  targetDate: string; processedSubscriptions: number; invoicesCreated: number;
  skippedDuplicates: number; hasMore: boolean;
  errors: Array<{ subscriptionId: string; subscriptionNumber: string; error: string }>;
}

// Manual and scheduled runs share this engine. Every iteration reads the persisted
// cursor inside its transaction, so overlapping workers can never move it backwards.
export async function runBillingCycle(options: BillingRunOptions = {}): Promise<BillingRunResult> {
  const targetDate = options.targetDate ?? new Date();
  const maxCycles = options.maxCatchUpCycles ?? 12;
  const batchSize = options.maxSubscriptions ?? 100;
  if (!Number.isFinite(targetDate.getTime()) || !Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new HttpError(400, 'INVALID_BILLING_OPTIONS', 'Invalid billing date or batch limits');
  }
  const where = {
    status: 'ACTIVE' as const, nextBillingDate: { lte: targetDate },
    ...(options.subscriptionId ? { id: options.subscriptionId } : {}),
    OR: [{ expiryDate: null }, { nextBillingDate: { lt: db.subscription.fields.expiryDate } }],
  };
  const selected = await db.subscription.findMany({ where, select: { id: true, number: true },
    orderBy: [{ nextBillingDate: 'asc' }, { id: 'asc' }], take: batchSize });
  const result: BillingRunResult = { targetDate: targetDate.toISOString(), processedSubscriptions: selected.length,
    invoicesCreated: 0, skippedDuplicates: 0, hasMore: false, errors: [] };
  for (const subscription of selected) {
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      try {
        const outcome = await db.$transaction(async tx => {
          const current = await tx.subscription.findUnique({ where: { id: subscription.id } });
          if (!current || current.status !== 'ACTIVE' || !current.nextBillingDate || current.nextBillingDate > targetDate ||
            (current.expiryDate && current.nextBillingDate >= current.expiryDate)) return 'done';
          const periodStart = current.nextBillingDate;
          const { nextPeriodStart, periodEnd } = calculateNextPeriod(periodStart, current.billingInterval, current.billingAnchorDay);
          const existing = await tx.invoice.findUnique({ where: { subscriptionId_periodStart: { subscriptionId: current.id, periodStart } } });
          if (!existing) await createInvoiceFromSubscription({ subscriptionId: current.id, periodStart, periodEnd, status: 'DRAFT', prisma: tx });
          const moved = await tx.subscription.updateMany({ where: { id: current.id, status: 'ACTIVE', nextBillingDate: periodStart, updatedAt: current.updatedAt }, data: { nextBillingDate: nextPeriodStart } });
          if (moved.count !== 1) throw new HttpError(409, 'STALE_SUBSCRIPTION', 'Subscription changed; retry billing');
          return existing ? 'duplicate' : 'created';
        });
        if (outcome === 'done') break;
        if (outcome === 'created') result.invoicesCreated++; else result.skippedDuplicates++;
      } catch {
        result.errors.push({ subscriptionId: subscription.id, subscriptionNumber: subscription.number,
          error: 'Billing could not complete for this subscription. Check its configuration and retry.' });
        break;
      }
    }
  }
  result.hasMore = (await db.subscription.count({ where })) > 0;
  return result;
}
