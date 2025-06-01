import Redis from 'ioredis';
import { logger } from '../utils/logger';

class CacheService {
  private client: Redis;
  private isConnected: boolean = false;
  private defaultTTL: number = 3600; // 1 hour in seconds

  constructor() {
    this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Cache service connected to Redis');
    });
    
    this.client.on('error', (err) => {
      this.isConnected = false;
      logger.error('Cache service Redis error:', err);
    });
  }

  /**
   * Set a value in cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttl Time to live in seconds
   */
  async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    if (!this.isConnected) return;
    
    try {
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized, 'EX', ttl);
      logger.debug(`Cache set: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Get a value from cache
   * @param key Cache key
   * @returns Cached value or null if not found
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected) return null;
    
    try {
      const data = await this.client.get(key);
      
      if (!data) return null;
      
      logger.debug(`Cache hit: ${key}`);
      return JSON.parse(data) as T;
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Check if a key exists in cache
   * @param key Cache key
   * @returns True if the key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) return false;
    
    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete a value from cache
   * @param key Cache key
   */
  async invalidate(key: string): Promise<void> {
    if (!this.isConnected) return;
    
    try {
      await this.client.del(key);
      logger.debug(`Cache invalidated: ${key}`);
    } catch (error) {
      logger.error(`Cache invalidation error for key ${key}:`, error);
    }
  }

  /**
   * Delete multiple keys by pattern
   * @param pattern Key pattern to match (e.g. "user:*")
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.isConnected) return;
    
    try {
      const keys = await this.client.keys(pattern);
      
      if (keys.length > 0) {
        await this.client.del(...keys);
        logger.debug(`Cache invalidated ${keys.length} keys matching: ${pattern}`);
      }
    } catch (error) {
      logger.error(`Cache pattern invalidation error for pattern ${pattern}:`, error);
    }
  }

  /**
   * Check health of the cache service
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Close the Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
  }
}

// Create a singleton instance
export const cacheService = new CacheService();

export default cacheService; 