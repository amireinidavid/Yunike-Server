import Joi from 'joi';

/**
 * Schema for creating a new product
 */
export const createProductSchema = Joi.object({
  name: Joi.string().required().min(2).max(255).trim(),
  slug: Joi.string().min(2).max(255).pattern(/^[a-z0-9-]+$/).trim()
    .message('Slug must contain only lowercase letters, numbers, and hyphens'),
  description: Joi.string().allow('', null).max(10000),
  shortDescription: Joi.string().allow('', null).max(500),
  price: Joi.number().required().min(0),
  comparePrice: Joi.number().min(0).allow(null),
  costPrice: Joi.number().min(0).allow(null),
  wholesalePrice: Joi.number().min(0).allow(null),
  wholesaleMinQty: Joi.number().integer().min(1).allow(null),
  sku: Joi.string().allow('', null).max(100),
  barcode: Joi.string().allow('', null).max(100),
  inventory: Joi.number().integer().min(0).default(0),
  lowStockThreshold: Joi.number().integer().min(0).default(5),
  weight: Joi.number().min(0).allow(null),
  dimensions: Joi.object({
    length: Joi.number().min(0),
    width: Joi.number().min(0),
    height: Joi.number().min(0)
  }).allow(null),
  isPublished: Joi.boolean().default(false),
  isDigital: Joi.boolean().default(false),
  digitalFileUrl: Joi.string().uri().allow('', null).when('isDigital', {
    is: true,
    then: Joi.required()
  }),
  hasVariants: Joi.boolean().default(false),
  isFeatured: Joi.boolean().default(false),
  isOnSale: Joi.boolean().default(false),
  saleStartDate: Joi.date().allow(null).when('isOnSale', {
    is: true,
    then: Joi.required()
  }),
  saleEndDate: Joi.date().allow(null).min(Joi.ref('saleStartDate')).when('isOnSale', {
    is: true,
    then: Joi.required()
  }),
  metaTitle: Joi.string().allow('', null).max(255),
  metaDescription: Joi.string().allow('', null).max(500),
  metaKeywords: Joi.array().items(Joi.string()).default([]),
  shippingClass: Joi.string().allow('', null).max(100),
  tagsAndKeywords: Joi.array().items(Joi.string()).default([]),
  condition: Joi.string().valid('NEW', 'USED', 'REFURBISHED', 'COLLECTIBLE').default('NEW'),
  warrantyInfo: Joi.string().allow('', null).max(1000),
  returnPolicy: Joi.string().allow('', null).max(1000),
  attributes: Joi.object().pattern(
    Joi.string(),
    Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean(), Joi.array().items(Joi.string()))
  ).allow(null),
  
  // Related resources
  categories: Joi.array().items(Joi.object({
    categoryId: Joi.string().required(),
    isPrimary: Joi.boolean().default(false)
  })),
  
  // Images
  images: Joi.array().items(
    Joi.alternatives().try(
      // URL string
      Joi.string().uri(),
      // Base64 encoded image
      Joi.string().pattern(/^data:image\/[a-zA-Z+]+;base64,/),
      // Uploaded file object from multer
      Joi.object({
        originalname: Joi.string().required(),
        path: Joi.string().required(),
        mimetype: Joi.string().pattern(/^image\//).required(),
        size: Joi.number().required()
      }),
      // Object with base64 data (from frontend)
      Joi.object({
        id: Joi.string(),
        data: Joi.string().pattern(/^data:image\/[a-zA-Z+]+;base64,/).required(),
        alt: Joi.string().allow(null, ''),
        isDefault: Joi.boolean().default(false)
      }),
      // Object with URL (from frontend)
      Joi.object({
        id: Joi.string(),
        url: Joi.string().uri().required(),
        alt: Joi.string().allow(null, ''),
        isDefault: Joi.boolean().default(false)
      })
    )
  ),
  
  // Variants
  variants: Joi.array().items(Joi.object({
    name: Joi.string().allow('', null),
    options: Joi.array().items(
      Joi.alternatives().try(
        // Support for string options
        Joi.string(),
        // Support for object options
        Joi.object()
      )
    ),
    price: Joi.number().min(0).allow(null),
    comparePrice: Joi.number().min(0).allow(null),
    inventory: Joi.number().integer().min(0).default(0),
    sku: Joi.string().allow('', null).max(100),
    barcode: Joi.string().allow('', null).max(100),
    weight: Joi.number().min(0).allow(null),
    dimensions: Joi.object({
      length: Joi.number().min(0),
      width: Joi.number().min(0),
      height: Joi.number().min(0)
    }).allow(null),
    imageUrls: Joi.array().items(Joi.string()),
    isDefault: Joi.boolean().default(false)
  })).when('hasVariants', {
    is: true,
    then: Joi.array().min(1).required()
  }),
  
  // Specifications
  specifications: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    value: Joi.string().required(),
    unit: Joi.string().allow('', null),
    group: Joi.string().allow('', null),
    position: Joi.number().integer().min(0).default(0),
    isTechnical: Joi.boolean().default(false),
    isFilterable: Joi.boolean().default(false)
  })),
  
  // Related products
  relatedProducts: Joi.array().items(Joi.object({
    relatedProductId: Joi.string().required(),
    relationType: Joi.string().valid('SIMILAR', 'ACCESSORY', 'UPSELL', 'CROSS_SELL').required(),
    position: Joi.number().integer().min(0).default(0)
  }))
});

/**
 * Schema for updating an existing product
 */
export const updateProductSchema = createProductSchema.fork(
  ['name', 'price'], // Make these optional for updates
  (schema) => schema.optional()
);

/**
 * Schema for updating product inventory
 */
export const updateInventorySchema = Joi.object({
  inventory: Joi.number().integer().min(0),
  variantInventory: Joi.object().pattern(
    // Variant ID as key
    Joi.string(),
    // Inventory count as value
    Joi.number().integer().min(0)
  ),
  reason: Joi.string().max(500).allow('', null)
}).or('inventory', 'variantInventory');

/**
 * Schema for searching products
 */
export const searchProductsSchema = Joi.object({
  query: Joi.string().allow('', null),
  category: Joi.string().allow('', null),
  minPrice: Joi.number().min(0).allow(null),
  maxPrice: Joi.number().min(0).allow(null).greater(Joi.ref('minPrice')),
  vendorId: Joi.string().allow('', null),
  sort: Joi.string().valid('newest', 'oldest', 'price_asc', 'price_desc', 'popular', 'rating').default('newest'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  condition: Joi.string().valid('NEW', 'USED', 'REFURBISHED', 'COLLECTIBLE').allow(null),
  inStock: Joi.boolean().allow(null)
});

export default {
  createProductSchema,
  updateProductSchema,
  updateInventorySchema,
  searchProductsSchema
}; 