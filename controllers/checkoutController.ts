import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { logger } from '../utils/logger';
import { validateCart } from './cartController';
import { validateProductsForOrder, decreaseInventory } from './productController';
import { NotFoundError, ValidationError, UnauthorizedError, AppError } from '../utils/errors';
import { v4 as uuidv4 } from 'uuid';
import { publishEvent } from '../utils/eventBus';
import { checkoutService } from '../services/checkoutService';

// Define extended interfaces to handle the missing fields in Prisma models
interface ExtendedOrderCreateInput extends Prisma.OrderCreateInput {
  metadata: string;
  orderItems?: any;
  emailAddress?: string;
  currency?: string;
}

interface ExtendedOrderUpdateInput extends Prisma.OrderUpdateInput {
  metadata?: string;
}

interface ExtendedCartUpdateInput extends Prisma.CartUpdateInput {
  isCheckedOut?: boolean;
  orderId?: string;
  couponId?: string | null;
}

interface ExtendedOrderWhereInput extends Prisma.OrderWhereInput {
  metadata?: Prisma.StringFilter;
}

interface ExtendedOrderInclude extends Prisma.OrderInclude {
  items?: boolean;
  orderItems?: boolean;
}

// Create a Prisma client
const prisma = new PrismaClient();

// Create typed Prisma client for use with extended interfaces
const typedPrisma = prisma as unknown as {
  order: {
    create: (args: { data: ExtendedOrderCreateInput }) => Promise<any>;
    update: (args: { where: Prisma.OrderWhereUniqueInput, data: ExtendedOrderUpdateInput }) => Promise<any>;
    findFirst: (args: { where: ExtendedOrderWhereInput, include?: ExtendedOrderInclude }) => Promise<any>;
  },
  cart: {
    update: (args: { where: Prisma.CartWhereUniqueInput, data: ExtendedCartUpdateInput }) => Promise<any>;
    findUnique: (args: { 
      where: Prisma.CartWhereUniqueInput;
      include?: any;
    }) => Promise<any>;
  }
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-04-30.basil',
});

const APP_FEE_PERCENTAGE = Number(process.env.STRIPE_APP_FEE_PERCENTAGE) || 10;

/**
 * Create a checkout session for the cart
 */
export const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { cartId } = req.params;
    const { successUrl, cancelUrl } = req.body;
    const userId = req.user?.id;

    if (!successUrl || !cancelUrl) {
      throw new ValidationError('Success URL and cancel URL are required');
    }

    // Find the cart and validate it
    const cart = await typedPrisma.cart.findUnique({
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
                    stripeAccountId: true,
                    storeName: true
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
      throw new NotFoundError('Cart not found');
    }

    // Verify cart ownership
    if (cart.userId && cart.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to access this cart');
    }

    // Check if cart is empty
    if (cart.items.length === 0) {
      throw new ValidationError('Cart is empty');
    }

    // Validate cart items are available
    const itemsToValidate = cart.items.map((item: any) => ({
      productId: item.productId,
      variantId: item.variantId || undefined,
      quantity: item.quantity
    }));

    const validationResults = await validateProductsForOrder(itemsToValidate);
    const invalidItems = validationResults.filter(item => !item.valid);
    
    if (invalidItems.length > 0) {
      throw new ValidationError(
        'Some items in your cart are no longer available',
        invalidItems.map(item => ({
          productId: item.productId,
          variantId: item.variantId,
          message: item.message
        }))
      );
    }

    // Group items by vendor for separate payment intents
    const itemsByVendor = cart.items.reduce((acc: Record<string, any>, item: any) => {
      const vendorId = item.product.vendor.id;
      if (!acc[vendorId]) {
        acc[vendorId] = {
          vendorId,
          stripeAccountId: item.product.vendor.stripeAccountId,
          storeName: item.product.vendor.storeName,
          items: []
        };
      }
      acc[vendorId].items.push(item);
      return acc;
    }, {} as Record<string, { vendorId: string, stripeAccountId: string | null, storeName: string, items: any[] }>);

    // Check if all vendors have Stripe accounts
    const vendorsWithoutStripe = Object.values(itemsByVendor).filter((v: any) => !v.stripeAccountId);
    if (vendorsWithoutStripe.length > 0) {
      throw new ValidationError(
        'Some vendors are not set up for payments yet',
        vendorsWithoutStripe.map((v: any) => ({
          vendorId: v.vendorId,
          storeName: v.storeName
        }))
      );
    }

    // Create a unique order reference
    const orderReference = `order_${uuidv4().replace(/-/g, '').substring(0, 16)}`;

    // Create line items for Stripe checkout
    const lineItems: Array<{
      price_data: {
        currency: string;
        product_data: {
          name: string;
          description?: string;
          images?: string[];
          metadata: Record<string, string>;
        };
        unit_amount: number;
      };
      quantity: number;
    }> = [];
    
    cart.items.forEach((item: any) => {
      const price = item.variant?.price || item.product.price;
      
      const lineItem = {
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.product.name,
            description: item.variant 
              ? `Variant: ${JSON.stringify(item.variant.options)}` 
              : item.product.shortDescription || undefined,
            metadata: {
              productId: item.productId,
              variantId: item.variantId || '',
              vendorId: item.product.vendorId
            } as Record<string, string>
          },
          unit_amount: Math.round(price * 100), // Convert to cents
        },
        quantity: item.quantity,
      };

      // Add images if they exist
      if (item.product.images && item.product.images.length > 0) {
        (lineItem.price_data.product_data as any).images = [item.product.images[0].url];
      }
      
      lineItems.push(lineItem as any);
    });

    // Apply coupon if present
    let discounts;
    if (cart.coupon) {
      if (cart.coupon.type === 'PERCENTAGE') {
        const couponName = (cart.coupon as any).name || 'Discount';
        discounts = [{
          coupon: await getOrCreateStripeCoupon(cart.coupon.code, {
            percent_off: cart.coupon.value,
            duration: 'once',
            name: `${couponName} ${cart.coupon.value}% off`
          })
        }];
      } else if (cart.coupon.type === 'FIXED_AMOUNT') {
        const couponName = (cart.coupon as any).name || 'Discount';
        discounts = [{
          coupon: await getOrCreateStripeCoupon(cart.coupon.code, {
            amount_off: Math.round(cart.coupon.value * 100),
            currency: 'usd',
            duration: 'once',
            name: `${couponName} $${cart.coupon.value} off`
          })
        }];
      }
    }

    // Fix type for destination
    const destination = Object.values(itemsByVendor)[0] as unknown as { stripeAccountId: string };

    // Create checkout session with Stripe
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      discounts,
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&order_ref=${orderReference}`,
      cancel_url: cancelUrl,
      client_reference_id: cartId,
      customer_email: req.user?.email || (cart as any).email || undefined,
      metadata: {
        cartId,
        orderReference,
        userId: userId || 'guest'
      },
      payment_intent_data: {
        application_fee_amount: Math.round(cart.total * (APP_FEE_PERCENTAGE / 100) * 100), // Convert to cents
        transfer_data: {
          destination: destination.stripeAccountId, // For simplicity, using first vendor
        },
        metadata: {
          cartId,
          orderReference,
          userId: userId || 'guest'
        }
      }
    });

    // Create a pending order in the database
    const order = await typedPrisma.order.create({
      data: {
        orderNumber: orderReference,
        user: { connect: { id: userId || 'guest' } },
        shippingAddress: {
          create: {
            street: '123 Main St',
            apartment: 'Apt 4B',
            city: 'New York',
            state: 'NY',
            postalCode: '10001',
            country: 'US',
            userId: userId || 'guest'
          }
        },
        status: 'PROCESSING',
        totalAmount: cart.total,
        subtotalAmount: cart.subtotal,
        taxAmount: cart.tax,
        shippingAmount: cart.shipping,
        discountAmount: cart.discount,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'PAID',
        metadata: JSON.stringify({
          stripeCheckoutId: session.id,
          stripeSessionUrl: session.url,
          sessionExpiry: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        }),
        items: {
          create: cart.items.map((item: any) => ({
            name: item.product.name,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.totalPrice,
            productId: item.productId,
            variantId: item.variantId || undefined,
            vendorId: item.product.vendorId
          }))
        }
      }
    });

    logger.info(`Order ${order.id} created with reference ${orderReference} and Stripe session ${session.id}`);

    // Return session ID to be used by Stripe.js
    return res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        orderReference: orderReference,
        url: session.url
      }
    });
  } catch (error) {
    logger.error('Checkout session creation error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to create checkout session';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Handle webhook events from Stripe
 */
export const handleCheckoutWebhook = async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!signature || !webhookSecret) {
    return res.status(400).json({
      success: false,
      message: 'Missing signature or webhook secret'
    });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.expired':
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Webhook error:', error);
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Webhook error'
    });
  }
};

/**
 * Get checkout session status
 */
export const getCheckoutStatus = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.id;

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    // Get session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    // Get order reference from session metadata
    const orderReference = session.metadata?.orderReference;
    
    if (!orderReference) {
      throw new ValidationError('Order reference not found in session');
    }
    
    // Find order by orderReference/orderNumber
    const order = await prisma.order.findUnique({
      where: { orderNumber: orderReference },
      include: { items: true }
    });
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Verify ownership if user is logged in
    if (userId && order.userId && order.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to access this order');
    }

    return res.status(200).json({
      success: true,
      data: {
        status: session.status,
        paymentStatus: session.payment_status,
        orderReference: order.orderNumber,
        orderStatus: order.status
      }
    });
  } catch (error) {
    logger.error('Get checkout status error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to get checkout status';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Get an existing Stripe coupon or create a new one
 */
async function getOrCreateStripeCoupon(code: string, params: Stripe.CouponCreateParams): Promise<string> {
  try {
    // Try to get existing coupon
    const existingCoupons = await stripe.coupons.list({ limit: 100 });
    const existingCoupon = existingCoupons.data.find(c => c.name === params.name || c.id === code);
    
    if (existingCoupon) {
      return existingCoupon.id;
    }
    
    // Create new coupon
    const newCoupon = await stripe.coupons.create({
      ...params,
      id: code.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
    });
    
    return newCoupon.id;
  } catch (error) {
    logger.error('Error creating Stripe coupon:', error);
    // If there's an error, just return a dummy coupon ID so checkout can continue
    return 'NO_COUPON';
  }
}

/**
 * Handle checkout.session.completed event from Stripe
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  try {
    // Get order reference from the session metadata
    const orderReference = session.metadata?.orderReference;
    
    if (!orderReference) {
      logger.error(`Order reference not found in session ${session.id}`);
      return;
    }
    
    // Find the order by order reference
    const order = await prisma.order.findUnique({
      where: { orderNumber: orderReference },
      include: { 
        items: true
      }
    });

    if (!order) {
      logger.error(`Order not found for reference ${orderReference}`);
      return;
    }

    // Update order status
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PROCESSING',
        paymentStatus: 'PAID',
        metadata: JSON.stringify({
          ...JSON.parse(order.metadata || '{}'),
          stripePaymentIntentId: session.payment_intent,
          paymentCompleted: true,
          paymentCompletedAt: new Date().toISOString()
        })
      }
    });

    // Update cart and clear items
    const cart = await typedPrisma.cart.findUnique({
      where: { id: session.client_reference_id as string }
    });

    if (cart) {
      // Mark the cart as checked out
      await typedPrisma.cart.update({
        where: { id: cart.id },
        data: {
          isCheckedOut: true,
          orderId: order.id
        }
      });
      
      // Clear all cart items
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id }
      });
      
      // Reset cart totals but maintain the reference to the order
      await typedPrisma.cart.update({
        where: { id: cart.id },
        data: {
          subtotal: 0,
          discount: 0,
          tax: 0,
          shipping: 0,
          total: 0
        }
      });
      
      logger.info(`Cart ${cart.id} cleared after successful payment`);
    }

    // Update inventory
    const inventoryUpdates = order.items.map((item: any) => ({
      productId: item.productId!,
      variantId: item.variantId || undefined,
      quantity: item.quantity,
      orderId: order.id
    }));

    await decreaseInventory(inventoryUpdates);

    // Use checkout service to process the completed order
    await checkoutService.processCompletedOrder(order.id);

    // Publish order.created event
    publishEvent('order.created', {
      orderId: order.id,
      userId: order.userId || 'guest',
      status: order.status,
      total: order.totalAmount
    });

    logger.info(`Order ${order.id} (ref: ${order.orderNumber}) confirmed from session ${session.id}`);
  } catch (error) {
    logger.error('Error handling checkout.session.completed webhook:', error);
  }
}

/**
 * Handle checkout.session.expired event from Stripe
 */
async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  try {
    // Get order reference from session metadata
    const orderReference = session.metadata?.orderReference;
    
    if (!orderReference) {
      logger.error(`Order reference not found in session ${session.id}`);
      return;
    }
    
    // Find the order by reference
    const order = await prisma.order.findUnique({
      where: { orderNumber: orderReference }
    });

    if (!order) {
      logger.error(`Order not found for reference ${orderReference}`);
      return;
    }

    // Update order status
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        paymentStatus: 'FAILED',
        metadata: JSON.stringify({
          ...JSON.parse(order.metadata || '{}'),
          expiredAt: new Date().toISOString()
        })
      }
    });
    
    logger.info(`Order ${order.id} (ref: ${order.orderNumber}) marked as expired`);
  } catch (error) {
    logger.error('Error handling checkout.session.expired webhook:', error);
  }
}

/**
 * Handle payment_intent.succeeded event from Stripe
 */
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  try {
    // Try to find the order using the payment intent's metadata
    const orderReference = paymentIntent.metadata?.orderReference;
    
    if (!orderReference) {
      logger.error(`Order reference not found in payment intent ${paymentIntent.id}`);
      return;
    }
    
    // Get the order by reference
    const order = await prisma.order.findUnique({
      where: { orderNumber: orderReference }
    });

    if (!order) {
      logger.error(`Order not found for reference ${orderReference}`);
      return;
    }

    if (order.status === 'PENDING') {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'PROCESSING',
          paymentStatus: 'PAID',
          metadata: JSON.stringify({
            ...JSON.parse(order.metadata || '{}'),
            paymentCompleted: true,
            paymentCompletedAt: new Date().toISOString()
          })
        }
      });
      
      logger.info(`Order ${order.id} (ref: ${order.orderNumber}) confirmed from payment intent ${paymentIntent.id}`);
    }
  } catch (error) {
    logger.error('Error handling payment_intent.succeeded webhook:', error);
  }
}

/**
 * Handle payment_intent.payment_failed event from Stripe
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  try {
    // Try to find the order using the payment intent's metadata
    const orderReference = paymentIntent.metadata?.orderReference;
    
    if (!orderReference) {
      logger.error(`Order reference not found in payment intent ${paymentIntent.id}`);
      return;
    }
    
    // Get the order by reference
    const order = await prisma.order.findUnique({
      where: { orderNumber: orderReference }
    });

    if (!order) {
      logger.error(`Order not found for reference ${orderReference}`);
      return;
    }

    // Update order status
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        paymentStatus: 'FAILED',
        metadata: JSON.stringify({
          ...JSON.parse(order.metadata || '{}'),
          paymentFailedAt: new Date().toISOString(),
          paymentError: paymentIntent.last_payment_error?.message || 'Payment failed'
        })
      }
    });
    
    logger.info(`Order ${order.id} (ref: ${order.orderNumber}) payment failed`);
  } catch (error) {
    logger.error('Error handling payment_intent.payment_failed webhook:', error);
  }
}