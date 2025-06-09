import { Request, Response } from 'express';
import Stripe from 'stripe';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import * as stripeService from '../services/stripeService';

// Initialize Stripe with the API key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-04-30.basil', // Use the latest stable API version
});

// Check if we're in test mode
const isTestMode = process.env.STRIPE_TEST_MODE === 'true';

/**
 * Create a Stripe Connect account for a vendor
 */
export const createConnectAccount = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { accountType = 'EXPRESS' } = req.body;
    
    // Use the stripe service to create the account
    const result = await stripeService.createConnectAccount(vendorId, accountType);
    
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    
    return res.status(201).json({
      success: true,
      ...result.data
    });
  } catch (error: any) {
    logger.error('Error creating Stripe Connect account:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to create Stripe Connect account' 
    });
  }
};

/**
 * Generate an account link for completing the Stripe onboarding process
 */
export const generateAccountLink = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    
    // Use the stripe service to generate the account link
    const result = await stripeService.generateAccountLink(vendorId);
    
    return res.status(200).json({
      success: true,
      ...result.data
    });
  } catch (error: any) {
    logger.error('Error generating account link:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate account link' });
  }
};

/**
 * Get a vendor's Stripe account status
 */
export const getAccountStatus = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    
    const result = await stripeService.getAccountStatus(vendorId);
    
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    
    return res.status(200).json({
      success: true,
      ...result.data
    });
  } catch (error: any) {
    logger.error('Error retrieving Stripe account status:', error);
    return res.status(500).json({ error: error.message || 'Failed to get account status' });
  }
};

/**
 * Update vendor's payout schedule
 */
export const updatePayoutSchedule = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { schedule, minimumAmount } = req.body;
    
    console.log('Payout Schedule Update Request:', {
      vendorId,
      schedule,
      scheduleType: typeof schedule,
      minimumAmount
    });
    
    // Ensure schedule is lowercase before passing to service
    const normalizedSchedule = typeof schedule === 'string' 
      ? schedule.toLowerCase() 
      : 'daily';
    
    const result = await stripeService.updatePayoutSchedule(vendorId, normalizedSchedule, minimumAmount);
    
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    
    return res.status(200).json({
      success: true,
      ...result.data
    });
  } catch (error: any) {
    logger.error('Error updating payout schedule:', error);
    return res.status(500).json({ error: error.message || 'Failed to update payout schedule' });
  }
};

/**
 * Handle Stripe webhook events
 */
export const handleWebhookEvent = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.error('Stripe webhook secret not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      webhookSecret
    );

    // Process the event using the service
    const result = await stripeService.processWebhookEvent(event.type, event.data.object);
    
    if (result.error) {
      logger.warn(`Error processing webhook event: ${result.error}`);
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error('Error handling webhook:', error);
    return res.status(400).json({ error: error.message || 'Webhook error' });
  }
};

/**
 * Create a Stripe Connect account with direct vendor URL for onboarding
 * This is specifically for the individual vendor direct link flow
 */
export const createVendorConnectLink = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { accountType = 'EXPRESS', email } = req.body;
    
    // Use the stripe service to create the account
    const result = await stripeService.createConnectAccount(vendorId, accountType);
    
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    
    return res.status(200).json({
      success: true,
      ...result.data
    });
  } catch (error: any) {
    logger.error('Error creating vendor Connect link:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to create Stripe Connect link' 
    });
  }
};

/**
 * Disconnect a vendor's Stripe Connect account 
 * (doesn't delete the actual Stripe account, just removes the association)
 */
export const disconnectStripeAccount = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    
    const result = await stripeService.disconnectStripeAccount(vendorId);
    
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    
    return res.status(200).json({
      success: true,
      ...result.data
    });
  } catch (error: any) {
    logger.error('Error disconnecting Stripe account:', error);
    return res.status(500).json({ error: error.message || 'Failed to disconnect Stripe account' });
  }
};
