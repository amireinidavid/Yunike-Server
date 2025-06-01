import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { logger } from '../utils/logger';
import { microservices } from '../services/microservices';

const prisma = new PrismaClient();

// Extended Request type with user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        permissions?: string[];
      };
    }
  }
}

interface AuthOptions {
  requiredRole?: string;
  requiredPermissions?: string[];
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user data to request
 */
export const authenticate = (options: AuthOptions = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get token from Authorization header or cookies
      const authHeader = req.headers.authorization;
      console.log('[authMiddleware] Received Authorization header:', authHeader);
      const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : req.cookies?.token;
      console.log('[authMiddleware] Token extracted for validation:', token);
      
      if (!token) {
        throw new UnauthorizedError('Authentication required');
      }
      
      let decoded: any;
      
      // Check if we should use auth microservice
      if (process.env.USE_AUTH_SERVICE === 'true') {
        try {
          // Validate token with auth service
          const validation = await microservices.auth.validateToken(token);
          
          if (!validation.valid) {
            throw new UnauthorizedError('Invalid or expired token');
          }
          
          decoded = validation.payload;
        } catch (error) {
          logger.warn('Auth service unavailable, falling back to local token validation');
          // Fall back to local validation
          decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        }
      } else {
        // Local token validation
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      }
      
      // Check token type and expiration
      if (decoded.type !== 'ACCESS') {
        throw new UnauthorizedError('Invalid token type');
      }
      
      // Get user from database to ensure they still exist and have proper permissions
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: {
          admin: true,
          vendor: true
        }
      });
      
      if (!user) {
        throw new UnauthorizedError('User not found');
      }
      
      if (user.accountStatus !== 'ACTIVE') {
        throw new UnauthorizedError('Account is not active');
      }
      
      // Attach user data to request
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        permissions: user.admin?.permissions
      };
      
      // Check if specific role is required
      if (options.requiredRole && user.role !== options.requiredRole && user.role !== 'ADMIN') {
        throw new ForbiddenError(`${options.requiredRole} role required`);
      }
      
      // Check if specific permissions are required
      if (options.requiredPermissions && options.requiredPermissions.length > 0) {
        const userPermissions = user.admin?.permissions || [];
        const hasAllPermissions = options.requiredPermissions.every(permission => 
          userPermissions.includes(permission)
        );
        
        if (!hasAllPermissions && user.role !== 'ADMIN') {
          throw new ForbiddenError('Insufficient permissions');
        }
      }
      
      // Record last login time and IP if not recorded recently
      const lastLoginThreshold = new Date();
      lastLoginThreshold.setHours(lastLoginThreshold.getHours() - 1);
      
      if (!user.lastLoginAt || user.lastLoginAt < lastLoginThreshold) {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            lastLoginIp: Array.isArray(clientIp) ? clientIp[0] : clientIp as string
          }
        });
      }
      
      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        return next(new UnauthorizedError('Invalid token'));
      }
      
      if (error instanceof jwt.TokenExpiredError) {
        return next(new UnauthorizedError('Token expired'));
      }
      
      next(error);
    }
  };
};

/**
 * Middleware to check if user is a vendor
 */
export const validateVendor = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }
      
      // Check if user is a vendor
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id },
        select: { id: true, verificationStatus: true, isActive: true }
      });
      
      if (!vendor) {
        throw new ForbiddenError('Vendor account required');
      }
      
      if (!vendor.isActive) {
        throw new ForbiddenError('Vendor account is not active');
      }
      
      if (vendor.verificationStatus !== 'VERIFIED') {
        throw new ForbiddenError('Vendor account is not verified');
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

export default { authenticate, validateVendor }; 