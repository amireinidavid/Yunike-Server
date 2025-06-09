import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

// Extend Express Request to include vendor information
declare global {
  namespace Express {
    interface Request {
      vendor?: {
        id: string;
        userId: string;
        [key: string]: any;
      };
    }
  }
}

const prisma = new PrismaClient();

/**
 * Middleware to validate that the authenticated user owns the vendor account
 * or is an admin
 */
export const validateVendorOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    
    // Get vendor ID from request
    const vendorId = req.params.vendorId;
    
    if (!vendorId) {
      throw new ForbiddenError('Vendor ID is required');
    }
    
    // Check if user is an admin (admins can access any vendor)
    if (req.user.role === 'ADMIN') {
      return next();
    }
    
    // Check if the vendor belongs to this user
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { userId: true }
    });
    
    if (!vendor) {
      throw new ForbiddenError('Vendor not found');
    }
    
    if (vendor.userId !== req.user.id) {
      throw new ForbiddenError('You do not have permission to access this vendor account');
    }
    
    // Attach vendor ID to request for later use
    req.vendor = { id: vendorId, userId: vendor.userId };
    
    next();
  } catch (error) {
    next(error);
  }
}; 