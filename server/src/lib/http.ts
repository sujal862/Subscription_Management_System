import type { Request, Response, NextFunction, RequestHandler } from 'express';
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
