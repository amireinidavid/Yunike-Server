import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { microservices } from './microservices';

const prisma = new PrismaClient();

interface ProductViewData {
  productId: string;
  userId?: string;
  sessionId?: string;
  source?: string;
  device?: string;
  referrer?: string;
  country?: string;
  region?: string;
  city?: string;
}

interface SearchQueryData {
  query: string;
  userId?: string;
  sessionId?: string;
  device?: string;
  resultsCount?: number;
  clickedProductId?: string;
}

interface UserActivityData {
  userId: string;
  sessionId?: string;
  activityType: string;
  metadata?: Record<string, any>;
}

class AnalyticsService {
  /**
   * Record a product view event
   */
  async recordProductView(data: ProductViewData): Promise<void> {
    try {
      // Check if we should use analytics microservice
      if (process.env.USE_ANALYTICS_SERVICE === 'true') {
        try {
          await microservices.analytics.trackEvent({
            eventType: 'product_view',
            data
          });
          return;
        } catch (error) {
          logger.warn('Analytics service unavailable, falling back to direct database recording');
          // Fall back to direct database recording
        }
      }
      
      // Create record in database
      await prisma.productView.create({
        data: {
          productId: data.productId,
          userId: data.userId,
          sessionId: data.sessionId,
          source: data.source,
          referrer: data.referrer,
          device: data.device,
          country: data.country,
          region: data.region,
          city: data.city,
        }
      });
      
      logger.debug(`Recorded product view: ${data.productId}`);
    } catch (error) {
      logger.error('Error recording product view:', error);
      // Don't throw error for analytics failures to avoid breaking main flow
    }
  }

  /**
   * Record a search query
   */
  async recordSearchQuery(data: SearchQueryData): Promise<void> {
    try {
      // Check if we should use analytics microservice
      if (process.env.USE_ANALYTICS_SERVICE === 'true') {
        try {
          await microservices.analytics.trackEvent({
            eventType: 'search_query',
            data
          });
          return;
        } catch (error) {
          logger.warn('Analytics service unavailable, falling back to direct database recording');
          // Fall back to direct database recording
        }
      }
      
      // Create record in database
      await prisma.searchQuery.create({
        data: {
          query: data.query,
          userId: data.userId,
          sessionId: data.sessionId,
          resultsCount: data.resultsCount || 0,
          clickedProductId: data.clickedProductId,
          device: data.device,
        }
      });
      
      logger.debug(`Recorded search query: ${data.query}`);
    } catch (error) {
      logger.error('Error recording search query:', error);
      // Don't throw error for analytics failures to avoid breaking main flow
    }
  }

  /**
   * Record user activity
   */
  async recordUserActivity(data: UserActivityData): Promise<void> {
    try {
      // Check if we should use analytics microservice
      if (process.env.USE_ANALYTICS_SERVICE === 'true') {
        try {
          await microservices.analytics.trackEvent({
            eventType: 'user_activity',
            data
          });
          return;
        } catch (error) {
          logger.warn('Analytics service unavailable, falling back to direct database recording');
          // Fall back to direct database recording
        }
      }
      
      // Get current date (just the date part, not time)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get or create user analytics record for today
      const userAnalytics = await prisma.userAnalytics.upsert({
        where: {
          userId_date: {
            userId: data.userId,
            date: today
          }
        },
        update: {},
        create: {
          userId: data.userId,
          date: today,
        }
      });
      
      // Update relevant metrics based on activity type
      const updateData: any = {};
      
      switch (data.activityType) {
        case 'page_view':
          updateData.pageViews = { increment: 1 };
          break;
        case 'login':
          updateData.loginCount = { increment: 1 };
          break;
        case 'search':
          updateData.searchCount = { increment: 1 };
          break;
        case 'product_view':
          updateData.productViewCount = { increment: 1 };
          break;
        case 'click':
          updateData.clicksCount = { increment: 1 };
          break;
        case 'favorite':
          updateData.favoriteActions = { increment: 1 };
          break;
        case 'review':
          updateData.reviewsSubmitted = { increment: 1 };
          break;
        case 'order':
          updateData.ordersPlaced = { increment: 1 };
          if (data.metadata?.amount) {
            updateData.totalSpent = { increment: data.metadata.amount };
          }
          break;
      }
      
      // Update user analytics record
      if (Object.keys(updateData).length > 0) {
        await prisma.userAnalytics.update({
          where: { id: userAnalytics.id },
          data: updateData
        });
      }
      
      logger.debug(`Recorded user activity: ${data.activityType} for user ${data.userId}`);
    } catch (error) {
      logger.error('Error recording user activity:', error);
      // Don't throw error for analytics failures to avoid breaking main flow
    }
  }

  /**
   * Get top viewed products for a time period
   */
  async getTopViewedProducts(days: number = 30, limit: number = 10): Promise<any[]> {
    try {
      // Check if we should use analytics microservice
      if (process.env.USE_ANALYTICS_SERVICE === 'true') {
        try {
          return await microservices.analytics.getDashboardMetrics({
            metric: 'top_products',
            days,
            limit
          });
        } catch (error) {
          logger.warn('Analytics service unavailable, falling back to direct database query');
          // Fall back to direct database query
        }
      }
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Get product view counts
      const productViews = await prisma.productView.groupBy({
        by: ['productId'],
        _count: {
          productId: true
        },
        where: {
          createdAt: {
            gte: startDate
          }
        },
        orderBy: {
          _count: {
            productId: 'desc'
          }
        },
        take: limit
      });
      
      // Get product details
      const products = await Promise.all(
        productViews.map(async (view) => {
          const product = await prisma.product.findUnique({
            where: { id: view.productId },
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
              images: {
                where: { isMain: true },
                take: 1,
                select: { url: true }
              },
              vendor: {
                select: {
                  id: true,
                  storeName: true
                }
              }
            }
          });
          
          return {
            ...product,
            viewCount: view._count.productId,
            mainImage: product?.images[0]?.url
          };
        })
      );
      
      return products;
    } catch (error) {
      logger.error('Error getting top viewed products:', error);
      return [];
    }
  }

  /**
   * Get popular search terms
   */
  async getPopularSearchTerms(days: number = 30, limit: number = 10): Promise<any[]> {
    try {
      // Check if we should use analytics microservice
      if (process.env.USE_ANALYTICS_SERVICE === 'true') {
        try {
          return await microservices.analytics.getDashboardMetrics({
            metric: 'popular_searches',
            days,
            limit
          });
        } catch (error) {
          logger.warn('Analytics service unavailable, falling back to direct database query');
          // Fall back to direct database query
        }
      }
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Get search query counts
      const searchQueries = await prisma.searchQuery.groupBy({
        by: ['query'],
        _count: {
          query: true
        },
        where: {
          createdAt: {
            gte: startDate
          }
        },
        orderBy: {
          _count: {
            query: 'desc'
          }
        },
        take: limit
      });
      
      return searchQueries.map(item => ({
        term: item.query,
        count: item._count.query
      }));
    } catch (error) {
      logger.error('Error getting popular search terms:', error);
      return [];
    }
  }
}

// Export a singleton instance
export const analyticsService = new AnalyticsService();

export default analyticsService; 