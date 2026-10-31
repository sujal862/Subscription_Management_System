import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/http.js';
import { calculateInvoice, type LineCalculationInput } from './calculation.js';
import type { Prisma, InvoiceStatus } from '@prisma/client';

export interface CreateInvoiceOptions {
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  status?: InvoiceStatus;
  prisma?: Prisma.TransactionClient;
}

export interface ListInvoicesOptions {
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  customerId?: string;
}

let invoiceCounter = 1;

export function generateInvoiceNumber(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const sequence = String(invoiceCounter++).padStart(4, '0');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${year}${month}-${sequence}-${randomSuffix}`;
}

export async function createInvoiceFromSubscription(options: CreateInvoiceOptions) {
  const client = options.prisma ?? db;

  const subscription = await client.subscription.findUnique({
    where: { id: options.subscriptionId },
    include: {
      customer: true,
      lines: true,
    },
  });

  if (!subscription) {
    throw new HttpError(404, 'NOT_FOUND', 'Subscription not found');
  }

  if (subscription.lines.length === 0) {
    throw new HttpError(400, 'NO_LINES', 'Subscription has no lines to bill');
  }

  // Calculate integer paise values for all lines
  const calculationInputs: LineCalculationInput[] = subscription.lines.map(line => ({
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    taxRateBps: line.taxRateBps,
    discountMinor: 0, // Hour 1 starts with 0 discount
  }));

  const calcResult = calculateInvoice(calculationInputs);

  const dueDate = new Date(options.periodStart.getTime() + subscription.paymentTermDays * 24 * 60 * 60 * 1000);
  const number = generateInvoiceNumber(options.periodStart);

  const invoice = await client.invoice.create({
    data: {
      number,
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      customerName: subscription.customer.name,
      customerEmail: subscription.customer.email,
      customerAddress: subscription.customer.address,
      status: options.status ?? 'DRAFT',
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
      dueDate,
      subtotalMinor: calcResult.subtotalMinor,
      discountMinor: 0,
      taxMinor: calcResult.taxMinor,
      totalMinor: calcResult.totalMinor,
      lines: {
        create: subscription.lines.map((subLine, idx) => {
          const calculated = calcResult.lines[idx];
          return {
            productId: subLine.productId,
            description: subLine.description,
            quantity: subLine.quantity,
            unitPriceMinor: subLine.unitPriceMinor,
            discountMinor: 0,
            taxRateBps: subLine.taxRateBps,
            taxMinor: calculated.taxMinor,
            amountMinor: calculated.amountMinor,
          };
        }),
      },
    },
    include: {
      lines: true,
      payments: true,
      customer: true,
    },
  });

  return invoice;
}

export async function listInvoices(options: ListInvoicesOptions) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.InvoiceWhereInput = {};
  if (options.status) {
    where.status = options.status;
  }
  if (options.customerId) {
    where.customerId = options.customerId;
  }

  const [total, items] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { issuedAt: 'desc' },
      include: {
        lines: true,
        payments: true,
        customer: {
          select: { id: true, name: true, email: true, company: true },
        },
      },
    }),
  ]);

  const itemsWithBalances = items.map(inv => {
    const paidAmountMinor = inv.payments.reduce((acc, p) => acc + p.amountMinor, 0);
    const remainingBalanceMinor = Math.max(0, inv.totalMinor - paidAmountMinor);
    const isOverdue = inv.status === 'CONFIRMED' && inv.dueDate < new Date();
    return {
      ...inv,
      paidAmountMinor,
      remainingBalanceMinor,
      isOverdue,
    };
  });

  return {
    items: itemsWithBalances,
    page,
    pageSize,
    total,
  };
}

export async function getInvoiceById(id: string) {
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      lines: true,
      payments: true,
      discountRedemptions: {
        include: { discount: true },
      },
      customer: true,
      subscription: {
        select: { id: true, number: true, status: true, billingInterval: true },
      },
    },
  });

  if (!invoice) {
    throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const paidAmountMinor = invoice.payments.reduce((acc, p) => acc + p.amountMinor, 0);
  const remainingBalanceMinor = Math.max(0, invoice.totalMinor - paidAmountMinor);
  const isOverdue = invoice.status === 'CONFIRMED' && invoice.dueDate < new Date();

  return {
    ...invoice,
    paidAmountMinor,
    remainingBalanceMinor,
    isOverdue,
  };
}
