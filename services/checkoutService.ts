import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { cacheService } from './cacheService';
import { realtimeService } from './realtimeService';
import { kafkaService, OrderEvent } from './kafkaService';
import { sendEmail } from './emailService';
import Stripe from 'stripe';
import { validateProductsForOrder, decreaseInventory } from '../controllers/productController';
import { Prisma } from '@prisma/client';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-04-30.basil',
});

export interface CheckoutSessionParams {
  cartId: string;
  userId?: string;
  email?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  success: boolean;
  sessionId?: string;
  orderReference?: string;
  url?: string;
  error?: string;
}

// Define extended interfaces to handle metadata and custom fields
interface ExtendedOrder extends Record<string, any> {
  id: string;
  userId: string | null;
  orderNumber: string;
  orderMetadata?: any;
  subtotalAmount: number;
  shippingAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  items: any[];
  user?: any;
  shippingAddressId?: string;
  shippingAddress?: any;
  status: string;
  createdAt: Date;
}

class CheckoutService {
  /**
   * Create a checkout session for a cart
   */
  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutResult> {
    try {
      const { cartId, userId, email, successUrl, cancelUrl } = params;

      // Find the cart with all required data
      const cart = await prisma.cart.findUnique({
        where: { id: cartId },
        include: {
          items: {
            include: {
              product: {
                include: {
                  images: true,
                  vendor: {
                    select: {
                      id: true,
                      storeName: true,
                      stripeAccountId: true
                    }
                  }
                }
              },
              variant: true
            }
          },
          coupon: true
        }
      });

      if (!cart) {
        return { success: false, error: 'Cart not found' };
      }

      if (cart.items.length === 0) {
        return { success: false, error: 'Cart is empty' };
      }

      // Validate cart items are available
      const itemsToValidate = cart.items.map(item => ({
        productId: item.productId,
        variantId: item.variantId || undefined,
        quantity: item.quantity
      }));

      const validationResults = await validateProductsForOrder(itemsToValidate);
      const invalidItems = validationResults.filter(item => !item.valid);

      if (invalidItems.length > 0) {
        return {
          success: false,
          error: 'Some items in your cart are no longer available'
        };
      }

      // Check if all vendors have Stripe accounts
      const vendorsWithoutStripe = cart.items.filter(
        item => !item.product.vendor.stripeAccountId
      ).map(item => item.product.vendor);

      if (vendorsWithoutStripe.length > 0) {
        return {
          success: false,
          error: 'Some vendors are not set up for payments yet'
        };
      }

      // The rest of the checkout process is handled by the controller
      // This service is for additional microservice integrations
      return {
        success: true
      };
    } catch (error) {
      logger.error('CheckoutService - createCheckoutSession error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during checkout'
      };
    }
  }

  /**
   * Process a successful order after checkout completion
   */
  async processCompletedOrder(orderId: string): Promise<void> {
    try {
      // Get order details
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: {
                include: {
                  vendor: true
                }
              }
            }
          },
          user: true
        }
      }) as unknown as ExtendedOrder;

      if (!order) {
        logger.error(`CheckoutService - processCompletedOrder: Order ${orderId} not found`);
        return;
      }

      // Group items by vendor
      const itemsByVendor: Record<string, any[]> = {};
      order.items.forEach(item => {
        const vendorId = item.product.vendorId;
        if (!itemsByVendor[vendorId]) {
          itemsByVendor[vendorId] = [];
        }
        itemsByVendor[vendorId].push(item);
      });

      // Create vendor sub-orders
      for (const [vendorId, items] of Object.entries(itemsByVendor)) {
        const vendorTotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
        
        // Use prisma.$transaction or a direct SQL query instead of vendorOrder if it doesn't exist
        await prisma.$queryRaw`
          INSERT INTO "VendorOrder" ("orderId", "vendorId", "status", "total")
          VALUES (${order.id}, ${vendorId}, 'NEW', ${vendorTotal})
        `;

        // Send real-time notification to vendor
        realtimeService.notifyNewOrder(vendorId, {
          orderId: order.id,
          orderReference: order.orderNumber, // Changed from reference to orderNumber
          total: vendorTotal,
          itemCount: items.length
        });

        // Publish event to Kafka
        try {
          await kafkaService.publishOrderCreated({
            orderId: order.id,
            vendorId,
            userId: order.userId || 'guest',
            orderItems: items.map(item => ({
              productId: item.productId,
              variantId: item.variantId || undefined,
              quantity: item.quantity,
              price: item.unitPrice
            })),
            totalAmount: vendorTotal,
            status: 'NEW',
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          logger.error('Failed to publish order event to Kafka:', error);
        }
      }

      // Send order confirmation email to customer
      const userEmail = order.user?.email || (order.orderMetadata?.email as string);
      if (userEmail) {
        try {
          await sendEmail({
            to: userEmail,
            subject: `Order Confirmation - ${order.orderNumber}`, // Changed from reference to orderNumber
            template: 'orderConfirmation',
            context: {
              orderReference: order.orderNumber, // Changed from reference to orderNumber
              orderDate: new Date(order.createdAt).toLocaleDateString(),
              orderItems: order.items.map(item => ({
                name: item.name, // Changed from productName to name
                quantity: item.quantity,
                price: item.unitPrice.toFixed(2),
                total: item.totalPrice.toFixed(2),
                vendorName: item.product.vendor.storeName
              })),
              subtotal: order.subtotalAmount.toFixed(2), // Changed from subtotal to subtotalAmount
              shipping: order.shippingAmount.toFixed(2), // Changed from shipping to shippingAmount
              tax: order.taxAmount.toFixed(2), // Changed from tax to taxAmount
              discount: order.discountAmount.toFixed(2), // Changed from discount to discountAmount
              total: order.totalAmount.toFixed(2), // Changed from total to totalAmount
              customerName: order.user?.name || 'Valued Customer'
            }
          });
        } catch (error) {
          logger.error('Failed to send order confirmation email:', error);
        }
      }

      // Invalidate relevant caches
      cacheService.invalidatePattern(`user:${order.userId}:orders*`);
      
      logger.info(`Order ${orderId} processed successfully`);
    } catch (error) {
      logger.error('CheckoutService - processCompletedOrder error:', error);
    }
  }

  /**
   * Get checkout session status
   */
  async getCheckoutSessionStatus(sessionId: string): Promise<any> {
    try {
      // Get session from Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      // Get order from database using JSON path query
      const order = await prisma.order.findFirst({
        where: {
          AND: [
            {
              orderMetadata: {
                not: null
              }
            } as any,
            {
              orderMetadata: {
                path: ['stripeCheckoutId'],
                equals: sessionId
              }
            } as any
          ]
        }
      }) as unknown as ExtendedOrder;

      if (!order) {
        return { success: false, error: 'Order not found' };
      }

      return {
        success: true,
        data: {
          status: session.status,
          paymentStatus: session.payment_status,
          orderReference: order.orderNumber, // Changed from reference to orderNumber
          orderStatus: order.status
        }
      };
    } catch (error) {
      logger.error('CheckoutService - getCheckoutSessionStatus error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting checkout status'
      };
    }
  }
}

export const checkoutService = new CheckoutService(); 