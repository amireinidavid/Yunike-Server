import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import multer from 'multer';
import ImageKit from 'imagekit';
import { ApiError } from '../utils/errors';

// Extend Express Request to include user and file properties
declare module 'express' {
  interface Request {
    user?: {
      id: string;
      email: string;
      role: string;
      permissions?: string[];
    };
    file?: Express.Multer.File;
  }
}

// Declare Express.Multer namespace
declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination?: string;
      filename?: string;
      path?: string;
      buffer: Buffer;
    }
  }
}

const prisma = new PrismaClient();

// Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'public_SbuIp9j0pNP2dV+SjlnkE2hzrxU=',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'private_5hfcc5WrNLJ+jysSR3RcH2w5g6o=',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/n5f98cn1o/yunike'});

// Configure multer for image uploads - using memory storage for ImageKit
const storage = multer.memoryStorage();

// Filter for images only
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  console.log('Multer processing file:', {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size || 'unknown'
  });
  
  // Accept images only
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
    console.error('File rejected - invalid extension:', file.originalname);
    return cb(new Error('Only image files are allowed!'));
  }
  
  // Additional mimetype check
  if (!file.mimetype.startsWith('image/')) {
    console.error('File rejected - invalid mimetype:', file.mimetype);
    return cb(new Error('File must be an image!'));
  }
  
  console.log('File accepted for upload:', file.originalname);
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max size
  },
});

/**
 * Upload image to ImageKit
 * @param file File buffer from multer
 * @param folder Target folder in ImageKit
 * @param transforms Optional transformations to apply via URL parameters
 * @returns URL of uploaded image with optional transformations
 */
async function uploadImageToImageKit(
  file: Express.Multer.File, 
  folder: string,
  transforms?: { height?: number; width?: number }
): Promise<string> {
  try {
    console.log('Uploading to ImageKit:', {
      fileSize: file.size,
      fileType: file.mimetype,
      fileName: file.originalname
    });
    
    // Create a unique filename
    const fileExtension = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExtension}`;
    
    // Upload to ImageKit
    const result = await imagekit.upload({
      file: file.buffer, // Buffer data
      fileName: fileName,
      folder: folder
    });
    
    // Add transformation parameters if specified
    let finalUrl = result.url;
    if (transforms) {
      const transformParams = [];
      
      if (transforms.height) {
        transformParams.push(`h-${transforms.height}`);
      }
      
      if (transforms.width) {
        transformParams.push(`w-${transforms.width}`);
      }
      
      if (transformParams.length > 0) {
        finalUrl = `${result.url}?tr=${transformParams.join(',')}`;
      }
    }
    
    console.log('ImageKit upload success:', finalUrl);
    return finalUrl;
  } catch (error) {
    console.error("ImageKit upload error:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
    }
    throw new Error("Failed to upload image to ImageKit");
  }
}

/**
 * Get customer profile for logged-in user
 */
export const getCustomerProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;

    const customer = await prisma.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        phone: true,
        profileImageUrl: true,
        isVerified: true,
        lastLoginAt: true,
        addresses: true,
        wishlists: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                images: {
                  where: {
                    isMain: true
                  },
                  select: {
                    url: true
                  },
                  take: 1
                }
              }
            }
          }
        },
        orders: {
          take: 5,
          orderBy: {
            createdAt: 'desc'
          },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        status: 'error',
        message: 'Customer profile not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: customer
    });
  } catch (error) {
    console.error('Error fetching customer profile:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch customer profile',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Update user profile information
 */
export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const { name, firstName, lastName, phone, gender, dateOfBirth, preferredLanguage, preferredCurrency } = req.body;
    
    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        firstName,
        lastName,
        phone,
        gender,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        preferredLanguage,
        preferredCurrency
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        preferredLanguage: true,
        preferredCurrency: true,
        profileImageUrl: true,
        isVerified: true
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'User profile updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to update user profile',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Upload user profile image
 */
export const uploadProfileImage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    console.log('Upload profile image request received');
    console.log('File in request:', req.file);
    
    if (!req.file) {
      console.error('No file found in the request');
      return res.status(400).json({
        status: 'error',
        message: 'No file uploaded'
      });
    }

    // Log file details
    console.log('Received file:', {
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Upload to ImageKit
    const profileUrl = await uploadImageToImageKit(req.file, 'users/profiles');
    
    // Generate thumbnail URLs in various sizes
    const thumbnailUrl = getTransformedImageUrl(profileUrl, {
      width: 150,
      height: 150,
      crop: 'maintain_ratio'
    });
    
    const smallUrl = getTransformedImageUrl(profileUrl, {
      width: 50,
      height: 50,
      crop: 'maintain_ratio'
    });

    // Update user with profile image URL
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        profileImageUrl: profileUrl
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        phone: true,
        profileImageUrl: true,
        isVerified: true
      }
    });

    console.log('User profile image updated successfully');
    res.status(200).json({
      status: 'success',
      message: 'Profile image uploaded successfully',
      data: {
        profileImageUrl: profileUrl,
        thumbnailUrl: thumbnailUrl,
        smallUrl: smallUrl,
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('Error uploading profile image:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload profile image',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Get customer orders with details
 */
export const getCustomerOrders = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalOrders = await prisma.order.count({
      where: {
        userId
      }
    });

    const orders = await prisma.order.findMany({
      where: {
        userId
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: limit,
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: {
                  where: {
                    isMain: true
                  },
                  take: 1
                }
              }
            }
          }
        },
        shippingAddress: true
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        orders,
        pagination: {
          total: totalOrders,
          page,
          pageSize: limit,
          pageCount: Math.ceil(totalOrders / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching customer orders:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch customer orders',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Get single order details
 */
export const getOrderDetails = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const orderId = req.params.id;

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: {
                  where: {
                    isMain: true
                  },
                  take: 1
                }
              }
            },
            variant: true
          }
        },
        shippingAddress: true,
        billingAddress: true,
        transactions: {
          select: {
            id: true,
            amount: true,
            status: true,
            type: true,
            provider: true,
            createdAt: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: order
    });
  } catch (error) {
    console.error('Error fetching order details:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch order details',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Get customer addresses
 */
export const getCustomerAddresses = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;

    const addresses = await prisma.address.findMany({
      where: {
        userId
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.status(200).json({
      status: 'success',
      data: addresses
    });
  } catch (error) {
    console.error('Error fetching customer addresses:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch customer addresses',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Add new address
 */
export const addAddress = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const {
      name,
      street,
      apartment,
      city,
      state,
      postalCode,
      country,
      phoneNumber,
      isDefault,
      isShippingDefault,
      isBillingDefault,
      label,
      notes
    } = req.body;

    // Check if this is the first address
    const addressCount = await prisma.address.count({
      where: { userId }
    });

    // If it's the first address, make it default
    const firstAddress = addressCount === 0;

    // Start a transaction to handle default addresses correctly
    const newAddress = await prisma.$transaction(async (tx) => {
      // If setting as default, update existing defaults
      if ((isDefault || firstAddress) && !isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false }
        });
      }

      if ((isShippingDefault || firstAddress) && !isShippingDefault) {
        await tx.address.updateMany({
          where: { userId, isShippingDefault: true },
          data: { isShippingDefault: false }
        });
      }

      if ((isBillingDefault || firstAddress) && !isBillingDefault) {
        await tx.address.updateMany({
          where: { userId, isBillingDefault: true },
          data: { isBillingDefault: false }
        });
      }

      // Create the new address
      return tx.address.create({
        data: {
          userId,
          name,
          street,
          apartment,
          city,
          state,
          postalCode,
          country,
          phoneNumber,
          isDefault: isDefault || firstAddress,
          isShippingDefault: isShippingDefault || firstAddress,
          isBillingDefault: isBillingDefault || firstAddress,
          label,
          notes
        }
      });
    });

    res.status(201).json({
      status: 'success',
      message: 'Address added successfully',
      data: newAddress
    });
  } catch (error) {
    console.error('Error adding address:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to add address',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Update address
 */
export const updateAddress = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const addressId = req.params.id;
    const {
      name,
      street,
      apartment,
      city,
      state,
      postalCode,
      country,
      phoneNumber,
      isDefault,
      isShippingDefault,
      isBillingDefault,
      label,
      notes
    } = req.body;

    // Verify address belongs to user
    const existingAddress = await prisma.address.findFirst({
      where: {
        id: addressId,
        userId
      }
    });

    if (!existingAddress) {
      return res.status(404).json({
        status: 'error',
        message: 'Address not found or not owned by user'
      });
    }

    // Start a transaction to handle default addresses correctly
    const updatedAddress = await prisma.$transaction(async (tx) => {
      // If setting as default, update existing defaults
      if (isDefault) {
        await tx.address.updateMany({
          where: { 
            userId, 
            isDefault: true,
            id: { not: addressId }
          },
          data: { isDefault: false }
        });
      }

      if (isShippingDefault) {
        await tx.address.updateMany({
          where: { 
            userId, 
            isShippingDefault: true,
            id: { not: addressId }
          },
          data: { isShippingDefault: false }
        });
      }

      if (isBillingDefault) {
        await tx.address.updateMany({
          where: { 
            userId, 
            isBillingDefault: true,
            id: { not: addressId }
          },
          data: { isBillingDefault: false }
        });
      }

      // Update the address
      return tx.address.update({
        where: { id: addressId },
        data: {
          name,
          street,
          apartment,
          city,
          state,
          postalCode,
          country,
          phoneNumber,
          isDefault,
          isShippingDefault,
          isBillingDefault,
          label,
          notes
        }
      });
    });

    res.status(200).json({
      status: 'success',
      message: 'Address updated successfully',
      data: updatedAddress
    });
  } catch (error) {
    console.error('Error updating address:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to update address',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Delete address
 */
export const deleteAddress = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const addressId = req.params.id;

    // Verify address belongs to user
    const existingAddress = await prisma.address.findFirst({
      where: {
        id: addressId,
        userId
      }
    });

    if (!existingAddress) {
      return res.status(404).json({
        status: 'error',
        message: 'Address not found or not owned by user'
      });
    }

    // Check if address is used in orders
    const orderWithAddress = await prisma.order.findFirst({
      where: {
        OR: [
          { shippingAddressId: addressId },
          { billingAddressId: addressId }
        ]
      }
    });

    if (orderWithAddress) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete address as it is associated with orders'
      });
    }

    // Delete the address
    await prisma.address.delete({
      where: { id: addressId }
    });

    // If the deleted address was default, set another address as default
    if (existingAddress.isDefault || existingAddress.isShippingDefault || existingAddress.isBillingDefault) {
      const anotherAddress = await prisma.address.findFirst({
        where: { userId }
      });

      if (anotherAddress) {
        await prisma.address.update({
          where: { id: anotherAddress.id },
          data: {
            isDefault: existingAddress.isDefault ? true : anotherAddress.isDefault,
            isShippingDefault: existingAddress.isShippingDefault ? true : anotherAddress.isShippingDefault,
            isBillingDefault: existingAddress.isBillingDefault ? true : anotherAddress.isBillingDefault
          }
        });
      }
    }

    res.status(200).json({
      status: 'success',
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting address:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete address',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Get customer wishlist
 */
export const getWishlist = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalItems = await prisma.wishlistItem.count({
      where: {
        userId
      }
    });

    const wishlist = await prisma.wishlistItem.findMany({
      where: {
        userId
      },
      orderBy: {
        addedAt: 'desc'
      },
      skip,
      take: limit,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            comparePrice: true,
            isOnSale: true,
            inventory: true,
            images: {
              where: {
                isMain: true
              },
              take: 1
            }
          }
        }
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        items: wishlist,
        pagination: {
          total: totalItems,
          page,
          pageSize: limit,
          pageCount: Math.ceil(totalItems / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch wishlist',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Add product to wishlist
 */
export const addToWishlist = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const { productId, notes } = req.body;

    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found'
      });
    }

    // Check if already in wishlist
    const existing = await prisma.wishlistItem.findFirst({
      where: {
        userId,
        productId
      }
    });

    if (existing) {
      return res.status(400).json({
        status: 'error',
        message: 'Product already in wishlist'
      });
    }

    // Add to wishlist
    const wishlistItem = await prisma.wishlistItem.create({
      data: {
        userId,
        productId,
        notes
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            images: {
              where: {
                isMain: true
              },
              take: 1
            }
          }
        }
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'Product added to wishlist',
      data: wishlistItem
    });
  } catch (error) {
    console.error('Error adding to wishlist:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to add to wishlist',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Remove product from wishlist
 */
export const removeFromWishlist = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const productId = req.params.productId;

    // Check if item exists in user's wishlist
    const wishlistItem = await prisma.wishlistItem.findFirst({
      where: {
        userId,
        productId
      }
    });

    if (!wishlistItem) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found in wishlist'
      });
    }

    // Remove from wishlist
    await prisma.wishlistItem.delete({
      where: {
        id: wishlistItem.id
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Product removed from wishlist'
    });
  } catch (error) {
    console.error('Error removing from wishlist:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to remove from wishlist',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Delete customer account
 */
export const deleteCustomerAccount = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    
    // Check if user has any active orders
    const activeOrders = await prisma.order.findMany({
      where: {
        userId,
        status: {
          in: ['PENDING', 'PROCESSING', 'PACKED', 'SHIPPED']
        }
      }
    });

    if (activeOrders.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete account with active orders. Please wait until all orders are completed.'
      });
    }

    // Start a transaction to soft delete the user account
    await prisma.$transaction(async (tx) => {
      // Soft delete the user (set deletedAt)
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          accountStatus: 'DEACTIVATED',
          email: `deleted_${userId}@deleted.com`, // Replace email to allow re-registration with same email
          password: 'DELETED_ACCOUNT'
        }
      });

      // Optionally anonymize certain data
      await tx.address.updateMany({
        where: { userId },
        data: {
          name: 'Deleted User',
          phoneNumber: null
        }
      });
    });

    res.status(200).json({
      status: 'success',
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting customer account:', error);
    
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete customer account',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Generate a transformed URL for an existing ImageKit image
 * @param imageUrl Original ImageKit URL
 * @param transforms Transformations to apply (height, width, etc.)
 * @returns Transformed image URL
 */
export function getTransformedImageUrl(
  imageUrl: string,
  transforms: { 
    height?: number;
    width?: number;
    quality?: number; 
    format?: 'auto' | 'webp' | 'jpg' | 'png';
    focus?: 'center' | 'top' | 'left' | 'bottom' | 'right';
    crop?: 'maintain_ratio' | 'force';
  }
): string {
  // Return original URL if no transforms or not an ImageKit URL
  if (!transforms || !imageUrl.includes('ik.imagekit.io')) {
    return imageUrl;
  }

  // Parse existing URL parameters
  const [baseUrl, existingParams] = imageUrl.split('?');
  const params = new URLSearchParams(existingParams || '');
  
  // Build transformation parameter string
  const transformParams = [];
  
  if (transforms.height) {
    transformParams.push(`h-${transforms.height}`);
  }
  
  if (transforms.width) {
    transformParams.push(`w-${transforms.width}`);
  }
  
  if (transforms.quality) {
    transformParams.push(`q-${transforms.quality}`);
  }
  
  if (transforms.format) {
    transformParams.push(`f-${transforms.format}`);
  }
  
  if (transforms.focus) {
    transformParams.push(`fo-${transforms.focus}`);
  }
  
  if (transforms.crop) {
    transformParams.push(`c-${transforms.crop}`);
  }
  
  // If we already have tr parameter, update it, otherwise add it
  if (transformParams.length > 0) {
    params.set('tr', transformParams.join(','));
  }
  
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}
