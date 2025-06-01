import express from 'express';
import { authenticate, hasRole } from '../middleware/auth';
import * as stripeController from '../controllers/stripeController';

const router = express.Router();

// Middleware to parse raw body for webhooks
const rawBodyMiddleware = express.raw({ type: 'application/json' });

// Stripe Connect account management routes (authenticated)
router.post('/connect/account', authenticate, stripeController.createConnectAccount);
router.get('/connect/account/status', authenticate, stripeController.getAccountStatus);
router.get('/connect/account/status/:vendorId', authenticate, stripeController.getAccountStatus);
router.get('/connect/account/onboarding', authenticate, stripeController.getOnboardingLink);
router.get('/connect/account/onboarding/:vendorId', authenticate, stripeController.getOnboardingLink);
router.put('/connect/account/payout-schedule/:vendorId', authenticate, stripeController.updatePayoutSchedule);

// Payment routes (can be accessed by customers)
router.post('/payment/intent', stripeController.createPaymentIntent);
router.post('/payment/multi-vendor', stripeController.createMultiVendorPayment);

// Webhook route (no authentication, uses raw body middleware)
router.post('/webhooks', rawBodyMiddleware, stripeController.handleWebhook);

export default router; 