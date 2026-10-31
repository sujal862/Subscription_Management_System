import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { signupSchema } from '../../../../shared/auth.js';
import { db } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { hashPassword } from '../../lib/password.js';
import { requireRole } from '../../middleware/auth.js';
import { publicUser } from '../auth/session.js';

export const staffRouter = Router();
staffRouter.use(requireRole('ADMIN'));
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(''),
}).strict();

staffRouter.get('/', asyncRoute(async (req, res) => {
  const { page, pageSize, search } = listSchema.parse(req.query);
  const where: Prisma.UserWhereInput = {
    role: 'STAFF', ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
  };
  const [total, users] = await db.$transaction([
    db.user.count({ where }),
    db.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ data: { items: users.map(publicUser), page, pageSize, total } });
}));

staffRouter.post('/', asyncRoute(async (req, res) => {
  const { name, email, password } = signupSchema.parse(req.body);
  const passwordHash = await hashPassword(password);
  try {
    const user = await db.user.create({ data: { name, email, passwordHash, role: 'STAFF' } });
    res.status(201).json({ data: publicUser(user) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
    }
    throw error;
  }
}));
