/**
 * Billing Calculation Service
 * Authoritative monetary calculation in integer paise (INR).
 * Tax is calculated on the discounted base: Math.round((taxableBase * taxRateBps) / 10000).
 */

export interface LineCalculationInput {
  quantity: number;
  unitPriceMinor: number;
  taxRateBps: number;
  discountMinor?: number;
}

export interface CalculatedLine {
  quantity: number;
  unitPriceMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  taxableBaseMinor: number;
  taxRateBps: number;
  taxMinor: number;
  amountMinor: number;
}

export interface InvoiceCalculationSummary {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: CalculatedLine[];
}

/**
 * Calculates a single invoice line.
 * All outputs are in integer minor units (paise).
 */
export function calculateLine(input: LineCalculationInput): CalculatedLine {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error('Quantity must be a positive integer');
  }
  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
    throw new Error('Unit price must be a non-negative integer in paise');
  }
  if (!Number.isInteger(input.taxRateBps) || input.taxRateBps < 0 || input.taxRateBps > 10000) {
    throw new Error('Tax rate bps must be an integer between 0 and 10000');
  }

  const subtotalMinor = input.quantity * input.unitPriceMinor;
  const rawDiscount = input.discountMinor ?? 0;
  const discountMinor = Math.min(subtotalMinor, Math.max(0, rawDiscount));
  const taxableBaseMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.round((taxableBaseMinor * input.taxRateBps) / 10000);
  const amountMinor = taxableBaseMinor + taxMinor;

  return {
    quantity: input.quantity,
    unitPriceMinor: input.unitPriceMinor,
    subtotalMinor,
    discountMinor,
    taxableBaseMinor,
    taxRateBps: input.taxRateBps,
    taxMinor,
    amountMinor,
  };
}

/**
 * Aggregates line calculations into full invoice totals.
 */
export function calculateInvoice(linesInput: LineCalculationInput[]): InvoiceCalculationSummary {
  const lines = linesInput.map(calculateLine);
  const subtotalMinor = lines.reduce((acc, l) => acc + l.subtotalMinor, 0);
  const discountMinor = lines.reduce((acc, l) => acc + l.discountMinor, 0);
  const taxMinor = lines.reduce((acc, l) => acc + l.taxMinor, 0);
  const totalMinor = subtotalMinor - discountMinor + taxMinor;

  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor,
    lines,
  };
}
