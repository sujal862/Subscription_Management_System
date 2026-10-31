import { BillingInterval } from '@prisma/client';

export interface NextPeriodResult {
  nextPeriodStart: Date;
  periodEnd: Date;
}

/**
 * Calculates the next period start and period end given the current period start,
 * the interval, and an optional anchor day (1-31) for monthly/yearly calendar clamping.
 */
export function calculateNextPeriod(
  currentPeriodStart: Date,
  interval: BillingInterval,
  anchorDay?: number | null
): NextPeriodResult {
  const start = new Date(currentPeriodStart);
  let nextStart: Date;

  switch (interval) {
    case 'DAILY': {
      nextStart = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      break;
    }

    case 'WEEKLY': {
      nextStart = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    }

    case 'MONTHLY': {
      const currentYear = start.getUTCFullYear();
      const currentMonth = start.getUTCMonth();
      const targetYear = currentMonth === 11 ? currentYear + 1 : currentYear;
      const targetMonth = (currentMonth + 1) % 12;

      // Determine the anchor day to preserve across variable-length months (e.g. 31st)
      const effectiveAnchor = anchorDay ?? start.getUTCDate();

      // Find the last day of the target month: new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const clampedDay = Math.min(effectiveAnchor, daysInTargetMonth);

      nextStart = new Date(Date.UTC(
        targetYear,
        targetMonth,
        clampedDay,
        start.getUTCHours(),
        start.getUTCMinutes(),
        start.getUTCSeconds(),
        start.getUTCMilliseconds()
      ));
      break;
    }

    case 'YEARLY': {
      const targetYear = start.getUTCFullYear() + 1;
      const targetMonth = start.getUTCMonth();
      const effectiveAnchor = anchorDay ?? start.getUTCDate();

      const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const clampedDay = Math.min(effectiveAnchor, daysInTargetMonth);

      nextStart = new Date(Date.UTC(
        targetYear,
        targetMonth,
        clampedDay,
        start.getUTCHours(),
        start.getUTCMinutes(),
        start.getUTCSeconds(),
        start.getUTCMilliseconds()
      ));
      break;
    }

    default:
      throw new Error(`Unsupported billing interval: ${String(interval)}`);
  }

  // The current billing period ends 1 millisecond before the next period starts
  const periodEnd = new Date(nextStart.getTime() - 1);

  return {
    nextPeriodStart: nextStart,
    periodEnd,
  };
}
