import type { NextFunction, Request, Response } from '@tinyhttp/app';
import { cors } from '@tinyhttp/cors';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

import { HTTP_STATUS, HTTP_STATUS_CODE } from './enums.js';
import { BadRequestError, HttpError, UnauthorizedError } from './errors.js';
import type JsonDataManager from './json-data-manager.js';
import type { ServerConfig } from './types.js';
import { generateResponse, verifyToken } from './utils.js';

// Error handler
export const errorHandler = (
  err: Error | HttpError,
  req: Request,
  res: Response
) => {
  console.error(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json(
      generateResponse(req, {
        errors: [{ code: err.code, message: err.message }],
      })
    );
  }

  return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(
    generateResponse(req, {
      errors: [
        { code: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR, message: err.message },
      ],
    })
  );
};

// Not found handler
export const notFoundHandler = (req: Request, res: Response) => {
  return res.status(HTTP_STATUS.NOT_FOUND).json(
    generateResponse(req, {
      errors: [
        {
          code: HTTP_STATUS_CODE.NOT_FOUND,
          message: 'The resource that you are looking for is not found!',
        },
      ],
    })
  );
};

// Request logger
export const requestMeta = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const requestId = uuidv4();
  const timestamp = new Date().toISOString();
  req['request_id'] = requestId;
  req['timestamp'] = timestamp;

  next();
};

// CORS middleware
export const corsMiddleware = (config?: ServerConfig) =>
  cors({
    origin:
      config?.corsOrigin?.split(',').map(o => o.trim()) ??
      (process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || '*'),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-source'],
    maxAge: 86400, // 24 hours
    credentials: true,
  });

export const bodyParserMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (
    req.headers['content-type'] !== 'application/json' ||
    !['POST', 'PUT', 'PATCH', 'OPTIONS'].includes(req.method)
  ) {
    return next();
  }

  let data = '';

  req.on('data', chunk => {
    data += chunk;
  });

  req.on('end', () => {
    try {
      req.body = JSON.parse(data || '{}');
      next();
    } catch (error) {
      next(new BadRequestError(error?.message || 'Invalid JSON'));
    }
  });

  req.on('error', error => {
    next(new BadRequestError(error?.message || 'Error reading request body'));
  });
};

// Rate limiter middleware
export const rateLimiterMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Authentication middleware
export const isAuthenticated =
  (dataManager: JsonDataManager, enabled = true) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const authorizationHeader = req.headers['authorization'];
    if (!authorizationHeader) {
      throw new UnauthorizedError(
        'You are not authorized to access this resource'
      );
    }

    const token = authorizationHeader.split(' ')[1];

    try {
      const {
        decoded,
        user: { password, ...user },
      } = await verifyToken(token, dataManager);
      req['user'] = user;

      next();
    } catch (error) {
      if (enabled) {
        throw new UnauthorizedError('Invalid token');
      }
      next();
    }
  };

// Authorization middleware (example for admin role)
export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  // Assuming you have a user object attached to the request after authentication
  const user = req['user'];
  if (!user || user.role !== 'admin') {
    throw new UnauthorizedError(
      'You do not have permission to access this resource'
    );
  }
  next();
};

// Security headers middleware
export const securityHeadersMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const request_id = req['request_id'];
  const timestamp = req['timestamp'];

  res.setHeader('X-Request-Id', request_id);
  res.setHeader('X-Request-Timestamp', timestamp);
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Enable HSTS only if the connection is secure
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  next();
};

// Error handling wrapper for async route handlers
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
