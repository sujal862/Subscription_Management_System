import { processSubscriptionLifecycle } from './lifecycle.js';

// Module-owned scheduler: no shared app/index or Member 4 billing files are changed.
// No invoices are generated here. Deferred expiry closures retry after billing catches up.
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startSubscriptionLifecycleScheduler(intervalMs = 60000) {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void processSubscriptionLifecycle().catch(error => console.error('Subscription lifecycle processing failed', error))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
}
export function stopSubscriptionLifecycleScheduler() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
