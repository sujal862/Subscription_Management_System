import type { DiscountRule } from '@prisma/client';

export interface DiscountCandidate {
  rule: DiscountRule;
  savingsMinor: number;
  productLineIndex?: number;
}

export interface LineDiscountInput {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBps: number;
}

/**
 * Evaluates all candidate discount rules against the subscription lines and period start,
 * selecting the single discount that yields the highest savings deterministically.
 */
export function selectBestEligibleDiscount(
  rules: DiscountRule[],
  lines: LineDiscountInput[],
  periodStart: Date
): DiscountCandidate | null {
  const invoiceSubtotalMinor = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceMinor, 0);
  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);

  const eligibleCandidates: DiscountCandidate[] = [];

  for (const rule of rules) {
    // 1. Must be active
    if (!rule.isActive) continue;

    // 2. Date checks (startsAt <= periodStart and endsAt >= periodStart if present)
    if (rule.startsAt > periodStart) continue;
    if (rule.endsAt && rule.endsAt < periodStart) continue;

    // 3. Usage limit check
    if (rule.usageLimit !== null && rule.uses >= rule.usageLimit) continue;

    if (rule.scope === 'SUBSCRIPTION') {
      // Must meet whole-subscription minimum purchase and quantity thresholds
      if (invoiceSubtotalMinor < rule.minimumPurchaseMinor) continue;
      if (totalQuantity < rule.minimumQuantity) continue;

      let savings = 0;
      if (rule.kind === 'FIXED') {
        savings = Math.min(invoiceSubtotalMinor, rule.value);
      } else if (rule.kind === 'PERCENTAGE') {
        savings = Math.min(invoiceSubtotalMinor, Math.round((invoiceSubtotalMinor * rule.value) / 10000));
      }

      if (savings > 0) {
        eligibleCandidates.push({
          rule,
          savingsMinor: savings,
        });
      }
    } else if (rule.scope === 'PRODUCT') {
      // Must target a specific product present in the lines
      if (!rule.productId) continue;

      // Find matching line
      const lineIndex = lines.findIndex(l => l.productId === rule.productId);
      if (lineIndex === -1) continue;

      const line = lines[lineIndex];
      const lineSubtotal = line.quantity * line.unitPriceMinor;

      if (lineSubtotal < rule.minimumPurchaseMinor) continue;
      if (line.quantity < rule.minimumQuantity) continue;

      let savings = 0;
      if (rule.kind === 'FIXED') {
        savings = Math.min(lineSubtotal, rule.value);
      } else if (rule.kind === 'PERCENTAGE') {
        savings = Math.min(lineSubtotal, Math.round((lineSubtotal * rule.value) / 10000));
      }

      if (savings > 0) {
        eligibleCandidates.push({
          rule,
          savingsMinor: savings,
          productLineIndex: lineIndex,
        });
      }
    }
  }

  if (eligibleCandidates.length === 0) {
    return null;
  }

  // Choose the single largest eligible savings deterministically.
  // Tie-breaker: alphabetical by rule id.
  eligibleCandidates.sort((a, b) => {
    if (b.savingsMinor !== a.savingsMinor) {
      return b.savingsMinor - a.savingsMinor;
    }
    return a.rule.id.localeCompare(b.rule.id);
  });

  return eligibleCandidates[0];
}
