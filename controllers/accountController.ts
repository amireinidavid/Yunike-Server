import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import ImageKit from 'imagekit';
import { validateVendorUpdate } from '../utils/validators';
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
 * Get vendor profile for logged-in user
 */
export const getVendorProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;

    const vendor = await prisma.vendor.findUnique({
      where: {
        userId
      },
      include: {
        user: {
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
          }
        }
      }
    });

    if (!vendor) {
      return res.status(404).json({
        status: 'error',
        message: 'Vendor profile not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: vendor
    });
  } catch (error) {
    console.error('Error fetching vendor profile:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch vendor profile',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Update vendor profile
 */
export const updateVendorProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const updateData = req.body;
    
    // Validate incoming data
    const { error, validData } = validateVendorUpdate(updateData);
    if (error) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error',
        errors: error
      });
    }

    // Check if vendor exists for this user
    const existingVendor = await prisma.vendor.findUnique({
      where: { userId }
    });

    if (!existingVendor) {
      return res.status(404).json({
        status: 'error',
        message: 'Vendor profile not found'
      });
    }

    // Handle slug uniqueness if being updated
    if (validData && validData.slug && validData.slug !== existingVendor.slug) {
      const slugExists = await prisma.vendor.findUnique({
        where: { slug: validData.slug }
      });

      if (slugExists) {
        return res.status(400).json({
          status: 'error',
          message: 'Slug already in use'
        });
      }
    }

    // Update the vendor with validated data
    const dataToUpdate = validData || {};
    const updatedVendor = await prisma.vendor.update({
      where: { userId },
      data: dataToUpdate,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            phone: true,
            profileImageUrl: true,
            isVerified: true,
          }
        }
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Vendor profile updated successfully',
      data: updatedVendor
    });
  } catch (error) {
    console.error('Error updating vendor profile:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to update vendor profile',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Upload vendor logo
 */
export const uploadVendorLogo = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    console.log('Upload vendor logo request received');
    console.log('Files in request:', req.files);
    console.log('File in request:', req.file);
    console.log('Body:', req.body);
    
    // Check if multer properly processed the file
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
    const logoUrl = await uploadImageToImageKit(req.file, 'vendor/logos');

    // Generate thumbnail URL
    const thumbnailUrl = getTransformedImageUrl(logoUrl, {
      width: 300,
      height: 300,
      crop: 'maintain_ratio'
    });

    // Update vendor with logo URL
    const updatedVendor = await prisma.vendor.update({
      where: { userId },
      data: {
        logo: logoUrl
      }
    });

    console.log('Vendor logo updated successfully:', logoUrl);
    res.status(200).json({
      status: 'success',
      message: 'Logo uploaded successfully',
      data: {
        logoUrl: logoUrl,
        thumbnailUrl: thumbnailUrl
      }
    });
  } catch (error) {
    console.error('Error uploading vendor logo:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload vendor logo',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Upload vendor banner
 */
export const uploadVendorBanner = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file uploaded'
      });
    }

    // Upload to ImageKit
    const bannerUrl = await uploadImageToImageKit(file, 'vendor/banners');

    // Update vendor with banner URL
    const updatedVendor = await prisma.vendor.update({
      where: { userId },
      data: {
        banner: bannerUrl
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Banner uploaded successfully',
      data: {
        bannerUrl: bannerUrl
      }
    });
  } catch (error) {
    console.error('Error uploading vendor banner:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload vendor banner',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

/**
 * Upload vendor cover image
 */
export const uploadVendorCoverImage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    console.log('Upload vendor cover request received');
    console.log('Files in request:', req.files);
    console.log('File in request:', req.file);
    console.log('Body:', req.body);
    
    // Check if multer properly processed the file
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
    const coverUrl = await uploadImageToImageKit(req.file, 'vendor/covers');

    // Generate thumbnail and responsive sizes
    const thumbnailUrl = getTransformedImageUrl(coverUrl, {
      width: 300,
      height: 100,
      crop: 'maintain_ratio'
    });
    
    const mediumUrl = getTransformedImageUrl(coverUrl, {
      width: 768,
      height: 256,
      crop: 'maintain_ratio'
    });

    // Update vendor with cover image URL using the banner field instead
    const updatedVendor = await prisma.vendor.update({
      where: { userId },
      data: {
        banner: coverUrl // Use banner field instead of coverImage
      }
    });

    console.log('Vendor cover updated successfully:', coverUrl);
    res.status(200).json({
      status: 'success',
      message: 'Cover image uploaded successfully',
      data: {
        coverImageUrl: coverUrl,
        thumbnailUrl: thumbnailUrl,
        mediumUrl: mediumUrl
      }
    });
  } catch (error) {
    console.error('Error uploading vendor cover image:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload vendor cover image',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
}

/**
 * Update user profile information (for vendor)
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
    const { name, firstName, lastName, phone } = req.body;
    
    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        firstName,
        lastName,
        phone
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
 * Delete vendor account
 */
export const deleteVendorAccount = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized - User not found'
      });
    }

    const userId = req.user.id;
    
    // Start a transaction to ensure all related data is deleted
    await prisma.$transaction(async (tx) => {
      // First find the vendor to ensure it exists
      const vendor = await tx.vendor.findUnique({
        where: { userId },
        include: {
          products: true
        }
      });

      if (!vendor) {
        throw new ApiError(404, 'Vendor profile not found');
      }

      // Delete all products and their related data first (due to cascade constraints)
      if (vendor.products.length > 0) {
        await tx.product.deleteMany({
          where: { vendorId: vendor.id }
        });
      }

      // Delete the vendor record
      await tx.vendor.delete({
        where: { userId }
      });

      // Optionally, update the user role back to CUSTOMER
      await tx.user.update({
        where: { id: userId },
        data: {
          role: 'CUSTOMER'
        }
      });
    });

    res.status(200).json({
      status: 'success',
      message: 'Vendor account deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting vendor account:', error);
    
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete vendor account',
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