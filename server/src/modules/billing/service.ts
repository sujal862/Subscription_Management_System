import { db } from '../../lib/db.js';
import { HttpError } from '../../lib/http.js';
import { sendMail } from '../../lib/mail.js';
import { calculateInvoice, type LineCalculationInput } from './calculation.js';
import { selectBestEligibleDiscount, allocateDiscount } from './discounts.js';
import { randomBytes } from 'node:crypto';
import { escapeHtml } from '../../lib/html.js';
import { Prisma, type InvoiceStatus } from '@prisma/client';

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

export function generateInvoiceNumber(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `INV-${year}${month}-${randomBytes(8).toString('hex').toUpperCase()}`;
}

export async function createInvoiceFromSubscription(options: CreateInvoiceOptions): Promise<Prisma.InvoiceGetPayload<{ include: { lines: true; payments: true; customer: true } }>> {
  // Invoice, discount reservation and redemption always share one transaction.
  if (!options.prisma) return db.$transaction(tx => createInvoiceFromSubscription({ ...options, prisma: tx }));
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
  const lineDiscounts = allocateDiscount(discountInputs, bestDiscount);
  if (bestDiscount) {
    const reserved = await client.discountRule.updateMany({ where: {
      id: bestDiscount.rule.id, uses: bestDiscount.rule.uses, isActive: true,
      OR: [{ usageLimit: null }, { usageLimit: { gt: bestDiscount.rule.uses } }],
    }, data: { uses: { increment: 1 } } });
    if (reserved.count !== 1) throw new HttpError(409, 'DISCOUNT_CHANGED', 'Discount availability changed. Retry billing.');
  }

  // 3. Calculate integer paise values for all lines (tax is calculated on discounted base)
  const calculationInputs: LineCalculationInput[] = subscription.lines.map((line, idx) => ({
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    taxRateBps: line.taxRateBps,
    discountMinor: lineDiscounts[idx] || 0,
  }));

  let calcResult;
  try { calcResult = calculateInvoice(calculationInputs); }
  catch { throw new HttpError(400, 'INVALID_INVOICE_AMOUNT', 'Invoice quantities or amounts exceed supported limits'); }

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

  }

  return invoice;
}

export async function confirmInvoice(id: string) {
  return db.$transaction(async tx => {
  const invoice = await tx.invoice.findUnique({
    where: { id },
  });

  if (!invoice) {
    throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.status !== 'DRAFT') {
    throw new HttpError(400, 'INVALID_STATUS', `Cannot confirm invoice with status ${invoice.status}. Only DRAFT invoices can be confirmed.`);
  }

  return invoiceBalances(await tx.invoice.update({
    where: { id, status: 'DRAFT' },
    data: { status: 'CONFIRMED' },
    include: {
      lines: true,
      payments: true,
      discountRedemptions: { include: { discount: true } },
      customer: true,
    },
  }));
  });
}

export async function cancelInvoice(id: string) {
  return db.$transaction(async tx => {
  const invoice = await tx.invoice.findUnique({
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

  return invoiceBalances(await tx.invoice.update({
    where: { id, status: invoice.status },
    data: { status: 'CANCELLED' },
    include: {
      lines: true,
      payments: true,
      discountRedemptions: { include: { discount: true } },
      customer: true,
    },
  }));
  });
}

export async function recordPayment(invoiceId: string, input: RecordPaymentInput) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > 2147483647) {
    throw new HttpError(400, 'INVALID_AMOUNT', 'Payment amount must be a positive integer in paise');
  }

  if (!input.method || input.method.trim().length === 0) {
    throw new HttpError(400, 'INVALID_METHOD', 'Payment method is required');
  }
  if (input.paidAt && !Number.isFinite(input.paidAt.getTime())) throw new HttpError(400, 'INVALID_PAYMENT_DATE', 'Payment date must be valid');

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
  }).catch(error => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(400, 'DUPLICATE_REFERENCE', 'That payment reference is already recorded');
    throw error;
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
  if (options.overdue) return listOverdueInvoices(options, page, pageSize);

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
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
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

async function listOverdueInvoices(options: ListInvoicesOptions, page: number, pageSize: number) {
  const include = { lines: true, payments: true, discountRedemptions: { include: { discount: true } },
    customer: { select: { id: true, name: true, email: true, company: true } } } as const;
  return db.$transaction(async tx => {
    const scope = Prisma.sql`i.status = 'CONFIRMED' AND i.dueDate < ${new Date()}
      AND i.totalMinor > COALESCE((SELECT SUM(p.amountMinor) FROM Payment p WHERE p.invoiceId = i.id),0)
      ${options.customerId ? Prisma.sql`AND i.customerId = ${options.customerId}` : Prisma.empty}
      ${options.status && options.status !== 'CONFIRMED' ? Prisma.sql`AND 0=1` : Prisma.empty}`;
    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM Invoice i WHERE ${scope}`);
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT i.id FROM Invoice i WHERE ${scope}
      ORDER BY i.dueDate ASC, i.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
    const invoices = await tx.invoice.findMany({ where: { id: { in: ids.map(row => row.id) } }, include,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] });
    return { page, pageSize, total: Number(count.total), items: invoices.map(invoice => {
      const paidAmountMinor = invoice.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
      return { ...invoice, paidAmountMinor, remainingBalanceMinor: Math.max(0, invoice.totalMinor - paidAmountMinor), isOverdue: true };
    }) };
  });
}

export async function getInvoiceById(id: string, customerId?: string) {
  const invoice = await db.invoice.findFirst({
    where: { id, ...(customerId ? { customerId } : {}) },
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

  // Cross-customer security isolation: reject if customerId does not match
  if (customerId && invoice.customerId !== customerId) {
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

export async function getPrintableInvoice(id: string, customerId?: string) {
  const invoice = await getInvoiceById(id, customerId);
  return {
    invoice: customerId ? customerInvoice(invoice) : invoice,
    printable: true,
  };
}

export async function sendInvoiceEmail(invoiceId: string) {
  const invoice = await getInvoiceById(invoiceId);
  const recipient = invoice.customerEmail || invoice.customer?.email;
  if (!recipient) {
    throw new HttpError(400, 'NO_RECIPIENT_EMAIL', 'Invoice does not have a customer email');
  }

  const subject = `Invoice ${invoice.number} from Brightloop`;

  const formattedSubtotal = (invoice.subtotalMinor / 100).toFixed(2);
  const formattedDiscount = (invoice.discountMinor / 100).toFixed(2);
  const formattedTax = (invoice.taxMinor / 100).toFixed(2);
  const formattedTotal = (invoice.totalMinor / 100).toFixed(2);
  const formattedPaid = (invoice.paidAmountMinor / 100).toFixed(2);
  const formattedBalance = (invoice.remainingBalanceMinor / 100).toFixed(2);
  const issuedDate = new Date(invoice.issuedAt).toISOString().split('T')[0];
  const dueDate = new Date(invoice.dueDate).toISOString().split('T')[0];
  const periodStart = new Date(invoice.periodStart).toISOString().split('T')[0];
  const periodEnd = new Date(invoice.periodEnd).toISOString().split('T')[0];

  const lineItemsText = invoice.lines
    .map(line => `  • ${line.description} (Qty: ${line.quantity}, Unit: ₹${(line.unitPriceMinor / 100).toFixed(2)}) - ₹${(line.amountMinor / 100).toFixed(2)}`)
    .join('\n');

  const text = [
    `Brightloop Software - Invoice ${invoice.number}`,
    `====================================================`,
    `Customer: ${invoice.customerName}`,
    `Email: ${recipient}`,
    invoice.customerAddress ? `Address: ${invoice.customerAddress}` : '',
    `Billing Period: ${periodStart} to ${periodEnd}`,
    `Issue Date: ${issuedDate}`,
    `Due Date: ${dueDate}`,
    `Status: ${invoice.status}`,
    ``,
    `Line Items:`,
    lineItemsText,
    ``,
    `Subtotal: ₹${formattedSubtotal}`,
    invoice.discountMinor > 0 ? `Discount: -₹${formattedDiscount}` : '',
    `Tax: ₹${formattedTax}`,
    `Total: ₹${formattedTotal}`,
    `Paid: ₹${formattedPaid}`,
    `Remaining Balance: ₹${formattedBalance}`,
    ``,
    `Thank you for subscribing to Brightloop!`,
  ].filter(Boolean).join('\n');

  const lineItemsHtml = invoice.lines
    .map(line => `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(line.description)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${line.quantity}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">₹${(line.unitPriceMinor / 100).toFixed(2)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">₹${(line.amountMinor / 100).toFixed(2)}</td>
    </tr>`)
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Invoice ${escapeHtml(invoice.number)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; line-height: 1.5; padding: 24px; max-width: 650px; margin: 0 auto;">
  <div style="border-bottom: 2px solid #133c35; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: baseline;">
    <h1 style="color: #133c35; margin: 0; font-size: 24px;">Brightloop Software</h1>
    <span style="font-size: 14px; color: #6b7280;">Invoice #${escapeHtml(invoice.number)}</span>
  </div>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; background: #f9fafb; padding: 16px; border-radius: 8px;">
    <div>
      <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Billed To</div>
      <div style="font-weight: 600; font-size: 15px;">${escapeHtml(invoice.customerName)}</div>
      <div style="color: #4b5563; font-size: 14px;">${escapeHtml(recipient)}</div>
      ${invoice.customerAddress ? `<div style="color: #4b5563; font-size: 14px;">${escapeHtml(invoice.customerAddress)}</div>` : ''}
    </div>
    <div>
      <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Invoice Details</div>
      <div style="font-size: 14px;"><strong>Issue Date:</strong> ${issuedDate}</div>
      <div style="font-size: 14px;"><strong>Due Date:</strong> ${dueDate}</div>
      <div style="font-size: 14px;"><strong>Status:</strong> ${invoice.status}</div>
    </div>
  </div>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
    <thead>
      <tr style="background: #f3f4f6; text-align: left;">
        <th style="padding: 8px 12px;">Description</th>
        <th style="padding: 8px 12px; text-align: center;">Qty</th>
        <th style="padding: 8px 12px; text-align: right;">Unit Price</th>
        <th style="padding: 8px 12px; text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>${lineItemsHtml}</tbody>
  </table>
  <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
    <div style="min-width: 220px; font-size: 14px;">
      <div style="display: flex; justify-content: space-between; padding: 4px 0;"><span>Subtotal:</span><span>₹${formattedSubtotal}</span></div>
      ${invoice.discountMinor > 0 ? `<div style="display: flex; justify-content: space-between; padding: 4px 0; color: #047857;"><span>Discount:</span><span>-₹${formattedDiscount}</span></div>` : ''}
      <div style="display: flex; justify-content: space-between; padding: 4px 0;"><span>Tax:</span><span>₹${formattedTax}</span></div>
      <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 2px solid #133c35; font-weight: 700; font-size: 16px; color: #133c35;"><span>Total:</span><span>₹${formattedTotal}</span></div>
      <div style="display: flex; justify-content: space-between; padding: 4px 0; color: #059669;"><span>Total Paid:</span><span>₹${formattedPaid}</span></div>
      <div style="display: flex; justify-content: space-between; padding: 4px 0; font-weight: 600; color: ${invoice.remainingBalanceMinor > 0 ? '#b91c1c' : '#047857'};"><span>Remaining Balance:</span><span>₹${formattedBalance}</span></div>
    </div>
  </div>
  <footer style="border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 12px; color: #6b7280; text-align: center;">
    Brightloop Software &bull; Subscription Billing &bull; Thank you for your business.
  </footer>
</body>
</html>`;

  await sendMail({
    to: recipient,
    subject,
    text,
    html,
  });

  const now = new Date();
  await db.invoice.update({
    where: { id: invoice.id },
    data: { sentAt: now },
  });

  return {
    sent: true,
    sentAt: now,
    recipient,
    deliveryMode: (process.env.MAIL_MODE ?? 'file') === 'file' ? 'file' : 'smtp',
  };
}

type InvoiceForCustomer = Prisma.InvoiceGetPayload<{ include: { lines: true; payments: true;
  discountRedemptions: { include: { discount: true } } } }> & {
    paidAmountMinor: number; remainingBalanceMinor: number; isOverdue: boolean;
  };
// Explicit response fields prevent staff notes, commercial thresholds and internal
// relations from silently becoming part of the customer's portal as models evolve.
export function customerInvoice(invoice: InvoiceForCustomer) {
  const { id, number, customerId, customerName, customerEmail, customerAddress, status,
    periodStart, periodEnd, issuedAt, dueDate, subtotalMinor, discountMinor, taxMinor,
    totalMinor, sentAt, paidAmountMinor, remainingBalanceMinor, isOverdue } = invoice;
  return { id, number, customerId, customerName, customerEmail, customerAddress, status,
    periodStart, periodEnd, issuedAt, dueDate, subtotalMinor, discountMinor, taxMinor,
    totalMinor, sentAt, paidAmountMinor, remainingBalanceMinor, isOverdue,
    lines: invoice.lines.map(({ id, productId, description, quantity, unitPriceMinor, discountMinor, taxRateBps, taxMinor, amountMinor }) => ({ id, productId, description, quantity, unitPriceMinor, discountMinor, taxRateBps, taxMinor, amountMinor })),
    payments: invoice.payments.map(({ id, amountMinor, method, paidAt }) => ({ id, amountMinor, method, paidAt })),
    discountRedemptions: invoice.discountRedemptions.map(({ amountMinor, discount }) => ({ amountMinor,
      discount: { name: discount.name, kind: discount.kind, value: discount.value } })),
  };
}

function invoiceBalances<T extends { totalMinor: number; status: string; dueDate: Date; payments: { amountMinor: number }[] }>(invoice: T) {
  const paidAmountMinor = invoice.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const remainingBalanceMinor = Math.max(0, invoice.totalMinor - paidAmountMinor);
  return { ...invoice, paidAmountMinor, remainingBalanceMinor,
    isOverdue: invoice.status === 'CONFIRMED' && invoice.dueDate < new Date() && remainingBalanceMinor > 0 };
}
