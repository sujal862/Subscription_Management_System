import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { HttpError, asyncRoute } from '../../lib/http.js';
import { selectBestEligibleDiscount } from '../billing/discounts.js';
import type { Request, Response, RequestHandler } from 'express';
import type { Prisma, DiscountKind, DiscountScope } from '@prisma/client';

export const catalogRouter = Router();

// Authorization middleware helpers for catalog
const requireStaffOrAdmin: RequestHandler = (req, _res, next) => {
  const user = req.user;
  if (!user) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required to access the catalog.'));
  }
  if (user.role === 'CUSTOMER') {
    return next(new HttpError(403, 'FORBIDDEN', 'Customer access to catalog management is not permitted.'));
  }
  next();
};

const requireAdmin: RequestHandler = (req, _res, next) => {
  const user = req.user;
  if (!user) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required to access the catalog.'));
  }
  if (user.role !== 'ADMIN') {
    return next(new HttpError(403, 'FORBIDDEN', 'Only administrators can perform catalog mutations.'));
  }
  next();
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createProductSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Product name cannot be empty')
    .max(255, 'Product name cannot exceed 255 characters'),
  type: z.string()
    .trim()
    .min(1, 'Product type cannot be empty')
    .default('SOFTWARE'),
  salesPriceMinor: z.number()
    .int('Sales price must be an integer paise amount')
    .min(0, 'Sales price cannot be negative').max(2147483647),
  costPriceMinor: z.number()
    .int('Cost price must be an integer paise amount')
    .min(0, 'Cost price cannot be negative').max(2147483647)
    .default(0),
  notes: z.string().trim().max(2000, 'Notes cannot exceed 2000 characters').nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name cannot be empty').max(255).optional(),
  type: z.string().trim().min(1, 'Product type cannot be empty').optional(),
  salesPriceMinor: z.number().int('Sales price must be an integer paise amount').min(0, 'Sales price cannot be negative').max(2147483647).optional(),
  costPriceMinor: z.number().int('Cost price must be an integer paise amount').min(0, 'Cost price cannot be negative').max(2147483647).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  type: z.string().trim().optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

const createVariantSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Variant name cannot be empty')
    .max(255, 'Variant name cannot exceed 255 characters'),
  priceAdjustmentMinor: z.number()
    .int('Price adjustment must be an integer paise amount').min(-2147483648).max(2147483647)
    .default(0),
  isActive: z.boolean().optional().default(true),
});

const updateVariantSchema = z.object({
  name: z.string().trim().min(1, 'Variant name cannot be empty').max(255).optional(),
  priceAdjustmentMinor: z.number().int('Price adjustment must be an integer paise amount').min(-2147483648).max(2147483647).optional(),
  isActive: z.boolean().optional(),
});

const dateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(val => {
    const d = new Date(`${val}T00:00:00.000Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === val;
  }, 'Invalid calendar date')
  .transform(val => new Date(`${val}T00:00:00.000Z`));

const createPlanSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Plan name cannot be empty')
    .max(255, 'Plan name cannot exceed 255 characters'),
  productId: z.string().min(1, 'Product ID is required'),
  priceMinor: z.number()
    .int('Plan price must be an integer paise amount')
    .min(0, 'Plan price cannot be negative').max(2147483647),
  interval: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  minimumQuantity: z.number()
    .int('Minimum quantity must be an integer')
    .min(1, 'Minimum quantity must be at least 1')
    .default(1),
  availableFrom: dateStringSchema.nullable().optional(),
  availableUntil: dateStringSchema.nullable().optional(),
  autoClose: z.boolean().optional().default(true),
  allowEarlyClose: z.boolean().optional().default(true),
  allowPause: z.boolean().optional().default(false),
  allowRenew: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
}).refine(data => {
  if (data.availableFrom && data.availableUntil) {
    return data.availableUntil >= data.availableFrom;
  }
  return true;
}, {
  message: 'availableUntil must be on or after availableFrom',
  path: ['availableUntil'],
});

const updatePlanSchema = z.object({
  name: z.string().trim().min(1, 'Plan name cannot be empty').max(255).optional(),
  productId: z.string().min(1).optional(),
  priceMinor: z.number().int('Plan price must be an integer paise amount').min(0, 'Plan price cannot be negative').max(2147483647).optional(),
  interval: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  minimumQuantity: z.number().int('Minimum quantity must be an integer').min(1, 'Minimum quantity must be at least 1').optional(),
  availableFrom: dateStringSchema.nullable().optional(),
  availableUntil: dateStringSchema.nullable().optional(),
  autoClose: z.boolean().optional(),
  allowEarlyClose: z.boolean().optional(),
  allowPause: z.boolean().optional(),
  allowRenew: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const listPlansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  productId: z.string().trim().optional(),
  interval: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  availableAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Tax rule schemas (basis points: 0 to 10000; 1800 = 18%)
const createTaxSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Tax rule name cannot be empty')
    .max(255, 'Tax rule name cannot exceed 255 characters'),
  rateBps: z.number()
    .int('Tax rate must be an integer basis point value')
    .min(0, 'Tax rate cannot be negative')
    .max(10000, 'Tax rate cannot exceed 10000 basis points (100%)'),
  isActive: z.boolean().optional().default(true),
});

const updateTaxSchema = z.object({
  name: z.string().trim().min(1, 'Tax rule name cannot be empty').max(255).optional(),
  rateBps: z.number()
    .int('Tax rate must be an integer basis point value')
    .min(0, 'Tax rate cannot be negative')
    .max(10000, 'Tax rate cannot exceed 10000 basis points (100%)')
    .optional(),
  isActive: z.boolean().optional(),
});

const listTaxesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

// Discount rule schemas (Step 5)
// PERCENTAGE: basis points (0 to 10000; 1000 = 10%)
// FIXED: paise (> 0)
const isoDateTimeSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).transform(val => new Date(val));

const createDiscountSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Discount rule name cannot be empty')
    .max(255, 'Discount rule name cannot exceed 255 characters'),
  kind: z.enum(['FIXED', 'PERCENTAGE'] as const),
  scope: z.enum(['PRODUCT', 'SUBSCRIPTION'] as const),
  value: z.number()
    .int('Discount value must be an integer')
    .min(0, 'Discount value cannot be negative').max(2147483647),
  productId: z.string().trim().nullable().optional(),
  minimumPurchaseMinor: z.number()
    .int('Minimum purchase must be an integer paise amount')
    .min(0, 'Minimum purchase cannot be negative').max(2147483647)
    .default(0),
  minimumQuantity: z.number()
    .int('Minimum quantity must be an integer')
    .min(1, 'Minimum quantity must be at least 1')
    .default(1),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.nullable().optional(),
  usageLimit: z.number()
    .int('Usage limit must be an integer')
    .min(1, 'Usage limit must be at least 1').max(2147483647)
    .nullable()
    .optional(),
  isActive: z.boolean().optional().default(true),
}).strict().superRefine((data, ctx) => {
  if (data.kind === 'PERCENTAGE' && data.value > 10000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Percentage discount cannot exceed 10000 basis points (100%)',
      path: ['value'],
    });
  }
  if (data.scope === 'PRODUCT') {
    if (!data.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Product-scoped discount requires a valid productId',
        path: ['productId'],
      });
    }
  } else if (data.scope === 'SUBSCRIPTION') {
    if (data.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Whole-subscription scoped discount cannot specify a productId',
        path: ['productId'],
      });
    }
  }
  if (data.endsAt && data.startsAt && data.endsAt < data.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endsAt must be on or after startsAt',
      path: ['endsAt'],
    });
  }
});

const updateDiscountSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  kind: z.enum(['FIXED', 'PERCENTAGE'] as const).optional(),
  scope: z.enum(['PRODUCT', 'SUBSCRIPTION'] as const).optional(),
  value: z.number().int().min(0).max(2147483647).optional(),
  productId: z.string().trim().nullable().optional(),
  minimumPurchaseMinor: z.number().int().min(0).max(2147483647).optional(),
  minimumQuantity: z.number().int().min(1).optional(),
  startsAt: isoDateTimeSchema.optional(),
  endsAt: isoDateTimeSchema.nullable().optional(),
  usageLimit: z.number().int().min(1).max(2147483647).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

const listDiscountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  scope: z.enum(['PRODUCT', 'SUBSCRIPTION'] as const).optional(),
  kind: z.enum(['FIXED', 'PERCENTAGE'] as const).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  productId: z.string().trim().optional(),
});

const previewDiscountSchema = z.object({
  lines: z.array(z.object({
    productId: z.string().min(1, 'Product ID is required'),
    quantity: z.number().int('Quantity must be an integer').min(1, 'Quantity must be at least 1'),
    unitPriceMinor: z.number().int('Unit price must be an integer paise amount').min(0),
    taxRateBps: z.number().int().min(0).max(10000).default(0),
  })).min(1, 'At least one line is required for eligibility preview').max(100).refine(lines =>
    lines.reduce((sum, line) => sum + BigInt(line.quantity) * BigInt(line.unitPriceMinor), 0n) <= 2147483647n, 'Preview total exceeds supported monetary range'),
  periodStart: isoDateTimeSchema.optional(),
});

// ---------------------------------------------------------------------------
// Product Endpoints
// ---------------------------------------------------------------------------

// GET /products - List products with pagination and variants (STAFF or ADMIN)
catalogRouter.get('/products', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const query = listProductsQuerySchema.parse(req.query);
  const where: Prisma.ProductWhereInput = {};

  if (query.search) {
    where.name = { contains: query.search };
  }
  if (query.type) {
    where.type = query.type;
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true';
  }

  const [total, items] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      include: {
        variants: {
          orderBy: { name: 'asc' },
        },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.json({
    data: {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  });
}));

// GET /products/:id - Single product details with variants (STAFF or ADMIN)
catalogRouter.get('/products/:id', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const product = await db.product.findUnique({
    where: { id: req.params.id },
    include: {
      variants: {
        orderBy: { name: 'asc' },
      },
    },
  });
  if (!product) {
    throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  }
  res.json({ data: product });
}));

// POST /products - Create product (ADMIN only)
catalogRouter.post('/products', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const data = createProductSchema.parse(req.body);
  const product = await db.product.create({
    data: {
      name: data.name,
      type: data.type,
      salesPriceMinor: data.salesPriceMinor,
      costPriceMinor: data.costPriceMinor,
      notes: data.notes ?? null,
      isActive: data.isActive,
    },
    include: {
      variants: true,
    },
  });
  res.status(201).json({ data: product });
}));

// PATCH /products/:id - Update product (ADMIN only)
catalogRouter.patch('/products/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.product.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  }
  const data = updateProductSchema.parse(req.body);
  const updated = await db.product.update({
    where: { id: req.params.id },
    data,
    include: {
      variants: {
        orderBy: { name: 'asc' },
      },
    },
  });
  res.json({ data: updated });
}));

// DELETE /products/:id - Archive product instead of deleting financial history (ADMIN only)
catalogRouter.delete('/products/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.product.findUnique({
    where: { id: req.params.id },
    include: {
      _count: {
        select: {
          subscriptionLines: true,
          templateLines: true,
          plans: true,
        },
      },
    },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  }

  // Always archive to protect financial history and referenced models
  const archived = await db.product.update({
    where: { id: req.params.id },
    data: { isActive: false },
    include: { variants: true },
  });

  res.json({
    data: {
      ...archived,
      archived: true,
      message: 'Product archived to preserve financial history and subscription integrity.',
    },
  });
}));

// POST /products/:id/archive - Explicit archive endpoint (ADMIN only)
catalogRouter.post('/products/:id/archive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.product.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  const updated = await db.product.update({
    where: { id: req.params.id },
    data: { isActive: false },
    include: { variants: true },
  });
  res.json({ data: updated });
}));

// POST /products/:id/unarchive - Explicit restore endpoint (ADMIN only)
catalogRouter.post('/products/:id/unarchive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.product.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  const updated = await db.product.update({
    where: { id: req.params.id },
    data: { isActive: true },
    include: { variants: true },
  });
  res.json({ data: updated });
}));

// ---------------------------------------------------------------------------
// Variant Endpoints
// ---------------------------------------------------------------------------

// GET /products/:id/variants - List variants for product (STAFF or ADMIN)
catalogRouter.get('/products/:id/variants', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const product = await db.product.findUnique({
    where: { id: req.params.id },
  });
  if (!product) {
    throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  }

  const variants = await db.productVariant.findMany({
    where: { productId: req.params.id },
    orderBy: { name: 'asc' },
  });
  res.json({ data: variants });
}));

// POST /products/:id/variants - Add variant to product (ADMIN only)
catalogRouter.post('/products/:id/variants', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const product = await db.product.findUnique({
    where: { id: req.params.id },
  });
  if (!product) {
    throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  }

  const data = createVariantSchema.parse(req.body);

  const existing = await db.productVariant.findUnique({
    where: {
      productId_name: {
        productId: req.params.id,
        name: data.name,
      },
    },
  });
  if (existing) {
    throw new HttpError(409, 'CONFLICT', `A variant with name "${data.name}" already exists for this product`);
  }

  const variant = await db.productVariant.create({
    data: {
      productId: req.params.id,
      name: data.name,
      priceAdjustmentMinor: data.priceAdjustmentMinor,
      isActive: data.isActive,
    },
  });
  res.status(201).json({ data: variant });
}));

// PATCH /products/:id/variants/:variantId - Update variant (ADMIN only)
catalogRouter.patch('/products/:id/variants/:variantId', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const product = await db.product.findUnique({
    where: { id: req.params.id },
  });
  if (!product) {
    throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  }

  const variant = await db.productVariant.findFirst({
    where: {
      id: req.params.variantId,
      productId: req.params.id,
    },
  });
  if (!variant) {
    throw new HttpError(404, 'NOT_FOUND', 'Variant not found for this product');
  }

  const data = updateVariantSchema.parse(req.body);

  if (data.name && data.name !== variant.name) {
    const conflict = await db.productVariant.findUnique({
      where: {
        productId_name: {
          productId: req.params.id,
          name: data.name,
        },
      },
    });
    if (conflict) {
      throw new HttpError(409, 'CONFLICT', `A variant with name "${data.name}" already exists for this product`);
    }
  }

  const updated = await db.productVariant.update({
    where: { id: req.params.variantId },
    data,
  });
  res.json({ data: updated });
}));

// ---------------------------------------------------------------------------
// Plan Endpoints (Lifecycle Controls & Availability Window)
// ---------------------------------------------------------------------------

// GET /plans - List plans with pagination, lifecycle controls, and filters (STAFF or ADMIN)
catalogRouter.get('/plans', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const query = listPlansQuerySchema.parse(req.query);
  const where: Prisma.PlanWhereInput = {};

  if (query.productId) {
    where.productId = query.productId;
  }
  if (query.interval) {
    where.interval = query.interval;
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true';
  }
  if (query.availableAt) {
    const targetDate = new Date(`${query.availableAt}T00:00:00.000Z`);
    where.AND = [
      { OR: [{ availableFrom: null }, { availableFrom: { lte: targetDate } }] },
      { OR: [{ availableUntil: null }, { availableUntil: { gte: targetDate } }] },
    ];
  }
  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { product: { name: { contains: query.search } } },
    ];
  }

  const [total, items] = await Promise.all([
    db.plan.count({ where }),
    db.plan.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            type: true,
            salesPriceMinor: true,
            isActive: true,
            variants: {
              where: { isActive: true },
              select: { id: true, name: true, priceAdjustmentMinor: true, isActive: true },
            },
          },
        },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.json({
    data: {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  });
}));

// GET /plans/:id - Single plan details (STAFF or ADMIN)
catalogRouter.get('/plans/:id', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const plan = await db.plan.findUnique({
    where: { id: req.params.id },
    include: {
      product: {
        include: {
          variants: true,
        },
      },
    },
  });
  if (!plan) {
    throw new HttpError(404, 'NOT_FOUND', 'Plan not found');
  }
  res.json({ data: plan });
}));

// POST /plans - Create recurring plan with lifecycle flags (ADMIN only)
catalogRouter.post('/plans', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const data = createPlanSchema.parse(req.body);

  const product = await db.product.findUnique({
    where: { id: data.productId },
  });
  if (!product) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Referenced product does not exist');
  }

  const plan = await db.plan.create({
    data: {
      name: data.name,
      productId: data.productId,
      priceMinor: data.priceMinor,
      interval: data.interval,
      minimumQuantity: data.minimumQuantity,
      availableFrom: data.availableFrom ?? null,
      availableUntil: data.availableUntil ?? null,
      autoClose: data.autoClose,
      allowEarlyClose: data.allowEarlyClose,
      allowPause: data.allowPause,
      allowRenew: data.allowRenew,
      isActive: data.isActive,
    },
    include: {
      product: true,
    },
  });
  res.status(201).json({ data: plan });
}));

// PATCH /plans/:id - Update plan lifecycle controls and fields (ADMIN only)
catalogRouter.patch('/plans/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.plan.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Plan not found');
  }

  const data = updatePlanSchema.parse(req.body);

  if (data.productId) {
    const product = await db.product.findUnique({
      where: { id: data.productId },
    });
    if (!product) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Referenced product does not exist');
    }
  }

  // Validate date chronology against existing values if one is omitted
  const effectiveFrom = data.availableFrom !== undefined ? data.availableFrom : existing.availableFrom;
  const effectiveUntil = data.availableUntil !== undefined ? data.availableUntil : existing.availableUntil;
  if (effectiveFrom && effectiveUntil && effectiveUntil < effectiveFrom) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'availableUntil must be on or after availableFrom');
  }

  const updated = await db.plan.update({
    where: { id: req.params.id },
    data,
    include: {
      product: true,
    },
  });
  res.json({ data: updated });
}));

// DELETE /plans/:id - Archive plan instead of deleting financial history (ADMIN only)
catalogRouter.delete('/plans/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.plan.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Plan not found');
  }

  // Archive plan to preserve subscription snapshots and quotation template references
  const archived = await db.plan.update({
    where: { id: req.params.id },
    data: { isActive: false },
    include: { product: true },
  });

  res.json({
    data: {
      ...archived,
      archived: true,
      message: 'Plan archived to preserve subscription and billing history.',
    },
  });
}));

// POST /plans/:id/archive - Explicit archive endpoint (ADMIN only)
catalogRouter.post('/plans/:id/archive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.plan.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Plan not found');
  const updated = await db.plan.update({
    where: { id: req.params.id },
    data: { isActive: false },
    include: { product: true },
  });
  res.json({ data: updated });
}));

// POST /plans/:id/unarchive - Explicit restore endpoint (ADMIN only)
catalogRouter.post('/plans/:id/unarchive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.plan.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Plan not found');
  const updated = await db.plan.update({
    where: { id: req.params.id },
    data: { isActive: true },
    include: { product: true },
  });
  res.json({ data: updated });
}));

// ---------------------------------------------------------------------------
// Primary-Line Pricing Calculation / Verification Endpoint
// ---------------------------------------------------------------------------

// POST /pricing/calculate - Primary-line pricing rule calculation
// Rule:
//   Primary line (first line): Plan.priceMinor + variant adjustment
//   Add-on lines (subsequent lines): Product.salesPriceMinor + variant adjustment
//   Plan fee is never added twice.
catalogRouter.post('/pricing/calculate', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const schema = z.object({
    planId: z.string().min(1),
    lines: z.array(z.object({
      productId: z.string().min(1),
      variantId: z.string().nullable().optional(),
      quantity: z.number().int().min(1),
    })).min(1, 'At least one line is required'),
  });

  const input = schema.parse(req.body);
  const plan = await db.plan.findUnique({
    where: { id: input.planId },
    include: { product: true },
  });
  if (!plan) {
    throw new HttpError(404, 'NOT_FOUND', 'Plan not found');
  }

  // First line must match plan's product
  if (input.lines[0].productId !== plan.productId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'The first (primary) line must match the plan product');
  }
  if (input.lines[0].quantity < plan.minimumQuantity) {
    throw new HttpError(400, 'VALIDATION_ERROR', `The primary line requires at least ${plan.minimumQuantity} units`);
  }

  const productIds = Array.from(new Set(input.lines.map(l => l.productId)));
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: { variants: true },
  });

  const calculatedLines = input.lines.map((line, index) => {
    const isPrimary = index === 0;
    const product = products.find(p => p.id === line.productId);
    if (!product) {
      throw new HttpError(400, 'VALIDATION_ERROR', `Product ${line.productId} not found`);
    }

    const variant = line.variantId ? product.variants.find(v => v.id === line.variantId) : null;
    if (line.variantId && !variant) {
      throw new HttpError(400, 'VALIDATION_ERROR', `Variant ${line.variantId} does not belong to product "${product.name}"`);
    }

    // Agreed primary-line pricing rule:
    // Primary line defaults to Plan.priceMinor + variant adjustment
    // Add-on lines default to Product.salesPriceMinor + variant adjustment
    const basePriceMinor = isPrimary ? plan.priceMinor : product.salesPriceMinor;
    const variantAdjustmentMinor = variant?.priceAdjustmentMinor ?? 0;
    const unitPriceMinor = Math.max(0, basePriceMinor + variantAdjustmentMinor);
    const lineSubtotalMinor = unitPriceMinor * line.quantity;

    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      isPrimary,
      quantity: line.quantity,
      basePriceMinor,
      variantAdjustmentMinor,
      unitPriceMinor,
      subtotalMinor: lineSubtotalMinor,
      description: `${product.name}${variant ? ` — ${variant.name}` : ''}${isPrimary ? ` (${plan.name})` : ''}`,
    };
  });

  const subtotalMinor = calculatedLines.reduce((acc, l) => acc + l.subtotalMinor, 0);

  res.json({
    data: {
      planId: plan.id,
      planName: plan.name,
      interval: plan.interval,
      minimumQuantity: plan.minimumQuantity,
      lines: calculatedLines,
      subtotalMinor,
    },
  });
}));

// ---------------------------------------------------------------------------
// Tax Rules Endpoints (Step 4)
// ---------------------------------------------------------------------------

// GET /taxes - List tax rules with pagination (STAFF or ADMIN)
catalogRouter.get('/taxes', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const query = listTaxesQuerySchema.parse(req.query);
  const where: Prisma.TaxRuleWhereInput = {};

  if (query.search) {
    where.name = { contains: query.search };
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true';
  }

  const [total, items] = await Promise.all([
    db.taxRule.count({ where }),
    db.taxRule.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { rateBps: 'desc' },
    }),
  ]);

  res.json({
    data: {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  });
}));

// GET /taxes/:id - Single tax rule details (STAFF or ADMIN)
catalogRouter.get('/taxes/:id', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const taxRule = await db.taxRule.findUnique({
    where: { id: req.params.id },
  });
  if (!taxRule) {
    throw new HttpError(404, 'NOT_FOUND', 'Tax rule not found');
  }
  res.json({ data: taxRule });
}));

// POST /taxes - Create tax rule (ADMIN only)
catalogRouter.post('/taxes', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const data = createTaxSchema.parse(req.body);
  const taxRule = await db.taxRule.create({
    data: {
      name: data.name,
      rateBps: data.rateBps,
      isActive: data.isActive,
    },
  });
  res.status(201).json({ data: taxRule });
}));

// PATCH /taxes/:id - Update tax rule (ADMIN only)
// Note: Future catalog edits must not rewrite issued invoices or snapshot history.
catalogRouter.patch('/taxes/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.taxRule.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Tax rule not found');
  }

  const data = updateTaxSchema.parse(req.body);
  const updated = await db.taxRule.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ data: updated });
}));

// DELETE /taxes/:id - Archive tax rule instead of deleting financial history (ADMIN only)
catalogRouter.delete('/taxes/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.taxRule.findUnique({
    where: { id: req.params.id },
    include: {
      _count: {
        select: {
          subscriptionLines: true,
          templateLines: true,
        },
      },
    },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Tax rule not found');
  }

  // Archive tax rule to protect existing subscription/template lines
  const archived = await db.taxRule.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });

  res.json({
    data: {
      ...archived,
      archived: true,
      message: 'Tax rule archived to preserve financial records and historical calculations.',
    },
  });
}));

// POST /taxes/:id/archive - Explicit archive endpoint (ADMIN only)
catalogRouter.post('/taxes/:id/archive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.taxRule.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Tax rule not found');
  const updated = await db.taxRule.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ data: updated });
}));

// POST /taxes/:id/unarchive - Explicit restore endpoint (ADMIN only)
catalogRouter.post('/taxes/:id/unarchive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.taxRule.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Tax rule not found');
  const updated = await db.taxRule.update({
    where: { id: req.params.id },
    data: { isActive: true },
  });
  res.json({ data: updated });
}));

// ---------------------------------------------------------------------------
// Discount Rules Endpoints (Step 5)
// ---------------------------------------------------------------------------

// POST /discounts/preview - Read-only eligibility preview (STAFF or ADMIN)
// Evaluates active discount rules using Member 4's deterministic 1-discount policy.
// Does NOT mutate database, increment redemptions, or alter invoice transactions.
catalogRouter.post('/discounts/preview', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const data = previewDiscountSchema.parse(req.body);
  const periodStart = data.periodStart ?? new Date();

  // Load all active discount rules
  const candidateRules = await db.discountRule.findMany({
    where: { isActive: true },
    include: {
      product: {
        select: { id: true, name: true, type: true, salesPriceMinor: true, isActive: true },
      },
    },
  });

  const bestCandidate = selectBestEligibleDiscount(candidateRules, data.lines, periodStart);

  if (!bestCandidate) {
    return void res.json({
      data: {
        eligible: false,
        selectedDiscount: null,
        savingsMinor: 0,
        productLineIndex: null,
        policy: 'Deterministic single-discount policy (highest savings selected, discounts do not stack)',
        message: 'No active discount rules are eligible for this line combination and threshold.',
      },
    });
  }

  res.json({
    data: {
      eligible: true,
      selectedDiscount: bestCandidate.rule,
      savingsMinor: bestCandidate.savingsMinor,
      productLineIndex: bestCandidate.productLineIndex ?? null,
      policy: 'Deterministic single-discount policy (highest savings selected, discounts do not stack)',
    },
  });
}));

// GET /discounts - List discount rules with pagination and filters (STAFF or ADMIN)
catalogRouter.get('/discounts', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const query = listDiscountsQuerySchema.parse(req.query);
  const where: Prisma.DiscountRuleWhereInput = {};

  if (query.search) {
    where.name = { contains: query.search };
  }
  if (query.scope) {
    where.scope = query.scope;
  }
  if (query.kind) {
    where.kind = query.kind;
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true';
  }
  if (query.productId) {
    where.productId = query.productId;
  }

  const [total, items] = await Promise.all([
    db.discountRule.count({ where }),
    db.discountRule.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, type: true, salesPriceMinor: true, isActive: true },
        },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.json({
    data: {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  });
}));

// GET /discounts/:id - Single discount rule details (STAFF or ADMIN)
catalogRouter.get('/discounts/:id', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const discountRule = await db.discountRule.findUnique({
    where: { id: req.params.id },
    include: {
      product: {
        select: { id: true, name: true, type: true, salesPriceMinor: true, isActive: true },
      },
    },
  });
  if (!discountRule) {
    throw new HttpError(404, 'NOT_FOUND', 'Discount rule not found');
  }
  res.json({ data: discountRule });
}));

// POST /discounts - Create discount rule (ADMIN only)
catalogRouter.post('/discounts', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const data = createDiscountSchema.parse(req.body);

  if (data.scope === 'PRODUCT' && data.productId) {
    const product = await db.product.findUnique({ where: { id: data.productId } });
    if (!product) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Referenced product does not exist');
    }
  }

  const discountRule = await db.discountRule.create({
    data: {
      name: data.name,
      kind: data.kind,
      scope: data.scope,
      value: data.value,
      productId: data.scope === 'PRODUCT' ? data.productId : null,
      minimumPurchaseMinor: data.minimumPurchaseMinor,
      minimumQuantity: data.minimumQuantity,
      startsAt: data.startsAt,
      endsAt: data.endsAt ?? null,
      usageLimit: data.usageLimit ?? null,
      isActive: data.isActive,
    },
    include: {
      product: true,
    },
  });

  res.status(201).json({ data: discountRule });
}));

// PATCH /discounts/:id - Update discount rule (ADMIN only)
catalogRouter.patch('/discounts/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.discountRule.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Discount rule not found');
  }

  const data = updateDiscountSchema.parse(req.body);

  const effectiveKind = data.kind ?? existing.kind;
  const effectiveValue = data.value !== undefined ? data.value : existing.value;
  if (effectiveKind === 'PERCENTAGE' && effectiveValue > 10000) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Percentage discount cannot exceed 10000 basis points (100%)');
  }

  const effectiveScope = data.scope ?? existing.scope;
  let effectiveProductId = data.productId !== undefined ? data.productId : existing.productId;

  if (effectiveScope === 'PRODUCT') {
    if (!effectiveProductId) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Product-scoped discount requires a valid productId');
    }
    const product = await db.product.findUnique({ where: { id: effectiveProductId } });
    if (!product) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Referenced product does not exist');
    }
  } else {
    // Whole subscription scope cannot have productId
    effectiveProductId = null;
  }

  const effectiveStartsAt = data.startsAt ?? existing.startsAt;
  const effectiveEndsAt = data.endsAt !== undefined ? data.endsAt : existing.endsAt;
  if (effectiveEndsAt && effectiveStartsAt && effectiveEndsAt < effectiveStartsAt) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'endsAt must be on or after startsAt');
  }

  const updated = await db.discountRule.update({
    where: { id: req.params.id },
    data: {
      ...data,
      productId: effectiveProductId,
    },
    include: {
      product: true,
    },
  });

  res.json({ data: updated });
}));

// DELETE /discounts/:id - Archive discount rule instead of deleting financial history (ADMIN only)
catalogRouter.delete('/discounts/:id', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.discountRule.findUnique({
    where: { id: req.params.id },
    include: {
      _count: {
        select: {
          redemptions: true,
        },
      },
    },
  });
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Discount rule not found');
  }

  // Archive discount rule to protect financial records and historical redemption snapshots
  const archived = await db.discountRule.update({
    where: { id: req.params.id },
    data: { isActive: false },
    include: { product: true },
  });

  res.json({
    data: {
      ...archived,
      archived: true,
      message: 'Discount rule archived to preserve redemption history and financial integrity.',
    },
  });
}));

// POST /discounts/:id/archive - Explicit archive endpoint (ADMIN only)
catalogRouter.post('/discounts/:id/archive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.discountRule.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Discount rule not found');
  const updated = await db.discountRule.update({
    where: { id: req.params.id },
    data: { isActive: false },
    include: { product: true },
  });
  res.json({ data: updated });
}));

// POST /discounts/:id/unarchive - Explicit restore endpoint (ADMIN only)
catalogRouter.post('/discounts/:id/unarchive', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  const existing = await db.discountRule.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Discount rule not found');
  const updated = await db.discountRule.update({
    where: { id: req.params.id },
    data: { isActive: true },
    include: { product: true },
  });
  res.json({ data: updated });
}));
