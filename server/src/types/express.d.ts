import type { PublicUser } from '../../../shared/contracts.js';

declare global {
  namespace Express {
    interface Request { user?: PublicUser }
  }
}
export {};
