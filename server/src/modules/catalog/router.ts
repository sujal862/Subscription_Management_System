import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { HttpError, asyncRoute } from '../../lib/http.js';
import type { Request, Response, RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';

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
    .min(0, 'Sales price cannot be negative'),
  costPriceMinor: z.number()
    .int('Cost price must be an integer paise amount')
    .min(0, 'Cost price cannot be negative')
    .default(0),
  notes: z.string().trim().max(2000, 'Notes cannot exceed 2000 characters').nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name cannot be empty').max(255).optional(),
  type: z.string().trim().min(1, 'Product type cannot be empty').optional(),
  salesPriceMinor: z.number().int('Sales price must be an integer paise amount').min(0, 'Sales price cannot be negative').optional(),
  costPriceMinor: z.number().int('Cost price must be an integer paise amount').min(0, 'Cost price cannot be negative').optional(),
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
    .int('Price adjustment must be an integer paise amount')
    .default(0),
  isActive: z.boolean().optional().default(true),
});

const updateVariantSchema = z.object({
  name: z.string().trim().min(1, 'Variant name cannot be empty').max(255).optional(),
  priceAdjustmentMinor: z.number().int('Price adjustment must be an integer paise amount').optional(),
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
    .min(0, 'Plan price cannot be negative'),
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
  priceMinor: z.number().int('Plan price must be an integer paise amount').min(0, 'Plan price cannot be negative').optional(),
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
// Plan Endpoints
// ---------------------------------------------------------------------------

// GET /plans - List plans with pagination, filters, and linked product (STAFF or ADMIN)
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

// POST /plans - Create recurring plan (ADMIN only)
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

// PATCH /plans/:id - Update plan (ADMIN only)
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
// Pending catalog features for future hours (return 501 as required)
// ---------------------------------------------------------------------------

catalogRouter.all(['/taxes', '/taxes/*'], (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Tax rules are not implemented yet.' } });
});

catalogRouter.all(['/discounts', '/discounts/*'], (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Discounts are not implemented yet.' } });
});
