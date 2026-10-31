import { Router } from 'express';
import { subscriptionPortalRouter } from '../subscriptions/router.js';
import { billingPortalRouter } from '../billing/router.js';
// Stable mount points; owners edit their own child routers, not this file.
export const portalRouter = Router();
portalRouter.use('/subscriptions', subscriptionPortalRouter);
portalRouter.use('/invoices', billingPortalRouter);
