import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Middleware to validate that the authenticated user is a vendor
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
        select: { 
          id: true, 
          verificationStatus: true, 
          isActive: true,
          subscriptionExpiresAt: true,
          subscription: true
        }
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
      
      // Check if subscription is expired
      if (vendor.subscriptionExpiresAt && vendor.subscriptionExpiresAt < new Date()) {
        logger.warn(`Vendor ${vendor.id} has an expired subscription`);
        // Allow basic operations but with a warning in response
        res.locals.subscriptionExpired = true;
      }
      
      // Attach vendor data to request for later use
      req.vendor = vendor;
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to validate vendor ownership of a product
 */
export const validateProductOwnership = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }
      
      // Get product ID from request
      const productId = req.params.id || req.params.productId;
      
      if (!productId) {
        throw new ForbiddenError('Product ID is required');
      }
      
      // Check if user is an admin (admins can edit any product)
      if (req.user.role === 'ADMIN') {
        return next();
      }
      
      // Get the vendor ID for this user
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id },
        select: { id: true }
      });
      
      if (!vendor) {
        throw new ForbiddenError('Vendor account required');
      }
      
      // Check if product belongs to this vendor
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { vendorId: true }
      });
      
      if (!product) {
        throw new ForbiddenError('Product not found');
      }
      
      if (product.vendorId !== vendor.id) {
        throw new ForbiddenError('You do not have permission to manage this product');
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check vendor subscription level
 * @param requiredTier Minimum subscription tier required
 */
export const checkSubscriptionTier = (requiredTier: 'BASIC' | 'PREMIUM' | 'PROFESSIONAL' | 'ENTERPRISE') => {
  const tierValues = {
    'BASIC': 0,
    'PREMIUM': 1,
    'PROFESSIONAL': 2,
    'ENTERPRISE': 3
  };
  
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.vendor) {
        // Get vendor data if not already attached to request
        const vendor = await prisma.vendor.findUnique({
          where: { userId: req.user?.id },
          select: { 
            id: true,
            subscription: true,
            subscriptionExpiresAt: true
          }
        });
        
        if (!vendor) {
          throw new ForbiddenError('Vendor account required');
        }
        
        req.vendor = vendor;
      }
      
      // Check if subscription has expired
      if (req.vendor.subscriptionExpiresAt && req.vendor.subscriptionExpiresAt < new Date()) {
        throw new ForbiddenError('Your subscription has expired. Please renew to access this feature.');
      }
      
      // Check if subscription tier is sufficient
      const vendorTierValue = tierValues[req.vendor.subscription as keyof typeof tierValues];
      const requiredTierValue = tierValues[requiredTier];
      
      if (vendorTierValue < requiredTierValue) {
        throw new ForbiddenError(`This feature requires ${requiredTier} subscription or higher.`);
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

export default {
  validateVendor,
  validateProductOwnership,
  checkSubscriptionTier
}; 