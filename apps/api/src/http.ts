import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import type { Logger } from './logger.js';

export class HttpError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export const err = (code: string, message: string, status = 400) => new HttpError(code, message, status);

export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId as string);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      logger.info('request.completed', {
        requestId: res.locals.requestId as string,
        method: req.method,
        // Express route templates redact tokens and order IDs. Never log originalUrl.
        route: typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    });
    next();
  };
}

export const notFound: RequestHandler = (_req, _res, next) => next(err('NOT_FOUND', 'Route not found', 404));

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) { next(error); return; }
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: { path: string; code: string }[] | undefined;
    if (error instanceof HttpError) {
      ({ status, code, message } = error);
    } else if (error instanceof z.ZodError) {
      status = 400; code = 'VALIDATION_ERROR'; message = 'Request validation failed';
      // Zod messages can embed user input (including credentials); return field paths/codes only.
      details = error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code }));
    } else if (error && typeof error === 'object' && 'type' in error) {
      if (error.type === 'entity.parse.failed') {
        status = 400; code = 'INVALID_JSON'; message = 'Request body must be valid JSON';
      } else if (error.type === 'entity.too.large') {
        status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body exceeds the size limit';
      } else if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
        status = 415; code = 'UNSUPPORTED_ENCODING'; message = 'Request encoding is unsupported';
      } else if (error.type === 'request.aborted' || error.type === 'request.size.invalid') {
        status = 400; code = 'INVALID_REQUEST'; message = 'Request body is incomplete';
      }
    }
    if (status >= 500) logger.error('request.failed', { requestId: res.locals.requestId as string, code, status });
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, requestId: res.locals.requestId });
  };
}
