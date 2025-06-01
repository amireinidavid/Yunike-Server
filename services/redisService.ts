import { createClient, SetOptions } from 'redis';
import { ServiceUnavailableError } from '../utils/errors';

// Redis configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Redis client
const client = createClient({
  url: REDIS_URL
});

// Connect to Redis when the service starts
(async () => {
  client.on('error', (err: Error) => {
    console.error('Redis connection error:', err);
    // Don't crash the server if Redis is unavailable
    // Fallback to in-memory storage or database can be implemented
  });

  try {
    if (!client.isOpen) {
      await client.connect();
      console.log('✅ Connected to Redis');
    }
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
  }
})();

// If Node process ends, close the Redis connection
process.on('SIGINT', () => {
  client.quit();
});

/**
 * Redis client wrapper with fallback mechanisms
 */
export const redisClient = {
  /**
   * Set a key-value pair in Redis
   * @param key Redis key
   * @param value Value to store
   * @param expiryMode Optional expiry mode (EX, PX, etc.)
   * @param time Optional time value for expiry
   * @returns Promise that resolves to 'OK' if successful
   */
  set: async (key: string, value: string, expiryMode?: string, time?: number): Promise<string> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      
      if (expiryMode && time) {
        return await client.set(key, value, {
          [expiryMode]: time
        }) || 'OK'; // Handle potential null return with fallback to 'OK'
      }
      
      return await client.set(key, value) || 'OK';
    } catch (error) {
      console.error(`Redis set error for key ${key}:`, error);
      // Fallback to in-memory or database could be implemented here
      return 'OK';
    }
  },

  /**
   * Get a value from Redis by key
   * @param key Redis key
   * @returns Promise that resolves to the value or null
   */
  get: async (key: string): Promise<string | null> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.get(key);
    } catch (error) {
      console.error(`Redis get error for key ${key}:`, error);
      // Fallback to in-memory or database could be implemented here
      return null;
    }
  },

  /**
   * Delete a key from Redis
   * @param key Redis key
   * @returns Promise that resolves to number of keys deleted
   */
  del: async (key: string): Promise<number> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.del(key);
    } catch (error) {
      console.error(`Redis del error for key ${key}:`, error);
      // Fallback to in-memory or database could be implemented here
      return 0;
    }
  },

  /**
   * Check if a key exists in Redis
   * @param key Redis key
   * @returns Promise that resolves to 1 if exists, 0 if not
   */
  exists: async (key: string): Promise<number> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.exists(key);
    } catch (error) {
      console.error(`Redis exists error for key ${key}:`, error);
      // Fallback to in-memory or database could be implemented here
      return 0;
    }
  },

  /**
   * Get time-to-live for key in seconds
   * @param key Redis key
   * @returns Promise that resolves to TTL in seconds, -2 if key doesn't exist, -1 if no expiry
   */
  ttl: async (key: string): Promise<number> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.ttl(key);
    } catch (error) {
      console.error(`Redis TTL error for key ${key}:`, error);
      // If there's an error, assume the key doesn't exist
      return -2;
    }
  },

  /**
   * Set expiry time on a key
   * @param key Redis key
   * @param seconds Time in seconds until expiry
   * @returns Promise that resolves to 1 if successful, 0 if key doesn't exist
   */
  expire: async (key: string, seconds: number): Promise<number> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.expire(key, seconds);
    } catch (error) {
      console.error(`Redis expire error for key ${key}:`, error);
      // Fallback to in-memory or database could be implemented here
      return 0;
    }
  },

  /**
   * Increment a key's value
   * @param key Redis key
   * @returns Promise that resolves to the new value
   */
  incr: async (key: string): Promise<number> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.incr(key);
    } catch (error) {
      console.error(`Redis incr error for key ${key}:`, error);
      // Fallback to in-memory or database could be implemented here
      return 0;
    }
  },
  
  /**
   * Store a hash field
   * @param key Redis key
   * @param field Hash field
   * @param value Value to store
   * @returns Promise that resolves to 1 if new field created, 0 if field updated
   */
  hSet: async (key: string, field: string, value: string): Promise<number> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.hSet(key, field, value);
    } catch (error) {
      console.error(`Redis hSet error for key ${key}, field ${field}:`, error);
      // Fallback to in-memory or database could be implemented here
      return 0;
    }
  },

  /**
   * Get a hash field
   * @param key Redis key
   * @param field Hash field
   * @returns Promise that resolves to the field value or null
   */
  hGet: async (key: string, field: string): Promise<string | null> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      return await client.hGet(key, field);
    } catch (error) {
      console.error(`Redis hGet error for key ${key}, field ${field}:`, error);
      // Fallback to in-memory or database could be implemented here
      return null;
    }
  },

  /**
   * Check if Redis connection is healthy
   * @returns Promise that resolves to true if healthy, false otherwise
   */
  isHealthy: async (): Promise<boolean> => {
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      const response = await client.ping();
      return response === 'PONG';
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }
}; 