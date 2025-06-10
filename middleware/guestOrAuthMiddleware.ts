import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// Extend Express Request type to include cartToken
declare global {
  namespace Express {
    interface Request {
      cartToken?: {
        cartId: string;
        issuedAt: number;
      };
    }
  }
}

/**
 * Middleware that allows both guest users and authenticated users
 * For authenticated users, it attaches the user object to the request
 * For guest users, it still allows the request to proceed
 * For cart operations, it verifies the cart token
 */
export const guestOrAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');
    
    // Check for cart authorization in headers
    const cartAuthHeader = req.header('X-Cart-Authorization');
    
    if (cartAuthHeader) {
      try {
        // Verify the cart token
        const decoded = jwt.verify(
          cartAuthHeader, 
          process.env.JWT_SECRET || 'your-secret-key'
        ) as { cartId: string; issuedAt: number };
        
        // Attach cart token data to request for use in controllers
        req.cartToken = decoded;
      } catch (error) {
        // Invalid cart token, but we'll continue as guest
        logger.warn('Invalid cart token in guestOrAuth middleware:', error);
      }
    }
    
    if (token) {
      try {
        // Verify user token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as { id: string };
        
        // Find user
        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true
          }
        });
        
        if (user) {
          // Attach user to request
          req.user = user;
        }
      } catch (error) {
        // Token invalid, but we'll continue as guest
        logger.warn('Invalid token in guestOrAuth middleware:', error);
      }
    }
    
    // Continue to next middleware/route handler regardless of authentication
    next();
  } catch (error) {
    logger.error('Error in guestOrAuth middleware:', error);
    next(error);
  }
}; 