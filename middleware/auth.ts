import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole } from '@prisma/client';
import { verifyAccessToken } from '../utils/jwt';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

const prisma = new PrismaClient();

// Define a user type for use in the middleware
interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  permissions?: string[];
}

// Extend Express Request type to include user information
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Middleware to authenticate a user using JWT
 * @param req Express request
 * @param res Express response
 * @param next Express next function
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get token from cookie, authorization header, or query parameter
    let token = req.cookies.accessToken;

    // If no token in cookie, check authorization header
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    // If still no token, check query parameter (for WebSocket connections)
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

    if (!token) {
      throw new UnauthorizedError('No authentication token provided');
    }

    // Verify token
    const decoded = await verifyAccessToken(token);

    // Set user in request object with the correct type
    const user: AuthenticatedUser = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      permissions: [] // Initialize with empty array
    };
    
    req.user = user;

    // If user is admin, fetch permissions
    if (decoded.role === UserRole.ADMIN) {
      const admin = await prisma.admin.findUnique({
        where: { userId: decoded.userId },
        select: { permissions: true }
      });

      if (admin && req.user) {
        req.user.permissions = admin.permissions;
      }
    }

    next();
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Access token has expired') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    next(new UnauthorizedError('Authentication failed'));
  }
};

/**
 * Middleware to check if user has required role
 * @param roles Array of allowed roles
 * @returns Express middleware
 */
export const hasRole = (roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User not authenticated');
      }

      if (!roles.includes(req.user.role as UserRole)) {
        throw new ForbiddenError('Insufficient permissions');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check if admin has required permissions
 * @param requiredPermissions Array of required permissions
 * @returns Express middleware
 */
export const hasPermission = (requiredPermissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User not authenticated');
      }

      // Super admins bypass permission checks
      if (req.user.role === UserRole.ADMIN) {
        const admin = await prisma.admin.findUnique({
          where: { userId: req.user.id },
          select: { permissions: true }
        });

        // Check if admin has 'super_admin' permission
        if (admin && admin.permissions.includes('super_admin')) {
          return next();
        }

        // Check if admin has all required permissions
        const hasAllPermissions = requiredPermissions.every(permission =>
          admin?.permissions?.includes(permission) || false
        );

        if (!hasAllPermissions) {
          throw new ForbiddenError('Insufficient permissions');
        }
      } else {
        throw new ForbiddenError('Insufficient permissions');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check if user owns the resource or has admin role
 * @param paramIdField Name of the parameter containing the resource ID
 * @param userIdField Field name in the resource that contains the user ID
 * @param model Prisma model name
 * @returns Express middleware
 */
export const isOwnerOrAdmin = (
  paramIdField: string,
  userIdField: string = 'userId',
  model: any
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User not authenticated');
      }

      // Admins can access any resource
      if (req.user.role === UserRole.ADMIN) {
        return next();
      }

      const resourceId = req.params[paramIdField];
      if (!resourceId) {
        throw new Error(`Parameter ${paramIdField} not found`);
      }

      // Check if user owns the resource
      const resource = await model.findUnique({
        where: { id: resourceId },
        select: { [userIdField]: true }
      });

      if (!resource) {
        throw new Error('Resource not found');
      }

      if (resource[userIdField] !== req.user.id) {
        throw new ForbiddenError('You do not have permission to access this resource');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check CSRF token
 */
export const validateCsrfToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Only check for POST, PUT, DELETE, PATCH requests
    if (
      ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) &&
      !req.path.includes('/api/v1/auth')
    ) {
      const csrfTokenCookie = req.cookies.csrfToken;
      const csrfTokenHeader = req.headers['x-csrf-token'] as string;

      if (!csrfTokenCookie || !csrfTokenHeader || csrfTokenCookie !== csrfTokenHeader) {
        throw new ForbiddenError('Invalid CSRF token');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to validate user IP and user agent for high security routes
 */
export const validateClientIdentity = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get the current user's token
    const token = req.cookies.refreshToken;
    
    if (!token || !req.user) {
      return next();
    }

    // For high security operations, validate client identity
    const isSecureOperation = 
      req.path.includes('/api/v1/auth/change-password') ||
      req.path.includes('/api/v1/auth/reset-password') ||
      req.path.includes('/api/v1/auth/sessions') ||
      req.path.includes('/api/v1/auth/revoke');

    if (isSecureOperation) {
      // Use a different approach, using query instead of direct model access
      // since authToken doesn't exist directly on PrismaClient
      prisma.$queryRaw`
        SELECT * FROM "AuthToken" 
        WHERE "userId" = ${req.user.id} 
        AND "token" = ${token} 
        AND "revokedAt" IS NULL
      `.then((results: unknown) => {
        const tokenRecords = results as any[];
        if (!tokenRecords || tokenRecords.length === 0) {
          throw new UnauthorizedError('Invalid session');
        }

        const tokenRecord = tokenRecords[0];

        // Check if IP and user agent match
        const currentIp = req.ip;
        const currentUserAgent = req.headers['user-agent'];

        // Allow different IP/user agent, but log it for security monitoring
        if (
          tokenRecord.ipAddress !== currentIp ||
          tokenRecord.userAgent !== currentUserAgent
        ) {
          console.warn(
            `Security warning: Client identity changed for user ${req.user?.id}. ` +
            `Original IP: ${tokenRecord.ipAddress}, Current IP: ${currentIp}. ` +
            `Original UA: ${tokenRecord.userAgent}, Current UA: ${currentUserAgent}`
          );
        }

        next();
      }).catch((error: unknown) => {
        next(error);
      });
    } else {
      next();
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to rate limit based on IP
 * @param maxRequests Maximum number of requests allowed
 * @param windowMs Time window in milliseconds
 * @returns Express middleware
 */
export const ipRateLimit = (maxRequests: number, windowMs: number) => {
  const ips = new Map();

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip;
      
      if (!ips.has(ip)) {
        ips.set(ip, { count: 1, resetTime: Date.now() + windowMs });
      } else {
        const data = ips.get(ip);
        
        // Reset count if time window has passed
        if (Date.now() > data.resetTime) {
          data.count = 1;
          data.resetTime = Date.now() + windowMs;
        } else {
          data.count++;
        }
        
        // Check if rate limit exceeded
        if (data.count > maxRequests) {
          throw new ForbiddenError(`Rate limit exceeded. Try again after ${Math.ceil((data.resetTime - Date.now()) / 1000)} seconds`);
        }
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
}; 