import { z } from 'zod';
import { HttpError } from '../../lib/http.js';
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform(value => value || null);
export const customerSchema = z.object({
  name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email().max(254),
  company: optionalText(200), phone: optionalText(40), address: optionalText(2000),
}).strict();
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(200).default(''),
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid date in YYYY-MM-DD format');
export const draftSchema = z.object({
  customerId: z.string().min(1), planId: z.string().min(1), startDate: date,
  expiryDate: date.nullable().optional(), paymentTermDays: z.number().int().min(0).max(365).default(7),
  lines: z.array(z.object({
    productId: z.string().min(1), variantId: z.string().min(1).nullable().optional(),
    quantity: z.number().int().min(1).max(1000000), unitPriceMinor: z.number().int().min(0).max(2147483647).optional(),
    taxRuleId: z.string().min(1).nullable().optional(),
  }).strict()).min(1).max(100),
}).strict().refine(value => !value.expiryDate || value.expiryDate > value.startDate, { path: ['expiryDate'], message: 'Expiry date must be after start date' });
export function amounts<T extends { quantity: number; unitPriceMinor: number; taxRateBps: number }>(lines: T[]) {
  let subtotal = 0n, tax = 0n;
  const result = lines.map(line => {
    const base = BigInt(line.quantity) * BigInt(line.unitPriceMinor);
    const lineTax = (base * BigInt(line.taxRateBps) + 5000n) / 10000n;
    subtotal += base; tax += lineTax;
    return { ...line, subtotalMinor: Number(base), taxMinor: Number(lineTax), totalMinor: Number(base + lineTax) };
  });
  if (subtotal + tax > 2147483647n) throw new HttpError(400, 'VALIDATION_ERROR', 'Subscription total exceeds supported monetary range');
  return { lines: result, subtotalMinor: Number(subtotal), taxMinor: Number(tax), totalMinor: Number(subtotal + tax) };
}
