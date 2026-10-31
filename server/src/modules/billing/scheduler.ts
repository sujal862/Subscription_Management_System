import { runBillingCycle, type BillingRunResult } from './recurring.js';
import { processSubscriptionLifecycle } from '../subscriptions/lifecycle.js';

let timer: ReturnType<typeof setInterval> | undefined;
let isRunning = false;
let pending: Promise<BillingRunResult | null> | undefined;

/**
 * Executes a single recurring billing cycle run safely, preventing overlapping runs.
 */
export function runScheduledBillingCycle(): Promise<BillingRunResult | null> {
  if (isRunning) {
    return Promise.resolve(null); // Skip if a cycle is already currently running
  }

  isRunning = true;
  pending = (async () => { try {
    await processSubscriptionLifecycle();
    const result = await runBillingCycle();
    await processSubscriptionLifecycle();
    if (result.invoicesCreated > 0 || result.errors.length > 0) {
      console.log(`[Billing Scheduler] Created ${result.invoicesCreated} invoices, skipped ${result.skippedDuplicates} duplicates.`);
    }
    return result;
  } catch (error) {
    console.error('[Billing Scheduler] Cycle failed; it will retry on the next run.');
    return null;
  } finally {
    isRunning = false;
    pending = undefined;
  } })();
  return pending;
}
export async function waitForBillingScheduler() { await pending; }

/**
 * Starts the recurring billing scheduler and performs an immediate catch-up cycle on startup.
 */
export function startBillingScheduler(intervalMs = 60000) {
  if (timer) return;

  // Catch up any missed due periods immediately on startup
  void runScheduledBillingCycle();

  timer = setInterval(() => {
    void runScheduledBillingCycle();
  }, intervalMs);

  timer.unref();
}

/**
 * Stops the recurring billing scheduler.
 */
export function stopBillingScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
