import type { RequestHandler } from 'express';
import { config } from '../lib/config.js';
import { HttpError } from '../lib/http.js';

// Browser mutations must come from the configured application origins. CLI/API
// clients may omit Origin; SameSite cookies and Fetch Metadata protect browsers.
export const requireSafeOrigin: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if ((origin !== undefined && !config.allowedOrigins.includes(origin)) || req.get('sec-fetch-site') === 'cross-site') {
    return next(new HttpError(403, 'INVALID_ORIGIN', 'Request origin is not allowed'));
  }
  next();
};
