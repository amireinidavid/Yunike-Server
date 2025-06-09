import express from 'express';
import * as stripeController from '../controllers/stripeController';
import { authenticate } from '../middleware/auth';
import { validateVendorOwnership } from '../middleware/vendor';
import { validateSchema } from '../middleware/validation';
import { validateStripeAccountUpdate } from '../utils/validators';

const router = express.Router();

// Middleware to ensure raw body is available for webhook verification
// This must be added in your main app.ts/server.ts before route setup
// app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Create a Connect account for a vendor
router.post(
  '/connect/accounts/:vendorId',
  authenticate,
  validateVendorOwnership,
  stripeController.createConnectAccount
);

// Generate an account onboarding link
router.post(
  '/connect/account-links/:vendorId',
  authenticate,
  validateVendorOwnership,
  stripeController.generateAccountLink
);

// Get vendor's Stripe account status
router.get(
  '/connect/accounts/:vendorId',
  authenticate,
  validateVendorOwnership,
  stripeController.getAccountStatus
);

// Update vendor's payout schedule
router.patch(
  '/connect/payout-schedule/:vendorId',
  authenticate,
  validateVendorOwnership,
  validateSchema(validateStripeAccountUpdate),
  stripeController.updatePayoutSchedule
);

// Create direct vendor connect link with Stripe hosted onboarding
router.post(
  '/connect/direct-link/:vendorId',
  authenticate,
  validateVendorOwnership,
  stripeController.createVendorConnectLink
);

// Disconnect a vendor's Stripe Connect account
router.delete(
  '/connect/accounts/:vendorId',
    authenticate,
  validateVendorOwnership,
  stripeController.disconnectStripeAccount
);

// Handle Stripe webhooks
// This route should be publicly accessible (no auth middleware)
// but protected by the Stripe signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), stripeController.handleWebhookEvent);

export default router;