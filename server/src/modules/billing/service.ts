import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/http.js';
import { calculateInvoice, type LineCalculationInput } from './calculation.js';
import { selectBestEligibleDiscount } from './discounts.js';
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
  overdue?: boolean;
}

export interface RecordPaymentInput {
  method: string;
  amountMinor: number;
  paidAt?: Date;
  note?: string | null;
  reference?: string | null;
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

  // 1. Fetch active discounts to determine eligible savings
  const activeDiscountRules = await client.discountRule.findMany({
    where: { isActive: true },
  });

  const discountInputs = subscription.lines.map(line => ({
    productId: line.productId,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    taxRateBps: line.taxRateBps,
  }));

  const bestDiscount = selectBestEligibleDiscount(
    activeDiscountRules,
    discountInputs,
    options.periodStart
  );

  // 2. Allocate discount amounts to individual lines
  let lineDiscounts: number[] = new Array(subscription.lines.length).fill(0);

  if (bestDiscount) {
    if (bestDiscount.productLineIndex !== undefined) {
      // Product-scoped discount applies to the specific product line
      lineDiscounts[bestDiscount.productLineIndex] = bestDiscount.savingsMinor;
    } else {
      // Subscription-scoped discount: distribute across lines proportionally
      const totalRawSubtotal = discountInputs.reduce((sum, l) => sum + l.quantity * l.unitPriceMinor, 0);
      let allocatedDiscount = 0;

      lineDiscounts = subscription.lines.map((line, idx) => {
        if (idx === subscription.lines.length - 1) {
          return bestDiscount.savingsMinor - allocatedDiscount;
        }
        const lineSubtotal = line.quantity * line.unitPriceMinor;
        const lineShare = Math.min(
          lineSubtotal,
          Math.round((lineSubtotal / totalRawSubtotal) * bestDiscount.savingsMinor)
        );
        allocatedDiscount += lineShare;
        return lineShare;
      });
    }
  }

  // 3. Calculate integer paise values for all lines (tax is calculated on discounted base)
  const calculationInputs: LineCalculationInput[] = subscription.lines.map((line, idx) => ({
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    taxRateBps: line.taxRateBps,
    discountMinor: lineDiscounts[idx] || 0,
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
      discountMinor: calcResult.discountMinor,
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
            discountMinor: calculated.discountMinor,
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

  // 4. Atomically record discount redemption and increment usage count
  if (bestDiscount && bestDiscount.savingsMinor > 0) {
    await client.discountRedemption.create({
      data: {
        discountId: bestDiscount.rule.id,
        invoiceId: invoice.id,
        amountMinor: bestDiscount.savingsMinor,
      },
    });

    await client.discountRule.update({
      where: { id: bestDiscount.rule.id },
      data: {
        uses: { increment: 1 },
      },
    });
  }

  return invoice;
}

export async function confirmInvoice(id: string) {
  const invoice = await db.invoice.findUnique({
    where: { id },
  });

  if (!invoice) {
    throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.status !== 'DRAFT') {
    throw new HttpError(400, 'INVALID_STATUS', `Cannot confirm invoice with status ${invoice.status}. Only DRAFT invoices can be confirmed.`);
  }

  return db.invoice.update({
    where: { id },
    data: { status: 'CONFIRMED' },
    include: {
      lines: true,
      payments: true,
      discountRedemptions: { include: { discount: true } },
      customer: true,
    },
  });
}

export async function cancelInvoice(id: string) {
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: { payments: true },
  });

  if (!invoice) {
    throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.payments.length > 0) {
    throw new HttpError(400, 'PAYMENTS_EXIST', 'Cannot cancel an invoice with recorded payments. Cancellation must not orphan payments.');
  }

  if (invoice.status === 'CANCELLED') {
    throw new HttpError(400, 'ALREADY_CANCELLED', 'Invoice is already cancelled.');
  }

  if (invoice.status === 'PAID') {
    throw new HttpError(400, 'ALREADY_PAID', 'Cannot cancel a paid invoice.');
  }

  return db.invoice.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: {
      lines: true,
      payments: true,
      discountRedemptions: { include: { discount: true } },
      customer: true,
    },
  });
}

export async function recordPayment(invoiceId: string, input: RecordPaymentInput) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new HttpError(400, 'INVALID_AMOUNT', 'Payment amount must be a positive integer in paise');
  }

  if (!input.method || input.method.trim().length === 0) {
    throw new HttpError(400, 'INVALID_METHOD', 'Payment method is required');
  }

  const cleanReference = input.reference && input.reference.trim().length > 0 ? input.reference.trim() : null;

  return db.$transaction(async tx => {
    // 1. Fetch invoice with existing payments
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });

    if (!invoice) {
      throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
    }

    // 2. Reject payments against DRAFT or CANCELLED invoices
    if (invoice.status === 'DRAFT') {
      throw new HttpError(400, 'INVALID_INVOICE_STATUS', 'Cannot record payment against a DRAFT invoice. Confirm the invoice first.');
    }

    if (invoice.status === 'CANCELLED') {
      throw new HttpError(400, 'INVALID_INVOICE_STATUS', 'Cannot record payment against a CANCELLED invoice.');
    }

    // 3. Check reference uniqueness if provided
    if (cleanReference) {
      const existingRef = await tx.payment.findUnique({
        where: { reference: cleanReference },
      });
      if (existingRef) {
        throw new HttpError(400, 'DUPLICATE_REFERENCE', `A payment with reference "${cleanReference}" has already been recorded.`);
      }
    }

    // 4. Calculate existing paid total and remaining balance
    const existingPaid = invoice.payments.reduce((sum, p) => sum + p.amountMinor, 0);
    const remainingBalance = Math.max(0, invoice.totalMinor - existingPaid);

    if (remainingBalance === 0 || invoice.status === 'PAID') {
      throw new HttpError(400, 'ALREADY_PAID', 'This invoice is already paid in full.');
    }

    // 5. Reject overpayment
    if (input.amountMinor > remainingBalance) {
      throw new HttpError(
        400,
        'OVERPAYMENT',
        `Payment amount (${input.amountMinor} paise) exceeds the remaining balance (${remainingBalance} paise). Overpayment is rejected.`
      );
    }

    // 6. Record the payment
    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        method: input.method.trim(),
        amountMinor: input.amountMinor,
        paidAt: input.paidAt ?? new Date(),
        note: input.note?.trim() || null,
        reference: cleanReference,
      },
    });

    const newTotalPaid = existingPaid + input.amountMinor;
    const newRemainingBalance = invoice.totalMinor - newTotalPaid;

    // 7. Transition to PAID only when fully paid
    let newStatus: InvoiceStatus = invoice.status;
    if (newRemainingBalance === 0) {
      newStatus = 'PAID';
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID' },
      });
    }

    return {
      payment,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        status: newStatus,
        totalMinor: invoice.totalMinor,
        paidAmountMinor: newTotalPaid,
        remainingBalanceMinor: newRemainingBalance,
      },
    };
  });
}

export async function listPaymentsForInvoice(invoiceId: string) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: {
        orderBy: { paidAt: 'desc' },
      },
    },
  });

  if (!invoice) {
    throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const paidAmountMinor = invoice.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const remainingBalanceMinor = Math.max(0, invoice.totalMinor - paidAmountMinor);

  return {
    items: invoice.payments,
    totalPaidMinor: paidAmountMinor,
    remainingBalanceMinor,
    invoiceTotalMinor: invoice.totalMinor,
    invoiceStatus: invoice.status,
  };
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
  if (options.overdue) {
    where.status = 'CONFIRMED';
    where.dueDate = { lt: new Date() };
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
        discountRedemptions: { include: { discount: true } },
        customer: {
          select: { id: true, name: true, email: true, company: true },
        },
      },
    }),
  ]);

  const itemsWithBalances = items.map(inv => {
    const paidAmountMinor = inv.payments.reduce((acc, p) => acc + p.amountMinor, 0);
    const remainingBalanceMinor = Math.max(0, inv.totalMinor - paidAmountMinor);
    const isOverdue = inv.status === 'CONFIRMED' && inv.dueDate < new Date() && remainingBalanceMinor > 0;
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
      payments: {
        orderBy: { paidAt: 'desc' },
      },
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
  const isOverdue = invoice.status === 'CONFIRMED' && invoice.dueDate < new Date() && remainingBalanceMinor > 0;

  return {
    ...invoice,
    paidAmountMinor,
    remainingBalanceMinor,
    isOverdue,
  };
}
