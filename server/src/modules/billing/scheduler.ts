import { runBillingCycle, type BillingRunResult } from './recurring.js';

let timer: ReturnType<typeof setInterval> | undefined;
let isRunning = false;

/**
 * Executes a single recurring billing cycle run safely, preventing overlapping runs.
 */
export async function runScheduledBillingCycle(): Promise<BillingRunResult | null> {
  if (isRunning) {
    return null; // Skip if a cycle is already currently running
  }

  isRunning = true;
  try {
    const result = await runBillingCycle();
    if (result.invoicesCreated > 0 || result.errors.length > 0) {
      console.log(`[Billing Scheduler] Created ${result.invoicesCreated} invoices, skipped ${result.skippedDuplicates} duplicates.`);
    }
    return result;
  } catch (error) {
    console.error('[Billing Scheduler] Error executing recurring billing cycle:', error);
    return null;
  } finally {
    isRunning = false;
  }
}

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
