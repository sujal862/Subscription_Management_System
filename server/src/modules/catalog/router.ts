import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { HttpError, asyncRoute } from '../../lib/http.js';
import type { Request, Response, RequestHandler } from 'express';
import type { PublicUser } from '../../../../shared/contracts.js';
import type { Prisma } from '@prisma/client';

export const catalogRouter = Router();

// Authorization middleware helpers for catalog
const requireStaffOrAdmin: RequestHandler = (req, _res, next) => {
  const user = (req as Request & { user?: PublicUser }).user;
  if (!user) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required to access the catalog.'));
  }
  if (user.role === 'CUSTOMER') {
    return next(new HttpError(403, 'FORBIDDEN', 'Customer access to catalog management is not permitted.'));
  }
  next();
};

const requireAdmin: RequestHandler = (req, _res, next) => {
  const user = (req as Request & { user?: PublicUser }).user;
  if (!user) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required to access the catalog.'));
  }
  if (user.role !== 'ADMIN') {
    return next(new HttpError(403, 'FORBIDDEN', 'Only administrators can perform catalog mutations.'));
  }
  next();
};

// Zod schemas for Product validation
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

// GET /products - List products with pagination (STAFF or ADMIN)
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

// GET /products/:id - Single product details (STAFF or ADMIN)
catalogRouter.get('/products/:id', requireStaffOrAdmin, asyncRoute(async (req: Request, res: Response) => {
  const product = await db.product.findUnique({
    where: { id: req.params.id },
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
  });
  res.json({ data: updated });
}));

// Pending catalog features for future hours (return 501 as required)
catalogRouter.all(['/products/:id/variants', '/products/:id/variants/*'], (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Product variants are not implemented yet.' } });
});
catalogRouter.all(['/plans', '/plans/*'], (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Plans management is not implemented yet.' } });
});
catalogRouter.all(['/taxes', '/taxes/*'], (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Tax rules are not implemented yet.' } });
});
catalogRouter.all(['/discounts', '/discounts/*'], (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Discounts are not implemented yet.' } });
});
