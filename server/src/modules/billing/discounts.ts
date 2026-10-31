import type { DiscountRule } from '@prisma/client';

export interface DiscountCandidate {
  rule: DiscountRule;
  savingsMinor: number;
  productLineIndex?: number;
  productLineIndexes?: number[];
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
        savings = Math.min(invoiceSubtotalMinor, Number((BigInt(invoiceSubtotalMinor) * BigInt(rule.value) + 5000n) / 10000n));
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
      const indexes = lines.flatMap((line, index) => line.productId === rule.productId ? [index] : []);
      if (!indexes.length) continue;
      const lineSubtotal = indexes.reduce((sum, index) => sum + lines[index].quantity * lines[index].unitPriceMinor, 0);
      const matchingQuantity = indexes.reduce((sum, index) => sum + lines[index].quantity, 0);

      if (lineSubtotal < rule.minimumPurchaseMinor) continue;
      if (matchingQuantity < rule.minimumQuantity) continue;

      let savings = 0;
      if (rule.kind === 'FIXED') {
        savings = Math.min(lineSubtotal, rule.value);
      } else if (rule.kind === 'PERCENTAGE') {
        savings = Math.min(lineSubtotal, Number((BigInt(lineSubtotal) * BigInt(rule.value) + 5000n) / 10000n));
      }

      if (savings > 0) {
        eligibleCandidates.push({
          rule,
          savingsMinor: savings,
          productLineIndex: indexes[0], productLineIndexes: indexes,
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

// Largest remainder allocation preserves the exact saving, even for one-paise lines.
export function allocateDiscount(lines: LineDiscountInput[], candidate: DiscountCandidate | null): number[] {
  const result = lines.map(() => 0);
  if (!candidate) return result;
  const indexes = candidate.productLineIndexes ?? (candidate.productLineIndex === undefined ? lines.map((_, index) => index) : [candidate.productLineIndex]);
  const total = indexes.reduce((sum, index) => sum + BigInt(lines[index].quantity) * BigInt(lines[index].unitPriceMinor), 0n);
  if (!total) return result;
  const saving = BigInt(candidate.savingsMinor);
  const shares = indexes.map(index => {
    const weighted = BigInt(lines[index].quantity) * BigInt(lines[index].unitPriceMinor) * saving;
    result[index] = Number(weighted / total);
    return { index, remainder: weighted % total };
  }).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  let remainder = candidate.savingsMinor - result.reduce((sum, value) => sum + value, 0);
  for (const share of shares) { if (remainder-- <= 0) break; result[share.index]++; }
  return result;
}
