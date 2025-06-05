import { logger } from '../utils/logger';
import { realtimeService } from './realtimeService';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './emailService';

const prisma = new PrismaClient();

// Event types
export interface InventoryEvent {
  productId: string;
  vendorId: string;
  quantity: number;
  previousQuantity: number;
  orderId?: string;
  reason?: string;
  timestamp: string;
  lowStockThreshold?: number;
}

export interface OrderEvent {
  orderId: string;
  vendorId: string;
  userId: string;
  orderItems: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  status: string;
  timestamp: string;
}

export interface ProductEvent {
  productId: string;
  vendorId: string;
  name: string;
  action: 'created' | 'updated' | 'deleted';
  timestamp: string;
}

/**
 * EventService - A lightweight replacement for Kafka
 * Uses Socket.IO directly for real-time communications
 */
class EventService {
  private isInitialized = false;
  
  constructor() {}
  
  /**
   * Initialize the event service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      // Nothing to initialize as we're using Socket.IO directly
      this.isInitialized = true;
      logger.info('Event service initialized');
    } catch (error) {
      logger.error('Failed to initialize event service:', error);
    }
  }
  
  /**
   * Handle inventory update event
   */
  async publishInventoryUpdate(data: InventoryEvent): Promise<void> {
    try {
      logger.info(`Processing inventory update event for product ${data.productId}`);
      
      // Get product information
      const product = await prisma.product.findUnique({
        where: { id: data.productId },
        include: { vendor: true }
      });
      
      if (!product) {
        logger.warn(`Product ${data.productId} not found for inventory event`);
        return;
      }
      
      // Send real-time notification to vendor using Socket.IO
      realtimeService.notifyInventoryUpdate(data.vendorId, {
        id: product.id,
        name: product.name,
        inventory: data.quantity,
        previousInventory: data.previousQuantity,
        reason: data.reason || 'Inventory update',
        timestamp: data.timestamp || new Date().toISOString()
      });
      
      // Check if inventory is below threshold and send low inventory alert
      const threshold = product.lowStockThreshold || data.lowStockThreshold || 5;
      
      if (data.quantity <= threshold) {
        // Send real-time low stock notification
        realtimeService.notifyLowInventory(data.vendorId, {
          id: product.id,
          name: product.name,
          inventory: data.quantity,
          lowStockThreshold: threshold,
          timestamp: data.timestamp || new Date().toISOString()
        });
        
        // Also send email notification if vendor has email
        if (product.vendor?.contactEmail) {
          await sendEmail({
            to: product.vendor.contactEmail,
            subject: `Low Inventory Alert: ${product.name}`,
            template: 'low-inventory-alert',
            context: {
              vendorName: product.vendor.storeName,
              productName: product.name,
              productId: product.id,
              currentStock: data.quantity,
              threshold: threshold,
              dashboardUrl: `${process.env.VENDOR_FRONTEND_URL}/dashboard/products/${product.id}`
            }
          });
        }
      }
      
    } catch (error) {
      logger.error('Error processing inventory event:', error);
    }
  }
  
  /**
   * Handle order created event
   */
  async publishOrderCreated(data: OrderEvent): Promise<void> {
    try {
      logger.info(`Processing order created event for order ${data.orderId}`);
      
      // Send real-time notification to vendor
      realtimeService.notifyNewOrder(data.vendorId, {
        id: data.orderId,
        items: data.orderItems,
        totalAmount: data.totalAmount,
        status: data.status,
        timestamp: data.timestamp || new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error processing order event:', error);
    }
  }
  
  /**
   * Handle order updated event
   */
  async publishOrderUpdated(data: OrderEvent): Promise<void> {
    try {
      logger.info(`Processing order updated event for order ${data.orderId}`);
      
      // You could add specific logic for order updates here
      // For now, just reuse the notifyNewOrder method with an updated status
      realtimeService.notifyNewOrder(data.vendorId, {
        id: data.orderId,
        items: data.orderItems,
        totalAmount: data.totalAmount,
        status: data.status,
        timestamp: data.timestamp || new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error processing order update event:', error);
    }
  }
  
  /**
   * Close the event service
   */
  async close(): Promise<void> {
    // Nothing to close as we're using Socket.IO directly
    this.isInitialized = false;
    logger.info('Event service closed');
  }
}

// Export singleton instance
export const eventService = new EventService();
export default eventService; 