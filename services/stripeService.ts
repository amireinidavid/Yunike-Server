import Stripe from 'stripe';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

// Initialize Stripe with the API key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-04-30.basil', // Use the latest stable API version
});

// Check if we're in test mode
const isTestMode = process.env.STRIPE_TEST_MODE === 'true';

/**
 * Create a Stripe Connect account for a vendor
 */
export async function createConnectAccount(vendorId: string, accountType: string = 'EXPRESS') {
  try {
    // Get vendor from database
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          }
        }
      }
    });

    if (!vendor) {
      return { error: 'Vendor not found' };
    }

    // Check if vendor already has a Stripe account
    if (vendor.stripeAccountId) {
      return {
        error: 'Vendor already has a Stripe Connect account',
        data: { accountId: vendor.stripeAccountId }
      };
    }

    // Create the Connect account
    const account = await stripe.accounts.create({
      type: accountType.toLowerCase() as Stripe.AccountCreateParams.Type,
      email: vendor.user.email,
      metadata: {
        vendorId: vendor.id,
        userId: vendor.user.id,
      },
      business_profile: {
        name: vendor.storeName,
        url: vendor.slug || undefined,
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      settings: {
        payouts: {
          schedule: {
            interval: 'manual',
          },
        },
      },
      ...(vendor.user.phone && { 
        business_profile: { 
          support_phone: vendor.user.phone 
        } 
      }),
    });

    // Update vendor with Stripe account ID
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        stripeAccountId: account.id,
        stripeAccountType: accountType as any,
        stripeAccountStatus: 'PENDING',
      }
    });

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.VENDOR_FRONTEND_URL}/dashboard/payments/refresh`,
      return_url: `${process.env.VENDOR_FRONTEND_URL}/dashboard/payments/complete`,
      type: 'account_onboarding',
      collect: 'eventually_due',
    });

    // Log the successful creation
    logger.info(`Stripe Connect account created for vendor: ${vendorId}`, { 
      vendorId,
      stripeAccountId: account.id,
      isTestMode
    });

    return {
      error: null,
      data: {
        accountId: account.id,
        accountLinkUrl: accountLink.url,
        isTestMode,
      }
    };
  } catch (error: any) {
    logger.error('Error creating Stripe Connect account:', error);
    return { error: error.message || 'Failed to create Stripe Connect account' };
  }
}

/**
 * Generate an account link for completing the Stripe onboarding process
 */
export async function generateAccountLink(vendorId: string) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor) {
      return { error: 'Vendor not found' };
    }

    if (!vendor.stripeAccountId) {
      return { error: 'Vendor has no Stripe Connect account' };
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: vendor.stripeAccountId,
      refresh_url: `${process.env.VENDOR_FRONTEND_URL}/dashboard/settings/payments/refresh`,
      return_url: `${process.env.VENDOR_FRONTEND_URL}/dashboard/settings/payments/complete`,
      type: 'account_onboarding',
      collect: 'eventually_due',
    });

    return {
      error: null,
      data: {
        accountLinkUrl: accountLink.url,
        isTestMode,
      }
    };
  } catch (error: any) {
    logger.error('Error generating account link:', error);
    return { error: error.message || 'Failed to generate account link' };
  }
}

/**
 * Get a vendor's Stripe account status
 */
export async function getAccountStatus(vendorId: string) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor) {
      return { error: 'Vendor not found' };
    }

    if (!vendor.stripeAccountId) {
      return { error: 'Vendor has no Stripe Connect account' };
    }

    // Get the account from Stripe
    const account = await stripe.accounts.retrieve(vendor.stripeAccountId);

    // Update vendor with the latest status
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        stripeDetailsSubmitted: account.details_submitted,
        stripeChargesEnabled: account.charges_enabled,
        stripePayoutsEnabled: account.payouts_enabled,
        stripeAccountStatus: account.charges_enabled ? 'ACTIVE' : 'PENDING',
        stripeOnboardingComplete: account.details_submitted,
      }
    });

    // Check if this is a test account by looking at the Stripe account metadata or test clock
    const accountIsTestMode = account.metadata?.test_mode === 'true' || process.env.STRIPE_TEST_MODE === 'true';
    
    return {
      error: null,
      data: {
        stripeAccountId: vendor.stripeAccountId,
        status: account.charges_enabled ? 'ACTIVE' : 'PENDING',
        detailsSubmitted: account.details_submitted,
        payoutsEnabled: account.payouts_enabled,
        chargesEnabled: account.charges_enabled,
        isTestMode: accountIsTestMode,
      }
    };
  } catch (error: any) {
    logger.error('Error retrieving Stripe account status:', error);
    return { error: error.message || 'Failed to get account status' };
  }
}

/**
 * Update vendor's payout schedule
 */
export async function updatePayoutSchedule(vendorId: string, schedule: string, minimumAmount?: number) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor) {
      return { error: 'Vendor not found' };
    }

    if (!vendor.stripeAccountId) {
      return { error: 'Vendor has no Stripe Connect account' };
    }

    // Valid schedule intervals
    const validSchedules = ['daily', 'weekly', 'monthly', 'manual'];
    if (!validSchedules.includes(schedule)) {
      return { error: 'Invalid schedule. Must be one of: daily, weekly, monthly, manual' };
    }

    // Update the payout schedule in Stripe
    await stripe.accounts.update(vendor.stripeAccountId, {
      settings: {
        payouts: {
          schedule: {
            interval: schedule as Stripe.AccountUpdateParams.Settings.Payouts.Schedule.Interval,
            ...(schedule !== 'manual' && minimumAmount && { delay_days: 2 }),
          },
          ...(minimumAmount && { minimum_amount: Math.floor(minimumAmount * 100) }), // Convert to cents
        },
      },
    });

    // Update vendor record with payout preferences
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        payoutSchedule: schedule.toUpperCase(),
        ...(minimumAmount && { minimumPayoutAmount: minimumAmount }),
      }
    });

    return {
      error: null,
      data: {
        schedule,
        minimumAmount,
      }
    };
  } catch (error: any) {
    logger.error('Error updating payout schedule:', error);
    return { error: error.message || 'Failed to update payout schedule' };
  }
}

/**
 * Process Stripe webhook events
 */
export async function processWebhookEvent(eventType: string, data: any) {
  try {
    switch (eventType) {
      case 'account.updated': {
        const account = data as Stripe.Account;
        
        // Find the vendor by Stripe account ID
        const vendor = await prisma.vendor.findFirst({
          where: { stripeAccountId: account.id }
        });

        if (!vendor) {
          logger.warn(`No vendor found for Stripe account: ${account.id}`);
          return { error: 'No vendor found for Stripe account' };
        }

        // Check if onboarding was just completed
        const onboardingJustCompleted = account.details_submitted && !vendor.stripeDetailsSubmitted;
        
        // Update vendor status
        await prisma.vendor.update({
          where: { id: vendor.id },
          data: {
            stripeDetailsSubmitted: account.details_submitted,
            stripeChargesEnabled: account.charges_enabled,
            stripePayoutsEnabled: account.payouts_enabled,
            stripeAccountStatus: account.charges_enabled ? 'ACTIVE' : (account.details_submitted ? 'PENDING' : 'PENDING'),
            stripeOnboardingComplete: account.details_submitted,
            stripeMetadata: account.metadata as any,
            // Set default payout schedule if onboarding was just completed
            ...(onboardingJustCompleted && { payoutSchedule: 'DAILY' })
          }
        });
        
        // If onboarding was just completed, set up default payout schedule in Stripe
        if (onboardingJustCompleted && vendor.stripeAccountId) {
          try {
            await stripe.accounts.update(vendor.stripeAccountId, {
              settings: {
                payouts: {
                  schedule: {
                    interval: 'daily',
                  },
                },
              },
            });
            logger.info(`Set default daily payout schedule for vendor ${vendor.id}`);
          } catch (payoutError) {
            logger.error(`Failed to set default payout schedule: ${payoutError}`);
          }
        }

        logger.info(`Updated vendor ${vendor.id} Stripe Connect status`);
        return { error: null, data: { success: true } };
      }
      
      // Handle other events as needed
      default:
        logger.info(`Unhandled Stripe event type: ${eventType}`);
        return { error: null, data: { handled: false, eventType } };
    }
  } catch (error: any) {
    logger.error(`Error processing webhook event ${eventType}:`, error);
    return { error: error.message || `Failed to process webhook event: ${eventType}` };
  }
}

/**
 * Create a payment from customer to vendor
 */
export async function createVendorPayment(
  customerId: string,
  vendorId: string,
  amount: number,
  currency: string = 'usd',
  description: string,
  metadata: Record<string, any> = {}
) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor) {
      throw new Error('Vendor not found');
    }

    if (!vendor.stripeAccountId) {
      throw new Error('Vendor has no Stripe Connect account');
    }

    if (!vendor.stripeChargesEnabled) {
      throw new Error('Vendor does not have charges enabled on their Stripe account');
    }

    // Calculate platform fee (e.g. 10% of the total amount)
    const platformFeePercentage = vendor.commissionRate || 10;
    const platformFeeAmount = Math.round((amount * platformFeePercentage) / 100);
    
    // Create a payment intent with the connected account
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      application_fee_amount: platformFeeAmount,
      transfer_data: {
        destination: vendor.stripeAccountId,
      },
      description,
      metadata: {
        ...metadata,
        vendorId,
        customerId,
      },
    });

    return {
      success: true,
      data: {
        paymentIntent,
        clientSecret: paymentIntent.client_secret,
      }
    };
  } catch (error: any) {
    logger.error('Error creating vendor payment:', error);
    throw error;
  }
}

/**
 * Disconnect a vendor's Stripe Connect account
 */
export async function disconnectStripeAccount(vendorId: string) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!vendor) {
      return { error: 'Vendor not found' };
    }

    if (!vendor.stripeAccountId) {
      return { error: 'Vendor has no connected Stripe account' };
    }

    // Store the account ID for logging
    const stripeAccountId = vendor.stripeAccountId;

    // Update vendor record to remove Stripe association
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        stripeAccountId: null,
        stripeAccountStatus: null,
        stripeAccountType: null,
        stripeOnboardingComplete: false,
        stripePayoutsEnabled: false,
        stripeChargesEnabled: false,
        stripeDetailsSubmitted: false,
        stripeMetadata: {
          vendorId: vendorId,
          userId: vendor.userId,
        },
      }
    });

    // Log the disconnection
    logger.info(`Disconnected Stripe account from vendor ${vendorId}`, {
      vendorId,
      disconnectedAccountId: stripeAccountId
    });

    return {
      error: null,
      data: {
        success: true,
        message: 'Stripe Connect account has been disconnected'
      }
    };
  } catch (error: any) {
    logger.error('Error disconnecting Stripe account:', error);
    return { error: error.message || 'Failed to disconnect Stripe account' };
  }
}