import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { HttpError, asyncRoute } from '../../lib/http.js';
import { draftSchema, pageSchema, amounts } from './validation.js';

const invalid = (message: string): never => { throw new HttpError(400, 'VALIDATION_ERROR', message); };
const missing = (name: string): never => { throw new HttpError(404, 'NOT_FOUND', `${name} not found`); };
const lineSchema = draftSchema.shape.lines;
export const templateSchema = z.object({
  name: z.string().trim().min(1).max(200), planId: z.string().min(1),
  validDays: z.number().int().min(1).max(365).default(14),
  paymentTermDays: z.number().int().min(0).max(365).default(7), lines: lineSchema,
}).strict();
export const quotationSchema = z.object({
  templateId: z.string().min(1), customerId: z.string().min(1),
  startDate: draftSchema.shape.startDate, expiryDate: draftSchema.shape.expiryDate,
  planId: z.string().min(1).optional(),
}).strict().refine(value => !value.expiryDate || value.expiryDate > value.startDate, { path: ['expiryDate'], message: 'Expiry date must be after start date' });
const templateInclude = {
  plan: { select: { id: true, name: true, productId: true, interval: true } },
  lines: { orderBy: { id: 'asc' as const }, include: {
    product: { select: { name: true } }, variant: { select: { name: true } },
    taxRule: { select: { name: true, rateBps: true } },
  } },
} satisfies Prisma.QuotationTemplateInclude;
const quotationInclude = { customer: true, plan: { select: { id: true, name: true, interval: true, minimumQuantity: true } }, lines: true } as const;
type Line = z.infer<typeof lineSchema>[number];

// Templates have no position field. Put the plan product first on reads and copies;
// price is stored on each line, so catalog edits cannot add the plan fee again.
function primaryFirst<T extends { productId: string }>(lines: T[], productId: string): T[] {
  const index = lines.findIndex(line => line.productId === productId);
  if (index < 0) return invalid('Template must contain the plan product');
  return [lines[index], ...lines.filter((_, i) => i !== index)];
}
export async function validateQuotationLines(tx: Prisma.TransactionClient, planId: string, input: Line[], storedPrices = false, startDate?: Date) {
  const plan = await tx.plan.findUnique({ where: { id: planId }, include: { product: true } }) ?? missing('Plan');
  if (!plan.isActive || !plan.product.isActive) invalid('Plan and its product must be active');
  if (startDate && ((plan.availableFrom && startDate < plan.availableFrom) || (plan.availableUntil && startDate > plan.availableUntil))) invalid('Plan is unavailable on the selected start date');
  if (!input.length || input[0].productId !== plan.productId || input[0].quantity < plan.minimumQuantity) invalid('The first line must match the plan product and minimum quantity');
  const products = await tx.product.findMany({ where: { id: { in: input.map(line => line.productId) } }, include: { variants: true } });
  const taxes = await tx.taxRule.findMany({ where: { id: { in: input.flatMap(line => line.taxRuleId ? [line.taxRuleId] : []) } } });
  const lines = input.map((line, index) => {
    const product = products.find(item => item.id === line.productId);
    if (!product?.isActive) return invalid('Each product must exist and be active');
    const variant = line.variantId ? product.variants.find(item => item.id === line.variantId && item.isActive) : undefined;
    if (line.variantId && !variant) invalid('Variant must be active and belong to its product');
    const defaultPrice = (index === 0 ? plan.priceMinor : product.salesPriceMinor) + (variant?.priceAdjustmentMinor ?? 0);
    const unitPriceMinor = storedPrices ? line.unitPriceMinor! : defaultPrice;
    if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0 || unitPriceMinor > 2147483647) invalid('Invalid line price');
    if (!storedPrices && line.unitPriceMinor !== undefined && line.unitPriceMinor !== defaultPrice) invalid('Price overrides are unavailable; use the current catalog price');
    const tax = line.taxRuleId ? taxes.find(item => item.id === line.taxRuleId && item.isActive) : undefined;
    if (line.taxRuleId && !tax) invalid('Tax rule must exist and be active');
    if (tax && (tax.rateBps < 0 || tax.rateBps > 10000)) invalid('Invalid catalog tax rate');
    return { productId: product.id, variantId: variant?.id ?? null, quantity: line.quantity, unitPriceMinor, taxRuleId: tax?.id ?? null, taxRateBps: tax?.rateBps ?? 0, description: `${product.name}${variant ? ` — ${variant.name}` : ''}` };
  });
  amounts(lines);
  return { plan, lines };
}
function templateResult(template: Prisma.QuotationTemplateGetPayload<{ include: typeof templateInclude }>) {
  const lines = primaryFirst(template.lines, template.plan.productId).map(line => ({ ...line,
    description: `${line.product.name}${line.variant ? ` — ${line.variant.name}` : ''}`, taxRateBps: line.taxRule?.rateBps ?? 0,
  }));
  return { ...template, ...amounts(lines) };
}
export const templatesRouter = Router();
templatesRouter.get('/', asyncRoute(async (req, res) => {
  const { page, pageSize, search } = pageSchema.parse(req.query);
  const where: Prisma.QuotationTemplateWhereInput = search ? { OR: [{ name: { contains: search } }, { plan: { name: { contains: search } } }] } : {};
  const [total, items] = await db.$transaction([
    db.quotationTemplate.count({ where }),
    db.quotationTemplate.findMany({ where, include: { plan: { select: { id: true, name: true } }, _count: { select: { lines: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ data: { items, page, pageSize, total } });
}));
templatesRouter.get('/:id', asyncRoute(async (req, res) => {
  const item = await db.quotationTemplate.findUnique({ where: { id: req.params.id }, include: templateInclude }) ?? missing('Template');
  res.json({ data: templateResult(item) });
}));
templatesRouter.post('/', asyncRoute(async (req, res) => {
  const input = templateSchema.parse(req.body);
  const item = await db.$transaction(async tx => {
    const { lines } = await validateQuotationLines(tx, input.planId, input.lines);
    return tx.quotationTemplate.create({ data: { ...input, lines: { create: lines.map(({ description: _description, taxRateBps: _rate, ...line }) => line) } }, include: templateInclude });
  });
  res.status(201).json({ data: templateResult(item) });
}));
templatesRouter.patch('/:id', asyncRoute(async (req, res) => {
  // Zod applies inner defaults even inside partial objects; PATCH must not reset
  // validity or payment terms when the caller only edits the name.
  const patch = templateSchema.partial().extend({
    validDays: templateSchema.shape.validDays.removeDefault().optional(),
    paymentTermDays: templateSchema.shape.paymentTermDays.removeDefault().optional(),
  }).refine(value => Object.keys(value).length > 0, 'Provide at least one field').parse(req.body);
  const item = await db.$transaction(async tx => {
    const old = await tx.quotationTemplate.findUnique({ where: { id: req.params.id }, include: templateInclude }) ?? missing('Template');
    if (patch.planId && patch.planId !== old.planId && !patch.lines) invalid('Changing the plan requires replacement product lines');
    const planId = patch.planId ?? old.planId;
    const { lines } = await validateQuotationLines(tx, planId, patch.lines ?? primaryFirst(old.lines, old.plan.productId), !patch.lines);
    return tx.quotationTemplate.update({ where: { id: old.id }, data: { ...patch,
      ...(patch.lines ? { lines: { deleteMany: {}, create: lines.map(({ description: _description, taxRateBps: _rate, ...line }) => line) } } : { lines: undefined }),
    }, include: templateInclude });
  });
  res.json({ data: templateResult(item) });
}));
templatesRouter.delete('/:id', asyncRoute(async (req, res) => {
  // No subscription references templates: existing quotations own independent lines.
  const deleted = await db.quotationTemplate.deleteMany({ where: { id: req.params.id } });
  if (!deleted.count) missing('Template');
  res.json({ data: { id: req.params.id, deleted: true } });
}));

export async function createQuotation(input: z.infer<typeof quotationSchema>) {
  return db.$transaction(async tx => {
    if (!await tx.customer.findUnique({ where: { id: input.customerId } })) missing('Customer');
    const template = await tx.quotationTemplate.findUnique({ where: { id: input.templateId }, include: templateInclude }) ?? missing('Template');
    if (input.planId && input.planId !== template.planId) invalid('Selected plan does not match the template');
    const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
    const { plan, lines } = await validateQuotationLines(tx, template.planId, primaryFirst(template.lines, template.plan.productId), true, startDate);
    const quotationValidUntil = new Date(Date.now() + template.validDays * 86400000);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await tx.subscription.create({ data: {
          number: `SUB-${new Date().getUTCFullYear()}-${randomBytes(8).toString('hex').toUpperCase()}`,
          customerId: input.customerId, planId: plan.id, status: 'QUOTATION', startDate,
          expiryDate: input.expiryDate ? new Date(`${input.expiryDate}T00:00:00.000Z`) : null,
          paymentTermDays: template.paymentTermDays, billingInterval: plan.interval, quotationValidUntil, lines: { create: lines },
        }, include: quotationInclude });
        return { ...data, ...amounts(data.lines) };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    throw new HttpError(409, 'CONFLICT', 'Could not allocate a subscription number; please retry');
  });
}

export const transitionSchema = z.object({ action: z.literal('QUOTATION'), validDays: z.number().int().min(1).max(365).default(14) }).strict();
export async function quoteDraft(id: string, validDays: number) {
  return db.$transaction(async tx => {
    const draft = await tx.subscription.findUnique({ where: { id }, include: quotationInclude }) ?? missing('Subscription');
    if (draft.status !== 'DRAFT') throw new HttpError(409, 'INVALID_TRANSITION', 'Only a draft can become a quotation');
    if (!draft.lines.length) invalid('A quotation requires product lines');
    const plan = await tx.plan.findUnique({ where: { id: draft.planId } }) ?? missing('Plan');
    // Validate references again, but retain the draft's own price and tax snapshots.
    await validateQuotationLines(tx, draft.planId, primaryFirst(draft.lines, plan.productId), true, draft.startDate);
    amounts(draft.lines);
    const quotationValidUntil = new Date(Date.now() + validDays * 86400000);
    const changed = await tx.subscription.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'QUOTATION', quotationValidUntil } });
    if (!changed.count) throw new HttpError(409, 'INVALID_TRANSITION', 'Subscription status changed; refresh and retry');
    const updated = await tx.subscription.findUniqueOrThrow({ where: { id }, include: quotationInclude });
    return { ...updated, ...amounts(updated.lines) };
  });
}
