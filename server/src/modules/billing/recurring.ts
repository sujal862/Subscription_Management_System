import { db } from '../../lib/db.js';
import { createInvoiceFromSubscription } from './service.js';
import { calculateNextPeriod } from './calendar.js';
import type { Prisma } from '@prisma/client';

export interface BillingRunOptions {
  targetDate?: Date;
  subscriptionId?: string;
  maxCatchUpCycles?: number;
}

export interface BillingRunResult {
  targetDate: string;
  processedSubscriptions: number;
  invoicesCreated: number;
  skippedDuplicates: number;
  errors: Array<{
    subscriptionId: string;
    subscriptionNumber: string;
    error: string;
  }>;
}

const DEFAULT_MAX_CATCH_UP_CYCLES = 12;

/**
 * Shared Recurring Billing Engine.
 * Processes active subscriptions where nextBillingDate <= targetDate.
 * Enforces transaction safety, anchor-day clamping, expiry boundaries, and idempotency.
 */
export async function runBillingCycle(options: BillingRunOptions = {}): Promise<BillingRunResult> {
  const targetDate = options.targetDate ? new Date(options.targetDate) : new Date();
  const maxCycles = options.maxCatchUpCycles ?? DEFAULT_MAX_CATCH_UP_CYCLES;

  const where: Prisma.SubscriptionWhereInput = {
    status: 'ACTIVE',
    nextBillingDate: { lte: targetDate },
    ...(options.subscriptionId ? { id: options.subscriptionId } : {}),
  };

  const activeSubscriptions = await db.subscription.findMany({
    where,
    include: {
      lines: true,
      customer: true,
    },
    orderBy: { nextBillingDate: 'asc' },
  });

  const result: BillingRunResult = {
    targetDate: targetDate.toISOString(),
    processedSubscriptions: 0,
    invoicesCreated: 0,
    skippedDuplicates: 0,
    errors: [],
  };

  for (const subscription of activeSubscriptions) {
    if (!subscription.nextBillingDate) continue;

    let currentBillingDate: Date = new Date(subscription.nextBillingDate);
    let cyclesForSub = 0;
    let hadError = false;

    result.processedSubscriptions++;

    // Bounded catch-up loop: process due periods sequentially without skipping
    while (currentBillingDate <= targetDate && cyclesForSub < maxCycles && !hadError) {
      // Coordinate subscription expiry boundary:
      // If subscription has an expiryDate and current billing start is on or after expiry, do not bill.
      if (subscription.expiryDate && currentBillingDate >= subscription.expiryDate) {
        break;
      }

      const { nextPeriodStart, periodEnd } = calculateNextPeriod(
        currentBillingDate,
        subscription.billingInterval,
        subscription.billingAnchorDay
      );

      try {
        await db.$transaction(async tx => {
          // Check existing unique billing-period key: @@unique([subscriptionId, periodStart])
          const existingInvoice = await tx.invoice.findUnique({
            where: {
              subscriptionId_periodStart: {
                subscriptionId: subscription.id,
                periodStart: currentBillingDate,
              },
            },
          });

          if (existingInvoice) {
            // Already billed this period. Advance nextBillingDate to prevent infinite loop.
            await tx.subscription.update({
              where: { id: subscription.id },
              data: { nextBillingDate: nextPeriodStart },
            });
            result.skippedDuplicates++;
          } else {
            // Generate invoice with snapshot of customer, lines, and prices
            await createInvoiceFromSubscription({
              subscriptionId: subscription.id,
              periodStart: currentBillingDate,
              periodEnd,
              status: 'DRAFT',
              prisma: tx,
            });

            // Advance nextBillingDate only upon successful invoice creation
            await tx.subscription.update({
              where: { id: subscription.id },
              data: { nextBillingDate: nextPeriodStart },
            });

            result.invoicesCreated++;
          }
        });

        // Update loop cursor
        currentBillingDate = nextPeriodStart;
        cyclesForSub++;
      } catch (err: any) {
        hadError = true;
        result.errors.push({
          subscriptionId: subscription.id,
          subscriptionNumber: subscription.number,
          error: err.message || 'Unknown billing error',
        });
      }
    }
  }

  return result;
}
