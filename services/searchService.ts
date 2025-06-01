import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { microservices } from './microservices';

const prisma = new PrismaClient();

interface SearchFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  vendorId?: string;
  condition?: string;
  inStock?: boolean;
  attributes?: Record<string, any>;
}

interface SearchOptions {
  page?: number;
  limit?: number;
  sort?: string;
}

interface SearchResults<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

class SearchService {
  /**
   * Search for products using advanced filters
   */
  async searchProducts(
    query: string,
    filters: SearchFilters = {},
    options: SearchOptions = { page: 1, limit: 20, sort: 'newest' }
  ): Promise<SearchResults<any>> {
    try {
      // Default options
      const page = options.page || 1;
      const limit = options.limit || 20;
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {
        isPublished: true,
        deletedAt: null,
      };
      
      // Add text search if query provided
      if (query) {
        where.OR = [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { shortDescription: { contains: query, mode: 'insensitive' } },
          { tagsAndKeywords: { has: query } },
        ];
      }
      
      // Apply category filter
      if (filters.category) {
        where.categories = {
          some: {
            OR: [
              { categoryId: filters.category },
              { category: { slug: filters.category } }
            ]
          }
        };
      }
      
      // Apply price range filters
      if (filters.minPrice !== undefined) {
        where.price = { gte: filters.minPrice };
      }
      
      if (filters.maxPrice !== undefined) {
        if (where.price) {
          where.price.lte = filters.maxPrice;
        } else {
          where.price = { lte: filters.maxPrice };
        }
      }
      
      // Apply vendor filter
      if (filters.vendorId) {
        where.vendorId = filters.vendorId;
      }
      
      // Apply condition filter
      if (filters.condition) {
        where.condition = filters.condition;
      }
      
      // Apply stock filter
      if (filters.inStock !== undefined) {
        where.inventory = filters.inStock ? { gt: 0 } : { equals: 0 };
      }
      
      // Define sorting
      let orderBy: any = {};
      switch (options.sort) {
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
      
      // Check if we should use external search service
      if (process.env.USE_EXTERNAL_SEARCH === 'true' && query) {
        try {
          // Try to use the microservice if available
          return await microservices.search.search(query, {
            filters,
            page,
            limit,
            sort: options.sort
          });
        } catch (error) {
          logger.warn('External search service unavailable, falling back to database search');
          // Fall back to database search
        }
      }
      
      // Execute the search query
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            images: {
              where: { isMain: true },
              take: 1
            },
            vendor: {
              select: {
                id: true,
                storeName: true,
                slug: true
              }
            },
            categories: {
              include: {
                category: {
                  select: {
                    id: true,
                    name: true,
                    slug: true
                  }
                }
              }
            }
          },
          orderBy,
          skip,
          take: limit
        }),
        prisma.product.count({ where })
      ]);
      
      return {
        items: products,
        total,
        page,
        limit
      };
    } catch (error) {
      logger.error('Search products error:', error);
      throw error;
    }
  }

  /**
   * Index a product in the search engine
   */
  async indexProduct(productId: string): Promise<void> {
    try {
      // Get product data
      const product = await prisma.product.findUnique({
        where: { id: productId },
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
        }
      });
      
      if (!product) {
        logger.warn(`Attempted to index non-existent product: ${productId}`);
        return;
      }
      
      // If using external search service
      if (process.env.USE_EXTERNAL_SEARCH === 'true') {
        try {
          await microservices.search.indexProduct(product);
          logger.debug(`Product ${productId} indexed in search service`);
        } catch (error) {
          logger.error(`Failed to index product ${productId} in search service:`, error);
        }
      }
    } catch (error) {
      logger.error(`Error indexing product ${productId}:`, error);
      throw error;
    }
  }

  /**
   * Remove a product from the search index
   */
  async removeProduct(productId: string): Promise<void> {
    try {
      // If using external search service
      if (process.env.USE_EXTERNAL_SEARCH === 'true') {
        try {
          // Use removeProduct method from search service instead of directly calling protected callService
          await microservices.search.removeProduct(productId);
          logger.debug(`Product ${productId} removed from search index`);
        } catch (error) {
          logger.error(`Failed to remove product ${productId} from search index:`, error);
        }
      }
    } catch (error) {
      logger.error(`Error removing product ${productId} from search:`, error);
      throw error;
    }
  }

  /**
   * Get search suggestions based on a query
   */
  async getSuggestions(query: string, limit: number = 5): Promise<string[]> {
    if (!query || query.length < 2) return [];
    
    try {
      if (process.env.USE_EXTERNAL_SEARCH === 'true') {
        try {
          return await microservices.search.autoComplete(query);
        } catch (error) {
          logger.warn('External search service unavailable for suggestions, falling back to database');
        }
      }
      
      // Fallback to database search
      const products = await prisma.product.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' },
          isPublished: true,
          deletedAt: null
        },
        select: { name: true },
        take: limit
      });
      
      return products.map(p => p.name);
    } catch (error) {
      logger.error('Error getting search suggestions:', error);
      return [];
    }
  }
}

// Export a singleton instance
export const searchService = new SearchService();

export default searchService; 