import { Request, Response, NextFunction } from 'express';
import { cacheService } from '../services/cacheService';
import { logger } from '../utils/logger';

/**
 * Middleware to cache API responses
 * @param prefix Cache key prefix
 * @param ttl Time to live in seconds
 */
export const cacheMiddleware = (prefix: string, ttl: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key based on the request URL and any query params
    const key = `${prefix}:${req.originalUrl}`;
    
    try {
      // Try to get from cache
      const cachedData = await cacheService.get(key);
      
      if (cachedData) {
        logger.debug(`Cache hit for ${key}`);
        return res.json(cachedData);
      }
      
      // Cache miss, replace res.json to intercept the response
      const originalJson = res.json;
      res.json = function (data) {
        // Restore original function
        res.json = originalJson;
        
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Store in cache
          cacheService.set(key, data, ttl)
            .catch(err => logger.error(`Error caching response for ${key}:`, err));
        }
        
        // Continue with the original response
        return originalJson.call(this, data);
      };
      
      next();
    } catch (error) {
      logger.error(`Cache middleware error for ${key}:`, error);
      next();
    }
  };
};

export default cacheMiddleware; 