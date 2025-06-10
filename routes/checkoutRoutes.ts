import express from 'express';
import { createCheckoutSession, handleCheckoutWebhook, getCheckoutStatus } from '../controllers/checkoutController';
import { authenticate, optionalAuth } from '../middleware/auth';

const router = express.Router();

/**
 * @swagger
 * /api/checkout/{cartId}:
 *   post:
 *     summary: Create a Stripe checkout session
 *     tags: [Checkout]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *         description: Cart ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - successUrl
 *               - cancelUrl
 *             properties:
 *               successUrl:
 *                 type: string
 *                 description: URL to redirect after successful payment
 *               cancelUrl:
 *                 type: string
 *                 description: URL to redirect if payment is cancelled
 *     responses:
 *       200:
 *         description: Checkout session created
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Cart not found
 */
router.post('/:cartId', optionalAuth, createCheckoutSession);

/**
 * @swagger
 * /api/checkout/status/{sessionId}:
 *   get:
 *     summary: Get checkout session status
 *     tags: [Checkout]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Stripe checkout session ID
 *     responses:
 *       200:
 *         description: Checkout session status
 *       404:
 *         description: Session not found
 */
router.get('/status/:sessionId', optionalAuth, getCheckoutStatus);

/**
 * @swagger
 * /api/checkout/webhook:
 *   post:
 *     summary: Handle Stripe webhook events
 *     tags: [Checkout]
 *     responses:
 *       200:
 *         description: Webhook received and processed
 *       400:
 *         description: Invalid webhook data
 */
// This route needs raw body for Stripe signature verification
// Must be configured in the server.ts/app.ts before routes setup
router.post('/webhook', express.raw({ type: 'application/json' }), handleCheckoutWebhook);

export default router; 