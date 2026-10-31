import 'dotenv/config';
import { signupSchema } from '../shared/auth.js';
import { db } from '../server/src/lib/db.js';
import { hashPassword } from '../server/src/lib/password.js';

try {
  const parsed = signupSchema.safeParse({
    name: process.env.ADMIN_NAME ?? 'Administrator', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
  });
  if (!parsed.success) throw new Error('Set ADMIN_EMAIL, ADMIN_NAME and a valid ADMIN_PASSWORD in your private .env before running this command.');
  const { name, email, password } = parsed.data;
  const existing = await db.user.findUnique({ where: { email } });
  const customer = await db.customer.findUnique({ where: { email } });
  if (existing || customer) throw new Error('That email is already in use. Existing accounts are never promoted or overwritten by this command.');
  await db.user.create({ data: { name, email, role: 'ADMIN', passwordHash: await hashPassword(password) } });
  console.log('Administrator created. Sign in with the credentials configured in your private environment.');
} catch (error) {
  console.error(error instanceof Error && !(error.name.startsWith('Prisma')) ? error.message : 'Administrator creation failed. Check local configuration and database availability.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
