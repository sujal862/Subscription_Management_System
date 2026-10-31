// Shared contract. Coordinate changes with the leader before editing.
export const roles = ['ADMIN', 'STAFF', 'CUSTOMER'] as const;
export type Role = typeof roles[number];
export const subscriptionStatuses = ['DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE', 'PAUSED', 'CLOSED'] as const;
export const invoiceStatuses = ['DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED'] as const;
export const billingIntervals = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export interface PublicUser { id: string; name: string; email: string; role: Role; customerId: string | null }
export interface DashboardSummary {
  activeSubscriptions: number; invoicedRevenueMinor: number; collectedMinor: number;
  outstandingMinor: number; overdueMinor: number; overdueInvoices: number; currency: 'INR';
}
export type ApiResponse<T> = { data: T } | { error: { code: string; message: string; details?: unknown } };
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
