import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../utils/errors';

const prisma = new PrismaClient();

// Extend Express Request type to include user and vendor properties
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string;
      role: string;
      permissions?: string[];
    };
    vendor?: any;
  }
}

/**
 * Middleware to ensure the user has a vendor account
 * Must be used after authenticateToken middleware
 */
export const vendorRequired = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const userId = req.user.id;

    // Check if user has a vendor account
    const vendor = await prisma.vendor.findUnique({
      where: { userId }
    });

    if (!vendor) {
      throw new UnauthorizedError('Vendor account required for this operation');
    }

    // Attach vendor to request object for use in controllers
    req.vendor = vendor;
    
    next();
  } catch (error) {
    next(error);
  }
}; 