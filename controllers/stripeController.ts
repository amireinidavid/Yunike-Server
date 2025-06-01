import { Request, Response } from 'express';
import { PrismaClient, StripeAccountType } from '@prisma/client';
import Stripe from 'stripe';
import { BadRequestError, NotFoundError, UnauthorizedError, ApiError } from '../utils/errors';
import * as stripeService from '../services/stripeService';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil',
});

/**
 * Create a Stripe Connect account for a vendor
 */
export const createConnectAccount = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Get vendor ID from request or try to find by user ID
    let vendorId = req.body.vendorId;
    
    if (!vendorId) {
      // Find vendor by user ID
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id }
      });
      
      if (!vendor) {
        throw new NotFoundError('Vendor profile not found');
      }
      
      vendorId = vendor.id;
    }
    
    // Check if user is authorized for this vendor
    if (req.user.role !== 'ADMIN') {
      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId }
      });
      
      if (!vendor || vendor.userId !== req.user.id) {
        throw new UnauthorizedError('Not authorized to manage this vendor');
      }
    }

    // Get account type from request or use default
    const accountType = req.body.accountType as StripeAccountType || StripeAccountType.EXPRESS;
    
    // Create Stripe Connect account
    const result = await stripeService.createConnectAccount(vendorId, accountType);
    
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong creating Connect account';
    
    res.status(statusCode).json({ 
      success: false,
      error: message
    });
  }
};

/**
 * Get onboarding link for an existing Stripe Connect account
 */
export const getOnboardingLink = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Get vendor ID from request or try to find by user ID
    let vendorId = req.params.vendorId || req.query.vendorId;
    
    if (!vendorId) {
      // Find vendor by user ID
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id }
      });
      
      if (!vendor) {
        throw new NotFoundError('Vendor profile not found');
      }
      
      vendorId = vendor.id;
    }
    
    // Check if user is authorized for this vendor
    if (req.user.role !== 'ADMIN') {
      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId as string }
      });
      
      if (!vendor || vendor.userId !== req.user.id) {
        throw new UnauthorizedError('Not authorized to manage this vendor');
      }
    }

    // Create account link
    const accountLinkUrl = await stripeService.createAccountLink(vendorId as string);
    
    res.status(200).json({
      success: true,
      url: accountLinkUrl
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong creating onboarding link';
    
    res.status(statusCode).json({ 
      success: false,
      error: message
    });
  }
};

/**
 * Get Stripe account status
 */
export const getAccountStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Get vendor ID from request or try to find by user ID
    let vendorId = req.params.vendorId || req.query.vendorId;
    
    if (!vendorId) {
      // Find vendor by user ID
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id }
      });
      
      if (!vendor) {
        throw new NotFoundError('Vendor profile not found');
      }
      
      vendorId = vendor.id;
    }
    
    // Check if user is authorized for this vendor
    if (req.user.role !== 'ADMIN') {
      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId as string }
      });
      
      if (!vendor || vendor.userId !== req.user.id) {
        throw new UnauthorizedError('Not authorized to manage this vendor');
      }
    }

    // Get account status
    const status = await stripeService.getAccountStatus(vendorId as string);
    
    res.status(200).json({
      success: true,
      data: status
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong getting account status';
    
    res.status(statusCode).json({ 
      success: false,
      error: message
    });
  }
};

/**
 * Create a payment intent for a single vendor
 */
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { amount, currency, vendorId, metadata } = req.body;
    
    if (!amount || !currency || !vendorId) {
      throw new BadRequestError('Amount, currency, and vendorId are required');
    }

    // Create payment intent
    const paymentIntent = await stripeService.createPaymentIntent(amount, currency, vendorId, metadata);
    
    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong creating payment intent';
    
    res.status(statusCode).json({ 
      success: false,
      error: message
    });
  }
};

/**
 * Create a payment intent for multiple vendors
 */
export const createMultiVendorPayment = async (req: Request, res: Response) => {
  try {
    const { items, currency, metadata } = req.body;
    
    if (!items || !currency || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestError('Valid items array and currency are required');
    }

    // Validate items
    items.forEach(item => {
      if (!item.vendorId || !item.amount || item.amount <= 0) {
        throw new BadRequestError('Each item must have a vendorId and valid amount');
      }
    });

    // Create multi-vendor payment intent
    const paymentIntent = await stripeService.createMultiVendorPayment(items, currency, metadata);
    
    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong creating multi-vendor payment';
    
    res.status(statusCode).json({ 
      success: false,
      error: message
    });
  }
};

/**
 * Webhook handler for Stripe events
 */
export const handleWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  
  if (!sig) {
    return res.status(400).json({ success: false, error: 'Missing stripe-signature header' });
  }
  
  try {
    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    
    // Handle different event types
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        
        // Find vendor by Stripe account ID
        const vendor = await prisma.vendor.findFirst({
          where: { stripeAccountId: account.id }
        });
        
        if (vendor) {
          // Update vendor with latest account status
          await prisma.vendor.update({
            where: { id: vendor.id },
            data: {
              stripeDetailsSubmitted: account.details_submitted,
              stripePayoutsEnabled: account.payouts_enabled,
              stripeChargesEnabled: account.charges_enabled,
              stripeOnboardingComplete: 
                account.details_submitted && 
                account.payouts_enabled && 
                account.charges_enabled
            }
          });
          
          console.log(`Updated vendor ${vendor.id} Stripe status`);
        }
        break;
      }
      
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        
        // Check if it's a multi-vendor payment
        if (paymentIntent.metadata?.isMultiVendor === 'true' && paymentIntent.metadata.vendorIds) {
          // In a real application, you would fetch the transfer info from your database
          // where you stored it when creating the payment intent
          // Here we're just logging that we should handle the multi-vendor payment
          console.log(`Multi-vendor payment succeeded: ${paymentIntent.id}`);
          console.log(`Should process transfers to vendors: ${paymentIntent.metadata.vendorIds}`);
        }
        
        break;
      }
      
      // Handle other events as needed
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.status(200).json({ received: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook error';
    console.error('Webhook error:', message);
    
    res.status(400).json({
      success: false,
      error: message
    });
  }
};

/**
 * Update vendor's payout schedule
 */
export const updatePayoutSchedule = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const { vendorId } = req.params;
    const { schedule, minimumAmount } = req.body;
    
    if (!vendorId || !schedule) {
      throw new BadRequestError('Vendor ID and schedule are required');
    }
    
    // Check if user is authorized for this vendor
    if (req.user.role !== 'ADMIN') {
      const vendor = await prisma.vendor.findUnique({
        where: { id: vendorId }
      });
      
      if (!vendor || vendor.userId !== req.user.id) {
        throw new UnauthorizedError('Not authorized to manage this vendor');
      }
    }

    // Update payout schedule
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        payoutSchedule: schedule,
        minimumPayoutAmount: minimumAmount || undefined
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Payout schedule updated successfully'
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong updating payout schedule';
    
    res.status(statusCode).json({ 
      success: false,
      error: message
    });
  }
}; 