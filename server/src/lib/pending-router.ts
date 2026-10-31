import { Router } from 'express';
export function pendingRouter(module: string) {
  const router = Router();
  router.use((_req, res) => res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: `${module} is assigned to its module owner and is not implemented yet.` } }));
  return router;
}
