import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import ImageKit from 'imagekit';
import { logger } from '../utils/logger';
import { microservices } from './microservices';

// Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'public_SbuIp9j0pNP2dV+SjlnkE2hzrxU=',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'private_5hfcc5WrNLJ+jysSR3RcH2w5g6o=',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/n5f98cn1o/yunike'
});

// Default storage settings
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '5242880', 10); // 5MB
const ALLOWED_FILE_TYPES = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/webp,image/gif').split(',');

// Ensure upload directory exists for temporary files
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(path.join(UPLOAD_DIR, 'temp'), { recursive: true });
}

// Configure multer storage for temporary files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(UPLOAD_DIR, 'temp'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter function
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`));
  }
};

// Create multer upload instance
export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
});

/**
 * Upload image to ImageKit
 * @param file File buffer or path
 * @param folder Target folder in ImageKit
 * @param transforms Optional transformations to apply
 * @returns URL of uploaded image
 */
async function uploadToImageKit(
  file: Buffer | string,
  fileName: string,
  folder: string,
  transforms?: { height?: number; width?: number }
): Promise<string> {
  try {
    logger.debug(`Uploading to ImageKit: ${fileName} to folder: ${folder}`);
    
    // Upload to ImageKit
    const result = await imagekit.upload({
      file: file, // Buffer or file path
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
    
    logger.debug(`ImageKit upload success: ${finalUrl}`);
    return finalUrl;
  } catch (error) {
    logger.error("ImageKit upload error:", error);
    throw new Error("Failed to upload image to ImageKit");
  }
}

/**
 * Generate a transformed URL for an ImageKit image
 */
function getTransformedImageUrl(
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

class UploadService {
  /**
   * Upload product images
   * @param files Array of file objects or base64 strings
   * @param productId Product ID
   * @returns Array of uploaded file URLs
   */
  async uploadProductImages(files: any[], productId: string): Promise<string[]> {
    try {
      // Debug logging
      logger.debug(`Starting upload for ${files.length} product images for product: ${productId}`);
      logger.debug(`File types received: ${files.map(file => typeof file === 'string' ? 'base64 string' : (file.path ? 'file object' : 'other object type')).join(', ')}`);
      
      // Check if we should use media microservice
      if (process.env.USE_MEDIA_SERVICE === 'true') {
        try {
          // Prepare file data for API
          const fileData = await Promise.all(files.map(async (file, index) => {
            // Check for isMain/isDefault flag
            const isMainImage = file.isMain || file.isDefault || false;
            
            if (typeof file === 'string' && file.startsWith('data:image')) {
              // Return base64 string directly
              logger.debug(`Processing base64 string (type 1) for image ${index}`);
              return { data: file, name: `image_${index}.jpg`, type: 'base64', isMain: isMainImage };
            } else if (file.data && file.data.startsWith && file.data.startsWith('data:image')) {
              // Handle {data: "data:image..."} format
              logger.debug(`Processing base64 string (type 2) for image ${index}`);
              return { data: file.data, name: `image_${index}.jpg`, type: 'base64', isMain: isMainImage };
            } else if (file.path) {
              // Read file and convert to base64
              logger.debug(`Processing file path object for image ${index}: ${file.path}`);
              const buffer = fs.readFileSync(file.path);
              const base64 = buffer.toString('base64');
              const mimeType = file.mimetype || 'image/jpeg';
              return { 
                data: `data:${mimeType};base64,${base64}`, 
                name: file.originalname,
                type: 'base64',
                isMain: isMainImage
              };
            }
            logger.warn(`Unknown file format for image ${index}, skipping:`, file);
            return null;
          }));
          
          // Filter out null values
          const validFiles = fileData.filter(f => f !== null);
          logger.debug(`${validFiles.length} valid files prepared for media service upload`);
          
          // Call microservice with file data
          const result = await microservices.media.uploadImages({
            files: validFiles,
            entityType: 'product',
            entityId: productId
          });
          
          logger.debug(`Media service upload complete, received ${result.urls.length} URLs`);
          return result.urls;
        } catch (error) {
          logger.warn('Media service unavailable, falling back to ImageKit storage:', error);
          // Fall back to ImageKit storage
        }
      }
      
      const uploadedUrls: string[] = [];
      
      // Process each file
      for (const [index, file] of files.entries()) {
        let fileBuffer: Buffer;
        let fileName: string;
        // Check for isMain/isDefault flag
        const isMainImage = file.isMain || file.isDefault || index === 0;
        
        // Handle different file input types
        if (typeof file === 'string' && file.startsWith('data:image')) {
          // Handle base64 image
          logger.debug(`Processing direct base64 string for image ${index}`);
          const matches = file.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          
          if (!matches || matches.length !== 3) {
            logger.error(`Invalid base64 image format for image ${index}`);
            throw new Error('Invalid base64 image format');
          }
          
          fileBuffer = Buffer.from(matches[2], 'base64');
          fileName = `${uuidv4()}.jpg`;
        } else if (file.data && typeof file.data === 'string' && file.data.startsWith('data:image')) {
          // Handle {data: "data:image..."} format from frontend
          logger.debug(`Processing base64 in data property for image ${index}`);
          const matches = file.data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          
          if (!matches || matches.length !== 3) {
            logger.error(`Invalid base64 image format in data property for image ${index}`);
            throw new Error('Invalid base64 image format');
          }
          
          fileBuffer = Buffer.from(matches[2], 'base64');
          fileName = `${uuidv4()}.jpg`;
        } else if (file.path) {
          // Handle multer uploaded file
          logger.debug(`Processing file path: ${file.path} for image ${index}`);
          fileBuffer = fs.readFileSync(file.path);
          fileName = `${uuidv4()}${path.extname(file.originalname)}`;
          
          // Remove temp file
          fs.unlinkSync(file.path);
        } else {
          logger.error(`Unsupported file format for image ${index}:`, file);
          throw new Error('Unsupported file format');
        }
        
        // Upload to ImageKit
        logger.debug(`Uploading image ${index} to ImageKit...`);
        const imageUrl = await uploadToImageKit(
          fileBuffer,
          fileName,
          `products/${productId}`,
          { width: 1200 }
        );
        
        // Generate thumbnail
        const thumbnailUrl = getTransformedImageUrl(imageUrl, {
          width: 300,
          height: 300,
          crop: 'maintain_ratio'
        });
        
        logger.debug(`Image ${index} uploaded successfully: ${imageUrl}`);
        uploadedUrls.push(imageUrl);
      }
      
      logger.debug(`All ${uploadedUrls.length} images uploaded successfully for product ${productId}`);
      return uploadedUrls;
    } catch (error) {
      logger.error('Error uploading product images:', error);
      throw error;
    }
  }

  /**
   * Upload vendor profile images
   * @param file File object or base64 string
   * @param vendorId Vendor ID
   * @param type Image type (logo, banner, etc)
   * @returns Uploaded file URL
   */
  async uploadVendorImage(file: any, vendorId: string, type: 'logo' | 'banner' | 'cover'): Promise<string> {
    try {
      // Use media service if available
      if (process.env.USE_MEDIA_SERVICE === 'true') {
        try {
          let fileData: any = null;
          
          // Prepare file data
          if (typeof file === 'string' && file.startsWith('data:image')) {
            // For base64 strings
            fileData = { 
              data: file, 
              name: `${type}.jpg`, 
              type: 'base64' 
            };
          } else if (file.path) {
            // For file objects
            const buffer = fs.readFileSync(file.path);
            const base64 = buffer.toString('base64');
            const mimeType = file.mimetype || 'image/jpeg';
            fileData = { 
              data: `data:${mimeType};base64,${base64}`, 
              name: file.originalname, 
              type: 'base64' 
            };
          }
          
          if (!fileData) {
            throw new Error('Invalid file format');
          }
          
          // Call microservice
          const result = await microservices.media.uploadImage({
            file: fileData,
            entityType: 'vendor',
            entityId: vendorId,
            imageType: type
          });
          
          return result.url;
        } catch (error) {
          logger.warn('Media service unavailable, falling back to ImageKit storage');
          // Fall back to ImageKit storage
        }
      }
      
      let fileBuffer: Buffer;
      let fileName: string;
      
      // Handle different file input types
      if (typeof file === 'string' && file.startsWith('data:image')) {
        // Handle base64 image
        const matches = file.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
          throw new Error('Invalid base64 image format');
        }
        
        fileBuffer = Buffer.from(matches[2], 'base64');
        fileName = `${type}_${uuidv4()}.jpg`;
      } else if (file.path) {
        // Handle multer uploaded file
        fileBuffer = fs.readFileSync(file.path);
        fileName = `${type}_${uuidv4()}${path.extname(file.originalname)}`;
        
        // Remove temp file
        fs.unlinkSync(file.path);
      } else {
        throw new Error('Unsupported file format');
      }
      
      // Get dimensions based on type
      let width: number | undefined;
      let height: number | undefined;
      
      if (type === 'logo') {
        width = 400;
        height = 400;
      } else if (type === 'banner') {
        width = 1920;
        height = 500;
      } else if (type === 'cover') {
        width = 1200;
        height = 900;
      }
      
      // Upload to ImageKit
      const imageUrl = await uploadToImageKit(
        fileBuffer,
        fileName,
        `vendors/${vendorId}`,
        { width, height }
      );
      
      return imageUrl;
    } catch (error) {
      logger.error('Error uploading vendor image:', error);
      throw error;
    }
  }

  /**
   * Delete a file from storage
   * @param url File URL to delete
   */
  async deleteFile(url: string): Promise<void> {
    try {
      // Check if we should use media microservice
      if (process.env.USE_MEDIA_SERVICE === 'true') {
        try {
          // Call microservice with URL to delete
          await microservices.media.deleteMedia({ url });
          return;
        } catch (error) {
          logger.warn('Media service unavailable, falling back to ImageKit deletion');
          // Fall back to ImageKit deletion
        }
      }
      
      // For ImageKit files, extract the file ID from URL
      if (url.includes('ik.imagekit.io')) {
        try {
          // Extract file ID from URL path
          const urlPath = new URL(url).pathname;
          const fileId = path.basename(urlPath);
          
          // Delete from ImageKit
          await imagekit.deleteFile(fileId);
          logger.debug(`Deleted ImageKit file: ${fileId}`);
        } catch (error) {
          logger.warn(`Failed to delete ImageKit file: ${url}`, error);
        }
      } else if (url.startsWith('/uploads/')) {
        // Handle local files as fallback
        const filePath = path.join(UPLOAD_DIR, url.replace('/uploads/', ''));
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.debug(`Deleted local file: ${filePath}`);
        } else {
          logger.warn(`File not found for deletion: ${filePath}`);
        }
      }
    } catch (error) {
      logger.error('Error deleting file:', error);
      throw error;
    }
  }

  async uploadSingleProductImage(image: any, productId: string): Promise<string> {
    try {
      let buffer: Buffer;
      let fileName: string;
      
      // Handle different image input formats
      if (typeof image === 'string') {
        // Base64 string
        if (image.startsWith('data:image')) {
          // Extract the base64 data part
          const base64Data = image.split(';base64,').pop() || '';
          buffer = Buffer.from(base64Data, 'base64');
          fileName = `${uuidv4()}.${image.substring(11, image.indexOf(';'))}`;
        } else {
          throw new Error('Invalid image string format');
        }
      } else if (image.data && typeof image.data === 'string' && image.data.startsWith('data:image')) {
        // Object with base64 data
        const base64Data = image.data.split(';base64,').pop() || '';
        buffer = Buffer.from(base64Data, 'base64');
        fileName = image.name || `${uuidv4()}.${image.data.substring(11, image.data.indexOf(';'))}`;
      } else if (image.buffer) {
        // Multer file or similar
        buffer = image.buffer;
        fileName = image.originalname || `${uuidv4()}.jpg`;
      } else if (image.file && image.file.buffer) {
        // Object containing a file
        buffer = image.file.buffer;
        fileName = image.file.originalname || `${uuidv4()}.jpg`;
      } else {
        throw new Error('Unsupported image format');
      }
      
      // Upload to ImageKit
      const folder = `products/${productId}`;
      const result = await imagekit.upload({
        file: buffer,
        fileName,
        folder
      });
      
      // Add width parameter for responsive images
      return `${result.url}?tr=w-1200`;
    } catch (error) {
      console.error('Error uploading single product image:', error);
      throw error;
    }
  }
}

// Export a singleton instance
export const uploadService = new UploadService(); 