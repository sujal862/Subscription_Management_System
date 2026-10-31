import type { RequestHandler } from 'express';
import type { Role } from '../../../shared/contracts.js';
// Member 1 replaces these with real session authentication and role checks.
// Fail closed: incomplete authentication never grants access.
export const requireAuth: RequestHandler = (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Authentication is not implemented yet.' } });
};
export const requireRole = (..._roles: Role[]): RequestHandler => (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Authorization is not implemented yet.' } });
};
