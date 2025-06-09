import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { cacheService } from '../services/cacheService';
import { validateProductsForOrder } from './productController';
import { cartItemSchema, applyPromoSchema } from '../utils/validators/cartValidation';
import { NotFoundError, ValidationError, UnauthorizedError, AppError } from '../utils/errors';

const prisma = new PrismaClient();

// Cart TTL in milliseconds (3 days)
const CART_TTL = 3 * 24 * 60 * 60 * 1000;

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Create or initialize a cart
 */
export const initializeCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { sessionId } = req.body;

    // Check if user already has a cart
    if (userId) {
      const existingCart = await prisma.cart.findFirst({
        where: { userId }
      });

      if (existingCart) {
        // Return existing cart
        const fullCart = await prisma.cart.findUnique({
          where: { id: existingCart.id },
          include: { 
            items: {
              include: {
                product: {
                  include: {
                    images: true,
                    vendor: true
                  }
                },
                variant: true
              }
            }
          }
        });

        return res.status(200).json({
          success: true,
          data: fullCart
        });
      }

      // If user doesn't have a cart but we have a session ID,
      // try to find a cart with that session ID and convert it
      if (sessionId) {
        const existingSessionCart = await prisma.cart.findFirst({
          where: { sessionId }
        });

        if (existingSessionCart) {
          // Convert session cart to user cart
          await prisma.cart.update({
            where: { id: existingSessionCart.id },
            data: {
              userId,
              sessionId: null,
              expiresAt: null // Remove expiration for authenticated users
            }
          });

          // Return updated cart
          const fullCart = await prisma.cart.findUnique({
            where: { id: existingSessionCart.id },
            include: { 
              items: {
                include: {
                  product: {
                    include: {
                      images: true,
                      vendor: true
                    }
                  },
                  variant: true
                }
              }
            }
          });

          logger.info(`Cart ${existingSessionCart.id} converted from guest to user cart for user ${userId}`);
          return res.status(200).json({
            success: true,
            data: fullCart
          });
        }
      }
    }

    // Check if session already has a cart
    if (sessionId) {
      const existingGuestCart = await prisma.cart.findFirst({
        where: { sessionId }
      });

      if (existingGuestCart) {
        // If user is now authenticated, convert guest cart to user cart
        if (userId) {
          await prisma.cart.update({
            where: { id: existingGuestCart.id },
            data: { 
              userId,
              sessionId: null,
              expiresAt: null // Remove expiration for authenticated users
            }
          });
          
          logger.info(`Cart ${existingGuestCart.id} converted from guest to user cart for user ${userId}`);
        }

        // Return existing cart
        const fullCart = await prisma.cart.findUnique({
          where: { id: existingGuestCart.id },
          include: { 
            items: {
              include: {
                product: {
                  include: {
                    images: true,
                    vendor: true
                  }
                },
                variant: true
              }
            }
          }
        });

        return res.status(200).json({
          success: true,
          data: fullCart
        });
      }
    }

    // Create a new cart
    const newCart = await prisma.cart.create({
      data: {
        userId,
        sessionId: !userId ? (sessionId || generateSessionId()) : null,
        subtotal: 0,
        discount: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        expiresAt: !userId ? new Date(Date.now() + CART_TTL) : null
      }
    });
    
    logger.info(`New cart created: ${newCart.id}, for ${userId ? `user ${userId}` : 'guest session'}`);

    return res.status(201).json({
      success: true,
      data: newCart
    });
  } catch (error) {
    logger.error('Cart initialization error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to initialize cart';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Get cart by ID or user
 */
export const getCart = async (req: Request, res: Response) => {
  try {
    const { cartId, sessionId } = req.params;
    const userId = req.user?.id;

    let cart = null;

    // Find cart by ID if provided
    if (cartId) {
      cart = await prisma.cart.findUnique({
        where: { id: cartId }
      });
      
      // If user is logged in and cart exists but doesn't have a user ID, 
      // associate the cart with the user (convert guest cart to user cart)
      if (cart && userId && !cart.userId) {
        cart = await prisma.cart.update({
          where: { id: cart.id },
          data: { 
            userId,
            sessionId: null, // Clear session ID since it's now a user cart
            expiresAt: null  // User carts don't expire
          }
        });
        logger.info(`Cart ${cart.id} converted from guest to user cart for user ${userId}`);
      }
    } 
    // Find cart by session ID
    else if (sessionId) {
      cart = await prisma.cart.findFirst({
        where: { sessionId }
      });
      
      // If user is logged in and we found a session cart, convert it to a user cart
      if (cart && userId) {
        cart = await prisma.cart.update({
          where: { id: cart.id },
          data: { 
            userId,
            sessionId: null, // Clear session ID
            expiresAt: null  // User carts don't expire
          }
        });
        logger.info(`Cart ${cart.id} converted from guest to user cart for user ${userId}`);
      }
    } 
    // Find cart by user ID
    else if (userId) {
      cart = await prisma.cart.findFirst({
        where: { userId }
      });
    } else {
      throw new ValidationError('Cart ID, session ID or authenticated user required');
    }

    if (!cart) {
      throw new NotFoundError('Cart not found');
    }

    // Verify cart ownership - only after trying to convert cart
    if (cart.userId && cart.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to access this cart');
    }

    // Get cart with items
    const fullCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { 
        items: {
          include: {
            product: {
              include: {
                images: true,
                vendor: true
              }
            },
            variant: true
          }
        },
        coupon: true
      }
    });

    return res.status(200).json({
      success: true,
      data: fullCart
    });
  } catch (error) {
    logger.error('Get cart error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to get cart';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Add item to cart
 */
export const addItemToCart = async (req: Request, res: Response) => {
  try {
    const { cartId } = req.params;
    const userId = req.user?.id;
    const { productId, variantId, quantity, sessionId } = req.body;

    // Validate input
    if (!productId || !quantity || quantity <= 0) {
      throw new ValidationError('Product ID and quantity are required');
    }

    let cart = null;

    // Find or create cart
    if (cartId) {
      cart = await prisma.cart.findUnique({ where: { id: cartId } });
      
      // If user is logged in and cart exists but doesn't have a user ID, 
      // associate the cart with the user (convert guest cart to user cart)
      if (cart && userId && !cart.userId) {
        cart = await prisma.cart.update({
          where: { id: cart.id },
          data: { 
            userId,
            sessionId: null, // Clear session ID since it's now a user cart
            expiresAt: null  // User carts don't expire
          }
        });
        logger.info(`Cart ${cart.id} converted from guest to user cart for user ${userId}`);
      }
      // Verify ownership only after potential conversion
      else if (cart && cart.userId && cart.userId !== userId) {
        throw new UnauthorizedError('You do not have permission to modify this cart');
      }
    } 
    else if (userId) {
      // Find user cart
      cart = await prisma.cart.findFirst({ where: { userId } });
    }
    else if (sessionId) {
      // Find session cart
      cart = await prisma.cart.findFirst({ where: { sessionId } });
      
      // If user is logged in and we found a session cart, convert it to a user cart
      if (cart && userId) {
        cart = await prisma.cart.update({
          where: { id: cart.id },
          data: { 
            userId,
            sessionId: null,  // Clear session ID
            expiresAt: null   // User carts don't expire
          }
        });
        logger.info(`Cart ${cart.id} converted from guest to user cart for user ${userId}`);
      }
    }

    // Create new cart if needed
    if (!cart) {
      cart = await prisma.cart.create({
        data: {
          userId,
          sessionId: !userId ? (sessionId || generateSessionId()) : null,
          subtotal: 0,
          discount: 0,
          tax: 0,
          shipping: 0,
          total: 0,
          expiresAt: !userId ? new Date(Date.now() + CART_TTL) : null
        }
      });
      logger.info(`New cart created: ${cart.id}, for ${userId ? `user ${userId}` : 'guest session'}`);
    }

    // Validate product exists
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    // Calculate item price
    let price = product.price;
    
    // Check variant if provided
    if (variantId) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId }
      });
      
      if (!variant || variant.productId !== productId) {
        throw new ValidationError('Invalid product variant');
      }
      
      if (variant.price) {
        price = variant.price;
      }
    }

    // Check if item already exists in cart
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId,
        ...(variantId ? { variantId } : {})
      }
    });

    if (existingItem) {
      // Update existing item
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { 
          quantity: existingItem.quantity + quantity,
          price,
          totalPrice: price * (existingItem.quantity + quantity)
        }
      });
    } else {
      // Add new item
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          variantId,
          quantity,
          price,
          totalPrice: price * quantity,
          options: {}
        }
      });
    }

    // Update cart totals
    await updateCartTotals(cart.id);

    // Get updated cart
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { 
        items: {
          include: {
            product: {
              include: {
                images: true,
                vendor: true
              }
            },
            variant: true
          }
        },
        coupon: true
      }
    });

    return res.status(200).json({
      success: true,
      data: updatedCart
    });
  } catch (error) {
    logger.error('Add item to cart error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to add item to cart';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Update cart item quantity
 */
export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const { cartId, itemId } = req.params;
    const userId = req.user?.id;
    const { quantity } = req.body;

    if (quantity === undefined || typeof quantity !== 'number') {
      throw new ValidationError('Valid quantity is required');
    }

    // Find cart and verify ownership
    const cart = await prisma.cart.findUnique({
      where: { id: cartId }
    });

    if (!cart) {
      throw new NotFoundError('Cart not found');
    }

    if (cart.userId && cart.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to modify this cart');
    }

    // Find cart item
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId }
    });

    if (!cartItem || cartItem.cartId !== cartId) {
      throw new NotFoundError('Cart item not found');
    }

    if (quantity <= 0) {
      // Remove item if quantity is 0 or negative
      await prisma.cartItem.delete({
        where: { id: itemId }
      });
    } else {
      // Update item quantity
      await prisma.cartItem.update({
        where: { id: itemId },
        data: {
          quantity,
          totalPrice: cartItem.price * quantity
        }
      });
    }

    // Update cart totals
    await updateCartTotals(cartId);

    // Get updated cart
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { 
        items: {
          include: {
            product: {
              include: {
                images: true,
                vendor: true
              }
            },
            variant: true
          }
        },
        coupon: true
      }
    });

    return res.status(200).json({
      success: true,
      data: updatedCart
    });
  } catch (error) {
    logger.error('Update cart item error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to update cart item';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Remove item from cart
 */
export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const { cartId, itemId } = req.params;
    const userId = req.user?.id;

    // Find cart and verify ownership
    const cart = await prisma.cart.findUnique({
      where: { id: cartId }
    });

    if (!cart) {
      throw new NotFoundError('Cart not found');
    }

    if (cart.userId && cart.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to modify this cart');
    }

    // Find and delete cart item
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId }
    });

    if (!cartItem || cartItem.cartId !== cartId) {
      throw new NotFoundError('Cart item not found');
    }

    await prisma.cartItem.delete({
      where: { id: itemId }
    });

    // Update cart totals
    await updateCartTotals(cartId);

    // Get updated cart
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { 
        items: {
          include: {
            product: {
              include: {
                images: true,
                vendor: true
              }
            },
            variant: true
          }
        },
        coupon: true
      }
    });

    return res.status(200).json({
      success: true,
      data: updatedCart
    });
  } catch (error) {
    logger.error('Remove cart item error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to remove cart item';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Clear cart (remove all items)
 */
export const clearCart = async (req: Request, res: Response) => {
  try {
    const { cartId } = req.params;
    const userId = req.user?.id;

    // Find cart and verify ownership
    const cart = await prisma.cart.findUnique({
      where: { id: cartId }
    });

    if (!cart) {
      throw new NotFoundError('Cart not found');
    }

    if (cart.userId && cart.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to modify this cart');
    }

    // Delete all cart items
    await prisma.cartItem.deleteMany({
      where: { cartId }
    });

    // Reset cart totals
    await prisma.cart.update({
      where: { id: cartId },
      data: {
        subtotal: 0,
        discount: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        couponId: null
      }
    });

    return res.status(200).json({
      success: true,
      data: { id: cartId, message: 'Cart cleared successfully' }
    });
  } catch (error) {
    logger.error('Clear cart error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to clear cart';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Apply coupon to cart
 */
export const applyCoupon = async (req: Request, res: Response) => {
  try {
    const { cartId } = req.params;
    const userId = req.user?.id;
    const { couponCode } = req.body;

    if (!couponCode) {
      throw new ValidationError('Coupon code is required');
    }

    // Find cart and verify ownership
    const cart = await prisma.cart.findUnique({
      where: { id: cartId }
    });

    if (!cart) {
      throw new NotFoundError('Cart not found');
    }

    if (cart.userId && cart.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to modify this cart');
    }

    // Find coupon
    const coupon = await prisma.coupon.findUnique({
      where: { code: couponCode }
    });

    if (!coupon) {
      throw new ValidationError('Invalid coupon code');
    }

    if (!coupon.isActive) {
      throw new ValidationError('This coupon is not active');
    }

    const now = new Date();
    if (coupon.startDate && now < coupon.startDate) {
      throw new ValidationError('This coupon is not yet active');
    }

    if (coupon.endDate && now > coupon.endDate) {
      throw new ValidationError('This coupon has expired');
    }

    // Apply coupon to cart
    await prisma.cart.update({
      where: { id: cartId },
      data: { couponId: coupon.id }
    });

    // Update cart totals
    await updateCartTotals(cartId);

    // Get updated cart
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { 
        items: {
          include: {
            product: {
              include: {
                images: true,
                vendor: true
              }
            },
            variant: true
          }
        },
        coupon: true
      }
    });

    return res.status(200).json({
      success: true,
      data: updatedCart
    });
  } catch (error) {
    logger.error('Apply coupon error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to apply coupon';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Remove coupon from cart
 */
export const removeCoupon = async (req: Request, res: Response) => {
  try {
    const { cartId } = req.params;
    const userId = req.user?.id;

    // Find cart and verify ownership
    const cart = await prisma.cart.findUnique({
      where: { id: cartId }
    });

    if (!cart) {
      throw new NotFoundError('Cart not found');
    }

    if (cart.userId && cart.userId !== userId) {
      throw new UnauthorizedError('You do not have permission to modify this cart');
    }

    // Remove coupon from cart
    await prisma.cart.update({
      where: { id: cartId },
      data: { couponId: null }
    });

    // Update cart totals
    await updateCartTotals(cartId);

    // Get updated cart
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { 
        items: {
          include: {
            product: {
              include: {
                images: true,
                vendor: true
              }
            },
            variant: true
          }
        },
        coupon: true
      }
    });

    return res.status(200).json({
      success: true,
      data: updatedCart
    });
  } catch (error) {
    logger.error('Remove coupon error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to remove coupon';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

/**
 * Update cart totals
 */
async function updateCartTotals(cartId: string): Promise<void> {
  // Get all cart items
  const cartItems = await prisma.cartItem.findMany({
    where: { cartId }
  });
  
  // Calculate subtotal
  const subtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  
  // Get cart to check for coupon
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: { coupon: true }
  });
  
  if (!cart) return;
  
  // Calculate discount based on coupon
  let discount = 0;
  if (cart.coupon) {
    if (cart.coupon.type === 'PERCENTAGE') {
      discount = subtotal * (cart.coupon.value / 100);
      // Apply max discount if set
      if (cart.coupon.maxDiscount && discount > cart.coupon.maxDiscount) {
        discount = cart.coupon.maxDiscount;
      }
    } else if (cart.coupon.type === 'FIXED_AMOUNT') {
      discount = Math.min(subtotal, cart.coupon.value);
    }
  }
  
  // Calculate tax and shipping (simplified)
  const tax = 0;
  const shipping = 0;
  
  // Calculate total
  const total = Math.max(0, subtotal - discount + tax + shipping);
  
  // Update cart
  await prisma.cart.update({
    where: { id: cartId },
    data: { 
      subtotal,
      discount,
      tax,
      shipping,
      total
    }
  });
}

/**
 * Validate cart before checkout
 */
export const validateCart = async (req: Request, res: Response) => {
  try {
    const { cartId } = req.params;
    const userId = req.user?.id;
    const { sessionId } = req.body;

    // Find cart and verify ownership
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { 
        items: true,
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
      return res.status(200).json({
        success: false,
        message: 'Cart is empty',
        data: {
          valid: false,
          reason: 'CART_EMPTY'
        }
      });
    }

    // Validate each product in the cart
    const itemsToValidate = cart.items.map(item => ({
      productId: item.productId,
      variantId: item.variantId || undefined,
      quantity: item.quantity
    }));

    // Assuming validateProductsForOrder from productController returns validation results
    const validationResults = await validateProductsForOrder(itemsToValidate);
    
    // Check if all items are valid
    const invalidItems = validationResults.filter(item => !item.valid);
    
    if (invalidItems.length > 0) {
      return res.status(200).json({
        success: false,
        message: 'Some items in your cart are no longer available',
        data: {
          valid: false,
          reason: 'ITEMS_UNAVAILABLE',
          invalidItems: invalidItems.map(item => ({
            productId: item.productId,
            variantId: item.variantId,
            message: item.message
          }))
        }
      });
    }

    // Validate coupon if present
    if (cart.couponId && cart.coupon) {
      // Check if coupon is active
      if (!cart.coupon.isActive) {
        return res.status(200).json({
          success: false,
          message: 'The applied coupon is no longer active',
          data: {
            valid: false,
            reason: 'COUPON_INACTIVE'
          }
        });
      }

      // Check coupon date validity
      const now = new Date();
      if (cart.coupon.startDate && now < cart.coupon.startDate) {
        return res.status(200).json({
          success: false,
          message: 'The applied coupon is not yet active',
          data: {
            valid: false,
            reason: 'COUPON_NOT_STARTED'
          }
        });
      }

      if (cart.coupon.endDate && now > cart.coupon.endDate) {
        return res.status(200).json({
          success: false,
          message: 'The applied coupon has expired',
          data: {
            valid: false,
            reason: 'COUPON_EXPIRED'
          }
        });
      }

      // Check minimum order amount
      if (cart.coupon.minOrderAmount && cart.subtotal < cart.coupon.minOrderAmount) {
        return res.status(200).json({
          success: false,
          message: `Minimum purchase of $${cart.coupon.minOrderAmount.toFixed(2)} required for this coupon`,
          data: {
            valid: false,
            reason: 'MINIMUM_PURCHASE_NOT_MET',
            requiredAmount: cart.coupon.minOrderAmount
          }
        });
      }

      // Check usage limit
      if (cart.coupon.usageLimit && cart.coupon.usageCount >= cart.coupon.usageLimit) {
        return res.status(200).json({
          success: false,
          message: 'This coupon has reached its usage limit',
          data: {
            valid: false,
            reason: 'COUPON_USAGE_LIMIT_REACHED'
          }
        });
      }

      // Check user usage limit if authenticated
      if (userId && cart.coupon.userUsageLimit) {
        const userUsageCount = await prisma.order.count({
          where: {
            userId,
            couponId: cart.couponId
          }
        });

        if (userUsageCount >= cart.coupon.userUsageLimit) {
          return res.status(200).json({
            success: false,
            message: 'You have reached the personal usage limit for this coupon',
            data: {
              valid: false,
              reason: 'USER_COUPON_LIMIT_REACHED'
            }
          });
        }
      }
    }

    // If we made it here, the cart is valid
    return res.status(200).json({
      success: true,
      data: {
        valid: true,
        cart: {
          id: cart.id,
          subtotal: cart.subtotal,
          discount: cart.discount,
          tax: cart.tax,
          shipping: cart.shipping,
          total: cart.total,
          itemCount: cart.items.length,
          couponApplied: !!cart.couponId
        }
      }
    });
  } catch (error) {
    logger.error('Cart validation error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to validate cart';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export default {
  initializeCart,
  getCart,
  addItemToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  applyCoupon,
  removeCoupon,
  validateCart
};
