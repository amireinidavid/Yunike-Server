import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { PrismaClient, ServiceRegistry } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Base microservice client
 */
class MicroserviceClient {
  protected baseUrl: string;
  protected apiKey: string | null;
  protected client: AxiosInstance;
  protected serviceName: string;
  protected isAvailable: boolean = false;
  
  constructor(serviceName: string, baseUrl?: string, apiKey?: string) {
    this.serviceName = serviceName;
    this.baseUrl = baseUrl || process.env[`${serviceName.toUpperCase()}_SERVICE_URL`] || '';
    this.apiKey = apiKey || process.env[`${serviceName.toUpperCase()}_API_KEY`] || null;
    
    // Create axios instance
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'X-API-Key': this.apiKey })
      }
    });
    
    // Check if service is available
    this.checkAvailability();
  }
  
  /**
   * Check if the service is available
   */
  public async checkAvailability(): Promise<boolean> {
    if (!this.baseUrl) {
      this.isAvailable = false;
      return false;
    }
    
    try {
      const response = await this.client.get('/health');
      this.isAvailable = response.status === 200;
      
      if (this.isAvailable) {
        logger.debug(`${this.serviceName} service is available`);
      } else {
        logger.warn(`${this.serviceName} service health check failed: ${response.status}`);
      }
      
      return this.isAvailable;
    } catch (error) {
      this.isAvailable = false;
      logger.warn(`${this.serviceName} service is not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }
  
  /**
   * Register the service in the registry
   */
  public async register(): Promise<void> {
    if (!this.isAvailable) return;
    
    try {
      const info = await this.client.get('/info');
      
      await prisma.serviceRegistry.upsert({
        where: { name: this.serviceName },
        update: {
          version: info.data.version || '1.0.0',
          url: this.baseUrl,
          healthEndpoint: `${this.baseUrl}/health`,
          lastHeartbeat: new Date(),
          isActive: true
        },
        create: {
          name: this.serviceName,
          version: info.data.version || '1.0.0',
          url: this.baseUrl,
          healthEndpoint: `${this.baseUrl}/health`,
          description: info.data.description || '',
          isActive: true,
          lastHeartbeat: new Date()
        }
      });
      
      logger.info(`Registered ${this.serviceName} service in registry`);
    } catch (error) {
      logger.error(`Failed to register ${this.serviceName} service: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Call a service endpoint
   */
  protected async callService(endpoint: string, method: string = 'GET', data?: any, options?: AxiosRequestConfig): Promise<any> {
    if (!this.isAvailable) {
      await this.checkAvailability();
      
      if (!this.isAvailable) {
        throw new Error(`${this.serviceName} service is not available`);
      }
    }
    
    try {
      let response;
      
      switch (method.toUpperCase()) {
        case 'GET':
          response = await this.client.get(endpoint, { ...options, params: data });
          break;
        case 'POST':
          response = await this.client.post(endpoint, data, options);
          break;
        case 'PUT':
          response = await this.client.put(endpoint, data, options);
          break;
        case 'DELETE':
          response = await this.client.delete(endpoint, { ...options, data });
          break;
        default:
          throw new Error(`Unsupported HTTP method: ${method}`);
      }
      
      return response.data;
    } catch (error) {
      logger.error(`Error calling ${this.serviceName} service at ${endpoint}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
}

/**
 * Search service client
 */
class SearchService extends MicroserviceClient {
  constructor() {
    super('search');
  }
  
  /**
   * Search for products
   */
  async search(query: string, options: any = {}): Promise<any> {
    return this.callService('/search', 'POST', {
      query,
      ...options
    });
  }
  
  /**
   * Index a product in the search engine
   */
  async indexProduct(product: any): Promise<any> {
    return this.callService('/index/product', 'POST', product);
  }
  
  /**
   * Remove a product from the search engine
   */
  async removeProduct(productId: string): Promise<any> {
    return this.callService('/search/index/product', 'DELETE', { productId });
  }
  
  /**
   * Get search autocomplete suggestions
   */
  async autoComplete(query: string, limit: number = 5): Promise<string[]> {
    return this.callService('/autocomplete', 'GET', {
      query,
      limit
    });
  }
}

/**
 * Analytics service client
 */
class AnalyticsService extends MicroserviceClient {
  constructor() {
    super('analytics');
  }
  
  /**
   * Track an event
   */
  async trackEvent(data: any): Promise<any> {
    return this.callService('/track', 'POST', data);
  }
  
  /**
   * Get dashboard metrics
   */
  async getDashboardMetrics(options: any = {}): Promise<any> {
    return this.callService('/metrics/dashboard', 'GET', options);
  }
}

/**
 * Media service client
 */
class MediaService extends MicroserviceClient {
  constructor() {
    super('media');
  }
  
  /**
   * Upload a single image
   */
  async uploadImage(data: any): Promise<any> {
    return this.callService('/upload', 'POST', data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Upload multiple images
   */
  async uploadImages(data: any): Promise<any> {
    return this.callService('/upload/batch', 'POST', data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Delete media
   */
  async deleteMedia(data: any): Promise<any> {
    return this.callService('/delete', 'DELETE', data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

/**
 * Authentication service client
 */
class AuthService extends MicroserviceClient {
  constructor() {
    super('auth');
  }
  
  /**
   * Validate a token
   */
  async validateToken(token: string): Promise<any> {
    return this.callService('/validate-token', 'POST', { token });
  }
  
  /**
   * Generate a token
   */
  async generateToken(userId: string, type: string = 'ACCESS'): Promise<any> {
    return this.callService('/generate-token', 'POST', {
      userId,
      type
    });
  }
}

// Create instances
export const serviceRegistry = {
  search: new SearchService(),
  analytics: new AnalyticsService(),
  media: new MediaService(),
  auth: new AuthService()
};

// Expose as default and as named export
export const microservices = serviceRegistry;
export default serviceRegistry; 