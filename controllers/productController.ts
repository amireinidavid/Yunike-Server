import { Request, Response } from 'express';
import { PrismaClient, Product, ProductVariant, ProductImage, ProductSpecification, ProductCondition, Prisma } from '@prisma/client';
import { publishEvent } from '../utils/eventBus';
import { cacheService } from '../services/cacheService';
import { createProductSchema, updateProductSchema, updateInventorySchema } from '../utils/validators/productValidation';
import { uploadService } from '../services/uploadService';
import { searchService } from '../services/searchService';
import { analyticsService } from '../services/analyticsService';
import { NotFoundError, ValidationError, UnauthorizedError, AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { kafkaService, InventoryEvent } from '../services/kafkaService';
import { realtimeService } from '../services/realtimeService';

const prisma = new PrismaClient();

// Extend Express Request type to include user and vendor properties
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string;
      role: string;
      permissions?: string[];
    };
    vendor?: any;
  }
}

// Type for product input data from request
interface ProductInput {
  name: string;
  slug?: string;
  description?: string | null;
  shortDescription?: string | null;
  price: number;
  comparePrice?: number | null;
  costPrice?: number | null;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
  sku?: string | null;
  barcode?: string | null;
  inventory?: number;
  lowStockThreshold?: number | null;
  weight?: number | null;
  dimensions?: any | null;
  isPublished?: boolean;
  isDigital?: boolean;
  digitalFileUrl?: string | null;
  hasVariants?: boolean;
  isFeatured?: boolean;
  isOnSale?: boolean;
  saleStartDate?: Date | null;
  saleEndDate?: Date | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string[];
  shippingClass?: string | null;
  tagsAndKeywords?: string[];
  condition?: ProductCondition;
  warrantyInfo?: string | null;
  returnPolicy?: string | null;
  attributes?: any | null;
  variants?: any[];
  specifications?: any[];
  images?: any[];
  categories?: any[];
  relatedProducts?: any[];
}

/**
 * Validate product data against schema
 */
const validateProductData = (data: ProductInput, isUpdate = false): Prisma.ProductCreateInput | Prisma.ProductUpdateInput => {
  // Log the incoming data for debugging
  console.log('[productController] Incoming product data:', JSON.stringify(data, null, 2));
  
  // Debug images and variants specifically
  if (data.images && data.images.length > 0) {
    console.log(`[productController] Processing ${data.images.length} images`);
    data.images.forEach((img, idx) => {
      const imgType = typeof img === 'string' 
        ? 'string' 
        : (img.data ? 'object with data' : img.url ? 'object with url' : 'other object type');
      console.log(`[productController] Image ${idx} type: ${imgType}`);
    });
  }
  
  if (data.variants && data.variants.length > 0) {
    console.log(`[productController] Processing ${data.variants.length} variants`);
    data.variants.forEach((v, idx) => {
      console.log(`[productController] Variant ${idx} options: ${JSON.stringify(v.options)}`);
    });
  }
  
  // Validate against schema
  const schema = isUpdate ? updateProductSchema : createProductSchema;
  const { error, value } = schema.validate(data, { 
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    console.error('[productController] Product validation error details:', error.details);
    throw new ValidationError('Product validation failed', error.details);
  }
  
  return value as Prisma.ProductCreateInput | Prisma.ProductUpdateInput;
};

// Type for inventory update
interface InventoryUpdateInput {
  inventory?: number;
  variantInventory?: Record<string, number>;
  reason?: string | null;
}

// Main Product CRUD Operations
export const createProduct = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    
    const userId = req.user.id;
    const productData: ProductInput = req.body;
    
    // Get vendor ID for the current user
    const vendor = await prisma.vendor.findUnique({
      where: { userId }
    });
    
    if (!vendor) {
      throw new UnauthorizedError('Only vendors can create products');
    }
    
    // Validate product data
    const validatedData = validateProductData(productData) as Prisma.ProductCreateInput;
    const hasVariants = productData.variants ? productData.variants.length > 0 : false;

    // --- IMAGE HANDLING FIX ---
    // Separate images that need uploading (base64 or file) from those that are already URLs
    const imagesToUpload = (productData.images || []).filter(img => {
      if (typeof img === 'string') {
        // Base64 string or URL
        return img.startsWith('data:image');
      } else if (img && typeof img === 'object') {
        if (img.data && typeof img.data === 'string' && img.data.startsWith('data:image')) {
          return true;
        }
        if (img.path) {
          return true;
        }
        // If it has a url property, it's already uploaded
        if (img.url) {
          return false;
        }
      }
      return false;
    });
    const alreadyUploadedImages = (productData.images || []).filter(img => {
      if (typeof img === 'string') {
        return !img.startsWith('data:image');
      } else if (img && typeof img === 'object' && img.url) {
        return true;
      }
      return false;
    });

    // --- VARIANT/SPECIFICATION SANITIZATION ---
    // Only keep fields Prisma expects
    const sanitizeVariants = (variants: any[] = []) => variants.map(v => ({
      name: v.name,
      options: v.options,
      price: v.price,
      comparePrice: v.comparePrice,
      inventory: v.inventory,
      sku: v.sku,
      barcode: v.barcode,
      weight: v.weight,
      dimensions: v.dimensions,
      imageUrls: v.imageUrls,
      isDefault: v.isDefault
    }));
    const sanitizeSpecifications = (specs: any[] = []) => specs.map(s => ({
      name: s.name,
      value: s.value,
      unit: s.unit,
      group: s.group,
      position: s.position,
      isTechnical: s.isTechnical,
      isFilterable: s.isFilterable
    }));

    let variantsCreate = undefined;
    if (productData.variants && productData.variants.length > 0) {
      variantsCreate = { create: sanitizeVariants(productData.variants) };
    }
    let specificationsCreate = undefined;
    if (productData.specifications && productData.specifications.length > 0) {
      specificationsCreate = { create: sanitizeSpecifications(productData.specifications) };
    }

    // Remove variants and specifications from validatedData to avoid conflict with nested create
    const { variants, specifications, images, ...restValidatedData } = validatedData as any;

    // Debug log to confirm data shape before Prisma call
    console.log('Data passed to prisma.product.create:', JSON.stringify({
      ...restValidatedData,
      vendor: { connect: { id: vendor.id } },
      hasVariants,
      ...(variantsCreate ? { variants: variantsCreate } : {}),
      ...(specificationsCreate ? { specifications: specificationsCreate } : {})
    }, null, 2));

    // Create product with vendor ID using Prisma's relation syntax
    const product = await prisma.product.create({
      data: {
        ...restValidatedData,
        vendor: {
          connect: { id: vendor.id }
        },
        hasVariants,
        ...(variantsCreate ? { variants: variantsCreate } : {}),
        ...(specificationsCreate ? { specifications: specificationsCreate } : {})
      }
    });

    // --- IMAGE UPLOAD & DB CREATION ---
    let allImageUrls: { url: string, isMain: boolean, position: number }[] = [];
    // Upload new images if any
    if (imagesToUpload.length > 0) {
      const uploadedUrls = await uploadService.uploadProductImages(imagesToUpload, product.id);
      allImageUrls = uploadedUrls.map((url, index) => {
        // Try to preserve isMain/isDefault from original image data
        let isMain = false;
        const originalImage = imagesToUpload[index];
        if (originalImage) {
          isMain = originalImage.isMain || originalImage.isDefault || index === 0;
        } else {
          isMain = index === 0;
        }
        return { url, isMain, position: index };
      });
    }
    // Add already uploaded images (from URLs)
    if (alreadyUploadedImages.length > 0) {
      alreadyUploadedImages.forEach((img, idx) => {
        let url = typeof img === 'string' ? img : img.url;
        let isMain = (typeof img === 'object' && (img.isMain || img.isDefault)) || false;
        allImageUrls.push({ url, isMain, position: allImageUrls.length });
      });
    }
    // Save all images to DB
    if (allImageUrls.length > 0) {
      await Promise.all(allImageUrls.map((img, index) =>
        prisma.productImage.create({
          data: {
            url: img.url,
            productId: product.id,
            isMain: img.isMain || index === 0, // First image is main if none specified
            position: img.position
          }
        })
      ));
    }

    // Index in search service
    await searchService.indexProduct(product.id);

    // Publish event for other services
    publishEvent('product.created', { productId: product.id });

    return res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Product creation error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to create product';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export const getProduct = async (req: Request, res: Response) => {
  try {
    const { id, slug } = req.params;
    const isVendor = !!req.user && req.user.role === 'VENDOR';
    const isAdmin = !!req.user && req.user.role === 'ADMIN';

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { id: id || undefined },
          { slug: slug || undefined }
        ],
        deletedAt: null,
        ...(isVendor || isAdmin
          ? {} // No isPublished filter for vendor/admin
          : { isPublished: true }
        )
      },
      include: {
        images: true,
        variants: true,
        specifications: true,
        categories: {
          include: {
            category: true
          }
        },
        vendor: {
          select: {
            id: true,
            storeName: true,
            slug: true,
            logo: true,
            avgRating: true,
            totalRatings: true
          }
        },
        reviews: {
          where: {
            status: 'APPROVED'
          },
          take: 5,
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    // Restrict vendor to their own products
    if (isVendor && product) {
      // Find the vendor for the current user
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user!.id }
      });
      if (!vendor || product.vendorId !== vendor.id) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
    }

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    // Record product view
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'] as string;
    const userId = req.user?.id;

    analyticsService.recordProductView({
      productId: product.id,
      userId,
      sessionId,
      source: req.headers.referer as string,
      device: req.headers['user-agent'] as string
    });

    // Update view count
    await prisma.product.update({
      where: { id: product.id },
      data: { viewCount: { increment: 1 } }
    });

    // Get related products
    const relatedProducts = await prisma.relatedProduct.findMany({
      where: { productId: product.id },
      include: {
        relatedProduct: {
          include: {
            images: {
              where: { isMain: true },
              take: 1
            }
          }
        }
      },
      take: 8
    });

    return res.status(200).json({
      success: true,
      data: {
        ...product,
        relatedProducts: relatedProducts.map(rp => rp.relatedProduct)
      }
    });
  } catch (error) {
    logger.error('Get product error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to get product';

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    
    const userId = req.user.id;
    const updateData: ProductInput = req.body;
    
    // Get the product and check ownership
    const product = await prisma.product.findUnique({
      where: { id },
      include: { vendor: true }
    });
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the vendor who owns this product
    const vendor = await prisma.vendor.findUnique({
      where: { userId }
    });
    
    if (!vendor || vendor.id !== product.vendorId) {
      throw new UnauthorizedError('You do not have permission to update this product');
    }
    
    // Validate update data
    const validatedData = validateProductData(updateData, true) as Prisma.ProductUpdateInput;
    
    // Remove images from validatedData since we handle them separately
    const { images, ...productUpdateData } = validatedData;
    
    // Update the product
    const updatedProduct = await prisma.product.update({
      where: { id },
      data: productUpdateData
    });
    
    // Handle variant updates if provided
    if (updateData.variants) {
      // First delete existing variants
      await prisma.productVariant.deleteMany({
        where: { productId: id }
      });
      
      // Then create new ones
      if (updateData.variants.length > 0) {
        await Promise.all(updateData.variants.map((variant) => 
          prisma.productVariant.create({
            data: {
              ...variant,
              productId: id
            }
          })
        ));
      }
      
      // Update hasVariants flag
      await prisma.product.update({
        where: { id },
        data: { hasVariants: updateData.variants.length > 0 }
      });
    }
    
    // Handle specification updates if provided
    if (updateData.specifications) {
      // First delete existing specs
      await prisma.productSpecification.deleteMany({
        where: { productId: id }
      });
      
      // Then create new ones
      if (updateData.specifications.length > 0) {
        await Promise.all(updateData.specifications.map((spec) => 
          prisma.productSpecification.create({
            data: {
              ...spec,
              productId: id
            }
          })
        ));
      }
    }
    
    // Handle image updates if provided
    if (updateData.images) {
      // Get existing images
      const existingImages = await prisma.productImage.findMany({
        where: { productId: id }
      });
      
      // Delete all existing images from database (we'll recreate them)
      await prisma.productImage.deleteMany({
        where: { productId: id }
      });
      
      // Process each image
      if (updateData.images.length > 0) {
        console.log(`[productController] Processing ${updateData.images.length} images`);
        
        // Process all images and create them in the database
        await Promise.all(updateData.images.map(async (image: any, index: number) => {
          let url = '';
          let isMain = false;
          
          // If image already has a URL, use it directly (already uploaded)
          if (typeof image === 'object' && image.url) {
            url = image.url;
            isMain = image.isMain || image.isDefault || false;
            console.log(`[productController] Using existing image URL: ${url}`);
          } 
          // Otherwise try to upload it
          else if (image.data || image.file || typeof image === 'string') {
            try {
              // Upload to ImageKit
              const uploadedUrl = await uploadService.uploadSingleProductImage(
                image,
                id
              );
              url = uploadedUrl;
              isMain = image.isMain || image.isDefault || false;
              console.log(`[productController] Uploaded new image: ${url}`);
            } catch (error) {
              console.error(`[productController] Failed to upload image:`, error);
              return; // Skip this image
            }
          } else {
            console.warn(`[productController] Skipping invalid image format at index ${index}`);
            return; // Skip this image
          }
          
          // Create database record
          if (url) {
            await prisma.productImage.create({
              data: {
                url,
                productId: id,
                isMain: isMain || index === 0, // First image is main by default if none is marked
                position: index
              }
            });
          }
        }));
      }
    }
    
    // Update search index
    await searchService.indexProduct(id);
    
    // Publish event for other services
    publishEvent('product.updated', { productId: id });
    
    // Clear product cache
    cacheService.invalidate(`product:${id}`);
    
    return res.status(200).json({
      success: true,
      data: updatedProduct
    });
  } catch (error) {
    logger.error('Product update error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to update product';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    
    const userId = req.user.id;
    
    // Get the product and check ownership
    const product = await prisma.product.findUnique({
      where: { id },
      include: { vendor: true }
    });
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the vendor who owns this product
    const vendor = await prisma.vendor.findUnique({
      where: { userId }
    });
    
    if (!vendor || vendor.id !== product.vendorId) {
      throw new UnauthorizedError('You do not have permission to delete this product');
    }
    
    // Soft delete the product
    await prisma.product.update({
      where: { id },
      data: { 
        deletedAt: new Date(),
        isPublished: false
      }
    });
    
    // Publish event for other services
    publishEvent('product.deleted', { productId: id });
    
    // Remove from search index
    await searchService.removeProduct(id);
    
    // Clear product cache
    cacheService.invalidate(`product:${id}`);
    
    return res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    logger.error('Product deletion error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to delete product';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

// Advanced Product Operations
export const searchProducts = async (req: Request, res: Response) => {
  try {
    const {
      query,
      category,
      minPrice,
      maxPrice,
      vendorId,
      sort,
      page = '1',
      limit = '20'
    } = req.query as Record<string, string>;
    
    // Record search query for analytics
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'] as string;
    const userId = req.user?.id;
    
    analyticsService.recordSearchQuery({
      query: query || '',
      userId,
      sessionId,
      device: req.headers['user-agent'] as string
    });
    
    // Use search service for complex queries
    const searchResults = await searchService.searchProducts(
      query || '',
      {
        category,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        vendorId
      },
      {
        sort,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );
    
    return res.status(200).json({
      success: true,
      data: searchResults.items,
      pagination: {
        total: searchResults.total,
        page: searchResults.page,
        limit: searchResults.limit,
        pages: Math.ceil(searchResults.total / searchResults.limit)
      }
    });
  } catch (error) {
    logger.error('Product search error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to search products';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export const getVendorProducts = async (req: Request, res: Response) => {
  try {
    const { vendorId, slug } = req.params;
    const { 
      page = '1', 
      limit = '20', 
      sort = 'newest' 
    } = req.query as Record<string, string>;
    
    // Find vendor by ID or slug
    const vendor = await prisma.vendor.findFirst({
      where: {
        OR: [
          { id: vendorId || undefined },
          { slug: slug || undefined }
        ]
      },
      select: { id: true }
    });
    
    if (!vendor) {
      throw new NotFoundError('Vendor not found');
    }
    
    // Define sorting
    let orderBy: any = {};
    switch (sort) {
      case 'price_asc':
        orderBy = { price: 'asc' };
        break;
      case 'price_desc':
        orderBy = { price: 'desc' };
        break;
      case 'popular':
        orderBy = { viewCount: 'desc' };
        break;
      case 'rating':
        orderBy = { avgRating: 'desc' };
        break;
      case 'oldest':
        orderBy = { createdAt: 'asc' };
        break;
      case 'newest':
      default:
        orderBy = { createdAt: 'desc' };
    }
    
    // Get products with pagination
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);
    
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: {
          vendorId: vendor.id,
          isPublished: true,
          deletedAt: null
        },
        include: {
          images: {
            where: { isMain: true },
            take: 1
          }
        },
        orderBy,
        skip: (parsedPage - 1) * parsedLimit,
        take: parsedLimit
      }),
      prisma.product.count({
        where: {
          vendorId: vendor.id,
          isPublished: true,
          deletedAt: null
        }
      })
    ]);
    
    return res.status(200).json({
      success: true,
      data: products,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    logger.error('Get vendor products error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to get vendor products';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export const updateInventory = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    
    const userId = req.user.id;
    
    // Validate update data
    const { error, value } = updateInventorySchema.validate(req.body);
    if (error) {
      throw new ValidationError('Invalid inventory data', error.details);
    }
    
    const { inventory, variantInventory, reason } = value as InventoryUpdateInput;
    
    // Get the product and check ownership
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { vendor: true }
    });
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the vendor who owns this product
    const vendor = await prisma.vendor.findUnique({
      where: { userId }
    });
    
    if (!vendor || vendor.id !== product.vendorId) {
      throw new UnauthorizedError('You do not have permission to update this inventory');
    }
    
    // Use a transaction to update inventory and create history
    await prisma.$transaction(async (tx) => {
      // Update main product inventory if provided
      if (inventory !== undefined) {
        const previousInventory = product.inventory;
        const difference = inventory - previousInventory;
        
        await tx.product.update({
          where: { id: productId },
          data: { inventory }
        });
        
        // Create inventory history record
        await tx.inventoryHistory.create({
          data: {
            productId,
            quantity: difference,
            type: difference > 0 ? 'PURCHASE' : 'ADJUSTMENT',
            reason: reason || 'Manual inventory update',
            createdBy: userId
          }
        });
        
        // Publish inventory update event to Kafka
        try {
          await kafkaService.publishInventoryUpdate({
            productId,
            vendorId: vendor.id,
            quantity: inventory,
            previousQuantity: previousInventory,
            reason: reason || 'Manual inventory update',
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          logger.error('Failed to publish inventory update to Kafka:', error);
          // Continue even if Kafka publish fails - fallback to direct notification
          
          // Fallback: send real-time notification directly
          realtimeService.notifyInventoryUpdate(vendor.id, {
            id: productId,
            name: product.name,
            inventory,
            previousInventory,
            reason: reason || 'Manual inventory update',
            timestamp: new Date().toISOString()
          });
        }
      }
      
      // Update variant inventory if provided
      if (variantInventory && Object.keys(variantInventory).length > 0) {
        for (const [variantId, quantity] of Object.entries(variantInventory)) {
          const variant = await tx.productVariant.findUnique({
            where: { id: variantId }
          });
          
          if (!variant || variant.productId !== productId) {
            continue; // Skip if variant doesn't exist or doesn't belong to this product
          }
          
          const previousInventory = variant.inventory;
          const difference = quantity - previousInventory;
          
          await tx.productVariant.update({
            where: { id: variantId },
            data: { inventory: quantity }
          });
          
          // Create inventory history record for variant
          await tx.inventoryHistory.create({
            data: {
              productId,
              variantId,
              quantity: difference,
              type: difference > 0 ? 'PURCHASE' : 'ADJUSTMENT',
              reason: reason || 'Manual inventory update',
              createdBy: userId
            }
          });
          
          // Publish variant inventory update to Kafka
          try {
            await kafkaService.publishInventoryUpdate({
              productId,
              vendorId: vendor.id,
              quantity,
              previousQuantity: previousInventory,
              reason: reason || 'Manual variant inventory update',
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            logger.error('Failed to publish variant inventory update to Kafka:', error);
          }
        }
      }
    });
    
    // Publish event for other services
    publishEvent('product.inventory.updated', { productId });
    
    // Clear product cache
    cacheService.invalidate(`product:${productId}`);
    
    return res.status(200).json({
      success: true,
      message: 'Inventory updated successfully'
    });
  } catch (error) {
    logger.error('Inventory update error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to update inventory';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export const getFeaturedProducts = async (req: Request, res: Response) => {
  try {
    const { limit = '8' } = req.query as Record<string, string>;
    
    const featuredProducts = await prisma.product.findMany({
      where: {
        isFeatured: true,
        isPublished: true,
        deletedAt: null
      },
      include: {
        images: {
          where: { isMain: true },
          take: 1
        },
        vendor: {
          select: {
            storeName: true,
            slug: true
          }
        }
      },
      take: parseInt(limit)
    });
    
    return res.status(200).json({
      success: true,
      data: featuredProducts
    });
  } catch (error) {
    logger.error('Get featured products error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to get featured products';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export const getRelatedProducts = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { limit = '8' } = req.query as Record<string, string>;
    
    const relatedProducts = await prisma.relatedProduct.findMany({
      where: { productId },
      include: {
        relatedProduct: {
          include: {
            images: {
              where: { isMain: true },
              take: 1
            },
            vendor: {
              select: {
                storeName: true,
                slug: true
              }
            }
          }
        }
      },
      take: parseInt(limit)
    });
    
    return res.status(200).json({
      success: true,
      data: relatedProducts.map(rp => rp.relatedProduct)
    });
  } catch (error) {
    logger.error('Get related products error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to get related products';
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

// Microservice Exports - these functions would be used by other services via API calls

// For Review Service
export const getProductForReview = async (productId: string) => {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      vendorId: true,
      images: {
        where: { isMain: true },
        take: 1,
        select: { url: true }
      }
    }
  });
};

// For Order Service
export const validateProductsForOrder = async (items: Array<{productId: string, variantId?: string, quantity: number}>) => {
  const results = [];
  
  for (const item of items) {
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        name: true,
        price: true,
        inventory: true,
        vendorId: true,
        isPublished: true,
        deletedAt: true
      }
    });
    
    if (!product || !product.isPublished || product.deletedAt) {
      results.push({
        productId: item.productId,
        valid: false,
        message: 'Product not available'
      });
      continue;
    }
    
    // Check variant if specified
    if (item.variantId) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId },
        select: {
          id: true,
          inventory: true,
          price: true
        }
      });
      
      if (!variant || variant.inventory < item.quantity) {
        results.push({
          productId: item.productId,
          variantId: item.variantId,
          valid: false,
          message: variant ? 'Insufficient inventory' : 'Variant not found'
        });
        continue;
      }
      
      results.push({
        productId: item.productId,
        variantId: item.variantId,
        valid: true,
        price: variant.price || product.price,
        vendorId: product.vendorId,
        name: product.name
      });
    } else {
      // Check main product inventory
      if (product.inventory < item.quantity) {
        results.push({
          productId: item.productId,
          valid: false,
          message: 'Insufficient inventory'
        });
        continue;
      }
      
      results.push({
        productId: item.productId,
        valid: true,
        price: product.price,
        vendorId: product.vendorId,
        name: product.name
      });
    }
  }
  
  return results;
};

// For Inventory Service
export const decreaseInventory = async (items: Array<{productId: string, variantId?: string, quantity: number, orderId: string}>) => {
  const updates = [];
  
  for (const item of items) {
    if (item.variantId) {
      // Update variant inventory
      const variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId },
        include: {
          product: {
            include: {
              vendor: true
            }
          }
        }
      });
      
      if (!variant || variant.inventory < item.quantity) {
        updates.push({
          productId: item.productId,
          variantId: item.variantId,
          success: false,
          message: variant ? 'Insufficient inventory' : 'Variant not found'
        });
        continue;
      }
      
      const previousInventory = variant.inventory;
      const newInventory = previousInventory - item.quantity;
      
      await prisma.productVariant.update({
        where: { id: item.variantId },
        data: { inventory: { decrement: item.quantity } }
      });
      
      // Create inventory history
      await prisma.inventoryHistory.create({
        data: {
          productId: item.productId,
          variantId: item.variantId,
          quantity: -item.quantity,
          type: 'SALE',
          orderId: item.orderId
        }
      });
      
      updates.push({
        productId: item.productId,
        variantId: item.variantId,
        success: true
      });
      
      // Publish inventory update to Kafka
      try {
        if (variant.product?.vendor) {
          await kafkaService.publishInventoryUpdate({
            productId: item.productId,
            vendorId: variant.product.vendor.id,
            quantity: newInventory,
            previousQuantity: previousInventory,
            orderId: item.orderId,
            reason: 'Order purchase',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('Failed to publish variant inventory update to Kafka:', error);
      }
    } else {
      // Update main product inventory
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        include: { vendor: true }
      });
      
      if (!product || product.inventory < item.quantity) {
        updates.push({
          productId: item.productId,
          success: false,
          message: product ? 'Insufficient inventory' : 'Product not found'
        });
        continue;
      }
      
      const previousInventory = product.inventory;
      const newInventory = previousInventory - item.quantity;
      
      await prisma.product.update({
        where: { id: item.productId },
        data: { inventory: { decrement: item.quantity } }
      });
      
      // Create inventory history
      await prisma.inventoryHistory.create({
        data: {
          productId: item.productId,
          quantity: -item.quantity,
          type: 'SALE',
          orderId: item.orderId
        }
      });
      
      updates.push({
        productId: item.productId,
        success: true
      });
      
      // Publish inventory update to Kafka
      try {
        if (product.vendor) {
          await kafkaService.publishInventoryUpdate({
            productId: item.productId,
            vendorId: product.vendor.id,
            quantity: newInventory,
            previousQuantity: previousInventory,
            orderId: item.orderId,
            reason: 'Order purchase',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('Failed to publish inventory update to Kafka:', error);
        
        // Fallback: send real-time notification directly if Kafka fails
        if (product.vendor) {
          realtimeService.notifyInventoryUpdate(product.vendor.id, {
            id: item.productId,
            name: product.name,
            inventory: newInventory,
            previousInventory,
            reason: 'Order purchase',
            timestamp: new Date().toISOString()
          });
          
          // Check if inventory is low and send notification
          const threshold = product.lowStockThreshold || 5;
          if (newInventory <= threshold) {
            realtimeService.notifyLowInventory(product.vendor.id, {
              id: item.productId,
              name: product.name,
              inventory: newInventory,
              lowStockThreshold: threshold,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    }
  }
  
  return updates;
};

// For Search Service
export const getProductsForIndexing = async (batchSize = 100, lastId?: string) => {
  return prisma.product.findMany({
    where: {
      id: lastId ? { gt: lastId } : undefined,
      isPublished: true,
      deletedAt: null
    },
    include: {
      images: true,
      categories: {
        include: {
          category: true
        }
      },
      specifications: true,
      vendor: {
        select: {
          id: true,
          storeName: true,
          slug: true
        }
      }
    },
    orderBy: { id: 'asc' },
    take: batchSize
  });
};

// For the vendor dashboard - get product by ID with all details
export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log(`[getProductById] Request for product ID: ${id}`);
    
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    
    console.log(`[getProductById] User: ${req.user.id}, Role: ${req.user.role}`);
    
    // Get vendor ID for the current user
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user.id }
    });
    
    if (!vendor) {
      throw new UnauthorizedError('Only vendors can access this endpoint');
    }
    
    console.log(`[getProductById] Vendor: ${vendor.id}`);
    
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        images: true,
        variants: true,
        specifications: true,
        categories: {
          include: {
            category: true
          }
        },
        vendor: {
          select: {
            id: true,
            storeName: true,
            slug: true,
            logo: true
          }
        }
      }
    });
    
    console.log(`[getProductById] Product found: ${!!product}`);
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Verify ownership - vendor can only access their own products
    if (product.vendorId !== vendor.id && req.user.role !== 'ADMIN') {
      console.log(`[getProductById] Ownership check failed: Product vendor ${product.vendorId} vs. Request vendor ${vendor.id}`);
      throw new UnauthorizedError('You do not have permission to access this product');
    }
    
    console.log(`[getProductById] Returning product: ${product.id}, ${product.name}`);
    
    return res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Get product by ID error:', error);
    const statusCode = (error instanceof AppError) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to get product details';
    
    console.error(`[getProductById] Error: ${statusCode}, ${message}`);
    
    return res.status(statusCode).json({
      success: false,
      message
    });
  }
};

export default {
  createProduct,
  getProduct,
  getProductById,
  updateProduct,
  deleteProduct,
  searchProducts,
  getVendorProducts,
  updateInventory,
  getFeaturedProducts,
  getRelatedProducts,
  getProductForReview,
  validateProductsForOrder,
  decreaseInventory,
  getProductsForIndexing
};
