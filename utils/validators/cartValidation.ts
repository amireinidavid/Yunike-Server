import Joi from 'joi';

export const cartItemSchema = Joi.object({
  productId: Joi.string().required().messages({
    'any.required': 'Product ID is required',
    'string.empty': 'Product ID cannot be empty'
  }),
  variantId: Joi.string().allow(null, '').optional(),
  quantity: Joi.number().integer().min(1).required().messages({
    'any.required': 'Quantity is required',
    'number.base': 'Quantity must be a number',
    'number.integer': 'Quantity must be an integer',
    'number.min': 'Quantity must be at least 1'
  })
});

export const cartUpdateSchema = Joi.object({
  items: Joi.array().items(cartItemSchema).min(1).required().messages({
    'any.required': 'At least one item is required',
    'array.min': 'At least one item is required'
  })
});

export const applyPromoSchema = Joi.object({
  promoCode: Joi.string().required().messages({
    'any.required': 'Promo code is required',
    'string.empty': 'Promo code cannot be empty'
  })
});

export const cartGuestSchema = Joi.object({
  guestId: Joi.string().required().messages({
    'any.required': 'Guest ID is required',
    'string.empty': 'Guest ID cannot be empty'
  })
});

export default {
  cartItemSchema,
  cartUpdateSchema,
  applyPromoSchema,
  cartGuestSchema
}; 