import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import type { DashboardSummary, DashboardOverdueInvoice, Page } from '../../../../shared/contracts.js';

// Calendar days are interpreted in Asia/Kolkata, independently of host timezone.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '9998-12-31';
}, 'Provide a valid calendar date between 1900 and 9998');
const fields = { from: day.optional(), to: day.optional(), status: z.enum(['CONFIRMED', 'PAID']).optional() };
const validRange = (value: { from?: string; to?: string }) => !value.from || !value.to || value.from <= value.to;
export const dashboardFilterSchema = z.object(fields).strict().refine(validRange, 'From date must be on or before to date');
export const overdueQuerySchema = z.object({ ...fields,
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(validRange, 'From date must be on or before to date');
type Filters = z.infer<typeof dashboardFilterSchema>;

function invoiceScope(filter: Filters) {
  const clauses = [filter.status ? Prisma.sql`i.status = ${filter.status}` : Prisma.sql`i.status IN ('CONFIRMED', 'PAID')`];
  if (filter.from) clauses.push(Prisma.sql`i.issuedAt >= ${new Date(`${filter.from}T00:00:00+05:30`)}`);
  if (filter.to) clauses.push(Prisma.sql`i.issuedAt < ${new Date(new Date(`${filter.to}T00:00:00+05:30`).getTime() + 86400000)}`);
  return Prisma.join(clauses, ' AND ');
}
// Payments are summed once per invoice inside SQLite, never joined as duplicate invoice rows.
// The existing Payment(invoiceId) index bounds each correlated aggregation.
function balances(filter: Filters) {
  return Prisma.sql`WITH balances AS (
    SELECT i.id, i.number, i.customerName, i.dueDate, i.totalMinor,
      i.subtotalMinor - i.discountMinor AS revenue,
      COALESCE((SELECT SUM(p.amountMinor) FROM Payment p WHERE p.invoiceId = i.id), 0) AS paid
    FROM Invoice i WHERE ${invoiceScope(filter)}
  )`;
}
function integer(value: bigint | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Dashboard aggregate exceeds safe integer range');
  return result;
}
type Totals = { invoiceCount: bigint; revenue: bigint; paid: bigint; outstanding: bigint; overdue: bigint; overdueCount: bigint };
export async function dashboardSummary(filter: Filters, now = new Date()): Promise<DashboardSummary> {
  return db.$transaction(async tx => {
    const [row] = await tx.$queryRaw<Totals[]>(Prisma.sql`${balances(filter)}
      SELECT COUNT(*) AS invoiceCount, COALESCE(SUM(revenue),0) AS revenue,
      COALESCE(SUM(paid),0) AS paid, COALESCE(SUM(MAX(0,totalMinor-paid)),0) AS outstanding,
      COALESCE(SUM(CASE WHEN dueDate < ${now} THEN MAX(0,totalMinor-paid) ELSE 0 END),0) AS overdue,
      COALESCE(SUM(CASE WHEN dueDate < ${now} AND totalMinor > paid THEN 1 ELSE 0 END),0) AS overdueCount
      FROM balances`);
    return { activeSubscriptions: await tx.subscription.count({ where: { status: 'ACTIVE' } }),
      invoicedRevenueMinor: integer(row.revenue), collectedMinor: integer(row.paid),
      outstandingMinor: integer(row.outstanding), overdueMinor: integer(row.overdue),
      overdueInvoices: integer(row.overdueCount), invoiceCount: integer(row.invoiceCount), currency: 'INR', asOf: now.toISOString() };
  });
}
type OverdueRow = { id: string; number: string; customerName: string; dueDate: Date; totalMinor: number; paid: bigint; outstanding: bigint };
export async function overdueInvoices(filter: z.infer<typeof overdueQuerySchema>, now = new Date()): Promise<Page<DashboardOverdueInvoice>> {
  return db.$transaction(async tx => {
    const scope = Prisma.sql`dueDate < ${now} AND totalMinor > paid`;
    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`${balances(filter)} SELECT COUNT(*) AS total FROM balances WHERE ${scope}`);
    const rows = await tx.$queryRaw<OverdueRow[]>(Prisma.sql`${balances(filter)}
      SELECT id, number, customerName, dueDate, totalMinor, paid, totalMinor-paid AS outstanding
      FROM balances WHERE ${scope} ORDER BY dueDate ASC, id ASC LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`);
    return { page: filter.page, pageSize: filter.pageSize, total: integer(count.total), items: rows.map(row => ({
      id: row.id, number: row.number, customerName: row.customerName, dueDate: new Date(row.dueDate).toISOString(),
      totalMinor: row.totalMinor, paidMinor: integer(row.paid), outstandingMinor: integer(row.outstanding),
    })) };
  });
}
